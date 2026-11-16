import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { CONFIG_DIR } from "../config.js";
import { CgtwClient, CgtwError } from "./client.js";
import { convertToProres } from "./convert.js";
import { fpsMatches, framesMatch, probeVideo, type VideoMeta } from "./video.js";

export type SubmitKind = "review" | "render";

const VIDEO_EXT = new Set([".mov", ".mp4", ".m4v"]);
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".tif", ".tiff", ".exr", ".tga", ".bmp", ".webp"]);
const VERSION_RE = /_v(\d{1,4})/i;
const SIGNS: Record<SubmitKind, string[]> = { review: ["review"], render: ["fullres", "render"] };
// 项目目标帧率：CGTW 本身不提供，WMZB2 为 25；可在 ~/.infinite-canvas/cgtw-settings.json 的 fps 里按项目数据库名追加或覆盖
const DEFAULT_FPS: Record<string, number> = { proj_wmzb2: 25 };
const activeTargets = new Set<string>();

const osName = () => (process.platform === "win32" ? "win" : process.platform === "darwin" ? "mac" : "linux");

function projectFps(db: string) {
    let custom: Record<string, number> = {};
    try {
        custom = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, "cgtw-settings.json"), "utf8")).fps || {};
    } catch {}
    const value = Number({ ...DEFAULT_FPS, ...custom }[db]);
    return value > 0 ? value : null;
}

/** 文件框命名规则里带 # 的那一条，例如 S001_0020_cmp_cmp_v####.mov；以 .* 结尾表示不限扩展名。 */
export function ruleOf(filebox: Record<string, any>) {
    const rules: string[] = Array.isArray(filebox.rule) ? filebox.rule : filebox.rule ? [filebox.rule] : [];
    const raw = rules.find((item) => item?.includes("#"));
    if (!raw) throw new CgtwError(422, "该文件框没有命名规则，请联系管理员配置");
    const rule = raw.replace(/\.\*$/, "");
    const pad = /#+/.exec(rule)![0].length;
    return { rule, pad, ext: rule === raw ? path.extname(rule).toLowerCase() : "" };
}

export const nameFor = (rule: string, pad: number, version: number, ext: string, ruleExt: string) => rule.replace(/#+/, String(version).padStart(pad, "0")) + (ruleExt ? "" : ext);

export async function resolveFilebox(client: CgtwClient, db: string, taskId: string, kind: SubmitKind) {
    for (const sign of SIGNS[kind]) {
        for (const os of new Set([osName(), "win"])) {
            const filebox = await client.filebox(db, taskId, sign, os);
            if (filebox) return { filebox, sign, os };
        }
    }
    throw new CgtwError(422, `该任务在 CGTW 里没有配置${kind === "review" ? "小样" : "大样"}文件框（${SIGNS[kind].join("/")}），无法提交，请联系管理员配置`);
}

export function targetDir(filebox: Record<string, any>) {
    const dir = String(filebox.path || "").replace(/\\/g, "/").replace(/\/+$/, "");
    if (!dir || dir.includes("{")) throw new CgtwError(422, "文件框没有可用的存储目录");
    return dir;
}

/** 目录里已有的文件和文件夹，按文件名里的版本号倒序；序列帧大样是 _v0001 命名的文件夹，所以文件夹也算。 */
export function listEntries(dir: string) {
    let names: string[] = [];
    try {
        names = fs.readdirSync(dir);
    } catch {
        return { exists: false, entries: [] as ReturnType<typeof entryOf>[] };
    }
    return { exists: true, entries: names.filter((name) => !name.startsWith(".")).map((name) => entryOf(dir, name)).sort((a, b) => (b.version ?? -1) - (a.version ?? -1) || a.name.localeCompare(b.name)) };
}

function entryOf(dir: string, name: string) {
    let stat: fs.Stats | null = null;
    try {
        stat = fs.statSync(path.join(dir, name));
    } catch {}
    const match = VERSION_RE.exec(name);
    return { name, version: match ? Number(match[1]) : null, isDir: !!stat?.isDirectory(), size: stat && !stat.isDirectory() ? stat.size : 0, mtime: stat ? stat.mtime.toISOString() : "" };
}

/** 本地目录与 CGTW 版本里已用过的版本号，取最大值加 1 作为建议版本。 */
async function usedVersions(client: CgtwClient, db: string, filebox: Record<string, any>, entries: { version: number | null }[]) {
    const cgtw = (await client.versionTokens(db, filebox)) ?? [];
    const disk = entries.map((entry) => entry.version).filter((version): version is number => version !== null);
    return { cgtw, disk, all: new Set([...cgtw, ...disk]) };
}

export async function planSubmit(client: CgtwClient, db: string, taskId: string, kind: SubmitKind) {
    const task = await client.task(db, taskId);
    const { filebox, sign } = await resolveFilebox(client, db, taskId, kind);
    const { rule, pad, ext } = ruleOf(filebox);
    const dir = targetDir(filebox);
    const { exists, entries } = listEntries(dir);
    const used = await usedVersions(client, db, filebox, entries);
    const isFlow = kind === "review" && String(filebox.is_submit || "").toUpperCase() === "Y";
    return {
        task,
        kind,
        sign,
        title: filebox.title || sign,
        dir,
        dirExists: exists,
        entries: entries.slice(0, 200),
        entryCount: entries.length,
        cgtwVersions: used.cgtw.sort((a, b) => b - a),
        nextVersion: Math.max(0, ...used.all) + 1,
        rule,
        pad,
        ruleExt: ext,
        allowedExt: ext ? [ext] : [...VIDEO_EXT, ...IMAGE_EXT],
        target: { fps: projectFps(db), frames: task.frame || null },
        features: { convert: true },
        triggersFlow: isFlow,
        setsReviewStatus: kind === "review",
    };
}

export function checkVideo(meta: VideoMeta, kind: SubmitKind, fps: number | null, frames: number | null) {
    const reasons: string[] = [];
    if (fps !== null) {
        if (meta.fps === null) reasons.push(`无法检测帧率（要求 ${fps} fps）`);
        else if (fpsMatches(meta.fps, fps) === false) reasons.push(`帧率不符：检测 ${meta.fps.toFixed(3)} fps，要求 ${fps} fps`);
    }
    if (frames) {
        if (meta.frames === null) reasons.push(`无法检测帧数（任务要求 ${frames} 帧）`);
        else if (framesMatch(meta.frames, frames) === false) reasons.push(`帧数不符：检测 ${meta.frames} 帧，任务要求 ${frames} 帧`);
    }
    const is1080 = meta.width === 1920 && meta.height === 1080;
    if (meta.width !== null && meta.height !== null) {
        if (kind === "review" && !is1080) reasons.push(`小样分辨率要求 1920x1080，当前为 ${meta.width}x${meta.height}`);
        if (kind === "render" && is1080) reasons.push("大样不能是 1920x1080");
    }
    return reasons;
}

export type SubmitArgs = { db: string; taskId: string; kind: SubmitKind; version: number; ext: string; convert?: boolean; trim?: boolean };

export async function runSubmit(client: CgtwClient, args: SubmitArgs, body: Readable) {
    const drain = () => body.resume();
    let tmp = "";
    let converted = "";
    let lockKey = "";
    try {
        const { db, taskId, kind, version } = args;
        const sourceExt = args.ext.toLowerCase();
        if (!Number.isInteger(version) || version < 1 || version > 9999) throw new CgtwError(400, "版本号必须是 1–9999 的整数");
        if (!VIDEO_EXT.has(sourceExt) && !IMAGE_EXT.has(sourceExt)) throw new CgtwError(422, `不支持的文件格式 ${sourceExt || "(无扩展名)"}`);
        if (args.convert && !VIDEO_EXT.has(sourceExt)) throw new CgtwError(422, "只有视频可以转换为 ProRes .mov");
        // 转换后的最终文件一定是 .mov，命名规则和版本冲突都按它检查
        const ext = args.convert ? ".mov" : sourceExt;
        const task = await client.task(db, taskId);
        const { filebox, sign, os } = await resolveFilebox(client, db, taskId, kind);
        const { rule, pad, ext: ruleExt } = ruleOf(filebox);
        if (ruleExt && ext !== ruleExt) throw new CgtwError(422, `该文件框的命名规则只接受 ${ruleExt} 文件（${rule}），当前文件是 ${ext}${VIDEO_EXT.has(sourceExt) ? "，可勾选“转换为 ProRes .mov”" : ""}`);
        const dir = targetDir(filebox);
        const name = nameFor(rule, pad, version, ext, ruleExt);
        if (path.basename(name) !== name || name.includes("..")) throw new CgtwError(400, "文件名不合法");
        const finalPath = path.join(dir, name);
        const { entries } = listEntries(dir);
        const used = await usedVersions(client, db, filebox, entries);
        if (used.all.has(version)) throw new CgtwError(409, `版本 v${String(version).padStart(pad, "0")} 已存在，请更换版本号`);
        if (fs.existsSync(finalPath)) throw new CgtwError(409, `目标文件已存在：${name}`);
        lockKey = finalPath.toLowerCase();
        if (activeTargets.has(lockKey)) throw new CgtwError(409, "同一版本正在提交中");
        activeTargets.add(lockKey);
        try {
            fs.mkdirSync(dir, { recursive: true });
        } catch (error) {
            throw new CgtwError(500, `无法创建目录 ${dir}：${error instanceof Error ? error.message : error}`);
        }

        const stem = `.cgtw-upload-${crypto.randomBytes(6).toString("hex")}`;
        tmp = path.join(dir, `${stem}${sourceExt}`);
        await pipeline(body, fs.createWriteStream(tmp));

        const fps = projectFps(db);
        const source = VIDEO_EXT.has(sourceExt) ? probeVideo(tmp) : null;
        let checked = tmp;
        if (args.convert) {
            converted = path.join(dir, `${stem}-converted.mov`);
            await convertToProres(tmp, converted, { kind, fps, frames: task.frame || null, trim: !!args.trim });
            checked = converted;
        }
        const isVideo = VIDEO_EXT.has(ext);
        const meta = isVideo ? probeVideo(checked) : { fps: null, frames: null, width: null, height: null };
        const reasons = isVideo ? checkVideo(meta, kind, fps, task.frame || null) : [];
        if (reasons.length) throw new CgtwError(422, `${args.convert ? "转换后" : ""}校验不通过：${reasons.join("；")}`);
        if (fs.existsSync(finalPath)) throw new CgtwError(409, `目标文件已存在：${name}`);
        fs.renameSync(checked, finalPath);
        if (checked === converted) converted = "";
        else tmp = "";

        const warnings: string[] = [];
        // source 是原始上传文件的实际参数，converted / trimmed 说明是否做过转换、是否被截取，方便核对帧数怎么变的
        const trimmed = !!args.convert && !!args.trim && !!task.frame && (source?.frames ?? 0) > task.frame;
        const result = { ok: true, filename: name, version, path: finalPath, kind, sign, meta, source, converted: !!args.convert, trimmed, cgtwSynced: false, cgtwVersionId: "", warnings };
        try {
            Object.assign(result, await registerVersion(client, { db, taskId, kind, sign, os, filebox, finalPath, version, warnings }));
        } catch (error) {
            warnings.push(`已落盘，但同步 CGTW 失败：${error instanceof Error ? error.message : error}`);
        }
        return result;
    } catch (error) {
        drain();
        throw error;
    } finally {
        if (tmp) fs.rmSync(tmp, { force: true });
        if (converted) fs.rmSync(converted, { force: true });
        if (lockKey) activeTargets.delete(lockKey);
    }
}

/** 同 KJ_PIPELINE：file/create → version/client_create → 小样触发 work_flow/submit，并把小样任务状态改为 review。 */
async function registerVersion(client: CgtwClient, a: { db: string; taskId: string; kind: SubmitKind; sign: string; os: string; filebox: Record<string, any>; finalPath: string; version: number; warnings: string[] }) {
    const stat = fs.statSync(a.finalPath);
    const modifyTime = new Date(stat.mtime.getTime() - stat.mtime.getTimezoneOffset() * 60000).toISOString().slice(0, 19).replace("T", " ");
    const serverRoot = String(a.filebox.server || "").replace(/\\/g, "/");
    const cgtwPath = a.finalPath.replace(/\\/g, "/");
    const submitDir = cgtwPath.slice(0, cgtwPath.lastIndexOf("/"));
    const relative = (value: string) => {
        if (serverRoot && value.toLowerCase().startsWith(serverRoot.toLowerCase())) return value.slice(serverRoot.length).replace(/^\/?/, "/");
        return value;
    };
    const serverId = a.filebox.server_id || "";
    const versionId = crypto.createHash("md5").update(`${a.db}:${a.taskId}:${a.sign}:${a.finalPath}:${Date.now()}`).digest("hex").toUpperCase();

    await client.createFile({ db: a.db, taskId: a.taskId, versionId, path: cgtwPath, size: stat.size, modifyTime, os: a.os, serverId, submitDir });
    const created = await client.createClientVersion({ db: a.db, taskId: a.taskId, sign: a.sign, submitDir: relative(submitDir), submitPath: relative(cgtwPath), serverId, fields: { "#id": versionId, entity: String(a.version).padStart(3, "0") } });
    const createdId = typeof created === "string" ? created : created?.id || created?.version_id || created?.["#id"] || (Array.isArray(created) && created[0]?.id) || versionId;

    if (a.kind === "review") {
        if (String(a.filebox.is_submit || "").toUpperCase() === "Y") {
            try {
                await client.workflowSubmit({ db: a.db, taskId: a.taskId, filebox: a.filebox, versionId: createdId });
                a.warnings.push("已触发 CGTW 正式提交流程");
            } catch (error) {
                a.warnings.push(`CGTW 正式提交流程未执行：${error instanceof Error ? error.message : error}`);
            }
        }
        for (const sign of ["task.leader_status", "task.status"]) {
            try {
                await client.setTaskField(a.db, a.taskId, sign, "review");
            } catch (error) {
                a.warnings.push(`状态更新失败（${sign}）：${error instanceof Error ? error.message : error}`);
                break;
            }
        }
    }
    return { cgtwSynced: true, cgtwVersionId: createdId };
}
