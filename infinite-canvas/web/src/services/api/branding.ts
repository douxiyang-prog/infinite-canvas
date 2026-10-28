import { apiRequest } from "@/services/api/auth";

export type BrandingInfo = {
    companyName: string | null;
    logoUrl: string | null;
    updatedAt: string | null;
};

export const MAX_BRANDING_LOGO_BYTES = 2 * 1024 * 1024;
export const BRANDING_LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];

export async function fetchBranding() {
    return apiRequest<BrandingInfo>("/api/branding");
}

export async function updateBrandingCompanyName(companyName: string) {
    return apiRequest<BrandingInfo>("/api/admin/branding", {
        method: "PATCH",
        body: JSON.stringify({ companyName }),
    });
}

export async function uploadBrandingLogo(file: File) {
    return apiRequest<BrandingInfo>("/api/admin/branding/logo", {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
    });
}
