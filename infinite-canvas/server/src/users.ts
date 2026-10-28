import type { ResultSetHeader, RowDataPacket } from "mysql2";

import { db } from "./db";
import { HttpError } from "./http";
import {
  hashPassword,
  validateDisplayName,
  validatePassword,
} from "./password";

export type UserRole = "admin" | "user";
export type UserStatus = "active" | "disabled";

export type PublicUser = {
  id: number;
  username: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type UserRow = RowDataPacket & {
  id: number;
  username: string;
  display_name: string;
  password_hash: string;
  role: UserRole;
  status: UserStatus;
  last_login_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export type UserWithPassword = PublicUser & { passwordHash: string };

const userColumns =
  "id, username, display_name, password_hash, role, status, last_login_at, created_at, updated_at";

function iso(value: Date | string | null) {
  if (!value) return null;
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function publicUser(row: UserRow): PublicUser {
  return {
    id: Number(row.id),
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    lastLoginAt: iso(row.last_login_at),
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  };
}

function withPassword(row: UserRow): UserWithPassword {
  return { ...publicUser(row), passwordHash: row.password_hash };
}

export async function findUserByUsername(username: string) {
  const [rows] = await db.execute<UserRow[]>(
    `SELECT ${userColumns} FROM users WHERE username = ? LIMIT 1`,
    [username],
  );
  return rows[0] ? withPassword(rows[0]) : null;
}

export async function findUserById(id: number) {
  const [rows] = await db.execute<UserRow[]>(
    `SELECT ${userColumns} FROM users WHERE id = ? LIMIT 1`,
    [id],
  );
  return rows[0] ? publicUser(rows[0]) : null;
}

export async function listUsers() {
  const [rows] = await db.query<UserRow[]>(
    `SELECT ${userColumns} FROM users ORDER BY id ASC`,
  );
  return rows.map(publicUser);
}

export async function createUser(input: {
  username: string;
  displayName: string;
  password: string;
  role: UserRole;
}) {
  const displayName = validateDisplayName(input.displayName);
  const passwordHash = await hashPassword(input.password);
  try {
    const [result] = await db.execute<ResultSetHeader>(
      "INSERT INTO users (username, display_name, password_hash, role, status) VALUES (?, ?, ?, ?, 'active')",
      [input.username, displayName, passwordHash, input.role],
    );
    return (await findUserById(Number(result.insertId)))!;
  } catch (error) {
    if ((error as { code?: string }).code === "ER_DUP_ENTRY")
      throw new HttpError(409, "用户名已存在");
    throw error;
  }
}

export async function updateUser(
  id: number,
  input: {
    displayName?: string;
    password?: string;
    role?: UserRole;
    status?: UserStatus;
  },
) {
  const sets: string[] = [];
  const values: Array<string | number> = [];
  if (input.displayName !== undefined) {
    sets.push("display_name = ?");
    values.push(validateDisplayName(input.displayName));
  }
  if (input.password !== undefined) {
    sets.push("password_hash = ?");
    values.push(await hashPassword(validatePassword(input.password)));
  }
  if (input.role !== undefined) {
    sets.push("role = ?");
    values.push(input.role);
  }
  if (input.status !== undefined) {
    sets.push("status = ?");
    values.push(input.status);
  }
  if (!sets.length) throw new HttpError(400, "没有需要更新的字段");

  values.push(id);
  const [result] = await db.execute<ResultSetHeader>(
    `UPDATE users SET ${sets.join(", ")} WHERE id = ?`,
    values,
  );
  if (!result.affectedRows) throw new HttpError(404, "用户不存在");
  if (input.password !== undefined || input.status === "disabled") {
    await db.execute("DELETE FROM user_sessions WHERE user_id = ?", [id]);
  }
  return (await findUserById(id))!;
}

export async function countActiveAdmins() {
  const [rows] = await db.query<Array<RowDataPacket & { count: number }>>(
    "SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND status = 'active'",
  );
  return Number(rows[0]?.count || 0);
}

export async function markLogin(id: number) {
  await db.execute(
    "UPDATE users SET last_login_at = CURRENT_TIMESTAMP(3) WHERE id = ?",
    [id],
  );
}

export async function changeOwnPassword(userId: number, password: string) {
  const passwordHash = await hashPassword(password);
  await db.execute("UPDATE users SET password_hash = ? WHERE id = ?", [
    passwordHash,
    userId,
  ]);
  await db.execute("DELETE FROM user_sessions WHERE user_id = ?", [userId]);
}
