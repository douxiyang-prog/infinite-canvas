import { apiRequest } from "@/services/api/auth";
import type { Asset } from "@/stores/use-asset-store";

export type TeamProjectAssetDefinition = Omit<Asset, "id" | "createdAt" | "updatedAt">;

export function fetchTeamProjectAssets(teamProjectId: string) {
    return apiRequest<{ assets: Asset[] }>(`/api/team-projects/${encodeURIComponent(teamProjectId)}/assets`);
}

export async function createTeamProjectAsset(teamProjectId: string, asset: TeamProjectAssetDefinition) {
    return (
        await apiRequest<{ asset: Asset }>(`/api/team-projects/${encodeURIComponent(teamProjectId)}/assets`, {
            method: "POST",
            body: JSON.stringify({ asset }),
        })
    ).asset;
}

export async function updateTeamProjectAsset(teamProjectId: string, assetId: string, asset: TeamProjectAssetDefinition) {
    return (
        await apiRequest<{ asset: Asset }>(`/api/team-projects/${encodeURIComponent(teamProjectId)}/assets/${encodeURIComponent(assetId)}`, {
            method: "PUT",
            body: JSON.stringify({ asset }),
        })
    ).asset;
}

export function deleteTeamProjectAsset(teamProjectId: string, assetId: string) {
    return apiRequest<{ deleted: true }>(`/api/team-projects/${encodeURIComponent(teamProjectId)}/assets/${encodeURIComponent(assetId)}`, {
        method: "DELETE",
    });
}
