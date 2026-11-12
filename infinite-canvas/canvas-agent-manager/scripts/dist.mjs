import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const edition = process.argv[2];
if (edition !== "lite" && edition !== "full") throw new Error("Usage: node scripts/dist.mjs <lite|full>");

const managerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...process.env, CANVAS_AGENT_EDITION: edition };

run("node", ["scripts/prepare-resources.mjs", ...(edition === "lite" ? ["--lite"] : [])]);
run("npm", ["run", "build"]);
run("npx", ["electron-builder", "--win", "nsis"]);

function run(command, args) {
    const result = spawnSync(command, args, { cwd: managerRoot, env, stdio: "inherit", shell: process.platform === "win32" });
    if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed`);
}
