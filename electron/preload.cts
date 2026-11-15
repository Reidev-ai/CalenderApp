import { contextBridge, ipcRenderer } from "electron";
import type { DesktopRequest } from "../src/desktop.js";
import type { UpdateStatus } from "../src/updateTypes.js";

contextBridge.exposeInMainWorld("calendarDesktop", Object.freeze({
  request: (request: DesktopRequest) => ipcRenderer.invoke("calendar:request", request),
  updates: Object.freeze({
    getStatus: () => ipcRenderer.invoke("updates:status"),
    download: () => ipcRenderer.invoke("updates:action", "download"),
    install: () => ipcRenderer.invoke("updates:action", "install"),
    subscribe: (listener: (status: UpdateStatus) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, status: UpdateStatus) => listener(status);
      ipcRenderer.on("updates:status", handler);
      return () => { ipcRenderer.removeListener("updates:status", handler); };
    },
  }),
}));
