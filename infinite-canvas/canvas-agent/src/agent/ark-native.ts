import crypto from "node:crypto";

import { dshSessions } from "./deepseek.js";
import type { AgentAttachment, AgentEmit, AgentMessageMetadata } from "./types.js";
import { logger } from "../utils/logger.js";
import { errorMessage } from "../utils/value.js";

type ArkNativeRunInput = {
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

const API_BASE = process.env.CANVAS_ARK_NATIVE_BASE_URL?.trim() || "https://ark.cn-beijing.volces.com/api/plan";
const DEFAULT_MODEL = process.env.CANVAS_DSH_MODEL?.trim() || "deepseek-v4-pro";
const MAX_TOKENS = positiveInteger(process.env.CANVAS_ARK_NATIVE_MAX_TOKENS) || 16384;
let activeController: AbortController | null = null;
let activeRuns = 0;

export async function runArkNativeTurn(input: ArkNativeRunInput) {
    const controller = new AbortController();
    activeController = controller;
    activeRuns += 1;
    const startedAt = Date.now();
    const itemId = `ark:${input.threadId}:${input.turnId}:assistant`;
    let text = "";
    const agentEvent = (type: string, payload: Record<string, unknown> = {}) => {
        input.emit("agent_event", { threadId: input.threadId, turnId: input.turnId, type, ...payload });
    };
    try {
        const existing = await dshSessions.get(input.threadId);
        if (!existing) throw new Error("DeepSeek Harness 会话不存在");
        const priorMessages = [...existing.messages];
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

        const apiKey = process.env.ARK_AGENT_PLAN_CN_API_KEY || process.env.CANVAS_DSH_API_KEY || "";
        if (!apiKey) throw new Error("请先在连接设置中填写 Ark Agent Plan API Key");

        agentEvent("turn.started");
        agentEvent("item.started", { item: { id: itemId, type: "agent_message", status: "inProgress", text: "" } });
        const model = input.model || DEFAULT_MODEL;
        const messages = historyMessages(priorMessages);
        const currentContent = messageContent(input.prompt, input.attachments, supportsImages(model));
        const last = messages.at(-1);
        if (last?.role === "user") last.content.push(...currentContent);
        else messages.push({ role: "user", content: currentContent });
        const response = await fetch(`${API_BASE.replace(/\/$/, "")}/v1/messages`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
                model,
                max_tokens: MAX_TOKENS,
                stream: true,
                messages,
            }),
            signal: controller.signal,
        });
        if (!response.ok) {
            const detail = (await response.text().catch(() => "")).trim();
            throw new Error(detail ? `Ark API ${response.status}: ${detail}` : `Ark API request failed with status ${response.status}`);
        }
        if (!response.body) throw new Error("Ark API returned no streaming body");

        const decoder = new TextDecoder();
        let buffer = "";
        let usage: Record<string, number> | null = null;
        const consume = (line: string) => {
            if (!line.startsWith("data:")) return;
            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") return;
            const event = record(JSON.parse(data));
            if (event.type === "content_block_delta") {
                const delta = record(event.delta);
                if (delta.type === "text_delta" && typeof delta.text === "string" && delta.text) {
                    text += delta.text;
                    agentEvent("item.updated", { item: { id: itemId, type: "agent_message", delta: delta.text } });
                }
            } else if (event.type === "message_start") {
                usage = apiUsage(record(record(event.message).usage), usage);
            } else if (event.type === "message_delta") {
                usage = apiUsage(record(event.usage), usage);
            } else if (event.type === "error") {
                throw new Error(errorMessage(record(event.error)) || "Ark API stream failed");
            }
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
            logger.error("Ark native API turn failed", error);
            agentEvent("turn.completed", { status: "failed", error: { message } });
        }
    } finally {
        if (activeController === controller) activeController = null;
        activeRuns = Math.max(0, activeRuns - 1);
        logger.info("Ark native API turn finished", { threadId: input.threadId, turnId: input.turnId, durationMs: Date.now() - startedAt });
        input.onFinish?.();
    }
}

export function interruptArkNativeTurn() {
    const controller = activeController;
    activeController = null;
    if (controller) controller.abort();
    return Boolean(controller) || activeRuns > 0;
}

function messageContent(prompt: string, attachments: AgentAttachment[], includeImages: boolean) {
    const content: Array<Record<string, unknown>> = [{ type: "text", text: prompt }];
    if (!includeImages) {
        if (attachments.length) content.push({ type: "text", text: "\n\n[The selected model does not accept image attachments.]" });
        return content;
    }
    for (const attachment of attachments) {
        const match = attachment.dataUrl?.match(/^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,(.+)$/i);
        if (!match) continue;
        const mediaType = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();
        content.push({ type: "image", source: { type: "base64", media_type: mediaType, data: match[2] } });
    }
    return content;
}

function historyMessages(messages: Array<{ role: "user" | "assistant"; text: string }>) {
    const result: Array<{ role: "user" | "assistant"; content: Array<Record<string, unknown>> }> = [];
    for (const message of messages.slice(-60)) {
        const text = message.text.trim();
        if (!text) continue;
        const previous = result.at(-1);
        if (previous?.role === message.role) {
            previous.content[0].text = `${String(previous.content[0].text)}${String(previous.content[0].text) ? "\n\n" : ""}${text}`;
        } else {
            result.push({ role: message.role, content: [{ type: "text", text }] });
        }
    }
    return result;
}

function supportsImages(model: string) {
    return ["doubao-seed-evolving", "doubao-seed-2.1-pro", "doubao-seed-2.1-turbo", "kimi-k3"].includes(model);
}

function apiUsage(value: Record<string, unknown>, previous: Record<string, number> | null) {
    const inputTokens = Number(value.input_tokens ?? value.inputTokens ?? previous?.input_tokens ?? 0);
    const outputTokens = Number(value.output_tokens ?? value.outputTokens ?? previous?.output_tokens ?? 0);
    const cached = Number(value.cache_read_input_tokens ?? value.cached_input_tokens ?? previous?.cached_input_tokens ?? 0);
    return { input_tokens: inputTokens, cached_input_tokens: cached, output_tokens: outputTokens };
}

function positiveInteger(value: unknown) {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
