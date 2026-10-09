export type Status =
  | 'Waiting'
  | 'Requested'
  | 'Accepted'
  | 'Transferred'
  | 'Declined'
  | 'Called In'
  | 'Meeting'
  | 'Completed';

export type Employee = {
  id: string;
  name: string;
  designation: string;
  department: string;
  loginEmail: string;
  active: boolean;
  canReceiveRequests: boolean;
  canTransferRequests: boolean;
  transferTo: string[];
};

export type MeetingRequest = {
  id: string;
  visitorName: string;
  mobileNumber: string;
  company: string;
  purpose: string;
  requestedEmployeeId: string;
  requestedEmployeeName: string;
  assignedEmployeeId: string;
  assignedEmployeeName: string;
  visitorCount: number;
  idVehicleNumber: string;
  remarks: string;
  requestedAt: string;
  updatedAt: string;
  status: Status;
};

export type NewMeetingRequest = {
  visitorName: string;
  mobileNumber: string;
  company: string;
  purpose: string;
  requestedEmployeeId: string;
  visitorCount: number;
  idVehicleNumber: string;
  remarks: string;
};

export type EmployeeAction = 'call' | 'wait' | 'decline';

export type ReceptionSnapshot = {
  requests: MeetingRequest[];
  employees: Employee[];
};

export interface ReceptionRepository {
  getSnapshot(): ReceptionSnapshot;
  subscribe(listener: () => void): () => void;
  createRequest(input: NewMeetingRequest): MeetingRequest;
  respondToRequest(requestId: string, employeeId: string, action: EmployeeAction): MeetingRequest;
  transferRequest(requestId: string, employeeId: string, targetEmployeeId: string): MeetingRequest;
  advanceRequest(requestId: string, status: 'Called In' | 'Meeting' | 'Completed'): MeetingRequest;
  saveEmployee(employee: Employee): void;
  toggleEmployeeActive(employeeId: string): void;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const REQUESTS_KEY = 'reception-coordination-requests-v2';
export const EMPLOYEES_KEY = 'reception-coordination-employees-v2';
export const STATUSES: Status[] = [
  'Waiting',
  'Requested',
  'Accepted',
  'Transferred',
  'Declined',
  'Called In',
  'Meeting',
  'Completed',
];

const EMPLOYEE_ACTION_STATUSES: Status[] = ['Requested', 'Waiting', 'Transferred'];
const RECEPTION_TRANSITIONS: Partial<Record<Status, Status>> = {
  Accepted: 'Called In',
  'Called In': 'Meeting',
  Meeting: 'Completed',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readArray<T>(storage: StorageLike, key: string, normalize: (value: unknown, index: number) => T): T[] {
  const raw = storage.getItem(key);
  if (raw === null) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Saved reception data in "${key}" is unreadable. It was not overwritten.`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Saved reception data in "${key}" has an invalid format. It was not overwritten.`);
  }
  return parsed.map(normalize);
}

function normalizeEmployee(value: unknown, index: number): Employee {
  if (!isRecord(value)) throw new Error(`Saved employee record ${index + 1} is invalid.`);
  const { id, name, designation, department, loginEmail, active, canReceiveRequests, canTransferRequests, transferTo } = value;
  if (
    typeof id !== 'string' ||
    typeof name !== 'string' ||
    typeof designation !== 'string' ||
    typeof department !== 'string' ||
    typeof (loginEmail ?? '') !== 'string' ||
    typeof active !== 'boolean' ||
    typeof canReceiveRequests !== 'boolean' ||
    typeof canTransferRequests !== 'boolean' ||
    !Array.isArray(transferTo) ||
    !transferTo.every(target => typeof target === 'string')
  ) {
    throw new Error(`Saved employee record ${index + 1} is invalid.`);
  }
  return {
    id,
    name,
    designation,
    department,
    loginEmail: (loginEmail as string | undefined) ?? '',
    active,
    canReceiveRequests,
    canTransferRequests,
    transferTo: [...transferTo] as string[],
  };
}

function normalizeRequest(value: unknown, index: number): MeetingRequest {
  if (!isRecord(value)) throw new Error(`Saved meeting request ${index + 1} is invalid.`);
  const requiredStrings = [
    'id',
    'visitorName',
    'mobileNumber',
    'purpose',
    'requestedEmployeeId',
    'requestedEmployeeName',
    'requestedAt',
  ];
  if (requiredStrings.some(key => typeof value[key] !== 'string' || !(value[key] as string).trim())) {
    throw new Error(`Saved meeting request ${index + 1} is missing required data.`);
  }
  if (!STATUSES.includes(value.status as Status)) {
    throw new Error(`Saved meeting request ${index + 1} has an unknown status.`);
  }
  const requestedAt = value.requestedAt as string;
  if (!Number.isFinite(Date.parse(requestedAt))) {
    throw new Error(`Saved meeting request ${index + 1} has an invalid request time.`);
  }
  const visitorCount = Number(value.visitorCount);
  if (!Number.isSafeInteger(visitorCount) || visitorCount < 1) {
    throw new Error(`Saved meeting request ${index + 1} has an invalid visitor count.`);
  }
  const requestedEmployeeId = value.requestedEmployeeId as string;
  const requestedEmployeeName = value.requestedEmployeeName as string;
  const assignedEmployeeId =
    typeof value.assignedEmployeeId === 'string' ? value.assignedEmployeeId : requestedEmployeeId;
  const assignedEmployeeName =
    typeof value.assignedEmployeeName === 'string' ? value.assignedEmployeeName : requestedEmployeeName;
  const updatedAt =
    typeof value.updatedAt === 'string' && Number.isFinite(Date.parse(value.updatedAt))
      ? value.updatedAt
      : requestedAt;
  const optionalString = (key: string) => (typeof value[key] === 'string' ? (value[key] as string) : '');

  return {
    id: value.id as string,
    visitorName: value.visitorName as string,
    mobileNumber: value.mobileNumber as string,
    company: optionalString('company'),
    purpose: value.purpose as string,
    requestedEmployeeId,
    requestedEmployeeName,
    assignedEmployeeId,
    assignedEmployeeName,
    visitorCount,
    idVehicleNumber: optionalString('idVehicleNumber'),
    remarks: optionalString('remarks'),
    requestedAt,
    updatedAt,
    status: value.status as Status,
  };
}

export class LocalStorageReceptionRepository implements ReceptionRepository {
  private snapshot: ReceptionSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly onStorageEvent: EventListener;
  private readonly storage: StorageLike;
  private readonly eventTarget?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  private readonly now: () => Date;
  private readonly makeId: () => string;

  constructor(
    storage: StorageLike,
    eventTarget?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>,
    now: () => Date = () => new Date(),
    makeId: () => string = () => globalThis.crypto.randomUUID(),
  ) {
    this.storage = storage;
    this.eventTarget = eventTarget;
    this.now = now;
    this.makeId = makeId;
    this.snapshot = this.readSnapshot();
    this.onStorageEvent = event => this.handleStorageEvent(event as StorageEvent);
  }

  getSnapshot = (): ReceptionSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    const wasEmpty = this.listeners.size === 0;
    this.listeners.add(listener);
    if (wasEmpty) this.eventTarget?.addEventListener('storage', this.onStorageEvent);
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.eventTarget?.removeEventListener('storage', this.onStorageEvent);
    };
  };

  createRequest(input: NewMeetingRequest): MeetingRequest {
    const visitorName = this.requiredText(input.visitorName, 'Visitor name');
    const mobileNumber = this.requiredText(input.mobileNumber, 'Mobile number');
    const purpose = this.requiredText(input.purpose, 'Purpose of visit');
    const employee = this.snapshot.employees.find(
      item => item.id === input.requestedEmployeeId && item.active && item.canReceiveRequests,
    );
    if (!employee) throw new Error('Choose an active employee who can receive requests.');
    if (!Number.isSafeInteger(input.visitorCount) || input.visitorCount < 1) {
      throw new Error('Number of visitors must be a whole number greater than zero.');
    }

    const requestedAt = this.now().toISOString();
    const request: MeetingRequest = {
      id: this.makeId(),
      visitorName,
      mobileNumber,
      company: input.company.trim(),
      purpose,
      requestedEmployeeId: employee.id,
      requestedEmployeeName: employee.name,
      assignedEmployeeId: employee.id,
      assignedEmployeeName: employee.name,
      visitorCount: input.visitorCount,
      idVehicleNumber: input.idVehicleNumber.trim(),
      remarks: input.remarks.trim(),
      requestedAt,
      updatedAt: requestedAt,
      status: 'Requested',
    };
    this.commitRequests([request, ...this.snapshot.requests]);
    return request;
  }

  respondToRequest(requestId: string, employeeId: string, action: EmployeeAction): MeetingRequest {
    const employee = this.snapshot.employees.find(item => item.id === employeeId);
    if (!employee?.active) throw new Error('This employee is inactive and cannot respond to requests.');
    const request = this.requireAssignedRequest(requestId, employeeId);
    if (!EMPLOYEE_ACTION_STATUSES.includes(request.status)) {
      throw new Error('This request no longer accepts employee actions.');
    }
    const status: Status =
      action === 'call' ? 'Accepted' : action === 'wait' ? 'Waiting' : 'Declined';
    return this.updateRequest(requestId, current => ({ ...current, status }));
  }

  transferRequest(requestId: string, employeeId: string, targetEmployeeId: string): MeetingRequest {
    const employee = this.snapshot.employees.find(item => item.id === employeeId);
    if (!employee?.active || !employee.canTransferRequests) {
      throw new Error('This employee is not authorized to transfer requests.');
    }
    const request = this.requireAssignedRequest(requestId, employeeId);
    if (!EMPLOYEE_ACTION_STATUSES.includes(request.status)) {
      throw new Error('This request can no longer be transferred.');
    }
    const target = this.snapshot.employees.find(item => item.id === targetEmployeeId);
    if (
      !target ||
      target.id === employee.id ||
      !target.active ||
      !target.canReceiveRequests ||
      !employee.transferTo.includes(target.id)
    ) {
      throw new Error('Choose an active employee allowed by the transfer hierarchy.');
    }
    return this.updateRequest(requestId, current => ({
      ...current,
      assignedEmployeeId: target.id,
      assignedEmployeeName: target.name,
      status: 'Transferred',
    }));
  }

  advanceRequest(requestId: string, status: 'Called In' | 'Meeting' | 'Completed'): MeetingRequest {
    const request = this.snapshot.requests.find(item => item.id === requestId);
    if (!request) throw new Error('Meeting request was not found.');
    if (RECEPTION_TRANSITIONS[request.status] !== status) {
      throw new Error(`A request cannot move from ${request.status} to ${status}.`);
    }
    return this.updateRequest(requestId, current => ({ ...current, status }));
  }

  saveEmployee(employee: Employee): void {
    const id = this.requiredText(employee.id, 'Employee ID');
    const name = this.requiredText(employee.name, 'Employee name');
    const eligibleTargets = new Set(
      this.snapshot.employees
        .filter(item => item.id !== id && item.active && item.canReceiveRequests)
        .map(item => item.id),
    );
    const normalized: Employee = {
      ...employee,
      id,
      name,
      designation: employee.designation.trim(),
      department: employee.department.trim(),
      loginEmail: employee.loginEmail.trim(),
      transferTo: [...new Set(employee.transferTo)].filter(targetId => eligibleTargets.has(targetId)),
    };
    const exists = this.snapshot.employees.some(item => item.id === id);
    let employees = exists
      ? this.snapshot.employees.map(item => (item.id === id ? normalized : item))
      : [...this.snapshot.employees, normalized];

    if (!normalized.active || !normalized.canReceiveRequests) {
      employees = employees.map(item =>
        item.id === id ? item : { ...item, transferTo: item.transferTo.filter(targetId => targetId !== id) },
      );
    }
    this.commitEmployees(employees);
  }

  toggleEmployeeActive(employeeId: string): void {
    const employee = this.snapshot.employees.find(item => item.id === employeeId);
    if (!employee) throw new Error('Employee was not found.');
    const active = !employee.active;
    const employees = this.snapshot.employees.map(item => {
      if (item.id === employeeId) return { ...item, active };
      return active
        ? item
        : { ...item, transferTo: item.transferTo.filter(targetId => targetId !== employeeId) };
    });
    this.commitEmployees(employees);
  }

  private readSnapshot(): ReceptionSnapshot {
    return {
      requests: readArray(this.storage, REQUESTS_KEY, normalizeRequest),
      employees: readArray(this.storage, EMPLOYEES_KEY, normalizeEmployee),
    };
  }

  private handleStorageEvent(event: StorageEvent): void {
    if (event.storageArea && event.storageArea !== this.storage) return;
    if (event.key !== null && event.key !== REQUESTS_KEY && event.key !== EMPLOYEES_KEY) return;
    try {
      this.snapshot = this.readSnapshot();
      this.emit();
    } catch (error) {
      console.error('Could not refresh reception data from browser storage.', error);
    }
  }

  private commitRequests(requests: MeetingRequest[]): void {
    this.persist(REQUESTS_KEY, requests);
    this.snapshot = { ...this.snapshot, requests };
    this.emit();
  }

  private commitEmployees(employees: Employee[]): void {
    this.persist(EMPLOYEES_KEY, employees);
    this.snapshot = { ...this.snapshot, employees };
    this.emit();
  }

  private persist(key: string, value: unknown): void {
    try {
      this.storage.setItem(key, JSON.stringify(value));
    } catch {
      throw new Error('Could not save this change in browser storage. Check storage permissions and try again.');
    }
  }

  private updateRequest(
    requestId: string,
    update: (request: MeetingRequest) => MeetingRequest,
  ): MeetingRequest {
    const current = this.snapshot.requests.find(item => item.id === requestId);
    if (!current) throw new Error('Meeting request was not found.');
    const updated = { ...update(current), updatedAt: this.nextTimestamp(current.updatedAt) };
    this.commitRequests(this.snapshot.requests.map(item => (item.id === requestId ? updated : item)));
    return updated;
  }

  private requireAssignedRequest(requestId: string, employeeId: string): MeetingRequest {
    const request = this.snapshot.requests.find(item => item.id === requestId);
    if (!request) throw new Error('Meeting request was not found.');
    if (request.assignedEmployeeId !== employeeId) {
      throw new Error('This request is assigned to another employee.');
    }
    return request;
  }

  private nextTimestamp(previous: string): string {
    const currentTime = this.now().getTime();
    const previousTime = Date.parse(previous);
    return new Date(Math.max(currentTime, Number.isFinite(previousTime) ? previousTime + 1 : currentTime)).toISOString();
  }

  private requiredText(value: string, label: string): string {
    const normalized = value.trim();
    if (!normalized) throw new Error(`${label} is required.`);
    return normalized;
  }

  private emit(): void {
    this.listeners.forEach(listener => listener());
  }
}