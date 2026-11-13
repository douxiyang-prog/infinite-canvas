import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RowDataPacket } from "mysql2";

import { config } from "./config";
import { db } from "./db";
import { HttpError } from "./http";
import { requireStorageSettings, resolveStoragePath } from "./storage";
import { assertTeamProjectMember } from "./team-projects";

const STORAGE_KEY = /^[A-Za-z0-9_-]{1,40}:[A-Za-z0-9_-]{1,80}$/;
const PROJECT_ID = /^[A-Za-z0-9_-]{1,64}$/;

type FileRow = RowDataPacket & {
  id: string;
  storage_key: string;
  relative_path: string;
  mime_type: string;
  bytes: number;
  sha256: string;
  owner_user_id?: number;
  project_id?: string | null;
  team_project_id?: string | null;
};

type ProjectRow = RowDataPacket & {
  id: string;
  owner_user_id: number;
  team_project_id: string | null;
  deleted_at: Date | string | null;
};

function extensionFor(mimeType: string, name: string) {
  const byMime: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/ogg": "ogg",
    "audio/mp4": "m4a",
    "application/pdf": "pdf",
  };
  const fromMime = byMime[mimeType.toLowerCase()];
  if (fromMime) return fromMime;
  const match = name.toLowerCase().match(/\.([a-z0-9]{1,10})$/);
  return match?.[1] || "bin";
}

function kindFor(mimeType: string, requested: string) {
  if (["image", "video", "audio", "file"].includes(requested)) return requested;
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "file";
}

function numericField(form: FormData, key: string) {
  const raw = form.get(key);
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}

export async function saveFile(userId: number, form: FormData) {
  const upload = form.get("file");
  if (!upload || typeof upload === "string")
    throw new HttpError(400, "缺少上传文件");
  const file = upload as File;
  const area = String(form.get("area") || "input");
  if (area !== "input" && area !== "output")
    throw new HttpError(400, "文件区域必须是 input 或 output");
  const projectValue = form.get("projectId");
  const projectId =
    typeof projectValue === "string" && projectValue.trim()
      ? projectValue.trim()
      : null;
  const requestedTeamProjectValue = form.get("teamProjectId");
  const requestedTeamProjectId =
    typeof requestedTeamProjectValue === "string" &&
    requestedTeamProjectValue.trim()
      ? requestedTeamProjectValue.trim()
      : null;
  if (projectId && !PROJECT_ID.test(projectId))
    throw new HttpError(400, "画布 ID 格式不正确");
  if (requestedTeamProjectId && !PROJECT_ID.test(requestedTeamProjectId))
    throw new HttpError(400, "项目 ID 格式不正确");
  let projectExists = false;
  let teamProjectId = requestedTeamProjectId;
  if (projectId) {
    const [projects] = await db.execute<ProjectRow[]>(
      `SELECT id, owner_user_id, team_project_id, deleted_at FROM canvas_projects WHERE id = ? LIMIT 1`,
      [projectId],
    );
    if (projects[0]?.team_project_id)
      await assertTeamProjectMember(projects[0].team_project_id, userId);
    else if (projects[0] && Number(projects[0].owner_user_id) !== userId)
      throw new HttpError(404, "画布不存在");
    if (projects[0]?.deleted_at) throw new HttpError(410, "画布已删除");
    if (projects[0]) teamProjectId = projects[0].team_project_id || null;
    else if (requestedTeamProjectId)
      await assertTeamProjectMember(requestedTeamProjectId, userId);
    projectExists = Boolean(projects[0]);
  } else if (requestedTeamProjectId) {
    await assertTeamProjectMember(requestedTeamProjectId, userId);
  }

  const settings = await requireStorageSettings();
  const bytes = file.size;
  if (!bytes) throw new HttpError(400, "上传文件为空");
  if (bytes > settings.maxUploadMb * 1024 * 1024)
    throw new HttpError(413, `文件不能超过 ${settings.maxUploadMb} MB`);

  const requestedKey = String(form.get("storageKey") || "");
  const mimeType = file.type || "application/octet-stream";
  const kind = kindFor(mimeType, String(form.get("kind") || ""));
  const storageKey =
    requestedKey || `${kind}:${randomUUID().replace(/-/g, "")}`;
  if (!STORAGE_KEY.test(storageKey))
    throw new HttpError(400, "storageKey 格式不正确");

  const [existingRows] = await db.execute<FileRow[]>(
    `SELECT id, storage_key, relative_path, mime_type, bytes, sha256
       FROM canvas_files
      WHERE owner_user_id = ? AND storage_key = ?
      LIMIT 1`,
    [userId, storageKey],
  );
  const existing = existingRows[0];
  const id = existing?.id || randomUUID();
  const extension = extensionFor(mimeType, file.name || storageKey);
  const relativePath =
    existing?.relative_path ||
    (projectId
      ? `users/${userId}/projects/${projectId}/${area}/${id}.${extension}`
      : teamProjectId
        ? `team-projects/${teamProjectId}/assets/${id}.${extension}`
      : `users/${userId}/${area}/${id}.${extension}`);
  const target = resolveStoragePath(settings.root, relativePath);
  await mkdir(dirname(target), { recursive: true });
  const tempPath = `${target}.${randomUUID()}.tmp`;
  const backupPath = `${target}.${randomUUID()}.backup`;
  const data = Buffer.from(await file.arrayBuffer());
  await writeFile(tempPath, data);
  let hadBackup = false;
  try {
    await rename(target, backupPath);
    hadBackup = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const sha256 = createHash("sha256").update(data).digest("hex");
  let connection: Awaited<ReturnType<typeof db.getConnection>> | null = null;
  try {
    await rename(tempPath, target);
    connection = await db.getConnection();
    await connection.beginTransaction();
    if (projectId && !projectExists) {
      await connection.execute(
        `INSERT INTO canvas_projects
           (id, owner_user_id, team_project_id, title, storage_path, version, size_bytes)
         VALUES (?, ?, ?, 'Untitled', ?, 0, 0)`,
        [
          projectId,
          userId,
          teamProjectId,
          `users/${userId}/projects/${projectId}`,
        ],
      );
    }
    await connection.execute(
      `INSERT INTO canvas_files
         (id, storage_key, owner_user_id, project_id, team_project_id, area, relative_path, kind, mime_type, bytes, sha256, width, height, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         project_id = VALUES(project_id),
         team_project_id = VALUES(team_project_id),
         area = VALUES(area),
         relative_path = VALUES(relative_path),
         kind = VALUES(kind),
         mime_type = VALUES(mime_type),
         bytes = VALUES(bytes),
         sha256 = VALUES(sha256),
         width = VALUES(width),
         height = VALUES(height),
         duration_ms = VALUES(duration_ms),
         deleted_at = NULL`,
      [
        id,
        storageKey,
        userId,
        projectId,
        teamProjectId,
        area,
        relativePath,
        kind,
        mimeType,
        bytes,
        sha256,
        numericField(form, "width") || null,
        numericField(form, "height") || null,
        numericField(form, "durationMs") || null,
      ],
    );
    await connection.commit();
    if (hadBackup) await rm(backupPath, { force: true }).catch(() => undefined);
  } catch (error) {
    await connection?.rollback().catch(() => undefined);
    await rm(target, { force: true }).catch(() => undefined);
    if (hadBackup) await rename(backupPath, target).catch(() => undefined);
    throw error;
  } finally {
    connection?.release();
  }

  return {
    storageKey,
    url: `/api/files/${encodeURIComponent(storageKey)}`,
    bytes,
    mimeType,
    width: numericField(form, "width"),
    height: numericField(form, "height"),
    durationMs: numericField(form, "durationMs"),
  };
}

function publicFileSignature(
  userId: number,
  storageKey: string,
  expiresAt: number,
) {
  if (!config.settingsEncryptionKey)
    throw new HttpError(503, "未配置 SETTINGS_ENCRYPTION_KEY");
  return createHmac("sha256", config.settingsEncryptionKey)
    .update(`${userId}\n${expiresAt}\n${storageKey}`)
    .digest("base64url");
}

export async function createPublicFileUrl(
  userId: number,
  storageKey: string,
  _request: Request,
) {
  if (!STORAGE_KEY.test(storageKey))
    throw new HttpError(400, "storageKey 格式不正确");
  if (!config.publicBaseUrl)
    throw new HttpError(
      503,
      "参考视频需要配置 CANVAS_PUBLIC_BASE_URL 为花生壳公网地址",
    );
  const [rows] = await db.execute<FileRow[]>(accessibleFileSql(), [
    storageKey,
    userId,
    userId,
    userId,
    userId,
    userId,
  ]);
  if (!rows[0]) throw new HttpError(404, "文件不存在");
  const expiresAt = Math.floor(Date.now() / 1000) + config.publicFileTtlSeconds;
  const signature = publicFileSignature(userId, storageKey, expiresAt);
  return `${config.publicBaseUrl}/api/public/files/${encodeURIComponent(storageKey)}?token=v1.${userId}.${expiresAt}.${signature}`;
}

function publicFileUser(storageKey: string, token: string) {
  const [version, rawUserId, rawExpiresAt, signature] = token.split(".");
  const userId = Number(rawUserId);
  const expiresAt = Number(rawExpiresAt);
  if (
    version !== "v1" ||
    !Number.isSafeInteger(userId) ||
    userId <= 0 ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= Math.floor(Date.now() / 1000) ||
    !signature
  )
    throw new HttpError(403, "文件访问链接无效或已过期");
  const expected = publicFileSignature(userId, storageKey, expiresAt);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  )
    throw new HttpError(403, "文件访问链接无效或已过期");
  return userId;
}

export async function getPublicFile(storageKey: string, request: Request) {
  const token = new URL(request.url).searchParams.get("token") || "";
  const userId = publicFileUser(storageKey, token);
  return getFile(userId, storageKey, request, true);
}

function parseRange(value: string | null, size: number) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim());
  if (!match) throw new HttpError(416, "Range 请求格式不正确");
  let start: number;
  let end: number;
  if (!match[1] && match[2]) {
    const suffix = Number(match[2]);
    if (!Number.isFinite(suffix) || suffix <= 0)
      throw new HttpError(416, "Range 请求无效");
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start
  )
    throw new HttpError(416, "Range 请求超出文件范围");
  return { start, end: Math.min(end, size - 1) };
}

export async function getFile(
  userId: number,
  storageKey: string,
  request: Request,
  publicAccess = false,
) {
  const [rows] = await db.execute<FileRow[]>(accessibleFileSql(), [
    storageKey,
    userId,
    userId,
    userId,
    userId,
    userId,
  ]);
  const row = rows[0];
  if (!row) throw new HttpError(404, "文件不存在");
  const settings = await requireStorageSettings();
  const filePath = resolveStoragePath(settings.root, row.relative_path);
  const file = Bun.file(filePath);
  if (!(await file.exists())) throw new HttpError(410, "文件已丢失");
  const size = file.size;
  const range = parseRange(request.headers.get("range"), size);
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": publicAccess
      ? "public, max-age=3600"
      : "private, no-cache",
    "Content-Type": row.mime_type,
    ETag: `"${row.sha256}"`,
    "X-Content-Type-Options": "nosniff",
  });
  if (!range) {
    headers.set("Content-Length", String(size));
    return new Response(request.method === "HEAD" ? null : file, {
      headers,
    });
  }
  headers.set("Content-Length", String(range.end - range.start + 1));
  headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
  return new Response(
    request.method === "HEAD" ? null : file.slice(range.start, range.end + 1),
    { status: 206, headers },
  );
}

function accessibleFileSql() {
  return `SELECT f.id, f.storage_key, f.relative_path, f.mime_type, f.bytes, f.sha256,
                 f.owner_user_id, f.project_id, f.team_project_id
            FROM canvas_files f
           WHERE f.storage_key = ? AND f.deleted_at IS NULL
             AND (
               (
                 f.project_id IS NULL
                 AND f.team_project_id IS NULL
                 AND f.owner_user_id = ?
               )
               OR EXISTS (
                 SELECT 1
                   FROM canvas_projects cp
                  WHERE cp.id = f.project_id
                    AND cp.deleted_at IS NULL
                    AND (
                      (cp.team_project_id IS NULL AND f.owner_user_id = ?)
                      OR EXISTS (
                        SELECT 1
                          FROM team_project_members pm
                          JOIN team_projects tp ON tp.id = pm.project_id
                         WHERE pm.project_id = cp.team_project_id
                           AND pm.user_id = ?
                           AND tp.deleted_at IS NULL
                      )
                    )
                 )
               OR (
                 f.team_project_id IS NOT NULL
                 AND EXISTS (
                   SELECT 1
                     FROM team_project_members pm
                     JOIN team_projects tp ON tp.id = pm.project_id
                    WHERE pm.project_id = f.team_project_id
                      AND pm.user_id = ?
                      AND tp.deleted_at IS NULL
                 )
               )
             )
           ORDER BY (
                      f.project_id IS NULL
                      AND f.team_project_id IS NULL
                      AND f.owner_user_id = ?
                    ) DESC,
                    f.updated_at DESC
           LIMIT 1`;
}
