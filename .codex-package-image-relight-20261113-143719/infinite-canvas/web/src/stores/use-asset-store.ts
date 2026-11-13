import { create } from "zustand";

import { localForageStorage } from "@/lib/localforage-storage";
import {
    createServerAsset,
    deleteServerAsset,
    fetchAssets,
    importServerAssets,
    replaceServerAssets,
    updateServerAsset,
    type AssetDefinition,
} from "@/services/api/assets";
import { cleanupUnusedImages, ensureImagePreview, previewUrlFor, resolveImageUrl, uploadImage } from "@/services/image-storage";
import { cleanupUnusedMedia, resolveMediaUrl } from "@/services/file-storage";

export type AssetKind = "text" | "image" | "video";
export type TextAsset = AssetBase<"text"> & { data: { content: string } };
export type ImageAsset = AssetBase<"image"> & { data: { dataUrl: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type VideoAsset = AssetBase<"video"> & { data: { url: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type Asset = TextAsset | ImageAsset | VideoAsset;

type AssetBase<T extends AssetKind> = {
    id: string;
    kind: T;
    title: string;
    coverUrl: string;
    tags: string[];
    source?: string;
    note?: string;
    createdAt: string;
    updatedAt: string;
    metadata?: Record<string, unknown>;
};

type AssetStore = {
    hydrated: boolean;
    loadError: string;
    assets: Asset[];
    loadAssets: () => Promise<void>;
    addAsset: (asset: AssetDefinition) => Promise<string>;
    updateAsset: (id: string, patch: Partial<Omit<Asset, "id" | "createdAt">>) => Promise<void>;
    removeAsset: (id: string) => Promise<void>;
    replaceAssets: (assets: Asset[]) => Promise<void>;
    cleanupImages: (extra?: unknown) => void;
};

// 卡片用缩略图渲染，自定义封面（远程地址或单独上传的封面）保持原样。
export function assetCoverUrl(asset: Asset) {
    const own = asset.kind === "image" ? asset.data.dataUrl : "";
    const cover = asset.coverUrl || own;
    return asset.kind === "image" && cover === own ? previewUrlFor(asset.data.storageKey) || cover : cover;
}

const ASSET_STORE_KEY = "infinite-canvas:asset_store";
let loadPromise: Promise<void> | null = null;
let storeGeneration = 0;

async function normalizeAssetForDisplay(asset: Asset): Promise<Asset> {
    if (asset.kind === "video" && asset.data.storageKey) {
        return { ...asset, data: { ...asset.data, url: await resolveMediaUrl(asset.data.storageKey, asset.data.url) } };
    }
    if (asset.kind !== "image" || !asset.data.storageKey) return asset;
    void ensureImagePreview(asset.data.storageKey);
    return {
        ...asset,
        coverUrl: asset.coverUrl.startsWith("blob:") ? await resolveImageUrl(asset.data.storageKey, asset.coverUrl) : asset.coverUrl,
        data: { ...asset.data, dataUrl: await resolveImageUrl(asset.data.storageKey, asset.data.dataUrl) },
    };
}

async function readLegacyAssets() {
    const value = await localForageStorage.getItem(ASSET_STORE_KEY);
    if (!value) return [];
    try {
        const parsed = JSON.parse(value) as { state?: { assets?: Asset[] } };
        if (!Array.isArray(parsed.state?.assets)) return [];
        return Promise.all(
            parsed.state.assets.map(async (asset) => {
                if (asset.kind !== "image" || asset.data.storageKey || !asset.data.dataUrl.startsWith("data:image/")) return normalizeAssetForDisplay(asset);
                try {
                    const image = await uploadImage(asset.data.dataUrl);
                    return {
                        ...asset,
                        coverUrl: asset.coverUrl.startsWith("data:image/") ? image.url : asset.coverUrl,
                        data: { ...asset.data, dataUrl: image.url, storageKey: image.storageKey, bytes: image.bytes, mimeType: image.mimeType },
                    } as ImageAsset;
                } catch {
                    return asset;
                }
            }),
        );
    } catch {
        return [];
    }
}

async function migrateLegacyAssets(serverAssets: Asset[]) {
    const legacyAssets = await readLegacyAssets();
    if (!legacyAssets.length) return serverAssets;
    const serverIds = new Set(serverAssets.map((asset) => asset.id));
    const missing = legacyAssets.filter((asset) => !serverIds.has(asset.id));
    if (!missing.length) {
        await localForageStorage.removeItem(ASSET_STORE_KEY);
        return serverAssets;
    }
    const migrated = await importServerAssets(missing);
    await localForageStorage.removeItem(ASSET_STORE_KEY);
    return migrated.assets;
}

export const useAssetStore = create<AssetStore>()(
    (set, get) => ({
        hydrated: false,
        loadError: "",
        assets: [],
        loadAssets: () => {
            const state = get();
            if (state.hydrated && !state.loadError) return Promise.resolve();
            if (loadPromise) return loadPromise;
            const generation = storeGeneration;
            set({ hydrated: false, loadError: "" });
            loadPromise = (async () => {
                let serverAssets: Asset[];
                try {
                    serverAssets = (await fetchAssets()).assets;
                } catch (error) {
                    if (generation !== storeGeneration) return;
                    set({ hydrated: true, loadError: error instanceof Error ? error.message : String(error) });
                    return;
                }
                let loadError = "";
                let assets = serverAssets;
                try {
                    assets = await migrateLegacyAssets(serverAssets);
                } catch (error) {
                    loadError = error instanceof Error ? error.message : String(error);
                }
                if (generation !== storeGeneration) return;
                set({ assets: await Promise.all(assets.map(normalizeAssetForDisplay)), hydrated: true, loadError });
            })().finally(() => {
                loadPromise = null;
            });
            return loadPromise;
        },
        addAsset: async (asset) => {
            await get().loadAssets();
            const saved = (await createServerAsset(asset)).asset;
            const displayAsset = await normalizeAssetForDisplay(saved);
            set((state) => ({ assets: [displayAsset, ...state.assets], loadError: "" }));
            return saved.id;
        },
        updateAsset: async (id, patch) => {
            await get().loadAssets();
            const current = get().assets.find((asset) => asset.id === id);
            if (!current) throw new Error("资产不存在");
            const next = { ...current, ...patch } as Asset;
            const saved = (await updateServerAsset(id, next)).asset;
            const displayAsset = await normalizeAssetForDisplay(saved);
            set((state) => ({ assets: state.assets.map((asset) => (asset.id === id ? displayAsset : asset)), loadError: "" }));
        },
        removeAsset: async (id) => {
            await get().loadAssets();
            await deleteServerAsset(id);
            set((state) => ({ assets: state.assets.filter((asset) => asset.id !== id), loadError: "" }));
            get().cleanupImages();
        },
        replaceAssets: async (assets) => {
            await get().loadAssets();
            const saved = (await replaceServerAssets(assets)).assets;
            set({ assets: await Promise.all(saved.map(normalizeAssetForDisplay)), loadError: "" });
        },
        cleanupImages: (extra) => {
            window.setTimeout(async () => {
                const { useCanvasStore } = await import("@/stores/canvas/use-canvas-store");
                await cleanupUnusedImages({ assets: get().assets, projects: useCanvasStore.getState().projects, extra });
                await cleanupUnusedMedia({ assets: get().assets, projects: useCanvasStore.getState().projects, extra });
            }, 0);
        },
    }),
);

export function prepareAssetStoreForSession() {
    storeGeneration += 1;
    loadPromise = null;
    useAssetStore.setState({ hydrated: false, loadError: "", assets: [] });
}
