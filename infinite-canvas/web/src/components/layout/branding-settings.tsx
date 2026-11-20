import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, RotateCcw, Save, UploadCloud } from "lucide-react";
import { useEffect, useState } from "react";
import { App, Button, Form, Input, InputNumber, Segmented, Upload } from "antd";
import type { UploadProps } from "antd";

import { BrandLogo } from "@/components/layout/brand-logo";
import {
    BRANDING_LOGO_TYPES,
    LOGIN_LOGO_OFFSET_LIMIT,
    MAX_BRANDING_LOGO_BYTES,
    updateBrandingCompanyName,
    updateLoginBackground,
    updateLoginLogoOffset,
    uploadBrandingLogo,
    type BrandingLogoVariant,
    type LoginBackgroundMode,
} from "@/services/api/branding";
import { useBrandingStore } from "@/stores/use-branding-store";
import { cn } from "@/lib/utils";

type BrandingValues = {
    companyName: string;
};

function clampLogoOffset(value: number) {
    return Math.min(LOGIN_LOGO_OFFSET_LIMIT, Math.max(-LOGIN_LOGO_OFFSET_LIMIT, Math.round(value)));
}

function isDefaultLogo(url: string) {
    return url === "/logo.svg" || url === "/brand/logo.svg";
}

export function BrandingSettings() {
    const { message } = App.useApp();
    const [form] = Form.useForm<BrandingValues>();
    const companyName = useBrandingStore((state) => state.companyName);
    const darkLogoUrl = useBrandingStore((state) => state.darkLogoUrl);
    const logoUrl = useBrandingStore((state) => state.logoUrl);
    const loginBackground = useBrandingStore((state) => state.loginBackground);
    const loginLogoOffsetX = useBrandingStore((state) => state.loginLogoOffsetX);
    const loginLogoOffsetY = useBrandingStore((state) => state.loginLogoOffsetY);
    const applyBranding = useBrandingStore((state) => state.applyBranding);
    const [savingName, setSavingName] = useState(false);
    const [savingBackground, setSavingBackground] = useState(false);
    const [savingLogoOffset, setSavingLogoOffset] = useState(false);
    const [uploadingLogo, setUploadingLogo] = useState<BrandingLogoVariant | null>(null);
    const [logoOffsetX, setLogoOffsetX] = useState(loginLogoOffsetX);
    const [logoOffsetY, setLogoOffsetY] = useState(loginLogoOffsetY);

    useEffect(() => {
        form.setFieldsValue({ companyName });
    }, [companyName, form]);

    useEffect(() => {
        setLogoOffsetX(loginLogoOffsetX);
        setLogoOffsetY(loginLogoOffsetY);
    }, [loginLogoOffsetX, loginLogoOffsetY]);

    const saveCompanyName = async ({ companyName: value }: BrandingValues) => {
        setSavingName(true);
        try {
            applyBranding(await updateBrandingCompanyName(value.trim()));
            message.success("公司名称已更新");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存公司名称失败");
        } finally {
            setSavingName(false);
        }
    };

    const logoUploadHandler = (variant: BrandingLogoVariant): UploadProps["beforeUpload"] => async (file) => {
        if (!BRANDING_LOGO_TYPES.includes(file.type)) {
            message.error("Logo 仅支持 PNG、JPEG 或 WebP");
            return Upload.LIST_IGNORE;
        }
        if (file.size > MAX_BRANDING_LOGO_BYTES) {
            message.error("Logo 图片不能超过 2 MB");
            return Upload.LIST_IGNORE;
        }
        setUploadingLogo(variant);
        try {
            applyBranding(await uploadBrandingLogo(file, variant));
            message.success(variant === "dark" ? "深色主题 Logo 已更新" : "浅色主题 Logo 已更新");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "上传 Logo 失败");
        } finally {
            setUploadingLogo(null);
        }
        return Upload.LIST_IGNORE;
    };

    const saveLoginBackground = async (value: LoginBackgroundMode) => {
        if (value === loginBackground) return;
        setSavingBackground(true);
        try {
            applyBranding(await updateLoginBackground(value));
            message.success(value === "nebula" ? "登录页已切换为星云背景" : "登录页已恢复原始界面");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存登录页背景失败");
        } finally {
            setSavingBackground(false);
        }
    };

    const saveLogoOffset = async () => {
        setSavingLogoOffset(true);
        try {
            applyBranding(await updateLoginLogoOffset(logoOffsetX, logoOffsetY));
            message.success("登录页 Logo 偏移已更新");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存 Logo 偏移失败");
        } finally {
            setSavingLogoOffset(false);
        }
    };

    const nudgeLogo = (deltaX: number, deltaY: number) => {
        setLogoOffsetX((value) => clampLogoOffset(value + deltaX));
        setLogoOffsetY((value) => clampLogoOffset(value + deltaY));
    };

    return (
        <div className="space-y-5">
            <div className="grid auto-rows-max items-start gap-5 md:grid-cols-2">
                <div className="space-y-5">
                    <section className="rounded-xl border border-stone-200 p-5 dark:border-stone-800">
                        <h2 className="text-base font-medium">公司名称</h2>
                        <p className="mt-1 text-sm text-stone-500">用于登录页、首页、顶部导航和浏览器标题。</p>
                        <Form form={form} layout="vertical" requiredMark={false} onFinish={(values) => void saveCompanyName(values)} className="mt-5">
                            <Form.Item label="名称" name="companyName" rules={[{ required: true, whitespace: true, message: "请输入公司名称" }, { max: 100, message: "公司名称不能超过 100 个字符" }]}>
                                <Input size="large" maxLength={100} showCount />
                            </Form.Item>
                            <Button type="primary" htmlType="submit" loading={savingName} icon={<Save className="size-4" />}>
                                保存名称
                            </Button>
                        </Form>
                    </section>

                    <section className="rounded-xl border border-stone-200 p-5 dark:border-stone-800">
                        <h2 className="text-base font-medium">登录页 Logo 偏移</h2>
                        <p className="mt-1 text-sm text-stone-500">负数向左或向上，正数向右或向下，单位为像素。</p>
                        <div className="mt-5 grid gap-4 sm:grid-cols-2">
                            <label className="text-sm text-stone-600 dark:text-stone-300">
                                水平偏移
                                <InputNumber
                                    className="mt-2 !w-full"
                                    value={logoOffsetX}
                                    min={-LOGIN_LOGO_OFFSET_LIMIT}
                                    max={LOGIN_LOGO_OFFSET_LIMIT}
                                    precision={0}
                                    addonAfter="px"
                                    onChange={(value) => setLogoOffsetX(clampLogoOffset(Number(value ?? 0)))}
                                />
                            </label>
                            <label className="text-sm text-stone-600 dark:text-stone-300">
                                垂直偏移
                                <InputNumber
                                    className="mt-2 !w-full"
                                    value={logoOffsetY}
                                    min={-LOGIN_LOGO_OFFSET_LIMIT}
                                    max={LOGIN_LOGO_OFFSET_LIMIT}
                                    precision={0}
                                    addonAfter="px"
                                    onChange={(value) => setLogoOffsetY(clampLogoOffset(Number(value ?? 0)))}
                                />
                            </label>
                        </div>
                        <div className="relative mt-4 h-20 overflow-hidden rounded-lg border border-stone-200 bg-[radial-gradient(rgba(120,113,108,.22)_1px,transparent_1px)] [background-size:12px_12px] dark:border-stone-800">
                            <span className="absolute inset-y-0 left-1/2 w-px bg-stone-300 dark:bg-stone-700" />
                            <span className="absolute inset-x-0 top-1/2 h-px bg-stone-300 dark:bg-stone-700" />
                            <span className="absolute left-3 top-2 rounded bg-background/80 px-1.5 py-0.5 text-xs text-stone-500">
                                X {logoOffsetX}px · Y {logoOffsetY}px
                            </span>
                            <div
                                className="absolute left-1/2 top-1/2"
                                style={{ transform: `translate(calc(-50% + ${logoOffsetX}px), calc(-50% + ${logoOffsetY}px))` }}
                            >
                                <BrandLogo className="h-10 w-auto max-w-32" />
                            </div>
                        </div>
                        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                            <div className="flex gap-1.5">
                                <Button size="small" title="上移 1px" aria-label="上移 1px" icon={<ArrowUp className="size-4" />} onClick={() => nudgeLogo(0, -1)} />
                                <Button size="small" title="下移 1px" aria-label="下移 1px" icon={<ArrowDown className="size-4" />} onClick={() => nudgeLogo(0, 1)} />
                                <Button size="small" title="左移 1px" aria-label="左移 1px" icon={<ArrowLeft className="size-4" />} onClick={() => nudgeLogo(-1, 0)} />
                                <Button size="small" title="右移 1px" aria-label="右移 1px" icon={<ArrowRight className="size-4" />} onClick={() => nudgeLogo(1, 0)} />
                            </div>
                            <div className="flex gap-2">
                                <Button
                                    icon={<RotateCcw className="size-4" />}
                                    onClick={() => {
                                        setLogoOffsetX(0);
                                        setLogoOffsetY(0);
                                    }}
                                >
                                    归零
                                </Button>
                                <Button type="primary" loading={savingLogoOffset} icon={<Save className="size-4" />} onClick={() => void saveLogoOffset()}>
                                    保存偏移
                                </Button>
                            </div>
                        </div>
                    </section>
                </div>

                <section className="rounded-xl border border-stone-200 p-5 dark:border-stone-800">
                    <h2 className="text-base font-medium">公司 Logo</h2>
                    <p className="mt-1 text-sm text-stone-500">分别上传浅色主题和深色主题使用的 Logo，支持 PNG、JPEG、WebP，最大 2 MB。</p>
                    <div className="mt-5 grid gap-4 lg:grid-cols-2">
                        <div className="space-y-3">
                            <div>
                                <h3 className="text-sm font-medium">浅色主题 Logo</h3>
                                <p className="mt-0.5 text-xs text-stone-500">建议使用深色图形，显示在浅色背景上。</p>
                            </div>
                            <div className="flex min-h-24 items-center justify-center rounded-lg border border-dashed border-stone-300 bg-white p-4">
                                <img src={logoUrl} alt="" aria-hidden className="h-12 max-w-full object-contain" />
                            </div>
                            <Upload.Dragger className="!block h-40" accept="image/png,image/jpeg,image/webp" maxCount={1} showUploadList={false} beforeUpload={logoUploadHandler("light")} disabled={uploadingLogo !== null}>
                                <p className="ant-upload-drag-icon">
                                    <UploadCloud className="mx-auto size-5 text-stone-500" />
                                </p>
                                <p className="ant-upload-text">{uploadingLogo === "light" ? "正在上传..." : "上传浅色主题 Logo"}</p>
                                <p className="ant-upload-hint">点击或拖拽图片到这里</p>
                            </Upload.Dragger>
                        </div>
                        <div className="space-y-3">
                            <div>
                                <h3 className="text-sm font-medium">深色主题 Logo</h3>
                                <p className="mt-0.5 text-xs text-stone-500">建议使用浅色图形，显示在深色背景上。</p>
                            </div>
                            <div className="flex min-h-24 items-center justify-center rounded-lg border border-dashed border-stone-700 bg-stone-950 p-4">
                                <img src={darkLogoUrl} alt="" aria-hidden className={cn("h-12 max-w-full object-contain", isDefaultLogo(darkLogoUrl) && "invert")} />
                            </div>
                            <Upload.Dragger className="!block h-40" accept="image/png,image/jpeg,image/webp" maxCount={1} showUploadList={false} beforeUpload={logoUploadHandler("dark")} disabled={uploadingLogo !== null}>
                                <p className="ant-upload-drag-icon">
                                    <UploadCloud className="mx-auto size-5 text-stone-500" />
                                </p>
                                <p className="ant-upload-text">{uploadingLogo === "dark" ? "正在上传..." : "上传深色主题 Logo"}</p>
                                <p className="ant-upload-hint">点击或拖拽图片到这里</p>
                            </Upload.Dragger>
                        </div>
                    </div>
                </section>
            </div>

            <section className="rounded-xl border border-stone-200 p-5 dark:border-stone-800">
                <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
                    <div>
                        <h2 className="text-base font-medium">登录页背景</h2>
                        <p className="mt-1 text-sm text-stone-500">选择所有用户看到的登录页样式。</p>
                    </div>
                    <Segmented<LoginBackgroundMode>
                        value={loginBackground}
                        disabled={savingBackground}
                        options={[
                            { label: "原始登录页", value: "original" },
                            { label: "星云动态背景", value: "nebula" },
                        ]}
                        onChange={(value) => void saveLoginBackground(value)}
                    />
                </div>
            </section>
        </div>
    );
}
