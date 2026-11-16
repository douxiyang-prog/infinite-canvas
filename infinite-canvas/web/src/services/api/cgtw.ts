import { useAgentStore } from "@/stores/use-agent-store";

export type CgtwSession = { loggedIn: boolean; name: string; server: string; mode: "desktop" | "password" | "" };
export type CgtwProject = { db: string; code: string; name: string; status: string };
export type CgtwTask = { id: string; shot: string; eps: string; pipeline: string; status: string; artist: string; frame: number; lastSubmit: string; startDate: string; finishTime: string };
export type CgtwMedia = { type: "image" | "video"; url: string; thumb: string };
export type CgtwNote = { id: string; time: string; type: string; author: string; version: string; filename: string; text: string; medias: CgtwMedia[] };
export type CgtwFacets = { eps: string[]; pipelines: string[]; statuses: string[]; colors: Record<string, string> };
export type CgtwTaskPage = { total: number; items: CgtwTask[] };

export const CGTW_PAGE_SIZE = 50;

export class CgtwApiError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message);
        this.name = "CgtwApiError";
    }
}

/** CGTW 接口挂在本机 Canvas Agent 的 /cgtw 下，地址和 token 直接沿用 Agent 面板里的连接信息。 */
function agentConnection() {
    const { url, token } = useAgentStore.getState();
    return { base: `${url.trim().replace(/\/+$/, "")}/cgtw`, token: token.trim() };
}

async function request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    const { base, token } = agentConnection();
    if (!token) throw new CgtwApiError(401, "请先在右上角 Agent 面板连接本机 Canvas Agent");
    let response: Response;
    try {
        response = await fetch(`${base}${path}`, {
            method: init?.method,
            headers: { "content-type": "application/json", "x-canvas-agent-token": token },
            body: init?.body === undefined ? undefined : JSON.stringify(init.body),
        });
    } catch {
        throw new CgtwApiError(0, "无法连接本机 Canvas Agent，请确认 Canvas Agent Manager 正在运行");
    }
    const data = (await response.json().catch(() => null)) as ({ ok?: boolean; error?: string } & T) | null;
    if (response.status === 404 && data?.error === "not found") throw new CgtwApiError(404, "当前 Canvas Agent 版本不支持 CGTW，请升级 Canvas Agent Manager");
    if (!response.ok || !data?.ok) throw new CgtwApiError(response.status, data?.error || "CGTW 请求失败");
    return data;
}

const params = (values: Record<string, string | number | boolean>) => new URLSearchParams(Object.entries(values).map(([key, value]) => [key, String(value)])).toString();

export const fetchCgtwSession = () => request<CgtwSession>("/session");
export const loginCgtw = (input: { server?: string; account?: string; password?: string } = {}) => request<CgtwSession>("/login", { method: "POST", body: input });
export const logoutCgtw = () => request<CgtwSession>("/logout", { method: "POST" });
export const fetchCgtwProjects = async () => (await request<{ projects: CgtwProject[] }>("/projects")).projects;
export const fetchCgtwFacets = (db: string) => request<CgtwFacets>(`/facets?${params({ db })}`);
export const fetchCgtwTasks = (db: string, filters: { mine: boolean; eps: string; pipeline: string; status: string; q: string }, offset: number) =>
    request<CgtwTaskPage>(`/tasks?${params({ db, ...filters, mine: filters.mine ? 1 : 0, offset, limit: CGTW_PAGE_SIZE })}`);
export const fetchCgtwNotes = async (db: string, taskId: string) => (await request<{ notes: CgtwNote[] }>(`/notes?${params({ db, taskId })}`)).notes;

export type CgtwSubmitKind = "review" | "render";
export type CgtwFileEntry = { name: string; version: number | null; isDir: boolean; size: number; mtime: string; importKind: "image" | "video" | null };
export type CgtwFileList = { dir: string; exists: boolean; entries: CgtwFileEntry[] };

export const fetchCgtwFiles = (db: string, taskId: string, kind: CgtwSubmitKind) => request<CgtwFileList>(`/files?${params({ db, taskId, kind })}`);

/** 目录里的文件经 Agent 提供（.mov 会先转成 H.264 预览）；token 放在查询参数里。 */
export function cgtwFileUrl(db: string, taskId: string, kind: CgtwSubmitKind, name: string) {
    const { base, token } = agentConnection();
    return `${base}/file?${params({ db, taskId, kind, name, token })}`;
}
export type CgtwSubmitEntry = { name: string; version: number | null; isDir: boolean; size: number; mtime: string };
export type CgtwSubmitPlan = {
    task: CgtwTask;
    kind: CgtwSubmitKind;
    title: string;
    dir: string;
    dirExists: boolean;
    entries: CgtwSubmitEntry[];
    entryCount: number;
    cgtwVersions: number[];
    nextVersion: number;
    rule: string;
    pad: number;
    ruleExt: string;
    allowedExt: string[];
    target: { fps: number | null; frames: number | null };
    /** 旧版 Agent 没有这个字段，网页据此提示升级 Manager。 */
    features?: { convert?: boolean };
    triggersFlow: boolean;
    setsReviewStatus: boolean;
};
export type CgtwVideoMeta = { fps: number | null; frames: number | null; width: number | null; height: number | null };
export type CgtwSubmitResult = { filename: string; version: number; path: string; cgtwSynced: boolean; cgtwVersionId: string; warnings: string[]; meta: CgtwVideoMeta; source?: CgtwVideoMeta | null; converted?: boolean; trimmed?: boolean };

export const fetchCgtwSubmitPlan = (db: string, taskId: string, kind: CgtwSubmitKind) => request<CgtwSubmitPlan>(`/submit/plan?${params({ db, taskId, kind })}`);

/** 请求体直接是文件内容，元数据走查询参数；大文件不做大小限制，由 Agent 流式写盘。 */
export async function submitCgtwFile(input: { db: string; taskId: string; kind: CgtwSubmitKind; version: number; ext: string; file: Blob; convert?: boolean; trim?: boolean }) {
    const { base, token } = agentConnection();
    let response: Response;
    try {
        response = await fetch(`${base}/submit?${params({ db: input.db, taskId: input.taskId, kind: input.kind, version: input.version, ext: input.ext, convert: input.convert ? 1 : 0, trim: input.trim ? 1 : 0 })}`, {
            method: "POST",
            headers: { "content-type": "application/octet-stream", "x-canvas-agent-token": token },
            body: input.file,
        });
    } catch {
        throw new CgtwApiError(0, "无法连接本机 Canvas Agent，请确认 Canvas Agent Manager 正在运行");
    }
    const data = (await response.json().catch(() => null)) as ({ ok?: boolean; error?: string } & CgtwSubmitResult) | null;
    if (!response.ok || !data?.ok) throw new CgtwApiError(response.status, data?.error || "提交失败");
    return data;
}

/** 附件需要 CGTW 登录态，统一经 Agent 代理；<img>/<video> 无法带请求头，所以 token 放在查询参数里。 */
export function cgtwMediaUrl(url: string) {
    const { base, token } = agentConnection();
    return `${base}/media?${params({ url, token })}`;
}
