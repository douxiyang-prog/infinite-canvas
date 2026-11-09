import { FolderKanban, Plus, UsersRound } from "lucide-react";
import { Button } from "antd";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { CanvasProjectCard } from "@/components/canvas/canvas-project-card";
import { CanvasDeleteProjectsDialog } from "@/components/canvas/canvas-delete-projects-dialog";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";

export default function ProjectsPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const hydrated = useCanvasStore((state) => state.hydrated);
    const allProjects = useCanvasStore((state) => state.projects);
    const projects = allProjects.filter((project) => project.scope === "project");
    const teamProjects = useCanvasStore((state) => state.teamProjects);
    const createProject = useCanvasStore((state) => state.createProject);

    const createCanvas = (teamProject: (typeof teamProjects)[number]) => {
        const count = projects.filter((project) => project.teamProjectId === teamProject.id).length + 1;
        const id = createProject(t("canvas.defaultTitle", { count }), teamProject);
        navigate(`/canvas/${id}?teamProjectId=${encodeURIComponent(teamProject.id)}`);
    };

    return (
        <main className="h-full overflow-y-auto bg-background text-stone-950 dark:text-stone-100">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
                <header className="border-b border-stone-200 pb-6 dark:border-stone-800">
                    <p className="text-xs text-stone-500">团队协作空间</p>
                    <h1 className="mt-3 flex items-center gap-2 text-3xl font-semibold">
                        <FolderKanban className="size-7" />
                        {t("navigation.projects")}
                    </h1>
                    <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-500">这里只显示管理员分配给你的项目。项目画布仅对当前项目成员可见，不会和个人画布混在一起。</p>
                </header>

                {!hydrated ? (
                    <section className="flex min-h-[360px] items-center justify-center border-y border-stone-200 text-sm text-stone-500 dark:border-stone-800">正在加载项目...</section>
                ) : teamProjects.length ? (
                    <div className="space-y-10">
                        {teamProjects.map((teamProject) => {
                            const canvases = projects.filter((project) => project.teamProjectId === teamProject.id);
                            return (
                                <section key={teamProject.id}>
                                    <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-stone-200 pb-3 dark:border-stone-800">
                                        <div className="min-w-0">
                                            <h2 className="flex items-center gap-2 text-xl font-semibold">
                                                <FolderKanban className="size-5" />
                                                {teamProject.title}
                                            </h2>
                                            <p className="mt-1 text-sm text-stone-500">{teamProject.description || "暂无项目描述"}</p>
                                            <p className="mt-2 flex items-center gap-1.5 text-xs text-stone-400">
                                                <UsersRound className="size-3.5" />
                                                {teamProject.members.map((member) => member.displayName).join("、") || "暂无成员"}
                                            </p>
                                        </div>
                                        <Button type="primary" icon={<Plus className="size-4" />} onClick={() => createCanvas(teamProject)}>
                                            新建项目画布
                                        </Button>
                                    </div>
                                    {canvases.length ? (
                                        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                                            {canvases.map((project) => (
                                                <CanvasProjectCard key={project.id} project={project} selectable={false} />
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed border-stone-200 text-sm text-stone-500 dark:border-stone-800">
                                            <span>这个项目还没有画布</span>
                                            <Button type="link" icon={<Plus className="size-4" />} onClick={() => createCanvas(teamProject)}>
                                                创建第一张画布
                                            </Button>
                                        </div>
                                    )}
                                </section>
                            );
                        })}
                    </div>
                ) : (
                    <section className="flex min-h-[360px] flex-col items-center justify-center border-y border-stone-200 px-6 text-center dark:border-stone-800">
                        <FolderKanban className="size-10 text-stone-400" />
                        <h2 className="mt-5 text-xl font-medium">还没有加入项目</h2>
                        <p className="mt-3 max-w-lg text-sm leading-6 text-stone-500">当前只能使用个人画布。项目由管理员在“用户管理 → 项目管理”中创建并分配成员。</p>
                        <Button className="mt-6" onClick={() => navigate("/canvas")}>
                            返回我的画布
                        </Button>
                    </section>
                )}
            </div>
            <CanvasDeleteProjectsDialog />
        </main>
    );
}
