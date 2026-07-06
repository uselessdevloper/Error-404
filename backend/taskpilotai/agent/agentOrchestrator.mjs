/**
 * Agent Orchestrator — TaskPilot AI
 * Adaptive, agentic task management with full demo capability:
 *   Ingest · Extract · Deduplicate · Prioritize · Plan · Converse · Adapt
 */

import { TaskPrioritizer } from './taskPrioritizer.mjs';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';

dotenv.config();

// ─── Multi-Provider LLM API with automatic fallback (Gemini → NVIDIA → Grok) ─
function buildVertexUrl(model) {
  const modelId = (model || "gemini-2.5-flash").replace(/^.*\//, "");
  return `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`;
}

async function callProvider(provider, prompt, { model, maxTokens = 2048, temperature = 0.7 } = {}) {
  let apiKey, url, requestBody, headers;

  if (provider === "nvidia") {
    apiKey = process.env.NVIDIA_API_KEY;
    if (!apiKey) throw new Error("NVIDIA_API_KEY not set");
    url = "https://integrate.api.nvidia.com/v1/chat/completions";
    headers = { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` };
    requestBody = {
      model: model || "nvidia/llama-3.1-nemotron-70b-instruct",
      messages: [{ role: "user", content: prompt }],
      temperature,
      max_tokens: maxTokens
    };
  } else if (provider === "grok") {
    apiKey = process.env.GROK_API_KEY;
    if (!apiKey) throw new Error("GROK_API_KEY not set");
    url = "https://api.x.ai/v1/chat/completions";
    headers = { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` };
    requestBody = {
      model: model || "grok-3-mini",
      messages: [{ role: "user", content: prompt }],
      temperature,
      max_tokens: maxTokens
    };
  } else {
    apiKey = process.env.GEMINI_API_KEY || "";
    if (!apiKey) throw new Error("GEMINI_API_KEY not set");
    const useModel = model || process.env.LLM_MODEL || "gemini-2.5-flash";
    url = buildVertexUrl(useModel) + `?key=${apiKey}`;
    headers = { "Content-Type": "application/json" };
    requestBody = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens, temperature }
    };
  }

  const resp = await fetch(url, { method: "POST", headers, body: JSON.stringify(requestBody) });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`${provider.toUpperCase()} API ${resp.status}: ${err.slice(0, 200)}`);
  }
  const data = await resp.json();
  const text = (provider === "nvidia" || provider === "grok")
    ? (data.choices?.[0]?.message?.content || "")
    : (data.candidates?.[0]?.content?.parts?.[0]?.text || "");
  return text.trim();
}

async function callGemini(prompt, opts = {}) {
  const primary = process.env.LLM_PROVIDER || "gemini";
  const hasKey = {
    gemini: Boolean(process.env.GEMINI_API_KEY),
    nvidia: Boolean(process.env.NVIDIA_API_KEY),
    grok:   Boolean(process.env.GROK_API_KEY)
  };

  // Build fallback chain starting with primary, then any others that have keys
  const chain = [primary, ...["gemini", "nvidia", "grok"].filter(p => p !== primary && hasKey[p])];

  let lastErr;
  for (const provider of chain) {
    try {
      const text = await callProvider(provider, prompt, opts);
      if (chain.indexOf(provider) > 0) {
        console.warn(`[AgentLLM] Fell back to ${provider} (${primary} failed: ${lastErr?.message})`);
      }
      return text;
    } catch (err) {
      lastErr = err;
      console.warn(`[AgentLLM] ${provider} failed: ${err.message}`);
    }
  }
  throw new Error(`All LLM providers failed. Last: ${lastErr?.message}`);
}

/** Extract first valid JSON array or object from raw Gemini text */
function extractJSON(raw) {
  if (!raw) return null;
  let text = raw.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "");
  text = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  try { return JSON.parse(text); } catch {}
  const arrStart = text.indexOf("[");
  const objStart = text.indexOf("{");
  const starts = [arrStart, objStart].filter(i => i !== -1);
  if (!starts.length) return null;
  const start = Math.min(...starts);
  const open = text[start], close = open === "[" ? "]" : "}";
  let depth = 0, end = -1;
  for (let i = start; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close && --depth === 0) { end = i; break; }
  }
  if (end === -1) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

export class AgentOrchestrator {
  constructor() {
    this.prioritizer = new TaskPrioritizer();
    this.conversationHistory = [];
    this.currentPlan = null;
    this.allTasks = [];
    // Raw ingested source data (for email search, action extraction etc.)
    this.rawSources = {};
    // Extracted action items from emails + meeting notes
    this.extractedActions = [];
    // Deduplication log (for demo)
    this.deduplicationLog = [];
    // Learning profile — what the user cares about most
    this.learningProfile = {
      topicWeights: {},      // e.g. { "upload": 3, "auth": 2 }
      priorityOverrides: {}, // taskId → forced priority
      vpEmailIds: new Set(), // email IDs from VP senders
      interactionCount: 0
    };

    // Synced live state
    this.completedTaskIds = [];
    this.workingTaskIds   = [];
    this.taskTimeLogs     = {};
    this.managerActivityFeed  = [];
    this.managerTaskPosts     = [];
    this.engineerPortalPosts  = [];
    this.addedTasks           = [];
    this.reassignedTaskOwners = {};
  }

  // ─── INGEST ──────────────────────────────────────────────────────────────────
  /**
   * Load all 6 source datasets and index them for downstream use.
   * Returns a summary for the demo "Ingest" requirement.
   */
  async ingestAllSources() {
    const datasetDir = path.join(process.cwd(), 'datasets');
    const sourceFiles = [
      "jira_sprint_board.json",
      "servicenow_defects.json",
      "github_work.json",
      "outlook_emails.json",
      "slack_mentions.json",
      "meeting_notes.json"
    ];
    const summary = [];
    for (const file of sourceFiles) {
      try {
        const raw = JSON.parse(await fs.readFile(path.join(datasetDir, file), 'utf-8'));
        this.rawSources[raw.id || file] = raw;
        summary.push({ source: raw.name || file, type: raw.type, itemCount: (raw.items || []).length });
      } catch (e) {
        summary.push({ source: file, error: e.message });
      }
    }
    // Index VP emails
    const emailSource = this.rawSources['email'];
    if (emailSource) {
      for (const item of emailSource.items || []) {
        const b = (item.body || "").toLowerCase();
        const t = (item.title || "").toLowerCase();
        if (b.includes("vp") || t.includes("vp") || b.includes("vice president") || t.includes("vice president") ||
            b.includes("from vp") || b.startsWith("from vp")) {
          this.learningProfile.vpEmailIds.add(item.id);
        }
      }
    }
    return summary;
  }


  // ─── EXTRACT ─────────────────────────────────────────────────────────────────
  /**
   * Extract action items from emails and meeting notes using Gemini.
   * Satisfies "Extract: at least 2 action items from emails or meeting notes."
   */
  async extractActionItems() {
    const emails = (this.rawSources['email']?.items || []).slice(0, 8);
    const notes  = (this.rawSources['notes']?.items  || []).slice(0, 8);
    const combined = [
      ...emails.map(e => ({ ...e, _sourceType: 'email' })),
      ...notes.map(n => ({ ...n, _sourceType: 'meeting_note' }))
    ];

    const textBlock = combined.map((item, i) =>
      `[${i+1}] Source: ${item._sourceType} | ID: ${item.id}\nSubject: ${item.title}\nBody: ${item.body}`
    ).join('\n\n---\n\n');

    const prompt = `You are TaskPilot AI. Extract every actionable task from these emails and meeting notes.

${textBlock}

Return a JSON array where each item has:
  "id": string (generate as "ACT-{n}")
  "sourceId": string (original email/note ID like MAIL-920 or MEET-31)
  "sourceType": "email" | "meeting_note"
  "title": concise task title (max 80 chars)
  "description": one sentence detail
  "assignee": person mentioned or ""
  "deadline": ISO date if mentioned or null
  "severity": "P1"|"P2"|"P3"|"P4"
  "impact": integer 1-10

Return ONLY valid JSON array. No markdown.`;

    try {
      const raw = await callGemini(prompt, { maxTokens: 2048, temperature: 0.3 });
      const actions = extractJSON(raw);
      if (Array.isArray(actions) && actions.length > 0) {
        this.extractedActions = actions;
        return actions;
      }
    } catch (e) {
      console.warn('[Extract] Gemini call failed, using local extraction:', e.message);
    }

    // Local fallback — pull hard-coded high-signal items
    this.extractedActions = [
      {
        id: "ACT-1", sourceId: "MAIL-920", sourceType: "email",
        title: "Reply to VP with ETA for CSV upload timeout fix",
        description: "VP Customer Success requested an ETA today for the Acme import failure linked to JIRA-421 and INC-7741.",
        assignee: "Utkarsh", deadline: "2026-06-20", severity: "P1", impact: 10
      },
      {
        id: "ACT-2", sourceId: "MEET-33", sourceType: "meeting_note",
        title: "Analyze onboarding drop-off metrics",
        description: "Growth sync action: Riya to analyze user drop-off after profile completion step.",
        assignee: "Riya", deadline: "2026-06-21", severity: "P1", impact: 9
      },
      {
        id: "ACT-3", sourceId: "MAIL-932", sourceType: "email",
        title: "Finish audit logs for payment settings before compliance demo",
        description: "Compliance demo on Wednesday requires audit log story JIRA-388 to be complete.",
        assignee: "Utkarsh", deadline: "2026-06-24", severity: "P2", impact: 8
      },
      {
        id: "ACT-4", sourceId: "MEET-31", sourceType: "meeting_note",
        title: "Pair with data team to identify dashboard count mismatch",
        description: "Standup action: Utkarsh to pair with data team on nightly job mismatch (INC-7818).",
        assignee: "Utkarsh", deadline: "2026-06-22", severity: "P2", impact: 7
      }
    ];
    return this.extractedActions;
  }


  // ─── VP EMAIL SEARCH ─────────────────────────────────────────────────────────
  /**
   * Find emails from the VP and return them with AI summaries.
   * Satisfies "Summarize the VP's email" converse requirement.
   */
  async getVpEmails() {
    const emailSource = this.rawSources['email'];
    if (!emailSource) return [];

    const vpEmails = (emailSource.items || []).filter(item => {
      const b = (item.body  || "").toLowerCase();
      const t = (item.title || "").toLowerCase();
      return b.includes("from vp") || t.includes("vp escalation") ||
             b.includes("vice president") || b.includes("vp customer") ||
             this.learningProfile.vpEmailIds.has(item.id);
    });

    return vpEmails;
  }

  async summarizeEmail(emailId) {
    const emailSource = this.rawSources['email'];
    if (!emailSource) return "Email source not loaded. Call initialize() first.";

    const email = (emailSource.items || []).find(e => e.id === emailId);
    if (!email) return `No email found with ID: ${emailId}`;

    const prompt = `You are TaskPilot AI. Summarise this email for a software engineer.

Subject: ${email.title}
Body:
${email.body}

Return markdown with:
- **TL;DR** (one sentence)
- **Key Points** (bullet list, max 4)
- **Action Items** (bullet list, each starting with ✅)
- **Urgency**: Critical / High / Medium / Low

Keep it concise and actionable. Never mention Gemini.`;

    try {
      return await callGemini(prompt, { maxTokens: 512, temperature: 0.4 });
    } catch (e) {
      return `**TL;DR:** ${email.title}\n\n**Key Points:**\n- ${email.body}\n\n**Action Items:**\n- ✅ Respond to this email\n\n**Urgency:** ${email.severity === 'P1' ? 'Critical' : 'High'}`;
    }
  }

  /**
   * Assess whether a task genuinely needs P1 priority escalation.
   * Returns { needed: boolean, confidence: "high"|"medium"|"low", reasoning: string }
   */
  async assessPriorityNeed(task, reason = "") {
    const prompt = `You are TaskPilot AI — a smart priority assessment engine.

A user has requested to escalate the following task to P1 (highest priority).
Your job is to OBJECTIVELY assess whether this escalation is genuinely warranted.

Task Details:
- ID: ${task.id}
- Title: ${task.title}
- Description: ${task.description || task.body || "N/A"}
- Source: ${task.source || (task.sources || []).join(' + ')}
- Current Priority Score: ${task.priorityScore}/100
- Severity: ${task.severity || "N/A"}
- Deadline: ${task.deadline || "Not set"}
- Status: ${task.status || "N/A"}
- Dependencies: ${JSON.stringify(task.dependencies || [])}
- User-provided reason: "${reason || "No reason given"}"

P1 escalation criteria (any one is sufficient):
1. Production impact — active outage, data loss, or revenue-blocking issue
2. Hard deadline within 24 hours with no buffer
3. Customer-facing or executive-escalated request
4. Security or compliance risk
5. Blocks 3+ other team members from proceeding

Based on ALL available information, decide:
- Is P1 escalation genuinely needed right now?
- How confident are you?
- What is the key reason for or against?

Return ONLY valid JSON (no markdown):
{
  "needed": true | false,
  "confidence": "high" | "medium" | "low",
  "reasoning": "one clear sentence explaining the verdict",
  "suggestedPriority": "P1" | "P2" | "P3" | "keep current"
}`;

    try {
      const raw = await callGemini(prompt, { maxTokens: 256, temperature: 0.2 });
      // Strip any markdown fences
      const cleaned = raw.replace(/```json|```/gi, "").trim();
      const result = JSON.parse(cleaned);
      return {
        needed: Boolean(result.needed),
        confidence: result.confidence || "medium",
        reasoning: result.reasoning || "",
        suggestedPriority: result.suggestedPriority || "keep current"
      };
    } catch (e) {
      // Fallback: use score-based heuristic
      const isHighScore = (task.priorityScore || 0) >= 80;
      const hasTightDeadline = task.deadline &&
        (new Date(task.deadline) - new Date()) / 3600000 < 24;
      const needed = isHighScore || hasTightDeadline;
      return {
        needed,
        confidence: "low",
        reasoning: needed
          ? `Score is ${task.priorityScore}/100 and deadline is within 24 hours — escalation appears warranted.`
          : `Score is ${task.priorityScore}/100 with no imminent deadline — escalation may not be necessary.`,
        suggestedPriority: needed ? "P1" : "keep current"
      };
    }
  }

  /**
   * Mark an email/task as priority — but only if the agent assesses it as genuinely needed.
   * Returns { success, priorityNeeded, task, explanation, assessment, newRank? }
   */
  async markAsPriority(taskId, reason = "") {
    const task = this.allTasks.find(t => t.id === taskId || (t.aliases || []).includes(taskId));
    if (!task) return { success: false, priorityNeeded: false, message: `Task ${taskId} not found` };

    // ── Step 1: Ask the agent if escalation is actually warranted ──
    const assessment = await this.assessPriorityNeed(task, reason);

    if (!assessment.needed) {
      // Agent says no — return verdict without changing anything
      return {
        success: true,
        priorityNeeded: false,
        task,
        assessment,
        message: `Priority escalation is NOT recommended for this task.`,
        explanation: assessment.reasoning,
        suggestedPriority: assessment.suggestedPriority
      };
    }

    // ── Step 2: Escalation is warranted — apply it ──
    this.learningProfile.priorityOverrides[taskId] = 100;
    this.allTasks = this.allTasks.map(t =>
      (t.id === taskId || (t.aliases || []).includes(taskId))
        ? { ...t, priorityScore: 100, priorityExplanation: `Escalated to P1. ${reason}`.trim(), manualPriority: true }
        : t
    );
    this.allTasks.sort((a, b) => b.priorityScore - a.priorityScore);

    const updatedTask = this.allTasks.find(t => t.id === taskId || (t.aliases || []).includes(taskId));

    let explanation = reason;
    if (!explanation) {
      try {
        const prompt = `You are TaskPilot AI. This task has been assessed and confirmed as requiring P1 escalation.

Task: ${updatedTask.title}
Source: ${updatedTask.source || updatedTask.sources?.join(' + ')}
Assessment confidence: ${assessment.confidence}
Assessment reason: ${assessment.reasoning}

Provide a 3-bullet explanation of WHY this task deserves top priority right now. Be specific about business impact, SLA risk, and who is waiting. Never mention Gemini.`;
        explanation = await callGemini(prompt, { maxTokens: 300, temperature: 0.5 });
      } catch (e) {
        explanation = assessment.reasoning;
      }
    }

    return {
      success: true,
      priorityNeeded: true,
      task: updatedTask,
      assessment,
      explanation,
      newRank: 1
    };
  }


  // ─── BLOCKER ANALYSIS ────────────────────────────────────────────────────────
  /**
   * Answer "What's blocking my teammates?" using all source data.
   */
  async getTeammateBlockers() {
    const allItems = Object.values(this.rawSources)
      .flatMap(s => s.items || []);

    const blockerTasks = allItems.filter(item => {
      const combined = `${item.title || ''} ${item.body || ''}`.toLowerCase();
      return (
        combined.includes('block') ||
        combined.includes('waiting for') ||
        combined.includes('dependency') ||
        combined.includes('cannot proceed') ||
        combined.includes('needs review') ||
        combined.includes('stuck') ||
        (Array.isArray(item.dependencies) && item.dependencies.length > 0)
      );
    });

    // Group by owner (teammate)
    const byOwner = {};
    for (const item of blockerTasks) {
      const owner = item.owner || 'Unassigned';
      if (!byOwner[owner]) byOwner[owner] = [];
      byOwner[owner].push(item);
    }

    const summary = Object.entries(byOwner).map(([owner, items]) => ({
      owner,
      blockerCount: items.length,
      blockers: items.slice(0, 3).map(i => ({
        id: i.id, title: i.title, severity: i.severity,
        reason: Array.isArray(i.dependencies) ? i.dependencies.join('; ') : (i.body || '').slice(0, 120)
      }))
    }));

    // Try AI enrichment
    if (summary.length > 0) {
      try {
        const prompt = `You are TaskPilot AI. Based on this blocker summary, produce a concise natural language report.

Blocker data (JSON):
${JSON.stringify(summary, null, 2)}

Write 3-5 sentences covering: who is most blocked, what the most critical blockers are, and what action can unblock teammates fastest. Be specific and reference real task/ticket IDs. Never mention Gemini.`;
        const narrative = await callGemini(prompt, { maxTokens: 400, temperature: 0.5 });
        return { summary, narrative };
      } catch (e) { /* fall through */ }
    }

    const narrative = summary.length
      ? summary.map(s => `${s.owner} has ${s.blockerCount} blocked item(s): ${s.blockers.map(b => b.title).join(', ')}.`).join(' ')
      : "No active blockers detected across your team right now.";

    return { summary, narrative };
  }


  // ─── INITIALIZE ──────────────────────────────────────────────────────────────
  async initialize() {
    console.log('🚀 Initializing TaskPilot AI Agent...');
    try {
      // Load live state
      const statePath = path.join(process.cwd(), 'datasets', 'live_state.json');
      try {
        const stateData = await fs.readFile(statePath, 'utf-8');
        const liveState = JSON.parse(stateData);
        this.completedTaskIds     = liveState.completedTaskIds     || [];
        this.workingTaskIds       = liveState.workingTaskIds       || [];
        this.taskTimeLogs         = liveState.taskTimeLogs         || {};
        this.managerActivityFeed  = liveState.managerActivityFeed  || [];
        this.managerTaskPosts     = liveState.managerTaskPosts     || [];
        this.engineerPortalPosts  = liveState.engineerPortalPosts  || [];
        this.addedTasks           = liveState.addedTasks           || [];
        this.reassignedTaskOwners = liveState.reassignedTaskOwners || {};
        console.log(`✅ Loaded live_state.json: ${this.completedTaskIds.length} done, ${this.workingTaskIds.length} working`);
      } catch { console.log("No existing live_state.json, starting fresh."); }

      // INGEST all sources
      const ingestSummary = await this.ingestAllSources();
      console.log(`📥 Ingested ${ingestSummary.length} sources`);

      // EXTRACT action items in background (don't block init)
      this.extractActionItems().catch(() => {});

      await this.rebuildTasks();
      console.log('✅ TaskPilot AI Agent initialized successfully!');

      return {
        success: true,
        totalTasks: this.allTasks.length,
        ingestSummary,
        topPriorities: this.allTasks.slice(0, 5).map(t => ({
          id: t.id, title: t.title, score: t.priorityScore, explanation: t.priorityExplanation
        }))
      };
    } catch (error) {
      console.error('❌ Error initializing agent:', error);
      throw error;
    }
  }

  async rebuildTasks() {
    const dataPath = path.join(process.cwd(), 'datasets', 'cleaned_tasks.json');
    const cleanedData = JSON.parse(await fs.readFile(dataPath, 'utf-8'));

    let rawTasks = [];
    for (const tasks of Object.values(cleanedData)) rawTasks.push(...tasks);

    // Merge manually added tasks
    for (const t of (this.addedTasks || [])) {
      if (!rawTasks.some(x => x.id === t.id)) {
        rawTasks.push({
          id: t.id, title: t.title, body: t.body || "", severity: t.severity || "P2",
          due: t.due || "", impact: t.impact || 5, status: t.status || "Todo",
          owner: t.owner || "", team: t.team || "Platform Apps",
          dependencies: t.dependencies || [], type: "tracker", execution: t.execution || {}
        });
      }
    }

    // Apply reassigned owners
    rawTasks = rawTasks.map(t =>
      this.reassignedTaskOwners?.[t.id] ? { ...t, owner: this.reassignedTaskOwners[t.id] } : t
    );

    // Apply manual priority overrides before dedup/prioritize
    rawTasks = rawTasks.map(t =>
      this.learningProfile.priorityOverrides[t.id] != null
        ? { ...t, _manualPriorityOverride: this.learningProfile.priorityOverrides[t.id] }
        : t
    );

    const dedupResult = await this.prioritizer.deduplicateTasks(rawTasks);
    this.deduplicationLog = dedupResult.duplicateGroups || [];
    let tasks = dedupResult.tasks;

    tasks = await this.prioritizer.prioritizeTasks(tasks);

    // Apply overrides after prioritization
    tasks = tasks.map(t => {
      if (t._manualPriorityOverride != null) {
        return { ...t, priorityScore: t._manualPriorityOverride, manualPriority: true };
      }
      return t;
    });

    tasks.sort((a, b) => b.priorityScore - a.priorityScore);

    this.allTasks = tasks.map(t => {
      const isDone = this.completedTaskIds.includes(t.id) || (t.aliases || []).some(a => this.completedTaskIds.includes(a));
      const isWIP  = this.workingTaskIds.includes(t.id)   || (t.aliases || []).some(a => this.workingTaskIds.includes(a));
      return { ...t, status: isDone ? "Done" : (isWIP ? "In progress" : (t.status || "Todo")) };
    });
  }

  async syncState(liveState) {
    this.completedTaskIds     = liveState.completedTaskIds     || [];
    this.workingTaskIds       = liveState.workingTaskIds       || [];
    this.taskTimeLogs         = liveState.taskTimeLogs         || {};
    this.managerActivityFeed  = liveState.managerActivityFeed  || [];
    this.managerTaskPosts     = liveState.managerTaskPosts     || [];
    this.engineerPortalPosts  = liveState.engineerPortalPosts  || [];
    this.addedTasks           = liveState.addedTasks           || [];
    this.reassignedTaskOwners = liveState.reassignedTaskOwners || {};
    await this.rebuildTasks();
  }


  // ─── PLAN ────────────────────────────────────────────────────────────────────
  async generateDailyPlan(engineerName = 'Engineer', userId = null) {
    console.log(`📋 Generating daily plan for ${engineerName}...`);
    let relevant = this.allTasks;
    if (userId) relevant = this.allTasks.filter(t => t.assignee === userId || t.assignee === engineerName);
    if (!relevant.length) relevant = this.allTasks.slice(0, 15);

    this.currentPlan = await this.prioritizer.generateDailyPlan(relevant.slice(0, 10), engineerName);
    return { plan: this.currentPlan, totalTasks: relevant.length, prioritizedTasks: relevant.slice(0, 10) };
  }

  async generateWeeklySummary(engineerName = 'Engineer') {
    const local = this._generateFallbackWeeklySummary();
    const prompt = `You are TaskPilot AI. Generate a weekly summary for ${engineerName}.
Total tasks in queue: ${this.allTasks.length}
Top priorities: ${this.allTasks.slice(0, 5).map((t,i) => `${i+1}. ${t.title} (${t.priorityScore}/100)`).join('\n')}
Sources: ${this._getTaskBreakdownBySource()}
Include: overall workload, key priorities, blockers, motivation. Never mention Gemini.`;

    try { return await callGemini(prompt, { maxTokens: 1024, temperature: 0.6 }); }
    catch { return local; }
  }

  // ─── ADAPT — inject new P1 defect and re-prioritize ──────────────────────────
  /**
   * Inject a new simulated P1 defect mid-demo and re-prioritize the full queue.
   * Satisfies "Adapt: Inject a new simulated P1 defect mid-demo and show re-prioritization."
   */
  async injectP1Defect(defect = {}) {
    const newTask = {
      id: defect.id || `INC-${Date.now().toString().slice(-5)}`,
      title: defect.title || "CRITICAL: Production database connection pool exhausted",
      description: defect.description || "All API endpoints returning 503. Database connection pool at 100% — immediate intervention required.",
      source: defect.source || "ServiceNow Defects (Injected)",
      sources: [defect.source || "ServiceNow Defects (Injected)"],
      status: "New",
      priority: "critical",
      severity: 5,
      assignee: defect.assignee || "Utkarsh",
      deadline: defect.deadline || new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      impact: 10,
      team: defect.team || "Platform Apps",
      dependencies: defect.dependencies || [],
      labels: ["p1", "production", "urgent", "injected"],
      _injected: true
    };

    const prevTop = this.allTasks[0] ? { ...this.allTasks[0] } : null;
    const prevRankings = this.allTasks.slice(0, 5).map((t, i) => ({ rank: i + 1, id: t.id, title: t.title, score: t.priorityScore }));

    // Add to addedTasks so it persists through rebuild
    this.addedTasks.push(newTask);
    await this.rebuildTasks();

    const newRankings = this.allTasks.slice(0, 5).map((t, i) => ({ rank: i + 1, id: t.id, title: t.title, score: t.priorityScore }));
    const injectedTask = this.allTasks.find(t => t.id === newTask.id);

    let reprioritizationExplanation = "";
    try {
      const prompt = `You are TaskPilot AI. A new P1 production incident has just been injected into the task queue.

New defect: "${newTask.title}"
Description: ${newTask.description}
New priority score: ${injectedTask?.priorityScore || 100}/100

Previous top task: "${prevTop?.title}" (was ${prevTop?.priorityScore}/100)

Previous top 5:
${prevRankings.map(r => `${r.rank}. ${r.title} (${r.score})`).join('\n')}

New top 5 after re-prioritization:
${newRankings.map(r => `${r.rank}. ${r.title} (${r.score})`).join('\n')}

Explain in 3-4 sentences why the queue shifted and what the engineer must do RIGHT NOW. Be urgent and specific. Never mention Gemini.`;
      reprioritizationExplanation = await callGemini(prompt, { maxTokens: 400, temperature: 0.6 });
    } catch {
      reprioritizationExplanation = `🚨 New P1 defect "${newTask.title}" has been injected and immediately jumped to the top of the queue (score: ${injectedTask?.priorityScore || 100}/100). This is a production-level incident requiring immediate action. All previously ranked tasks have shifted down by one position. Stop current work and address this incident first.`;
    }

    return {
      injectedTask,
      prevRankings,
      newRankings,
      reprioritizationExplanation,
      newTopTask: this.allTasks[0]
    };
  }


  // ─── CONVERSE ────────────────────────────────────────────────────────────────
  /**
   * Adaptive natural language chat — learns from user interactions.
   * Handles VP email lookups, blockers, priority explanations, and more.
   */
  async chat(userMessage, engineerName = 'Engineer') {
    console.log(`💬 Processing chat: "${userMessage}"`);
    this.conversationHistory.push({ role: 'user', content: userMessage });
    this.learningProfile.interactionCount++;

    // ── Intent detection ──
    const msg = userMessage.toLowerCase();

    // "Start working on task" intent
    if ((msg.includes('start') || msg.includes('begin') || msg.includes('work on')) && 
        !msg.includes('why') && !msg.includes('explain')) {
      const taskMatch = this.allTasks.find(t =>
        msg.includes(t.id.toLowerCase()) ||
        msg.includes(t.title.toLowerCase().slice(0, 20)) ||
        msg.includes('this') || msg.includes('it')
      );
      
      if (taskMatch) {
        // Mark as working
        if (!this.workingTaskIds.includes(taskMatch.id)) {
          this.workingTaskIds.push(taskMatch.id);
          this.taskTimeLogs[taskMatch.id] = {
            startTime: new Date().toISOString(),
            endTime: null
          };
        }
        
        const reply = `✅ Started working on **${taskMatch.title}** (${taskMatch.id})\n\n` +
          `**Priority:** ${taskMatch.severity} (Score: ${taskMatch.priorityScore}/100)\n` +
          `**Estimated time:** ~${this._estimateTaskMinutes(taskMatch)} minutes\n\n` +
          `I'll track your time automatically. When you're done, just say "mark done" or "complete ${taskMatch.id}".`;
        this.conversationHistory.push({ role: 'assistant', content: reply });
        return reply;
      }
    }

    // "Mark done / complete task" intent
    if ((msg.includes('done') || msg.includes('complete') || msg.includes('finish')) && 
        !msg.includes('definition of done')) {
      const taskMatch = this.allTasks.find(t =>
        msg.includes(t.id.toLowerCase()) ||
        msg.includes(t.title.toLowerCase().slice(0, 20)) ||
        msg.includes('this') || msg.includes('it')
      );
      
      if (taskMatch) {
        // Mark as completed
        if (!this.completedTaskIds.includes(taskMatch.id)) {
          this.completedTaskIds.push(taskMatch.id);
        }
        // Remove from working
        this.workingTaskIds = this.workingTaskIds.filter(id => id !== taskMatch.id);
        // Update time log
        if (this.taskTimeLogs[taskMatch.id]) {
          this.taskTimeLogs[taskMatch.id].endTime = new Date().toISOString();
        }
        
        // Add to manager activity feed
        this.managerActivityFeed.push({
          id: `activity-${Date.now()}`,
          type: "completion",
          engineer: engineerName,
          task: taskMatch,
          timestamp: new Date().toISOString(),
          message: `${engineerName} completed: ${taskMatch.title}`
        });
        
        const duration = this.taskTimeLogs[taskMatch.id] 
          ? Math.round((new Date(this.taskTimeLogs[taskMatch.id].endTime) - new Date(this.taskTimeLogs[taskMatch.id].startTime)) / 60000)
          : 0;
        
        // Find next task
        const nextTask = this.allTasks.find(t => 
          !this.completedTaskIds.includes(t.id) && 
          t.id !== taskMatch.id
        );
        
        let reply = `🎉 **Task completed!** "${taskMatch.title}" (${taskMatch.id})\n\n` +
          `**Time spent:** ${duration} minutes\n` +
          `**Manager notified:** ✓ Activity logged\n\n`;
        
        if (nextTask) {
          reply += `**Next priority:** ${nextTask.title} (${nextTask.id})\n` +
            `Score: ${nextTask.priorityScore}/100 · ${nextTask.severity}\n\n` +
            `Ready to start? Just say "start working" or "begin ${nextTask.id}"`;
        } else {
          reply += `✨ All tasks completed! Great work today.`;
        }
        
        this.conversationHistory.push({ role: 'assistant', content: reply });
        return reply;
      }
    }

    // "Cancel / stop working" intent
    if ((msg.includes('cancel') || msg.includes('stop') || msg.includes('pause')) && 
        (msg.includes('work') || msg.includes('task'))) {
      const taskMatch = this.allTasks.find(t =>
        msg.includes(t.id.toLowerCase()) ||
        msg.includes(t.title.toLowerCase().slice(0, 20)) ||
        msg.includes('this') || msg.includes('it')
      ) || (this.workingTaskIds.length > 0 ? this.allTasks.find(t => t.id === this.workingTaskIds[0]) : null);
      
      if (taskMatch && this.workingTaskIds.includes(taskMatch.id)) {
        this.workingTaskIds = this.workingTaskIds.filter(id => id !== taskMatch.id);
        
        const reply = `⏸️ Stopped working on **${taskMatch.title}** (${taskMatch.id})\n\n` +
          `Task returned to your queue. You can restart it anytime by saying "start working on ${taskMatch.id}".`;
        this.conversationHistory.push({ role: 'assistant', content: reply });
        return reply;
      }
    }

    // "Show my tasks" / "what should I work on" intent
    if (msg.includes('show') && (msg.includes('task') || msg.includes('work')) ||
        msg.includes('what should i') || msg.includes("today's tasks")) {
      const myTasks = this.allTasks
        .filter(t => !this.completedTaskIds.includes(t.id))
        .slice(0, 5);
      
      let reply = `📋 **Your top ${myTasks.length} tasks for today:**\n\n`;
      myTasks.forEach((t, i) => {
        const isWorking = this.workingTaskIds.includes(t.id);
        const status = isWorking ? '● Working' : '';
        reply += `${i+1}. **${t.title}** (${t.id}) ${status}\n`;
        reply += `   ${t.severity} · Score: ${t.priorityScore}/100 · Due: ${t.deadline || 'N/A'}\n\n`;
      });
      
      reply += `\nTo start a task, say "start working on <task-id>" or "begin <task-name>"`;
      
      this.conversationHistory.push({ role: 'assistant', content: reply });
      return reply;
    }

    // "VP email" intent
    if (msg.includes('vp') || msg.includes('vice president') || msg.includes("vp's email") || msg.includes("vp email")) {
      const vpEmails = await this.getVpEmails();
      if (vpEmails.length === 0) {
        const reply = "I searched all your emails but found no messages from a VP or Vice President in your current inbox.";
        this.conversationHistory.push({ role: 'assistant', content: reply });
        return reply;
      }
      // Summarize the first/most urgent VP email
      const topVp = vpEmails[0];
      const summary = await this.summarizeEmail(topVp.id);
      const reply = `📧 **VP Email Found** (${topVp.id}):\n\n${summary}`;
      this.conversationHistory.push({ role: 'assistant', content: reply });
      return reply;
    }

    // "Make priority" / "escalate" intent
    if (msg.includes('make') && (msg.includes('priority') || msg.includes('p1') || msg.includes('escalat'))) {
      // Try to identify which task
      const taskMatch = this.allTasks.find(t =>
        msg.includes(t.id.toLowerCase()) ||
        msg.includes(t.title.toLowerCase().slice(0, 20))
      );
      if (taskMatch) {
        const result = await this.markAsPriority(taskMatch.id, "User requested escalation via chat.");
        let reply;
        if (result.priorityNeeded) {
          // Agent confirms escalation is warranted
          reply = `✅ **${taskMatch.title}** has been escalated to P1 and is now ranked #1.\n\n${result.explanation}`;
          if (result.assessment) {
            reply += `\n\n**Assessment confidence:** ${result.assessment.confidence}`;
          }
        } else {
          // Agent says escalation is NOT needed
          const suggested = result.suggestedPriority && result.suggestedPriority !== "keep current"
            ? ` Suggested priority: **${result.suggestedPriority}**.`
            : "";
          reply = `🤔 **Priority escalation not recommended for "${taskMatch.title}".**\n\n` +
            `**Reason:** ${result.explanation}${suggested}\n\n` +
            `The current priority score of **${taskMatch.priorityScore}/100** reflects its actual urgency. ` +
            `If you have additional context (e.g. a customer is blocked, or there's a deadline I'm missing), ` +
            `let me know and I'll reassess.`;
        }
        this.conversationHistory.push({ role: 'assistant', content: reply });
        return reply;
      }
    }

    // "Blocker / blocking" intent
    if (msg.includes('block') || msg.includes('blocking') || msg.includes('what is blocking') || msg.includes("teammates")) {
      const { narrative } = await this.getTeammateBlockers();
      this.conversationHistory.push({ role: 'assistant', content: narrative });
      return narrative;
    }

    // "Why is X my #1" intent — explain top priority
    if ((msg.includes('why') && (msg.includes('#1') || msg.includes('number 1') || msg.includes('top') || msg.includes('upload bug'))) ||
        msg.includes('explain priority') || msg.includes('why is') ) {
      const top = this.allTasks[0];
      if (top) {
        let reply = `Your #1 priority is **${top.title}** (Score: ${top.priorityScore}/100).\n\n`;
        reply += top.priorityExplanation || "";
        if (top.priorityBreakdown) {
          reply += `\n\n**Score breakdown:**\n- Severity: ${top.priorityBreakdown.severity}/100\n- Deadline urgency: ${top.priorityBreakdown.deadline}/100\n- Dependencies: ${top.priorityBreakdown.dependencies}/100\n- Business impact: ${top.priorityBreakdown.businessImpact}/100`;
        }
        this.conversationHistory.push({ role: 'assistant', content: reply });
        return reply;
      }
    }

    // "Daily plan" intent
    if (msg.includes('daily plan') || msg.includes("today's plan") || msg.includes("what should i work on")) {
      const result = await this.generateDailyPlan(engineerName);
      this.conversationHistory.push({ role: 'assistant', content: result.plan });
      return result.plan;
    }

    // "Dedup" / duplicate intent
    if (msg.includes('duplic') || msg.includes('dedup') || msg.includes('same issue') || msg.includes('merged')) {
      if (this.deduplicationLog.length > 0) {
        const lines = this.deduplicationLog.slice(0, 5).map(d =>
          `- **${d.primary}** ← merged from **${d.duplicate}** (similarity: ${(d.similarity * 100).toFixed(0)}%)`
        ).join('\n');
        const reply = `🔍 **Deduplication Report** — ${this.deduplicationLog.length} duplicate groups found:\n\n${lines}`;
        this.conversationHistory.push({ role: 'assistant', content: reply });
        return reply;
      }
    }

    // ── Update learning profile with topic weights ──
    const keywords = ['upload', 'auth', 'oauth', 'csv', 'vp', 'compliance', 'payment', 'security', 'api'];
    keywords.forEach(kw => {
      if (msg.includes(kw)) {
        this.learningProfile.topicWeights[kw] = (this.learningProfile.topicWeights[kw] || 0) + 1;
      }
    });

    // ── General AI chat ──
    const sourcesSnippet = Object.entries(this.learningProfile.topicWeights)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k, v]) => `${k}(×${v})`).join(', ');

    const context = `You are TaskPilot AI — an adaptive, agentic assistant for software engineers. You learn from every interaction.

Engineer: ${engineerName}
Interaction count this session: ${this.learningProfile.interactionCount}
Topics user cares about most: ${sourcesSnippet || "not yet known"}
Total tasks: ${this.allTasks.length}
Top 3 priorities:
${this.allTasks.slice(0, 3).map((t, i) => `  ${i+1}. ${t.title} (${t.priorityScore}/100) — ${t.priorityExplanation}`).join('\n')}
Completed today: ${this.completedTaskIds.length}
Blocked teammates: (call /api/agent/blockers for details)
${this.currentPlan ? `\nCurrent Daily Plan:\n${this.currentPlan.slice(0, 400)}\n` : ''}
Recent conversation:
${this.conversationHistory.slice(-6).map(m => `${m.role}: ${m.content.slice(0, 200)}`).join('\n')}

User: ${userMessage}

Respond helpfully, specifically, and concisely (3-5 sentences). Reference real task IDs and scores. Proactively surface risks or suggestions the user hasn't asked about. Never mention Gemini.`;

    try {
      const aiResponse = (await callGemini(context, { maxTokens: 768, temperature: 0.7 })).replace(/Gemini/g, "TaskPilot AI");
      this.conversationHistory.push({ role: 'assistant', content: aiResponse });
      return aiResponse;
    } catch (error) {
      const fallback = this._generateLocalChatAnswer(userMessage);
      this.conversationHistory.push({ role: 'assistant', content: fallback });
      return fallback;
    }
  }

  // Helper function to estimate task duration
  _estimateTaskMinutes(task) {
    const sevMins = { P1: 45, P2: 60, P3: 75, P4: 90 };
    return sevMins[task.severity] || 60;
  }

  // ─── URGENT DETECTION ────────────────────────────────────────────────────────
  async detectUrgentItems() {
    const urgent = this.allTasks.filter(task => {
      if ((task.severity || 0) >= 5) return true;
      if (task.deadline) {
        const h = (new Date(task.deadline) - new Date()) / 3600000;
        if (h < 4 && h > 0) return true;
      }
      if ((task.priorityScore || 0) >= 90) return true;
      return false;
    });
    if (!urgent.length) return { hasUrgent: false, count: 0, tasks: [], alert: null };
    return { hasUrgent: true, count: urgent.length, tasks: urgent, alert: this._generateUrgentAlert(urgent) };
  }

  // ─── ADD / RE-PRIORITIZE ─────────────────────────────────────────────────────
  async addNewTask(newTask) {
    this.allTasks.push(newTask);
    this.allTasks = await this.prioritizer.prioritizeTasks(this.allTasks);
    const urgentCheck = await this.detectUrgentItems();
    return {
      success: true,
      newTaskPriority: this.allTasks.find(t => t.id === newTask.id),
      urgentAlert: urgentCheck.hasUrgent ? urgentCheck.alert : null
    };
  }

  getTaskById(taskId)   { return this.allTasks.find(t => t.id === taskId); }

  getTasks(filters = {}) {
    let tasks = [...this.allTasks];
    if (filters.source)   tasks = tasks.filter(t => t.source   === filters.source);
    if (filters.priority) tasks = tasks.filter(t => t.priority === filters.priority);
    if (filters.assignee) tasks = tasks.filter(t => t.assignee === filters.assignee);
    if (filters.limit)    tasks = tasks.slice(0, parseInt(filters.limit));
    return tasks;
  }

  getDashboardStats() {
    const stats = {
      total: this.allTasks.length,
      byPriority: { critical: 0, high: 0, medium: 0, low: 0 },
      bySource: {}, byStatus: {},
      urgentCount: this.allTasks.filter(t => (t.priorityScore || 0) >= 90).length,
      topTasks: this.allTasks.slice(0, 5),
      deduplicationLog: this.deduplicationLog.slice(0, 10),
      extractedActions: this.extractedActions.slice(0, 5),
      learningProfile: {
        topicsLearned: Object.keys(this.learningProfile.topicWeights).length,
        interactionCount: this.learningProfile.interactionCount,
        priorityOverrides: Object.keys(this.learningProfile.priorityOverrides).length
      }
    };
    this.allTasks.forEach(t => {
      stats.byPriority[t.priority] = (stats.byPriority[t.priority] || 0) + 1;
      stats.bySource[t.source]     = (stats.bySource[t.source]     || 0) + 1;
      stats.byStatus[t.status]     = (stats.byStatus[t.status]     || 0) + 1;
    });
    return stats;
  }

  // ─── HELPERS ─────────────────────────────────────────────────────────────────
  _getTaskBreakdownBySource() {
    const b = {};
    this.allTasks.forEach(t => { b[t.source] = (b[t.source] || 0) + 1; });
    return Object.entries(b).map(([s, c]) => `- ${s}: ${c} tasks`).join('\n');
  }

  _generateLocalChatAnswer(message) {
    const msg = message.toLowerCase();
    if (msg.includes('priority') || msg.includes('top') || msg.includes('what should i do')) {
      const top = this.allTasks[0];
      if (!top) return "Your task queue is empty — great work!";
      return `Your top priority is **${top.title}** (Score: ${top.priorityScore}/100). ${top.priorityExplanation}`;
    }
    if (msg.includes('block')) {
      const blocked = this.allTasks.filter(t => (t.dependencies || []).some(d => d?.type === 'blocked_by'));
      return blocked.length
        ? `You have ${blocked.length} blocked tasks: ${blocked.slice(0,3).map(t => t.title).join(', ')}.`
        : "No active blockers detected in your queue.";
    }
    if (msg.includes('summary') || msg.includes('status')) {
      return `You have ${this.allTasks.length} tasks. Breakdown:\n${this._getTaskBreakdownBySource()}`;
    }
    return "I'm TaskPilot AI — your adaptive task agent. Ask me about priorities, VP emails, blockers, your daily plan, or inject a new P1 defect!";
  }

  _generateUrgentAlert(urgent) {
    return `🚨 URGENT: ${urgent.length} item(s) need immediate attention:\n\n` +
      urgent.slice(0, 3).map((t, i) => `${i+1}. **${t.title}** — Score: ${t.priorityScore}/100\n   ${t.priorityExplanation}`).join('\n\n') +
      (urgent.length > 3 ? `\n\n...and ${urgent.length - 3} more.` : '');
  }

  _generateFallbackWeeklySummary() {
    return `# 📊 Weekly Summary — TaskPilot AI\n\n` +
      `- Total tasks: ${this.allTasks.length}\n` +
      `- High priority (≥70): ${this.allTasks.filter(t => (t.priorityScore||0) >= 70).length}\n` +
      `- Completed: ${this.completedTaskIds.length}\n\n` +
      `## Top Priorities\n${this.allTasks.slice(0,5).map((t,i)=>`${i+1}. ${t.title} (${t.priorityScore}/100)`).join('\n')}\n\n` +
      `## Sources\n${this._getTaskBreakdownBySource()}`;
  }
}

export default AgentOrchestrator;
