import { apiRequest } from "@/services/api/auth";
import type { AiConfig, WebdavSyncConfig } from "@/stores/use-config-store";

export type GlobalConfigResponse = {
    version: number;
    config: Partial<AiConfig> | null;
    webdav: Partial<WebdavSyncConfig> | null;
    updatedAt: string | null;
};

export function fetchGlobalConfig() {
    return apiRequest<GlobalConfigResponse>("/api/config");
}

export function saveGlobalConfig(input: { expectedVersion: number; config: AiConfig; webdav: WebdavSyncConfig }) {
    return apiRequest<GlobalConfigResponse>("/api/config", {
        method: "PUT",
        body: JSON.stringify(input),
    });
}
