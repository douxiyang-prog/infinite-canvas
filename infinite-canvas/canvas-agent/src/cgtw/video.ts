import fs from "node:fs";

type Range = { start: number; end: number };

/** 读取 MP4/MOV 的 atom 结构得到帧率、帧数和分辨率，不依赖 ffprobe；移植自 KJ_PIPELINE 的 video_utils.py。 */
class Atoms {
    private fd: number;
    readonly size: number;
    constructor(file: string) {
        this.fd = fs.openSync(file, "r");
        this.size = fs.fstatSync(this.fd).size;
    }
    close() {
        fs.closeSync(this.fd);
    }
    read(position: number, length: number) {
        const buffer = Buffer.alloc(length);
        const read = fs.readSync(this.fd, buffer, 0, length, position);
        return read < length ? buffer.subarray(0, read) : buffer;
    }
    *atoms(start: number, end: number): Generator<{ type: string; start: number; end: number }> {
        let position = start;
        while (position + 8 <= end) {
            const header = this.read(position, 8);
            if (header.length < 8) return;
            let size = header.readUInt32BE(0);
            const type = header.toString("latin1", 4, 8);
            let payload = position + 8;
            if (size === 1) {
                const extended = this.read(position + 8, 8);
                if (extended.length < 8) return;
                size = Number(extended.readBigUInt64BE(0));
                payload = position + 16;
            } else if (size === 0) size = end - position;
            const payloadEnd = position + size;
            if (payloadEnd <= position) return;
            yield { type, start: payload, end: payloadEnd };
            position = payloadEnd;
        }
    }
    find(start: number, end: number, names: string[]): Range | null {
        for (const atom of this.atoms(start, end)) {
            if (atom.type !== names[0]) continue;
            if (names.length === 1) return atom;
            const found = this.find(atom.start, atom.end, names.slice(1));
            if (found) return found;
        }
        return null;
    }
    /** 只取视频轨：音频轨的采样率会被误读成帧率。 */
    videoTrak(): Range | null {
        const moov = this.find(0, this.size, ["moov"]);
        if (!moov) return null;
        let fallback: Range | null = null;
        let anyHandler = false;
        for (const atom of this.atoms(moov.start, moov.end)) {
            if (atom.type !== "trak") continue;
            fallback ||= atom;
            const hdlr = this.find(atom.start, atom.end, ["mdia", "hdlr"]);
            if (!hdlr) continue;
            anyHandler = true;
            if (this.read(hdlr.start + 8, 4).toString("latin1") === "vide") return atom;
        }
        return anyHandler ? null : fallback;
    }
}

export type VideoMeta = { fps: number | null; frames: number | null; width: number | null; height: number | null };

export function probeVideo(file: string): VideoMeta {
    const meta: VideoMeta = { fps: null, frames: null, width: null, height: null };
    let atoms: Atoms | undefined;
    try {
        atoms = new Atoms(file);
        const trak = atoms.videoTrak();
        if (!trak) return meta;
        const mdia = atoms.find(trak.start, trak.end, ["mdia"]);
        const mdhd = mdia && atoms.find(mdia.start, mdia.end, ["mdhd"]);
        const stts = mdia && atoms.find(mdia.start, mdia.end, ["minf", "stbl", "stts"]);
        if (mdhd && stts) {
            const head = atoms.read(mdhd.start, 32);
            const version = head.readUInt8(0);
            const timescale = version === 1 ? head.readUInt32BE(20) : head.readUInt32BE(12);
            const duration = version === 1 ? Number(head.readBigUInt64BE(24)) : head.readUInt32BE(16);
            const count = atoms.read(stts.start + 4, 4).readUInt32BE(0);
            const table = atoms.read(stts.start + 8, count * 8);
            let samples = 0;
            let total = 0;
            for (let index = 0; index + 8 <= table.length; index += 8) {
                const sampleCount = table.readUInt32BE(index);
                samples += sampleCount;
                total += sampleCount * table.readUInt32BE(index + 4);
            }
            meta.frames = samples || null;
            if (total > 0 && timescale > 0) meta.fps = (samples * timescale) / total;
            else if (duration > 0 && timescale > 0 && samples > 0) meta.fps = samples / (duration / timescale);
        }
        const tkhd = atoms.find(trak.start, trak.end, ["tkhd"]);
        if (tkhd) {
            const head = atoms.read(tkhd.start, 100);
            const offset = head.readUInt8(0) === 1 ? 4 + 32 + 52 : 4 + 20 + 52;
            meta.width = head.readUInt32BE(offset) >>> 16;
            meta.height = head.readUInt32BE(offset + 4) >>> 16;
        }
    } catch {
        // 无法解析时保持 null，由调用方按“无法检测”处理
    } finally {
        atoms?.close();
    }
    return meta;
}

/** 帧率比较容差 0.05，兼容 23.976 与 24。 */
export const fpsMatches = (actual: number | null, target: number | null) => (actual === null || target === null ? null : Math.abs(actual - target) <= 0.05);
export const framesMatch = (actual: number | null, target: number | null) => (actual === null || !target ? null : actual === target);
