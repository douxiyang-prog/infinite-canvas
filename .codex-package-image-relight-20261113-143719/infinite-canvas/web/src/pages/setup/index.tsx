import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Alert, App, Button, Input, InputNumber, Spin, Steps, Tag } from "antd";
import { ArrowRight, Check, CheckCircle2, Database, FolderCheck, HardDrive, LockKeyhole, RefreshCw, Server, ShieldCheck, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { BrandLogo } from "@/components/layout/brand-logo";
import { fetchAdminStorageConfig, fetchSetupStatus, completeStorageSetup, validateStorageSetup, type AdminStorageConfig, type SetupStatus, type StorageValidation } from "@/services/api/setup";
import { useUserStore } from "@/stores/use-user-store";

const copy = {
    "zh-CN": {
        title: "初始化无限画布",
        subtitle: "完成服务端存储配置后即可开始使用。",
        steps: ["环境检查", "存储位置", "默认策略", "完成"],
        environmentTitle: "环境检查",
        environmentDescription: "确认数据库、管理员和文件存储服务已经就绪。",
        database: "MySQL 数据库",
        admin: "管理员账户",
        storage: "文件存储",
        ready: "已就绪",
        pending: "待配置",
        pathTitle: "存储位置",
        pathDescription: "填写 API 容器内可访问的绝对路径。该目录将保存画布 JSON、输入素材和生成结果。",
        path: "SMB 存储路径",
        pathPlaceholder: "/mnt/smb/infinite-canvas",
        allowedRoots: "允许的根目录",
        validate: "检测路径",
        pathRequired: "请先填写并检测存储路径",
        writable: "可读写",
        mounted: "独立挂载",
        exists: "目录存在",
        marker: "目录可初始化",
        policyTitle: "默认策略",
        policyDescription: "这些参数以后可以在全局配置中调整。",
        maxUpload: "单文件上限",
        autosave: "自动保存间隔",
        retention: "回收站保留",
        initialize: "初始化存储",
        completeTitle: "初始化完成",
        completeDescription: "服务端存储已经就绪，现在可以进入画布。",
        enter: "进入主页",
        next: "继续",
        back: "上一步",
        retry: "重试",
        adminOnly: "只有管理员可以完成系统初始化。",
        adminOnlyDescription: "请联系管理员登录并完成存储配置。",
        alreadyReady: "系统已经完成初始化。",
        error: "操作失败",
        mb: "MB",
        seconds: "秒",
        days: "天",
    },
    "en-US": {
        title: "Initialize Infinite Canvas",
        subtitle: "Configure server storage before using the workspace.",
        steps: ["Environment", "Storage", "Defaults", "Complete"],
        environmentTitle: "Environment check",
        environmentDescription: "Confirm that the database, administrator account, and file storage are ready.",
        database: "MySQL database",
        admin: "Administrator account",
        storage: "File storage",
        ready: "Ready",
        pending: "Not configured",
        pathTitle: "Storage location",
        pathDescription: "Enter an absolute path visible inside the API container. Canvas JSON, input media, and generated results will be stored here.",
        path: "SMB storage path",
        pathPlaceholder: "/mnt/smb/infinite-canvas",
        allowedRoots: "Allowed roots",
        validate: "Check path",
        pathRequired: "Check a storage path before continuing",
        writable: "Read and write",
        mounted: "Mounted volume",
        exists: "Directory exists",
        marker: "Ready for initialization",
        policyTitle: "Default policies",
        policyDescription: "These values can be changed later in global settings.",
        maxUpload: "File size limit",
        autosave: "Autosave interval",
        retention: "Trash retention",
        initialize: "Initialize storage",
        completeTitle: "Initialization complete",
        completeDescription: "Server storage is ready. You can now open the workspace.",
        enter: "Enter workspace",
        next: "Continue",
        back: "Back",
        retry: "Retry",
        adminOnly: "Only an administrator can initialize the system.",
        adminOnlyDescription: "Ask an administrator to sign in and configure storage.",
        alreadyReady: "The system has already been initialized.",
        error: "Operation failed",
        mb: "MB",
        seconds: "seconds",
        days: "days",
    },
} as const;

function StatusRow({ icon, label, ready, readyLabel, pendingLabel }: { icon: ReactNode; label: string; ready: boolean; readyLabel: string; pendingLabel: string }) {
    return (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-stone-200 px-4 py-4 dark:border-stone-800">
            <div className="flex min-w-0 items-center gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-stone-100 dark:bg-stone-800">{icon}</span>
                <span className="truncate text-sm font-medium">{label}</span>
            </div>
            <Tag color={ready ? "success" : "warning"} bordered={false}>
                {ready ? readyLabel : pendingLabel}
            </Tag>
        </div>
    );
}

function CheckRow({ ok, label }: { ok: boolean; label: string }) {
    return (
        <div className="flex items-center gap-2 text-sm">
            {ok ? <Check className="size-4 text-emerald-500" /> : <X className="size-4 text-stone-400" />}
            <span className={ok ? "text-stone-700 dark:text-stone-200" : "text-stone-500"}>{label}</span>
        </div>
    );
}

export default function SetupPage() {
    const { i18n } = useTranslation();
    const language = i18n.resolvedLanguage === "en-US" ? "en-US" : "zh-CN";
    const text = copy[language];
    const navigate = useNavigate();
    const { message } = App.useApp();
    const user = useUserStore((state) => state.user);
    const [status, setStatus] = useState<SetupStatus | null>(null);
    const [adminStorage, setAdminStorage] = useState<AdminStorageConfig | null>(null);
    const [step, setStep] = useState(0);
    const [path, setPath] = useState("");
    const [validation, setValidation] = useState<StorageValidation | null>(null);
    const [maxUploadMb, setMaxUploadMb] = useState(500);
    const [autosaveMs, setAutosaveMs] = useState(1500);
    const [trashRetentionDays, setTrashRetentionDays] = useState(14);
    const [loading, setLoading] = useState(true);
    const [validating, setValidating] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [revision, setRevision] = useState(0);
    const isAdmin = user?.role === "admin";

    useEffect(() => {
        let active = true;
        setLoading(true);
        setError("");
        Promise.all([fetchSetupStatus(), isAdmin ? fetchAdminStorageConfig() : Promise.resolve(null)])
            .then(([nextStatus, nextStorage]) => {
                if (!active) return;
                setStatus(nextStatus);
                setAdminStorage(nextStorage);
                if (nextStorage?.settings) {
                    setPath(nextStorage.settings.root);
                    setMaxUploadMb(nextStorage.settings.maxUploadMb);
                    setAutosaveMs(nextStorage.settings.autosaveMs);
                    setTrashRetentionDays(nextStorage.settings.trashRetentionDays);
                }
            })
            .catch((reason) => {
                if (active) setError(reason instanceof Error ? reason.message : text.error);
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [isAdmin, revision, text.error]);

    const statusItems = useMemo(
        () => [
            { icon: <Database className="size-4" />, label: text.database, ready: Boolean(status?.databaseReady) },
            { icon: <ShieldCheck className="size-4" />, label: text.admin, ready: Boolean(status?.adminReady) },
            { icon: <HardDrive className="size-4" />, label: text.storage, ready: Boolean(status?.storageReady) },
        ],
        [status, text.admin, text.database, text.storage],
    );

    const validate = async () => {
        if (!path.trim()) {
            message.warning(text.pathRequired);
            return;
        }
        setValidating(true);
        setError("");
        try {
            const result = await validateStorageSetup(path.trim());
            setValidation(result);
            if (!result.valid) setError(result.message);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : text.error);
        } finally {
            setValidating(false);
        }
    };

    const initialize = async () => {
        setSaving(true);
        setError("");
        try {
            await completeStorageSetup({ path: path.trim(), maxUploadMb, autosaveMs, trashRetentionDays });
            setStep(3);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : text.error);
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex h-dvh items-center justify-center bg-background">
                <Spin size="large" />
            </div>
        );
    }

    if (!isAdmin) {
        return (
            <div className="flex min-h-dvh items-center justify-center bg-background px-6">
                <div className="max-w-md text-center">
                    <LockKeyhole className="mx-auto size-10 text-stone-400" />
                    <h1 className="mt-5 text-xl font-semibold">{text.adminOnly}</h1>
                    <p className="mt-2 text-sm text-stone-500">{text.adminOnlyDescription}</p>
                </div>
            </div>
        );
    }

    if (status && !status.setupRequired && step < 3) {
        return (
            <div className="flex min-h-dvh items-center justify-center bg-background px-6">
                <div className="max-w-md text-center">
                    <CheckCircle2 className="mx-auto size-10 text-emerald-500" />
                    <h1 className="mt-5 text-xl font-semibold">{text.alreadyReady}</h1>
                    <Button type="primary" className="mt-6" onClick={() => navigate("/", { replace: true })}>
                        {text.enter}
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="relative min-h-dvh overflow-y-auto bg-background bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px] dark:bg-[radial-gradient(rgba(245,245,244,.16)_1px,transparent_1px)]">
            <header className="flex h-14 items-center border-b border-stone-200 bg-background/90 px-6 backdrop-blur-xl dark:border-stone-800">
                <div className="flex items-center gap-2 text-sm font-semibold">
                    <BrandLogo className="h-5 w-auto max-w-24" />
                    <span>{text.title}</span>
                </div>
                <Button type="text" className="ml-auto" icon={<RefreshCw className="size-4" />} onClick={() => setRevision((value) => value + 1)}>
                    {text.retry}
                </Button>
            </header>

            <main className="mx-auto max-w-4xl px-6 py-10">
                <div className="mb-8">
                    <h1 className="text-3xl font-semibold tracking-tight">{text.title}</h1>
                    <p className="mt-2 text-sm text-stone-500">{text.subtitle}</p>
                </div>
                <Steps current={step} items={text.steps.map((title) => ({ title }))} className="mb-8" />

                <section className="rounded-2xl border border-stone-200 bg-background/95 p-6 shadow-sm dark:border-stone-800">
                    {error ? <Alert className="mb-5" type="error" showIcon message={text.error} description={error} /> : null}

                    {step === 0 ? (
                        <div>
                            <h2 className="text-lg font-semibold">{text.environmentTitle}</h2>
                            <p className="mt-1 text-sm text-stone-500">{text.environmentDescription}</p>
                            <div className="mt-6 grid gap-3 md:grid-cols-3">
                                {statusItems.map((item) => (
                                    <StatusRow key={item.label} icon={item.icon} label={item.label} ready={item.ready} readyLabel={text.ready} pendingLabel={text.pending} />
                                ))}
                            </div>
                            <div className="mt-8 flex justify-end">
                                <Button type="primary" disabled={!status?.databaseReady || !status.adminReady} onClick={() => setStep(1)} icon={<ArrowRight className="size-4" />} iconPlacement="end">
                                    {text.next}
                                </Button>
                            </div>
                        </div>
                    ) : null}

                    {step === 1 ? (
                        <div>
                            <h2 className="text-lg font-semibold">{text.pathTitle}</h2>
                            <p className="mt-1 text-sm text-stone-500">{text.pathDescription}</p>
                            <div className="mt-6">
                                <label className="mb-2 block text-sm font-medium">{text.path}</label>
                                <div className="flex flex-col gap-2 sm:flex-row">
                                    <Input prefix={<HardDrive className="size-4 text-stone-400" />} value={path} placeholder={text.pathPlaceholder} onChange={(event) => { setPath(event.target.value); setValidation(null); }} />
                                    <Button icon={<FolderCheck className="size-4" />} loading={validating} onClick={() => void validate()}>
                                        {text.validate}
                                    </Button>
                                </div>
                                {adminStorage?.allowedRoots.length ? (
                                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-stone-500">
                                        <span>{text.allowedRoots}:</span>
                                        {adminStorage.allowedRoots.map((root) => <Tag key={root}>{root}</Tag>)}
                                    </div>
                                ) : null}
                                {validation ? (
                                    <div className="mt-5 grid gap-3 rounded-xl border border-stone-200 p-4 dark:border-stone-800 sm:grid-cols-2 lg:grid-cols-4">
                                        <CheckRow ok={validation.mounted} label={text.mounted} />
                                        <CheckRow ok={validation.exists} label={text.exists} />
                                        <CheckRow ok={validation.writable} label={text.writable} />
                                        <CheckRow ok={validation.initialized || validation.empty} label={text.marker} />
                                    </div>
                                ) : null}
                            </div>
                            <div className="mt-8 flex justify-between">
                                <Button onClick={() => setStep(0)}>{text.back}</Button>
                                <Button type="primary" disabled={!validation?.valid} onClick={() => setStep(2)} icon={<ArrowRight className="size-4" />} iconPlacement="end">
                                    {text.next}
                                </Button>
                            </div>
                        </div>
                    ) : null}

                    {step === 2 ? (
                        <div>
                            <h2 className="text-lg font-semibold">{text.policyTitle}</h2>
                            <p className="mt-1 text-sm text-stone-500">{text.policyDescription}</p>
                            <div className="mt-6 grid gap-5 md:grid-cols-3">
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
                            <div className="mt-8 flex justify-between">
                                <Button onClick={() => setStep(1)}>{text.back}</Button>
                                <Button type="primary" loading={saving} onClick={() => void initialize()} icon={<Server className="size-4" />}>
                                    {text.initialize}
                                </Button>
                            </div>
                        </div>
                    ) : null}

                    {step === 3 ? (
                        <div className="py-8 text-center">
                            <CheckCircle2 className="mx-auto size-14 text-emerald-500" />
                            <h2 className="mt-5 text-2xl font-semibold">{text.completeTitle}</h2>
                            <p className="mt-2 text-sm text-stone-500">{text.completeDescription}</p>
                            <Button type="primary" size="large" className="mt-7" onClick={() => navigate("/", { replace: true })}>
                                {text.enter}
                            </Button>
                        </div>
                    ) : null}
                </section>
            </main>
        </div>
    );
}
