/**
 * Gemini Client — calls Gemini directly via the REST API.
 * Tries Electron IPC first, then direct Google AI REST API, then backend as last resort.
 */

const BACKEND = "http://127.0.0.1:8787";
const DEFAULT_MODEL = "gemini-2.5-flash";
// API key embedded for direct browser calls (frontend-only build, no backend required)
const GEMINI_API_KEY = "AIzaSyA08RN6IS0x2s-K3uIDqwlwqPrN1MTt31o_GiA0dFyqdUobHifQ";

let _backendModel = DEFAULT_MODEL;
export function setModel(m) { _backendModel = m || DEFAULT_MODEL; }

// ─── Direct REST call to Google Generative Language API ───────────────────────
async function geminiDirect(prompt, model) {
  const apiModel = model.startsWith("gemini") ? model : "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${apiModel}:generateContent?key=${GEMINI_API_KEY}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
    })
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Gemini API ${resp.status}: ${err}`);
  }
  const data = await resp.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return text;
}

// ─── Core call ────────────────────────────────────────────────────────────────

export async function geminiChat(prompt, { model, onChunk } = {}) {
  const useModel = model || _backendModel;

  // 1. Electron: use IPC so the API key never leaves the main process
  if (window.taskPilotDesktop?.geminiChat) {
    const result = await window.taskPilotDesktop.geminiChat(prompt, useModel);
    if (!result.success) throw new Error(result.error);
    if (onChunk) onChunk(result.text);
    return result.text;
  }

  // 2. Direct Google AI REST API (works without backend server)
  try {
    const text = await geminiDirect(prompt, useModel);
    if (onChunk) onChunk(text);
    return text;
  } catch (directErr) {
    // 3. Fallback: try local backend
    try {
      const resp = await fetch(`${BACKEND}/api/taskpilot/gemini-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, model: useModel })
      });
      if (!resp.ok) throw new Error(`backend ${resp.status}`);
      const data = await resp.json();
      if (onChunk) onChunk(data.text);
      return data.text;
    } catch {
      throw directErr; // surface the original direct API error
    }
  }
}

// ─── Specialised helpers ──────────────────────────────────────────────────────

/** Prioritise a flat task list; returns tasks with score + rankReasons */
export async function geminPrioritizeTasks(tasks) {
  const prompt = `You are TaskPilot AI — an agentic task prioritisation assistant.

Given the JSON array of engineering tasks below, rank them from highest to lowest priority.
For each task add TWO fields:
  "score": integer 0–100
  "rankReasons": array of 3 short strings explaining the score

Use these factors: severity (P1>P2>P3>P4), deadline urgency, business impact, dependency risk.
Return ONLY a valid JSON array. No markdown, no explanation outside JSON.

Tasks:
${JSON.stringify(tasks, null, 2)}`;

  const raw = await geminiChat(prompt, { model: "gemini-2.5-flash" });
  try {
    return JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch {
    console.warn("Gemini returned non-JSON prioritisation response, using local scores");
    return tasks;
  }
}

/** Extract action items from unstructured text (email / meeting note) */
export async function geminiExtractActions(text, source = "email") {
  const prompt = `You are TaskPilot AI. Extract every actionable task from this ${source}.

Return a JSON array where each item has:
  "title": concise task title (max 80 chars)
  "description": one sentence detail
  "assignee": person mentioned, or ""
  "deadline": ISO date if mentioned, or null
  "severity": "P1"|"P2"|"P3"|"P4" — infer from urgency language
  "impact": integer 1–10

Return ONLY valid JSON. No markdown.

Text:
${text}`;

  const raw = await geminiChat(prompt, { model: "gemini-2.5-flash" });
  try {
    return JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch {
    return [];
  }
}

/** Generate a full daily plan narrative */
export async function geminiDailyPlan(tasks, engineerName, calendarBlocks = []) {
  const top = tasks.slice(0, 8);
  const meetings = calendarBlocks.map(b => `${b.start}–${b.end}: ${b.title}`).join(", ");
  const prompt = `You are TaskPilot AI. Generate a structured, actionable daily plan for ${engineerName}.

Today's calendar blocks: ${meetings || "none"}

Top prioritised tasks (in order):
${top.map((t, i) => `${i + 1}. [${t.severity || "P2"}] ${t.canonicalTitle || t.title} — score ${t.score || "?"} — due ${t.due || "?"}`).join("\n")}

Write a clear markdown daily plan with:
- A one-sentence motivating opener
- ### Top 3 Priorities (with 1-line rationale each)
- ### Time-Blocked Schedule (fit around calendar blocks)
- ### Watch List (next 3 tasks)
- ### End-of-Day Goal

Be concise, direct, and actionable. Use real task names.`;

  return geminiChat(prompt, { model: "gemini-2.5-flash" });
}

/** Summarise an email thread into bullet points + action items */
export async function geminiSummariseEmail(emailBody, subject = "") {
  const prompt = `You are TaskPilot AI. Summarise this email for a software engineer.

Subject: ${subject}
Body:
${emailBody}

Return markdown with:
- **TL;DR** (one sentence)
- **Key Points** (bullet list)
- **Action Items** (bullet list, each starting with ✅)
- **Urgency**: Critical / High / Medium / Low`;

  return geminiChat(prompt, { model: "gemini-2.5-flash" });
}

/** Analyse meeting notes and extract decisions + follow-ups + meetings to schedule */
export async function geminiAnalyseMeeting(notes, meetingTitle = "") {
  const prompt = `You are TaskPilot AI. Analyse these meeting notes for "${meetingTitle}".

Notes:
${notes}

Return a JSON object with:
  "summary": string (2–3 sentences)
  "decisions": string[] (key decisions made)
  "actionItems": [{ "title", "assignee", "deadline", "severity" }]
  "followUpMeetings": [{ "title", "suggestedDate", "attendees": [], "agenda": string }]
  "risks": string[]

Return ONLY valid JSON.`;

  const raw = await geminiChat(prompt, { model: "gemini-2.5-flash" });
  try {
    return JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch {
    return {
      summary: "Could not parse meeting analysis.",
      decisions: [],
      actionItems: [],
      followUpMeetings: [],
      risks: []
    };
  }
}

/** Answer a natural language question about the current task state */
export async function geminiAnswerQuery(question, state) {
  const top5 = state.prioritized.slice(0, 5).map((t, i) =>
    `${i + 1}. [${t.severity}] ${t.canonicalTitle} — score ${t.score} — due ${t.due}`
  ).join("\n");

  const prompt = `You are TaskPilot AI — an intelligent, proactive engineering assistant.

Current state:
- Total tasks: ${state.prioritized.length}
- Completed today: ${state.completedCount}
- Top 5 tasks:\n${top5}
- Active alerts: ${state.alerts.length}

Engineer's question: "${question}"

Answer concisely (2–4 sentences max). Be specific, data-driven, and actionable.
Reference real task names and scores when relevant.`;

  return geminiChat(prompt, { model: "gemini-2.5-flash" });
}

/** Real-time agent reasoning — calls onChunk for each streamed step */
export async function geminiAgentRun(intent, context, onStep) {
  const prompt = `You are TaskPilot AI — an autonomous agentic assistant.

Current context:
- Active task: ${context.activeTask}
- Total queue: ${context.queueSize} tasks
- Sources connected: ${context.sources}
- Profile: ${context.profile}

The engineer just asked: "${intent}"

Act like a real AI agent: reason step-by-step, check priorities, surface hidden risks, and give a concrete recommendation.
Format your response as:

🔍 **Scanning...** (what you checked)
🧠 **Reasoning...** (your analysis)  
⚡ **Recommendation:** (specific, actionable next step)
📊 **Confidence:** X% (your confidence in this recommendation)

Be specific, reference real data, and act proactively.`;

  return geminiChat(prompt, { model: "gemini-2.5-flash", onChunk: onStep });
}

/** Generate weekly standup summary */
export async function geminiWeeklyStandup(tasks, completedIds, engineerName) {
  const completed = tasks.filter(t => completedIds.includes(t.id));
  const pending = tasks.filter(t => !completedIds.includes(t.id));

  const prompt = `You are TaskPilot AI. Generate a standup-ready weekly summary for ${engineerName}.

Completed this week (${completed.length}):
${completed.map(t => `- ${t.canonicalTitle || t.title}`).join("\n") || "None"}

Still pending (${pending.slice(0, 5).length}):
${pending.slice(0, 5).map(t => `- [${t.severity}] ${t.canonicalTitle || t.title} (score: ${t.score})`).join("\n")}

Write a 3-paragraph weekly summary:
1. Accomplishments (what was done)
2. In-progress and blockers
3. Next week priorities and risks

Keep it professional and suitable for a manager standup report.`;

  return geminiChat(prompt, { model: "gemini-2.5-flash" });
}

/** Analyse meeting for scheduling — returns suggested meeting slots */
export async function geminiMeetingPrioritizer(meetings, calendarBlocks) {
  const prompt = `You are TaskPilot AI. Analyse these pending meetings and upcoming calendar blocks.

Pending meetings to schedule:
${JSON.stringify(meetings, null, 2)}

Existing calendar blocks:
${JSON.stringify(calendarBlocks, null, 2)}

Return a JSON array of recommended meeting schedules:
[{
  "meetingTitle": string,
  "priority": "Critical"|"High"|"Medium"|"Low",
  "priorityScore": integer 0-100,
  "suggestedTime": ISO datetime string,
  "duration": minutes as integer,
  "reasoning": string,
  "attendees": string[],
  "agenda": string,
  "isConflict": boolean,
  "conflictsWith": string or null
}]

Return ONLY valid JSON.`;

  const raw = await geminiChat(prompt, { model: "gemini-2.5-flash" });
  try {
    return JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch {
    return [];
  }
}
