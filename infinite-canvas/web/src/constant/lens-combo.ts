import type { CanvasLensCombo } from "@/types/canvas";

export type LensComboOption = {
    id: string;
    label: string;
    cue: string;
};

export const CAMERA_OPTIONS: LensComboOption[] = [
    { id: "sony-venice-2", label: "Sony VENICE 2", cue: "filmic color science, gentle highlight rolloff and rich tonal separation" },
    { id: "arri-alexa-35", label: "ARRI ALEXA 35", cue: "natural skin tones, wide dynamic range and refined cinematic color" },
    { id: "red-v-raptor", label: "RED V-RAPTOR", cue: "crisp large-format detail with a contemporary high-contrast character" },
    { id: "blackmagic-ursa-cine", label: "Blackmagic URSA Cine", cue: "clean large-format digital rendering with tactile texture" },
    { id: "canon-c500", label: "Canon EOS C500 II", cue: "smooth organic color and warm natural skin rendering" },
    { id: "panavision-dxl2", label: "Panavision DXL2", cue: "large-format cinematic depth with rich, restrained color" },
];

export const LENS_OPTIONS: LensComboOption[] = [
    { id: "zeiss-ultra-prime", label: "Zeiss Ultra Prime", cue: "clean spherical rendering, precise focus and gentle optical falloff" },
    { id: "arri-signature-prime", label: "ARRI Signature Prime", cue: "smooth focus rolloff and soft, dimensional character" },
    { id: "cooke-s7", label: "Cooke S7/i", cue: "warm contrast and the characteristic Cooke focus falloff" },
    { id: "panavision-primo", label: "Panavision Primo", cue: "balanced contrast, natural skin tones and smooth bokeh" },
    { id: "canon-k35", label: "Canon K35", cue: "vintage warmth, delicate halation and gentle edge softness" },
    { id: "atlas-orion", label: "Atlas Orion Anamorphic", cue: "oval bokeh, horizontal flare and widescreen anamorphic character" },
];

export const FOCAL_LENGTH_OPTIONS = [14, 18, 21, 24, 28, 35, 40, 50, 65, 75, 85, 100, 135].map((value) => ({
    value,
    label: `${value} mm`,
}));

export const APERTURE_OPTIONS = [1.4, 1.8, 2, 2.8, 4, 5.6, 8].map((value) => ({
    value,
    label: `T${value}`,
}));

export const DEFAULT_LENS_COMBO: CanvasLensCombo = {
    cameraId: "sony-venice-2",
    lensId: "zeiss-ultra-prime",
    focalLengthMm: 35,
    aperture: 1.4,
};

export function cameraOption(id: string) {
    return CAMERA_OPTIONS.find((option) => option.id === id);
}

export function lensOption(id: string) {
    return LENS_OPTIONS.find((option) => option.id === id);
}

export function focalLengthCue(focalLengthMm: number) {
    if (focalLengthMm <= 21) return "wide-angle perspective with strong environmental context and pronounced spatial depth";
    if (focalLengthMm <= 35) return "medium-wide natural perspective with open environmental framing";
    if (focalLengthMm <= 50) return "natural cinematic perspective with balanced subject and background";
    if (focalLengthMm <= 85) return "compressed portrait perspective with stronger subject isolation";
    return "telephoto perspective with pronounced background compression";
}

export function apertureCue(aperture: number) {
    if (aperture <= 1.8) return "very shallow depth of field, smooth bokeh and strong subject separation";
    if (aperture <= 2.8) return "shallow depth of field with softly separated background";
    if (aperture <= 5.6) return "moderately deep focus with a natural balance between subject and setting";
    return "deep focus with the environment clearly readable";
}
