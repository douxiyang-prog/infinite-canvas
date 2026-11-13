import { defaultConfig, resolveModelForCapability, type AiConfig } from "@/stores/use-config-store";
import i18n from "@/i18n";
import { ensureImagePreview, resolveImageUrl, uploadImage } from "@/services/image-storage";
import { resolveMediaUrl } from "@/services/file-storage";
import { imageMetadata, referenceUrl } from "@/lib/canvas/canvas-node-factory";
import type { NodeGenerationInput } from "@/components/canvas/canvas-node-generation";
import type { CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import type { CanvasImageAngleParams } from "@/components/canvas/canvas-node-angle-dialog";
import type { ReferenceImage } from "@/types/image";
import { CanvasNodeType, type CanvasAssistantSession, type CanvasConnection, type CanvasImageRelightParams, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";

export function imageExtension(dataUrl: string) {
    return dataUrl.match(/^data:image[/]([^;]+)/)?.[1] || dataUrl.match(/image[/]([^;]+)/)?.[1] || "png";
}

export function audioExtension(mimeType?: string) {
    if (mimeType?.includes("wav")) return "wav";
    if (mimeType?.includes("opus")) return "opus";
    if (mimeType?.includes("aac")) return "aac";
    if (mimeType?.includes("flac")) return "flac";
    if (mimeType?.includes("pcm")) return "pcm";
    return "mp3";
}

export function generationReferenceUrls(context: { referenceImages: ReferenceImage[]; referenceVideos: Array<{ storageKey?: string; url?: string }>; referenceAudios?: Array<{ storageKey?: string; url?: string }> }) {
    return [
        ...context.referenceImages.map(referenceUrl).filter((url): url is string => Boolean(url)),
        ...context.referenceVideos.map((video) => video.storageKey || video.url).filter((url): url is string => Boolean(url)),
        ...(context.referenceAudios || []).map((audio) => audio.storageKey || audio.url).filter((url): url is string => Boolean(url)),
    ];
}

export async function resolveMetadataReferences(metadata: CanvasNodeMetadata) {
    if (metadata.generationType !== "edit") return [];
    if (!metadata.references?.length) return null;
    const references = await Promise.all(
        metadata.references.map(async (url, index) => {
            const dataUrl = url.startsWith("image:") ? await resolveImageUrl(url, "") : url;
            return dataUrl ? { id: `${index}`, name: `reference-${index}.png`, type: "image/png", dataUrl, storageKey: url.startsWith("image:") ? url : undefined } : null;
        }),
    );
    return references.every(Boolean) ? (references as ReferenceImage[]) : null;
}

export async function hydrateCanvasImages(nodes: CanvasNodeData[]) {
    return Promise.all(
        nodes.map(async (node) => {
            const metadata = node.metadata;
            const content = metadata?.content;
            if ((node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio) && metadata?.storageKey) return { ...node, metadata: { ...metadata, content: await resolveMediaUrl(metadata.storageKey, content) } };
            if (node.type !== CanvasNodeType.Image || !metadata || !content) return node;
            const images = await Promise.all(
                (metadata.images || []).map(async (image) => {
                    if (!image.content) return image;
                    void ensureImagePreview(image.storageKey);
                    return { ...image, content: await resolveImageUrl(image.storageKey, image.content) };
                }),
            );
            if (metadata.storageKey) {
                void ensureImagePreview(metadata.storageKey);
                return { ...node, metadata: { ...metadata, content: await resolveImageUrl(metadata.storageKey, content), images } };
            }
            if (!content.startsWith("data:image/")) return node;
            return { ...node, metadata: { ...metadata, ...imageMetadata(await uploadImage(content)) } };
        }),
    );
}

export async function hydrateAssistantImages(sessions: CanvasAssistantSession[]) {
    const hydrateItem = async <T extends { dataUrl?: string; storageKey?: string }>(item: T) => {
        if (item.storageKey) return { ...item, dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl) };
        if (item.dataUrl?.startsWith("data:image/")) {
            const image = await uploadImage(item.dataUrl);
            return { ...item, dataUrl: image.url, storageKey: image.storageKey };
        }
        return item;
    };
    return Promise.all(
        sessions.map(async (session) => ({
            ...session,
            messages: await Promise.all(
                session.messages.map(async (message) => ({
                    ...message,
                    references: await Promise.all((message.references || []).map(hydrateItem)),
                })),
            ),
        })),
    );
}

export function getGenerationCount(count: string) {
    return Math.max(1, Math.min(15, Math.floor(Math.abs(Number(count)) || 1)));
}

export function getInputSummary(inputs: NodeGenerationInput[]) {
    const resources = [...new Map(inputs.flatMap((input) => (input.type === "group" ? input.children : [input])).map((input) => [input.nodeId, input])).values()];
    return {
        textCount: resources.filter((input) => input.type === "text").length,
        imageCount: resources.filter((input) => input.type === "image").length,
        videoCount: resources.filter((input) => input.type === "video").length,
        audioCount: resources.filter((input) => input.type === "audio").length,
    };
}

export function buildGenerationConfig(config: AiConfig, node: CanvasNodeData | undefined, mode: CanvasNodeGenerationMode): AiConfig {
    return {
        ...config,
        model: resolveModelForCapability(config, node?.metadata?.model, mode),
        reasoningEffort: node?.metadata?.reasoningEffort || config.reasoningEffort || defaultConfig.reasoningEffort,
        quality: node?.metadata?.quality || config.quality || defaultConfig.quality,
        size: node?.metadata?.size || config.size || defaultConfig.size,
        background: node?.metadata?.background ?? config.background ?? defaultConfig.background,
        videoSeconds: node?.metadata?.seconds || config.videoSeconds || defaultConfig.videoSeconds,
        videoDurationMode: node?.metadata?.videoDurationMode || config.videoDurationMode || defaultConfig.videoDurationMode,
        vquality: node?.metadata?.vquality || config.vquality || defaultConfig.vquality,
        videoGenerateAudio: node?.metadata?.generateAudio || config.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: node?.metadata?.watermark || config.videoWatermark || defaultConfig.videoWatermark,
        videoMode: node?.metadata?.videoMode || config.videoMode || defaultConfig.videoMode,
        audioVoice: node?.metadata?.audioVoice || config.audioVoice || defaultConfig.audioVoice,
        audioFormat: node?.metadata?.audioFormat || config.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node?.metadata?.audioSpeed || config.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node?.metadata?.audioInstructions || config.audioInstructions || defaultConfig.audioInstructions,
        count: String(node?.metadata?.count || (mode === "image" ? config.canvasImageCount || config.count : config.count) || defaultConfig.count),
    };
}

export function hasResumableVideoTask(node: CanvasNodeData) {
    return node.type === CanvasNodeType.Video && Boolean(node.metadata?.videoTaskId) && !node.metadata?.content;
}

export function resetInterruptedGeneration(nodes: CanvasNodeData[]) {
    return nodes.map((node) =>
        node.metadata?.status === "loading"
            ? hasResumableVideoTask(node)
                ? node
                : {
                      ...node,
                      metadata: {
                          ...node.metadata,
                          status: "error" as const,
                          errorDetails: i18n.t("canvas.generation.interrupted"),
                          images: node.metadata.images?.map((image) => (image.status === "loading" ? { ...image, status: "error" as const, errorDetails: i18n.t("canvas.generation.interrupted") } : image)),
                          texts: node.metadata.texts?.map((text) => (text.status === "loading" ? { ...text, status: "error" as const, errorDetails: i18n.t("canvas.generation.interrupted") } : text)),
                      },
                  }
            : node,
    );
}

export function isGenerationCanceled(error: unknown) {
    return error instanceof Error && (error.message === i18n.t("common.requestCanceled") || error.name === "AbortError");
}

export function findRetrySourceNode(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const queue = connections.filter((connection) => connection.toNodeId === nodeId).map((connection) => connection.fromNodeId);
    const visited = new Set<string>();
    while (queue.length) {
        const id = queue.shift()!;
        if (visited.has(id)) continue;
        visited.add(id);
        const node = nodes.find((item) => item.id === id);
        if (node?.type === CanvasNodeType.Config) return node;
        connections.filter((connection) => connection.toNodeId === id).forEach((connection) => queue.push(connection.fromNodeId));
    }
    return null;
}

export function sourceNodeReferenceImages(node: CanvasNodeData | null) {
    if (!node || node.type !== CanvasNodeType.Image || !node.metadata?.content) return [];
    return [
        {
            id: node.id,
            name: `${node.title || node.id}.png`,
            type: node.metadata.mimeType || "image/png",
            dataUrl: node.metadata.content,
            storageKey: node.metadata.storageKey,
        },
    ];
}

export function isAudioFile(file: File) {
    return file.type.startsWith("audio/") || /\.(mp3|wav)$/i.test(file.name);
}

export function buildAngleLabel(params: CanvasImageAngleParams) {
    const horizontal = params.horizontalAngle === 0 ? i18n.t("canvas.generation.front") : params.horizontalAngle > 0 ? i18n.t("canvas.generation.rotateRight", { angle: params.horizontalAngle }) : i18n.t("canvas.generation.rotateLeft", { angle: Math.abs(params.horizontalAngle) });
    const pitch = params.pitchAngle === 0 ? i18n.t("canvas.generation.level") : params.pitchAngle > 0 ? i18n.t("canvas.generation.topDown", { angle: params.pitchAngle }) : i18n.t("canvas.generation.lowAngle", { angle: Math.abs(params.pitchAngle) });
    return i18n.t("canvas.generation.angleLabel", { horizontal, pitch, distance: params.cameraDistance.toFixed(1), lens: i18n.t(params.wideAngle ? "canvas.editors.wide" : "canvas.editors.standard") });
}

export function buildAnglePrompt(params: CanvasImageAngleParams) {
    return i18n.t("canvas.generation.anglePrompt", { angle: buildAngleLabel(params) });
}

export function buildRelightLabel(params: CanvasImageRelightParams) {
    const direction = relightDirectionKey(params);
    return i18n.t("canvas.generation.relightLabel", {
        direction: i18n.t(`canvas.editors.relightPosition_${direction}`),
        brightness: params.brightness,
        temperature: params.temperature,
    });
}

export function buildRelightPrompt(params: CanvasImageRelightParams) {
    const horizontal = params.lightX < -0.18 ? "left" : params.lightX > 0.18 ? "right" : "center";
    const vertical = params.lightY < -0.18 ? "bottom" : params.lightY > 0.18 ? "top" : "middle";
    const depth = params.lightZ < -0.2 ? "back" : params.lightZ > 0.2 ? "front" : "center";
    const cues = [
        params.lightY < -0.18 ? i18n.t("canvas.generation.relightCueBelow") : params.lightY > 0.18 ? i18n.t("canvas.generation.relightCueAbove") : "",
        params.lightX < -0.18 ? i18n.t("canvas.generation.relightCueLeft") : params.lightX > 0.18 ? i18n.t("canvas.generation.relightCueRight") : "",
        params.lightZ < -0.2 ? i18n.t("canvas.generation.relightCueBack") : params.lightZ > 0.2 ? i18n.t("canvas.generation.relightCueFront") : "",
    ].filter(Boolean);
    const lightingCue = cues.length ? cues.join(" ") : i18n.t("canvas.generation.relightCueLevel");
    return i18n.t("canvas.generation.relightPrompt", {
        lightPosition: i18n.t("canvas.generation.relightPositionNatural", {
            horizontal: i18n.t(`canvas.generation.relightHorizontal_${horizontal}`),
            vertical: i18n.t(`canvas.generation.relightVertical_${vertical}`),
            depth: i18n.t(`canvas.generation.relightDepth_${depth}`),
        }),
        lightingCue,
        brightness: params.brightness,
        temperature: params.temperature,
        shadow: i18n.t(params.softness < 34 ? "canvas.generation.relightShadowHard" : params.softness > 66 ? "canvas.generation.relightShadowSoft" : "canvas.generation.relightShadowBalanced"),
        rim: i18n.t(params.rimLight ? "canvas.generation.relightRimOn" : "canvas.generation.relightRimOff"),
    });
}

function relightDirectionKey(params: CanvasImageRelightParams) {
    if (params.lightY > 0.56) return "top";
    if (params.lightY < -0.56) return "bottom";
    if (params.lightZ < -0.35) return "back";
    if (params.lightX < -0.48) return "left";
    if (params.lightX > 0.48) return "right";
    return "front";
}
