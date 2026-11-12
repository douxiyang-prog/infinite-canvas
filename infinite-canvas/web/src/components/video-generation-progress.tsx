import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { formatDuration } from "@/lib/image-utils";
import { estimatedVideoProgress } from "@/lib/video-generation-estimate";
import { useThemeStore } from "@/stores/use-theme-store";
import { cn } from "@/lib/utils";

type VideoGenerationProgressProps = {
    startedAt?: number;
    expectedMs?: number;
    progress?: number;
    phase?: "queued" | "running" | "finalizing";
    className?: string;
};

export function VideoGenerationProgress({ startedAt, expectedMs, progress, phase, className }: VideoGenerationProgressProps) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [now, setNow] = useState(Date.now());
    const [mountedAt] = useState(Date.now);

    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);

    const actualProgress = Number.isFinite(progress) ? clampPercent(progress!) : undefined;
    const progressStartedAt = startedAt || mountedAt;
    const effectivePhase = phase ?? (actualProgress === undefined ? undefined : actualProgress < 15 ? "queued" : actualProgress >= 90 ? "finalizing" : "running");
    const percent = actualProgress ?? estimatedVideoProgress(progressStartedAt, expectedMs, effectivePhase, now);
    const elapsedMs = Math.max(0, now - progressStartedAt);
    const stage = effectivePhase === "queued" ? "queued" : effectivePhase === "finalizing" ? "finalizing" : percent < 72 ? "rendering" : "composing";

    return (
        <div className={cn("relative flex h-full w-full flex-col justify-center overflow-hidden p-5", className)} style={{ color: theme.node.activeStroke }}>
            <div
                className="absolute inset-0 opacity-35"
                style={{ backgroundImage: "radial-gradient(circle, currentColor 0.7px, transparent 0.9px)", backgroundSize: "18px 18px", maskImage: "radial-gradient(ellipse at 50% 50%, black 0%, transparent 72%)" }}
            />
            <div className="relative flex items-center gap-2 text-sm font-medium">
                <LoaderCircle className="size-4 animate-spin" />
                <span className="truncate">{t(`videoProgress.stage.${stage}`)}</span>
            </div>
            <div className="relative mt-5 flex items-end justify-between gap-3">
                <span className="text-2xl font-semibold tabular-nums">{percent}%</span>
                <span className="pb-1 text-[10px] opacity-65">{actualProgress === undefined ? t("videoProgress.estimated") : t("videoProgress.live")}</span>
            </div>
            <div className="relative mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: theme.node.stroke }}>
                <div className="h-full rounded-full transition-[width] duration-700 ease-out" style={{ width: `${percent}%`, background: theme.node.activeStroke }} />
            </div>
            <div className="relative mt-2 flex items-center justify-between gap-3 text-[10px] opacity-55">
                <span>{t("videoProgress.elapsed", { time: formatDuration(elapsedMs) })}</span>
                {expectedMs ? <span>{t("videoProgress.expected", { time: formatDuration(expectedMs) })}</span> : null}
            </div>
        </div>
    );
}

function clampPercent(value: number) {
    return Math.min(99, Math.max(0, Math.round(value)));
}
