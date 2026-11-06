import mysql, {
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";

import { config } from "./config";
import {
  hashPassword,
  validateDisplayName,
  validateUsername,
} from "./password";

export const db = mysql.createPool({
  host: config.mysqlHost,
  port: config.mysqlPort,
  database: config.mysqlDatabase,
  user: config.mysqlUser,
  password: config.mysqlPassword,
  charset: "utf8mb4",
  connectionLimit: 10,
  waitForConnections: true,
});

export async function migrate() {
  for (const migration of [
    "001_users.sql",
    "002_storage.sql",
    "003_user_channels.sql",
  ]) {
    const schema = await Bun.file(
      new URL(`../sql/${migration}`, import.meta.url),
    ).text();
    const statements = schema
      .replace(/^\s*--.*$/gm, "")
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean);
    for (const statement of statements) await db.query(statement);
  }
  const [columns] = await db.query<
    Array<RowDataPacket & { Field: string }>
  >("SHOW COLUMNS FROM app_settings LIKE 'login_background'");
  if (!columns.length) {
    await db.query(
      "ALTER TABLE app_settings ADD COLUMN login_background VARCHAR(20) NOT NULL DEFAULT 'original' AFTER company_name",
    );
  }
}

export async function bootstrapAdmin() {
  const [rows] = await db.query<Array<RowDataPacket & { count: number }>>(
    "SELECT COUNT(*) AS count FROM users",
  );
  if (Number(rows[0]?.count || 0) > 0) return;
  if (!config.bootstrapUsername || !config.bootstrapPassword) {
    console.warn(
      "用户表为空；请设置 BOOTSTRAP_ADMIN_USERNAME 和 BOOTSTRAP_ADMIN_PASSWORD 后重启以创建首个管理员",
    );
    return;
  }

  const username = validateUsername(config.bootstrapUsername);
  const displayName = validateDisplayName(config.bootstrapDisplayName);
  const passwordHash = await hashPassword(config.bootstrapPassword);
  await db.execute<ResultSetHeader>(
    "INSERT INTO users (username, display_name, password_hash, role, status) VALUES (?, ?, ?, 'admin', 'active')",
    [username, displayName, passwordHash],
  );
  console.log(`已创建初始管理员：${username}`);
}
