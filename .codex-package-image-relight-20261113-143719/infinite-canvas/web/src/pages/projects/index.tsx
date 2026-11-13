import { ArrowRight, FolderKanban, Images, UsersRound } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { useCanvasStore } from "@/stores/canvas/use-canvas-store";

export default function ProjectsPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const hydrated = useCanvasStore((state) => state.hydrated);
    const projects = useCanvasStore((state) => state.projects);
    const teamProjects = useCanvasStore((state) => state.teamProjects);

    return (
        <main className="h-full overflow-y-auto bg-background text-stone-950 dark:text-stone-100">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
                <header className="border-b border-stone-200 pb-6 dark:border-stone-800">
                    <p className="text-xs text-stone-500">团队协作空间</p>
                    <h1 className="mt-3 flex items-center gap-2 text-3xl font-semibold">
                        <FolderKanban className="size-7" />
                        {t("navigation.projects")}
                    </h1>
                    <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-500">选择项目进入独立项目页，查看场次和项目画布。</p>
                </header>

                {!hydrated ? (
                    <section className="flex min-h-[360px] items-center justify-center border-y border-stone-200 text-sm text-stone-500 dark:border-stone-800">正在加载项目...</section>
                ) : teamProjects.length ? (
                    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                        {teamProjects.map((teamProject) => {
                            const canvases = projects.filter((project) => project.teamProjectId === teamProject.id);
                            const latest = canvases.reduce<number>((value, project) => Math.max(value, new Date(project.updatedAt).getTime()), 0);
                            return (
                                <button
                                    key={teamProject.id}
                                    type="button"
                                    className="group flex min-h-48 flex-col rounded-2xl border border-stone-200 bg-stone-50/70 p-5 text-left transition hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-lg dark:border-stone-800 dark:bg-stone-900/70 dark:hover:border-stone-700"
                                    onClick={() => navigate(`/projects/${encodeURIComponent(teamProject.id)}`)}
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <h2 className="truncate text-xl font-semibold">{teamProject.title}</h2>
                                            <p className="mt-1 line-clamp-2 text-sm text-stone-500">{teamProject.description || "暂无项目描述"}</p>
                                        </div>
                                        <ArrowRight className="size-5 shrink-0 text-stone-400 transition group-hover:translate-x-1 group-hover:text-stone-700 dark:group-hover:text-stone-200" />
                                    </div>
                                    <div className="mt-auto space-y-2 pt-6 text-xs text-stone-500">
                                        <div className="flex items-center gap-2">
                                            <Images className="size-3.5" />
                                            <span>
                                                {canvases.length} 张画布 · {teamProject.scenes.length} 个场次
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <UsersRound className="size-3.5" />
                                            <span className="truncate">{teamProject.members.map((member) => member.displayName).join("、") || "暂无成员"}</span>
                                        </div>
                                        {latest ? <div>更新于 {new Date(latest).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</div> : null}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                ) : (
                    <section className="flex min-h-[360px] flex-col items-center justify-center border-y border-stone-200 px-6 text-center dark:border-stone-800">
                        <FolderKanban className="size-10 text-stone-400" />
                        <h2 className="mt-5 text-xl font-medium">还没有加入项目</h2>
                        <p className="mt-3 max-w-lg text-sm leading-6 text-stone-500">当前只能使用个人画布。项目由管理员在“用户管理 → 项目管理”中创建并分配成员。</p>
                    </section>
                )}
            </div>
        </main>
    );
}
