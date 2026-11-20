import { cn } from "@/lib/utils";
import { useBrandingStore } from "@/stores/use-branding-store";

export function BrandLogo({ className, invertOnDark = true }: { className?: string; invertOnDark?: boolean }) {
    const logoUrl = useBrandingStore((state) => state.logoUrl);
    const darkLogoUrl = useBrandingStore((state) => state.darkLogoUrl) || logoUrl;
    const isDefaultLogo = (url: string) => url === "/logo.svg" || url === "/brand/logo.svg";
    const imageClassName = cn("block shrink-0 object-contain", className);

    return (
        <>
            <img src={logoUrl} alt="" aria-hidden className={cn(imageClassName, "dark:hidden")} />
            <img src={darkLogoUrl} alt="" aria-hidden className={cn(imageClassName, "hidden dark:block", isDefaultLogo(darkLogoUrl) && invertOnDark && "dark:invert")} />
        </>
    );
}
