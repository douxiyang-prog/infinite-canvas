import type { CSSProperties, MouseEvent, PointerEvent } from "react";
import { Button, Tooltip } from "antd";
import { LoaderCircle, Mic, Square, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useBrowserSpeechInput, type BrowserSpeechErrorCode } from "@/hooks/voice/use-browser-speech-input";
import { cn } from "@/lib/utils";

type Props = {
    onText: (text: string) => void;
    showLabel?: boolean;
    placement?: "top" | "bottom";
    className?: string;
    style?: CSSProperties;
    panelStyle?: CSSProperties;
    disabled?: boolean;
};

const ERROR_KEYS: Record<BrowserSpeechErrorCode, string> = {
    permissionDenied: "voiceInput.permissionDenied",
    serviceUnavailable: "voiceInput.serviceUnavailable",
    microphoneUnavailable: "voiceInput.microphoneUnavailable",
    noSpeech: "voiceInput.noSpeech",
    networkError: "voiceInput.networkError",
    languageUnsupported: "voiceInput.languageUnsupported",
    failed: "voiceInput.failed",
};

export function VoiceInputButton({ onText, showLabel = false, placement = "bottom", className, style, panelStyle, disabled = false }: Props) {
    const { t, i18n } = useTranslation();
    const voice = useBrowserSpeechInput({ language: i18n.resolvedLanguage || "zh-CN", onText });
    const listening = voice.status === "listening";
    const processing = voice.status === "processing" || voice.status === "starting";
    const active = listening || processing;
    const unavailable = disabled || !voice.supported;
    const tooltip = unavailable ? t("voiceInput.unsupported") : listening ? t("voiceInput.stop") : t("voiceInput.label");
    const statusPanelVisible = voice.status !== "idle";

    const stopCanvasInteraction = (event: MouseEvent | PointerEvent) => event.stopPropagation();
    const toggle = () => {
        if (unavailable) return;
        if (listening) voice.stop();
        else if (voice.status === "starting") voice.cancel();
        else if (!processing) voice.start();
    };

    return (
        <div className="relative shrink-0" style={style} onMouseDown={stopCanvasInteraction} onPointerDown={stopCanvasInteraction} onClick={stopCanvasInteraction} data-canvas-no-zoom>
            <Tooltip title={tooltip}>
                <span className="inline-flex shrink-0">
                    <Button
                        type="text"
                        className={cn("!h-9 !min-w-9 shrink-0 !rounded-full !p-0", showLabel ? "!px-3" : "!w-9", className)}
                        style={{ color: listening ? "#ef4444" : style?.color, background: listening ? "rgba(239,68,68,.12)" : undefined }}
                        icon={processing ? <LoaderCircle className="size-4 animate-spin" /> : listening ? <Square className="size-3.5 fill-current" /> : <Mic className="size-4" />}
                        disabled={unavailable}
                        aria-label={tooltip}
                        aria-pressed={listening}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={toggle}
                    >
                        {showLabel ? <span className="text-xs">{t("voiceInput.label")}</span> : null}
                    </Button>
                </span>
            </Tooltip>
            {statusPanelVisible ? (
                <div
                    role="status"
                    className={`absolute right-0 z-[1200] w-[min(320px,calc(100vw_-_24px))] rounded-xl border bg-popover p-3 text-xs text-popover-foreground shadow-2xl backdrop-blur-md ${placement === "top" ? "bottom-full mb-2" : "top-full mt-2"}`}
                    style={{ background: panelStyle?.background, borderColor: panelStyle?.borderColor, color: panelStyle?.color }}
                    onMouseDown={stopCanvasInteraction}
                    onPointerDown={stopCanvasInteraction}
                    onClick={stopCanvasInteraction}
                >
                    {voice.status === "error" ? (
                        <div className="flex items-start gap-2">
                            <span className="min-w-0 flex-1 leading-5">{t(ERROR_KEYS[voice.error || "failed"])}</span>
                            <button type="button" className="grid size-6 shrink-0 place-items-center rounded-md opacity-60 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10" aria-label={t("voiceInput.close")} onClick={voice.clearError}>
                                <X className="size-3.5" />
                            </button>
                        </div>
                    ) : (
                        <>
                            <div className="flex items-center justify-between gap-2">
                                <span className="flex items-center gap-1.5 font-medium">
                                    {processing ? <LoaderCircle className="size-3.5 animate-spin" /> : <span className="size-2 rounded-full bg-red-500" />}
                                    {voice.status === "starting" ? t("voiceInput.requesting") : processing ? t("voiceInput.processing") : t("voiceInput.listening", { seconds: voice.seconds })}
                                </span>
                                {!processing ? (
                                    <span className="flex items-center gap-1">
                                        <button type="button" className="rounded-md px-1.5 py-0.5 font-medium transition hover:bg-black/5 dark:hover:bg-white/10" onClick={voice.stop}>
                                            {t("voiceInput.stop")}
                                        </button>
                                        <button type="button" className="rounded-md px-1.5 py-0.5 opacity-65 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10" onClick={voice.cancel}>
                                            {t("common.cancel")}
                                        </button>
                                    </span>
                                ) : null}
                            </div>
                            <div className="mt-2 max-h-24 overflow-y-auto whitespace-pre-wrap break-words leading-5 opacity-75">{voice.transcript || t("voiceInput.transcriptHint")}</div>
                        </>
                    )}
                </div>
            ) : null}
        </div>
    );
}
