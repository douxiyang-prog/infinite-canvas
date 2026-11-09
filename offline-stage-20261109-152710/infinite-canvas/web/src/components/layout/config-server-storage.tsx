import { useEffect, useState } from "react";
import { Alert, App, Button, Input, InputNumber, Spin, Tag } from "antd";
import { CheckCircle2, FolderCheck, HardDrive, RefreshCw, Save } from "lucide-react";
import { useTranslation } from "react-i18next";

import { completeStorageSetup, fetchAdminStorageConfig, validateStorageSetup, type AdminStorageConfig, type StorageValidation } from "@/services/api/setup";

const copy = {
    "zh-CN": {
        title: "服务端存储",
        description: "配置画布 JSON、我的资产和媒体文件的落盘位置。目录会自动按 input/output 分类存储。",
        path: "存储路径",
        pathPlaceholder: "/mnt/smb/infinite-canvas",
        allowedRoots: "允许的根目录",
        validate: "检测路径",
        save: "保存配置",
        refresh: "刷新",
        writable: "可读写",
        initialized: "已初始化",
        empty: "空目录",
        saved: "存储配置已保存",
        failed: "存储配置失败",
        pathRequired: "请填写存储路径",
        maxUpload: "单文件上限",
        autosave: "自动保存间隔",
        retention: "回收站保留",
        mb: "MB",
        seconds: "秒",
        days: "天",
    },
    "en-US": {
        title: "Server storage",
        description: "Configure where canvas JSON, My Assets, and media files are stored. Each project uses input/output directories.",
        path: "Storage path",
        pathPlaceholder: "/mnt/smb/infinite-canvas",
        allowedRoots: "Allowed roots",
        validate: "Check path",
        save: "Save",
        refresh: "Refresh",
        writable: "Read and write",
        initialized: "Initialized",
        empty: "Empty directory",
        saved: "Storage settings saved",
        failed: "Storage setup failed",
        pathRequired: "Enter a storage path",
        maxUpload: "File size limit",
        autosave: "Autosave interval",
        retention: "Trash retention",
        mb: "MB",
        seconds: "seconds",
        days: "days",
    },
} as const;

export function ConfigServerStorage() {
    const { i18n } = useTranslation();
    const language = i18n.resolvedLanguage === "en-US" ? "en-US" : "zh-CN";
    const text = copy[language];
    const { message } = App.useApp();
    const [config, setConfig] = useState<AdminStorageConfig | null>(null);
    const [path, setPath] = useState("");
    const [validation, setValidation] = useState<StorageValidation | null>(null);
    const [maxUploadMb, setMaxUploadMb] = useState(500);
    const [autosaveMs, setAutosaveMs] = useState(1500);
    const [trashRetentionDays, setTrashRetentionDays] = useState(14);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<"validate" | "save" | null>(null);
    const [error, setError] = useState("");
    const [revision, setRevision] = useState(0);

    useEffect(() => {
        let active = true;
        setLoading(true);
        fetchAdminStorageConfig()
            .then((next) => {
                if (!active) return;
                setConfig(next);
                setPath(next.settings?.root || "");
                setValidation(next.validation);
                setMaxUploadMb(next.settings?.maxUploadMb || 500);
                setAutosaveMs(next.settings?.autosaveMs || 1500);
                setTrashRetentionDays(next.settings?.trashRetentionDays || 14);
                setError("");
            })
            .catch((reason) => {
                if (active) setError(reason instanceof Error ? reason.message : text.failed);
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [revision, text.failed]);

    const validate = async () => {
        if (!path.trim()) {
            message.warning(text.pathRequired);
            return;
        }
        setBusy("validate");
        setError("");
        try {
            const result = await validateStorageSetup(path.trim());
            setValidation(result);
            if (!result.valid) setError(result.message);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : text.failed);
        } finally {
            setBusy(null);
        }
    };

    const save = async () => {
        setBusy("save");
        setError("");
        try {
            const result = await completeStorageSetup({ path: path.trim(), maxUploadMb, autosaveMs, trashRetentionDays });
            setConfig((current) => ({
                settings: result.settings,
                validation: {
                    path: result.settings.root,
                    valid: true,
                    mounted: true,
                    exists: true,
                    writable: true,
                    initialized: true,
                    empty: false,
                    filesystemType: "",
                    mountPoint: "",
                    message: text.initialized,
                },
                allowedRoots: current?.allowedRoots || config?.allowedRoots || [],
            }));
            setValidation((current) => current && { ...current, valid: true, initialized: true, message: text.initialized });
            message.success(text.saved);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : text.failed);
        } finally {
            setBusy(null);
        }
    };

    if (loading) {
        return (
            <div className="flex min-h-48 items-center justify-center">
                <Spin />
            </div>
        );
    }

    return (
        <div>
            <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                    <div className="flex items-center gap-2 text-sm font-semibold">
                        <HardDrive className="size-4" />
                        {text.title}
                    </div>
                    <p className="mt-1 text-xs text-stone-500">{text.description}</p>
                </div>
                <Button icon={<RefreshCw className="size-4" />} onClick={() => setRevision((value) => value + 1)}>
                    {text.refresh}
                </Button>
            </div>

            {error ? <Alert className="mb-4" type="error" showIcon message={error} /> : null}
            {validation?.valid ? (
                <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-900 dark:text-emerald-400">
                    <CheckCircle2 className="size-4" />
                    <span>{validation.message}</span>
                    <Tag color="success" bordered={false}>{text.writable}</Tag>
                    {validation.initialized ? <Tag color="success" bordered={false}>{text.initialized}</Tag> : null}
                    {validation.empty ? <Tag bordered={false}>{text.empty}</Tag> : null}
                </div>
            ) : null}

            <label className="text-sm">
                <span className="mb-2 block font-medium">{text.path}</span>
                <div className="flex flex-col gap-2 sm:flex-row">
                    <Input value={path} placeholder={text.pathPlaceholder} onChange={(event) => { setPath(event.target.value); setValidation(null); }} />
                    <Button icon={<FolderCheck className="size-4" />} loading={busy === "validate"} onClick={() => void validate()}>
                        {text.validate}
                    </Button>
                </div>
            </label>
            {config?.allowedRoots.length ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-stone-500">
                    <span>{text.allowedRoots}:</span>
                    {config.allowedRoots.map((root) => <Tag key={root}>{root}</Tag>)}
                </div>
            ) : null}

            <div className="mt-6 grid gap-4 md:grid-cols-3">
                <label className="text-sm">
                    <span className="mb-2 block font-medium">{text.maxUpload}</span>
                    <InputNumber min={1} max={500} value={maxUploadMb} addonAfter={text.mb} className="w-full" onChange={(value) => setMaxUploadMb(Number(value) || 500)} />
                </label>
                <label className="text-sm">
                    <span className="mb-2 block font-medium">{text.autosave}</span>
                    <InputNumber min={400} max={30_000} step={100} value={autosaveMs} addonAfter={text.seconds} className="w-full" onChange={(value) => setAutosaveMs(Number(value) || 1500)} />
                </label>
                <label className="text-sm">
                    <span className="mb-2 block font-medium">{text.retention}</span>
                    <InputNumber min={1} max={365} value={trashRetentionDays} addonAfter={text.days} className="w-full" onChange={(value) => setTrashRetentionDays(Number(value) || 14)} />
                </label>
            </div>
            <div className="mt-6 flex justify-end">
                <Button type="primary" icon={<Save className="size-4" />} loading={busy === "save"} disabled={!validation?.valid} onClick={() => void save()}>
                    {text.save}
                </Button>
            </div>
        </div>
    );
}
