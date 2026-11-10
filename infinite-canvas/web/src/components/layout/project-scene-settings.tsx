import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { App, Button, Input, Popconfirm, Select } from "antd";
import { useTranslation } from "react-i18next";

import { createAdminTeamProjectScene, deleteAdminTeamProjectScene, fetchAdminTeamProjects, updateAdminTeamProjectScene } from "@/services/api/team-projects";
import type { TeamProject, TeamProjectScene } from "@/types/team-project";

export function ProjectSceneSettings() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [projects, setProjects] = useState<TeamProject[]>([]);
    const [projectId, setProjectId] = useState("");
    const [newTitle, setNewTitle] = useState("");
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);

    const selected = projects.find((project) => project.id === projectId);

    const load = async () => {
        try {
            const next = await fetchAdminTeamProjects();
            setProjects(next);
            setProjectId((current) => (next.some((project) => project.id === current) ? current : next[0]?.id || ""));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("projectPage.sceneLoadFailed"));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const replaceScene = (scene: TeamProjectScene) => {
        setProjects((current) =>
            current.map((project) =>
                project.id !== selected?.id
                    ? project
                    : {
                          ...project,
                          scenes: project.scenes
                              .map((item) => (item.id === scene.id ? scene : item))
                              .sort((left, right) => left.sortOrder - right.sortOrder),
                      },
            ),
        );
    };

    const updateScene = async (scene: TeamProjectScene, patch: { title?: string; sortOrder?: number }) => {
        setBusy(true);
        try {
            replaceScene(await updateAdminTeamProjectScene(scene.id, patch));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("projectPage.sceneUpdateFailed"));
        } finally {
            setBusy(false);
        }
    };

    const createScene = async () => {
        if (!selected) return;
        const title = newTitle.trim() || t("projectPage.sceneTitle", { count: selected.scenes.length + 1 });
        setBusy(true);
        try {
            const scene = await createAdminTeamProjectScene(selected.id, title);
            setProjects((current) => current.map((project) => (project.id === selected.id ? { ...project, scenes: [...project.scenes, scene] } : project)));
            setNewTitle("");
            message.success(t("projectPage.sceneCreated", { title }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("projectPage.sceneCreateFailed"));
        } finally {
            setBusy(false);
        }
    };

    const moveScene = async (index: number, direction: -1 | 1) => {
        if (!selected) return;
        const target = selected.scenes[index + direction];
        const scene = selected.scenes[index];
        if (!target || !scene) return;
        setBusy(true);
        try {
            const [nextScene, nextTarget] = await Promise.all([
                updateAdminTeamProjectScene(scene.id, { sortOrder: target.sortOrder }),
                updateAdminTeamProjectScene(target.id, { sortOrder: scene.sortOrder }),
            ]);
            replaceScene(nextScene);
            replaceScene(nextTarget);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("projectPage.sceneUpdateFailed"));
        } finally {
            setBusy(false);
        }
    };

    const deleteScene = async (scene: TeamProjectScene) => {
        if (!selected) return;
        setBusy(true);
        try {
            await deleteAdminTeamProjectScene(scene.id);
            setProjects((current) => current.map((project) => (project.id === selected.id ? { ...project, scenes: project.scenes.filter((item) => item.id !== scene.id) } : project)));
            message.success(t("projectPage.sceneDeleted", { title: scene.title }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("projectPage.sceneDeleteFailed"));
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className="mt-5 rounded-xl border border-stone-200 p-5 dark:border-stone-800">
            <h2 className="text-base font-medium">{t("projectPage.sceneSettings")}</h2>
            <p className="mt-1 text-sm text-stone-500">{t("projectPage.sceneSettingsDescription")}</p>
            <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                <Select value={projectId || undefined} placeholder={t("projectPage.selectProject")} options={projects.map((project) => ({ value: project.id, label: project.title }))} onChange={setProjectId} />
                <Input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder={t("projectPage.sceneNamePlaceholder")} onPressEnter={() => void createScene()} />
                <Button type="primary" icon={<Plus className="size-4" />} disabled={!selected || busy} loading={busy} onClick={() => void createScene()}>
                    {t("projectPage.newScene")}
                </Button>
            </div>
            <div className="mt-4 space-y-2">
                {loading ? <div className="text-sm text-stone-500">{t("projectPage.sceneLoading")}</div> : null}
                {!loading && !selected?.scenes.length ? <div className="text-sm text-stone-500">{t("projectPage.emptyScene")}</div> : null}
                {selected?.scenes.map((scene, index) => (
                    <SceneSettingsRow
                        key={scene.id}
                        scene={scene}
                        busy={busy}
                        canMoveUp={index > 0}
                        canMoveDown={index < selected.scenes.length - 1}
                        onMoveUp={() => void moveScene(index, -1)}
                        onMoveDown={() => void moveScene(index, 1)}
                        onRename={(title) => void updateScene(scene, { title })}
                        onDelete={() => void deleteScene(scene)}
                    />
                ))}
            </div>
        </section>
    );
}

function SceneSettingsRow({
    scene,
    busy,
    canMoveUp,
    canMoveDown,
    onMoveUp,
    onMoveDown,
    onRename,
    onDelete,
}: {
    scene: TeamProjectScene;
    busy: boolean;
    canMoveUp: boolean;
    canMoveDown: boolean;
    onMoveUp: () => void;
    onMoveDown: () => void;
    onRename: (title: string) => void;
    onDelete: () => void;
}) {
    const { t } = useTranslation();
    const [title, setTitle] = useState(scene.title);
    useEffect(() => setTitle(scene.title), [scene.title]);
    return (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-stone-200 px-3 py-2 dark:border-stone-800">
            <Input size="small" className="min-w-40 flex-1" value={title} onChange={(event) => setTitle(event.target.value)} onBlur={() => title.trim() && title.trim() !== scene.title && onRename(title.trim())} onPressEnter={() => title.trim() && title.trim() !== scene.title && onRename(title.trim())} />
            <Button size="small" type="text" disabled={busy || !canMoveUp} icon={<ArrowUp className="size-3.5" />} onClick={onMoveUp} aria-label={t("projectPage.moveSceneUp")} />
            <Button size="small" type="text" disabled={busy || !canMoveDown} icon={<ArrowDown className="size-3.5" />} onClick={onMoveDown} aria-label={t("projectPage.moveSceneDown")} />
            <Popconfirm title={t("projectPage.deleteSceneTitle", { title: scene.title })} description={t("projectPage.deleteSceneDescription")} okText={t("projectPage.deleteScene")} cancelText={t("common.cancel")} onConfirm={onDelete}>
                <Button size="small" danger disabled={busy} icon={<Trash2 className="size-3.5" />} aria-label={t("projectPage.deleteScene")} />
            </Popconfirm>
        </div>
    );
}
