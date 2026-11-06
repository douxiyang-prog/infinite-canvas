import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { Spin } from "antd";

import { AgentPanel } from "@/components/agent/agent-panel";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppTopNav } from "@/components/layout/app-top-nav";
import { useGlobalConfigSync } from "@/hooks/use-global-config-sync";
import { prepareCanvasStoreForSession, useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { prepareAssetStoreForSession, useAssetStore } from "@/stores/use-asset-store";
import { useConfigStore } from "@/stores/use-config-store";

export default function UserLayout({ children }: { children: ReactNode }) {
    const bootstrapped = useRef(false);
    const configHydrated = useConfigStore((state) => state.hydrated);
    useGlobalConfigSync();
    useEffect(() => {
        if (bootstrapped.current) return;
        bootstrapped.current = true;
        prepareCanvasStoreForSession();
        prepareAssetStoreForSession();
        void useCanvasStore.persist.rehydrate();
        void useAssetStore.getState().loadAssets();
    }, []);

    return (
        <div className="flex h-dvh overflow-hidden bg-background text-foreground">
            <AppSidebar />
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <AppTopNav />
                <div className="min-h-0 flex-1 overflow-hidden">
                    {configHydrated ? children : (
                        <div className="flex h-full items-center justify-center bg-background">
                            <Spin size="large" />
                        </div>
                    )}
                </div>
            </div>
            <AgentPanel />
        </div>
    );
}
