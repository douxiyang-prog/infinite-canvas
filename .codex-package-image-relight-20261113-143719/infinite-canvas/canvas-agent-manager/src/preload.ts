import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("manager", {
    getState: () => ipcRenderer.invoke("manager:get-state"),
    start: () => ipcRenderer.invoke("manager:start"),
    stop: () => ipcRenderer.invoke("manager:stop"),
    restart: () => ipcRenderer.invoke("manager:restart"),
    saveSettings: (settings: unknown) => ipcRenderer.invoke("manager:save-settings", settings),
    copyToken: () => ipcRenderer.invoke("manager:copy-token"),
    openCanvas: () => ipcRenderer.invoke("manager:open-canvas"),
    openDataFolder: () => ipcRenderer.invoke("manager:open-data-folder"),
    onState: (callback: (state: unknown) => void) => {
        const listener = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state);
        ipcRenderer.on("manager:state", listener);
        return () => ipcRenderer.removeListener("manager:state", listener);
    },
});
