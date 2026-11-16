import assert from "node:assert/strict";
import test from "node:test";

import { ffmpegArgs } from "./convert.js";

const flag = (args: string[], name: string) => args[args.indexOf(name) + 1];

test("ffmpegArgs encodes review as ProRes 422 LT at 1920x1080 and render as ProRes 4444 XQ without resizing", () => {
    const review = ffmpegArgs("in.mp4", "out.mov", { kind: "review", fps: 25, frames: 100, trim: false });
    assert.equal(flag(review, "-profile:v"), "1");
    assert.equal(flag(review, "-pix_fmt"), "yuv422p10le");
    assert.equal(flag(review, "-vf"), "fps=25,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2");
    assert.ok(!review.includes("-frames:v"));

    const render = ffmpegArgs("in.mp4", "out.mov", { kind: "render", fps: null, frames: 100, trim: true });
    assert.equal(flag(render, "-profile:v"), "5");
    assert.equal(flag(render, "-pix_fmt"), "yuv444p10le");
    assert.ok(!render.includes("-vf"));
    assert.equal(flag(render, "-frames:v"), "100");
});
