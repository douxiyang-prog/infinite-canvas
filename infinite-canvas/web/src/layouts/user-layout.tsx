import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

import { AgentPanel } from "@/components/agent/agent-panel";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppTopNav } from "@/components/layout/app-top-nav";
import { prepareCanvasStoreForSession, useCanvasStore } from "@/stores/canvas/use-canvas-store";

export default function UserLayout({ children }: { children: ReactNode }) {
    const bootstrapped = useRef(false);
    useEffect(() => {
        if (bootstrapped.current) return;
        bootstrapped.current = true;
        prepareCanvasStoreForSession();
        void useCanvasStore.persist.rehydrate();
    }, []);

    return (
        <div className="flex h-dvh overflow-hidden bg-background text-foreground">
            <AppSidebar />
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <AppTopNav />
                <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
            </div>
            <AgentPanel />
        </div>
    );
}
