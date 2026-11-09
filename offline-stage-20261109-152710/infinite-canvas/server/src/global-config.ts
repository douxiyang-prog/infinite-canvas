import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import type { RowDataPacket } from "mysql2";

import { config } from "./config";
import { db } from "./db";
import { HttpError } from "./http";

const SETTING_KEY = "global_config";

type StoredRow = RowDataPacket & { setting_value: unknown };

type EncryptedValue = {
  kind: "encrypted";
  version: 1;
  iv: string;
  tag: string;
  data: string;
};

type PlainValue = {
  kind: "plain";
  value: GlobalConfigSnapshot;
};

export type GlobalConfigSnapshot = {
  version: number;
  config: Record<string, unknown> | null;
  webdav: Record<string, unknown> | null;
  promptSources: Record<string, unknown> | null;
  updatedAt: string | null;
};

function encryptionKey() {
  const secret = config.settingsEncryptionKey;
  return secret ? createHash("sha256").update(secret).digest() : null;
}

function encrypt(value: GlobalConfigSnapshot): EncryptedValue {
  const key = encryptionKey();
  if (!key) throw new HttpError(503, "未配置 SETTINGS_ENCRYPTION_KEY");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return {
    kind: "encrypted",
    version: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
}

function decrypt(value: EncryptedValue): GlobalConfigSnapshot {
  const key = encryptionKey();
  if (!key) throw new HttpError(503, "未配置 SETTINGS_ENCRYPTION_KEY");
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(value.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(value.tag, "base64"));
    const data = Buffer.concat([
      decipher.update(Buffer.from(value.data, "base64")),
      decipher.final(),
    ]);
    return JSON.parse(data.toString("utf8")) as GlobalConfigSnapshot;
  } catch {
    throw new HttpError(500, "全局配置解密失败");
  }
}

function snapshot(value: unknown): GlobalConfigSnapshot | null {
  if (!value) return null;
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
  const valueSnapshot =
    item.kind === "encrypted"
      ? decrypt(item as EncryptedValue)
      : item.kind === "plain"
        ? (item as PlainValue).value
        : (item as GlobalConfigSnapshot);
  return {
    version: Number(valueSnapshot.version) || 0,
    config: valueSnapshot.config || null,
    webdav: valueSnapshot.webdav || null,
    promptSources: valueSnapshot.promptSources || null,
    updatedAt: valueSnapshot.updatedAt || null,
  };
}

async function readSnapshot() {
  const [rows] = await db.execute<StoredRow[]>(
    "SELECT setting_value FROM system_settings WHERE setting_key = ? LIMIT 1",
    [SETTING_KEY],
  );
  return snapshot(rows[0]?.setting_value);
}

export async function getGlobalConfig() {
  return (
    (await readSnapshot()) || {
      version: 0,
      config: null,
      webdav: null,
      promptSources: null,
      updatedAt: null,
    }
  );
}

export async function saveGlobalConfig(
  input: {
    expectedVersion: number;
    config: unknown;
    webdav: unknown;
    promptSources: unknown;
  },
  userId: number,
) {
  if (!input.config || typeof input.config !== "object" || Array.isArray(input.config))
    throw new HttpError(400, "配置格式不正确");
  if (!input.webdav || typeof input.webdav !== "object" || Array.isArray(input.webdav))
    throw new HttpError(400, "WebDAV 配置格式不正确");
  if (
    !input.promptSources ||
    typeof input.promptSources !== "object" ||
    Array.isArray(input.promptSources)
  )
    throw new HttpError(400, "提示词来源配置格式不正确");
  const current = await readSnapshot();
  const currentVersion = current?.version || 0;
  if (input.expectedVersion !== currentVersion)
    throw new HttpError(409, `配置已被其他页面更新，当前版本为 ${currentVersion}`);

  const next: GlobalConfigSnapshot = {
    version: currentVersion + 1,
    config: input.config as Record<string, unknown>,
    webdav: input.webdav as Record<string, unknown>,
    promptSources: input.promptSources as Record<string, unknown>,
    updatedAt: new Date().toISOString(),
  };
  if (!encryptionKey())
    throw new HttpError(503, "请先配置 SETTINGS_ENCRYPTION_KEY 再保存全局配置");
  const stored = encrypt(next);
  const encoded = JSON.stringify(stored);
  if (Buffer.byteLength(encoded) > 5 * 1024 * 1024)
    throw new HttpError(413, "全局配置不能超过 5 MB");
  await db.execute(
    `INSERT INTO system_settings (setting_key, setting_value, updated_by)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
    [SETTING_KEY, encoded, userId],
  );
  return next;
}
