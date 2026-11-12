import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const managerRoot = path.resolve(scriptDir, "..");
const projectRoot = path.resolve(managerRoot, "..");
const agentRoot = path.join(projectRoot, "canvas-agent");
const resourcesRoot = path.join(managerRoot, "resources");
const agentStage = path.join(resourcesRoot, "agent");
const packStage = path.join(resourcesRoot, ".pack");
// 精简版不安装 optionalDependencies（DeepSeek Harness 与 Codex），体积和文件数大幅减少。
const lite = process.argv.includes("--lite");

assertInside(managerRoot, resourcesRoot);
await fs.rm(resourcesRoot, { recursive: true, force: true });
await fs.mkdir(agentStage, { recursive: true });
await fs.mkdir(packStage, { recursive: true });

run("npm", ["run", "build"], agentRoot);
const packed = run("npm", ["pack", "--pack-destination", packStage, "--json"], agentRoot, true);
const packages = JSON.parse(packed);
const filename = packages?.[0]?.filename;
if (!filename) throw new Error("npm pack did not return a package filename");
const tarball = path.join(packStage, filename);
if (!await exists(tarball)) throw new Error(`Packed Agent not found: ${tarball}`);

run("npm", [
    "install",
    "--omit=dev",
    ...(lite ? ["--omit=optional"] : []),
    "--no-audit",
    "--no-fund",
    "--prefix",
    agentStage,
    tarball,
], managerRoot);

await fs.rm(packStage, { recursive: true, force: true });
const installedEntry = path.join(agentStage, "node_modules", "@basketikun", "canvas-agent", "dist", "index.js");
if (!await exists(installedEntry)) throw new Error(`Installed Agent entry not found: ${installedEntry}`);
const dshInstalled = await exists(path.join(agentStage, "node_modules", "@deepseek-ai", "dsh-sdk-client"));
const codexInstalled = await exists(path.join(agentStage, "node_modules", "@openai", "codex"));
if (lite && (dshInstalled || codexInstalled)) throw new Error("Lite package must not include DeepSeek Harness or Codex");
if (!lite && (!dshInstalled || !codexInstalled)) throw new Error("Full package is missing DeepSeek Harness or Codex");
console.log(`Prepared ${lite ? "lite" : "full"} Canvas Agent resources at ${agentStage}`);

function run(command, args, cwd, capture = false) {
    const result = spawnSync(command, args, {
        cwd,
        encoding: "utf8",
        stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
        windowsHide: true,
        shell: process.platform === "win32",
    });
    if (result.status !== 0) {
        const detail = [result.stdout, result.stderr].filter(Boolean).join("\n");
        throw new Error(`${command} ${args.join(" ")} failed${detail ? `:\n${detail}` : ""}`);
    }
    return result.stdout || "";
}

function assertInside(parent, candidate) {
    const parentPath = path.resolve(parent);
    const candidatePath = path.resolve(candidate);
    if (candidatePath === parentPath || !candidatePath.startsWith(`${parentPath}${path.sep}`)) {
        throw new Error(`Unsafe generated path: ${candidatePath}`);
    }
}

async function exists(file) {
    try {
        await fs.access(file);
        return true;
    } catch {
        return false;
    }
}
