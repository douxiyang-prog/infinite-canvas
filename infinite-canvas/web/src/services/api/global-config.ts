import { apiRequest } from "@/services/api/auth";
import type { PromptSource } from "@/services/api/prompt-source-presets";
import type { AiConfig, WebdavSyncConfig } from "@/stores/use-config-store";
import type { PromptSourceSchedule } from "@/stores/use-prompt-source-store";

export type GlobalConfigResponse = {
    version: number;
    config: Partial<AiConfig> | null;
    webdav: Partial<WebdavSyncConfig> | null;
    promptSources: { sources?: PromptSource[]; schedule?: Partial<PromptSourceSchedule> } | null;
    updatedAt: string | null;
};

export function fetchGlobalConfig() {
    return apiRequest<GlobalConfigResponse>("/api/config");
}

export function saveGlobalConfig(input: { expectedVersion: number; config: AiConfig; webdav: WebdavSyncConfig; promptSources: { sources: PromptSource[]; schedule: PromptSourceSchedule } }) {
    return apiRequest<GlobalConfigResponse>("/api/config", {
        method: "PUT",
        body: JSON.stringify(input),
    });
}
