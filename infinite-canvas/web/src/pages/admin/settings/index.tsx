import { Save, UploadCloud } from "lucide-react";
import { useEffect, useState } from "react";
import { App, Button, Form, Input, Upload } from "antd";
import type { UploadProps } from "antd";
import { Navigate } from "react-router-dom";

import { BrandLogo } from "@/components/layout/brand-logo";
import { BRANDING_LOGO_TYPES, MAX_BRANDING_LOGO_BYTES, updateBrandingCompanyName, uploadBrandingLogo } from "@/services/api/branding";
import { useBrandingStore } from "@/stores/use-branding-store";
import { useUserStore } from "@/stores/use-user-store";

type BrandingValues = {
    companyName: string;
};

export default function AdminSettingsPage() {
    const currentUser = useUserStore((state) => state.user);
    if (!currentUser || currentUser.role !== "admin") return <Navigate to="/" replace />;
    return <AdminSettings />;
}

function AdminSettings() {
    const { message } = App.useApp();
    const [form] = Form.useForm<BrandingValues>();
    const companyName = useBrandingStore((state) => state.companyName);
    const applyBranding = useBrandingStore((state) => state.applyBranding);
    const [savingName, setSavingName] = useState(false);
    const [uploadingLogo, setUploadingLogo] = useState(false);

    useEffect(() => {
        form.setFieldsValue({ companyName });
    }, [companyName, form]);

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

    const beforeUpload: UploadProps["beforeUpload"] = async (file) => {
        if (!BRANDING_LOGO_TYPES.includes(file.type)) {
            message.error("Logo 仅支持 PNG、JPEG 或 WebP");
            return Upload.LIST_IGNORE;
        }
        if (file.size > MAX_BRANDING_LOGO_BYTES) {
            message.error("Logo 图片不能超过 2 MB");
            return Upload.LIST_IGNORE;
        }
        setUploadingLogo(true);
        try {
            applyBranding(await uploadBrandingLogo(file));
            message.success("Logo 已更新");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "上传 Logo 失败");
        } finally {
            setUploadingLogo(false);
        }
        return Upload.LIST_IGNORE;
    };

    return (
        <main className="h-full overflow-y-auto bg-background">
            <div className="mx-auto max-w-4xl px-6 py-7">
                <div className="mb-6">
                    <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">全局管理</h1>
                    <p className="mt-1 text-sm text-stone-500">管理所有用户都能看到的公司名称和品牌 Logo。</p>
                </div>

                <div className="grid gap-5 md:grid-cols-2">
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
                        <h2 className="text-base font-medium">公司 Logo</h2>
                        <p className="mt-1 text-sm text-stone-500">支持 PNG、JPEG、WebP，最大 2 MB。</p>
                        <div className="my-5 flex min-h-24 items-center justify-center rounded-lg border border-dashed border-stone-300 bg-white p-5 dark:border-stone-700">
                            <BrandLogo className="h-12 max-w-56" invertOnDark={false} />
                        </div>
                        <Upload.Dragger accept="image/png,image/jpeg,image/webp" maxCount={1} showUploadList={false} beforeUpload={beforeUpload} disabled={uploadingLogo}>
                            <p className="ant-upload-drag-icon">
                                <UploadCloud className="mx-auto size-6 text-stone-500" />
                            </p>
                            <p className="ant-upload-text">{uploadingLogo ? "正在上传..." : "点击或拖拽图片到这里"}</p>
                            <p className="ant-upload-hint">公司 Logo 会立即应用到所有页面</p>
                        </Upload.Dragger>
                    </section>
                </div>
            </div>
        </main>
    );
}
