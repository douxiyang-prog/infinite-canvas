function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
}

function positiveNumber(name: string, fallback: number) {
  const raw = process.env[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`${name} 必须是正数`);
  return value;
}

function booleanValue(name: string, fallback: boolean) {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  throw new Error(`${name} 必须是 true 或 false`);
}

export const config = {
  port: positiveNumber("PORT", 8080),
  mysqlHost: required("MYSQL_HOST"),
  mysqlPort: positiveNumber("MYSQL_PORT", 3306),
  mysqlDatabase: required("MYSQL_DATABASE"),
  mysqlUser: required("MYSQL_USER"),
  mysqlPassword: required("MYSQL_PASSWORD"),
  sessionTtlSeconds: positiveNumber("SESSION_TTL_HOURS", 168) * 3600,
  cookieSecure: booleanValue("COOKIE_SECURE", false),
  bootstrapUsername: process.env.BOOTSTRAP_ADMIN_USERNAME?.trim() || "",
  bootstrapPassword: process.env.BOOTSTRAP_ADMIN_PASSWORD || "",
  bootstrapDisplayName:
    process.env.BOOTSTRAP_ADMIN_DISPLAY_NAME?.trim() || "管理员",
};
