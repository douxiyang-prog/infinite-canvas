import { cn } from "@/lib/utils";
import { useBrandingStore } from "@/stores/use-branding-store";

export function BrandLogo({ className, invertOnDark = true }: { className?: string; invertOnDark?: boolean }) {
    const logoUrl = useBrandingStore((state) => state.logoUrl);
    const defaultLogo = logoUrl === "/logo.svg" || logoUrl === "/brand/logo.svg";

    return <img src={logoUrl} alt="" aria-hidden className={cn("block shrink-0 object-contain", defaultLogo && invertOnDark && "dark:invert", className)} />;
}
