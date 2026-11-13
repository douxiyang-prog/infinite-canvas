export type UserRole = "admin" | "user";
export type UserStatus = "active" | "disabled";

export type AuthUser = {
    id: number;
    username: string;
    displayName: string;
    role: UserRole;
    status: UserStatus;
    lastLoginAt: string | null;
    createdAt: string;
    updatedAt: string;
};
