import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export type SubmitMedia = { kind: "image" | "video"; url: string; title: string };

/** 取节点当前显示的图片/视频地址：多图结果优先用主图，其余用 metadata.content。 */
export function submitMediaOf(node?: CanvasNodeData | null): SubmitMedia | null {
    const metadata = node?.metadata;
    if (!node || !metadata) return null;
    if (node.type === CanvasNodeType.Video && metadata.content) return { kind: "video", url: metadata.content, title: node.title };
    if (node.type !== CanvasNodeType.Image) return null;
    const primary = metadata.images?.find((image) => image.id === metadata.primaryImageId) ?? metadata.images?.[0];
    const url = primary?.content || metadata.content;
    return url ? { kind: "image", url, title: node.title } : null;
}

export const findCanvasNode = (projectId: string | undefined, nodeId: string) => useCanvasStore.getState().projects.find((project) => project.id === projectId)?.nodes.find((node) => node.id === nodeId);

const MIME_EXT: Record<string, string> = { "video/quicktime": ".mov", "video/mp4": ".mp4", "video/x-m4v": ".m4v", "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/bmp": ".bmp", "image/tiff": ".tif" };

/** 先看 Blob 的 MIME，再看地址里的扩展名；两者都认不出时按节点类型给默认值。 */
export function extensionOf(blob: Blob, url: string, kind: "image" | "video") {
    const fromMime = MIME_EXT[blob.type.split(";")[0]];
    if (fromMime) return fromMime;
    const fromUrl = /\.([a-z0-9]{2,4})(?:[?#]|$)/i.exec(url.startsWith("data:") ? "" : url)?.[1];
    return fromUrl ? `.${fromUrl.toLowerCase()}` : kind === "video" ? ".mp4" : ".png";
}
