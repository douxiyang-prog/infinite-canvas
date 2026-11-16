import { App, Button, Empty, Image, Spin, Tag } from "antd";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ImagePlus } from "lucide-react";

import { CgtwDirectory } from "@/components/cgtw/cgtw-directory";
import { CgtwStatusTag } from "@/components/cgtw/cgtw-status-tag";
import { cgtwMediaUrl, fetchCgtwNotes, type CgtwMedia, type CgtwNote, type CgtwTask } from "@/services/api/cgtw";
import { uploadMediaFile } from "@/services/file-storage";
import { uploadImage } from "@/services/image-storage";
import { useAssetStore } from "@/stores/use-asset-store";
import { useCgtwStore } from "@/stores/use-cgtw-store";

const NOTE_TYPE_LABEL: Record<string, string> = { retake: "返修", submit: "提交", change_status: "状态变更" };

/** 把批注附件下载后存成「我的资产」，之后可在画布左侧「素材」面板里插入，和手动上传的素材完全一致。 */
async function saveMediaAsAssets(task: CgtwTask, note: CgtwNote, medias: CgtwMedia[]) {
    const { addAsset } = useAssetStore.getState();
    const tags = ["CGTW", task.shot, task.pipeline];
    for (const [index, media] of medias.entries()) {
        const blob = await (await fetch(cgtwMediaUrl(media.url))).blob();
        const ext = media.url.split(".").pop() || (media.type === "video" ? "mp4" : "png");
        const title = `${task.shot}_${task.pipeline}_${note.time.slice(5, 16).replace(/\D/g, "")}_${index + 1}`;
        const file = new File([blob], `${title}.${ext}`, { type: blob.type || (media.type === "video" ? "video/mp4" : "image/png") });
        const metadata = { source: "cgtw", taskId: task.id, noteId: note.id };
        if (media.type === "image") {
            const image = await uploadImage(file);
            await addAsset({ kind: "image", title, coverUrl: image.url, tags, source: "CGTW", metadata, data: { dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType } });
        } else {
            const video = await uploadMediaFile(file, "video");
            await addAsset({ kind: "video", title, coverUrl: "", tags, source: "CGTW", metadata, data: { url: video.url, storageKey: video.storageKey, width: video.width || 0, height: video.height || 0, bytes: video.bytes, mimeType: video.mimeType } });
        }
    }
}

export function CgtwNotes({ task }: { task: CgtwTask }) {
    const { message } = App.useApp();
    const db = useCgtwStore((state) => state.db);
    const selectTask = useCgtwStore((state) => state.selectTask);
    const notes = useQuery({ queryKey: ["cgtw", "notes", db, task.id], queryFn: () => fetchCgtwNotes(db, task.id), staleTime: 30_000 });
    const list = [...(notes.data || [])].reverse();

    const save = async (note: CgtwNote, medias: CgtwMedia[]) => {
        const hide = message.loading("正在存入我的资产…", 0);
        try {
            await saveMediaAsAssets(task, note, medias);
            message.success(`已存入我的资产 ${medias.length} 个，可在画布左侧“素材”里插入`);
        } catch (error) {
            console.error(error);
            message.error("存入我的资产失败");
        } finally {
            hide();
        }
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center gap-2 border-b border-stone-200 px-3 py-2 dark:border-stone-800">
                <Button type="text" size="small" title="返回任务列表" icon={<ArrowLeft className="size-3.5" />} onClick={() => selectTask(null)} />
                <b className="min-w-0 flex-1 truncate text-sm">{task.shot} · {task.pipeline}</b>
                <CgtwStatusTag status={task.status} />
            </div>
            <div className="border-b border-stone-200 px-3 py-1.5 text-xs text-stone-500 dark:border-stone-800">
                {task.eps} · {task.artist || "未分配"} · 批注 {notes.data?.length ?? "-"}
            </div>
            <div className="min-h-0 flex-[2] space-y-4 overflow-auto p-3">
                {notes.isLoading ? (
                    <div className="flex justify-center p-8"><Spin /></div>
                ) : notes.isError ? (
                    <div className="text-center text-sm text-red-500">{notes.error.message}</div>
                ) : list.length ? (
                    list.map((note) => (
                        <div key={note.id} className="space-y-1.5">
                            <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
                                <span className="font-medium text-stone-700 dark:text-stone-300">{note.author || "系统"}</span>
                                <span>{note.time.slice(0, 16)}</span>
                                {note.type ? <Tag className="!m-0" variant="filled">{NOTE_TYPE_LABEL[note.type] || note.type}</Tag> : null}
                                {note.version ? <span>v{note.version}</span> : null}
                            </div>
                            {note.text ? <p className="whitespace-pre-wrap text-sm">{note.text}</p> : null}
                            {note.medias.length ? (
                                <div className="space-y-1.5">
                                    <div className="flex flex-wrap gap-2">
                                        {note.medias.map((media) =>
                                            media.type === "video" ? (
                                                <video key={media.url} className="h-24 rounded-md bg-black" controls preload="metadata" src={cgtwMediaUrl(media.url)} />
                                            ) : (
                                                <Image key={media.url} height={96} className="rounded-md object-cover" src={cgtwMediaUrl(media.thumb)} preview={{ src: cgtwMediaUrl(media.url) }} />
                                            ),
                                        )}
                                    </div>
                                    <Button type="text" size="small" icon={<ImagePlus className="size-3.5" />} onClick={() => save(note, note.medias)}>
                                        全部存入我的资产
                                    </Button>
                                </div>
                            ) : null}
                        </div>
                    ))
                ) : (
                    <Empty className="mt-10" description="这个任务还没有批注" />
                )}
            </div>
            <CgtwDirectory task={task} kind="review" title="小样目录" />
            <CgtwDirectory task={task} kind="render" title="大样目录" />
        </div>
    );
}
