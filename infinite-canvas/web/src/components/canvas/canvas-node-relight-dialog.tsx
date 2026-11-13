import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Button, Modal, Segmented, Switch, Tooltip } from "antd";
import { ArrowUp, Box, Info, RotateCcw, SunMedium, Thermometer } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { AiConfig } from "@/stores/use-config-store";
import type { CanvasImageRelightParams } from "@/types/canvas";
import { NewApiGenerationCost } from "./new-api-generation-cost";

export const defaultRelightParams: CanvasImageRelightParams = {
    lightX: 0.44,
    lightY: 0.38,
    lightZ: 0.812,
    brightness: 50,
    temperature: 5600,
    softness: 50,
    rimLight: false,
};

const lightPositions = [
    { id: "left", x: -0.96, y: 0, z: 0.28 },
    { id: "top", x: 0, y: 0.96, z: 0.28 },
    { id: "right", x: 0.96, y: 0, z: 0.28 },
    { id: "front", x: 0, y: 0, z: 1 },
    { id: "bottom", x: 0, y: -0.96, z: 0.28 },
    { id: "back", x: 0, y: 0, z: -1 },
] as const;

const relightPresets: Array<{ id: string; params: Partial<CanvasImageRelightParams> }> = [
    { id: "morning", params: { lightX: 0.65, lightY: 0.14, lightZ: 0.75, brightness: 58, temperature: 4300, softness: 55, rimLight: false } },
    { id: "noon", params: { lightX: 0.08, lightY: 0.92, lightZ: 0.38, brightness: 78, temperature: 5900, softness: 24, rimLight: false } },
    { id: "sunset", params: { lightX: 0.68, lightY: -0.05, lightZ: 0.73, brightness: 55, temperature: 3200, softness: 42, rimLight: true } },
    { id: "backlight", params: { lightX: 0.18, lightY: 0.08, lightZ: -0.98, brightness: 48, temperature: 4600, softness: 68, rimLight: true } },
    { id: "overcast", params: { lightX: 0.05, lightY: 0.56, lightZ: 0.82, brightness: 64, temperature: 6500, softness: 88, rimLight: false } },
    { id: "studio", params: { lightX: -0.42, lightY: 0.34, lightZ: 0.84, brightness: 62, temperature: 5600, softness: 76, rimLight: false } },
];

export function CanvasNodeRelightDialog({
    dataUrl,
    config,
    initialParams,
    open,
    onClose,
    onConfirm,
}: {
    dataUrl: string;
    config: AiConfig;
    initialParams?: CanvasImageRelightParams;
    open: boolean;
    onClose: () => void;
    onConfirm: (params: CanvasImageRelightParams) => void;
}) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [params, setParams] = useState(defaultRelightParams);
    const [view, setView] = useState<"perspective" | "front">("perspective");
    const draggingRef = useRef(false);

    useEffect(() => {
        if (!open) return;
        setParams(normalizeRelightParams(initialParams || defaultRelightParams));
        setView("perspective");
    }, [dataUrl, initialParams, open]);

    const update = <Key extends keyof CanvasImageRelightParams>(key: Key, value: CanvasImageRelightParams[Key]) => setParams((current) => ({ ...current, [key]: value }));

    const updateFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (!draggingRef.current) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const rawX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const rawY = 1 - ((event.clientY - rect.top) / rect.height) * 2;
        const radius = Math.hypot(rawX, rawY);
        const scale = radius > 1 ? 1 / radius : 1;
        const lightX = rawX * scale;
        const lightY = rawY * scale;
        setParams((current) => {
            const hemisphere = current.lightZ < 0 ? -1 : 1;
            const lightZ = Math.sqrt(Math.max(0, 1 - lightX * lightX - lightY * lightY));
            return { ...current, lightX, lightY, lightZ: lightZ * hemisphere };
        });
    };

    const updateVector = (key: "lightX" | "lightY" | "lightZ", value: number) => {
        setParams((current) => normalizeRelightParams({ ...current, [key]: value }));
    };

    const setDirection = (axis: "horizontal" | "vertical" | "depth", value: string) => {
        setParams((current) => {
            const next = { ...current };
            if (axis === "horizontal") next.lightX = value === "left" ? -0.65 : value === "right" ? 0.65 : 0;
            if (axis === "vertical") next.lightY = value === "bottom" ? -0.65 : value === "top" ? 0.65 : 0;
            if (axis === "depth") {
                next.lightZ = value === "front" ? 0.72 : value === "back" ? -0.72 : 0;
                if (value === "side" && Math.hypot(next.lightX, next.lightY) < 0.08) next.lightX = 0.24;
            }
            return normalizeRelightParams(next);
        });
    };

    const applyPreset = (preset: Partial<CanvasImageRelightParams>) => setParams(normalizeRelightParams({ ...defaultRelightParams, ...preset }));

    const startDragging = (event: ReactPointerEvent<HTMLDivElement>) => {
        draggingRef.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        updateFromPointer(event);
    };

    const stopDragging = (event: ReactPointerEvent<HTMLDivElement>) => {
        draggingRef.current = false;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    };

    const activePosition = useMemo(
        () =>
            lightPositions.reduce(
                (best, item) => {
                    const distance = Math.hypot(params.lightX - item.x, params.lightY - item.y, params.lightZ - item.z);
                    return distance < best.distance ? { id: item.id, distance } : best;
                },
                { id: "front", distance: Number.POSITIVE_INFINITY },
            ).id,
        [params.lightX, params.lightY, params.lightZ],
    );
    const horizontalDirection = params.lightX < -0.18 ? "left" : params.lightX > 0.18 ? "right" : "center";
    const verticalDirection = params.lightY < -0.18 ? "bottom" : params.lightY > 0.18 ? "top" : "middle";
    const depthDirection = params.lightZ < -0.2 ? "back" : params.lightZ > 0.2 ? "front" : "side";
    const [lightRed, lightGreen, lightBlue] = temperatureRgb(params.temperature);
    const lightColor = `rgb(${lightRed}, ${lightGreen}, ${lightBlue})`;
    const lightAlpha = (alpha: number) => `rgba(${lightRed}, ${lightGreen}, ${lightBlue}, ${alpha})`;
    const planeTransform = view === "front" ? "" : "perspective(300px) rotateY(-30deg) rotateX(10deg) rotateZ(-2deg)";
    const lightLeft = 50 + params.lightX * 38;
    const lightTop = 50 - params.lightY * 38;
    const isBackLight = params.lightZ < 0;

    return (
        <Modal open={open && Boolean(dataUrl)} onCancel={onClose} footer={null} width={860} centered destroyOnHidden styles={{ body: { padding: 0 } }}>
            <div className="overflow-hidden rounded-2xl" style={{ color: theme.node.text, background: theme.node.panel, border: `1px solid ${theme.node.stroke}` }}>
                <h2 className="sr-only">{t("canvas.editors.relightTitle")}</h2>
                <div className="grid md:grid-cols-[minmax(0,1fr)_350px]">
                    <section className="relative flex min-h-[370px] flex-col justify-end p-4" style={{ background: `${theme.node.fill}66`, borderRight: `1px solid ${theme.node.stroke}` }}>
                        <div className="absolute left-4 top-4 z-30">
                            <Segmented
                                size="small"
                                value={view}
                                options={[
                                    { label: t("canvas.editors.relightPerspective"), value: "perspective" },
                                    { label: t("canvas.editors.relightFront"), value: "front" },
                                ]}
                                onChange={(value) => setView(value as "perspective" | "front")}
                            />
                        </div>
                        <div className="mx-auto mt-12 w-[190px] max-w-full">
                            <div
                                className="relative aspect-square cursor-crosshair touch-none overflow-hidden rounded-xl border shadow-lg"
                                style={{ borderColor: theme.node.stroke, background: theme.node.panel }}
                                onPointerDown={startDragging}
                                onPointerMove={updateFromPointer}
                                onPointerUp={stopDragging}
                                onPointerCancel={stopDragging}
                                aria-label={t("canvas.editors.relightDragHint")}
                            >
                                <LightingPreviewImage
                                    dataUrl={dataUrl}
                                    brightness={params.brightness}
                                    lightLeft={lightLeft}
                                    lightTop={lightTop}
                                    lightZ={params.lightZ}
                                    rimLight={params.rimLight}
                                    lightColor={lightColor}
                                    lightAlpha={lightAlpha}
                                    className="size-full"
                                />
                                <div
                                    className="pointer-events-none absolute z-20 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full"
                                    style={{
                                        left: `${lightLeft}%`,
                                        top: `${lightTop}%`,
                                        background: theme.node.panel,
                                        border: `2px ${isBackLight ? "dashed" : "solid"} ${theme.node.text}`,
                                        boxShadow: `0 0 0 2px ${theme.node.panel}, 0 0 18px 6px ${lightAlpha(0.55)}`,
                                        opacity: isBackLight ? 0.55 : 1,
                                    }}
                                />
                                <span className="absolute left-2 top-2 z-30 rounded-full px-2 py-1 text-[10px] font-medium backdrop-blur" style={{ background: `${theme.node.panel}e6`, color: theme.node.text, border: `1px solid ${theme.node.stroke}` }}>
                                    {t("canvas.editors.relightEffectPreview")}
                                </span>
                            </div>
                        </div>
                        <div
                            className="relative mx-auto mt-3 aspect-square w-full max-w-[250px] cursor-crosshair touch-none select-none rounded-full"
                            onPointerDown={startDragging}
                            onPointerMove={updateFromPointer}
                            onPointerUp={stopDragging}
                            onPointerCancel={stopDragging}
                            aria-label={t("canvas.editors.relightDragHint")}
                        >
                            <div
                                className="absolute inset-[7%] rounded-full"
                                style={{
                                    border: `1px solid ${theme.node.stroke}`,
                                    background: `radial-gradient(circle at ${lightLeft}% ${lightTop}%, ${lightAlpha(0.2)} 0%, transparent 38%), radial-gradient(circle at 50% 58%, color-mix(in srgb, ${theme.node.fill} 72%, ${theme.node.text} 12%) 0%, ${theme.node.panel} 78%)`,
                                    boxShadow: `inset 0 0 45px ${theme.node.stroke}55`,
                                }}
                            />
                            <div className="absolute inset-[18%] rounded-full border border-dashed" style={{ borderColor: `${theme.node.stroke}90` }} />
                            <div className="absolute inset-[34%] rounded-full border" style={{ borderColor: `${theme.node.stroke}65` }} />
                            <svg className="pointer-events-none absolute inset-0 size-full" viewBox="0 0 100 100" aria-hidden="true">
                                <defs>
                                    <linearGradient id="relight-ray" x1={lightLeft} y1={lightTop} x2="50" y2="50" gradientUnits="userSpaceOnUse">
                                        <stop offset="0%" stopColor={lightColor} stopOpacity="0.85" />
                                        <stop offset="100%" stopColor={lightColor} stopOpacity="0.06" />
                                    </linearGradient>
                                </defs>
                                <polygon points={`${lightLeft},${lightTop} 32,60 68,60`} fill={lightColor} opacity={params.lightZ < -0.2 ? 0.05 : 0.16} />
                                <line x1={lightLeft} y1={lightTop} x2="50" y2="50" stroke="url(#relight-ray)" strokeWidth="0.8" strokeDasharray={params.lightZ < -0.2 ? "1.5 1.5" : undefined} />
                            </svg>
                            <div className="absolute left-1/2 top-1/2 z-10 h-[32%] w-[32%] -translate-x-1/2 -translate-y-1/2">
                                <div
                                    className="size-full rounded-lg p-1 transition-transform duration-150"
                                    style={{
                                        transform: planeTransform,
                                        background: "#ecebe7",
                                        border: "1px solid rgba(255,255,255,.55)",
                                        boxShadow: `0 18px 34px rgba(0,0,0,.24), 0 0 24px ${lightAlpha(0.14)}`,
                                    }}
                                >
                                    <LightingPreviewImage
                                        dataUrl={dataUrl}
                                        brightness={params.brightness}
                                        lightLeft={lightLeft}
                                        lightTop={lightTop}
                                        lightZ={params.lightZ}
                                        rimLight={params.rimLight}
                                        lightColor={lightColor}
                                        lightAlpha={lightAlpha}
                                        className="size-full rounded-md"
                                    />
                                </div>
                            </div>
                            <div
                                className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full"
                                style={{
                                    left: `${lightLeft}%`,
                                    top: `${lightTop}%`,
                                    background: theme.node.panel,
                                    border: `2px solid ${theme.node.text}`,
                                    boxShadow: `0 0 0 3px ${theme.node.panel}, 0 0 26px 9px ${lightAlpha(0.67)}`,
                                    opacity: 0.45 + ((params.lightZ + 1) / 2) * 0.55,
                                    scale: `${0.72 + ((params.lightZ + 1) / 2) * 0.28}`,
                                    zIndex: isBackLight ? 5 : 20,
                                    borderStyle: isBackLight ? "dashed" : "solid",
                                }}
                            />
                        </div>
                        <div className="mt-2 grid grid-cols-[auto_1fr_auto] items-center gap-2">
                            <span className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs" style={{ background: theme.toolbar.activeBg, color: theme.toolbar.activeText }}>
                                <SunMedium className="size-3.5" />
                                {t(`canvas.editors.relightPosition_${activePosition}`)}
                            </span>
                            <span className="text-center text-[11px] tabular-nums opacity-55" aria-live="polite">
                                X {formatAxis(params.lightX)} · Y {formatAxis(params.lightY)} · Z {formatAxis(params.lightZ)}
                            </span>
                            <Button size="small" type="text" icon={<RotateCcw className="size-4" />} onClick={() => setParams(defaultRelightParams)}>
                                {t("canvas.editors.reset")}
                            </Button>
                        </div>
                    </section>

                    <section className="flex min-h-[370px] flex-col p-5">
                        <div className="flex-1 space-y-5">
                            <section className="space-y-2">
                                <h3 className="text-sm font-semibold">{t("canvas.editors.relightPresets")}</h3>
                                <div className="grid grid-cols-3 gap-2">
                                    {relightPresets.map((preset) => (
                                        <Button key={preset.id} size="small" onClick={() => applyPreset(preset.params)}>
                                            {t(`canvas.editors.relightPreset_${preset.id}`)}
                                        </Button>
                                    ))}
                                </div>
                            </section>

                            <section className="space-y-2">
                                <h3 className="text-sm font-semibold">{t("canvas.editors.relightDirection")}</h3>
                                <DirectionRow
                                    label={t("canvas.editors.relightHorizontal")}
                                    value={horizontalDirection}
                                    options={[
                                        ["left", t("canvas.editors.relightDirectionLeft")],
                                        ["center", t("canvas.editors.relightDirectionCenter")],
                                        ["right", t("canvas.editors.relightDirectionRight")],
                                    ]}
                                    onChange={(value) => setDirection("horizontal", value)}
                                />
                                <DirectionRow
                                    label={t("canvas.editors.relightHeight")}
                                    value={verticalDirection}
                                    options={[
                                        ["bottom", t("canvas.editors.relightDirectionLow")],
                                        ["middle", t("canvas.editors.relightDirectionLevel")],
                                        ["top", t("canvas.editors.relightDirectionHigh")],
                                    ]}
                                    onChange={(value) => setDirection("vertical", value)}
                                />
                                <DirectionRow
                                    label={t("canvas.editors.relightDepth")}
                                    value={depthDirection}
                                    options={[
                                        ["front", t("canvas.editors.relightDirectionFrontLight")],
                                        ["side", t("canvas.editors.relightDirectionSideLight")],
                                        ["back", t("canvas.editors.relightDirectionBackLight")],
                                    ]}
                                    onChange={(value) => setDirection("depth", value)}
                                />
                            </section>

                            <section className="space-y-3">
                                <RelightSlider icon={<SunMedium className="size-4" />} label={t("canvas.editors.relightBrightness")} value={params.brightness} min={0} max={100} suffix="%" onChange={(value) => update("brightness", value)} />
                                <RelightSlider icon={<Box className="size-4" />} label={t("canvas.editors.relightSoftness")} value={params.softness} min={0} max={100} suffix="%" onChange={(value) => update("softness", value)} />
                            </section>

                            <div className="flex items-center justify-between gap-4">
                                <div>
                                    <div className="flex items-center gap-1.5 text-sm font-semibold">
                                        {t("canvas.editors.relightRim")}
                                        <Tooltip title={t("canvas.editors.relightRimHint")}>
                                            <Info className="size-3.5 opacity-45" />
                                        </Tooltip>
                                    </div>
                                    <div className="mt-0.5 text-xs opacity-55">{t("canvas.editors.relightRimHint")}</div>
                                </div>
                                <Switch checked={params.rimLight} onChange={(checked) => update("rimLight", checked)} />
                            </div>

                            <details className="rounded-lg border px-3 py-2" style={{ borderColor: theme.node.stroke }}>
                                <summary className="cursor-pointer text-xs font-medium opacity-60">{t("canvas.editors.relightAdvanced")}</summary>
                                <div className="mt-3 space-y-3">
                                    <RelightSlider
                                        icon={<Thermometer className="size-4" />}
                                        label={t("canvas.editors.relightTemperature")}
                                        value={params.temperature}
                                        min={2000}
                                        max={10000}
                                        step={100}
                                        suffix="K"
                                        onChange={(value) => update("temperature", value)}
                                    />
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-medium opacity-65">{t("canvas.editors.relightCoordinates")}</span>
                                        <span className="text-[10px] tabular-nums opacity-45">x² + y² + z² = 1</span>
                                    </div>
                                    <RelightSlider icon={<Box className="size-4" />} label={t("canvas.editors.relightAxisX")} value={params.lightX} min={-1} max={1} step={0.01} suffix="" onChange={(value) => updateVector("lightX", value)} />
                                    <RelightSlider icon={<Box className="size-4" />} label={t("canvas.editors.relightAxisY")} value={params.lightY} min={-1} max={1} step={0.01} suffix="" onChange={(value) => updateVector("lightY", value)} />
                                    <RelightSlider icon={<Box className="size-4" />} label={t("canvas.editors.relightAxisZ")} value={params.lightZ} min={-1} max={1} step={0.01} suffix="" onChange={(value) => updateVector("lightZ", value)} />
                                    <p className="text-[11px] leading-4 opacity-45">{t("canvas.editors.relightCoordinateHint")}</p>
                                </div>
                            </details>
                        </div>

                        <div className="mt-5 flex items-center justify-between gap-3 border-t pt-4" style={{ borderColor: theme.node.stroke }}>
                            <span className="text-xs opacity-45">{t("canvas.editors.relightDragHint")}</span>
                            <div className="flex items-center gap-2">
                                <NewApiGenerationCost config={config} mode="image" count={1} />
                                <Button type="primary" shape="circle" size="large" icon={<ArrowUp className="size-5" />} onClick={() => onConfirm(params)} aria-label={t("canvas.editors.relightGenerate")} />
                            </div>
                        </div>
                    </section>
                </div>
            </div>
        </Modal>
    );
}

function RelightSlider({ icon, label, value, min, max, step = 1, suffix, onChange }: { icon: ReactNode; label: string; value: number; min: number; max: number; step?: number; suffix: string; onChange: (value: number) => void }) {
    return (
        <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
                <span className="inline-flex items-center gap-2 opacity-70">
                    {icon}
                    {label}
                </span>
                <span className="font-medium tabular-nums">{Number.isInteger(value) ? `${value} ${suffix}` : formatAxis(value)}</span>
            </div>
            <input className="h-4 w-full cursor-pointer accent-current" type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} aria-label={label} />
        </div>
    );
}

function DirectionRow({ label, value, options, onChange }: { label: string; value: string; options: Array<[string, string]>; onChange: (value: string) => void }) {
    return (
        <div className="grid grid-cols-[60px_1fr] items-center gap-2">
            <span className="text-xs opacity-55">{label}</span>
            <div className="grid grid-cols-3 gap-1">
                {options.map(([optionValue, optionLabel]) => (
                    <Button key={optionValue} size="small" type={value === optionValue ? "primary" : "default"} onClick={() => onChange(optionValue)}>
                        {optionLabel}
                    </Button>
                ))}
            </div>
        </div>
    );
}

function LightingPreviewImage({
    dataUrl,
    brightness,
    lightLeft,
    lightTop,
    lightZ,
    rimLight,
    lightColor,
    lightAlpha,
    className,
}: {
    dataUrl: string;
    brightness: number;
    lightLeft: number;
    lightTop: number;
    lightZ: number;
    rimLight: boolean;
    lightColor: string;
    lightAlpha: (alpha: number) => string;
    className: string;
}) {
    const isBackLight = lightZ < 0;
    return (
        <div className={`relative overflow-hidden ${className}`}>
            <img src={dataUrl} alt="" className="size-full object-cover" draggable={false} style={{ filter: `brightness(${0.5 + brightness / 100})` }} />
            <div
                className="pointer-events-none absolute inset-0 mix-blend-screen"
                style={{
                    background: isBackLight
                        ? `radial-gradient(circle at ${lightLeft}% ${lightTop}%, transparent 26%, ${lightAlpha(0.5)} 46%, ${lightAlpha(0.78)} 62%, transparent 82%)`
                        : `radial-gradient(circle at ${lightLeft}% ${lightTop}%, ${lightAlpha(0.72)} 0%, ${lightAlpha(0.34)} 24%, transparent 68%)`,
                    opacity: 0.18 + brightness / 250,
                }}
            />
            <div
                className="pointer-events-none absolute inset-0 mix-blend-multiply"
                style={{
                    background: `radial-gradient(circle at ${100 - lightLeft}% ${100 - lightTop}%, transparent 30%, rgba(0,0,0,.42) 100%)`,
                    opacity: 0.45,
                }}
            />
            <div className="pointer-events-none absolute inset-0 mix-blend-soft-light" style={{ background: lightColor, opacity: 0.12 }} />
            {rimLight || isBackLight ? (
                <div
                    className="pointer-events-none absolute inset-0 rounded-[inherit]"
                    style={{
                        border: `2px solid ${lightAlpha(rimLight ? 0.62 : 0.34)}`,
                        boxShadow: `inset 0 0 ${rimLight ? 18 : 12}px ${lightAlpha(rimLight ? 0.72 : 0.42)}, inset 0 0 34px ${lightAlpha(0.24)}`,
                    }}
                />
            ) : null}
        </div>
    );
}

function temperatureRgb(temperature: number): [number, number, number] {
    const t = Math.max(0, Math.min(1, (temperature - 2000) / 8000));
    return [Math.round(255 - t * 75), Math.round(185 + t * 55), Math.round(105 + t * 145)];
}

function formatAxis(value: number) {
    const rounded = Math.abs(value) < 0.005 ? 0 : value;
    return rounded.toFixed(2);
}

function normalizeRelightParams(params: CanvasImageRelightParams): CanvasImageRelightParams {
    const x = Math.max(-1, Math.min(1, params.lightX));
    const y = Math.max(-1, Math.min(1, params.lightY));
    const z = Math.max(-1, Math.min(1, params.lightZ));
    const length = Math.hypot(x, y, z);
    const divisor = length < 0.0001 ? 1 : length;
    const softness = Number.isFinite(params.softness) ? params.softness : defaultRelightParams.softness;
    return {
        lightX: length < 0.0001 ? 0 : x / divisor,
        lightY: length < 0.0001 ? 0 : y / divisor,
        lightZ: length < 0.0001 ? (params.lightZ < 0 ? -1 : 1) : z / divisor,
        brightness: Math.max(0, Math.min(100, params.brightness)),
        temperature: Math.max(2000, Math.min(10000, params.temperature)),
        softness: Math.max(0, Math.min(100, softness)),
        rimLight: params.rimLight,
    };
}
