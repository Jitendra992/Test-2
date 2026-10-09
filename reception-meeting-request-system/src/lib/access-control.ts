import type { AuthRole } from "@shared/api";

export function homeForRole(role: AuthRole): string {
  if (role === "Receptionist") return "/";
  if (role === "Admin") return "/admin";
  return "/employee";
}

export function roleCanOpenPath(role: AuthRole, path: string): boolean {
  if (role === "Receptionist") {
    return ["/", "/requests/new", "/requests", "/history"].includes(path);
  }
  if (role === "Admin") {
    return ["/admin", "/admin/team", "/admin/users"].includes(path);
  }
  return path === "/employee";
}