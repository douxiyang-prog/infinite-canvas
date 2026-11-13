import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { readZip } from "@/lib/zip";
import { setMediaBlob } from "@/services/file-storage";
import { setImageBlob } from "@/services/image-storage";
import type { CanvasExportAsset, CanvasExportFile, CanvasProjectExportItem } from "@/types/canvas-export";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import type { CanvasConnection, CanvasNodeData, CanvasNodeMetadata, Position, ViewportTransform } from "@/types/canvas";
import type { TeamProject } from "@/types/team-project";

type ArchiveEntries = Awaited<ReturnType<typeof readZip>>;

export type MergeCanvasArchiveResult = {
    sourceTitle: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    warnings: string[];
};

export async function importCanvasArchive(
    file: File,
    importProject: (project: Partial<CanvasProject>, teamProject?: Pick<TeamProject, "id" | "title">, sceneId?: string | null) => string,
    teamProject?: Pick<TeamProject, "id" | "title">,
    sceneId: string | null = null,
) {
    const { data, zip } = await readCanvasArchive(file);
    await Promise.all(
        data.projects.flatMap((project) =>
            project.files.map(async (item) => {
                const blob = zip.get(item.path);
                if (!blob) return;
                const typedBlob = blob.type ? blob : blob.slice(0, blob.size, item.mimeType);
                const options = teamProject ? { teamProjectId: teamProject.id } : undefined;
                await (item.storageKey.startsWith("image:") ? setImageBlob(item.storageKey, typedBlob, options) : setMediaBlob(item.storageKey, typedBlob, options));
            }),
        ),
    );
    data.projects.forEach((item) => importProject(item.project, teamProject, sceneId));
    return { count: data.projects.length, projectIds: data.projects.map((item) => item.project.id) };
}

export async function mergeCanvasArchiveIntoCanvas(
    file: File,
    options: {
        targetProjectId: string;
        teamProjectId?: string;
        projectIndex?: number;
        currentNodes: CanvasNodeData[];
        viewport: ViewportTransform;
        viewportSize: { width: number; height: number };
    },
): Promise<MergeCanvasArchiveResult> {
    const { data, zip } = await readCanvasArchive(file);
    const source = data.projects[Math.max(0, Math.min(options.projectIndex || 0, data.projects.length - 1))];
    if (!source) throw new Error(i18n.t("canvas.importEmpty"));

    const warnings: string[] = [];
    const storageKeyMap = await restoreMedia(zip, source, options, warnings);
    const nodeIdMap = new Map(source.project.nodes.map((node) => [node.id, nanoid()]));
    const nodes = source.project.nodes.map((node) => remapNode(node, nodeIdMap, storageKeyMap));
    const nodeIds = new Set(nodes.map((node) => node.id));
    const connections = source.project.connections
        .map((connection) => ({
            ...connection,
            id: nanoid(),
            fromNodeId: nodeIdMap.get(connection.fromNodeId) || "",
            toNodeId: nodeIdMap.get(connection.toNodeId) || "",
        }))
        .filter((connection) => nodeIds.has(connection.fromNodeId) && nodeIds.has(connection.toNodeId));
    return {
        sourceTitle: source.project.title,
        nodes: offsetImportedNodes(nodes, options.currentNodes, options.viewport, options.viewportSize),
        connections,
        warnings,
    };
}

async function readCanvasArchive(file: File) {
    const zip = await readZip(file);
    const projectFile = zip.get("projects.json");
    if (!projectFile) throw new Error(i18n.t("canvas.importInvalid"));
    const data = JSON.parse(await projectFile.text()) as CanvasExportFile;
    if (data?.app !== "infinite-canvas" || !Array.isArray(data.projects) || !data.projects.length) {
        throw new Error(i18n.t("canvas.importInvalid"));
    }
    return { data, zip };
}

async function restoreMedia(zip: ArchiveEntries, source: CanvasProjectExportItem, options: { targetProjectId: string; teamProjectId?: string }, warnings: string[]) {
    const keyMap = new Map<string, string>();
    await runWithConcurrency(source.files, 4, async (item) => {
        const blob = zip.get(item.path);
        if (!blob) {
            warnings.push(i18n.t("canvas.importMissingMedia", { name: item.path }));
            return;
        }
        const prefix = item.storageKey.includes(":") ? item.storageKey.split(":", 1)[0] : "file";
        const storageKey = `${prefix}:${nanoid()}`;
        const typedBlob = new Blob([blob], { type: item.mimeType || blob.type || "application/octet-stream" });
        try {
            const uploadOptions = { projectId: options.targetProjectId, teamProjectId: options.teamProjectId };
            await (item.storageKey.startsWith("image:") ? setImageBlob(storageKey, typedBlob, uploadOptions) : setMediaBlob(storageKey, typedBlob, uploadOptions));
            keyMap.set(item.storageKey, storageKey);
        } catch (error) {
            warnings.push(i18n.t("canvas.importMediaFailed", { name: item.path, message: error instanceof Error ? error.message : String(error) }));
        }
    });
    return keyMap;
}

function remapNode(node: CanvasNodeData, nodeIdMap: Map<string, string>, storageKeyMap: Map<string, string>): CanvasNodeData {
    const metadata = rewriteMediaValues(node.metadata, storageKeyMap) as CanvasNodeMetadata | undefined;
    if (metadata) {
        metadata.groupId = metadata.groupId ? nodeIdMap.get(metadata.groupId) : undefined;
        metadata.videoTaskId = undefined;
        metadata.videoTaskProvider = undefined;
        metadata.videoProgress = undefined;
        metadata.videoProgressPhase = undefined;
        metadata.videoProgressStartedAt = undefined;
        metadata.videoExpectedMs = undefined;
        if (metadata.status === "loading") {
            metadata.status = "error";
            metadata.errorDetails = i18n.t("canvas.generation.interrupted");
        }
        if (metadata.images?.length) {
            const imageIds = new Map(metadata.images.map((image) => [image.id, nanoid()]));
            metadata.images = metadata.images.map((image) => ({ ...image, id: imageIds.get(image.id) || nanoid() }));
            metadata.primaryImageId = metadata.primaryImageId ? imageIds.get(metadata.primaryImageId) : undefined;
        }
        if (metadata.texts?.length) {
            const textIds = new Map(metadata.texts.map((text) => [text.id, nanoid()]));
            metadata.texts = metadata.texts.map((text) => ({ ...text, id: textIds.get(text.id) || nanoid() }));
            metadata.primaryTextId = metadata.primaryTextId ? textIds.get(metadata.primaryTextId) : undefined;
        }
    }
    return {
        ...node,
        id: nodeIdMap.get(node.id) || nanoid(),
        metadata,
    };
}

function rewriteMediaValues(value: unknown, storageKeyMap: Map<string, string>): unknown {
    if (typeof value === "string") {
        const direct = storageKeyMap.get(value);
        if (direct) return direct;
        if (value.startsWith("/api/files/")) {
            const encoded = value.slice("/api/files/".length);
            try {
                const key = decodeURIComponent(encoded);
                const remapped = storageKeyMap.get(key);
                if (remapped) return `/api/files/${encodeURIComponent(remapped)}`;
            } catch {
                return value;
            }
        }
        return value;
    }
    if (Array.isArray(value)) return value.map((item) => rewriteMediaValues(item, storageKeyMap));
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewriteMediaValues(item, storageKeyMap)]));
}

function offsetImportedNodes(nodes: CanvasNodeData[], currentNodes: CanvasNodeData[], viewport: ViewportTransform, viewportSize: { width: number; height: number }) {
    if (!nodes.length) return nodes;
    const importedBounds = nodeBounds(nodes);
    let target: Position;
    if (currentNodes.length) {
        const currentBounds = nodeBounds(currentNodes);
        target = { x: currentBounds.maxX + 240, y: currentBounds.minY };
    } else {
        target = {
            x: (viewportSize.width / 2 - viewport.x) / viewport.k,
            y: (viewportSize.height / 2 - viewport.y) / viewport.k,
        };
    }
    const offset = {
        x: target.x - (currentNodes.length ? importedBounds.minX : (importedBounds.minX + importedBounds.maxX) / 2),
        y: target.y - (currentNodes.length ? importedBounds.minY : (importedBounds.minY + importedBounds.maxY) / 2),
    };
    return nodes.map((node) => ({ ...node, position: { x: node.position.x + offset.x, y: node.position.y + offset.y } }));
}

function nodeBounds(nodes: CanvasNodeData[]) {
    return nodes.reduce(
        (bounds, node) => ({
            minX: Math.min(bounds.minX, node.position.x),
            minY: Math.min(bounds.minY, node.position.y),
            maxX: Math.max(bounds.maxX, node.position.x + node.width),
            maxY: Math.max(bounds.maxY, node.position.y + node.height),
        }),
        { minX: Number.POSITIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY },
    );
}

async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
    let index = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (index < items.length) {
            const item = items[index++];
            await worker(item);
        }
    });
    await Promise.all(workers);
}
