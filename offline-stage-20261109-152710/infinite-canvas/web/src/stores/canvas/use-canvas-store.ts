import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import i18n from "@/i18n";
import { ApiError } from "@/services/api/auth";
import { deleteProject as deleteServerProject, fetchProjects, saveProject as saveServerProject } from "@/services/api/projects";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";
import type { TeamProject } from "@/types/team-project";

export type CanvasScope = "personal" | "project";

export type CanvasProject = {
    id: string;
    title: string;
    scope: CanvasScope;
    teamProjectId: string | null;
    teamProjectTitle: string | null;
    ownerDisplayName: string | null;
    createdAt: string;
    updatedAt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
};

export type CanvasDeletedProject = {
    id: string;
    deletedAt: string;
};

type CanvasStore = {
    hydrated: boolean;
    projects: CanvasProject[];
    teamProjects: TeamProject[];
    deletedProjects: CanvasDeletedProject[];
    createProject: (title?: string, teamProject?: Pick<TeamProject, "id" | "title">) => string;
    importProject: (project: Partial<CanvasProject>) => string;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => void;
    deleteProjects: (ids: string[]) => void;
    refreshProjects: () => Promise<void>;
    replaceProjects: (projects: CanvasProject[], deletedProjects?: CanvasDeletedProject[], teamProjects?: TeamProject[]) => void;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">>) => void;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
const CANVAS_STORE_KEY = "infinite-canvas:canvas_store";
type PersistedCanvasState = Pick<CanvasStore, "projects" | "deletedProjects">;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastPersistedState: PersistedCanvasState | null = null;
let persistQueue: Promise<void> = Promise.resolve();
let persistenceEnabled = false;
const projectVersions = new Map<string, number>();

function reportStorageError(error: unknown) {
    window.dispatchEvent(new CustomEvent("canvas-storage-error", { detail: error instanceof Error ? error.message : String(error) }));
}

function reportStorageConflict(projectId: string, error: unknown) {
    window.dispatchEvent(new CustomEvent("canvas-storage-conflict", { detail: { projectId, message: error instanceof Error ? error.message : String(error) } }));
}

async function persistProjectChanges(previous: PersistedCanvasState, next: PersistedCanvasState) {
    const previousById = new Map(previous.projects.map((project) => [project.id, project]));
    const nextIds = new Set(next.projects.map((project) => project.id));
    for (const project of next.projects) {
        if (previousById.get(project.id) === project) continue;
        try {
            const result = await saveServerProject(project, projectVersions.get(project.id) || 0);
            projectVersions.set(project.id, result.version);
        } catch (error) {
            if (error instanceof ApiError && error.status === 409) reportStorageConflict(project.id, error);
            throw error;
        }
    }
    for (const project of previous.projects) {
        if (nextIds.has(project.id)) continue;
        try {
            await deleteServerProject(project.id, projectVersions.get(project.id) || 0);
            projectVersions.delete(project.id);
        } catch (error) {
            if (error instanceof ApiError && error.status === 409) reportStorageConflict(project.id, error);
            throw error;
        }
    }
}

const canvasStorage: PersistStorage<CanvasStore> = {
    getItem: async () => {
        try {
            const data = await fetchProjects();
            projectVersions.clear();
            for (const [id, version] of Object.entries(data.versions)) projectVersions.set(id, Number(version));
            const state = { projects: data.projects, deletedProjects: [] } as PersistedCanvasState;
            useCanvasStore.setState({ teamProjects: data.teamProjects || [] });
            lastPersistedState = state;
            return { state, version: 0 } as StorageValue<CanvasStore>;
        } catch (error) {
            reportStorageError(error);
            throw error;
        }
    },
    setItem: (_name, value) => {
        if (!persistenceEnabled) return;
        const nextState = value.state as PersistedCanvasState;
        if (lastPersistedState && lastPersistedState.projects === nextState.projects && lastPersistedState.deletedProjects === nextState.deletedProjects) return;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            saveTimer = null;
            const snapshot = nextState;
            persistQueue = persistQueue
                .then(async () => {
                    const previous = lastPersistedState || { projects: [], deletedProjects: [] };
                    await persistProjectChanges(previous, snapshot);
                    lastPersistedState = snapshot;
                })
                .catch((error) => {
                    if (!(error instanceof ApiError && error.status === 409)) reportStorageError(error);
                });
        }, 400);
    },
    removeItem: async () => undefined,
};

export function prepareCanvasStoreForSession() {
    persistenceEnabled = false;
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
    lastPersistedState = null;
    projectVersions.clear();
    useCanvasStore.setState({ hydrated: false, projects: [], teamProjects: [], deletedProjects: [] });
}

export const useCanvasStore = create<CanvasStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            projects: [],
            teamProjects: [],
            deletedProjects: [],
            createProject: (title = i18n.t("canvas.project.untitled"), teamProject) => {
                const now = new Date().toISOString();
                const id = nanoid();
                const project: CanvasProject = {
                    id,
                    title,
                    scope: teamProject ? "project" : "personal",
                    teamProjectId: teamProject?.id || null,
                    teamProjectTitle: teamProject?.title || null,
                    ownerDisplayName: null,
                    createdAt: now,
                    updatedAt: now,
                    nodes: [],
                    connections: [],
                    chatSessions: [],
                    activeChatId: null,
                    backgroundMode: "lines",
                    showImageInfo: false,
                    viewport: initialViewport,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                return id;
            },
            importProject: (source) => {
                const now = new Date().toISOString();
                const project: CanvasProject = {
                    id: nanoid(),
                    title: source.title || i18n.t("canvas.project.imported"),
                    scope: "personal",
                    teamProjectId: null,
                    teamProjectTitle: null,
                    ownerDisplayName: null,
                    createdAt: source.createdAt || now,
                    updatedAt: now,
                    nodes: source.nodes || [],
                    connections: source.connections || [],
                    chatSessions: source.chatSessions || [],
                    activeChatId: source.activeChatId || null,
                    backgroundMode: source.backgroundMode || "lines",
                    showImageInfo: source.showImageInfo || false,
                    viewport: source.viewport || initialViewport,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                return project.id;
            },
            openProject: (id) => {
                return get().projects.find((item) => item.id === id) || null;
            },
            renameProject: (id, title) =>
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, title: title.trim() || project.title, updatedAt: new Date().toISOString() } : project)),
                })),
            deleteProjects: (ids) =>
                set((state) => {
                    const now = new Date().toISOString();
                    const removing = new Set(ids);
                    const projects = state.projects.filter((project) => !removing.has(project.id));
                    const deletedProjects = [...state.deletedProjects.filter((item) => !removing.has(item.id)), ...ids.map((id) => ({ id, deletedAt: now }))];
                    return { projects, deletedProjects };
                }),
            refreshProjects: async () => {
                const data = await fetchProjects();
                projectVersions.clear();
                for (const [id, version] of Object.entries(data.versions)) projectVersions.set(id, Number(version));
                lastPersistedState = { projects: data.projects, deletedProjects: [] };
                set({ projects: data.projects, teamProjects: data.teamProjects || [], deletedProjects: [] });
            },
            replaceProjects: (projects, deletedProjects = [], teamProjects) => set((state) => ({ projects, deletedProjects, teamProjects: teamProjects ?? state.teamProjects })),
            updateProject: (id, patch) =>
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, ...patch, updatedAt: new Date().toISOString() } : project)),
                })),
        }),
        {
            name: CANVAS_STORE_KEY,
            storage: canvasStorage,
            partialize: (state) =>
                ({
                    projects: state.projects,
                    deletedProjects: state.deletedProjects,
                }) as StorageValue<CanvasStore>["state"],
            onRehydrateStorage: () => (_state, error) => {
                persistenceEnabled = !error;
                useCanvasStore.setState({ hydrated: true });
            },
            skipHydration: true,
        },
    ),
);
