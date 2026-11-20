import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Aperture, Camera, Check, ChevronLeft, ChevronRight, Focus, RotateCcw, Scan, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { App, Input } from "antd";

import { APERTURE_OPTIONS, CAMERA_OPTIONS, DEFAULT_LENS_COMBO, FOCAL_LENGTH_OPTIONS, LENS_OPTIONS, apertureCue, cameraOption, focalLengthCue, lensOption } from "@/constant/lens-combo";
import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import { buildLensComboPrompt, lensComboSummary } from "@/lib/canvas/canvas-lens-combo";
import { createPromptPreset, type LensPromptPreset } from "@/services/api/prompt-presets";
import { usePromptPresetStore } from "@/stores/use-prompt-preset-store";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasLensCombo } from "@/types/canvas";

type CanvasLensComboPopoverProps = {
    value?: CanvasLensCombo;
    onApply: (value: CanvasLensCombo | undefined, prompt?: string, presetId?: string) => void;
    buttonClassName?: string;
    compact?: boolean;
    placement?: "topLeft" | "top" | "topRight" | "bottomLeft" | "bottom" | "bottomRight";
    defaultOpen?: boolean;
};

type RailOption = {
    key: string;
    label: string;
};

export function CanvasLensComboPopover({ value, onApply, buttonClassName, compact = false, placement = "topLeft", defaultOpen = false }: CanvasLensComboPopoverProps) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const buttonRef = useRef<HTMLSpanElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(defaultOpen);
    const [buttonRect, setButtonRect] = useState<DOMRect | null>(null);

    useEffect(() => {
        if (!open) return;
        const syncPosition = () => setButtonRect(buttonRef.current?.getBoundingClientRect() || null);
        const closeOnOutsidePointer = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
            setOpen(false);
        };

        syncPosition();
        window.addEventListener("resize", syncPosition);
        window.addEventListener("scroll", syncPosition, true);
        window.addEventListener("pointerdown", closeOnOutsidePointer, true);
        return () => {
            window.removeEventListener("resize", syncPosition);
            window.removeEventListener("scroll", syncPosition, true);
            window.removeEventListener("pointerdown", closeOnOutsidePointer, true);
        };
    }, [open]);

    const summary = lensComboSummary(value);
    const triggerLabel = compact ? (value ? `${value.focalLengthMm}mm · T${value.aperture}` : t("canvas.editors.lensCombo.title")) : summary || `${t("canvas.editors.lensCombo.title")} · ${t("canvas.editors.lensCombo.automatic")}`;
    const panel =
        open && buttonRect ? (
            <LensComboPortal
                buttonRect={buttonRect}
                panelRef={panelRef}
                placement={placement}
                value={value}
                theme={theme}
                onApply={(next) => {
                    onApply(next);
                    setOpen(false);
                }}
                onClose={() => setOpen(false)}
            />
        ) : null;

    return (
        <>
            <span ref={buttonRef} className="inline-flex min-w-0">
                <button
                    type="button"
                    className={buttonClassName || "inline-flex h-8 max-w-[220px] items-center gap-2 rounded-full border px-3 text-xs transition hover:opacity-75"}
                    style={{ borderColor: theme.node.stroke, color: theme.node.text, background: "transparent" }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={() => setOpen((current) => !current)}
                    aria-expanded={open}
                    title={summary || t("canvas.editors.lensCombo.title")}
                >
                    <Camera className="size-3.5 shrink-0" />
                    <span className="truncate">{triggerLabel}</span>
                </button>
            </span>
            {panel}
        </>
    );
}

export function CanvasLensComboPanel({ value, onApply, onClose, theme: themeOverride }: { value?: CanvasLensCombo; onApply: (value: CanvasLensCombo | undefined, prompt?: string, presetId?: string) => void; onClose?: () => void; theme?: CanvasTheme }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const storedTheme = canvasThemes[useThemeStore((state) => state.theme)];
    const theme = themeOverride || storedTheme;
    const [draft, setDraft] = useState<CanvasLensCombo>(value || DEFAULT_LENS_COMBO);
    const [activePresetId, setActivePresetId] = useState("");
    const [savingPreset, setSavingPreset] = useState(false);
    const [presetName, setPresetName] = useState("");
    const presets = usePromptPresetStore((state) => state.presets).filter((preset) => preset.category === "lens" && preset.enabled) as LensPromptPreset[];
    const savePreset = usePromptPresetStore((state) => state.savePreset);

    const update = <Key extends keyof CanvasLensCombo>(key: Key, next: CanvasLensCombo[Key]) => {
        setActivePresetId("");
        setDraft((current) => ({ ...current, [key]: next }));
    };
    const camera = cameraOption(draft.cameraId);
    const lens = lensOption(draft.lensId);

    return (
        <section
            data-canvas-no-zoom
            className="max-h-[calc(100dvh-24px)] w-full overflow-y-auto rounded-[24px] border shadow-[0_28px_90px_rgba(0,0,0,.35)]"
            style={{ borderColor: theme.toolbar.border, background: theme.toolbar.panel, color: theme.node.text }}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
        >
            <div className="flex items-start justify-between gap-4 px-5 pb-3 pt-5">
                <div>
                    <div className="flex items-center gap-2">
                        <span className="grid size-8 place-items-center rounded-full border" style={{ borderColor: theme.node.stroke }}>
                            <Camera className="size-4" />
                        </span>
                        <div>
                            <div className="text-[10px] font-semibold uppercase tracking-[.22em]" style={{ color: theme.node.muted }}>
                                Lens combo
                            </div>
                            <h2 className="text-xl font-semibold leading-tight">{t("canvas.editors.lensCombo.title")}</h2>
                        </div>
                    </div>
                    <p className="mt-2 text-xs" style={{ color: theme.node.muted }}>
                        {t("canvas.editors.lensCombo.hint")}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                        {presets.map((preset) => (
                            <button
                                key={preset.id}
                                type="button"
                                className="rounded-full border px-2.5 py-1 text-[11px] transition hover:bg-black/5 dark:hover:bg-white/10"
                                style={{ borderColor: activePresetId === preset.id ? theme.node.text : theme.node.stroke }}
                                onClick={() => {
                                    setDraft(preset.params);
                                    setActivePresetId(preset.id);
                                }}
                            >
                                {preset.name}
                            </button>
                        ))}
                    </div>
                </div>
                {onClose ? (
                    <button type="button" className="grid size-8 shrink-0 place-items-center rounded-full transition hover:bg-black/5 dark:hover:bg-white/10" onClick={onClose} aria-label={t("canvas.editors.lensCombo.close")}>
                        <X className="size-4" />
                    </button>
                ) : null}
            </div>

            <div className="grid gap-3 px-4 pb-4 md:grid-cols-[minmax(250px,.9fr)_minmax(390px,1.35fr)]">
                <div className="relative min-h-[260px] overflow-hidden rounded-[20px] border" style={{ borderColor: theme.node.stroke, background: "#171512" }}>
                    <div className="absolute -left-14 top-8 size-64 rounded-full opacity-65 blur-3xl" style={{ background: "radial-gradient(circle,#f4a261 0%,#c65d34 38%,transparent 70%)" }} />
                    <div className="absolute -right-16 bottom-4 size-72 rounded-full opacity-55 blur-3xl" style={{ background: "radial-gradient(circle,#527b98 0%,#253e54 44%,transparent 72%)" }} />
                    <div className="absolute inset-0 opacity-30" style={{ backgroundImage: "linear-gradient(115deg,transparent 0 32%,rgba(255,255,255,.16) 40%,transparent 48% 100%)" }} />
                    <div className="absolute left-8 top-12 h-40 w-24 rotate-[18deg] rounded-[50%] border border-white/20 bg-gradient-to-b from-white/15 to-transparent blur-[1px]" />
                    <div className="absolute right-10 top-9 h-44 w-20 -rotate-[24deg] rounded-[50%] border border-white/10 bg-gradient-to-b from-white/10 to-transparent blur-[2px]" />
                    <div className="absolute inset-x-5 bottom-5">
                        <div className="rounded-2xl border border-white/15 bg-black/35 p-4 text-white backdrop-blur-md">
                            <div className="text-[10px] uppercase tracking-[.2em] text-white/55">{t("canvas.editors.lensCombo.preview")}</div>
                            <div className="mt-2 text-2xl font-semibold leading-tight">{camera?.label}</div>
                            <div className="mt-1 text-sm text-white/70">{lens?.label}</div>
                            <div className="mt-3 flex items-center gap-2 text-sm font-medium">
                                <span>{draft.focalLengthMm} mm</span>
                                <span className="size-1 rounded-full bg-white/35" />
                                <span>T{draft.aperture}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                    <OptionRail
                        title={t("canvas.editors.lensCombo.camera")}
                        icon={<Camera className="size-3.5" />}
                        options={CAMERA_OPTIONS.map((option) => ({ key: option.id, label: option.label }))}
                        value={draft.cameraId}
                        theme={theme}
                        onChange={(cameraId) => update("cameraId", cameraId)}
                    />
                    <OptionRail
                        title={t("canvas.editors.lensCombo.lens")}
                        icon={<Focus className="size-3.5" />}
                        options={LENS_OPTIONS.map((option) => ({ key: option.id, label: option.label }))}
                        value={draft.lensId}
                        theme={theme}
                        onChange={(lensId) => update("lensId", lensId)}
                    />
                    <OptionRail
                        title={t("canvas.editors.lensCombo.focalLength")}
                        icon={<Scan className="size-3.5" />}
                        options={FOCAL_LENGTH_OPTIONS.map((option) => ({ key: String(option.value), label: option.label }))}
                        value={String(draft.focalLengthMm)}
                        theme={theme}
                        onChange={(value) => update("focalLengthMm", Number(value))}
                    />
                    <OptionRail
                        title={t("canvas.editors.lensCombo.aperture")}
                        icon={<Aperture className="size-3.5" />}
                        options={APERTURE_OPTIONS.map((option) => ({ key: String(option.value), label: option.label }))}
                        value={String(draft.aperture)}
                        theme={theme}
                        onChange={(value) => update("aperture", Number(value))}
                    />
                </div>
            </div>

            <div className="grid gap-3 border-t px-5 py-4 md:grid-cols-[minmax(0,1fr)_auto]" style={{ borderColor: theme.toolbar.border }}>
                <div className="text-[11px] leading-5" style={{ color: theme.node.muted }}>
                    <div>{focalLengthCue(draft.focalLengthMm)}.</div>
                    <div>{apertureCue(draft.aperture)}.</div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                    <button
                        type="button"
                        className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs transition hover:bg-black/5 dark:hover:bg-white/10"
                        onClick={() => {
                            setDraft(DEFAULT_LENS_COMBO);
                            setActivePresetId("");
                        }}
                    >
                        <RotateCcw className="size-3.5" />
                        {t("canvas.editors.lensCombo.recommended")}
                    </button>
                    {value ? (
                        <button type="button" className="h-9 rounded-full px-3 text-xs transition hover:bg-black/5 dark:hover:bg-white/10" onClick={() => onApply(undefined, undefined, undefined)}>
                            {t("canvas.editors.lensCombo.clear")}
                        </button>
                    ) : null}
                    <button type="button" className="h-9 rounded-full px-3 text-xs transition hover:bg-black/5 dark:hover:bg-white/10" onClick={() => setSavingPreset((current) => !current)}>
                        保存为预设
                    </button>
                    <button
                        type="button"
                        className="inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-xs font-semibold"
                        style={{ background: theme.node.text, color: theme.node.panel }}
                        onClick={() => onApply(draft, presets.find((preset) => preset.id === activePresetId)?.prompt || buildLensComboPrompt(draft), activePresetId || undefined)}
                    >
                        <Check className="size-3.5" />
                        {t("canvas.editors.lensCombo.apply")}
                    </button>
                </div>
            </div>
            {savingPreset ? (
                <div className="flex items-center gap-2 border-t px-5 py-3" style={{ borderColor: theme.toolbar.border }}>
                    <Input size="small" value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="输入镜头预设名称" />
                    <button
                        type="button"
                        className="h-7 shrink-0 rounded-full px-3 text-xs"
                        style={{ background: theme.node.text, color: theme.node.panel }}
                        onClick={() => {
                            if (!presetName.trim()) return;
                            savePreset(createPromptPreset({ category: "lens", name: presetName, params: draft, prompt: buildLensComboPrompt(draft), builtIn: false }));
                            message.success("镜头预设已保存到全局配置");
                            setPresetName("");
                            setSavingPreset(false);
                        }}
                    >
                        保存
                    </button>
                </div>
            ) : null}
        </section>
    );
}

function OptionRail({ title, icon, options, value, theme, onChange }: { title: string; icon: React.ReactNode; options: RailOption[]; value: string; theme: CanvasTheme; onChange: (value: string) => void }) {
    const index = Math.max(
        0,
        options.findIndex((option) => option.key === value),
    );
    const move = (offset: number) => onChange(options[(index + offset + options.length) % options.length].key);
    const previous = options[(index - 1 + options.length) % options.length];
    const next = options[(index + 1) % options.length];

    return (
        <div className="min-w-0 rounded-2xl border px-2 py-2.5" style={{ borderColor: theme.node.stroke }}>
            <div className="flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-[.14em]" style={{ color: theme.node.muted }}>
                {icon}
                <span>{title}</span>
            </div>
            <div className="mt-2 grid grid-cols-[26px_minmax(0,1fr)_26px] items-center gap-1">
                <RailButton direction="previous" theme={theme} onClick={() => move(-1)} />
                <div className="min-w-0 text-center">
                    <div className="truncate text-[9px] leading-4 opacity-30">{previous.label}</div>
                    <div className="break-words text-base font-semibold leading-5">{options[index].label}</div>
                    <div className="truncate text-[9px] leading-4 opacity-30">{next.label}</div>
                </div>
                <RailButton direction="next" theme={theme} onClick={() => move(1)} />
            </div>
        </div>
    );
}

function RailButton({ direction, theme, onClick }: { direction: "previous" | "next"; theme: CanvasTheme; onClick: () => void }) {
    const Icon = direction === "previous" ? ChevronLeft : ChevronRight;
    return (
        <button type="button" className="grid size-7 place-items-center rounded-full transition hover:bg-black/5 dark:hover:bg-white/10" style={{ color: theme.node.muted }} onClick={onClick} aria-label={direction}>
            <Icon className="size-4" />
        </button>
    );
}

function LensComboPortal({
    buttonRect,
    panelRef,
    placement,
    value,
    theme,
    onApply,
    onClose,
}: {
    buttonRect: DOMRect;
    panelRef: RefObject<HTMLDivElement | null>;
    placement: NonNullable<CanvasLensComboPopoverProps["placement"]>;
    value?: CanvasLensCombo;
    theme: CanvasTheme;
    onApply: (value: CanvasLensCombo | undefined) => void;
    onClose: () => void;
}) {
    const width = Math.min(780, window.innerWidth - 24);
    const maxHeight = Math.max(360, Math.min(620, window.innerHeight - 24));
    const alignRight = placement.endsWith("Right");
    const alignCenter = placement === "top" || placement === "bottom";
    const requestedLeft = alignCenter ? buttonRect.left + buttonRect.width / 2 - width / 2 : alignRight ? buttonRect.right - width : buttonRect.left;
    const left = Math.max(12, Math.min(window.innerWidth - width - 12, requestedLeft));
    const preferredTop = placement.startsWith("top") ? buttonRect.top - maxHeight - 10 : buttonRect.bottom + 10;
    const top = Math.max(12, Math.min(window.innerHeight - maxHeight - 12, preferredTop));

    return createPortal(
        <div ref={panelRef} style={{ position: "fixed", zIndex: 1300, width, maxHeight, left, top }}>
            <CanvasLensComboPanel value={value} onApply={onApply} onClose={onClose} theme={theme} />
        </div>,
        document.body,
    );
}
