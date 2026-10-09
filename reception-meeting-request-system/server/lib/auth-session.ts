import {
  createHmac,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import type { Request, Response } from "express";
import { getSessionSecret, isProduction } from "./config.js";
import { appDataRepository, isEmployeeRole, publicUser, type PublicAuthUser } from "./app-data.js";

const COOKIE_NAME = "reception_session";
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;

function derivePassword(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, 64, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

export async function hashPassword(password: string): Promise<{
  passwordSalt: string;
  passwordHash: string;
}> {
  const passwordSalt = randomBytes(16).toString("hex");
  const passwordHash = (await derivePassword(password, passwordSalt)).toString("hex");
  return { passwordSalt, passwordHash };
}

export async function verifyPassword(
  password: string,
  passwordSalt: string,
  passwordHash: string,
): Promise<boolean> {
  const expected = Buffer.from(passwordHash, "hex");
  const actual = await derivePassword(password, passwordSalt);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function signSessionId(id: string): string {
  return createHmac("sha256", getSessionSecret()).update(id).digest("base64url");
}

function sessionIdFromRequest(request: Request): string | null {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return null;
  const entry = cookieHeader
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${COOKIE_NAME}=`));
  if (!entry) return null;

  const token = decodeURIComponent(entry.slice(COOKIE_NAME.length + 1));
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;
  const id = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expected = Buffer.from(signSessionId(id));
  const supplied = Buffer.from(signature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  return id;
}

function setSessionCookie(response: Response, id: string): void {
  const token = `${id}.${signSessionId(id)}`;
  const secure = isProduction() ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_DURATION_MS / 1000)}${secure}`,
  );
}

export function clearSessionCookie(response: Response): void {
  const secure = isProduction() ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=; Path=/api; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
  );
}

export async function createSession(
  userId: string,
): Promise<{ user: PublicAuthUser; sessionId: string }> {
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
  const user = await appDataRepository.transact((data) => {
    const storedUser = data.users.find((item) => item.id === userId);
    if (!storedUser || !storedUser.active) throw new Error("This account is not active.");
    data.sessions = data.sessions.filter(
      (session) => Date.parse(session.expiresAt) > Date.now(),
    );
    data.sessions.push({ id: sessionId, userId, expiresAt });
    return publicUser(storedUser);
  });
  return { user, sessionId };
}

export async function signInAndSetCookie(response: Response, userId: string): Promise<PublicAuthUser> {
  const session = await createSession(userId);
  setSessionCookie(response, session.sessionId);
  return session.user;
}

export async function currentUser(request: Request): Promise<PublicAuthUser | null> {
  const sessionId = sessionIdFromRequest(request);
  if (!sessionId) return null;
  const data = await appDataRepository.load();
  const session = data.sessions.find(
    (item) => item.id === sessionId && Date.parse(item.expiresAt) > Date.now(),
  );
  if (!session) return null;
  const user = data.users.find((item) => item.id === session.userId && item.active);
  if (!user) return null;
  if (isEmployeeRole(user.role)) {
    const employee = data.employees.find(
      (item) => item.id === user.employeeId && item.active,
    );
    if (!employee) return null;
  }
  return publicUser(user);
}

export async function endSession(request: Request): Promise<void> {
  const sessionId = sessionIdFromRequest(request);
  if (!sessionId) return;
  await appDataRepository.transact((data) => {
    data.sessions = data.sessions.filter((item) => item.id !== sessionId);
  });
}