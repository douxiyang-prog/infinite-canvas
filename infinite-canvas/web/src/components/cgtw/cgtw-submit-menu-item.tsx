import { useParams } from "react-router-dom";
import { Send } from "lucide-react";

import { findCanvasNode, submitMediaOf } from "@/components/cgtw/cgtw-submit-node";
import { canvasThemes } from "@/lib/canvas-theme";
import { useCgtwSubmitStore } from "@/stores/use-cgtw-submit-store";
import { useThemeStore } from "@/stores/use-theme-store";

/** 原生节点右键菜单里的“提交到 CGTW”：仅在 CGTW 画布页、且右键的是图片/视频节点时出现。 */
export function CgtwSubmitMenuItem({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
    const { id } = useParams<{ id: string }>();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const enabled = useCgtwSubmitStore((state) => state.enabled);
    if (!enabled || !submitMediaOf(findCanvasNode(id, nodeId))) return null;
    return (
        <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:opacity-80"
            style={{ color: theme.node.text }}
            onClick={() => {
                useCgtwSubmitStore.getState().open(nodeId);
                onClose();
            }}
        >
            <Send className="size-4" />
            <span>提交到 CGTW</span>
        </button>
    );
}
