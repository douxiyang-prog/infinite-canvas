import { apiRequest } from "@/services/api/auth";
import type { Asset } from "@/stores/use-asset-store";

export type AssetDefinition = Omit<Asset, "id" | "createdAt" | "updatedAt">;

export function fetchAssets() {
    return apiRequest<{ assets: Asset[] }>("/api/assets");
}

export function createServerAsset(asset: AssetDefinition) {
    return apiRequest<{ asset: Asset }>("/api/assets", {
        method: "POST",
        body: JSON.stringify({ asset }),
    });
}

export function updateServerAsset(id: string, asset: AssetDefinition) {
    return apiRequest<{ asset: Asset }>(`/api/assets/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify({ asset }),
    });
}

export function deleteServerAsset(id: string) {
    return apiRequest<{ deleted: true }>(`/api/assets/${encodeURIComponent(id)}`, {
        method: "DELETE",
    });
}

export function importServerAssets(assets: Asset[]) {
    return apiRequest<{ assets: Asset[] }>("/api/assets/import", {
        method: "POST",
        body: JSON.stringify({ assets }),
    });
}

export function replaceServerAssets(assets: Asset[]) {
    return apiRequest<{ assets: Asset[] }>("/api/assets", {
        method: "PUT",
        body: JSON.stringify({ assets }),
    });
}
