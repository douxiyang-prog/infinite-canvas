import crypto from "node:crypto";

import { dshSessions } from "./deepseek.js";
import type { AgentAttachment, AgentEmit, AgentMessageMetadata } from "./types.js";
import { logger } from "../utils/logger.js";
import { errorMessage } from "../utils/value.js";

export type CanvasChannelConfig = {
    channelId: string;
    channelName: string;
    baseUrl: string;
    apiKey: string;
    model: string;
};

type CanvasChannelRunInput = {
    threadId: string;
    turnId: string;
    cwd: string;
    prompt: string;
    messageText: string;
    attachments: AgentAttachment[];
    messageMetadata?: AgentMessageMetadata;
    model?: string;
    emit: AgentEmit;
    onFinish?: () => void;
};

let channelConfig: CanvasChannelConfig | null = null;
let activeController: AbortController | null = null;

export function setCanvasChannelConfig(value: CanvasChannelConfig) {
    const config = normalizeChannelConfig(value);
    channelConfig = config;
    return publicChannelConfig();
}

export function clearCanvasChannelConfig() {
    channelConfig = null;
}

export function canvasChannelModels() {
    if (!channelConfig) return [];
    return [{
        id: channelConfig.model,
        model: channelConfig.model,
        displayName: `${channelConfig.model} · ${channelConfig.channelName}`,
        defaultReasoningEffort: "high",
        supportedReasoningEfforts: [
            { reasoningEffort: "low", description: "Fast" },
            { reasoningEffort: "high", description: "Balanced" },
            { reasoningEffort: "max", description: "Deep reasoning" },
        ],
        isDefault: true,
    }];
}

export function publicChannelConfig() {
    return channelConfig ? {
        channelId: channelConfig.channelId,
        channelName: channelConfig.channelName,
        baseUrl: channelConfig.baseUrl,
        model: channelConfig.model,
        hasApiKey: Boolean(channelConfig.apiKey),
    } : null;
}

export async function runCanvasChannelTurn(input: CanvasChannelRunInput) {
    const controller = new AbortController();
    activeController = controller;
    const startedAt = Date.now();
    const itemId = `canvas-channel:${input.threadId}:${input.turnId}:assistant`;
    let text = "";
    let usage: Record<string, number> | null = null;
    const agentEvent = (type: string, payload: Record<string, unknown> = {}) => {
        input.emit("agent_event", { threadId: input.threadId, turnId: input.turnId, type, ...payload });
    };
    try {
        const config = channelConfig;
        if (!config) throw new Error("请先在连接设置中选择 Canvas 语言渠道");
        const thread = await dshSessions.get(input.threadId);
        if (!thread) throw new Error("DeepSeek Harness 会话不存在");
        const priorMessages = [...thread.messages];
        const stored = await dshSessions.appendUser(input.threadId, {
            id: `${input.threadId}:${input.turnId}:user`,
            itemId: "synthetic:user",
            threadId: input.threadId,
            turnId: input.turnId,
            role: "user",
            text: input.messageText,
            ...(input.messageMetadata || {}),
        });
        if (!stored) throw new Error("DeepSeek Harness 会话不存在");

        agentEvent("turn.started");
        agentEvent("item.started", { item: { id: itemId, type: "agent_message", status: "inProgress", text: "" } });
        const model = input.model || config.model;
        const response = await fetch(chatCompletionsUrl(config.baseUrl), {
            method: "POST",
            headers: {
                "content-type": "application/json",
                Authorization: `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify({
                model,
                stream: true,
                messages: [
                    ...historyMessages(priorMessages),
                    { role: "user", content: currentContent(input.prompt, input.attachments) },
                ],
            }),
            signal: controller.signal,
        });
        if (!response.ok) {
            const detail = (await response.text().catch(() => "")).trim();
            throw new Error(detail ? `Canvas channel ${response.status}: ${detail}` : `Canvas channel request failed with status ${response.status}`);
        }
        if (!response.body) throw new Error("Canvas channel returned no streaming body");

        const decoder = new TextDecoder();
        let buffer = "";
        const consume = (line: string) => {
            if (!line.startsWith("data:")) return;
            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") return;
            const payload = record(JSON.parse(data));
            if (payload.error) throw new Error(errorMessage(payload.error));
            const choice = record(Array.isArray(payload.choices) ? payload.choices[0] : undefined);
            const delta = record(choice.delta);
            if (typeof delta.content === "string" && delta.content) {
                text += delta.content;
                agentEvent("item.updated", { item: { id: itemId, type: "agent_message", delta: delta.content } });
            }
            if (payload.usage) usage = openAiUsage(record(payload.usage));
        };
        const reader = response.body.getReader();
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let newline = buffer.indexOf("\n");
            while (newline >= 0) {
                consume(buffer.slice(0, newline).replace(/\r$/, ""));
                buffer = buffer.slice(newline + 1);
                newline = buffer.indexOf("\n");
            }
        }
        if (buffer.trim()) consume(buffer.trim());
        agentEvent("item.completed", { item: { id: itemId, type: "agent_message", text, status: "completed" } });
        if (usage) agentEvent("usage.updated", { usage });
        await dshSessions.appendAssistant(input.threadId, input.turnId, text);
        await dshSessions.settleTurn(input.threadId, input.turnId);
        agentEvent("turn.completed", { status: controller.signal.aborted ? "interrupted" : "completed", ...(usage ? { usage } : {}) });
    } catch (error) {
        if (controller.signal.aborted) {
            agentEvent("turn.completed", { status: "interrupted" });
        } else {
            const message = errorMessage(error);
            logger.error("Canvas channel turn failed", error);
            agentEvent("turn.completed", { status: "failed", error: { message } });
        }
    } finally {
        if (activeController === controller) activeController = null;
        logger.info("Canvas channel turn finished", { threadId: input.threadId, turnId: input.turnId, durationMs: Date.now() - startedAt });
        input.onFinish?.();
    }
}

export function interruptCanvasChannelTurn() {
    const controller = activeController;
    activeController = null;
    if (controller) controller.abort();
    return Boolean(controller);
}

export function chatCompletionsUrl(baseUrl: string) {
    const normalized = normalizeBaseUrl(baseUrl);
    const apiBase = /\/v1$/i.test(normalized) ? normalized : `${normalized}/v1`;
    return `${apiBase}/chat/completions`;
}

function normalizeChannelConfig(value: CanvasChannelConfig): CanvasChannelConfig {
    const channelId = String(value.channelId || "").trim();
    const channelName = String(value.channelName || "").trim();
    const baseUrl = normalizeBaseUrl(value.baseUrl);
    const apiKey = String(value.apiKey || "").trim();
    const model = String(value.model || "").trim();
    if (!channelId || !channelName || !baseUrl || !apiKey || !model) throw new Error("Canvas 语言渠道配置不完整");
    const parsed = new URL(baseUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Canvas 渠道 Base URL 无效");
    return { channelId, channelName, baseUrl, apiKey, model };
}

function normalizeBaseUrl(value: string) {
    const trimmed = String(value || "").trim();
    if (trimmed.startsWith("/") && !trimmed.startsWith("//")) throw new Error("Canvas channel Base URL is relative; resolve it against the Canvas site origin before sending it to the local Agent");
    if (/^https?:\/?\/?$/i.test(trimmed)) throw new Error("Canvas channel Base URL is invalid; use a full URL such as https://example.com/v1");
    let normalized = trimmed.replace(/\/+$/, "");
    if (!normalized) throw new Error("Canvas channel Base URL cannot be empty");
    if (normalized.startsWith("//")) {
        normalized = `https:${normalized}`;
    } else if (!/^[a-z][a-z\d+.-]*:\/\//i.test(normalized)) {
        const scheme = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::|\/|$)/i.test(normalized) ? "http" : "https";
        normalized = `${scheme}://${normalized.replace(/^\/+/, "")}`;
    }
    let parsed: URL;
    try {
        parsed = new URL(normalized);
    } catch {
        throw new Error("Canvas channel Base URL is invalid; use a full URL such as https://example.com/v1");
    }
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Canvas channel Base URL must use http or https");
    return normalized;
}

function currentContent(prompt: string, attachments: AgentAttachment[]) {
    const images = attachments.flatMap((attachment) => {
        if (!attachment.dataUrl?.startsWith("data:image/")) return [];
        return [{ type: "image_url", image_url: { url: attachment.dataUrl } }];
    });
    return images.length ? [{ type: "text", text: prompt }, ...images] : prompt;
}

function historyMessages(messages: Array<{ role: "user" | "assistant"; text: string }>) {
    const result: Array<{ role: "user" | "assistant"; content: string }> = [];
    for (const message of messages.slice(-60)) {
        const text = message.text.trim();
        if (!text) continue;
        const previous = result.at(-1);
        if (previous?.role === message.role) previous.content = `${previous.content}\n\n${text}`;
        else result.push({ role: message.role, content: text });
    }
    return result;
}

function openAiUsage(value: Record<string, unknown>) {
    return {
        input_tokens: Number(value.prompt_tokens || 0),
        cached_input_tokens: Number(record(value.prompt_tokens_details).cached_tokens || 0),
        output_tokens: Number(value.completion_tokens || 0),
    };
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
