import type { AuthUser, Employee } from "@shared/api";
import {
  LocalStorageReceptionRepository,
  type EmployeeAction,
  type MeetingRequest,
  type NewMeetingRequest,
  type ReceptionSnapshot,
  type Status,
} from "./reception-store";
import { apiRequest, jsonBody } from "./api-client";

export type ApiReceptionState = ReceptionSnapshot & {
  migrationAvailable: boolean;
  loading: boolean;
  error: string;
  migrationWarning: string;
};

const emptyState = (): ApiReceptionState => ({
  requests: [],
  employees: [],
  migrationAvailable: false,
  loading: false,
  error: "",
  migrationWarning: "",
});

export class ApiReceptionRepository {
  private state = emptyState();
  private readonly listeners = new Set<() => void>();
  private user: AuthUser | null = null;

  getSnapshot = (): ApiReceptionState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async loadFor(user: AuthUser): Promise<void> {
    this.user = user;
    this.state = { ...emptyState(), loading: true };
    this.emit();
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (!this.user) return;
    try {
      let remote = await apiRequest<ReceptionSnapshot & { migrationAvailable: boolean }>(
        "/reception/snapshot",
      );
      let migrationWarning = "";
      if (remote.migrationAvailable && this.user.role === "Admin") {
        try {
          const legacy = new LocalStorageReceptionRepository(window.localStorage).getSnapshot();
          if (legacy.requests.length || legacy.employees.length) {
            await apiRequest("/reception/migrate-local", {
              method: "POST",
              body: jsonBody(legacy),
            });
            remote = await apiRequest<ReceptionSnapshot & { migrationAvailable: boolean }>(
              "/reception/snapshot",
            );
          }
        } catch (error) {
          migrationWarning =
            error instanceof Error
              ? `Existing browser records were left untouched and could not be imported: ${error.message}`
              : "Existing browser records were left untouched and could not be imported.";
        }
      }
      this.state = {
        ...remote,
        loading: false,
        error: "",
        migrationWarning,
      };
      this.emit();
    } catch (error) {
      this.state = {
        ...this.state,
        loading: false,
        error: error instanceof Error ? error.message : "Could not load shared reception data.",
      };
      this.emit();
      throw error;
    }
  }

  clear(): void {
    this.user = null;
    this.state = emptyState();
    this.emit();
  }

  async createRequest(input: NewMeetingRequest): Promise<MeetingRequest> {
    const request = await apiRequest<MeetingRequest>("/reception/requests", {
      method: "POST",
      body: jsonBody(input),
    });
    this.upsertRequest(request);
    return request;
  }

  async respondToRequest(requestId: string, action: EmployeeAction): Promise<MeetingRequest> {
    const request = await apiRequest<MeetingRequest>(
      `/reception/requests/${encodeURIComponent(requestId)}/action`,
      { method: "POST", body: jsonBody({ action }) },
    );
    this.upsertRequest(request);
    return request;
  }

  async transferRequest(requestId: string, targetEmployeeId: string): Promise<MeetingRequest> {
    const request = await apiRequest<MeetingRequest>(
      `/reception/requests/${encodeURIComponent(requestId)}/transfer`,
      { method: "POST", body: jsonBody({ targetEmployeeId }) },
    );
    this.upsertRequest(request);
    return request;
  }

  async advanceRequest(
    requestId: string,
    status: Extract<Status, "Called In" | "Meeting" | "Completed">,
  ): Promise<MeetingRequest> {
    const request = await apiRequest<MeetingRequest>(
      `/reception/requests/${encodeURIComponent(requestId)}/status`,
      { method: "PATCH", body: jsonBody({ status }) },
    );
    this.upsertRequest(request);
    return request;
  }

  async saveEmployee(employee: Employee): Promise<Employee> {
    const exists = this.state.employees.some((item) => item.id === employee.id);
    const saved = await apiRequest<Employee>(
      exists
        ? `/reception/employees/${encodeURIComponent(employee.id)}`
        : "/reception/employees",
      { method: exists ? "PUT" : "POST", body: jsonBody(employee) },
    );
    const employees = exists
      ? this.state.employees.map((item) => (item.id === saved.id ? saved : item))
      : [...this.state.employees, saved];
    this.state = { ...this.state, employees, error: "" };
    this.emit();
    return saved;
  }

  async toggleEmployeeActive(employeeId: string): Promise<Employee> {
    const employee = this.state.employees.find((item) => item.id === employeeId);
    if (!employee) throw new Error("Employee was not found.");
    const updated = await apiRequest<Employee>(
      `/reception/employees/${encodeURIComponent(employeeId)}/active`,
      { method: "PATCH", body: jsonBody({ active: !employee.active }) },
    );
    const employees = this.state.employees.map((item) =>
      item.id === updated.id
        ? updated
        : !updated.active
          ? { ...item, transferTo: item.transferTo.filter((id) => id !== updated.id) }
          : item,
    );
    this.state = { ...this.state, employees, error: "" };
    this.emit();
    return updated;
  }

  private upsertRequest(request: MeetingRequest): void {
    const requests = this.state.requests.filter((item) => item.id !== request.id);
    const canSeeRequest =
      !this.user ||
      !["MD", "COO", "President", "Employee"].includes(this.user.role) ||
      request.assignedEmployeeId === this.user.employeeId;
    if (canSeeRequest) requests.unshift(request);
    this.state = { ...this.state, requests, error: "" };
    this.emit();
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }
}