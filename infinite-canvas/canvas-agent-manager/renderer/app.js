const elements = {
  statusPill: document.querySelector("#status-pill"),
  statusText: document.querySelector("#status-text"),
  statusDetail: document.querySelector("#status-detail"),
  agentUrl: document.querySelector("#agent-url"),
  token: document.querySelector("#token"),
  logs: document.querySelector("#logs"),
  port: document.querySelector("#port"),
  runtime: document.querySelector("#runtime"),
  canvasUrl: document.querySelector("#canvas-url"),
  startOnLaunch: document.querySelector("#start-on-launch"),
  autoRestart: document.querySelector("#auto-restart"),
  minimizeToTray: document.querySelector("#minimize-to-tray"),
  startButton: document.querySelector("#start-btn"),
  stopButton: document.querySelector("#stop-btn"),
  restartButton: document.querySelector("#restart-btn"),
  saveButton: document.querySelector("#save-settings"),
  openCanvas: document.querySelector("#open-canvas"),
  copyToken: document.querySelector("#copy-token"),
  toggleToken: document.querySelector("#toggle-token"),
  openData: document.querySelector("#open-data"),
  clearLogs: document.querySelector("#clear-logs"),
  toast: document.querySelector("#toast"),
};

let currentState = null;
let tokenVisible = false;
let clearedBefore = 0;
let toastTimer = null;

const statusLabels = {
  stopped: "已停止",
  starting: "正在启动",
  running: "运行中",
  stopping: "正在停止",
  error: "需要处理",
};

function maskToken(value) {
  if (!value) return "尚未生成";
  return tokenVisible ? value : `${value.slice(0, 6)}${"•".repeat(Math.max(12, value.length - 6))}`;
}

function render(state) {
  currentState = state;
  elements.statusPill.className = `status-pill ${state.status}`;
  elements.statusPill.querySelector("strong").textContent = statusLabels[state.status] || state.status;
  elements.statusText.textContent = statusLabels[state.status] || state.status;
  const runtimeDetail = state.pid
    ? `PID ${state.pid} · Node ${state.electronNodeVersion}`
    : state.lastError || `Node ${state.electronNodeVersion}`;
  elements.statusDetail.textContent = `v${state.version} · ${runtimeDetail}`;
  elements.agentUrl.textContent = state.agentUrl;
  elements.agentUrl.title = state.agentUrl;
  elements.token.textContent = maskToken(state.token);
  elements.token.title = tokenVisible ? state.token : "Token 默认隐藏";
  elements.startButton.disabled = state.status !== "stopped" && state.status !== "error";
  elements.stopButton.disabled = state.status !== "running" && state.status !== "starting";
  elements.restartButton.disabled = state.status === "starting" || state.status === "stopping" || state.status === "stopped";
  const updating = state.update?.status === "checking" || state.update?.status === "downloading" || state.update?.status === "downloaded";
  elements.port.value = state.settings.port;
  elements.runtime.querySelector('option[value="dsh"]').disabled = !state.components?.dsh;
  elements.runtime.querySelector('option[value="dsh"]').textContent = state.components?.dsh ? "DeepSeek Harness" : "DeepSeek Harness（完整版可用）";
  elements.runtime.value = state.settings.runtime;
  elements.canvasUrl.value = state.settings.canvasUrl;
  elements.startOnLaunch.checked = state.settings.startOnLaunch;
  elements.autoRestart.checked = state.settings.autoRestart;
  elements.minimizeToTray.checked = state.settings.minimizeToTray;
  const visibleLogs = state.logs.slice(clearedBefore);
  elements.logs.textContent = visibleLogs.join("\n") || "暂无日志";
  elements.logs.scrollTop = elements.logs.scrollHeight;
}

function showToast(text, error = false) {
  clearTimeout(toastTimer);
  elements.toast.textContent = text;
  elements.toast.className = `toast visible${error ? " error" : ""}`;
  toastTimer = setTimeout(() => {
    elements.toast.className = "toast";
  }, 3200);
}

async function run(action, successText) {
  try {
    const state = await action();
    if (state) render(state);
    if (successText) showToast(successText);
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), true);
  }
}

elements.startButton.addEventListener("click", () => {
  elements.startButton.disabled = true;
  void run(() => window.manager.start(), "Canvas Agent 已启动");
});
elements.stopButton.addEventListener("click", () => {
  elements.stopButton.disabled = true;
  void run(() => window.manager.stop(), "Canvas Agent 已停止");
});
elements.restartButton.addEventListener("click", () => {
  elements.restartButton.disabled = true;
  void run(() => window.manager.restart(), "Canvas Agent 已重启");
});
elements.saveButton.addEventListener("click", () => run(() => window.manager.saveSettings({
  port: Number(elements.port.value),
  runtime: elements.runtime.value,
  canvasUrl: elements.canvasUrl.value,
  startOnLaunch: elements.startOnLaunch.checked,
  autoRestart: elements.autoRestart.checked,
  minimizeToTray: elements.minimizeToTray.checked,
}), "设置已保存"));
elements.copyToken.addEventListener("click", () => run(async () => {
  await window.manager.copyToken();
  showToast("Token 已复制");
  return null;
}));
elements.toggleToken.addEventListener("click", () => {
  tokenVisible = !tokenVisible;
  elements.toggleToken.textContent = tokenVisible ? "隐藏" : "显示";
  if (currentState) render(currentState);
});
elements.openCanvas.addEventListener("click", () => run(async () => {
  await window.manager.openCanvas();
  return null;
}));
elements.openData.addEventListener("click", () => run(async () => {
  await window.manager.openDataFolder();
  return null;
}));
elements.clearLogs.addEventListener("click", () => {
  clearedBefore = currentState?.logs.length || 0;
  if (currentState) render(currentState);
});

window.manager.onState(render);
run(() => window.manager.getState());
