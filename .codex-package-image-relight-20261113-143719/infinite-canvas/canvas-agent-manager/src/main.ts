import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile, spawn, type ChildProcessByStdio } from "node:child_process";
import { promisify } from "node:util";
import type { Readable } from "node:stream";

import { app, BrowserWindow, clipboard, ipcMain, Menu, nativeImage, shell, Tray } from "electron";

type AgentRuntime = "canvas" | "dsh" | "ark";
type AgentStatus = "stopped" | "starting" | "running" | "stopping" | "error";
type AgentChild = ChildProcessByStdio<null, Readable, Readable>;

type ManagerSettings = {
    port: number;
    runtime: AgentRuntime;
    canvasUrl: string;
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
    components: { dsh: boolean };
};

const DEFAULT_SETTINGS: ManagerSettings = {
    port: 17371,
    runtime: "canvas",
    canvasUrl: "http://192.168.1.68",
    startOnLaunch: true,
    autoRestart: true,
    minimizeToTray: true,
};
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
const agentConfigDir = () => path.join(app.getPath("home"), ".infinite-canvas");
const agentConfigFile = () => path.join(agentConfigDir(), "canvas-agent.json");

function loadSettings(): ManagerSettings {
    try {
        const stored = JSON.parse(fs.readFileSync(settingsFile(), "utf8")) as Partial<ManagerSettings>;
        return {
            port: validPort(stored.port) ? Number(stored.port) : DEFAULT_SETTINGS.port,
            runtime: validRuntime(stored.runtime) && (stored.runtime !== "dsh" || dshAvailable()) ? stored.runtime : DEFAULT_SETTINGS.runtime,
            canvasUrl: typeof stored.canvasUrl === "string" ? stored.canvasUrl : DEFAULT_SETTINGS.canvasUrl,
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

function validPort(value: unknown) {
    const port = Number(value);
    return Number.isInteger(port) && port >= 1024 && port <= 65535;
}

function validRuntime(value: unknown): value is AgentRuntime {
    return value === "canvas" || value === "dsh" || value === "ark";
}

function normalizeSettings(value: unknown): ManagerSettings {
    const input = value && typeof value === "object" && !Array.isArray(value) ? value as Partial<ManagerSettings> : {};
    const port = Number(input.port);
    if (!validPort(port)) throw new Error("端口必须在 1024 到 65535 之间");
    if (!validRuntime(input.runtime)) throw new Error("Agent 后端无效");
    if (input.runtime === "dsh" && !dshAvailable()) throw new Error("当前安装包不包含 DeepSeek Harness，请安装完整版");
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
    return {
        port,
        runtime: input.runtime,
        canvasUrl,
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
        components: { dsh: dshAvailable() },
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

/** 精简版安装包不含 DeepSeek Harness，需要同时检查打包与开发两种依赖布局。 */
function dshAvailable() {
    const root = agentWorkingDirectory();
    return [path.join(root, "node_modules"), path.resolve(root, "..", "..")]
        .some((dir) => fs.existsSync(path.join(dir, "@deepseek-ai", "dsh-sdk-client")));
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
    const child = spawn(process.execPath, [entry], {
        cwd: agentWorkingDirectory(),
        env: {
            ...process.env,
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
        const next = normalizeSettings(value);
        saveSettings(next);
        configureLoginItem(next);
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
        configureLoginItem(loadSettings());
        if (loadSettings().startOnLaunch && !process.argv.includes("--skip-autostart")) {
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
