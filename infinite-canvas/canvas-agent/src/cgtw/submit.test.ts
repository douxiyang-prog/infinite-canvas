import assert from "node:assert/strict";
import test from "node:test";

import { checkVideo, nameFor, ruleOf } from "./submit.js";

const meta = (fps: number | null, frames: number | null, width: number | null, height: number | null) => ({ fps, frames, width, height });

test("ruleOf treats a trailing .* as any extension and keeps a literal extension otherwise", () => {
    assert.deepEqual(ruleOf({ rule: ["S001_0020_mattepainting_v###.*"] }), { rule: "S001_0020_mattepainting_v###", pad: 3, ext: "" });
    assert.deepEqual(ruleOf({ rule: ["S001_0020_cmp_cmp_v####.mov"] }), { rule: "S001_0020_cmp_cmp_v####.mov", pad: 4, ext: ".mov" });
    assert.equal(nameFor("S001_0020_mattepainting_v###", 3, 1, ".png", ""), "S001_0020_mattepainting_v001.png");
});

test("nameFor fills the # placeholder with the padded version and only appends the extension when the rule has none", () => {
    assert.equal(nameFor("S001_0020_cmp_cmp_v####.mov", 4, 11, ".mov", ".mov"), "S001_0020_cmp_cmp_v0011.mov");
    assert.equal(nameFor("S001_0020_cmp_cmp_v####", 4, 12, ".png", ""), "S001_0020_cmp_cmp_v0012.png");
});

test("checkVideo rejects wrong fps, frame count, undetectable meta, and wrong resolution per kind", () => {
    assert.deepEqual(checkVideo(meta(25, 100, 1920, 1080), "review", 25, 100), []);
    assert.deepEqual(checkVideo(meta(24, 100, 1920, 1080), "review", 25, 100), ["帧率不符：检测 24.000 fps，要求 25 fps"]);
    assert.deepEqual(checkVideo(meta(25, 99, 1920, 1080), "review", 25, 100), ["帧数不符：检测 99 帧，任务要求 100 帧"]);
    assert.deepEqual(checkVideo(meta(null, null, null, null), "review", 25, 100), ["无法检测帧率（要求 25 fps）", "无法检测帧数（任务要求 100 帧）"]);
    assert.deepEqual(checkVideo(meta(25, 100, 1280, 720), "review", 25, 100), ["小样分辨率要求 1920x1080，当前为 1280x720"]);
    assert.deepEqual(checkVideo(meta(25, 100, 1920, 1080), "render", 25, 100), ["大样不能是 1920x1080"]);
    assert.deepEqual(checkVideo(meta(30, 7, 1920, 1080), "review", null, null), []);
});
