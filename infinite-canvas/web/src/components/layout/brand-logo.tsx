import { COMPANY_LOGO_URL } from "@/constant/runtime-config";
import { cn } from "@/lib/utils";

export function BrandLogo({ className, invertOnDark = true }: { className?: string; invertOnDark?: boolean }) {
    const defaultLogo = COMPANY_LOGO_URL === "/logo.svg" || COMPANY_LOGO_URL === "/brand/logo.svg";

    return <img src={COMPANY_LOGO_URL} alt="" aria-hidden className={cn("block shrink-0 object-contain", defaultLogo && invertOnDark && "dark:invert", className)} />;
}
