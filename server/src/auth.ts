import type { RowDataPacket } from "mysql2";

import { config } from "./config";
import { db } from "./db";
import { HttpError } from "./http";
import {
  markLogin,
  type PublicUser,
  type UserRole,
  type UserStatus,
} from "./users";

const SESSION_COOKIE = "infinite_canvas_session";

type SessionUserRow = RowDataPacket & {
  id: number;
  username: string;
  display_name: string;
  role: UserRole;
  status: UserStatus;
  last_login_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

function dateIso(value: Date | string | null) {
  return value
    ? value instanceof Date
      ? value.toISOString()
      : new Date(value).toISOString()
    : null;
}

function cookieValue(request: Request) {
  const cookies = request.headers.get("cookie") || "";
  for (const item of cookies.split(";")) {
    const [name, ...rest] = item.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function cookieSecure(request: Request) {
  return (
    config.cookieSecure || request.headers.get("x-forwarded-proto") === "https"
  );
}

function sessionCookie(request: Request, token?: string) {
  const secure = cookieSecure(request) ? "; Secure" : "";
  if (!token)
    return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${config.sessionTtlSeconds}${secure}`;
}

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Buffer.from(digest).toString("hex");
}

export async function createSession(request: Request, userId: number) {
  const token = Buffer.from(
    crypto.getRandomValues(new Uint8Array(32)),
  ).toString("base64url");
  const tokenHash = await hashToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.sessionTtlSeconds * 1000);
  await db.execute(
    "DELETE FROM user_sessions WHERE expires_at <= CURRENT_TIMESTAMP(3)",
  );
  await db.execute(
    "INSERT INTO user_sessions (user_id, token_hash, expires_at, last_seen_at) VALUES (?, ?, ?, ?)",
    [userId, tokenHash, expiresAt, now],
  );
  await markLogin(userId);
  return sessionCookie(request, token);
}

export async function currentUser(
  request: Request,
): Promise<PublicUser | null> {
  const token = cookieValue(request);
  if (!token) return null;
  const tokenHash = await hashToken(token);
  const [rows] = await db.execute<SessionUserRow[]>(
    `SELECT u.id, u.username, u.display_name, u.role, u.status, u.last_login_at, u.created_at, u.updated_at
         FROM user_sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP(3) AND u.status = 'active'
         LIMIT 1`,
    [tokenHash],
  );
  const row = rows[0];
  if (!row) return null;
  await db.execute(
    "UPDATE user_sessions SET last_seen_at = CURRENT_TIMESTAMP(3) WHERE token_hash = ?",
    [tokenHash],
  );
  return {
    id: Number(row.id),
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    lastLoginAt: dateIso(row.last_login_at),
    createdAt: dateIso(row.created_at)!,
    updatedAt: dateIso(row.updated_at)!,
  };
}

export async function deleteSession(request: Request) {
  const token = cookieValue(request);
  if (token)
    await db.execute("DELETE FROM user_sessions WHERE token_hash = ?", [
      await hashToken(token),
    ]);
  return sessionCookie(request);
}

export async function requireUser(request: Request) {
  const user = await currentUser(request);
  if (!user) throw new HttpError(401, "请先登录");
  return user;
}

export async function requireAdmin(request: Request) {
  const user = await requireUser(request);
  if (user.role !== "admin") throw new HttpError(403, "需要管理员权限");
  return user;
}
