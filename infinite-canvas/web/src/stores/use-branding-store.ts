import { create } from "zustand";

import { COMPANY_LOGO_URL, COMPANY_NAME } from "@/constant/runtime-config";
import { fetchBranding, type BrandingInfo } from "@/services/api/branding";

type BrandingStore = {
    companyName: string;
    logoUrl: string;
    loadBranding: () => Promise<void>;
    applyBranding: (branding: BrandingInfo) => void;
};

let brandingRequest: Promise<void> | null = null;

export const useBrandingStore = create<BrandingStore>()((set, get) => ({
    companyName: COMPANY_NAME,
    logoUrl: COMPANY_LOGO_URL,
    loadBranding: () => {
        if (brandingRequest) return brandingRequest;
        brandingRequest = fetchBranding()
            .then((branding) => get().applyBranding(branding))
            .catch(() => {
                // 保留环境变量中的品牌配置作为降级值。
            })
            .finally(() => {
                brandingRequest = null;
            });
        return brandingRequest;
    },
    applyBranding: (branding) =>
        set((state) => ({
            companyName: branding.companyName || state.companyName || COMPANY_NAME,
            logoUrl: branding.logoUrl || state.logoUrl || COMPANY_LOGO_URL,
        })),
}));
