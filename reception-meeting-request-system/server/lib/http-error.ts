import type { AuthRole } from "../../shared/api.js";
import type { Request } from "express";
import { currentUser } from "./auth-session.js";
import type { PublicAuthUser } from "./app-data.js";
import { HttpError } from "./errors.js";

export { HttpError };

export async function requireUser(request: Request): Promise<PublicAuthUser> {
  const user = await currentUser(request);
  if (!user) throw new HttpError(401, "Sign in to continue.");
  return user;
}

export function requireRoles(user: PublicAuthUser, ...roles: AuthRole[]): void {
  if (!roles.includes(user.role)) {
    throw new HttpError(403, "Your account is not allowed to perform this action.");
  }
}
