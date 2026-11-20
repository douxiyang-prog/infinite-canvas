import type { RowDataPacket } from "mysql2";

import { db } from "./db";
import { HttpError } from "./http";

export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

type BrandingRow = RowDataPacket & {
  company_name: string;
  dark_logo_mime: string | null;
  dark_logo_updated_at: Date | string | null;
  login_background: string | null;
  login_logo_offset_x: number | null;
  login_logo_offset_y: number | null;
  logo_mime: string | null;
  logo_updated_at: Date | string | null;
};

type LogoRow = RowDataPacket & {
  dark_logo_data: Buffer | null;
  dark_logo_mime: string | null;
  logo_data: Buffer | null;
  logo_mime: string | null;
};

export type BrandingInfo = {
  companyName: string | null;
  darkLogoUrl: string | null;
  loginBackground: "original" | "nebula";
  loginLogoOffsetX: number;
  loginLogoOffsetY: number;
  logoUrl: string | null;
  updatedAt: string | null;
};

function dateIso(value: Date | string | null) {
  return value
    ? value instanceof Date
      ? value.toISOString()
      : new Date(value).toISOString()
    : null;
}

export async function getBranding(): Promise<BrandingInfo> {
  const [rows] = await db.query<BrandingRow[]>(
    "SELECT company_name, dark_logo_mime, dark_logo_updated_at, login_background, login_logo_offset_x, login_logo_offset_y, logo_mime, logo_updated_at FROM app_settings WHERE id = 1",
  );
  const row = rows[0];
  const updatedAt = dateIso(row?.logo_updated_at ?? null);
  const darkUpdatedAt = dateIso(row?.dark_logo_updated_at ?? null);
  return {
    companyName: row?.company_name || null,
    darkLogoUrl:
      row?.dark_logo_mime && darkUpdatedAt
        ? `/api/branding/logo-dark?v=${encodeURIComponent(darkUpdatedAt)}`
        : null,
    loginBackground:
      row?.login_background === "nebula" ? "nebula" : "original",
    loginLogoOffsetX: Number(row?.login_logo_offset_x ?? 0),
    loginLogoOffsetY: Number(row?.login_logo_offset_y ?? 0),
    logoUrl:
      row?.logo_mime && updatedAt
        ? `/api/branding/logo?v=${encodeURIComponent(updatedAt)}`
        : null,
    updatedAt,
  };
}

export async function updateCompanyName(companyName: string) {
  await db.execute(
    `INSERT INTO app_settings (id, company_name) VALUES (1, ?)
     ON DUPLICATE KEY UPDATE company_name = VALUES(company_name)`,
    [companyName],
  );
  return getBranding();
}

export async function updateLoginBackground(
  loginBackground: "original" | "nebula",
) {
  await db.execute(
    `INSERT INTO app_settings (id, login_background) VALUES (1, ?)
     ON DUPLICATE KEY UPDATE login_background = VALUES(login_background)`,
    [loginBackground],
  );
  return getBranding();
}

export async function updateLoginLogoOffset(
  loginLogoOffsetX: number,
  loginLogoOffsetY: number,
) {
  await db.execute(
    `INSERT INTO app_settings (id, login_logo_offset_x, login_logo_offset_y) VALUES (1, ?, ?)
     ON DUPLICATE KEY UPDATE
       login_logo_offset_x = VALUES(login_logo_offset_x),
       login_logo_offset_y = VALUES(login_logo_offset_y)`,
    [loginLogoOffsetX, loginLogoOffsetY],
  );
  return getBranding();
}

export async function updateLogo(
  data: Uint8Array,
  mime: string,
  dark = false,
) {
  const columns = dark
    ? ["dark_logo_data", "dark_logo_mime", "dark_logo_updated_at"]
    : ["logo_data", "logo_mime", "logo_updated_at"];
  await db.execute(
    `INSERT INTO app_settings (id, ${columns[0]}, ${columns[1]}, ${columns[2]})
     VALUES (1, ?, ?, CURRENT_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE
       ${columns[0]} = VALUES(${columns[0]}),
       ${columns[1]} = VALUES(${columns[1]}),
       ${columns[2]} = CURRENT_TIMESTAMP(3)`,
    [data, mime],
  );
  return getBranding();
}

export async function getLogo(dark = false) {
  const [rows] = await db.query<LogoRow[]>(
    "SELECT dark_logo_data, dark_logo_mime, logo_data, logo_mime FROM app_settings WHERE id = 1",
  );
  const row = rows[0];
  const data = dark ? row?.dark_logo_data : row?.logo_data;
  const mime = dark ? row?.dark_logo_mime : row?.logo_mime;
  if (!data || !mime)
    throw new HttpError(404, "尚未设置 Logo");
  return { data, mime };
}

export function detectLogoMime(data: Uint8Array) {
  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a
  )
    return "image/png";
  if (
    data.length >= 3 &&
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[2] === 0xff
  )
    return "image/jpeg";
  if (
    data.length >= 12 &&
    data[0] === 0x52 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x46 &&
    data[8] === 0x57 &&
    data[9] === 0x45 &&
    data[10] === 0x42 &&
    data[11] === 0x50
  )
    return "image/webp";
  return null;
}
