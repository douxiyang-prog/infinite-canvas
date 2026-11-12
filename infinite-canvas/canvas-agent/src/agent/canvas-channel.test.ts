import assert from "node:assert/strict";
import test from "node:test";

import {
    chatCompletionsUrl,
    clearCanvasChannelConfig,
    publicChannelConfig,
    runCanvasChannelTurn,
    setCanvasChannelConfig,
} from "./canvas-channel.js";
import { dshSessions } from "./deepseek.js";

test("Canvas channel builds one v1 chat completions path", () => {
    assert.equal(chatCompletionsUrl("https://example.com"), "https://example.com/v1/chat/completions");
    assert.equal(chatCompletionsUrl("https://example.com/v1"), "https://example.com/v1/chat/completions");
    assert.equal(chatCompletionsUrl("https://example.com/v1/"), "https://example.com/v1/chat/completions");
    assert.equal(chatCompletionsUrl("new-api.example.com"), "https://new-api.example.com/v1/chat/completions");
    assert.equal(chatCompletionsUrl("localhost:3000/v1"), "http://localhost:3000/v1/chat/completions");
    assert.throws(() => chatCompletionsUrl("http://"), /Base URL/);
    assert.throws(() => chatCompletionsUrl("/provider"), /relative/);
});

test("Canvas channel keeps the API key private", () => {
    setCanvasChannelConfig({
        channelId: "channel-1",
        channelName: "New API",
        baseUrl: "https://example.com/v1",
        apiKey: "sk-secret",
        model: "doubao-seed-2.1-pro",
    });
    try {
        assert.deepEqual(publicChannelConfig(), {
            channelId: "channel-1",
            channelName: "New API",
            baseUrl: "https://example.com/v1",
            model: "doubao-seed-2.1-pro",
            hasApiKey: true,
        });
    } finally {
        clearCanvasChannelConfig();
    }
});

test("Canvas channel normalizes a host without a scheme", () => {
    setCanvasChannelConfig({
        channelId: "channel-1",
        channelName: "New API",
        baseUrl: "new-api.example.com/v1/",
        apiKey: "sk-secret",
        model: "doubao-seed-2.1-pro",
    });
    try {
        assert.equal(publicChannelConfig()?.baseUrl, "https://new-api.example.com/v1");
    } finally {
        clearCanvasChannelConfig();
    }
});

test("Canvas channel streams OpenAI-compatible responses into Agent events", async (t) => {
    const originalFetch = globalThis.fetch;
    const store = dshSessions as unknown as Record<string, unknown>;
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    let appendedAssistant = "";
    let settledTurnId = "";

    store.get = async () => ({
        messages: [
            { role: "user", text: "earlier question" },
            { role: "assistant", text: "earlier answer" },
        ],
    });
    store.appendUser = async () => true;
    store.appendAssistant = async (_threadId: string, _turnId: string, text: string) => {
        appendedAssistant = text;
    };
    store.settleTurn = async (_threadId: string, turnId: string) => {
        settledTurnId = turnId;
    };
    globalThis.fetch = async (input, init) => {
        requestUrl = String(input);
        requestInit = init;
        const chunks = [
            'data: {"choices":[{"delta":{"content":"你',
            '好"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"！"}}],"usage":{"prompt_tokens":7,"completion_tokens":2,"prompt_tokens_details":{"cached_tokens":3}}}\n\n',
            "data: [DONE]\n\n",
        ];
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                const encoder = new TextEncoder();
                for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
                controller.close();
            },
        });
        return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    };

    t.after(() => {
        globalThis.fetch = originalFetch;
        delete store.get;
        delete store.appendUser;
        delete store.appendAssistant;
        delete store.settleTurn;
        clearCanvasChannelConfig();
    });

    setCanvasChannelConfig({
        channelId: "channel-1",
        channelName: "New API",
        baseUrl: "https://example.com/v1",
        apiKey: "sk-secret",
        model: "doubao-seed-2.1-pro",
    });
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    await runCanvasChannelTurn({
        threadId: "thread-1",
        turnId: "turn-1",
        cwd: process.cwd(),
        prompt: "current question",
        messageText: "current question",
        attachments: [],
        emit: (type, payload) => events.push({ type, payload: payload as Record<string, unknown> }),
    });

    assert.equal(requestUrl, "https://example.com/v1/chat/completions");
    assert.equal(new Headers(requestInit?.headers).get("authorization"), "Bearer sk-secret");
    assert.deepEqual(JSON.parse(String(requestInit?.body)).messages, [
        { role: "user", content: "earlier question" },
        { role: "assistant", content: "earlier answer" },
        { role: "user", content: "current question" },
    ]);
    assert.equal(appendedAssistant, "你好！");
    assert.equal(settledTurnId, "turn-1");
    assert.deepEqual(
        events.filter((event) => event.payload.type === "item.updated").map((event) => (event.payload.item as Record<string, unknown>).delta),
        ["你好", "！"],
    );
    assert.deepEqual(events.at(-2), {
        type: "agent_event",
        payload: {
            threadId: "thread-1",
            turnId: "turn-1",
            type: "usage.updated",
            usage: { input_tokens: 7, cached_input_tokens: 3, output_tokens: 2 },
        },
    });
    assert.deepEqual(events.at(-1), {
        type: "agent_event",
        payload: {
            threadId: "thread-1",
            turnId: "turn-1",
            type: "turn.completed",
            status: "completed",
            usage: { input_tokens: 7, cached_input_tokens: 3, output_tokens: 2 },
        },
    });
    assert.equal(JSON.stringify(events).includes("sk-secret"), false);
});
