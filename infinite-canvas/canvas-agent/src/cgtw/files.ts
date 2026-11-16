import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { CONFIG_DIR } from "../config.js";
import { CgtwClient, CgtwError } from "./client.js";
import { findFfmpeg } from "./convert.js";
import { listEntries, resolveFilebox, targetDir, type SubmitKind } from "./submit.js";

// 浏览器能直接显示的格式原样提供；.mov（小样多为 ProRes）浏览器播不了，先转成 H.264 预览再提供
const NATIVE_IMAGE = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"]);
const NATIVE_VIDEO = new Set([".mp4", ".m4v", ".webm"]);
const PREVIEW_VIDEO = new Set([".mov"]);
const CACHE_DIR = path.join(CONFIG_DIR, "cgtw-cache");
// 预览缓存保留 7 天，每次生成新预览时清理过期文件
const CACHE_TTL_MS = 7 * 24 * 3600 * 1000;
const pending = new Map<string, Promise<string>>();

export const importKind = (name: string) => {
    const ext = path.extname(name).toLowerCase();
    return NATIVE_IMAGE.has(ext) ? "image" : NATIVE_VIDEO.has(ext) || PREVIEW_VIDEO.has(ext) ? "video" : null;
};

/** 任务某个文件框目录里的文件列表，供 CGTW 面板的“小样目录/大样目录”使用。 */
export async function listTaskFiles(client: CgtwClient, db: string, taskId: string, kind: SubmitKind) {
    const { filebox } = await resolveFilebox(client, db, taskId, kind);
    const dir = targetDir(filebox);
    const { exists, entries } = listEntries(dir);
    return { dir, exists, entries: entries.map((entry) => ({ ...entry, importKind: entry.isDir ? null : importKind(entry.name) })) };
}

/** 返回可以直接发送给浏览器的本地文件路径；文件名必须是目录里已有的普通文件。 */
export async function resolveTaskFile(client: CgtwClient, db: string, taskId: string, kind: SubmitKind, name: string) {
    if (!name || path.basename(name) !== name || name.startsWith(".")) throw new CgtwError(400, "文件名不合法");
    const type = importKind(name);
    if (!type) throw new CgtwError(422, "该格式不支持导入画布");
    const { filebox } = await resolveFilebox(client, db, taskId, kind);
    const file = path.join(targetDir(filebox), name);
    const stat = fs.statSync(file, { throwIfNoEntry: false });
    if (!stat?.isFile()) throw new CgtwError(404, "文件不存在");
    return PREVIEW_VIDEO.has(path.extname(name).toLowerCase()) ? previewOf(file, stat) : file;
}

function previewOf(file: string, stat: fs.Stats) {
    const key = crypto.createHash("sha1").update(`${file}|${stat.mtimeMs}|${stat.size}`).digest("hex");
    const output = path.join(CACHE_DIR, `${key}.mp4`);
    if (fs.existsSync(output)) return Promise.resolve(output);
    let job = pending.get(key);
    if (!job) {
        job = transcode(file, output).finally(() => pending.delete(key));
        pending.set(key, job);
    }
    return job;
}

function transcode(input: string, output: string) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    for (const name of fs.readdirSync(CACHE_DIR)) {
        const old = path.join(CACHE_DIR, name);
        if (Date.now() - fs.statSync(old).mtimeMs > CACHE_TTL_MS) fs.rmSync(old, { force: true });
    }
    const partial = `${output}.part.mp4`;
    return new Promise<string>((resolve, reject) => {
        const args = ["-hide_banner", "-y", "-i", input, "-map", "0:v:0", "-map", "0:a:0?", "-dn", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:a", "aac", "-movflags", "+faststart", partial];
        const child = spawn(findFfmpeg(), args);
        let tail = "";
        child.stderr.on("data", (chunk) => {
            tail = (tail + chunk).slice(-1000);
        });
        child.once("error", () => reject(new CgtwError(422, "未找到 ffmpeg，无法生成预览。请安装 CGTW 客户端，或设置环境变量 CANVAS_FFMPEG")));
        child.once("close", (code) => {
            if (code !== 0) {
                fs.rmSync(partial, { force: true });
                return reject(new CgtwError(422, `预览转换失败：${tail.trim().split("\n").slice(-2).join(" ")}`));
            }
            fs.renameSync(partial, output);
            resolve(output);
        });
    });
}
