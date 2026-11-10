import { ArrowLeft, Download, ImagePlus, PencilLine, Plus, Search, Trash2, Upload, Video } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { App, Button, Card, Empty, Form, Image, Input, Modal, Pagination, Select, Space, Spin, Tag, Typography } from "antd";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { saveAs } from "file-saver";

import {
    createTeamProjectAsset,
    deleteTeamProjectAsset,
    fetchTeamProjectAssets,
    updateTeamProjectAsset,
    type TeamProjectAssetDefinition,
} from "@/services/api/team-project-assets";
import { getMediaBlob, uploadMediaFile } from "@/services/file-storage";
import { ensureImagePreview, getImageBlob, previewUrlFor, uploadImage } from "@/services/image-storage";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import type { Asset, ImageAsset, VideoAsset } from "@/stores/use-asset-store";

type AssetKind = Asset["kind"];

type AssetFormValues = {
    kind: AssetKind;
    title: string;
    tags: string[];
    source?: string;
    note?: string;
    content?: string;
};

const PAGE_SIZE = 12;

export default function ProjectAssetsPage() {
    const { message } = App.useApp();
    const { projectId = "" } = useParams<{ projectId: string }>();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const teamProject = useCanvasStore((state) => state.teamProjects.find((project) => project.id === projectId));
    const [form] = Form.useForm<AssetFormValues>();
    const [keyword, setKeyword] = useState("");
    const [kindFilter, setKindFilter] = useState<AssetKind | "all">("all");
    const [page, setPage] = useState(1);
    const [editorOpen, setEditorOpen] = useState(false);
    const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
    const [mediaDraft, setMediaDraft] = useState<ImageAsset["data"] | VideoAsset["data"] | null>(null);
    const [saving, setSaving] = useState(false);
    const [deletingAsset, setDeletingAsset] = useState<Asset | null>(null);
    const [deleting, setDeleting] = useState(false);
    const { data, isLoading } = useQuery({
        queryKey: ["team-project-assets", projectId],
        queryFn: () => fetchTeamProjectAssets(projectId),
        enabled: Boolean(projectId),
    });
    const assets = data?.assets || [];

    useEffect(() => {
        assets.forEach((asset) => {
            if (asset.kind === "image" && asset.data.storageKey) void ensureImagePreview(asset.data.storageKey);
        });
    }, [assets]);

    const filtered = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return assets.filter((asset) => {
            if (kindFilter !== "all" && asset.kind !== kindFilter) return false;
            if (!query) return true;
            return [asset.title, asset.source || "", asset.note || "", ...(asset.tags || [])].join(" ").toLowerCase().includes(query);
        });
    }, [assets, keyword, kindFilter]);
    const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    useEffect(() => {
        setPage((value) => Math.min(value, Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))));
    }, [filtered.length]);

    const openCreate = () => {
        setEditingAsset(null);
        setMediaDraft(null);
        form.setFieldsValue({ kind: "image", title: "", tags: [], source: "", note: "", content: "" });
        setEditorOpen(true);
    };

    const openEdit = (asset: Asset) => {
        setEditingAsset(asset);
        setMediaDraft(asset.kind === "text" ? null : asset.data);
        form.setFieldsValue({
            kind: asset.kind,
            title: asset.title,
            tags: asset.tags || [],
            source: asset.source || "",
            note: asset.note || "",
            content: asset.kind === "text" ? asset.data.content : "",
        });
        setEditorOpen(true);
    };

    const save = async () => {
        setSaving(true);
        try {
            const values = await form.validateFields();
            const base = {
                title: values.title.trim(),
                coverUrl: values.kind === "image" && mediaDraft && "dataUrl" in mediaDraft ? mediaDraft.dataUrl : "",
                tags: values.tags || [],
                source: values.source?.trim(),
                note: values.note?.trim(),
                metadata: { source: "project" },
            };
            let asset: TeamProjectAssetDefinition;
            if (values.kind === "text") {
                asset = { ...base, kind: "text", data: { content: (values.content || "").trim() } };
            } else if (values.kind === "image") {
                if (!mediaDraft || !("dataUrl" in mediaDraft)) throw new Error("请选择图片");
                asset = { ...base, kind: "image", data: mediaDraft };
            } else {
                if (!mediaDraft || !("url" in mediaDraft)) throw new Error("请选择视频");
                asset = { ...base, kind: "video", data: mediaDraft };
            }
            if (editingAsset) await updateTeamProjectAsset(projectId, editingAsset.id, asset);
            else await createTeamProjectAsset(projectId, asset);
            await queryClient.invalidateQueries({ queryKey: ["team-project-assets", projectId] });
            message.success(editingAsset ? "项目资产已更新" : "项目资产已添加");
            setEditorOpen(false);
        } catch (error) {
            if (error instanceof Error && error.message) message.error(error.message);
        } finally {
            setSaving(false);
        }
    };

    const upload = async (file?: File) => {
        if (!file) return;
        try {
            if (file.type.startsWith("image/")) {
                const image = await uploadImage(file, { area: "input", teamProjectId: projectId });
                setMediaDraft({ dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType });
                form.setFieldValue("kind", "image");
            } else if (file.type.startsWith("video/")) {
                const video = await uploadMediaFile(file, "video", { area: "input", teamProjectId: projectId });
                setMediaDraft({ url: video.url, storageKey: video.storageKey, width: video.width || 0, height: video.height || 0, bytes: video.bytes, mimeType: video.mimeType });
                form.setFieldValue("kind", "video");
            } else {
                throw new Error("仅支持图片或视频文件");
            }
            if (!form.getFieldValue("title")) form.setFieldValue("title", file.name);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "上传失败");
        }
    };

    const download = async (asset: Asset) => {
        if (asset.kind === "text") return;
        const blob = asset.data.storageKey
            ? asset.kind === "image"
                ? await getImageBlob(asset.data.storageKey)
                : await getMediaBlob(asset.data.storageKey)
            : await fetch(asset.kind === "image" ? asset.data.dataUrl : asset.data.url).then((response) => (response.ok ? response.blob() : null));
        if (!blob) return void message.error("下载失败");
        const ext = asset.data.mimeType.split("/")[1]?.split("+")[0] || (asset.kind === "video" ? "mp4" : "png");
        saveAs(blob, `${asset.title || "asset"}.${ext}`);
    };

    const remove = async () => {
        if (!deletingAsset) return;
        setDeleting(true);
        try {
            await deleteTeamProjectAsset(projectId, deletingAsset.id);
            await queryClient.invalidateQueries({ queryKey: ["team-project-assets", projectId] });
            setDeletingAsset(null);
            message.success("项目资产已删除");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "删除失败");
        } finally {
            setDeleting(false);
        }
    };

    const kind = Form.useWatch("kind", form) || "image";
    const cover = (asset: Asset) => (asset.kind === "image" ? previewUrlFor(asset.data.storageKey) || asset.data.dataUrl || asset.coverUrl : asset.coverUrl);

    return (
        <main className="h-full overflow-y-auto bg-background text-stone-950 dark:text-stone-100">
            <div className="mx-auto max-w-7xl px-6 py-8">
                <header className="flex flex-wrap items-end justify-between gap-4 border-b border-stone-200 pb-5 dark:border-stone-800">
                    <div>
                        <Button type="text" icon={<ArrowLeft className="size-4" />} onClick={() => navigate(`/projects/${encodeURIComponent(projectId)}`)}>
                            返回项目
                        </Button>
                        <h1 className="mt-3 text-3xl font-semibold">{teamProject?.title || "项目"} · 项目资产</h1>
                        <p className="mt-2 text-sm text-stone-500">项目成员共享此素材库；个人“我的资产”不会出现在这里。</p>
                    </div>
                    <Button type="primary" icon={<Plus className="size-4" />} onClick={openCreate}>
                        添加项目资产
                    </Button>
                </header>

                <div className="mt-6 flex flex-wrap items-center gap-3">
                    <Input className="max-w-sm" prefix={<Search className="size-4 text-stone-400" />} allowClear placeholder="搜索项目资产" value={keyword} onChange={(event) => { setPage(1); setKeyword(event.target.value); }} />
                    <Space wrap>
                        {(["all", "image", "video", "text"] as const).map((value) => (
                            <Tag.CheckableTag key={value} checked={kindFilter === value} onChange={() => { setPage(1); setKindFilter(value); }}>
                                {value === "all" ? "全部" : value === "image" ? "图片" : value === "video" ? "视频" : "文本"}
                            </Tag.CheckableTag>
                        ))}
                    </Space>
                </div>

                {isLoading ? (
                    <div className="flex min-h-80 items-center justify-center"><Spin /></div>
                ) : visible.length ? (
                    <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {visible.map((asset) => (
                            <Card
                                key={asset.id}
                                hoverable
                                className="overflow-hidden"
                                styles={{ body: { padding: 0 } }}
                                cover={
                                    <div className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-stone-100 dark:bg-stone-900">
                                        {cover(asset) ? (
                                            <Image
                                                src={cover(asset)}
                                                alt={asset.title}
                                                preview={asset.kind === "image" ? { src: asset.data.dataUrl || cover(asset) } : false}
                                                className="size-full object-cover"
                                            />
                                        ) : asset.kind === "video" ? (
                                            <Video className="size-10 text-stone-400" />
                                        ) : (
                                            <ImagePlus className="size-10 text-stone-400" />
                                        )}
                                    </div>
                                }
                            >
                                <div className="p-4">
                                    <div className="flex items-start justify-between gap-2">
                                        <h2 className="line-clamp-1 text-sm font-semibold">{asset.title}</h2>
                                        <Tag className="m-0">{asset.kind === "image" ? "图片" : asset.kind === "video" ? "视频" : "文本"}</Tag>
                                    </div>
                                    <Typography.Paragraph type="secondary" ellipsis={{ rows: 2 }} className="!mb-0 !mt-2 !text-xs">
                                        {asset.kind === "text" ? asset.data.content : asset.source || asset.note || asset.data.mimeType}
                                    </Typography.Paragraph>
                                    <div className="mt-3 flex flex-wrap gap-1">
                                        {(asset.tags || []).slice(0, 3).map((tag) => <Tag key={tag} className="m-0 text-[11px]">{tag}</Tag>)}
                                    </div>
                                    <div className="mt-4 flex gap-2">
                                        {asset.kind !== "text" ? <Button size="small" icon={<Download className="size-3.5" />} onClick={() => void download(asset)}>下载</Button> : null}
                                        <Button size="small" icon={<PencilLine className="size-3.5" />} onClick={() => openEdit(asset)}>编辑</Button>
                                        <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={() => setDeletingAsset(asset)}>删除</Button>
                                    </div>
                                </div>
                            </Card>
                        ))}
                    </div>
                ) : (
                    <Empty className="py-24" description="这个项目还没有资产" />
                )}

                {filtered.length > PAGE_SIZE ? <div className="mt-6 flex justify-center"><Pagination current={page} pageSize={PAGE_SIZE} total={filtered.length} onChange={setPage} showSizeChanger={false} /></div> : null}
            </div>

            <Modal title={editingAsset ? "编辑项目资产" : "添加项目资产"} open={editorOpen} width={760} confirmLoading={saving} okText="保存" cancelText="取消" onOk={() => void save()} onCancel={() => setEditorOpen(false)}>
                <Form form={form} layout="vertical" requiredMark={false}>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Form.Item label="资产类型" name="kind"><Select options={[{ value: "image", label: "图片" }, { value: "video", label: "视频" }, { value: "text", label: "文本" }]} disabled={Boolean(editingAsset)} /></Form.Item>
                        <Form.Item label="标题" name="title" rules={[{ required: true, message: "请输入标题" }]}><Input /></Form.Item>
                        <Form.Item label="来源" name="source"><Input placeholder="例如：项目拍摄、Canvas 生成" /></Form.Item>
                        <Form.Item label="标签" name="tags"><Select mode="tags" tokenSeparators={[",", "，"]} /></Form.Item>
                    </div>
                    <Form.Item label="备注" name="note"><Input /></Form.Item>
                    {kind === "text" ? <Form.Item label="文本内容" name="content" rules={[{ required: true, message: "请输入文本内容" }]}><Input.TextArea rows={7} /></Form.Item> : (
                        <Form.Item label={kind === "video" ? "视频文件" : "图片文件"}>
                            <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-stone-300 p-5 dark:border-stone-700">
                                <Upload className="size-5" />
                                <span className="text-sm">{mediaDraft ? "已选择媒体，点击可替换" : "点击上传图片或视频"}</span>
                                <input type="file" accept="image/*,video/*" className="hidden" onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = ""; }} />
                            </label>
                            {mediaDraft ? <p className="mt-2 text-xs text-stone-500">{mediaDraft.width} × {mediaDraft.height} · {mediaDraft.mimeType}</p> : null}
                        </Form.Item>
                    )}
                </Form>
            </Modal>

            <Modal title="删除项目资产" open={Boolean(deletingAsset)} okText="删除" cancelText="取消" confirmLoading={deleting} okButtonProps={{ danger: true }} onOk={() => void remove()} onCancel={() => setDeletingAsset(null)}>
                确定删除“{deletingAsset?.title}”？项目成员将无法继续访问。
            </Modal>
        </main>
    );
}
