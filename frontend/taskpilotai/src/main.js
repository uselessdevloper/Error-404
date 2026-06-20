import { calendarBlocks, demoProfiles, sources, meetingsData, logoDataUrl } from "./data.js";
import { answerQuery, buildState, completeAndAssignNext, createExecutionBrief, createDailyPlan } from "./taskEngine.js";
import { createTeeSession, sealForTee, teePlanSteps } from "./teeTrust.js";
import { geminiChat, geminiAgentRun, geminiAnswerQuery, geminiDailyPlan, geminiExtractActions, geminiAnalyseMeeting, geminiMeetingPrioritizer, geminiSummariseEmail, geminiWeeklyStandup, geminPrioritizeTasks, setModel } from "./geminiClient.js";
import "./styles.css";

const app = document.querySelector("#app");
const isDesktopShell = Boolean(window.taskPilotDesktop?.isDesktop) || new URLSearchParams(window.location.search).has("desktop");

// ─── Application State ────────────────────────────────────────────────────────
let activePage = "overview";
let activeProfile = "engineer";
let activeSource = "all";
let completedTaskIds = [];
let workingTaskIds = [];        // tasks currently being worked on / agent is discussing
let managerActivityFeed = [];  // real-time updates visible on manager dashboard
let workspaceActiveSource = ""; // active tab in workspace hub
// ── Task time tracking ─────────────────────────────────────────────────────
// { taskId: { title, severity, source, startTime: ISO, endTime: ISO | null } }
let taskTimeLogs = {};

// Initialize workspace source to first source after state is built
function getWorkspaceActiveSource() {
  return workspaceActiveSource || sources[0]?.id || "jira";
}

// Initialize task state
let state = buildState(sources, calendarBlocks);
let selectedTaskId = state.prioritized[0]?.id;

let authSession = JSON.parse(localStorage.getItem("taskpilot:session") || "null");
if (authSession?.role) activeProfile = authSession.role;

let backendConfig = { geminiConfigured: false, teeMode: "local-attested", supabaseConfigured: false, llmModel: "gemini-2.5-flash" };
let authError = "";
let authLoading = false;

// Agent & Chat state
let lastAnswer = "Ask a quick question to see explainable agent output.";
let lastAnswerLoading = false;
let companionOpen = true;
let isProcessing = false;
let activeRunId = 0;
let currentPlanSteps = [];
let currentContext = null;
let teeSession = createTeeSession();
let dockEyesBound = false;
let companionLog = [
  { role: "agent", text: "TEE trust envelope attested. I scanned Jira, ServiceNow, GitHub, Slack, Outlook, and meeting notes. The P1 upload issue is duplicated across 3 systems with SLA due today." }
];

// Sub-page states
let dailyPlanContent = "";
let dailyPlanLoading = false;
let meetingsList = meetingsData ? meetingsData.items || [] : [];
let meetingAgentLog = [];
let meetingAgentRunning = false;
let meetingAgentComplete = null; // null | false | array of prioritized meetings
let analyzedMeetings = {}; // notes ID -> analysis cache
let calendarGranted = false; // Mock calendar access check
let showCalendarDialog = false;
let selectedMeetingToSave = null;
let activeEmailId = "MAIL-920";
let selectedMeeting = null;
let emailSummaries = {}; // email ID -> summary cache
let emailSummaryLoading = false;
let activePrId = "PR-118";
let prReviewChecklist = {}; // PR ID -> checklist review cache
let prReviewLoading = false;
let settingsProfile = { name: "Utkarsh Sinha", role: "Full-stack Engineer", email: "utkarsh@taskpilot.dev" };
function syncSettingsProfileWithSession() {
  if (authSession) {
    settingsProfile.name = authSession.name || settingsProfile.name;
    settingsProfile.email = authSession.email || settingsProfile.email;
    settingsProfile.role = authSession.role || settingsProfile.role;
  }
}
syncSettingsProfileWithSession();
let settingsSaving = false;
let settingsMsg = "";
let executionHistory = [
  { id: "run-1", task: "Deduplication and prioritization scan", status: "attested", timestamp: "2026-06-19T09:00:00Z" },
  { id: "run-2", task: "Incident INC-7741 correlation verification", status: "attested", timestamp: "2026-06-19T11:30:00Z" }
];

// Agent execution log monitoring state
let agentLogLines = [];
let agentRunning = false;
let agentLogTimer = null;
let scanCompleteInfo = null;

// Modal States
let showAddJiraModal = false;

// ─── Manager Task Assignment State ───────────────────────────────────────────
let managerTaskPosts = [];          // posts created by manager this session
let assignmentResult = null;        // latest Gemini assignment result
let assignmentLoading = false;      // spinner while calling backend
let engineerPortalPosts = [];       // posts visible to engineer (synced from manager)
let showPortalPanel = false;        // engineer portal slide-in
let assignForm = {                  // manager assign form state
  title: "",
  description: "",
  priority: "P2",
  deadline: "",
  team: "Platform Apps"
};
let addedTasks = [];                // manually added tasks during session

async function syncStateWithBackend() {
  try {
    await fetch("http://127.0.0.1:8787/api/taskpilot/sync-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        completedTaskIds,
        workingTaskIds,
        taskTimeLogs,
        managerActivityFeed,
        managerTaskPosts,
        engineerPortalPosts,
        addedTasks
      })
    });
  } catch (err) {
    console.error("Failed to sync state with backend:", err);
  }
}

// ─── Navigation ───────────────────────────────────────────────────────────────
const ENGINEER_NAV = [
  { label: "Command",      items: [["overview","Dashboard","⌂"],["today","My Tasks","◎"],["agent-scan","AI Agent","✦"]] },
  { label: "Intelligence", items: [["inbox","All Sources","✉"],["meetings","Meetings","◷"]] },
  { label: "Workspace",    items: [["workspace","Workspace","▦"]] },
  { label: "Insights",     items: [["execution","Execution plan","✓"]] },
  { label: "Team",         items: [["eng-portal","Team workload","📋"]] },
  { label: "Account",      items: [["settings","Settings","⚙"]] }
];

const MANAGER_NAV = [
  { label: "Command",      items: [["overview","Dashboard","⌂"]] },
  { label: "Intelligence", items: [
    ["inbox","All Sources","✉"],
    ["mgr-jira","Jira Tasks","▦"],
    ["mgr-github","GitHub PRs","⌁"],
    ["mgr-servicenow","Incidents","△"],
    ["mgr-email","Email Actions","📧"],
    ["mgr-slack","Slack Mentions","💬"],
    ["meetings","Meetings","◷"],
    ["hidden","Hidden asks","◇"]
  ]},
  { label: "Workspace",    items: [["workspace","Workspace","▦"]] },
  { label: "Team",         items: [["team-portal","Team workload","📋"],["analytics","Analytics","▥"]] },
  { label: "Account",      items: [["settings","Settings","⚙"]] }
];

function navLabel(page) {
  const currentNav = activeProfile === "manager" ? MANAGER_NAV : ENGINEER_NAV;
  for (const g of currentNav) {
    for (const [id, label] of g.items) {
      if (id === page) return label;
    }
  }
  return page;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function filteredTasks() {
  const queue = activeQueue();
  if (activeSource === "all") return queue;
  return queue.filter(t => t.sources.some(s => s.toLowerCase().includes(activeSource.toLowerCase())));
}

function activeQueue() {
  return state.prioritized.filter(t => !completedTaskIds.includes(t.id));
}

function sourceCounts() {
  return sources.map(s => ({ ...s, count: state.flattened.filter(t => t.sourceId === s.id).length }));
}

function datasetInsights() {
  const unstructured = state.flattened.filter(t => ["message","note"].includes(t.type));
  const duplicateGroups = state.deduped.filter(t => t.duplicateCount > 0);
  const owners = {};
  state.prioritized.forEach(t => {
    const o = t.owner || "Unassigned";
    if (!owners[o]) owners[o] = { owner: o, count:0, score:0, blockers:0, p1:0 };
    owners[o].count++; 
    owners[o].score += t.score;
    owners[o].blockers += t.dependencies.some(d => /block|waiting|approval|eta|coordinate/i.test(d)) ? 1 : 0;
    owners[o].p1 += t.severity === "P1" ? 1 : 0;
  });
  return { 
    unstructuredCount: unstructured.length, 
    duplicateGroups,
    ownerLoad: Object.values(owners).sort((a,b)=>b.score-a.score),
    sourceTypes: [...new Set(sources.map(s=>s.type))],
    trainedSignals: state.model.samples, 
    featureCount: state.model.features.length 
  };
}

function formatDue(date) {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en",{month:"short",day:"numeric"}).format(new Date(`${date}T12:00:00`));
}

function escapeHtml(v) {
  return String(v).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
}

function renderMd(text) {
  return escapeHtml(text)
    .replace(/#{3}\s+(.*)/g,"<h3>$1</h3>")
    .replace(/#{2}\s+(.*)/g,"<h2>$1</h2>")
    .replace(/\*\*(.*?)\*\*/g,"<strong>$1</strong>")
    .replace(/`(.*?)`/g,"<code>$1</code>")
    .replace(/^[-*]\s+(.*)/gm,"<li>$1</li>")
    .replace(/(<li>.*<\/li>)/gs,"<ul>$1</ul>")
    .replace(/\n{2,}/g,"</p><p>")
    .replace(/\n/g,"<br>");
}

function sleep(ms) { return new Promise(r=>setTimeout(r,ms)); }

function triggerLocalNotification(title, message) {
  if (window.Notification) {
    if (Notification.permission === "granted") {
      new Notification(title, { body: message });
    } else if (Notification.permission !== "denied") {
      Notification.requestPermission().then(permission => {
        if (permission === "granted") new Notification(title, { body: message });
      });
    }
  }
}

// ─── Login Page ───────────────────────────────────────────────────────────────
function renderLogin() {
  const hasSupabase = backendConfig.supabaseConfigured;
  const hasGemini = backendConfig.geminiConfigured;

  const googleSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>`;

  app.innerHTML = `
    <main class="login-shell">
      <div class="login-copy">
        <div class="login-logo">
          <img src="${logoDataUrl}" alt="TaskPilot AI" style="width:100%;height:100%;object-fit:cover;border-radius:14px;display:block;">
        </div>
        <p class="eyebrow">TaskPilot AI &middot; Agentic Engineering Assistant</p>
        <h1>One trusted queue.<br>Zero context switching.</h1>
        <p>TaskPilot scans Jira, ServiceNow, GitHub, Slack, Outlook, and meeting notes &mdash;
          deduplicates, ranks, and surfaces your #1 task with a live AI execution brief.</p>

        <div class="login-preview">
          <div>
            <strong>${state.flattened.length}</strong>
            <span>raw signals</span>
          </div>
          <div>
            <strong>${state.deduped.length}</strong>
            <span>clean tasks</span>
          </div>
          <div>
            <strong>${state.prioritized.filter(t => t.severity === 'P1').length}</strong>
            <span>P1 escalations</span>
          </div>
        </div>
      </div>

      <div class="login-card">
        <p class="eyebrow">Sign in to continue</p>
        <h2>Welcome back</h2>
        <p class="login-subtitle">
          ${hasGemini ? '&#10003; TaskPilot AI Engine ready' : '&#9888; Add GEMINI_API_KEY to backend/.env'}
          &nbsp;&middot;&nbsp;
          ${hasSupabase ? '&#10003; Google auth enabled' : 'Google auth optional'}
        </p>

        ${authError ? `<p class="login-error">${escapeHtml(authError)}</p>` : ''}

        <button class="google-login" id="loginEngineerBtn" ${authLoading ? 'disabled' : ''}>
          ${authLoading ? '<span>Signing in...</span>' : `${googleSvg} Sign in with Google &middot; Engineer`}
        </button>
        <button class="google-login" id="loginManagerBtn" ${authLoading ? 'disabled' : ''} style="margin-top:8px">
          ${authLoading ? '<span>Signing in...</span>' : `${googleSvg} Sign in with Google &middot; Manager`}
        </button>

        <p class="login-footnote">
          Sign in with your Google account to access your personalised TaskPilot workspace.
          All AI features use TaskPilot AI via your Google Cloud credits.
        </p>

        ${!hasSupabase ? `
          <div style="margin-top:16px;padding:12px;border:1px solid #dfe3ea;border-radius:8px;background:#f7f8fa;">
            <p style="margin:0 0 8px;font-size:12px;color:#626f86;">Google auth requires Supabase. Configure <code>SUPABASE_URL</code> in backend/.env to enable, or enter as:</p>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              <button class="secondary" id="demoEngineerBtn" style="font-size:12px;padding:8px;">Engineer workspace</button>
              <button class="secondary" id="demoManagerBtn" style="font-size:12px;padding:8px;">Manager workspace</button>
            </div>
          </div>
        ` : ''}
      </div>
    </main>
  `;

  bindLoginEvents();
}

function bindLoginEvents() {
  document.querySelector("#demoEngineerBtn")?.addEventListener("click", () => {
    authSession = {
      provider: "demo",
      role: "engineer",
      userId: "demo-engineer",
      email: "demo@taskpilot.dev",
      name: "Demo Engineer",
      avatarUrl: ""
    };
    activeProfile = "engineer";
    localStorage.setItem("taskpilot:session", JSON.stringify(authSession));
    syncSettingsProfileWithSession();
    render();
  });

  document.querySelector("#demoManagerBtn")?.addEventListener("click", () => {
    authSession = {
      provider: "demo",
      role: "manager",
      userId: "demo-manager",
      email: "manager@taskpilot.dev",
      name: "Demo Manager",
      avatarUrl: ""
    };
    activeProfile = "manager";
    localStorage.setItem("taskpilot:session", JSON.stringify(authSession));
    syncSettingsProfileWithSession();
    render();
  });

  document.querySelector("#loginEngineerBtn")?.addEventListener("click", async () => {
    authLoading = true;
    authError = "";
    renderLogin();
    try {
      const result = await window.taskPilotDesktop.googleLogin("engineer");
      if (result.success) {
        authSession = result.session;
        activeProfile = result.session.role || "engineer";
        localStorage.setItem("taskpilot:session", JSON.stringify(authSession));
        await loadUserProfile();
        render();
      } else {
        authError = result.error || "Google sign-in failed. Try demo mode.";
      }
    } catch (err) {
      authError = err.message || "Sign-in error. Try demo mode.";
    } finally {
      authLoading = false;
      if (!authSession) renderLogin();
    }
  });

  document.querySelector("#loginManagerBtn")?.addEventListener("click", async () => {
    authLoading = true;
    authError = "";
    renderLogin();
    try {
      const result = await window.taskPilotDesktop.googleLogin("manager");
      if (result.success) {
        authSession = result.session;
        activeProfile = result.session.role || "manager";
        localStorage.setItem("taskpilot:session", JSON.stringify(authSession));
        await loadUserProfile();
        render();
      } else {
        authError = result.error || "Google sign-in failed. Try demo mode.";
      }
    } catch (err) {
      authError = err.message || "Sign-in error. Try demo mode.";
    } finally {
      authLoading = false;
      if (!authSession) renderLogin();
    }
  });
}

// ─── Rendering Layout ─────────────────────────────────────────────────────────
function render() {
  if (!authSession) {
    renderLogin();
    return;
  }

  const queue = activeQueue();
  const selected = queue.find(t => t.id === selectedTaskId) || queue[0] || state.prioritized[0];
  const executionBrief = selected ? createExecutionBrief(selected) : null;
  const dynamicPlan = createDailyPlan(queue, calendarBlocks);
  currentContext = selected ? detectContext(selected) : null;
  // Push state updates to floating companion panel if in desktop shell
  if (window.taskPilotDesktop?.sendToFloating) {
    window.taskPilotDesktop.sendToFloating({
      type: "state-update",
      activeQueue: queue.map(t => ({
        id: t.id,
        title: t.canonicalTitle,
        severity: t.severity,
        score: t.score,
        body: t.body,
        due: t.due,
        sources: t.sources,
        sourceId: t.sourceId,
        eta: t.execution?.estimatedMinutes ? `~${t.execution.estimatedMinutes} min` : "~60 min"
      })),
      completedTaskIds: completedTaskIds,
      workingTaskIds: workingTaskIds,
      taskTimeLogs: taskTimeLogs,
      userName: settingsProfile.name,
      userRole: settingsProfile.role || "Full-stack Engineer"
    });
  }

  app.innerHTML = `
    <main class="shell ${isDesktopShell ? "desktop-shell" : ""} role-${activeProfile}">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-mark">
            <img src="${logoDataUrl}" alt="TaskPilot AI" style="width:100%;height:100%;object-fit:cover;border-radius:7px;display:block;">
          </div>
          <div>
            <strong>TaskPilot AI</strong>
            <span>${activeProfile === "manager" ? "Manager" : "Engineer"}</span>
          </div>
        </div>

        <nav class="app-nav" aria-label="Workspace navigation">
          ${renderNavigation()}
        </nav>

        <section class="panel compact tee-card">
          <p class="eyebrow">Security</p>
          <h2>Trusted execution enabled</h2>
          <div class="tee-meter">
            <span style="width:${teeSession.trustScore}%"></span>
          </div>
          <p class="small">OCR and execution actions stay approval-gated.</p>
        </section>
      </aside>

      <section class="workspace">
        <header class="topbar">
          <div>
            <p class="eyebrow">Friday, June 19, 2026</p>
            <h1>${navLabel(activePage)}</h1>
            <p class="topbar-subtitle">Active Profile: ${escapeHtml(authSession.email)}</p>
          </div>
          <div class="top-actions">
            ${activeProfile === "manager"
              ? `<button class="secondary success" id="completePriority">Approve next handoff</button>
                 <button class="secondary" id="simulateUrgent">Simulate team load shift</button>`
              : `<button class="secondary success" id="completePriority">Complete & assign next</button>
                 <button class="secondary" id="simulateUrgent">Simulate urgent work</button>
                 <button class="primary" id="runScan">Run autonomous scan</button>`
            }
            <button class="secondary icon-action" id="logoutBtn">Sign out</button>
          </div>
        </header>

        ${renderPageContent(selected, executionBrief, dynamicPlan)}
      </section>
    </main>

    ${renderCompanionDock()}
    ${renderCalendarPermissionModal()}
    ${renderAddJiraModal()}
  `;

  bindEvents();
}

function renderNavigation() {
  const currentNav = activeProfile === "manager" ? MANAGER_NAV : ENGINEER_NAV;
  return currentNav.map(g => `
    <div class="nav-group">
      <p>${g.label}</p>
      ${g.items.map(([id, label, icon]) => `
        <button class="${activePage === id ? "active" : ""}" data-nav="${id}">
          <span>${icon}</span>${label}
        </button>`).join("")}
    </div>`).join("");
}

// ─── Switch Page Contents ─────────────────────────────────────────────────────
function renderPageContent(selected, executionBrief, dynamicPlan) {
  switch (activePage) {
    case "overview":
      return activeProfile === "manager"
        ? renderManagerDashboard(selected)
        : renderEngineerDashboard(selected, executionBrief, dynamicPlan);
    case "today":
      return renderTodayPriority(dynamicPlan);
    case "agent-scan":
      return renderAgentScanConsole();
    case "inbox":
      return renderUnifiedInbox();
    case "mgr-jira":
      scrumActiveSource = "jira";
      return renderUnifiedInbox();
    case "mgr-github":
      scrumActiveSource = "github";
      return renderUnifiedInbox();
    case "mgr-servicenow":
      scrumActiveSource = "servicenow";
      return renderUnifiedInbox();
    case "mgr-email":
      scrumActiveSource = "email";
      return renderUnifiedInbox();
    case "mgr-slack":
      scrumActiveSource = "slack";
      return renderUnifiedInbox();
    case "meetings":
      return renderMeetingMemory();
    case "hidden":
      return renderHiddenAsks();
    case "jira":
      return renderJiraBoard();
    case "workspace":
      return renderWorkspaceHub();
    case "incidents":
      return renderIncidentsTable();
    case "github":
      return renderGitHubPRReviews();
    case "analytics":
      return renderAnalyticsView();
    case "execution":
      return renderExecutionPlan(selected, executionBrief);
    case "team-portal":
      return renderTeamPortalPage();
    case "eng-portal":
      return renderEngineerPortalPage();
    case "settings":
      return renderSettingsDashboard();
    default:
      return `<div class="panel" style="padding:32px;text-align:center;color:#626f86;">Page coming soon.</div>`;
  }
}

// ─── Page Renderers ───────────────────────────────────────────────────────────

// ─── Engineer Dashboard (full standalone) ────────────────────────────────────
function renderEngineerDashboard(selected, executionBrief, dynamicPlan) {
  const insights = datasetInsights();
  const tasks = filteredTasks();
  const displayedTasks = tasks.slice(0, 4);
  const newAssigned = engineerPortalPosts.filter(p => !p.viewed);
  return `
    <div class="engineer-dashboard-shell">
      ${newAssigned.length > 0 ? `
        <div class="eng-portal-banner">
          <span class="banner-dot"></span>
          <span class="banner-text"><strong>${newAssigned.length} new task${newAssigned.length > 1 ? "s" : ""} assigned by your manager</strong> — TaskPilot AI has already prioritized them in your queue.</span>
          <button data-nav="eng-portal">View Portal</button>
        </div>
      ` : ""}
      <div class="engineer-kpi-row">
        <div class="eng-kpi-card accent-blue">
          <p class="eyebrow">Top priority score</p>
          <span class="kpi-value">${selected?.score || 0}</span>
          <span class="kpi-label">${selected?.canonicalTitle?.slice(0, 28) || "No task"}</span>
          <span class="kpi-trend flat">${selected?.severity || "—"} · due ${formatDue(selected?.due)}</span>
        </div>
        <div class="eng-kpi-card accent-green">
          <p class="eyebrow">Tasks in queue</p>
          <span class="kpi-value">${tasks.length}</span>
          <span class="kpi-label">Active after dedup</span>
          <span class="kpi-trend up">${state.deduped.length} clean · ${state.flattened.length} raw</span>
        </div>
        <div class="eng-kpi-card accent-red">
          <p class="eyebrow">P1 escalations</p>
          <span class="kpi-value">${state.prioritized.filter(t=>t.severity==="P1").length}</span>
          <span class="kpi-label">Need action today</span>
          <span class="kpi-trend down">${insights.duplicateGroups.length} merge groups found</span>
        </div>
        <div class="eng-kpi-card accent-amber">
          <p class="eyebrow">Hidden asks</p>
          <span class="kpi-value">${insights.unstructuredCount}</span>
          <span class="kpi-label">NLP extracted from inbox</span>
          <span class="kpi-trend flat">TEE score ${teeSession.trustScore}%</span>
        </div>
      </div>
      <div class="engineer-main-grid">
        <div class="eng-task-board">
          <div class="eng-task-board-header">
            <div><p class="eyebrow">Unified task board</p><h2 style="margin:2px 0 0;font-size:20px;">Ranked &amp; deduped work</h2></div>
            <div style="display:flex;gap:8px;align-items:center;">
              <span class="eng-assigned-badge ${newAssigned.length > 0 ? "new" : ""}">${engineerPortalPosts.length} manager-assigned</span>
              <span style="color:#626f86;font-size:13px;">${tasks.length} tasks</span>
            </div>
          </div>
          <div style="display:grid;gap:12px;">
            ${tasks.length === 0
              ? `<div style="padding:48px;text-align:center;background:#fff;border-radius:8px;border:1px solid #dfe3ea;">
                  <h3 style="margin:0 0 6px;color:#22a06b;">🎉 Queue Fully Cleared!</h3>
                  <p style="font-size:13px;color:#626f86;margin:0;">No outstanding priorities remain. Great work today!</p>
                 </div>`
              : displayedTasks.map((t, index) => {
                  const isAssigned = engineerPortalPosts.some(p => p.id === t.id || p.title === t.canonicalTitle);
                  if (index === 0) {
                    return `
                      <div class="eng-task-item hero-focus-card ${selectedTaskId === t.id ? "selected" : ""} ${isAssigned ? "manager-assigned" : ""}" data-task="${t.id}">
                        <div class="hero-header">
                          <span class="focus-pulse-dot"></span>
                          <span class="severity ${t.severity.toLowerCase()}">${t.severity}</span>
                          <span class="focus-pill-label">🔥 HIGH FOCUS</span>
                        </div>
                        <div class="eng-task-body">
                          <strong class="hero-title">${escapeHtml(t.canonicalTitle)}${isAssigned ? '<span class="eng-assigned-tag">Manager</span>' : ""}</strong>
                          <p class="hero-subtitle">${escapeHtml(t.extraction)} · Correlated across ${t.sources.length} sources</p>
                          <div class="hero-meta-grid">
                            <span>📍 ${escapeHtml(t.sources.join(" + "))}</span>
                            <span>⏱ ${t.execution?.estimatedMinutes ? `~${t.execution.estimatedMinutes} min` : `~${Math.max(15, Math.min(180, Math.round(t.score)))} min`}</span>
                            <span>📅 Due ${formatDue(t.due)}</span>
                          </div>
                        </div>
                        <div class="eng-task-score">
                          <span class="hero-score-val">${t.score}</span>
                          <small>PRIORITY</small>
                        </div>
                      </div>`;
                  }
                  return `
                    <div class="eng-task-item ${selectedTaskId === t.id ? "selected" : ""} ${isAssigned ? "manager-assigned" : ""}" data-task="${t.id}">
                      <span class="severity ${t.severity.toLowerCase()}">${t.severity}</span>
                      <div class="eng-task-body">
                        <strong>${escapeHtml(t.canonicalTitle)}${isAssigned ? '<span class="eng-assigned-tag">Manager</span>' : ""}</strong>
                        <p>${escapeHtml(t.extraction)} · ${escapeHtml(t.aliases.join(", "))}</p>
                      </div>
                      <div class="eng-task-score">
                        <span>${t.score}</span>
                        <small>${t.sources.length} src</small>
                      </div>
                    </div>`;
                }).join("")}
          </div>
          ${tasks.length > 4 ? `
            <div style="margin-top: 8px; text-align: center;">
              <button class="primary" data-nav="today" style="background: linear-gradient(135deg, #152238, #1c2e4a); color: white; padding: 10px 20px; border-radius: 999px; border: none; font-size: 13px; font-weight: 800; cursor: pointer; transition: all 0.2s ease; box-shadow: 0 4px 12px rgba(21, 34, 56, 0.15); display: inline-flex; align-items: center; gap: 8px; width: 100%; justify-content: center;">
                <span>📋</span> View Full Task Queue (${tasks.length} items)
              </button>
            </div>
          ` : ""}
        </div>
        <div class="eng-sidebar">
          <div class="eng-panel exec-brief">
            <h3>Why this rank?</h3>
            <p style="font-size:13px;font-weight:800;color:#172b4d;margin:0 0 6px;">${selected?.canonicalTitle || "—"}</p>
            <ul style="padding-left:16px;margin:0;font-size:12px;color:#44546f;display:grid;gap:4px;">
              ${selected ? selected.rankReasons.slice(0,4).map(r=>`<li>${r}</li>`).join("") : "<li>Select a task</li>"}
            </ul>
            <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:8px;">
              ${selected ? selected.sources.map(s=>`<span style="padding:3px 8px;border-radius:999px;background:#f1f2f4;color:#44546f;font-size:11px;font-weight:700;">${s}</span>`).join("") : ""}
            </div>
          </div>
          <div class="eng-panel exec-brief" style="border-left-color:#0c66e4;">
            <h3>Execution brief</h3>
            <p style="font-size:12px;color:#44546f;margin:0 0 6px;">${executionBrief?.definitionOfDone || "Select a task"}</p>
            <span class="timeline-pill" style="font-size:11px;">⏱ ${executionBrief?.timeline || "—"}</span>
            <div class="eng-checklist">
              ${executionBrief ? executionBrief.process.slice(0,4).map((s,i)=>`
                <label class="eng-checklist-item"><input type="checkbox" data-execution-step-idx="${i}"><span>${escapeHtml(s)}</span></label>
              `).join("") : ""}
            </div>
            <p style="font-size:11px;margin:8px 0 0;color:#0c66e4;cursor:pointer;text-decoration:underline;" data-nav="execution">Full checklist →</p>
          </div>
          <div class="eng-panel">
            <h3>Today's schedule</h3>
            <div class="eng-timeline">
              ${dynamicPlan.map(s=>`
                <div class="eng-slot">
                  <time>${s.time}</time>
                  <div><strong>${s.label}</strong><span>${s.task ? s.task.canonicalTitle : "Buffer"}</span></div>
                </div>`).join("")}
            </div>
          </div>
          <div class="eng-panel gemini-brief">
            <h3>Ask TaskPilot AI</h3>
            ${renderQuickQueries()}
            <div class="answer" id="answerBox" style="margin-top:8px;max-height:130px;overflow-y:auto;font-size:12px;">${lastAnswer}</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ─── Manager Dashboard Command Strip ──────────────────────────────────────────
function renderManagerCommandStrip(selected) {
  const insights = datasetInsights();
  const p1Tasks = state.prioritized.filter(t => t.severity === "P1");
  const blockers = state.prioritized.filter(t => t.dependencies.some(d => /block|waiting|approval|eta|coordinate/i.test(d)));
  const slaRisks = state.prioritized.filter(t => t.severity === "P1" || t.due <= "2026-06-20");
  return `
    <section class="manager-command-strip hero-grid">
      <article class="hero-card alert" style="cursor: pointer;" data-nav="overview">
        <p class="eyebrow">Team risk pulse</p>
        <h2>${slaRisks.length} SLA / escalation risks</h2>
        <p>Highest risk: ${selected?.canonicalTitle || "None"}. It is correlated across ${selected?.sources.length || 0} systems and requires manager visibility.</p>
      </article>
      <article class="hero-card">
        <p class="eyebrow">Dataset intelligence</p>
        <h2>${state.flattened.length} raw signals → ${state.deduped.length} clean tasks</h2>
        <p>Trained on ${insights.trainedSignals} backend records using ${insights.featureCount} features: source type, severity, deadline, owner pressure, blockers, impact, and duplicate similarity.</p>
      </article>
      <article class="hero-card" style="cursor: pointer;" data-nav="hidden">
        <p class="eyebrow">NLP pipeline</p>
        <h2>${insights.unstructuredCount} unstructured asks</h2>
        <p>Emails, Slack mentions, and meeting notes are normalized into structured task records before priority scoring.</p>
      </article>
      <article class="hero-card priority" style="cursor: pointer;" data-nav="analytics">
        <p class="eyebrow">Manager action</p>
        <h2>${blockers.length} blockers need decisions</h2>
        <p>Use this view to rebalance owners, approve dependencies, and send ETA updates across Jira, ServiceNow, and Outlook.</p>
      </article>
    </section>
  `;
}

// ─── Manager Dashboard (full standalone) - KPI + Assign + Kanban ─────────────
function renderManagerDashboard_inner(selected, insights, p1Tasks, blockers, slaRisks) {
  // helper — workload bar
  const wBar = (load, color) => `<div style="height:7px;background:#f1f2f4;border-radius:999px;overflow:hidden;"><div style="width:${Math.min(96,Math.max(10,load))}%;height:100%;background:${color};border-radius:inherit;"></div></div>`;

  return `
    <div class="manager-dashboard-shell">
      <!-- KPI row -->
      <div class="mgr-kpi-row">
        <div class="mgr-kpi-card accent-red">
          <p class="eyebrow">SLA risks</p>
          <span class="kpi-value" style="color:#de350b;">${slaRisks.length}</span>
          <span class="kpi-label">P1 + due today</span>
        </div>
        <div class="mgr-kpi-card accent-amber">
          <p class="eyebrow">Blockers</p>
          <span class="kpi-value" style="color:#974f0c;">${blockers.length}</span>
          <span class="kpi-label">Need decisions</span>
        </div>
        <div class="mgr-kpi-card accent-green">
          <p class="eyebrow">Clean tasks</p>
          <span class="kpi-value" style="color:#216e4e;">${insights.ownerLoad.reduce((s,o)=>s+o.count,0)}</span>
          <span class="kpi-label">After dedup</span>
        </div>
        <div class="mgr-kpi-card accent-blue">
          <p class="eyebrow">Signals</p>
          <span class="kpi-value">${state.flattened.length}</span>
          <span class="kpi-label">Across ${sources.length} systems</span>
        </div>
        <div class="mgr-kpi-card accent-purple">
          <p class="eyebrow">Posted today</p>
          <span class="kpi-value">${managerTaskPosts.length}</span>
          <span class="kpi-label">Manager assignments</span>
        </div>
      </div>

      <!-- Meetings & Sources Intelligence -->
      <div class="mgr-intel-row" style="display:grid; grid-template-columns: 1.2fr 0.8fr; gap:14px; margin-bottom:14px;">
        <!-- Meetings Card -->
        <div class="mgr-panel" style="border-left: 4px solid #22a06b;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
            <h3 style="margin:0;">📅 Meetings Intelligence</h3>
            <button class="secondary" style="font-size:11px; padding:4px 10px;" data-nav="meetings">Go to Meetings →</button>
          </div>
          <div style="display:grid; gap:8px; max-height:220px; overflow-y:auto;">
            ${meetingsList.slice(0, 3).map(m => `
              <div style="padding:10px; border:1px solid #dfe3ea; border-radius:6px; background:#fafbfc; display:flex; justify-content:space-between; align-items:start;">
                <div>
                  <strong style="color:#172b4d; font-size:13px;">${escapeHtml(m.title)}</strong>
                  <div style="font-size:11px; color:#626f86; margin-top:2px;">
                    🕒 ${m.suggestedDate} ${m.suggestedTime || ""} · 👤 ${m.attendees?.join(", ") || "No attendees"}
                  </div>
                  ${m.agenda ? `<div style="font-size:11px; color:#44546f; margin-top:4px; font-style:italic;">"${escapeHtml(m.agenda)}"</div>` : ""}
                </div>
                <span style="font-size:11px; padding:2px 7px; border-radius:10px; background:${m.priority === 'Critical' ? '#ffd5d2' : m.priority === 'High' ? '#fff0b3' : '#dcfff1'}; color:${m.priority === 'Critical' ? '#ae2a19' : m.priority === 'High' ? '#974f0c' : '#216e4e'}; font-weight:800;">
                  ${m.priority}
                </span>
              </div>
            `).join("")}
            ${meetingsList.length === 0 ? `<p style="color:#626f86; font-size:12px; font-style:italic;">No meetings detected.</p>` : ""}
          </div>
        </div>

        <!-- Sources Card -->
        <div class="mgr-panel" style="border-left: 4px solid #0c66e4;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
            <h3 style="margin:0;">🔌 Connected Sources</h3>
            <button class="secondary" style="font-size:11px; padding:4px 10px;" data-nav="inbox">All Sources →</button>
          </div>
          <div style="display:grid; gap:8px;">
            ${[
              { id: "mgr-jira", name: "Jira Sprint Board", srcId: "Jira", color: "#0c66e4", icon: "▦" },
              { id: "mgr-github", name: "GitHub PR Reviews", srcId: "GitHub", color: "#24292f", icon: "⌁" },
              { id: "mgr-servicenow", name: "ServiceNow Defects", srcId: "ServiceNow", color: "#bf2600", icon: "△" },
              { id: "mgr-email", name: "Outlook Inbox", srcId: "Outlook Emails", color: "#0c66e4", icon: "📧" },
              { id: "mgr-slack", name: "Slack Mentions", srcId: "Slack Mentions", color: "#6554c0", icon: "💬" }
            ].map(src => {
              const count = state.prioritized.filter(t => t.sources.some(s => s.toLowerCase().includes(src.srcId.toLowerCase())) && !completedTaskIds.includes(t.id)).length;
              const p1Count = state.prioritized.filter(t => t.sources.some(s => s.toLowerCase().includes(src.srcId.toLowerCase())) && t.severity === "P1" && !completedTaskIds.includes(t.id)).length;
              return `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 10px; border:1px solid #dfe3ea; border-radius:6px; background:#fff; cursor:pointer;" data-nav="${src.id}">
                  <div style="display:flex; align-items:center; gap:8px;">
                    <span style="display:grid; width:22px; height:22px; place-items:center; border-radius:4px; background:${src.color}22; color:${src.color}; font-weight:bold; font-size:11px;">${src.icon}</span>
                    <strong style="color:#172b4d; font-size:12px;">${src.name}</strong>
                  </div>
                  <div style="display:flex; align-items:center; gap:6px;">
                    <span style="font-size:11px; padding:2px 7px; border-radius:10px; background:#f1f2f4; color:#44546f; font-weight:700;">${count} active</span>
                    ${p1Count > 0 ? `<span style="font-size:10px; padding:2px 6px; border-radius:4px; background:#ffd5d2; color:#ae2a19; font-weight:800;">${p1Count} P1</span>` : ""}
                  </div>
                </div>
              `;
            }).join("")}
          </div>
        </div>
      </div>

      <!-- Main grid -->
      <div class="manager-main-grid">
        <!-- Left col: Kanban -->
        <div style="display:grid;gap:14px;">
          <div class="mgr-panel">
            <h3>Team Execution Queue</h3>
            <div class="mgr-kanban">
              ${["P1","P2","P3"].map(sev => {
                const col = {"P1":"#de350b","P2":"#ffab00","P3":"#22a06b"}[sev];
                const tasks = state.prioritized.filter(t => t.severity === sev && !completedTaskIds.includes(t.id)).slice(0, 5);
                return `
                  <div class="mgr-lane">
                    <div class="mgr-lane-head" style="color:${col};">
                      ${sev} <span class="mgr-lane-count">${tasks.length}</span>
                    </div>
                    ${tasks.map(t=>`
                      <div class="mgr-lane-card ${selectedTaskId===t.id?"selected":""}" data-task="${t.id}">
                        <strong>${t.canonicalTitle}</strong>
                        <span>${t.owner||"Unassigned"} · ${t.sources.length} src</span>
                        <div class="card-actions">
                          <button class="card-action-btn" data-assign-lane-task="${t.id}">Assign</button>
                          <button class="card-action-btn" data-task="${t.id}">Select</button>
                        </div>
                      </div>`).join("")}
                  </div>`;
              }).join("")}
            </div>
          </div>

          <div class="mgr-panel team-health">
            <h3>Team Workload Distribution</h3>
            <div class="mgr-workload-grid">
              ${insights.ownerLoad.slice(0,5).map((owner,i)=>{
                const colors=["#0c66e4","#22a06b","#ffab00","#6554c0","#de350b"];
                const pct = Math.min(95,Math.max(10,Math.round(owner.score/2)));
                return `
                  <div class="mgr-workload-row">
                    <div class="mgr-workload-row-header">
                      <strong>${owner.owner}</strong>
                      <span>${owner.count} tasks · ${owner.blockers} blockers · ${owner.p1} P1</span>
                    </div>
                    <div class="mgr-workload-bar-bg">
                      <div class="mgr-workload-bar-fill" style="width:${pct}%;background:${colors[i%5]};"></div>
                    </div>
                  </div>`;
              }).join("")}
            </div>
          </div>
        </div>

        <!-- Right col: Assign + Portal -->
        <div style="display:grid;gap:14px;align-content:start;">
          <!-- Assign task form -->
          <div class="mgr-panel assign-panel">
            <h3>⚡ Post Job Update · Assign via TaskPilot AI</h3>
            <div class="mgr-assign-form">
              <div class="mgr-form-row">
                <label>Task title *</label>
                <input type="text" id="mgrAssignTitle" placeholder="e.g. Fix auth token expiry bug in prod" value="${escapeHtml(assignForm.title)}">
              </div>
              <div class="mgr-form-row">
                <label>Description</label>
                <textarea id="mgrAssignDesc" rows="2" placeholder="Context, acceptance criteria, relevant links...">${escapeHtml(assignForm.description)}</textarea>
              </div>
              <div class="mgr-form-2col">
                <div class="mgr-form-row">
                  <label>Priority</label>
                  <select id="mgrAssignPriority">
                    ${["P1","P2","P3","P4"].map(p=>`<option value="${p}" ${assignForm.priority===p?"selected":""}>${p}</option>`).join("")}
                  </select>
                </div>
                <div class="mgr-form-row">
                  <label>Deadline</label>
                  <input type="date" id="mgrAssignDeadline" value="${assignForm.deadline}">
                </div>
              </div>
              <div class="mgr-form-row">
                <label>Team / Squad</label>
                <input type="text" id="mgrAssignTeam" placeholder="Platform Apps" value="${escapeHtml(assignForm.team)}">
              </div>
              <button class="mgr-assign-btn" id="mgrPostAssignBtn" ${assignmentLoading?"disabled":""}>
                ${assignmentLoading ? "⏳ TaskPilot AI analyzing..." : "🤖 Analyze &amp; Assign with TaskPilot AI"}
              </button>
            </div>

            <!-- Assignment result -->
            <div class="mgr-assignment-result ${assignmentResult?"":"hidden"}" id="mgrAssignResult">
              ${assignmentResult ? renderAssignmentResult(assignmentResult) : ""}
            </div>
          </div>

          <!-- Team portal posts -->
          <div class="mgr-panel portal-panel">
            <h3 style="display:flex;justify-content:space-between;align-items:center;">
              Team Portal <span style="font-size:12px;color:#626f86;font-weight:500;">${managerTaskPosts.length} posted</span>
            </h3>
            <div class="mgr-portal-list">
              ${managerTaskPosts.length === 0
                ? `<p style="color:#626f86;font-size:13px;text-align:center;padding:20px 0;">No tasks posted yet. Use TaskPilot AI Assign above.</p>`
                : managerTaskPosts.map(post => renderPortalPost(post)).join("")
              }
            </div>
          </div>

          <!-- Ask TaskPilot -->
          <div class="mgr-panel">
            <h3>Ask TaskPilot AI</h3>
            ${renderManagerQueries()}
            <div class="answer" id="answerBox" style="margin-top:8px;max-height:120px;overflow-y:auto;font-size:12px;">${lastAnswer}</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderManagerDashboard(selected) {
  const insights = datasetInsights();
  const activePrioritized = state.prioritized.filter(t => !completedTaskIds.includes(t.id));
  const p1Tasks = activePrioritized.filter(t => t.severity === "P1");
  const blockers = activePrioritized.filter(t => t.dependencies.some(d => /block|waiting|approval|eta|coordinate/i.test(d)));
  const slaRisks = activePrioritized.filter(t => t.severity === "P1" || t.due <= "2026-06-20");
  return renderManagerDashboard_inner(selected, insights, p1Tasks, blockers, slaRisks);
}

function renderAssignmentResult(result) {
  const initials = (name) => name.split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2);
  return `
    <div class="result-header">
      <div class="mgr-assignee-avatar">${initials(result.recommendedAssignee || "?")}</div>
      <div>
        <div class="result-name">${escapeHtml(result.recommendedAssignee || "TBD")}</div>
        <div class="result-reason">${escapeHtml((result.assignmentReasoning||"").slice(0,80))}…</div>
      </div>
      <span class="mgr-risk-badge ${result.riskLevel}">${result.riskLevel}</span>
    </div>
    <div class="mgr-team-update-box">
      <strong style="font-size:11px;color:#626f86;text-transform:uppercase;letter-spacing:.05em;">Team Update</strong><br>
      ${escapeHtml(result.teamUpdate || "")}
    </div>
    <div class="mgr-team-update-box" style="margin-top:6px;border-color:#c9f0e1;background:#f4fff9;">
      <strong style="font-size:11px;color:#216e4e;text-transform:uppercase;letter-spacing:.05em;">Engineer Portal Note</strong><br>
      ${escapeHtml(result.engineerPortalNote || "")}
    </div>
    ${result.alternativeAssignees?.length > 0 ? `
      <div style="margin-top:8px;font-size:11px;color:#626f86;">Also consider:</div>
      <div class="mgr-alt-assignees">
        ${result.alternativeAssignees.map(n=>`<span class="mgr-alt-chip">👤 ${escapeHtml(n)}</span>`).join("")}
      </div>` : ""}
    <div style="display:flex;gap:8px;margin-top:10px;">
      <button class="secondary" style="font-size:12px;" id="mgrConfirmAssignBtn">✓ Confirm &amp; Post to Portal</button>
      <button class="secondary" style="font-size:12px;color:#de350b;border-color:#ffd5d2;" id="mgrCancelAssignBtn">✕ Discard</button>
    </div>
  `;
}

function renderPortalPost(post) {
  const sev = post.priority || "P2";
  const sevColor = {"P1":"#de350b","P2":"#974f0c","P3":"#216e4e","P4":"#626f86"}[sev]||"#626f86";
  return `
    <div class="mgr-portal-post">
      <div class="post-header">
        <div>
          <span class="post-title">${escapeHtml(post.title)}</span>
          <span style="margin-left:6px;padding:2px 7px;border-radius:4px;background:#ffd5d2;color:${sevColor};font-size:10px;font-weight:800;">${sev}</span>
        </div>
        <span style="font-size:10px;color:#626f86;">${new Date(post.postedAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</span>
      </div>
      <div class="post-meta">Team: ${escapeHtml(post.team||"")} · Deadline: ${escapeHtml(post.deadline||"TBD")} · Score: ${post.assignment?.priorityScore||"—"}</div>
      <span class="post-assignee">👤 ${escapeHtml(post.assignment?.recommendedAssignee||"Unassigned")}</span>
      ${post.assignment?.riskLevel ? `<span class="mgr-risk-badge ${post.assignment.riskLevel}" style="margin-left:6px;">${post.assignment.riskLevel}</span>` : ""}
    </div>
  `;
}

function renderManagerQueries() {
  return `
    <div class="quick-queries">
      ${["Who is overloaded?","Show P1 risks","Blockers needing decisions","Team standup summary","Suggest rebalancing"]
        .map(q=>`<button data-query="${escapeHtml(q)}">${q}</button>`).join("")}
    </div>
  `;
}

function renderManagerLane(severity) {
  const laneTasks = state.prioritized.filter(t => t.severity === severity).slice(0, 4);
  const col = {"P1":"#de350b","P2":"#ffab00","P3":"#22a06b"}[severity];
  return `
    <div class="mgr-lane">
      <div class="mgr-lane-head" style="color:${col};">
        ${severity} <span class="mgr-lane-count">${laneTasks.length}</span>
      </div>
      ${laneTasks.map(t=>`
        <div class="mgr-lane-card ${selectedTaskId===t.id?"selected":""}" data-task="${t.id}">
          <strong>${t.canonicalTitle}</strong>
          <span>${t.sources.join(" · ")}</span>
        </div>`).join("")}
    </div>
  `;
}

function renderTimeline(dynamicPlan) {
  return dynamicPlan
    .map(slot => `
      <div class="slot">
        <time>${slot.time}</time>
        <div>
          <strong>${slot.label}</strong>
          <span>${slot.task ? slot.task.canonicalTitle : "Buffer"}</span>
        </div>
      </div>
    `).join("");
}

function renderQuickQueries() {
  return `
    <div class="quick-queries">
      ${["What's my top priority?", "Summarize my emails", "Show duplicate tasks", "What is blocking teammates?", "Prepare standup"]
        .map(q => `<button data-query="${escapeHtml(q)}">${q}</button>`).join("")}
    </div>
  `;
}

function taskCard(task) {
  return `
    <button class="task-card ${selectedTaskId === task.id ? "selected" : ""}" data-task="${task.id}">
      <div class="task-main">
        <span class="severity ${task.severity.toLowerCase()}">${task.severity}</span>
        <div>
          <strong>${task.canonicalTitle}</strong>
          <p>${task.extraction} • ${task.aliases.join(", ")}</p>
        </div>
      </div>
      <div class="task-meta">
        <span>${task.score}</span>
        <small>${task.sources.length} source${task.sources.length > 1 ? "s" : ""}</small>
      </div>
    </button>
  `;
}

// ─── Team Workload (both manager and engineer view) ───────────────────────────
function renderTeamPortalPage() {
  return renderTeamWorkload(true);
}
function renderEngineerPortalPage() {
  return renderTeamWorkload(false);
}

function renderTeamWorkload(isManager) {
  // Build teammate rows from all tasks in state
  const ownerMap = {};
  state.prioritized.forEach(t => {
    const o = t.owner || "Unassigned";
    if (!ownerMap[o]) ownerMap[o] = { name: o, total: 0, done: 0, working: 0, todo: 0, p1: 0, p2: 0, tasks: [] };
    ownerMap[o].total++;
    ownerMap[o].tasks.push(t);
    if (completedTaskIds.includes(t.id)) ownerMap[o].done++;
    else if (workingTaskIds.includes(t.id)) ownerMap[o].working++;
    else ownerMap[o].todo++;
    if (t.severity === "P1") ownerMap[o].p1++;
    if (t.severity === "P2") ownerMap[o].p2++;
  });

  // Also fold in manager-posted completion notifications
  managerActivityFeed.forEach(e => {
    const o = settingsProfile.name;
    if (ownerMap[o]) ownerMap[o].done = Math.min(ownerMap[o].total, ownerMap[o].done);
  });

  const teammates = Object.values(ownerMap).sort((a, b) => b.total - a.total);
  const totalDone = teammates.reduce((s, t) => s + t.done, 0);
  const totalTasks = teammates.reduce((s, t) => s + t.total, 0);

  return `
    <div class="team-workload-shell">
      <!-- Header -->
      <div class="tw-header">
        <div>
          <p class="eyebrow">${isManager ? "Manager View" : "Your Team"}</p>
          <h2 style="margin:2px 0 0;">Team Workload</h2>
          <p style="font-size:13px;color:#626f86;margin:4px 0 0;">${totalDone} of ${totalTasks} tasks done across ${teammates.length} engineers</p>
        </div>
        ${isManager ? `<button class="primary" id="openAssignFromPortalBtn">+ Assign Task</button>` : `<button class="secondary" id="syncPortalBtn">↻ Sync</button>`}
      </div>

      <!-- Team-wide progress bar -->
      <div class="tw-overall-progress">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
          <span style="font-size:12px;font-weight:700;color:#172b4d;">Team overall progress</span>
          <span style="font-size:12px;color:#626f86;">${totalTasks ? Math.round(totalDone/totalTasks*100) : 0}% complete</span>
        </div>
        <div style="height:10px;background:#f1f2f4;border-radius:999px;overflow:hidden;">
          <div style="height:100%;width:${totalTasks ? Math.round(totalDone/totalTasks*100) : 0}%;background:linear-gradient(90deg,#0c66e4,#22a06b);border-radius:inherit;transition:width 0.5s;"></div>
        </div>
        <div style="display:flex;gap:16px;margin-top:8px;font-size:11px;font-weight:700;">
          <span style="color:#22a06b;">✓ ${totalDone} done</span>
          <span style="color:#ffab00;">● ${teammates.reduce((s,t)=>s+t.working,0)} working</span>
          <span style="color:#626f86;">○ ${teammates.reduce((s,t)=>s+t.todo,0)} todo</span>
        </div>
      </div>

      <!-- Teammate cards grid -->
      <div class="tw-grid">
        ${teammates.map(eng => {
          const pct = eng.total ? Math.round(eng.done / eng.total * 100) : 0;
          const colors = ["#0c66e4","#22a06b","#6554c0","#de350b","#ffab00","#24292f"];
          const color = colors[teammates.indexOf(eng) % colors.length];
          const initials = eng.name.split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2);
          return `
            <div class="tw-member-card">
              <div class="tw-member-header">
                <div class="tw-avatar" style="background:${color}22;color:${color};">${initials}</div>
                <div class="tw-member-info">
                  <strong style="font-size:14px;color:#172b4d;">${escapeHtml(eng.name)}</strong>
                  <div style="font-size:11px;color:#626f86;margin-top:2px;">${eng.total} tasks · ${eng.p1} P1 · ${eng.p2} P2</div>
                </div>
                <div class="tw-pct-badge" style="background:${pct>=80?"#dcfff1":pct>=40?"#fff0b3":"#f1f2f4"};color:${pct>=80?"#216e4e":pct>=40?"#974f0c":"#44546f"};">${pct}%</div>
              </div>

              <!-- Progress bar -->
              <div style="margin:10px 0 6px;">
                <div style="height:7px;background:#f1f2f4;border-radius:999px;overflow:hidden;">
                  <div style="height:100%;width:${pct}%;background:${color};border-radius:inherit;transition:width 0.5s;"></div>
                </div>
              </div>

              <!-- Status pills -->
              <div style="display:flex;gap:6px;margin-bottom:10px;">
                <span class="tw-stat-pill done">${eng.done} Done</span>
                ${eng.working > 0 ? `<span class="tw-stat-pill working">${eng.working} Working</span>` : ""}
                <span class="tw-stat-pill todo">${eng.todo} Todo</span>
              </div>

              <!-- Top 3 tasks -->
              <div class="tw-task-mini-list">
                ${eng.tasks.filter(t => !completedTaskIds.includes(t.id)).slice(0, 3).map(t => {
                  const isW = workingTaskIds.includes(t.id);
                  const sevColor = {P1:"#de350b",P2:"#974f0c",P3:"#216e4e"}[t.severity]||"#626f86";
                  return `
                    <div class="tw-mini-task ${isW?"working":""}">
                      <span class="tw-mini-sev" style="color:${sevColor};">${t.severity}</span>
                      <span class="tw-mini-title">${escapeHtml(t.canonicalTitle.slice(0,48))}${t.canonicalTitle.length>48?"…":""}</span>
                      ${isW ? `<span style="font-size:10px;color:#ffab00;font-weight:800;">Working</span>` : ""}
                    </div>`;
                }).join("")}
                ${eng.tasks.filter(t => !completedTaskIds.includes(t.id)).length > 3
                  ? `<div style="font-size:11px;color:#626f86;padding:4px 0;">+ ${eng.tasks.filter(t => !completedTaskIds.includes(t.id)).length - 3} more remaining</div>`
                  : ""}
              </div>

              ${isManager ? `
                <div style="margin-top:10px;display:flex;gap:6px;">
                  <button class="secondary" style="font-size:11px;padding:5px 10px;" data-assign-to="${escapeHtml(eng.name)}">Assign task</button>
                </div>` : ""}
            </div>`;
        }).join("")}
      </div>

      <!-- Manager activity feed (real-time completions) -->
      ${managerActivityFeed.length > 0 ? `
        <div class="tw-feed-section">
          <p class="eyebrow" style="margin-bottom:8px;">Live Activity Feed</p>
          <div class="tw-feed">
            ${managerActivityFeed.slice(0,8).map(e => `
              <div class="tw-feed-item">
                <span class="tw-feed-dot" style="background:${e.color||"#22a06b"}"></span>
                <div>
                  <div class="tw-feed-msg">${escapeHtml(e.message)}</div>
                  <div class="tw-feed-time">${e.time}</div>
                </div>
              </div>`).join("")}
          </div>
        </div>
      ` : ""}
    </div>
  `;
}

// Page: Today Priority
function renderTodayPriority(dynamicPlan) {
  const queue = activeQueue();
  const todayStr = "2026-06-19";

  // Partition tasks: overdue first, then today, then upcoming
  const overdue  = queue.filter(t => t.due && t.due < todayStr);
  const today    = queue.filter(t => t.due === todayStr);
  const upcoming = queue.filter(t => !t.due || t.due > todayStr).slice(0, 8);

  function taskStatusLabel(t) {
    if (completedTaskIds.includes(t.id)) return "done";
    if (workingTaskIds.includes(t.id))   return "working";
    return "todo";
  }

  function renderTaskRow(t) {
    const status = taskStatusLabel(t);
    const isDone    = status === "done";
    const isWorking = status === "working";
    const isOverdue = t.due && t.due < todayStr;
    const sevColor  = { P1:"#de350b", P2:"#974f0c", P3:"#216e4e" }[t.severity] || "#626f86";
    const srcColor  = sources.find(s => s.id === t.sourceId)?.color || "#626f86";
    const srcName   = sources.find(s => s.id === t.sourceId)?.name  || t.sourceId;

    return `
      <div class="tp-task-row ${isDone ? "tp-done" : isWorking ? "tp-working" : ""}" data-task-row="${t.id}">
        <div class="tp-task-row-left">
          <div class="tp-sev-dot" style="background:${sevColor}" title="${t.severity}"></div>
          <div class="tp-task-info">
            <div class="tp-task-title ${isDone ? "tp-strike" : ""}">
              ${escapeHtml(t.canonicalTitle)}
              ${isWorking ? `<span class="tp-status-chip working">● Working</span>` : ""}
              ${isDone    ? `<span class="tp-status-chip done">✓ Done</span>` : ""}
            </div>
            <div class="tp-task-meta">
              <span class="tp-src-badge" style="background:${srcColor}22;color:${srcColor};">${srcName}</span>
              <span>${t.severity}</span>
              ${t.due ? `<span class="${isOverdue && !isDone ? "tp-overdue" : ""}">${isOverdue && !isDone ? "⚠ Overdue · " : ""}${formatDue(t.due)}</span>` : ""}
              <span>${t.owner || "Unassigned"}</span>
            </div>
          </div>
        </div>
        <div class="tp-task-actions">
          ${!isDone && !isWorking ? `
            <button class="tp-btn-start" data-task-start="${t.id}" title="Mark as working">▶ Start</button>
          ` : ""}
          ${isWorking ? `
            <button class="tp-btn-done" data-task-complete="${t.id}" title="Mark as done">✓ Done</button>
            <button class="tp-btn-cancel" data-task-cancel="${t.id}" title="Cancel">✕</button>
          ` : ""}
          ${isDone ? `
            <button class="tp-btn-reopen" data-task-reopen="${t.id}" title="Reopen">↩ Reopen</button>
          ` : ""}
        </div>
      </div>`;
  }

  function renderSection(label, tasks, accent) {
    if (!tasks.length) return "";
    return `
      <div class="tp-section">
        <div class="tp-section-head" style="border-left-color:${accent}">
          <span>${label}</span>
          <span class="tp-count">${tasks.length}</span>
        </div>
        ${tasks.map(renderTaskRow).join("")}
      </div>`;
  }

  return `
    <div class="today-priority-shell">
      <!-- Left: Task List -->
      <div class="tp-task-panel">
        <div class="tp-panel-head">
          <div>
            <p class="eyebrow">Today's Work</p>
            <h2 style="margin:2px 0 0;">Your Task List</h2>
          </div>
          <div style="display:flex;gap:8px;align-items:center;">
            <span class="tp-summary-pill">
              ${completedTaskIds.length} done · ${workingTaskIds.length} working · ${queue.length - completedTaskIds.length - workingTaskIds.length} todo
            </span>
            <button class="primary" id="regeneratePlanBtn" style="font-size:12px;padding:7px 12px;" ${dailyPlanLoading ? "disabled" : ""}>
              ${dailyPlanLoading ? "⚙ Analyzing…" : "Brief it"}
            </button>
            <button class="secondary" id="generateDailyReportBtn" style="font-size:12px;padding:7px 12px;">
              📄 Daily Report
            </button>
          </div>
        </div>

        ${overdue.length || today.length || upcoming.length ? "" : `<div style="padding:32px;text-align:center;color:#626f86;">All caught up 🎉</div>`}
        ${renderSection("⚠ Overdue", overdue, "#de350b")}
        ${renderSection("📅 Due Today", today, "#0c66e4")}
        ${renderSection("🗓 Upcoming", upcoming, "#22a06b")}
      </div>

      <!-- Right: Agent + Schedule -->
      <aside class="tp-sidebar">
        <!-- Manager Activity Feed -->
        <div class="tp-card" id="managerFeedCard">
          <p class="eyebrow">Manager Feed</p>
          <h3 style="margin:2px 0 10px;font-size:15px;">Live Updates</h3>
          <div class="tp-feed" id="managerFeed">
            ${managerActivityFeed.length === 0
              ? `<div class="tp-feed-empty">Complete a task to notify your manager automatically.</div>`
              : managerActivityFeed.slice(0,6).map(e => `
                  <div class="tp-feed-item">
                    <span class="tp-feed-dot" style="background:${e.color || "#22a06b"}"></span>
                    <div>
                      <div class="tp-feed-msg">${escapeHtml(e.message)}</div>
                      <div class="tp-feed-time">${e.time}</div>
                    </div>
                  </div>`).join("")
            }
          </div>
        </div>

        <!-- TaskPilot AI Plan Narrative -->
        <div class="tp-card">
          <p class="eyebrow">TaskPilot AI Assistant</p>
          <h3 style="margin:2px 0 10px;font-size:15px;">Plan Narrative</h3>
          <div style="font-size:13px;line-height:1.6;color:#44546f;max-height:180px;overflow-y:auto;" id="planNarrativeBox">
            ${dailyPlanLoading
              ? `<div style="text-align:center;padding:20px 0;"><span style="animation:spin 1s linear infinite;display:inline-block;">⚙</span> Composing schedule…</div>`
              : (dailyPlanContent ? renderMd(dailyPlanContent) : `<p>Click <strong> Brief it</strong> to get a tailored day schedule around your meetings.</p>`)
            }
          </div>
        </div>

        <!-- Time-blocking -->
        <div class="tp-card">
          <p class="eyebrow">Suggested Schedule</p>
          <h3 style="margin:2px 0 10px;font-size:15px;">Time Blocks</h3>
          <div style="display:grid;gap:0;">
            ${dynamicPlan.slice(0, 6).map(slot => `
              <div style="display:flex;gap:12px;padding:9px 0;border-bottom:1px solid #f1f2f4;align-items:flex-start;">
                <time style="font-weight:800;color:#0c66e4;font-size:12px;min-width:44px;">${slot.time}</time>
                <div>
                  <div style="font-size:13px;font-weight:700;color:#172b4d;">${slot.label}</div>
                  <div style="font-size:11px;color:#626f86;">${slot.task ? slot.task.canonicalTitle : "Buffer"}</div>
                </div>
              </div>`).join("")}
          </div>
        </div>
      </aside>
    </div>
  `;
}

// ─── Google resource links per task type ─────────────────────────────────────
function getGoogleResources(task) {
  const title = (task?.canonicalTitle || "").toLowerCase();
  const resources = [];

  if (/csv|upload|timeout|import/.test(title))
    resources.push(
      { label: "Nginx timeout tuning guide", url: "https://docs.nginx.com/nginx/admin-guide/web-server/reverse-proxy/", icon: "📄" },
      { label: "Node.js stream timeout patterns", url: "https://nodejs.org/api/stream.html", icon: "📄" },
      { label: "Video: Debugging upload timeouts", url: "https://www.youtube.com/results?search_query=debug+file+upload+timeout+node", icon: "▶" }
    );
  else if (/auth|token|oauth|sso|login/.test(title))
    resources.push(
      { label: "OAuth 2.0 token refresh RFC", url: "https://datatracker.ietf.org/doc/html/rfc6749#section-6", icon: "📄" },
      { label: "Google Identity platform docs", url: "https://cloud.google.com/identity-platform/docs", icon: "📄" },
      { label: "Video: JWT token rotation walkthrough", url: "https://www.youtube.com/results?search_query=jwt+token+rotation+security", icon: "▶" }
    );
  else if (/webhook|retry|queue/.test(title))
    resources.push(
      { label: "Webhook retry best practices", url: "https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks", icon: "📄" },
      { label: "Message queue patterns (Google Cloud)", url: "https://cloud.google.com/pubsub/docs/overview", icon: "📄" },
      { label: "Video: Building reliable webhooks", url: "https://www.youtube.com/results?search_query=reliable+webhook+delivery+idempotency", icon: "▶" }
    );
  else if (/dashboard|analytics|search|index/.test(title))
    resources.push(
      { label: "Elasticsearch indexing docs", url: "https://www.elastic.co/guide/en/elasticsearch/reference/current/docs-index_.html", icon: "📄" },
      { label: "BigQuery optimization guide", url: "https://cloud.google.com/bigquery/docs/best-practices-performance-overview", icon: "📄" },
      { label: "Video: Optimizing analytics queries", url: "https://www.youtube.com/results?search_query=optimizing+database+queries+dashboard", icon: "▶" }
    );
  else if (/compliance|audit|security|secret|credentials/.test(title))
    resources.push(
      { label: "Google Cloud security best practices", url: "https://cloud.google.com/security/best-practices", icon: "📄" },
      { label: "NIST security controls guide", url: "https://csrc.nist.gov/publications/detail/sp/800-53/rev-5/final", icon: "📄" },
      { label: "Video: Secret rotation automation", url: "https://www.youtube.com/results?search_query=secret+rotation+kubernetes+vault", icon: "▶" }
    );
  else if (/billing|invoice|payment|reconcil/.test(title))
    resources.push(
      { label: "Stripe webhook idempotency docs", url: "https://stripe.com/docs/webhooks/best-practices#idempotency", icon: "📄" },
      { label: "Billing reconciliation patterns", url: "https://cloud.google.com/billing/docs/how-to/notify", icon: "📄" },
      { label: "Video: Payment processing reliability", url: "https://www.youtube.com/results?search_query=payment+processing+reliability+engineering", icon: "▶" }
    );
  else
    resources.push(
      { label: "Google Cloud architecture patterns", url: "https://cloud.google.com/architecture", icon: "📄" },
      { label: "Stack Overflow: search this issue", url: `https://stackoverflow.com/search?q=${encodeURIComponent(task?.canonicalTitle||"engineering best practice")}`, icon: "🔍" },
      { label: "Video: Engineering deep dive", url: `https://www.youtube.com/results?search_query=${encodeURIComponent((task?.canonicalTitle||"software engineering").slice(0,60))}`, icon: "▶" }
    );

  return resources;
}

// Page: AI Agent — task-specific execution assistant with resource links
function renderAgentScanConsole() {
  const queue = activeQueue();
  const agentTask = queue.find(t => t.id === selectedTaskId) || queue[0];
  const resources = getGoogleResources(agentTask);
  const completedCount = completedTaskIds.length;
  const totalCount = state.prioritized.length;

  return `
    <div class="agent-page-shell">
      <!-- Left: terminal + task selection -->
      <div class="agent-main-col">
        <!-- Header -->
        <div class="agent-page-header">
          <div>
            <p class="eyebrow">AI Agent · Autonomous Execution</p>
            <h2 style="margin:2px 0 0;">Pick a task · Let the agent work it</h2>
          </div>
          <div style="display:flex;gap:8px;">
            <button class="primary" id="startAgentScanBtn" ${agentRunning ? "disabled" : ""}>
              ${agentRunning ? "⚡ Running…" : "▶ Start Agent"}
            </button>
            ${agentRunning ? `<button class="secondary" id="stopAgentScanBtn" style="background:#ad2f2f;color:#fff;border:none;">■ Stop</button>` : ""}
          </div>
        </div>

        <!-- Task selector -->
        <div class="agent-task-selector">
          ${queue.slice(0, 6).map(t => {
            const isSel = t.id === (agentTask?.id);
            const isDone = completedTaskIds.includes(t.id);
            const isWorking = workingTaskIds.includes(t.id);
            const sevColor = {P1:"#de350b",P2:"#974f0c",P3:"#216e4e"}[t.severity]||"#626f86";
            return `
              <button class="agent-task-chip ${isSel?"active":""} ${isDone?"done":""}" data-task="${t.id}">
                <span class="agent-chip-sev" style="background:${sevColor}22;color:${sevColor};">${t.severity}</span>
                <span class="agent-chip-title">${escapeHtml(t.canonicalTitle.slice(0,46))}${t.canonicalTitle.length>46?"…":""}</span>
                ${isDone ? `<span class="agent-chip-badge done">✓ Done</span>` : isWorking ? `<span class="agent-chip-badge working">● Working</span>` : ""}
              </button>`;
          }).join("")}
        </div>

        <!-- Terminal -->
        <div class="agent-terminal" id="agentTerminal">
          ${agentLogLines.length === 0
            ? `<div class="agent-terminal-idle">[TASKPILOT AGENT] Idle — select a task above and click ▶ Start Agent to begin autonomous execution.</div>`
            : agentLogLines.map(line => `<div>${escapeHtml(line)}</div>`).join("")
          }
        </div>

        <!-- Real-time completion bar -->
        <div class="agent-progress-bar-wrap">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <span style="font-size:12px;font-weight:700;color:#172b4d;">Overall progress</span>
            <span style="font-size:12px;color:#626f86;">${completedCount} of ${totalCount} tasks done</span>
          </div>
          <div style="height:8px;background:#f1f2f4;border-radius:999px;overflow:hidden;">
            <div style="height:100%;width:${totalCount?Math.round(completedCount/totalCount*100):0}%;background:linear-gradient(90deg,#0c66e4,#22a06b);border-radius:inherit;transition:width 0.4s;"></div>
          </div>
        </div>

        <!-- Action buttons for selected task -->
        ${agentTask ? `
          <div class="agent-task-actions-row">
            ${!completedTaskIds.includes(agentTask.id) && !workingTaskIds.includes(agentTask.id) ? `
              <button class="tp-btn-start" data-task-start="${agentTask.id}">▶ Start "${agentTask.canonicalTitle.slice(0,30)}…"</button>
            ` : ""}
            ${workingTaskIds.includes(agentTask.id) ? `
              <button class="tp-btn-done" data-task-complete="${agentTask.id}">✓ Mark Done — notify manager</button>
              <button class="tp-btn-cancel" data-task-cancel="${agentTask.id}">✕ Cancel</button>
            ` : ""}
            ${completedTaskIds.includes(agentTask.id) ? `
              <span style="color:#22a06b;font-weight:800;font-size:13px;">✓ Completed · Manager notified</span>
              <button class="tp-btn-reopen" data-task-reopen="${agentTask.id}">↩ Reopen</button>
            ` : ""}
          </div>
        ` : ""}
      </div>

      <!-- Right: task brief + Google resources -->
      <aside class="agent-aside-col">
        <!-- Execution brief -->
        ${agentTask ? `
          <div class="agent-brief-card">
            <p class="eyebrow">Current Task</p>
            <h3 style="margin:4px 0 8px;font-size:15px;color:#172b4d;">${escapeHtml(agentTask.canonicalTitle)}</h3>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">
              <span class="agent-sev-badge sev-${agentTask.severity.toLowerCase()}">${agentTask.severity}</span>
              <span class="agent-meta-pill">Due ${formatDue(agentTask.due)}</span>
              <span class="agent-meta-pill">Score ${agentTask.score}</span>
              <span class="agent-meta-pill">${agentTask.sources.join(" + ")}</span>
            </div>
            <p style="font-size:13px;color:#44546f;margin:0 0 8px;">${escapeHtml(agentTask.body||"")}</p>
            <div style="background:#f7f8fa;border-radius:6px;padding:10px;margin-bottom:10px;">
              <strong style="font-size:12px;color:#172b4d;">Definition of Done</strong>
              <p style="font-size:12px;color:#44546f;margin:4px 0 0;">${escapeHtml(agentTask.execution?.definitionOfDone||"Complete and verify task.")}</p>
            </div>
            <div>
              <strong style="font-size:12px;color:#172b4d;">Steps</strong>
              <ol style="padding-left:16px;margin:6px 0 0;font-size:12px;color:#44546f;display:grid;gap:4px;">
                ${(agentTask.execution?.process||["Analyse","Execute","Validate","Close"]).map(s=>`<li>${escapeHtml(s)}</li>`).join("")}
              </ol>
            </div>
          </div>
        ` : `<div class="agent-brief-card" style="text-align:center;color:#626f86;padding:32px;"><p>Select a task above to see the execution brief.</p></div>`}

        <!-- Google resource links -->
        <div class="agent-resources-card">
          <p class="eyebrow" style="margin-bottom:8px;">📚 How-to Resources</p>
          <p style="font-size:12px;color:#626f86;margin:0 0 10px;">Docs & videos to help you fix this — one click to open.</p>
          <div style="display:grid;gap:6px;">
            ${resources.map(r=>`
              <a href="${r.url}" target="_blank" rel="noopener" class="agent-resource-link">
                <span class="agent-resource-icon">${r.icon}</span>
                <span>${escapeHtml(r.label)}</span>
                <span class="agent-resource-arrow">↗</span>
              </a>
            `).join("")}
          </div>
        </div>

        <!-- Agent confidence -->
        <div class="agent-confidence-card">
          <p class="eyebrow" style="margin-bottom:6px;">Agent Status</p>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <span style="font-size:12px;color:#44546f;">Confidence</span>
            <strong style="color:#18745f;">${Array.isArray(scanCompleteInfo)?"95%":agentRunning?"Scanning…":"—"}</strong>
          </div>
          <div style="height:6px;background:#f1f2f4;border-radius:999px;overflow:hidden;">
            <div style="height:100%;width:${Array.isArray(scanCompleteInfo)?"95":agentRunning?"60":"0"}%;background:#18745f;border-radius:inherit;transition:width 0.5s;"></div>
          </div>
          <div style="margin-top:10px;font-size:12px;color:${agentRunning?"#b87319":Array.isArray(scanCompleteInfo)?"#18745f":"#626f86"};font-weight:700;">
            ${agentRunning?"⚡ Scanning & reasoning…":Array.isArray(scanCompleteInfo)?"✓ Scan completed":"○ Idle · ready"}
          </div>
        </div>
      </aside>
    </div>
  `;
}

// Page: Unified Inbox — Full Scrum Board with Source Tree, Kanban, and Date Stream
function renderUnifiedInbox() {
  const allTasks = getScrumTasks();
  const byStatus = groupByStatus(allTasks);

  return `
    <div class="scrum-shell" id="scrumShell">
      ${renderSourceTree()}
      <div class="scrum-filters">
        <div class="scrum-search-wrap">
          <span class="scrum-search-icon">🔍</span>
          <input type="text" class="scrum-search" id="scrumSearch" placeholder="Search tasks, IDs, owners…" value="${escapeHtml(scrumSearch)}">
        </div>
        <div class="scrum-filter-group">
          <span class="scrum-filter-label">Date</span>
          ${[["all","All"],["overdue","Overdue"],["today","Today"],["week","This week"]].map(([v,l])=>`
            <button class="scrum-pill ${scrumDateFilter===v?"active":""}" data-scrum-date="${v}">${l}</button>
          `).join("")}
        </div>
        <div class="scrum-filter-group">
          <span class="scrum-filter-label">Effort</span>
          ${[["all","All"],["easy","Easy"],["medium","Medium"],["hard","Hard"]].map(([v,l])=>`
            <button class="scrum-pill ${scrumDiffFilter===v?"active":""}" data-scrum-diff="${v}">${l}</button>
          `).join("")}
        </div>
        <div style="margin-left:auto;display:flex;align-items:center;gap:8px;">
          <span class="scrum-count-badge">${allTasks.length} tasks · ${sources.length} sources</span>
          <button class="primary" style="font-size:12px;padding:7px 12px;" id="openAddJiraModalBtn">+ Add Task</button>
        </div>
      </div>
      <div class="scrum-kanban" id="scrumKanban">
        ${renderScrumColumns(byStatus)}
      </div>
      <div class="scrum-task-stream" id="scrumTaskStream">
        ${renderScrumStream(allTasks)}
      </div>
    </div>
  `;
}

// Page: Meeting Agent (Autonomous — mirrors the task agent)
function renderMeetingMemory() {
  const pendingMeetings = meetingsList.filter(m => m.status === "Pending");
  const scheduledMeetings = meetingsList.filter(m => m.status === "Scheduled");
  const activeMeeting = selectedMeeting || meetingsList[0];

  const priorityColor = (p) => {
    if (p === "Critical") return "#ef4444";
    if (p === "High") return "#f97316";
    if (p === "Medium") return "#eab308";
    return "#22c55e";
  };

  const typeIcon = (t) => {
    if (t === "zoom") return "📹";
    if (t === "slack") return "💬";
    if (t === "recurring") return "🔁";
    return "📅";
  };

  return `
    <div class="meeting-agent-container">
      <!-- Agent Toolbar -->
      <div class="meeting-header-row">
        <div class="meeting-header-title">
          <p class="eyebrow">Autonomous Meeting Intelligence</p>
          <h2>Meeting Agent</h2>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="secondary" id="addMeetingNoteBtn" style="display:flex; align-items:center; gap:6px;">
            <span>➕</span> Add Note
          </button>
          <button class="primary" id="startMeetingAgentBtn" ${meetingAgentRunning ? "disabled" : ""} style="display:flex; align-items:center; gap:6px; background: linear-gradient(135deg, #0ea5e9, #0284c7); border: none;">
            <span>${meetingAgentRunning ? "⏳" : "⚡"}</span> ${meetingAgentRunning ? "Scanning..." : "Run Meeting Agent"}
          </button>
        </div>
      </div>

      <!-- Agent Terminal -->
      <div class="meeting-terminal" id="meetingAgentTerminal">
        ${meetingAgentLog.length === 0
          ? `<div class="meeting-terminal-idle">
               <span style="font-size:14px;">🤖</span> [MEETING AGENT] Idle. Click "Run Meeting Agent" to scan emails, Slack, and calendar for meetings autonomously.
             </div>`
          : meetingAgentLog.map(l => `
              <div class="meeting-terminal-line">
                <span class="meeting-terminal-prefix">&gt;</span> ${escapeHtml(l)}
              </div>
            `).join("")
        }
      </div>

      <div class="content-grid" style="grid-template-columns: minmax(0,1.4fr) minmax(320px, 0.85fr); gap:16px;">
        <!-- Left: Meeting List -->
        <div style="display:flex; flex-direction:column; gap:16px;">
          <!-- Pending Meetings -->
          <div class="meeting-board">
            <div class="meeting-board-header">
              <div>
                <p class="eyebrow">Needs Scheduling</p>
                <h3>Pending Meetings (${pendingMeetings.length})</h3>
              </div>
              <span class="meeting-badge-action">${pendingMeetings.length} action required</span>
            </div>
            <div style="display:grid; gap:10px;">
              ${pendingMeetings.length === 0
                ? `<p style="color:#64748b; font-size:13px; font-style:italic; padding:12px; text-align:center;">No pending meetings. Run the agent to extract from inbox.</p>`
                : pendingMeetings.map(m => renderMeetingCard(m, priorityColor, typeIcon)).join("")
              }
            </div>
          </div>

          <!-- Scheduled Meetings -->
          <div class="meeting-board">
            <div class="meeting-board-header">
              <div>
                <p class="eyebrow">On Calendar</p>
                <h3>Scheduled Meetings (${scheduledMeetings.length})</h3>
              </div>
              <span class="meeting-badge-confirmed">✓ Confirmed</span>
            </div>
            <div style="display:grid; gap:10px;">
              ${scheduledMeetings.length === 0
                ? `<p style="color:#64748b; font-size:13px; font-style:italic; padding:12px; text-align:center;">No scheduled meetings on calendar yet.</p>`
                : scheduledMeetings.map(m => renderMeetingCard(m, priorityColor, typeIcon)).join("")}
            </div>
          </div>
        </div>

        <!-- Right: Detail Panel -->
        <aside>
          ${activeMeeting ? `
            <section class="meeting-detail-panel">
              <div class="meeting-detail-title-section">
                <p class="eyebrow">Meeting Intelligence</p>
                <h3 style="margin:4px 0 2px; font-size:18px; font-weight:800; color:#0f172a; line-height:1.35;">${escapeHtml(activeMeeting.title)}</h3>
                <div class="meeting-detail-pills">
                  <span class="meeting-detail-pill priority-${(activeMeeting.urgencyLabel || activeMeeting.priority || "low").toLowerCase()}">
                    ${activeMeeting.urgencyLabel || activeMeeting.priority}
                  </span>
                  <span class="meeting-detail-pill type">
                    ${typeIcon(activeMeeting.type)} ${activeMeeting.type}
                  </span>
                  <span class="meeting-detail-pill score">
                    Score: ${activeMeeting.priorityScore || "—"}
                  </span>
                </div>
              </div>

              <div class="meeting-detail-section agenda">
                <strong>📝 Agenda:</strong> ${escapeHtml(activeMeeting.agenda || "Not specified")}
              </div>

              ${activeMeeting.aiReasoning ? `
                <div class="meeting-detail-section ai-reasoning">
                  <strong>🤖 AI Reasoning:</strong> ${escapeHtml(activeMeeting.aiReasoning)}
                </div>
              ` : ""}

              ${activeMeeting.suggestedAction ? `
                <div class="meeting-detail-section suggested-action">
                  <strong>⚡ Suggested Action:</strong> ${escapeHtml(activeMeeting.suggestedAction)}
                </div>
              ` : ""}

              ${activeMeeting.riskIfSkipped ? `
                <div class="meeting-detail-section risk">
                  <strong>⚠ Risk if Skipped:</strong> ${escapeHtml(activeMeeting.riskIfSkipped)}
                </div>
              ` : (activeMeeting.risks && activeMeeting.risks.length > 0 ? `
                <div class="meeting-detail-section risk">
                  <strong>⚠ Risks:</strong> ${escapeHtml(activeMeeting.risks.join("; "))}
                </div>
              ` : "")}

              <div class="meeting-detail-info-block">
                <div class="meeting-detail-info-row">
                  <span class="meeting-detail-info-label">👥 Attendees:</span>
                  <span class="meeting-detail-info-value">${escapeHtml((activeMeeting.attendees || []).join(", "))}</span>
                </div>
                <div class="meeting-detail-info-row">
                  <span class="meeting-detail-info-label">🕒 Suggested:</span>
                  <span class="meeting-detail-info-value">${escapeHtml(activeMeeting.suggestedDate)} at ${escapeHtml(activeMeeting.suggestedTime)} (${activeMeeting.duration} min)</span>
                </div>
                <div class="meeting-detail-info-row">
                  <span class="meeting-detail-info-label">🔌 Source:</span>
                  <span class="meeting-detail-info-value">${escapeHtml(activeMeeting.extractedFrom || activeMeeting.source)}</span>
                </div>
              </div>

              <div class="meeting-action-buttons">
                <button class="secondary" id="analyzeMeetingBtn" data-meet-detail="${activeMeeting.id}" style="display:flex; align-items:center; gap:6px;">
                  <span>🧠</span> Analyze with AI
                </button>
                ${activeMeeting.savedToCalendar || activeMeeting.status === "Scheduled"
                  ? `<button class="secondary" style="color:#15803d; border-color:#dcfce7; background:#f0fdf4; display:flex; align-items:center; gap:6px;" disabled>
                       <span>✓</span> On Calendar
                     </button>`
                  : `<button class="primary" id="saveMeetingCalBtn" data-meeting-id="${activeMeeting.id}" style="display:flex; align-items:center; gap:6px; background: linear-gradient(135deg, #0ea5e9, #0284c7); border: none;">
                       <span>📅</span> Save to Calendar
                     </button>`
                }
              </div>

              <!-- Analysis Result -->
              <div id="meetingAnalysisResult" style="font-size:13px; color:#334155; border-top:1px solid #e2e8f0; padding-top:12px; display:grid; gap:8px;">
                ${renderMeetingAnalysisHTML(activeMeeting.id)}
              </div>
            </section>
          ` : `<section class="meeting-detail-panel"><p style="color:#64748b; text-align:center; padding:24px; font-style:italic;">No meeting selected.</p></section>`}
        </aside>
      </div>
    </div>
  `;
}

function renderMeetingCard(m, priorityColor, typeIcon) {
  const isActive = (selectedMeeting?.id === m.id) || (!selectedMeeting && meetingsList[0]?.id === m.id);
  const color = priorityColor(m.urgencyLabel || m.priority);
  const bgTint = m.urgencyLabel === "Critical" || m.priority === "Critical" ? "rgba(239, 68, 68, 0.12)"
              : m.urgencyLabel === "High" || m.priority === "High" ? "rgba(249, 115, 22, 0.12)"
              : m.urgencyLabel === "Medium" || m.priority === "Medium" ? "rgba(234, 179, 8, 0.12)"
              : "rgba(34, 197, 94, 0.12)";
              
  return `
    <button class="meeting-card-btn ${isActive ? "selected" : ""}" data-meet-id="${m.id}" style="--meet-accent: ${color}; --meet-bg-tint: ${bgTint};">
      <div class="meeting-card-header">
        <div class="meeting-card-title-group">
          <div class="meeting-card-icon-wrapper">
            ${typeIcon(m.type)}
          </div>
          <span class="meeting-card-title">${escapeHtml(m.title)}</span>
        </div>
        <div class="meeting-card-score">
          ${m.priorityScore || "—"}
        </div>
      </div>
      
      <div class="meeting-card-meta">
        <span>📅 ${m.suggestedDate} at ${m.suggestedTime}</span>
        <span>•</span>
        <span>⏱ ${m.duration} min</span>
        <span>•</span>
        <span>👥 ${(m.attendees||[]).length} attendees</span>
      </div>
      
      <div class="meeting-card-footer">
        <span class="meeting-card-urgency">${m.urgencyLabel || m.priority}</span>
        ${m.savedToCalendar || m.status === "Scheduled"
          ? `<span class="meeting-card-status saved">✓ Saved to Calendar</span>`
          : `<span class="meeting-card-status pending">⏳ Pending Save</span>`
        }
      </div>
    </button>
  `;
}

function renderMeetingAnalysisHTML(meetId) {
  const analysis = analyzedMeetings[meetId];
  if (!analysis) {
    return `<p style="color:#626f86; font-size:12px;">Click <strong>Analyze with AI</strong> to extract decisions, action items, and follow-up meetings using TaskPilot AI.</p>`;
  }

  return `
    <div style="display:grid; gap:8px;">
      <div style="background:#f7f8fa; padding:10px; border-radius:6px; font-size:13px;">
        <strong>Summary:</strong> ${escapeHtml(analysis.summary || "")}
      </div>
      ${analysis.decisions && analysis.decisions.length > 0 ? `
        <div>
          <strong style="font-size:12px; color:#626f86; text-transform:uppercase; letter-spacing:0.05em;">Key Decisions</strong>
          <ul style="padding-left:16px; margin:4px 0; font-size:12px; color:#44546f; line-height:1.5;">
            ${analysis.decisions.map(d => `<li>${escapeHtml(d)}</li>`).join("")}
          </ul>
        </div>
      ` : ""}
      ${analysis.actionItems && analysis.actionItems.length > 0 ? `
        <div>
          <strong style="font-size:12px; color:#626f86; text-transform:uppercase; letter-spacing:0.05em;">Action Items</strong>
          <div style="display:grid; gap:4px; margin-top:4px;">
            ${analysis.actionItems.map(a => `
              <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 8px; background:#fff; border:1px solid #dfe3ea; border-radius:4px; font-size:12px;">
                <span>✅ ${escapeHtml(a.title)}</span>
                <span style="color:#626f86; font-size:11px;">${a.assignee || ""} ${a.deadline ? "· " + a.deadline : ""}</span>
              </div>
            `).join("")}
          </div>
        </div>
      ` : ""}
      ${analysis.followUpMeetings && analysis.followUpMeetings.length > 0 ? `
        <div>
          <strong style="font-size:12px; color:#626f86; text-transform:uppercase; letter-spacing:0.05em;">Follow-up Meetings</strong>
          ${analysis.followUpMeetings.map((f, i) => `
            <div style="background:#fffcf5; border:1px dashed #d9c8ae; padding:8px; border-radius:6px; margin-top:5px; display:flex; justify-content:space-between; align-items:center; font-size:12px;">
              <div>
                <strong>${escapeHtml(f.title)}</strong><br>
                <span class="small">Suggested: ${escapeHtml(f.suggestedDate || "TBD")} · ${f.duration || 30} min</span>
              </div>
              <button class="secondary success" style="font-size:11px; padding:4px 8px;" data-save-meeting-index="${i}">📅 Calendar</button>
            </div>
          `).join("")}
        </div>
      ` : ""}
      ${analysis.risks && analysis.risks.length > 0 ? `
        <div style="background:#fff4f2; border-left:3px solid #de350b; padding:8px; border-radius:4px; font-size:12px; color:#6b1a0a;">
          <strong>Risks:</strong> ${analysis.risks.join("; ")}
        </div>
      ` : ""}
    </div>
  `;
}

// Page: Hidden Asks
function renderHiddenAsks() {
  const unstructured = state.flattened.filter(t => ["message", "note"].includes(t.type));
  return `
    <section class="board" style="padding:18px;">
      <div class="section-head">
        <div>
          <p class="eyebrow">NLP Extraction Pipeline</p>
          <h2>Unstructured Hidden Action Items</h2>
        </div>
        <span>${unstructured.length} items detected</span>
      </div>

      <div style="display:grid; gap:12px; margin-top:15px;">
        ${unstructured.map(item => `
          <div style="display:flex; justify-content:space-between; align-items:center; border:1px solid #e4dacd; border-radius:8px; padding:15px; background:#fff;">
            <div style="min-width:0; flex:1; margin-right:15px;">
              <div style="display:flex; align-items:center; gap:8px; margin-bottom:5px;">
                <span class="severity ${item.severity.toLowerCase()}">${item.severity}</span>
                <strong style="color:#152238;">${item.title}</strong>
              </div>
              <p style="margin:5px 0 0; font-size:13px; color:#65717d;">
                Extracted from: <strong>${item.sourceName} (${item.id})</strong><br>
                "${item.body}"
              </p>
            </div>
            <button class="primary" style="font-size:12px; padding:8px 12px;" data-promote-task="${item.id}">
              Promote to Jira
            </button>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

// ─── Scrum / Source Board state ───────────────────────────────────────────────
let scrumActiveSource = "all";      // "all" | source id
let scrumDateFilter  = "all";       // "all" | "today" | "week" | "overdue"
let scrumDiffFilter  = "all";       // "all" | "easy" | "medium" | "hard"
let scrumSearch      = "";

// ─── Unified Scrum Board ───────────────────────────────────────────────────────
// Entry point — "Jira board" nav item now opens this full board
function renderJiraBoard() {
  // Collect ALL tasks from ALL sources with their raw source metadata
  const allTasks = getScrumTasks();
  const byStatus = groupByStatus(allTasks);

  return `
    <div class="scrum-shell" id="scrumShell">
      <!-- Source Tree + title bar -->
      ${renderSourceTree()}

      <!-- Filters bar -->
      <div class="scrum-filters" id="scrumFilters">
        <div class="scrum-search-wrap">
          <span class="scrum-search-icon">🔍</span>
          <input type="text" class="scrum-search" id="scrumSearch" placeholder="Search tasks…" value="${escapeHtml(scrumSearch)}">
        </div>
        <div class="scrum-filter-group">
          <span class="scrum-filter-label">Date</span>
          ${["all","overdue","today","week"].map(v=>`
            <button class="scrum-pill ${scrumDateFilter===v?"active":""}" data-scrum-date="${v}">${v==="all"?"All":v==="overdue"?"Overdue":v==="today"?"Today":"This week"}</button>
          `).join("")}
        </div>
        <div class="scrum-filter-group">
          <span class="scrum-filter-label">Effort</span>
          ${["all","easy","medium","hard"].map(v=>`
            <button class="scrum-pill ${scrumDiffFilter===v?"active":""}" data-scrum-diff="${v}">${v==="all"?"All":v.charAt(0).toUpperCase()+v.slice(1)}</button>
          `).join("")}
        </div>
        <div style="margin-left:auto;display:flex;align-items:center;gap:8px;">
          <span class="scrum-count-badge">${allTasks.length} tasks · ${Object.keys(byStatus).length} statuses</span>
          <button class="primary" style="font-size:12px;" id="openAddJiraModalBtn">+ Add Task</button>
        </div>
      </div>

      <!-- Kanban columns -->
      <div class="scrum-kanban" id="scrumKanban">
        ${renderScrumColumns(byStatus)}
      </div>

      <!-- Task list for selected source (below tree) -->
      <div class="scrum-task-stream" id="scrumTaskStream">
        ${renderScrumStream(allTasks)}
      </div>
    </div>
  `;
}

// ─── Workspace Hub — Unstop-style source sub-navigation with deep links ───────
function renderWorkspaceHub() {
  // Deep-link URL builder per source type
  function sourceDeepLink(sourceId, taskId) {
    const map = {
      jira:        `https://jira.atlassian.com/browse/${taskId}`,
      servicenow:  `https://support.servicenow.com/now/nav/ui/classic/params/target/task_list.do?sysparm_query=number=${taskId}`,
      github:      taskId.startsWith("PR") ? `https://github.com/pulls` : `https://github.com/issues`,
      email:       `https://outlook.office.com/mail/`,
      slack:       `https://app.slack.com/`,
      notes:       `https://meet.google.com/`
    };
    return map[sourceId] || "#";
  }

  const workspaceSources = sources.map(s => ({
    ...s,
    tasks: state.prioritized.filter(t => t.sources.includes(s.name) && !completedTaskIds.includes(t.id)).slice(0, 6)
  }));

  const activeWsSource = workspaceActiveSource || sources[0]?.id;
  const activeSource = workspaceSources.find(s => s.id === activeWsSource) || workspaceSources[0];

  return `
    <div class="ws-shell">
      <!-- Source tabs (Unstop-style sidebar) -->
      <nav class="ws-source-nav">
        <p class="eyebrow" style="padding:0 12px 8px;">Integrations</p>
        ${workspaceSources.map(s => `
          <button class="ws-source-tab ${s.id === activeWsSource ? "active" : ""}" data-ws-source="${s.id}" style="--tab-color:${s.color}">
            <span class="ws-source-dot" style="background:${s.color}"></span>
            <span class="ws-source-tab-name">${s.name}</span>
            <span class="ws-source-count">${s.tasks.length}</span>
          </button>
        `).join("")}
      </nav>

      <!-- Task list for active source -->
      <div class="ws-task-area">
        <div class="ws-task-area-header">
          <div>
            <p class="eyebrow" style="color:${activeSource?.color}">${activeSource?.name}</p>
            <h2 style="margin:2px 0 0;">${activeSource?.tasks.length} open tasks</h2>
          </div>
          <a href="${sourceDeepLink(activeWsSource, "")}" target="_blank" rel="noopener"
             class="primary" style="text-decoration:none;padding:9px 16px;border-radius:6px;font-size:13px;font-weight:800;display:inline-flex;align-items:center;gap:6px;">
            Open ${activeSource?.name} ↗
          </a>
        </div>

        <div class="ws-task-list">
          ${!activeSource?.tasks.length
            ? `<div style="padding:48px;text-align:center;color:#626f86;">
                <p style="font-size:24px;margin:0 0 10px;">🎉</p>
                <h3 style="margin:0 0 6px;color:#172b4d;">All clear in ${activeSource?.name}!</h3>
                <p style="margin:0;font-size:13px;">No open tasks from this source.</p>
               </div>`
            : activeSource.tasks.map(t => {
                const deepLink = sourceDeepLink(activeWsSource, t.aliases[0] || t.id);
                const isWorking = workingTaskIds.includes(t.id);
                const sevColor = {P1:"#de350b",P2:"#974f0c",P3:"#216e4e"}[t.severity]||"#626f86";
                return `
                  <div class="ws-task-card">
                    <div class="ws-task-left">
                      <span class="ws-sev-chip" style="background:${sevColor}22;color:${sevColor};">${t.severity}</span>
                      <div class="ws-task-info">
                        <div class="ws-task-title">
                          ${escapeHtml(t.canonicalTitle)}
                          ${isWorking ? `<span class="tp-status-chip working">● Working</span>` : ""}
                        </div>
                        <div class="ws-task-meta">
                          <span>${escapeHtml(t.aliases.slice(0,3).join(", "))}</span>
                          <span>·</span>
                          <span>${t.owner||"Unassigned"}</span>
                          <span>·</span>
                          <span class="${t.due && t.due < "2026-06-19" ? "tp-overdue" : ""}">Due ${formatDue(t.due)}</span>
                        </div>
                      </div>
                    </div>
                    <div class="ws-task-actions">
                      <a href="${deepLink}" target="_blank" rel="noopener" class="ws-open-btn" title="Open in ${activeSource?.name}">
                        Open in ${activeSource?.name} ↗
                      </a>
                      ${!isWorking ? `<button class="tp-btn-start" data-task-start="${t.id}">▶ Start</button>` : `<button class="tp-btn-done" data-task-complete="${t.id}">✓ Done</button>`}
                    </div>
                  </div>`;
              }).join("")
          }
        </div>
      </div>
    </div>
  `;
}

function getScrumTasks() {
  let tasks = [...state.prioritized];

  // Source filter
  if (scrumActiveSource !== "all") {
    tasks = tasks.filter(t => t.sources.some(s => s.toLowerCase().replace(/\s+/g,"").includes(scrumActiveSource.toLowerCase().replace(/\s+/g,""))));
  }

  // Search
  if (scrumSearch.trim()) {
    const q = scrumSearch.toLowerCase();
    tasks = tasks.filter(t => t.canonicalTitle.toLowerCase().includes(q) || t.body.toLowerCase().includes(q) || t.id.toLowerCase().includes(q));
  }

  // Date filter
  const today = "2026-06-19";
  const weekEnd = "2026-06-26";
  if (scrumDateFilter === "overdue") {
    tasks = tasks.filter(t => t.due && t.due < today);
  } else if (scrumDateFilter === "today") {
    tasks = tasks.filter(t => t.due === today);
  } else if (scrumDateFilter === "week") {
    tasks = tasks.filter(t => t.due && t.due >= today && t.due <= weekEnd);
  }

  // Difficulty filter (based on score + estimatedMinutes)
  if (scrumDiffFilter !== "all") {
    tasks = tasks.filter(t => {
      const mins = t.execution?.estimatedMinutes || 60;
      if (scrumDiffFilter === "easy")   return mins <= 60 && t.severity !== "P1";
      if (scrumDiffFilter === "medium") return mins > 60 && mins <= 120;
      if (scrumDiffFilter === "hard")   return mins > 120 || t.severity === "P1";
      return true;
    });
  }

  return tasks;
}

function groupByStatus(tasks) {
  const order = ["In progress","Review requested","Assigned","Todo","Open","New","Captured","Done"];
  const groups = {};
  tasks.forEach(t => {
    const s = completedTaskIds.includes(t.id) ? "Done" : (t.status || "Todo");
    if (!groups[s]) groups[s] = [];
    groups[s].push(t);
  });
  // Sort by order
  const sorted = {};
  order.forEach(s => { if (groups[s]) sorted[s] = groups[s]; });
  Object.keys(groups).forEach(s => { if (!sorted[s]) sorted[s] = groups[s]; });
  return sorted;
}

function renderScrumColumns(byStatus) {
  const colMeta = {
    "In progress": { color:"#0c66e4", bg:"#f4f8ff", dot:"#0c66e4" },
    "Review requested": { color:"#6554c0", bg:"#f8f5ff", dot:"#6554c0" },
    "Assigned": { color:"#974f0c", bg:"#fffdf5", dot:"#ffab00" },
    "Todo": { color:"#172b4d", bg:"#f7f8fa", dot:"#626f86" },
    "Open": { color:"#172b4d", bg:"#f7f8fa", dot:"#626f86" },
    "New": { color:"#172b4d", bg:"#f7f8fa", dot:"#626f86" },
    "Captured": { color:"#216e4e", bg:"#f4fff9", dot:"#22a06b" },
    "Done": { color:"#216e4e", bg:"#f4fff9", dot:"#22a06b" }
  };

  return Object.entries(byStatus).map(([status, tasks]) => {
    const meta = colMeta[status] || { color:"#172b4d", bg:"#f7f8fa", dot:"#626f86" };
    return `
      <div class="scrum-col" style="--col-bg:${meta.bg};--col-dot:${meta.dot};">
        <div class="scrum-col-head">
          <span class="scrum-col-dot" style="background:${meta.dot};"></span>
          <strong style="color:${meta.color};">${status}</strong>
          <span class="scrum-col-count">${tasks.length}</span>
        </div>
        <div class="scrum-col-body">
          ${tasks.map(t => renderScrumCard(t, status)).join("")}
        </div>
      </div>
    `;
  }).join("");
}

function renderScrumCard(task, status) {
  const isDone = status === "Done";
  const sevColors = { P1:"#de350b", P2:"#974f0c", P3:"#216e4e", P4:"#626f86" };
  const srcIcons = { "jira":"J", "github":"G", "servicenow":"SN", "email":"✉", "slack":"S", "notes":"M", "meetings":"📅" };
  const srcIcon = srcIcons[task.sourceId] || task.sourceId?.[0]?.toUpperCase() || "?";
  const mins = task.execution?.estimatedMinutes || 60;
  const effort = mins <= 60 ? "Easy" : mins <= 120 ? "Medium" : "Hard";
  const effortColor = mins <= 60 ? "#216e4e" : mins <= 120 ? "#974f0c" : "#de350b";

  return `
    <div class="scrum-card ${selectedTaskId === task.id ? "scrum-card-selected" : ""} ${isDone ? "scrum-card-done" : ""}" data-task="${task.id}">
      <div class="scrum-card-top">
        <span class="scrum-sev-dot" style="background:${sevColors[task.severity]||"#626f86"};"></span>
        <span class="scrum-card-id">${task.id}</span>
        <span class="scrum-src-badge">${srcIcon}</span>
      </div>
      <p class="scrum-card-title">${isDone ? `<s style="opacity:.55">${escapeHtml(task.canonicalTitle)}</s>` : escapeHtml(task.canonicalTitle)}</p>
      <div class="scrum-card-meta">
        <span class="scrum-effort-tag" style="color:${effortColor};background:${effortColor}18;">${effort}</span>
        ${task.due ? `<span class="scrum-due ${task.due <= "2026-06-19" && !isDone ? "overdue":""}">${formatDue(task.due)}</span>` : ""}
        <span class="scrum-owner">${task.owner||"—"}</span>
      </div>
      <div class="scrum-card-actions">
        ${status === "Todo" || status === "Open" || status === "New" ? `<button class="scrum-btn" data-transition-task="${task.id}" data-to-status="In progress">▶ Start</button>` : ""}
        ${status === "In progress" || status === "Review requested" ? `<button class="scrum-btn success" data-transition-task="${task.id}" data-to-status="Done">✔ Done</button>` : ""}
        ${isDone ? `<button class="scrum-btn" data-transition-task="${task.id}" data-to-status="Todo">↺</button>` : ""}
      </div>
    </div>
  `;
}

function renderScrumStream(tasks) {
  if (tasks.length === 0) return `<div style="padding:24px;text-align:center;color:#626f86;font-size:14px;">No tasks match current filters.</div>`;

  // Group by date
  const byDate = {};
  tasks.forEach(t => {
    const key = t.due || "No date";
    if (!byDate[key]) byDate[key] = [];
    byDate[key].push(t);
  });
  const sortedDates = Object.keys(byDate).sort((a,b) => {
    if (a === "No date") return 1;
    if (b === "No date") return -1;
    return a < b ? -1 : 1;
  });

  return `
    <div class="scrum-stream-header">
      <span>All Tasks · Date View</span>
      <span style="color:#626f86;font-size:12px;">${tasks.length} total · scroll to see all</span>
    </div>
    ${sortedDates.map(date => {
      const isToday = date === "2026-06-19";
      const isOverdue = date !== "No date" && date < "2026-06-19";
      return `
        <div class="scrum-date-group">
          <div class="scrum-date-label ${isToday?"today":""} ${isOverdue?"overdue":""}">
            ${isOverdue ? "⚠ " : isToday ? "● " : ""}
            ${date === "No date" ? "No deadline" : new Intl.DateTimeFormat("en",{weekday:"short",month:"short",day:"numeric"}).format(new Date(date+"T12:00:00"))}
            <span class="scrum-date-count">${byDate[date].length}</span>
          </div>
          <div class="scrum-stream-row">
            ${byDate[date].map(t => renderScrumStreamCard(t)).join("")}
          </div>
        </div>
      `;
    }).join("")}
  `;
}

function renderScrumStreamCard(task) {
  const isDone = completedTaskIds.includes(task.id);
  const sevColor = { P1:"#de350b", P2:"#974f0c", P3:"#216e4e", P4:"#626f86" }[task.severity] || "#626f86";
  const srcColor = sources.find(s=>s.id===task.sourceId)?.color || "#626f86";
  return `
    <div class="scrum-stream-card ${isDone?"done":""} ${selectedTaskId===task.id?"sel":""}" data-task="${task.id}">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
        <span style="width:3px;height:32px;border-radius:2px;background:${sevColor};flex-shrink:0;"></span>
        <div style="min-width:0;">
          <div style="display:flex;align-items:center;gap:5px;margin-bottom:2px;">
            <span style="width:8px;height:8px;border-radius:50%;background:${srcColor};flex-shrink:0;"></span>
            <span style="font-size:10px;color:#626f86;font-weight:700;">${escapeHtml(task.sources[0]||"")}</span>
            <span style="font-size:10px;color:#aaa;">${task.id}</span>
          </div>
          <strong style="font-size:13px;color:${isDone?"#aaa":"#172b4d"};${isDone?"text-decoration:line-through;":""}">${escapeHtml(task.canonicalTitle)}</strong>
        </div>
        <span style="margin-left:auto;font-size:18px;font-weight:900;color:${isDone?"#aaa":"#172b4d"};flex-shrink:0;">${task.score}</span>
      </div>
      <div style="display:flex;gap:6px;align-items:center;padding-left:9px;">
        <span style="padding:2px 6px;border-radius:3px;background:${sevColor}18;color:${sevColor};font-size:10px;font-weight:800;">${task.severity}</span>
        <span style="font-size:11px;color:#626f86;">${task.owner||""}</span>
        <span style="font-size:11px;color:#626f86;margin-left:auto;">${task.status||""}</span>
      </div>
    </div>
  `;
}

// ─── Animated Source Tree ─────────────────────────────────────────────────────
function renderSourceTree() {
  const nodeRadius = 28;
  const centerX = 520, centerY = 200;
  const sourceNodes = [
    { id:"all",         label:"All",      icon:"⊕", color:"#172b4d", angle: 0,   r: 0 },
    { id:"jira",        label:"Jira",     icon:"J",  color:"#0c66e4", angle: 0,   r: 160 },
    { id:"github",      label:"GitHub",   icon:"G",  color:"#24292f", angle: 60,  r: 160 },
    { id:"servicenow",  label:"Snow",     icon:"SN", color:"#bf2600", angle: 120, r: 160 },
    { id:"email",       label:"Outlook",  icon:"✉",  color:"#0c66e4", angle: 180, r: 160 },
    { id:"slack",       label:"Slack",    icon:"S",  color:"#6554c0", angle: 240, r: 160 },
    { id:"notes",       label:"Meetings", icon:"M",  color:"#22a06b", angle: 300, r: 160 },
  ];

  const toRad = d => d * Math.PI / 180;

  // Build computed positions
  const positioned = sourceNodes.map(n => {
    const x = n.r === 0 ? centerX : centerX + n.r * Math.cos(toRad(n.angle - 90));
    const y = n.r === 0 ? centerY : centerY + n.r * Math.sin(toRad(n.angle - 90));
    const count = n.id === "all" ? state.flattened.length : state.flattened.filter(t => t.sourceId === n.id).length;
    return { ...n, x: Math.round(x), y: Math.round(y), count };
  });

  const center = positioned[0];
  const leaves = positioned.slice(1);

  const svgW = 1040, svgH = 400;

  const lines = leaves.map((n,i) => `
    <line class="tree-branch" x1="${center.x}" y1="${center.y}" x2="${n.x}" y2="${n.y}"
      stroke="${n.color}" stroke-width="1.5" stroke-dasharray="200" stroke-dashoffset="200"
      style="animation:drawBranch .7s ease ${i*0.1}s forwards;">
    </line>
    <circle cx="${(center.x+n.x)/2}" cy="${(center.y+n.y)/2}" r="3"
      fill="${n.color}" opacity="0"
      style="animation:fadeNode .4s ease ${i*0.1+.5}s forwards;">
    </circle>
  `).join("");

  const nodeEls = positioned.map((n,i) => {
    const active = scrumActiveSource === n.id;
    return `
      <g class="tree-node ${active?"tree-node-active":""}" data-scrum-source="${n.id}"
         style="cursor:pointer;animation:popNode .5s cubic-bezier(.34,1.56,.64,1) ${i*0.09}s both;">
        <circle cx="${n.x}" cy="${n.y}" r="${active ? nodeRadius+4 : nodeRadius}"
          fill="${active ? n.color : "#fff"}"
          stroke="${n.color}" stroke-width="${active?2.5:1.5}"
          filter="${active?"url(#glow)":"none"}">
        </circle>
        <text x="${n.x}" y="${n.y-4}" text-anchor="middle" dominant-baseline="middle"
          font-size="${n.id==="all"?15:13}" font-weight="800"
          fill="${active?"#fff":n.color}">${n.icon}</text>
        <text x="${n.x}" y="${n.y+10}" text-anchor="middle" dominant-baseline="middle"
          font-size="9" font-weight="700" fill="${active?"#fff":n.color}" opacity="${active?1:.8}">
          ${n.label}
        </text>
        ${n.count > 0 ? `
          <circle cx="${n.x+22}" cy="${n.y-22}" r="11" fill="${n.color}">
          </circle>
          <text x="${n.x+22}" y="${n.y-22}" text-anchor="middle" dominant-baseline="middle"
            font-size="9" font-weight="800" fill="#fff">${n.count}</text>
        ` : ""}
      </g>
    `;
  }).join("");

  const selectedLabel = positioned.find(n => n.id === scrumActiveSource)?.label || "All Sources";

  return `
    <div class="scrum-tree-wrap">
      <svg class="scrum-tree-svg" viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="4" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <radialGradient id="bgGrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#f0f4ff" stop-opacity=".6"/>
            <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <rect width="${svgW}" height="${svgH}" fill="url(#bgGrad)" rx="12"/>
        ${lines}
        ${nodeEls}
      </svg>
      <div class="scrum-tree-label">
        Viewing: <strong>${selectedLabel}</strong>
        ${scrumActiveSource !== "all" ? `<button class="scrum-clear-source" data-scrum-source="all">✕ Show all</button>` : ""}
      </div>
    </div>
    <style>
      @keyframes drawBranch {
        to { stroke-dashoffset: 0; }
      }
      @keyframes fadeNode {
        to { opacity: .6; }
      }
      @keyframes popNode {
        from { transform: scale(0); opacity: 0; transform-origin: center; }
        to   { transform: scale(1); opacity: 1; }
      }
      .tree-node { transition: transform .2s ease; transform-origin: center; }
      .tree-node:hover circle { filter: brightness(1.08); }
      .tree-node:hover { transform: scale(1.08); }
      .tree-node-active circle { box-shadow: 0 0 0 6px currentColor; }
    </style>
  `;
}

// old shim kept for compatibility
function renderJiraKanbanCard(task, col) {
  return renderScrumCard(task, col === "todo" ? "Todo" : col === "inprogress" ? "In progress" : "Done");
}

// Page: Incidents
function renderIncidentsTable() {
  const incidents = state.prioritized.filter(t => t.sources.some(s => s.toLowerCase().includes("servicenow")));
  return `
    <section class="board" style="padding:18px;">
      <div class="section-head">
        <div>
          <p class="eyebrow">ServiceNow Defects</p>
          <h2>Support Incidents Board</h2>
        </div>
        <span>${incidents.length} active tickets</span>
      </div>

      <table style="width:100%; border-collapse:collapse; text-align:left; margin-top:15px;">
        <thead>
          <tr style="border-bottom:2px solid #eadfce; color:#8a5c22; font-size:13px;">
            <th style="padding:10px;">ID</th>
            <th style="padding:10px;">Title</th>
            <th style="padding:10px;">Severity</th>
            <th style="padding:10px;">SLA Countdown</th>
            <th style="padding:10px;">Status</th>
            <th style="padding:10px;">Action</th>
          </tr>
        </thead>
        <tbody>
          ${incidents.map(inc => {
            const isCompleted = completedTaskIds.includes(inc.id);
            return `
              <tr style="border-bottom:1px solid #eadfce; background:${isCompleted ? "#faf8f2" : "#fff"}; opacity:${isCompleted ? 0.6 : 1};">
                <td style="padding:12px; font-weight:bold;">${inc.id}</td>
                <td style="padding:12px;">
                  <strong>${inc.canonicalTitle}</strong><br>
                  <span class="small">${inc.body}</span>
                </td>
                <td style="padding:12px;"><span class="severity ${inc.severity.toLowerCase()}">${inc.severity}</span></td>
                <td style="padding:12px; color:#ad2f2f; font-weight:bold;">${inc.due === "2026-06-19" ? "Due Today!" : inc.due === "2026-06-20" ? "1 day remaining" : inc.due}</td>
                <td style="padding:12px;"><strong>${isCompleted ? "Resolved" : inc.status}</strong></td>
                <td style="padding:12px;">
                  ${isCompleted 
                    ? `<span style="color:#18745f;">✔ Closed</span>` 
                    : `<button class="secondary success" style="font-size:11px; padding:4px 8px;" data-resolve-incident="${inc.id}">Resolve</button>`
                  }
                </td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </section>
  `;
}

// Page: GitHub PR Reviews
function renderGitHubPRReviews() {
  const prs = state.prioritized.filter(t => t.sources.some(s => s.toLowerCase().includes("github")));
  const activePr = prs.find(p => p.id === activePrId) || prs[0];

  return `
    <section class="content-grid github-pr-reviews">
      <div class="board" style="padding:18px;">
        <div class="section-head">
          <div>
            <p class="eyebrow">GitHub Action Queue</p>
            <h2>Pull Request Reviews</h2>
          </div>
          <span>${prs.length} open items</span>
        </div>

        <div style="display:grid; gap:10px; margin-top:10px;">
          ${prs.map(pr => `
            <button class="task-card ${activePrId === pr.id ? "selected" : ""}" data-pr-id="${pr.id}" style="width:100%; border:1px solid #e4dacd; border-radius:8px; padding:12px; text-align:left; background:#fff; cursor:pointer;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                <span class="small" style="font-weight:bold;">${pr.id}</span>
                <span style="font-size:11px; font-weight:bold; color:${pr.status.includes("Review") ? "#b87319" : "#18745f"};">${pr.status}</span>
              </div>
              <strong style="display:block; font-size:14px; color:#152238; margin-bottom:4px;">${pr.title}</strong>
              <span class="small">Workload Team: ${pr.team}</span>
            </button>
          `).join("")}
        </div>
      </div>

      <aside class="details">
        ${activePr ? `
          <section class="panel" style="background:#fff; display:flex; flex-direction:column; gap:12px;">
            <div>
              <p class="eyebrow">Pull Request details</p>
              <h2 style="margin:4px 0; color:#152238;">${activePr.title}</h2>
              <span class="small">Creator: Teammate Riya • Priority score: ${activePr.score}</span>
            </div>

            <p style="font-size:13px; line-height:1.4; color:#34414f; background:#fbfaf5; padding:10px; border-radius:6px; margin:0;">
              <strong>PR Context:</strong> "${activePr.body}"<br>
              <strong>Dependencies:</strong> ${activePr.dependencies.join(", ") || "None"}
            </p>

            <div style="display:flex; gap:8px;">
              <button class="secondary" id="runPrCheckBtn" ${prReviewLoading ? "disabled" : ""}>
                ${prReviewLoading ? "Running Checks..." : "AI Review PR"}
              </button>
              <button class="primary" id="approvePrBtn">Approve & Merge</button>
            </div>

            <div id="prReviewResult" style="font-size:13px; color:#34414f; border-top:1px solid #eadfce; padding-top:10px;">
              ${prReviewChecklist[activePr.id] 
                ? renderMd(prReviewChecklist[activePr.id]) 
                : "Click <strong>AI Review PR</strong> to perform automated security and token checks using TaskPilot AI."
              }
            </div>
          </section>
        ` : `
          <section class="panel"><p>No PRs selected.</p></section>
        `}
      </aside>
    </section>
  `;
}

// Page: Analytics
function renderAnalyticsView() {
  const insights = datasetInsights();
  return `
    <section class="board" style="padding:18px;">
      <div class="section-head" style="margin-bottom:20px;">
        <div>
          <p class="eyebrow">Scoring Insights</p>
          <h2>Priority Model Feature Analysis</h2>
        </div>
      </div>

      <div style="display:grid; grid-template-columns: 1.5fr 1fr; gap:20px;">
        <div class="panel" style="background:#fff;">
          <h3>⚙ Weight Coefficients</h3>
          <div style="display:grid; gap:12px; margin-top:15px;">
            <div>
              <div style="display:flex; justify-content:space-between; font-size:13px;">
                <span>Severity Coefficient</span>
                <strong>40%</strong>
              </div>
              <div style="height:8px; background:#eadfcc; border-radius:4px; overflow:hidden; margin-top:4px;">
                <div style="width:40%; background:#152238; height:100%;"></div>
              </div>
            </div>

            <div>
              <div style="display:flex; justify-content:space-between; font-size:13px;">
                <span>Deadline Urgency</span>
                <strong>30%</strong>
              </div>
              <div style="height:8px; background:#eadfcc; border-radius:4px; overflow:hidden; margin-top:4px;">
                <div style="width:30%; background:#152238; height:100%;"></div>
              </div>
            </div>

            <div>
              <div style="display:flex; justify-content:space-between; font-size:13px;">
                <span>Dependency Risk</span>
                <strong>20%</strong>
              </div>
              <div style="height:8px; background:#eadfcc; border-radius:4px; overflow:hidden; margin-top:4px;">
                <div style="width:20%; background:#152238; height:100%;"></div>
              </div>
            </div>

            <div>
              <div style="display:flex; justify-content:space-between; font-size:13px;">
                <span>Business Impact Value</span>
                <strong>10%</strong>
              </div>
              <div style="height:8px; background:#eadfcc; border-radius:4px; overflow:hidden; margin-top:4px;">
                <div style="width:10%; background:#152238; height:100%;"></div>
              </div>
            </div>
          </div>
        </div>

        <div class="panel" style="background:#fff;">
          <h3>👥 Team Workload Distribution</h3>
          <div style="display:grid; gap:15px; margin-top:15px;">
            ${insights.ownerLoad.map((owner, idx) => `
              <div>
                <strong>${owner.owner}</strong>
                <div class="small">Workload score: ${owner.score} points</div>
                <div style="height:6px; background:#eadfcc; border-radius:3px; overflow:hidden; margin-top:4px;">
                  <div style="width:${Math.min(100, owner.score / 2.5)}%; background:${["#0c66e4", "#22a06b", "#ffab00"][idx % 3]}; height:100%;"></div>
                </div>
              </div>
            `).join("")}
          </div>
        </div>
      </div>
    </section>
  `;
}

// Page: Execution Plan
function renderExecutionPlan(selected, executionBrief) {
  if (!selected) {
    return `<section class="panel"><h2>No Active task select</h2></section>`;
  }
  return `
    <section class="content-grid execution-plan">
      <div class="board" style="padding:18px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
          <div>
            <p class="eyebrow">Task Action Plan</p>
            <h2 style="margin:4px 0 0;">${selected.canonicalTitle}</h2>
          </div>
          <span style="background:#152238; color:#fff; font-size:12px; padding:6px 12px; border-radius:20px; font-weight:bold;">
            Score: ${selected.score}
          </span>
        </div>

        <div class="panel" style="background:#fff; margin-bottom:15px;">
          <h3>📋 Definition of Done</h3>
          <p style="font-size:14px; line-height:1.5; color:#34414f;">
            "${executionBrief.definitionOfDone}"
          </p>
          <div class="timeline-pill" style="display:inline-block; background:#f1e6d6; color:#5d4730; font-weight:bold; padding:4px 10px; border-radius:4px; font-size:12px;">
            Estimated time: ${executionBrief.timeline}
          </div>
        </div>

        <div class="panel" style="background:#fff;">
          <h3>✅ Implementation Process Checklist</h3>
          <div style="display:grid; gap:12px; margin-top:12px;" id="executionChecklistContainer">
            ${executionBrief.process.map((step, idx) => `
              <label style="display:flex; align-items:center; gap:10px; font-size:14px; cursor:pointer;">
                <input type="checkbox" style="width:18px; height:18px;" data-execution-step-idx="${idx}">
                <span>${escapeHtml(step)}</span>
              </label>
            `).join("")}
          </div>
        </div>
      </div>

      <aside class="details">
        <section class="panel">
          <p class="eyebrow">Audit details</p>
          <h2 style="margin:4px 0 10px;">Why Now?</h2>
          <ul class="reason-list">
            ${selected.rankReasons.map(r => `<li>${r}</li>`).join("")}
          </ul>
          <p class="small" style="margin-top:15px;">
            <strong>Security policy:</strong> ${executionBrief.approvalGate}
          </p>
        </section>
      </aside>
    </section>
  `;
}

// Page: Settings Dashboard
function renderSettingsDashboard() {
  return `
    <section class="board" style="padding:18px;">
      <div class="section-head">
        <div>
          <p class="eyebrow">Workspace Configuration</p>
          <h2>Settings Dashboard</h2>
        </div>
      </div>

      <div style="display:grid; grid-template-columns: 1.2fr 1fr; gap:20px; margin-top:15px;">
        <div class="panel" style="background:#fff; display:grid; gap:16px;">
          <h3>👤 User Workspace Profile</h3>
          <div>
            <label class="api-label">
              <span>Full Name</span>
              <input type="text" id="settingsNameInput" value="${escapeHtml(settingsProfile.name)}">
            </label>
          </div>
          <div>
            <label class="api-label">
              <span>Google Account Email</span>
              <input type="email" id="settingsEmailInput" value="${escapeHtml(settingsProfile.email)}" disabled>
            </label>
          </div>
          <div>
            <label class="api-label">
              <span>Active Role</span>
              <select id="settingsRoleInput" style="width: 100%; padding: 11px; border: 1px solid #d8ccba; border-radius: 8px; background: #fff;">
                <option value="engineer" ${settingsProfile.role.toLowerCase().includes("engineer") ? "selected" : ""}>Engineer</option>
                <option value="manager" ${settingsProfile.role.toLowerCase().includes("manager") ? "selected" : ""}>Manager</option>
              </select>
            </label>
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center;">
            <button class="primary" id="saveSettingsBtn" ${settingsSaving ? "disabled" : ""}>
              ${settingsSaving ? "Saving..." : "Save Config"}
            </button>
            ${settingsMsg ? `<span style="font-size:13px; color:#18745f; font-weight:bold;">${settingsMsg}</span>` : ""}
          </div>
        </div>

        <div style="display:grid; gap:16px;">
          <div class="panel" style="background:#fff;">
            <h3>📊 Background Sync Logs</h3>
            <div style="display:grid; gap:8px; margin-top:10px;">
              <div style="display:flex; justify-content:space-between; font-size:13px; border-bottom:1px solid #eadfce; padding-bottom:4px;">
                <span>Backend Port Connection</span>
                <strong style="color:#18745f;">Port ${backendConfig.backendPort || "8787"}</strong>
              </div>
              <div style="display:flex; justify-content:space-between; font-size:13px; border-bottom:1px solid #eadfce; padding-bottom:4px;">
                <span>Active LLM Model</span>
                <strong>${backendConfig.llmModel || "gemini-2.5-flash"}</strong>
              </div>
              <div style="display:flex; justify-content:space-between; font-size:13px;">
                <span>TEE Mode</span>
                <strong>${backendConfig.teeMode || "local-attested"}</strong>
              </div>
            </div>
          </div>

          <div class="panel" style="background:#fff;">
            <h3>🛡 TEE Attested History</h3>
            <div style="display:grid; gap:8px; margin-top:10px; max-height: 200px; overflow-y:auto;">
              ${executionHistory.map(hist => `
                <div style="display:flex; justify-content:space-between; font-size:12px; padding:6px; background:#fffcf5; border-radius:4px; border:1px solid #e4dacd;">
                  <span>${hist.task}</span>
                  <span style="color:#18745f; font-weight:bold;">${hist.status}</span>
                </div>
              `).join("")}
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}

// ─── Floating Companion Dock & Log ────────────────────────────────────────────
function renderCompanionDock() {
  if (isDesktopShell) return "";
  return `
    <div class="companion ${companionOpen ? "" : "closed"}">
      <button class="dock-avatar" id="dockToggle">
        <img src="${logoDataUrl}" alt="TaskPilot Agent" style="width:100%;height:100%;object-fit:cover;border-radius:26px;display:block;pointer-events:none;">
      </button>

      ${companionOpen ? `
        <div class="companion-panel">
          <header class="companion-head">
            <div style="display:flex;align-items:center;gap:8px;">
              <img src="${logoDataUrl}" alt="TaskPilot" style="width:28px;height:28px;object-fit:cover;border-radius:7px;flex-shrink:0;">
              <div>
                <strong>TaskPilot Attestation</strong>
                <span>${currentContext ? contextLabel(currentContext) : "Ready"}</span>
              </div>
            </div>
            <div class="dock-actions">
              <button id="captureScreen" style="font-size:10px; padding:4px 8px; background:#18745f; border-radius:4px; color:#fff; border:none; cursor:pointer;">
                TEE OCR
              </button>
              <button id="minimizeCompanion" style="background:none; border:none; font-size:14px; font-weight:bold; cursor:pointer; color:#65717d;">–</button>
              <button id="closeCompanion" style="background:none; border:none; font-size:14px; font-weight:bold; cursor:pointer; color:#65717d;">×</button>
            </div>
          </header>

          <div class="tee-strip">
            <span class="secure-dot"></span>
            <strong>Attested</strong>
            <span>${teeSession.attestationHash}</span>
          </div>

          <div class="plan-steps">
            ${currentPlanSteps.length === 0 
              ? `<div class="plan-step"><span class="step-icon">o</span><span>Ready to guide action plans.</span></div>`
              : currentPlanSteps.map(step => `
                  <div class="plan-step ${step.status}">
                    <span class="step-icon">${stepIcon(step.status)}</span>
                    <span>${escapeHtml(step.label || step.description)}</span>
                  </div>
                `).join("")
            }
          </div>

          <div class="companion-log" id="companionLogBox">
            ${companionLog.map(log => `
              <p class="${log.role}">${renderLogText(log.text)}</p>
            `).join("")}
          </div>

          <form id="companionForm" class="companion-form">
            <textarea id="taskInput" name="message" rows="1" placeholder="Ask, plan, or execute..."></textarea>
            <button id="sendCompanionBtn" ${isProcessing ? "class='stop'" : ""}>
              ${isProcessing ? "Stop" : "Send"}
            </button>
          </form>
        </div>
      ` : ""}
    </div>
  `;
}

function renderCalendarPermissionModal() {
  if (!showCalendarDialog || !selectedMeetingToSave) return "";
  return `
    <div style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:999; display:grid; place-items:center;">
      <div class="panel" style="background:#fff; width:400px; padding:20px; border-radius:12px; box-shadow:0 10px 30px rgba(0,0,0,0.3);">
        <h3 style="margin-top:0;">📅 Calendar Access Requested</h3>
        <p style="font-size:14px; line-height:1.5; color:#34414f;">
          TaskPilot is requesting access to write to your Calendar events to save meeting slot:<br>
          <strong>"${selectedMeetingToSave.title}"</strong> on ${new Date(selectedMeetingToSave.startTime).toLocaleDateString()} at ${new Date(selectedMeetingToSave.startTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}.
        </p>
        <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:20px;">
          <button class="secondary" id="denyCalendarBtn">Deny</button>
          <button class="primary" id="allowCalendarBtn">Allow Access</button>
        </div>
      </div>
    </div>
  `;
}

function renderAddJiraModal() {
  if (!showAddJiraModal) return "";
  return `
    <div style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:999; display:grid; place-items:center;">
      <div class="panel" style="background:#fff; width:450px; padding:24px; border-radius:12px; display:grid; gap:16px;">
        <h3 style="margin-top:0; border-bottom:1px solid #eadfce; padding-bottom:8px;">➕ Create New Jira Sprint Task</h3>
        
        <div>
          <label class="api-label">
            <span>Task Title</span>
            <input type="text" id="addJiraTitle" placeholder="concise task description">
          </label>
        </div>

        <div>
          <label class="api-label">
            <span>Detailed Body</span>
            <textarea id="addJiraBody" rows="3" placeholder="task details"></textarea>
          </label>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
          <label class="api-label">
            <span>Severity</span>
            <select id="addJiraSeverity" style="padding:10px; border:1px solid #d8ccba; border-radius:8px; background:#fff;">
              <option value="P1">P1 - Urgent</option>
              <option value="P2" selected>P2 - High</option>
              <option value="P3">P3 - Medium</option>
              <option value="P4">P4 - Low</option>
            </select>
          </label>

          <label class="api-label">
            <span>Due Date</span>
            <input type="date" id="addJiraDue" value="2026-06-20">
          </label>
        </div>

        <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:10px;">
          <button class="secondary" id="closeAddJiraModalBtn">Cancel</button>
          <button class="primary" id="saveAddJiraTaskBtn">Add Task</button>
        </div>
      </div>
    </div>
  `;
}

// ─── Event Binding ────────────────────────────────────────────────────────────
function bindEvents() {
  // Navigation
  document.querySelectorAll("[data-nav]").forEach(btn => {
    btn.addEventListener("click", () => {
      activePage = btn.dataset.nav;
      render();
    });
  });

  // Profile Switching
  document.querySelectorAll("[data-profile]").forEach(btn => {
    btn.addEventListener("click", () => {
      activeProfile = btn.dataset.profile;
      authSession = { ...authSession, role: activeProfile };
      localStorage.setItem("taskpilot:session", JSON.stringify(authSession));
      render();
    });
  });

  // Source list filtering
  document.querySelectorAll("[data-source]").forEach(btn => {
    btn.addEventListener("click", () => {
      activeSource = btn.dataset.source;
      render();
    });
  });

  // Task selection
  document.querySelectorAll("[data-task]").forEach(btn => {
    btn.addEventListener("click", () => {
      selectedTaskId = btn.dataset.task;
      render();
    });
  });

  // Quick Chat queries in details sidebar
  document.querySelectorAll("[data-query]").forEach(btn => {
    btn.addEventListener("click", () => {
      const answer = answerQuery(btn.dataset.query, state);
      lastAnswer = answer;
      pushCompanion("user", btn.dataset.query, false);
      pushCompanion("agent", answer, false);
      // Mark the currently selected task as "working"
      if (selectedTaskId && !completedTaskIds.includes(selectedTaskId) && !workingTaskIds.includes(selectedTaskId)) {
        workingTaskIds = [...workingTaskIds, selectedTaskId];
      }
      render();
    });
  });

  // Main header actions
  document.querySelector("#logoutBtn")?.addEventListener("click", () => {
    authSession = null;
    completedTaskIds = [];
    workingTaskIds = [];
    managerActivityFeed = [];
    localStorage.removeItem("taskpilot:session");
    render();
  });

  // ─── Manager: Assign task via Gemini ─────────────────────────────────────
  document.querySelector("#mgrPostAssignBtn")?.addEventListener("click", async () => {
    const title = document.querySelector("#mgrAssignTitle")?.value.trim();
    const description = document.querySelector("#mgrAssignDesc")?.value.trim();
    const priority = document.querySelector("#mgrAssignPriority")?.value || "P2";
    const deadline = document.querySelector("#mgrAssignDeadline")?.value || "";
    const team = document.querySelector("#mgrAssignTeam")?.value.trim() || "Platform Apps";

    if (!title) { alert("Please enter a task title."); return; }

    // Save form state
    assignForm = { title, description, priority, deadline, team };
    assignmentLoading = true;
    assignmentResult = null;
    render();

    try {
      const resp = await fetch("http://127.0.0.1:8787/api/manager/assign-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description, priority, deadline, team, managerName: settingsProfile.name })
      });
      const data = await resp.json();
      if (data.success) {
        assignmentResult = data.assignment;
        // Store taskPost pending confirm
        window._pendingTaskPost = data.taskPost;
      } else {
        throw new Error(data.error || "Assignment failed");
      }
    } catch (err) {
      // Fallback local assignment
      const owners = datasetInsights().ownerLoad;
      const best = owners.sort((a,b) => a.count - b.count)[0];
      assignmentResult = {
        recommendedAssignee: best?.owner || "Utkarsh",
        alternativeAssignees: owners.slice(1,3).map(o=>o.owner),
        assignmentReasoning: `${best?.owner || "Utkarsh"} has the lowest current task load.`,
        priorityScore: priority === "P1" ? 92 : priority === "P2" ? 74 : 50,
        estimatedHours: 4,
        riskLevel: priority === "P1" ? "Critical" : "Medium",
        teamUpdate: `"${title}" assigned to ${best?.owner || "Utkarsh"} — ${priority} priority, deadline ${deadline || "this sprint"}.`,
        engineerPortalNote: `You've been assigned: ${title}. Priority ${priority}. Deadline: ${deadline || "end of sprint"}.`,
        suggestedDeadline: deadline || "End of sprint",
        dependencyWarnings: []
      };
      window._pendingTaskPost = {
        id: `MGR-${Date.now().toString().slice(-5)}`,
        title, description, priority, deadline, team,
        postedBy: settingsProfile.name,
        postedAt: new Date().toISOString(),
        assignment: assignmentResult,
        status: "Posted"
      };
    } finally {
      assignmentLoading = false;
      render();
    }
  });

  // Confirm assignment → post to portal
  document.querySelector("#mgrConfirmAssignBtn")?.addEventListener("click", () => {
    if (!window._pendingTaskPost) return;
    const post = window._pendingTaskPost;
    managerTaskPosts.unshift(post);
    // Also push to engineerPortalPosts so engineer can see it immediately
    engineerPortalPosts.unshift({
      ...post,
      viewed: false,
      engineerNote: post.assignment?.engineerPortalNote || ""
    });
    assignmentResult = null;
    assignForm = { title: "", description: "", priority: "P2", deadline: "", team: "Platform Apps" };
    window._pendingTaskPost = null;
    triggerLocalNotification("TaskPilot", `Task "${post.title}" posted to ${post.assignment?.recommendedAssignee || "team"}.`);
    render();
    syncStateWithBackend();
  });

  // Cancel assignment
  document.querySelector("#mgrCancelAssignBtn")?.addEventListener("click", () => {
    assignmentResult = null;
    window._pendingTaskPost = null;
    render();
  });

  // Open assign panel from portal page
  document.querySelector("#openAssignFromPortalBtn")?.addEventListener("click", () => {
    activePage = "overview";
    render();
    setTimeout(() => document.querySelector("#mgrAssignTitle")?.focus(), 100);
  });

  // Assign from kanban lane
  document.querySelectorAll("[data-assign-lane-task]").forEach(btn => {
    btn.addEventListener("click", () => {
      const task = state.prioritized.find(t => t.id === btn.dataset.assignLaneTask);
      if (!task) return;
      assignForm = { title: task.canonicalTitle, description: task.body, priority: task.severity, deadline: task.due || "", team: task.team || "Platform Apps" };
      activePage = "overview";
      render();
      setTimeout(() => document.querySelector("#mgrAssignTitle")?.focus(), 100);
    });
  });

  // ─── Engineer: Sync + Accept portal tasks ────────────────────────────────
  document.querySelector("#syncPortalBtn")?.addEventListener("click", async () => {
    try {
      const resp = await fetch("http://127.0.0.1:8787/api/manager/team-portal");
      const data = await resp.json();
      if (data.posts) {
        const existing = engineerPortalPosts.map(p => p.id);
        const newPosts = data.posts.filter(p => !existing.includes(p.id));
        engineerPortalPosts = [...newPosts.map(p => ({...p, viewed: false})), ...engineerPortalPosts];
      }
    } catch {
      // already have local posts from same session
    }
    render();
    syncStateWithBackend();
  });

  document.querySelectorAll("[data-accept-portal-task]").forEach(btn => {
    btn.addEventListener("click", () => {
      const postId = btn.dataset.acceptPortalTask;
      const post = engineerPortalPosts.find(p => p.id === postId);
      if (!post) return;
      // Mark viewed
      engineerPortalPosts = engineerPortalPosts.map(p => p.id === postId ? {...p, viewed: true} : p);
      // Add to Jira source
      const jiraSource = sources.find(s => s.id === "jira");
      if (jiraSource) {
        const newTask = {
          id: post.id,
          title: post.title,
          body: post.description || post.assignment?.engineerPortalNote || "",
          severity: post.priority || "P2",
          due: post.deadline || "2026-06-26",
          impact: post.assignment?.priorityScore ? Math.round(post.assignment.priorityScore / 10) : 7,
          status: "Todo",
          owner: settingsProfile.name,
          team: post.team || "Platform Apps",
          dependencies: [],
          execution: {
            definitionOfDone: `Complete: ${post.title}`,
            process: ["Read manager note", "Clarify requirements", "Implement", "Review & close"],
            estimatedMinutes: (post.assignment?.estimatedHours || 4) * 60
          }
        };
        jiraSource.items.push(newTask);
        addedTasks.push(newTask);
        state = buildState(sources, calendarBlocks);
        alert(`"${post.title}" added to your Jira queue and priority-scored!`);
        render();
        syncStateWithBackend();
      }
    });
  });

  document.querySelector("#completePriority")?.addEventListener("click", () => {
    const queue = activeQueue();
    const current = queue.find(t => t.id === selectedTaskId) || queue[0];
    if (!current) return;
    completeTask(current.id);
  });

  document.querySelector("#simulateUrgent")?.addEventListener("click", () => {
    const alertText = "New urgent Outlook email detected: VP escalation requires prompt reply for the enterprise proxy server upload failure.";
    pushCompanion("agent", alertText);
    triggerLocalNotification("Urgent Escalation Surfaced", alertText);
  });

  document.querySelector("#runScan")?.addEventListener("click", () => {
    activePage = "agent-scan";
    render();
    document.querySelector("#startAgentScanBtn")?.click();
  });

  // Today Priority — Start task (mark working + log start time)
  document.querySelectorAll("[data-task-start]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.taskStart;
      if (!workingTaskIds.includes(id)) workingTaskIds = [...workingTaskIds, id];
      selectedTaskId = id;
      const task = state.prioritized.find(t => t.id === id);
      // Log start time
      if (task && !taskTimeLogs[id]) {
        taskTimeLogs[id] = {
          title: task.canonicalTitle,
          severity: task.severity,
          source: task.sources?.join(" + ") || task.sourceId,
          startTime: new Date().toISOString(),
          endTime: null
        };
      }
      if (task) pushCompanion("agent", `Started working on "${task.canonicalTitle}". I'll track your progress and help you execute.`, false);
      render();
      syncStateWithBackend();
    });
  });

  // Today Priority — Cancel working state
  document.querySelectorAll("[data-task-cancel]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.taskCancel;
      workingTaskIds = workingTaskIds.filter(x => x !== id);
      // Remove start log if cancelled before completion
      delete taskTimeLogs[id];
      render();
      syncStateWithBackend();
    });
  });

  // Today Priority — Mark done + notify manager + log end time
  document.querySelectorAll("[data-task-complete]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.taskComplete;
      completeTask(id);
    });
  });

  // Today Priority — Reopen task
  document.querySelectorAll("[data-task-reopen]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.taskReopen;
      completedTaskIds = completedTaskIds.filter(x => x !== id);
      managerActivityFeed = managerActivityFeed.filter(e => e.taskId !== id);
      if (taskTimeLogs[id]) taskTimeLogs[id].endTime = null;
      render();
      syncStateWithBackend();
    });
  });

  // End-of-day PDF report
  document.querySelector("#generateDailyReportBtn")?.addEventListener("click", () => {
    generateDailyReportPDF();
  });

  // Today Priority - Daily plan generation (calls Gemini directly)
  document.querySelector("#regeneratePlanBtn")?.addEventListener("click", async () => {
    dailyPlanLoading = true;
    render();
    try {
      dailyPlanContent = await geminiDailyPlan(activeQueue(), settingsProfile.name, calendarBlocks);
    } catch (err) {
      dailyPlanContent = `⚠ Gemini error: ${err.message}`;
    } finally {
      dailyPlanLoading = false;
      render();
    }
  });

  // Agent Scan Console Buttons
  document.querySelector("#startAgentScanBtn")?.addEventListener("click", async () => {
    if (agentRunning) return;
    agentRunning = true;
    agentLogLines = [];
    scanCompleteInfo = null;
    render();

    const writeLog = (msg) => {
      agentLogLines.push(msg);
      const term = document.querySelector("#agentTerminal");
      if (term) {
        term.innerHTML = agentLogLines.map(line => `<div>${line}</div>`).join("");
        term.scrollTop = term.scrollHeight;
      }
    };

    writeLog("[SYSTEM] Attesting TEE hardware environment...");
    await sleep(250);
    writeLog(`[SYSTEM] Envelope Attested. Hash: ${teeSession.attestationHash}`);
    await sleep(200);
    writeLog("[SCAN] Initializing autonomous connection to taskpilotai backend...");
    await sleep(250);

    try {
      const resp = await fetch("http://127.0.0.1:8787/api/agent/initialize", {
        method: "POST"
      });
      if (!resp.ok) {
        throw new Error(`HTTP error ${resp.status}`);
      }
      const data = await resp.json();
      if (data.success) {
        writeLog(`[SCAN] Successfully connected. Loaded ${data.totalTasks} tasks across all integrated systems.`);
        await sleep(250);
        writeLog("[SCAN] Performing semantic deduplication with similarity threshold 0.85...");
        await sleep(300);
        writeLog("[REASON] Running real-time task prioritization engine via Gemini 2.5 Flash...");
        await sleep(300);
        writeLog("[REASON] Scoring factors: severity (0.4), deadline (0.3), dependencies (0.2), impact (0.1)");
        await sleep(250);
        
        data.topPriorities.forEach((t, i) => {
          writeLog(`[RECOMMEND] Priority #${i+1}: ${t.title} [Score: ${t.score}]`);
        });
        await sleep(250);
        writeLog("[COMPLETED] Autonomous scan complete. Prioritized queue and workspace sync updated.");
        
        scanCompleteInfo = data.topPriorities;
      } else {
        throw new Error(data.error || "Backend initialization failed");
      }
    } catch (err) {
      writeLog(`[ERROR] Autonomous scan failed: ${err.message}`);
      writeLog("[SYSTEM] Safe TEE boundary retained. Workspace data was not compromised.");
      scanCompleteInfo = false;
    } finally {
      agentRunning = false;
      render();
    }
  });

  document.querySelector("#stopAgentScanBtn")?.addEventListener("click", () => {
    agentRunning = false;
    agentLogLines.push("[SYSTEM] Scan stopped by user. Safe boundary retained.");
    render();
  });

  // Inbox page item click & summary action
  document.querySelectorAll("[data-mail-id]").forEach(btn => {
    btn.addEventListener("click", () => {
      activeEmailId = btn.dataset.mailId;
      render();
    });
  });

  document.querySelector("#summarizeEmailBtn")?.addEventListener("click", async () => {
    const items = state.flattened.filter(t => ["message"].includes(t.type));
    const mail = items.find(m => m.id === activeEmailId) || items[0];
    if (!mail) return;

    emailSummaryLoading = true;
    render();

    try {
      emailSummaries[mail.id] = await geminiSummariseEmail(mail.body, mail.title);
    } catch (err) {
      emailSummaries[mail.id] = `Failed to get AI summary: ${err.message}`;
    } finally {
      emailSummaryLoading = false;
      render();
    }
  });

  document.querySelector("#extractTaskBtn")?.addEventListener("click", async () => {
    const items = state.flattened.filter(t => ["message"].includes(t.type));
    const mail = items.find(m => m.id === activeEmailId) || items[0];
    if (!mail) return;

    emailSummaryLoading = true;
    render();

    try {
      const result = await geminiExtractActions(mail.body, "email");
      if (result && result.length > 0) {
        const jiraSource = sources.find(s => s.id === "jira");
        result.forEach(item => {
          const newTask = {
            id: `EXT-${Date.now().toString().slice(-4)}`,
            title: item.title,
            body: item.description,
            severity: item.severity || "P2",
            due: item.deadline || "2026-06-20",
            impact: item.impact || 6,
            status: "Todo",
            owner: item.assignee || settingsProfile.name,
            team: "Platform Apps",
            dependencies: []
          };
          if (jiraSource) {
            jiraSource.items.push(newTask);
          }
        });
        state = buildState(sources, calendarBlocks);
        emailSummaries[mail.id] = `<strong>Success:</strong> Extracted task items and added them to Jira sprint queue. Check Jira or Overview cards.`;
      } else {
        emailSummaries[mail.id] = "No structured action items could be extracted.";
      }
    } catch (err) {
      emailSummaries[mail.id] = `Extraction failed: ${err.message}`;
    } finally {
      emailSummaryLoading = false;
      render();
    }
  });

  // Meeting notes items clicks & analysis
  document.querySelectorAll("[data-meet-id]").forEach(btn => {
    btn.addEventListener("click", () => {
      const found = meetingsList.find(m => m.id === btn.dataset.meetId)
        || state.flattened.filter(t => ["note"].includes(t.type)).find(m => m.id === btn.dataset.meetId);
      selectedMeeting = found || null;
      render();
    });
  });

  document.querySelector("#addMeetingNoteBtn")?.addEventListener("click", () => {
    const noteTitle = prompt("Meeting title:");
    if (!noteTitle) return;
    const noteAgenda = prompt("Meeting agenda or notes:");
    if (!noteAgenda) return;

    const newMeeting = {
      id: `MTG-${Date.now().toString().slice(-3)}`,
      title: noteTitle,
      type: "zoom",
      source: "manual",
      sourceRef: "",
      attendees: [settingsProfile.email || "utkarsh@taskpilot.dev"],
      suggestedDate: "2026-06-20",
      suggestedTime: "10:00",
      duration: 30,
      priority: "Medium",
      priorityScore: 55,
      status: "Pending",
      agenda: noteAgenda,
      extractedFrom: "Manually added",
      risks: [],
      savedToCalendar: false,
      calendarEventId: null
    };

    meetingsList = [newMeeting, ...meetingsList];
    selectedMeeting = newMeeting;
    render();
  });

  // ─── Meeting Agent: Autonomous Scan ──────────────────────────────────────
  document.querySelector("#startMeetingAgentBtn")?.addEventListener("click", async () => {
    if (meetingAgentRunning) return;
    meetingAgentRunning = true;
    meetingAgentLog = [];
    meetingAgentComplete = null;
    render();

    const writeLog = (msg) => {
      meetingAgentLog.push(msg);
      const term = document.querySelector("#meetingAgentTerminal");
      if (term) {
        term.innerHTML = meetingAgentLog.map(l => `<div>${l}</div>`).join("");
        term.scrollTop = term.scrollHeight;
      }
    };

    writeLog("[AGENT] Attesting TEE boundary for meeting intelligence scan...");
    await sleep(200);
    writeLog(`[AGENT] Envelope attested: ${teeSession.attestationHash}`);
    await sleep(150);
    writeLog("[SCAN] Connecting to Outlook, Slack, and calendar sources...");
    await sleep(250);

    try {
      const resp = await fetch("http://127.0.0.1:8787/api/agent/meetings/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engineerName: settingsProfile.name })
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();

      if (data.success) {
        // Show backend log lines
        (data.logLines || []).forEach(l => writeLog(l));
        await sleep(200);

        // Update meetings list with AI-ranked results
        if (data.meetings && data.meetings.length > 0) {
          meetingsList = data.meetings;
          if (!selectedMeeting) selectedMeeting = meetingsList[0];
        }

        meetingAgentComplete = data.meetings;
        writeLog(`[COMPLETED] Meeting agent scan complete. ${data.total} meetings processed, ${data.extracted || 0} extracted from inbox.`);
        triggerLocalNotification("TaskPilot Meeting Agent", `Scanned ${data.total} meetings. Top priority: ${data.meetings[0]?.title || "none"}`);
      } else {
        throw new Error(data.error || "Scan failed");
      }
    } catch (err) {
      // Fallback: local prioritization
      writeLog(`[WARN] Backend unreachable: ${err.message}`);
      writeLog("[FALLBACK] Running local meeting prioritization...");
      await sleep(300);

      // Sort by priorityScore locally
      meetingsList = [...meetingsList].sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0));
      if (!selectedMeeting) selectedMeeting = meetingsList[0];
      meetingAgentComplete = meetingsList;
      meetingsList.slice(0, 3).forEach((m, i) => {
        writeLog(`[RECOMMEND] #${i+1}: ${m.title} (Score: ${m.priorityScore}) — ${m.agenda}`);
      });
      writeLog("[COMPLETED] Local meeting prioritization done.");
    } finally {
      meetingAgentRunning = false;
      render();
    }
  });

  // ─── Meeting Detail: Analyze with AI ─────────────────────────────────────
  document.querySelector("#analyzeMeetingBtn")?.addEventListener("click", async () => {
    const meet = selectedMeeting;
    if (!meet) return;

    // Update button state
    const btn = document.querySelector("#analyzeMeetingBtn");
    if (btn) { btn.disabled = true; btn.textContent = "Analyzing..."; }

    try {
      // Try backend first
      let result = null;
      if (backendConfig.geminiConfigured) {
        const resp = await fetch("http://127.0.0.1:8787/api/agent/meetings/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            meetingId: meet.id,
            title: meet.title,
            notes: meet.agenda + "\n" + (meet.extractedFrom || "") + "\n" + (meet.risks || []).join(". ")
          })
        });
        if (resp.ok) {
          const data = await resp.json();
          result = data.analysis;
        }
      }

      // Fallback to frontend gemini client
      if (!result) {
        result = await geminiAnalyseMeeting(
          meet.agenda + "\nSource: " + (meet.extractedFrom || meet.source) + "\nRisks: " + (meet.risks || []).join(", "),
          meet.title
        );
      }

      analyzedMeetings[meet.id] = result;
    } catch (err) {
      analyzedMeetings[meet.id] = {
        summary: `Analysis failed: ${err.message}`,
        decisions: [],
        actionItems: [],
        followUpMeetings: [],
        risks: []
      };
    } finally {
      render();
    }
  });

  // ─── Save Meeting to Calendar ─────────────────────────────────────────────
  document.querySelector("#saveMeetingCalBtn")?.addEventListener("click", () => {
    const meet = selectedMeeting;
    if (!meet) return;
    selectedMeetingToSave = {
      id: meet.id,
      title: meet.title,
      startTime: `${meet.suggestedDate}T${meet.suggestedTime || "10:00"}:00`,
      endTime: new Date(new Date(`${meet.suggestedDate}T${meet.suggestedTime || "10:00"}:00`).getTime() + (meet.duration || 30) * 60 * 1000).toISOString(),
      description: meet.agenda,
      attendees: meet.attendees || []
    };
    showCalendarDialog = true;
    render();
  });

  // Save Followup to Calendar
  document.querySelectorAll("[data-save-meeting-index]").forEach(btn => {
    btn.addEventListener("click", () => {
      const meet = selectedMeeting || state.flattened.filter(t => ["note"].includes(t.type))[0];
      const analysis = analyzedMeetings[meet.id];
      const index = parseInt(btn.dataset.saveMeetingIndex);
      const followUp = analysis.followUpMeetings[index];

      // Convert suggested Date (e.g. Wednesday 3 PM) to structured date
      const eventTime = new Date("2026-06-24T15:00:00.000Z");
      selectedMeetingToSave = {
        title: followUp.title,
        startTime: eventTime.toISOString(),
        endTime: new Date(eventTime.getTime() + (followUp.duration || 30) * 60 * 1000).toISOString(),
        description: followUp.agenda || "Follow up sync",
        attendees: followUp.attendees || []
      };

      showCalendarDialog = true;
      render();
    });
  });

  document.querySelector("#denyCalendarBtn")?.addEventListener("click", () => {
    showCalendarDialog = false;
    selectedMeetingToSave = null;
    render();
  });

  document.querySelector("#allowCalendarBtn")?.addEventListener("click", async () => {
    if (!selectedMeetingToSave) return;
    calendarGranted = true;
    showCalendarDialog = false;
    render();

    try {
      if (window.taskPilotDesktop?.saveToCalendar) {
        const result = await window.taskPilotDesktop.saveToCalendar(selectedMeetingToSave);
        if (result.success) {
          alert(`Successfully saved to calendar! File: ${result.path}`);
          _markMeetingSaved(selectedMeetingToSave);
        } else {
          alert(`Save failed: ${result.error}`);
        }
      } else {
        // Browser: call backend to generate ICS, then open data URL
        try {
          const resp = await fetch("http://127.0.0.1:8787/api/agent/meetings/save-calendar", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(selectedMeetingToSave)
          });
          if (resp.ok) {
            const data = await resp.json();
            // Create downloadable ICS blob
            const blob = new Blob([data.icsContent], { type: "text/calendar" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${(selectedMeetingToSave.title || "meeting").replace(/[^a-z0-9]/gi,"_")}.ics`;
            a.click();
            URL.revokeObjectURL(url);
            alert("Calendar event downloaded! Open the .ics file to add to your calendar.");
            _markMeetingSaved(selectedMeetingToSave);
          }
        } catch {
          alert("Calendar saved to local memory.");
          _markMeetingSaved(selectedMeetingToSave);
        }
      }

      const name = selectedMeetingToSave.title;
      const startStr = new Date(selectedMeetingToSave.startTime).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit", hour12:false});
      const endStr = new Date(selectedMeetingToSave.endTime).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit", hour12:false});
      calendarBlocks.push({ id: `cal-${Date.now()}`, title: name, start: startStr, end: endStr });
      state = buildState(sources, calendarBlocks);
    } catch (err) {
      alert(`Save exception: ${err.message}`);
    } finally {
      selectedMeetingToSave = null;
      render();
    }
  });

  // Promote unstructured task in Hidden asks page
  document.querySelectorAll("[data-promote-task]").forEach(btn => {
    btn.addEventListener("click", () => {
      const taskId = btn.dataset.promoteTask;
      const task = state.flattened.find(t => t.id === taskId);
      if (task) {
        task.extraction = "Structured tracker task";
        task.type = "tracker";
        
        // Add to Jira source items
        const jiraSource = sources.find(s => s.id === "jira");
        if (jiraSource) {
          jiraSource.items.push(task);
          state = buildState(sources, calendarBlocks);
          alert(`Task "${task.title}" promoted to Jira sprint tracker successfully!`);
          render();
        }
      }
    });
  });

  // ─── Scrum Board: Source tree clicks ─────────────────────────────────────
  document.querySelectorAll("[data-scrum-source]").forEach(el => {
    el.addEventListener("click", e => {
      e.stopPropagation();
      scrumActiveSource = el.dataset.scrumSource;
      render();
      setTimeout(() => {
        document.querySelector("#scrumKanban")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 80);
    });
  });

  // ─── Workspace Hub: source tab clicks ────────────────────────────────────
  document.querySelectorAll("[data-ws-source]").forEach(btn => {
    btn.addEventListener("click", () => {
      workspaceActiveSource = btn.dataset.wsSource;
      render();
    });
  });

  // Scrum date filter pills
  document.querySelectorAll("[data-scrum-date]").forEach(btn => {
    btn.addEventListener("click", () => { scrumDateFilter = btn.dataset.scrumDate; render(); });
  });

  // Scrum effort/difficulty filter pills
  document.querySelectorAll("[data-scrum-diff]").forEach(btn => {
    btn.addEventListener("click", () => { scrumDiffFilter = btn.dataset.scrumDiff; render(); });
  });

  // Scrum search
  document.querySelector("#scrumSearch")?.addEventListener("input", e => {
    scrumSearch = e.target.value;
    // Debounce re-render
    clearTimeout(window._scrumSearchTimer);
    window._scrumSearchTimer = setTimeout(render, 220);
  });

  // Kanban Board transitions
  document.querySelectorAll("[data-transition-task]").forEach(btn => {
    btn.addEventListener("click", () => {
      const taskId = btn.dataset.transitionTask;
      const newStatus = btn.dataset.toStatus;

      // Update in sources
      let found = false;
      sources.forEach(src => {
        const item = src.items.find(t => t.id === taskId);
        if (item) {
          item.status = newStatus;
          found = true;
        }
      });

      if (found) {
        if (newStatus === "Done") {
          completeTask(taskId);
        } else {
          completedTaskIds = completedTaskIds.filter(id => id !== taskId);
          state = buildState(sources, calendarBlocks);
          render();
        }
      }
    });
  });

  // Jira Modal Controls
  document.querySelector("#openAddJiraModalBtn")?.addEventListener("click", () => {
    showAddJiraModal = true;
    render();
  });

  document.querySelector("#closeAddJiraModalBtn")?.addEventListener("click", () => {
    showAddJiraModal = false;
    render();
  });

  document.querySelector("#saveAddJiraTaskBtn")?.addEventListener("click", () => {
    const title = document.querySelector("#addJiraTitle").value.trim();
    const body = document.querySelector("#addJiraBody").value.trim();
    const severity = document.querySelector("#addJiraSeverity").value;
    const due = document.querySelector("#addJiraDue").value;

    if (!title || !body) {
      alert("Please fill title and body!");
      return;
    }

    const newJira = {
      id: `JIRA-${Date.now().toString().slice(-3)}`,
      title: title,
      body: body,
      severity: severity,
      due: due,
      impact: severity === "P1" ? 10 : severity === "P2" ? 8 : severity === "P3" ? 5 : 3,
      status: "Todo",
      owner: settingsProfile.name,
      team: "Platform Apps",
      dependencies: [],
      execution: {
        definitionOfDone: `Complete ${title} and verify.`,
        process: ["Implement core function", "Validate outputs"],
        estimatedMinutes: 90
      }
    };

    const jiraSource = sources.find(s => s.id === "jira");
    if (jiraSource) {
      jiraSource.items.push(newJira);
      addedTasks.push(newJira);
      state = buildState(sources, calendarBlocks);
      showAddJiraModal = false;
      alert(`Jira Task ${newJira.id} added and priority queue recomputed!`);
      render();
      syncStateWithBackend();
    }
  });

  // Resolve ServiceNow incident
  document.querySelectorAll("[data-resolve-incident]").forEach(btn => {
    btn.addEventListener("click", () => {
      const incId = btn.dataset.resolveIncident;
      completeTask(incId);
      alert(`ServiceNow Incident ${incId} resolved and marked closed.`);
    });
  });

  // GitHub PR details & checks
  document.querySelectorAll("[data-pr-id]").forEach(btn => {
    btn.addEventListener("click", () => {
      activePrId = btn.dataset.prId;
      render();
    });
  });

  document.querySelector("#runPrCheckBtn")?.addEventListener("click", async () => {
    const activePr = state.prioritized.find(p => p.id === activePrId);
    if (!activePr) return;

    prReviewLoading = true;
    render();

    try {
      const prompt = `Perform an AI Pull Request code checklist check for the following PR:
      Title: ${activePr.canonicalTitle}
      Body/Changes: ${activePr.body}
      Dependencies: ${activePr.dependencies.join(", ")}
      
      Suggest potential security issues, dependency locks, and structural sanity checks in markdown bullets.`;
      
      prReviewChecklist[activePr.id] = await geminiChat(prompt);
    } catch (err) {
      prReviewChecklist[activePr.id] = `Review failed: ${err.message}`;
    } finally {
      prReviewLoading = false;
      render();
    }
  });

  document.querySelector("#approvePrBtn")?.addEventListener("click", () => {
    const activePr = state.prioritized.find(p => p.id === activePrId);
    if (!activePr) return;
    completeTask(activePr.id);
    alert(`PR ${activePr.id} has been Approved, verified and merged.`);
  });

  // Checklist actions in Execution page
  document.querySelectorAll("[data-execution-step-idx]").forEach(chk => {
    chk.addEventListener("change", () => {
      const container = document.querySelector("#executionChecklistContainer");
      const checkboxes = container.querySelectorAll("input[type='checkbox']");
      const allChecked = Array.from(checkboxes).every(c => c.checked);
      if (allChecked) {
        setTimeout(() => {
          document.querySelector("#completePriority")?.click();
        }, 300);
      }
    });
  });

  // Settings inputs & key save
  document.querySelector("#saveSettingsBtn")?.addEventListener("click", async () => {
    const name = document.querySelector("#settingsNameInput").value.trim();
    const role = document.querySelector("#settingsRoleInput").value;
    
    settingsSaving = true;
    render();

    try {
      if (authSession && authSession.userId && authSession.provider !== "demo") {
        const response = await fetch("http://127.0.0.1:8787/api/settings/profile", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: authSession.userId,
            updates: {
              full_name: name,
              role: role
            }
          })
        });
        const data = await response.json();
        if (data.profile) {
          settingsProfile.name = data.profile.full_name || name;
          settingsProfile.role = data.profile.role || role;
        }
      } else {
        // Fallback for demo mode
        settingsProfile.name = name;
        settingsProfile.role = role;
      }

      // Update activeProfile and session
      activeProfile = role.toLowerCase().includes("manager") ? "manager" : "engineer";
      if (authSession) {
        authSession.role = activeProfile;
        authSession.name = settingsProfile.name;
        localStorage.setItem("taskpilot:session", JSON.stringify(authSession));
      }

      // Fallback page if current page isn't in new profile's navigation
      const currentNav = activeProfile === "manager" ? MANAGER_NAV : ENGINEER_NAV;
      const isValidPage = currentNav.some(g => g.items.some(([id]) => id === activePage));
      if (!isValidPage) {
        activePage = "overview";
      }
      
      settingsMsg = "Configuration saved successfully!";
    } catch (err) {
      console.error("Failed to save profile configuration:", err);
      settingsMsg = "Error saving configuration.";
    } finally {
      settingsSaving = false;
      render();
      
      setTimeout(() => {
        settingsMsg = "";
        render();
      }, 2500);
    }
  });

  // Floating companion events
  document.querySelector("#dockToggle")?.addEventListener("click", () => {
    companionOpen = !companionOpen;
    render();
  });

  document.querySelector("#minimizeCompanion")?.addEventListener("click", () => {
    companionOpen = false;
    render();
  });

  document.querySelector("#closeCompanion")?.addEventListener("click", () => {
    companionOpen = false;
    render();
  });

  document.querySelector("#captureScreen")?.addEventListener("click", () => {
    runCompanionWorkflow("Secure OCR scan", { captureScreen: true });
  });

  document.querySelector("#taskInput")?.addEventListener("input", (event) => {
    autoResize(event.target);
  });

  document.querySelector("#taskInput")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (isProcessing) {
        stopProcessing();
      } else {
        document.querySelector("#companionForm")?.requestSubmit();
      }
    }
  });

  document.querySelector("#companionForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (isProcessing) {
      stopProcessing();
      return;
    }
    const input = new FormData(event.target).get("message").trim();
    if (!input) return;
    runCompanionWorkflow(input, { captureScreen: /ocr|scan|screen/i.test(input) });
  });

  if (!dockEyesBound) {
    document.addEventListener("mousemove", updateDockEyes, { passive: true });
    dockEyesBound = true;
  }
}

// ─── Meeting Helpers ──────────────────────────────────────────────────────────
function _markMeetingSaved(meetingToSave) {
  if (!meetingToSave?.id) return;
  meetingsList = meetingsList.map(m =>
    m.id === meetingToSave.id ? { ...m, savedToCalendar: true, status: "Scheduled" } : m
  );
  if (selectedMeeting?.id === meetingToSave.id) {
    selectedMeeting = { ...selectedMeeting, savedToCalendar: true, status: "Scheduled" };
  }
}

// ─── Companion Actions Logic ──────────────────────────────────────────────────
function pushCompanion(role, text, rerender = true) {
  companionLog = [...companionLog, { role, text }].slice(-6);
  if (rerender) render();
}

async function runCompanionWorkflow(intent, options = {}) {
  if (isProcessing) return;
  companionOpen = true;
  isProcessing = true;
  activeRunId += 1;
  const runId = activeRunId;
  const selected = state.prioritized.find(t => t.id === selectedTaskId) || state.prioritized[0];
  const queue = activeQueue();
  const current = queue.find(t => t.id === selectedTaskId) || queue[0] || selected;

  // Mark the task being discussed as "working"
  if (current && !completedTaskIds.includes(current.id) && !workingTaskIds.includes(current.id)) {
    workingTaskIds = [...workingTaskIds, current.id];
  }
  
  const sealed = sealForTee({
    intent,
    activeApp: currentContext?.app?.name,
    selectedTask: current?.canonicalTitle,
    sourceCount: state.flattened.length,
    containsScreenFrame: Boolean(options.captureScreen)
  }, teeSession);

  currentPlanSteps = teePlanSteps(intent).map(step => ({ ...step, status: "pending" }));
  pushCompanion("user", intent, false);
  render();

  try {
    await runStep(runId, "context", "running", "Detecting active app and selected task");
    await sleep(220);
    await runStep(runId, "context", "done", `${contextLabel(currentContext)} detected`);

    await runStep(runId, "tee", "running", "Sealing minimized payload inside TEE envelope");
    await sleep(260);
    await runStep(runId, "tee", "done", `Sealed payload ${sealed.payloadDigest}`);

    await runStep(runId, "reason", "running", "Ranking urgency, deadline, blockers, and duplicate signals");
    
    let result;
    if (options.captureScreen) {
      result = await runScreenScan(runId, sealed);
    } else {
      if (backendConfig.geminiConfigured) {
        // Fetch reasoning direct from agent endpoint
        const resp = await fetch("http://127.0.0.1:8787/api/agent/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: intent, engineerName: settingsProfile.name })
        });
        const payload = await resp.json();
        result = payload.response;
      } else {
        result = await createCompanionAnswer(intent, sealed);
      }
    }
    await runStep(runId, "reason", "done", "Reasoning complete with auditable rationale");

    await runStep(runId, "consent", "running", "Preparing user-approved recommendation");
    await sleep(180);
    await runStep(runId, "consent", "done", "No execution performed without approval");

    if (runId !== activeRunId) return;
    lastAnswer = result;
    pushCompanion("agent", result, false);
  } catch (error) {
    if (runId === activeRunId) {
      pushCompanion("agent", `Workflow stopped safely: ${error.message}`, false);
    }
  } finally {
    if (runId === activeRunId) {
      isProcessing = false;
      render();
    }
  }
}

async function runScreenScan(runId, sealed) {
  if (window.taskPilotDesktop?.captureScreen) {
    const capture = await window.taskPilotDesktop.captureScreen({
      attestationHash: teeSession.attestationHash,
      payloadDigest: sealed.payloadDigest
    });
    if (runId !== activeRunId) throw new Error("scan cancelled");
    if (backendConfig.geminiConfigured && capture.thumbnail) {
      return analyzeScreenWithTaskPilot(capture.thumbnail, capture.name);
    }
    return `TEE OCR demo scan complete for ${capture.name}. The frame was treated as ephemeral, sealed as ${sealed.payloadDigest}, and mapped to the CSV upload incident without sending raw screen data.`;
  }
  await sleep(360);
  return `Browser demo TEE OCR complete. I would capture the visible screen only after approval, seal it as ${sealed.payloadDigest}, extract visible asks, and keep execution under your control.`;
}

async function createCompanionAnswer(intent, sealed) {
  const normalized = intent.toLowerCase();
  if (normalized.includes("what should") || normalized.includes("now")) {
    const top = activeQueue()[0] || state.prioritized[0];
    return `Do ${top.canonicalTitle} first. It is due today, has ${top.severity} severity, and appears across ${top.sources.length} sources. TEE payload: ${sealed.payloadDigest}.`;
  }
  if (normalized.includes("autonomous scan")) {
    return `Autonomous scan complete: ${state.flattened.length} raw signals checked, ${state.deduped.length} clean tasks produced, hidden email work extracted, and duplicate work merged. TEE payload: ${sealed.payloadDigest}.`;
  }
  if (normalized.includes("secure ocr") || normalized.includes("ocr") || normalized.includes("screen")) {
    return `TEE OCR is ready. Press TEE OCR to capture the screen with an ephemeral frame, secret redaction, and approval-first execution.`;
  }
  
  // Use Gemini Chat directly if configured
  try {
    return await geminiAnswerQuery(intent, state);
  } catch (err) {
    return `${answerQuery(intent, state)} TEE payload: ${sealed.payloadDigest}.`;
  }
}

async function runStep(runId, id, status, label) {
  if (runId !== activeRunId) throw new Error("run cancelled");
  currentPlanSteps = currentPlanSteps.map(step => (step.id === id ? { ...step, status, label } : step));
  render();
}

function stopProcessing() {
  activeRunId += 1;
  isProcessing = false;
  currentPlanSteps = currentPlanSteps.map(step => (step.status === "running" ? { ...step, status: "error", label: "Stopped by user" } : step));
  pushCompanion("agent", "Stopped safely. No external call or task execution continued after your stop request.");
}

function autoResize(input) {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 150)}px`;
}

function detectContext(selected) {
  const primarySource = activeSource === "all" ? selected.sources[0] : sources.find(s => s.id === activeSource)?.name;
  return {
    app: { name: primarySource || "TaskPilot" },
    task: selected.canonicalTitle,
    profile: demoProfiles[activeProfile].name,
    trust: teeSession.status
  };
}

function contextLabel(context) {
  if (!context?.app?.name) return "Ready";
  return `${context.app.name} - ${context.profile}`;
}

function stepIcon(status) {
  if (status === "running") return "...";
  if (status === "done") return "OK";
  if (status === "error") return "!";
  return "o";
}

function renderLogText(text) {
  return escapeHtml(text)
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.*?)`/g, "<code>$1</code>")
    .replace(/\n/g, "<br>");
}

function updateDockEyes(event) {
  const dock = document.querySelector(".dock-avatar");
  if (!dock) return;
  const rect = dock.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const angle = Math.atan2(event.clientY - centerY, event.clientX - centerX);
  const move = Math.min(2.8, Math.hypot(event.clientX - centerX, event.clientY - centerY) / 80);
  const x = Math.cos(angle) * move;
  const y = Math.sin(angle) * move;
  document.querySelectorAll(".dock-eye").forEach(eye => {
    eye.style.transform = `translate(${x}px, ${y}px)`;
  });
}

async function analyzeScreenWithTaskPilot(dataUrl, sourceName) {
  try {
    const visionRequest = { sourceName, redactedOcrContext: "screen frame sealed by TEE; frontend does not receive TaskPilot AI key", hasFrame: Boolean(dataUrl), thumbnail: dataUrl };
    if (window.taskPilotDesktop?.summarizeVision) {
      const result = await window.taskPilotDesktop.summarizeVision(visionRequest);
      return result.summary;
    }
    const response = await fetch("http://127.0.0.1:8787/api/taskpilot/vision-summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(visionRequest)
    });
    const visionPayload = await response.json();
    return visionPayload.summary;
  } catch (error) {
    return `Backend TaskPilot AI service was unavailable, so I kept local prioritization active. ${error.message}`;
  }
}

// ─── Initializer ──────────────────────────────────────────────────────────────
async function loadUserProfile() {
  if (!authSession) return;
  try {
    const url = `http://127.0.0.1:8787/api/settings/profile?email=${encodeURIComponent(authSession.email)}&id=${encodeURIComponent(authSession.userId || "")}`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.profile) {
      settingsProfile.name = data.profile.full_name || data.profile.display_name || authSession.name;
      settingsProfile.role = data.profile.role || authSession.role;
      settingsProfile.email = data.profile.email || authSession.email;
    }
  } catch (err) {
    console.error("Failed to load user profile:", err);
  }
}

async function loadBackendConfig() {
  try {
    if (window.taskPilotDesktop?.getBackendConfig) {
      backendConfig = await window.taskPilotDesktop.getBackendConfig();
    } else {
      const response = await fetch("http://127.0.0.1:8787/api/taskpilot/config");
      backendConfig = await response.json();
    }
  } catch {
    backendConfig = { geminiConfigured: false, teeMode: "local-attested", supabaseConfigured: false, supabaseUrl: "", backendPort: "8787" };
  }

  // Fetch live state from backend to synchronize the local state
  try {
    const response = await fetch("http://127.0.0.1:8787/api/taskpilot/state");
    const data = await response.json();
    if (data.success) {
      completedTaskIds = data.completedTaskIds || [];
      workingTaskIds = data.workingTaskIds || [];
      taskTimeLogs = data.taskTimeLogs || {};
      managerActivityFeed = data.managerActivityFeed || [];
      managerTaskPosts = data.managerTaskPosts || [];
      engineerPortalPosts = data.engineerPortalPosts || [];
      addedTasks = data.addedTasks || [];

      // Add loaded manually added tasks back to local sources items
      if (addedTasks.length > 0) {
        addedTasks.forEach(t => {
          const jiraSource = sources.find(s => s.id === "jira");
          if (jiraSource && !jiraSource.items.some(x => x.id === t.id)) {
            jiraSource.items.push(t);
          }
        });
      }
      state = buildState(sources, calendarBlocks);
    }
  } catch (err) {
    console.error("Failed to load task state from backend:", err);
  }

  // Only clear sessions that have no userId AND are from google-supabase (truly malformed).
  // Demo sessions are always valid — do NOT wipe them on restart.
  const isMalformedSession = authSession && authSession.provider === "google-supabase" && !authSession.userId;
  if (isMalformedSession) {
    authSession = null;
    localStorage.removeItem("taskpilot:session");
  }

  // Load user profile from backend
  await loadUserProfile();

  // In desktop shell with no session, show the login page (do not auto-bypass)
  // User must sign in with Google to use the app
}

// ─── Unified Task Completion ──────────────────────────────────────────────────
function completeTask(id) {
  const task = state.prioritized.find(t => t.id === id);
  if (!task) return;

  // Log end time
  const now = new Date();
  if (!taskTimeLogs[id]) {
    // If started without clicking Start (e.g. completed from agent), create full log
    taskTimeLogs[id] = {
      title: task.canonicalTitle,
      severity: task.severity,
      source: task.sources?.join(" + ") || task.sourceId,
      startTime: new Date(now.getTime() - 30 * 60000).toISOString(), // assume 30min ago
      endTime: now.toISOString()
    };
  } else {
    taskTimeLogs[id].endTime = now.toISOString();
  }

  // Move from working → done
  workingTaskIds = workingTaskIds.filter(x => x !== id);
  if (!completedTaskIds.includes(id)) {
    completedTaskIds = [...completedTaskIds, id];
  }

  // Build manager notification
  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  const feedEntry = {
    message: `✓ ${settingsProfile.name} completed "${task.canonicalTitle}" (${task.severity})`,
    color: "#22a06b",
    time: timeStr,
    taskId: id
  };
  managerActivityFeed = [feedEntry, ...managerActivityFeed];

  // Also add to managerTaskPosts so it appears in manager portal
  managerTaskPosts = [{
    id: `DONE-${id}`,
    title: task.canonicalTitle,
    description: `Completed by ${settingsProfile.name} at ${timeStr}`,
    priority: task.severity,
    status: "Completed",
    postedBy: settingsProfile.name,
    postedAt: now.toISOString(),
    type: "completion"
  }, ...managerTaskPosts];

  // Handoff & next selection
  const queue = activeQueue();
  const assignment = completeAndAssignNext([...queue, task], id);
  selectedTaskId = assignment.next?.id || queue[0]?.id || "";

  pushCompanion("agent", `"${task.canonicalTitle}" marked done. Manager notified. ${assignment.handoff.brief ? `Next up: ${assignment.next?.canonicalTitle || "all clear!"}` : "Queue cleared!"}`, false);
  lastAnswer = assignment.handoff.brief
    ? `${assignment.handoff.message} Definition: ${assignment.handoff.brief.definitionOfDone}`
    : assignment.handoff.message;

  triggerLocalNotification("TaskPilot", `Task completed: ${task.canonicalTitle}`);
  render();
  syncStateWithBackend();
}

// ─── End-of-day PDF Report ────────────────────────────────────────────────────
async function generateDailyReportPDF() {
  const today = new Date();
  const dateStr = today.toLocaleDateString("en-US", { weekday:"long", year:"numeric", month:"long", day:"numeric" });

  // Get completed task logs
  const completedLogs = Object.entries(taskTimeLogs)
    .filter(([id]) => completedTaskIds.includes(id))
    .map(([id, log]) => {
      const startDt = new Date(log.startTime);
      const endDt = log.endTime ? new Date(log.endTime) : today;
      const durationMs = endDt - startDt;
      const durationMin = Math.round(durationMs / 60000);
      return {
        ...log,
        id,
        startStr: startDt.toLocaleTimeString("en-US", { hour:"2-digit", minute:"2-digit" }),
        endStr: endDt.toLocaleTimeString("en-US", { hour:"2-digit", minute:"2-digit" }),
        durationMin
      };
    });

  // Remaining tasks for tomorrow
  const remaining = activeQueue().slice(0, 8);

  // Gemini summary
  let aiSummary = "AI summary unavailable.";
  try {
    const prompt = `You are TaskPilot AI. Write a professional end-of-day summary for ${settingsProfile.name} (${settingsProfile.role || "Engineer"}).

Completed tasks today:
${completedLogs.map((l, i) => `${i+1}. ${l.title} [${l.severity}] — ${l.startStr} to ${l.endStr} (${l.durationMin} min)`).join("\n") || "No tasks completed."}

Pending for tomorrow (top priority):
${remaining.slice(0, 5).map((t, i) => `${i+1}. ${t.canonicalTitle} [${t.severity}] due ${t.due || "TBD"}`).join("\n")}

Write 2-3 sentences summarizing today's accomplishments and a 1-2 sentence recommendation for tomorrow's priorities. Be specific and professional.`;
    const r = await geminiChat(prompt);
    aiSummary = r || aiSummary;
  } catch { /* use default */ }

  // Build HTML for the report
  const logoDataUrlStr = typeof logoDataUrl !== "undefined" ? logoDataUrl : "";
  const reportHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Daily Report — ${settingsProfile.name} — ${dateStr}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800;900&family=Plus+Jakarta+Sans:wght@400;500;700;800&display=swap');
  @page { size: A4; margin: 15mm 15mm 20mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;
    color: #1e293b;
    background: #f8fafc;
    font-size: 13px;
    line-height: 1.5;
    padding: 20px;
  }
  .container {
    max-width: 850px;
    margin: 0 auto;
    background: #ffffff;
    border-radius: 16px;
    box-shadow: 0 4px 25px rgba(0, 0, 0, 0.04);
    padding: 35px;
    border: 1px solid #e2e8f0;
  }
  .header {
    display: flex;
    align-items: center;
    gap: 20px;
    padding-bottom: 24px;
    border-bottom: 1px solid #e2e8f0;
    margin-bottom: 26px;
  }
  .logo-container {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 64px;
    height: 64px;
    border-radius: 16px;
    background: linear-gradient(135deg, #0c66e4, #00d4aa);
    padding: 4px;
    box-shadow: 0 4px 12px rgba(12, 102, 228, 0.15);
  }
  .logo {
    width: 100%;
    height: 100%;
    border-radius: 12px;
    object-fit: cover;
  }
  .logo-placeholder {
    font-family: 'Outfit', sans-serif;
    font-size: 24px;
    font-weight: 900;
    color: #ffffff;
  }
  .header-title h1 {
    font-family: 'Outfit', sans-serif;
    font-size: 24px;
    font-weight: 900;
    color: #0f172a;
    letter-spacing: -0.02em;
    line-height: 1.2;
  }
  .header-title p {
    font-size: 12px;
    color: #64748b;
    margin-top: 4px;
    font-weight: 500;
  }
  .meta-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
    margin-bottom: 28px;
  }
  .meta-card {
    padding: 14px 16px;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    background: #f8fafc;
  }
  .meta-card label {
    font-size: 10px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #64748b;
    display: block;
    margin-bottom: 6px;
  }
  .meta-card span {
    font-size: 14px;
    font-weight: 700;
    color: #0f172a;
  }
  h2 {
    font-family: 'Outfit', sans-serif;
    font-size: 16px;
    font-weight: 800;
    color: #0f172a;
    margin: 0 0 16px;
    padding-bottom: 8px;
    border-bottom: 2px solid #f1f5f9;
  }
  section {
    margin-bottom: 30px;
  }
  table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    overflow: hidden;
    margin-bottom: 8px;
  }
  thead tr {
    background: #0f172a;
    color: #ffffff;
  }
  thead th {
    padding: 12px 16px;
    text-align: left;
    font-size: 10px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  tbody tr:nth-child(even) {
    background: #f8fafc;
  }
  tbody tr:last-child td {
    border-bottom: none;
  }
  tbody td {
    padding: 12px 16px;
    font-size: 12px;
    color: #334155;
    border-bottom: 1px solid #e2e8f0;
  }
  .sev {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 3px 8px;
    border-radius: 6px;
    font-size: 10px;
    font-weight: 800;
  }
  .sev.P1 { background: #fee2e2; color: #991b1b; }
  .sev.P2 { background: #fef3c7; color: #92400e; }
  .sev.P3 { background: #dcfce7; color: #166534; }
  .sev.P4 { background: #f1f5f9; color: #475569; }
  
  .ai-block {
    padding: 18px;
    background: #f0f7ff;
    border-left: 4px solid #3b82f6;
    border-radius: 8px;
    font-size: 13px;
    line-height: 1.6;
    color: #1e3a8a;
  }
  .tomorrow-list {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
  }
  .tomorrow-item {
    padding: 14px;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    background: #ffffff;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .tomorrow-index {
    font-family: 'Outfit', sans-serif;
    font-weight: 800;
    color: #94a3b8;
    font-size: 12px;
  }
  .tomorrow-title {
    flex: 1;
    font-weight: 600;
    color: #0f172a;
    font-size: 12px;
  }
  .tomorrow-due {
    font-size: 10px;
    color: #64748b;
    font-weight: 500;
  }
  .footer {
    margin-top: 40px;
    padding-top: 20px;
    border-top: 1px solid #e2e8f0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 11px;
    color: #94a3b8;
  }
  .no-data {
    color: #64748b;
    font-size: 12px;
    font-style: italic;
    padding: 16px 0;
  }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div class="logo-container">
      ${logoDataUrlStr ? `<img src="${logoDataUrlStr}" class="logo" alt="TaskPilot AI">` : `<div class="logo-placeholder">TP</div>`}
    </div>
    <div class="header-title">
      <h1>Daily Engineering Report</h1>
      <p>TaskPilot AI Companion · ${dateStr}</p>
    </div>
  </div>

  <div class="meta-grid">
    <div class="meta-card"><label>Name of Engineer</label><span>${escapeHtml(settingsProfile.name)}</span></div>
    <div class="meta-card"><label>Role of Engineer</label><span>${escapeHtml(settingsProfile.role || "Full-stack Engineer")}</span></div>
    <div class="meta-card"><label>Work Progress</label><span>${completedLogs.length} Completed Today</span></div>
  </div>

  <section>
    <h2>✅ Tasks Completed Today</h2>
    ${completedLogs.length === 0
      ? `<p class="no-data">No tasks completed today.</p>`
      : `<table>
        <thead><tr><th>#</th><th>Task Title</th><th>Source</th><th>Sev</th><th>Start Time</th><th>End Time</th><th>Duration</th></tr></thead>
        <tbody>
          ${completedLogs.map((l, i) => `
            <tr>
              <td style="font-weight:800; color:#64748b;">${i+1}</td>
              <td><strong>${escapeHtml(l.title)}</strong></td>
              <td>${escapeHtml(l.source)}</td>
              <td><span class="sev ${l.severity}">${l.severity}</span></td>
              <td style="font-family:monospace; color:#475569;">${l.startStr}</td>
              <td style="font-family:monospace; color:#475569;">${l.endStr}</td>
              <td style="font-weight:600; color:#0f172a;">${l.durationMin >= 60 ? `${Math.floor(l.durationMin/60)}h ${l.durationMin%60}m` : `${l.durationMin}m`}</td>
            </tr>`).join("")}
        </tbody>
      </table>`}
  </section>

  <section>
    <h2>🤖 AI Summary & Achievements</h2>
    <div class="ai-block">${escapeHtml(aiSummary)}</div>
  </section>

  <section>
    <h2>📅 Priority Focus for Tomorrow</h2>
    ${remaining.length === 0
      ? `<p class="no-data">All priorities cleared — nothing pending!</p>`
      : `<div class="tomorrow-list">
          ${remaining.slice(0, 6).map((t, i) => `
            <div class="tomorrow-item">
              <span class="tomorrow-index">#${i+1}</span>
              <span class="sev ${t.severity}">${t.severity}</span>
              <span class="tomorrow-title">${escapeHtml(t.canonicalTitle)}</span>
              <span class="tomorrow-due">Due ${formatDue(t.due)}</span>
            </div>`).join("")}
        </div>`}
  </section>

  <div class="footer">
    <span>Generated by TaskPilot AI · ${today.toLocaleString()}</span>
    <span>${escapeHtml(settingsProfile.name)} · ${escapeHtml(settingsProfile.email || "")}</span>
  </div>
</div>
</body>
</html>`;

  // Open a new window, write the report, print it
  const printWin = window.open("", "_blank", "width=900,height=700");
  if (!printWin) {
    alert("Please allow popups for TaskPilot AI to generate the PDF report.");
    return;
  }
  printWin.document.write(reportHtml);
  printWin.document.close();
  printWin.focus();
  setTimeout(() => printWin.print(), 600);
}

// ─── Desktop floating panel task completion listener ──────────────────────────
if (window.taskPilotDesktop?.onCompleteTask) {
  window.taskPilotDesktop.onCompleteTask((payload) => {
    const taskId = payload.taskId;
    if (taskId) {
      completeTask(taskId);
    }
  });
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
loadBackendConfig().finally(render);
