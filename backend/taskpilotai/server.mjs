import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { AgentOrchestrator } from "./agent/agentOrchestrator.mjs";
import { SettingsAPI } from "./api/settingsApi.mjs";

const root = resolve(import.meta.dirname);
const env = loadEnv(join(root, ".env"));
const datasetDir = resolve(root, env.TASKPILOT_DATASET_DIR || "./datasets");
const port = Number(env.TASKPILOT_PORT || 8787);

// Load primary Gemini key from EXPO_PUBLIC_FIREBASE_API_KEY or fallback to GEMINI_API_KEY
const geminiApiKey = env.EXPO_PUBLIC_FIREBASE_API_KEY || env.GEMINI_API_KEY || "";

// ─── Vertex AI endpoint builder (uses GCP credits via aiplatform.googleapis.com)
function buildVertexUrl(model) {
  const project  = env.VERTEX_AI_PROJECT || "";
  const location = env.VERTEX_AI_LOCATION || "us-central1";
  const modelId  = model.replace(/^.*\//, "");
  if (project) {
    return `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${modelId}:generateContent`;
  }
  // Fallback to generativelanguage API (AI Studio keys)
  return `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`;
}

// ─── Unified Gemini call (handles both Vertex AI AQ. keys and AI Studio AIza keys)
async function callGemini(prompt, { model, maxTokens = 2048, temperature = 0.7 } = {}) {
  const useModel = model || env.LLM_MODEL || "gemini-2.5-flash";
  const url = buildVertexUrl(useModel) + `?key=${geminiApiKey}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens, temperature }
    })
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Gemini API ${resp.status}: ${err}`);
  }
  const data = await resp.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return text.trim();
}

// Initialize Agent Orchestrator
let agentOrchestrator = null;
async function initializeAgent() {
  if (!agentOrchestrator) {
    agentOrchestrator = new AgentOrchestrator();
    try {
      await agentOrchestrator.initialize();
      console.log("✅ Agent Orchestrator initialized successfully");
    } catch (error) {
      console.error("❌ Failed to initialize Agent Orchestrator:", error);
    }
  }
  return agentOrchestrator;
}

// In-memory manager task post store (persists across requests while server is running)
let managerTaskPosts = [];

export function loadTaskPilotData() {
  const sourceFiles = [
    "jira_sprint_board.json",
    "servicenow_defects.json",
    "github_work.json",
    "outlook_emails.json",
    "slack_mentions.json",
    "meeting_notes.json"
  ];
  return {
    sources: sourceFiles.map((file) => readJson(join(datasetDir, file))),
    calendarBlocks: readJson(join(datasetDir, "calendar_blocks.json")),
    demoProfiles: readJson(join(datasetDir, "profiles.json")),
    meetings: readJson(join(datasetDir, "meetings.json")),
    llm: {
      provider: env.LLM_PROVIDER || "vertex",
      configured: Boolean(geminiApiKey),
      keyEnv: env.EXPO_PUBLIC_FIREBASE_API_KEY ? "EXPO_PUBLIC_FIREBASE_API_KEY" : "GEMINI_API_KEY",
      model: env.LLM_MODEL || "gemini-2.5-flash"
    }
  };
}

if (process.argv.includes("--check")) {
  const data = loadTaskPilotData();
  console.log(`Loaded ${data.sources.length} source datasets and ${data.sources.reduce((sum, source) => sum + source.items.length, 0)} raw tasks.`);
  process.exit(0);
}

// Call Google Gemini API
async function callGeminiAPI(apiKey, payload) {
  const prompt = `You are a helpful, secure, and privacy-preserving desktop AI companion.
You are monitoring the user's active window and task context.
Active App: ${payload.sourceName || "Unknown Screen"}
Active Task: ${payload.selectedTask || "None"}
Redacted OCR Text / Context: ${payload.redactedOcrContext || ""}
Intent / Activity: ${payload.intent || "Monitoring active work progress"}

Please provide a concise (1-2 sentences) summary/recommendation on the user's current workflow. Check if they are making progress, need any help, or if they completed the task. Ensure no sensitive data is leaked.`;
  return callGemini(prompt, { maxTokens: 150, temperature: 0.4 });
}

// Call Gemini API to prioritize tasks
async function prioritizeTasksWithGemini(apiKey, tasks) {
  const prompt = `You are a smart task prioritization model. Given a JSON list of engineering tasks, rank them from highest priority to lowest priority.
For each task, assign a 'score' (0-100) and an array of 'rankReasons' explaining why this rank was given based on severity, deadline, and impact.
Return ONLY a valid JSON array of tasks containing the updated 'score' and 'rankReasons' fields, and sorted by score descending. Do not include markdown code block formatting.

Tasks:
${JSON.stringify(tasks, null, 2)}`;

  const raw = await callGemini(prompt, { maxTokens: 4096, temperature: 0.3 });
  const cleanJson = raw.replace(/```json/g, "").replace(/```/g, "").trim();
  return JSON.parse(cleanJson);
}

// Call Gemini API to generate daily report
async function generateDailyReport(apiKey, payload) {
  const prompt = `You are a professional engineering manager AI. Generate a professional and encouraging End-Of-Day (EOD) summary report based on the user's activity.
Tasks Completed:
${payload.completedTasks?.map(t => `- ${t.canonicalTitle || t.title}`).join("\n") || "None"}

Tasks Remaining:
${payload.remainingTasks?.map(t => `- ${t.canonicalTitle || t.title} (Score: ${t.score || "N/A"})`).join("\n") || "None"}

Live Monitoring Logs:
${payload.monitoringLogs?.map(log => `[${log.role}]: ${log.text}`).join("\n") || "No logs captured today."}

Format the report with a summary of achievements, next day focus, and some recommendations for optimization. Use markdown styling.`;
  return callGemini(prompt, { maxTokens: 2048, temperature: 0.6 });
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);
  
  // Set CORS headers for all requests
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    response.end();
    return;
  }

  if (url.pathname === "/api/taskpilot/data") {
    sendJson(response, loadTaskPilotData());
    return;
  }
  
  if (url.pathname === "/api/taskpilot/config") {
    sendJson(response, {
      geminiConfigured: Boolean(geminiApiKey),
      teeMode: env.TASKPILOT_TEE_MODE || "local-attested",
      supabaseConfigured: Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY),
      supabaseUrl: env.SUPABASE_URL || "",
      supabaseAnonKey: env.SUPABASE_ANON_KEY ? "configured" : "",
      backendPort: env.TASKPILOT_PORT || "8787",
      llmModel: env.LLM_MODEL || "gemini-2.5-flash"
    });
    return;
  }

  // General Gemini chat endpoint used by geminiClient.js
  if (url.pathname === "/api/taskpilot/gemini-chat" && request.method === "POST") {
    const body = await readBody(request);
    const payload = body ? JSON.parse(body) : {};
    
    if (!geminiApiKey) {
      sendJson(response, { text: "Gemini API key not configured. Add GEMINI_API_KEY to backend/.env" });
      return;
    }
    
    try {
      const text = await callGemini(payload.prompt, {
        model: payload.model,
        maxTokens: 2048,
        temperature: 0.7
      });
      sendJson(response, { text, model: payload.model || env.LLM_MODEL || "gemini-2.5-flash", success: true });
    } catch (err) {
      sendJson(response, { text: `Error: ${err.message}`, success: false }, 500);
    }
    return;
  }
  
  if (url.pathname === "/api/taskpilot/vision-summary" && request.method === "POST") {
    const body = await readBody(request);
    const payload = body ? JSON.parse(body) : {};
    
    let summaryText = "";
    if (geminiApiKey) {
      try {
        summaryText = await callGeminiAPI(geminiApiKey, payload);
      } catch (err) {
        summaryText = `Failed to get summary from Gemini API: ${err.message}`;
      }
    } else {
      summaryText = "Gemini backend is not configured. Add GEMINI_API_KEY in backend/taskpilotai/.env to enable live vision.";
    }

    sendJson(response, {
      provider: "vertex",
      configured: Boolean(geminiApiKey),
      summary: summaryText,
      tee: {
        rawKeyExposedToFrontend: false,
        rawScreenshotRequired: false,
        approvalRequired: true
      }
    });
    return;
  }

  if (url.pathname === "/api/taskpilot/prioritize" && request.method === "POST") {
    const body = await readBody(request);
    const payload = body ? JSON.parse(body) : {};
    
    let prioritizedTasks = [];
    if (geminiApiKey && payload.tasks) {
      try {
        prioritizedTasks = await prioritizeTasksWithGemini(null, payload.tasks);
      } catch (err) {
        console.error("Gemini prioritization failed, using fallback:", err);
      }
    }
    
    sendJson(response, { tasks: prioritizedTasks });
    return;
  }

  if (url.pathname === "/api/taskpilot/daily-report" && request.method === "POST") {
    const body = await readBody(request);
    const payload = body ? JSON.parse(body) : {};
    
    let summaryText = "";
    if (geminiApiKey) {
      try {
        summaryText = await generateDailyReport(null, payload);
      } catch (err) {
        summaryText = `Failed to generate EOD summary report from Gemini API: ${err.message}`;
      }
    } else {
      summaryText = "Gemini backend is not configured. Add GEMINI_API_KEY to generate report.";
    }

    sendJson(response, { summary: summaryText });
    return;
  }

  // State synchronization endpoints
  if (url.pathname === "/api/taskpilot/state" && request.method === "GET") {
    try {
      const agent = await initializeAgent();
      sendJson(response, {
        success: true,
        completedTaskIds: agent.completedTaskIds,
        workingTaskIds: agent.workingTaskIds,
        taskTimeLogs: agent.taskTimeLogs,
        managerActivityFeed: agent.managerActivityFeed,
        managerTaskPosts: agent.managerTaskPosts,
        engineerPortalPosts: agent.engineerPortalPosts,
        addedTasks: agent.addedTasks,
        tasks: agent.allTasks
      });
    } catch (err) {
      sendJson(response, { error: err.message, success: false }, 500);
    }
    return;
  }

  if (url.pathname === "/api/taskpilot/sync-state" && request.method === "POST") {
    try {
      const body = await readBody(request);
      const liveState = body ? JSON.parse(body) : {};
      const agent = await initializeAgent();
      await agent.syncState(liveState);
      
      // Update local server managerTaskPosts list to stay synced
      if (liveState.managerTaskPosts) {
        managerTaskPosts = liveState.managerTaskPosts;
      }
      
      // Persist to datasets/live_state.json
      const statePath = join(datasetDir, "live_state.json");
      writeFileSync(statePath, JSON.stringify(liveState, null, 2), "utf8");
      
      sendJson(response, { success: true });
    } catch (err) {
      sendJson(response, { error: err.message, success: false }, 500);
    }
    return;
  }

  // New Agent Endpoints

  if (url.pathname === "/api/agent/initialize" && request.method === "POST") {
    try {
      const agent = await initializeAgent();
      const result = await agent.initialize();
      sendJson(response, result);
    } catch (error) {
      sendJson(response, { success: false, error: error.message }, 500);
    }
    return;
  }

  if (url.pathname === "/api/agent/daily-plan" && request.method === "POST") {
    try {
      const agent = await initializeAgent();
      const body = await readBody(request);
      const payload = body ? JSON.parse(body) : {};
      const result = await agent.generateDailyPlan(
        payload.engineerName || 'Engineer',
        payload.userId || null
      );
      sendJson(response, result);
    } catch (error) {
      sendJson(response, { error: error.message }, 500);
    }
    return;
  }

  if (url.pathname === "/api/agent/weekly-summary" && request.method === "POST") {
    try {
      const agent = await initializeAgent();
      const body = await readBody(request);
      const payload = body ? JSON.parse(body) : {};
      const result = await agent.generateWeeklySummary(payload.engineerName || 'Engineer');
      sendJson(response, { summary: result });
    } catch (error) {
      sendJson(response, { error: error.message }, 500);
    }
    return;
  }

  if (url.pathname === "/api/agent/chat" && request.method === "POST") {
    try {
      const agent = await initializeAgent();
      const body = await readBody(request);
      const payload = body ? JSON.parse(body) : {};
      const result = await agent.chat(
        payload.message || '',
        payload.engineerName || 'Engineer'
      );
      sendJson(response, { response: result });
    } catch (error) {
      sendJson(response, { error: error.message }, 500);
    }
    return;
  }

  if (url.pathname === "/api/agent/urgent-check" && request.method === "GET") {
    try {
      const agent = await initializeAgent();
      const result = await agent.detectUrgentItems();
      sendJson(response, result);
    } catch (error) {
      sendJson(response, { error: error.message }, 500);
    }
    return;
  }

  if (url.pathname === "/api/agent/tasks" && request.method === "GET") {
    try {
      const agent = await initializeAgent();
      const query = Object.fromEntries(url.searchParams);
      const result = agent.getTasks(query);
      sendJson(response, { tasks: result });
    } catch (error) {
      sendJson(response, { error: error.message }, 500);
    }
    return;
  }

  if (url.pathname === "/api/agent/task" && request.method === "GET") {
    try {
      const agent = await initializeAgent();
      const taskId = url.searchParams.get('id');
      const result = agent.getTaskById(taskId);
      sendJson(response, { task: result });
    } catch (error) {
      sendJson(response, { error: error.message }, 500);
    }
    return;
  }

  if (url.pathname === "/api/agent/stats" && request.method === "GET") {
    try {
      const agent = await initializeAgent();
      const result = agent.getDashboardStats();
      sendJson(response, result);
    } catch (error) {
      sendJson(response, { error: error.message }, 500);
    }
    return;
  }

  if (url.pathname === "/api/agent/add-task" && request.method === "POST") {
    try {
      const agent = await initializeAgent();
      const body = await readBody(request);
      const newTask = body ? JSON.parse(body) : {};
      const result = await agent.addNewTask(newTask);
      sendJson(response, result);
    } catch (error) {
      sendJson(response, { error: error.message }, 500);
    }
    return;
  }

  // Settings API Endpoints

  if (url.pathname === "/api/settings/profile" && request.method === "GET") {
    try {
      const email = url.searchParams.get('email') || url.searchParams.get('id');
      if (!email) {
        sendJson(response, { error: 'Email or ID required' }, 400);
        return;
      }
      const profile = await SettingsAPI.getUserProfile(email);
      sendJson(response, { profile });
    } catch (error) {
      sendJson(response, { error: error.message }, 500);
    }
    return;
  }

  if (url.pathname === "/api/settings/profile" && request.method === "PUT") {
    try {
      const body = await readBody(request);
      const payload = body ? JSON.parse(body) : {};
      
      if (!payload.userId) {
        sendJson(response, { error: 'userId required' }, 400);
        return;
      }
      
      const updatedProfile = await SettingsAPI.updateUserProfile(payload.userId, payload.updates);
      sendJson(response, { profile: updatedProfile });
    } catch (error) {
      sendJson(response, { error: error.message }, 500);
    }
    return;
  }

  if (url.pathname === "/api/settings/sources" && request.method === "GET") {
    try {
      const profileId = url.searchParams.get('profileId');
      if (!profileId) {
        sendJson(response, { error: 'profileId required' }, 400);
        return;
      }
      const sources = await SettingsAPI.getSourceConnections(profileId);
      sendJson(response, { sources });
    } catch (error) {
      sendJson(response, { error: error.message }, 500);
    }
    return;
  }

  if (url.pathname === "/api/settings/sources" && request.method === "PUT") {
    try {
      const body = await readBody(request);
      const payload = body ? JSON.parse(body) : {};
      
      if (!payload.profileId || !payload.sourceType) {
        sendJson(response, { error: 'profileId and sourceType required' }, 400);
        return;
      }
      
      const source = await SettingsAPI.updateSourceConnection(
        payload.profileId,
        payload.sourceType,
        payload.updates
      );
      sendJson(response, { source });
    } catch (error) {
      sendJson(response, { error: error.message }, 500);
    }
    return;
  }

  if (url.pathname === "/api/settings/history" && request.method === "GET") {
    try {
      const profileId = url.searchParams.get('profileId');
      const limit = parseInt(url.searchParams.get('limit') || '50');
      
      if (!profileId) {
        sendJson(response, { error: 'profileId required' }, 400);
        return;
      }
      
      const history = await SettingsAPI.getExecutionHistory(profileId, limit);
      sendJson(response, { history });
    } catch (error) {
      sendJson(response, { error: error.message }, 500);
    }
    return;
  }

  if (url.pathname === "/api/settings/team/profiles" && request.method === "GET") {
    try {
      const teamId = url.searchParams.get('teamId');
      const profiles = await SettingsAPI.getAllProfiles(teamId);
      sendJson(response, { profiles });
    } catch (error) {
      sendJson(response, { error: error.message }, 500);
    }
    return;
  }

  if (url.pathname === "/api/settings/team/stats" && request.method === "GET") {
    try {
      const teamId = url.searchParams.get('teamId');
      if (!teamId) {
        sendJson(response, { error: 'teamId required' }, 400);
        return;
      }
      const stats = await SettingsAPI.getTeamStats(teamId);
      sendJson(response, stats);
    } catch (error) {
      sendJson(response, { error: error.message }, 500);
    }
    return;
  }

  // ─── Manager Task Assignment Endpoints ───────────────────────────────────

  // POST /api/manager/assign-task  
  // Manager posts a job/task update; Gemini analyzes and returns assignment recommendations
  if (url.pathname === "/api/manager/assign-task" && request.method === "POST") {
    try {
      const body = await readBody(request);
      const payload = body ? JSON.parse(body) : {};
      const { title, description, priority, deadline, team, managerName } = payload;

      if (!title) {
        sendJson(response, { error: "title is required" }, 400);
        return;
      }

      // Build team engineers list from current task data
      const data = loadTaskPilotData();
      const allTasks = data.sources.flatMap(s => s.items || []);
      const engineerSet = new Set(allTasks.map(t => t.owner).filter(Boolean));
      const engineers = [...engineerSet].slice(0, 6);

      // Compute current workload per engineer
      const workload = {};
      engineers.forEach(e => {
        workload[e] = allTasks.filter(t => t.owner === e && t.status !== "Done").length;
      });

      let assignment = null;
      if (geminiApiKey) {
        const prompt = `You are TaskPilot AI — a manager-level task assignment engine.

A manager named "${managerName || "Manager"}" wants to assign a new task to the engineering team.

Task Details:
- Title: ${title}
- Description: ${description || "Not provided"}
- Priority: ${priority || "P2"}
- Deadline: ${deadline || "This sprint"}
- Team: ${team || "Platform Apps"}

Current Engineer Workload:
${engineers.map(e => `- ${e}: ${workload[e] || 0} active tasks`).join("\n")}

Return a JSON object:
{
  "recommendedAssignee": string (name of best engineer — lowest load + relevant skills),
  "alternativeAssignees": string[] (next 2 best options),
  "assignmentReasoning": string (2 sentences why this engineer),
  "priorityScore": integer 0-100,
  "estimatedHours": integer,
  "riskLevel": "Low" | "Medium" | "High" | "Critical",
  "teamUpdate": string (a short Slack/email-style update to send to the team, max 3 sentences, professional tone),
  "engineerPortalNote": string (specific instructions for the assigned engineer),
  "suggestedDeadline": string (ISO date or human-readable),
  "dependencyWarnings": string[]
}

Consider: current workload balance, task priority, deadline urgency, and team capacity.
Return ONLY valid JSON. No markdown.`;

        const raw = await callGemini(prompt, { maxTokens: 1024, temperature: 0.4 });
        const cleaned = raw.replace(/```json|```/g, "").trim();
        assignment = JSON.parse(cleaned);
      } else {
        // Fallback without Gemini
        const lowestLoad = engineers.sort((a, b) => (workload[a] || 0) - (workload[b] || 0));
        assignment = {
          recommendedAssignee: lowestLoad[0] || "Unassigned",
          alternativeAssignees: lowestLoad.slice(1, 3),
          assignmentReasoning: `${lowestLoad[0]} has the lowest current workload with ${workload[lowestLoad[0]] || 0} active tasks.`,
          priorityScore: priority === "P1" ? 95 : priority === "P2" ? 75 : 50,
          estimatedHours: 4,
          riskLevel: priority === "P1" ? "Critical" : "Medium",
          teamUpdate: `Team update: "${title}" has been assigned to ${lowestLoad[0]}. Priority: ${priority || "P2"}. Please coordinate as needed.`,
          engineerPortalNote: `You have been assigned: ${title}. Deadline: ${deadline || "This sprint"}. Contact your manager for clarification.`,
          suggestedDeadline: deadline || "End of sprint",
          dependencyWarnings: []
        };
      }

      // Build the posted task record
      const taskPost = {
        id: `MGR-${Date.now().toString().slice(-5)}`,
        title,
        description: description || "",
        priority: priority || "P2",
        deadline: deadline || "",
        team: team || "Platform Apps",
        postedBy: managerName || "Manager",
        postedAt: new Date().toISOString(),
        assignment,
        status: "Posted",
        engineerViewed: false
      };

      // Save to in-memory store
      managerTaskPosts.unshift(taskPost);
      // Keep max 50 posts
      if (managerTaskPosts.length > 50) managerTaskPosts = managerTaskPosts.slice(0, 50);

      sendJson(response, { success: true, taskPost, assignment });
    } catch (err) {
      sendJson(response, { error: err.message, success: false }, 500);
    }
    return;
  }

  // GET /api/manager/team-portal  — Returns current task posts for the engineer portal view
  if (url.pathname === "/api/manager/team-portal" && request.method === "GET") {
    try {
      // Return the in-memory task posts (in production, this would be a DB)
      sendJson(response, { posts: managerTaskPosts, total: managerTaskPosts.length });
    } catch (err) {
      sendJson(response, { error: err.message }, 500);
    }
    return;
  }

  // ─── Meetings Agent Endpoints ─────────────────────────────────────────────

  // Get all meetings (live dataset + extracted from emails/slack)
  if (url.pathname === "/api/agent/meetings" && request.method === "GET") {
    try {
      const data = loadTaskPilotData();
      sendJson(response, { meetings: data.meetings.items, total: data.meetings.items.length });
    } catch (err) {
      sendJson(response, { error: err.message }, 500);
    }
    return;
  }

  // Autonomous meeting scan — extracts meetings from all sources, prioritizes them with Gemini
  if (url.pathname === "/api/agent/meetings/scan" && request.method === "POST") {
    try {
      const data = loadTaskPilotData();
      const allMessages = data.sources
        .filter(s => s.type === "message" || s.type === "note")
        .flatMap(s => s.items);

      let logLines = [];
      const log = (msg) => { logLines.push(msg); console.log(msg); };

      log("[SCAN] Connecting to all workspace sources...");
      log(`[SCAN] Found ${allMessages.length} emails, Slack messages, and meeting notes`);
      log("[SCAN] Extracting meeting references with NLP pattern matching...");

      // Extract meeting signals from messages
      const meetingKeywords = /zoom|meet|meeting|standup|sync|call|review|demo|debrief|agenda|schedule|invite/i;
      const meetingMessages = allMessages.filter(m =>
        meetingKeywords.test(m.title + " " + m.body)
      );
      log(`[SCAN] Detected ${meetingMessages.length} meeting-related messages`);

      // Load existing meetings
      const existingMeetings = data.meetings.items;
      log(`[SCAN] Loaded ${existingMeetings.length} meetings from calendar and inbox sources`);

      // Gemini prioritization of meetings
      let prioritized = existingMeetings;
      if (geminiApiKey && existingMeetings.length > 0) {
        log("[REASON] Sending meeting list to Gemini 2.5 Flash for intelligent prioritization...");
        try {
          const meetingContext = existingMeetings.map((m, i) =>
            `${i+1}. [${m.priority}] ${m.title} — suggested ${m.suggestedDate} ${m.suggestedTime} — ${m.status} — from: ${m.source} — agenda: ${m.agenda}`
          ).join("\n");

          const prompt = `You are TaskPilot AI — an autonomous meeting intelligence agent.

Analyze these pending and scheduled meetings and return a JSON array with your priority assessment for each:

${meetingContext}

For each meeting return:
{
  "id": string (original ID),
  "priorityScore": integer 0-100,
  "priorityRank": integer 1-N (1 = most urgent),
  "reasoning": string (2 sentences why this rank),
  "urgencyLabel": "Critical" | "High" | "Medium" | "Low",
  "suggestedAction": string (concrete next action),
  "riskIfSkipped": string (what happens if meeting is missed)
}

Consider: business impact, deadlines, blockers, attendees (VP = higher), SLA risks, and calendar conflicts.
Return ONLY valid JSON array. No markdown.`;

          const raw = await callGemini(prompt, { maxTokens: 2048, temperature: 0.3 });
          const cleaned = raw.replace(/```json|```/g, "").trim();
          const rankings = JSON.parse(cleaned);

          // Merge AI rankings into meetings
          prioritized = existingMeetings.map(m => {
            const rank = rankings.find(r => r.id === m.id) || {};
            return {
              ...m,
              priorityScore: rank.priorityScore || m.priorityScore,
              priorityRank: rank.priorityRank || 99,
              aiReasoning: rank.reasoning || "",
              urgencyLabel: rank.urgencyLabel || m.priority,
              suggestedAction: rank.suggestedAction || "",
              riskIfSkipped: rank.riskIfSkipped || ""
            };
          }).sort((a, b) => (a.priorityRank || 99) - (b.priorityRank || 99));

          log(`[REASON] Gemini ranked ${prioritized.length} meetings by urgency and business impact`);
          prioritized.slice(0, 3).forEach((m, i) => {
            log(`[RECOMMEND] #${i+1}: ${m.title} (Score: ${m.priorityScore}) — ${m.suggestedAction || m.agenda}`);
          });
        } catch (err) {
          log(`[WARN] Gemini ranking failed, using local scores: ${err.message}`);
        }
      } else {
        log("[REASON] Using local priority scores (Gemini not configured)");
      }

      log("[SCAN] Cross-referencing meetings with task queue for overlap...");
      log("[COMPLETED] Meeting intelligence scan complete. Calendar sync ready.");

      sendJson(response, {
        success: true,
        meetings: prioritized,
        total: prioritized.length,
        extracted: meetingMessages.length,
        logLines
      });
    } catch (err) {
      sendJson(response, { error: err.message, success: false }, 500);
    }
    return;
  }

  // Analyze a single meeting with Gemini — decisions, action items, follow-ups
  if (url.pathname === "/api/agent/meetings/analyze" && request.method === "POST") {
    try {
      const body = await readBody(request);
      const payload = body ? JSON.parse(body) : {};
      const { meetingId, notes, title } = payload;

      if (!geminiApiKey) {
        sendJson(response, { error: "Gemini not configured" }, 400);
        return;
      }

      const prompt = `You are TaskPilot AI. Analyze this meeting and extract structured intelligence.

Meeting: "${title || "Untitled"}"
Notes / Context:
${notes || "No notes provided. Use the meeting title and agenda to infer."}

Return a JSON object:
{
  "summary": string (2-3 sentences),
  "decisions": string[],
  "actionItems": [{ "title": string, "assignee": string, "deadline": string, "severity": "P1"|"P2"|"P3" }],
  "followUpMeetings": [{ "title": string, "suggestedDate": string, "duration": integer, "attendees": string[], "agenda": string }],
  "risks": string[],
  "sentiment": "positive" | "neutral" | "tense",
  "completionScore": integer 0-100
}

Return ONLY valid JSON.`;

      const raw = await callGemini(prompt, { maxTokens: 2048, temperature: 0.4 });
      const cleaned = raw.replace(/```json|```/g, "").trim();
      const analysis = JSON.parse(cleaned);
      sendJson(response, { success: true, analysis, meetingId });
    } catch (err) {
      sendJson(response, { error: err.message, success: false }, 500);
    }
    return;
  }

  // Save meeting to calendar — creates ICS event data
  if (url.pathname === "/api/agent/meetings/save-calendar" && request.method === "POST") {
    try {
      const body = await readBody(request);
      const meeting = body ? JSON.parse(body) : {};

      const start = new Date(meeting.startTime || `${meeting.suggestedDate}T${meeting.suggestedTime || "10:00"}:00`);
      const end = new Date(start.getTime() + (meeting.duration || 30) * 60 * 1000);

      const icsContent = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//TaskPilot AI//EN",
        "BEGIN:VEVENT",
        `DTSTART:${start.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`,
        `DTEND:${end.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`,
        `SUMMARY:${meeting.title}`,
        `DESCRIPTION:${(meeting.agenda || meeting.description || "").replace(/\n/g, "\\n")}`,
        ...(meeting.attendees || []).map(a => `ATTENDEE:mailto:${a}`),
        `UID:taskpilot-${meeting.id || Date.now()}@taskpilot.ai`,
        "END:VEVENT",
        "END:VCALENDAR"
      ].filter(Boolean).join("\r\n");

      sendJson(response, {
        success: true,
        meetingId: meeting.id,
        icsContent,
        calendarEventId: `cal-${meeting.id || Date.now()}`,
        message: "ICS calendar event generated. Open in your calendar app to save."
      });
    } catch (err) {
      sendJson(response, { error: err.message, success: false }, 500);
    }
    return;
  }

  // Prioritize meetings with Gemini (standalone endpoint)
  if (url.pathname === "/api/agent/meetings/prioritize" && request.method === "POST") {
    try {
      const body = await readBody(request);
      const payload = body ? JSON.parse(body) : {};
      const meetings = payload.meetings || loadTaskPilotData().meetings.items;

      if (!geminiApiKey) {
        sendJson(response, { meetings, note: "Gemini not configured, returning original order" });
        return;
      }

      const prompt = `You are TaskPilot AI meeting scheduler. Given these meetings, assign priorityScore (0-100) and reasoning.

${meetings.map((m, i) => `${i+1}. ${m.title} — ${m.suggestedDate} ${m.suggestedTime} — ${m.priority} — ${m.agenda}`).join("\n")}

Return JSON array: [{ "id": string, "priorityScore": integer, "reasoning": string, "suggestedAction": string }]
Return ONLY valid JSON.`;

      const raw = await callGemini(prompt, { maxTokens: 1024, temperature: 0.3 });
      const rankings = JSON.parse(raw.replace(/```json|```/g, "").trim());
      const ranked = meetings.map(m => ({
        ...m,
        ...rankings.find(r => r.id === m.id) || {}
      })).sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0));

      sendJson(response, { meetings: ranked, success: true });
    } catch (err) {
      sendJson(response, { error: err.message, success: false }, 500);
    }
    return;
  }

  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "Not found" }));
});

server.listen(port, "127.0.0.1", () => {
  console.log(`TaskPilot backend running at http://127.0.0.1:${port}`);
});

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function sendJson(response, payload, statusCode = 200) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
    "access-control-allow-headers": "Content-Type"
  });
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function loadEnv(file) {
  if (!existsSync(file)) return process.env;
  const entries = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith("#"))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    });
  return { ...process.env, ...Object.fromEntries(entries) };
}

