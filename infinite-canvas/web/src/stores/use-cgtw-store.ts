import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { CgtwTask } from "@/services/api/cgtw";

export type CgtwTaskFilters = { mine: boolean; eps: string; pipeline: string; status: string; q: string };

type CgtwStore = {
    db: string;
    canvasIds: string[];
    filters: CgtwTaskFilters;
    selectedTask: CgtwTask | null;
    statusColors: Record<string, string>;
    setDb: (db: string) => void;
    addCanvasIds: (ids: string[]) => void;
    removeCanvasIds: (ids: string[]) => void;
    setFilters: (filters: Partial<CgtwTaskFilters>) => void;
    selectTask: (task: CgtwTask | null) => void;
    setStatusColors: (colors: Record<string, string>) => void;
};

export const defaultCgtwFilters: CgtwTaskFilters = { mine: true, eps: "", pipeline: "", status: "", q: "" };

export const useCgtwStore = create<CgtwStore>()(
    persist(
        (set) => ({
            db: "",
            canvasIds: [],
            filters: defaultCgtwFilters,
            selectedTask: null,
            statusColors: {},
            setDb: (db) => set({ db, filters: { ...defaultCgtwFilters }, selectedTask: null }),
            addCanvasIds: (ids) => set((state) => ({ canvasIds: [...new Set([...state.canvasIds, ...ids])] })),
            removeCanvasIds: (ids) => set((state) => ({ canvasIds: state.canvasIds.filter((id) => !ids.includes(id)) })),
            setFilters: (filters) => set((state) => ({ filters: { ...state.filters, ...filters } })),
            selectTask: (selectedTask) => set({ selectedTask }),
            setStatusColors: (statusColors) => set({ statusColors }),
        }),
        { name: "infinite-canvas:cgtw_store", partialize: ({ db, canvasIds, filters }) => ({ db, canvasIds, filters }) },
    ),
);

