import { expect, test } from "bun:test";

import { defaultConfig } from "../src/stores/use-config-store";
import { buildSeedanceVideoContent, buildSeedanceVideoMetadata, buildSeedanceVideoSeconds } from "../src/services/api/video";

const config = {
    ...defaultConfig,
    size: "9:16",
    vquality: "1080",
};

test("first-frame and first-last-frame Seedance requests omit ratio", () => {
    const metadata = buildSeedanceVideoMetadata(config, [], true);
    expect("ratio" in metadata).toBe(false);
});

test("text and reference Seedance requests keep the selected ratio", () => {
    const metadata = buildSeedanceVideoMetadata(config, [], false);
    expect(metadata.ratio).toBe("9:16");
});

test("Seedance video editing follows the input video ratio and duration", () => {
    const metadata = buildSeedanceVideoMetadata(config, [], false, true);
    expect(metadata.ratio).toBe("adaptive");
    expect(buildSeedanceVideoSeconds(config, true)).toBe(-1);
});

test("Seedance frame content uses first_frame and last_frame roles", () => {
    const content = buildSeedanceVideoContent("move", ["first.png", "last.png"], [], [], "frames");
    expect(content.slice(1)).toEqual([
        { type: "image_url", image_url: { url: "first.png" }, role: "first_frame" },
        { type: "image_url", image_url: { url: "last.png" }, role: "last_frame" },
    ]);
});

test("Seedance reference content assigns every media role", () => {
    const content = buildSeedanceVideoContent("remix", ["ref.png"], ["ref.mp4"], ["ref.mp3"], "reference");
    expect(content.slice(1)).toEqual([
        { type: "image_url", image_url: { url: "ref.png" }, role: "reference_image" },
        { type: "video_url", video_url: { url: "ref.mp4" }, role: "reference_video" },
        { type: "audio_url", audio_url: { url: "ref.mp3" }, role: "reference_audio" },
    ]);
});
