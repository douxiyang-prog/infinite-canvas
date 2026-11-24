import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile, spawn, type ChildProcessByStdio } from "node:child_process";
import { promisify } from "node:util";
import type { Readable } from "node:stream";

import { app, BrowserWindow, clipboard, ipcMain, Menu, nativeImage, shell, Tray } from "electron";

type AgentRuntime = "canvas" | "codex" | "dsh" | "ark";
type AgentStatus = "stopped" | "starting" | "running" | "stopping" | "error";
type AgentChild = ChildProcessByStdio<null, Readable, Readable>;
type CodexProvider = "deepseek" | "best100" | "openai";

type ManagerSettings = {
    port: number;
    runtime: AgentRuntime;
    canvasUrl: string;
    proxyEnabled: boolean;
    proxyHost: string;
    proxyPort: number;
    proxyBypass: string;
    codexProvider: CodexProvider;
    codexBaseUrl: string;
    codexModel: string;
    startOnLaunch: boolean;
    autoRestart: boolean;
    minimizeToTray: boolean;
};

type AgentConfig = {
    url: string;
    token: string;
    runtime?: AgentRuntime;
    origins?: string[];
    workspace?: { workspacePath: string; activeThreadId?: string; pinnedThreadIds?: string[] };
    dsh?: { apiKey?: string };
};

type SystemProxyBackup = {
    enabled: number;
    server: string;
    override: string;
};

type ManagerState = {
    version: string;
    status: AgentStatus;
    pid: number | null;
    token: string;
    agentUrl: string;
    settings: ManagerSettings;
    logs: string[];
    lastError: string;
    electronNodeVersion: string;
    components: { codex: boolean; dsh: boolean };
};

const DEFAULT_SETTINGS: ManagerSettings = {
    port: 17371,
    runtime: "canvas",
    canvasUrl: "http://192.168.1.68",
    proxyEnabled: true,
    proxyHost: "192.168.1.65",
    proxyPort: 3333,
    proxyBypass: "localhost,127.0.0.1,::1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,ark.cn-beijing.volces.com,api.deepseek.com,api-beijing.klingai.com,.volces.com,.deepseek.com,.klingai.com",
    codexProvider: "deepseek",
    codexBaseUrl: "https://api.deepseek.com/",
    codexModel: "deepseek-flash",
    startOnLaunch: true,
    autoRestart: true,
    minimizeToTray: true,
};
const PROXY_ENV_KEYS = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"];
const WINDOWS_INTERNET_SETTINGS_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";
const execFileAsync = promisify(execFile);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let agentProcess: AgentChild | null = null;
let startTask: Promise<ManagerState> | null = null;
let restartTimer: NodeJS.Timeout | null = null;
let intentionalStop = false;
let quitting = false;
let status: AgentStatus = "stopped";
let lastError = "";
let logs: string[] = [];

const settingsFile = () => path.join(app.getPath("userData"), "manager-settings.json");
const systemProxyBackupFile = () => path.join(app.getPath("userData"), "system-proxy-backup.json");
const codexConfigFile = () => path.join(app.getPath("home"), ".codex", "config.toml");
const agentConfigDir = () => path.join(app.getPath("home"), ".infinite-canvas");
const agentConfigFile = () => path.join(agentConfigDir(), "canvas-agent.json");

function loadSettings(): ManagerSettings {
    try {
        const stored = JSON.parse(fs.readFileSync(settingsFile(), "utf8")) as Partial<ManagerSettings>;
        return {
            port: validPort(stored.port) ? Number(stored.port) : DEFAULT_SETTINGS.port,
            runtime: validRuntime(stored.runtime) && (stored.runtime !== "dsh" || dshAvailable()) && (stored.runtime !== "codex" || codexAvailable()) ? stored.runtime : DEFAULT_SETTINGS.runtime,
            canvasUrl: typeof stored.canvasUrl === "string" ? stored.canvasUrl : DEFAULT_SETTINGS.canvasUrl,
            proxyEnabled: typeof stored.proxyEnabled === "boolean" ? stored.proxyEnabled : DEFAULT_SETTINGS.proxyEnabled,
            proxyHost: typeof stored.proxyHost === "string" ? stored.proxyHost.trim() : DEFAULT_SETTINGS.proxyHost,
            proxyPort: validProxyPort(stored.proxyPort) ? Number(stored.proxyPort) : DEFAULT_SETTINGS.proxyPort,
            proxyBypass: typeof stored.proxyBypass === "string" && stored.proxyBypass.trim() ? stored.proxyBypass.trim() : DEFAULT_SETTINGS.proxyBypass,
            codexProvider: validCodexProvider(stored.codexProvider) ? stored.codexProvider : DEFAULT_SETTINGS.codexProvider,
            codexBaseUrl: typeof stored.codexBaseUrl === "string" ? stored.codexBaseUrl.trim() : DEFAULT_SETTINGS.codexBaseUrl,
            codexModel: typeof stored.codexModel === "string" ? stored.codexModel.trim() : DEFAULT_SETTINGS.codexModel,
            startOnLaunch: stored.startOnLaunch !== false,
            autoRestart: stored.autoRestart !== false,
            minimizeToTray: stored.minimizeToTray !== false,
        };
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
}

function saveSettings(next: ManagerSettings) {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2));
}

async function readWindowsProxyValue(name: string, type: "dword"): Promise<number>;
async function readWindowsProxyValue(name: string, type: "string"): Promise<string>;
async function readWindowsProxyValue(name: string, type: "dword" | "string"): Promise<number | string> {
    try {
        const { stdout } = await execFileAsync("reg.exe", ["query", WINDOWS_INTERNET_SETTINGS_KEY, "/v", name], { windowsHide: true, encoding: "utf8" });
        const line = String(stdout).split(/\r?\n/).find((item) => item.trim().startsWith(name));
        if (!line) return type === "dword" ? 0 : "";
        if (type === "dword") return Number.parseInt(line.match(/0x([0-9a-f]+)/i)?.[1] || "0", 16);
        return line.match(/\s+REG_SZ\s*(.*)$/i)?.[1]?.trim() || "";
    } catch {
        return type === "dword" ? 0 : "";
    }
}

async function readWindowsSystemProxy(): Promise<SystemProxyBackup> {
    const [enabled, server, override] = await Promise.all([
        readWindowsProxyValue("ProxyEnable", "dword"),
        readWindowsProxyValue("ProxyServer", "string"),
        readWindowsProxyValue("ProxyOverride", "string"),
    ]);
    return { enabled, server, override };
}

async function writeWindowsProxyValue(name: string, type: "REG_DWORD" | "REG_SZ", value: string | number) {
    await execFileAsync("reg.exe", ["add", WINDOWS_INTERNET_SETTINGS_KEY, "/v", name, "/t", type, "/d", String(value), "/f"], { windowsHide: true });
}

async function notifyWindowsProxyChanged() {
    const script = [
        "$type = '[DllImport(\"wininet.dll\", SetLastError = true)] public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);'",
        "$winInet = Add-Type -MemberDefinition $type -Name WinINet -Namespace Native -PassThru",
        "[Native.WinINet]::InternetSetOption([IntPtr]::Zero, 39, [IntPtr]::Zero, 0) | Out-Null",
        "[Native.WinINet]::InternetSetOption([IntPtr]::Zero, 37, [IntPtr]::Zero, 0) | Out-Null",
    ].join("; ");
    await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true });
}

function windowsProxyOverride(value: string) {
    const entries = new Set(["<local>"]);
    for (const raw of value.split(",").map((item) => item.trim()).filter(Boolean)) {
        if (raw === "192.168.0.0/16") entries.add("192.168.*");
        else if (raw === "10.0.0.0/8") entries.add("10.*");
        else if (raw === "172.16.0.0/12") {
            for (let octet = 16; octet <= 31; octet += 1) entries.add(`172.${octet}.*`);
        } else if (raw.startsWith(".")) entries.add(`*${raw}`);
        else entries.add(raw);
    }
    return [...entries].join(";");
}

async function applyWindowsSystemProxy(settings: ManagerSettings) {
    if (process.platform !== "win32") {
        if (settings.proxyEnabled) throw new Error("系统代理设置仅支持 Windows");
        return;
    }
    if (settings.proxyEnabled) {
        if (!fs.existsSync(systemProxyBackupFile())) {
            fs.mkdirSync(path.dirname(systemProxyBackupFile()), { recursive: true });
            fs.writeFileSync(systemProxyBackupFile(), JSON.stringify(await readWindowsSystemProxy(), null, 2));
        }
        await writeWindowsProxyValue("ProxyServer", "REG_SZ", `${settings.proxyHost}:${settings.proxyPort}`);
        await writeWindowsProxyValue("ProxyOverride", "REG_SZ", windowsProxyOverride(settings.proxyBypass));
        await writeWindowsProxyValue("ProxyEnable", "REG_DWORD", 1);
    } else {
        let backup: SystemProxyBackup | null = null;
        try {
            backup = JSON.parse(fs.readFileSync(systemProxyBackupFile(), "utf8")) as SystemProxyBackup;
        } catch {}
        if (backup) {
            await writeWindowsProxyValue("ProxyServer", "REG_SZ", backup.server);
            await writeWindowsProxyValue("ProxyOverride", "REG_SZ", backup.override);
            await writeWindowsProxyValue("ProxyEnable", "REG_DWORD", backup.enabled ? 1 : 0);
        } else {
            await writeWindowsProxyValue("ProxyEnable", "REG_DWORD", 0);
        }
        try {
            fs.rmSync(systemProxyBackupFile(), { force: true });
        } catch {}
    }
    await notifyWindowsProxyChanged();
}

function validCodexProvider(value: unknown): value is CodexProvider {
    return value === "deepseek" || value === "best100" || value === "openai";
}

function tomlString(value: string) {
    return JSON.stringify(value);
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceRootTomlValue(text: string, key: string, value: string) {
    const firstSection = text.search(/^\s*\[/m);
    const head = firstSection >= 0 ? text.slice(0, firstSection) : text;
    const tail = firstSection >= 0 ? text.slice(firstSection) : "";
    const pattern = new RegExp(`^(\\s*)${escapeRegExp(key)}\\s*=.*$`, "m");
    const next = pattern.test(head) ? head.replace(pattern, `$1${key} = ${value}`) : `${head.replace(/\s*$/, "")}\n${key} = ${value}\n`;
    return `${next}${tail}`;
}

function removeRootTomlValue(text: string, key: string) {
    const firstSection = text.search(/^\s*\[/m);
    const head = firstSection >= 0 ? text.slice(0, firstSection) : text;
    const tail = firstSection >= 0 ? text.slice(firstSection) : "";
    return `${head.replace(new RegExp(`^\\s*${escapeRegExp(key)}\\s*=.*(?:\\r?\\n)?`, "m"), "")}${tail}`;
}

function providerSectionRange(text: string, provider: CodexProvider) {
    const header = new RegExp(`^\\s*\\[model_providers\\.${escapeRegExp(provider)}\\]\\s*$`, "m").exec(text);
    if (!header || header.index === undefined) return null;
    const afterHeader = header.index + header[0].length;
    const next = /^\s*\[/m.exec(text.slice(afterHeader));
    return { start: header.index, end: next ? afterHeader + next.index : text.length };
}

async function writeCodexConfig(settings: ManagerSettings, apiKey: string) {
    const file = codexConfigFile();
    let text = "";
    try {
        text = fs.readFileSync(file, "utf8");
    } catch {}
    let token = apiKey.trim();
    const currentRange = providerSectionRange(text, settings.codexProvider);
    if (!token && currentRange) {
        const section = text.slice(currentRange.start, currentRange.end);
        const match = section.match(/^\s*experimental_bearer_token\s*=\s*("(?:\\.|[^"\\])*")/m);
        if (match) {
            try {
                token = String(JSON.parse(match[1]));
            } catch {}
        }
    }
    if (!token) throw new Error("请输入 Codex API Key");
    let baseUrl: URL;
    try {
        baseUrl = new URL(settings.codexBaseUrl);
    } catch {
        throw new Error("Codex Base URL 格式无效");
    }
    if (!["http:", "https:"].includes(baseUrl.protocol)) throw new Error("Codex Base URL 必须使用 http 或 https");
    if (!settings.codexModel) throw new Error("请填写 Codex 模型");
    const providerName = settings.codexProvider === "deepseek" ? "DeepSeek" : settings.codexProvider === "best100" ? "100Best" : "OpenAI";
    const section = [
        `[model_providers.${settings.codexProvider}]`,
        `name = ${tomlString(providerName)}`,
        `base_url = ${tomlString(settings.codexBaseUrl)}`,
        `wire_api = "responses"`,
        `experimental_bearer_token = ${tomlString(token)}`,
        "",
    ].join("\n");
    let next = replaceRootTomlValue(text, "model", tomlString(settings.codexModel));
    next = replaceRootTomlValue(next, "model_provider", tomlString(settings.codexProvider));
    next = replaceRootTomlValue(next, "forced_login_method", '"api"');
    next = removeRootTomlValue(next, "preferred_auth_method");
    const range = providerSectionRange(next, settings.codexProvider);
    next = range ? `${next.slice(0, range.start)}${section}${next.slice(range.end)}` : `${next.replace(/\s*$/, "")}\n\n${section}`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const backup = `${file}.canvas-agent-manager.bak`;
    if (fs.existsSync(file)) fs.copyFileSync(file, backup);
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, next, { mode: 0o600 });
    fs.renameSync(temp, file);
}

function validPort(value: unknown) {
    const port = Number(value);
    return Number.isInteger(port) && port >= 1024 && port <= 65535;
}

function validProxyPort(value: unknown) {
    const port = Number(value);
    return Number.isInteger(port) && port >= 1 && port <= 65535;
}

function validRuntime(value: unknown): value is AgentRuntime {
    return value === "canvas" || value === "codex" || value === "dsh" || value === "ark";
}

function normalizeSettings(value: unknown): ManagerSettings {
    const input = value && typeof value === "object" && !Array.isArray(value) ? value as Partial<ManagerSettings> : {};
    const port = Number(input.port);
    if (!validPort(port)) throw new Error("端口必须在 1024 到 65535 之间");
    if (!validRuntime(input.runtime)) throw new Error("Agent 后端无效");
    if (input.runtime === "dsh" && !dshAvailable()) throw new Error("当前安装包不包含 DeepSeek Harness，请安装完整版");
    if (input.runtime === "codex" && !codexAvailable()) throw new Error("当前安装包不包含 Codex，请安装完整版 Canvas Agent Manager");
    const canvasUrl = String(input.canvasUrl || "").trim();
    if (canvasUrl) {
        let parsed: URL;
        try {
            parsed = new URL(canvasUrl);
        } catch {
            throw new Error("Canvas 地址无效，请填写完整 URL");
        }
        if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Canvas 地址必须使用 http 或 https");
    }
    const proxyEnabled = input.proxyEnabled === true;
    const proxyHost = String(input.proxyHost || "").trim();
    const proxyPort = Number(input.proxyPort);
    if (proxyEnabled && !proxyHost) throw new Error("请填写 Agent 代理地址");
    if (proxyHost && /[:/?#\s]/.test(proxyHost)) throw new Error("代理地址只填写 IP 或域名，不要包含协议和端口");
    if (!validProxyPort(proxyPort)) throw new Error("代理端口必须在 1 到 65535 之间");
    if (!validCodexProvider(input.codexProvider)) throw new Error("Codex Provider 无效");
    const codexBaseUrl = String(input.codexBaseUrl || "").trim();
    try {
        const parsed = new URL(codexBaseUrl);
        if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
    } catch {
        throw new Error("Codex Base URL 必须使用 http 或 https");
    }
    const codexModel = String(input.codexModel || "").trim();
    if (!codexModel) throw new Error("请填写 Codex 模型");
    return {
        port,
        runtime: input.runtime,
        canvasUrl,
        proxyEnabled,
        proxyHost,
        proxyPort,
        proxyBypass: String(input.proxyBypass || "").trim() || DEFAULT_SETTINGS.proxyBypass,
        codexProvider: input.codexProvider,
        codexBaseUrl,
        codexModel,
        startOnLaunch: input.startOnLaunch !== false,
        autoRestart: input.autoRestart !== false,
        minimizeToTray: input.minimizeToTray !== false,
    };
}

function readAgentConfig(): AgentConfig {
    const settings = loadSettings();
    let existing: Partial<AgentConfig> = {};
    try {
        existing = JSON.parse(fs.readFileSync(agentConfigFile(), "utf8")) as Partial<AgentConfig>;
    } catch {}
    const config: AgentConfig = {
        ...existing,
        url: `http://127.0.0.1:${settings.port}`,
        token: existing.token || crypto.randomBytes(18).toString("hex"),
        runtime: settings.runtime,
    };
    fs.mkdirSync(agentConfigDir(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(agentConfigFile(), JSON.stringify(config, null, 2), { mode: 0o600 });
    try {
        fs.chmodSync(agentConfigDir(), 0o700);
        fs.chmodSync(agentConfigFile(), 0o600);
    } catch {}
    return config;
}

function snapshot(): ManagerState {
    const settings = loadSettings();
    let token = "";
    try {
        token = String((JSON.parse(fs.readFileSync(agentConfigFile(), "utf8")) as Partial<AgentConfig>).token || "");
    } catch {}
    return {
        version: app.getVersion(),
        status,
        pid: agentProcess?.pid || null,
        token,
        agentUrl: `http://127.0.0.1:${settings.port}`,
        settings,
        logs: [...logs],
        lastError,
        electronNodeVersion: process.versions.node,
        components: { codex: codexAvailable(), dsh: dshAvailable() },
    };
}

function publish() {
    mainWindow?.webContents.send("manager:state", snapshot());
    rebuildTrayMenu();
}

function appendLog(line: string) {
    const token = (() => {
        try {
            return String((JSON.parse(fs.readFileSync(agentConfigFile(), "utf8")) as Partial<AgentConfig>).token || "");
        } catch {
            return "";
        }
    })();
    const redacted = (token ? line.split(token).join("[token]") : line)
        .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/g, "[redacted-key]");
    logs = [...logs, redacted].slice(-300);
    publish();
}

function attachOutput(child: AgentChild) {
    for (const stream of [child.stdout, child.stderr]) {
        let buffer = "";
        stream.setEncoding("utf8");
        stream.on("data", (chunk: string) => {
            buffer += chunk;
            let newline = buffer.search(/[\r\n]/);
            while (newline >= 0) {
                appendLog(buffer.slice(0, newline));
                buffer = buffer.slice(newline + 1).replace(/^\n/, "");
                newline = buffer.search(/[\r\n]/);
            }
        });
        stream.on("end", () => {
            if (buffer.trim()) appendLog(buffer.trim());
        });
    }
}

function agentEntry() {
    if (app.isPackaged) {
        return path.join(process.resourcesPath, "agent", "node_modules", "@basketikun", "canvas-agent", "dist", "index.js");
    }
    return path.resolve(__dirname, "..", "..", "canvas-agent", "dist", "index.js");
}

function agentWorkingDirectory() {
    return path.dirname(path.dirname(agentEntry()));
}

function agentEnvironment(settings: ManagerSettings) {
    const env = { ...process.env };
    for (const key of PROXY_ENV_KEYS) delete env[key];
    if (!settings.proxyEnabled) return env;
    const proxyUrl = `http://${settings.proxyHost}:${settings.proxyPort}`;
    env.HTTP_PROXY = proxyUrl;
    env.HTTPS_PROXY = proxyUrl;
    env.ALL_PROXY = proxyUrl;
    env.http_proxy = proxyUrl;
    env.https_proxy = proxyUrl;
    env.all_proxy = proxyUrl;
    env.NO_PROXY = settings.proxyBypass;
    env.no_proxy = settings.proxyBypass;
    return env;
}

/** 精简版安装包不含 DeepSeek Harness，需要同时检查打包与开发两种依赖布局。 */
function dshAvailable() {
    const root = agentWorkingDirectory();
    return [path.join(root, "node_modules"), path.resolve(root, "..", "..")]
        .some((dir) => fs.existsSync(path.join(dir, "@deepseek-ai", "dsh-sdk-client")));
}

/** Codex 和 DSH 一样属于完整版可选组件。 */
function codexAvailable() {
    const root = agentWorkingDirectory();
    return [path.join(root, "node_modules"), path.resolve(root, "..", "..")]
        .some((dir) => fs.existsSync(path.join(dir, "@openai", "codex", "package.json")));
}

function startAgent() {
    if (agentProcess) return Promise.resolve(snapshot());
    if (startTask) return startTask;
    startTask = startAgentOnce().finally(() => {
        startTask = null;
    });
    return startTask;
}

async function startAgentOnce() {
    if (agentProcess) return snapshot();
    if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
    }
    const settings = loadSettings();
    const config = readAgentConfig();
    const entry = agentEntry();
    if (!fs.existsSync(entry)) {
        status = "error";
        lastError = `Canvas Agent 未找到：${entry}`;
        appendLog(lastError);
        return snapshot();
    }
    try {
        await releaseExistingAgent(settings.port, config.token);
    } catch (error) {
        status = "error";
        lastError = error instanceof Error ? error.message : String(error);
        appendLog(lastError);
        return snapshot();
    }
    if (!supportsRequiredNode(process.versions.node)) {
        status = "error";
        lastError = `内置 Node ${process.versions.node} 低于 Canvas Agent 要求的 24.9.0`;
        appendLog(lastError);
        return snapshot();
    }

    status = "starting";
    lastError = "";
    appendLog(`启动 Canvas Agent，端口 ${settings.port}，后端 ${settings.runtime}`);
    appendLog(settings.proxyEnabled ? `Agent 网络代理：${settings.proxyHost}:${settings.proxyPort}` : "Agent 网络代理已关闭");
    const child = spawn(process.execPath, [entry], {
        cwd: agentWorkingDirectory(),
        env: {
            ...agentEnvironment(settings),
            ELECTRON_RUN_AS_NODE: "1",
            PORT: String(settings.port),
            CANVAS_AGENT_RUNTIME: settings.runtime,
        },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
    });
    agentProcess = child;
    intentionalStop = false;
    attachOutput(child);
    child.once("error", (error) => {
        lastError = error.message;
        status = "error";
        appendLog(`启动失败：${error.message}`);
    });
    child.once("exit", (code, signal) => {
        if (agentProcess === child) agentProcess = null;
        if (intentionalStop || quitting) {
            status = "stopped";
            appendLog("Canvas Agent 已停止");
        } else {
            lastError = `Canvas Agent 意外退出（code=${code ?? "null"}，signal=${signal ?? "null"}）`;
            status = "error";
            appendLog(lastError);
            if (loadSettings().autoRestart && !quitting) {
                restartTimer = setTimeout(() => {
                    restartTimer = null;
                    void startAgent();
                }, 2000);
            }
        }
        publish();
    });
    publish();

    if (await waitForHealth(`http://127.0.0.1:${settings.port}/health`, 20_000)) {
        if (agentProcess === child) {
            status = "running";
            lastError = "";
            appendLog(`Canvas Agent 已就绪：http://127.0.0.1:${settings.port}`);
        }
    } else if (agentProcess === child) {
        status = "error";
        lastError = "Canvas Agent 启动超时，请查看日志";
        appendLog(lastError);
    }
    publish();
    return snapshot();
}

async function stopAgent() {
    if (startTask) await startTask.catch(() => undefined);
    if (!agentProcess) {
        status = "stopped";
        publish();
        return snapshot();
    }
    const child = agentProcess;
    const settings = loadSettings();
    const config = readAgentConfig();
    intentionalStop = true;
    status = "stopping";
    publish();
    try {
        await fetch(`http://127.0.0.1:${settings.port}/agent/shutdown`, {
            method: "POST",
            headers: { "x-canvas-agent-token": config.token },
            signal: AbortSignal.timeout(2000),
        });
    } catch {}
    if (!await waitForExit(child, 4000)) {
        appendLog("Canvas Agent 未在 4 秒内退出，正在强制结束进程");
        child.kill();
        await waitForExit(child, 2000);
    }
    if (agentProcess === child) agentProcess = null;
    status = "stopped";
    publish();
    return snapshot();
}

async function restartAgent() {
    status = "stopping";
    publish();
    await stopAgent();
    await new Promise((resolve) => setTimeout(resolve, 250));
    return startAgent();
}

async function quitManager() {
    if (quitting) return;
    quitting = true;
    if (restartTimer) clearTimeout(restartTimer);
    await stopAgent();
    app.quit();
}

function supportsRequiredNode(version: string) {
    const [major, minor] = version.split(".").map(Number);
    return major > 24 || (major === 24 && minor >= 9);
}

function waitForExit(child: AgentChild, timeoutMs: number) {
    if (child.exitCode !== null) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), timeoutMs);
        child.once("exit", () => {
            clearTimeout(timer);
            resolve(true);
        });
    });
}

async function waitForHealth(url: string, timeoutMs: number) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return true;
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return false;
}

async function releaseExistingAgent(port: number, token: string) {
    if (!await waitForHealth(`http://127.0.0.1:${port}/health`, 400)) return;
    appendLog(`端口 ${port} 已有 Canvas Agent，正在尝试接管`);
    try {
        await fetch(`http://127.0.0.1:${port}/agent/shutdown`, {
            method: "POST",
            headers: { "x-canvas-agent-token": token },
            signal: AbortSignal.timeout(2000),
        });
    } catch {}
    if (await waitForPortClosed(port, 4000)) return;

    const pids = await listeningProcessIds(port);
    if (!pids.length) throw new Error(`端口 ${port} 已被占用，但无法识别占用进程`);
    for (const pid of pids) {
        const commandLine = await processCommandLine(pid);
        if (!/canvas-agent/i.test(commandLine)) throw new Error(`端口 ${port} 被其他程序占用：${commandLine || `PID ${pid}`}`);
        appendLog(`正在结束旧 Canvas Agent 进程 PID ${pid}`);
        if (process.platform === "win32") await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
        else process.kill(pid, "SIGKILL");
    }
    if (!await waitForPortClosed(port, 4000)) throw new Error(`无法释放端口 ${port}，请先关闭旧 Canvas Agent`);
}

async function waitForPortClosed(port: number, timeoutMs: number) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) });
        } catch {
            return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return false;
}

async function listeningProcessIds(port: number) {
    if (process.platform !== "win32") {
        // lsof 在没有匹配进程时以退出码 1 结束。
        const { stdout } = await execFileAsync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]).catch(() => ({ stdout: "" }));
        return stdout.split(/\s+/).map(Number).filter((pid, index, values) => Number.isInteger(pid) && pid > 0 && values.indexOf(pid) === index);
    }
    const { stdout } = await execFileAsync("netstat", ["-ano", "-p", "tcp"], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    return [...stdout.matchAll(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/gim)]
        .filter((match) => Number(match[1]) === port)
        .map((match) => Number(match[2]))
        .filter((pid, index, values) => pid > 0 && values.indexOf(pid) === index);
}

async function processCommandLine(pid: number) {
    if (process.platform !== "win32") {
        const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "command="]).catch(() => ({ stdout: "" }));
        return stdout.trim();
    }
    const script = `$process = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' -ErrorAction SilentlyContinue; if ($process) { $process.CommandLine }`;
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script], { windowsHide: true, maxBuffer: 1024 * 1024 });
    return stdout.trim();
}

function configureLoginItem(settings: ManagerSettings) {
    app.setLoginItemSettings({
        openAtLogin: settings.startOnLaunch,
        path: process.execPath,
        args: ["--hidden"],
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 900,
        height: 720,
        minWidth: 760,
        minHeight: 600,
        show: false,
        backgroundColor: "#0f1115",
        title: "Canvas Agent Manager",
        icon: assetPath("icon.png"),
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });
    mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
    mainWindow.once("ready-to-show", () => {
        if (!process.argv.includes("--hidden")) mainWindow?.show();
    });
    mainWindow.on("close", (event) => {
        if (!quitting && loadSettings().minimizeToTray) {
            event.preventDefault();
            mainWindow?.hide();
        }
    });
    mainWindow.on("closed", () => {
        mainWindow = null;
    });
}

function assetPath(name: string) {
    return path.join(__dirname, "..", "assets", name);
}

function trayImage() {
    return nativeImage.createFromPath(assetPath("tray.png"));
}

function createTray() {
    tray = new Tray(trayImage());
    tray.setToolTip("Canvas Agent Manager");
    tray.on("double-click", showWindow);
    rebuildTrayMenu();
}

function rebuildTrayMenu() {
    if (!tray) return;
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: "打开管理界面", click: showWindow },
        { type: "separator" },
        { label: "启动 Agent", enabled: status === "stopped" || status === "error", click: () => void startAgent() },
        { label: "停止 Agent", enabled: status === "running" || status === "starting", click: () => void stopAgent() },
        { label: "重启 Agent", enabled: status === "running" || status === "error", click: () => void restartAgent() },
        { type: "separator" },
        { label: "打开 Canvas", click: () => void openCanvas() },
        {
            label: "退出",
            click: () => void quitManager(),
        },
    ]));
}

function showWindow() {
    if (!mainWindow) createWindow();
    mainWindow?.show();
    mainWindow?.focus();
}

async function openCanvas() {
    const settings = loadSettings();
    if (!settings.canvasUrl) throw new Error("请先配置 Canvas 地址");
    const config = readAgentConfig();
    const target = new URL(settings.canvasUrl);
    target.hash = new URLSearchParams({
        agentUrl: `http://127.0.0.1:${settings.port}`,
        agentToken: config.token,
    }).toString();
    await shell.openExternal(target.toString());
}

function registerIpc() {
    ipcMain.handle("manager:get-state", () => snapshot());
    ipcMain.handle("manager:start", async () => startAgent());
    ipcMain.handle("manager:stop", async () => stopAgent());
    ipcMain.handle("manager:restart", async () => restartAgent());
    ipcMain.handle("manager:save-settings", async (_event, value: unknown) => {
        const input = value && typeof value === "object" && !Array.isArray(value) ? value as Partial<ManagerSettings> & { codexApiKey?: string } : {};
        const next = normalizeSettings({ ...loadSettings(), ...input });
        if (next.runtime === "codex") await writeCodexConfig(next, String(input.codexApiKey || ""));
        saveSettings(next);
        configureLoginItem(next);
        if (agentProcess) await restartAgent();
        else publish();
        return snapshot();
    });
    ipcMain.handle("manager:set-proxy", async (_event, value: unknown) => {
        const input = value && typeof value === "object" && !Array.isArray(value) ? value as Partial<ManagerSettings> : {};
        const current = loadSettings();
        const enabled = input.proxyEnabled === true;
        const next = normalizeSettings(enabled
            ? { ...current, ...input, proxyEnabled: true }
            : { ...current, proxyEnabled: false });
        await applyWindowsSystemProxy(next);
        saveSettings(next);
        if (agentProcess) await restartAgent();
        else publish();
        return snapshot();
    });
    ipcMain.handle("manager:copy-token", () => {
        clipboard.writeText(readAgentConfig().token);
        return true;
    });
    ipcMain.handle("manager:open-canvas", async () => {
        await openCanvas();
        return true;
    });
    ipcMain.handle("manager:open-data-folder", async () => {
        await shell.openPath(agentConfigDir());
        return true;
    });
}

const lock = app.requestSingleInstanceLock();
if (!lock) {
    app.quit();
} else {
    app.on("second-instance", showWindow);
    app.whenReady().then(async () => {
        registerIpc();
        createWindow();
        createTray();
        const settings = loadSettings();
        if (settings.proxyEnabled) {
            try {
                await applyWindowsSystemProxy(settings);
            } catch (error) {
                lastError = error instanceof Error ? error.message : String(error);
                appendLog(`系统代理应用失败：${lastError}`);
            }
        }
        configureLoginItem(settings);
        if (settings.startOnLaunch && !process.argv.includes("--skip-autostart")) {
            await startAgent();
        }
    });
}

app.on("window-all-closed", () => {
    if (!loadSettings().minimizeToTray) app.quit();
});

app.on("activate", showWindow);

app.on("before-quit", (event) => {
    if (!quitting) {
        event.preventDefault();
        void quitManager();
    }
});
