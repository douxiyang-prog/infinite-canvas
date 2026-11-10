import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ResultSetHeader, RowDataPacket } from "mysql2";

import { db } from "./db";
import { HttpError } from "./http";
import { requireStorageSettings, resolveStoragePath } from "./storage";
import {
  assertSceneAvailable,
  assertTeamProjectMember,
  listMemberTeamProjects,
} from "./team-projects";

const PROJECT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const PROJECT_FILE = "project.json";
const PROJECT_FORMAT_VERSION = 1;
const locks = new Map<string, Promise<unknown>>();

type ProjectRow = RowDataPacket & {
  id: string;
  owner_user_id: number;
  team_project_id: string | null;
  scene_id: string | null;
  title: string;
  storage_path: string;
  version: number;
  deleted_at: Date | string | null;
  updated_at: Date | string;
  owner_display_name?: string;
  team_project_title?: string | null;
};

type ProjectFile = {
  app: "infinite-canvas";
  formatVersion: number;
  version: number;
  savedAt: string;
  project: Record<string, unknown>;
};

function validId(value: string) {
  if (!PROJECT_ID.test(value)) throw new HttpError(400, "画布 ID 格式不正确");
  return value;
}

function validProject(value: unknown, id: string) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HttpError(400, "画布数据格式不正确");
  const project = value as Record<string, unknown>;
  if (project.id !== id) throw new HttpError(400, "画布 ID 不匹配");
  if (typeof project.title !== "string" || !project.title.trim())
    throw new HttpError(400, "画布标题不能为空");
  if (!Array.isArray(project.nodes) || !Array.isArray(project.connections))
    throw new HttpError(400, "画布节点或连线格式不正确");
  return project;
}

function projectWithAccess(row: ProjectRow, value: Record<string, unknown>) {
  const teamProjectId = row.team_project_id || null;
  return {
    ...value,
    scope: teamProjectId ? "project" : "personal",
    teamProjectId,
    sceneId: row.scene_id || null,
    teamProjectTitle: row.team_project_title || null,
    ownerDisplayName: row.owner_display_name || null,
  };
}

async function assertCanvasAccess(row: ProjectRow, userId: number) {
  if (row.team_project_id) {
    await assertTeamProjectMember(row.team_project_id, userId);
    return;
  }
  if (Number(row.owner_user_id) !== userId)
    throw new HttpError(404, "画布不存在");
}

async function accessibleCanvasRow(userId: number, projectId: string) {
  const [rows] = await db.execute<ProjectRow[]>(
    `SELECT cp.id, cp.owner_user_id, cp.team_project_id, cp.scene_id, cp.title, cp.storage_path,
            cp.version, cp.deleted_at, cp.updated_at,
            owner.display_name AS owner_display_name,
            tp.title AS team_project_title
       FROM canvas_projects cp
       JOIN users owner ON owner.id = cp.owner_user_id
       LEFT JOIN team_projects tp ON tp.id = cp.team_project_id AND tp.deleted_at IS NULL
       LEFT JOIN team_project_members pm ON pm.project_id = cp.team_project_id AND pm.user_id = ?
      WHERE cp.id = ? AND cp.deleted_at IS NULL
        AND (
          (cp.team_project_id IS NULL AND cp.owner_user_id = ?)
          OR (cp.team_project_id IS NOT NULL AND pm.user_id IS NOT NULL AND tp.id IS NOT NULL)
        )
      LIMIT 1`,
    [userId, projectId, userId],
  );
  return rows[0] || null;
}

export async function canAccessCanvas(userId: number, projectId: string) {
  return Boolean(await accessibleCanvasRow(userId, projectId));
}

function projectRelativePath(userId: number, projectId: string) {
  return `users/${userId}/projects/${projectId}`;
}

async function withProjectLock<T>(
  key: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = locks.get(key) || Promise.resolve();
  const current = previous.catch(() => undefined).then(task);
  locks.set(key, current);
  try {
    return await current;
  } finally {
    if (locks.get(key) === current) locks.delete(key);
  }
}

async function readProjectFile(row: ProjectRow, root: string) {
  const filePath = resolveStoragePath(
    root,
    `${row.storage_path}/${PROJECT_FILE}`,
  );
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch {
    throw new HttpError(500, `画布 ${row.id} 的项目文件缺失`);
  }
  let stored: ProjectFile;
  try {
    stored = JSON.parse(content) as ProjectFile;
  } catch {
    throw new HttpError(500, `画布 ${row.id} 的项目文件损坏`);
  }
  if (
    stored.app !== "infinite-canvas" ||
    stored.formatVersion !== PROJECT_FORMAT_VERSION ||
    !stored.project ||
    stored.project.id !== row.id
  )
    throw new HttpError(500, `画布 ${row.id} 的项目文件格式无效`);
  return {
    project: stored.project,
    version: Number(stored.version) || Number(row.version),
  };
}

export async function listProjects(userId: number) {
  const settings = await requireStorageSettings();
  const [rows] = await db.execute<ProjectRow[]>(
    `SELECT cp.id, cp.owner_user_id, cp.team_project_id, cp.scene_id, cp.title, cp.storage_path,
            cp.version, cp.deleted_at, cp.updated_at,
            owner.display_name AS owner_display_name,
            tp.title AS team_project_title
       FROM canvas_projects cp
       JOIN users owner ON owner.id = cp.owner_user_id
       LEFT JOIN team_projects tp ON tp.id = cp.team_project_id AND tp.deleted_at IS NULL
       LEFT JOIN team_project_members pm ON pm.project_id = cp.team_project_id AND pm.user_id = ?
      WHERE cp.deleted_at IS NULL
        AND (
          (cp.team_project_id IS NULL AND cp.owner_user_id = ?)
          OR (cp.team_project_id IS NOT NULL AND pm.user_id IS NOT NULL AND tp.id IS NOT NULL)
        )
      ORDER BY cp.updated_at DESC`,
    [userId, userId],
  );
  const projects: Record<string, unknown>[] = [];
  const versions: Record<string, number> = {};
  for (const row of rows) {
    const loaded = await readProjectFile(row, settings.root);
    projects.push(projectWithAccess(row, loaded.project));
    versions[row.id] = loaded.version;
  }
  return {
    projects,
    versions,
    teamProjects: await listMemberTeamProjects(userId),
  };
}

export async function loadProject(userId: number, projectId: string) {
  validId(projectId);
  const settings = await requireStorageSettings();
  const row = await accessibleCanvasRow(userId, projectId);
  if (!row) throw new HttpError(404, "画布不存在");
  const loaded = await readProjectFile(row, settings.root);
  return {
    project: projectWithAccess(row, loaded.project),
    version: loaded.version,
  };
}

export async function saveProject(
  userId: number,
  projectId: string,
  value: unknown,
  expectedVersion: number,
) {
  validId(projectId);
  const project = validProject(value, projectId);
  const settings = await requireStorageSettings();
  return withProjectLock(projectId, async () => {
    const [rows] = await db.execute<ProjectRow[]>(
      `SELECT id, owner_user_id, team_project_id, scene_id, title, storage_path, version, deleted_at, updated_at
         FROM canvas_projects
        WHERE id = ?
        LIMIT 1`,
      [projectId],
    );
    const current = rows[0];
    if (current) await assertCanvasAccess(current, userId);
    const currentVersion = current ? Number(current.version) : 0;
    if (expectedVersion !== currentVersion) {
      throw new HttpError(
        409,
        `画布已被其他页面更新，当前版本为 ${currentVersion}`,
      );
    }
    if (current?.deleted_at) throw new HttpError(410, "画布已删除");

    let teamProjectId = current?.team_project_id || null;
    let sceneId = current?.scene_id || null;
    if (!current) {
      const requestedTeamProject = project.teamProjectId;
      if (
        project.scope !== undefined &&
        project.scope !== "personal" &&
        project.scope !== "project"
      )
        throw new HttpError(400, "画布归属格式不正确");
      if (project.scope === "personal" && requestedTeamProject)
        throw new HttpError(400, "个人画布不能指定所属项目");
      if (project.scope === "project" && !requestedTeamProject)
        throw new HttpError(400, "项目画布必须指定所属项目");
      if (requestedTeamProject !== undefined && requestedTeamProject !== null) {
        if (
          typeof requestedTeamProject !== "string" ||
          !requestedTeamProject.trim()
        )
          throw new HttpError(400, "项目 ID 格式不正确");
        validId(requestedTeamProject.trim());
        await assertTeamProjectMember(requestedTeamProject.trim(), userId);
        teamProjectId = requestedTeamProject.trim();
      }
      const requestedScene = project.sceneId;
      if (requestedScene !== undefined && requestedScene !== null) {
        if (typeof requestedScene !== "string" || !requestedScene.trim())
          throw new HttpError(400, "场次 ID 格式不正确");
        if (!teamProjectId) throw new HttpError(400, "无场次画布不能指定场次");
        validId(requestedScene.trim());
        await assertSceneAvailable(
          teamProjectId,
          requestedScene.trim(),
        );
        sceneId = requestedScene.trim();
      }
    }
    const storedProject = {
      ...project,
      scope: teamProjectId ? "project" : "personal",
      teamProjectId,
      sceneId,
    };

    const version = currentVersion + 1;
    const relativePath =
      current?.storage_path || projectRelativePath(userId, projectId);
    const projectDir = resolveStoragePath(settings.root, relativePath);
    await mkdir(join(projectDir, "input"), { recursive: true });
    await mkdir(join(projectDir, "output"), { recursive: true });

    const payload: ProjectFile = {
      app: "infinite-canvas",
      formatVersion: PROJECT_FORMAT_VERSION,
      version,
      savedAt: new Date().toISOString(),
      project: storedProject,
    };
    const body = Buffer.from(JSON.stringify(payload, null, 2), "utf8");
    if (body.byteLength > 20 * 1024 * 1024)
      throw new HttpError(413, "画布数据不能超过 20 MB");
    const filePath = join(projectDir, PROJECT_FILE);
    const tempPath = `${filePath}.${randomUUID()}.tmp`;
    const backupPath = `${filePath}.${randomUUID()}.backup`;
    await writeFile(tempPath, body);
    let hadBackup = false;
    try {
      await rename(filePath, backupPath);
      hadBackup = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const checksum = createHash("sha256").update(body).digest("hex");
    try {
      await rename(tempPath, filePath);
      await db.execute<ResultSetHeader>(
        `INSERT INTO canvas_projects
           (id, owner_user_id, team_project_id, scene_id, title, storage_path, version, content_sha256, size_bytes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           title = VALUES(title),
           storage_path = VALUES(storage_path),
           version = VALUES(version),
           content_sha256 = VALUES(content_sha256),
           size_bytes = VALUES(size_bytes),
           deleted_at = NULL`,
        [
          projectId,
          userId,
          teamProjectId,
          sceneId,
          String(project.title).trim().slice(0, 200),
          relativePath,
          version,
          checksum,
          body.byteLength,
        ],
      );
      if (hadBackup)
        await rm(backupPath, { force: true }).catch(() => undefined);
    } catch (error) {
      await rm(filePath, { force: true }).catch(() => undefined);
      if (hadBackup) await rename(backupPath, filePath).catch(() => undefined);
      throw error;
    }
    return { version, updatedAt: new Date().toISOString() };
  });
}

export async function deleteProject(
  userId: number,
  projectId: string,
  expectedVersion: number,
) {
  validId(projectId);
  const settings = await requireStorageSettings();
  return withProjectLock(projectId, async () => {
    const [rows] = await db.execute<ProjectRow[]>(
      `SELECT id, owner_user_id, team_project_id, scene_id, title, storage_path, version, deleted_at, updated_at
         FROM canvas_projects
        WHERE id = ? AND deleted_at IS NULL
        LIMIT 1`,
      [projectId],
    );
    const current = rows[0];
    if (!current) throw new HttpError(404, "画布不存在");
    await assertCanvasAccess(current, userId);
    if (expectedVersion !== Number(current.version))
      throw new HttpError(409, "画布版本已变化，请刷新后重试");

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const trashRelative = `.trash/${userId}/${timestamp}-${projectId}`;
    const source = resolveStoragePath(settings.root, current.storage_path);
    const target = resolveStoragePath(settings.root, trashRelative);
    await mkdir(join(settings.root, ".trash", String(userId)), {
      recursive: true,
    });
    await rename(source, target);
    const purgeAfter = new Date(
      Date.now() + settings.trashRetentionDays * 24 * 60 * 60 * 1000,
    );
    try {
      await db.execute(
        `UPDATE canvas_projects SET deleted_at = CURRENT_TIMESTAMP(3), version = version + 1 WHERE id = ?`,
        [projectId],
      );
      await db.execute(
        `UPDATE canvas_files SET deleted_at = CURRENT_TIMESTAMP(3) WHERE project_id = ? AND deleted_at IS NULL`,
        [projectId],
      );
      await db.execute(
        `INSERT INTO trash_entries
           (owner_user_id, resource_type, resource_id, original_path, trash_path, deleted_by, purge_after)
         VALUES (?, 'project', ?, ?, ?, ?, ?)`,
        [
          userId,
          projectId,
          current.storage_path,
          trashRelative,
          userId,
          purgeAfter,
        ],
      );
    } catch (error) {
      await rename(target, source).catch(() => undefined);
      throw error;
    }
    return {
      deleted: true,
      trashPath: trashRelative,
      purgeAfter: purgeAfter.toISOString(),
    };
  });
}
