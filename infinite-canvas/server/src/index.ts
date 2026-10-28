import {
  createSession,
  deleteSession,
  requireAdmin,
  requireUser,
} from "./auth";
import {
  detectLogoMime,
  getBranding,
  getLogo,
  MAX_LOGO_BYTES,
  updateCompanyName,
  updateLogo,
} from "./branding";
import { config } from "./config";
import { bootstrapAdmin, db, migrate } from "./db";
import {
  HttpError,
  json,
  optionalPasswordField,
  optionalTextField,
  passwordField,
  readJson,
  textField,
} from "./http";
import { validatePassword, validateUsername, verifyPassword } from "./password";
import {
  changeOwnPassword,
  countActiveAdmins,
  createUser,
  findUserById,
  findUserByUsername,
  listUsers,
  type UserRole,
  type UserStatus,
  updateUser,
} from "./users";

function roleValue(value: unknown, fallback?: UserRole): UserRole | undefined {
  if (value === undefined) return fallback;
  if (value === "admin" || value === "user") return value;
  throw new HttpError(400, "用户角色不正确");
}

function statusValue(
  value: unknown,
  fallback?: UserStatus,
): UserStatus | undefined {
  if (value === undefined) return fallback;
  if (value === "active" || value === "disabled") return value;
  throw new HttpError(400, "用户状态不正确");
}

async function handleApi(request: Request, url: URL) {
  if (request.method === "GET" && url.pathname === "/api/health") {
    await db.query("SELECT 1");
    return json({ ok: true });
  }

  if (request.method === "GET" && url.pathname === "/api/branding") {
    return json(await getBranding());
  }

  if (request.method === "GET" && url.pathname === "/api/branding/logo") {
    const logo = await getLogo();
    return new Response(Uint8Array.from(logo.data), {
      headers: {
        "Content-Type": logo.mime,
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  if (request.method === "POST" && url.pathname === "/api/auth/login") {
    const body = await readJson(request);
    const username = textField(body, "username", "用户名");
    const password = passwordField(body, "password", "密码");
    const record = await findUserByUsername(username);
    if (!record || !(await verifyPassword(password, record.passwordHash))) {
      throw new HttpError(401, "用户名或密码不正确");
    }
    if (record.status !== "active") throw new HttpError(403, "账号已停用");
    const setCookie = await createSession(request, record.id);
    return json({ user: (await findUserById(record.id))! }, 200, {
      "Set-Cookie": setCookie,
    });
  }

  if (request.method === "GET" && url.pathname === "/api/auth/me") {
    return json({ user: await requireUser(request) });
  }

  if (request.method === "POST" && url.pathname === "/api/auth/logout") {
    return json({ ok: true }, 200, {
      "Set-Cookie": await deleteSession(request),
    });
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/auth/change-password"
  ) {
    const user = await requireUser(request);
    const body = await readJson(request);
    const currentPassword = passwordField(body, "currentPassword", "当前密码");
    const newPassword = validatePassword(
      passwordField(body, "newPassword", "新密码"),
    );
    const record = await findUserByUsername(user.username);
    if (
      !record ||
      !(await verifyPassword(currentPassword, record.passwordHash))
    ) {
      throw new HttpError(400, "当前密码不正确");
    }
    await changeOwnPassword(user.id, newPassword);
    return json({ ok: true }, 200, {
      "Set-Cookie": await deleteSession(request),
    });
  }

  if (request.method === "GET" && url.pathname === "/api/admin/users") {
    await requireAdmin(request);
    return json({ users: await listUsers() });
  }

  if (request.method === "PATCH" && url.pathname === "/api/admin/branding") {
    await requireAdmin(request);
    const body = await readJson(request);
    const companyName = textField(body, "companyName", "公司名称");
    if (Array.from(companyName).length > 100)
      throw new HttpError(400, "公司名称不能超过 100 个字符");
    return json(await updateCompanyName(companyName));
  }

  if (request.method === "PUT" && url.pathname === "/api/admin/branding/logo") {
    await requireAdmin(request);
    const data = new Uint8Array(await request.arrayBuffer());
    if (!data.length) throw new HttpError(400, "请选择 Logo 图片");
    if (data.length > MAX_LOGO_BYTES)
      throw new HttpError(413, "Logo 图片不能超过 2 MB");
    const mime = detectLogoMime(data);
    if (!mime) throw new HttpError(415, "Logo 仅支持 PNG、JPEG 或 WebP");
    return json(await updateLogo(data, mime));
  }

  if (request.method === "POST" && url.pathname === "/api/admin/users") {
    await requireAdmin(request);
    const body = await readJson(request);
    const user = await createUser({
      username: validateUsername(textField(body, "username", "用户名")),
      displayName: textField(body, "displayName", "显示名称"),
      password: passwordField(body, "password", "密码"),
      role: roleValue(body.role, "user")!,
    });
    return json({ user }, 201);
  }

  const userMatch = url.pathname.match(/^\/api\/admin\/users\/(\d+)$/);
  if (request.method === "PATCH" && userMatch) {
    const current = await requireAdmin(request);
    const targetId = Number(userMatch[1]);
    const target = await findUserById(targetId);
    if (!target) throw new HttpError(404, "用户不存在");
    const body = await readJson(request);
    const displayName = optionalTextField(body, "displayName");
    const password = optionalPasswordField(body, "password");
    const role = roleValue(body.role, target.role);
    const status = statusValue(body.status, target.status);

    if (current.id === target.id && (role !== "admin" || status !== "active")) {
      throw new HttpError(400, "不能停用自己或移除自己的管理员权限");
    }
    if (
      target.role === "admin" &&
      target.status === "active" &&
      (role !== "admin" || status !== "active") &&
      (await countActiveAdmins()) <= 1
    ) {
      throw new HttpError(400, "必须至少保留一个启用中的管理员");
    }

    const user = await updateUser(target.id, {
      displayName,
      password: password ? validatePassword(password) : undefined,
      role,
      status,
    });
    return json({ user });
  }

  throw new HttpError(404, "接口不存在");
}

async function fetchHandler(request: Request) {
  const url = new URL(request.url);
  try {
    if (url.pathname.startsWith("/api/")) return await handleApi(request, url);
    return new Response("Not Found", { status: 404 });
  } catch (error) {
    if (error instanceof HttpError)
      return json({ error: error.message }, error.status);
    console.error(error);
    return json({ error: "服务器内部错误" }, 500);
  }
}

await migrate();
await bootstrapAdmin();
const server = Bun.serve({
  port: config.port,
  hostname: "0.0.0.0",
  fetch: fetchHandler,
});
console.log(`Canvas API listening on http://0.0.0.0:${server.port}`);

process.on("SIGTERM", async () => {
  server.stop();
  await db.end();
});
