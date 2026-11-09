import type { RowDataPacket } from "mysql2";

import { db } from "./db";
import { getGlobalConfig } from "./global-config";
import { HttpError } from "./http";

type AssignmentRow = RowDataPacket & {
  all_channels: number;
  channel_ids: unknown;
  version: number;
  updated_at: Date | string | null;
};

type GlobalChannel = {
  id: string;
  name: string;
  models: Array<{ name: string; capability: string }>;
  [key: string]: unknown;
};

export type UserChannelAssignment = {
  allChannels: boolean;
  channelIds: string[];
  version: number;
  updatedAt: string | null;
};

function dateIso(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function parseIds(value: unknown): string[] {
  let parsed = value;
  if (Buffer.isBuffer(parsed)) parsed = parsed.toString("utf8");
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return Array.from(
    new Set(
      parsed
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function globalChannels(config: Record<string, unknown> | null) {
  const value = config?.channels;
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const channel = item as Record<string, unknown>;
    if (typeof channel.id !== "string" || typeof channel.name !== "string")
      return [];
    const models = Array.isArray(channel.models)
      ? channel.models.filter(
          (model): model is { name: string; capability: string } =>
            Boolean(
              model &&
                typeof model === "object" &&
                !Array.isArray(model) &&
                typeof (model as { name?: unknown }).name === "string" &&
                typeof (model as { capability?: unknown }).capability ===
                  "string",
            ),
        )
      : [];
    return [{ ...channel, id: channel.id, name: channel.name, models }];
  });
}

async function readAssignment(userId: number): Promise<UserChannelAssignment> {
  const [rows] = await db.execute<AssignmentRow[]>(
    `SELECT all_channels, channel_ids, version, updated_at
       FROM user_channel_assignments
      WHERE user_id = ?
      LIMIT 1`,
    [userId],
  );
  const row = rows[0];
  return {
    allChannels: row ? Boolean(row.all_channels) : true,
    channelIds: row ? parseIds(row.channel_ids) : [],
    version: Number(row?.version || 0),
    updatedAt: dateIso(row?.updated_at),
  };
}

function channelIdOfModel(value: unknown) {
  if (typeof value !== "string") return "";
  const separator = value.indexOf("::");
  return separator === -1 ? "" : value.slice(0, separator);
}

function pickDefault(
  requested: unknown,
  capability: string,
  channels: GlobalChannel[],
) {
  const value = typeof requested === "string" ? requested : "";
  const channelId = channelIdOfModel(value);
  const modelName = channelId
    ? value.slice(channelId.length + 2)
    : value;
  const requestedChannel = channels.find((channel) => channel.id === channelId);
  if (
    requestedChannel?.models.some(
      (model) =>
        model.name === modelName && model.capability === capability,
    )
  )
    return value;
  for (const channel of channels) {
    const model = channel.models.find((item) => item.capability === capability);
    if (model) return `${channel.id}::${model.name}`;
  }
  return "";
}

export async function getEffectiveUserConfig(userId: number) {
  const [globalConfig, assignment] = await Promise.all([
    getGlobalConfig(),
    readAssignment(userId),
  ]);
  const source = globalConfig.config || {};
  const channels = globalChannels(globalConfig.config);
  const allowed = assignment.allChannels
    ? channels
    : channels.filter((channel) => assignment.channelIds.includes(channel.id));
  const config = {
    ...source,
    channelMode: "local",
    baseUrl: "",
    apiKey: "",
    channels: allowed,
    models: allowed.flatMap((channel) =>
      channel.models.map((model) => `${channel.id}::${model.name}`),
    ),
    model: pickDefault(source.model, "image", allowed),
    imageModel: pickDefault(source.imageModel, "image", allowed),
    videoModel: pickDefault(source.videoModel, "video", allowed),
    textModel: pickDefault(source.textModel, "text", allowed),
    audioModel: pickDefault(source.audioModel, "audio", allowed),
  };
  return {
    version: assignment.version,
    config: globalConfig.config ? config : null,
    webdav: null,
    promptSources: null,
    updatedAt: assignment.updatedAt || globalConfig.updatedAt,
  };
}

export async function getUserChannelAssignment(userId: number) {
  const [globalConfig, assignment] = await Promise.all([
    getGlobalConfig(),
    readAssignment(userId),
  ]);
  return {
    assignment,
    channels: globalChannels(globalConfig.config).map((channel) => ({
      id: channel.id,
      name: channel.name,
      models: channel.models,
    })),
  };
}

export async function saveUserChannelAssignment(
  userId: number,
  input: {
    allChannels: unknown;
    channelIds: unknown;
    expectedVersion: unknown;
  },
  updatedBy: number,
) {
  if (typeof input.allChannels !== "boolean")
    throw new HttpError(400, "全选渠道配置格式不正确");
  const expectedVersion = Number(input.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0)
    throw new HttpError(400, "渠道配置版本不正确");
  if (!Array.isArray(input.channelIds))
    throw new HttpError(400, "渠道选择格式不正确");

  const globalConfig = await getGlobalConfig();
  const knownIds = new Set(
    globalChannels(globalConfig.config).map((channel) => channel.id),
  );
  const channelIds = parseIds(input.channelIds);
  const invalid = channelIds.find((id) => !knownIds.has(id));
  if (invalid) throw new HttpError(400, `渠道不存在：${invalid}`);

  const current = await readAssignment(userId);
  if (expectedVersion !== current.version)
    throw new HttpError(
      409,
      `用户渠道配置已被其他页面更新，当前版本为 ${current.version}`,
    );

  const version = current.version + 1;
  await db.execute(
    `INSERT INTO user_channel_assignments
       (user_id, all_channels, channel_ids, version, updated_by)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       all_channels = VALUES(all_channels),
       channel_ids = VALUES(channel_ids),
       version = VALUES(version),
       updated_by = VALUES(updated_by)`,
    [
      userId,
      input.allChannels ? 1 : 0,
      JSON.stringify(input.allChannels ? [] : channelIds),
      version,
      updatedBy,
    ],
  );
  return {
    assignment: {
      allChannels: input.allChannels,
      channelIds: input.allChannels ? [] : channelIds,
      version,
      updatedAt: new Date().toISOString(),
    },
  };
}
