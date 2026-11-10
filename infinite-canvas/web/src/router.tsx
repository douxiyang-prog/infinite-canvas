import { createBrowserRouter, Navigate, Outlet, useLocation } from "react-router-dom";

import { RequireAuth } from "@/components/auth/require-auth";
import { RequireSetup } from "@/components/auth/require-setup";
import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import UserLayout from "@/layouts/user-layout";
import AdminSettingsPage from "@/pages/admin/settings";
import AssetsPage from "@/pages/assets";
import CanvasPage from "@/pages/canvas";
import CanvasProjectPage from "@/pages/canvas/project";
import HomePage from "@/pages/home";
import ImagePage from "@/pages/image";
import LoginPage from "@/pages/login";
import NotFound from "@/pages/not-found";
import PromptsPage from "@/pages/prompts";
import ProjectsPage from "@/pages/projects";
import ProjectDetailPage from "@/pages/projects/detail";
import ProjectAssetsPage from "@/pages/projects/assets";
import SetupPage from "@/pages/setup";
import VideoPage from "@/pages/video";

export const router = createBrowserRouter([
    { path: "/login", element: <LoginPage /> },
    {
        element: <RequireAuth />,
        children: [
            {
                element: (
                    <RequireSetup>
                        <UserLayout>
                            <AnalyticsTracker />
                            <Outlet />
                        </UserLayout>
                    </RequireSetup>
                ),
                children: [
                    { path: "/", element: <HomePage /> },
                    { path: "/image", element: <ImagePage /> },
                    { path: "/video", element: <VideoPage /> },
                    { path: "/assets", element: <AssetsPage /> },
                    { path: "/prompts", element: <PromptsPage /> },
                    { path: "/canvas", element: <CanvasPage /> },
                    { path: "/projects", element: <ProjectsPage /> },
                    { path: "/projects/:projectId", element: <ProjectDetailPage /> },
                    { path: "/projects/:projectId/assets", element: <ProjectAssetsPage /> },
                    { path: "/canvas/:id", element: <CanvasProjectPage /> },
                    { path: "/config", element: <Navigate to="/admin/settings" replace /> },
                    { path: "/admin/settings", element: <AdminSettingsPage /> },
                    { path: "/admin/user-channels", element: <AdminSettingsRedirect tab="user-channels" /> },
                    { path: "/admin/users", element: <AdminSettingsRedirect tab="users" /> },
                ],
            },
            { path: "/setup", element: <SetupPage /> },
        ],
    },
    { path: "*", element: <NotFound /> },
]);

function AdminSettingsRedirect({ tab }: { tab: string }) {
    const { search } = useLocation();
    const params = new URLSearchParams(search);
    params.set("tab", tab);
    return <Navigate to={`/admin/settings?${params.toString()}`} replace />;
}
