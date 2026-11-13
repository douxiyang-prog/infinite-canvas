import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { Popover } from "antd";
import { Coins, LoaderCircle, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { resolveModelChannel, useConfigStore, type ModelChannel } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";

const REFRESH_INTERVAL_MS = 30_000;

type CreditUsage = {
    used: number;
    total: number;
    displayType: "CNY" | "USD" | "TOKENS";
    unlimited: boolean;
};

export function NewApiCreditBadge({ variant = "default" }: { variant?: "default" | "canvas" }) {
    const { t, i18n } = useTranslation();
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const config = useConfigStore((state) => state.config);
    const channels = config.channels.filter((channel) => channel.baseUrl.trim() && channel.apiKey.trim());
    const channel = resolveModelChannel(config, config.model || config.imageModel || config.videoModel || config.textModel || config.audioModel);
    const [usage, setUsage] = useState<CreditUsage | null>(null);
    const [channelBalances, setChannelBalances] = useState<Record<string, CreditUsage | null>>({});
    const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
    const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
    const [open, setOpen] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);
    const [listRefreshKey, setListRefreshKey] = useState(0);
    const iconStyle: CSSProperties | undefined = variant === "canvas" ? { color: theme.node.text } : undefined;
    const remaining = usage ? Math.max(0, usage.total - usage.used) : 0;
    const remainingText = usage ? (usage.unlimited ? "∞" : formatCredit(remaining, usage.displayType, i18n.resolvedLanguage === "zh-CN")) : "--";
    const totalText = usage ? (usage.unlimited ? "∞" : formatCredit(usage.total, usage.displayType, i18n.resolvedLanguage === "zh-CN")) : "--";
    const exactRemainingText = usage ? (usage.unlimited ? t("topNav.creditUsageUnlimited") : formatExactCredit(remaining, usage.displayType, i18n.resolvedLanguage === "zh-CN")) : "--";
    const exactTotalText = usage ? (usage.unlimited ? t("topNav.creditUsageUnlimited") : formatExactCredit(usage.total, usage.displayType, i18n.resolvedLanguage === "zh-CN")) : "--";
    const label = usage
        ? t("topNav.creditUsageLabel", { remaining: exactRemainingText, total: exactTotalText, channel: channel.name })
        : t(status === "error" ? "topNav.creditUsageUnavailable" : "topNav.creditUsageLoading");

    useEffect(() => {
        let disposed = false;
        let controller: AbortController | null = null;

        const refresh = async () => {
            controller?.abort();
            controller = new AbortController();
            if (!disposed) setStatus("loading");
            try {
                const nextUsage = await fetchCreditUsage(channel, controller.signal);
                if (disposed) return;
                setUsage(nextUsage);
                setStatus("ready");
            } catch (error) {
                if (disposed || (error instanceof DOMException && error.name === "AbortError")) return;
                setUsage(null);
                setStatus("error");
            }
        };

        void refresh();
        const timer = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
        const refreshOnFocus = () => void refresh();
        window.addEventListener("focus", refreshOnFocus);
        return () => {
            disposed = true;
            controller?.abort();
            window.clearInterval(timer);
            window.removeEventListener("focus", refreshOnFocus);
        };
    }, [channel.baseUrl, channel.apiKey, refreshKey]);

    useEffect(() => {
        if (!open) return;
        let disposed = false;
        const controllers: AbortController[] = [];
        const refreshAll = async () => {
            for (const availableChannel of channels) {
                if (disposed) return;
                const controller = new AbortController();
                controllers.push(controller);
                setLoadingIds((current) => new Set(current).add(availableChannel.id));
                try {
                    const nextUsage = await fetchCreditUsage(availableChannel, controller.signal);
                    if (disposed) return;
                    setChannelBalances((current) => ({ ...current, [availableChannel.id]: nextUsage }));
                } catch {
                    if (disposed) return;
                    setChannelBalances((current) => ({ ...current, [availableChannel.id]: null }));
                } finally {
                    if (!disposed) {
                        setLoadingIds((current) => {
                            const next = new Set(current);
                            next.delete(availableChannel.id);
                            return next;
                        });
                    }
                }
            }
        };
        void refreshAll();
        return () => {
            disposed = true;
            controllers.forEach((controller) => controller.abort());
        };
    }, [open, listRefreshKey, channels.map((item) => `${item.id}:${item.baseUrl}:${item.apiKey}`).join("|")]);

    const popoverContent = (
        <div className="w-80 max-w-[calc(100vw-32px)]">
            <div className="mb-2 flex items-center justify-between gap-3">
                <div className="text-sm font-semibold">{t("topNav.creditUsageChannels")}</div>
                <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs opacity-70 hover:bg-black/5 dark:hover:bg-white/10"
                    onClick={() => {
                        setRefreshKey((value) => value + 1);
                        setListRefreshKey((value) => value + 1);
                    }}
                >
                    <RefreshCw className="size-3.5" />
                    {t("topNav.creditUsageRefresh")}
                </button>
            </div>
            <div className="space-y-1">
                {channels.length ? (
                    channels.map((item) => {
                        const itemUsage = channelBalances[item.id];
                        const loading = loadingIds.has(item.id);
                        const text = loading
                            ? "..."
                            : itemUsage
                              ? itemUsage.unlimited
                                  ? "∞ / ∞"
                                  : `${formatCredit(Math.max(0, itemUsage.total - itemUsage.used), itemUsage.displayType, i18n.resolvedLanguage === "zh-CN")} / ${formatCredit(itemUsage.total, itemUsage.displayType, i18n.resolvedLanguage === "zh-CN")}`
                              : "--";
                        return (
                            <div key={item.id} className="flex items-center justify-between gap-3 rounded-md px-2 py-2 text-xs">
                                <span className={`min-w-0 truncate ${item.id === channel.id ? "font-semibold" : "opacity-70"}`}>{item.name}</span>
                                <span className="shrink-0 tabular-nums">{text}</span>
                            </div>
                        );
                    })
                ) : (
                    <div className="px-2 py-3 text-xs opacity-60">{t("topNav.creditUsageNoChannels")}</div>
                )}
            </div>
            <div className="mt-2 border-t pt-2 text-[11px] leading-5 opacity-60" style={{ borderColor: theme.toolbar.border }}>
                {t("topNav.creditUsageOwnKeyHint")}
            </div>
        </div>
    );

    return (
        <Popover content={popoverContent} trigger="click" placement="bottomRight" open={open} onOpenChange={setOpen}>
            <button
                type="button"
                className="group inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-xs transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                style={iconStyle}
                aria-label={label}
                title={label}
            >
                {status === "loading" ? <LoaderCircle className="size-3.5 animate-spin opacity-70" /> : <Coins className="size-3.5 opacity-70" />}
                <span className="font-semibold tabular-nums">{remainingText}</span>
                <span className="opacity-45">/</span>
                <span className="tabular-nums opacity-60">{totalText}</span>
            </button>
        </Popover>
    );
}

async function fetchCreditUsage(channel: ModelChannel, signal: AbortSignal): Promise<CreditUsage> {
    if (!channel.baseUrl.trim() || !channel.apiKey.trim()) throw new Error("New API channel is not configured");

    const baseUrl = new URL(channel.baseUrl.trim(), window.location.origin);
    const root = `${baseUrl.origin}${baseUrl.pathname.replace(/\/+$/, "").replace(/\/v1$/i, "")}`;
    const headers = { Authorization: `Bearer ${channel.apiKey}` };
    const options: RequestInit = { headers, signal, cache: "no-store", credentials: "omit" };
    const [site, subscriptionResponse, usageResponse] = await Promise.all([
        fetch(`${root}/api/status`, { signal, cache: "no-store", credentials: "omit" })
            .then((response) => (response.ok ? response.json() : null))
            .catch(() => null),
        fetch(`${root}/v1/dashboard/billing/subscription`, options),
        fetch(`${root}/v1/dashboard/billing/usage`, options),
    ]);
    if (!subscriptionResponse.ok || !usageResponse.ok) throw new Error(`New API billing request failed: ${subscriptionResponse.status}/${usageResponse.status}`);

    const [subscription, usage] = await Promise.all([subscriptionResponse.json(), usageResponse.json()]);
    if (subscription?.error || usage?.error) throw new Error(subscription?.error?.message || usage?.error?.message || "New API billing error");

    const total = Number(subscription?.hard_limit_usd);
    const used = Number(usage?.total_usage) / 100;
    if (!Number.isFinite(total) || total < 0 || !Number.isFinite(used) || used < 0) throw new Error("Invalid New API billing response");
    const configuredType = String(site?.data?.quota_display_type || "CNY").toUpperCase();
    const displayType = configuredType === "USD" || configuredType === "TOKENS" ? configuredType : "CNY";
    return { used, total, displayType, unlimited: total === 100_000_000 };
}

function formatCredit(value: number, displayType: CreditUsage["displayType"], chinese: boolean) {
    const unit = displayType === "CNY" ? "¥" : displayType === "USD" ? "$" : chinese ? "积分" : "credits";
    let amount: string;
    if (value >= 10_000) {
        const compact = Math.round((value / 10_000) * 10) / 10;
        amount = `${compact.toLocaleString(undefined, { maximumFractionDigits: 1 })}${chinese ? "万" : "K"}`;
    } else {
        amount = value.toLocaleString(undefined, { maximumFractionDigits: 2 });
    }
    return displayType === "TOKENS" ? `${amount} ${unit}` : `${unit}${amount}`;
}

function formatExactCredit(value: number, displayType: CreditUsage["displayType"], chinese: boolean) {
    const unit = displayType === "CNY" ? "¥" : displayType === "USD" ? "$" : chinese ? "积分" : "credits";
    const amount = value.toLocaleString(undefined, {
        minimumFractionDigits: displayType === "TOKENS" ? 0 : 2,
        maximumFractionDigits: displayType === "TOKENS" ? 0 : 6,
    });
    return displayType === "TOKENS" ? `${amount} ${unit}` : `${unit}${amount}`;
}
