import { apiRequest } from "@/services/api/auth";

export type SetupStatus = {
    databaseReady: boolean;
    adminReady: boolean;
    storageReady: boolean;
    setupRequired: boolean;
};

export type StorageValidation = {
    path: string;
    valid: boolean;
    mounted: boolean;
    exists: boolean;
    writable: boolean;
    initialized: boolean;
    empty: boolean;
    filesystemType: string;
    mountPoint: string;
    message: string;
};

export type StorageSettings = {
    root: string;
    layout: "input-output";
    storageId: string;
    formatVersion: number;
    initializedAt: string;
    initializedBy: number;
    maxUploadMb: number;
    autosaveMs: number;
    trashRetentionDays: number;
};

export type AdminStorageConfig = {
    settings: StorageSettings | null;
    validation: StorageValidation | null;
    allowedRoots: string[];
};

export function fetchSetupStatus() {
    return apiRequest<SetupStatus>("/api/setup/status");
}

export function fetchAdminStorageConfig() {
    return apiRequest<AdminStorageConfig>("/api/admin/storage");
}

export function validateStorageSetup(path: string) {
    return apiRequest<StorageValidation>("/api/admin/storage/validate", {
        method: "POST",
        body: JSON.stringify({ path }),
    });
}

export function completeStorageSetup(input: { path: string; maxUploadMb: number; autosaveMs: number; trashRetentionDays: number }) {
    return apiRequest<{ settings: StorageSettings }>("/api/admin/storage/initialize", {
        method: "POST",
        body: JSON.stringify(input),
    });
}
