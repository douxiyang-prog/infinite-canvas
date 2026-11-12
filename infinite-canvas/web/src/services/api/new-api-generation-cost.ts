import { Parser } from "expr-eval";

import { buildVideoBillingUsage, type VideoBillingUsage } from "@/lib/video-generation-estimate";
import { modelOptionName, type AiConfig } from "@/stores/use-config-store";
import type { CanvasGenerationMode } from "@/types/canvas";

type PricingVariant = {
    billing_expr?: string;
};

type ModelPricing = {
    model_name?: string;
    model_price?: number;
    billing_expr?: string;
    billing_plugin_variants?: PricingVariant[];
};

export type GenerationCostEstimate = {
    total: number;
    unit: number;
    imageCount: number;
    currency: "CNY" | "USD";
    usage?: Pick<VideoBillingUsage, "seconds" | "resolution">;
};

type GenerationCostRequest = {
    config: AiConfig;
    mode: CanvasGenerationMode;
    count: number;
    hasVideoReference?: boolean;
    signal: AbortSignal;
};

export async function fetchGenerationCost({ config, mode, count, hasVideoReference = false, signal }: GenerationCostRequest): Promise<GenerationCostEstimate | null> {
    const channelBaseUrl = config.baseUrl.trim();
    if (!channelBaseUrl || !config.apiKey.trim()) return null;

    const baseUrl = new URL(channelBaseUrl, window.location.origin);
    const root = `${baseUrl.origin}${baseUrl.pathname.replace(/\/+$/, "").replace(/\/v1$/i, "")}`;
    const [siteResponse, pricingResponse] = await Promise.all([fetch(`${root}/api/status`, { signal, cache: "no-store", credentials: "omit" }), fetch(`${root}/api/pricing`, { signal, cache: "no-store", credentials: "omit" })]);
    if (!siteResponse.ok || !pricingResponse.ok) throw new Error("New API pricing is unavailable");

    const [site, pricing] = await Promise.all([siteResponse.json(), pricingResponse.json()]);
    const model = modelOptionName(config.model || (mode === "video" ? config.videoModel : config.imageModel));
    const modelPricing = Array.isArray(pricing?.data) ? pricing.data.find((item: ModelPricing) => item.model_name === model) : undefined;
    if (!modelPricing) return null;

    const imageCount = Math.max(1, Math.floor(count));
    const videoUsage = mode === "video" ? buildVideoBillingUsage(config, hasVideoReference) : undefined;
    const usage: Record<string, unknown> = videoUsage
        ? { ...videoUsage }
        : {
              image_count: 1,
              n: 1,
          };
    const expressions = pricingExpressions(modelPricing);
    let unitUsd = expressions.map((expression) => evaluateBillingExpression(expression, usage, videoUsage)).find((value): value is number => value !== null);
    if (unitUsd === undefined) {
        const fixedMatch = expressions.map((expression) => expression.match(/fixed\(\s*([0-9.]+)\s*\)/i)).find(Boolean);
        unitUsd = fixedMatch ? Number(fixedMatch[1]) : undefined;
    }
    if (unitUsd === undefined && !expressions.length && Number.isFinite(modelPricing.model_price) && Number(modelPricing.model_price) >= 0) {
        unitUsd = Number(modelPricing.model_price);
    }
    if (unitUsd === undefined || !Number.isFinite(unitUsd) || unitUsd < 0) return null;

    const displayType = String(site?.data?.quota_display_type || "CNY").toUpperCase();
    const exchangeRate = Number(site?.data?.usd_exchange_rate || 7.3);
    const currency = displayType === "USD" ? "USD" : "CNY";
    const multiplier = currency === "CNY" ? exchangeRate : 1;
    const unit = unitUsd * multiplier;
    const total = unit * (mode === "image" ? imageCount : 1);
    return {
        unit,
        total,
        imageCount,
        currency,
        ...(videoUsage ? { usage: { seconds: videoUsage.seconds, resolution: videoUsage.resolution } } : {}),
    };
}

function pricingExpressions(pricing: ModelPricing) {
    const expressions = [pricing.billing_expr, ...(pricing.billing_plugin_variants || []).map((variant) => variant.billing_expr)].map((expression) => expression?.trim()).filter((expression): expression is string => Boolean(expression));
    return [...new Set(expressions)];
}

function evaluateBillingExpression(expression: string, usage: Record<string, unknown>, videoUsage?: VideoBillingUsage) {
    try {
        const parser = new Parser();
        const requestBody = {
            n: 1,
            seconds: videoUsage?.seconds,
            duration: videoUsage?.seconds,
            resolution: videoUsage?.resolution,
            size: videoUsage?.resolution,
        };
        parser.functions = {
            u: (name) => usage[String(name)] ?? null,
            tier: (_name, value) => value,
            fixed: (value) => value,
            param: (path) => readPath(requestBody, String(path)),
            header: () => "",
            has: (source, part) => String(source ?? "").includes(String(part ?? "")),
            min: (a, b) => Math.min(Number(a), Number(b)),
            max: (a, b) => Math.max(Number(a), Number(b)),
            abs: (value) => Math.abs(Number(value)),
            floor: (value) => Math.floor(Number(value)),
            ceil: (value) => Math.ceil(Number(value)),
        };
        const billingExpression = toExprEvalSyntax(expression.split("|||", 1)[0].trim());
        const value = parser.parse(billingExpression, { allowMemberAccess: false }).evaluate();
        return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
    } catch {
        return null;
    }
}

function toExprEvalSyntax(expression: string) {
    return expression
        .replace(/&&/g, " and ")
        .replace(/\|\|/g, " or ")
        .replace(/!(?!=)/g, " not ");
}

function readPath(source: unknown, path: string) {
    let value = source;
    for (const key of path.split(".").filter(Boolean)) {
        if (!value || typeof value !== "object") return null;
        value = (value as Record<string, unknown>)[key];
    }
    return value ?? null;
}
