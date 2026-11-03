import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { createImageThumbnail } from "@/lib/image-thumbnail";
import { canvasFileUrl, fetchCanvasFileBlob, uploadCanvasFile, type FileArea } from "@/services/api/files";
import { withLocalProxy } from "@/stores/use-config-store";

export type UploadedImage = {
    url: string;
    storageKey?: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

type ImageReadOptions = {
    signal?: AbortSignal;
    area?: FileArea;
    projectId?: string;
};

const previewUrls = new Map<string, string>();
const previewListeners = new Set<() => void>();
let previewRevision = 0;
let previewQueue: Promise<unknown> = Promise.resolve();
const IMAGE_DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
const IMAGE_DECODE_TIMEOUT_MS = 10_000;
const IMAGE_RESPONSE_ERROR = "ImageResponseError";
const IMAGE_TIMEOUT_ERROR = "ImageTimeoutError";

export async function uploadImage(input: string | Blob, options?: ImageReadOptions): Promise<UploadedImage> {
    if (typeof input !== "string") return storeImage(input, options);
    const blob = await fetchImageBlob(input, options);
    return storeImage(blob, options);
}

async function storeImage(blob: Blob, options?: ImageReadOptions): Promise<UploadedImage> {
    const storageKey = `image:${nanoid()}`;
    const localUrl = URL.createObjectURL(blob);
    try {
        const meta = await loadImageMeta(localUrl, options);
        if (!meta) throw new Error(i18n.t("common.imageReadFailed"));
        throwIfAborted(options?.signal);
        const uploaded = await uploadCanvasFile(blob, {
            area: options?.area || "input",
            projectId: options?.projectId,
            kind: "image",
            storageKey,
            width: meta.width,
            height: meta.height,
        });
        throwIfAborted(options?.signal);
        await storeImagePreview(storageKey, blob);
        return {
            url: canvasFileUrl(storageKey),
            storageKey,
            width: meta.width,
            height: meta.height,
            bytes: uploaded.bytes,
            mimeType: uploaded.mimeType,
        };
    } catch (error) {
        throw error;
    } finally {
        URL.revokeObjectURL(localUrl);
    }
}

async function fetchImageBlob(url: string, options?: ImageReadOptions) {
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    if (options?.signal?.aborted) abort();
    else options?.signal?.addEventListener("abort", abort, { once: true });
    const timer = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, IMAGE_DOWNLOAD_TIMEOUT_MS);
    try {
        const response = await fetch(withLocalProxy(url), { signal: controller.signal });
        if (!response.ok) throw namedError(IMAGE_RESPONSE_ERROR);
        return await response.blob();
    } catch (error) {
        if (timedOut) throw namedError(IMAGE_TIMEOUT_ERROR);
        if (options?.signal?.aborted) throw abortReason(options.signal);
        throw error;
    } finally {
        window.clearTimeout(timer);
        options?.signal?.removeEventListener("abort", abort);
    }
}

function loadImageMeta(url: string, options?: ImageReadOptions, timeoutMs = IMAGE_DECODE_TIMEOUT_MS) {
    return new Promise<{ width: number; height: number } | null>((resolve, reject) => {
        if (options?.signal?.aborted) return reject(abortReason(options.signal));
        const image = new Image();
        let settled = false;
        const finish = (value: { width: number; height: number } | null) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            options?.signal?.removeEventListener("abort", abort);
            image.onload = null;
            image.onerror = null;
            resolve(value);
        };
        const abort = () => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            image.onload = null;
            image.onerror = null;
            reject(abortReason(options!.signal!));
        };
        const timer = window.setTimeout(() => finish(null), timeoutMs);
        options?.signal?.addEventListener("abort", abort, { once: true });
        image.onload = () => finish(image.naturalWidth && image.naturalHeight ? { width: image.naturalWidth, height: image.naturalHeight } : null);
        image.onerror = () => finish(null);
        image.src = url;
    });
}

function namedError(name: string) {
    const error = new Error(i18n.t("common.imageReadFailed"));
    error.name = name;
    return error;
}

function isNamedError(error: unknown, name: string) {
    return error instanceof Error && error.name === name;
}

function abortReason(signal: AbortSignal) {
    return signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");
}

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw abortReason(signal);
}

export async function resolveImageUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    try {
        return canvasFileUrl(storageKey);
    } catch {
        return fallback;
    }
}

export async function getImageBlob(storageKey: string) {
    try {
        return await fetchCanvasFileBlob(storageKey);
    } catch {
        return null;
    }
}

export function previewUrlFor(storageKey?: string) {
    return storageKey ? previewUrls.get(storageKey) : undefined;
}

export function subscribeImagePreviews(listener: () => void) {
    previewListeners.add(listener);
    return () => {
        previewListeners.delete(listener);
    };
}

export function getImagePreviewRevision() {
    return previewRevision;
}

export async function ensureImagePreview(storageKey?: string) {
    if (!storageKey) return undefined;
    const cached = previewUrls.get(storageKey);
    if (cached) return cached;
    queueImagePreview(storageKey);
    return undefined;
}

function queueImagePreview(storageKey: string) {
    previewQueue = previewQueue
        .then(async () => {
            if (previewUrls.has(storageKey)) return;
            const original = await getImageBlob(storageKey);
            if (original) await storeImagePreview(storageKey, original);
        })
        .catch(() => undefined);
}

async function storeImagePreview(storageKey: string, original: Blob) {
    const preview = await createImageThumbnail(original).catch(() => undefined);
    return preview ? cacheImagePreview(storageKey, preview) : undefined;
}

function cacheImagePreview(storageKey: string, preview: Blob) {
    const existing = previewUrls.get(storageKey);
    if (existing) URL.revokeObjectURL(existing);
    const url = URL.createObjectURL(preview);
    previewUrls.set(storageKey, url);
    previewRevision += 1;
    previewListeners.forEach((listener) => listener());
    return url;
}

function deleteImagePreview(storageKey: string) {
    const url = previewUrls.get(storageKey);
    if (url) URL.revokeObjectURL(url);
    previewUrls.delete(storageKey);
}

export async function setImageBlob(storageKey: string, blob: Blob) {
    await uploadCanvasFile(blob, {
        area: "input",
        kind: "image",
        storageKey,
    });
    deleteImagePreview(storageKey);
    await storeImagePreview(storageKey, blob);
    return canvasFileUrl(storageKey);
}

export async function imageToDataUrl(image: { url?: string; dataUrl?: string; storageKey?: string }, options?: ImageReadOptions) {
    if (image.dataUrl) return image.dataUrl;
    const blob = image.storageKey ? await getImageBlob(image.storageKey) : null;
    if (blob) return blobToDataUrl(blob);
    const url = image.url || "";
    if (!url || url.startsWith("data:")) return url;
    return blobToDataUrl(await fetchImageBlob(url, options));
}

export async function deleteStoredImages(keys: Iterable<string>) {
    for (const key of new Set(keys)) {
        deleteImagePreview(key);
    }
}

export async function cleanupUnusedImages(_usedData: unknown) {
    // Server-side garbage collection owns physical file deletion.
}

export function collectImageStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.startsWith("image:")) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectImageStorageKeys(child, keys)) : collectImageStorageKeys(item, keys)));
    return keys;
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error(i18n.t("common.imageReadFailed")));
        reader.readAsDataURL(blob);
    });
}
