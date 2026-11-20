import { apertureCue, cameraOption, focalLengthCue, lensOption } from "@/constant/lens-combo";
import type { CanvasLensCombo } from "@/types/canvas";

export function lensComboSummary(value?: CanvasLensCombo) {
    if (!value) return "";
    return [cameraOption(value.cameraId)?.label, lensOption(value.lensId)?.label, `${value.focalLengthMm}mm`, `T${value.aperture}`].filter(Boolean).join(" · ");
}

export function buildLensComboPrompt(value?: CanvasLensCombo) {
    if (!value) return "";
    const camera = cameraOption(value.cameraId);
    const lens = lensOption(value.lensId);
    return [
        `Optics: ${camera?.label || value.cameraId} camera, ${lens?.label || value.lensId} ${value.focalLengthMm}mm lens at T${value.aperture}.`,
        `Render with ${camera?.cue || "cinematic digital imaging"}, ${lens?.cue || "coherent optical character"}, ${focalLengthCue(value.focalLengthMm)} and ${apertureCue(value.aperture)}.`,
        "Use these camera and lens characteristics consistently while preserving the intended subject, scene and composition.",
    ].join(" ");
}

export function appendLensComboPrompt(prompt: string, value?: CanvasLensCombo, promptOverride?: string) {
    const optics = promptOverride?.trim() || buildLensComboPrompt(value);
    return optics && !/\bOptics:\s/i.test(prompt) ? `${prompt.trim()}\n\n${optics}` : prompt;
}
