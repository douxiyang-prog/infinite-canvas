import { useEffect } from "react";
import { Spin } from "antd";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { useUserStore } from "@/stores/use-user-store";

export function RequireAuth() {
    const location = useLocation();
    const status = useUserStore((state) => state.status);
    const loadSession = useUserStore((state) => state.loadSession);

    useEffect(() => {
        void loadSession();
    }, [loadSession]);

    if (status === "idle" || status === "loading") {
        return (
            <div className="flex h-dvh items-center justify-center bg-background">
                <Spin size="large" />
            </div>
        );
    }
    if (status === "anonymous") {
        return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
    }
    return <Outlet />;
}
