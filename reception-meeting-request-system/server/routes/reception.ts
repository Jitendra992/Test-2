import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import {
  AdvanceMeetingRequestBody,
  CreateMeetingRequestBody,
  CreateReceptionEmployeeBody,
  MigrateLocalReceptionDataBody,
  RespondToMeetingRequestBody,
  SetReceptionEmployeeActiveBody,
  TransferMeetingRequestBody,
  UpdateReceptionEmployeeBody,
} from "../../shared/api.js";
import {
  isEmployeeRole,
  appDataRepository,
  type AppData,
} from "../lib/app-data.js";
import { HttpError, requireRoles, requireUser } from "../lib/http-error.js";

const router: IRouter = Router();
const EMPLOYEE_ACTION_STATUSES = new Set(["Requested", "Waiting", "Transferred"]);
const RECEPTION_TRANSITIONS: Record<string, string> = {
  Accepted: "Called In",
  "Called In": "Meeting",
  Meeting: "Completed",
};

function invalidBody(message: string): never {
  throw new HttpError(400, message);
}

function nextTimestamp(previous?: string): string {
  const now = Date.now();
  const previousTime = previous ? Date.parse(previous) : Number.NaN;
  return new Date(Math.max(now, Number.isFinite(previousTime) ? previousTime + 1 : now)).toISOString();
}

function requireEmployee(data: AppData, user: Awaited<ReturnType<typeof requireUser>>) {
  if (!isEmployeeRole(user.role) || !user.employeeId) {
    throw new HttpError(403, "An employee account is required for this action.");
  }
  const employee = data.employees.find(
    (item) => item.id === user.employeeId && item.active,
  );
  if (!employee) throw new HttpError(403, "This employee account is inactive.");
  return employee;
}

function getRequest(data: AppData, requestId: string) {
  const request = data.requests.find((item) => item.id === requestId);
  if (!request) throw new HttpError(404, "Meeting request was not found.");
  return request;
}

function updateRequest(data: AppData, requestId: string, update: (current: AppData["requests"][number]) => void) {
  const request = getRequest(data, requestId);
  update(request);
  request.updatedAt = nextTimestamp(request.updatedAt);
  return request;
}

function normalizeEmployeeInput(employee: AppData["employees"][number], data: AppData, currentId?: string) {
  const id = employee.id.trim();
  const name = employee.name.trim();
  if (!id || !name) throw new HttpError(400, "Employee ID and name are required.");
  const eligibleTargets = new Set(
    data.employees
      .filter((item) => item.id !== id && item.active && item.canReceiveRequests)
      .map((item) => item.id),
  );
  const normalized = {
    ...employee,
    id,
    name,
    designation: employee.designation.trim(),
    department: employee.department.trim(),
    loginEmail: employee.loginEmail.trim(),
    transferTo: [...new Set(employee.transferTo)].filter((targetId) => eligibleTargets.has(targetId)),
  };
  if (data.employees.some((item) => item.id === id && item.id !== currentId)) {
    throw new HttpError(409, "An employee with this ID already exists.");
  }
  return normalized;
}

function cleanTransferReferences(data: AppData, employeeId: string): void {
  data.employees = data.employees.map((employee) =>
    employee.id === employeeId
      ? employee
      : { ...employee, transferTo: employee.transferTo.filter((targetId) => targetId !== employeeId) },
  );
}

router.get("/reception/snapshot", async (request, response) => {
  const user = await requireUser(request);
  const data = await appDataRepository.load();
  const visibleRequests = isEmployeeRole(user.role)
    ? data.requests.filter((item) => item.assignedEmployeeId === user.employeeId)
    : data.requests;
  const visibleEmployees = data.employees.map((employee) =>
    user.role === "Admin" ? employee : { ...employee, loginEmail: "" },
  );
  response.json({
    requests: visibleRequests,
    employees: visibleEmployees,
    migrationAvailable:
      user.role === "Admin" &&
      !data.localMigrationComplete &&
      data.requests.length === 0 &&
      data.employees.length === 0,
  });
});

router.post("/reception/migrate-local", async (request, response) => {
  const user = await requireUser(request);
  requireRoles(user, "Admin");
  const parsed = MigrateLocalReceptionDataBody.safeParse(request.body);
  if (!parsed.success) invalidBody(parsed.error.issues[0]?.message || "The browser data could not be imported.");
  const { requests, employees } = parsed.data;
  const employeeIds = new Set(employees.map((employee) => employee.id));
  if (employeeIds.size !== employees.length) throw new HttpError(400, "The browser data contains duplicate employee IDs.");
  if (new Set(requests.map((item) => item.id)).size !== requests.length) {
    throw new HttpError(400, "The browser data contains duplicate request IDs.");
  }
  if (requests.some((item) => !employeeIds.has(item.requestedEmployeeId) || !employeeIds.has(item.assignedEmployeeId))) {
    throw new HttpError(400, "The browser data contains a request linked to a missing employee.");
  }
  if (requests.length === 0 && employees.length === 0) {
    response.json({ imported: false, requestCount: 0, employeeCount: 0 });
    return;
  }
  const importedRequests = requests.map((item) => ({
    ...item,
    requestedAt: item.requestedAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  }));

  const result = await appDataRepository.transact((data) => {
    if (
      data.localMigrationComplete ||
      data.requests.length > 0 ||
      data.employees.length > 0
    ) {
      throw new HttpError(409, "Local import is closed because shared data already exists.");
    }
    data.employees = employees;
    data.requests = importedRequests;
    data.localMigrationComplete = true;
    return { imported: true, requestCount: requests.length, employeeCount: employees.length };
  });
  response.json(result);
});

router.post("/reception/requests", async (request, response) => {
  const user = await requireUser(request);
  requireRoles(user, "Receptionist");
  const parsed = CreateMeetingRequestBody.safeParse(request.body);
  if (!parsed.success) invalidBody(parsed.error.issues[0]?.message || "Enter valid visitor details.");
  const input = parsed.data;
  const requestRecord = await appDataRepository.transact((data) => {
    const employee = data.employees.find(
      (item) =>
        item.id === input.requestedEmployeeId &&
        item.active &&
        item.canReceiveRequests,
    );
    if (!employee) throw new HttpError(400, "Choose an active employee who can receive requests.");
    const timestamp = new Date().toISOString();
    const created = {
      id: randomUUID(),
      visitorName: input.visitorName.trim(),
      mobileNumber: input.mobileNumber.trim(),
      company: input.company.trim(),
      purpose: input.purpose.trim(),
      requestedEmployeeId: employee.id,
      requestedEmployeeName: employee.name,
      assignedEmployeeId: employee.id,
      assignedEmployeeName: employee.name,
      visitorCount: input.visitorCount,
      idVehicleNumber: input.idVehicleNumber.trim(),
      remarks: input.remarks.trim(),
      requestedAt: timestamp,
      updatedAt: timestamp,
      status: "Requested" as const,
    };
    data.localMigrationComplete = true;
    data.requests.unshift(created);
    return created;
  });
  response.status(201).json(requestRecord);
});

router.post("/reception/requests/:id/action", async (request, response) => {
  const user = await requireUser(request);
  const parsed = RespondToMeetingRequestBody.safeParse(request.body);
  if (!parsed.success) invalidBody(parsed.error.issues[0]?.message || "Choose a valid employee action.");
  const updated = await appDataRepository.transact((data) => {
    const employee = requireEmployee(data, user);
    const current = getRequest(data, request.params.id);
    if (current.assignedEmployeeId !== employee.id) {
      throw new HttpError(403, "This request is assigned to another employee.");
    }
    if (!EMPLOYEE_ACTION_STATUSES.has(current.status)) {
      throw new HttpError(409, "This request no longer accepts employee actions.");
    }
    return updateRequest(data, current.id, (item) => {
      item.status =
        parsed.data.action === "call"
          ? "Accepted"
          : parsed.data.action === "wait"
            ? "Waiting"
            : "Declined";
    });
  });
  response.json(updated);
});

router.post("/reception/requests/:id/transfer", async (request, response) => {
  const user = await requireUser(request);
  const parsed = TransferMeetingRequestBody.safeParse(request.body);
  if (!parsed.success) invalidBody(parsed.error.issues[0]?.message || "Choose a valid transfer target.");
  const updated = await appDataRepository.transact((data) => {
    const employee = requireEmployee(data, user);
    const current = getRequest(data, request.params.id);
    if (current.assignedEmployeeId !== employee.id) {
      throw new HttpError(403, "This request is assigned to another employee.");
    }
    if (!employee.canTransferRequests) {
      throw new HttpError(403, "This employee is not authorized to transfer requests.");
    }
    if (!EMPLOYEE_ACTION_STATUSES.has(current.status)) {
      throw new HttpError(409, "This request can no longer be transferred.");
    }
    const target = data.employees.find(
      (item) =>
        item.id === parsed.data.targetEmployeeId &&
        item.id !== employee.id &&
        item.active &&
        item.canReceiveRequests,
    );
    if (!target || !employee.transferTo.includes(target.id)) {
      throw new HttpError(400, "Choose an active employee allowed by the transfer hierarchy.");
    }
    return updateRequest(data, current.id, (item) => {
      item.assignedEmployeeId = target.id;
      item.assignedEmployeeName = target.name;
      item.status = "Transferred";
    });
  });
  response.json(updated);
});

router.patch("/reception/requests/:id/status", async (request, response) => {
  const user = await requireUser(request);
  requireRoles(user, "Receptionist");
  const parsed = AdvanceMeetingRequestBody.safeParse(request.body);
  if (!parsed.success) invalidBody(parsed.error.issues[0]?.message || "Choose a valid next status.");
  const updated = await appDataRepository.transact((data) => {
    const current = getRequest(data, request.params.id);
    const next = RECEPTION_TRANSITIONS[current.status];
    if (next !== parsed.data.status) {
      throw new HttpError(409, `A request cannot move from ${current.status} to ${parsed.data.status}.`);
    }
    return updateRequest(data, current.id, (item) => {
      item.status = parsed.data.status;
    });
  });
  response.json(updated);
});

router.post("/reception/employees", async (request, response) => {
  const user = await requireUser(request);
  requireRoles(user, "Admin");
  const parsed = CreateReceptionEmployeeBody.safeParse(request.body);
  if (!parsed.success) invalidBody(parsed.error.issues[0]?.message || "Enter valid employee details.");
  const employee = await appDataRepository.transact((data) => {
    const normalized = normalizeEmployeeInput(parsed.data, data);
    data.employees.push(normalized);
    data.localMigrationComplete = true;
    return normalized;
  });
  response.status(201).json(employee);
});

router.put("/reception/employees/:id", async (request, response) => {
  const user = await requireUser(request);
  requireRoles(user, "Admin");
  const parsed = UpdateReceptionEmployeeBody.safeParse(request.body);
  if (!parsed.success) invalidBody(parsed.error.issues[0]?.message || "Enter valid employee details.");
  if (parsed.data.id !== request.params.id) throw new HttpError(400, "Employee ID does not match the route.");
  const employee = await appDataRepository.transact((data) => {
    const current = data.employees.find((item) => item.id === request.params.id);
    const normalized = normalizeEmployeeInput(parsed.data, data, current?.id);
    if (current) {
      data.employees = data.employees.map((item) => item.id === current.id ? normalized : item);
    } else {
      data.employees.push(normalized);
    }
    if (!normalized.active || !normalized.canReceiveRequests) {
      cleanTransferReferences(data, normalized.id);
    }
    data.localMigrationComplete = true;
    return normalized;
  });
  response.json(employee);
});

router.patch("/reception/employees/:id/active", async (request, response) => {
  const user = await requireUser(request);
  requireRoles(user, "Admin");
  const parsed = SetReceptionEmployeeActiveBody.safeParse(request.body);
  if (!parsed.success) invalidBody(parsed.error.issues[0]?.message || "Set a valid active status.");
  const employee = await appDataRepository.transact((data) => {
    const current = data.employees.find((item) => item.id === request.params.id);
    if (!current) throw new HttpError(404, "Employee was not found.");
    current.active = parsed.data.active;
    if (!current.active) cleanTransferReferences(data, current.id);
    data.localMigrationComplete = true;
    return current;
  });
  response.json(employee);
});

export default router;