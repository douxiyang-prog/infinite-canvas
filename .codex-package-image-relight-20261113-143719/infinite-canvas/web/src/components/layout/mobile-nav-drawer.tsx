import { Drawer } from "antd";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { cn } from "@/lib/utils";
import { useUserStore } from "@/stores/use-user-store";

type MobileNavDrawerProps = {
    open: boolean;
    activeToolSlug?: NavigationToolSlug;
    onClose: () => void;
};

export function MobileNavDrawer({ open, activeToolSlug, onClose }: MobileNavDrawerProps) {
    const { t } = useTranslation();
    const { pathname } = useLocation();
    const user = useUserStore((state) => state.user);
    const isAdmin = user?.role === "admin";
    const visibleTools = navigationTools.filter((tool) => !("adminOnly" in tool && tool.adminOnly) || isAdmin);

    return (
        <Drawer title={t("topNav.navigation")} placement="left" size={280} open={open} onClose={onClose} className="md:hidden">
            <div className="space-y-1">
                {visibleTools.map((tool) => {
                    const Icon = tool.icon;
                    const active = tool.slug === "config" ? pathname.startsWith("/admin/settings") : tool.slug === activeToolSlug;
                    const label = t(tool.slug === "config" ? "navigation.globalSettings" : `navigation.${tool.slug}`);
                    return (
                        <Link
                            key={tool.slug}
                            to={tool.slug === "config" ? "/admin/settings" : `/${tool.slug}`}
                            onClick={onClose}
                            className={cn(
                                "flex items-center gap-3 rounded-lg px-3 py-3 text-base transition",
                                active ? "bg-stone-100 font-medium text-stone-950 dark:bg-stone-800 dark:text-stone-100" : "text-stone-600 hover:bg-stone-100 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-100",
                            )}
                        >
                            <Icon className="size-5" />
                            <span>{label}</span>
                        </Link>
                    );
                })}
            </div>
        </Drawer>
    );
}
