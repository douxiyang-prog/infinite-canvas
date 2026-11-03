import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RowDataPacket } from "mysql2";

import { db } from "./db";
import { HttpError } from "./http";
import { requireStorageSettings, resolveStoragePath } from "./storage";

const STORAGE_KEY = /^[A-Za-z0-9_-]{1,40}:[A-Za-z0-9_-]{1,80}$/;
const PROJECT_ID = /^[A-Za-z0-9_-]{1,64}$/;

type FileRow = RowDataPacket & {
  id: string;
  storage_key: string;
  relative_path: string;
  mime_type: string;
  bytes: number;
  sha256: string;
};

type ProjectRow = RowDataPacket & {
  id: string;
  owner_user_id: number;
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
  if (projectId && !PROJECT_ID.test(projectId))
    throw new HttpError(400, "画布 ID 格式不正确");
  let projectExists = false;
  if (projectId) {
    const [projects] = await db.execute<ProjectRow[]>(
      `SELECT id, owner_user_id, deleted_at FROM canvas_projects WHERE id = ? LIMIT 1`,
      [projectId],
    );
    if (projects[0] && Number(projects[0].owner_user_id) !== userId)
      throw new HttpError(404, "画布不存在");
    if (projects[0]?.deleted_at) throw new HttpError(410, "画布已删除");
    projectExists = Boolean(projects[0]);
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
    requestedKey ||
    `${kind}:${randomUUID().replace(/-/g, "")}`;
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
           (id, owner_user_id, title, storage_path, version, size_bytes)
         VALUES (?, ?, 'Untitled', ?, 0, 0)`,
        [projectId, userId, `users/${userId}/projects/${projectId}`],
      );
    }
    await connection.execute(
      `INSERT INTO canvas_files
         (id, storage_key, owner_user_id, project_id, area, relative_path, kind, mime_type, bytes, sha256, width, height, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         project_id = VALUES(project_id),
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
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= size || end < start)
    throw new HttpError(416, "Range 请求超出文件范围");
  return { start, end: Math.min(end, size - 1) };
}

export async function getFile(
  userId: number,
  storageKey: string,
  request: Request,
) {
  const [rows] = await db.execute<FileRow[]>(
    `SELECT id, storage_key, relative_path, mime_type, bytes, sha256
       FROM canvas_files
      WHERE owner_user_id = ? AND storage_key = ? AND deleted_at IS NULL
      LIMIT 1`,
    [userId, storageKey],
  );
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
    "Cache-Control": "private, no-cache",
    "Content-Type": row.mime_type,
    "ETag": `"${row.sha256}"`,
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
