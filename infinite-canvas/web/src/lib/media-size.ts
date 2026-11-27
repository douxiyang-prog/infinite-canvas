export const mediaScaleOptions = ["1k", "2k", "4k", "auto"] as const;
export const SMART_IMAGE_SIZE = "smart";
export const SMART_IMAGE_MIN_PIXELS = 921600;
export const SMART_IMAGE_MAX_PIXELS = 4624220;
export const SMART_IMAGE_MAX_RATIO = 16;
export const mediaRatioOptions = [
    { value: "1:1", width: 1, height: 1 },
    { value: "2:3", width: 2, height: 3 },
    { value: "3:2", width: 3, height: 2 },
    { value: "4:3", width: 4, height: 3 },
    { value: "3:4", width: 3, height: 4 },
    { value: "16:9", width: 16, height: 9 },
    { value: "9:16", width: 9, height: 16 },
    { value: "21:9", width: 21, height: 9 },
    { value: "9:21", width: 9, height: 21 },
    { value: "auto", width: 0, height: 0 },
] as const;

export const imageSizePresets: Record<string, Record<string, string>> = {
    "1k": { "1:1": "1024x1024", "2:3": "1024x1536", "3:2": "1536x1024", "4:3": "1024x768", "3:4": "768x1024", "16:9": "1536x864", "9:16": "864x1536", "21:9": "2016x864", "9:21": "864x2016" },
    "2k": { "1:1": "2048x2048", "2:3": "1360x2048", "3:2": "2048x1360", "4:3": "2048x1536", "3:4": "1536x2048", "16:9": "2048x1152", "9:16": "1152x2048", "21:9": "2688x1152", "9:21": "1152x2688" },
    "4k": { "1:1": "2880x2880", "2:3": "2336x3520", "3:2": "3520x2336", "4:3": "3312x2480", "3:4": "2480x3312", "16:9": "3840x2160", "9:16": "2160x3840", "21:9": "3840x1648", "9:21": "1648x3840" },
};

export function parsePixelSize(value: string) {
    const match = String(value || "").match(/^(\d+)x(\d+)$/i);
    if (!match) return null;
    return { width: Number(match[1]), height: Number(match[2]) };
}

export function parseAspectRatio(value: string) {
    const match = String(value || "").match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
    if (!match) return null;
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!width || !height) return null;
    return { width, height };
}

export function matchSourceImageSize(width: number, height: number) {
    const size = computeSourceImageSize(width, height);
    const dimensions = parsePixelSize(size);
    if (!dimensions) return null;
    return {
        source: { width, height },
        target: dimensions,
        pixels: dimensions.width * dimensions.height,
        exceedsLimit: dimensions.width * dimensions.height > SMART_IMAGE_MAX_PIXELS,
    };
}

/** Keep the source ratio while producing an image size accepted by the image request API. */
export function computeSourceImageSize(width: number, height: number) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return "auto";
    const step = 16;
    const minPixels = SMART_IMAGE_MIN_PIXELS;
    const maxPixels = SMART_IMAGE_MAX_PIXELS;
    const maxEdge = 3840;
    const sourceLongEdge = Math.max(width, height);
    const sourceRatio = sourceLongEdge / Math.min(width, height);
    const sourceOrientedRatio = width / height;
    const standardRatio = mediaRatioOptions.find((option) => option.value !== "auto" && Math.abs(option.width / option.height - sourceOrientedRatio) / sourceOrientedRatio <= 0.01);
    const preferredScale = inferMediaScale(`${width}x${height}`);
    let targetLongEdge = sourceLongEdge;
    if (standardRatio) {
        const preset = imageSizePresets[preferredScale]?.[standardRatio.value];
        const dimensions = parsePixelSize(preset || "");
        if (dimensions) targetLongEdge = Math.max(dimensions.width, dimensions.height);
    }
    const divisor = greatestCommonDivisor(Math.round(width), Math.round(height));
    const unitWidth = (Math.round(width) / divisor) * step;
    const unitHeight = (Math.round(height) / divisor) * step;
    const unitPixels = unitWidth * unitHeight;
    const minMultiplier = Math.ceil(Math.sqrt(minPixels / unitPixels));
    const maxMultiplier = Math.min(Math.floor(maxEdge / unitWidth), Math.floor(maxEdge / unitHeight), Math.floor(Math.sqrt(maxPixels / unitPixels)));
    if (minMultiplier <= maxMultiplier) {
    const preferredMultiplier = Math.max(1, Math.round(targetLongEdge / Math.max(unitWidth, unitHeight)));
        const multiplier = Math.max(minMultiplier, Math.min(maxMultiplier, preferredMultiplier));
        return `${unitWidth * multiplier}x${unitHeight * multiplier}`;
    }
    const ratio = Math.min(SMART_IMAGE_MAX_RATIO, sourceRatio);
    const landscape = width >= height;
    let longEdge = Math.min(maxEdge, Math.max(1024, targetLongEdge));
    let shortEdge = longEdge / ratio;
    const pixels = longEdge * shortEdge;
    const areaScale = pixels < minPixels ? Math.sqrt(minPixels / pixels) : pixels > maxPixels ? Math.sqrt(maxPixels / pixels) : 1;
    longEdge = Math.min(maxEdge, longEdge * areaScale);
    shortEdge = longEdge / ratio;
    const targetWidth = landscape ? longEdge : shortEdge;
    const targetHeight = landscape ? shortEdge : longEdge;
    const closest = closestGridSize(targetWidth, targetHeight, ratio, minPixels, maxPixels, maxEdge, step);
    if (closest) return `${closest.width}x${closest.height}`;
    const outputWidth = alignMediaDimension(targetWidth, step);
    const outputHeight = alignMediaDimension(targetHeight, step);
    return `${outputWidth}x${outputHeight}`;
}

export const videoRatioOptions = [
    { value: "1:1", width: 1, height: 1 },
    { value: "3:4", width: 3, height: 4 },
    { value: "4:3", width: 4, height: 3 },
    { value: "16:9", width: 16, height: 9 },
    { value: "9:16", width: 9, height: 16 },
    { value: "21:9", width: 21, height: 9 },
    { value: "auto", width: 0, height: 0 },
] as const;

export const VIDEO_SECONDS_MIN = 4;
export const VIDEO_SECONDS_MAX = 30;

export function normalizeMediaScale(value: string | undefined) {
    const scale = String(value || "").trim().toLowerCase();
    if (scale === "2k" || scale === "2048") return "2k";
    if (scale === "4k" || scale === "3840") return "4k";
    if (scale === "auto") return "auto";
    if (mediaScaleOptions.includes(scale as (typeof mediaScaleOptions)[number])) return scale;
    return "1k";
}

export function isSmartImageSize(size: string | undefined) {
    return size === SMART_IMAGE_SIZE || Boolean(size?.startsWith(`${SMART_IMAGE_SIZE}:`));
}

export function inferMediaScale(size: string, storedScale?: string) {
    if (storedScale) return normalizeMediaScale(storedScale);
    if (!size || size === "auto") return "auto";
    if (isSmartImageSize(size)) return "auto";
    if (parseAspectRatio(size)) return "auto";
    const pixels = parsePixelSize(size);
    if (!pixels) return "auto";
    const presetScale = Object.keys(imageSizePresets).find((scale) => Object.values(imageSizePresets[scale]).includes(`${pixels.width}x${pixels.height}`));
    if (presetScale) return presetScale;
    const longSide = Math.max(pixels.width, pixels.height);
    if (longSide >= 3072) return "4k";
    if (longSide >= 1536) return "2k";
    return "1k";
}

export function inferMediaRatio(size: string, fallback = "1:1") {
    if (!size || size === "auto") return "auto";
    if (isSmartImageSize(size)) return SMART_IMAGE_SIZE;
    if (mediaRatioOptions.some((item) => item.value === size)) return size;
    const pixels = parsePixelSize(size) || parseAspectRatio(size);
    if (!pixels) return fallback;
    const target = pixels.width / pixels.height;
    return mediaRatioOptions
        .filter((item) => item.value !== "auto")
        .reduce((best, item) => {
            const current = item.width / item.height;
            const bestOption = mediaRatioOptions.find((option) => option.value === best);
            const bestRatio = (bestOption?.width || 1) / Math.max(1, bestOption?.height || 1);
            return Math.abs(current - target) < Math.abs(bestRatio - target) ? item.value : best;
        }, fallback);
}

export function computeMediaSize(scale: string, ratio: string) {
    if (ratio === SMART_IMAGE_SIZE) {
        return SMART_IMAGE_SIZE;
    }
    if (ratio === "auto" || !ratio) return "auto";
    const normalizedScale = normalizeMediaScale(scale);
    if (normalizedScale === "auto") return ratio;
    return imageSizePresets[normalizedScale][ratio];
}

export function readMediaDimensions(size: string, scale: string, ratio: string) {
    if (isSmartImageSize(size) || ratio === SMART_IMAGE_SIZE) return { width: 0, height: 0 };
    const pixels = parsePixelSize(size);
    if (pixels) return pixels;
    const computed = computeMediaSize(scale === "auto" ? "1k" : scale, ratio === "auto" ? "1:1" : ratio);
    return parsePixelSize(computed) || { width: 0, height: 0 };
}

export function clampVideoSeconds(value: string) {
    const seconds = Math.floor(Number(value) || 6);
    return String(Math.max(VIDEO_SECONDS_MIN, Math.min(VIDEO_SECONDS_MAX, seconds)));
}

export function parseVideoResolution(value: string | undefined) {
    const raw = String(value || "").trim().toLowerCase();
    if (raw === "low") return "480";
    if (raw === "auto" || raw === "high" || raw === "medium") return "720";
    const number = raw.replace(/p$/i, "");
    return /^\d+$/.test(number) && Number(number) > 0 ? number : "720";
}

export function inferVideoRatio(size: string) {
    if (!size || size === "auto") return "auto";
    if (videoRatioOptions.some((item) => item.value === size)) return size;
    const pixels = parsePixelSize(size) || parseAspectRatio(size);
    if (!pixels) return "16:9";
    const target = pixels.width / pixels.height;
    return videoRatioOptions
        .filter((item) => item.value !== "auto")
        .reduce((best, item) => {
            const current = item.width / item.height;
            const bestOption = videoRatioOptions.find((option) => option.value === best);
            const bestRatio = (bestOption?.width || 16) / (bestOption?.height || 9);
            return Math.abs(current - target) < Math.abs(bestRatio - target) ? item.value : best;
        }, "16:9");
}

export function computeVideoSize(resolution: string, ratio: string) {
    if (ratio === "auto" || !ratio) return "auto";
    const parsed = parseAspectRatio(ratio);
    if (!parsed) return "auto";
    const p = Math.max(1, Math.floor(Number(parseVideoResolution(resolution)) || 720));
    const landscape = parsed.width >= parsed.height;
    const width = evenRound(landscape ? (p * parsed.width) / parsed.height : p);
    const height = evenRound(landscape ? p : (p * parsed.height) / parsed.width);
    return `${width}x${height}`;
}

export function readVideoDimensions(size: string, resolution: string, ratio: string) {
    const pixels = parsePixelSize(size);
    if (pixels) return pixels;
    const computed = computeVideoSize(resolution, ratio === "auto" ? "16:9" : ratio);
    return parsePixelSize(computed) || { width: 0, height: 0 };
}

function evenRound(value: number) {
    return Math.max(2, Math.round(value / 2) * 2);
}

function alignMediaDimension(value: number, step: number) {
    return Math.max(step, Math.ceil(value / step) * step);
}

function greatestCommonDivisor(left: number, right: number) {
    let a = Math.abs(left);
    let b = Math.abs(right);
    while (b) [a, b] = [b, a % b];
    return a || 1;
}

function closestGridSize(targetWidth: number, targetHeight: number, sourceRatio: number, minPixels: number, maxPixels: number, maxEdge: number, step: number) {
    const radius = step * 32;
    const minWidth = Math.max(step, Math.floor((targetWidth - radius) / step) * step);
    const maxWidth = Math.min(maxEdge, Math.ceil((targetWidth + radius) / step) * step);
    const minHeight = Math.max(step, Math.floor((targetHeight - radius) / step) * step);
    const maxHeight = Math.min(maxEdge, Math.ceil((targetHeight + radius) / step) * step);
    const landscape = targetWidth >= targetHeight;
    let best: { width: number; height: number; score: number } | null = null;
    for (let width = minWidth; width <= maxWidth; width += step) {
        for (let height = minHeight; height <= maxHeight; height += step) {
            if ((width >= height) !== landscape) continue;
            const pixels = width * height;
            if (pixels < minPixels || pixels > maxPixels) continue;
            const currentRatio = landscape ? width / height : height / width;
            const ratioError = Math.abs(currentRatio / sourceRatio - 1);
            const areaError = Math.abs(Math.log(pixels / (targetWidth * targetHeight)));
            const score = ratioError + areaError * 0.001;
            if (!best || score < best.score) best = { width, height, score };
        }
    }
    return best;
}
