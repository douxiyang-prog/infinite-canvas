import { Navigate, useNavigate, useSearchParams } from "react-router-dom";

import { AppConfigPanel } from "@/components/layout/app-config-modal";
import type { ConfigTabKey } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

const ADMIN_TABS = new Set<ConfigTabKey>([
    "channels",
    "local-proxy",
    "preferences",
    "prompt-sources",
    "webdav",
    "local-storage",
    "server-storage",
    "project-scenes",
    "branding",
    "users",
    "user-channels",
]);

export default function AdminSettingsPage() {
    const currentUser = useUserStore((state) => state.user);
    if (!currentUser || currentUser.role !== "admin") return <Navigate to="/" replace />;
    return <AdminSettings />;
}

function AdminSettings() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const requestedTab = searchParams.get("tab") as ConfigTabKey | null;
    const initialTab = requestedTab && ADMIN_TABS.has(requestedTab) ? requestedTab : "channels";

    return (
        <main className="h-full overflow-y-auto bg-background">
            <div className="mx-auto max-w-6xl px-6 py-7">
                <div className="mb-6">
                    <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">全局设置</h1>
                    <p className="mt-1 text-sm text-stone-500">统一管理应用配置、项目场次、品牌和用户权限。</p>
                </div>
                <AppConfigPanel initialTab={initialTab} showAdminTabs onTabChange={(tab) => navigate(`/admin/settings?tab=${encodeURIComponent(tab)}`, { replace: true })} />
            </div>
        </main>
    );
}
