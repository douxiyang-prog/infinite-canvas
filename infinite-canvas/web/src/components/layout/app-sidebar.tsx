import { useEffect, useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Tooltip } from "antd";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { BrandLogo } from "@/components/layout/brand-logo";
import { navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { cn } from "@/lib/utils";
import { useBrandingStore } from "@/stores/use-branding-store";

const SIDEBAR_STORAGE_KEY = "infinite-canvas:sidebar-collapsed";

function SidebarLink({ tool, active, collapsed }: { tool: (typeof navigationTools)[number]; active: boolean; collapsed: boolean }) {
    const { t } = useTranslation();
    const Icon = tool.icon;
    const label = t(`navigation.${tool.slug}`);
    const link = (
        <Link
            to={`/${tool.slug}`}
            aria-current={active ? "page" : undefined}
            title={collapsed ? label : undefined}
            className={cn(
                "relative flex h-10 items-center rounded-lg text-sm transition-colors",
                collapsed ? "justify-center px-0" : "gap-3 px-3",
                active
                    ? "bg-stone-100 font-medium text-stone-950 before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-stone-950 dark:bg-stone-800 dark:text-stone-100 dark:before:bg-stone-100"
                    : "text-stone-500 hover:bg-stone-100 hover:text-stone-950 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100",
            )}
        >
            <Icon className="size-4 shrink-0" />
            {collapsed ? null : <span className="truncate">{label}</span>}
        </Link>
    );

    return collapsed ? (
        <Tooltip title={label} placement="right" mouseEnterDelay={0.25}>
            {link}
        </Tooltip>
    ) : (
        link
    );
}

export function AppSidebar() {
    const { t } = useTranslation();
    const { pathname } = useLocation();
    const companyName = useBrandingStore((state) => state.companyName);
    const slug = pathname.split("/").filter(Boolean)[0];
    const activeToolSlug = navigationTools.some((tool) => tool.slug === slug) ? (slug as NavigationToolSlug) : undefined;
    const canvasProject = /^\/canvas\/[^/]+/.test(pathname);
    const [collapsed, setCollapsed] = useState(() => {
        const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY);
        return stored === null ? window.matchMedia("(max-width: 1279px)").matches : stored === "true";
    });
    const [canvasExpanded, setCanvasExpanded] = useState(false);

    useEffect(() => {
        setCanvasExpanded(false);
    }, [pathname]);

    const isCollapsed = canvasProject ? !canvasExpanded : collapsed;
    const toggleCollapsed = () => {
        if (canvasProject) {
            setCanvasExpanded((current) => !current);
            return;
        }
        setCollapsed((current) => {
            const next = !current;
            localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
            return next;
        });
    };
    const toggleLabel = t(isCollapsed ? "canvas.expandPanel" : "canvas.collapsePanel");

    return (
        <aside className={cn("hidden shrink-0 flex-col border-r border-stone-200 bg-background transition-[width] duration-200 dark:border-stone-800 md:flex", isCollapsed ? "w-16" : "w-56")}>
            <div className="flex h-14 shrink-0 items-center border-b border-stone-200 px-3 dark:border-stone-800">
                <Link
                    to="/"
                    className={cn("flex min-w-0 items-center gap-2 text-stone-950 transition hover:opacity-70 dark:text-stone-100", isCollapsed && "w-full justify-center")}
                    title={companyName || t("meta.title")}
                >
                    <BrandLogo className="h-5 w-auto max-w-24" />
                    {isCollapsed ? null : <span className="truncate text-sm font-semibold tracking-tight">{companyName || t("meta.title")}</span>}
                </Link>
            </div>

            <nav className="hide-scrollbar min-h-0 flex-1 overflow-y-auto p-2" aria-label={t("topNav.navigation")}>
                <div className="space-y-1">
                    {navigationTools.map((tool) => (
                        <SidebarLink key={tool.slug} tool={tool} active={tool.slug === activeToolSlug} collapsed={isCollapsed} />
                    ))}
                </div>
            </nav>

            <div className="shrink-0 border-t border-stone-200 p-2 dark:border-stone-800">
                <Tooltip title={toggleLabel} placement="right" mouseEnterDelay={0.25}>
                    <button
                        type="button"
                        className={cn(
                            "flex h-10 w-full items-center rounded-lg text-sm text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-950 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100",
                            isCollapsed ? "justify-center px-0" : "gap-3 px-3",
                        )}
                        onClick={toggleCollapsed}
                        aria-label={toggleLabel}
                        aria-expanded={!isCollapsed}
                    >
                        {isCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
                        {isCollapsed ? null : <span className="truncate">{toggleLabel}</span>}
                    </button>
                </Tooltip>
            </div>
        </aside>
    );
}
