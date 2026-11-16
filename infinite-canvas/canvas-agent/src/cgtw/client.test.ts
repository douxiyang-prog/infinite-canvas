import assert from "node:assert/strict";
import test from "node:test";

import { parseDomText, taskFilter, type TaskQuery } from "./client.js";

const empty: TaskQuery = { db: "proj_x", mine: false, q: "", eps: "", pipeline: "", status: "", offset: 0, limit: 50 };

test("taskFilter joins conditions with and and wraps the keyword or-group in parentheses", () => {
    assert.deepEqual(taskFilter(empty, "me"), []);
    assert.deepEqual(taskFilter({ ...empty, mine: true, eps: "R1", q: "s001" }, "窦熙洋"), [["task.artist", "=", "窦熙洋"], "and", ["eps.entity", "=", "R1"], "and", "(", ["shot.entity", "has", "s001"], "or", ["task.artist", "has", "s001"], ")"]);
});

test("parseDomText merges text items and turns attachments into absolute urls", () => {
    const dom = JSON.stringify([
        { type: "text", content: "遮幅不对" },
        { type: "image", max: "/upload/p/a.png", min: "/upload/p/a_min.png" },
        { type: "image", max: "/upload/p/b.mov", min: "/upload/p/b_min.png" },
    ]);
    assert.deepEqual(parseDomText(dom, "1.2.3.4"), {
        text: "遮幅不对",
        medias: [
            { type: "image", url: "http://1.2.3.4/upload/p/a.png", thumb: "http://1.2.3.4/upload/p/a_min.png" },
            { type: "video", url: "http://1.2.3.4/upload/p/b.mov", thumb: "http://1.2.3.4/upload/p/b_min.png" },
        ],
    });
    assert.deepEqual(parseDomText("not json", "1.2.3.4"), { text: "not json", medias: [] });
});
