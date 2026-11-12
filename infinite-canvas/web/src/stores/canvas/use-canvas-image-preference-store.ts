import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { modelMatchesCapability, useEffectiveConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

type ImagePreference = { model?: string; size?: string; count?: string };

type CanvasImagePreferenceStore = {
    byUser: Record<number, ImagePreference>;
    setPreference: (userId: number, patch: ImagePreference) => void;
};

export const useCanvasImagePreferenceStore = create<CanvasImagePreferenceStore>()(
    persist(
        (set) => ({
            byUser: {},
            setPreference: (userId, patch) => set((state) => ({ byUser: { ...state.byUser, [userId]: { ...state.byUser[userId], ...patch } } })),
        }),
        { name: "infinite-canvas:canvas_image_preference" },
    ),
);

/** Effective config with the current user's last used canvas image settings applied. */
export function useCanvasEffectiveConfig() {
    const config = useEffectiveConfig();
    const userId = useUserStore((state) => state.user?.id);
    const preference = useCanvasImagePreferenceStore((state) => (userId ? state.byUser[userId] : undefined));
    return useMemo(() => {
        if (!preference) return config;
        const model = preference.model && modelMatchesCapability(config, preference.model, "image") ? preference.model : config.imageModel;
        return { ...config, imageModel: model, size: preference.size || config.size, canvasImageCount: preference.count || config.canvasImageCount };
    }, [config, preference]);
}
