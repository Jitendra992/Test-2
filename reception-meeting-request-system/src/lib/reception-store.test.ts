import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EMPLOYEES_KEY,
  LocalStorageReceptionRepository,
  REQUESTS_KEY,
  type Employee,
  type NewMeetingRequest,
  type StorageLike,
} from './reception-store.ts';

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function makeEmployee(id: string, name: string, overrides: Partial<Employee> = {}): Employee {
  return {
    id,
    name,
    designation: 'Team member',
    department: 'Operations',
    loginEmail: '',
    active: true,
    canReceiveRequests: true,
    canTransferRequests: false,
    transferTo: [],
    ...overrides,
  };
}

function makeRequestInput(requestedEmployeeId: string): NewMeetingRequest {
  return {
    visitorName: 'Test Visitor',
    mobileNumber: '555-0100',
    company: 'Test Organization',
    purpose: 'Scheduled meeting',
    requestedEmployeeId,
    visitorCount: 2,
    idVehicleNumber: '',
    remarks: '',
  };
}

function setup() {
  const storage = new MemoryStorage();
  let currentTime = Date.parse('2026-10-01T10:00:00.000Z');
  let nextId = 0;
  const store = new LocalStorageReceptionRepository(
    storage,
    undefined,
    () => new Date(currentTime),
    () => `test-request-${++nextId}`,
  );
  return {
    storage,
    store,
    setTime: (value: string) => { currentTime = Date.parse(value); },
  };
}

test('a request moves through the employee and reception workflow and survives a reload', () => {
  const { storage, store, setTime } = setup();
  store.saveEmployee(makeEmployee('employee-a', 'Assigned employee'));
  const created = store.createRequest(makeRequestInput('employee-a'));

  assert.equal(created.status, 'Requested');
  assert.equal(created.requestedEmployeeId, 'employee-a');
  assert.equal(created.assignedEmployeeId, 'employee-a');
  assert.equal(created.updatedAt, created.requestedAt);

  const employeeView = new LocalStorageReceptionRepository(storage);
  assert.equal(employeeView.getSnapshot().requests[0]?.visitorName, 'Test Visitor');
  assert.equal(employeeView.getSnapshot().requests[0]?.status, 'Requested');

  setTime('2026-10-01T10:01:00.000Z');
  const accepted = store.respondToRequest(created.id, 'employee-a', 'call');
  assert.equal(accepted.status, 'Accepted');
  assert.ok(Date.parse(accepted.updatedAt) > Date.parse(created.updatedAt));

  setTime('2026-10-01T10:02:00.000Z');
  const calledIn = store.advanceRequest(created.id, 'Called In');
  assert.equal(calledIn.status, 'Called In');
  setTime('2026-10-01T10:03:00.000Z');
  const meeting = store.advanceRequest(created.id, 'Meeting');
  assert.equal(meeting.status, 'Meeting');
  setTime('2026-10-01T10:04:00.000Z');
  const completed = store.advanceRequest(created.id, 'Completed');
  assert.equal(completed.status, 'Completed');

  const reloaded = new LocalStorageReceptionRepository(storage);
  assert.equal(reloaded.getSnapshot().requests[0]?.status, 'Completed');
  assert.equal(reloaded.getSnapshot().requests[0]?.updatedAt, completed.updatedAt);
  assert.throws(() => reloaded.advanceRequest(created.id, 'Meeting'), /cannot move from Completed to Meeting/);
});

test('creation rejects ineligible recipients and invalid visitor counts without writing a request', () => {
  const { store } = setup();
  store.saveEmployee(makeEmployee('inactive', 'Inactive employee', { active: false }));
  store.saveEmployee(makeEmployee('not-receiving', 'Not receiving employee', { canReceiveRequests: false }));
  store.saveEmployee(makeEmployee('eligible', 'Eligible employee'));

  assert.throws(() => store.createRequest(makeRequestInput('inactive')), /active employee who can receive/);
  assert.throws(() => store.createRequest(makeRequestInput('not-receiving')), /active employee who can receive/);
  assert.throws(
    () => store.createRequest({ ...makeRequestInput('eligible'), visitorCount: 0 }),
    /whole number greater than zero/,
  );
  assert.equal(store.getSnapshot().requests.length, 0);
});

test('transfer permissions are enforced and the original requested employee is retained', () => {
  const { store } = setup();
  store.saveEmployee(makeEmployee('target', 'Approved target'));
  store.saveEmployee(makeEmployee('sender', 'Authorized sender', {
    canTransferRequests: true,
    transferTo: ['target'],
  }));
  store.saveEmployee(makeEmployee('other', 'Other employee'));
  const created = store.createRequest(makeRequestInput('sender'));

  assert.throws(() => store.transferRequest(created.id, 'other', 'target'), /not authorized/);
  const transferred = store.transferRequest(created.id, 'sender', 'target');
  assert.equal(transferred.status, 'Transferred');
  assert.ok(Date.parse(transferred.updatedAt) > Date.parse(created.updatedAt));
  assert.equal(transferred.requestedEmployeeId, 'sender');
  assert.equal(transferred.requestedEmployeeName, 'Authorized sender');
  assert.equal(transferred.assignedEmployeeId, 'target');
  assert.equal(transferred.assignedEmployeeName, 'Approved target');
  assert.throws(() => store.respondToRequest(created.id, 'sender', 'call'), /assigned to another employee/);
  assert.equal(store.respondToRequest(created.id, 'target', 'call').status, 'Accepted');
});

test('old request records receive an updatedAt value without discarding saved data', () => {
  const { storage, store } = setup();
  store.saveEmployee(makeEmployee('employee-a', 'Assigned employee'));
  const saved = store.createRequest(makeRequestInput('employee-a'));
  const legacy = { ...saved, updatedAt: undefined };
  storage.setItem(REQUESTS_KEY, JSON.stringify([legacy]));

  const migrated = new LocalStorageReceptionRepository(storage).getSnapshot().requests[0];
  assert.equal(migrated?.updatedAt, saved.requestedAt);
  assert.equal(migrated?.visitorName, saved.visitorName);
  assert.notEqual(storage.getItem(EMPLOYEES_KEY), null);
});

test('storage events refresh a subscribed repository in another tab', () => {
  const { storage, store } = setup();
  store.saveEmployee(makeEmployee('employee-a', 'Assigned employee'));
  const eventTarget = new EventTarget();
  const otherTab = new LocalStorageReceptionRepository(storage, eventTarget);
  let notifications = 0;
  const unsubscribe = otherTab.subscribe(() => { notifications += 1; });

  store.createRequest(makeRequestInput('employee-a'));
  const event = new Event('storage');
  Object.defineProperties(event, {
    key: { value: REQUESTS_KEY },
    storageArea: { value: storage },
  });
  eventTarget.dispatchEvent(event);

  assert.equal(otherTab.getSnapshot().requests.length, 1);
  assert.equal(notifications, 1);
  unsubscribe();
});