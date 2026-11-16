import { Readable } from "node:stream";
import path from "node:path";
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";

import { CgtwClient, CgtwError } from "./client.js";
import { listTaskFiles, resolveTaskFile } from "./files.js";
import { planSubmit, runSubmit } from "./submit.js";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/** CGTW 只读接口，挂在 Agent 的 /cgtw 下；令牌、来源校验和跨域头由 Agent 的全局中间件处理。 */
export function createCgtwRouter() {
    const client = new CgtwClient();
    const router = Router();
    const wrap = (handler: (req: Request, res: Response) => Promise<unknown> | unknown): RequestHandler => (req, res, next: NextFunction) => {
        Promise.resolve(handler(req, res)).catch((error) => {
            if (error instanceof CgtwError) return void res.status(error.status).json({ ok: false, error: error.message });
            next(error);
        });
    };
    const text = (req: Request, key: string) => (typeof req.query[key] === "string" ? (req.query[key] as string) : "");
    const database = (req: Request) => {
        const db = text(req, "db");
        if (!/^[\w-]+$/.test(db)) throw new CgtwError(400, "缺少项目数据库名");
        return db;
    };
    const sessionInfo = () => ({ ok: true, loggedIn: !!client.session, name: client.session?.name || "", server: client.session?.server || "", mode: client.session?.mode || "" });

    router.get("/session", (_req, res) => res.json(sessionInfo()));
    router.post("/login", wrap(async (req, res) => {
        await client.login(req.body || {});
        res.json(sessionInfo());
    }));
    router.post("/logout", (_req, res) => {
        client.logout();
        res.json(sessionInfo());
    });
    router.get("/projects", wrap(async (_req, res) => res.json({ ok: true, projects: await client.projects() })));
    router.get("/facets", wrap(async (req, res) => {
        const db = database(req);
        res.json({ ok: true, ...(await client.facets(db)), colors: await client.statusColors(db) });
    }));
    router.get("/tasks", wrap(async (req, res) => {
        const limit = Math.min(Math.max(Number(text(req, "limit")) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
        const result = await client.tasks({ db: database(req), mine: text(req, "mine") === "1", q: text(req, "q"), eps: text(req, "eps"), pipeline: text(req, "pipeline"), status: text(req, "status"), offset: Math.max(Number(text(req, "offset")) || 0, 0), limit });
        res.json({ ok: true, ...result });
    }));
    router.get("/notes", wrap(async (req, res) => res.json({ ok: true, notes: await client.notes(database(req), text(req, "taskId")) })));

    const submitKind = (req: Request) => {
        const kind = text(req, "kind");
        if (kind !== "review" && kind !== "render") throw new CgtwError(400, "提交类型必须是 review 或 render");
        return kind;
    };
    router.get("/submit/plan", wrap(async (req, res) => res.json({ ok: true, ...(await planSubmit(client, database(req), text(req, "taskId"), submitKind(req))) })));
    router.get("/files", wrap(async (req, res) => res.json({ ok: true, ...(await listTaskFiles(client, database(req), text(req, "taskId"), submitKind(req))) })));
    /** 把目录里的文件发给浏览器（.mov 先转成 H.264 预览）；sendFile 自带 Range 支持，视频可拖动进度。 */
    router.get("/file", wrap(async (req, res) => {
        const file = await resolveTaskFile(client, database(req), text(req, "taskId"), submitKind(req), text(req, "name"));
        await new Promise<void>((resolve, reject) => res.sendFile(path.basename(file), { root: path.dirname(file), dotfiles: "allow", headers: { "cache-control": "private, max-age=3600" } }, (error) => (error ? reject(error) : resolve())));
    }));
    /** 请求体就是文件本身（application/octet-stream），元数据放在查询参数里。 */
    router.post("/submit", wrap(async (req, res) => {
        const result = await runSubmit(client, { db: database(req), taskId: text(req, "taskId"), kind: submitKind(req), version: Number(text(req, "version")), ext: text(req, "ext"), convert: text(req, "convert") === "1", trim: text(req, "trim") === "1" }, req);
        res.json(result);
    }));

    /** 只代理 CGTW 服务器 /upload/ 下的附件，浏览器的 <img>/<video> 无法带登录 cookie。 */
    router.get("/media", wrap(async (req, res) => {
        const session = client.session;
        if (!session) throw new CgtwError(401, "尚未登录 CGTW");
        let url: URL;
        try {
            url = new URL(text(req, "url"));
        } catch {
            throw new CgtwError(400, "不支持的附件地址");
        }
        if (url.host !== session.server || !url.pathname.startsWith("/upload/")) throw new CgtwError(400, "不支持的附件地址");
        const range = req.headers.range;
        const upstream = await fetch(url, { headers: { cookie: `token=${session.token}`, ...(range ? { range } : {}) } });
        for (const name of ["content-type", "content-length", "content-range", "accept-ranges"]) {
            const value = upstream.headers.get(name);
            if (value) res.setHeader(name, value);
        }
        res.setHeader("cache-control", "private, max-age=3600");
        res.status(upstream.status);
        if (!upstream.body) return void res.end();
        Readable.fromWeb(upstream.body as never).pipe(res);
    }));

    return router;
}
