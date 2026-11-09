import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";

import { db } from "./db";
import { HttpError } from "./http";

export type TeamProjectMember = {
  userId: number;
  username: string;
  displayName: string;
};

export type TeamProjectSummary = {
  id: string;
  title: string;
  description: string;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
  canvasCount: number;
  members: TeamProjectMember[];
};

type ProjectRow = RowDataPacket & {
  id: string;
  title: string;
  description: string;
  created_by: number;
  created_at: Date | string;
  updated_at: Date | string;
};

type MemberRow = RowDataPacket & {
  project_id: string;
  user_id: number;
  username: string;
  display_name: string;
};

type CountRow = RowDataPacket & {
  team_project_id: string;
  count: number;
};

function iso(value: Date | string) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function newProjectId() {
  return `team_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

function titleValue(value: unknown) {
  if (typeof value !== "string" || !value.trim())
    throw new HttpError(400, "项目名称不能为空");
  return value.trim().slice(0, 200);
}

function descriptionValue(value: unknown) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new HttpError(400, "项目描述格式不正确");
  return value.trim().slice(0, 500);
}

function userIdsValue(value: unknown) {
  if (!Array.isArray(value)) throw new HttpError(400, "项目成员格式不正确");
  const ids = [
    ...new Set(
      value.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0),
    ),
  ];
  if (ids.length !== value.length)
    throw new HttpError(400, "项目成员格式不正确");
  return ids;
}

async function assertUsersExist(userIds: number[]) {
  if (!userIds.length) return;
  const placeholders = userIds.map(() => "?").join(", ");
  const [rows] = await db.query<Array<RowDataPacket & { id: number }>>(
    `SELECT id FROM users WHERE id IN (${placeholders})`,
    userIds,
  );
  if (rows.length !== userIds.length)
    throw new HttpError(400, "项目成员中包含不存在的用户");
}

async function projectRows(projectId?: string) {
  const params: string[] = [];
  let where = "p.deleted_at IS NULL";
  if (projectId) {
    where += " AND p.id = ?";
    params.push(projectId);
  }
  const [rows] = await db.execute<ProjectRow[]>(
    `SELECT p.id, p.title, p.description, p.created_by, p.created_at, p.updated_at
       FROM team_projects p
      WHERE ${where}
      ORDER BY p.updated_at DESC`,
    params,
  );
  return rows;
}

async function projectDetails(rows: ProjectRow[]) {
  if (!rows.length) return [] as TeamProjectSummary[];
  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => "?").join(", ");
  const [[memberRows], [countRows]] = await Promise.all([
    db.execute<MemberRow[]>(
      `SELECT pm.project_id, u.id AS user_id, u.username, u.display_name
         FROM team_project_members pm
         JOIN users u ON u.id = pm.user_id
        WHERE pm.project_id IN (${placeholders})
        ORDER BY u.display_name ASC, u.id ASC`,
      ids,
    ),
    db.query<CountRow[]>(
      `SELECT team_project_id, COUNT(*) AS count
         FROM canvas_projects
        WHERE deleted_at IS NULL AND team_project_id IN (${placeholders})
        GROUP BY team_project_id`,
      ids,
    ),
  ]);
  const membersByProject = new Map<string, TeamProjectMember[]>();
  for (const row of memberRows) {
    const members = membersByProject.get(row.project_id) || [];
    members.push({
      userId: Number(row.user_id),
      username: row.username,
      displayName: row.display_name,
    });
    membersByProject.set(row.project_id, members);
  }
  const counts = new Map(
    countRows.map((row) => [row.team_project_id, Number(row.count)]),
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    createdBy: Number(row.created_by),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    canvasCount: counts.get(row.id) || 0,
    members: membersByProject.get(row.id) || [],
  }));
}

export async function listAdminTeamProjects() {
  return projectDetails(await projectRows());
}

export async function listMemberTeamProjects(userId: number) {
  const [memberRows] = await db.execute<ProjectRow[]>(
    `SELECT p.id, p.title, p.description, p.created_by, p.created_at, p.updated_at
       FROM team_projects p
       JOIN team_project_members pm ON pm.project_id = p.id
      WHERE pm.user_id = ? AND p.deleted_at IS NULL
      ORDER BY p.updated_at DESC`,
    [userId],
  );
  return projectDetails(memberRows);
}

export async function createTeamProject(
  createdBy: number,
  input: { title: unknown; description?: unknown; userIds?: unknown },
) {
  const id = newProjectId();
  const title = titleValue(input.title);
  const description = descriptionValue(input.description);
  const memberIds = userIdsValue(input.userIds || [createdBy]);
  if (!memberIds.includes(createdBy)) memberIds.unshift(createdBy);
  await assertUsersExist(memberIds);
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      "INSERT INTO team_projects (id, title, description, created_by) VALUES (?, ?, ?, ?)",
      [id, title, description, createdBy],
    );
    for (const memberId of memberIds)
      await connection.execute(
        "INSERT INTO team_project_members (project_id, user_id) VALUES (?, ?)",
        [id, memberId],
      );
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
  return (await projectDetails(await projectRows(id)))[0];
}

export async function updateTeamProject(
  id: string,
  input: { title?: unknown; description?: unknown },
) {
  const sets: string[] = [];
  const values: Array<string> = [];
  if (input.title !== undefined) {
    sets.push("title = ?");
    values.push(titleValue(input.title));
  }
  if (input.description !== undefined) {
    sets.push("description = ?");
    values.push(descriptionValue(input.description));
  }
  if (!sets.length) throw new HttpError(400, "没有需要更新的字段");
  values.push(id);
  await db.execute(
    `UPDATE team_projects SET ${sets.join(", ")} WHERE id = ? AND deleted_at IS NULL`,
    values,
  );
  const project = (await projectDetails(await projectRows(id)))[0];
  if (!project) throw new HttpError(404, "项目不存在");
  return project;
}

export async function replaceTeamProjectMembers(id: string, value: unknown) {
  const memberIds = userIdsValue(value);
  await assertUsersExist(memberIds);
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [projects] = await connection.execute<ProjectRow[]>(
      "SELECT id, title, description, created_by, created_at, updated_at FROM team_projects WHERE id = ? AND deleted_at IS NULL FOR UPDATE",
      [id],
    );
    if (!projects[0]) throw new HttpError(404, "项目不存在");
    await connection.execute(
      "DELETE FROM team_project_members WHERE project_id = ?",
      [id],
    );
    for (const memberId of memberIds)
      await connection.execute(
        "INSERT INTO team_project_members (project_id, user_id) VALUES (?, ?)",
        [id, memberId],
      );
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
  return (await projectDetails(await projectRows(id)))[0];
}

export async function deleteTeamProject(id: string) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [projects] = await connection.execute<ProjectRow[]>(
      "SELECT id, title, description, created_by, created_at, updated_at FROM team_projects WHERE id = ? AND deleted_at IS NULL FOR UPDATE",
      [id],
    );
    if (!projects[0]) throw new HttpError(404, "项目不存在");
    await connection.execute(
      "UPDATE team_projects SET deleted_at = CURRENT_TIMESTAMP(3) WHERE id = ?",
      [id],
    );
    await connection.execute(
      "UPDATE canvas_projects SET deleted_at = CURRENT_TIMESTAMP(3), version = version + 1 WHERE team_project_id = ? AND deleted_at IS NULL",
      [id],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
  return { deleted: true };
}

export async function isTeamProjectMember(projectId: string, userId: number) {
  const [rows] = await db.execute<Array<RowDataPacket & { allowed: number }>>(
    `SELECT 1 AS allowed
       FROM team_project_members pm
       JOIN team_projects p ON p.id = pm.project_id
      WHERE pm.project_id = ? AND pm.user_id = ? AND p.deleted_at IS NULL
      LIMIT 1`,
    [projectId, userId],
  );
  return Boolean(rows[0]);
}

export async function assertTeamProjectMember(
  projectId: string,
  userId: number,
) {
  if (!(await isTeamProjectMember(projectId, userId)))
    throw new HttpError(404, "项目不存在或无权访问");
}
