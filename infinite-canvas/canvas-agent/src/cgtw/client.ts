export type Session = { server: string; token: string; accountId: string; name: string; mode: "desktop" | "password" };

export class CgtwError extends Error {
    readonly status: number;
    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

const DESKTOP_PORT = Number(process.env.CGTW_CLIENT_PORT) || 64999;
const VIDEO_EXT = new Set(["mov", "mp4", "m4v", "webm", "mkv", "avi"]);
const TASK_SIGNS = ["task.entity", "task.status", "task.pipeline", "task.artist", "shot.entity", "shot.frame", "eps.entity", "task.last_submit_time", "task.start_date", "task.finish_time"];

/** 通过本机 CGTW 客户端的 WebSocket 读取已登录的 token，不需要密码。 */
export function desktopLogin(): Promise<Session> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${DESKTOP_PORT}`);
        const fail = (message: string) => {
            ws.close();
            reject(new CgtwError(502, message));
        };
        ws.onerror = () => fail("无法连接本机 CGTW 客户端，请确认客户端已启动并登录");
        ws.onopen = () => ws.send(JSON.stringify({ sign: "main_widget", method: "get_login_data", type: "get", database: "main_widget", module: "main_widget" }));
        ws.onmessage = (event) => {
            try {
                let data = JSON.parse(String(event.data)).data;
                if (typeof data === "string") data = JSON.parse(data);
                if (!data?.token || !data.server_ip) throw new Error();
                ws.close();
                resolve({ server: data.server_ip, token: data.token, accountId: data.account_id, name: data.account_name || data.account || "", mode: "desktop" });
            } catch {
                fail("本机 CGTW 客户端尚未登录");
            }
        };
    });
}

export type TaskQuery = { db: string; mine: boolean; q: string; eps: string; pipeline: string; status: string; offset: number; limit: number };

export class CgtwClient {
    session: Session | null = null;

    /** 优先使用本机客户端登录态，传入账号密码时使用 api.php 登录。 */
    async login(input: { server?: string; account?: string; password?: string }) {
        if (!input.account) {
            this.session = await desktopLogin();
        } else {
            if (!input.server || !input.password) throw new CgtwError(400, "请填写服务器地址、账号和密码");
            const server = input.server.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
            const data = await this.post(server, "", "account", "login", { account: input.account, password: input.password });
            this.session = { server, token: data.token, accountId: data.account_id, name: data.name || input.account, mode: "password" };
        }
        // 任务的制作人字段存的是显示名，桌面客户端返回的是账号名，所以统一再查一次显示名
        const [account] = await this.call("account", "get_filter", { sign_array: ["account.name"], sign_filter_array: [["account.id", "=", this.session.accountId]], order_sign_array: [], limit: "1", start_num: "" });
        if (account?.["account.name"]) this.session.name = account["account.name"];
        return this.session;
    }

    logout() {
        this.session = null;
    }

    /** 调用 CGTW api.php，登录态过期时本机客户端模式会自动重新读取一次。 */
    async call(controller: string, method: string, data: Record<string, unknown> = {}, retry = true): Promise<any> {
        const session = this.session;
        if (!session) throw new CgtwError(401, "尚未登录 CGTW");
        try {
            return await this.post(session.server, session.token, controller, method, data);
        } catch (error) {
            if (retry && session.mode === "desktop" && error instanceof CgtwError && error.status === 401) {
                this.session = await desktopLogin();
                return this.call(controller, method, data, false);
            }
            throw error;
        }
    }

    private async post(server: string, token: string, controller: string, method: string, data: Record<string, unknown>) {
        const payload = { ...data, controller, method, app: "api", token, language: "zh" };
        const response = await fetch(`http://${server}/api.php`, {
            method: "POST",
            headers: token ? { cookie: `token=${token}` } : {},
            body: new URLSearchParams({ data: JSON.stringify(payload) }),
        });
        const result = (await response.json().catch(() => null)) as { code?: string; data?: any } | null;
        if (!result) throw new CgtwError(502, "CGTW 服务器返回了无法识别的内容");
        if (result.code === "2") throw new CgtwError(401, "CGTW 登录已过期");
        if (result.code !== "1") throw new CgtwError(400, typeof result.data === "string" ? result.data : "CGTW 请求失败");
        return result.data;
    }

    async projects() {
        const rows: any[] = await this.call("project", "get_filter", { sign_array: ["project.entity", "project.full_name", "project.database", "project.status"], sign_filter_array: [], order_sign_array: [], limit: "5000", start_num: "" });
        return rows.map((row) => ({ db: row["project.database"], code: row["project.entity"], name: row["project.full_name"], status: row["project.status"] }));
    }

    async statusColors(db: string): Promise<Record<string, string>> {
        return (await this.call("status", "get_status_and_color", { db })) || {};
    }

    async tasks(query: TaskQuery) {
        const base = { db: query.db, module: "shot", sign_filter_array: taskFilter(query, this.session?.name || "") };
        const [rows, total] = await Promise.all([
            this.call("task", "get_filter", { ...base, sign_array: TASK_SIGNS, order_sign_array: ["eps.entity", "shot.entity", "task.pipeline"], limit: String(query.limit), start_num: String(query.offset) }),
            this.call("task", "count", base),
        ]);
        return { total: Number(total) || 0, items: (rows as any[]).map(toTask) };
    }

    async facets(db: string) {
        const distinct = async (sign: string) => ((await this.call("task", "distinct", { db, module: "shot", distinct_sign: sign, sign_filter_array: [], order_sign_array: [] })) as string[]).filter(Boolean);
        const [eps, pipelines, statuses] = await Promise.all([distinct("eps.entity"), distinct("task.pipeline"), distinct("task.status")]);
        return { eps, pipelines, statuses };
    }

    async notes(db: string, taskId: string) {
        const rows: any[] = await this.call("note", "get_filter", { db, field_array: ["#id", "time", "dom_text", "type", "from_account_id", "version", "filename"], filter_array: [["#link_id", "=", taskId]], order_field_array: ["time"], limit: "500" });
        const ids = [...new Set(rows.map((row) => row.from_account_id).filter(Boolean))];
        const names = new Map<string, string>();
        if (ids.length) {
            const accounts: any[] = await this.call("account", "get_filter", { sign_array: ["account.name"], sign_filter_array: [["account.id", "in", ids]], order_sign_array: [], limit: "5000", start_num: "" });
            for (const account of accounts) names.set(account.id, account["account.name"]);
        }
        return rows.map((row) => ({ id: row["#id"], time: row.time, type: row.type, author: names.get(row.from_account_id) || "", version: row.version, filename: row.filename, ...parseDomText(row.dom_text, this.session!.server) }));
    }

    async task(db: string, id: string) {
        const rows: any[] = await this.call("task", "get", { db, module: "shot", sign_array: TASK_SIGNS, id_array: [id], order_sign_array: [], limit: "1" });
        if (!rows?.length) throw new CgtwError(404, "任务不存在");
        return toTask({ ...rows[0], id });
    }

    /** 文件框设置：目录、命名规则、版本列表、是否走提交流程等。 */
    async filebox(db: string, taskId: string, sign: string, os: string): Promise<Record<string, any> | null> {
        const data = await this.call("task", "get_sign_filebox", { db, module: "shot", id: taskId, os, filebox_sign: sign }).catch(() => null);
        return data && typeof data === "object" && data["#id"] ? data : null;
    }

    /** 文件框下已有 CGTW 版本的真实文件名版本号；版本记录号会被重复提交推高，不能当作文件版本号。 */
    async versionTokens(db: string, filebox: Record<string, any>): Promise<number[] | null> {
        const ids = Object.keys(filebox.version_id_list || {});
        if (!ids.length) return null;
        const files = await this.call("file", "get_version_file", { db, version_id_array: ids }).catch(() => null);
        if (!Array.isArray(files)) return null;
        const tokens = new Set<number>();
        for (const file of files) {
            const match = /_v(\d{1,4})/i.exec(String(file?.path || file?.["file.path"] || ""));
            if (match) tokens.add(Number(match[1]));
        }
        return [...tokens];
    }

    createFile(args: { db: string; taskId: string; versionId: string; path: string; size: number; modifyTime: string; os: string; serverId: string; submitDir: string }) {
        return this.call("file", "create", {
            db: args.db,
            module: "shot",
            module_type: "task",
            link_id: args.taskId,
            version_id: args.versionId,
            os: args.os,
            file_data_array: [{ path: args.path, size: String(args.size), modify_time: args.modifyTime }],
            meta_data_array: {},
            ...(args.serverId ? { server_id: args.serverId } : {}),
            ...(args.submitDir ? { submit_dir: args.submitDir } : {}),
            is_from_api: process.platform !== "win32",
        });
    }

    createClientVersion(args: { db: string; taskId: string; sign: string; submitDir: string; submitPath: string; serverId: string; fields: Record<string, string> }) {
        return this.call("version", "client_create", { db: args.db, link_id: args.taskId, sign: args.sign, submit_dir: args.submitDir, submit_path_array: [args.submitPath], server_id: args.serverId, field_data_array: args.fields });
    }

    workflowSubmit(args: { db: string; taskId: string; filebox: Record<string, any>; versionId: string }) {
        return this.call("work_flow", "submit", { db: args.db, module: "shot", task_id: args.taskId, filebox_id: args.filebox["#id"], dom_array: [], version_id: args.versionId, note_argv: {}, qc_account_id: args.filebox.reviewer_account_id || "" });
    }

    setTaskField(db: string, taskId: string, sign: string, value: string) {
        return this.call("task", "set", { db, module: "shot", module_type: "task", id_array: [taskId], sign_data_array: { [sign]: value }, exec_event_filter: true });
    }
}

/** 把筛选条件拼成 CGTW 过滤 DSL：条件之间用 "and" 连接，多字段搜索用括号包住 "or"。 */
export function taskFilter(query: TaskQuery, artist: string) {
    const conditions: unknown[][] = [];
    if (query.mine && artist) conditions.push([["task.artist", "=", artist]]);
    if (query.eps) conditions.push([["eps.entity", "=", query.eps]]);
    if (query.pipeline) conditions.push([["task.pipeline", "=", query.pipeline]]);
    if (query.status) conditions.push([["task.status", "=", query.status]]);
    if (query.q) conditions.push(["(", ["shot.entity", "has", query.q], "or", ["task.artist", "has", query.q], ")"]);
    return conditions.flatMap((item, index) => (index ? ["and", ...item] : item));
}

function toTask(row: Record<string, string>) {
    return { id: row.id, shot: row["shot.entity"], eps: row["eps.entity"], pipeline: row["task.pipeline"], status: row["task.status"], artist: row["task.artist"], frame: Number(row["shot.frame"]) || 0, lastSubmit: row["task.last_submit_time"], startDate: row["task.start_date"], finishTime: row["task.finish_time"] };
}

/** 批注内容 dom_text 是 [{type:"text",content}, {type:"image",max,min}] 数组，文字合并，附件转成绝对地址。 */
export function parseDomText(domText: string, server: string) {
    let items: any[] = [];
    try {
        items = JSON.parse(domText || "[]");
    } catch {
        items = [{ type: "text", content: domText }];
    }
    const absolute = (path: string) => (path?.startsWith("/") ? `http://${server}${path}` : path);
    const text = items.filter((item) => item.type === "text").map((item) => item.content).join("\n");
    const medias = items
        .filter((item) => item.max)
        .map((item) => ({ type: item.type === "video" || VIDEO_EXT.has(String(item.max).split(".").pop()!.toLowerCase()) ? ("video" as const) : ("image" as const), url: absolute(item.max), thumb: absolute(item.min || item.max) }));
    return { text, medias };
}
