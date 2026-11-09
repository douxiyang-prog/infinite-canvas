import { apiRequest } from "@/services/api/auth";
import type { ChannelModel } from "@/stores/use-config-store";

export type UserChannelAssignment = {
    allChannels: boolean;
    channelIds: string[];
    version: number;
    updatedAt: string | null;
};

export type AssignableChannel = {
    id: string;
    name: string;
    models: ChannelModel[];
};

export type UserChannelConfigResponse = {
    assignment: UserChannelAssignment;
    channels: AssignableChannel[];
};

export function fetchUserChannelConfig(userId: number) {
    return apiRequest<UserChannelConfigResponse>(`/api/admin/users/${userId}/channels`);
}

export function saveUserChannelConfig(userId: number, input: { allChannels: boolean; channelIds: string[]; expectedVersion: number }) {
    return apiRequest<{ assignment: UserChannelAssignment }>(`/api/admin/users/${userId}/channels`, {
        method: "PUT",
        body: JSON.stringify(input),
    });
}
