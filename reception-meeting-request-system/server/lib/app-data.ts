import type { AuthRole, AuthUser, Employee, MeetingRequest } from "../../shared/api.js";
import { createRepository } from "./storage.js";

export type PublicAuthUser = Omit<AuthUser, "createdAt"> & {
  createdAt: string;
};

export type StoredUser = PublicAuthUser & {
  passwordSalt: string;
  passwordHash: string;
};

export type StoredMeetingRequest = Omit<MeetingRequest, "requestedAt" | "updatedAt"> & {
  requestedAt: string;
  updatedAt: string;
};

export type StoredSession = {
  id: string;
  userId: string;
  expiresAt: string;
};

export type AppData = {
  version: 1;
  users: StoredUser[];
  sessions: StoredSession[];
  employees: Employee[];
  requests: StoredMeetingRequest[];
  localMigrationComplete: boolean;
};

export function publicUser(user: StoredUser): PublicAuthUser {
  const { passwordHash: _passwordHash, passwordSalt: _passwordSalt, ...safeUser } = user;
  return safeUser;
}

export function isEmployeeRole(role: AuthRole): boolean {
  return role === "MD" || role === "COO" || role === "President" || role === "Employee";
}

export function validateRoleLink(
  role: AuthRole,
  employeeId: string | null,
  employees: Employee[],
): void {
  if (!isEmployeeRole(role)) {
    if (employeeId !== null) {
      throw new Error("Receptionist and Admin accounts cannot be linked to an employee record.");
    }
    return;
  }
  const employee = employees.find((item) => item.id === employeeId);
  if (!employee || !employee.active) {
    throw new Error("Employee accounts must be linked to an active employee record.");
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface AppDataRepository {
  load(): Promise<AppData>;
  transact<T>(update: (data: AppData) => T | Promise<T>): Promise<T>;
}

// Authentication and visitor workflows depend on this boundary. Storage is a
// local JSON file for development and a hosted Redis store on Vercel
// (see storage.ts), with no change to the route rules.
const selected = createRepository();
export const storageKind = selected.kind;
export const storageDescription = selected.description;
export const appDataRepository: AppDataRepository = selected.repository;
