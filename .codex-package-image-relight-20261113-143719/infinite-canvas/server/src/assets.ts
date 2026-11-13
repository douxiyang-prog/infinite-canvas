import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { HttpError } from "./http";
import { requireStorageSettings, resolveStoragePath } from "./storage";

const ASSET_ID = /^[A-Za-z0-9_-]{1,64}$/;
const STORAGE_KEY = /^[A-Za-z0-9_-]{1,40}:[A-Za-z0-9_-]{1,80}$/;
const ASSET_FILE = "assets.json";
const ASSET_FORMAT_VERSION = 1;
const locks = new Map<string, Promise<unknown>>();

type AssetKind = "text" | "image" | "video";

type AssetBase<T extends AssetKind> = {
  id: string;
  kind: T;
  title: string;
  coverUrl: string;
  tags: string[];
  source?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
};

type TextAsset = AssetBase<"text"> & { data: { content: string } };
type ImageAsset = AssetBase<"image"> & {
  data: {
    dataUrl: string;
    storageKey?: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
  };
};
type VideoAsset = AssetBase<"video"> & {
  data: {
    url: string;
    storageKey?: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
  };
};
type Asset = TextAsset | ImageAsset | VideoAsset;

type AssetFile = {
  app: "infinite-canvas";
  formatVersion: number;
  updatedAt: string;
  assets: Asset[];
};

function withAssetLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) || Promise.resolve();
  const current = previous.catch(() => undefined).then(task);
  locks.set(key, current);
  return current.finally(() => {
    if (locks.get(key) === current) locks.delete(key);
  });
}

function assetRelativePath(userId: number) {
  return `users/${userId}/assets/${ASSET_FILE}`;
}

function teamAssetRelativePath(teamProjectId: string) {
  return `team-projects/${teamProjectId}/assets/${ASSET_FILE}`;
}

function asObject(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HttpError(400, `${label}格式不正确`);
  return value as Record<string, unknown>;
}

function optionalString(value: unknown, label: string) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new HttpError(400, `${label}格式不正确`);
  return value;
}

function optionalStorageKey(value: unknown) {
  const key = optionalString(value, "storageKey");
  if (!key) return undefined;
  if (!STORAGE_KEY.test(key))
    throw new HttpError(400, "storageKey 格式不正确");
  return key;
}

function numberValue(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function dateValue(value: unknown, fallback: string) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? fallback : new Date(timestamp).toISOString();
}

function assetId(value: unknown, fallback: string) {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !ASSET_ID.test(value))
    throw new HttpError(400, "资产 ID 格式不正确");
  return value;
}

function normalizeAsset(
  value: unknown,
  id: string,
  createdAt: string,
  updatedAt: string,
): Asset {
  const raw = asObject(value, "资产");
  const kind = raw.kind;
  if (kind !== "text" && kind !== "image" && kind !== "video")
    throw new HttpError(400, "资产类型不正确");
  const title =
    typeof raw.title === "string" ? raw.title.trim().slice(0, 200) : "";
  if (!title) throw new HttpError(400, "资产标题不能为空");
  const tags = Array.isArray(raw.tags)
    ? raw.tags
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.trim())
        .filter(Boolean)
    : [];
  const base = {
    id,
    title,
    coverUrl: optionalString(raw.coverUrl, "资产封面") || "",
    tags,
    source: optionalString(raw.source, "资产来源"),
    note: optionalString(raw.note, "资产备注"),
    createdAt,
    updatedAt,
    metadata:
      raw.metadata &&
      typeof raw.metadata === "object" &&
      !Array.isArray(raw.metadata)
        ? (raw.metadata as Record<string, unknown>)
        : undefined,
  };
  const data = asObject(raw.data, "资产内容");
  if (kind === "text") {
    if (typeof data.content !== "string")
      throw new HttpError(400, "文本资产内容格式不正确");
    return { ...base, kind, data: { content: data.content } };
  }
  const storageKey = optionalStorageKey(data.storageKey);
  const dimensions = {
    width: numberValue(data.width),
    height: numberValue(data.height),
    bytes: numberValue(data.bytes),
    mimeType: optionalString(data.mimeType, "媒体类型") || "",
  };
  if (kind === "image") {
    if (typeof data.dataUrl !== "string")
      throw new HttpError(400, "图片资产地址格式不正确");
    return {
      ...base,
      kind,
      data: { ...dimensions, dataUrl: data.dataUrl, storageKey },
    };
  }
  if (typeof data.url !== "string")
    throw new HttpError(400, "视频资产地址格式不正确");
  return {
    ...base,
    kind,
    data: { ...dimensions, url: data.url, storageKey },
  };
}

async function readAssetFileAt(relativePath: string): Promise<Asset[]> {
  const settings = await requireStorageSettings();
  const filePath = resolveStoragePath(settings.root, relativePath);
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  let stored: AssetFile;
  try {
    stored = JSON.parse(content) as AssetFile;
  } catch {
    throw new HttpError(500, "资产文件损坏");
  }
  if (
    stored.app !== "infinite-canvas" ||
    Number(stored.formatVersion) !== ASSET_FORMAT_VERSION ||
    !Array.isArray(stored.assets)
  )
    throw new HttpError(500, "资产文件格式无效");
  return stored.assets.map((asset) =>
    normalizeAsset(asset, asset.id, asset.createdAt, asset.updatedAt),
  );
}

async function writeAssetFileAt(relativePath: string, assets: Asset[]) {
  const settings = await requireStorageSettings();
  const filePath = resolveStoragePath(settings.root, relativePath);
  await mkdir(dirname(filePath), { recursive: true });
  const payload: AssetFile = {
    app: "infinite-canvas",
    formatVersion: ASSET_FORMAT_VERSION,
    updatedAt: new Date().toISOString(),
    assets: assets.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, JSON.stringify(payload, null, 2), "utf8");
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function readAssetFile(userId: number) {
  return readAssetFileAt(assetRelativePath(userId));
}

function writeAssetFile(userId: number, assets: Asset[]) {
  return writeAssetFileAt(assetRelativePath(userId), assets);
}

function readTeamAssetFile(teamProjectId: string) {
  return readAssetFileAt(teamAssetRelativePath(teamProjectId));
}

function writeTeamAssetFile(teamProjectId: string, assets: Asset[]) {
  return writeAssetFileAt(teamAssetRelativePath(teamProjectId), assets);
}

export async function listAssets(userId: number) {
  return { assets: await readAssetFile(userId) };
}

export async function createAsset(userId: number, value: unknown) {
  return withAssetLock(String(userId), async () => {
    const now = new Date().toISOString();
    const asset = normalizeAsset(
      value,
      randomUUID().replace(/-/g, ""),
      now,
      now,
    );
    const assets = await readAssetFile(userId);
    assets.unshift(asset);
    await writeAssetFile(userId, assets);
    return { asset };
  });
}

export async function updateAsset(
  userId: number,
  id: string,
  value: unknown,
) {
  if (!ASSET_ID.test(id)) throw new HttpError(400, "资产 ID 格式不正确");
  return withAssetLock(String(userId), async () => {
    const assets = await readAssetFile(userId);
    const index = assets.findIndex((asset) => asset.id === id);
    if (index === -1) throw new HttpError(404, "资产不存在");
    const now = new Date().toISOString();
    const asset = normalizeAsset(
      value,
      id,
      assets[index].createdAt,
      now,
    );
    assets[index] = asset;
    await writeAssetFile(userId, assets);
    return { asset };
  });
}

export async function deleteAsset(userId: number, id: string) {
  if (!ASSET_ID.test(id)) throw new HttpError(400, "资产 ID 格式不正确");
  return withAssetLock(String(userId), async () => {
    const assets = await readAssetFile(userId);
    const next = assets.filter((asset) => asset.id !== id);
    if (next.length === assets.length) throw new HttpError(404, "资产不存在");
    await writeAssetFile(userId, next);
    return { deleted: true };
  });
}

export async function importAssets(userId: number, value: unknown) {
  if (!Array.isArray(value)) throw new HttpError(400, "资产列表格式不正确");
  return withAssetLock(String(userId), async () => {
    const existing = await readAssetFile(userId);
    const byId = new Map(existing.map((asset) => [asset.id, asset]));
    for (const item of value) {
      const raw = asObject(item, "资产");
      const now = new Date().toISOString();
      const id = assetId(raw.id, randomUUID().replace(/-/g, ""));
      const asset = normalizeAsset(
        raw,
        id,
        dateValue(raw.createdAt, now),
        dateValue(raw.updatedAt, now),
      );
      byId.set(id, asset);
    }
    const assets = Array.from(byId.values());
    await writeAssetFile(userId, assets);
    return { assets };
  });
}

export async function replaceAssets(userId: number, value: unknown) {
  if (!Array.isArray(value)) throw new HttpError(400, "资产列表格式不正确");
  return withAssetLock(String(userId), async () => {
    const now = new Date().toISOString();
    const assets = value.map((item) => {
      const raw = asObject(item, "资产");
      const id = assetId(raw.id, randomUUID().replace(/-/g, ""));
      return normalizeAsset(
        raw,
        id,
        dateValue(raw.createdAt, now),
        dateValue(raw.updatedAt, now),
      );
    });
    await writeAssetFile(userId, assets);
    return { assets };
  });
}

export async function listTeamAssets(teamProjectId: string) {
  return { assets: await readTeamAssetFile(teamProjectId) };
}

export async function createTeamAsset(teamProjectId: string, value: unknown) {
  return withAssetLock(`team:${teamProjectId}`, async () => {
    const now = new Date().toISOString();
    const asset = normalizeAsset(
      value,
      randomUUID().replace(/-/g, ""),
      now,
      now,
    );
    const assets = await readTeamAssetFile(teamProjectId);
    assets.unshift(asset);
    await writeTeamAssetFile(teamProjectId, assets);
    return { asset };
  });
}

export async function updateTeamAsset(
  teamProjectId: string,
  id: string,
  value: unknown,
) {
  if (!ASSET_ID.test(id)) throw new HttpError(400, "资产 ID 格式不正确");
  return withAssetLock(`team:${teamProjectId}`, async () => {
    const assets = await readTeamAssetFile(teamProjectId);
    const index = assets.findIndex((asset) => asset.id === id);
    if (index === -1) throw new HttpError(404, "项目资产不存在");
    const asset = normalizeAsset(
      value,
      id,
      assets[index].createdAt,
      new Date().toISOString(),
    );
    assets[index] = asset;
    await writeTeamAssetFile(teamProjectId, assets);
    return { asset };
  });
}

export async function deleteTeamAsset(teamProjectId: string, id: string) {
  if (!ASSET_ID.test(id)) throw new HttpError(400, "资产 ID 格式不正确");
  return withAssetLock(`team:${teamProjectId}`, async () => {
    const assets = await readTeamAssetFile(teamProjectId);
    const next = assets.filter((asset) => asset.id !== id);
    if (next.length === assets.length) throw new HttpError(404, "项目资产不存在");
    await writeTeamAssetFile(teamProjectId, next);
    return { deleted: true };
  });
}

export async function importTeamAssets(
  teamProjectId: string,
  value: unknown,
) {
  if (!Array.isArray(value)) throw new HttpError(400, "资产列表格式不正确");
  return withAssetLock(`team:${teamProjectId}`, async () => {
    const existing = await readTeamAssetFile(teamProjectId);
    const byId = new Map(existing.map((asset) => [asset.id, asset]));
    for (const item of value) {
      const raw = asObject(item, "资产");
      const now = new Date().toISOString();
      const id = assetId(raw.id, randomUUID().replace(/-/g, ""));
      byId.set(
        id,
        normalizeAsset(
          raw,
          id,
          dateValue(raw.createdAt, now),
          dateValue(raw.updatedAt, now),
        ),
      );
    }
    const assets = Array.from(byId.values());
    await writeTeamAssetFile(teamProjectId, assets);
    return { assets };
  });
}
