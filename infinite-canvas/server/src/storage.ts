import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { RowDataPacket } from "mysql2";

import { config } from "./config";
import { db } from "./db";
import { HttpError } from "./http";

const SETTING_KEY = "storage";
const STORAGE_MARKER = ".infinite-canvas-storage";
const STORAGE_FORMAT_VERSION = 1;

type StoredValueRow = RowDataPacket & { setting_value: unknown };
type CountRow = RowDataPacket & { count: number };

export type StoragePolicy = {
  maxUploadMb: number;
  autosaveMs: number;
  trashRetentionDays: number;
};

export type StorageSettings = StoragePolicy & {
  root: string;
  layout: "input-output";
  storageId: string;
  formatVersion: number;
  initializedAt: string;
  initializedBy: number;
};

export type StorageValidation = {
  path: string;
  valid: boolean;
  mounted: boolean;
  exists: boolean;
  writable: boolean;
  initialized: boolean;
  empty: boolean;
  filesystemType: string;
  mountPoint: string;
  message: string;
};

function publicSettings(value: unknown): StorageSettings | null {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const item = parsed as Record<string, unknown>;
  if (
    typeof item.root !== "string" ||
    typeof item.storageId !== "string" ||
    typeof item.initializedAt !== "string" ||
    typeof item.initializedBy !== "number"
  )
    return null;
  return {
    root: item.root,
    layout: "input-output",
    storageId: item.storageId,
    formatVersion: Number(item.formatVersion) || STORAGE_FORMAT_VERSION,
    initializedAt: item.initializedAt,
    initializedBy: item.initializedBy,
    maxUploadMb: Math.min(
      500,
      Math.max(1, Number(item.maxUploadMb) || 500),
    ),
    autosaveMs: Math.min(
      30_000,
      Math.max(400, Number(item.autosaveMs) || 1500),
    ),
    trashRetentionDays: Math.min(
      365,
      Math.max(1, Number(item.trashRetentionDays) || 14),
    ),
  };
}

async function readStoredSettings() {
  const [rows] = await db.execute<StoredValueRow[]>(
    "SELECT setting_value FROM system_settings WHERE setting_key = ? LIMIT 1",
    [SETTING_KEY],
  );
  return publicSettings(rows[0]?.setting_value);
}

function isWithin(base: string, target: string) {
  const result = relative(base, target);
  return (
    result === "" ||
    (!result.startsWith(`..${sep}`) && result !== ".." && !isAbsolute(result))
  );
}

async function canonicalTarget(input: string) {
  const requested = resolve(input);
  const missing: string[] = [];
  let current = requested;
  while (true) {
    try {
      const existing = await realpath(current);
      return resolve(existing, ...missing.reverse());
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" || dirname(current) === current) throw error;
      missing.push(basename(current));
      current = dirname(current);
    }
  }
}

async function readStorageMarker(root: string) {
  try {
    const marker = JSON.parse(
      await readFile(join(root, STORAGE_MARKER), "utf8"),
    ) as Record<string, unknown>;
    if (
      marker.app !== "infinite-canvas" ||
      Number(marker.formatVersion) !== STORAGE_FORMAT_VERSION ||
      typeof marker.storageId !== "string"
    )
      return null;
    return marker;
  } catch {
    return null;
  }
}

async function allowedRoot(input: string) {
  const target = await canonicalTarget(input);
  for (const candidate of config.storageAllowedRoots) {
    try {
      const root = await realpath(resolve(candidate));
      if (isWithin(root, target)) return { root, target };
    } catch {
      // A missing allow-list root simply cannot authorize a storage path.
    }
  }
  return null;
}

function decodeMountPath(value: string) {
  return value
    .replace(/\\040/g, " ")
    .replace(/\\011/g, "\t")
    .replace(/\\012/g, "\n")
    .replace(/\\134/g, "\\");
}

async function mountedFilesystem(target: string) {
  try {
    let selected: { mountPoint: string; filesystemType: string } | null = null;
    const mounts = await readFile("/proc/self/mounts", "utf8");
    for (const line of mounts.split("\n")) {
      const fields = line.trim().split(/\s+/);
      if (fields.length < 3) continue;
      const mountPoint = decodeMountPath(fields[1]);
      if (!isWithin(mountPoint, target)) continue;
      if (!selected || mountPoint.length > selected.mountPoint.length) {
        selected = { mountPoint, filesystemType: fields[2] };
      }
    }
    return selected;
  } catch {
    return null;
  }
}

export async function validateStoragePath(
  input: string,
): Promise<StorageValidation> {
  const raw = input.trim();
  if (!raw || raw.includes("\0") || !isAbsolute(raw)) {
    return {
      path: raw,
      valid: false,
      mounted: false,
      exists: false,
      writable: false,
      initialized: false,
      empty: false,
      filesystemType: "",
      mountPoint: "",
      message: "请输入服务器容器内可访问的绝对路径",
    };
  }
  const allowed = await allowedRoot(raw).catch(() => null);
  if (!allowed) {
    return {
      path: raw,
      valid: false,
      mounted: false,
      exists: false,
      writable: false,
      initialized: false,
      empty: false,
      filesystemType: "",
      mountPoint: "",
      message: "路径不在允许的存储根目录内，请检查 CANVAS_STORAGE_ALLOWED_ROOTS",
    };
  }

  const target = allowed.target;
  const filesystem = await mountedFilesystem(target);
  const mounted = Boolean(filesystem && filesystem.mountPoint !== "/");
  let exists = true;
  try {
    const info = await stat(target);
    if (!info.isDirectory()) {
      return {
        path: target,
        valid: false,
        mounted,
        exists: true,
        writable: false,
        initialized: false,
        empty: false,
        filesystemType: filesystem?.filesystemType || "",
        mountPoint: filesystem?.mountPoint || "",
        message: "目标路径不是目录",
      };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    exists = false;
  }

  const entries = exists ? await readdir(target) : [];
  let initialized = false;
  if (entries.includes(STORAGE_MARKER)) {
    initialized = Boolean(await readStorageMarker(target));
    if (!initialized) {
      return {
        path: target,
        valid: false,
        mounted,
        exists,
        writable: false,
        initialized: false,
        empty: false,
        filesystemType: filesystem?.filesystemType || "",
        mountPoint: filesystem?.mountPoint || "",
        message: "存储标记文件无效",
      };
    }
  }

  const empty = exists && entries.length === 0;
  if (!empty && !initialized) {
    return {
      path: target,
      valid: false,
      mounted,
      exists,
      writable: false,
      initialized: false,
      empty: false,
      filesystemType: filesystem?.filesystemType || "",
      mountPoint: filesystem?.mountPoint || "",
      message: "目录非空且不是 Infinite Canvas 存储目录",
    };
  }

  const writableRoot = exists ? target : dirname(target);
  let writable = true;
  try {
    await access(writableRoot, fsConstants.R_OK | fsConstants.W_OK);
  } catch {
    writable = false;
  }
  return {
    path: target,
    valid: writable && mounted,
    mounted,
    exists,
    writable,
    initialized,
    empty,
    filesystemType: filesystem?.filesystemType || "",
    mountPoint: filesystem?.mountPoint || "",
    message: !mounted
      ? "目标路径没有位于独立挂载卷，请检查 SMB 挂载"
      : writable
      ? initialized
        ? "存储目录已初始化"
        : exists
          ? "空目录，可以初始化"
          : "目录不存在，初始化时将自动创建"
      : "存储目录没有读取或写入权限",
  };
}

async function writeMarker(root: string, storageId: string) {
  const markerPath = join(root, STORAGE_MARKER);
  const tempPath = `${markerPath}.${randomUUID()}.tmp`;
  await writeFile(
    tempPath,
    JSON.stringify(
      {
        app: "infinite-canvas",
        formatVersion: STORAGE_FORMAT_VERSION,
        storageId,
        initializedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );
  await rename(tempPath, markerPath);
}

async function verifyWritable(root: string) {
  const testPath = join(root, `.write-test-${randomUUID()}`);
  const renamedPath = `${testPath}.renamed`;
  await writeFile(testPath, "infinite-canvas-storage-test", "utf8");
  try {
    await rename(testPath, renamedPath);
    if ((await readFile(renamedPath, "utf8")) !== "infinite-canvas-storage-test")
      throw new Error("Storage write verification failed");
  } finally {
    await rm(testPath, { force: true }).catch(() => undefined);
    await rm(renamedPath, { force: true }).catch(() => undefined);
  }
}

function validInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

export async function initializeStorage(
  input: string,
  policy: Partial<StoragePolicy>,
  userId: number,
) {
  const validation = await validateStoragePath(input);
  if (!validation.valid) throw new HttpError(400, validation.message);

  const existing = await readStoredSettings();
  if (existing && resolve(existing.root) !== validation.path) {
    const [rows] = await db.execute<CountRow[]>(
      `SELECT
         (SELECT COUNT(*) FROM canvas_projects) +
         (SELECT COUNT(*) FROM canvas_files) AS count`,
    );
    if (Number(rows[0]?.count || 0) > 0) {
      throw new HttpError(
        409,
        "已有画布数据，不能直接更换存储路径，请使用存储迁移功能",
      );
    }
  }

  await mkdir(validation.path, { recursive: true });
  const marker = validation.initialized
    ? await readStorageMarker(validation.path)
    : null;
  const storageId =
    existing?.storageId ||
    (typeof marker?.storageId === "string" ? marker.storageId : randomUUID());
  if (!validation.initialized) await writeMarker(validation.path, storageId);
  await verifyWritable(validation.path);
  await mkdir(join(validation.path, "users"), { recursive: true });
  await mkdir(join(validation.path, ".trash"), { recursive: true });

  const settings: StorageSettings = {
    root: validation.path,
    layout: "input-output",
    storageId,
    formatVersion: STORAGE_FORMAT_VERSION,
    initializedAt: existing?.initializedAt || new Date().toISOString(),
    initializedBy: existing?.initializedBy || userId,
    maxUploadMb: validInteger(policy.maxUploadMb, 500, 1, 500),
    autosaveMs: validInteger(policy.autosaveMs, 1500, 400, 30_000),
    trashRetentionDays: validInteger(
      policy.trashRetentionDays,
      14,
      1,
      365,
    ),
  };
  await db.execute(
    `INSERT INTO system_settings (setting_key, setting_value, updated_by)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
    [SETTING_KEY, JSON.stringify(settings), userId],
  );
  return settings;
}

export async function getStorageSettings() {
  return readStoredSettings();
}

export async function requireStorageSettings() {
  const settings = await readStoredSettings();
  if (!settings) throw new HttpError(503, "服务端存储尚未初始化");
  const validation = await validateStoragePath(settings.root);
  if (!validation.valid) throw new HttpError(503, validation.message);
  return settings;
}

export function resolveStoragePath(root: string, relativePath: string) {
  if (!relativePath || isAbsolute(relativePath))
    throw new HttpError(400, "存储相对路径无效");
  const target = resolve(root, relativePath);
  if (!isWithin(resolve(root), target))
    throw new HttpError(400, "存储路径越界");
  return target;
}

export async function setupStatus() {
  const [userRows] = await db.execute<CountRow[]>(
    "SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND status = 'active'",
  );
  const settings = await readStoredSettings();
  let storageReady = false;
  if (settings) {
    const validation = await validateStoragePath(settings.root).catch(
      () => null,
    );
    storageReady = Boolean(validation?.valid && validation.mounted);
  }
  return {
    databaseReady: true,
    adminReady: Number(userRows[0]?.count || 0) > 0,
    storageReady,
    setupRequired:
      Number(userRows[0]?.count || 0) === 0 || !storageReady,
  };
}
