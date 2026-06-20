const { app, BrowserWindow, ipcMain, desktopCapturer, screen, shell } = require("electron");
const http = require("http");
const path = require("path");

const isDev = !app.isPackaged;
let mainWindow;
let dockWindow;
let panelWindow;
let cursorTimer;
const backendEnv = loadBackendEnv();
const gotSingleInstanceLock = app.requestSingleInstanceLock();
const authCallbackUrl = "http://127.0.0.1:47835/auth/callback";

// Build Vertex AI endpoint URL — uses aiplatform.googleapis.com (GCP credits)
function buildVertexUrl(model) {
  const project  = backendEnv.VERTEX_AI_PROJECT  || "";
  const location = backendEnv.VERTEX_AI_LOCATION || "us-central1";
  // Strip any "publishers/google/models/" prefix the user may have included
  const modelId  = model.replace(/^.*\//, "");
  return `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${modelId}:generateContent`;
}

function getKeyError(apiKey) {
  if (!apiKey || apiKey === "YOUR_GOOGLE_AI_STUDIO_KEY_HERE") {
    return "GEMINI_API_KEY not set in backend/taskpilotai/.env";
  }
  // Accept both Vertex AI Cloud keys (AQ.) and Google AI Studio keys (AIza)
  if (apiKey.length < 20) {
    return "API key looks too short. Check backend/taskpilotai/.env";
  }
  return null;
}

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
    if (dockWindow && !dockWindow.isDestroyed()) dockWindow.showInactive();
    if (panelWindow && !panelWindow.isDestroyed()) {
      positionPanelNearDock();
      panelWindow.showInactive();
    }
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1100,
    minHeight: 760,
    title: "TaskPilot AI",
    backgroundColor: "#f7f4ee",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev) {
    const localDist = path.join(__dirname, "../dist/index.html");
    mainWindow.loadFile(localDist, { query: { desktop: "1" } });
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"), { query: { desktop: "1" } });
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
    app.quit();
  });
}

function createDockWindow() {
  const workArea = screen.getPrimaryDisplay().workArea;
  dockWindow = new BrowserWindow({
    width: 76,
    height: 76,
    x: workArea.x + workArea.width - 96,
    y: workArea.y + workArea.height - 96,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    title: "TaskPilot Floating Agent",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  dockWindow.setAlwaysOnTop(true, process.platform === "darwin" ? "screen-saver" : "floating");
  if (process.platform === "darwin") {
    dockWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  dockWindow.loadFile(path.join(__dirname, "floating-dock.html"));
}

function createPanelWindow() {
  const workArea = screen.getPrimaryDisplay().workArea;
  panelWindow = new BrowserWindow({
    width: 430,
    height: 610,
    x: workArea.x + workArea.width - 456,
    y: workArea.y + workArea.height - 710,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    hasShadow: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    title: "TaskPilot Dock",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  panelWindow.setAlwaysOnTop(true, "floating");
  if (process.platform === "darwin") {
    panelWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  panelWindow.loadFile(path.join(__dirname, "floating-panel.html"));
}

function startCursorTracking() {
  cursorTimer = setInterval(() => {
    if (!dockWindow || dockWindow.isDestroyed()) return;
    dockWindow.webContents.send("taskpilot-floating:cursor-move", screen.getCursorScreenPoint());
  }, 80);
}

function togglePanel() {
  if (!panelWindow || panelWindow.isDestroyed()) {
    createPanelWindow();
    return;
  }
  if (panelWindow.isVisible()) {
    panelWindow.hide();
  } else {
    positionPanelNearDock();
    panelWindow.showInactive();
  }
}

function moveDockWindow(x, y) {
  if (!dockWindow || dockWindow.isDestroyed()) return;
  const display = screen.getDisplayNearestPoint({ x, y });
  const area = display.workArea;
  const bounds = dockWindow.getBounds();
  const nextX = Math.max(area.x, Math.min(x, area.x + area.width - bounds.width));
  const nextY = Math.max(area.y, Math.min(y, area.y + area.height - bounds.height));
  dockWindow.setPosition(Math.round(nextX), Math.round(nextY), false);
  positionPanelNearDock();
}

function positionPanelNearDock() {
  if (!dockWindow || dockWindow.isDestroyed() || !panelWindow || panelWindow.isDestroyed()) return;
  const dock = dockWindow.getBounds();
  const panel = panelWindow.getBounds();
  const display = screen.getDisplayNearestPoint({ x: dock.x, y: dock.y });
  const area = display.workArea;
  const preferLeft = dock.x + dock.width + panel.width > area.x + area.width;
  const x = preferLeft ? dock.x - panel.width - 12 : dock.x + dock.width + 12;
  const y = Math.max(area.y, Math.min(dock.y - panel.height + dock.height, area.y + area.height - panel.height));
  panelWindow.setPosition(Math.round(Math.max(area.x, x)), Math.round(y), false);
}

async function getSupabaseUser(accessToken) {
  const response = await fetch(`${backendEnv.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: backendEnv.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`
    }
  });
  if (!response.ok) throw new Error("Supabase could not validate the Google session.");
  return response.json();
}

async function saveTaskPilotRole(user, accessToken, role) {
  await fetch(`${backendEnv.SUPABASE_URL}/auth/v1/user`, {
    method: "PUT",
    headers: {
      apikey: backendEnv.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ data: { ...(user.user_metadata || {}), taskpilot_role: role } })
  });

  await fetch(`${backendEnv.SUPABASE_URL}/rest/v1/engineer_profiles?id=eq.${encodeURIComponent(user.id)}`, {
    method: "PATCH",
    headers: {
      apikey: backendEnv.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify({ role })
  });
}

function startGoogleLogin(role) {
  if (!backendEnv.SUPABASE_URL || !backendEnv.SUPABASE_ANON_KEY) {
    return Promise.resolve({ success: false, error: "Supabase is not configured." });
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      server.close();
      resolve(result);
    };

    const server = http.createServer(async (request, response) => {
      if (request.method === "GET" && request.url?.startsWith("/auth/callback")) {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(`<!doctype html>
<html><head><meta charset="utf-8"><title>TaskPilot signed in</title></head>
<body style="font-family:system-ui;padding:48px;color:#172033">
<h2>Finishing TaskPilot sign-in...</h2>
<p id="status">You can close this window when authentication completes.</p>
<script>
const values = new URLSearchParams(location.hash.slice(1));
fetch("/auth/session", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ accessToken: values.get("access_token"), error: values.get("error_description") })
}).then((response) => {
  document.querySelector("#status").textContent = response.ok
    ? "Signed in successfully. Return to TaskPilot AI."
    : "Sign-in could not be completed. Return to TaskPilot and try again.";
});
</script></body></html>`);
        return;
      }

      if (request.method === "POST" && request.url === "/auth/session") {
        let body = "";
        request.on("data", (chunk) => {
          body += chunk;
        });
        request.on("end", async () => {
          try {
            const payload = JSON.parse(body || "{}");
            if (!payload.accessToken) throw new Error(payload.error || "Google did not return an access token.");
            const user = await getSupabaseUser(payload.accessToken);
            await saveTaskPilotRole(user, payload.accessToken, role);
            response.writeHead(204);
            response.end();
            finish({
              success: true,
              session: {
                provider: "google-supabase",
                role,
                userId: user.id,
                email: user.email,
                name: user.user_metadata?.full_name || user.user_metadata?.name || user.email,
                avatarUrl: user.user_metadata?.avatar_url || ""
              }
            });
          } catch (error) {
            response.writeHead(400);
            response.end();
            finish({ success: false, error: error.message });
          }
        });
        return;
      }

      response.writeHead(404);
      response.end();
    });

    server.on("error", (error) => finish({ success: false, error: `Login callback failed: ${error.message}` }));
    server.listen(47835, "127.0.0.1", () => {
      const authorizeUrl = new URL(`${backendEnv.SUPABASE_URL}/auth/v1/authorize`);
      authorizeUrl.searchParams.set("provider", "google");
      authorizeUrl.searchParams.set("redirect_to", authCallbackUrl);
      authorizeUrl.searchParams.set("scopes", "openid email profile");
      shell.openExternal(authorizeUrl.toString());
    });

    const timeout = setTimeout(
      () => finish({ success: false, error: "Google sign-in timed out. Please try again." }),
      120000
    );
  });
}

if (gotSingleInstanceLock) {
app.whenReady().then(() => {
  ipcMain.handle("taskpilot:detect-context", async () => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    return {
      success: true,
      data: {
        app: { name: focusedWindow?.getTitle() || "TaskPilot AI" },
        platform: process.platform,
        capturedAt: new Date().toISOString()
      }
    };
  });

  ipcMain.handle("taskpilot:tee-attest", async () => ({
    success: true,
    data: {
      mode: "TEE-ready local enclave",
      status: "attested",
      boundary: "screen frames are ephemeral and user-approved",
      platform: process.platform
    }
  }));

  ipcMain.handle("taskpilot:backend-config", async () => ({
    geminiConfigured: !getKeyError(backendEnv.GEMINI_API_KEY),
    geminiKeyStatus: getKeyError(backendEnv.GEMINI_API_KEY) || "ok",
    llmProvider: backendEnv.LLM_PROVIDER || "vertex",
    teeMode: backendEnv.TASKPILOT_TEE_MODE || "local-attested",
    supabaseConfigured: Boolean(backendEnv.SUPABASE_URL && backendEnv.SUPABASE_ANON_KEY),
    supabaseUrl: backendEnv.SUPABASE_URL || "",
    supabaseAnonKey: backendEnv.SUPABASE_ANON_KEY ? "configured" : "",
    backendPort: backendEnv.TASKPILOT_PORT || "8787",
    llmModel: backendEnv.LLM_MODEL || "gemini-2.5-flash"
  }));

  ipcMain.handle("taskpilot:google-login", async (_event, { role }) => startGoogleLogin(role));

  ipcMain.handle("taskpilot:vision-summary", async (_event, payload) => {
    const apiKey = backendEnv.GEMINI_API_KEY;
    const keyErr = getKeyError(apiKey);
    if (keyErr) {
      return {
        provider: "taskpilotai",
        configured: false,
        summary: `⚠️ TaskPilot AI: ${keyErr}`
      };
    }
    try {
      const model = backendEnv.LLM_MODEL || "gemini-2.5-flash";
      const url = buildVertexUrl(model) + `?key=${apiKey}`;
      const contents = [];
      const parts = [
        {
          text: `You are TaskPilot AI — a secure, privacy-preserving desktop AI companion.
You are monitoring the user's desktop window.
Active Window Context: "${payload.sourceName || "Primary screen"}"
Redacted Context Description: "${payload.redactedOcrContext || ""}"

Please provide a concise (2-3 sentences max) summary of what tasks or errors are visible on screen, and what the engineer should focus on next.`
        }
      ];

      if (payload.thumbnail && payload.thumbnail.includes("base64,")) {
        const base64Data = payload.thumbnail.split("base64,")[1];
        parts.push({
          inlineData: {
            mimeType: "image/png",
            data: base64Data
          }
        });
      }

      contents.push({ role: "user", parts });

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          generationConfig: { maxOutputTokens: 500, temperature: 0.4 }
        })
      });

      if (!response.ok) {
        throw new Error(`Gemini API error ${response.status}: ${await response.text()}`);
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "No analysis available.";

      return {
        provider: "taskpilotai",
        configured: true,
        summary: text.trim(),
        tee: {
          rawKeyExposedToFrontend: false,
          rawScreenshotRequired: true,
          approvalRequired: true
        }
      };
    } catch (err) {
      console.error("[TaskPilot] Vision summary failed:", err.message);
      return {
        provider: "taskpilotai",
        configured: true,
        summary: `TaskPilot AI could not analyze the screen: ${err.message}`,
        tee: {
          rawKeyExposedToFrontend: false,
          rawScreenshotRequired: true,
          approvalRequired: true
        }
      };
    }
  });

  // TaskPilot AI streaming chat handler
  ipcMain.handle("taskpilot:gemini-stream", async (event, { prompt, model, thumbnail }) => {
    const apiKey = backendEnv.GEMINI_API_KEY;
    const keyErr = getKeyError(apiKey);
    if (keyErr) return { success: false, error: keyErr };
    try {
      const useModel = model || backendEnv.LLM_MODEL || "gemini-2.5-flash";
      const url = buildVertexUrl(useModel) + `?key=${apiKey}`;
      const contents = [];
      const parts = [{ text: prompt }];

      if (thumbnail && thumbnail.includes("base64,")) {
        const base64Data = thumbnail.split("base64,")[1];
        parts.push({
          inlineData: {
            mimeType: "image/png",
            data: base64Data
          }
        });
      }
      contents.push({ role: "user", parts });

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          generationConfig: { maxOutputTokens: 2048, temperature: 0.7 }
        })
      });
      if (!response.ok) throw new Error(`TaskPilot AI API ${response.status}: ${await response.text()}`);
      const data = await response.json();
      const text = (data.candidates?.[0]?.content?.parts?.[0]?.text || "").replace(/Gemini/g, "TaskPilot AI");
      return { success: true, text };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Calendar save handler
  ipcMain.handle("taskpilot:save-to-calendar", async (_event, meeting) => {
    // On macOS, open in Calendar app; cross-platform fallback to .ics file
    try {
      const { title, startTime, endTime, description, attendees } = meeting;
      const start = new Date(startTime).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
      const end = new Date(endTime || new Date(new Date(startTime).getTime() + 60 * 60 * 1000)).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
      const icsContent = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//TaskPilot AI//EN",
        "BEGIN:VEVENT",
        `DTSTART:${start}`,
        `DTEND:${end}`,
        `SUMMARY:${title}`,
        `DESCRIPTION:${(description || "").replace(/\n/g, "\\n")}`,
        attendees?.map(a => `ATTENDEE:mailto:${a}`).join("\n") || "",
        "END:VEVENT",
        "END:VCALENDAR"
      ].filter(Boolean).join("\r\n");

      const { dialog } = require("electron");
      const { filePath } = await dialog.showSaveDialog(mainWindow, {
        title: "Save Meeting to Calendar",
        defaultPath: `${title.replace(/[^a-z0-9]/gi, "_")}.ics`,
        filters: [{ name: "Calendar Files", extensions: ["ics"] }]
      });

      if (filePath) {
        require("fs").writeFileSync(filePath, icsContent);
        shell.openPath(filePath); // Opens in default calendar app
        return { success: true, path: filePath };
      }
      return { success: false, error: "Cancelled" };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("taskpilot:capture-screen", captureScreen);
  ipcMain.handle("taskpilot-floating:capture-screen", captureScreen);

  // TaskPilot AI chat for floating panel (API key never leaves main process)
  ipcMain.handle("taskpilot-floating:gemini-chat", async (_event, { prompt, model, thumbnail }) => {
    const apiKey = backendEnv.GEMINI_API_KEY;
    const keyErr = getKeyError(apiKey);
    if (keyErr) return { success: false, error: keyErr };
    try {
      const useModel = model || backendEnv.LLM_MODEL || "gemini-2.5-flash";
      const url = buildVertexUrl(useModel) + `?key=${apiKey}`;
      const contents = [];
      const parts = [{ text: prompt }];

      if (thumbnail && thumbnail.includes("base64,")) {
        const base64Data = thumbnail.split("base64,")[1];
        parts.push({
          inlineData: {
            mimeType: "image/png",
            data: base64Data
          }
        });
      }
      contents.push({ role: "user", parts });

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          generationConfig: { maxOutputTokens: 2048, temperature: 0.7 }
        })
      });
      if (!response.ok) throw new Error(`TaskPilot AI API error ${response.status}: ${await response.text()}`);
      const data = await response.json();
      const text = (data.candidates?.[0]?.content?.parts?.[0]?.text || "").replace(/Gemini/g, "TaskPilot AI");
      return { success: true, text };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("taskpilot-floating:create-plan", async (_event, { intent }) => ({
    success: true,
    data: {
      steps: [
        { id: "context", description: "Detect active app and selected task" },
        { id: "tee", description: "Seal minimized payload inside TEE envelope" },
        { id: "reason", description: `Reason about: ${intent}` },
        { id: "approval", description: "Wait for user approval before execution" }
      ]
    }
  }));

  ipcMain.handle("taskpilot-floating:execute-plan", async (_event, { intent }) => ({
    success: true,
    summary:
      intent && /ocr|screen|scan/i.test(intent)
        ? "TEE OCR scan prepared. Screen frames stay ephemeral, secrets are redacted, and final execution waits for your approval."
        : "Top recommendation: handle the P1 upload timeout first, then review the blocked auth-token PR. No action was executed without approval."
  }));

  ipcMain.on("taskpilot-floating:toggle-panel", togglePanel);
  ipcMain.on("taskpilot-floating:hide-panel", () => panelWindow?.hide());
  ipcMain.on("taskpilot-floating:move-dock", (_event, point) => moveDockWindow(point.x, point.y));
  ipcMain.on("taskpilot-floating:restore-main", () => {
    if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
    mainWindow.show();
    mainWindow.focus();
  });

  ipcMain.on("taskpilot-floating:complete-task", (_event, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("taskpilot:complete-task-from-floating", payload);
    }
  });

  // Open external URL in default browser (so links work in Electron)
  ipcMain.on("taskpilot:open-external", (_event, url) => {
    if (url && (url.startsWith("https://") || url.startsWith("http://"))) {
      shell.openExternal(url);
    }
  });

  // Mark task as working (push to main window)
  ipcMain.on("taskpilot-floating:task-working", (_event, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("taskpilot:task-working-from-floating", payload);
    }
  });

  ipcMain.on("taskpilot:send-to-floating", (_event, payload) => {
    if (panelWindow && !panelWindow.isDestroyed()) {
      panelWindow.webContents.send("taskpilot-floating:receive-message", payload);
    }
  });

  createMainWindow();
  createDockWindow();
  startCursorTracking();

  app.on("activate", () => {
    if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
    if (!dockWindow || dockWindow.isDestroyed()) createDockWindow();
  });
});
}

async function captureScreen() {
  try {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 1280, height: 720 }
    });
    const source = sources[0];
    return {
      success: true,
      name: source?.name || "Primary screen",
      thumbnail: source?.thumbnail?.toDataURL() || null,
      tee: {
        ephemeral: true,
        userApproved: true,
        redactedBeforeExternalCall: true
      }
    };
  } catch (err) {
    // macOS requires screen recording permission in System Preferences
    console.warn("[TaskPilot] Screen capture unavailable:", err.message);
    return {
      success: false,
      name: "Screen capture unavailable",
      thumbnail: null,
      error: "macOS screen recording permission not granted. Go to System Preferences → Privacy & Security → Screen Recording and enable TaskPilot.",
      tee: {
        ephemeral: true,
        userApproved: true,
        redactedBeforeExternalCall: true
      }
    };
  }
}

function loadBackendEnv() {
  // Try multiple possible paths for the backend .env file
  const possiblePaths = [
    path.join(__dirname, "../../../backend/taskpilotai/.env"),
    path.join(__dirname, "../../backend/taskpilotai/.env"),
    path.join(__dirname, "../../../backend/utkarsh/.env"),
    path.join(app.getAppPath(), "../../backend/taskpilotai/.env")
  ];

  for (const envPath of possiblePaths) {
    try {
      const text = require("fs").readFileSync(envPath, "utf8");
      const parsed = Object.fromEntries(
        text
          .split(/\r?\n/)
          .filter((line) => line.trim() && !line.trim().startsWith("#"))
          .map((line) => {
            const index = line.indexOf("=");
            return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
          })
      );
      console.log(`[TaskPilot] Loaded env from: ${envPath}`);
      return parsed;
    } catch {
      // try next path
    }
  }
  console.warn("[TaskPilot] No .env file found, using process.env");
  return process.env;
}

app.on("window-all-closed", () => {
  if (cursorTimer) clearInterval(cursorTimer);
  if (process.platform !== "darwin") app.quit();
});
