import type {
  AuthRole,
  AuthUser,
  AuthUserInput,
  AuthUserUpdate,
} from "@shared/api";
import { apiRequest, jsonBody } from "./api-client";

export type BootstrapStatus = { available: boolean; requiresToken: boolean };

export function getBootstrapStatus(): Promise<BootstrapStatus> {
  return apiRequest("/auth/bootstrap-status");
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const result = await apiRequest<{ user: AuthUser | null }>("/auth/session");
  return result.user;
}

export async function createFirstAdmin(input: {
  name: string;
  email: string;
  password: string;
  bootstrapToken?: string;
}): Promise<AuthUser> {
  const result = await apiRequest<{ user: AuthUser }>("/auth/bootstrap", {
    method: "POST",
    body: jsonBody(input),
  });
  return result.user;
}

export async function signIn(email: string, password: string): Promise<AuthUser> {
  const result = await apiRequest<{ user: AuthUser }>("/auth/login", {
    method: "POST",
    body: jsonBody({ email, password }),
  });
  return result.user;
}

export async function signOut(): Promise<void> {
  await apiRequest<{ success: boolean }>("/auth/logout", { method: "POST" });
}

export function listUsers(): Promise<AuthUser[]> {
  return apiRequest("/auth/users");
}

export function createUser(input: AuthUserInput): Promise<AuthUser> {
  return apiRequest("/auth/users", { method: "POST", body: jsonBody(input) });
}

export function updateUser(id: string, input: AuthUserUpdate): Promise<AuthUser> {
  return apiRequest(`/auth/users/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: jsonBody(input),
  });
}

export const AUTH_ROLES: AuthRole[] = [
  "Receptionist",
  "MD",
  "COO",
  "President",
  "Employee",
  "Admin",
];