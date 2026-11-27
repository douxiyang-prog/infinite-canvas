import { expect, test } from "bun:test";

import { matchSourceImageSize, SMART_IMAGE_MAX_PIXELS } from "../src/lib/media-size";

test("returns the same smart-match size used by image requests", () => {
    expect(matchSourceImageSize(1024, 1024)).toMatchObject({ target: { width: 1024, height: 1024 }, pixels: 1_048_576, exceedsLimit: false });
    expect(matchSourceImageSize(1024, 576)).toMatchObject({ target: { width: 1536, height: 864 }, pixels: 1_327_104, exceedsLimit: false });
    expect(matchSourceImageSize(1600, 688)).toMatchObject({ target: { width: 3200, height: 1376 }, pixels: 4_403_200, exceedsLimit: false });
    expect(matchSourceImageSize(1532, 462)).toMatchObject({ target: { width: 2016, height: 608 }, pixels: 1_225_728, exceedsLimit: false });
});

test("keeps smart-matched output within the model pixel limit", () => {
    for (const [width, height] of [
        [4096, 4096],
        [1024, 64],
        [64, 1024],
    ]) {
        const match = matchSourceImageSize(width, height);
        expect(match).not.toBeNull();
        expect(match!.pixels).toBeLessThanOrEqual(SMART_IMAGE_MAX_PIXELS);
    }
});
