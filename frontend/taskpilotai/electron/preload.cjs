const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("taskPilotDesktop", {
  isDesktop: true,
  captureScreen: (teeEnvelope) => ipcRenderer.invoke("taskpilot:capture-screen", teeEnvelope),
  getBackendConfig: () => ipcRenderer.invoke("taskpilot:backend-config"),
  googleLogin: (role) => ipcRenderer.invoke("taskpilot:google-login", { role }),
  summarizeVision: (payload) => ipcRenderer.invoke("taskpilot:vision-summary", payload),
  detectContext: () => ipcRenderer.invoke("taskpilot:detect-context"),
  teeAttest: () => ipcRenderer.invoke("taskpilot:tee-attest"),
  // Gemini direct call (API key stays in main process)
  geminiChat: (prompt, model, thumbnail) => ipcRenderer.invoke("taskpilot:gemini-stream", { prompt, model, thumbnail }),
  // Calendar integration
  saveToCalendar: (meeting) => ipcRenderer.invoke("taskpilot:save-to-calendar", meeting),
  onCompleteTask: (callback) => ipcRenderer.on("taskpilot:complete-task-from-floating", (_event, payload) => callback(payload)),
  onTaskWorking: (callback) => ipcRenderer.on("taskpilot:task-working-from-floating", (_event, payload) => callback(payload)),
  sendToFloating: (payload) => ipcRenderer.send("taskpilot:send-to-floating", payload)
});

contextBridge.exposeInMainWorld("taskPilotFloating", {
  togglePanel: () => ipcRenderer.send("taskpilot-floating:toggle-panel"),
  hidePanel: () => ipcRenderer.send("taskpilot-floating:hide-panel"),
  moveDock: (point) => ipcRenderer.send("taskpilot-floating:move-dock", point),
  restoreMain: () => ipcRenderer.send("taskpilot-floating:restore-main"),
  detectContext: () => ipcRenderer.invoke("taskpilot:detect-context"),
  captureScreen: () => ipcRenderer.invoke("taskpilot-floating:capture-screen"),
  geminiChat: (prompt, model, thumbnail) => ipcRenderer.invoke("taskpilot-floating:gemini-chat", { prompt, model, thumbnail }),
  createPlan: (payload) => ipcRenderer.invoke("taskpilot-floating:create-plan", payload),
  executePlan: (payload) => ipcRenderer.invoke("taskpilot-floating:execute-plan", payload),
  onCursorMove: (callback) => ipcRenderer.on("taskpilot-floating:cursor-move", (_event, point) => callback(point)),
  completeTask: (taskId) => ipcRenderer.send("taskpilot-floating:complete-task", { taskId }),
  markTaskWorking: (taskId) => ipcRenderer.send("taskpilot-floating:task-working", { taskId }),
  openExternal: (url) => ipcRenderer.send("taskpilot:open-external", url),
  onMessage: (callback) => ipcRenderer.on("taskpilot-floating:receive-message", (_event, msg) => callback(msg))
});
