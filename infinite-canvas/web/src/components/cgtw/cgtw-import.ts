import { cgtwFileUrl, type CgtwFileEntry, type CgtwSubmitKind } from "@/services/api/cgtw";

export const CGTW_CANVAS_SELECTOR = "[data-cgtw-canvas]";

/**
 * 把 Agent 提供的文件交给原生画布：模拟一次“把文件拖进画布”的 drop 事件，
 * 原生画布的 handleDrop 会像处理本机拖入的文件一样创建图片/视频节点，所以不需要改原生代码。
 * 没有指定落点（或落点不在画布上）时放在画布中央。
 */
export async function importCgtwFileToCanvas(db: string, taskId: string, kind: CgtwSubmitKind, entry: CgtwFileEntry, point?: { x: number; y: number }) {
    const canvas = document.querySelector<HTMLElement>(CGTW_CANVAS_SELECTOR);
    if (!canvas) throw new Error("没有找到画布");
    const response = await fetch(cgtwFileUrl(db, taskId, kind, entry.name));
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || "读取文件失败");
    const blob = await response.blob();
    // .mov 在 Agent 里转成了 mp4 预览，文件名跟着改，原生画布才会按视频处理
    const name = entry.name.replace(/\.mov$/i, ".mp4");
    const file = new File([blob], name, { type: blob.type || (entry.importKind === "video" ? "video/mp4" : "image/png") });

    const rect = canvas.getBoundingClientRect();
    const inside = point && point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
    const x = inside ? point.x : rect.left + rect.width / 2;
    const y = inside ? point.y : rect.top + rect.height / 2;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    (document.elementFromPoint(x, y) ?? canvas).dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: transfer }));
}
