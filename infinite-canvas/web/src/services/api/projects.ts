import { apiRequest } from "@/services/api/auth";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import type { TeamProject } from "@/types/team-project";

export type ProjectListResponse = {
    projects: CanvasProject[];
    versions: Record<string, number>;
    teamProjects: TeamProject[];
};

export function fetchProjects() {
    return apiRequest<ProjectListResponse>("/api/projects");
}

export function saveProject(project: CanvasProject, expectedVersion: number) {
    return apiRequest<{ version: number; updatedAt: string }>(`/api/projects/${encodeURIComponent(project.id)}`, {
        method: "PUT",
        body: JSON.stringify({ project, expectedVersion }),
    });
}

export function deleteProject(projectId: string, expectedVersion: number) {
    return apiRequest<{ deleted: true; trashPath: string; purgeAfter: string }>(`/api/projects/${encodeURIComponent(projectId)}?expectedVersion=${expectedVersion}`, {
        method: "DELETE",
    });
}
