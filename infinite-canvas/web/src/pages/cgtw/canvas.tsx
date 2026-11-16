import { useEffect } from "react";

import { CgtwPanel } from "@/components/cgtw/cgtw-panel";
import { CgtwSubmitDialog } from "@/components/cgtw/cgtw-submit-dialog";
import CanvasProjectPage from "@/pages/canvas/project";
import { useCgtwSubmitStore } from "@/stores/use-cgtw-submit-store";

/** 直接复用原生画布编辑器（节点、AI 生成、Agent、导入导出都一致），左边加 CGTW 面板，并开启节点右键“提交到 CGTW”。 */
export default function CgtwCanvasPage() {
    useEffect(() => {
        useCgtwSubmitStore.getState().setEnabled(true);
        return () => useCgtwSubmitStore.getState().setEnabled(false);
    }, []);
    return (
        <div className="flex h-full">
            <CgtwPanel />
            <div className="min-w-0 flex-1" data-cgtw-canvas>
                <CanvasProjectPage />
            </div>
            <CgtwSubmitDialog />
        </div>
    );
}
