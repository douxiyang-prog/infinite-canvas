export type FileArea = "input" | "output";

export type StoredServerFile = {
    storageKey: string;
    url: string;
    bytes: number;
    mimeType: string;
    width?: number;
    height?: number;
    durationMs?: number;
};

function currentCanvasProjectId() {
    const match = window.location.pathname.match(/^\/canvas\/([A-Za-z0-9_-]+)/);
    return match?.[1] || "";
}

function fileNameFor(blob: Blob, storageKey: string, mimeType: string) {
    if (blob instanceof File && blob.name) return blob.name;
    const extension = mimeType.split("/")[1]?.split("+")[0] || "bin";
    return `${storageKey.replace(/[^A-Za-z0-9_-]/g, "-")}.${extension}`;
}

export async function uploadCanvasFile(input: Blob, options: { area?: FileArea; kind?: string; storageKey?: string; projectId?: string; width?: number; height?: number; durationMs?: number } = {}) {
    const form = new FormData();
    const mimeType = input.type || "application/octet-stream";
    const storageKey = options.storageKey || `${options.kind || "file"}:crypto-random-placeholder`;
    form.set("file", input, fileNameFor(input, storageKey, mimeType));
    form.set("area", options.area || "input");
    form.set("projectId", options.projectId ?? currentCanvasProjectId());
    if (options.kind) form.set("kind", options.kind);
    if (options.storageKey) form.set("storageKey", options.storageKey);
    if (options.width) form.set("width", String(options.width));
    if (options.height) form.set("height", String(options.height));
    if (options.durationMs) form.set("durationMs", String(options.durationMs));

    const response = await fetch("/api/files", {
        method: "POST",
        credentials: "same-origin",
        body: form,
    });
    const data = (await response.json().catch(() => null)) as (StoredServerFile & { error?: string }) | null;
    if (!response.ok) throw new Error(data?.error || `文件上传失败（${response.status}）`);
    return data as StoredServerFile;
}

export async function createPublicFileUrl(storageKey: string) {
  const response = await fetch(
    `/api/files/public-url?storageKey=${encodeURIComponent(storageKey)}`,
    { credentials: "same-origin", cache: "no-store" },
  );
  const data = (await response.json().catch(() => null)) as
    | { url?: string; error?: string }
    | null;
  if (!response.ok || !data?.url)
    throw new Error(data?.error || `公网文件地址获取失败（${response.status}）`);
  return data.url;
}

export function canvasFileUrl(storageKey: string) {
    return `/api/files/${encodeURIComponent(storageKey)}`;
}

export async function fetchCanvasFileBlob(storageKey: string) {
    const response = await fetch(canvasFileUrl(storageKey), {
        credentials: "same-origin",
        cache: "no-store",
    });
    if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || `文件读取失败（${response.status}）`);
    }
    return response.blob();
}
