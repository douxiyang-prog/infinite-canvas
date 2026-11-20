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
// Lite installs Codex for canvas operations but omits the much larger DeepSeek Harness runtime.
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

if (lite) {
    const agentPackage = JSON.parse(await fs.readFile(path.join(agentRoot, "package.json"), "utf8"));
    const codexVersion = agentPackage.optionalDependencies?.["@openai/codex"];
    if (!codexVersion) throw new Error("Canvas Agent does not declare an optional Codex dependency");
    run("npm", [
        "install",
        "--omit=dev",
        "--omit=optional",
        "--no-audit",
        "--no-fund",
        "--prefix",
        agentStage,
        `@openai/codex@${codexVersion}`,
    ], managerRoot);
    const installedCodex = JSON.parse(await fs.readFile(path.join(agentStage, "node_modules", "@openai", "codex", "package.json"), "utf8"));
    const platformPackage = `@openai/codex-${process.platform}-${process.arch}`;
    const platformAlias = installedCodex.optionalDependencies?.[platformPackage];
    if (!platformAlias) throw new Error(`Codex does not provide a package for ${process.platform}-${process.arch}`);
    run("npm", [
        "install",
        "--omit=dev",
        "--omit=optional",
        "--no-audit",
        "--no-fund",
        "--no-save",
        "--prefix",
        agentStage,
        `${platformPackage}@${platformAlias}`,
    ], managerRoot);
}

await fs.rm(packStage, { recursive: true, force: true });
const installedEntry = path.join(agentStage, "node_modules", "@basketikun", "canvas-agent", "dist", "index.js");
if (!await exists(installedEntry)) throw new Error(`Installed Agent entry not found: ${installedEntry}`);
const dshInstalled = await exists(path.join(agentStage, "node_modules", "@deepseek-ai", "dsh-sdk-client"));
const codexInstalled = await exists(path.join(agentStage, "node_modules", "@openai", "codex"));
const codexPlatformInstalled = await exists(path.join(agentStage, "node_modules", "@openai", `codex-${process.platform}-${process.arch}`));
if (lite && dshInstalled) throw new Error("Lite package must not include DeepSeek Harness");
if (lite && (!codexInstalled || !codexPlatformInstalled)) throw new Error("Lite package is missing Codex or its native executable");
if (!lite && (!dshInstalled || !codexInstalled)) throw new Error("Full package is missing DeepSeek Harness or Codex");
console.log(`Prepared ${lite ? "lite + Codex" : "full"} Canvas Agent resources at ${agentStage}`);

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
