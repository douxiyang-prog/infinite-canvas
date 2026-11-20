import { create } from "zustand";
import { persist } from "zustand/middleware";

import { DEFAULT_PROMPT_PRESETS, createPromptPreset, type PromptPreset } from "@/services/api/prompt-presets";

const STORE_KEY = "infinite-canvas:prompt_preset_store_v1";

type PromptPresetStore = {
    presets: PromptPreset[];
    savePreset: (preset: PromptPreset) => void;
    removePreset: (id: string) => void;
    togglePreset: (id: string, enabled: boolean) => void;
    resetPreset: (id: string) => void;
    applyGlobalConfig: (presets: unknown) => void;
};

function normalizePresets(value: unknown) {
    const saved = Array.isArray(value) ? value.map((item) => createPromptPreset(item as Partial<PromptPreset>)) : [];
    const enabledById = new Map(saved.map((item) => [item.id, item.enabled]));
    const builtIn = DEFAULT_PROMPT_PRESETS.map((item) => {
        const existing = saved.find((candidate) => candidate.id === item.id);
        return existing ? { ...existing, builtIn: true, enabled: enabledById.get(item.id) ?? existing.enabled } : item;
    });
    return [...builtIn, ...saved.filter((item) => !item.builtIn && !DEFAULT_PROMPT_PRESETS.some((builtInItem) => builtInItem.id === item.id))];
}

export const usePromptPresetStore = create<PromptPresetStore>()(
    persist(
        (set) => ({
            presets: DEFAULT_PROMPT_PRESETS,
            savePreset: (preset) =>
                set((state) => ({
                    presets: state.presets.some((item) => item.id === preset.id) ? state.presets.map((item) => (item.id === preset.id ? createPromptPreset(preset) : item)) : [...state.presets, createPromptPreset(preset)],
                })),
            removePreset: (id) => set((state) => ({ presets: state.presets.filter((item) => item.id !== id || item.builtIn) })),
            togglePreset: (id, enabled) => set((state) => ({ presets: state.presets.map((item) => (item.id === id ? { ...item, enabled } : item)) })),
            resetPreset: (id) =>
                set((state) => {
                    const fallback = DEFAULT_PROMPT_PRESETS.find((item) => item.id === id);
                    return fallback ? { presets: state.presets.map((item) => (item.id === id ? fallback : item)) } : state;
                }),
            applyGlobalConfig: (presets) => set({ presets: normalizePresets(presets) }),
        }),
        {
            name: STORE_KEY,
            partialize: (state) => ({ presets: state.presets }),
            merge: (persisted, current) => ({ ...current, presets: normalizePresets((persisted as Partial<PromptPresetStore> | undefined)?.presets) }),
        },
    ),
);
