import { clampVideoSeconds, parseVideoResolution } from "@/lib/media-size";
import { modelOptionName, resolveVideoDurationMode, type AiConfig } from "@/stores/use-config-store";

const SEEDANCE_RESOLUTION_PIXELS: Record<string, [number, number]> = {
    "480p": [854, 480],
    "720p": [1280, 720],
    "1080p": [1920, 1080],
    "4k": [3840, 2160],
};

const SEEDANCE_MAX_SECONDS: Record<string, number> = {
    "doubao-seedance-2.5": 30,
    "doubao-seedance-2.0": 15,
    "doubao-seedance-2.0-fast": 15,
    "doubao-seedance-2.0-mini": 15,
};

const VIDEO_DURATION_ANCHORS = [
    { seconds: 1, expectedSeconds: 45 },
    { seconds: 2, expectedSeconds: 52 },
    { seconds: 4, expectedSeconds: 80 },
    { seconds: 5, expectedSeconds: 95 },
    { seconds: 6, expectedSeconds: 115 },
    { seconds: 7, expectedSeconds: 132 },
    { seconds: 10, expectedSeconds: 185 },
    { seconds: 15, expectedSeconds: 260 },
    { seconds: 30, expectedSeconds: 470 },
] as const;

export type VideoBillingUsage = {
    seconds: number;
    duration: number;
    automatic: boolean;
    resolution: string;
    tokens: number;
    video_input: "none" | "video";
    generate_audio: boolean;
    clips: number;
};

export function buildVideoBillingUsage(config: AiConfig, hasReferenceVideo: boolean): VideoBillingUsage {
    const model = modelOptionName(config.model || config.videoModel);
    const resolution = `${parseVideoResolution(config.vquality)}p`;
    const seconds = resolveVideoEstimateSeconds(config, model);
    const [width, height] = SEEDANCE_RESOLUTION_PIXELS[resolution] || SEEDANCE_RESOLUTION_PIXELS["720p"];
    return {
        seconds,
        duration: seconds,
        automatic: resolveVideoDurationMode(config) === "auto",
        resolution,
        tokens: Math.round((seconds * width * height * 24) / 1024),
        video_input: hasReferenceVideo ? "video" : "none",
        generate_audio: config.videoGenerateAudio === "true",
        clips: 1,
    };
}

export function estimateVideoGenerationMs(config: AiConfig): number {
    const model = modelOptionName(config.model || config.videoModel);
    const seconds = resolveVideoEstimateSeconds(config, model);
    const resolution = parseVideoResolution(config.vquality);
    const seedance = /seedance/i.test(model);
    const modelMultiplier = /seedance-2\.5/i.test(model) ? 1.3 : seedance ? 1 : 1.1;
    const baseSeconds = interpolateExpectedSeconds(seconds) * modelMultiplier;
    const resolutionMultiplier = resolution === "4k" ? 1.7 : resolution === "1080" ? 1.25 : resolution === "480" ? 0.9 : 1;
    const audioMultiplier = config.videoGenerateAudio === "true" && seedance ? 1.12 : 1;
    return Math.round(baseSeconds * resolutionMultiplier * audioMultiplier * 1000);
}

export function estimatedVideoProgress(startedAt: number | undefined, expectedMs: number | undefined, phase: "queued" | "running" | "finalizing" | undefined, now = Date.now()) {
    if (!startedAt || !expectedMs || expectedMs <= 0) return 0;
    const ratio = Math.max(0, now - startedAt) / expectedMs;
    if (phase === "queued") return Math.min(10, 5 + Math.floor(Math.max(0, now - startedAt) / 2000));
    if (phase === "finalizing") return 95;
    return Math.min(92, Math.max(10, Math.round(10 + (1 - Math.exp(-2.2 * ratio)) * 82)));
}

export function resolveVideoEstimateSeconds(config: AiConfig, model = modelOptionName(config.model || config.videoModel)) {
    if (resolveVideoDurationMode({ ...config, model }) === "auto") {
        return SEEDANCE_MAX_SECONDS[model] || 30;
    }
    return Number(clampVideoSeconds(config.videoSeconds));
}

function interpolateExpectedSeconds(seconds: number) {
    if (seconds <= VIDEO_DURATION_ANCHORS[0].seconds) return VIDEO_DURATION_ANCHORS[0].expectedSeconds;
    const last = VIDEO_DURATION_ANCHORS[VIDEO_DURATION_ANCHORS.length - 1];
    if (seconds >= last.seconds) return last.expectedSeconds;
    for (let index = 1; index < VIDEO_DURATION_ANCHORS.length; index += 1) {
        const right = VIDEO_DURATION_ANCHORS[index];
        if (seconds > right.seconds) continue;
        const left = VIDEO_DURATION_ANCHORS[index - 1];
        const ratio = (seconds - left.seconds) / (right.seconds - left.seconds);
        return left.expectedSeconds + (right.expectedSeconds - left.expectedSeconds) * ratio;
    }
    return last.expectedSeconds;
}
