import { nanoid } from "nanoid";

import { DEFAULT_LENS_COMBO } from "@/constant/lens-combo";
import { buildLensComboPrompt } from "@/lib/canvas/canvas-lens-combo";
import { buildRelightPrompt } from "@/lib/canvas/canvas-generation-helpers";
import type { CanvasImageRelightParams, CanvasLensCombo } from "@/types/canvas";

export type PromptPresetCategory = "lens" | "lighting";

type PromptPresetBase = {
    id: string;
    name: string;
    category: PromptPresetCategory;
    enabled: boolean;
    builtIn: boolean;
    prompt: string;
};

export type LensPromptPreset = PromptPresetBase & {
    category: "lens";
    params: CanvasLensCombo;
};

export type LightingPromptPreset = PromptPresetBase & {
    category: "lighting";
    params: CanvasImageRelightParams;
};

export type PromptPreset = LensPromptPreset | LightingPromptPreset;

const lightingDefaults: Array<{ id: string; name: string; params: CanvasImageRelightParams }> = [
    { id: "lighting-morning", name: "晨光", params: { lightX: 0.65, lightY: 0.14, lightZ: 0.75, brightness: 58, temperature: 4300, softness: 55, rimLight: false } },
    { id: "lighting-noon", name: "正午", params: { lightX: 0.08, lightY: 0.92, lightZ: 0.38, brightness: 78, temperature: 5900, softness: 24, rimLight: false } },
    { id: "lighting-sunset", name: "黄昏", params: { lightX: 0.68, lightY: -0.05, lightZ: 0.73, brightness: 55, temperature: 3200, softness: 42, rimLight: true } },
    { id: "lighting-backlight", name: "逆光", params: { lightX: 0.18, lightY: 0.08, lightZ: -0.98, brightness: 48, temperature: 4600, softness: 68, rimLight: true } },
    { id: "lighting-overcast", name: "阴天", params: { lightX: 0.05, lightY: 0.56, lightZ: 0.82, brightness: 64, temperature: 6500, softness: 88, rimLight: false } },
    { id: "lighting-studio", name: "影棚", params: { lightX: -0.42, lightY: 0.34, lightZ: 0.84, brightness: 62, temperature: 5600, softness: 76, rimLight: false } },
];

const lensDefaults: Array<{ id: string; name: string; params: CanvasLensCombo }> = [
    { id: "lens-standard-cinema", name: "标准电影镜头", params: { ...DEFAULT_LENS_COMBO } },
    { id: "lens-portrait", name: "人物近景", params: { cameraId: "arri-alexa-35", lensId: "arri-signature-prime", focalLengthMm: 85, aperture: 1.8 } },
    { id: "lens-wide-environment", name: "广角环境", params: { cameraId: "red-v-raptor", lensId: "zeiss-ultra-prime", focalLengthMm: 18, aperture: 2.8 } },
    { id: "lens-telephoto", name: "长焦压缩", params: { cameraId: "sony-venice-2", lensId: "cooke-s7", focalLengthMm: 135, aperture: 2.8 } },
];

export const DEFAULT_PROMPT_PRESETS: PromptPreset[] = [
    ...lensDefaults.map((preset) => ({
        ...preset,
        category: "lens" as const,
        enabled: true,
        builtIn: true,
        prompt: buildLensComboPrompt(preset.params),
    })),
    ...lightingDefaults.map((preset) => ({
        ...preset,
        category: "lighting" as const,
        enabled: true,
        builtIn: true,
        prompt: buildRelightPrompt(preset.params),
    })),
];

export function createPromptPreset(preset?: Partial<PromptPreset>): PromptPreset {
    if (preset?.category === "lighting") {
        const params = (preset.params || lightingDefaults[0].params) as CanvasImageRelightParams;
        return { id: preset.id || nanoid(), name: preset.name?.trim() || "自定义光照", category: "lighting", enabled: preset.enabled ?? true, builtIn: preset.builtIn ?? false, params, prompt: preset.prompt?.trim() || buildRelightPrompt(params) };
    }
    const params = (preset?.params || DEFAULT_LENS_COMBO) as CanvasLensCombo;
    return { id: preset?.id || nanoid(), name: preset?.name?.trim() || "自定义镜头", category: "lens", enabled: preset?.enabled ?? true, builtIn: preset?.builtIn ?? false, params, prompt: preset?.prompt?.trim() || buildLensComboPrompt(params) };
}

export function promptPresetSummary(preset: PromptPreset) {
    if (preset.category === "lighting") {
        const p = preset.params;
        return `${Math.round(p.brightness)}% · ${Math.round(p.temperature)}K · ${Math.round(p.softness)}%`;
    }
    return `${preset.params.focalLengthMm}mm · T${preset.params.aperture}`;
}
