import { useEffect, useRef, useState } from "react";
import { Button, Input } from "antd";
import { useQueryClient } from "@tanstack/react-query";
import { PlugZap } from "lucide-react";

import { loginCgtw, type CgtwSession } from "@/services/api/cgtw";

export const CGTW_SESSION_KEY = ["cgtw", "session"];

/** Agent 不可达或未登录 CGTW 时显示的连接引导。 */
export function CgtwConnect({ session, error }: { session?: CgtwSession; error?: Error | null }) {
    const queryClient = useQueryClient();
    const [account, setAccount] = useState({ server: "", account: "", password: "" });
    const [busy, setBusy] = useState(false);
    const [loginError, setLoginError] = useState("");
    const triedAuto = useRef(false);
    const bridgeReady = !!session;

    const refresh = () => queryClient.invalidateQueries({ queryKey: CGTW_SESSION_KEY });
    const login = async (input: Parameters<typeof loginCgtw>[0]) => {
        setBusy(true);
        setLoginError("");
        try {
            await loginCgtw(input);
            refresh();
        } catch (loginFailure) {
            setLoginError(loginFailure instanceof Error ? loginFailure.message : "登录失败");
        } finally {
            setBusy(false);
        }
    };

    // 桥接服务已连通但未登录时，先静默尝试一次本机 CGTW 客户端登录态
    useEffect(() => {
        if (!bridgeReady || triedAuto.current) return;
        triedAuto.current = true;
        void login({});
    }, [bridgeReady]);

    return (
        <div className="flex flex-1 items-start justify-center overflow-auto p-4">
            <div className="w-full space-y-5 rounded-xl border border-stone-200 p-5 dark:border-stone-800">
                <div className="flex items-center gap-2 text-base font-medium">
                    <PlugZap className="size-4" />
                    连接 CGTW
                </div>
                {bridgeReady ? (
                    <div className="space-y-4">
                        <p className="text-sm text-stone-500">桥接服务已连接，请登录 CGTW。优先使用本机 CGTW 客户端的登录态，不需要输入密码。</p>
                        <Button type="primary" block loading={busy} onClick={() => login({})}>
                            使用本机 CGTW 客户端登录
                        </Button>
                        <div className="space-y-2 border-t border-stone-200 pt-4 dark:border-stone-800">
                            <div className="text-xs text-stone-500">或使用账号密码（密码只保存在桥接服务内存中）</div>
                            <Input placeholder="服务器地址，例如 192.168.1.251" value={account.server} onChange={(event) => setAccount({ ...account, server: event.target.value })} />
                            <Input placeholder="账号" value={account.account} onChange={(event) => setAccount({ ...account, account: event.target.value })} />
                            <Input.Password placeholder="密码" value={account.password} onChange={(event) => setAccount({ ...account, password: event.target.value })} onPressEnter={() => login(account)} />
                            <Button block disabled={!account.account || !account.password} loading={busy} onClick={() => login(account)}>
                                账号密码登录
                            </Button>
                        </div>
                        {loginError ? <p className="text-sm text-red-500">{loginError}</p> : null}
                    </div>
                ) : (
                    <div className="space-y-3">
                        <p className="text-sm text-stone-500">{error?.message || "未连接本机 Canvas Agent。"}</p>
                        <p className="text-sm text-stone-500">CGTW 功能由本机 Canvas Agent Manager 提供：请启动 Manager，并在右上角 Agent 面板里连接一次本机 Agent（和使用 Agent 对话的连接方式相同）。</p>
                        <Button type="primary" block onClick={refresh}>
                            重新检测
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
}
