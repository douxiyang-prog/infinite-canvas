import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "antd";
import { useNavigate } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";

import { BrandLogo } from "@/components/layout/brand-logo";
import { navigationTools } from "@/constant/navigation-tools";
import { useBrandingStore } from "@/stores/use-branding-store";

function Highlighter({ action, color, children }: { action: "highlight" | "underline"; color: string; children?: ReactNode }) {
    return (
        <span className="relative inline-block px-1">
            {action === "highlight" ? (
                <span className="absolute inset-x-0 bottom-0 top-1 rounded-sm opacity-45" style={{ backgroundColor: color }} />
            ) : (
                <span className="absolute inset-x-0 bottom-0 h-1 rounded-full opacity-80" style={{ backgroundColor: color }} />
            )}
            <span className="relative font-medium text-stone-800 dark:text-stone-200">{children}</span>
        </span>
    );
}

export default function IndexPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [primaryTool] = navigationTools;
    const companyName = useBrandingStore((state) => state.companyName);

    return (
        <main className="relative h-full overflow-y-auto bg-background bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px] text-stone-950 dark:bg-[radial-gradient(rgba(245,245,244,.18)_1px,transparent_1px)] dark:text-stone-100">
            <section className="relative mx-auto min-h-[calc(100vh-4rem)] max-w-7xl overflow-hidden px-6">
                <div className="relative flex min-h-[620px] flex-col items-center justify-center pt-10 text-center">
                    <div className="mb-8 flex w-full max-w-6xl items-center justify-center gap-4 sm:gap-6 lg:gap-8">
                        <BrandLogo className="h-20 w-auto max-w-44 shrink-0 -translate-y-4 sm:h-24 sm:max-w-60 lg:h-28 lg:max-w-72" />
                        <h1 className="ai-title-aurora min-w-0 text-balance text-5xl font-semibold tracking-normal sm:text-7xl lg:text-8xl">{companyName || t("meta.title")}</h1>
                    </div>
                    <p className="mt-8 max-w-3xl text-balance text-lg leading-8 text-stone-500 dark:text-stone-400">
                        <Trans i18nKey="home.description" components={{ canvas: <Highlighter action="underline" color="#FF9800" />, content: <Highlighter action="highlight" color="#87CEFA" /> }} />
                    </p>
                    <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
                        <Button type="primary" size="large" onClick={() => navigate(`/${primaryTool.slug}`)} icon={<ArrowRight className="size-4" />} iconPlacement="end">
                            {t("home.start")}
                        </Button>
                        <Button size="large" onClick={() => navigate("/canvas")}>
                            {t("home.openCanvas")}
                        </Button>
                    </div>
                </div>
            </section>
        </main>
    );
}
