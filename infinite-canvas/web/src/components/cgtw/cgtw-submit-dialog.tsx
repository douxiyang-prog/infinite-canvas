import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Alert, Button, Checkbox, InputNumber, Modal, Segmented, Spin, Table, Tag } from "antd";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { CgtwStatusTag } from "@/components/cgtw/cgtw-status-tag";
import { extensionOf, findCanvasNode, submitMediaOf } from "@/components/cgtw/cgtw-submit-node";
import { fetchCgtwSubmitPlan, submitCgtwFile, type CgtwSubmitKind, type CgtwSubmitResult, type CgtwVideoMeta } from "@/services/api/cgtw";
import { useCgtwStore } from "@/stores/use-cgtw-store";
import { useCgtwSubmitStore } from "@/stores/use-cgtw-submit-store";

const formatSize = (bytes: number) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const describeMeta = (meta: CgtwVideoMeta) => [meta.fps !== null ? `${Number(meta.fps.toFixed(3))} fps` : "帧率未知", meta.frames !== null ? `${meta.frames} 帧` : "帧数未知", meta.width && meta.height ? `${meta.width}x${meta.height}` : ""].filter(Boolean).join(" · ");

/** 提交小样/大样：列出目标目录里已有的文件，自动取下一个版本号（可改），由 Agent 校验后写盘并回写 CGTW。 */
export function CgtwSubmitDialog() {
    const { id: projectId } = useParams<{ id: string }>();
    const queryClient = useQueryClient();
    const nodeId = useCgtwSubmitStore((state) => state.nodeId);
    const close = useCgtwSubmitStore((state) => state.close);
    const db = useCgtwStore((state) => state.db);
    const task = useCgtwStore((state) => state.selectedTask);
    const [kind, setKind] = useState<CgtwSubmitKind>("review");
    const [version, setVersion] = useState<number | null>(null);
    const [convert, setConvert] = useState(false);
    const [trim, setTrim] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const [result, setResult] = useState<CgtwSubmitResult | null>(null);

    const media = useMemo(() => (nodeId ? submitMediaOf(findCanvasNode(projectId, nodeId)) : null), [nodeId, projectId]);
    const file = useQuery({
        queryKey: ["cgtw", "submit-file", nodeId, media?.url],
        enabled: !!media,
        gcTime: 0,
        staleTime: Infinity,
        queryFn: async () => {
            const blob = await (await fetch(media!.url, { credentials: "include" })).blob();
            return { blob, ext: extensionOf(blob, media!.url, media!.kind) };
        },
    });
    const plan = useQuery({ queryKey: ["cgtw", "submit-plan", db, task?.id, kind], enabled: !!nodeId && !!task, gcTime: 0, staleTime: 0, queryFn: () => fetchCgtwSubmitPlan(db, task!.id, kind) });

    useEffect(() => {
        setKind("review");
        setVersion(null);
        setTrim(false);
        setError("");
        setResult(null);
    }, [nodeId]);
    // 只在建议版本号变化（切换类型、目录里多了新版本）时重置，窗口重新获得焦点触发的同值刷新不应覆盖制作者手改的版本号
    const suggestedVersion = plan.data?.nextVersion;
    useEffect(() => {
        if (suggestedVersion) setVersion(suggestedVersion);
    }, [suggestedVersion, kind, nodeId]);

    const data = plan.data;
    const sourceExt = file.data?.ext || "";
    const isVideo = media?.kind === "video";
    // 视频的扩展名不被文件框接受时默认勾选转换；转换后的文件一定是 .mov
    useEffect(() => {
        if (data && file.data) setConvert(isVideo && !data.allowedExt.includes(sourceExt));
    }, [data, file.data, isVideo, sourceExt]);
    const ext = convert ? ".mov" : sourceExt;
    const used = useMemo(() => new Set([...(data?.cgtwVersions ?? []), ...(data?.entries.map((entry) => entry.version).filter((value): value is number => value !== null) ?? [])]), [data]);
    const fileName = data && version ? data.rule.replace(/#+/, String(version).padStart(data.pad, "0")) + (data.ruleExt ? "" : ext) : "";
    const extProblem = data && ext && !data.allowedExt.includes(ext) ? (data.ruleExt ? `该文件框只接受 ${data.ruleExt} 文件，当前文件是 ${ext}` : `不支持 ${ext} 格式`) : "";
    const versionProblem = version && used.has(version) ? `版本 v${String(version).padStart(data?.pad ?? 3, "0")} 已存在，请更换` : "";
    const agentOutdated = !!data && convert && !data.features?.convert;
    const canSubmit = !!(data && file.data && version && !extProblem && !versionProblem && !agentOutdated && !submitting);

    const submit = async () => {
        if (!canSubmit || !task || !version) return;
        setSubmitting(true);
        setError("");
        try {
            setResult(await submitCgtwFile({ db, taskId: task.id, kind, version, ext: sourceExt, file: file.data!.blob, convert, trim: convert && trim }));
            void queryClient.invalidateQueries({ queryKey: ["cgtw", "tasks"] });
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : "提交失败");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal open={!!nodeId} onCancel={() => !submitting && close()} title="提交到 CGTW" width={680} destroyOnHidden mask={{ closable: false }} footer={null}>
            {!task ? (
                <Alert type="warning" showIcon title="请先在左侧 CGTW 面板里点选要提交的任务，再回到画布右键提交。" />
            ) : result ? (
                <div className="space-y-3">
                    <Alert type={result.cgtwSynced ? "success" : "warning"} showIcon title={result.cgtwSynced ? "提交成功" : "已落盘，但未同步到 CGTW"} description={`${result.filename}（v${result.version}）`} />
                    <div className="break-all text-xs text-stone-500">{result.path}</div>
                    {result.meta.frames !== null ? (
                        <div className="space-y-0.5 rounded-md border border-stone-200 p-2 text-xs dark:border-stone-800">
                            {result.source && result.converted ? <div>原视频：{describeMeta(result.source)}</div> : null}
                            <div>{result.converted ? "提交文件（转换后）" : "提交文件"}：{describeMeta(result.meta)}</div>
                            {result.trimmed ? <div className="text-amber-600">已按你的设置截取为任务帧数（原视频 {result.source?.frames} 帧 → {result.meta.frames} 帧）</div> : null}
                        </div>
                    ) : null}
                    {result.warnings.map((warning) => (
                        <div key={warning} className="text-xs text-stone-500">• {warning}</div>
                    ))}
                    <div className="flex justify-end"><Button type="primary" onClick={close}>完成</Button></div>
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="flex items-center gap-2 text-sm">
                        <b>{task.eps} / {task.shot} · {task.pipeline}</b>
                        <CgtwStatusTag status={task.status} />
                        <span className="text-xs text-stone-500">{task.frame ? `${task.frame} 帧` : ""}</span>
                    </div>
                    <Segmented value={kind} options={[{ value: "review", label: "小样 review" }, { value: "render", label: "大样 render" }]} onChange={(value) => setKind(value as CgtwSubmitKind)} />
                    {plan.isLoading ? (
                        <div className="flex justify-center p-8"><Spin /></div>
                    ) : plan.isError ? (
                        <Alert type="error" showIcon title={plan.error.message} />
                    ) : data ? (
                        <>
                            <div className="space-y-1">
                                <div className="text-xs text-stone-500">目标目录：{data.dir}{data.dirExists ? "" : "（尚不存在，提交时自动创建）"}</div>
                                <Table
                                    size="small"
                                    rowKey="name"
                                    pagination={false}
                                    scroll={{ y: 150 }}
                                    locale={{ emptyText: "目录里还没有文件" }}
                                    dataSource={data.entries}
                                    columns={[
                                        { title: "已有文件", dataIndex: "name", ellipsis: true, render: (name: string, row) => (<span>{name}{row.isDir ? <Tag className="!ml-1" variant="filled">文件夹</Tag> : null}</span>) },
                                        { title: "版本", dataIndex: "version", width: 64, render: (value: number | null) => (value === null ? "-" : `v${value}`) },
                                        { title: "大小", dataIndex: "size", width: 84, render: (size: number, row) => (row.isDir ? "-" : formatSize(size)) },
                                        { title: "修改时间", dataIndex: "mtime", width: 130, render: (value: string) => (value ? new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "-") },
                                    ]}
                                />
                                {data.entryCount > data.entries.length ? <div className="text-xs text-stone-500">仅显示前 {data.entries.length} 项，共 {data.entryCount} 项</div> : null}
                                {data.cgtwVersions.length ? <div className="text-xs text-stone-500">CGTW 已有版本：{data.cgtwVersions.map((value) => `v${value}`).join("、")}</div> : null}
                            </div>
                            <div className="flex items-center gap-3">
                                <span className="text-sm">版本号</span>
                                <InputNumber min={1} max={9999} precision={0} value={version} status={versionProblem ? "error" : undefined} onChange={(value) => setVersion(value)} />
                                <span className="min-w-0 flex-1 truncate text-xs text-stone-500" title={fileName}>{fileName}</span>
                            </div>
                            {versionProblem ? <div className="text-xs text-red-500">{versionProblem}</div> : null}
                            <div className="text-xs text-stone-500">
                                提交文件：{media?.title || "节点"}{file.data ? `（${sourceExt}，${formatSize(file.data.blob.size)}）` : file.isLoading ? "（读取中…）" : ""}
                            </div>
                            {isVideo ? (
                                <div className="space-y-1">
                                    <Checkbox checked={convert} onChange={(event) => setConvert(event.target.checked)}>
                                        转换为 ProRes .mov（{kind === "review" ? "小样 ProRes 422 LT，缩放到 1920x1080" : "大样 ProRes 4444 XQ，保持原分辨率"}{data.target.fps ? `，${data.target.fps} fps` : ""}）
                                    </Checkbox>
                                    {convert && data.target.frames ? (
                                        <div className="pl-6">
                                            <Checkbox checked={trim} onChange={(event) => setTrim(event.target.checked)}>视频超过 {data.target.frames} 帧时截取前 {data.target.frames} 帧</Checkbox>
                                        </div>
                                    ) : null}
                                    {convert ? <div className="pl-6 text-xs text-stone-500">转换使用 CGTW 客户端自带的 ffmpeg，长视频可能需要几分钟；转换后仍会校验，不符合直接拒绝。</div> : null}
                                </div>
                            ) : null}
                            {file.isError ? <Alert type="error" showIcon title="无法读取节点的图片/视频内容" /> : null}
                            {extProblem ? <Alert type="error" showIcon title={extProblem} /> : null}
                            {agentOutdated ? <Alert type="error" showIcon title="本机 Canvas Agent 版本过旧，不支持转换。请重新安装最新的 Canvas Agent Manager 并重新启动 Agent。" /> : null}
                            <Alert
                                type="info"
                                showIcon
                                title="提交规则"
                                description={
                                    <ul className="list-disc space-y-0.5 pl-4 text-xs">
                                        {media?.kind === "video" ? <li>视频将校验：帧率{data.target.fps ? ` ${data.target.fps} fps` : "（本项目未配置，跳过）"}、帧数{data.target.frames ? ` ${data.target.frames} 帧` : "（任务未设置，跳过）"}、{kind === "review" ? "小样分辨率 1920x1080" : "大样分辨率不能是 1920x1080"}，不符合直接拒绝</li> : <li>图片不校验帧率和分辨率</li>}
                                        <li>写入存储盘后创建 CGTW 版本和文件记录</li>
                                        {data.triggersFlow ? <li>小样会触发 CGTW 正式提交流程</li> : null}
                                        {data.setsReviewStatus ? <li>任务状态会改为 review</li> : null}
                                    </ul>
                                }
                            />
                            {error ? <Alert type="error" showIcon title={error} /> : null}
                        </>
                    ) : null}
                    <div className="flex justify-end gap-2">
                        <Button disabled={submitting} onClick={close}>取消</Button>
                        <Button type="primary" loading={submitting} disabled={!canSubmit} onClick={submit}>提交{kind === "review" ? "小样" : "大样"}</Button>
                    </div>
                </div>
            )}
        </Modal>
    );
}
