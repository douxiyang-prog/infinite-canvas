import { LogIn } from "lucide-react";
import { useEffect, useState } from "react";
import { App, Button, Form, Input } from "antd";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

import { BrandLogo } from "@/components/layout/brand-logo";
import { LoginNebulaBackground } from "./components/login-nebula-background";
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
        <main className="relative isolate flex min-h-dvh items-center justify-center overflow-hidden px-6 py-10 text-foreground">
            <LoginNebulaBackground />
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(255,255,255,.08),transparent_42%)] dark:bg-[radial-gradient(circle_at_50%_42%,rgba(96,165,250,.08),transparent_42%)]" />
            <section className="relative z-10 w-full max-w-[420px] rounded-2xl border border-white/80 bg-white/78 p-7 shadow-[0_28px_90px_-32px_rgba(51,65,85,.45)] backdrop-blur-2xl dark:border-white/[.12] dark:bg-black/72 dark:shadow-[0_28px_100px_-28px_rgba(0,0,0,.95)]">
                <div className="mb-7 flex items-center gap-3">
                    <span className="grid size-14 shrink-0 place-items-center rounded-xl border border-stone-800 bg-stone-950">
                        <BrandLogo className="size-9" invertOnDark={false} />
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
