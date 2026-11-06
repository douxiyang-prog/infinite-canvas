import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { App } from "antd";
import { useTranslation } from "react-i18next";

import { useConfigStore } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { usePromptSourceScheduler } from "@/hooks/use-prompt-source-scheduler";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message, modal } = App.useApp();
    const { i18n, t } = useTranslation();
    const handledConfigParams = useRef(false);
    const shownConflicts = useRef(new Set<string>());
    const lastSessionReplacementAt = useRef(0);
    const user = useUserStore((state) => state.user);
    const configHydrated = useConfigStore((state) => state.hydrated);
    const importChannelCredentials = useConfigStore((state) => state.importChannelCredentials);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);

    usePromptSourceScheduler();

    useEffect(() => {
        const handleSessionReplaced = () => {
            if (Date.now() - lastSessionReplacementAt.current < 1000) return;
            lastSessionReplacementAt.current = Date.now();
            useUserStore.getState().clearSession();
            message.warning(i18n.resolvedLanguage === "en-US" ? "This account was signed in elsewhere. The current session has expired." : "该账号已在其他设备登录，当前会话已失效，请重新登录。");
        };
        window.addEventListener("session-replaced", handleSessionReplaced);
        return () => window.removeEventListener("session-replaced", handleSessionReplaced);
    }, [i18n.resolvedLanguage, message]);

    useEffect(() => {
        const handleStorageError = (event: Event) => {
            const detail = (event as CustomEvent<unknown>).detail;
            const description = typeof detail === "string" ? detail : i18n.resolvedLanguage === "en-US" ? "Unknown storage error" : "未知存储错误";
            message.error(i18n.resolvedLanguage === "en-US" ? `Canvas save failed: ${description}` : `画布保存失败：${description}`);
        };
        window.addEventListener("canvas-storage-error", handleStorageError);
        return () => window.removeEventListener("canvas-storage-error", handleStorageError);
    }, [i18n.resolvedLanguage, message]);

    useEffect(() => {
        const handleStorageConflict = (event: Event) => {
            const detail = (event as CustomEvent<{ projectId?: string; message?: string }>).detail;
            const projectId = detail?.projectId || "unknown";
            if (shownConflicts.current.has(projectId)) return;
            shownConflicts.current.add(projectId);
            const english = i18n.resolvedLanguage === "en-US";
            modal.confirm({
                title: english ? "Canvas version conflict" : "画布版本冲突",
                content: english
                    ? "This canvas was updated in another page. The current page has stopped saving to avoid overwriting newer content. Reload to continue with the latest version."
                    : "该画布已在其他页面更新。为避免覆盖较新的内容，当前页面已停止继续保存。请重新加载最新版本后继续编辑。",
                okText: english ? "Reload" : "重新加载",
                cancelText: english ? "Keep viewing" : "暂不处理",
                onOk: () => window.location.reload(),
            });
        };
        window.addEventListener("canvas-storage-conflict", handleStorageConflict);
        return () => window.removeEventListener("canvas-storage-conflict", handleStorageConflict);
    }, [i18n.resolvedLanguage, modal]);

    useEffect(() => {
        if (handledConfigParams.current || !configHydrated || user?.role !== "admin") return;
        const searchParams = new URLSearchParams(window.location.search);
        const baseUrl = searchParams.get("baseUrl") || searchParams.get("baseurl");
        const apiKey = searchParams.get("apiKey") || searchParams.get("apikey");
        if (!baseUrl && !apiKey) return;
        handledConfigParams.current = true;
        searchParams.delete("baseUrl");
        searchParams.delete("baseurl");
        searchParams.delete("apiKey");
        searchParams.delete("apikey");
        window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);
        const result = importChannelCredentials({ baseUrl, apiKey });
        openConfigDialog(false, "channels");
        if (result.status === "created") message.success(t("config.importedChannelCreated", { name: result.channelName }));
        else if (result.status === "updated") message.success(t("config.importedChannelUpdated", { name: result.channelName }));
        else if (result.status === "missing-base-url") message.error(t("config.importedChannelBaseUrlRequired"));
        else message.error(t("config.importedChannelBaseUrlInvalid"));
    }, [configHydrated, importChannelCredentials, message, openConfigDialog, t, user?.role]);

    return <>{children}</>;
}
