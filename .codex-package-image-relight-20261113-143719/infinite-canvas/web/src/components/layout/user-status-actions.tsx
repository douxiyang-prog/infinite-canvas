import type { CSSProperties } from "react";
import { Dropdown, Tooltip } from "antd";
import type { MenuProps } from "antd";
import { Keyboard, LogOut, Puzzle, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { NewApiCreditBadge } from "@/components/layout/new-api-credit-badge";
import { VersionReleaseModal } from "@/components/layout/version-release-modal";
import { changeAppLocale, type AppLocale } from "@/i18n";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";

type UserStatusActionsProps = {
    showConfig?: boolean;
    variant?: "default" | "canvas";
    onOpenShortcuts?: () => void;
    onOpenPlugins?: () => void;
};

export function UserStatusActions({ showConfig = true, variant = "default", onOpenShortcuts, onOpenPlugins }: UserStatusActionsProps) {
    const { i18n, t } = useTranslation();
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const user = useUserStore((state) => state.user);
    const logout = useUserStore((state) => state.logout);
    const navigate = useNavigate();
    const canvasTheme = canvasThemes[theme];
    const naturalIconClass =
        "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-stone-600 transition-colors hover:bg-black/5 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white [&_svg]:size-4";
    const iconStyle: CSSProperties | undefined = variant === "canvas" ? { color: canvasTheme.node.text } : undefined;
    const versionStyle = iconStyle;
    const locale = i18n.resolvedLanguage as AppLocale;
    const nextLocale = locale === "zh-CN" ? "en-US" : "zh-CN";
    const languageLabel = t("topNav.switchLanguage", { language: t(nextLocale === "zh-CN" ? "locale.zhCN" : "locale.enUS") });
    const accountItems: MenuProps["items"] = user
        ? [
              {
                  key: "account",
                  disabled: true,
                  label: (
                      <div className="min-w-40 py-1">
                          <div className="font-medium text-current">{user.displayName}</div>
                          <div className="mt-0.5 text-xs opacity-55">
                              @{user.username} · {user.role === "admin" ? "管理员" : "用户"}
                          </div>
                      </div>
                  ),
              },
              { type: "divider" },
              { key: "logout", icon: <LogOut className="size-4" />, label: "退出登录", onClick: () => void logout() },
          ]
        : [];

    return (
        <div className="inline-flex shrink-0 items-center gap-1">
            <NewApiCreditBadge variant={variant} />
            {user ? (
                <Dropdown menu={{ items: accountItems }} trigger={["click"]} placement="bottomRight">
                    <button
                        type="button"
                        className="grid size-7 shrink-0 place-items-center rounded-full bg-stone-900 text-[11px] font-semibold text-white transition hover:opacity-80 dark:bg-stone-100 dark:text-stone-900"
                        style={variant === "canvas" ? { background: canvasTheme.node.text, color: canvasTheme.node.fill } : undefined}
                        aria-label="账户菜单"
                        title={user.displayName}
                    >
                        {user.displayName.slice(0, 1).toUpperCase()}
                    </button>
                </Dropdown>
            ) : null}
            {onOpenPlugins ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={onOpenPlugins} aria-label={t("topNav.plugins")} title={t("topNav.plugins")}>
                    <Puzzle className="size-4" />
                </button>
            ) : null}
            {showConfig && user?.role === "admin" ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={() => navigate("/admin/settings")} aria-label={t("navigation.globalSettings")} title={t("navigation.globalSettings")}>
                    <Settings2 className="size-4" />
                </button>
            ) : null}
            <Tooltip title={languageLabel} mouseEnterDelay={0.2}>
                <button type="button" className={`${naturalIconClass} text-[11px] font-semibold tracking-tight`} style={iconStyle} onClick={() => void changeAppLocale(nextLocale)} aria-label={languageLabel}>
                    {locale === "zh-CN" ? "中" : "EN"}
                </button>
            </Tooltip>
            <AnimatedThemeToggler
                theme={theme}
                onThemeChange={setTheme}
                className={naturalIconClass}
                style={iconStyle}
                aria-label={t(theme === "dark" ? "topNav.lightTheme" : "topNav.darkTheme")}
                title={t(theme === "dark" ? "topNav.lightTheme" : "topNav.darkTheme")}
            />
            <VersionReleaseModal style={versionStyle} />
            {onOpenShortcuts ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={onOpenShortcuts} aria-label={t("topNav.shortcuts")} title={t("topNav.shortcuts")}>
                    <Keyboard className="size-4" />
                </button>
            ) : null}
        </div>
    );
}
