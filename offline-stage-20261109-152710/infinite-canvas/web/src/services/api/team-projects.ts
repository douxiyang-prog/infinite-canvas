import { apiRequest } from "@/services/api/auth";
import type { TeamProject } from "@/types/team-project";

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
