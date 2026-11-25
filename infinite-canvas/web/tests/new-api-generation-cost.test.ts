import { afterAll, afterEach, expect, test } from "bun:test";

import type { AiConfig } from "../src/stores/use-config-store";

const values = new Map<string, string>();
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalFetch = globalThis.fetch;
Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
    },
});
Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { origin: "https://canvas.example.com" } },
});

const { fetchGenerationCost } = await import("../src/services/api/new-api-generation-cost");

afterAll(() => {
    globalThis.fetch = originalFetch;
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
});
afterEach(() => {
    globalThis.fetch = originalFetch;
});

function config(size: string): AiConfig {
    return {
        baseUrl: "https://new-api.example.com",
        apiKey: "sk-test",
        model: "test::doubao-seedream-5-5-261028",
        imageModel: "test::doubao-seedream-5-5-261028",
        videoModel: "",
        size,
        videoSeconds: "5",
        videoDurationMode: "fixed",
        videoGenerateAudio: "true",
        vquality: "720",
    } as AiConfig;
}

function mockPricing(pluginExpression: string, ordinaryExpression = 'tier("base", p * 0 + c * 0)') {
    globalThis.fetch = (async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/api/status")) {
            return Response.json({ data: { quota_display_type: "CNY", usd_exchange_rate: 7.3 } });
        }
        return Response.json({
            data: [
                {
                    model_name: "doubao-seedream-5-5-261028",
                    billing_expr: ordinaryExpression,
                    model_price: 0,
                    billing_plugin_variants: [
                        {
                            plugin_key: "doubao",
                            plugin_name: "Doubao",
                            billing_expr: pluginExpression,
                        },
                    ],
                },
            ],
        });
    }) as typeof fetch;
}

const pluginExpression = 'tier("base", u("images_above_1_5k") * 0.03150685 + u("images_up_to_1_5k") * 0.01780822 + u("input_images") * 0.0027)';

test("image cost prefers the task plugin expression over the ordinary model expression", async () => {
    mockPricing(pluginExpression);
    const estimate = await fetchGenerationCost({
        config: config("2048x2048"),
        mode: "image",
        count: 1,
        signal: new AbortController().signal,
    });

    expect(estimate?.source).toBe("Doubao");
    expect(estimate?.total).toBeCloseTo(0.23, 5);
});

test("image cost applies the lower Doubao pixel tier and reference image count", async () => {
    mockPricing(pluginExpression);
    const estimate = await fetchGenerationCost({
        config: config("1024x1024"),
        mode: "image",
        count: 1,
        referenceImageCount: 1,
        signal: new AbortController().signal,
    });

    expect(estimate?.source).toBe("Doubao");
    expect(estimate?.total).toBeCloseTo(0.14971, 5);
});

test("ordinary pricing remains the fallback when the plugin cannot price the request", async () => {
    mockPricing('tier("base", u("unsupported_usage") * 1)', 'tier("base", fixed(0.03150685))');
    const estimate = await fetchGenerationCost({
        config: config("2048x2048"),
        mode: "image",
        count: 1,
        signal: new AbortController().signal,
    });

    expect(estimate?.source).toBeUndefined();
    expect(estimate?.total).toBeCloseTo(0.23, 5);
});
