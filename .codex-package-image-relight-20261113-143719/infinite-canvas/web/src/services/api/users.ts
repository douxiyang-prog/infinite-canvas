import { apiRequest } from "@/services/api/auth";
import type { AuthUser, UserRole, UserStatus } from "@/types/user";

export async function fetchUsers() {
    return (await apiRequest<{ users: AuthUser[] }>("/api/admin/users")).users;
}

export async function createManagedUser(input: { username: string; displayName: string; password: string; role: UserRole }) {
    return (
        await apiRequest<{ user: AuthUser }>("/api/admin/users", {
            method: "POST",
            body: JSON.stringify(input),
        })
    ).user;
}

export async function updateManagedUser(
    id: number,
    input: {
        displayName?: string;
        password?: string;
        role?: UserRole;
        status?: UserStatus;
    },
) {
    return (
        await apiRequest<{ user: AuthUser }>(`/api/admin/users/${id}`, {
            method: "PATCH",
            body: JSON.stringify(input),
        })
    ).user;
}
