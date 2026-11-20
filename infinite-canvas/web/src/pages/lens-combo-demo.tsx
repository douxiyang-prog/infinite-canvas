import { useState } from "react";
import { Camera, CircleDot, Film, Layers3, Sparkles } from "lucide-react";

import { CanvasLensComboPanel } from "@/components/canvas/canvas-lens-combo-popover";
import { DEFAULT_LENS_COMBO } from "@/constant/lens-combo";
import { lensComboSummary } from "@/lib/canvas/canvas-lens-combo";
import { canvasThemes } from "@/lib/canvas-theme";
import type { CanvasLensCombo } from "@/types/canvas";

const theme = canvasThemes.dark;

export default function LensComboDemoPage() {
    const [value, setValue] = useState<CanvasLensCombo | undefined>(DEFAULT_LENS_COMBO);
    const summary = lensComboSummary(value);

    return (
        <main className="dark flex h-dvh min-h-[720px] flex-col overflow-hidden" style={{ background: "#12110f", color: theme.node.text }}>
            <header className="flex h-16 shrink-0 items-center justify-between border-b px-6" style={{ borderColor: "rgba(255,255,255,.08)" }}>
                <div className="flex items-center gap-3">
                    <span className="grid size-9 place-items-center rounded-xl border border-white/10 bg-white/[.04]">
                        <Camera className="size-4" />
                    </span>
                    <div>
                        <div className="text-sm font-semibold">Infinite Canvas</div>
                        <div className="text-[10px] uppercase tracking-[.22em] text-white/35">Camera lab</div>
                    </div>
                </div>
                <div className="flex items-center gap-2 text-[11px]">
                    <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2.5 py-1 text-emerald-200/80">Live prototype</span>
                    <span className="rounded-full border border-white/10 px-2.5 py-1 text-white/45">镜头组合 / Lens Combo</span>
                </div>
            </header>

            <div className="relative min-h-0 flex-1 overflow-hidden">
                <div
                    className="absolute inset-0 opacity-40"
                    style={{
                        backgroundImage: "radial-gradient(circle at center, rgba(255,255,255,.12) 1px, transparent 1.4px)",
                        backgroundSize: "24px 24px",
                    }}
                />
                <div className="absolute -left-36 top-20 size-[480px] rounded-full bg-orange-400/10 blur-[110px]" />
                <div className="absolute -right-36 bottom-0 size-[520px] rounded-full bg-sky-500/10 blur-[130px]" />

                <div className="pointer-events-none absolute inset-0 opacity-50">
                    <div className="absolute left-[26%] top-[18%] h-[52%] w-[8%] rotate-[18deg] rounded-[50%] border border-orange-100/15 bg-gradient-to-b from-orange-100/15 via-orange-300/5 to-transparent blur-[1px]" />
                    <div className="absolute left-[43%] top-[7%] h-[62%] w-[10%] -rotate-[16deg] rounded-[50%] border border-white/10 bg-gradient-to-b from-white/10 to-transparent blur-[2px]" />
                    <div className="absolute right-[24%] top-[16%] h-[56%] w-[9%] rotate-[25deg] rounded-[50%] border border-sky-100/10 bg-gradient-to-b from-sky-100/10 to-transparent blur-[2px]" />
                </div>

                <aside className="absolute bottom-8 left-8 z-10 w-[250px] rounded-2xl border p-4 shadow-2xl" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold">生成配置</span>
                        <span className="rounded-full bg-white/10 px-2 py-1 text-[9px] uppercase tracking-wider text-white/55">Video</span>
                    </div>
                    <div className="mt-3 rounded-xl border px-3 py-2.5 text-[11px]" style={{ borderColor: theme.node.stroke }}>
                        <div className="flex items-center gap-2 text-white/45">
                            <CircleDot className="size-3" />
                            电影感城市夜景
                        </div>
                        <div className="mt-2 flex items-center gap-2 text-white">
                            <Camera className="size-3.5 text-orange-200/80" />
                            <span className="truncate">{summary || "镜头组合 · 自动"}</span>
                        </div>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                        <span className="flex h-8 flex-1 items-center rounded-lg border px-2 text-[10px] text-white/45" style={{ borderColor: theme.node.stroke }}>
                            Seedance 2.0
                        </span>
                        <span className="grid size-8 place-items-center rounded-lg border" style={{ borderColor: theme.node.stroke }}>
                            <Sparkles className="size-3.5" />
                        </span>
                    </div>
                    <div className="mt-3 flex items-stretch gap-2">
                        <div className="flex h-9 max-w-[105px] items-center gap-1.5 rounded-xl border px-2.5 text-[10px] text-white/75" style={{ borderColor: theme.node.stroke }} title={summary || "镜头组合"}>
                            <Camera className="size-3.5 shrink-0" />
                            <span className="truncate">{value ? `${value.focalLengthMm}mm · T${value.aperture}` : "镜头组合"}</span>
                        </div>
                        <div className="grid h-9 min-w-0 flex-1 place-items-center rounded-xl bg-white text-xs font-semibold text-black">开始生成</div>
                    </div>
                </aside>

                <section className="relative z-20 mx-auto flex h-full w-full max-w-[820px] flex-col justify-center px-5 py-5">
                    <div className="mb-3 flex items-end justify-between px-1">
                        <div>
                            <div className="flex items-center gap-2 text-xs text-white/45">
                                <Film className="size-3.5" />
                                摄影参数
                            </div>
                            <h1 className="mt-1 text-2xl font-semibold tracking-tight">用镜头语言控制画面</h1>
                        </div>
                        <div className="hidden text-right text-[10px] leading-4 text-white/35 sm:block">
                            选择后仅在生成时内部应用
                            <br />
                            交互与正式 Canvas 使用同一组件
                        </div>
                    </div>
                    <CanvasLensComboPanel value={value} onApply={setValue} theme={theme} />
                </section>

                <aside className="absolute right-8 top-8 z-10 hidden w-[300px] rounded-2xl border p-4 shadow-2xl xl:block" style={{ borderColor: theme.node.stroke, background: "rgba(31,29,26,.88)", backdropFilter: "blur(18px)" }}>
                    <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[.16em] text-white/45">
                        <Layers3 className="size-3.5" />
                        Internal optics
                    </div>
                    <div className="mt-3 rounded-xl border border-white/[.07] bg-black/20 p-3">
                        <div className="text-[10px] uppercase tracking-wider text-orange-200/55">Hidden at generation time</div>
                        <div className="mt-2 text-sm font-medium text-white/80">{summary || "未启用镜头参数"}</div>
                        <p className="mt-2 text-[11px] leading-5 text-white/45">镜头描述不会显示在提示词输入框或结果节点中，只在提交模型时临时拼接。</p>
                    </div>
                    <p className="mt-3 text-[10px] leading-5 text-white/30">当前为内部提示词级光学控制，不模拟真实镜头参数。不同视频/图片模型对摄影描述的理解程度会有所差异。</p>
                </aside>
            </div>

            <footer className="flex h-9 shrink-0 items-center justify-between border-t px-6 text-[10px] text-white/30" style={{ borderColor: "rgba(255,255,255,.08)" }}>
                <span>Lens Combo prototype · Camera body / Lens / Focal length / Aperture</span>
                <span>{value ? `${value.focalLengthMm}mm · T${value.aperture}` : "Auto"}</span>
            </footer>
        </main>
    );
}
