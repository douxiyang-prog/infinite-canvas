export type TeamProjectMember = {
    userId: number;
    username: string;
    displayName: string;
};

export type TeamProjectScene = {
    id: string;
    title: string;
    hidden: boolean;
    sortOrder: number;
    createdAt: string;
    updatedAt: string;
};

export type TeamProject = {
    id: string;
    title: string;
    description: string;
    createdBy: number;
    createdAt: string;
    updatedAt: string;
    canvasCount: number;
    members: TeamProjectMember[];
    scenes: TeamProjectScene[];
};
