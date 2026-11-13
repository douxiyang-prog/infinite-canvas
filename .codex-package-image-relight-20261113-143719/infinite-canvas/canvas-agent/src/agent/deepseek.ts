import crypto from "node:crypto";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ReasoningEffortId as ReasoningEffortIdFn } from "@deepseek-ai/dsh-llm";
import type { DeepSeekHarness, HarnessNotification, RunResult, SdkPromptContentBlock } from "@deepseek-ai/dsh-sdk-client";

import { messageMetadataStore } from "./message-metadata.js";
import type { CodexModel, CodexReasoningEffort } from "./codex-protocol.js";
import type { AgentAttachment, AgentEmit, AgentMessageMetadata, AgentPermissionMode } from "./types.js";
import { logger } from "../utils/logger.js";
import { errorMessage } from "../utils/value.js";

type DshMessage = {
    id: string;
    itemId: string;
    threadId: string;
    turnId: string;
    role: "user" | "assistant";
    title?: string;
    text: string;
    meta?: string;
    detail?: unknown;
    attachments?: AgentMessageMetadata["attachments"];
    canvasReferences?: AgentMessageMetadata["canvasReferences"];
    skill?: AgentMessageMetadata["skill"];
};

type DshThread = {
    id: string;
    preview: string;
    name?: string | null;
    cwd?: string;
    status?: string;
    source?: unknown;
    createdAt: number;
    updatedAt: number;
    messages: DshMessage[];
    settledTurnIds: string[];
};

type DshSessionFile = {
    version: 1;
    sessions: Record<string, DshThread>;
};

export type DshSessionSnapshot = {
    thread: Omit<DshThread, "messages" | "settledTurnIds">;
    messages: DshMessage[];
    settledTurnIds: string[];
    historyReady: true;
};

type DshRunInput = {
    threadId: string;
    turnId: string;
    cwd: string;
    prompt: string;
    messageText: string;
    attachments: AgentAttachment[];
    messageMetadata?: AgentMessageMetadata;
    model?: string;
    effort?: CodexReasoningEffort;
    permissionMode?: AgentPermissionMode;
    emit: AgentEmit;
    onFinish?: () => void;
};

const DSH_ROOT = path.resolve(process.env.CANVAS_DSH_HOME || path.join(os.homedir(), ".infinite-canvas", "dsh"));
const DSH_SESSION_FILE = path.join(DSH_ROOT, "canvas-sessions.json");
const DSH_PATCH_FILE = fileURLToPath(new URL("../../dsh-ark-agent-plan.patch.yml", import.meta.url));
const DEFAULT_PROVIDER = process.env.CANVAS_DSH_PROVIDER?.trim() || "ark-agent-plan-cn";
const DEFAULT_MODEL = process.env.CANVAS_DSH_MODEL?.trim() || "deepseek-v4-pro";
const DEFAULT_EFFORT = normalizeEffort(process.env.CANVAS_DSH_REASONING_EFFORT) || "high";
const MODEL_CATALOG: Array<{ model: string; displayName: string }> = [
    { model: "deepseek-v4-pro", displayName: "DeepSeek V4 Pro" },
    { model: "deepseek-v4-flash", displayName: "DeepSeek V4 Flash" },
    { model: "doubao-seed-evolving", displayName: "Doubao Seed Evolving" },
    { model: "doubao-seed-2.1-pro", displayName: "Doubao Seed 2.1 Pro" },
    { model: "doubao-seed-2.1-turbo", displayName: "Doubao Seed 2.1 Turbo" },
    { model: "kimi-k3", displayName: "Kimi K3" },
    { model: "glm-5.3", displayName: "GLM-5.3" },
];

let harness: DeepSeekHarness | null = null;
let harnessKey = "";
let harnessStart: Promise<DeepSeekHarness> | null = null;
let queue: Promise<unknown> = Promise.resolve();
let runEpoch = 0;
let activeRuns = 0;

export function dshModels(): CodexModel[] {
    return MODEL_CATALOG.map((item) => ({
        id: item.model,
        model: item.model,
        displayName: item.displayName,
        defaultReasoningEffort: item.model === DEFAULT_MODEL ? DEFAULT_EFFORT : "high",
        supportedReasoningEfforts: [
            { reasoningEffort: "low", description: "Fast" },
            { reasoningEffort: "high", description: "Balanced" },
            { reasoningEffort: "max", description: "Deep reasoning" },
        ],
        isDefault: item.model === DEFAULT_MODEL,
    }));
}

export function dshRuntimeInfo() {
    return { provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL, available: dshInstalled() };
}

const requireFromHere = createRequire(import.meta.url);

/** 判断精简版安装包是否包含 DeepSeek Harness 运行环境。 */
export function dshInstalled() {
    try {
        requireFromHere.resolve("@deepseek-ai/dsh-sdk-client");
        return true;
    } catch {
        return false;
    }
}

async function loadDshModules(): Promise<{ DeepSeekHarness: typeof DeepSeekHarness; ReasoningEffortId: typeof ReasoningEffortIdFn }> {
    if (!dshInstalled()) throw new Error("当前安装包不包含 DeepSeek Harness 组件，请切换到火山原生 API 或 Canvas 渠道，或安装完整版 Canvas Agent Manager");
    const [llm, client] = await Promise.all([import("@deepseek-ai/dsh-llm"), import("@deepseek-ai/dsh-sdk-client")]);
    return { DeepSeekHarness: client.DeepSeekHarness, ReasoningEffortId: llm.ReasoningEffortId };
}

export async function createDshSession(cwd: string) {
    return await dshSessions.create(cwd);
}

export async function readDshSession(threadId: string): Promise<DshSessionSnapshot | undefined> {
    const thread = await dshSessions.get(threadId);
    if (!thread) return undefined;
    const messages = await messageMetadataStore.mergeThread(threadId, thread.messages);
    return {
        thread: withoutMessages(thread),
        messages,
        settledTurnIds: [...thread.settledTurnIds],
        historyReady: true,
    };
}

export async function listDshThreads(cwd: string) {
    return {
        data: (await dshSessions.list()).filter((thread) => samePath(thread.cwd || "", cwd)),
        nextCursor: null,
        backwardsCursor: null,
    };
}

export async function deleteDshSession(threadId: string) {
    await dshSessions.delete(threadId);
    await messageMetadataStore.removeThread(threadId).catch((error) => logger.warn("Failed to remove DSH message metadata", { threadId, error }));
}

export function runDshTurn(input: DshRunInput) {
    const epoch = runEpoch;
    activeRuns += 1;
    queue = queue
        .catch(() => undefined)
        .then(() => runDshTurnNow(input, epoch))
        .finally(() => {
            activeRuns = Math.max(0, activeRuns - 1);
        });
    return queue;
}

export async function interruptDshTurn() {
    runEpoch += 1;
    const current = harness;
    harness = null;
    harnessKey = "";
    harnessStart = null;
    if (current) await current.close().catch((error) => logger.warn("Failed to stop DeepSeek Harness", { error }));
    return Boolean(current) || activeRuns > 0;
}

export async function closeDshRuntime() {
    const current = harness;
    harness = null;
    harnessKey = "";
    harnessStart = null;
    if (current) await current.close();
}

async function runDshTurnNow(input: DshRunInput, epoch: number) {
    const startedAt = Date.now();
    if (epoch !== runEpoch) {
        input.emit("agent_event", {
            threadId: input.threadId,
            turnId: input.turnId,
            type: "turn.completed",
            status: "interrupted",
        });
        input.onFinish?.();
        return;
    }
    const stored = await dshSessions.appendUser(input.threadId, {
        id: `${input.threadId}:${input.turnId}:user`,
        itemId: "synthetic:user",
        threadId: input.threadId,
        turnId: input.turnId,
        role: "user",
        text: input.messageText,
        ...(input.messageMetadata || {}),
    });
    if (!stored)
        input.emit("agent_error", {
            threadId: input.threadId,
            turnId: input.turnId,
            message: "DSH 会话不存在",
        });

    if (!stored) {
        input.onFinish?.();
        return;
    }

    const agentEvent = (type: string, payload: Record<string, unknown> = {}) => {
        input.emit("agent_event", {
            threadId: input.threadId,
            turnId: input.turnId,
            type,
            ...payload,
        });
    };
    agentEvent("turn.started");

    try {
        const runtime = await ensureHarness(input.model, input.effort, input.cwd, input.permissionMode);
        const content = promptBlocks(input.prompt, input.attachments, supportsImages(input.model));
        let assistantText = "";
        let emittedAssistant = false;
        const onNotification = (notification: HarnessNotification) => {
            if (epoch !== runEpoch) return;
            emittedAssistant = mapNotification(notification, input, agentEvent) || emittedAssistant;
            assistantText = latestAssistantText(notification) || assistantText;
        };
        let run: RunResult;
        try {
            run = await runtime.session(input.threadId).run(content, { onNotification });
        } catch (error) {
            if (!/session .* already exists/i.test(errorMessage(error))) throw error;
            logger.info("Resuming persisted DeepSeek Harness session", { threadId: input.threadId });
            assistantText = "";
            emittedAssistant = false;
            run = await (await runtime.resumeSession(input.threadId)).run(content, { onNotification });
        }
        if (epoch !== runEpoch) {
            agentEvent("turn.completed", { status: "interrupted" });
            return;
        }
        const finalText = run.finalResponse || assistantText;
        if (finalText && !emittedAssistant) {
            agentEvent("item.completed", {
                item: {
                    id: `dsh:${input.threadId}:${input.turnId}:assistant`,
                    type: "agent_message",
                    text: finalText,
                    status: "completed",
                },
            });
        }
        if (finalText) await dshSessions.appendAssistant(input.threadId, input.turnId, finalText);
        await dshSessions.settleTurn(input.threadId, input.turnId);
        const failure = runFailure(run);
        agentEvent("turn.completed", {
            status: finishStatus(run),
            ...(lastUsage(run) ? { usage: lastUsage(run) } : {}),
            ...(failure ? { error: { message: failure } } : {}),
        });
    } catch (error) {
        if (epoch !== runEpoch) {
            agentEvent("turn.completed", { status: "interrupted" });
            return;
        }
        const message = errorMessage(error);
        logger.error("DeepSeek Harness turn failed", error);
        agentEvent("turn.completed", { status: "failed", error: { message } });
    } finally {
        logger.info("DeepSeek Harness turn finished", {
            threadId: input.threadId,
            turnId: input.turnId,
            durationMs: Date.now() - startedAt,
        });
        input.onFinish?.();
    }
}

async function ensureHarness(model = DEFAULT_MODEL, effort: CodexReasoningEffort | undefined = DEFAULT_EFFORT, cwd = process.cwd(), _permissionMode: AgentPermissionMode = "request") {
    const selectedModel = model || DEFAULT_MODEL;
    const selectedEffort = normalizeEffort(effort) || DEFAULT_EFFORT;
    const selectedCwd = path.resolve(cwd);
    const key = `${DEFAULT_PROVIDER}:${selectedModel}:${selectedEffort}:${selectedCwd}`;
    if (harness && harnessKey === key) return harness;
    if (harnessStart && harnessKey === key) return harnessStart;
    if (harness) {
        const previous = harness;
        harness = null;
        await previous.close().catch((error) => logger.warn("Failed to replace DeepSeek Harness runtime", { error }));
    }
    await fs.mkdir(DSH_ROOT, { recursive: true });
    harnessKey = key;
    harnessStart = (async () => {
        const { DeepSeekHarness: HarnessClass, ReasoningEffortId } = await loadDshModules();
        const env = { ...process.env };
        if (!env.ARK_AGENT_PLAN_CN_API_KEY && process.env.CANVAS_DSH_API_KEY) env.ARK_AGENT_PLAN_CN_API_KEY = process.env.CANVAS_DSH_API_KEY;
        const created = new HarnessClass({
            profile: process.env.CANVAS_DSH_PROFILE?.trim() || "sdk",
            dshHome: DSH_ROOT,
            cwd: selectedCwd,
            dshBin: process.env.CANVAS_DSH_BIN?.trim() || undefined,
            patches: DEFAULT_PROVIDER.startsWith("ark-") ? [DSH_PATCH_FILE] : undefined,
            provider: DEFAULT_PROVIDER,
            model: selectedModel,
            ...(DEFAULT_PROVIDER.startsWith("ark-") ? {} : { reasoningEffort: ReasoningEffortId(selectedEffort) }),
            approvalRequests: false,
            env,
            initializeTimeoutMs: 30_000,
            onUserQuestion: async () => ({ cancelled: true }),
        });
        await created.start();
        harness = created;
        return created;
    })();
    try {
        return await harnessStart;
    } catch (error) {
        harness = null;
        harnessKey = "";
        throw error;
    } finally {
        harnessStart = null;
    }
}

function mapNotification(notification: HarnessNotification, input: DshRunInput, agentEvent: (type: string, payload?: Record<string, unknown>) => void) {
    if (notification.method !== "session.event") return false;
    const params = notification.params as {
        sessionId?: unknown;
        event?: Record<string, unknown>;
    };
    if (String(params.sessionId || "") !== input.threadId) return false;
    const event = params.event;
    if (!event || typeof event.type !== "string") return false;
    if (event.type === "assistant/message") {
        const text = assistantMessageText(event);
        if (!text) return false;
        const seq = Number(event.seq);
        agentEvent("item.completed", {
            item: {
                id: `dsh:${input.threadId}:${input.turnId}:${Number.isFinite(seq) ? seq : crypto.randomUUID()}`,
                type: "agent_message",
                text,
                status: "completed",
            },
        });
        return true;
    }
    if (event.type === "tool/call") {
        const data = record(event.data);
        agentEvent("item.started", {
            item: {
                id: String(data.callId || crypto.randomUUID()),
                type: "mcp_tool_call",
                tool: String(data.name || "tool"),
                status: "inProgress",
                arguments: data.arguments,
            },
        });
    } else if (event.type === "tool/result") {
        const data = record(event.data);
        const message = record(data.message);
        agentEvent("item.completed", {
            item: {
                id: String(data.callId || crypto.randomUUID()),
                type: "mcp_tool_call",
                tool: "tool",
                status: data.error ? "failed" : "completed",
                result: message.content,
                ...(data.error ? { error: record(data.error) } : {}),
            },
        });
    }
    return false;
}

function latestAssistantText(notification: HarnessNotification) {
    if (notification.method !== "session.event") return "";
    const event = record(notification.params.event);
    return event.type === "assistant/message" ? assistantMessageText(event) : "";
}

function assistantMessageText(event: Record<string, unknown>) {
    const data = record(event.data);
    const message = record(data.message);
    return contentText(message.content);
}

function contentText(value: unknown): string {
    if (typeof value === "string") return value;
    if (!Array.isArray(value)) return "";
    return value
        .map((item) => {
            const block = record(item);
            return block.type === "text" && typeof block.text === "string" ? block.text : "";
        })
        .join("");
}

function finishStatus(run: { finishReason: string | null }) {
    if (run.finishReason === "error") return "failed";
    if (run.finishReason === "aborted" || run.finishReason === "interrupted") return "interrupted";
    return "completed";
}

function runFailure(run: RunResult) {
    for (let index = run.events.length - 1; index >= 0; index -= 1) {
        const event = run.events[index];
        if (event.type !== "turn/end") continue;
        const reason = record(event.data.reason);
        if (reason.kind !== "error") continue;
        const error = record(reason.error);
        const message = typeof error.message === "string" ? error.message : "";
        const code = typeof error.code === "string" ? error.code : "";
        if (message) return message;
        if (code) return code;
    }
    return run.finishReason === "error" ? "DeepSeek Harness turn failed" : "";
}

function lastUsage(run: RunResult) {
    for (let index = run.events.length - 1; index >= 0; index -= 1) {
        const event = run.events[index];
        if (event.type !== "assistant/message" || !event.data.usage) continue;
        const usage = event.data.usage;
        return {
            input_tokens: Number(usage.inputTokens || 0),
            cached_input_tokens: Number(usage.cacheReadTokens || 0),
            output_tokens: Number(usage.outputTokens || 0),
        };
    }
    return undefined;
}

function promptBlocks(prompt: string, attachments: AgentAttachment[], includeImages: boolean): SdkPromptContentBlock[] {
    const blocks: SdkPromptContentBlock[] = [{ type: "text", text: prompt }];
    if (!includeImages) {
        if (attachments.length)
            blocks.push({
                type: "text",
                text: "\n\n[The selected model does not accept image attachments.]",
            });
        return blocks;
    }
    for (const attachment of attachments) {
        const match = attachment.dataUrl?.match(/^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,(.+)$/i);
        if (!match) continue;
        const mimeType = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : (match[1].toLowerCase() as "image/png" | "image/jpeg" | "image/webp" | "image/gif");
        blocks.push({
            type: "image",
            data: match[2],
            mimeType,
            ...(attachment.name ? { name: attachment.name } : {}),
        });
    }
    return blocks;
}

function supportsImages(model: string | undefined) {
    return ["doubao-seed-evolving", "doubao-seed-2.1-pro", "doubao-seed-2.1-turbo", "kimi-k3"].includes(model || "");
}

function normalizeEffort(value: unknown): CodexReasoningEffort | undefined {
    return value === "low" || value === "high" || value === "max" ? value : undefined;
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function withoutMessages(thread: DshThread): Omit<DshThread, "messages" | "settledTurnIds"> {
    const { messages: _messages, settledTurnIds: _settledTurnIds, ...summary } = thread;
    return summary;
}

function samePath(left: string, right: string) {
    if (!left || !right) return false;
    return process.platform === "win32" ? path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase() : path.resolve(left) === path.resolve(right);
}

export class DshSessionStore {
    private data?: DshSessionFile;
    private queue: Promise<unknown> = Promise.resolve();

    constructor(private readonly file: string) {}

    async list() {
        const data = await this.read();
        return Object.values(data.sessions)
            .sort((left, right) => right.updatedAt - left.updatedAt)
            .map(withoutMessages);
    }

    async get(id: string) {
        return (await this.read()).sessions[id];
    }

    create(cwd: string): Promise<{ id: string }> {
        return this.mutate(async (data) => {
            const now = Date.now();
            const thread: DshThread = {
                id: `dsh-${crypto.randomUUID()}`,
                preview: "",
                name: null,
                cwd,
                status: "ready",
                source: "deepseek-harness",
                createdAt: now,
                updatedAt: now,
                messages: [],
                settledTurnIds: [],
            };
            data.sessions[thread.id] = thread;
            return { id: thread.id };
        });
    }

    appendUser(threadId: string, message: DshMessage) {
        return this.mutate((data) => {
            const thread = data.sessions[threadId];
            if (!thread) return false;
            thread.messages.push(message);
            thread.preview = message.text.slice(0, 160);
            thread.updatedAt = Date.now();
            thread.status = "running";
            return true;
        });
    }

    async appendAssistant(threadId: string, turnId: string, text: string) {
        await this.mutate((data) => {
            const thread = data.sessions[threadId];
            if (!thread) return;
            thread.messages.push({
                id: `${threadId}:${turnId}:assistant`,
                itemId: `dsh:${threadId}:${turnId}:assistant`,
                threadId,
                turnId,
                role: "assistant",
                title: "DeepSeek Harness",
                text,
            });
            thread.updatedAt = Date.now();
        });
    }

    async settleTurn(threadId: string, turnId: string) {
        await this.mutate((data) => {
            const thread = data.sessions[threadId];
            if (!thread) return;
            if (!thread.settledTurnIds.includes(turnId)) thread.settledTurnIds.push(turnId);
            thread.status = "ready";
            thread.updatedAt = Date.now();
        });
    }

    async delete(threadId: string) {
        await this.mutate((data) => {
            delete data.sessions[threadId];
        });
    }

    private async mutate<T>(task: (data: DshSessionFile) => T | Promise<T>): Promise<T> {
        const result = this.queue.then(async () => {
            const data = await this.read();
            const value = await task(data);
            await this.write(data);
            return value;
        });
        this.queue = result.catch(() => undefined);
        return result;
    }

    private async read() {
        if (this.data) return this.data;
        try {
            const parsed = JSON.parse(await fs.readFile(this.file, "utf8")) as Partial<DshSessionFile>;
            if (parsed.version !== 1 || !parsed.sessions || typeof parsed.sessions !== "object") throw new Error("DeepSeek Harness session index version is unsupported");
            this.data = normalizeSessionFile(parsed as DshSessionFile);
        } catch (error) {
            if (!isMissing(error)) throw error;
            this.data = { version: 1, sessions: {} };
        }
        return this.data;
    }

    private async write(data: DshSessionFile) {
        await fs.mkdir(path.dirname(this.file), { recursive: true });
        const temporary = `${this.file}.${process.pid}.${crypto.randomUUID()}.tmp`;
        try {
            await fs.writeFile(temporary, JSON.stringify(data));
            await fs.rename(temporary, this.file);
        } finally {
            await fs.rm(temporary, { force: true }).catch(() => undefined);
        }
    }
}

export const dshSessions = new DshSessionStore(DSH_SESSION_FILE);

function normalizeSessionFile(value: DshSessionFile): DshSessionFile {
    const sessions: Record<string, DshThread> = {};
    for (const [id, candidate] of Object.entries(value.sessions || {})) {
        const thread = record(candidate);
        if (typeof id !== "string" || !id || !Array.isArray(thread.messages)) continue;
        sessions[id] = {
            id,
            preview: typeof thread.preview === "string" ? thread.preview : "",
            name: typeof thread.name === "string" ? thread.name : null,
            cwd: typeof thread.cwd === "string" ? thread.cwd : undefined,
            status: typeof thread.status === "string" ? thread.status : "ready",
            source: thread.source,
            createdAt: Number(thread.createdAt) || Date.now(),
            updatedAt: Number(thread.updatedAt) || Date.now(),
            messages: thread.messages.filter((item): item is DshMessage => Boolean(record(item).id && record(item).text && record(item).role)),
            settledTurnIds: Array.isArray(thread.settledTurnIds) ? thread.settledTurnIds.map(String).filter(Boolean) : [],
        };
    }
    return { version: 1, sessions };
}

function isMissing(error: unknown) {
    return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT");
}
