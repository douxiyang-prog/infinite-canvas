import { useEffect } from "react";
import { App } from "antd";
import { useTranslation } from "react-i18next";

import { fetchGlobalConfig, fetchUserConfig, saveGlobalConfig, type GlobalConfigResponse } from "@/services/api/global-config";
import { useConfigStore } from "@/stores/use-config-store";
import { usePromptSourceStore } from "@/stores/use-prompt-source-store";
import { useUserStore } from "@/stores/use-user-store";

export function useGlobalConfigSync() {
    const { message } = App.useApp();
    const { i18n } = useTranslation();
    const user = useUserStore((state) => state.user);

    useEffect(() => {
        if (!user) return;
        let active = true;
        let ready = false;
        let version = 0;
        let saveTimer: ReturnType<typeof setTimeout> | null = null;
        let saving = false;
        let pending = false;

        const english = i18n.resolvedLanguage === "en-US";
        useConfigStore.getState().resetConfigForSession();

        const applySnapshot = (snapshot: GlobalConfigResponse) => {
            version = snapshot.version;
            useConfigStore.getState().applyGlobalConfig(
                snapshot.config || {
                    channels: [],
                },
                snapshot.webdav || {},
            );
            if (snapshot.promptSources) {
                usePromptSourceStore.getState().applyGlobalConfig(snapshot.promptSources.sources || [], snapshot.promptSources.schedule || {});
            }
        };

        if (user.role !== "admin") {
            const refresh = () =>
                fetchUserConfig()
                    .then((snapshot) => {
                        if (!active) return;
                        applySnapshot(snapshot);
                    })
                    .catch((error) => {
                        if (!active) return;
                        const description = error instanceof Error ? error.message : String(error);
                        useConfigStore.getState().setConfigHydrated(true);
                        message.error(english ? `Could not load account channels: ${description}` : `账号渠道加载失败：${description}`);
                    });
            const refreshOnFocus = () => {
                if (document.visibilityState === "visible") void refresh();
            };
            void refresh();
            window.addEventListener("focus", refreshOnFocus);
            document.addEventListener("visibilitychange", refreshOnFocus);
            return () => {
                active = false;
                window.removeEventListener("focus", refreshOnFocus);
                document.removeEventListener("visibilitychange", refreshOnFocus);
            };
        }

        const flush = async () => {
            if (!active || !ready) return;
            if (saving) {
                pending = true;
                return;
            }
            saving = true;
            const { config, webdav } = useConfigStore.getState();
            const { sources, schedule } = usePromptSourceStore.getState();
            try {
                const saved = await saveGlobalConfig({ expectedVersion: version, config, webdav, promptSources: { sources, schedule } });
                version = saved.version;
            } catch (error) {
                ready = false;
                const description = error instanceof Error ? error.message : String(error);
                message.error(english ? `Global settings save failed: ${description}` : `全局设置保存失败：${description}`);
            } finally {
                saving = false;
                if (pending && ready && active) {
                    pending = false;
                    saveTimer = setTimeout(() => {
                        saveTimer = null;
                        void flush();
                    }, 700);
                }
            }
        };

        const scheduleSave = (delay = 700) => {
            if (!ready || user.role !== "admin") return;
            if (saveTimer) clearTimeout(saveTimer);
            saveTimer = setTimeout(() => {
                saveTimer = null;
                void flush();
            }, delay);
        };

        const unsubscribe = useConfigStore.subscribe((state, previous) => {
            if (state.config === previous.config && state.webdav === previous.webdav) return;
            scheduleSave();
        });
        const unsubscribePromptSources = usePromptSourceStore.subscribe((state, previous) => {
            if (state.sources === previous.sources && state.schedule === previous.schedule) return;
            scheduleSave();
        });

        fetchGlobalConfig()
            .then((snapshot) => {
                if (!active) return;
                version = snapshot.version;
                useConfigStore.getState().applyGlobalConfig(
                    snapshot.config || {
                        channels: [],
                    },
                    snapshot.webdav || {},
                );
                if (snapshot.promptSources) {
                    usePromptSourceStore.getState().applyGlobalConfig(snapshot.promptSources.sources || [], snapshot.promptSources.schedule || {});
                }
                ready = true;
                if ((!snapshot.config || !snapshot.promptSources) && user.role === "admin") scheduleSave(0);
            })
            .catch((error) => {
                if (!active) return;
                const description = error instanceof Error ? error.message : String(error);
                useConfigStore.getState().setConfigHydrated(true);
                message.error(english ? `Could not load global settings: ${description}` : `全局设置加载失败：${description}`);
            });

        return () => {
            active = false;
            unsubscribe();
            unsubscribePromptSources();
            if (saveTimer) clearTimeout(saveTimer);
        };
    }, [i18n.resolvedLanguage, message, user]);
}
