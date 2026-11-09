import { nanoid } from "nanoid";

import { canvasFileUrl, fetchCanvasFileBlob, uploadCanvasFile, type FileArea } from "@/services/api/files";
import { withLocalProxy } from "@/stores/use-config-store";

export type UploadedFile = { url: string; storageKey: string; bytes: number; mimeType: string; width?: number; height?: number; durationMs?: number };

type MediaUploadOptions = {
    area?: FileArea;
    projectId?: string;
    teamProjectId?: string;
};

function mediaKind(prefix: string, blob: Blob) {
    if (prefix.includes("video") || blob.type.startsWith("video/")) return "video";
    if (prefix.includes("audio") || blob.type.startsWith("audio/")) return "audio";
    if (blob.type.startsWith("image/")) return "image";
    return "file";
}

export async function uploadMediaFile(input: string | Blob, prefix = "file", options: MediaUploadOptions = {}): Promise<UploadedFile> {
    const blob = typeof input === "string" ? await (await fetch(withLocalProxy(input))).blob() : input;
    const storageKey = `${prefix}:${nanoid()}`;
    const url = URL.createObjectURL(blob);
    const meta: { width?: number; height?: number; durationMs?: number } =
        blob.type.startsWith("video/") ? await readVideoMeta(url) : blob.type.startsWith("audio/") ? await readAudioMeta(url) : {};
    const uploaded = await uploadCanvasFile(blob, {
        area: options.area || "input",
        projectId: options.projectId,
        teamProjectId: options.teamProjectId,
        storageKey,
        kind: mediaKind(prefix, blob),
        width: meta.width,
        height: meta.height,
        durationMs: meta.durationMs,
    });
    URL.revokeObjectURL(url);
    return {
        url: canvasFileUrl(storageKey),
        storageKey,
        bytes: uploaded.bytes,
        mimeType: uploaded.mimeType,
        width: uploaded.width ?? meta.width,
        height: uploaded.height ?? meta.height,
        durationMs: uploaded.durationMs ?? meta.durationMs,
    };
}

export async function resolveMediaUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    try {
        return canvasFileUrl(storageKey);
    } catch {
        return fallback;
    }
}

export async function getMediaBlob(storageKey: string) {
    try {
        return await fetchCanvasFileBlob(storageKey);
    } catch {
        return null;
    }
}

export async function setMediaBlob(storageKey: string, blob: Blob, options?: { teamProjectId?: string }) {
    await uploadCanvasFile(blob, {
        area: "input",
        storageKey,
        kind: mediaKind(storageKey.split(":")[0] || "file", blob),
        teamProjectId: options?.teamProjectId,
    });
    return canvasFileUrl(storageKey);
}

export async function deleteStoredMedia(keys: Iterable<string>) {
    void keys;
}

export async function cleanupUnusedMedia(_usedData: unknown) {
    // Server-side garbage collection owns physical file deletion.
}

export function collectMediaStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.includes(":")) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectMediaStorageKeys(child, keys)) : collectMediaStorageKeys(item, keys)));
    return keys;
}

function readVideoMeta(url: string) {
    return new Promise<{ width: number; height: number; durationMs?: number }>((resolve) => {
        const video = document.createElement("video");
        const done = () => resolve({ width: video.videoWidth || 1280, height: video.videoHeight || 720, durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined });
        video.onloadedmetadata = done;
        video.onerror = done;
        video.src = url;
    });
}

function readAudioMeta(url: string) {
    return new Promise<{ durationMs?: number }>((resolve) => {
        const audio = document.createElement("audio");
        const done = () => resolve({ durationMs: Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : undefined });
        audio.onloadedmetadata = done;
        audio.onerror = done;
        audio.src = url;
    });
}
