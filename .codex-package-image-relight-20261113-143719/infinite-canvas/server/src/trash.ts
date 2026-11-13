import { mkdir, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import type { RowDataPacket } from "mysql2";

import { db } from "./db";
import { HttpError } from "./http";
import { requireStorageSettings, resolveStoragePath } from "./storage";

type TrashRow = RowDataPacket & {
  id: number;
  owner_user_id: number;
  resource_type: string;
  resource_id: string;
  original_path: string;
  trash_path: string;
  purge_after: Date | string;
  status: string;
};

async function moveIntoPlace(source: string, target: string) {
  await mkdir(dirname(target), { recursive: true });
  await rename(source, target);
}

export async function restoreProject(userId: number, projectId: string) {
  const settings = await requireStorageSettings();
  const [rows] = await db.execute<TrashRow[]>(
    `SELECT id, owner_user_id, resource_type, resource_id, original_path, trash_path, purge_after, status
       FROM trash_entries
      WHERE owner_user_id = ? AND resource_type = 'project' AND resource_id = ? AND status = 'trashed'
      ORDER BY deleted_at DESC LIMIT 1`,
    [userId, projectId],
  );
  const entry = rows[0];
  if (!entry) throw new HttpError(404, "回收站中不存在该画布");
  if (new Date(entry.purge_after).getTime() <= Date.now())
    throw new HttpError(410, "回收站保留期已结束");

  await db.execute(
    "UPDATE trash_entries SET status = 'restoring' WHERE id = ?",
    [entry.id],
  );
  const source = resolveStoragePath(settings.root, entry.trash_path);
  const target = resolveStoragePath(settings.root, entry.original_path);
  try {
    await moveIntoPlace(source, target);
    await db.execute(
      "UPDATE canvas_projects SET deleted_at = NULL, version = version + 1 WHERE id = ?",
      [projectId],
    );
    await db.execute(
      "UPDATE canvas_files SET deleted_at = NULL WHERE project_id = ?",
      [projectId],
    );
    await db.execute(
      "UPDATE trash_entries SET status = 'restored' WHERE id = ?",
      [entry.id],
    );
  } catch (error) {
    await rename(target, source).catch(() => undefined);
    await db
      .execute("UPDATE trash_entries SET status = 'trashed' WHERE id = ?", [
        entry.id,
      ])
      .catch(() => undefined);
    throw error;
  }
  return { restored: true };
}

export async function purgeExpiredTrash() {
  const settings = await requireStorageSettings().catch(() => null);
  if (!settings) return { purged: 0 };
  const [rows] = await db.execute<TrashRow[]>(
    `SELECT id, owner_user_id, resource_type, resource_id, original_path, trash_path, purge_after, status
       FROM trash_entries
      WHERE status = 'trashed' AND purge_after <= CURRENT_TIMESTAMP(3)
      ORDER BY purge_after ASC
      LIMIT 100`,
  );
  let purged = 0;
  for (const entry of rows) {
    await db.execute(
      "UPDATE trash_entries SET status = 'purging' WHERE id = ? AND status = 'trashed'",
      [entry.id],
    );
    const trashPath = resolveStoragePath(settings.root, entry.trash_path);
    const purgingPath = `${trashPath}.purging-${Date.now()}`;
    try {
      await rename(trashPath, purgingPath).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      });
      await rm(purgingPath, { recursive: true, force: true });
      if (entry.resource_type === "project") {
        await db.execute("DELETE FROM canvas_files WHERE project_id = ?", [
          entry.resource_id,
        ]);
        await db.execute("DELETE FROM canvas_projects WHERE id = ?", [
          entry.resource_id,
        ]);
      }
      await db.execute("DELETE FROM trash_entries WHERE id = ?", [entry.id]);
      purged += 1;
    } catch (error) {
      await db
        .execute("UPDATE trash_entries SET status = 'trashed' WHERE id = ?", [
          entry.id,
        ])
        .catch(() => undefined);
      console.error(`Failed to purge trash entry ${entry.id}`, error);
    }
  }
  return { purged };
}
