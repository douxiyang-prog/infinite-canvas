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
  updateLoginBackground,
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
import {
  getStorageSettings,
  initializeStorage,
  setupStatus,
  validateStoragePath,
} from "./storage";
import {
  deleteProject,
  listProjects,
  loadProject,
  saveProject,
} from "./projects";
import { createPublicFileUrl, getFile, getPublicFile, saveFile } from "./files";
import {
  createAsset,
  createTeamAsset,
  deleteAsset,
  deleteTeamAsset,
  importAssets,
  importTeamAssets,
  listAssets,
  listTeamAssets,
  replaceAssets,
  updateTeamAsset,
  updateAsset,
} from "./assets";
import { purgeExpiredTrash, restoreProject } from "./trash";
import { getGlobalConfig, saveGlobalConfig } from "./global-config";
import {
  getEffectiveUserConfig,
  getUserChannelAssignment,
  saveUserChannelAssignment,
} from "./user-channels";
import {
  createTeamProject,
  createTeamProjectScene,
  deleteTeamProjectScene,
  deleteTeamProject,
  assertTeamProjectMember,
  listAdminTeamProjects,
  listMemberTeamProjects,
  replaceTeamProjectMembers,
  updateTeamProject,
  updateTeamProjectScene,
} from "./team-projects";

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

function optionalNumberField(
  body: Record<string, unknown>,
  key: string,
  fallback: number,
) {
  const value = body[key];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new HttpError(400, `${key} 必须是数字`);
  return parsed;
}

async function handleApi(request: Request, url: URL) {
  if (request.method === "GET" && url.pathname === "/api/health") {
    await db.query("SELECT 1");
    return json({ ok: true });
  }

  if (request.method === "GET" && url.pathname === "/api/setup/status") {
    return json(await setupStatus());
  }

  if (request.method === "GET" && url.pathname === "/api/config") {
    await requireAdmin(request);
    return json(await getGlobalConfig());
  }

  if (request.method === "PUT" && url.pathname === "/api/config") {
    const user = await requireAdmin(request);
    const body = await readJson(request);
    const expectedVersion = optionalNumberField(body, "expectedVersion", -1);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0)
      throw new HttpError(400, "expectedVersion 无效");
    return json(
      await saveGlobalConfig(
        {
          expectedVersion,
          config: body.config,
          webdav: body.webdav,
          promptSources: body.promptSources,
        },
        user.id,
      ),
    );
  }

  if (request.method === "GET" && url.pathname === "/api/admin/storage") {
    await requireAdmin(request);
    const settings = await getStorageSettings();
    const validation = settings
      ? await validateStoragePath(settings.root)
      : null;
    return json({
      settings,
      validation,
      allowedRoots: config.storageAllowedRoots,
    });
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/admin/storage/validate"
  ) {
    await requireAdmin(request);
    const body = await readJson(request);
    const path = textField(body, "path", "存储路径");
    return json(await validateStoragePath(path));
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/admin/storage/initialize"
  ) {
    const user = await requireAdmin(request);
    const body = await readJson(request);
    const path = textField(body, "path", "存储路径");
    const settings = await initializeStorage(
      path,
      {
        maxUploadMb: optionalNumberField(body, "maxUploadMb", 500),
        autosaveMs: optionalNumberField(body, "autosaveMs", 1500),
        trashRetentionDays: optionalNumberField(body, "trashRetentionDays", 14),
      },
      user.id,
    );
    return json({ settings });
  }

  if (request.method === "GET" && url.pathname === "/api/projects") {
    const user = await requireUser(request);
    return json(await listProjects(user.id));
  }

  if (request.method === "GET" && url.pathname === "/api/user-config") {
    const user = await requireUser(request);
    return json(await getEffectiveUserConfig(user.id));
  }

  if (request.method === "GET" && url.pathname === "/api/assets") {
    const user = await requireUser(request);
    return json(await listAssets(user.id));
  }

  if (request.method === "POST" && url.pathname === "/api/assets") {
    const user = await requireUser(request);
    const body = await readJson(request);
    return json(await createAsset(user.id, body.asset), 201);
  }

  if (request.method === "PUT" && url.pathname === "/api/assets") {
    const user = await requireUser(request);
    const body = await readJson(request);
    return json(await replaceAssets(user.id, body.assets));
  }

  if (request.method === "POST" && url.pathname === "/api/assets/import") {
    const user = await requireUser(request);
    const body = await readJson(request);
    return json(await importAssets(user.id, body.assets));
  }

  const assetMatch = url.pathname.match(/^\/api\/assets\/([A-Za-z0-9_-]+)$/);
  if (assetMatch && request.method === "PUT") {
    const user = await requireUser(request);
    const body = await readJson(request);
    return json(await updateAsset(user.id, assetMatch[1], body.asset));
  }

  if (assetMatch && request.method === "DELETE") {
    const user = await requireUser(request);
    return json(await deleteAsset(user.id, assetMatch[1]));
  }

  const projectMatch = url.pathname.match(
    /^\/api\/projects\/([A-Za-z0-9_-]+)$/,
  );
  if (projectMatch) {
    const user = await requireUser(request);
    const projectId = projectMatch[1];
    if (request.method === "GET") {
      return json(await loadProject(user.id, projectId));
    }
    if (request.method === "PUT") {
      const body = await readJson(request);
      const expectedVersion = optionalNumberField(body, "expectedVersion", -1);
      if (!Number.isInteger(expectedVersion) || expectedVersion < 0)
        throw new HttpError(400, "expectedVersion 无效");
      return json(
        await saveProject(user.id, projectId, body.project, expectedVersion),
      );
    }
    if (request.method === "DELETE") {
      const expectedVersion = Number(url.searchParams.get("expectedVersion"));
      if (!Number.isInteger(expectedVersion) || expectedVersion < 0)
        throw new HttpError(400, "expectedVersion 无效");
      return json(await deleteProject(user.id, projectId, expectedVersion));
    }
  }

  const restoreMatch = url.pathname.match(
    /^\/api\/projects\/([A-Za-z0-9_-]+)\/restore$/,
  );
  if (restoreMatch && request.method === "POST") {
    const user = await requireUser(request);
    return json(await restoreProject(user.id, restoreMatch[1]));
  }

  if (request.method === "POST" && url.pathname === "/api/files") {
    const user = await requireUser(request);
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("multipart/form-data"))
      throw new HttpError(415, "文件上传必须使用 multipart/form-data");
    return json(await saveFile(user.id, await request.formData()), 201);
  }

  if (request.method === "GET" && url.pathname === "/api/files/public-url") {
    const user = await requireUser(request);
    const storageKey = url.searchParams.get("storageKey")?.trim() || "";
    return json({
      url: await createPublicFileUrl(user.id, storageKey, request),
    });
  }

  const publicFileMatch = url.pathname.match(/^\/api\/public\/files\/([^/]+)$/);
  if (
    publicFileMatch &&
    (request.method === "GET" || request.method === "HEAD")
  ) {
    return getPublicFile(decodeURIComponent(publicFileMatch[1]), request);
  }

  const fileMatch = url.pathname.match(/^\/api\/files\/([^/]+)$/);
  if (fileMatch && (request.method === "GET" || request.method === "HEAD")) {
    const user = await requireUser(request);
    return getFile(user.id, decodeURIComponent(fileMatch[1]), request);
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

  if (request.method === "GET" && url.pathname === "/api/team-projects") {
    const user = await requireUser(request);
    return json({ projects: await listMemberTeamProjects(user.id) });
  }

  const teamAssetsMatch = url.pathname.match(
    /^\/api\/team-projects\/([A-Za-z0-9_-]+)\/assets$/,
  );
  if (teamAssetsMatch) {
    const user = await requireUser(request);
    const teamProjectId = teamAssetsMatch[1];
    await assertTeamProjectMember(teamProjectId, user.id);
    if (request.method === "GET")
      return json(await listTeamAssets(teamProjectId));
    if (request.method === "POST") {
      const body = await readJson(request);
      return json(
        await createTeamAsset(teamProjectId, body.asset),
        201,
      );
    }
  }

  const teamAssetImportMatch = url.pathname.match(
    /^\/api\/team-projects\/([A-Za-z0-9_-]+)\/assets\/import$/,
  );
  if (teamAssetImportMatch && request.method === "POST") {
    const user = await requireUser(request);
    await assertTeamProjectMember(teamAssetImportMatch[1], user.id);
    const body = await readJson(request);
    return json(
      await importTeamAssets(teamAssetImportMatch[1], body.assets),
    );
  }

  const teamAssetItemMatch = url.pathname.match(
    /^\/api\/team-projects\/([A-Za-z0-9_-]+)\/assets\/([A-Za-z0-9_-]+)$/,
  );
  if (teamAssetItemMatch) {
    const user = await requireUser(request);
    await assertTeamProjectMember(teamAssetItemMatch[1], user.id);
    if (request.method === "PUT") {
      const body = await readJson(request);
      return json(
        await updateTeamAsset(
          teamAssetItemMatch[1],
          teamAssetItemMatch[2],
          body.asset,
        ),
      );
    }
    if (request.method === "DELETE")
      return json(
        await deleteTeamAsset(
          teamAssetItemMatch[1],
          teamAssetItemMatch[2],
        ),
      );
  }

  if (request.method === "GET" && url.pathname === "/api/admin/team-projects") {
    await requireAdmin(request);
    return json({ projects: await listAdminTeamProjects() });
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/admin/team-projects"
  ) {
    const user = await requireAdmin(request);
    const body = await readJson(request);
    return json(
      {
        project: await createTeamProject(user.id, {
          title: body.title,
          description: body.description,
          userIds: body.userIds,
        }),
      },
      201,
    );
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/admin/team-project-scenes"
  ) {
    const user = await requireAdmin(request);
    const body = await readJson(request);
    return json(
      {
        scene: await createTeamProjectScene(user.id, {
          teamProjectId: body.teamProjectId,
          title: body.title,
        }),
      },
      201,
    );
  }

  const teamProjectSceneMatch = url.pathname.match(
    /^\/api\/admin\/team-project-scenes\/([A-Za-z0-9_-]+)$/,
  );
  if (teamProjectSceneMatch && request.method === "PATCH") {
    await requireAdmin(request);
    const body = await readJson(request);
    return json({
      scene: await updateTeamProjectScene(teamProjectSceneMatch[1], {
        title: body.title,
        hidden: body.hidden,
        sortOrder: body.sortOrder,
      }),
    });
  }
  if (teamProjectSceneMatch && request.method === "DELETE") {
    await requireAdmin(request);
    return json(await deleteTeamProjectScene(teamProjectSceneMatch[1]));
  }

  const teamProjectMatch = url.pathname.match(
    /^\/api\/admin\/team-projects\/([A-Za-z0-9_-]+)$/,
  );
  if (teamProjectMatch) {
    await requireAdmin(request);
    const teamProjectId = teamProjectMatch[1];
    if (request.method === "PATCH") {
      const body = await readJson(request);
      return json({
        project: await updateTeamProject(teamProjectId, {
          title: body.title,
          description: body.description,
        }),
      });
    }
    if (request.method === "DELETE")
      return json(await deleteTeamProject(teamProjectId));
  }

  const teamProjectMembersMatch = url.pathname.match(
    /^\/api\/admin\/team-projects\/([A-Za-z0-9_-]+)\/members$/,
  );
  if (teamProjectMembersMatch && request.method === "PUT") {
    await requireAdmin(request);
    const body = await readJson(request);
    return json({
      project: await replaceTeamProjectMembers(
        teamProjectMembersMatch[1],
        body.userIds,
      ),
    });
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

  if (
    request.method === "PATCH" &&
    url.pathname === "/api/admin/branding/login-background"
  ) {
    await requireAdmin(request);
    const body = await readJson(request);
    if (
      body.loginBackground !== "original" &&
      body.loginBackground !== "nebula"
    )
      throw new HttpError(400, "登录页背景选项不正确");
    return json(await updateLoginBackground(body.loginBackground));
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

  const userChannelsMatch = url.pathname.match(
    /^\/api\/admin\/users\/(\d+)\/channels$/,
  );
  if (userChannelsMatch && request.method === "GET") {
    await requireAdmin(request);
    const targetId = Number(userChannelsMatch[1]);
    if (!(await findUserById(targetId))) throw new HttpError(404, "用户不存在");
    return json(await getUserChannelAssignment(targetId));
  }

  if (userChannelsMatch && request.method === "PUT") {
    const current = await requireAdmin(request);
    const targetId = Number(userChannelsMatch[1]);
    if (!(await findUserById(targetId))) throw new HttpError(404, "用户不存在");
    const body = await readJson(request);
    return json(
      await saveUserChannelAssignment(
        targetId,
        {
          allChannels: body.allChannels,
          channelIds: body.channelIds,
          expectedVersion: body.expectedVersion,
        },
        current.id,
      ),
    );
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

void purgeExpiredTrash().catch((error) =>
  console.error("Trash cleanup failed", error),
);
const trashTimer = setInterval(
  () => {
    void purgeExpiredTrash().catch((error) =>
      console.error("Trash cleanup failed", error),
    );
  },
  60 * 60 * 1000,
);

process.on("SIGTERM", async () => {
  clearInterval(trashTimer);
  server.stop();
  await db.end();
});
