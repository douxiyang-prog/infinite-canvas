import { ArrowLeft, Eye, EyeOff, FolderKanban, Images, Pencil, Plus, Trash2, Upload, UsersRound } from "lucide-react";
import { useRef, useState } from "react";
import { App, Button, Input, Popconfirm } from "antd";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { CanvasProjectCard } from "@/components/canvas/canvas-project-card";
import { CanvasDeleteProjectsDialog } from "@/components/canvas/canvas-delete-projects-dialog";
import { importCanvasArchive } from "@/lib/canvas/canvas-import";
import { deleteAdminTeamProjectScene, updateAdminTeamProjectScene } from "@/services/api/team-projects";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useUserStore } from "@/stores/use-user-store";
import type { TeamProject, TeamProjectScene } from "@/types/team-project";

type ImportTarget = {
    teamProject: TeamProject;
    sceneId: string | null;
};

export default function ProjectDetailPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const { projectId = "" } = useParams<{ projectId: string }>();
    const navigate = useNavigate();
    const importInputRef = useRef<HTMLInputElement>(null);
    const [importTarget, setImportTarget] = useState<ImportTarget | null>(null);
    const [expandedSceneIds, setExpandedSceneIds] = useState<Set<string>>(() => new Set());
    const hydrated = useCanvasStore((state) => state.hydrated);
    const teamProject = useCanvasStore((state) => state.teamProjects.find((project) => project.id === projectId));
    const allProjects = useCanvasStore((state) => state.projects);
    const projects = allProjects.filter((project) => project.scope === "project" && project.teamProjectId === projectId);
    const createProject = useCanvasStore((state) => state.createProject);
    const importProject = useCanvasStore((state) => state.importProject);
    const refreshProjects = useCanvasStore((state) => state.refreshProjects);
    const isAdmin = useUserStore((state) => state.user?.role === "admin");

    const createCanvas = (sceneId: string | null = null) => {
        if (!teamProject) return;
        const count = projects.filter((project) => (project.sceneId || null) === sceneId).length + 1;
        const id = createProject(t("canvas.defaultTitle", { count }), teamProject, sceneId);
        navigate(`/canvas/${id}?teamProjectId=${encodeURIComponent(teamProject.id)}`);
    };

    const selectImportTarget = (sceneId: string | null = null) => {
        if (!teamProject) return;
        setImportTarget({ teamProject, sceneId });
        importInputRef.current?.click();
    };

    const importCanvas = async (file?: File) => {
        if (!file || !importTarget) return;
        try {
            const result = await importCanvasArchive(file, importProject, importTarget.teamProject, importTarget.sceneId);
            message.success(t("projectPage.imported", { project: importTarget.teamProject.title, count: result.count }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("projectPage.importFailed"));
        } finally {
            if (importInputRef.current) importInputRef.current.value = "";
            setImportTarget(null);
        }
    };

    const updateScene = async (scene: TeamProjectScene, patch: { title?: string; hidden?: boolean }) => {
        try {
            await updateAdminTeamProjectScene(scene.id, patch);
            await refreshProjects();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("projectPage.sceneUpdateFailed"));
        }
    };

    const deleteScene = async (scene: TeamProjectScene) => {
        try {
            await deleteAdminTeamProjectScene(scene.id);
            await refreshProjects();
            message.success(t("projectPage.sceneDeleted", { title: scene.title }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("projectPage.sceneDeleteFailed"));
        }
    };

    if (!hydrated) {
        return <main className="grid h-full place-items-center text-sm text-stone-500">正在加载项目...</main>;
    }

    if (!teamProject) {
        return (
            <main className="grid h-full place-items-center bg-background px-6 text-center text-stone-950 dark:text-stone-100">
                <div>
                    <FolderKanban className="mx-auto size-10 text-stone-400" />
                    <h1 className="mt-4 text-xl font-semibold">项目不存在或无权访问</h1>
                    <Button className="mt-5" icon={<ArrowLeft className="size-4" />} onClick={() => navigate("/projects")}>
                        返回项目列表
                    </Button>
                </div>
            </main>
        );
    }

    const ungrouped = projects.filter((project) => !project.sceneId);

    return (
        <main className="h-full overflow-y-auto bg-background text-stone-950 dark:text-stone-100">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-8">
                <div>
                    <Button type="text" icon={<ArrowLeft className="size-4" />} onClick={() => navigate("/projects")}>
                        返回项目列表
                    </Button>
                </div>
                <header className="border-b border-stone-200 pb-6 dark:border-stone-800">
                    <h1 className="flex items-center gap-2 text-3xl font-semibold">
                        <FolderKanban className="size-7" />
                        {teamProject.title}
                    </h1>
                    <p className="mt-2 text-sm text-stone-500">{teamProject.description || "暂无项目描述"}</p>
                    <p className="mt-2 flex items-center gap-1.5 text-xs text-stone-400">
                        <UsersRound className="size-3.5" />
                        {teamProject.members.map((member) => member.displayName).join("、") || "暂无成员"}
                    </p>
                    <div className="mt-5 flex flex-wrap gap-2">
                        <Button icon={<Images className="size-4" />} onClick={() => navigate(`/projects/${encodeURIComponent(teamProject.id)}/assets`)}>
                            项目资产
                        </Button>
                        <Button icon={<Upload className="size-4" />} onClick={() => selectImportTarget()}>
                            {t("projectPage.importCanvas")}
                        </Button>
                        <Button type="primary" icon={<Plus className="size-4" />} onClick={() => createCanvas()}>
                            {t("projectPage.newCanvas")}
                        </Button>
                    </div>
                </header>

                {ungrouped.length ? (
                    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                        {ungrouped.map((project) => (
                            <CanvasProjectCard key={project.id} project={project} selectable={false} />
                        ))}
                    </div>
                ) : (
                    <div className="flex min-h-28 items-center justify-center rounded-xl border border-dashed border-stone-200 text-sm text-stone-500 dark:border-stone-800">
                        当前项目还没有无场次画布
                    </div>
                )}

                {teamProject.scenes.map((scene) => {
                    const canvases = projects.filter((project) => project.sceneId === scene.id);
                    const expanded = expandedSceneIds.has(scene.id);
                    return (
                        <section key={scene.id}>
                            <SceneDivider
                                scene={scene}
                                canvasCount={canvases.length}
                                isAdmin={isAdmin}
                                expanded={expanded}
                                onRename={(title) => updateScene(scene, { title })}
                                onToggleExpanded={() =>
                                    setExpandedSceneIds((current) => {
                                        const next = new Set(current);
                                        if (next.has(scene.id)) next.delete(scene.id);
                                        else next.add(scene.id);
                                        return next;
                                    })
                                }
                                onDelete={() => deleteScene(scene)}
                                onImport={() => selectImportTarget(scene.id)}
                                onCreate={() => createCanvas(scene.id)}
                            />
                            {expanded && canvases.length ? (
                                <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                                    {canvases.map((project) => (
                                        <CanvasProjectCard key={project.id} project={project} selectable={false} />
                                    ))}
                                </div>
                            ) : expanded ? (
                                <div className="flex min-h-28 items-center justify-center rounded-xl border border-dashed border-stone-200 text-sm text-stone-500 dark:border-stone-800">
                                    这个场次还没有画布
                                </div>
                            ) : null}
                        </section>
                    );
                })}
            </div>
            <input ref={importInputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importCanvas(event.target.files?.[0])} />
            <CanvasDeleteProjectsDialog />
        </main>
    );
}

function SceneDivider({ scene, canvasCount, isAdmin, expanded, onRename, onToggleExpanded, onDelete, onImport, onCreate }: {
    scene: TeamProjectScene;
    canvasCount: number;
    isAdmin: boolean;
    expanded: boolean;
    onRename: (title: string) => void;
    onToggleExpanded: () => void;
    onDelete: () => void;
    onImport: () => void;
    onCreate: () => void;
}) {
    const { t } = useTranslation();
    const [editing, setEditing] = useState(false);
    const [title, setTitle] = useState(scene.title);
    const finishEditing = () => {
        const value = title.trim();
        setEditing(false);
        if (value && value !== scene.title) onRename(value);
        else setTitle(scene.title);
    };
    return (
        <div className="mt-2 mb-4 flex flex-wrap items-center gap-2">
            <span className="h-px min-w-8 flex-1 bg-stone-200 dark:bg-stone-800" />
            {editing ? (
                <Input autoFocus size="small" value={title} className="w-40" onChange={(event) => setTitle(event.target.value)} onBlur={finishEditing} onPressEnter={finishEditing} />
            ) : (
                <h3 className="text-lg font-semibold">{scene.title}</h3>
            )}
            <span className="text-xs text-stone-500">{t("projectPage.sceneCanvasCount", { count: canvasCount })}</span>
            {isAdmin ? (
                <>
                    <Button size="small" type="text" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(true)}>
                        {t("projectPage.renameScene")}
                    </Button>
                    <Popconfirm title={t("projectPage.deleteSceneTitle", { title: scene.title })} description={t("projectPage.deleteSceneDescription")} okText={t("projectPage.deleteScene")} cancelText={t("common.cancel")} onConfirm={onDelete}>
                        <Button size="small" type="text" danger icon={<Trash2 className="size-3.5" />}>
                            {t("projectPage.deleteScene")}
                        </Button>
                    </Popconfirm>
                </>
            ) : null}
            <Button size="small" type="text" icon={expanded ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />} onClick={onToggleExpanded}>
                {t(expanded ? "projectPage.collapseScene" : "projectPage.expandScene")}
            </Button>
            <Button size="small" type="text" icon={<Upload className="size-3.5" />} onClick={onImport}>
                {t("projectPage.importCanvas")}
            </Button>
            <Button size="small" type="text" icon={<Plus className="size-3.5" />} onClick={onCreate}>
                {t("projectPage.newCanvas")}
            </Button>
            <span className="h-px min-w-8 flex-1 bg-stone-200 dark:bg-stone-800" />
        </div>
    );
}
