import { useEffect, useState } from "react";
import { Coins, LoaderCircle } from "lucide-react";
import { Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import { resolveModelChannel, type AiConfig } from "@/stores/use-config-store";
import type { CanvasGenerationMode } from "@/types/canvas";

type NewApiGenerationCostProps = {
    config: AiConfig;
    mode: CanvasGenerationMode;
    count: number;
};

type CostEstimate = {
    total: number;
    unit: number;
    imageCount: number;
    currency: "CNY" | "USD";
};

export function NewApiGenerationCost({ config, mode, count }: NewApiGenerationCostProps) {
    const { t, i18n } = useTranslation();
    const channel = resolveModelChannel(config, config.model);
    const [estimate, setEstimate] = useState<CostEstimate | null>(null);
    const [loading, setLoading] = useState(mode === "image");

    useEffect(() => {
        if (mode !== "image" || !channel.baseUrl.trim() || !channel.apiKey.trim()) {
            setEstimate(null);
            setLoading(false);
            return;
        }

        let disposed = false;
        const controller = new AbortController();
        setLoading(true);
        void fetchImageCost(config.model, count, channel.baseUrl, controller.signal)
            .then((nextEstimate) => {
                if (disposed) return;
                setEstimate(nextEstimate);
                setLoading(false);
            })
            .catch((error) => {
                if (disposed || (error instanceof DOMException && error.name === "AbortError")) return;
                setEstimate(null);
                setLoading(false);
            });

        return () => {
            disposed = true;
            controller.abort();
        };
    }, [channel.apiKey, channel.baseUrl, config.model, count, mode]);

    if (mode !== "image") return null;

    const formattedTotal = estimate ? formatMoney(estimate.total, estimate.currency, i18n.resolvedLanguage === "zh-CN", 2) : "--";
    const detail = estimate
        ? t("costEstimate.detail", {
              count: estimate.imageCount,
              unit: formatMoney(estimate.unit, estimate.currency, i18n.resolvedLanguage === "zh-CN", 4),
              total: formatMoney(estimate.total, estimate.currency, i18n.resolvedLanguage === "zh-CN", 4),
          })
        : t("costEstimate.unavailable");

    return (
        <Tooltip
            title={
                <div className="space-y-1 py-0.5">
                    <div className="font-medium">{t("costEstimate.title")}</div>
                    <div>{detail}</div>
                    <div className="opacity-70">{t("costEstimate.channel", { channel: channel.name })}</div>
                </div>
            }
        >
            <span className="inline-flex h-8 shrink-0 cursor-default items-center gap-1 rounded-full px-2 text-xs tabular-nums opacity-75">
                {loading ? <LoaderCircle className="size-3.5 animate-spin" /> : <Coins className="size-3.5" />}
                <span>{loading ? "..." : formattedTotal}</span>
            </span>
        </Tooltip>
    );
}

async function fetchImageCost(modelValue: string, count: number, baseUrlValue: string, signal: AbortSignal): Promise<CostEstimate | null> {
    const model = modelValue.includes("::") ? modelValue.slice(modelValue.indexOf("::") + 2) : modelValue;
    const baseUrl = new URL(baseUrlValue.trim(), window.location.origin);
    const root = `${baseUrl.origin}${baseUrl.pathname.replace(/\/+$/, "").replace(/\/v1$/i, "")}`;
    const [siteResponse, pricingResponse] = await Promise.all([
        fetch(`${root}/api/status`, { signal, cache: "no-store", credentials: "omit" }),
        fetch(`${root}/api/pricing`, { signal, cache: "no-store", credentials: "omit" }),
    ]);
    if (!siteResponse.ok || !pricingResponse.ok) throw new Error("New API pricing is unavailable");

    const [site, pricing] = await Promise.all([siteResponse.json(), pricingResponse.json()]);
    const modelPricing = Array.isArray(pricing?.data) ? pricing.data.find((item: { model_name?: string }) => item.model_name === model) : undefined;
    const fixedMatch = typeof modelPricing?.billing_expr === "string" ? modelPricing.billing_expr.match(/fixed\(\s*([0-9.]+)\s*\)/i) : null;
    if (!fixedMatch) return null;

    const imageCount = Math.max(1, Math.floor(count));
    const unitUsd = Number(fixedMatch[1]);
    if (!Number.isFinite(unitUsd) || unitUsd < 0) return null;

    const multipliesByImageCount = /image_count/i.test(modelPricing.billing_expr);
    const billableImages = multipliesByImageCount ? imageCount : 1;
    const displayType = String(site?.data?.quota_display_type || "CNY").toUpperCase();
    const exchangeRate = Number(site?.data?.usd_exchange_rate || 7.3);
    const currency = displayType === "USD" ? "USD" : "CNY";
    const multiplier = currency === "CNY" ? exchangeRate : 1;
    const unit = unitUsd * multiplier;
    return { unit, total: unit * billableImages, imageCount: billableImages, currency };
}

function formatMoney(value: number, currency: CostEstimate["currency"], chinese: boolean, fractionDigits: number) {
    const symbol = currency === "CNY" ? "¥" : "$";
    return `${symbol}${value.toLocaleString(undefined, { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits })}${chinese ? "" : ` ${currency}`}`;
}
