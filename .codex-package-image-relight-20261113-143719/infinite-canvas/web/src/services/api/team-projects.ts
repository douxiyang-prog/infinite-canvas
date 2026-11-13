import { apiRequest } from "@/services/api/auth";
import type { TeamProject, TeamProjectScene } from "@/types/team-project";

export async function fetchAdminTeamProjects() {
    return (await apiRequest<{ projects: TeamProject[] }>("/api/admin/team-projects")).projects;
}

export async function fetchMemberTeamProjects() {
    return (await apiRequest<{ projects: TeamProject[] }>("/api/team-projects")).projects;
}

export async function createAdminTeamProject(input: { title: string; description?: string; userIds: number[] }) {
    return (
        await apiRequest<{ project: TeamProject }>("/api/admin/team-projects", {
            method: "POST",
            body: JSON.stringify(input),
        })
    ).project;
}

export async function updateAdminTeamProject(id: string, input: { title?: string; description?: string }) {
    return (
        await apiRequest<{ project: TeamProject }>(`/api/admin/team-projects/${encodeURIComponent(id)}`, {
            method: "PATCH",
            body: JSON.stringify(input),
        })
    ).project;
}

export async function replaceAdminTeamProjectMembers(id: string, userIds: number[]) {
    return (
        await apiRequest<{ project: TeamProject }>(`/api/admin/team-projects/${encodeURIComponent(id)}/members`, {
            method: "PUT",
            body: JSON.stringify({ userIds }),
        })
    ).project;
}

export function deleteAdminTeamProject(id: string) {
    return apiRequest<{ deleted: true }>(`/api/admin/team-projects/${encodeURIComponent(id)}`, {
        method: "DELETE",
    });
}

export async function createAdminTeamProjectScene(teamProjectId: string, title: string) {
    return (
        await apiRequest<{ scene: TeamProjectScene }>("/api/admin/team-project-scenes", {
            method: "POST",
            body: JSON.stringify({ teamProjectId, title }),
        })
    ).scene;
}

export async function updateAdminTeamProjectScene(id: string, input: { title?: string; hidden?: boolean; sortOrder?: number }) {
    return (
        await apiRequest<{ scene: TeamProjectScene }>(`/api/admin/team-project-scenes/${encodeURIComponent(id)}`, {
            method: "PATCH",
            body: JSON.stringify(input),
        })
    ).scene;
}

export function deleteAdminTeamProjectScene(id: string) {
    return apiRequest<{ deleted: true; id: string }>(`/api/admin/team-project-scenes/${encodeURIComponent(id)}`, {
        method: "DELETE",
    });
}
