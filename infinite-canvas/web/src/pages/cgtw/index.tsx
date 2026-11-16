import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { App, Button, Checkbox } from "antd";
import { Download, FileUp, Plus, Trash2 } from "lucide-react";

import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { importCanvasArchive } from "@/lib/canvas/canvas-import";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCgtwStore } from "@/stores/use-cgtw-store";

/** CGTW 画布列表：画布数据就是原生画布，只是在 CGTW 入口下单独列出并用 /cgtw/:id 打开（左侧带 CGTW 面板）。 */
export default function CgtwPage() {
    const { message, modal } = App.useApp();
    const navigate = useNavigate();
    const inputRef = useRef<HTMLInputElement>(null);
    const [selected, setSelected] = useState<string[]>([]);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const allProjects = useCanvasStore((state) => state.projects);
    const createProject = useCanvasStore((state) => state.createProject);
    const importProject = useCanvasStore((state) => state.importProject);
    const deleteProjects = useCanvasStore((state) => state.deleteProjects);
    const canvasIds = useCgtwStore((state) => state.canvasIds);
    const projects = allProjects.filter((project) => canvasIds.includes(project.id));

    const create = () => {
        const id = createProject(`CGTW 画布 ${projects.length + 1}`);
        useCgtwStore.getState().addCanvasIds([id]);
        navigate(`/cgtw/${id}`);
    };
    const importCanvas = async (file?: File) => {
        if (!file) return;
        const before = new Set(useCanvasStore.getState().projects.map((project) => project.id));
        try {
            const result = await importCanvasArchive(file, importProject);
            useCgtwStore.getState().addCanvasIds(useCanvasStore.getState().projects.map((project) => project.id).filter((id) => !before.has(id)));
            message.success(`已导入 ${result.count} 个画布`);
        } catch {
            message.error("导入失败，请确认是导出的画布 ZIP");
        } finally {
            if (inputRef.current) inputRef.current.value = "";
        }
    };
    const remove = (ids: string[]) =>
        modal.confirm({
            title: `删除 ${ids.length} 个画布？`,
            content: "删除后无法恢复。",
            okButtonProps: { danger: true },
            onOk: () => {
                deleteProjects(ids);
                useCgtwStore.getState().removeCanvasIds(ids);
                setSelected((current) => current.filter((id) => !ids.includes(id)));
            },
        });

    return (
        <main className="h-full overflow-auto bg-background text-stone-950 dark:text-stone-100">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
                <header className="flex flex-wrap items-end justify-between gap-4 border-b border-stone-200 pb-6 dark:border-stone-800">
                    <div>
                        <p className="text-xs text-stone-500">CGTeamwork</p>
                        <h1 className="mt-3 text-3xl font-semibold">CGTW 画布</h1>
                    </div>
                    <div className="flex items-center gap-2">
                        {selected.length ? (
                            <>
                                <Button icon={<Download className="size-4" />} onClick={() => void exportCanvasProjects(projects.filter((project) => selected.includes(project.id)), `CGTW-${selected.length}`)}>
                                    导出所选
                                </Button>
                                <Button icon={<Trash2 className="size-4" />} onClick={() => remove(selected)}>
                                    删除所选
                                </Button>
                            </>
                        ) : null}
                        <Button disabled={!hydrated} icon={<FileUp className="size-4" />} onClick={() => inputRef.current?.click()}>
                            导入内容
                        </Button>
                        <Button disabled={!hydrated} type="primary" icon={<Plus className="size-4" />} onClick={create}>
                            新建画布
                        </Button>
                    </div>
                </header>

                {!hydrated ? (
                    <section className="flex min-h-[360px] items-center justify-center text-sm text-stone-500">正在加载…</section>
                ) : projects.length ? (
                    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                        {projects.map((project) => (
                            <article
                                key={project.id}
                                className="group flex cursor-pointer flex-col gap-3 rounded-xl border border-stone-200 p-5 transition-colors hover:bg-black/[0.03] dark:border-stone-800 dark:hover:bg-white/5"
                                onClick={() => navigate(`/cgtw/${project.id}`)}
                            >
                                <div className="flex items-start gap-3">
                                    <Checkbox
                                        checked={selected.includes(project.id)}
                                        onClick={(event) => event.stopPropagation()}
                                        onChange={(event) => setSelected((current) => (event.target.checked ? [...current, project.id] : current.filter((id) => id !== project.id)))}
                                    />
                                    <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">{project.title}</h2>
                                </div>
                                <p className="text-sm text-stone-600 dark:text-stone-400">
                                    {project.nodes.length} 个节点 · {project.connections.length} 条连线
                                </p>
                                <p className="text-xs text-stone-500">更新于 {new Date(project.updatedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</p>
                            </article>
                        ))}
                    </div>
                ) : (
                    <section className="flex min-h-[320px] flex-col items-center justify-center text-center">
                        <h2 className="text-xl font-medium">还没有 CGTW 画布</h2>
                        <p className="mt-3 text-sm text-stone-500">新建后和“我的画布”用法完全一致，左侧多一个 CGTW 面板，可查任务和批注。</p>
                        <Button type="primary" className="mt-6" icon={<Plus className="size-4" />} onClick={create}>
                            新建画布
                        </Button>
                    </section>
                )}
            </div>
            <input ref={inputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importCanvas(event.target.files?.[0])} />
        </main>
    );
}
