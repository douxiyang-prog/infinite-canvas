import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { DshSessionStore, dshModels } from "./deepseek.js";

test("DSH exposes DeepSeek and Ark Agent Plan models", () => {
    const models = dshModels();
    assert.ok(models.some((item) => item.model === "deepseek-v4-pro"));
    assert.ok(models.some((item) => item.model === "doubao-seed-evolving"));
    assert.ok(models.every((item) => item.supportedReasoningEfforts.length > 0));
});

test("DSH session summaries persist chat messages and settled turns", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-dsh-session-"));
    const file = path.join(directory, "sessions.json");
    const store = new DshSessionStore(file);
    const created = await store.create(directory);
    await store.appendUser(created.id, {
        id: `${created.id}:turn-1:user`,
        itemId: "synthetic:user",
        threadId: created.id,
        turnId: "turn-1",
        role: "user",
        text: "hello",
    });
    await store.appendAssistant(created.id, "turn-1", "hi");
    await store.settleTurn(created.id, "turn-1");

    const restored = new DshSessionStore(file);
    const thread = await restored.get(created.id);
    assert.equal(thread?.preview, "hello");
    assert.deepEqual(
        thread?.messages.map((item) => item.text),
        ["hello", "hi"],
    );
    assert.deepEqual(thread?.settledTurnIds, ["turn-1"]);
    assert.equal((await restored.list()).length, 1);

    await restored.delete(created.id);
    assert.equal(await restored.get(created.id), undefined);
});
