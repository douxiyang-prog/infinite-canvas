import { LogIn } from "lucide-react";
import { useEffect, useState } from "react";
import { App, Button, Form, Input } from "antd";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

import { BrandLogo } from "@/components/layout/brand-logo";
import { useBrandingStore } from "@/stores/use-branding-store";
import { useUserStore } from "@/stores/use-user-store";

type LoginValues = {
    username: string;
    password: string;
};

export default function LoginPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const location = useLocation();
    const user = useUserStore((state) => state.user);
    const companyName = useBrandingStore((state) => state.companyName);
    const login = useUserStore((state) => state.login);
    const loadSession = useUserStore((state) => state.loadSession);
    const [submitting, setSubmitting] = useState(false);
    const from = typeof (location.state as { from?: unknown } | null)?.from === "string" ? (location.state as { from: string }).from : "/";

    useEffect(() => {
        void loadSession();
    }, [loadSession]);

    if (user) return <Navigate to={from} replace />;

    const submit = async (values: LoginValues) => {
        setSubmitting(true);
        try {
            await login(values.username, values.password);
            navigate(from, { replace: true });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "登录失败");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <main className="flex min-h-dvh items-center justify-center bg-background bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] px-6 py-10 text-foreground [background-size:16px_16px] dark:bg-[radial-gradient(rgba(245,245,244,.16)_1px,transparent_1px)]">
            <section className="w-full max-w-[420px] rounded-2xl border border-stone-200 bg-background p-7 shadow-sm dark:border-stone-800">
                <div className="mb-7 flex items-center gap-3">
                    <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-stone-800 bg-stone-950">
                        <BrandLogo className="size-6" invertOnDark={false} />
                    </span>
                    <div>
                        <h1 className="text-xl font-semibold">登录{companyName || "无限画布"}</h1>
                        <p className="mt-1 text-sm text-stone-500">使用管理员分配给你的账号继续</p>
                    </div>
                </div>

                <Form<LoginValues> layout="vertical" requiredMark={false} onFinish={(values) => void submit(values)}>
                    <Form.Item label="用户名" name="username" rules={[{ required: true, message: "请输入用户名" }]}>
                        <Input size="large" autoComplete="username" autoFocus />
                    </Form.Item>
                    <Form.Item label="密码" name="password" rules={[{ required: true, message: "请输入密码" }]}>
                        <Input.Password size="large" autoComplete="current-password" />
                    </Form.Item>
                    <Button className="mt-2 w-full" type="primary" size="large" htmlType="submit" loading={submitting} icon={<LogIn className="size-4" />}>
                        登录
                    </Button>
                </Form>
            </section>
        </main>
    );
}
