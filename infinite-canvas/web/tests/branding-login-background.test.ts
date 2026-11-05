import { expect, test } from "bun:test";

import { useBrandingStore } from "../src/stores/use-branding-store";

test("login background defaults to the original layout", () => {
    expect(useBrandingStore.getState().loginBackground).toBe("original");
});

test("branding applies the globally selected nebula background", () => {
    useBrandingStore.getState().applyBranding({
        companyName: null,
        loginBackground: "nebula",
        logoUrl: null,
        updatedAt: null,
    });
    expect(useBrandingStore.getState().loginBackground).toBe("nebula");
});
