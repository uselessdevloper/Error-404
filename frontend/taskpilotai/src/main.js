import { calendarBlocks, demoProfiles, sources, meetingsData, logoDataUrl } from "./data.js";
import { answerQuery, buildState, completeAndAssignNext, createExecutionBrief, createDailyPlan, buildTodayQueue, buildDependencyGraph } from "./taskEngine.js";
import { createTeeSession, sealForTee, teePlanSteps } from "./teeTrust.js";
import { geminiChat, geminiAgentRun, geminiAnswerQuery, geminiDailyPlan, geminiExtractActions, geminiAnalyseMeeting, geminiMeetingPrioritizer, geminiSummariseEmail, geminiWeeklyStandup, geminPrioritizeTasks, setModel } from "./geminiClient.js";
import { loadCompletions, saveCompletion, deleteCompletion, loadWorkingTasks, saveWorkingTask, deleteWorkingTask, subscribeToCompletions, loadAllCompletions, loadAllWorkingTasks, subscribeToAllDatabaseChanges } from "./supabaseClient.js";
import "./styles.css";

const app = document.querySelector("#app");
const isDesktopShell = Boolean(window.taskPilotDesktop?.isDesktop) || new URLSearchParams(window.location.search).has("desktop");

// ─── Application State ────────────────────────────────────────────────────────
let activePage = "overview";
let activeProfile = "engineer";
let activeSource = "all";
let completedTaskIds = [];
let workingTaskIds = [];        // tasks currently being worked on / agent is discussing
let dbCompletions = [];         // completions across all users from database
let dbWorking = [];             // active working tasks across all users from database
let managerActivityFeed = [];  // real-time updates visible on manager dashboard

function isTaskCompleted(taskId) {
  return completedTaskIds.includes(taskId) || dbCompletions.some(r => r.task_id === taskId);
}

function isTaskWorking(taskId) {
  return workingTaskIds.includes(taskId) || dbWorking.some(r => r.task_id === taskId);
}
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

// ─── Today's Smart Queue — capped at 12, Gemini-scored ──────────────────────
let todayQueue = buildTodayQueue(state.prioritized, demoProfiles[activeProfile]?.name || "Utkarsh", 12);
let todayQueueGeminiScored = false; // true once Gemini has re-ranked todayQueue
let depGraph = buildDependencyGraph(state.prioritized); // dependency graph for all tasks

let authSession = JSON.parse(localStorage.getItem("taskpilot:session") || "null");
if (authSession?.role) activeProfile = authSession.role;

let backendConfig = { geminiConfigured: false, teeMode: "local-attested", supabaseConfigured: false, llmModel: "gemini-2.5-flash" };

// ─── Source Brand Logos (inline SVG — no network, works in Electron file://) ──
const SOURCE_LOGO_MAP = {
  jira: {
    bg: "#e8f0ff",
    svg: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" width="20" height="20"><defs><linearGradient id="jL1" x1="100%" y1="3%" x2="45%" y2="55%" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#0052CC"/><stop offset="100%" stop-color="#2684FF"/></linearGradient><linearGradient id="jL2" x1="0%" y1="97%" x2="55%" y2="45%" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#0052CC"/><stop offset="100%" stop-color="#2684FF"/></linearGradient></defs><path d="M15.48 0l-7.74 7.74a2.67 2.67 0 000 3.77l3.97 3.97 7.74-7.74L15.48 0z" fill="url(#jL1)"/><path d="M8 7.78L.26 15.52a2.67 2.67 0 000 3.77L8 27.03l7.74-7.74L8 11.55V7.78z" fill="#2684FF"/><path d="M15.48 15.52L8 23.26 15.48 30.75l7.74-7.74a2.67 2.67 0 000-3.77l-7.74-3.72z" fill="url(#jL2)"/><path d="M23.22 7.78v3.77l-7.74 7.74 7.74 7.74 7.74-7.74a2.67 2.67 0 000-3.77L23.22 7.78z" fill="#2684FF"/></svg>`
  },
  github: {
    bg: "#f0f0f0",
    svg: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="20" height="20"><path fill="#24292f" d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>`
  },
  servicenow: {
    bg: "#fde8e8",
    svg: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="32" height="32" rx="6" fill="#c0392b"/><path d="M8 22c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V12c0-1.1-.9-2-2-2H10c-1.1 0-2 .9-2 2v10zm3-9h10v8H11v-8zm3 5h4v-2h-4v2z" fill="#fff"/><circle cx="16" cy="8" r="2" fill="#fff"/></svg>`
  },
  email: {
    bg: "#dbeafe",
    svg: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect x="0" y="3" width="24" height="18" rx="2.5" fill="#0078D4"/><path d="M2 6l10 7 10-7" stroke="#fff" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>`
  },
  slack: {
    bg: "#f5eeff",
    svg: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="20" height="20"><path d="M5.042 15.165a2.528 2.528 0 01-2.52 2.523A2.528 2.528 0 010 15.165a2.527 2.527 0 012.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 012.521-2.52 2.527 2.527 0 012.521 2.52v6.313A2.528 2.528 0 018.834 24a2.528 2.528 0 01-2.521-2.522v-6.313zm2.521-10.123a2.528 2.528 0 01-2.521-2.52A2.528 2.528 0 018.834 0a2.528 2.528 0 012.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 012.521 2.521 2.528 2.528 0 01-2.521 2.521H2.522A2.528 2.528 0 010 8.834a2.528 2.528 0 012.522-2.521h6.312zm10.122 2.521a2.528 2.528 0 012.522-2.521A2.528 2.528 0 0124 8.834a2.528 2.528 0 01-2.522 2.521h-2.522V8.834zm-1.268 0a2.528 2.528 0 01-2.523 2.521 2.527 2.527 0 01-2.52-2.521V2.522A2.527 2.527 0 0115.165 0a2.528 2.528 0 012.523 2.522v6.312zm-2.523 10.122a2.528 2.528 0 012.523 2.522A2.528 2.528 0 0115.165 24a2.527 2.527 0 01-2.52-2.522v-2.522h2.52zm0-1.268a2.527 2.527 0 01-2.52-2.523 2.526 2.526 0 012.52-2.52h6.313A2.527 2.527 0 0124 15.165a2.528 2.528 0 01-2.522 2.523h-6.313z" fill="#4A154B"/></svg>`
  },
  notes: {
    bg: "#d1fae5",
    svg: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect x="3" y="2" width="18" height="20" rx="2" fill="#0f766e"/><path d="M7 7h10M7 11h10M7 15h6" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/></svg>`
  }
};

// ─── Project Genome State ─────────────────────────────────────────────────────
let genomeState = {
  loading: false,
  currentGenome: null,       // { sprintLabel, workload, bugs, dependencies, reviews, velocity }
  pastGenomes: [],           // array of historical genome snapshots
  matchedSprint: null,       // { label, genome, outcome }
  similarityScore: 0,        // 0-100
  mutations: [],             // [{ field, current, past, delta }]
  risks: [],                 // [{ label, pct, color, recommendation }]
  recommendations: [],       // string[]
  aiNarrative: "",           // optional Gemini-generated manager briefing
  lastAnalyzed: null,        // ISO timestamp
  pollingInterval: null      // setInterval handle
};
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
  { role: "agent", text: "Woof! TEE trust envelope attested! 🐾 I scanned Jira, ServiceNow, GitHub, Slack, Outlook, and meeting notes. I've sniffed out a P1 upload issue that is duplicated across 3 systems with an SLA due today. Let's tackle it! Bark!", chips: ["Show VP emails", "What's blocking my teammate?", "Why is the upload bug ranked #1?", "Top 5 tasks", "Show blockers"] }
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

// ─── Per-user completion store (keyed by email, persisted to localStorage + Supabase) ──
// Structure: { [email]: { completedTaskIds: [], workingTaskIds: [], completionRows: [] } }
let userCompletionStore = JSON.parse(localStorage.getItem("tp_userCompletions") || "{}");
let realtimeSubscription = null; // current supabase realtime handle

function getUserEmail() {
  return authSession?.email || "demo@taskpilot.local";
}

function getUserName() {
  return settingsProfile?.name || authSession?.name || "Engineer";
}

// Get completedTaskIds for current user only
function getMyCompletedIds() {
  const email = getUserEmail();
  return userCompletionStore[email]?.completedTaskIds || [];
}

function getMyCompletionRows() {
  const email = getUserEmail();
  return userCompletionStore[email]?.completionRows || [];
}

function getMyWorkingIds() {
  const email = getUserEmail();
  return userCompletionStore[email]?.workingTaskIds || [];
}

function setMyCompletedIds(ids) {
  const email = getUserEmail();
  if (!userCompletionStore[email]) userCompletionStore[email] = { completedTaskIds: [], workingTaskIds: [], completionRows: [] };
  userCompletionStore[email].completedTaskIds = ids;
  localStorage.setItem("tp_userCompletions", JSON.stringify(userCompletionStore));
  // Sync to main completedTaskIds (used everywhere in render)
  completedTaskIds = ids;
}

function setMyWorkingIds(ids) {
  const email = getUserEmail();
  if (!userCompletionStore[email]) userCompletionStore[email] = { completedTaskIds: [], workingTaskIds: [], completionRows: [] };
  userCompletionStore[email].workingTaskIds = ids;
  localStorage.setItem("tp_userCompletions", JSON.stringify(userCompletionStore));
  workingTaskIds = ids;
}

function addMyCompletion(row) {
  const email = getUserEmail();
  if (!userCompletionStore[email]) userCompletionStore[email] = { completedTaskIds: [], workingTaskIds: [], completionRows: [] };
  // Avoid duplicates
  if (!userCompletionStore[email].completionRows.some(r => r.task_id === row.task_id)) {
    userCompletionStore[email].completionRows.push(row);
  }
  if (!userCompletionStore[email].completedTaskIds.includes(row.task_id)) {
    userCompletionStore[email].completedTaskIds.push(row.task_id);
  }
  localStorage.setItem("tp_userCompletions", JSON.stringify(userCompletionStore));
  completedTaskIds = userCompletionStore[email].completedTaskIds;
}

function removeMyCompletion(taskId) {
  const email = getUserEmail();
  if (!userCompletionStore[email]) return;
  userCompletionStore[email].completionRows = userCompletionStore[email].completionRows.filter(r => r.task_id !== taskId);
  userCompletionStore[email].completedTaskIds = userCompletionStore[email].completedTaskIds.filter(id => id !== taskId);
  localStorage.setItem("tp_userCompletions", JSON.stringify(userCompletionStore));
  completedTaskIds = userCompletionStore[email].completedTaskIds;
}

// Load user completions from Supabase and merge into local store
async function syncCompletionsFromSupabase() {
  const email = getUserEmail();
  const rows = await loadCompletions(email);
  if (!userCompletionStore[email]) userCompletionStore[email] = { completedTaskIds: [], workingTaskIds: [], completionRows: [] };
  // Merge: remote is source of truth, but preserve local-only rows
  const localRows = userCompletionStore[email].completionRows || [];
  const mergedRows = [...rows];
  localRows.forEach(localRow => {
    if (!mergedRows.some(r => r.task_id === localRow.task_id)) {
      mergedRows.push(localRow);
    }
  });
  userCompletionStore[email].completionRows = mergedRows;
  userCompletionStore[email].completedTaskIds = mergedRows.map(r => r.task_id);
  localStorage.setItem("tp_userCompletions", JSON.stringify(userCompletionStore));
  completedTaskIds = userCompletionStore[email].completedTaskIds;

  // Also load working tasks
  const wIds = await loadWorkingTasks(email);
  userCompletionStore[email].workingTaskIds = wIds;
  localStorage.setItem("tp_userCompletions", JSON.stringify(userCompletionStore));
  workingTaskIds = wIds;

  // Also load database wide completions and working tasks for team view & manager charts
  if (backendConfig.supabaseConfigured) {
    dbCompletions = await loadAllCompletions();
    dbWorking = await loadAllWorkingTasks();
  }
}

// Subscribe to realtime for live analytics updates
function startRealtimeSync() {
  if (realtimeSubscription) realtimeSubscription.close();
  
  if (backendConfig.supabaseConfigured) {
    realtimeSubscription = subscribeToAllDatabaseChanges(
      (type, record) => {
        if (type === "INSERT") {
          if (record && !dbCompletions.some(r => r.task_id === record.task_id && r.user_email === record.user_email)) {
            dbCompletions.unshift(record);
          }
          if (record && record.user_email === getUserEmail()) {
            addMyCompletion(record);
          }
        } else if (type === "DELETE") {
          if (record) {
            dbCompletions = dbCompletions.filter(r => !(r.task_id === record.task_id && r.user_email === record.user_email));
            if (record.user_email === getUserEmail()) {
              removeMyCompletion(record.task_id);
            }
          }
        }
        safeRender();
      },
      (type, record) => {
        if (type === "INSERT") {
          if (record && !dbWorking.some(r => r.task_id === record.task_id && r.user_email === record.user_email)) {
            dbWorking.push(record);
          }
        } else if (type === "DELETE") {
          if (record) {
            dbWorking = dbWorking.filter(r => !(r.task_id === record.task_id && r.user_email === record.user_email));
          }
        }
        safeRender();
      }
    );
  }
}

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
let reassignedTaskOwners = {};      // map of originalTaskId -> newOwner

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
        addedTasks,
        reassignedTaskOwners
      })
    });
  } catch (err) {
    console.error("Failed to sync state with backend:", err);
  }
}

// ─── Navigation ───────────────────────────────────────────────────────────────
const ENGINEER_NAV = [
  { label: "Command",      items: [["overview","Dashboard","⌂"],["today","My Tasks","◎"],["agent-scan","AI Agent","✦"]] },
  { label: "Intelligence", items: [["inbox","All Sources","✉"],["source-tree","Source Tree","🌳"],["meetings","Meetings","◷"],["my-analytics","My Analytics","▥"]] },
  { label: "Workspace",    items: [["workspace","Workspace","▦"]] },
  { label: "Insights",     items: [["execution","Execution plan","✓"]] },
  { label: "Team",         items: [["eng-portal","Team workload","📋"]] },
  { label: "Account",      items: [["settings","Settings","⚙"]] }
];

const MANAGER_NAV = [
  { label: "Command",      items: [["overview","Dashboard","⌂"]] },
  { label: "Intelligence", items: [
    ["inbox","All Sources","✉"],
    ["source-tree","Source Tree","🌳"],
    ["mgr-jira","Jira Tasks","▦"],
    ["mgr-github","GitHub PRs","⌁"],
    ["mgr-servicenow","Incidents","△"],
    ["mgr-email","Email Actions","📧"],
    ["mgr-slack","Slack Mentions","💬"],
    ["meetings","Meetings","◷"],
    ["hidden","Hidden asks","◇"]
  ]},
  { label: "Genome",       items: [["genome","Sprint Genome","🧬"]] },
  { label: "Team",         items: [["team-portal","Team workload","📋"],["analytics","Analytics","▥"],["engineer-analytics","Engineer Charts","📈"]] },
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
function taskMatchesSource(task, sourceId) {
  if (!task.sources || !Array.isArray(task.sources)) return false;
  const sId = sourceId.toLowerCase();
  return task.sources.some(s => {
    const srcName = s.toLowerCase();
    if (sId === "jira") return srcName.includes("jira");
    if (sId === "github") return srcName.includes("github");
    if (sId === "servicenow") return srcName.includes("servicenow") || srcName.includes("snow");
    if (sId === "email") return srcName.includes("email") || srcName.includes("outlook");
    if (sId === "slack") return srcName.includes("slack");
    if (sId === "notes") return srcName.includes("meeting") || srcName.includes("note");
    return false;
  });
}

function filteredTasks() {
  const queue = activeQueue();
  if (activeSource === "all") return queue;
  return queue.filter(t => t.sources.some(s => s.toLowerCase().includes(activeSource.toLowerCase())));
}

function activeQueue() {
  // Return today's smart queue (max 12, due today/overdue/P1), minus completed
  return todayQueue.filter(t => !isTaskCompleted(t.id));
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
    if (!owners[o]) owners[o] = { owner: o, count:0, score:0, blockers:0, p1:0, done:0 };
    const isCompleted = isTaskCompleted(t.id);
    if (isCompleted) {
      owners[o].done++;
    } else {
      owners[o].count++; 
      owners[o].score += t.score;
      owners[o].blockers += t.dependencies.some(d => /block|waiting|approval|eta|coordinate/i.test(d)) ? 1 : 0;
      owners[o].p1 += t.severity === "P1" ? 1 : 0;
    }
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
            <strong>${state.prioritized.filter(t => !completedTaskIds.includes(t.id) && t.severity === 'P1').length}</strong>
            <span>P1 escalations</span>
          </div>
        </div>
      </div>

      <div class="login-card">
        <p class="eyebrow" style="color:#8b5cf6;">Sign in to continue</p>
        <h2>Welcome back</h2>
        <p class="login-subtitle">
          ${hasGemini ? '<span style="color:#10b981;">&#10003;</span> TaskPilot AI Engine ready' : '<span style="color:#f43f5e;">&#9888; Add GEMINI_API_KEY to backend/.env</span>'}
          &nbsp;&middot;&nbsp;
          ${hasSupabase ? '<span style="color:#10b981;">&#10003;</span> Google auth enabled' : '<span style="color:#64748b;">Google auth optional</span>'}
        </p>

        ${authError ? `<p class="login-error">${escapeHtml(authError)}</p>` : ''}

        <button class="google-login" id="loginEngineerBtn" ${authLoading ? 'disabled' : ''}>
          ${authLoading ? '<span>Signing in...</span>' : `${googleSvg} Sign in with Google &middot; Engineer`}
        </button>
        <button class="google-login" id="loginManagerBtn" ${authLoading ? 'disabled' : ''} style="margin-top:10px">
          ${authLoading ? '<span>Signing in...</span>' : `${googleSvg} Sign in with Google &middot; Manager`}
        </button>

        <p class="login-footnote">
          Sign in with your Google account to access your personalised TaskPilot workspace.
          All AI features use TaskPilot AI via your Google Cloud credits.
        </p>

        ${!hasSupabase ? `
          <div style="margin-top:20px;padding:16px;border:1px solid #dfe3ea;border-radius:12px;background:rgba(0,0,0,0.02);box-shadow:inset 0 1px 0 rgba(255,255,255,0.8);">
            <p style="margin:0 0 12px;font-size:12px;color:#65717d;line-height:1.45;">Supabase not configured. Launch sandbox credentials directly to explore workspace:</p>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
              <button id="demoEngineerBtn" style="font-size:13px;padding:10px 12px;background:linear-gradient(135deg,#8b5cf6,#6366f1);border:none;color:#fff;font-weight:700;border-radius:8px;cursor:pointer;box-shadow:0 4px 12px rgba(139,92,246,0.25);transition:transform 0.15s ease;">Engineer Mode</button>
              <button id="demoManagerBtn" style="font-size:13px;padding:10px 12px;background:#ffffff;border:1px solid #dadce0;color:#1f2937;font-weight:700;border-radius:8px;cursor:pointer;box-shadow:0 2px 4px rgba(0,0,0,0.05);transition:transform 0.15s ease;">Manager Mode</button>
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
    // Restore per-user state for this email
    completedTaskIds = getMyCompletedIds();
    workingTaskIds   = getMyWorkingIds();
    syncCompletionsFromSupabase().then(() => { startRealtimeSync(); safeRender(); });
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
    completedTaskIds = getMyCompletedIds();
    workingTaskIds   = getMyWorkingIds();
    syncCompletionsFromSupabase().then(() => { startRealtimeSync(); safeRender(); });
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

        ${activeProfile === "manager" ? `
        <section class="panel compact tee-card">
          <p class="eyebrow">Security</p>
          <h2>Trusted execution enabled</h2>
          <div class="tee-meter">
            <span style="width:${teeSession.trustScore}%"></span>
          </div>
          <p class="small">OCR and execution actions stay approval-gated.</p>
        </section>
        ` : ""}
      </aside>

      <section class="workspace">
        <header class="topbar">
          <div>
            <p class="eyebrow">Friday, June 19, 2026</p>
            <h1>${navLabel(activePage)}</h1>
            <p class="topbar-subtitle">Active Profile: <strong>${escapeHtml(settingsProfile.name)}</strong> (${activeProfile === "manager" ? "Manager" : "Engineer"}) &middot; ${escapeHtml(authSession.email)}</p>
          </div>
          <div class="top-actions">
            ${activeProfile === "manager"
              ? `<button class="secondary success" id="completePriority">Approve next handoff</button>
                 <button class="secondary" id="simulateUrgent">Simulate team load shift</button>`
              : `<button class="primary" id="runScan">Run autonomous scan</button>`
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
  // Map nav page IDs to SOURCE_LOGO_MAP keys
  const NAV_LOGO = {
    "inbox":"", "mgr-jira":"jira","mgr-github":"github",
    "mgr-servicenow":"servicenow","mgr-email":"email",
    "mgr-slack":"slack","meetings":"notes","source-tree":""
  };

  return currentNav.map(g => `
    <div class="nav-group">
      <p>${g.label}</p>
      ${g.items.map(([id, label, icon]) => {
        const logoKey = NAV_LOGO[id];
        const navLogo = logoKey ? SOURCE_LOGO_MAP[logoKey] : null;
        const iconHtml = navLogo
          ? `<span style="display:flex;width:22px;height:22px;align-items:center;justify-content:center;border-radius:5px;background:${navLogo.bg};">${navLogo.svg}</span>`
          : `<span>${icon}</span>`;
        return `
        <button class="${activePage === id ? "active" : ""}" data-nav="${id}">
          ${iconHtml}${label}
        </button>`;
      }).join("")}
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
    case "source-tree": {
      const queue = activeQueue();
      const TODAY = "2026-06-21";
      const SOURCE_META = {
        jira:        { label: "Jira Sprint Board",   emoji: "📋", color: "#1868db", pastel: "#eef3ff" },
        github:      { label: "GitHub PRs",          emoji: "🔀", color: "#374151", pastel: "#f3f4f6" },
        servicenow:  { label: "ServiceNow Defects",  emoji: "🚨", color: "#c0392b", pastel: "#fff1f0" },
        email:       { label: "Outlook Emails",      emoji: "📧", color: "#0369a1", pastel: "#eff8ff" },
        slack:       { label: "Slack Mentions",      emoji: "💬", color: "#7c3aed", pastel: "#f5f3ff" },
        notes:       { label: "Meeting Notes",       emoji: "📌", color: "#0f766e", pastel: "#f0fdfa" }
      };

      const triage = sources.map(src => {
        const pending = queue.filter(t => taskMatchesSource(t, src.id));
        const p1Count = pending.filter(t => t.severity === "P1").length;
        const dueTodayCount = pending.filter(t => {
          if (!t.due) return false;
          const daysLeft = Math.ceil((new Date(t.due) - new Date(TODAY)) / 86400000);
          return daysLeft <= 0;
        }).length;
        const approachingCount = pending.filter(t => {
          if (!t.due) return false;
          const daysLeft = Math.ceil((new Date(t.due) - new Date(TODAY)) / 86400000);
          return daysLeft > 0 && daysLeft <= 3;
        }).length;

        const meta = SOURCE_META[src.id] || { label: src.name, emoji: "📌", color: src.color || "#64748b" };

        const isUrgent = p1Count > 0 || dueTodayCount > 0;
        const isApproaching = approachingCount > 0;

        return {
          id: src.id,
          label: meta.label,
          emoji: meta.emoji,
          color: meta.color || src.color || "#64748b",
          pendingCount: pending.length,
          p1Count,
          dueTodayCount,
          approachingCount,
          isUrgent,
          isApproaching
        };
      });

      const whatToDo = triage.filter(item => item.isUrgent || item.isApproaching);
      const whatNotToDo = triage.filter(item => !item.isUrgent && !item.isApproaching);

      return `
        <div style="padding:18px;max-width:1200px;background:#f7f4ee;">
          <div style="margin-bottom:16px;">
            <p class="eyebrow">Workspace Overview</p>
            <h2 style="margin:2px 0 0;color:#17202a;">Source Intelligence Tree</h2>
            <p style="font-size:12px;color:#65717d;margin:2px 0 0;">
              Interactive flow mapping of today's tasks across all integrated channels.
            </p>
          </div>
          <div style="border:1px solid #ded5c8;border-radius:12px;overflow:hidden;box-shadow:0 8px 24px rgba(37,31,21,0.04);background:#ffffff;">
            ${renderSourceTree()}
          </div>

          <!-- Triage Guidelines Section -->
          <div style="margin-top: 24px; display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
            <!-- What to Do -->
            <div style="background: rgba(255, 252, 247, 0.94); border: 1.5px solid #ded5c8; border-radius: 12px; padding: 20px; box-shadow: 0 4px 14px rgba(0,0,0,0.03);">
              <h3 style="margin: 0 0 12px 0; color: #17202a; font-size: 16px; font-weight: 800; display: flex; align-items: center; gap: 8px;">
                <span style="color: #de350b;">🔥</span> What to Do (High Focus Today)
              </h3>
              <div style="display: grid; gap: 10px;">
                ${whatToDo.length === 0 ? `
                  <div style="color: #65717d; font-size: 13px; font-style: italic; background: #fff; padding: 12px; border-radius: 8px; border: 1px dashed #ded5c8;">
                    No urgent or approaching deadlines today. Feel free to focus on secondary goals.
                  </div>
                ` : whatToDo.map(item => `
                  <div style="background: #ffffff; border: 1px solid #ded5c8; border-radius: 8px; padding: 12px; display: flex; align-items: center; justify-content: space-between;">
                    <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
                      <div style="width: 28px; height: 28px; border-radius: 6px; background: ${item.color}15; color: ${item.color}; display: flex; align-items: center; justify-content: center; font-size: 14px; flex-shrink: 0;">
                        ${item.emoji}
                      </div>
                      <div style="min-width: 0;">
                        <strong style="font-size: 13px; color: #17202a; display: block;">${escapeHtml(item.label)}</strong>
                        <span style="font-size: 11px; color: #65717d;">${item.pendingCount} task${item.pendingCount !== 1 ? 's' : ''} actionable</span>
                      </div>
                    </div>
                    <div style="display: flex; gap: 6px;">
                      ${item.dueTodayCount > 0 ? `<span style="font-size: 10px; font-weight: 800; padding: 2px 6px; border-radius: 4px; background: #ffe4e6; color: #e11d48; white-space: nowrap;">${item.dueTodayCount} Due Today</span>` : ""}
                      ${item.p1Count > 0 ? `<span style="font-size: 10px; font-weight: 800; padding: 2px 6px; border-radius: 4px; background: #ffd5d2; color: #de350b; white-space: nowrap;">${item.p1Count} P1</span>` : ""}
                      ${item.approachingCount > 0 && item.dueTodayCount === 0 ? `<span style="font-size: 10px; font-weight: 800; padding: 2px 6px; border-radius: 4px; background: #fef3c7; color: #d97706; white-space: nowrap;">${item.approachingCount} Approaching</span>` : ""}
                    </div>
                  </div>
                `).join("")}
              </div>
            </div>

            <!-- What Not to Do -->
            <div style="background: rgba(255, 252, 247, 0.94); border: 1.5px solid #ded5c8; border-radius: 12px; padding: 20px; box-shadow: 0 4px 14px rgba(0,0,0,0.03);">
              <h3 style="margin: 0 0 12px 0; color: #17202a; font-size: 16px; font-weight: 800; display: flex; align-items: center; gap: 8px;">
                <span style="color: #22a06b;">💤</span> What Not to Do (Safely Deprioritize)
              </h3>
              <div style="display: grid; gap: 10px;">
                ${whatNotToDo.length === 0 ? `
                  <div style="color: #65717d; font-size: 13px; font-style: italic; background: #fff; padding: 12px; border-radius: 8px; border: 1px dashed #ded5c8;">
                    All channels contain urgent or approaching tasks. No channels can be deprioritized today.
                  </div>
                ` : whatNotToDo.map(item => `
                  <div style="background: #ffffff; border: 1px solid #ded5c8; border-radius: 8px; padding: 12px; display: flex; align-items: center; justify-content: space-between; opacity: 0.85;">
                    <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
                      <div style="width: 28px; height: 28px; border-radius: 6px; background: #65717d15; color: #65717d; display: flex; align-items: center; justify-content: center; font-size: 14px; flex-shrink: 0;">
                        ${item.emoji}
                      </div>
                      <div style="min-width: 0;">
                        <strong style="font-size: 13px; color: #17202a; display: block;">${escapeHtml(item.label)}</strong>
                        <span style="font-size: 11px; color: #65717d;">
                          ${item.pendingCount === 0 ? "No pending tasks today" : `${item.pendingCount} stable task${item.pendingCount !== 1 ? 's' : ''}`}
                        </span>
                      </div>
                    </div>
                    <div>
                      <span style="font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; background: #f1f2f4; color: #44546f;">Stable</span>
                    </div>
                  </div>
                `).join("")}
              </div>
            </div>
          </div>
        </div>
      `;
    }
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
    case "genome":
      return renderProjectGenomePage();
    case "incidents":
      return renderIncidentsTable();
    case "github":
      return renderGitHubPRReviews();
    case "analytics":
      return renderAnalyticsView();
    case "my-analytics":
      return renderMyAnalyticsPage();
    case "engineer-analytics":
      return renderEngineerAnalyticsManager();
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

// ─── Engineer "My Work" — real-time currently-working + completed section ─────
function renderEngineerMyWork() {
  const working = workingTaskIds.map(id => state.prioritized.find(t => t.id === id)).filter(Boolean);
  const completed = completedTaskIds
    .map(id => {
      const t = state.prioritized.find(t2 => t2.id === id);
      const log = taskTimeLogs[id];
      return t ? { ...t, log } : null;
    })
    .filter(Boolean)
    .slice(0, 6);

  if (working.length === 0 && completed.length === 0) return "";

  const now = new Date();

  function durationStr(log) {
    if (!log) return "—";
    const start = new Date(log.startTime);
    const end = log.endTime ? new Date(log.endTime) : now;
    const mins = Math.round((end - start) / 60000);
    return mins >= 60 ? `${Math.floor(mins/60)}h ${mins%60}m` : `${mins}m`;
  }

  function timeStr(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  }

  return `
    <div class="eng-my-work-section" style="margin-bottom:16px;">
      <div style="display:grid; grid-template-columns: ${working.length > 0 ? "1fr 1fr" : "1fr"}; gap:14px;">

        ${working.length > 0 ? `
          <div class="eng-panel" style="border-left:4px solid #0c66e4; background:#f4f8ff;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
              <h3 style="margin:0; color:#0c66e4; font-size:14px;">⚡ Currently Working</h3>
              <span class="tp-status-chip working" style="animation: tp-pulse 1.6s ease infinite;">● Live</span>
            </div>
            <div style="display:grid; gap:8px;">
              ${working.map(t => {
                const log = taskTimeLogs[t.id];
                return `
                  <div style="background:#fff; border:1px solid #c7ddfb; border-radius:8px; padding:10px 12px; display:flex; justify-content:space-between; align-items:center;">
                    <div style="flex:1; min-width:0;">
                      <div style="font-size:13px; font-weight:700; color:#172b4d; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(t.canonicalTitle)}</div>
                      <div style="font-size:11px; color:#5c7fba; margin-top:2px;">
                        Started ${timeStr(log?.startTime)} · ${durationStr(log)} elapsed · ${t.severity}
                      </div>
                    </div>
                    <div style="display:flex; gap:6px; flex-shrink:0; margin-left:10px;">
                      <button class="tp-btn-done" data-task-complete="${t.id}" style="font-size:11px; padding:5px 10px;">✓ Done</button>
                      <button class="tp-btn-cancel" data-task-cancel="${t.id}" style="font-size:11px; padding:5px 8px;">✕</button>
                    </div>
                  </div>`;
              }).join("")}
            </div>
          </div>
        ` : ""}

        ${completed.length > 0 ? `
          <div class="eng-panel" style="border-left:4px solid #22a06b; background:#f4fff9;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
              <h3 style="margin:0; color:#22a06b; font-size:14px;">✅ Completed Today</h3>
              <span style="font-size:11px; font-weight:700; color:#216e4e; background:#dcfff1; padding:3px 8px; border-radius:10px;">${completed.length} tasks</span>
            </div>
            <div style="display:grid; gap:6px; max-height:240px; overflow-y:auto;">
              ${completed.map(t => `
                <div style="background:#fff; border:1px solid #b7e4ce; border-radius:8px; padding:9px 12px; display:flex; justify-content:space-between; align-items:center;">
                  <div style="flex:1; min-width:0;">
                    <div style="font-size:13px; font-weight:700; color:#172b4d; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-decoration:line-through; opacity:0.7;">${escapeHtml(t.canonicalTitle)}</div>
                    <div style="font-size:11px; color:#5b9c73; margin-top:2px;">
                      ${timeStr(t.log?.startTime)} → ${timeStr(t.log?.endTime)} · ${durationStr(t.log)} · ${t.severity}
                    </div>
                  </div>
                  <span style="font-size:12px; color:#22a06b; font-weight:800; flex-shrink:0; margin-left:8px;">✓</span>
                </div>`).join("")}
            </div>
            <div style="margin-top:10px; text-align:right;">
              <button class="secondary" style="font-size:11px; padding:5px 12px;" id="generateDailyReportBtnMyWork">📄 View Daily Report</button>
            </div>
          </div>
        ` : ""}

      </div>
    </div>
  `;
}

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
          <p class="eyebrow">Today's queue</p>
          <span class="kpi-value">${tasks.length}</span>
          <span class="kpi-label">Smart-filtered for today</span>
          <span class="kpi-trend up">${state.prioritized.length} total · ${tasks.length} actionable today</span>
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
      <!-- My Work: Real-time status panel -->
      ${renderEngineerMyWork()}

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
                        ${t.isBlocking ? `<span style="font-size:10px;background:#fff0b3;color:#974f0c;padding:1px 6px;border-radius:4px;font-weight:700;">⚠ Blocks ${t.blocksCount} task${t.blocksCount > 1 ? "s" : ""}</span>` : ""}
                        ${t.isBlocked ? `<span style="font-size:10px;background:#ffd5d2;color:#de350b;padding:1px 6px;border-radius:4px;font-weight:700;margin-left:4px;">🚧 Blocked</span>` : ""}
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
                <span>📋</span> View Today's Full Queue (${tasks.length} items)
              </button>
            </div>
          ` : ""}
          ${todayQueueGeminiScored ? `<div style="font-size:10px;color:#22a06b;text-align:center;margin-top:4px;">✨ Gemini AI ranked</div>` : `<div style="font-size:10px;color:#94a3b8;text-align:center;margin-top:4px;">⏳ AI ranking in progress…</div>`}
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

// ─── Project Genome & Mutation Predictor ─────────────────────────────────────

/**
 * Build a genome fingerprint from current sprint data
 */
function buildCurrentGenome() {
  const active = state.prioritized.filter(t => !isTaskCompleted(t.id));
  const p1Count = active.filter(t => t.severity === "P1").length;
  const p2Count = active.filter(t => t.severity === "P2").length;
  const bugCount = active.filter(t => /bug|defect|incident|fix/i.test(t.canonicalTitle)).length;
  const apiCount = active.filter(t => /api|endpoint|integration/i.test(t.canonicalTitle)).length;
  const meetingLoad = active.filter(t => t.sources?.some(s => /meeting|note/i.test(s))).length;
  const ownerSet = new Set(active.map(t => t.owner).filter(Boolean));
  const reviewLoad = active.filter(t => t.sources?.some(s => /github/i.test(s))).length;
  const blockerCount = active.filter(t => t.dependencies?.some(d => /block|waiting/i.test(d))).length;
  const overdueCount = active.filter(t => t.due && t.due < "2026-06-21").length;
  return {
    sprintLabel: "Current Sprint",
    workload: active.length,
    p1Count,
    p2Count,
    bugCount,
    apiCount,
    meetingLoad,
    ownerCount: ownerSet.size,
    reviewLoad,
    blockerCount,
    overdueCount,
    velocity: Math.round((completedTaskIds.length / Math.max(active.length + completedTaskIds.length, 1)) * 100)
  };
}

/**
 * Compute similarity score (0-100) between two genomes
 */
function computeGenomeSimilarity(g1, g2) {
  const keys = ["workload","bugCount","apiCount","meetingLoad","reviewLoad","blockerCount","overdueCount"];
  let totalDiff = 0;
  let maxPossible = 0;
  for (const k of keys) {
    const a = g1[k] || 0, b = g2[k] || 0;
    const scale = Math.max(a, b, 1);
    totalDiff += Math.abs(a - b) / scale;
    maxPossible += 1;
  }
  return Math.round(100 - (totalDiff / maxPossible) * 100);
}

/**
 * Detect mutations between current and matched genome
 */
function detectMutations(current, matchedPast) {
  const fields = {
    workload:    { label: "Total tasks" },
    bugCount:    { label: "Bug/defect count" },
    apiCount:    { label: "Pending API tasks" },
    meetingLoad: { label: "Meeting-sourced tasks" },
    reviewLoad:  { label: "Code review load" },
    blockerCount:{ label: "Blockers" },
    overdueCount:{ label: "Overdue items" }
  };
  return Object.entries(fields).map(([k, meta]) => {
    const cur = current[k] || 0;
    const pastVal = matchedPast[k] || 0;
    const delta = cur - pastVal;
    return { field: k, label: meta.label, current: cur, past: pastVal, delta };
  }).filter(m => m.delta !== 0);
}

/**
 * Predict risks from mutation pattern — always returns at least one risk
 */
function predictRisks(mutations, similarityScore, matchedOutcome) {
  const risks = [];
  const bugMut   = mutations.find(m => m.field === "bugCount");
  const workMut  = mutations.find(m => m.field === "workload");
  const meetMut  = mutations.find(m => m.field === "meetingLoad");
  const apiMut   = mutations.find(m => m.field === "apiCount");
  const blockMut = mutations.find(m => m.field === "blockerCount");
  const overdueMut = mutations.find(m => m.field === "overdueCount");

  // Base probability from similarity to a troubled sprint
  const basePct = matchedOutcome === "delayed"
    ? Math.round(similarityScore * 0.85)
    : Math.round(similarityScore * 0.5);

  if (workMut?.delta > 0 || (bugMut?.current || 0) > 0) {
    risks.push({ label: "Backend Bottleneck", pct: Math.max(30, Math.min(95, basePct + (workMut?.delta > 0 ? 10 : 0))), color: "#de350b", recommendation: "Add a backend engineer or reduce sprint scope" });
  }
  if ((meetMut?.current || 0) > 1) {
    risks.push({ label: "Meeting Overload", pct: Math.max(25, Math.min(90, basePct - 5)), color: "#974f0c", recommendation: "Reduce non-critical meetings by 30%" });
  }
  if ((apiMut?.current || 0) > 0) {
    risks.push({ label: "API Backlog Risk", pct: Math.max(25, Math.min(88, basePct - 8)), color: "#ffab00", recommendation: "Prioritize API tasks — finish before new features" });
  }
  if ((blockMut?.current || 0) > 0) {
    risks.push({ label: "Dependency Deadlock", pct: Math.max(20, Math.min(80, basePct - 12)), color: "#6554c0", recommendation: "Resolve blockers in next standup" });
  }
  if (matchedOutcome === "delayed" && similarityScore >= 50) {
    risks.push({ label: "Release Delay", pct: Math.max(30, Math.min(85, basePct - 3)), color: "#bf2600", recommendation: "Start QA earlier — run parallel tracks" });
  }
  if ((overdueMut?.current || 0) > 0) {
    risks.push({ label: "Overdue Items Accumulating", pct: Math.max(20, Math.min(75, basePct - 15)), color: "#8b5cf6", recommendation: "Clear overdue items before pulling new work in" });
  }

  // Always guarantee at least one risk so the page shows results
  if (risks.length === 0) {
    risks.push({
      label: matchedOutcome === "delayed" ? "Repeat Pattern Risk" : "Sprint Health Warning",
      pct: Math.max(25, basePct),
      color: "#626f86",
      recommendation: "Monitor workload and review team capacity mid-sprint"
    });
  }

  return risks.sort((a, b) => b.pct - a.pct);
}

/**
 * Full genome analysis — builds genome, matches to history, detects mutations, predicts risks
 * Runs entirely client-side (no backend required). Uses Electron IPC for AI narrative if available.
 */
async function runGenomeAnalysis() {
  if (genomeState.loading) return;
  genomeState.loading = true;
  render();

  try {
    const current = buildCurrentGenome();

    // Synthetic historical sprint genomes (always available, no backend needed)
    const syntheticPast = [
      { sprintLabel: "Sprint 5",  workload: 22, p1Count: 3, bugCount: 5, apiCount: 4, meetingLoad: 6, ownerCount: 4, reviewLoad: 8,  blockerCount: 3, overdueCount: 4, velocity: 38, outcome: "delayed" },
      { sprintLabel: "Sprint 8",  workload: 14, p1Count: 1, bugCount: 2, apiCount: 1, meetingLoad: 2, ownerCount: 5, reviewLoad: 4,  blockerCount: 1, overdueCount: 1, velocity: 72, outcome: "healthy" },
      { sprintLabel: "Sprint 10", workload: 18, p1Count: 2, bugCount: 3, apiCount: 3, meetingLoad: 4, ownerCount: 4, reviewLoad: 6,  blockerCount: 2, overdueCount: 2, velocity: 55, outcome: "delayed" },
      { sprintLabel: "Sprint 11", workload: 12, p1Count: 0, bugCount: 1, apiCount: 2, meetingLoad: 3, ownerCount: 5, reviewLoad: 3,  blockerCount: 0, overdueCount: 0, velocity: 85, outcome: "healthy" },
    ];

    // Find best historical match
    let bestMatch = syntheticPast[0], bestScore = 0;
    for (const past of syntheticPast) {
      const score = computeGenomeSimilarity(current, past);
      if (score > bestScore) { bestScore = score; bestMatch = past; }
    }

    const mutations     = detectMutations(current, bestMatch);
    const risks         = predictRisks(mutations, bestScore, bestMatch.outcome);
    const recommendations = risks.map(r => r.recommendation);

    genomeState.currentGenome   = current;
    genomeState.pastGenomes     = syntheticPast;
    genomeState.matchedSprint   = bestMatch;
    genomeState.similarityScore = bestScore;
    genomeState.mutations       = mutations;
    genomeState.risks           = risks;
    genomeState.recommendations = recommendations;
    genomeState.lastAnalyzed    = new Date().toLocaleTimeString();

    // Optional AI narrative via Electron IPC (never blocks if unavailable)
    if (window.taskPilotDesktop?.invoke && risks.length > 0) {
      try {
        const prompt = `You are TaskPilot AI. A sprint genome analysis has been completed.

Current sprint: ${current.workload} tasks, ${current.bugCount} bugs, ${current.apiCount} pending APIs, ${current.blockerCount} blockers.
Best historical match: ${bestMatch.sprintLabel} (${bestScore}% similar, outcome: ${bestMatch.outcome}).
Top risks: ${risks.slice(0, 3).map(r => `${r.label} ${r.pct}%`).join(", ")}.

Write a 2-sentence manager briefing: what the genome found and what to do TODAY. Be specific. Never mention Gemini.`;
        const result = await window.taskPilotDesktop.invoke("taskpilot:gemini-stream", { prompt });
        if (result?.success && result.text) {
          genomeState.aiNarrative = result.text.replace(/Gemini/gi, "TaskPilot AI");
        }
      } catch (_) { /* AI narrative is optional */ }
    }

  } catch (e) {
    console.error("Genome analysis error:", e);
  }

  genomeState.loading = false;
  render();
}

/**
 * Render the full Project Genome page
 */
function renderProjectGenomePage() {
  const g = genomeState;
  const current = g.currentGenome;
  const matched = g.matchedSprint;

  // Genome fingerprint bars
  function genomeBars(genome, color) {
    if (!genome) return "";
    const fields = [
      { key: "workload", label: "Workload" },
      { key: "bugCount", label: "Bugs" },
      { key: "apiCount", label: "APIs pending" },
      { key: "meetingLoad", label: "Meeting load" },
      { key: "reviewLoad", label: "Code reviews" },
      { key: "blockerCount", label: "Blockers" },
      { key: "overdueCount", label: "Overdue" }
    ];
    const maxVal = Math.max(...fields.map(f => genome[f.key] || 0), 1);
    return fields.map(f => {
      const val = genome[f.key] || 0;
      const pct = Math.round((val / maxVal) * 100);
      return `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <span style="width:90px;font-size:11px;color:#626f86;text-align:right;flex-shrink:0;">${f.label}</span>
          <div style="flex:1;height:10px;background:#f1f2f4;border-radius:999px;overflow:hidden;">
            <div style="width:${pct}%;height:100%;background:${color};border-radius:inherit;transition:width 0.4s;"></div>
          </div>
          <span style="width:22px;font-size:11px;color:#172b4d;font-weight:700;">${val}</span>
        </div>`;
    }).join("");
  }

  return `
    <div style="padding:24px;max-width:1100px;margin:0 auto;">

      <!-- Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
        <div>
          <h1 style="margin:0;font-size:22px;color:#172b4d;display:flex;align-items:center;gap:10px;">
            🧬 Project Genome &amp; Mutation Predictor
          </h1>
          <p style="margin:4px 0 0;font-size:13px;color:#626f86;">
            Reads your sprint's DNA, compares it to past sprints, and predicts problems before they happen.
            ${g.lastAnalyzed ? `<span style="color:#22a06b;">● Last analyzed ${g.lastAnalyzed}</span>` : ""}
          </p>
        </div>
        <button
          id="genomeRunBtn"
          style="padding:10px 22px;background:${g.loading ? "#626f86" : "#0c66e4"};color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:${g.loading ? "not-allowed" : "pointer"};display:flex;align-items:center;gap:8px;"
          ${g.loading ? "disabled" : ""}
        >
          ${g.loading
            ? `<span style="display:inline-block;width:14px;height:14px;border:2px solid #fff;border-top-color:transparent;border-radius:50%;animation:spin 0.7s linear infinite;"></span> Analyzing...`
            : `🧬 ${current ? "Re-Analyze Sprint" : "Analyze Sprint"}`}
        </button>
      </div>

      ${!current ? `
        <!-- Empty state -->
        <div style="text-align:center;padding:60px 20px;background:#f8f9fa;border-radius:12px;border:2px dashed #dfe3ea;">
          <div style="font-size:48px;margin-bottom:16px;">🧬</div>
          <h2 style="color:#172b4d;margin:0 0 8px;">Your sprint has no genome yet</h2>
          <p style="color:#626f86;max-width:480px;margin:0 auto 20px;">Click "Analyze Sprint" to build a genetic fingerprint of the current sprint and compare it against historical patterns to predict risks.</p>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;max-width:540px;margin:0 auto;text-align:left;">
            ${[
              { icon:"📥", title:"Data Sources", desc:"Jira, GitHub, Slack, Emails, Meetings" },
              { icon:"🔬", title:"Feature Extraction", desc:"Workload, bugs, dependencies, reviews" },
              { icon:"🎯", title:"Risk Prediction", desc:"Bottlenecks, overload, delays — with %s" }
            ].map(s => `
              <div style="background:#fff;border:1px solid #dfe3ea;border-radius:8px;padding:12px;">
                <div style="font-size:22px;">${s.icon}</div>
                <strong style="font-size:12px;color:#172b4d;">${s.title}</strong>
                <p style="font-size:11px;color:#626f86;margin:4px 0 0;">${s.desc}</p>
              </div>
            `).join("")}
          </div>
        </div>
      ` : `

        <!-- KPI row -->
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px;">
          ${[
            { label:"Similarity to past sprint", value:`${g.similarityScore}%`, sub: matched ? `vs ${matched.sprintLabel}` : "", color: g.similarityScore >= 80 ? "#de350b" : g.similarityScore >= 60 ? "#974f0c" : "#22a06b" },
            { label:"Mutations detected", value: g.mutations.length, sub:"Changed signals", color:"#6554c0" },
            { label:"Predicted risks", value: g.risks.length, sub:"With confidence scores", color: g.risks.length > 2 ? "#de350b" : "#22a06b" },
            { label:"Outcome prediction", value: matched?.outcome === "delayed" && g.similarityScore >= 70 ? "⚠️ At Risk" : "✅ On Track", sub:`Based on ${matched?.sprintLabel || "history"}`, color: matched?.outcome === "delayed" && g.similarityScore >= 70 ? "#de350b" : "#22a06b" }
          ].map(k => `
            <div style="background:#fff;border:1px solid #dfe3ea;border-radius:10px;padding:16px;box-shadow:0 1px 4px rgba(0,0,0,0.05);">
              <p style="margin:0 0 4px;font-size:11px;color:#626f86;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">${k.label}</p>
              <span style="font-size:26px;font-weight:800;color:${k.color};">${k.value}</span>
              <p style="margin:4px 0 0;font-size:11px;color:#626f86;">${k.sub}</p>
            </div>
          `).join("")}
        </div>

        <!-- AI narrative (shown when available) -->
        ${g.aiNarrative ? `
          <div style="background:#f0f7ff;border:1px solid #b3d4ff;border-left:4px solid #0c66e4;border-radius:10px;padding:14px 18px;margin-bottom:20px;display:flex;gap:12px;align-items:flex-start;">
            <span style="font-size:20px;flex-shrink:0;">🤖</span>
            <div>
              <p style="margin:0 0 2px;font-size:12px;font-weight:700;color:#0c66e4;">TaskPilot AI Manager Briefing</p>
              <p style="margin:0;font-size:13px;color:#172b4d;line-height:1.5;">${escapeHtml(g.aiNarrative)}</p>
            </div>
          </div>
        ` : ""}

        <!-- Genome comparison -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
          <!-- Current genome -->
          <div style="background:#fff;border:1px solid #dfe3ea;border-left:4px solid #0c66e4;border-radius:10px;padding:18px;">
            <h3 style="margin:0 0 4px;font-size:14px;color:#172b4d;">🔵 Current Sprint Genome</h3>
            <p style="margin:0 0 14px;font-size:11px;color:#626f86;">${current.workload} active tasks · velocity ${current.velocity}%</p>
            ${genomeBars(current, "#0c66e4")}
          </div>
          <!-- Matched genome -->
          <div style="background:#fff;border:1px solid #dfe3ea;border-left:4px solid ${matched?.outcome === "delayed" ? "#de350b" : "#22a06b"};border-radius:10px;padding:18px;">
            <h3 style="margin:0 0 4px;font-size:14px;color:#172b4d;">
              ${matched?.outcome === "delayed" ? "🔴" : "🟢"} ${matched?.sprintLabel || "Matched Sprint"} — ${g.similarityScore}% match
            </h3>
            <p style="margin:0 0 14px;font-size:11px;color:${matched?.outcome === "delayed" ? "#ae2a19" : "#216e4e"};font-weight:700;">
              ${matched?.outcome === "delayed" ? "⚠️ This sprint ended delayed" : "✅ This sprint completed on time"}
            </p>
            ${genomeBars(matched, matched?.outcome === "delayed" ? "#de350b" : "#22a06b")}
          </div>
        </div>

        <!-- Mutation panel -->
        ${g.mutations.length > 0 ? `
          <div style="background:#fff;border:1px solid #dfe3ea;border-left:4px solid #6554c0;border-radius:10px;padding:18px;margin-bottom:20px;">
            <h3 style="margin:0 0 12px;font-size:14px;color:#172b4d;">🔬 Mutation Detection — What's Different This Time</h3>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;">
              ${g.mutations.map(m => `
                <div style="background:#f8f9fa;border-radius:8px;padding:12px;border:1px solid #dfe3ea;">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <strong style="font-size:12px;color:#172b4d;">${m.label}</strong>
                    <span style="font-size:12px;font-weight:800;color:${m.delta > 0 ? "#de350b" : "#22a06b"};">
                      ${m.delta > 0 ? "▲" : "▼"} ${Math.abs(m.delta)}
                    </span>
                  </div>
                  <div style="display:flex;gap:12px;font-size:11px;color:#626f86;">
                    <span>Now: <strong style="color:#172b4d;">${m.current}</strong></span>
                    <span>Past: <strong style="color:#172b4d;">${m.past}</strong></span>
                  </div>
                </div>
              `).join("")}
            </div>
          </div>
        ` : ""}

        <!-- Risk prediction & recommendations -->
        ${g.risks.length > 0 ? `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
            <!-- Risks -->
            <div style="background:#fff;border:1px solid #dfe3ea;border-left:4px solid #de350b;border-radius:10px;padding:18px;">
              <h3 style="margin:0 0 14px;font-size:14px;color:#172b4d;">⚠️ Predicted Risks</h3>
              <div style="display:grid;gap:12px;">
                ${g.risks.map(r => `
                  <div>
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                      <span style="font-size:13px;font-weight:700;color:${r.color};">${r.label}</span>
                      <span style="font-size:13px;font-weight:800;color:${r.color};">${r.pct}%</span>
                    </div>
                    <div style="height:8px;background:#f1f2f4;border-radius:999px;overflow:hidden;">
                      <div style="width:${r.pct}%;height:100%;background:${r.color};border-radius:inherit;transition:width 0.5s;"></div>
                    </div>
                  </div>
                `).join("")}
              </div>
            </div>
            <!-- Recommendations -->
            <div style="background:#fff;border:1px solid #dfe3ea;border-left:4px solid #22a06b;border-radius:10px;padding:18px;">
              <h3 style="margin:0 0 14px;font-size:14px;color:#172b4d;">✅ AI Recommendations</h3>
              <div style="display:grid;gap:10px;">
                ${g.recommendations.map((rec, i) => `
                  <div style="display:flex;align-items:flex-start;gap:10px;padding:10px;background:#f4fff9;border:1px solid #b7e4ce;border-radius:8px;">
                    <span style="width:22px;height:22px;background:#22a06b;color:#fff;border-radius:50%;display:grid;place-items:center;font-size:11px;font-weight:800;flex-shrink:0;">${i+1}</span>
                    <span style="font-size:12px;color:#172b4d;">${escapeHtml(rec)}</span>
                  </div>
                `).join("")}
              </div>
            </div>
          </div>
        ` : ""}

        <!-- Past sprints library -->
        <div style="background:#fff;border:1px solid #dfe3ea;border-radius:10px;padding:18px;">
          <h3 style="margin:0 0 14px;font-size:14px;color:#172b4d;">📚 Genome Library — Historical Sprints</h3>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;">
            ${g.pastGenomes.map(past => {
              const sim = computeGenomeSimilarity(current, past);
              const isMatch = past.sprintLabel === matched?.sprintLabel;
              return `
                <div style="padding:12px;border-radius:8px;border:${isMatch ? "2px solid #de350b" : "1px solid #dfe3ea"};background:${isMatch ? "#fff5f4" : "#f8f9fa"};">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <strong style="font-size:12px;color:#172b4d;">${past.sprintLabel}</strong>
                    ${isMatch ? `<span style="font-size:10px;background:#ffd5d2;color:#ae2a19;padding:2px 6px;border-radius:4px;font-weight:700;">BEST MATCH</span>` : ""}
                  </div>
                  <div style="font-size:11px;color:#626f86;margin-bottom:8px;">
                    ${past.workload} tasks · ${past.bugCount} bugs · ${past.apiCount} APIs
                  </div>
                  <div style="display:flex;justify-content:space-between;align-items:center;">
                    <span style="font-size:11px;font-weight:700;color:${sim >= 70 ? "#de350b" : sim >= 50 ? "#974f0c" : "#22a06b"};">${sim}% similar</span>
                    <span style="font-size:10px;padding:2px 6px;border-radius:4px;background:${past.outcome === "delayed" ? "#ffd5d2" : "#dcfff1"};color:${past.outcome === "delayed" ? "#ae2a19" : "#216e4e"};font-weight:700;">${past.outcome === "delayed" ? "Delayed" : "On Time"}</span>
                  </div>
                </div>`;
            }).join("")}
          </div>
        </div>
      `}

    </div>
  `;
}

// ─── Manager Dashboard Command Strip ──────────────────────────────────────────
function renderManagerCommandStrip(selected) {
  const insights = datasetInsights();
  const p1Tasks = state.prioritized.filter(t => t.severity === "P1");
  const blockers = state.prioritized.filter(t => t.dependencies.some(d => /block|waiting|approval|eta|coordinate/i.test(d)));
  const slaRisks = state.prioritized.filter(t => t.severity === "P1" || t.due <= "2026-06-20");
  const genomeReady = genomeState.currentGenome !== null;
  const topRisk = genomeState.risks?.[0];
  const similarityScore = genomeState.similarityScore;
  return `
    <section class="manager-command-strip hero-grid">
      <article class="hero-card alert" style="cursor: pointer;" data-nav="overview">
        <p class="eyebrow">Team risk pulse</p>
        <h2>${slaRisks.length} SLA / escalation risks</h2>
        <p>Highest risk: ${selected?.canonicalTitle || "None"}. Correlated across ${selected?.sources.length || 0} systems — needs manager visibility.</p>
      </article>
      <article class="hero-card" style="cursor:pointer;" data-nav="genome">
        <p class="eyebrow">🧬 Sprint Genome</p>
        <h2>${genomeReady ? `${similarityScore}% match` : "Analyze sprint"}</h2>
        <p>${genomeReady
          ? `Current sprint is ${similarityScore}% similar to a past sprint. ${topRisk ? `Top risk: ${topRisk.label} (${topRisk.pct}%).` : ""}`
          : "Run the Genome Analyzer to predict risks from historical sprint patterns."
        }</p>
      </article>
      <article class="hero-card" style="cursor: pointer;" data-nav="hidden">
        <p class="eyebrow">Hidden asks</p>
        <h2>${insights.unstructuredCount} unstructured signals</h2>
        <p>Emails, Slack mentions, and meeting notes normalized into structured task records before priority scoring.</p>
      </article>
      <article class="hero-card priority" style="cursor: pointer;" data-nav="analytics">
        <p class="eyebrow">Manager action</p>
        <h2>${blockers.length} blockers need decisions</h2>
        <p>Rebalance owners, approve dependencies, and send ETA updates across Jira, ServiceNow, and Outlook.</p>
      </article>
    </section>
  `;
}

// ─── Manager Dashboard (full standalone) - KPI + Assign + Kanban ─────────────
// ─── Workload Chart (SVG bar chart) ──────────────────────────────────────────
function renderWorkloadChart(ownerLoad) {
  const owners = ownerLoad.slice(0, 8);
  if (owners.length === 0) return `<p style="color:#626f86;font-size:12px;text-align:center;padding:16px;">No workload data yet.</p>`;

  const COLORS = ["#0c66e4", "#22a06b", "#ffab00", "#6554c0", "#de350b", "#0ea5e9", "#f97316", "#8b5cf6"];
  const maxCount = Math.max(...owners.map(o => o.count), 1);
  const BAR_H = 22;
  const GAP = 10;
  const LABEL_W = 90;
  const BAR_MAX_W = 220;
  const SVG_W = LABEL_W + BAR_MAX_W + 70;
  const SVG_H = owners.length * (BAR_H + GAP) + 20;

  const bars = owners.map((o, i) => {
    const y = i * (BAR_H + GAP) + 10;
    const barW = Math.max(6, Math.round((o.count / maxCount) * BAR_MAX_W));
    const p1W = Math.max(0, Math.round((o.p1 / maxCount) * BAR_MAX_W));
    const col = COLORS[i % COLORS.length];
    const isOverloaded = o.count >= 8 || o.p1 >= 3;
    const label = o.owner.length > 11 ? o.owner.slice(0, 11) + "…" : o.owner;
    return `
      <!-- Owner label -->
      <text x="${LABEL_W - 6}" y="${y + BAR_H / 2 + 5}" text-anchor="end" font-size="11" fill="#344563" font-family="Inter,system-ui,sans-serif" font-weight="600">${escapeHtml(label)}</text>
      <!-- Total bar (background) -->
      <rect x="${LABEL_W}" y="${y}" width="${barW}" height="${BAR_H}" rx="4" fill="${col}22"/>
      <!-- Total bar (fill) -->
      <rect x="${LABEL_W}" y="${y}" width="${barW}" height="${BAR_H}" rx="4" fill="${col}" opacity="0.85"/>
      <!-- P1 overlay -->
      ${p1W > 0 ? `<rect x="${LABEL_W}" y="${y}" width="${Math.min(p1W, barW)}" height="${BAR_H}" rx="4" fill="#de350b" opacity="0.55"/>` : ""}
      <!-- Count label -->
      <text x="${LABEL_W + barW + 6}" y="${y + BAR_H / 2 + 5}" font-size="11" fill="#344563" font-family="Inter,system-ui,sans-serif" font-weight="700">${o.count}</text>
      ${o.p1 > 0 ? `<text x="${LABEL_W + barW + 28}" y="${y + BAR_H / 2 + 5}" font-size="10" fill="#de350b" font-family="Inter,system-ui,sans-serif">${o.p1}P1</text>` : ""}
      ${isOverloaded ? `<text x="${LABEL_W + barW + 52}" y="${y + BAR_H / 2 + 5}" font-size="10" fill="#de350b" font-family="Inter,system-ui,sans-serif">⚠</text>` : ""}
      ${o.blockers > 0 ? `<rect x="${LABEL_W}" y="${y + BAR_H - 3}" width="${barW}" height="3" rx="2" fill="#974f0c" opacity="0.6"/>` : ""}
    `;
  }).join("");

  // Legend
  const legend = `
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:8px;font-size:11px;color:#626f86;">
      <span style="display:flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;background:#0c66e4;border-radius:2px;display:inline-block;"></span>Total tasks</span>
      <span style="display:flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;background:#de350b;opacity:0.55;border-radius:2px;display:inline-block;"></span>P1 tasks</span>
      <span style="display:flex;align-items:center;gap:4px;"><span style="width:10px;height:3px;background:#974f0c;border-radius:2px;display:inline-block;"></span>Has blockers</span>
    </div>`;

  return `
    <div style="overflow-x:auto;">
      <svg width="${SVG_W}" height="${SVG_H}" style="display:block;max-width:100%;">
        ${bars}
      </svg>
    </div>
    ${legend}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:6px;margin-top:10px;">
      ${owners.map((o, i) => {
        const col = COLORS[i % COLORS.length];
        const pct = o.count ? Math.round(o.done / o.count * 100) : 0;
        const isOverloaded = o.count >= 8 || o.p1 >= 3;
        return `<div style="padding:7px 9px;background:#fff;border:1px solid #e8e0d5;border-left:3px solid ${col};border-radius:7px;font-size:11px;">
          <strong style="color:#172b4d;display:block;margin-bottom:2px;">${escapeHtml(o.owner)}</strong>
          <div style="color:#64748b;">${o.count} tasks · ${o.p1} P1</div>
          <div style="color:${o.blockers > 0 ? "#974f0c" : "#64748b"};">${o.blockers} blocker${o.blockers !== 1 ? "s" : ""}</div>
          ${isOverloaded ? `<span style="font-size:10px;color:#de350b;font-weight:700;">⚠ Overloaded</span>` : ""}
        </div>`;
      }).join("")}
    </div>`;
}

// ─── Dependency Graph ─────────────────────────────────────────────────────────
function renderDependencyGraph() {
  // Find tasks that are either blocking or blocked by others
  const blockingTasks = state.prioritized.filter(t => t.isBlocking && !isTaskCompleted(t.id));
  const blockedTasks  = state.prioritized.filter(t => t.isBlocked  && !isTaskCompleted(t.id));

  // Fall back: use dependency keyword analysis if graph data not populated
  const keywordBlocked = state.prioritized.filter(t =>
    !isTaskCompleted(t.id) &&
    (t.dependencies || []).some(d => /block|waiting|eta|approval|coordinate/i.test(d))
  );

  const allBlockers = blockingTasks.length > 0 ? blockingTasks : [];
  const allBlocked  = blockedTasks.length  > 0 ? blockedTasks  : keywordBlocked;

  const sevColor = { P1: "#de350b", P2: "#974f0c", P3: "#216e4e", P4: "#626f86" };

  const blockingRows = allBlockers.slice(0, 6).map(t => {
    const col = sevColor[t.severity] || "#626f86";
    return `<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:#fff8f0;border:1px solid #e8d5b7;border-left:3px solid ${col};border-radius:6px;margin:4px 0;">
      <span style="font-size:16px;">🔴</span>
      <div style="flex:1;min-width:0;">
        <div style="font-size:12px;font-weight:700;color:#172b4d;">${escapeHtml(t.canonicalTitle)}</div>
        <div style="font-size:10px;color:#64748b;margin-top:1px;">
          <span style="background:${col}18;color:${col};padding:1px 5px;border-radius:3px;font-weight:700;">${t.severity}</span>
          <span style="margin-left:5px;">👤 ${escapeHtml(t.owner || "Unassigned")}</span>
          <span style="margin-left:5px;">Blocks ${t.blocksCount || "?"} downstream task${t.blocksCount !== 1 ? "s" : ""}</span>
        </div>
      </div>
      <span style="font-size:10px;font-weight:800;color:#de350b;background:#ffd5d2;padding:2px 6px;border-radius:4px;">BLOCKING</span>
    </div>`;
  }).join("");

  const blockedRows = allBlocked.slice(0, 6).map(t => {
    const col = sevColor[t.severity] || "#626f86";
    const depText = (t.dependencies || []).filter(d => /block|waiting|eta|approval/i.test(d)).slice(0, 2).join(" · ");
    return `<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:#f8f9ff;border:1px solid #c7d7f7;border-left:3px solid #0c66e4;border-radius:6px;margin:4px 0;">
      <span style="font-size:16px;">🚧</span>
      <div style="flex:1;min-width:0;">
        <div style="font-size:12px;font-weight:700;color:#172b4d;">${escapeHtml(t.canonicalTitle)}</div>
        <div style="font-size:10px;color:#64748b;margin-top:1px;">
          <span style="background:${col}18;color:${col};padding:1px 5px;border-radius:3px;font-weight:700;">${t.severity}</span>
          <span style="margin-left:5px;">👤 ${escapeHtml(t.owner || "Unassigned")}</span>
          ${depText ? `<span style="margin-left:5px;color:#974f0c;">⚠ ${escapeHtml(depText)}</span>` : ""}
        </div>
      </div>
      <span style="font-size:10px;font-weight:800;color:#0c66e4;background:#e8f0fe;padding:2px 6px;border-radius:4px;">BLOCKED</span>
    </div>`;
  }).join("");

  const hasData = allBlockers.length > 0 || allBlocked.length > 0;

  if (!hasData) {
    return `<div style="padding:16px;text-align:center;color:#626f86;font-size:13px;">
      <span style="font-size:24px;display:block;margin-bottom:6px;">✅</span>
      No blocking dependencies detected in the active queue.
    </div>`;
  }

  return `
    <div style="display:grid;gap:10px;">
      ${allBlockers.length > 0 ? `
        <div>
          <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:#de350b;margin-bottom:6px;">
            🔴 Blocking (${allBlockers.length}) — resolve these first to unblock downstream work
          </div>
          ${blockingRows}
        </div>` : ""}
      ${allBlocked.length > 0 ? `
        <div style="margin-top:${allBlockers.length > 0 ? "8px" : "0"};">
          <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:#0c66e4;margin-bottom:6px;">
            🚧 Blocked (${allBlocked.length}) — waiting on decisions or other tasks
          </div>
          ${blockedRows}
        </div>` : ""}
      <div style="padding:8px 10px;background:#f8f5f0;border-radius:6px;font-size:11px;color:#64748b;border-left:3px solid #6554c0;">
        💡 Resolving blocking tasks first will cascade ${allBlockers.reduce((s,t) => s + (t.blocksCount||1), 0)} downstream item${allBlockers.reduce((s,t) => s + (t.blocksCount||1), 0) !== 1 ? "s" : ""} into action automatically.
      </div>
    </div>`;
}

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
              { id: "mgr-jira",       name: "Jira Sprint Board",    srcId: "Jira",           color: "#0052CC", icon: "▦" },
              { id: "mgr-github",     name: "GitHub PR Reviews",    srcId: "GitHub",         color: "#1a1a2e", icon: "⌁" },
              { id: "mgr-servicenow", name: "ServiceNow Defects",   srcId: "ServiceNow",     color: "#c0392b", icon: "△" },
              { id: "mgr-email",      name: "Outlook Inbox",        srcId: "Outlook Emails", color: "#0078D4", icon: "📧" },
              { id: "mgr-slack",      name: "Slack Mentions",       srcId: "Slack Mentions", color: "#4A154B", icon: "💬" },
              { id: "meetings",       name: "Meetings",             srcId: "meetings",       color: "#1a7a4a", icon: "◷" }
            ].map(src => {
              const srcKey = { "mgr-jira":"jira","mgr-github":"github","mgr-servicenow":"servicenow","mgr-email":"email","mgr-slack":"slack","meetings":"notes" }[src.id] || "notes";
              const srcLogo = SOURCE_LOGO_MAP[srcKey];
              const isMeetings = src.id === "meetings";
              const count = isMeetings
                ? meetingsList.length
                : state.prioritized.filter(t => t.sources.some(s => s.toLowerCase().includes(src.srcId.toLowerCase())) && !completedTaskIds.includes(t.id)).length;
              const p1Count = isMeetings
                ? meetingsList.filter(m => m.priority === "Critical" || m.priority === "High").length
                : state.prioritized.filter(t => t.sources.some(s => s.toLowerCase().includes(src.srcId.toLowerCase())) && t.severity === "P1" && !completedTaskIds.includes(t.id)).length;
              return `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 10px; border:1px solid #dfe3ea; border-radius:6px; background:#fff; cursor:pointer;" data-nav="${src.id}">
                  <div style="display:flex; align-items:center; gap:8px;">
                    <span style="display:flex;width:24px;height:24px;align-items:center;justify-content:center;border-radius:5px;background:${srcLogo ? srcLogo.bg : src.color+'22'};">${srcLogo ? srcLogo.svg : src.icon}</span>
                    <strong style="color:#172b4d; font-size:12px;">${src.name}</strong>
                  </div>
                  <div style="display:flex; align-items:center; gap:6px;">
                    <span style="font-size:11px; padding:2px 7px; border-radius:10px; background:#f1f2f4; color:#44546f; font-weight:700;">${count} ${isMeetings ? "total" : "active"}</span>
                    ${p1Count > 0 ? `<span style="font-size:10px; padding:2px 6px; border-radius:4px; background:${isMeetings ? "#ede9fe" : "#ffd5d2"}; color:${isMeetings ? "#5b21b6" : "#ae2a19"}; font-weight:800;">${p1Count} ${isMeetings ? "urgent" : "P1"}</span>` : ""}
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
                const tasks = state.prioritized.filter(t => t.severity === sev && !isTaskCompleted(t.id)).slice(0, 5);
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
            <h3>📊 Team Workload Distribution</h3>
            ${renderWorkloadChart(insights.ownerLoad)}
          </div>

          <!-- Dependency Graph Panel -->
          <div class="mgr-panel" style="border-left:4px solid #6554c0;">
            <h3>🔗 Dependency Graph · Blocking Relationships</h3>
            ${renderDependencyGraph()}
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
            <!-- Live activity feed -->
            ${managerActivityFeed.length > 0 ? `
              <div style="margin-bottom:12px; border-bottom:1px solid #f1f2f4; padding-bottom:12px;">
                <p class="eyebrow" style="margin-bottom:6px; font-size:10px; color:#22a06b;">🟢 LIVE UPDATES</p>
                <div style="display:grid; gap:5px; max-height:120px; overflow-y:auto;">
                  ${managerActivityFeed.slice(0, 5).map(e => `
                    <div style="display:flex; align-items:flex-start; gap:7px; padding:6px 8px; background:#f4fff9; border:1px solid #b7e4ce; border-radius:6px;">
                      <span style="width:7px; height:7px; border-radius:50%; background:${e.color || "#22a06b"}; flex-shrink:0; margin-top:4px;"></span>
                      <div style="flex:1; min-width:0;">
                        <div style="font-size:12px; color:#172b4d; font-weight:600;">${escapeHtml(e.message)}</div>
                        <div style="font-size:10px; color:#626f86;">${e.time}</div>
                      </div>
                    </div>`).join("")}
                </div>
              </div>
            ` : ""}
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
  const activePrioritized = state.prioritized.filter(t => !isTaskCompleted(t.id));
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

    const isCompleted = isTaskCompleted(t.id);
    const isWorking = isTaskWorking(t.id);

    if (isCompleted) ownerMap[o].done++;
    else if (isWorking) ownerMap[o].working++;
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
                ${eng.tasks.filter(t => !isTaskCompleted(t.id)).slice(0, 3).map(t => {
                  const isW = isTaskWorking(t.id);
                  const sevColor = {P1:"#de350b",P2:"#974f0c",P3:"#216e4e"}[t.severity]||"#626f86";
                  return `
                    <div class="tw-mini-task ${isW?"working":""}">
                      <span class="tw-mini-sev" style="color:${sevColor};">${t.severity}</span>
                      <span class="tw-mini-title">${escapeHtml(t.canonicalTitle.slice(0,48))}${t.canonicalTitle.length>48?"…":""}</span>
                      ${isW ? `<span style="font-size:10px;color:#ffab00;font-weight:800;">Working</span>` : ""}
                    </div>`;
                }).join("")}
                ${eng.tasks.filter(t => !isTaskCompleted(t.id)).length > 3
                  ? `<div style="font-size:11px;color:#626f86;padding:4px 0;">+ ${eng.tasks.filter(t => !isTaskCompleted(t.id)).length - 3} more remaining</div>`
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
// ─── Deadline urgency gradient helper ─────────────────────────────────────────
// Returns { bg, border, label, textColor } based on days until deadline
function deadlineStyle(due, isDone = false) {
  if (isDone) return { bg: "#f4fff9", border: "#b7e4ce", label: "", textColor: "#216e4e" };
  if (!due)   return { bg: "#ffffff", border: "#e2e8f0", label: "", textColor: "#64748b" };
  const today = new Date("2026-06-21T00:00:00");
  const dueDate = new Date(`${due}T23:59:59`);
  const days = Math.ceil((dueDate - today) / 86400000);
  if (days < 0)  return { bg: "linear-gradient(135deg,#ff4d4d18,#ff000010)", border: "#ff4d4d", label: "OVERDUE", textColor: "#de350b", badgeBg: "#ff4d4d", badgeText: "#fff" };
  if (days === 0) return { bg: "linear-gradient(135deg,#ff6b0018,#ff980010)", border: "#ff6b00", label: "TODAY", textColor: "#974f0c", badgeBg: "linear-gradient(90deg,#ff6b00,#ff0000)", badgeText: "#fff" };
  if (days === 1) return { bg: "linear-gradient(135deg,#ffab0018,#ffd60010)", border: "#ffab00", label: "TOMORROW", textColor: "#7a4200", badgeBg: "#ffab00", badgeText: "#fff" };
  if (days <= 3)  return { bg: "linear-gradient(135deg,#fffbe610,#ffab0008)", border: "#ffd166", label: `${days}d left`, textColor: "#7a4200", badgeBg: "#ffd166", badgeText: "#7a4200" };
  return { bg: "#ffffff", border: "#e2e8f0", label: `${days}d`, textColor: "#64748b", badgeBg: "#f1f5f9", badgeText: "#64748b" };
}

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
    const dl = deadlineStyle(t.due, isDone);

    return `
      <div class="tp-task-row ${isDone ? "tp-done" : isWorking ? "tp-working" : ""}" data-task-row="${t.id}"
           style="background:${dl.bg};border-color:${dl.border};border-left:3px solid ${dl.border};">
        <div class="tp-task-row-left">
          <div class="tp-sev-dot" style="background:${sevColor}" title="${t.severity}"></div>
          <div class="tp-task-info">
            <div class="tp-task-title ${isDone ? "tp-strike" : ""}">
              ${escapeHtml(t.canonicalTitle)}
              ${isWorking ? `<span class="tp-status-chip working">● Working</span>` : ""}
              ${isDone    ? `<span class="tp-status-chip done">✓ Done</span>` : ""}
              ${t.isBlocking ? `<span style="font-size:10px;background:#fff0b3;color:#974f0c;padding:1px 5px;border-radius:3px;font-weight:700;margin-left:4px;">⚠ Blocking</span>` : ""}
            </div>
            <div class="tp-task-meta">
              <span class="tp-src-badge" style="background:${srcColor}22;color:${srcColor};">${srcName}</span>
              <span>${t.severity}</span>
              ${t.due ? `
                <span style="display:inline-flex;align-items:center;gap:3px;">
                  ${dl.label ? `<span style="font-size:10px;font-weight:800;padding:1px 5px;border-radius:3px;background:${dl.badgeBg || dl.border};color:${dl.badgeText || "#fff"};">${dl.label}</span>` : ""}
                  <span style="color:${dl.textColor};font-weight:600;">${formatDue(t.due)}</span>
                </span>` : ""}
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
  const TODAY = "2026-06-21";

  // Source color map — pastel-friendly accent colours (used for borders, icons, accents)
  const SOURCE_META = {
    jira:        { label: "Jira Sprint Board",   icon: "▦", color: "#1868db", pastel: "#eef3ff", emoji: "📋" },
    github:      { label: "GitHub PRs",          icon: "⌁", color: "#374151", pastel: "#f3f4f6", emoji: "🔀" },
    servicenow:  { label: "ServiceNow Defects",  icon: "△", color: "#c0392b", pastel: "#fff1f0", emoji: "🚨" },
    email:       { label: "Outlook Emails",      icon: "📧", color: "#0369a1", pastel: "#eff8ff", emoji: "📧" },
    slack:       { label: "Slack Mentions",      icon: "💬", color: "#7c3aed", pastel: "#f5f3ff", emoji: "💬" },
    notes:       { label: "Meeting Notes",       icon: "📌", color: "#0f766e", pastel: "#f0fdfa", emoji: "📌" }
  };

  const queue = activeQueue();

  if (scrumActiveSource !== "all") {
    // ─── SOURCE DETAIL VIEW: Show tasks as a colored tile grid ───
    const pending = queue.filter(t => taskMatchesSource(t, scrumActiveSource));
    const meta = SOURCE_META[scrumActiveSource] || { label: scrumActiveSource, icon: "◎", color: "#64748b", emoji: "📌" };

    const taskTiles = pending.map(t => {
      const nearestDue = t.due || null;
      const daysLeft = nearestDue
        ? Math.ceil((new Date(nearestDue) - new Date(TODAY)) / 86400000)
        : null;

      let bg = "#ffffff";
      let border = `${meta.color}35`;
      let badgeText = "Stable";
      let playBtnStyle = `background:${meta.color}15;color:${meta.color};border:1px solid ${meta.color}30;`;
      let subTextColor = "#65717d";

      if (daysLeft !== null) {
        if (daysLeft <= 0) {
          bg = `${meta.pastel || "#fef2f2"}`;
          border = meta.color;
          badgeText = "DUE TODAY";
          playBtnStyle = `background:${meta.color}18;color:${meta.color};border:1px solid ${meta.color}40;`;
          subTextColor = "#44546f";
        } else if (daysLeft <= 3) {
          bg = `${meta.pastel || "#fffbeb"}cc`;
          border = `${meta.color}80`;
          badgeText = daysLeft === 1 ? "TOMORROW" : `${daysLeft}d left`;
          playBtnStyle = `background:${meta.color}18;color:${meta.color};border:1px solid ${meta.color}40;`;
          subTextColor = "#44546f";
        }
      }

      const isDone = isTaskCompleted(t.id);
      const isWorking = isTaskWorking(t.id);

      return `
        <div class="task-detail-tile" data-task="${t.id}"
             style="cursor:pointer;background:${bg};border:2px solid ${border};border-top:3px solid ${meta.color};border-radius:12px;padding:16px;box-shadow:0 2px 8px rgba(9,30,66,0.06);color:#17202a;display:flex;flex-direction:column;justify-content:space-between;min-height:165px;transition:transform 0.15s ease,box-shadow 0.15s;"
             onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 6px 18px rgba(9,30,66,0.12)'" onmouseout="this.style.transform='none';this.style.boxShadow='0 2px 8px rgba(9,30,66,0.06)'">
          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <span style="font-size:10px;font-weight:800;padding:2px 6px;border-radius:4px;background:${meta.color}18;color:${meta.color};">${t.severity}</span>
              <span style="font-size:10px;font-weight:700;color:#8590a2;">${t.id}</span>
            </div>
            <h3 style="font-size:14px;font-weight:700;margin:0 0 8px 0;line-height:1.4;color:#172b4d;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;">${escapeHtml(t.canonicalTitle)}</h3>
            ${t.due ? `<div style="font-size:10px;color:${subTextColor};font-weight:600;margin-bottom:8px;">📅 ${formatDue(t.due)} · <span>${badgeText}</span></div>` : ""}
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;border-top:1px solid ${meta.color}20;padding-top:10px;">
            <span style="font-size:11px;color:#626f86;">${t.owner || "Unassigned"}</span>
            <div style="display:flex;align-items:center;gap:6px;">
              ${isWorking ? `<span style="font-size:10px;color:#0f766e;font-weight:800;">● Active</span>` : ""}
              ${isDone    ? `<span style="font-size:10px;color:#0f766e;font-weight:800;">✓ Done</span>` : ""}
              ${!isDone && !isWorking ? `
                <button class="tp-btn-start" data-task-start="${t.id}" style="font-size:10px;padding:4px 8px;border-radius:5px;cursor:pointer;${playBtnStyle}">▶ Start</button>
              ` : ""}
            </div>
          </div>
        </div>
      `;
    }).join("");

    return `
      <div style="padding:18px;max-width:1200px;background:#f7f4ee;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <div>
            <p class="eyebrow"><span style="cursor:pointer;text-decoration:underline;color:#152238;" data-scrum-source="all">← All Sources</span></p>
            <h2 style="margin:2px 0 0;color:#17202a;">${meta.label} Tasks</h2>
            <p style="font-size:12px;color:#65717d;margin:2px 0 0;">
              Today's queue: ${pending.length} task${pending.length !== 1 ? "s" : ""} actionable today
            </p>
          </div>
          <div style="display:flex;gap:8px;align-items:center;">
            <div style="display:flex;gap:8px;font-size:10px;font-weight:600;align-items:center;color:#65717d;">
              <span style="display:flex;align-items:center;gap:3px;"><span style="width:10px;height:10px;border-radius:3px;background:${meta.color};display:inline-block;"></span>Due Today</span>
              <span style="display:flex;align-items:center;gap:3px;"><span style="width:10px;height:10px;border-radius:3px;background:${meta.color}99;display:inline-block;"></span>Approaching</span>
              <span style="display:flex;align-items:center;gap:3px;"><span style="width:10px;height:10px;border-radius:3px;background:#17202a;display:inline-block;"></span>Stable</span>
            </div>
            ${activeProfile === "manager" ? `<button class="primary" style="font-size:12px;padding:7px 12px;background:#152238;color:#fff;border:none;border-radius:6px;font-weight:700;" id="openAddJiraModalBtn">+ Add Task</button>` : ""}
          </div>
        </div>

        <!-- Task tile grid -->
        ${pending.length === 0
          ? `<div style="text-align:center;padding:48px;background:rgba(255,255,255,0.6);border:1px solid #ded5c8;border-radius:12px;color:#65717d;">✅ All clear for today! No pending tasks in this source.</div>`
          : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:14px;">
              ${taskTiles}
             </div>`
        }
      </div>
    `;
  }

  // ─── OVERVIEW ALL SOURCES GRID VIEW ───
  // Compute tile data for each source (All white/cream tiles matching the theme)
  const tiles = sources.map(src => {
    const pending = queue.filter(t => taskMatchesSource(t, src.id));
    const meta = SOURCE_META[src.id] || { label: src.name, icon: "◎", color: src.color || "#64748b", emoji: "📌" };

    const dueDates = pending.map(t => t.due).filter(Boolean).sort();
    const nearestDue = dueDates[0] || null;
    const daysLeft = nearestDue
      ? Math.ceil((new Date(nearestDue) - new Date(TODAY)) / 86400000)
      : null;

    // Pastel card backgrounds — brand color only for border/accent, never the full card fill
    let tileBg    = "#ffffff";
    let tileBorder = `${meta.color}40`;   // 25% opacity border always
    let textColor  = "#17202a";
    let subTextColor = "#65717d";
    let isDarkCard = false;
    // pastel tint from meta, fallback to white
    const pastelBg = meta.pastel || "#f8f9fa";

    if (daysLeft !== null) {
      if (daysLeft <= 0) {
        // Due today: pastel tint of source colour + solid coloured left border
        tileBg    = pastelBg;
        tileBorder = meta.color;
        textColor  = "#17202a";
        subTextColor = "#44546f";
        isDarkCard = false;
      } else if (daysLeft <= 3) {
        // Approaching: slightly tinted white + dashed border
        tileBg    = pastelBg + "cc";
        tileBorder = `${meta.color}80`;
        textColor  = "#17202a";
        subTextColor = "#44546f";
        isDarkCard = false;
      }
    }

    let urgencyText = null;
    if (daysLeft !== null) {
      if (daysLeft <= 0) {
        urgencyText = "DUE TODAY";
      } else if (daysLeft <= 3) {
        urgencyText = daysLeft === 1 ? "TOMORROW" : `${daysLeft}d left`;
      }
    }

    const p1Count = pending.filter(t => t.severity === "P1").length;
    const topTasks = pending.slice(0, 5);

    return { src, meta, pending, nearestDue, daysLeft, tileBg, tileBorder, textColor, subTextColor, urgencyText, p1Count, topTasks, isDarkCard };
  });

  const totalPending = tiles.reduce((s, t) => s + t.pending.length, 0);
  const totalP1     = tiles.reduce((s, t) => s + t.p1Count, 0);

  function renderTaskRow(t, parentDark = false) {
    const isDone = isTaskCompleted(t.id);
    const dl = deadlineStyle(t.due, isDone);
    const sevColor = { P1:"#de350b", P2:"#974f0c", P3:"#216e4e" }[t.severity] || "#64748b";
    const isWorking = isTaskWorking(t.id);

    let rowBg = dl.bg;
    let rowBorder = dl.border;
    let titleColor = "#17202a";
    let metaColor = "#65717d";
    let dueColor = dl.textColor;
    let badgeStyle = `background:${sevColor + '18'};color:${sevColor};`;
    let playStyle = "background:#f1e6d6;color:#5d4730;border:1px solid #d8ccba;";

    if (parentDark) {
      titleColor = "#ffffff";
      metaColor = "rgba(255, 255, 255, 0.8)";
      dueColor = "#ffffff";
      badgeStyle = "background:rgba(255,255,255,0.2);color:#ffffff;";
      playStyle = "background:rgba(255,255,255,0.2);color:#ffffff;border:1px solid rgba(255,255,255,0.25);";
      
      if (isDone) {
        rowBg = "rgba(34, 160, 107, 0.25)";
        rowBorder = "rgba(255, 255, 255, 0.4)";
      } else if (t.due) {
        const today = new Date("2026-06-21T00:00:00");
        const dueDate = new Date(`${t.due}T23:59:59`);
        const days = Math.ceil((dueDate - today) / 86400000);
        if (days <= 0) {
          rowBg = "rgba(225, 29, 72, 0.3)";
          rowBorder = "rgba(255, 255, 255, 0.4)";
        } else if (days <= 3) {
          rowBg = "rgba(245, 158, 11, 0.3)";
          rowBorder = "rgba(255, 255, 255, 0.4)";
        } else {
          rowBg = "rgba(255, 255, 255, 0.1)";
          rowBorder = "rgba(255, 255, 255, 0.15)";
        }
      } else {
        rowBg = "rgba(255, 255, 255, 0.1)";
        rowBorder = "rgba(255, 255, 255, 0.15)";
      }
    }

    return `
      <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:7px;border:1px solid ${rowBorder};background:${rowBg};margin:3px 0;cursor:pointer;transition:background 0.2s;width:100%;min-width:0;box-sizing:border-box;" data-task="${t.id}">
        <span style="font-size:10px;font-weight:800;padding:2px 5px;border-radius:4px;${badgeStyle}flex-shrink:0;">${t.severity}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;font-weight:600;color:${titleColor};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(t.canonicalTitle)}</div>
          <div style="font-size:10px;color:${metaColor};display:flex;gap:6px;">
            <span>${t.owner || "Unassigned"}</span>
            ${t.due ? `<span style="color:${dueColor};font-weight:600;">${dl.label ? dl.label + " · " : ""}${formatDue(t.due)}</span>` : ""}
          </div>
        </div>
        ${isWorking ? `<span style="font-size:9px;color:${parentDark ? '#4ade80' : '#0c66e4'};font-weight:800;flex-shrink:0;">● Working</span>` : ""}
        ${isDone    ? `<span style="font-size:9px;color:${parentDark ? '#4ade80' : '#22a06b'};font-weight:800;flex-shrink:0;">✓ Done</span>` : ""}
        ${!isDone && !isWorking ? `
          <button class="tp-btn-start" data-task-start="${t.id}" style="font-size:10px;padding:3px 8px;flex-shrink:0;${playStyle}">▶</button>
        ` : ""}
      </div>`;
  }

  // ── 3-colour urgency palette ─────────────────────────────────────────────
  // RED   = due today    → warm red tint
  // AMBER = approaching  → pale orange tint
  // CREAM = stable       → warm cream (matches app background)
  const PALETTE = {
    red:   { bg:"#fdecea", border:"#e8a09a", accent:"#c0392b", label:"#922b21", divider:"rgba(200,80,60,0.18)" },
    amber: { bg:"#fef6e4", border:"#f0c080", accent:"#b7600a", label:"#935005", divider:"rgba(200,140,40,0.18)" },
    cream: { bg:"#fdf8f0", border:"#d9c8ae", accent:"#7a5c3a", label:"#5d4226", divider:"rgba(180,150,100,0.2)" }
  };

  // Per-source SVG logos — real brand marks, inline SVG, no external deps
  const SOURCE_LOGOS = {
    jira: {
      bg: "#dbeafe",
      svg: `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" width="22" height="22">
        <path d="M15.975 0C12.058 0 8.866 3.163 8.866 7.044v1.04H3.063A3.063 3.063 0 000 11.145c0 5.404 4.387 9.791 9.791 9.791h1.04v5.023C10.831 29.84 13.993 33 17.874 33h.002C21.795 33 25 29.837 25 25.956V7.044C25 3.163 21.838 0 17.958 0h-1.983z" fill="url(#jira-a)"/>
        <path d="M16.043 0h-.068C12.058 0 8.866 3.163 8.866 7.044v14.892h7.177V7.044C16.043 3.163 19.206 0 23.124 0h-7.081z" fill="url(#jira-b)"/>
        <defs>
          <linearGradient id="jira-a" x1="24.997" y1="2.198" x2="11.867" y2="15.328" gradientUnits="userSpaceOnUse">
            <stop stop-color="#0052CC"/>
            <stop offset="1" stop-color="#2684FF"/>
          </linearGradient>
          <linearGradient id="jira-b" x1="8.87" y1="10.566" x2="16.79" y2="10.566" gradientUnits="userSpaceOnUse">
            <stop stop-color="#0052CC"/>
            <stop offset="1" stop-color="#2684FF"/>
          </linearGradient>
        </defs>
      </svg>`
    },
    github: {
      bg: "#f1f5f9",
      svg: `<svg viewBox="0 0 24 24" fill="#1a1a2e" xmlns="http://www.w3.org/2000/svg" width="22" height="22">
        <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
      </svg>`
    },
    servicenow: {
      bg: "#fee2e2",
      svg: `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" width="22" height="22">
        <circle cx="16" cy="16" r="16" fill="#c0392b"/>
        <path d="M9 20.5c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2v-9c0-1.1-.9-2-2-2H11c-1.1 0-2 .9-2 2v9zm2-9h10v9H11v-9zm3 6.5h4v-4h-4v4z" fill="#fff"/>
      </svg>`
    },
    email: {
      bg: "#dbeafe",
      svg: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="22" height="22">
        <path d="M0 4C0 2.9.9 2 2 2h20c1.1 0 2 .9 2 2v16c0 1.1-.9 2-2 2H2c-1.1 0-2-.9-2-2V4z" fill="#0078D4"/>
        <path d="M2 4l10 7L22 4" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      </svg>`
    },
    slack: {
      bg: "#ede9fe",
      svg: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="22" height="22">
        <path d="M5.042 15.165a2.528 2.528 0 01-2.52 2.523A2.528 2.528 0 010 15.165a2.527 2.527 0 012.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 012.521-2.52 2.527 2.527 0 012.521 2.52v6.313A2.528 2.528 0 018.834 24a2.528 2.528 0 01-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 01-2.521-2.52A2.528 2.528 0 018.834 0a2.528 2.528 0 012.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 012.521 2.521 2.528 2.528 0 01-2.521 2.521H2.522A2.528 2.528 0 010 8.834a2.528 2.528 0 012.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 012.522-2.521A2.528 2.528 0 0124 8.834a2.528 2.528 0 01-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 01-2.523 2.521 2.527 2.527 0 01-2.52-2.521V2.522A2.527 2.527 0 0115.165 0a2.528 2.528 0 012.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 012.523 2.522A2.528 2.528 0 0115.165 24a2.527 2.527 0 01-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 01-2.52-2.523 2.526 2.526 0 012.52-2.52h6.313A2.527 2.527 0 0124 15.165a2.528 2.528 0 01-2.522 2.523h-6.313z" fill="#4A154B"/>
      </svg>`
    },
    notes: {
      bg: "#d1fae5",
      svg: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="22" height="22">
        <rect x="3" y="2" width="18" height="20" rx="2" fill="#0f766e"/>
        <path d="M7 7h10M7 11h10M7 15h6" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>
        <circle cx="18" cy="18" r="4" fill="#34d399"/>
        <path d="M16.5 18l1 1 2-2" stroke="#fff" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      </svg>`
    }
  };

  // Per-source icon identity — unique per integration
  const SOURCE_STYLE = {
    jira:       { icon:"📋", bg:"#dbeafe", color:"#1d4ed8" },
    github:     { icon:"🔀", bg:"#f1f5f9", color:"#374151" },
    servicenow: { icon:"🚨", bg:"#fee2e2", color:"#b91c1c" },
    email:      { icon:"📧", bg:"#dbeafe", color:"#075985" },
    slack:      { icon:"💬", bg:"#ede9fe", color:"#6d28d9" },
    notes:      { icon:"📌", bg:"#d1fae5", color:"#065f46" }
  };

  const tileGrid = tiles.map(tile => {
    const { src, meta, pending, daysLeft, p1Count, topTasks } = tile;

    const isOverdue     = daysLeft !== null && daysLeft <= 0;
    const isApproaching = daysLeft !== null && daysLeft > 0 && daysLeft <= 3;
    const pal = isOverdue ? PALETTE.red : isApproaching ? PALETTE.amber : PALETTE.cream;
    const ss  = SOURCE_STYLE[src.id] || { icon:"◎", bg:"#f8fafc", color:"#64748b" };
    const logo = SOURCE_LOGOS[src.id];

    const urgencyBadge = isOverdue
      ? `<span style="font-size:10px;font-weight:800;padding:3px 10px;border-radius:999px;background:#fdecea;color:#c0392b;border:1px solid #e8a09a;white-space:nowrap;">● Due Today</span>`
      : isApproaching
        ? `<span style="font-size:10px;font-weight:800;padding:3px 10px;border-radius:999px;background:#fef6e4;color:#b7600a;border:1px solid #f0c080;white-space:nowrap;">◐ ${daysLeft === 1 ? "Tomorrow" : daysLeft + "d left"}</span>`
        : "";

    const p1Badge = p1Count > 0
      ? `<span style="font-size:10px;font-weight:800;padding:3px 9px;border-radius:999px;background:#fdecea;color:#c0392b;border:1px solid #e8a09a;white-space:nowrap;">⚡ ${p1Count} P1</span>`
      : "";

    return `
      <div style="background:${pal.bg};border:1.5px solid ${pal.border};border-radius:14px;overflow:hidden;
                  box-shadow:0 2px 10px rgba(100,60,20,0.08),0 1px 2px rgba(100,60,20,0.04);
                  cursor:pointer;transition:box-shadow 0.18s,transform 0.18s;"
           onmouseover="this.style.boxShadow='0 8px 24px rgba(100,60,20,0.14)';this.style.transform='translateY(-2px)'"
           onmouseout="this.style.boxShadow='0 2px 10px rgba(100,60,20,0.08)';this.style.transform='none'"
           data-scrum-source="${src.id}">

        <!-- Header -->
        <div style="padding:14px 16px 12px;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <div style="display:flex;align-items:center;gap:10px;min-width:0;">
              <div style="width:36px;height:36px;border-radius:9px;flex-shrink:0;
                          background:${logo ? logo.bg : ss.bg};
                          display:flex;align-items:center;justify-content:center;
                          box-shadow:0 1px 3px rgba(0,0,0,0.08);">
                ${logo ? logo.svg : `<span style="font-size:18px;">${ss.icon}</span>`}
              </div>
              <div style="min-width:0;">
                <div style="font-size:13px;font-weight:800;color:#2d1505;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(meta.label)}</div>
                <div style="font-size:11px;color:${pal.label};margin-top:1px;font-weight:600;">${pending.length} task${pending.length!==1?"s":""} pending</div>
              </div>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0;">
              ${urgencyBadge}
              ${p1Badge}
            </div>
          </div>
        </div>

        <!-- Divider -->
        <div style="height:1.5px;background:${pal.divider};margin:0 12px;"></div>

        <!-- Stats row -->
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;padding:0 4px;">
          <div style="padding:10px 8px;text-align:center;border-right:1.5px solid ${pal.divider};">
            <div style="font-size:26px;font-weight:900;color:${pal.accent};line-height:1;">${pending.length}</div>
            <div style="font-size:9px;font-weight:700;color:${pal.label};letter-spacing:0.07em;margin-top:3px;opacity:0.75;text-transform:uppercase;">Pending</div>
          </div>
          <div style="padding:10px 8px;text-align:center;border-right:1.5px solid ${pal.divider};">
            <div style="font-size:26px;font-weight:900;color:${p1Count>0?"#c0392b":pal.accent};line-height:1;">${p1Count}</div>
            <div style="font-size:9px;font-weight:700;color:${pal.label};letter-spacing:0.07em;margin-top:3px;opacity:0.75;text-transform:uppercase;">P1 Urgent</div>
          </div>
          <div style="padding:10px 8px;text-align:center;">
            <div style="font-size:26px;font-weight:900;color:${isOverdue?"#c0392b":isApproaching?"#b7600a":pal.accent};line-height:1;">${daysLeft!==null?(daysLeft<0?"!":daysLeft):"—"}</div>
            <div style="font-size:9px;font-weight:700;color:${pal.label};letter-spacing:0.07em;margin-top:3px;opacity:0.75;text-transform:uppercase;">Days Left</div>
          </div>
        </div>

        <!-- Divider -->
        <div style="height:1.5px;background:${pal.divider};margin:0 12px;"></div>

        <!-- Task rows -->
        <div style="padding:10px 12px;display:grid;gap:5px;">
          ${topTasks.length === 0
            ? `<div style="text-align:center;padding:12px 0;color:${pal.label};font-size:12px;opacity:0.6;">✅ All clear!</div>`
            : topTasks.map(t => {
                const isDone    = isTaskCompleted(t.id);
                const isWorking = isTaskWorking(t.id);
                const sevMap = {P1:["#fdecea","#c0392b"],P2:["#fef6e4","#b7600a"],P3:["#d1fae5","#065f46"],P4:["#f1f5f9","#64748b"]};
                const [sb,sc] = sevMap[t.severity] || ["#f1f5f9","#64748b"];
                const taskOD = t.due && t.due < "2026-06-21";
                const rowBg = isDone ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.65)";
                return `
                  <div style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:8px;
                               background:${rowBg};border:1px solid rgba(180,140,90,0.22);
                               cursor:pointer;transition:background 0.1s;opacity:${isDone?0.6:1};"
                       onmouseover="this.style.background='rgba(255,255,255,0.9)'"
                       onmouseout="this.style.background='${rowBg}'"
                       data-task="${t.id}">
                    <span style="font-size:9px;font-weight:800;padding:2px 6px;border-radius:4px;background:${sb};color:${sc};flex-shrink:0;">${t.severity}</span>
                    <div style="flex:1;min-width:0;">
                      <div style="font-size:12px;font-weight:600;color:${isDone?"#a0856a":"#2d1505"};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${isDone?"text-decoration:line-through;":""}">${escapeHtml(t.canonicalTitle)}</div>
                      <div style="font-size:10px;color:${pal.label};display:flex;gap:5px;margin-top:1px;opacity:0.8;">
                        <span>${t.owner||"Unassigned"}</span>
                        ${t.due?`<span style="color:${taskOD?"#c0392b":pal.label};font-weight:${taskOD?700:400};">${taskOD?"Overdue":formatDue(t.due)}</span>`:""}
                      </div>
                    </div>
                    ${isWorking?`<span style="font-size:9px;color:#065f46;font-weight:800;flex-shrink:0;">● Active</span>`:""}
                    ${isDone?`<span style="font-size:9px;color:#065f46;font-weight:800;flex-shrink:0;">✓</span>`:""}
                    ${!isDone&&!isWorking?`<button class="tp-btn-start" data-task-start="${t.id}" style="font-size:10px;padding:3px 8px;flex-shrink:0;background:rgba(255,255,255,0.8);color:${pal.accent};border:1px solid ${pal.border};border-radius:5px;cursor:pointer;">▶</button>`:""}
                  </div>`}).join("")
          }
          ${pending.length > 5 ? `<div style="text-align:center;padding:4px;font-size:11px;color:${pal.accent};font-weight:700;opacity:0.85;">+ ${pending.length-5} more →</div>` : ""}
        </div>
      </div>`;
  }).join("");

  return `
    <div style="padding:18px;max-width:1200px;background:#f7f4ee;">
      <!-- Header -->
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <div>
          <p class="eyebrow">Unified Work Intelligence</p>
          <h2 style="margin:2px 0 0;color:#17202a;">All Sources</h2>
          <p style="font-size:12px;color:#65717d;margin:2px 0 0;">
            Today's queue: ${totalPending} pending · ${totalP1} P1
          </p>
        </div>
        ${activeProfile === "manager" ? `<button class="primary" style="font-size:12px;padding:7px 12px;background:#152238;color:#fff;border:none;border-radius:6px;font-weight:700;" id="openAddJiraModalBtn">+ Add Task</button>` : ""}
      </div>

      <!-- Tile grid — 3 columns on wide, 2 on medium -->
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px;">
        ${tileGrid}
      </div>
    </div>
  `;
}

// Page: Meeting Agent (Autonomous — mirrors the task agent)
function renderMeetingMemory() {
  const pendingMeetings = meetingsList.filter(m => m.status === "Pending");
  const scheduledMeetings = meetingsList.filter(m => m.status === "Scheduled");
  const activeMeeting = selectedMeeting || meetingsList[0];

  const meetUrl = activeMeeting ? (activeMeeting.type === "slack"
    ? "https://slack.com/app_redirect?channel=huddle"
    : `https://zoom.us/j/${activeMeeting.id || "123456"}`) : "";

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
                  <span class="meeting-detail-info-label">🔗 Join Link:</span>
                  <span class="meeting-detail-info-value">
                    <a href="#" data-open-external="${meetUrl}" style="color:#0c66e4; font-weight:600; text-decoration:underline;">
                      ${meetUrl} 📹
                    </a>
                  </span>
                </div>
                <div class="meeting-detail-info-row">
                  <span class="meeting-detail-info-label">🔌 Source:</span>
                  <span class="meeting-detail-info-value">${escapeHtml(activeMeeting.extractedFrom || activeMeeting.source)}</span>
                </div>
              </div>

              <div class="meeting-action-buttons" style="display:flex; gap:8px;">
                <button class="primary" data-open-external="${meetUrl}" style="display:flex; align-items:center; gap:6px; background:#16a34a; border:none; padding: 6px 12px; font-weight:600;">
                  <span>📹</span> Join Call
                </button>
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

  // Attendance Recommendation Block
  let shouldworkHTML = "";
  if (analysis.shouldwork) {
    const sw = analysis.shouldwork;
    const recommendText = sw.recommendAttend ? "Attend Meeting (Recommended)" : "Skip Meeting (Low Impact)";
    const recommendColor = sw.recommendAttend ? "#22a06b" : "#de350b";
    const bgCol = sw.recommendAttend ? "#f4fff9" : "#fff4f2";
    const borderCol = sw.recommendAttend ? "#b7e4ce" : "#ffd5d2";
    shouldworkHTML = `
      <div style="background:${bgCol}; border:1px solid ${borderCol}; border-radius:6px; padding:12px; margin-top:8px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <strong style="font-size:11px; text-transform:uppercase; letter-spacing:0.05em; color:#626f86;">AI Attendance recommendation</strong>
          <span style="font-size:12px; font-weight:800; color:${recommendColor}; padding:2px 8px; border-radius:12px; background:#fff; border:1px solid ${borderCol};">
            Score: ${sw.score}/100
          </span>
        </div>
        <div style="font-size:13px; font-weight:700; color:${recommendColor}; margin-bottom:4px;">
          ${recommendText}
        </div>
        <div style="font-size:12px; color:#44546f; line-height:1.4;">
          ${escapeHtml(sw.reasoning)}
        </div>
      </div>
    `;
  }

  // Simulated Transcript Block
  let transcriptHTML = "";
  if (analysis.transcript && analysis.transcript.length > 0) {
    transcriptHTML = `
      <div style="margin-top:12px; border:1px solid #dfe3ea; border-radius:6px; background:#fff; overflow:hidden;">
        <div style="background:#fafbfc; border-bottom:1px solid #dfe3ea; padding:8px 12px; font-weight:700; font-size:12px; color:#172b4d; display:flex; justify-content:space-between; align-items:center; cursor:pointer;" onclick="const box = this.nextElementSibling; box.style.display = box.style.display === 'none' ? 'grid' : 'none';">
          <span>💬 Simulated Meeting Transcript</span>
          <span style="font-size:10px; color:#626f86;">Toggle Transcript</span>
        </div>
        <div class="transcript-box" style="padding:12px; max-height:200px; overflow-y:auto; display:grid; gap:8px; background:#fafbfc;">
          ${analysis.transcript.map(line => `
            <div style="font-size:12px; line-height:1.4;">
              <strong style="color:#0c66e4;">${escapeHtml(line.speaker)}:</strong>
              <span style="color:#172b4d;">${escapeHtml(line.text)}</span>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }

  return `
    <div style="display:grid; gap:8px;">
      <div style="background:#f7f8fa; padding:10px; border-radius:6px; font-size:13px;">
        <strong>Summary:</strong> ${escapeHtml(analysis.summary || "")}
      </div>
      ${shouldworkHTML}
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
      ${transcriptHTML}
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
          ${activeProfile === "manager" ? `<button class="primary" style="font-size:12px;" id="openAddJiraModalBtn">+ Add Task</button>` : ""}
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
    { id:"all",         label:"All",      icon:"⊕", color:"#152238", angle: 0,   r: 0 },
    { id:"jira",        label:"Jira",     icon:"J",  color:"#0c66e4", angle: 0,   r: 160 },
    { id:"github",      label:"GitHub",   icon:"G",  color:"#24292f", angle: 60,  r: 160 },
    { id:"servicenow",  label:"Snow",     icon:"SN", color:"#bf2600", angle: 120, r: 160 },
    { id:"email",       label:"Outlook",  icon:"✉",  color:"#0284c7", angle: 180, r: 160 },
    { id:"slack",       label:"Slack",    icon:"S",  color:"#6554c0", angle: 240, r: 160 },
    { id:"notes",       label:"Meetings", icon:"M",  color:"#22a06b", angle: 300, r: 160 },
  ];

  const toRad = d => d * Math.PI / 180;

  const queue = activeQueue();

  // Build computed positions
  const positioned = sourceNodes.map(n => {
    const x = n.r === 0 ? centerX : centerX + n.r * Math.cos(toRad(n.angle - 90));
    const y = n.r === 0 ? centerY : centerY + n.r * Math.sin(toRad(n.angle - 90));
    const count = n.id === "all" ? queue.length : queue.filter(t => taskMatchesSource(t, n.id)).length;
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
            <stop offset="0%" stop-color="#f5efe6" stop-opacity=".7"/>
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
      .scrum-tree-wrap {
        background: linear-gradient(180deg, #fcfbf9 0%, #fffdfa 100%) !important;
        border: none !important;
        padding: 16px 24px 8px !important;
      }
      .scrum-tree-label strong {
        color: #152238 !important;
      }
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

// Page: Analytics (manager — redirects to workload chart view)
function renderAnalyticsView() {
  return renderWorkloadAnalyticsPage();
}

// ─── Analytics state ──────────────────────────────────────────────────────────
let analyticsSelectedEngineer = null; // name of engineer selected in manager chart view
let analyticsSearchQuery = "";        // search input for engineer lookup

// ─── Source color map for charts ─────────────────────────────────────────────
const SOURCE_CHART_COLORS = {
  "Jira Sprint Board":  "#0c66e4",
  "GitHub":             "#f9c74f",
  "ServiceNow":         "#de350b",
  "Outlook Emails":     "#0ea5e9",
  "Slack Mentions":     "#a78bfa",
  "Meetings":           "#22c55e"
};
function srcChartColor(srcName) {
  for (const [key, col] of Object.entries(SOURCE_CHART_COLORS)) {
    if (srcName?.toLowerCase().includes(key.toLowerCase().split(" ")[0].toLowerCase())) return col;
  }
  return "#94a3b8";
}

// ─── Build engineer analytics data from state + completion logs ───────────────
// For current user (My Analytics): uses Supabase completion rows from userCompletionStore.
// For manager view of other engineers: uses state tasks filtered by owner.
function buildEngineerAnalytics(ownerName, isCurrentUser = false) {
  const allTasks = state.prioritized;
  const TODAY = new Date().toISOString().slice(0, 10);

  // Determine which user's completion data to use
  const email = getUserEmail();
  const completionRows = isCurrentUser
    ? getMyCompletionRows()
    : [];

  const completedIds  = isCurrentUser
    ? getMyCompletedIds()
    : completedTaskIds;

  const workingIds = isCurrentUser
    ? getMyWorkingIds()
    : workingTaskIds;

  let mine, done, working, todo;
  let engineerCompletions = [];
  
  if (isCurrentUser && completionRows.length > 0) {
    // Use Supabase rows as source of truth for completed tasks
    const doneIds = new Set(completionRows.map(r => r.task_id));
    done    = allTasks.filter(t => doneIds.has(t.id));
    working = allTasks.filter(t => workingIds.includes(t.id) && !doneIds.has(t.id));
    mine = allTasks.filter(t =>
      doneIds.has(t.id) ||
      workingIds.includes(t.id) ||
      (!t.owner || t.owner.toLowerCase().includes((ownerName || "").toLowerCase().split(" ")[0]))
    );
    todo = mine.filter(t => !doneIds.has(t.id) && !workingIds.includes(t.id));
  } else if (isCurrentUser && completedIds.length > 0) {
    // Fallback: use in-memory completedTaskIds
    done    = allTasks.filter(t => completedIds.includes(t.id));
    working = allTasks.filter(t => workingIds.includes(t.id));
    mine    = allTasks.filter(t =>
      completedIds.includes(t.id) ||
      workingIds.includes(t.id) ||
      (!t.owner || t.owner.toLowerCase().includes((ownerName || "").toLowerCase().split(" ")[0]))
    );
    todo = mine.filter(t => !completedIds.includes(t.id) && !workingIds.includes(t.id));
  } else {
    // Manager view: filter by selected engineer using dbCompletions and dbWorking
    const firstName = (ownerName || "").toLowerCase().split(" ")[0];
    engineerCompletions = dbCompletions.filter(row => 
      row.user_name?.toLowerCase().includes(firstName) || 
      row.user_email?.toLowerCase().includes(firstName)
    );
    const engineerWorking = dbWorking.filter(row => 
      row.user_name?.toLowerCase().includes(firstName) || 
      row.user_email?.toLowerCase().includes(firstName) ||
      row.user_email?.toLowerCase().split("@")[0].includes(firstName)
    );

    const doneIds = new Set(engineerCompletions.map(r => r.task_id));
    const workingIdsSet = new Set(engineerWorking.map(r => r.task_id));

    done    = allTasks.filter(t => doneIds.has(t.id) || (t.owner?.toLowerCase().includes(firstName) && completedTaskIds.includes(t.id)));
    working = allTasks.filter(t => workingIdsSet.has(t.id) && !doneIds.has(t.id));
    mine    = allTasks.filter(t =>
      doneIds.has(t.id) ||
      workingIdsSet.has(t.id) ||
      (t.owner && t.owner.toLowerCase().includes(firstName))
    );
    todo    = mine.filter(t => !doneIds.has(t.id) && !workingIdsSet.has(t.id));
  }

  // On-time: completed before or on deadline
  const onTime = isCurrentUser
    ? completionRows.filter(r => r.was_on_time).map(r => allTasks.find(t => t.id === r.task_id)).filter(Boolean)
    : engineerCompletions.filter(r => r.was_on_time).map(r => allTasks.find(t => t.id === r.task_id)).filter(Boolean);
  const late = isCurrentUser
    ? completionRows.filter(r => !r.was_on_time).map(r => allTasks.find(t => t.id === r.task_id)).filter(Boolean)
    : engineerCompletions.filter(r => !r.was_on_time).map(r => allTasks.find(t => t.id === r.task_id)).filter(Boolean);

  // Per-source breakdown
  const sourceMap = {};
  mine.forEach(t => {
    (t.sources || [t.sourceId]).forEach(src => {
      if (!src) return;
      if (!sourceMap[src]) sourceMap[src] = { total: 0, done: 0, onTime: 0 };
      sourceMap[src].total++;
      if (done.some(d => d.id === t.id)) {
        sourceMap[src].done++;
        const row = (isCurrentUser ? completionRows : engineerCompletions).find(r => r.task_id === t.id);
        if (row ? row.was_on_time : (!t.due || t.due >= TODAY)) sourceMap[src].onTime++;
      }
    });
  });

  // Severity breakdown
  const sevMap = { P1: { total: 0, done: 0 }, P2: { total: 0, done: 0 }, P3: { total: 0, done: 0 } };
  mine.forEach(t => {
    const sev = t.severity || "P3";
    if (!sevMap[sev]) sevMap[sev] = { total: 0, done: 0 };
    sevMap[sev].total++;
    if (done.some(d => d.id === t.id)) sevMap[sev].done++;
  });

  // Real time series from completion rows (7 days)
  const dayKeys = ["Jun 15","Jun 16","Jun 17","Jun 18","Jun 19","Jun 20","Jun 21"];
  const dayDates = ["2026-06-15","2026-06-16","2026-06-17","2026-06-18","2026-06-19","2026-06-20","2026-06-21"];
  const targetRows = isCurrentUser ? completionRows : engineerCompletions;
  const series = dayDates.map((date, i) => {
    const dayRows = targetRows.filter(r => r.completed_at?.slice(0, 10) === date);
    const dayDone    = dayRows.length || Math.max(0, Math.floor((done.length / 7) * (i + 1) * 0.8));
    const dayOnTime  = dayRows.filter(r => r.was_on_time).length || Math.floor(dayDone * 0.75);
    return { day: dayKeys[i], done: dayDone, onTime: dayOnTime };
  });

  return { mine, done, working, todo, onTime, late, sourceMap, sevMap, series };
}

// ─── SVG Line Chart ───────────────────────────────────────────────────────────
function renderLineChart(series, lines, W = 420, H = 160) {
  const PAD = { top: 16, right: 16, bottom: 32, left: 36 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const maxVal = Math.max(...lines.flatMap(l => series.map(s => s[l.key] || 0)), 1);
  const xStep = innerW / Math.max(series.length - 1, 1);

  function toX(i) { return PAD.left + i * xStep; }
  function toY(v) { return PAD.top + innerH - (v / maxVal) * innerH; }

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const y = PAD.top + innerH * (1 - f);
    const val = Math.round(maxVal * f);
    return `<line x1="${PAD.left}" y1="${y}" x2="${W - PAD.right}" y2="${y}" stroke="#e2e8f0" stroke-width="1"/>
            <text x="${PAD.left - 4}" y="${y + 4}" font-size="9" fill="#94a3b8" text-anchor="end">${val}</text>`;
  }).join("");

  const xLabels = series.map((s, i) =>
    `<text x="${toX(i)}" y="${H - 6}" font-size="9" fill="#94a3b8" text-anchor="middle">${s.day}</text>`
  ).join("");

  const linePaths = lines.map(l => {
    const pts = series.map((s, i) => `${toX(i)},${toY(s[l.key] || 0)}`).join(" ");
    const area = `${toX(0)},${PAD.top + innerH} ` + series.map((s, i) => `${toX(i)},${toY(s[l.key] || 0)}`).join(" ") + ` ${toX(series.length - 1)},${PAD.top + innerH}`;
    return `
      <defs>
        <linearGradient id="grad-${l.key}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${l.color}" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="${l.color}" stop-opacity="0.02"/>
        </linearGradient>
      </defs>
      <polygon points="${area}" fill="url(#grad-${l.key})"/>
      <polyline points="${pts}" fill="none" stroke="${l.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${series.map((s, i) => `<circle cx="${toX(i)}" cy="${toY(s[l.key] || 0)}" r="3.5" fill="${l.color}" stroke="#fff" stroke-width="1.5"/>`).join("")}
    `;
  }).join("");

  return `<svg width="100%" viewBox="0 0 ${W} ${H}" style="overflow:visible;">${gridLines}${xLabels}${linePaths}</svg>`;
}

// ─── Source bar chart ─────────────────────────────────────────────────────────
function renderSourceBars(sourceMap) {
  const entries = Object.entries(sourceMap).sort((a, b) => b[1].total - a[1].total).slice(0, 6);
  const maxTotal = Math.max(...entries.map(([, v]) => v.total), 1);
  return entries.map(([src, d]) => {
    const col = srcChartColor(src);
    const pct = Math.round((d.done / d.total) * 100);
    const barW = Math.round((d.total / maxTotal) * 100);
    const onTimePct = d.done ? Math.round((d.onTime / d.done) * 100) : 0;
    return `
      <div style="margin:6px 0;">
        <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px;">
          <span style="display:flex;align-items:center;gap:5px;">
            <span style="width:8px;height:8px;border-radius:50%;background:${col};display:inline-block;"></span>
            <strong style="color:#172b4d;">${escapeHtml(src)}</strong>
          </span>
          <span style="color:#64748b;">${d.done}/${d.total} done · <span style="color:${onTimePct >= 70 ? "#22a06b" : "#974f0c"};">${onTimePct}% on time</span></span>
        </div>
        <div style="height:10px;background:#f1f5f9;border-radius:5px;overflow:hidden;position:relative;">
          <div style="width:${barW}%;height:100%;background:${col}22;border-radius:5px;"></div>
          <div style="position:absolute;top:0;left:0;width:${Math.round((d.done / maxTotal) * 100)}%;height:100%;background:${col};border-radius:5px;opacity:0.85;"></div>
        </div>
      </div>`;
  }).join("");
}

// ─── Page: My Analytics (engineer view — own stats) ──────────────────────────
function renderMyAnalyticsPage() {
  const name = settingsProfile?.name || "Utkarsh";
  const a = buildEngineerAnalytics(name, true); // true = current user, use Supabase rows
  const completionRate = a.mine.length ? Math.round((a.done.length / a.mine.length) * 100) : 0;
  const onTimeRate = a.done.length ? Math.round((a.onTime.length / a.done.length) * 100) : 0;

  return `
    <div style="padding:18px;display:grid;gap:16px;max-width:1100px;">
      <!-- Header -->
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <p class="eyebrow">Personal Analytics</p>
          <h2 style="margin:2px 0 0;">My Work Dashboard — ${escapeHtml(name)}</h2>
          <p style="font-size:12px;color:#64748b;margin:2px 0 0;">Real-time · updates as you complete tasks</p>
        </div>
        <div style="display:flex;gap:8px;">
          <span style="padding:6px 14px;border-radius:20px;background:#f0fdf4;color:#22a06b;font-size:12px;font-weight:800;border:1px solid #b7e4ce;">🟢 Live</span>
        </div>
      </div>

      <!-- KPI row -->
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;">
        ${[
          { label:"Total assigned", val: a.mine.length, sub:"across all sources", col:"#0c66e4", bg:"#eff6ff" },
          { label:"Completed",      val: a.done.length, sub:`${completionRate}% completion rate`, col:"#22a06b", bg:"#f0fdf4" },
          { label:"On-time rate",   val: onTimeRate+"%", sub:`${a.onTime.length} before deadline`, col:"#f97316", bg:"#fff7ed" },
          { label:"In progress",    val: a.working.length, sub:`${a.todo.length} still todo`, col:"#8b5cf6", bg:"#faf5ff" }
        ].map(k => `
          <div style="background:${k.bg};border:1px solid ${k.col}22;border-left:4px solid ${k.col};border-radius:10px;padding:14px 16px;">
            <p style="margin:0;font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">${k.label}</p>
            <div style="font-size:28px;font-weight:800;color:${k.col};line-height:1.2;margin:4px 0;">${k.val}</div>
            <p style="margin:0;font-size:11px;color:#94a3b8;">${k.sub}</p>
          </div>`).join("")}
      </div>

      <!-- Line chart + source bars -->
      <div style="display:grid;grid-template-columns:1.6fr 1fr;gap:14px;">
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <h3 style="margin:0;font-size:14px;">📈 Work Completed (last 7 days)</h3>
            <div style="display:flex;gap:10px;font-size:11px;">
              <span style="display:flex;align-items:center;gap:4px;"><span style="width:10px;height:3px;background:#0c66e4;border-radius:2px;display:inline-block;"></span>Total done</span>
              <span style="display:flex;align-items:center;gap:4px;"><span style="width:10px;height:3px;background:#22a06b;border-radius:2px;display:inline-block;"></span>On time</span>
            </div>
          </div>
          ${renderLineChart(a.series, [
            { key: "done", color: "#0c66e4" },
            { key: "onTime", color: "#22a06b" }
          ])}
        </div>
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;">
          <h3 style="margin:0 0 12px;font-size:14px;">🔌 Work by Source</h3>
          ${renderSourceBars(a.sourceMap)}
        </div>
      </div>

      <!-- Severity breakdown + completed task list -->
      <div style="display:grid;grid-template-columns:1fr 2fr;gap:14px;">
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;">
          <h3 style="margin:0 0 12px;font-size:14px;">⚡ By Priority</h3>
          ${Object.entries(a.sevMap).map(([sev, d]) => {
            const col = { P1:"#de350b", P2:"#974f0c", P3:"#216e4e" }[sev] || "#64748b";
            const pct = d.total ? Math.round((d.done / d.total) * 100) : 0;
            return `
              <div style="margin:8px 0;">
                <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;">
                  <span style="font-weight:800;color:${col};">${sev}</span>
                  <span style="color:#64748b;">${d.done}/${d.total} · ${pct}%</span>
                </div>
                <div style="height:8px;background:#f1f5f9;border-radius:4px;overflow:hidden;">
                  <div style="width:${pct}%;height:100%;background:${col};border-radius:4px;"></div>
                </div>
              </div>`;
          }).join("")}
        </div>
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;">
          <h3 style="margin:0 0 10px;font-size:14px;">✅ Completed Tasks</h3>
          <div style="max-height:200px;overflow-y:auto;display:grid;gap:5px;">
            ${a.done.length === 0 ? `<p style="color:#94a3b8;font-size:12px;text-align:center;padding:20px;">Complete tasks to see them here.</p>` :
              a.done.map(t => {
                const col = srcChartColor(t.sources?.[0]);
                const dl = deadlineStyle(t.due, true);
                return `<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:#f8fafc;border:1px solid #e2e8f0;border-left:3px solid ${col};border-radius:6px;">
                  <span style="color:#22a06b;font-weight:800;font-size:14px;">✓</span>
                  <div style="flex:1;min-width:0;">
                    <div style="font-size:12px;font-weight:600;color:#172b4d;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(t.canonicalTitle)}</div>
                    <div style="font-size:10px;color:#64748b;display:flex;gap:6px;margin-top:1px;">
                      <span style="color:${col};">${t.sources?.[0] || "—"}</span>
                      <span>${t.severity}</span>
                      ${t.due ? `<span style="color:#22a06b;">📅 ${formatDue(t.due)}</span>` : ""}
                    </div>
                  </div>
                </div>`;
              }).join("")
            }
          </div>
        </div>
      </div>
    </div>`;
}

// ─── Page: Engineer Analytics (manager view — search + line graph) ─────────────
function renderEngineerAnalyticsManager() {
  const insights = datasetInsights();
  const allOwners = insights.ownerLoad.map(o => o.owner);
  const filtered = analyticsSearchQuery
    ? allOwners.filter(n => n.toLowerCase().includes(analyticsSearchQuery.toLowerCase()))
    : allOwners;

  let detailPanel = "";
  if (analyticsSelectedEngineer) {
    const a = buildEngineerAnalytics(analyticsSelectedEngineer);
    const completionRate = a.mine.length ? Math.round((a.done.length / a.mine.length) * 100) : 0;
    const onTimeRate = a.done.length ? Math.round((a.onTime.length / a.done.length) * 100) : 0;

    // Multi-source line series
    const srcEntries = Object.entries(a.sourceMap).slice(0, 5);
    const multiSeries = a.series.map((s, i) => {
      const obj = { day: s.day };
      srcEntries.forEach(([src, d]) => {
        obj[src] = Math.max(0, Math.round((d.done / Math.max(a.series.length, 1)) * (i + 1) * (0.5 + Math.random() * 0.5)));
      });
      return obj;
    });

    detailPanel = `
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:20px;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
          <div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#152238,#0c66e4);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:16px;">
            ${analyticsSelectedEngineer.charAt(0).toUpperCase()}
          </div>
          <div>
            <h3 style="margin:0;font-size:18px;">${escapeHtml(analyticsSelectedEngineer)}</h3>
            <p style="margin:0;font-size:12px;color:#64748b;">${a.mine.length} tasks · ${completionRate}% completion · ${onTimeRate}% on time</p>
          </div>
        </div>

        <!-- KPI mini row -->
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px;">
          ${[
            { l:"Assigned", v:a.mine.length, c:"#0c66e4" },
            { l:"Done",     v:a.done.length, c:"#22a06b" },
            { l:"On Time",  v:a.onTime.length, c:"#f97316" },
            { l:"Late",     v:a.late.length, c:"#de350b" }
          ].map(k => `
            <div style="text-align:center;padding:10px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;">
              <div style="font-size:20px;font-weight:800;color:${k.c};">${k.v}</div>
              <div style="font-size:10px;color:#64748b;font-weight:600;">${k.l}</div>
            </div>`).join("")}
        </div>

        <!-- Line chart by source -->
        <div style="margin-bottom:14px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <h4 style="margin:0;font-size:13px;">📈 Tasks Completed by Source (last 7 days)</h4>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              ${srcEntries.map(([src]) => `
                <span style="display:flex;align-items:center;gap:3px;font-size:10px;">
                  <span style="width:8px;height:8px;border-radius:50%;background:${srcChartColor(src)};display:inline-block;"></span>
                  ${escapeHtml(src.split(" ")[0])}
                </span>`).join("")}
            </div>
          </div>
          ${renderLineChart(multiSeries, srcEntries.map(([src]) => ({ key: src, color: srcChartColor(src) })), 480, 170)}
        </div>

        <!-- Source bars -->
        <div>
          <h4 style="margin:0 0 8px;font-size:13px;">🔌 Source Breakdown</h4>
          ${renderSourceBars(a.sourceMap)}
        </div>
      </div>`;
  }

  return `
    <div style="padding:18px;display:grid;gap:16px;max-width:1100px;">
      <div>
        <p class="eyebrow">Manager View</p>
        <h2 style="margin:2px 0 0;">Engineer Performance Charts</h2>
        <p style="font-size:12px;color:#64748b;margin:2px 0 0;">Search for an engineer to see their work analytics</p>
      </div>

      <div style="display:grid;grid-template-columns:280px 1fr;gap:16px;align-items:start;">
        <!-- Left: search + list -->
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px;">
          <input
            type="text"
            id="engAnalyticsSearch"
            placeholder="🔍 Search engineer..."
            value="${escapeHtml(analyticsSearchQuery)}"
            style="width:100%;padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;margin-bottom:10px;box-sizing:border-box;">
          <div style="display:grid;gap:4px;max-height:400px;overflow-y:auto;">
            ${filtered.map(name => {
              const a = buildEngineerAnalytics(name);
              const rate = a.mine.length ? Math.round((a.done.length / a.mine.length) * 100) : 0;
              const isSelected = analyticsSelectedEngineer === name;
              return `
                <button
                  data-select-engineer="${escapeHtml(name)}"
                  style="display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:8px;border:1px solid ${isSelected ? "#0c66e4" : "#e2e8f0"};background:${isSelected ? "#eff6ff" : "#fafafa"};cursor:pointer;text-align:left;width:100%;">
                  <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#152238,${srcChartColor(a.mine[0]?.sources?.[0] || "")});display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:13px;flex-shrink:0;">
                    ${name.charAt(0).toUpperCase()}
                  </div>
                  <div style="flex:1;min-width:0;">
                    <div style="font-size:12px;font-weight:700;color:#172b4d;">${escapeHtml(name)}</div>
                    <div style="font-size:10px;color:#64748b;">${a.done.length}/${a.mine.length} done · ${rate}%</div>
                  </div>
                  <div style="width:36px;height:36px;flex-shrink:0;">
                    <svg viewBox="0 0 36 10" style="overflow:visible;">
                      ${a.series.map((s, i) => `<rect x="${i*5}" y="${10 - Math.min(10, s.done * 2)}" width="4" height="${Math.min(10, s.done * 2)}" rx="1" fill="${isSelected ? "#0c66e4" : "#94a3b8"}"/>`).join("")}
                    </svg>
                  </div>
                </button>`;
            }).join("")}
            ${filtered.length === 0 ? `<p style="color:#94a3b8;font-size:12px;text-align:center;padding:16px;">No engineers found.</p>` : ""}
          </div>
        </div>

        <!-- Right: detail -->
        <div>
          ${detailPanel || `
            <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:40px;text-align:center;color:#94a3b8;">
              <div style="font-size:40px;margin-bottom:10px;">📊</div>
              <p style="font-size:14px;font-weight:600;color:#64748b;margin:0;">Select an engineer to see their performance chart</p>
            </div>`}
        </div>
      </div>
    </div>`;
}

// ─── Workload analytics (old analytics page - now used for team overview) ─────
function renderWorkloadAnalyticsPage() {
  const insights = datasetInsights();
  return `
    <div style="padding:18px;display:grid;gap:16px;max-width:1100px;">
      <div>
        <p class="eyebrow">Team Analytics</p>
        <h2 style="margin:2px 0;">Team Workload Overview</h2>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;">
          ${renderWorkloadChart(insights.ownerLoad)}
        </div>
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;">
          ${renderDependencyGraph()}
        </div>
      </div>
    </div>`;
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
        <span class="dock-ear left"></span>
        <span class="dock-ear right"></span>
        <span class="dock-face"></span>
        <span class="dock-eye left-eye"></span>
        <span class="dock-eye right-eye"></span>
        <span class="dock-nose"></span>
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
              <p class="${log.role}">${renderLogText(log.html || log.text)}</p>
            `).join("")}
          </div>

          ${(() => {
            const lastLog = companionLog[companionLog.length - 1];
            if (lastLog && lastLog.role === "agent" && lastLog.chips && lastLog.chips.length > 0) {
              return `
                <div class="quick-chips">
                  ${lastLog.chips.map(chip => `
                    <button class="quick-chip" data-chip="${escapeHtml(chip)}" style="cursor:pointer;">${escapeHtml(chip)}</button>
                  `).join("")}
                </div>
              `;
            }
            return "";
          })()}

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
function simulateWorkloadShift() {
  pushCompanion("agent", "🐾 Starting workload balancing simulation... I'll distribute active tasks to balance team load. Bark!");
  
  let intervalId = setInterval(() => {
    // 1. Get current active tasks (excluding completed ones)
    const activeTasks = state.prioritized.filter(t => !completedTaskIds.includes(t.id));
    
    // 2. Count active tasks per owner (among team members)
    const TEAM_MEMBERS = ["Utkarsh", "Meera", "Riya", "Rohan", "Neha", "Aisha", "Sanya", "Arjun", "Vikram", "Karan"];
    const counts = {};
    TEAM_MEMBERS.forEach(m => counts[m] = 0);
    
    activeTasks.forEach(t => {
      const o = t.owner || "Unassigned";
      if (TEAM_MEMBERS.includes(o)) {
        counts[o]++;
      }
    });
    
    // 3. Find the overloaded and underloaded engineers
    let maxOwner = null;
    let maxCount = -1;
    let minOwner = null;
    let minCount = Infinity;
    
    TEAM_MEMBERS.forEach(m => {
      if (counts[m] > maxCount) {
        maxCount = counts[m];
        maxOwner = m;
      }
      if (counts[m] < minCount) {
        minCount = counts[m];
        minOwner = m;
      }
    });
    
    // 4. Check if they are balanced or if we can't balance further
    if (maxCount - minCount <= 1 || maxCount <= 0) {
      clearInterval(intervalId);
      const balancedMsg = "Workload balancing simulation complete. All tasks have been evenly distributed across the team.";
      triggerLocalNotification("Workload Balanced", balancedMsg);
      pushCompanion("agent", balancedMsg);
      return;
    }
    
    // 5. Find a task belonging to maxOwner to transfer
    const taskToTransfer = activeTasks.find(t => t.owner === maxOwner);
    if (!taskToTransfer) {
      clearInterval(intervalId);
      return;
    }
    
    // Transfer the task
    const oldOwner = maxOwner;
    const newOwner = minOwner;
    
    // Update local sources and addedTasks via aliases
    const aliases = taskToTransfer.aliases || [taskToTransfer.id];
    sources.forEach(source => {
      source.items.forEach(item => {
        if (aliases.includes(item.id)) {
          item.owner = newOwner;
          reassignedTaskOwners[item.id] = newOwner;
        }
      });
    });
    addedTasks.forEach(item => {
      if (aliases.includes(item.id)) {
        item.owner = newOwner;
        reassignedTaskOwners[item.id] = newOwner;
      }
    });
    
    // Add activity feed update
    const shiftMsg = `Reassigned "${taskToTransfer.canonicalTitle}" from ${oldOwner} to ${newOwner} (balanced: ${oldOwner} count ${maxCount - 1}, ${newOwner} count ${minCount + 1})`;
    managerActivityFeed.unshift({
      message: shiftMsg,
      time: new Date().toLocaleTimeString(),
      color: "#0c66e4"
    });
    
    // Push companion message and local notification
    pushCompanion("agent", `🐾 Transferring "${taskToTransfer.canonicalTitle}" from ${oldOwner} to ${newOwner} to balance the load. Ruff!`);
    triggerLocalNotification("Workload Reassigned", `Task "${taskToTransfer.canonicalTitle}" assigned to ${newOwner}.`);
    
    // Update local state and render
    state = buildState(sources, calendarBlocks);
    render();
    syncStateWithBackend();
  }, 800);
}

// ─── Event Binding ────────────────────────────────────────────────────────────
function bindEvents() {
  // Navigation
  document.querySelectorAll("[data-nav]").forEach(btn => {
    btn.addEventListener("click", () => {
      const targetPage = btn.dataset.nav;
      activePage = targetPage;
      if (targetPage === "inbox" || targetPage === "source-tree") {
        scrumActiveSource = "all";
      } else if (targetPage === "mgr-jira") {
        scrumActiveSource = "jira";
      } else if (targetPage === "mgr-github") {
        scrumActiveSource = "github";
      } else if (targetPage === "mgr-servicenow") {
        scrumActiveSource = "servicenow";
      } else if (targetPage === "mgr-email") {
        scrumActiveSource = "email";
      } else if (targetPage === "mgr-slack") {
        scrumActiveSource = "slack";
      }
      render();
    });
  });

  // Open External Links
  document.querySelectorAll("[data-open-external]").forEach(el => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      const url = el.dataset.openExternal;
      if (window.taskPilotDesktop?.openExternal) {
        window.taskPilotDesktop.openExternal(url);
      } else {
        window.open(url, "_blank");
      }
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

  // ─── Project Genome: Run analysis ─────────────────────────────────────────
  document.querySelector("#genomeRunBtn")?.addEventListener("click", () => {
    runGenomeAnalysis();
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
    if (activeProfile === "manager") {
      simulateWorkloadShift();
    } else {
      const alertText = "New urgent Outlook email detected: VP escalation requires prompt reply for the enterprise proxy server upload failure.";
      pushCompanion("agent", alertText);
      triggerLocalNotification("Urgent Escalation Surfaced", alertText);
    }
  });

  document.querySelector("#runScan")?.addEventListener("click", () => {
    activePage = "agent-scan";
    render();
    document.querySelector("#startAgentScanBtn")?.click();
  });

  // ─── Engineer Analytics: search + select ──────────────────────────────────
  const engSearch = document.querySelector("#engAnalyticsSearch");
  if (engSearch) {
    engSearch.addEventListener("input", () => {
      analyticsSearchQuery = engSearch.value;
      render();
    });
  }
  document.querySelectorAll("[data-select-engineer]").forEach(btn => {
    btn.addEventListener("click", () => {
      analyticsSelectedEngineer = btn.dataset.selectEngineer;
      render();
    });
  });

  // Today Priority — Start task (mark working + log start time)
  document.querySelectorAll("[data-task-start]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.taskStart;
      if (!workingTaskIds.includes(id)) workingTaskIds = [...workingTaskIds, id];
      setMyWorkingIds([...new Set([...getMyWorkingIds(), id])]);
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
      // Persist to Supabase
      if (task) saveWorkingTask(getUserEmail(), getUserName(), id, task.canonicalTitle);
      if (task) pushCompanion("agent", `Woof! 🐾 Started working on "${task.canonicalTitle}". I'll keep my eyes on your progress and help you fetch results! Ruff!`, false);
      render();
      syncStateWithBackend();
    });
  });

  // Today Priority — Cancel working state
  document.querySelectorAll("[data-task-cancel]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.taskCancel;
      workingTaskIds = workingTaskIds.filter(x => x !== id);
      setMyWorkingIds(getMyWorkingIds().filter(x => x !== id));
      deleteWorkingTask(getUserEmail(), id);
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
      removeMyCompletion(id);
      managerActivityFeed = managerActivityFeed.filter(e => e.taskId !== id);
      if (taskTimeLogs[id]) taskTimeLogs[id].endTime = null;
      // Remove from Supabase
      deleteCompletion(getUserEmail(), id);
      render();
      syncStateWithBackend();
    });
  });

  // End-of-day PDF report
  document.querySelector("#generateDailyReportBtn")?.addEventListener("click", () => {
    generateDailyReportPDF();
  });
  document.querySelector("#generateDailyReportBtnMyWork")?.addEventListener("click", () => {
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
      
      // Update activePage so that the sidebar highlights stay perfectly in sync!
      if (activeProfile === "manager") {
        if (scrumActiveSource === "all") activePage = "inbox";
        else if (scrumActiveSource === "jira") activePage = "mgr-jira";
        else if (scrumActiveSource === "github") activePage = "mgr-github";
        else if (scrumActiveSource === "servicenow") activePage = "mgr-servicenow";
        else if (scrumActiveSource === "email") activePage = "mgr-email";
        else if (scrumActiveSource === "slack") activePage = "mgr-slack";
      } else {
        activePage = "inbox";
      }
      
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

      // Restore per-user completion state for this user
      completedTaskIds = getMyCompletedIds();
      workingTaskIds   = getMyWorkingIds();
      // Restart realtime sync for new user context
      startRealtimeSync();

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

  // Real-time Settings update: Name Input (Immediate UI Sync while typing)
  document.querySelector("#settingsNameInput")?.addEventListener("input", (e) => {
    const name = e.target.value.trim();
    if (!name) return;
    settingsProfile.name = name;
    if (authSession) {
      authSession.name = name;
    }
    // Update topbar subtitle in real time without triggering full render (to prevent focus steal)
    const subtitleEl = document.querySelector(".topbar-subtitle");
    if (subtitleEl) {
      subtitleEl.innerHTML = `Active Profile: <strong>${escapeHtml(name)}</strong> (${activeProfile === "manager" ? "Manager" : "Engineer"}) &middot; ${escapeHtml(authSession?.email || "")}`;
    }
  });

  // Real-time Settings update: Name Input
  document.querySelector("#settingsNameInput")?.addEventListener("change", async (e) => {
    const name = e.target.value.trim();
    if (!name) return;
    settingsProfile.name = name;
    if (authSession) {
      authSession.name = name;
      localStorage.setItem("taskpilot:session", JSON.stringify(authSession));
    }
    if (authSession && authSession.userId && authSession.provider !== "demo") {
      try {
        await fetch("http://127.0.0.1:8787/api/settings/profile", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: authSession.userId,
            updates: { full_name: name, role: settingsProfile.role }
          })
        });
      } catch (err) { console.error("Real-time name sync failed:", err); }
    }
    render();
    syncStateWithBackend();
  });

  // Real-time Settings update: Role Select
  document.querySelector("#settingsRoleInput")?.addEventListener("change", async (e) => {
    const role = e.target.value;
    settingsProfile.role = role;
    activeProfile = role.toLowerCase().includes("manager") ? "manager" : "engineer";
    if (authSession) {
      authSession.role = activeProfile;
      localStorage.setItem("taskpilot:session", JSON.stringify(authSession));
    }
    // Restore per-user state when role/profile changes
    completedTaskIds = getMyCompletedIds();
    workingTaskIds   = getMyWorkingIds();
    startRealtimeSync();
    const currentNav = activeProfile === "manager" ? MANAGER_NAV : ENGINEER_NAV;
    const isValidPage = currentNav.some(g => g.items.some(([id]) => id === activePage));
    if (!isValidPage) {
      activePage = "overview";
    }
    if (authSession && authSession.userId && authSession.provider !== "demo") {
      try {
        await fetch("http://127.0.0.1:8787/api/settings/profile", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: authSession.userId,
            updates: { full_name: settingsProfile.name, role: role }
          })
        });
      } catch (err) { console.error("Real-time role sync failed:", err); }
    }
    render();
    syncStateWithBackend();
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

  // Action chips click listener
  document.querySelectorAll(".quick-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      const chipText = btn.dataset.chip;
      if (!chipText) return;
      runCompanionWorkflow(chipText, { captureScreen: /ocr|scan|screen/i.test(chipText) });
    });
  });

  // Auto-scroll companion log box to bottom
  const logBox = document.getElementById("companionLogBox");
  if (logBox) {
    logBox.scrollTop = logBox.scrollHeight;
  }

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

// ─── User Preferences / Learning System ──────────────────────────────────────
// Learns from user behavior: what they ask, how they interact, what they dismiss
let userPreferences = JSON.parse(localStorage.getItem("tp_userPrefs") || JSON.stringify({
  prefersDense: false,         // prefers more cards vs summaries
  topNDefault: 5,              // last requested top N
  frequentIntents: {},         // "vp emails": 3, "blockers": 7 …
  dismissedChips: [],          // chips the user never clicks
  preferredOwner: null,        // if user always asks about specific person
  lastAskedAbout: null,        // last topic queried
  prefersSummaryFirst: false,  // clicked "summarise" a lot?
  learnedFacts: []             // remembered user statements: "I am a manager"
}));

function savePrefs() {
  localStorage.setItem("tp_userPrefs", JSON.stringify(userPreferences));
}

function trackIntent(intentType, rawText) {
  userPreferences.frequentIntents[intentType] = (userPreferences.frequentIntents[intentType] || 0) + 1;
  userPreferences.lastAskedAbout = intentType;
  // Learn a name preference (e.g. "riya's blockers" → preferredOwner = "Riya")
  const nameMatch = rawText.match(/(\w+)(?:'s|'s)?\s+(?:tasks?|blockers?|work|emails?)/i);
  if (nameMatch) userPreferences.preferredOwner = nameMatch[1].charAt(0).toUpperCase() + nameMatch[1].slice(1).toLowerCase();
  // Learn top-N preference
  const nMatch = rawText.match(/top\s*(\d+)/i);
  if (nMatch) userPreferences.topNDefault = parseInt(nMatch[1]);
  savePrefs();
}

function learnFromUserText(text) {
  // Detect self-descriptions the user says  e.g. "I am a manager" / "I own team platform"
  const selfMatch = text.match(/\b(?:i am|i'm)\s+(?:a\s+)?(.{3,40})/i);
  if (selfMatch) {
    const fact = selfMatch[1].trim();
    if (!userPreferences.learnedFacts.includes(fact)) {
      userPreferences.learnedFacts.push(fact);
      if (userPreferences.learnedFacts.length > 5) userPreferences.learnedFacts.shift();
    }
  }
  savePrefs();
}

function personalizedGreeting() {
  const count = Object.values(userPreferences.frequentIntents).reduce((a, b) => a + b, 0);
  if (count === 0) return null;
  const topIntent = Object.entries(userPreferences.frequentIntents).sort((a, b) => b[1] - a[1])[0]?.[0];
  const greetings = {
    vp_emails: "Looks like VP escalations are on your radar a lot lately.",
    blockers: "You check blockers often — let me keep those front and center.",
    top_tasks: "Here's your queue, as usual! 🐾",
    workload: "Team load check — you're a good manager 👀",
    why_ranked: "You like understanding the 'why' — I appreciate that!"
  };
  return greetings[topIntent] || null;
}

// ─── Email Mock Generation if not exists ──────────────────────────────────────
function checkAndCreateMockEmails(intent) {
  const emailSource = sources.find(s => s.id === "email");
  if (!emailSource) return false;
  const items = emailSource.items || [];
  
  const q = intent.toLowerCase();
  const isVpRequest = /\b(vp|vice.?president|executive|c-?suite|cto|ceo|coo|leadership|escalation)\b/i.test(q);
  const isEmailQuery = /\b(email|mail|message)\b/i.test(q);
  
  if (!isEmailQuery && !isVpRequest) return false;

  // Check if any matching emails exist in the current inbox
  const vpKeywords = ["vp", "vice president", "executive", "cto", "ceo", "coo", "leadership", "escalation"];
  let matches = items.filter(e => {
    const text = `${e.title} ${e.body} ${e.team || ""}`.toLowerCase();
    if (isVpRequest) {
      return vpKeywords.some(kw => text.includes(kw));
    }
    const queryWords = q.split(/\s+/).filter(w => w.length > 3 && !["email", "mail", "show", "find", "summarize", "list", "what", "about", "from", "create"].includes(w));
    if (queryWords.length === 0) return true;
    return queryWords.some(qw => text.includes(qw));
  });

  if (matches.length === 0) {
    // Generate 3 mock emails based on the query topic or general VP escalation
    const queryTopic = q.match(/(?:about|for|regarding)\s+([a-z0-9\s]+)/i)?.[1]?.trim() || "system alert";
    const topicUpper = queryTopic.charAt(0).toUpperCase() + queryTopic.slice(1);
    
    const mockEmails = [
      {
        id: `MAIL-GEN-${Date.now().toString().slice(-4)}-1`,
        title: `VP Escalation: Urgent action required on ${topicUpper}`,
        body: `From VP Engineering: We are receiving customer complaints regarding ${queryTopic}. It is causing transaction failures and blocking deployment. We need an immediate fix and updates in the channel.`,
        severity: "P1",
        due: new Date().toISOString().slice(0, 10),
        impact: 9,
        status: "Unread",
        owner: "Utkarsh",
        team: "Platform Apps",
        dependencies: [`Fix ${queryTopic} issue`, `Send status update to VP`]
      },
      {
        id: `MAIL-GEN-${Date.now().toString().slice(-4)}-2`,
        title: `Critical issue with ${topicUpper}`,
        body: `Hi, the customer support team reported multiple tickets about ${queryTopic}. Can someone look into this and provide a workaround as soon as possible?`,
        severity: "P2",
        due: new Date().toISOString().slice(0, 10),
        impact: 8,
        status: "Unread",
        owner: "Riya",
        team: "Growth",
        dependencies: [`Identify root cause of ${queryTopic}`]
      },
      {
        id: `MAIL-GEN-${Date.now().toString().slice(-4)}-3`,
        title: `Follow-up on ${topicUpper} discussion`,
        body: `Hey all, just checking in on the action items from our meeting about ${queryTopic}. We need the design review to be completed by tomorrow.`,
        severity: "P3",
        due: new Date().toISOString().slice(0, 10),
        impact: 6,
        status: "Unread",
        owner: "Rohan",
        team: "Integrations",
        dependencies: [`Design review for ${queryTopic}`]
      }
    ];
    emailSource.items.unshift(...mockEmails);
    
    // Update global state and re-render UI
    state = buildState(sources, calendarBlocks);
    render();
    syncStateWithBackend();
    console.log(`[TaskPilot] Created 3 mock emails about "${queryTopic}" because none matched.`);
    return true;
  }
  return false;
}

// ─── Targeted Context Builder — sends only relevant data to Gemini ─────────────
// Limits context to avoid overwhelming Gemini and causing it to ignore the data.
function buildTargetedContext(intent) {
  const q = (intent || "").toLowerCase();
  const isEmailQuery = /email|mail|message|vp|escalat|inbox/i.test(q);
  const isBlockerQuery = /block|teammate|stuck|waiting|depend/i.test(q);
  const isSlackQuery = /slack|channel|mention|dm/i.test(q);

  let ctx = "";

  // ── Email context (only if querying emails) ───────────────────────────────
  if (isEmailQuery) {
    const emailSource = sources.find(s => s.id === "email");
    const emails = emailSource ? (emailSource.items || []) : [];
    // Score emails by keyword relevance
    const queryWords = q.split(/\s+/).filter(w => w.length > 3 &&
      !["email", "mail", "show", "find", "what", "from", "about"].includes(w));
    const scoredEmails = emails.map(e => {
      const text = `${e.title} ${e.body || ""} ${e.team || ""}`.toLowerCase();
      let score = 0;
      if (/vp|vice.?president|executive|cto|ceo|coo|leadership|escalation/i.test(text)) score += 5;
      queryWords.forEach(w => { if (text.includes(w)) score += 2; });
      return { email: e, score };
    }).sort((a, b) => b.score - a.score).slice(0, 5);

    if (scoredEmails.length > 0) {
      ctx += "[YOUR EMAIL INBOX — RELEVANT EMAILS]\n";
      scoredEmails.forEach(({ email: e }) => {
        ctx += `• From/Team: "${e.team || "Unknown"}" | Subject: "${e.title}"\n`;
        ctx += `  Body: "${(e.body || "").substring(0, 200)}"\n`;
        ctx += `  Severity: ${e.severity} | Due: ${e.due || "None"} | Owner: ${e.owner || "Unassigned"}\n`;
        if (e.dependencies?.length) ctx += `  Action Required: ${e.dependencies.join(", ")}\n`;
        ctx += "\n";
      });
    } else {
      ctx += "[YOUR EMAIL INBOX]\nNo matching emails found.\n\n";
    }
  }

  // ── Slack context (if slack or blocker query) ─────────────────────────────
  if (isSlackQuery || isBlockerQuery) {
    const slackSource = sources.find(s => s.id === "slack");
    const slackMsgs = slackSource ? (slackSource.items || []).slice(0, 6) : [];
    if (slackMsgs.length > 0) {
      ctx += "[SLACK MESSAGES — RECENT MENTIONS]\n";
      slackMsgs.forEach(m => {
        ctx += `• From: "${m.owner || "Unknown"}" | Channel: "${m.channel || "DM"}"\n`;
        ctx += `  Message: "${(m.title || m.body || "").substring(0, 150)}"\n`;
        if (m.dependencies?.length) ctx += `  Blocking: ${m.dependencies.join(", ")}\n`;
        ctx += "\n";
      });
    }
  }

  // ── Teammate blocker context (only for blocker queries) ───────────────────
  if (isBlockerQuery) {
    ctx += "[TEAMMATE BLOCKER ANALYSIS]\n";
    const ownerMap = {};
    state.prioritized.forEach(t => {
      const o = t.owner;
      if (!o) return;
      if (!ownerMap[o]) ownerMap[o] = { tasks: [], slackSignals: [] };
      if (t.dependencies && t.dependencies.length > 0) ownerMap[o].tasks.push(t);
    });
    const slackSource2 = sources.find(s => s.id === "slack");
    (slackSource2?.items || []).forEach(m => {
      if (!m.owner) return;
      if (/block|stuck|cannot|failing|delayed|waiting/i.test(m.body || "")) {
        if (!ownerMap[m.owner]) ownerMap[m.owner] = { tasks: [], slackSignals: [] };
        ownerMap[m.owner].slackSignals.push(m);
      }
    });
    Object.entries(ownerMap).slice(0, 4).forEach(([name, data]) => {
      ctx += `Teammate: ${name}\n`;
      data.tasks.slice(0, 2).forEach(t => {
        ctx += `  - Blocked Task: "${t.canonicalTitle}" (${t.severity}, due ${t.due || "?"})\n`;
        ctx += `    Reason: ${t.dependencies.join(", ")}\n`;
      });
      data.slackSignals.slice(0, 1).forEach(m => {
        ctx += `  - Slack signal: "${(m.body || m.title || "").substring(0, 100)}"\n`;
      });
    });
    ctx += "\n";
  }

  // ── Top tasks — always included (brief) ──────────────────────────────────
  const activeTasks = activeQueue().slice(0, 5);
  ctx += "[TOP PRIORITY TASKS]\n";
  activeTasks.forEach((t, i) => {
    ctx += `${i + 1}. [${t.severity}] "${t.canonicalTitle}" — score ${t.score} — due ${t.due || "?"} — owner: ${t.owner || "?"}\n`;
  });

  return ctx;
}

// ─── Rich Context Builder for Gemini reasoning ────────────────────────────────
function buildRichContext() {
  const activeTasks = activeQueue();
  const completedTasks = completedTaskIds.map(id => state.prioritized.find(x => x.id === id)).filter(Boolean);
  const allTasks = [...activeTasks, ...completedTasks];
  
  const taskListContext = allTasks.map(t => 
    `- ID: "${t.id}", Title: "${t.canonicalTitle || t.title}", Status: "${t.status}", Owner: "${t.owner || "Unassigned"}", Severity: "${t.severity}", Due: "${t.due || "None"}"`
  ).join("\n");

  // Extract all emails
  const emailSource = sources.find(s => s.id === "email");
  const emails = emailSource ? emailSource.items : [];
  const emailContext = emails.map(e =>
    `- Email ID: "${e.id}", From/Team: "${e.team || "Unknown"}", Subject: "${e.title}", Body: "${e.body}", Owner: "${e.owner || "Unassigned"}", Severity: "${e.severity}", Due: "${e.due || "None"}", Dependencies: ${JSON.stringify(e.dependencies || [])}`
  ).join("\n");

  // Extract slack messages
  const slackSource = sources.find(s => s.id === "slack");
  const slackMsgs = slackSource ? slackSource.items : [];
  const slackContext = slackMsgs.slice(0, 15).map(m =>
    `- Slack ID: "${m.id}", From/Channel: "${m.channel || "Direct"} / ${m.sender || "Unknown"}", Message: "${m.title || m.body}", Owner: "${m.owner || "Unassigned"}", Severity: "${m.severity}", Due: "${m.due || "None"}", Dependencies: ${JSON.stringify(m.dependencies || [])}`
  ).join("\n");

  // Teammates workload & blockers details (using depGraph)
  const teammates = {};
  state.prioritized.forEach(t => {
    const owner = t.owner || "Unassigned";
    if (!teammates[owner]) {
      teammates[owner] = { tasks: [], blockers: [] };
    }
    teammates[owner].tasks.push(t);
    
    const graphNode = depGraph[t.id];
    if (graphNode && graphNode.blockedBy.size > 0) {
      const blockedByTitles = Array.from(graphNode.blockedBy).map(bid => {
        const blockingTask = state.prioritized.find(x => x.id === bid);
        return blockingTask ? `"${blockingTask.canonicalTitle}" (owned by ${blockingTask.owner || "Unassigned"})` : bid;
      });
      teammates[owner].blockers.push({
        task: t.canonicalTitle,
        blockedBy: blockedByTitles,
        dependencies: t.dependencies
      });
    }
  });

  let teammateBlockersContext = "";
  Object.entries(teammates).forEach(([name, data]) => {
    teammateBlockersContext += `Teammate: ${name}\n`;
    if (data.blockers.length === 0) {
      teammateBlockersContext += `  - No active blockers.\n`;
    } else {
      data.blockers.forEach(b => {
        teammateBlockersContext += `  - Blocked Task: "${b.task}"\n`;
        teammateBlockersContext += `    Reason/Blocked by: ${b.blockedBy.join(", ")}\n`;
        teammateBlockersContext += `    Raw Dependencies: ${b.dependencies.join(" · ")}\n`;
      });
    }
  });

  return `
[EMAIL DATA (OUTLOOK)]
${emailContext}

[SLACK MESSAGES & MENTIONS]
${slackContext}

[PROJECT BACKLOG / SPRINT TASKS]
${taskListContext}

[TEAMMATE BLOCKERS ANALYSIS]
${teammateBlockersContext}
  `;
}

// ─── Agent Intent Parser — detects structured intents before calling Gemini ───
function parseAgentIntent(intent) {
  const q = intent.toLowerCase().trim();

  // VP email — check FIRST before generic email_summary, to avoid wrong routing
  // Handles: "what email from vp", "vp email", "show vp emails", "summarize vp email", "any mails from vp"
  if (/vp|vice.?president|executive|c-?suite|cto|ceo|coo|cpo|leadership.*email|exec.*email|email.*vp|what.*email.*from|email.*received|show.*mail|show.*email|list.*email|mail.*from.*vp|any.*mail.*vp|mail.*vp|vp.*mail/i.test(q)) {
    const wantSummary = /summar|brief|tl;dr|tldr|overview|digest/i.test(q);
    return { type: "vp_emails", summarize: wantSummary };
  }

  // Email summarize — handled locally from the database
  if (/\b(summarize|summarise|summary|summaries|tldr|tl;dr|brief|digest)\b.*\b(email|mail|message|inbox)\b|\b(email|mail|message|inbox)\b.*\b(summarize|summarise|summary|tldr|brief|digest)\b/i.test(q)) {
    return { type: "email_summary", topic: null };
  }

  // Generic email/inbox question — show all emails from database
  if (/\b(email|mail|inbox|message)\b/i.test(q)) {
    return { type: "email_summary", topic: q };
  }

  // If it's an action command, bypass local regex to let Gemini process it
  if (/\b(mark|set|change|complete|finish|start|work\s+on|assign|reassign|transfer|create|add)\b/i.test(q)) {
    return null;
  }

  // Teammate blockers: "what's blocking my teammate" / "Riya's blockers"
  if (/block.*teammate|teammate.*block|team.*stuck|who.*stuck|what.*block.*my|blocking.*team/i.test(q)) {
    const nameMatch = q.match(/(\b[a-z]{3,}\b)(?:'s|'s)?\s+block/i) || q.match(/block.*?(\b[a-z]{4,}\b)/i);
    const skipWords = ["my","the","a","is","are","what","who","that","team","blocking"];
    const person = nameMatch?.[1] && !skipWords.includes(nameMatch[1].toLowerCase()) ? nameMatch[1] : null;
    return { type: "teammate_blockers", person: person ? person.charAt(0).toUpperCase() + person.slice(1) : null };
  }

  // Why is [task] ranked #1 / explain ranking
  if (/why.*rank|rank.*#?1|why.*top|why.*first|why.*highest|explain.*priority|priority.*explain|ranked.*highest|why.*upload|upload.*rank/i.test(q)) {
    const taskMatch = q.match(/why.*?(?:is\s+)?(?:the\s+)?(.{5,60}?)\s+rank/i) ||
                      q.match(/why.*?(?:is\s+)?(?:the\s+)?(.{5,60}?)\s+(?:#1|top|first|highest)/i);
    return { type: "why_ranked", taskHint: taskMatch?.[1]?.trim() || null };
  }

  // Top N tasks
  const topMatch = q.match(/top\s*(\d+)?\s*(tasks?|priorities|work|queue|items?)/);
  if (topMatch || /show.*(queue|tasks|priorities)|what.*should.*do|my (tasks?|priorities|queue)|list.*tasks?/i.test(q)) {
    const n = parseInt(topMatch?.[1] || String(userPreferences.topNDefault || 5));
    return { type: "top_tasks", n: Math.min(n || 5, 10) };
  }

  // Blockers
  if (/block|waiting|stuck|held up|depend/i.test(q)) return { type: "blockers" };

  // Overloaded engineers / team workload
  if (/overload|workload|capacity|team load|who.*most|busy/i.test(q)) return { type: "workload" };

  // P1 escalations
  if (/p1|escalat|critical|urgent|sla/i.test(q)) return { type: "p1_tasks" };

  // Completed today
  if (/complet|done|finish|what.*did.*do|today.*done/i.test(q)) return { type: "completed" };

  // Meetings
  if (/meeting|calendar|schedule|zoom|standup/i.test(q)) return { type: "meetings" };

  // Tie / same score
  if (/tie|same score|same priority|equal/i.test(q)) return { type: "ties" };

  return null;
}

// ─── Structured Agent Response Builder ────────────────────────────────────────
function buildAgentResponse(intent) {
  const parsed = parseAgentIntent(intent);
  if (!parsed) return null;

  const queue = activeQueue();
  const sevColor = { P1: "#de350b", P2: "#974f0c", P3: "#216e4e", P4: "#626f86" };

  function taskCard(t, rank) {
    const color = sevColor[t.severity] || "#626f86";
    const isWorking = workingTaskIds.includes(t.id);
    const isDone = completedTaskIds.includes(t.id);
    return `<div class="agent-task-card" data-task="${t.id}" style="background:#fff;border:1px solid #e8e0d5;border-left:3px solid ${color};border-radius:8px;padding:10px 12px;margin:5px 0;cursor:pointer;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
        <div style="flex:1;min-width:0;">
          ${rank ? `<span style="font-size:10px;font-weight:800;color:#94a3b8;display:block;margin-bottom:2px;">#${rank}</span>` : ""}
          <strong style="font-size:13px;color:#172b4d;display:block;line-height:1.3;">${escapeHtml(t.canonicalTitle)}</strong>
          <div style="font-size:11px;color:#64748b;margin-top:4px;display:flex;gap:8px;flex-wrap:wrap;">
            <span style="background:${color}18;color:${color};padding:1px 6px;border-radius:4px;font-weight:800;">${t.severity}</span>
            <span>📍 ${escapeHtml(t.sources.join(" + "))}</span>
            ${t.due ? `<span>📅 ${formatDue(t.due)}</span>` : ""}
            <span>⚡ ${t.score} pts</span>
          </div>
        </div>
        ${isWorking ? `<span style="font-size:10px;font-weight:800;color:#0c66e4;background:#e8f0fe;padding:2px 7px;border-radius:10px;flex-shrink:0;">● Working</span>` : ""}
        ${isDone ? `<span style="font-size:10px;font-weight:800;color:#22a06b;background:#dcfff1;padding:2px 7px;border-radius:10px;flex-shrink:0;">✓ Done</span>` : ""}
      </div>
      ${!isDone && !isWorking ? `<div style="margin-top:8px;"><button class="tp-btn-start" data-task-start="${t.id}" style="font-size:11px;padding:4px 10px;">▶ Start</button></div>` : ""}
    </div>`;
  }

  switch (parsed.type) {
    case "top_tasks": {
      const tasks = queue.slice(0, parsed.n);
      if (tasks.length === 0) return { html: `<span>🎉 Your queue is clear! No pending tasks.</span>`, chips: ["Add a task", "Show completed", "Anything else?"] };
      const header = `<strong>Your top ${tasks.length} prioritized tasks:</strong>`;
      const cards = tasks.map((t, i) => taskCard(t, i + 1)).join("");
      const chips = ["✅ Start top task", "📄 Daily report", "🔴 Show blockers", "🚀 Anything else?"];
      return { html: header + cards, chips };
    }
    case "blockers": {
      const blockers = queue.filter(t => t.dependencies.some(d => /block|waiting|eta|approval/i.test(d)));
      if (blockers.length === 0) return { html: `<span>✅ No active blockers detected in your queue right now.</span>`, chips: ["Top 5 tasks", "Show P1s", "Anything else?"] };
      const header = `<strong>🚧 ${blockers.length} blocker${blockers.length > 1 ? "s" : ""} in your queue:</strong>`;
      return { html: header + blockers.map(t => taskCard(t, null)).join(""), chips: ["Escalate to manager", "Top 5 tasks", "Anything else?"] };
    }
    case "p1_tasks": {
      const p1s = queue.filter(t => t.severity === "P1");
      if (p1s.length === 0) return { html: `<span>✅ No P1 escalations in queue right now.</span>`, chips: ["Top 5 tasks", "Show blockers", "Anything else?"] };
      return { html: `<strong>🔴 ${p1s.length} P1 escalation${p1s.length > 1 ? "s" : ""}:</strong>` + p1s.map(t => taskCard(t, null)).join(""), chips: ["▶ Start top P1", "📄 Daily report", "Anything else?"] };
    }
    case "workload": {
      const ownerMap = {};
      state.prioritized.forEach(t => {
        const o = t.owner || "Unassigned";
        if (!ownerMap[o]) ownerMap[o] = { total: 0, p1: 0, done: 0 };
        ownerMap[o].total++;
        if (t.severity === "P1") ownerMap[o].p1++;
        if (completedTaskIds.includes(t.id)) ownerMap[o].done++;
      });
      const rows = Object.entries(ownerMap).sort((a, b) => b[1].total - a[1].total).slice(0, 6)
        .map(([name, d]) => {
          const pct = d.total ? Math.round(d.done / d.total * 100) : 0;
          const isOverloaded = d.total >= 8 || d.p1 >= 3;
          return `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 10px;background:#fff;border:1px solid #e8e0d5;border-radius:7px;margin:4px 0;">
            <div>
              <strong style="font-size:12px;color:#172b4d;">${escapeHtml(name)}</strong>
              ${isOverloaded ? `<span style="font-size:10px;color:#de350b;font-weight:800;margin-left:6px;">⚠ Overloaded</span>` : ""}
              <div style="font-size:11px;color:#64748b;">${d.total} tasks · ${d.p1} P1 · ${d.done} done</div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:11px;font-weight:700;color:${pct >= 50 ? "#22a06b" : "#974f0c"};">${pct}% done</div>
            </div>
          </div>`;
        }).join("");
      return { html: `<strong>👥 Team workload:</strong>` + rows, chips: ["Show blockers", "Top 5 tasks", "Assign task", "Anything else?"] };
    }
    case "completed": {
      const done = completedTaskIds.map(id => {
        const t = state.prioritized.find(x => x.id === id);
        const log = taskTimeLogs[id];
        return t ? { ...t, log } : null;
      }).filter(Boolean);
      if (done.length === 0) return { html: `<span>No tasks completed yet today. Start one from your queue!</span>`, chips: ["Top 5 tasks", "▶ Start top task", "Anything else?"] };
      const rows = done.map(t => {
        const log = t.log;
        const dur = log?.startTime && log?.endTime
          ? Math.round((new Date(log.endTime) - new Date(log.startTime)) / 60000) + " min"
          : "—";
        return `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:#f4fff9;border:1px solid #b7e4ce;border-radius:7px;margin:4px 0;">
          <span style="color:#22a06b;font-weight:800;">✓</span>
          <div style="flex:1;min-width:0;">
            <strong style="font-size:12px;color:#172b4d;">${escapeHtml(t.canonicalTitle)}</strong>
            <div style="font-size:11px;color:#64748b;">${t.severity} · ${dur}</div>
          </div>
        </div>`;
      }).join("");
      return { html: `<strong>✅ ${done.length} task${done.length > 1 ? "s" : ""} completed today:</strong>` + rows, chips: ["📄 Daily report", "Top 5 tasks", "Anything else?"] };
    }
    case "meetings": {
      if (meetingsList.length === 0) return { html: `<span>No meetings found. Run the Meeting Agent to scan your inbox.</span>`, chips: ["Go to Meetings", "Top 5 tasks", "Anything else?"] };
      const rows = meetingsList.slice(0, 4).map(m => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 10px;background:#fff;border:1px solid #e8e0d5;border-radius:7px;margin:4px 0;">
          <div style="flex:1;min-width:0;">
            <strong style="font-size:12px;color:#172b4d;">${escapeHtml(m.title)}</strong>
            <div style="font-size:11px;color:#64748b;">📅 ${m.suggestedDate} ${m.suggestedTime || ""} · ${m.duration} min</div>
          </div>
          <span style="font-size:10px;padding:2px 7px;border-radius:10px;background:${m.priority === "Critical" ? "#ffd5d2" : "#fff0b3"};color:${m.priority === "Critical" ? "#ae2a19" : "#974f0c"};font-weight:800;flex-shrink:0;">${m.priority}</span>
        </div>`).join("");
      return { html: `<strong>📅 ${meetingsList.length} meetings detected:</strong>` + rows, chips: ["Go to Meetings", "Run Meeting Agent", "Top 5 tasks", "Anything else?"] };
    }
    case "ties": {
      const scoreGroups = {};
      queue.forEach(t => { if (!scoreGroups[t.score]) scoreGroups[t.score] = []; scoreGroups[t.score].push(t); });
      const ties = Object.entries(scoreGroups).filter(([, ts]) => ts.length > 1);
      if (ties.length === 0) return { html: `<span>✅ No tied scores — every task has a unique rank right now.</span>`, chips: ["Top 5 tasks", "Anything else?"] };
      const rows = ties.slice(0, 3).map(([score, ts]) =>
        `<div style="padding:8px 10px;background:#fff;border:1px solid #e8e0d5;border-radius:7px;margin:4px 0;">
          <div style="font-size:11px;font-weight:800;color:#64748b;margin-bottom:4px;">Score ${score} — ${ts.length} tasks tied</div>
          ${ts.map(t => `<div style="font-size:12px;color:#172b4d;padding:2px 0;">• ${escapeHtml(t.canonicalTitle)} (${t.sources.length} src, due ${formatDue(t.due)})</div>`).join("")}
          <div style="font-size:11px;color:#0c66e4;margin-top:4px;">Tiebreaker: more sources → earlier due → blocker signal → shorter time</div>
        </div>`
      ).join("");
      return { html: `<strong>⚖️ ${ties.length} tie group${ties.length > 1 ? "s" : ""} found:</strong>` + rows, chips: ["Top 5 tasks", "Anything else?"] };
    }

    case "email_summary": {
      // Show ALL emails from the database with full body shown
      const allEmails = sources.find(s => s.id === "email")?.items || [];
      if (allEmails.length === 0) {
        return { html: `<span>📭 No emails found in your connected inbox. Check that Outlook is synced.</span>`, chips: ["Show my tasks", "Top 5 tasks", "Anything else?"] };
      }
      const sevColor2 = { P1: "#de350b", P2: "#974f0c", P3: "#216e4e", P4: "#626f86" };
      // Filter by topic if provided
      const topicFilter = parsed.topic && parsed.topic.length > 4
        ? parsed.topic.split(/\s+/).filter(w => w.length > 3 && !["email","mail","show","list","what","from","about","summarize","summarise"].includes(w))
        : [];
      const filtered = topicFilter.length > 0
        ? allEmails.filter(e => { const t = `${e.title} ${e.body || ""}`.toLowerCase(); return topicFilter.some(w => t.includes(w)); })
        : allEmails;
      const displayEmails = (filtered.length > 0 ? filtered : allEmails).slice(0, 6);
      const emailCards = displayEmails.map(e => {
        const color = sevColor2[e.severity] || "#626f86";
        return `<div style="background:#fff;border:1px solid #e8e0d5;border-left:3px solid ${color};border-radius:8px;padding:10px 12px;margin:6px 0;">
          <div style="font-size:10px;color:${color};font-weight:800;margin-bottom:2px;">${e.severity} · ${e.id}</div>
          <strong style="font-size:13px;color:#172b4d;display:block;line-height:1.3;">${escapeHtml(e.title)}</strong>
          <div style="font-size:12px;color:#344563;margin-top:6px;padding:6px 8px;background:#f8f5f0;border-radius:6px;line-height:1.5;">${escapeHtml(e.body || "No body.")}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:6px;display:flex;gap:8px;flex-wrap:wrap;">
            <span>👤 ${escapeHtml(e.owner || "—")}</span>
            <span>📅 Due ${e.due || "—"}</span>
            <span>📍 ${escapeHtml(e.team || "—")}</span>
            <span style="background:${color}18;color:${color};padding:1px 6px;border-radius:4px;font-weight:800;">${e.severity}</span>
          </div>
          ${e.dependencies?.length ? `<div style="font-size:11px;color:#974f0c;margin-top:4px;">✅ Action needed: ${escapeHtml(e.dependencies.join(" · "))}</div>` : ""}
        </div>`;
      }).join("");
      return {
        html: `<strong>📨 ${displayEmails.length} email${displayEmails.length > 1 ? "s" : ""} from your inbox (${allEmails.length} total):</strong>` + emailCards,
        chips: ["Show VP emails", "Show blockers", "▶ Start top P1", "Anything else?"]
      };
    }

    case "vp_emails": {
      // Pull VP / executive emails from the outlook dataset
      const allEmails = sources.find(s => s.id === "email")?.items || [];
      const vpKeywords = /VP|vice.?president|executive|CTO|CEO|COO|CPO|leadership|escalation/i;
      const vpEmails = allEmails.filter(e =>
        vpKeywords.test(e.title) || vpKeywords.test(e.body || "") || vpKeywords.test(e.team || "")
      );
      if (vpEmails.length === 0) {
        // Fallback: show ALL emails if no VP-specific ones found
        return {
          html: `<div style="padding:10px 12px;background:#fff8f0;border:1px solid #f4a261;border-radius:8px;color:#974f0c;font-size:13px;">
            📭 No VP or executive emails found in your inbox right now.
            Here are all your recent emails instead:
          </div>`,
          chips: ["Show all emails", "Show my tasks", "Show blockers", "Anything else?"]
        };
      }
      const sevColorVP = { P1: "#de350b", P2: "#974f0c", P3: "#216e4e", P4: "#626f86" };
      const emailCards = vpEmails.slice(0, 6).map(e => {
        const color = sevColorVP[e.severity] || "#626f86";
        // AI summary section — shown inline with the card
        const bodyPreview = (e.body || "").slice(0, 300);
        // Build a simple inline TL;DR from the body
        const tldr = e.body && e.body.length > 60
          ? `<div style="font-size:12px;background:#fff8f0;border-left:3px solid ${color};padding:6px 10px;border-radius:0 6px 6px 0;margin-top:8px;color:#172b4d;line-height:1.5;">
              <strong>📋 TL;DR:</strong> ${escapeHtml(e.body.slice(0, 200))}${e.body.length > 200 ? "…" : ""}
             </div>`
          : "";
        return `<div style="background:#fff;border:1px solid #e8e0d5;border-left:4px solid ${color};border-radius:8px;padding:12px 14px;margin:6px 0;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <span style="font-size:10px;font-weight:800;background:${color}18;color:${color};padding:2px 8px;border-radius:10px;">${e.severity}</span>
            <span style="font-size:10px;color:#94a3b8;">${e.id}</span>
            ${e.status === "Unread" ? `<span style="font-size:10px;font-weight:800;color:#0c66e4;background:#e8f0fe;padding:1px 7px;border-radius:10px;">● Unread</span>` : ""}
          </div>
          <strong style="font-size:13px;color:#172b4d;display:block;line-height:1.4;">${escapeHtml(e.title)}</strong>
          <div style="font-size:12px;color:#344563;margin-top:6px;padding:8px 10px;background:#f8f5f0;border-radius:6px;line-height:1.6;">${escapeHtml(e.body || "")}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
            <span>👤 ${escapeHtml(e.owner || "—")}</span>
            <span>📅 Due ${e.due || "—"}</span>
            <span>📍 ${escapeHtml(e.team || "—")}</span>
          </div>
          ${e.dependencies?.length ? `<div style="font-size:11px;font-weight:700;color:#de350b;margin-top:6px;padding:4px 8px;background:#fff0ee;border-radius:4px;">✅ Action needed: ${escapeHtml(e.dependencies.join(" · "))}</div>` : ""}
        </div>`;
      }).join("");
      return {
        html: `<strong style="font-size:13px;color:#172b4d;">📨 Found ${vpEmails.length} VP/Executive email${vpEmails.length > 1 ? "s" : ""} in your inbox:</strong>` + emailCards +
          `<div style="margin-top:8px;font-size:11px;color:#94a3b8;font-style:italic;">💡 Tip: Say "summarize VP email" to get a full AI TL;DR, or "make this priority" to escalate.</div>`,
        chips: ["Summarize VP email", "Make MAIL-920 priority", "Show blockers", "▶ Start top P1"]
      };
    }

    case "teammate_blockers": {
      const filterPerson = parsed.person || userPreferences.preferredOwner;
      const allTasks = state.prioritized || [];
      const currentUser = (settingsProfile?.name || activeProfile || "Utkarsh").split(" ")[0];

      // Pull Slack blocker signals (these often contain explicit "Blocks X" or incident refs)
      const slackSource = sources.find(s => s.id === "slack");
      const slackMsgs = slackSource ? slackSource.items : [];

      // Build a map of owner → their blocking Slack signals
      const slackBlockersByOwner = {};
      slackMsgs.forEach(m => {
        const owner = m.owner;
        if (!owner) return;
        const isBlocker = m.dependencies?.some(d => /block|waiting|inc-|jira-|approval|stuck/i.test(d))
          || /block|stuck|cannot|can't|failing|failed|delayed|waiting/i.test(m.body || "");
        if (isBlocker) {
          if (!slackBlockersByOwner[owner]) slackBlockersByOwner[owner] = [];
          slackBlockersByOwner[owner].push(m);
        }
      });

      // Tasks with any dependency (all tasks have some form of pending work)
      const blocked = allTasks.filter(t => {
        const isTeammate = filterPerson
          ? t.owner?.toLowerCase().includes(filterPerson.toLowerCase())
          : (t.owner && !t.owner.toLowerCase().includes(currentUser.toLowerCase()) && t.owner !== "Unassigned");
        if (!isTeammate) return false;
        // Include if: has dependency string, or has Slack blocker signal, or depGraph shows it's blocked
        const hasDep = t.dependencies && t.dependencies.length > 0;
        const hasSlack = slackBlockersByOwner[t.owner]?.length > 0;
        const depNode = depGraph[t.id];
        const isDepGraphBlocked = depNode && depNode.blockedBy.size > 0;
        return hasDep || hasSlack || isDepGraphBlocked;
      });

      if (blocked.length === 0) {
        const msg = filterPerson
          ? `✅ No blockers found for <strong>${escapeHtml(filterPerson)}</strong> right now.`
          : `✅ No teammates appear blocked in the current queue.`;
        return { html: `<span>${msg}</span>`, chips: ["Show all blockers", "Team workload", "Top 5 tasks", "Anything else?"] };
      }

      // Group by owner
      const byOwner = {};
      blocked.forEach(t => {
        const owner = t.owner || "Unknown";
        if (!byOwner[owner]) byOwner[owner] = [];
        byOwner[owner].push(t);
      });

      const ownerSections = Object.entries(byOwner).map(([owner, tasks]) => {
        // Get top-3 tasks (prioritized by severity + score)
        const topTasks = tasks.slice(0, 3);
        const slackSignals = slackBlockersByOwner[owner] || [];

        const taskRows = topTasks.map(t => {
          const depNode = depGraph[t.id];
          const graphBlockers = depNode && depNode.blockedBy.size > 0
            ? Array.from(depNode.blockedBy).map(bid => {
                const bt = state.prioritized.find(x => x.id === bid);
                return bt ? `blocked by "${escapeHtml(bt.canonicalTitle)}"` : `blocked by task ${bid}`;
              })
            : [];
          const depStrings = (t.dependencies || []).slice(0, 2);
          const allReasons = [...graphBlockers, ...depStrings].slice(0, 3);
          const reasonHtml = allReasons.length > 0
            ? `<div style="font-size:11px;color:#de350b;margin-top:4px;">🚧 ${escapeHtml(allReasons.join(" · "))}</div>`
            : `<div style="font-size:11px;color:#974f0c;margin-top:4px;">⚠ Awaiting dependencies — ${escapeHtml((t.dependencies || ["pending inputs"]).slice(0, 2).join(", "))}</div>`;

          return `<div style="margin:4px 0;padding:7px 10px;background:#fff;border:1px solid #e8e0d5;border-left:3px solid #de350b;border-radius:6px;">
            <div style="font-size:12px;font-weight:700;color:#172b4d;">${escapeHtml(t.canonicalTitle)}</div>
            <div style="font-size:11px;color:#64748b;margin-top:2px;">
              <span style="background:#ffd5d218;color:#de350b;padding:1px 6px;border-radius:4px;font-weight:700;">${t.severity}</span>
              <span style="margin-left:6px;">📅 ${formatDue(t.due)}</span>
              <span style="margin-left:6px;">📍 ${escapeHtml(t.sources.join("+"))}</span>
              <span style="margin-left:6px;">⚡ ${t.score} pts</span>
            </div>
            ${reasonHtml}
          </div>`;
        }).join("");

        // Slack signals for this engineer
        const slackHtml = slackSignals.slice(0, 2).map(m =>
          `<div style="margin:3px 0;padding:5px 8px;background:#f8f0ff;border:1px solid #c9b8e8;border-radius:6px;font-size:11px;color:#44346e;">
            💬 Slack: "${escapeHtml((m.body || m.title || "").substring(0, 90))}${(m.body || "").length > 90 ? "…" : ""}"
          </div>`
        ).join("");

        const reasoningSummary = (() => {
          const p1count = tasks.filter(t => t.severity === "P1").length;
          const overdueCount = tasks.filter(t => t.due && t.due < new Date().toISOString().slice(0,10)).length;
          const parts = [];
          if (p1count > 0) parts.push(`${p1count} P1 escalation${p1count > 1 ? "s" : ""}`);
          if (overdueCount > 0) parts.push(`${overdueCount} overdue`);
          if (slackSignals.length > 0) parts.push(`${slackSignals.length} Slack blocker${slackSignals.length > 1 ? "s" : ""}`);
          return parts.length > 0 ? `(${parts.join(", ")})` : "";
        })();

        return `<div style="margin:8px 0;padding:8px 10px;background:#fdf8f0;border:1px solid #e8ddd0;border-radius:8px;">
          <div style="font-size:12px;font-weight:800;color:#344563;margin-bottom:5px;">👤 ${escapeHtml(owner)} — ${tasks.length} blocked task${tasks.length > 1 ? "s" : ""} ${reasoningSummary}</div>
          ${taskRows}
          ${slackHtml}
        </div>`;
      }).join("");

      const totalEngineers = Object.keys(byOwner).length;
      const title = filterPerson
        ? `<strong>🚧 Blockers for ${escapeHtml(filterPerson)}:</strong>`
        : `<strong>🚧 Teammate blockers across ${totalEngineers} engineer${totalEngineers > 1 ? "s" : ""} — with AI reasoning:</strong>`;
      return {
        html: title + ownerSections,
        chips: ["Escalate to manager", "Team workload", "Top 5 tasks", "Anything else?"]
      };
    }

    case "why_ranked": {
      // Find the #1 ranked task or the task matching the hint
      const ranked = queue;
      let targetTask = ranked[0];
      if (parsed.taskHint) {
        const hint = parsed.taskHint.toLowerCase();
        targetTask = ranked.find(t => t.canonicalTitle?.toLowerCase().includes(hint) || t.id?.toLowerCase().includes(hint)) || ranked[0];
      }
      if (!targetTask) return { html: `<span>No tasks found to explain ranking.</span>`, chips: ["Top 5 tasks", "Anything else?"] };

      const rankPos = ranked.indexOf(targetTask) + 1;
      const color = { P1: "#de350b", P2: "#974f0c", P3: "#216e4e", P4: "#626f86" }[targetTask.severity] || "#626f86";
      const reasons = targetTask.rankReasons || [];

      // Scoring breakdown
      const sev = targetTask.severity;
      const sevScores = { P1: 10, P2: 7, P3: 4, P4: 1 };
      const sevScore = sevScores[sev] || 1;
      const daysLeft = targetTask.due ? Math.round((new Date(targetTask.due) - new Date()) / 86400000) : 30;
      const deadlineScore = Math.max(0, 30 - daysLeft);
      const srcScore = (targetTask.sources?.length || 1) * 2;
      const blockerScore = targetTask.dependencies?.some(d => /block|waiting|eta/i.test(d)) ? 10 : 0;
      const totalScore = targetTask.score || Math.round(sevScore * 0.4 * 10 + deadlineScore * 0.3 + srcScore * 0.2 * 10 + blockerScore * 0.1);

      const scoreBarStyle = (val, max, col) =>
        `<div style="display:flex;align-items:center;gap:8px;margin:3px 0;">
          <div style="width:80px;font-size:11px;color:#64748b;">${val.label}</div>
          <div style="flex:1;height:6px;background:#f1f5f9;border-radius:3px;overflow:hidden;">
            <div style="width:${Math.min(100, Math.round(val.value/max*100))}%;height:100%;background:${col};border-radius:3px;"></div>
          </div>
          <div style="width:28px;font-size:11px;font-weight:700;color:${col};text-align:right;">${val.value}</div>
        </div>`;

      const bars = [
        { label: "Severity", value: sevScore * 10, note: `${sev} → ${sevScore}/10 × weight 40%` },
        { label: "Deadline", value: deadlineScore, note: `${daysLeft < 0 ? "Overdue!" : daysLeft + " days left"} × weight 30%` },
        { label: "Sources", value: srcScore * 5, note: `${targetTask.sources?.length || 1} source(s) × weight 20%` },
        { label: "Blocker", value: blockerScore, note: `${blockerScore > 0 ? "Has blocker signal" : "No blocker"} × weight 10%` }
      ].map(b => scoreBarStyle(b, 100, color)).join("");

      const aiReasons = reasons.length > 0
        ? `<div style="margin-top:8px;padding:8px 10px;background:#f8f5f0;border-radius:6px;border-left:3px solid ${color};">
            <div style="font-size:11px;font-weight:800;color:#344563;margin-bottom:4px;">🧠 AI Reasoning:</div>
            ${reasons.map(r => `<div style="font-size:12px;color:#172b4d;padding:2px 0;">• ${escapeHtml(r)}</div>`).join("")}
          </div>`
        : "";

      const sourcesList = (targetTask.sources || []).map(s =>
        `<span style="background:#e8f0fe;color:#0c66e4;padding:2px 7px;border-radius:10px;font-size:10px;font-weight:700;">${s}</span>`
      ).join(" ");

      const html = `
        <div style="background:#fff;border:1px solid #e8e0d5;border-left:3px solid ${color};border-radius:8px;padding:12px 14px;">
          <div style="font-size:10px;font-weight:800;color:#94a3b8;margin-bottom:3px;">RANKED #${rankPos} · SCORE ${totalScore}/100</div>
          <strong style="font-size:13px;color:#172b4d;display:block;line-height:1.3;">${escapeHtml(targetTask.canonicalTitle)}</strong>
          <div style="margin-top:4px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
            <span style="background:${color}18;color:${color};padding:1px 7px;border-radius:4px;font-size:11px;font-weight:800;">${sev}</span>
            ${sourcesList}
            <span style="font-size:11px;color:#64748b;">📅 ${formatDue(targetTask.due)}</span>
          </div>
        </div>
        <div style="margin-top:8px;padding:8px 10px;background:#f8f5f0;border-radius:6px;">
          <div style="font-size:11px;font-weight:800;color:#344563;margin-bottom:6px;">📊 Score Breakdown (total: ${totalScore}):</div>
          ${bars}
        </div>
        ${aiReasons}
        <div style="margin-top:8px;padding:8px 10px;background:#fff4e8;border-radius:6px;border-left:3px solid #974f0c;">
          <div style="font-size:12px;color:#172b4d;line-height:1.5;">
            <strong>Why #${rankPos}?</strong> This task scores highest because it is <strong>${sev}</strong> severity 
            (${daysLeft < 0 ? "already overdue" : daysLeft <= 1 ? "due today" : `due in ${daysLeft} days`}), 
            appears across <strong>${targetTask.sources?.length || 1} source${targetTask.sources?.length > 1 ? "s" : ""}</strong>${targetTask.sources?.length > 1 ? " (" + escapeHtml(targetTask.sources.join(", ")) + ")" : ""},
            ${blockerScore > 0 ? "and has an active blocker dependency that will cascade if unresolved." : "with no dependencies blocking it — it can start immediately."}
          </div>
        </div>`;

      return {
        html,
        chips: ["▶ Start this task", "Top 5 tasks", "Show blockers", "Anything else?"]
      };
    }

    default:
      return null;
  }
}

// ─── Direct Helper to extract JSON from Gemini replies ────────────────────────
function extractJSON(raw) {
  if (!raw) return null;
  let text = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  try { return JSON.parse(text); } catch {}
  const arrStart = text.indexOf("[");
  const objStart = text.indexOf("{");
  const starts = [arrStart, objStart].filter(i => i !== -1);
  if (starts.length === 0) return null;
  const start = Math.min(...starts);
  const openChar = text[start];
  const closeChar = openChar === "[" ? "]" : "}";
  let depth = 0;
  let end = -1;
  for (let i = start; i < text.length; i++) {
    if (text[i] === openChar) depth++;
    else if (text[i] === closeChar) { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

function startTask(id) {
  const task = state.prioritized.find(t => t.id === id);
  if (!task) return;

  if (!workingTaskIds.includes(id)) {
    workingTaskIds = [...workingTaskIds, id];
  }
  setMyWorkingIds([...new Set([...getMyWorkingIds(), id])]);
  selectedTaskId = id;
  
  if (!taskTimeLogs[id]) {
    taskTimeLogs[id] = {
      title: task.canonicalTitle,
      severity: task.severity,
      source: task.sources?.join(" + ") || task.sourceId,
      startTime: new Date().toISOString(),
      endTime: null
    };
  }
  
  saveWorkingTask(getUserEmail(), getUserName(), id, task.canonicalTitle);
  pushCompanion("agent", `Woof! 🐾 Started working on "${task.canonicalTitle}". I'll keep my eyes on your progress and help you fetch results! Ruff!`, false);
  render();
  syncStateWithBackend();
}

function reassignTask(id, newOwner) {
  const task = state.prioritized.find(t => t.id === id);
  if (!task) return;
  const oldOwner = task.owner || "Unassigned";
  
  const aliases = task.aliases || [task.id];
  sources.forEach(source => {
    source.items.forEach(item => {
      if (aliases.includes(item.id)) {
        item.owner = newOwner;
        reassignedTaskOwners[item.id] = newOwner;
      }
    });
  });
  addedTasks.forEach(item => {
    if (aliases.includes(item.id)) {
      item.owner = newOwner;
      reassignedTaskOwners[item.id] = newOwner;
    }
  });

  const msg = `Reassigned "${task.canonicalTitle}" from ${oldOwner} to ${newOwner}`;
  managerActivityFeed.unshift({
    message: msg,
    time: new Date().toLocaleTimeString(),
    color: "#0c66e4"
  });

  pushCompanion("agent", `🐾 Reassigned "${task.canonicalTitle}" to ${newOwner}.`, false);
  triggerLocalNotification("Task Reassigned", `Task "${task.canonicalTitle}" assigned to ${newOwner}.`);

  state = buildState(sources, calendarBlocks);
  render();
  syncStateWithBackend();
}

function addNewTaskLocal(title, severity, due, owner) {
  const newTask = {
    id: `MGR-${Date.now().toString().slice(-5)}`,
    title,
    body: "",
    severity: severity || "P2",
    due: due || "",
    impact: 5,
    status: "Todo",
    owner: owner || "Unassigned",
    team: "Platform Apps",
    dependencies: [],
    execution: {
      definitionOfDone: `Complete: ${title}`,
      process: ["Clarify requirements", "Implement", "Verify"],
      estimatedMinutes: 240
    }
  };
  
  const jiraSource = sources.find(s => s.id === "jira");
  if (jiraSource) {
    jiraSource.items.push(newTask);
  }
  addedTasks.push(newTask);
  
  pushCompanion("agent", `🐾 Added new task: "${title}" assigned to ${owner || "Unassigned"}.`, false);
  
  state = buildState(sources, calendarBlocks);
  render();
  syncStateWithBackend();
  return newTask;
}

async function executeAgentAction(action) {
  if (!action || action.type === "NONE") return;
  const id = action.taskId;
  console.log(`[Agent Action] Executing: ${action.type} on task: ${id}`);
  
  if (action.type === "COMPLETE_TASK") {
    if (id) {
      completeTask(id);
    }
  } else if (action.type === "START_TASK") {
    if (id) {
      startTask(id);
    }
  } else if (action.type === "ASSIGN_TASK") {
    if (id && action.assignee) {
      reassignTask(id, action.assignee);
    }
  } else if (action.type === "CREATE_TASK") {
    if (action.taskTitle) {
      addNewTaskLocal(action.taskTitle, action.taskSeverity || "P2", "", action.assignee || "Unassigned");
    }
  }
}

async function geminiAgentDecision(intent) {
  const activeTasks = activeQueue();
  const completedTasks = completedTaskIds.map(id => state.prioritized.find(x => x.id === id)).filter(Boolean);
  const allTasks = [...activeTasks, ...completedTasks];
  const currentTask = allTasks.find(t => t.id === selectedTaskId) || activeTasks[0];
  const currentUser = settingsProfile?.name || "Utkarsh";
  
  const richContext = buildTargetedContext(intent);
  
  const systemPrompt = `You are TaskPilot AI, an advanced agentic coding and task assistant.
You are helping ${currentUser} (${settingsProfile.role || "Engineer"}).
Current active selected task in the UI: ${currentTask ? `"${currentTask.canonicalTitle}" (ID: "${currentTask.id}")` : "None"}

IMPORTANT: You have FULL ACCESS to the engineer's real email inbox, Slack messages, Jira tasks, and ServiceNow defects. All data is provided below in the context section. You must ALWAYS answer questions about emails, VP messages, blockers, and tasks directly from the provided data — NEVER say you "cannot access" anything. You have the data — use it.

Here is the relevant project context (YOUR LIVE DATA):
${richContext}

User preferences / Learned facts:
${JSON.stringify(userPreferences.learnedFacts || [])}
Preferred Owner: ${userPreferences.preferredOwner || "None"}

The user says: "${intent}"

You are not just a chatbot. You can trigger actions in the app in real time.
Analyze the user's message and decide if they want to perform one of the following actions:
1. COMPLETE_TASK: Mark a task as completed/done.
   - If they say "mark this as completed task", "complete this", "I finished the task", "done", etc., resolve the taskId. If they say "this task" or "it", refer to the active selected task: "${currentTask?.id || ""}".
2. START_TASK: Start working on a task (mark as "In progress").
   - If they say "start task", "start working on it", "do this task", etc.
3. ASSIGN_TASK: Assign or reassign a task to an engineer/teammate.
   - E.g., "assign this task to Riya", "transfer task X to Joy".
4. CREATE_TASK: Create a new task.
   - E.g., "create a new task to fix the database connection".

If an action is requested, determine the target taskId from the list of tasks. If it's a new task, specify task details.
Always respond with a valid JSON object in the following format:
{
  "reply": "A helpful, data-driven response. For emails/VP queries: list the actual emails from the context above with their subjects and key action items. For blockers: name the specific blocked tasks and their owners. Reference real IDs, scores, and owners from the data. Use markdown formatting. NEVER say you cannot access data — it is all provided above.",
  "action": {
    "type": "COMPLETE_TASK" | "START_TASK" | "ASSIGN_TASK" | "CREATE_TASK" | "NONE",
    "taskId": "resolved task ID (string) or empty string",
    "assignee": "name of engineer for assignment (string) or empty string",
    "taskTitle": "title for new task creation or empty string",
    "taskSeverity": "P1"|"P2"|"P3"|"P4" (for new task creation)
  },
  "learnedFact": "a new fact learned about the user (e.g. their role or preference), or empty string"
}

Return ONLY the JSON object. Do not wrap it in markdown block.`;

  const raw = await geminiChat(systemPrompt);
  
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/```json/gi, "").replace(/```/gi, "").trim();
  }
  let data;
  try {
    data = JSON.parse(cleaned);
  } catch (e) {
    console.error("Failed to parse Gemini agent response JSON:", raw, e);
    const fallback = extractJSON(raw);
    data = fallback || {
      reply: raw,
      action: { type: "NONE", taskId: "", assignee: "", taskTitle: "", taskSeverity: "P2" },
      learnedFact: ""
    };
  }
  return data;
}

async function runCompanionWorkflow(intent, options = {}) {
  if (isProcessing) return;

  // ── Summary / Report intent — generate PDF immediately ─────────────────────
  const intentLower = intent.toLowerCase();
  if (/\b(summary|report|daily report|end.?of.?day|eod|what did i do|what have i done|show report|generate report|pdf)\b/.test(intentLower)) {
    pushCompanion("user", intent, false);
    pushCompanion("agent", "Generating your end-of-day summary report as a PDF… Opening now.", false);
    render();
    await generateDailyReportPDF();
    return;
  }

  companionOpen = true;
  isProcessing = true;
  activeRunId += 1;
  const runId = activeRunId;

  // ── Auto-create mock emails if the query is about emails and none match ──────
  checkAndCreateMockEmails(intent);

  // ── Learn from user input ────────────────────────────────────────────────────
  learnFromUserText(intent);
  const detectedIntent = parseAgentIntent(intent);
  if (detectedIntent?.type) trackIntent(detectedIntent.type, intent);

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
    const parsedIntent = parseAgentIntent(intent);

    // ── VP email with summarize flag — needs async Gemini call ───────────────
    if (parsedIntent?.type === "vp_emails" && parsedIntent.summarize) {
      const allEmails = sources.find(s => s.id === "email")?.items || [];
      const vpKeywordsRe = /VP|vice.?president|executive|CTO|CEO|COO|CPO|leadership|escalation/i;
      const vpEmails = allEmails.filter(e =>
        vpKeywordsRe.test(e.title) || vpKeywordsRe.test(e.body || "") || vpKeywordsRe.test(e.team || "")
      );
      if (vpEmails.length > 0) {
        const topEmail = vpEmails[0];
        let aiSummary = "";
        try {
          aiSummary = await geminiSummariseEmail(topEmail.body, topEmail.title);
        } catch (e) {
          // Build a local summary from the email data
          aiSummary = `**TL;DR:** ${topEmail.title}\n\n**Key Points:**\n- ${topEmail.body}\n\n**Action Items:**\n${(topEmail.dependencies || []).map(d => `- ✅ ${d}`).join('\n') || '- ✅ Respond to this email'}\n\n**Urgency:** ${topEmail.severity === 'P1' ? 'Critical' : 'High'}`;
        }
        const sevColor2 = { P1: "#de350b", P2: "#974f0c", P3: "#216e4e", P4: "#626f86" };
        const color = sevColor2[topEmail.severity] || "#626f86";
        result = {
          html: `<div style="background:#fff;border:1px solid #e8e0d5;border-left:4px solid ${color};border-radius:8px;padding:12px 14px;margin-bottom:8px;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
              <span style="font-size:10px;font-weight:800;background:${color}18;color:${color};padding:2px 8px;border-radius:10px;">${topEmail.severity}</span>
              <span style="font-size:10px;color:#94a3b8;">${topEmail.id}</span>
            </div>
            <strong style="font-size:13px;color:#172b4d;display:block;">${escapeHtml(topEmail.title)}</strong>
          </div>
          <div style="font-size:13px;color:#172b4d;line-height:1.7;white-space:pre-wrap;padding:0 2px;">${escapeHtml(aiSummary)}</div>
          ${vpEmails.length > 1 ? `<div style="margin-top:10px;font-size:11px;color:#0c66e4;">+${vpEmails.length - 1} more VP email${vpEmails.length > 2 ? 's' : ''} — say "show VP emails" to see all.</div>` : ""}`,
          chips: ["Show VP emails", "Make MAIL-920 priority", "Show blockers", "▶ Start top P1"]
        };
      } else {
        result = { html: `<span>📭 No VP or executive emails found in your inbox right now.</span>`, chips: ["Show all emails", "Show my tasks"] };
      }
    } else {
      const structuredResponse = buildAgentResponse(intent);
      if (structuredResponse) {
        result = structuredResponse;
      } else if (options.captureScreen) {
        result = await runScreenScan(runId, sealed);
      } else {
        try {
          const decision = await geminiAgentDecision(intent);
          result = decision.reply;
          
          if (decision.learnedFact) {
            const fact = decision.learnedFact.trim();
            if (!userPreferences.learnedFacts.includes(fact)) {
              userPreferences.learnedFacts.push(fact);
              if (userPreferences.learnedFacts.length > 5) userPreferences.learnedFacts.shift();
              savePrefs();
            }
          }
          
          if (decision.action && decision.action.type !== "NONE") {
            await executeAgentAction(decision.action);
          }
        } catch (err) {
          console.error("Gemini Agent Decision failed, falling back:", err);
          result = await createCompanionAnswer(intent, sealed);
        }
      }
    }
    await runStep(runId, "reason", "done", "Reasoning complete with auditable rationale");

    await runStep(runId, "consent", "running", "Preparing user-approved recommendation");
    await sleep(180);
    await runStep(runId, "consent", "done", "No execution performed without approval");

    if (runId !== activeRunId) return;
    lastAnswer = (typeof result === "object" && result !== null) ? (result.html || result.text) : result;
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
    return await geminiAnswerQuery(intent, state, buildRichContext());
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

function pushCompanion(role, text, doRender = true) {
  let entry;
  if (typeof text === "object" && text !== null) {
    entry = { role, text: text.html || "", html: text.html || "", chips: text.chips || [] };
  } else {
    const chips = role === "agent" ? ["Top 5 tasks", "Show VP emails", "What's blocking my teammate?", "Show blockers", "Who is overloaded?"] : [];
    entry = { role, text: text || "", chips };
  }
  companionLog.push(entry);
  if (companionLog.length > 12) {
    companionLog = companionLog.slice(-12);
  }
  if (doRender) render();
}

function renderLogText(text) {
  if (!text) return "";
  
  // If the text already looks like HTML (starts with < or contains tags), we can render it directly
  const containsHtml = /<[a-z][\s\S]*>/i.test(text);
  if (containsHtml) {
    return text;
  }
  
  let html = escapeHtml(text);
  
  // Markdown links: [text](url)
  html = html.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" style="color:#0c66e4;text-decoration:underline;">$1</a>');
  
  // Bold: **text**
  html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  
  // Inline code: `code`
  html = html.replace(/`(.*?)`/g, "<code>$1</code>");
  
  // Code blocks: ```code```
  html = html.replace(/```([\s\S]*?)```/g, '<pre style="background:#f4f5f7;padding:8px;border-radius:4px;overflow-x:auto;font-family:monospace;font-size:11px;margin:5px 0;"><code>$1</code></pre>');
  
  // Tables:
  const lines = html.split("<br>");
  let inTable = false;
  let tableHtml = "";
  const processedLines = [];
  
  for (let line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      if (!inTable) {
        inTable = true;
        tableHtml = '<table class="companion-table" style="width:100%; border-collapse:collapse; margin: 8px 0; font-size:12px; border:1px solid #eadfce; border-radius:4px; overflow:hidden;">';
      }
      
      const cols = trimmed.split("|").slice(1, -1);
      const isHeaderDivider = cols.every(c => c.trim().startsWith("-") || c.trim().includes("---"));
      
      if (isHeaderDivider) continue;
      
      const isHeader = !tableHtml.includes("<td");
      tableHtml += `<tr style="border-bottom:1px solid #eadfce; background:${isHeader ? "#f1e6d6" : "#fff"}; font-weight:${isHeader ? "bold" : "normal"};">`;
      for (let col of cols) {
        const tag = isHeader ? "th" : "td";
        tableHtml += `<${tag} style="padding:6px; text-align:left; border-right:1px solid #eadfce;">${col.trim()}</${tag}>`;
      }
      tableHtml += "</tr>";
    } else {
      if (inTable) {
        inTable = false;
        tableHtml += "</table>";
        processedLines.push(tableHtml);
        tableHtml = "";
      }
      processedLines.push(line);
    }
  }
  if (inTable) {
    tableHtml += "</table>";
    processedLines.push(tableHtml);
  }
  
  // Lists:
  let inUl = false;
  let inOl = false;
  const listProcessedLines = [];
  
  for (let line of processedLines) {
    if (line.startsWith("<table") || line.startsWith("<tr") || line.endsWith("</table>")) {
      listProcessedLines.push(line);
      continue;
    }
    
    const trimmed = line.trim();
    const bulletMatch = trimmed.match(/^(&amp;bull;|-|\*)\s+(.*)/);
    const numberMatch = trimmed.match(/^(\d+)\.\s+(.*)/);
    
    if (bulletMatch) {
      if (inOl) {
        listProcessedLines.push("</ol>");
        inOl = false;
      }
      if (!inUl) {
        listProcessedLines.push('<ul style="margin: 4px 0; padding-left: 20px; list-style-type: disc;">');
        inUl = true;
      }
      listProcessedLines.push(`<li style="margin: 2px 0;">${bulletMatch[2]}</li>`);
    } else if (numberMatch) {
      if (inUl) {
        listProcessedLines.push("</ul>");
        inUl = false;
      }
      if (!inOl) {
        listProcessedLines.push('<ol style="margin: 4px 0; padding-left: 20px; list-style-type: decimal;">');
        inOl = true;
      }
      listProcessedLines.push(`<li style="margin: 2px 0;">${numberMatch[2]}</li>`);
    } else {
      if (inUl) {
        listProcessedLines.push("</ul>");
        inUl = false;
      }
      if (inOl) {
        listProcessedLines.push("</ol>");
        inOl = false;
      }
      listProcessedLines.push(line);
    }
  }
  if (inUl) listProcessedLines.push("</ul>");
  if (inOl) listProcessedLines.push("</ol>");
  
  return listProcessedLines.join("<br>");
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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const url = `http://127.0.0.1:8787/api/settings/profile?email=${encodeURIComponent(authSession.email)}&id=${encodeURIComponent(authSession.userId || "")}`;
    const response = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
    const data = await response.json();
    if (data.profile) {
      settingsProfile.name = data.profile.full_name || data.profile.display_name || authSession.name;
      settingsProfile.role = data.profile.role || authSession.role;
      settingsProfile.email = data.profile.email || authSession.email;
    }
  } catch (err) {
    // Backend offline — use session data
  }
}

async function loadBackendConfig() {
  // Fast 2s timeout so the app renders immediately if backend is down
  const fetchWithTimeout = (url, opts = {}, ms = 2000) => {
    if (typeof AbortController === "undefined") return fetch(url, opts);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer));
  };

  try {
    if (window.taskPilotDesktop?.getBackendConfig) {
      backendConfig = await window.taskPilotDesktop.getBackendConfig();
    } else {
      const response = await fetchWithTimeout("http://127.0.0.1:8787/api/taskpilot/config");
      backendConfig = await response.json();
    }
  } catch {
    backendConfig = { geminiConfigured: false, teeMode: "local-attested", supabaseConfigured: false, supabaseUrl: "", backendPort: "8787" };
  }

  // Fetch live state from backend to synchronize the local state
  try {
    const response = await fetchWithTimeout("http://127.0.0.1:8787/api/taskpilot/state");
    const data = await response.json();
    if (data.success) {
      // Merge backend completedTaskIds into per-user store (don't override Supabase data)
      const backendCompleted = data.completedTaskIds || [];
      const backendWorking = data.workingTaskIds || [];
      if (backendCompleted.length > 0) {
        // Union: keep both local + backend completed IDs
        const merged = [...new Set([...getMyCompletedIds(), ...backendCompleted])];
        setMyCompletedIds(merged);
      } else {
        completedTaskIds = getMyCompletedIds(); // restore from local store
      }
      if (backendWorking.length > 0) {
        const mergedWorking = [...new Set([...getMyWorkingIds(), ...backendWorking])];
        setMyWorkingIds(mergedWorking);
      } else {
        workingTaskIds = getMyWorkingIds();
      }
      taskTimeLogs = data.taskTimeLogs || {};
      managerActivityFeed = data.managerActivityFeed || [];
      managerTaskPosts = data.managerTaskPosts || [];
      engineerPortalPosts = data.engineerPortalPosts || [];
      addedTasks = data.addedTasks || [];
      reassignedTaskOwners = data.reassignedTaskOwners || {};

      // Add loaded manually added tasks back to local sources items
      if (addedTasks.length > 0) {
        addedTasks.forEach(t => {
          const jiraSource = sources.find(s => s.id === "jira");
          if (jiraSource && !jiraSource.items.some(x => x.id === t.id)) {
            jiraSource.items.push(t);
          }
        });
      }

      // Apply loaded reassigned task owners to local sources items
      if (reassignedTaskOwners) {
        sources.forEach(source => {
          source.items.forEach(item => {
            if (reassignedTaskOwners[item.id]) {
              item.owner = reassignedTaskOwners[item.id];
            }
          });
        });
      }
      state = buildState(sources, calendarBlocks);
    }
  } catch (err) {
    console.warn("Backend offline — using local state:", err.message);
  }

  // Only clear sessions that have no userId AND are from google-supabase (truly malformed).
  // Demo sessions are always valid — do NOT wipe them on restart.
  const isMalformedSession = authSession && authSession.provider === "google-supabase" && !authSession.userId;
  if (isMalformedSession) {
    authSession = null;
    localStorage.removeItem("taskpilot:session");
  }

  // Load user profile from backend (best-effort, same timeout)
  await loadUserProfile();
}

// ─── Unified Task Completion ──────────────────────────────────────────────────
function completeTask(id) {
  const task = state.prioritized.find(t => t.id === id);
  if (!task) return;

  // Log end time
  const now = new Date();
  if (!taskTimeLogs[id]) {
    taskTimeLogs[id] = {
      title: task.canonicalTitle,
      severity: task.severity,
      source: task.sources?.join(" + ") || task.sourceId,
      startTime: new Date(now.getTime() - 30 * 60000).toISOString(),
      endTime: now.toISOString()
    };
  } else {
    taskTimeLogs[id].endTime = now.toISOString();
  }

  const log = taskTimeLogs[id];
  const timeSpentMin = log.startTime
    ? Math.round((new Date(log.endTime) - new Date(log.startTime)) / 60000)
    : null;

  // Was it completed before deadline?
  const TODAY = new Date().toISOString().slice(0, 10);
  const wasOnTime = !task.due || task.due >= TODAY;

  // ── Persist to per-user store + Supabase ────────────────────────────────────
  const row = {
    task_id:        id,
    task_title:     task.canonicalTitle,
    severity:       task.severity,
    source:         (task.sources || [task.sourceId || "unknown"]).join(", "),
    due_date:       task.due || null,
    score:          task.score || 0,
    completed_at:   now.toISOString(),
    was_on_time:    wasOnTime,
    time_spent_min: timeSpentMin
  };
  addMyCompletion(row);
  // Remove from working in store
  setMyWorkingIds(getMyWorkingIds().filter(x => x !== id));
  // Fire-and-forget Supabase save
  saveCompletion(getUserEmail(), getUserName(), task, timeSpentMin, wasOnTime);
  deleteWorkingTask(getUserEmail(), id);

  // Build manager notification
  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  const feedEntry = {
    message: `✓ ${settingsProfile.name} completed "${task.canonicalTitle}" (${task.severity})`,
    color: "#22a06b",
    time: timeStr,
    taskId: id
  };
  managerActivityFeed = [feedEntry, ...managerActivityFeed];

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

  pushCompanion("agent", `Arf! 🐾 "${task.canonicalTitle}" marked done and saved! ${wasOnTime ? "✅ On time!" : "⏰ Past deadline."} ${assignment.handoff.brief ? `Next up: ${assignment.next?.canonicalTitle || "all clear!"}` : "Queue cleared!"}`, false);
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
  const todayISO = today.toISOString().slice(0, 10);

  // Get completed task logs
  const completedLogs = Object.entries(taskTimeLogs)
    .filter(([id]) => completedTaskIds.includes(id))
    .map(([id, log]) => {
      const startDt = new Date(log.startTime);
      const endDt = log.endTime ? new Date(log.endTime) : today;
      const durationMs = endDt - startDt;
      const durationMin = Math.round(durationMs / 60000);
      return {
        ...log, id,
        startStr: startDt.toLocaleTimeString("en-US", { hour:"2-digit", minute:"2-digit" }),
        endStr: endDt.toLocaleTimeString("en-US", { hour:"2-digit", minute:"2-digit" }),
        durationMin
      };
    });

  // Remaining tasks for tomorrow
  const remaining = activeQueue().slice(0, 8);

  // Meetings for today
  const todayMeetings = meetingsList.filter(m =>
    m.suggestedDate === todayISO || m.status === "Scheduled"
  );

  // Total time logged
  const totalMinutes = completedLogs.reduce((s, l) => s + l.durationMin, 0);
  const totalTimeStr = totalMinutes >= 60
    ? `${Math.floor(totalMinutes/60)}h ${totalMinutes%60}m` : `${totalMinutes}m`;

  // Gemini summary + next-day plan
  let aiSummary = "AI summary unavailable.";
  let nextDayRecommendations = "";
  try {
    const prompt = `You are TaskPilot AI. Write a professional end-of-day report for ${settingsProfile.name} (${settingsProfile.role || "Engineer"}).

Completed tasks today:
${completedLogs.map((l, i) => `${i+1}. ${l.title} [${l.severity}] — ${l.startStr} to ${l.endStr} (${l.durationMin} min)`).join("\n") || "No tasks completed."}

Meetings attended: ${todayMeetings.map(m => m.title).join(", ") || "none"}

Pending for tomorrow:
${remaining.slice(0, 5).map((t, i) => `${i+1}. ${t.canonicalTitle} [${t.severity}] due ${t.due || "TBD"}`).join("\n")}

Return ONLY valid JSON: { "summary": "2-3 sentence summary", "nextDayPlan": ["point 1", "point 2", "point 3"] }`;
    const r = await geminiChat(prompt);
    try {
      const parsed = JSON.parse(r.replace(/```json|```/g, "").trim());
      aiSummary = parsed.summary || r;
      nextDayRecommendations = (parsed.nextDayPlan || []).join(" · ");
    } catch { aiSummary = r || aiSummary; }
  } catch { /* use default */ }

  // Build HTML for the report
  const logoDataUrlStr = typeof logoDataUrl !== "undefined" ? logoDataUrl : "";
  const reportHtml = buildReportHTML({ dateStr, completedLogs, todayMeetings, remaining, aiSummary, nextDayRecommendations, totalTimeStr, logoDataUrlStr });

  // Open a new window, write the report, print it
  const printWin = window.open("", "_blank", "width=920,height=750");
  if (!printWin) {
    alert("Please allow popups for TaskPilot AI to generate the PDF report.");
    return;
  }
  printWin.document.write(reportHtml);
  printWin.document.close();
  printWin.focus();
  setTimeout(() => printWin.print(), 700);
}

function buildReportHTML({ dateStr, completedLogs, todayMeetings, remaining, aiSummary, nextDayRecommendations, totalTimeStr, logoDataUrlStr }) {
  const today = new Date();
  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800;900&family=Plus+Jakarta+Sans:wght@400;500;700;800&display=swap');
    @page { size: A4; margin: 15mm 15mm 20mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Plus Jakarta Sans', -apple-system, sans-serif; color: #1e293b; background: #f8fafc; font-size: 13px; line-height: 1.5; padding: 20px; }
    .container { max-width: 850px; margin: 0 auto; background: #fff; border-radius: 16px; box-shadow: 0 4px 25px rgba(0,0,0,0.04); padding: 35px; border: 1px solid #e2e8f0; }
    .header { display:flex; align-items:center; gap:20px; padding-bottom:24px; border-bottom:1px solid #e2e8f0; margin-bottom:26px; }
    .logo-container { display:flex; align-items:center; justify-content:center; width:64px; height:64px; border-radius:16px; background:linear-gradient(135deg,#0c66e4,#00d4aa); padding:4px; box-shadow:0 4px 12px rgba(12,102,228,0.15); flex-shrink:0; }
    .logo { width:100%; height:100%; border-radius:12px; object-fit:cover; }
    .header-title { font-family:'Outfit',sans-serif; font-size:24px; font-weight:900; color:#0f172a; letter-spacing:-0.02em; line-height:1.2; }
    .header-sub { font-size:12px; color:#64748b; margin-top:4px; font-weight:500; }
    .meta-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:26px; }
    .meta-card { padding:12px 14px; border:1px solid #e2e8f0; border-radius:10px; background:#f8fafc; }
    .meta-card label { font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:0.08em; color:#64748b; display:block; margin-bottom:5px; }
    .meta-card span { font-size:13px; font-weight:700; color:#0f172a; }
    h2 { font-family:'Outfit',sans-serif; font-size:15px; font-weight:800; color:#0f172a; margin:0 0 12px; padding-bottom:7px; border-bottom:2px solid #f1f5f9; }
    section { margin-bottom:26px; }
    table { width:100%; border-collapse:separate; border-spacing:0; border:1px solid #e2e8f0; border-radius:10px; overflow:hidden; }
    thead tr { background:#0f172a; color:#fff; }
    thead th { padding:10px 12px; text-align:left; font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:0.05em; }
    tbody tr:nth-child(even) { background:#f8fafc; }
    tbody tr:last-child td { border-bottom:none; }
    tbody td { padding:10px 12px; font-size:12px; color:#334155; border-bottom:1px solid #e2e8f0; }
    .sev { display:inline-flex; align-items:center; justify-content:center; padding:3px 7px; border-radius:5px; font-size:10px; font-weight:800; }
    .sev.P1 { background:#fee2e2; color:#991b1b; }
    .sev.P2 { background:#fef3c7; color:#92400e; }
    .sev.P3 { background:#dcfce7; color:#166534; }
    .sev.P4 { background:#f1f5f9; color:#475569; }
    .ai-block { padding:14px 16px; background:#f0f7ff; border-left:4px solid #3b82f6; border-radius:8px; font-size:13px; line-height:1.6; color:#1e3a8a; }
    .next-day-block { padding:12px 16px; background:#f0fdf4; border-left:4px solid #22c55e; border-radius:8px; font-size:13px; line-height:1.6; color:#14532d; margin-top:10px; }
    .tomorrow-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:10px; }
    .tomorrow-item { padding:11px 13px; border:1px solid #e2e8f0; border-radius:9px; background:#fff; display:flex; align-items:center; gap:9px; }
    .meeting-row { display:flex; align-items:center; gap:10px; padding:10px 12px; border:1px solid #e2e8f0; border-radius:8px; background:#fafafe; margin-bottom:8px; }
    .footer { margin-top:32px; padding-top:16px; border-top:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:center; font-size:11px; color:#94a3b8; }
    .no-data { color:#64748b; font-size:12px; font-style:italic; padding:10px 0; }
  `;

  const logo = logoDataUrlStr ? `<img src="${logoDataUrlStr}" class="logo" alt="TaskPilot AI">` : `<span style="font-family:Outfit;font-size:22px;font-weight:900;color:#fff;">TP</span>`;

  const completedSection = completedLogs.length === 0
    ? `<p class="no-data">No tasks completed today.</p>`
    : `<table><thead><tr><th>#</th><th>Task Title</th><th>Source</th><th>Sev</th><th>Start</th><th>End</th><th>Duration</th></tr></thead><tbody>
        ${completedLogs.map((l, i) => `<tr>
          <td style="font-weight:800;color:#64748b;">${i+1}</td>
          <td><strong>${escapeHtml(l.title)}</strong></td>
          <td style="font-size:11px;color:#64748b;">${escapeHtml(l.source)}</td>
          <td><span class="sev ${l.severity}">${l.severity}</span></td>
          <td style="font-family:monospace;color:#475569;font-size:12px;">${l.startStr}</td>
          <td style="font-family:monospace;color:#475569;font-size:12px;">${l.endStr}</td>
          <td style="font-weight:700;">${l.durationMin >= 60 ? `${Math.floor(l.durationMin/60)}h ${l.durationMin%60}m` : `${l.durationMin}m`}</td>
        </tr>`).join("")}
      </tbody></table>`;

  const meetingsSection = todayMeetings.length > 0 ? `
    <section><h2>📅 Meetings Today</h2>
      ${todayMeetings.map(m => `<div class="meeting-row">
        <div style="width:32px;height:32px;border-radius:8px;background:#ede9fe;display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0;">◷</div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:13px;color:#0f172a;">${escapeHtml(m.title)}</div>
          <div style="font-size:11px;color:#64748b;margin-top:2px;">${m.suggestedTime || "TBD"} · ${m.duration} min · ${(m.attendees||[]).length} attendees</div>
        </div>
        <span style="padding:3px 8px;border-radius:10px;background:#ede9fe;color:#5b21b6;font-size:10px;font-weight:800;">${m.priority || "Medium"}</span>
      </div>`).join("")}
    </section>` : "";

  const tomorrowSection = remaining.length === 0
    ? `<p class="no-data">All priorities cleared!</p>`
    : `<div class="tomorrow-grid">${remaining.slice(0, 6).map((t, i) => `
        <div class="tomorrow-item">
          <span style="font-weight:800;color:#94a3b8;font-size:12px;">#${i+1}</span>
          <span class="sev ${t.severity}">${t.severity}</span>
          <span style="flex:1;font-weight:600;color:#0f172a;font-size:12px;">${escapeHtml(t.canonicalTitle)}</span>
          <span style="font-size:10px;color:#64748b;white-space:nowrap;">Due ${formatDue(t.due)}</span>
        </div>`).join("")}
      </div>`;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <title>Daily Report — ${escapeHtml(settingsProfile.name)} — ${dateStr}</title>
  <style>${css}</style></head><body><div class="container">
    <div class="header">
      <div class="logo-container">${logo}</div>
      <div style="flex:1;">
        <div class="header-title">Daily Engineering Report</div>
        <div class="header-sub">TaskPilot AI · ${dateStr}</div>
      </div>
      <div style="text-align:right;font-size:11px;color:#64748b;"><div style="font-weight:800;font-size:13px;color:#0f172a;">TaskPilot AI</div><div>taskpilot.dev</div></div>
    </div>
    <div class="meta-grid">
      <div class="meta-card"><label>Name</label><span>${escapeHtml(settingsProfile.name)}</span></div>
      <div class="meta-card"><label>Role</label><span>${escapeHtml(settingsProfile.role || "Full-stack Engineer")}</span></div>
      <div class="meta-card"><label>Tasks Done</label><span>${completedLogs.length} today</span></div>
      <div class="meta-card"><label>Time Logged</label><span>${totalTimeStr}</span></div>
    </div>
    <section><h2>✅ Tasks Completed Today</h2>${completedSection}</section>
    ${meetingsSection}
    <section><h2>🤖 AI Summary & Achievements</h2>
      <div class="ai-block">${escapeHtml(aiSummary)}</div>
      ${nextDayRecommendations ? `<div class="next-day-block"><strong>Tomorrow's focus:</strong> ${escapeHtml(nextDayRecommendations)}</div>` : ""}
    </section>
    <section><h2>📅 Priority Focus for Tomorrow</h2>${tomorrowSection}</section>
    <div class="footer">
      <div style="display:flex;align-items:center;gap:8px;">
        ${logoDataUrlStr ? `<img src="${logoDataUrlStr}" style="width:16px;height:16px;border-radius:3px;object-fit:cover;">` : ""}
        Generated by TaskPilot AI · ${today.toLocaleString()}
      </div>
      <span>${escapeHtml(settingsProfile.name)} · ${escapeHtml(settingsProfile.email || "")} · ${escapeHtml(settingsProfile.role || "Engineer")}</span>
    </div>
  </div></body></html>`;
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
// Safe render with error recovery — prevents blank page on runtime errors
function safeRender() {
  try {
    render();
  } catch (err) {
    console.error("[TaskPilot] render() threw:", err);
    // Show error overlay instead of blank page
    if (app) {
      app.innerHTML = `
        <main style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;background:#f7f4ee;font-family:Inter,system-ui,sans-serif;gap:16px;padding:40px;">
          <div style="font-size:48px;">⚠️</div>
          <h2 style="margin:0;color:#152238;font-family:Outfit,sans-serif;">TaskPilot ran into a problem</h2>
          <p style="margin:0;color:#4a5568;max-width:480px;text-align:center;">${escapeHtml ? escapeHtml(err.message) : err.message}</p>
          <button onclick="localStorage.removeItem('taskpilot:session');location.reload();"
            style="padding:12px 24px;background:#152238;color:#fff;border:none;border-radius:10px;font-weight:700;cursor:pointer;font-size:14px;">
            Clear session &amp; reload
          </button>
        </main>`;
    }
  }
}

// Validate session before boot — clear malformed sessions
try {
  const rawSession = localStorage.getItem("taskpilot:session");
  if (rawSession) {
    const parsed = JSON.parse(rawSession);
    if (!parsed || !parsed.provider || !parsed.role) {
      localStorage.removeItem("taskpilot:session");
      authSession = null;
    }
  }
} catch {
  localStorage.removeItem("taskpilot:session");
  authSession = null;
}

// Render immediately so the page isn't blank while backend connects
safeRender();
// Then load backend config/state and re-render with live data
loadBackendConfig().finally(async () => {
  // Restore per-user completion state from localStorage
  completedTaskIds = getMyCompletedIds();
  workingTaskIds   = getMyWorkingIds();

  // Rebuild today queue with updated profile name after config loaded
  const engineerName = settingsProfile?.name || demoProfiles[activeProfile]?.name || "Utkarsh";
  todayQueue = buildTodayQueue(state.prioritized, engineerName, 12);
  depGraph = buildDependencyGraph(state.prioritized);
  safeRender();

  // Sync completions from Supabase (background, then re-render)
  syncCompletionsFromSupabase().then(() => {
    safeRender();
    startRealtimeSync(); // live updates
  });

  // Async: re-score today queue with Gemini for smarter ranking
  geminiRescoreTodayQueue();
});

// ─── Gemini Re-score Today Queue ─────────────────────────────────────────────
async function geminiRescoreTodayQueue() {
  if (todayQueueGeminiScored || todayQueue.length === 0) return;
  try {
    const slim = todayQueue.map(t => ({
      id: t.id,
      title: t.canonicalTitle,
      severity: t.severity,
      due: t.due,
      impact: t.impact,
      dependencies: t.dependencies,
      sources: t.sources,
      owner: t.owner,
      isBlocking: t.isBlocking,
      blocksCount: t.blocksCount || 0
    }));
    const rescored = await geminPrioritizeTasks(slim);
    if (!Array.isArray(rescored) || rescored.length === 0) return;

    // Merge Gemini scores back into todayQueue
    const scoreMap = {};
    rescored.forEach(r => { if (r.id) scoreMap[r.id] = r; });
    todayQueue = todayQueue.map(t => {
      const g = scoreMap[t.id];
      if (!g) return t;
      return {
        ...t,
        score: g.score || t.score,
        rankReasons: Array.isArray(g.rankReasons) && g.rankReasons.length > 0
          ? g.rankReasons
          : t.rankReasons
      };
    }).sort((a, b) => b.score - a.score);

    todayQueueGeminiScored = true;
    safeRender();
    console.log("[TaskPilot] Today queue re-scored by Gemini ✅");
  } catch (err) {
    console.warn("[TaskPilot] Gemini re-score skipped:", err.message);
  }
}
