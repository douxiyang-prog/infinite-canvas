import { create } from "zustand";

type CgtwSubmitStore = {
    /** 只有 CGTW 画布页挂载时才为 true，原生右键菜单据此决定是否显示“提交到 CGTW”。 */
    enabled: boolean;
    nodeId: string | null;
    setEnabled: (enabled: boolean) => void;
    open: (nodeId: string) => void;
    close: () => void;
};

export const useCgtwSubmitStore = create<CgtwSubmitStore>((set) => ({
    enabled: false,
    nodeId: null,
    setEnabled: (enabled) => set({ enabled, nodeId: null }),
    open: (nodeId) => set({ nodeId }),
    close: () => set({ nodeId: null }),
}));
