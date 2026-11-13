import { useEffect, useState } from "react";
import { Coins, LoaderCircle } from "lucide-react";
import { Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import { fetchGenerationCost, type GenerationCostEstimate } from "@/services/api/new-api-generation-cost";
import { resolveModelChannel, type AiConfig } from "@/stores/use-config-store";
import type { CanvasGenerationMode } from "@/types/canvas";

type NewApiGenerationCostProps = {
    config: AiConfig;
    mode: CanvasGenerationMode;
    count: number;
    hasVideoReference?: boolean;
};

export function NewApiGenerationCost({ config, mode, count, hasVideoReference = false }: NewApiGenerationCostProps) {
    const { t, i18n } = useTranslation();
    const channel = resolveModelChannel(config, config.model);
    const [estimate, setEstimate] = useState<GenerationCostEstimate | null>(null);
    const [loading, setLoading] = useState(mode === "image" || mode === "video");

    useEffect(() => {
        if ((mode !== "image" && mode !== "video") || !channel.baseUrl.trim() || !channel.apiKey.trim()) {
            setEstimate(null);
            setLoading(false);
            return;
        }

        let disposed = false;
        const controller = new AbortController();
        setLoading(true);
        void fetchGenerationCost({ config: { ...config, baseUrl: channel.baseUrl, apiKey: channel.apiKey }, mode, count, hasVideoReference, signal: controller.signal })
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
    }, [channel.apiKey, channel.baseUrl, config.model, config.size, config.videoDurationMode, config.videoGenerateAudio, config.videoSeconds, config.vquality, count, hasVideoReference, mode]);

    if (mode !== "image" && mode !== "video") return null;

    const formattedTotal = estimate ? formatMoney(estimate.total, estimate.currency, i18n.resolvedLanguage === "zh-CN", 2) : "--";
    const detail =
        estimate && mode === "video" && estimate.usage
            ? t(estimate.usage.automatic ? "costEstimate.videoDetailAuto" : "costEstimate.videoDetail", {
                  seconds: estimate.usage.seconds,
                  resolution: estimate.usage.resolution,
                  total: formatMoney(estimate.total, estimate.currency, i18n.resolvedLanguage === "zh-CN", 4),
              })
            : estimate
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
                    <div className="font-medium">{t(mode === "video" ? "costEstimate.videoTitle" : "costEstimate.title")}</div>
                    <div>{detail}</div>
                    <div className="opacity-70">{t("costEstimate.channel", { channel: channel.name })}</div>
                </div>
            }
        >
            <span className="inline-flex h-8 shrink-0 cursor-default items-center gap-1 rounded-full px-2 text-xs tabular-nums opacity-75">
                {loading ? <LoaderCircle className="size-3.5 animate-spin" /> : <Coins className="size-3.5" />}
                <span>{loading ? "..." : estimate ? `≈${formattedTotal}` : formattedTotal}</span>
            </span>
        </Tooltip>
    );
}

function formatMoney(value: number, currency: GenerationCostEstimate["currency"], chinese: boolean, fractionDigits: number) {
    const symbol = currency === "CNY" ? "¥" : "$";
    return `${symbol}${value.toLocaleString(undefined, { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits })}${chinese ? "" : ` ${currency}`}`;
}
