import { spawn } from "node:child_process";
import fs from "node:fs";

import { CgtwError } from "./client.js";

export type ConvertOptions = { kind: "review" | "render"; fps: number | null; frames: number | null; trim: boolean };

/** 优先用环境变量，其次是 CGTW 客户端自带的 ffmpeg，最后是 PATH 里的 ffmpeg。 */
export function findFfmpeg() {
    const candidates = [process.env.CANVAS_FFMPEG, "C:\\CgTeamWork_v7\\bin\\base\\app\\ffmpeg.exe", "C:\\CgTeamWork_v6\\bin\\base\\app\\ffmpeg.exe", "C:\\cgteamwork\\bin\\base\\app\\ffmpeg.exe"];
    return candidates.find((file): file is string => !!file && fs.existsSync(file)) || "ffmpeg";
}

/** 小样：ProRes 422 LT、缩放到 1920x1080（保持比例，补黑边）；大样：ProRes 4444 XQ，保持原分辨率。 */
export function ffmpegArgs(input: string, output: string, options: ConvertOptions) {
    const filters: string[] = [];
    if (options.fps) filters.push(`fps=${options.fps}`);
    if (options.kind === "review") filters.push("scale=1920:1080:force_original_aspect_ratio=decrease", "pad=1920:1080:(ow-iw)/2:(oh-ih)/2");
    const review = options.kind === "review";
    return [
        "-hide_banner",
        "-y",
        "-i",
        input,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        ...(filters.length ? ["-vf", filters.join(",")] : []),
        ...(options.trim && options.frames ? ["-frames:v", String(options.frames)] : []),
        "-c:v",
        "prores_ks",
        "-profile:v",
        review ? "1" : "5",
        "-pix_fmt",
        review ? "yuv422p10le" : "yuv444p10le",
        "-vendor",
        "apl0",
        "-c:a",
        "pcm_s16le",
        output,
    ];
}

/** 把上传的视频转成 ProRes .mov；不设超时，长视频可能需要几分钟，失败时返回 ffmpeg 最后几行错误。 */
export function convertToProres(input: string, output: string, options: ConvertOptions) {
    return new Promise<void>((resolve, reject) => {
        const child = spawn(findFfmpeg(), ffmpegArgs(input, output, options), { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
        let tail = "";
        child.stderr.on("data", (chunk) => {
            tail = (tail + chunk).slice(-1500);
        });
        child.once("error", () => reject(new CgtwError(422, "未找到 ffmpeg，无法转换。请安装 CGTW 客户端，或设置环境变量 CANVAS_FFMPEG 指向 ffmpeg.exe")));
        child.once("close", (code) => (code === 0 ? resolve() : reject(new CgtwError(422, `视频转换失败：${tail.trim().split("\n").slice(-3).join(" ") || `ffmpeg 退出码 ${code}`}`))));
    });
}
