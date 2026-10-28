import { create } from "zustand";

import { fetchCurrentUser, loginRequest, logoutRequest } from "@/services/api/auth";
import type { AuthUser } from "@/types/user";

export type { AuthUser as LocalUser } from "@/types/user";

type UserStore = {
    user: AuthUser | null;
    status: "idle" | "loading" | "authenticated" | "anonymous";
    loadSession: () => Promise<void>;
    login: (username: string, password: string) => Promise<AuthUser>;
    logout: () => Promise<void>;
    clearSession: () => void;
};

let sessionRequest: Promise<void> | null = null;

export const useUserStore = create<UserStore>()((set, get) => ({
    user: null,
    status: "idle",
    loadSession: () => {
        if (get().status !== "idle") return Promise.resolve();
        if (sessionRequest) return sessionRequest;
        set({ status: "loading" });
        sessionRequest = fetchCurrentUser()
            .then((user) => set({ user, status: user ? "authenticated" : "anonymous" }))
            .catch(() => set({ user: null, status: "anonymous" }))
            .finally(() => {
                sessionRequest = null;
            });
        return sessionRequest;
    },
    login: async (username, password) => {
        const user = (await loginRequest(username, password)).user;
        set({ user, status: "authenticated" });
        return user;
    },
    logout: async () => {
        try {
            await logoutRequest();
        } catch {
            // 本地仍退出；服务端会话会在过期后清理。
        } finally {
            set({ user: null, status: "anonymous" });
        }
    },
    clearSession: () => set({ user: null, status: "anonymous" }),
}));
