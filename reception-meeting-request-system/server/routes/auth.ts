import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import {
  BootstrapFirstAdminBody,
  CreateAuthUserBody,
  LoginBody,
  UpdateAuthUserBody,
} from "../../shared/api.js";
import {
  hashPassword,
  signInAndSetCookie,
  currentUser,
  clearSessionCookie,
  endSession,
  verifyPassword,
} from "../lib/auth-session.js";
import {
  isEmployeeRole,
  normalizeEmail,
  publicUser,
  appDataRepository,
  validateRoleLink,
  type StoredUser,
} from "../lib/app-data.js";
import { HttpError, requireRoles, requireUser } from "../lib/http-error.js";

const router: IRouter = Router();

function invalidBody(message: string): never {
  throw new HttpError(400, message);
}

function ensureUniqueEmail(users: StoredUser[], email: string, exceptId?: string): void {
  if (users.some((user) => user.id !== exceptId && normalizeEmail(user.email) === email)) {
    throw new HttpError(409, "An account with this email already exists.");
  }
}

function ensureEmployeeLink(
  role: StoredUser["role"],
  employeeId: string | null,
  employees: Awaited<ReturnType<typeof appDataRepository.load>>["employees"],
): void {
  try {
    validateRoleLink(role, employeeId, employees);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Choose a valid employee.");
  }
}

function employeeAccountIsActive(
  user: Pick<StoredUser, "role" | "employeeId">,
  employees: Awaited<ReturnType<typeof appDataRepository.load>>["employees"],
): boolean {
  return !isEmployeeRole(user.role) ||
    employees.some((employee) => employee.id === user.employeeId && employee.active);
}

router.get("/auth/bootstrap-status", async (_request, response) => {
  const data = await appDataRepository.load();
  response.json({
    available: data.users.length === 0,
    requiresToken: Boolean(process.env.ADMIN_BOOTSTRAP_TOKEN),
  });
});

router.post("/auth/bootstrap", async (request, response) => {
  const parsed = BootstrapFirstAdminBody.safeParse(request.body);
  if (!parsed.success) invalidBody(parsed.error.issues[0]?.message || "Enter valid administrator details.");
  const input = parsed.data;
  const requiredToken = process.env.ADMIN_BOOTSTRAP_TOKEN;
  if (requiredToken && input.bootstrapToken !== requiredToken) {
    throw new HttpError(403, "A valid first-admin setup token is required.");
  }
  const email = normalizeEmail(input.email);
  const credentials = await hashPassword(input.password);
  const userId = randomUUID();

  await appDataRepository.transact((data) => {
    if (data.users.length > 0) {
      throw new HttpError(409, "First-admin setup has already been completed.");
    }
    data.users.push({
      id: userId,
      name: input.name.trim(),
      email,
      role: "Admin",
      employeeId: null,
      active: true,
      createdAt: new Date().toISOString(),
      ...credentials,
    });
  });

  const user = await signInAndSetCookie(response, userId);
  response.status(201).json({ user });
});

router.post("/auth/login", async (request, response) => {
  const parsed = LoginBody.safeParse(request.body);
  if (!parsed.success) invalidBody(parsed.error.issues[0]?.message || "Enter an email and password.");
  const email = normalizeEmail(parsed.data.email);
  const data = await appDataRepository.load();
  const user = data.users.find((item) => normalizeEmail(item.email) === email);
  const passwordMatches = user
    ? await verifyPassword(parsed.data.password, user.passwordSalt, user.passwordHash)
    : await verifyPassword(parsed.data.password, "unknown-user-salt", "00");
  if (!user || !user.active || !passwordMatches || !employeeAccountIsActive(user, data.employees)) {
    throw new HttpError(401, "Email or password is incorrect, or this account is inactive.");
  }
  const signedInUser = await signInAndSetCookie(response, user.id);
  response.json({ user: signedInUser });
});

router.get("/auth/session", async (request, response) => {
  const user = await currentUser(request);
  if (!user) clearSessionCookie(response);
  response.json({ user });
});

router.post("/auth/logout", async (request, response) => {
  await endSession(request);
  clearSessionCookie(response);
  response.json({ success: true });
});

router.get("/auth/users", async (request, response) => {
  const actor = await requireUser(request);
  requireRoles(actor, "Admin");
  const data = await appDataRepository.load();
  response.json(data.users.map(publicUser).sort((a, b) => a.name.localeCompare(b.name)));
});

router.post("/auth/users", async (request, response) => {
  const actor = await requireUser(request);
  requireRoles(actor, "Admin");
  const parsed = CreateAuthUserBody.safeParse(request.body);
  if (!parsed.success) invalidBody(parsed.error.issues[0]?.message || "Enter valid account details.");
  const input = parsed.data;
  const email = normalizeEmail(input.email);
  const credentials = await hashPassword(input.password);
  const user = await appDataRepository.transact((data) => {
    ensureUniqueEmail(data.users, email);
    ensureEmployeeLink(input.role, input.employeeId, data.employees);
    const created: StoredUser = {
      id: randomUUID(),
      name: input.name.trim(),
      email,
      role: input.role,
      employeeId: input.employeeId,
      active: input.active,
      createdAt: new Date().toISOString(),
      ...credentials,
    };
    data.users.push(created);
    return publicUser(created);
  });
  response.status(201).json(user);
});

router.patch("/auth/users/:id", async (request, response) => {
  const actor = await requireUser(request);
  requireRoles(actor, "Admin");
  const parsed = UpdateAuthUserBody.safeParse(request.body);
  if (!parsed.success) invalidBody(parsed.error.issues[0]?.message || "Enter valid account changes.");
  const input = parsed.data;
  const replacementCredentials = input.password ? await hashPassword(input.password) : undefined;

  const user = await appDataRepository.transact((data) => {
    const current = data.users.find((item) => item.id === request.params.id);
    if (!current) throw new HttpError(404, "Account was not found.");
    const email = input.email === undefined ? current.email : normalizeEmail(input.email);
    const role = input.role ?? current.role;
    const employeeId = input.employeeId === undefined ? current.employeeId : input.employeeId;
    const active = input.active ?? current.active;
    ensureUniqueEmail(data.users, email, current.id);
    ensureEmployeeLink(role, employeeId, data.employees);

    const removesCurrentAdmin = current.role === "Admin" && current.active && (!active || role !== "Admin");
    if (removesCurrentAdmin) {
      const anotherActiveAdmin = data.users.some(
        (item) => item.id !== current.id && item.role === "Admin" && item.active,
      );
      if (!anotherActiveAdmin) {
        throw new HttpError(409, "At least one active Admin account must remain.");
      }
    }
    if (current.id === actor.id && !active) {
      throw new HttpError(409, "You cannot deactivate the account you are currently using.");
    }

    Object.assign(current, {
      name: input.name?.trim() ?? current.name,
      email,
      role,
      employeeId,
      active,
      ...(replacementCredentials ?? {}),
    });
    if (!active) data.sessions = data.sessions.filter((session) => session.userId !== current.id);
    return publicUser(current);
  });
  response.json(user);
});

export default router;