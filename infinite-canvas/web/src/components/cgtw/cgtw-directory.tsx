import { useState } from "react";
import { App, Button, Spin, Tag } from "antd";
import { useQuery } from "@tanstack/react-query";
import { FolderOpen, Image as ImageIcon, RefreshCw, Video } from "lucide-react";

import { importCgtwFileToCanvas } from "@/components/cgtw/cgtw-import";
import { cn } from "@/lib/utils";
import { fetchCgtwFiles, type CgtwFileEntry, type CgtwSubmitKind, type CgtwTask } from "@/services/api/cgtw";
import { useCgtwStore } from "@/stores/use-cgtw-store";

const formatSize = (bytes: number) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** 任务的小样/大样目录文件列表：点“导入”或直接拖到画布上，都会把文件放进当前画布。 */
export function CgtwDirectory({ task, kind, title }: { task: CgtwTask; kind: CgtwSubmitKind; title: string }) {
    const { message } = App.useApp();
    const db = useCgtwStore((state) => state.db);
    const [busy, setBusy] = useState("");
    const files = useQuery({ queryKey: ["cgtw", "files", db, task.id, kind], queryFn: () => fetchCgtwFiles(db, task.id, kind), staleTime: 0, gcTime: 0 });

    const importFile = async (entry: CgtwFileEntry, point?: { x: number; y: number }) => {
        setBusy(entry.name);
        const hide = message.loading(entry.name.toLowerCase().endsWith(".mov") ? "正在生成预览并导入…" : "正在导入…", 0);
        try {
            await importCgtwFileToCanvas(db, task.id, kind, entry, point);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "导入失败");
        } finally {
            hide();
            setBusy("");
        }
    };

    return (
        <section className="flex min-h-0 flex-1 flex-col border-t border-stone-200 dark:border-stone-800">
            <div className="flex items-center gap-2 px-3 py-1.5 text-xs">
                <FolderOpen className="size-3.5 text-stone-500" />
                <b className="text-sm">{title}</b>
                <span className="min-w-0 flex-1 truncate text-stone-400" title={files.data?.dir}>{files.data?.dir}</span>
                <Button type="text" size="small" title="刷新" icon={<RefreshCw className="size-3.5" />} loading={files.isFetching} onClick={() => files.refetch()} />
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
                {files.isLoading ? (
                    <div className="flex justify-center p-4"><Spin size="small" /></div>
                ) : files.isError ? (
                    <div className="p-2 text-xs text-red-500">{files.error.message}</div>
                ) : !files.data?.entries.length ? (
                    <div className="p-2 text-xs text-stone-400">{files.data?.exists ? "目录里还没有文件" : "目录还不存在"}</div>
                ) : (
                    files.data.entries.map((entry) => (
                        <div
                            key={entry.name}
                            draggable={!!entry.importKind}
                            onDragStart={(event) => {
                                event.dataTransfer.effectAllowed = "copy";
                                event.dataTransfer.setData("text/plain", entry.name);
                            }}
                            onDragEnd={(event) => entry.importKind && void importFile(entry, { x: event.clientX, y: event.clientY })}
                            className={cn("group flex items-center gap-2 rounded-md px-2 py-1 text-xs", entry.importKind ? "cursor-grab hover:bg-black/5 dark:hover:bg-white/10" : "opacity-60")}
                        >
                            {entry.importKind === "video" ? <Video className="size-3.5 shrink-0" /> : <ImageIcon className="size-3.5 shrink-0" />}
                            <span className="min-w-0 flex-1 truncate" title={entry.name}>{entry.name}</span>
                            {entry.isDir ? <Tag className="!m-0" variant="filled">文件夹</Tag> : <span className="shrink-0 text-stone-400">{formatSize(entry.size)}</span>}
                            {entry.importKind ? (
                                <Button type="text" size="small" loading={busy === entry.name} className="shrink-0" onClick={() => importFile(entry)}>
                                    导入
                                </Button>
                            ) : null}
                        </div>
                    ))
                )}
            </div>
        </section>
    );
}
