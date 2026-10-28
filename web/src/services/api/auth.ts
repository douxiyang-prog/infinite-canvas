import type { AuthUser } from "@/types/user";

export class ApiError extends Error {
    constructor(
        public readonly status: number,
        message: string,
    ) {
        super(message);
    }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const response = await fetch(path, {
        ...init,
        headers,
        credentials: "same-origin",
        cache: "no-store",
    });
    const data = (await response.json().catch(() => null)) as { error?: string } | T | null;
    if (!response.ok) {
        const error = data && typeof data === "object" ? (data as { error?: string }).error : null;
        throw new ApiError(response.status, error || `请求失败（${response.status}）`);
    }
    return data as T;
}

export async function fetchCurrentUser(): Promise<AuthUser | null> {
    try {
        return (await apiRequest<{ user: AuthUser }>("/api/auth/me")).user;
    } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
    }
}

export async function loginRequest(username: string, password: string) {
    return apiRequest<{ user: AuthUser }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
    });
}

export async function logoutRequest() {
    await apiRequest<{ ok: true }>("/api/auth/logout", { method: "POST" });
}
