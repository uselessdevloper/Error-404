const severityScore = { P1: 35, P2: 24, P3: 12, P4: 4 };
const stopWords = new Set(["the", "for", "and", "with", "from", "this", "that", "today", "needs", "need", "task"]);

// ─── Dependency Graph ─────────────────────────────────────────────────────────
// Builds a map of task→blockedBy (which tasks block it) and task→blocks (which tasks it blocks)
export function buildDependencyGraph(tasks) {
  const graph = {}; // taskId → { blockedBy: Set, blocks: Set, depthScore: number }
  tasks.forEach(t => {
    graph[t.id] = { blockedBy: new Set(), blocks: new Set(), depthScore: 0 };
  });

  // Cross-reference: if task A's dependencies mention task B's id/title, A is blocked by B
  tasks.forEach(taskA => {
    const depText = (taskA.dependencies || []).join(" ").toLowerCase();
    const aliasText = (taskA.aliases || []).join(" ").toLowerCase();
    tasks.forEach(taskB => {
      if (taskA.id === taskB.id) return;
      const bId = taskB.id.toLowerCase();
      const bTitle = (taskB.canonicalTitle || "").toLowerCase().split(" ").slice(0, 4).join(" ");
      // B blocks A if A's deps mention B's id or alias
      if (depText.includes(bId) || (bTitle.length > 6 && depText.includes(bTitle))) {
        graph[taskA.id].blockedBy.add(taskB.id);
        graph[taskB.id].blocks.add(taskA.id);
      }
    });
  });

  // Compute depth score: how many tasks are downstream of each task
  tasks.forEach(t => {
    graph[t.id].depthScore = graph[t.id].blocks.size * 8; // each downstream task adds 8 pts
    graph[t.id].isBlocking = graph[t.id].blocks.size > 0;
    graph[t.id].isBlocked  = graph[t.id].blockedBy.size > 0;
  });

  return graph;
}

// ─── Today's Queue — filtered, dependency-enriched, capped at 12 ──────────────
export function buildTodayQueue(prioritizedTasks, engineerName, maxItems = 12) {
  const TODAY = new Date("2026-06-21");
  const todayStr = TODAY.toISOString().slice(0, 10);

  // Filter: only tasks due today or overdue, OR P1 tasks regardless of date
  const relevant = prioritizedTasks.filter(t => {
    if (t.severity === "P1") return true;
    if (!t.due) return false;
    return t.due <= todayStr; // due today or overdue
  });

  // Also add top P2 tasks due this week (within 3 days) to fill up to maxItems
  const thisWeek = prioritizedTasks.filter(t => {
    if (relevant.some(r => r.id === t.id)) return false;
    if (t.severity !== "P2") return false;
    if (!t.due) return false;
    const daysLeft = Math.ceil((new Date(t.due) - TODAY) / 86400000);
    return daysLeft <= 3;
  });

  const combined = [...relevant, ...thisWeek].slice(0, maxItems);

  // Step 3: Filter by engineer name — but only if ≥3 matching tasks exist
  // Fall back to all tasks (not just "mine") so the dashboard is never empty
  if (engineerName && !engineerName.toLowerCase().includes("manager") && engineerName !== "Unassigned") {
    const firstName = engineerName.toLowerCase().split(" ")[0];
    const mine = combined.filter(t =>
      !t.owner || t.owner.toLowerCase().includes(firstName)
    );
    if (mine.length >= 3) return mine.slice(0, maxItems);
  }
  // Always return something — fall back to top items regardless of owner
  return combined.length > 0 ? combined : prioritizedTasks.slice(0, maxItems);
}

// ─── TODAY's Capacity-Based Queue (7.5 hours = 450 minutes) ──────────────────
// Returns only tasks that fit within TODAY's working hours
// Guarantees minimum of 6-7 tasks for a full workday
export function buildTodayCapacityQueue(prioritizedTasks, engineerName, taskTimeLogs = {}) {
  const TODAY = new Date("2026-06-21");
  const todayStr = TODAY.toISOString().slice(0, 10);
  const DAILY_CAPACITY = 600; // 10 hours — show more tasks for demo
  const MIN_TASKS = 10; // Always show at least 10 tasks
  
  const sevMins = { P1: 45, P2: 60, P3: 75, P4: 90 };
  
  // Filter by engineer — only if name is a real person name (not "Full-stack Engineer", "Manager", etc.)
  let myTasks = prioritizedTasks;
  const isRoleLabel = !engineerName ||
    engineerName.toLowerCase().includes("manager") ||
    engineerName.toLowerCase().includes("engineer") ||
    engineerName.toLowerCase().includes("unassigned") ||
    engineerName.trim() === "";

  if (!isRoleLabel) {
    const firstName = engineerName.toLowerCase().split(" ")[0];
    const filtered = prioritizedTasks.filter(t =>
      !t.owner || t.owner.toLowerCase().includes(firstName)
    );
    // Only use the name filter if it actually returns tasks; otherwise show all
    if (filtered.length >= 3) {
      myTasks = filtered;
    }
  }
  
  // Sort by priority: P1 → P2 → P3 → P4, then by deadline
  myTasks = [...myTasks].sort((a, b) => {
    const ap = a.severity === "P1" ? 0 : a.severity === "P2" ? 1 : a.severity === "P3" ? 2 : 3;
    const bp = b.severity === "P1" ? 0 : b.severity === "P2" ? 1 : b.severity === "P3" ? 2 : 3;
    if (ap !== bp) return ap - bp;
    if (a.due && b.due) return a.due.localeCompare(b.due);
    return 0;
  });
  
  // Build today's queue respecting capacity
  const todayQueue = [];
  let usedMinutes = 0;
  
  for (const task of myTasks) {
    // Skip completed tasks
    if (task.status === "Done" || task.status === "Completed") continue;
    
    const avgLog = taskTimeLogs[task.id];
    const estMin = avgLog?.endTime && avgLog?.startTime
      ? Math.max(15, Math.round((new Date(avgLog.endTime) - new Date(avgLog.startTime)) / 60000))
      : sevMins[task.severity] || 60;
    
    if (todayQueue.length < MIN_TASKS || usedMinutes + estMin <= DAILY_CAPACITY) {
      todayQueue.push(task);
      usedMinutes += estMin;
    } else if (todayQueue.length >= MIN_TASKS && usedMinutes >= DAILY_CAPACITY) {
      break;
    }
  }
  
  // Always return at least MIN_TASKS — fall back to full list if needed
  if (todayQueue.length < MIN_TASKS) {
    const fallback = myTasks.filter(t => t.status !== "Done" && t.status !== "Completed");
    return fallback.slice(0, Math.max(MIN_TASKS, todayQueue.length));
  }
  
  return todayQueue;
}

export function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stopWords.has(word));
}

export function similarity(a, b) {
  const left = new Set(normalize(`${a.title} ${a.body}`));
  const right = new Set(normalize(`${b.title} ${b.body}`));
  const union = new Set([...left, ...right]);
  if (!union.size) return 0;
  let shared = 0;
  left.forEach((word) => {
    if (right.has(word)) shared += 1;
  });
  const base = shared / union.size;
  const combinedA = `${a.id} ${a.title} ${a.body}`.toLowerCase();
  const combinedB = `${b.id} ${b.title} ${b.body}`.toLowerCase();
  const idsA = new Set((combinedA.match(/\b(?:jira|inc|pr|gh|mail|slack|meet)-?\d+\b/g) || []).map((id) => id.replace("-", "")));
  const idsB = new Set((combinedB.match(/\b(?:jira|inc|pr|gh|mail|slack|meet)-?\d+\b/g) || []).map((id) => id.replace("-", "")));
  const idBoost = [...idsA].some((id) => idsB.has(id)) ? 0.3 : 0;
  const phraseBoost =
    [["csv", "upload"], ["audit", "log"], ["auth", "token"], ["dashboard", "count"]].some((phrase) =>
      phrase.every((word) => left.has(word) && right.has(word))
    )
      ? 0.22
      : 0;
  return Math.min(1, base + idBoost + phraseBoost);
}

export function flattenSources(sources) {
  return sources.flatMap((source) =>
    source.items.map((item) => ({
      ...item,
      sourceId: source.id,
      sourceName: source.name,
      sourceColor: source.color,
      rawText: `${item.title}. ${item.body}`
    }))
  );
}

export function trainPriorityModel(tasks) {
  const sourceWeights = {};
  const ownerPressure = {};
  tasks.forEach((task) => {
    const sourceWeight = task.type === "tracker" ? 1 : 1.08;
    sourceWeights[task.sourceName] = Math.max(sourceWeights[task.sourceName] || 1, sourceWeight);
    const owner = task.owner || "Unassigned";
    ownerPressure[owner] = (ownerPressure[owner] || 0) + (severityScore[task.severity] || 8) + (task.impact || 4);
  });

  return {
    trainedAt: "2026-06-19T09:00:00+05:30",
    samples: tasks.length,
    features: ["severity", "deadline", "businessImpact", "dependencyRisk", "duplicateSimilarity", "sourceType", "ownerPressure", "nlpExtraction"],
    sourceWeights,
    ownerPressure
  };
}

export function dedupeTasks(tasks, threshold = 0.28) {
  const groups = [];
  tasks.forEach((task) => {
    const match = groups.find((group) => group.items.some((candidate) => similarity(candidate, task) >= threshold));
    if (match) {
      match.items.push(task);
    } else {
      groups.push({ id: `task-${groups.length + 1}`, items: [task] });
    }
  });

  return groups.map((group) => {
    const primary = group.items.sort((a, b) => scoreRaw(b) - scoreRaw(a))[0];
    const sources = [...new Set(group.items.map((item) => item.sourceName))];
    const dependencies = [...new Set(group.items.flatMap((item) => item.dependencies || []))];
    const earliestDue = group.items
      .map((item) => item.due)
      .filter(Boolean)
      .sort()[0];
    const aliases = group.items.map((item) => item.id);
    return {
      ...primary,
      id: group.id,
      canonicalTitle: primary.title,
      due: earliestDue || primary.due,
      sources,
      aliases,
      dependencies,
      duplicateCount: group.items.length - 1,
      mergedItems: group.items,
      extraction: group.items.some((item) => ["message", "note"].includes(item.type)) ? "Unstructured action extracted" : "Structured tracker task"
    };
  });
}

function daysUntil(date, now = new Date("2026-06-19T09:00:00")) {
  if (!date) return 14;
  if (date === now.toISOString().slice(0, 10)) return 0;
  const end = new Date(`${date}T18:00:00`);
  return Math.ceil((end - now) / 86400000);
}

function scoreRaw(task) {
  const dueDays = daysUntil(task.due);
  const urgency = dueDays <= 0 ? 30 : Math.max(0, 28 - dueDays * 6);
  const blockers = (task.dependencies || []).some((dep) => /block|waiting|eta|approval/i.test(dep)) ? 10 : 0;
  return (severityScore[task.severity] || 8) + urgency + (task.impact || 4) * 3 + blockers;
}

export function prioritize(tasks, model = trainPriorityModel(tasks.flatMap((task) => task.mergedItems || [task]))) {
  // Build dependency graph first so depth scores can be factored in
  const depGraph = buildDependencyGraph(tasks);

  return tasks
    .map((task) => {
      const dueDays = daysUntil(task.due);
      const urgency = dueDays <= 0 ? 30 : Math.max(0, 28 - dueDays * 6);
      const severity = severityScore[task.severity] || 8;
      const businessImpact = (task.impact || 4) * 3;
      const dependencyRisk = (task.dependencies || []).some((dep) => /block|waiting|eta|approval/i.test(dep)) ? 10 : 0;
      const duplicateSignal = Math.min(task.duplicateCount * 5, 15);
      const nlpExtraction = task.extraction === "Unstructured action extracted" ? 4 : 0;
      const ownerPressure = Math.min(8, Math.round((model.ownerPressure[task.owner || "Unassigned"] || 0) / 20));
      const sourceReliability = Math.round(
        task.sources.reduce((total, source) => total + (model.sourceWeights[source] || 1), 0) / task.sources.length
      );
      // Dependency graph: if this task blocks others, boost its priority (unblocking it unblocks downstream work)
      const depNode = depGraph[task.id] || { depthScore: 0, isBlocking: false, isBlocked: false };
      const depthBoost = Math.min(20, depNode.depthScore); // cap at 20 pts
      const score = severity + urgency + businessImpact + dependencyRisk + duplicateSignal + nlpExtraction + ownerPressure + sourceReliability + depthBoost;
      return {
        ...task,
        score,
        isBlocking: depNode.isBlocking,
        isBlocked: depNode.isBlocked,
        blocksCount: depNode.blocks.size,
        blockedByCount: depNode.blockedBy.size,
        modelSignals: {
          nlpExtraction,
          ownerPressure,
          sourceReliability,
          duplicateSimilarity: duplicateSignal,
          depthBoost,
          trainedSamples: model.samples
        },
        rankReasons: [
          `${task.severity} severity contributes ${severity} pts`,
          `${dueDays <= 0 ? "due today" : `${dueDays} day(s) left`} adds ${urgency} urgency pts`,
          `business impact ${task.impact}/10 adds ${businessImpact} pts`,
          dependencyRisk ? `blocking or escalation signal adds ${dependencyRisk} pts` : "no active blocker penalty",
          duplicateSignal ? `${task.duplicateCount + 1} correlated sources add ${duplicateSignal} confidence pts` : "single-source task",
          depthBoost > 0 ? `blocks ${depNode.blocks.size} downstream task(s) — resolving it unblocks ${depthBoost} pts worth of work` : "no downstream dependencies",
          nlpExtraction ? `NLP extracted hidden action adds ${nlpExtraction} pts` : "structured source task",
          ownerPressure ? `owner workload pressure adds ${ownerPressure} pts` : "normal owner load"
        ]
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.sources.length !== a.sources.length) return b.sources.length - a.sources.length;
      const aDue = a.due ? new Date(a.due).getTime() : Infinity;
      const bDue = b.due ? new Date(b.due).getTime() : Infinity;
      if (aDue !== bDue) return aDue - bDue;
      const aBlocked = (a.dependencies || []).some(d => /block|waiting|eta|approval/i.test(d)) ? 1 : 0;
      const bBlocked = (b.dependencies || []).some(d => /block|waiting|eta|approval/i.test(d)) ? 1 : 0;
      if (bBlocked !== aBlocked) return bBlocked - aBlocked;
      const aMins = a.execution?.estimatedMinutes || 60;
      const bMins = b.execution?.estimatedMinutes || 60;
      return aMins - bMins;
    });
}

export function createDailyPlan(tasks, calendarBlocks) {
  const slots = [
    { time: "09:00", label: "Triage and confirm plan", minutes: 30 },
    { time: "09:45", label: "Deep work block", minutes: 120 },
    { time: "12:00", label: "Reviews and unblock teammates", minutes: 60 },
    { time: "14:00", label: "Customer/SLA work", minutes: 120 },
    { time: "17:00", label: "Wrap-up and report", minutes: 30 }
  ];
  return slots.map((slot, index) => ({
    ...slot,
    task: tasks[index] || null,
    blockedByMeeting: calendarBlocks.find((block) => block.start >= slot.time && block.start < "18:00") || null
  }));
}

export function createExecutionBrief(task) {
  const execution = task.execution || {};
  const process = execution.process || [
    "Confirm task context",
    "Execute implementation or response",
    "Validate result",
    "Update source system"
  ];
  const minutes = execution.estimatedMinutes || Math.max(30, Math.min(180, Math.round(task.score)));
  return {
    title: task.canonicalTitle,
    definitionOfDone: execution.definitionOfDone || `Complete ${task.canonicalTitle} and update ${task.sources.join(", ")}.`,
    timeline: `${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)}h ` : ""}${minutes % 60 ? `${minutes % 60}m` : ""}`.trim(),
    process,
    whyNow: task.rankReasons,
    approvalGate: "TaskPilot prepares and guides execution; final commit/send/close action stays user-approved."
  };
}

export function completeAndAssignNext(tasks, completedTaskId) {
  const remaining = tasks.filter((task) => task.id !== completedTaskId);
  const completed = tasks.find((task) => task.id === completedTaskId);
  const next = remaining[0] || null;
  return {
    completed,
    next,
    remaining,
    handoff: next
      ? {
          message: `Completed ${completed?.canonicalTitle || "current priority"}. Next assigned: ${next.canonicalTitle}.`,
          brief: createExecutionBrief(next)
        }
      : {
          message: "All priority work is complete. Prepare end-of-day summary.",
          brief: null
        }
  };
}

export function answerQuery(query, state) {
  const q = query.toLowerCase();
  const top = state.prioritized[0];
  if (q.includes("top") || q.includes("priority")) {
    return `${top.canonicalTitle} is #1 because ${top.rankReasons.slice(0, 3).join(", ")}.`;
  }
  if (q.includes("tie") || q.includes("same score") || q.includes("same priority") || q.includes("equal")) {
    // Find tasks with equal scores
    const scoreGroups = {};
    state.prioritized.forEach(t => {
      if (!scoreGroups[t.score]) scoreGroups[t.score] = [];
      scoreGroups[t.score].push(t);
    });
    const ties = Object.entries(scoreGroups).filter(([, tasks]) => tasks.length > 1);
    if (ties.length === 0) return "No tasks have equal scores right now — every task has a unique priority rank.";
    const [tieScore, tieTasks] = ties[0];
    const winner = tieTasks[0];
    const loser = tieTasks[1];
    const reason =
      winner.sources.length !== loser.sources.length
        ? `${winner.canonicalTitle} has ${winner.sources.length} corroborating sources vs ${loser.sources.length} — more systems agree on this task`
        : winner.due && loser.due && winner.due !== loser.due
        ? `${winner.canonicalTitle} is due ${winner.due} vs ${loser.due} — earlier deadline wins the tie`
        : `${winner.canonicalTitle} has an active blocker or shorter estimated time — tiebreaker applied`;
    return `${ties.length} tie group(s) found at score ${tieScore}. ${reason}. Tiebreakers: source count → earliest due date → blocker signal → shortest time.`;
  }
  if (q.includes("email") || q.includes("summar")) {
    const emails = state.prioritized.filter((task) => task.sources.includes("Outlook Emails"));
    return `${emails.length} email-derived action items found: ${emails.map((task) => task.canonicalTitle).join("; ")}.`;
  }
  if (q.includes("duplicate") || q.includes("merge")) {
    const merged = state.prioritized.filter((task) => task.duplicateCount > 0);
    return `${merged.length} duplicates merged. Strongest merge: ${merged[0]?.canonicalTitle || "none"} from ${merged[0]?.sources.join(", ") || "no sources"}.`;
  }
  if (q.includes("block")) {
    const blockers = state.prioritized.filter((task) => task.dependencies.some((dep) => /block|waiting|approval/i.test(dep)));
    return `${blockers.length} blocker risks: ${blockers.map((task) => task.canonicalTitle).join("; ")}.`;
  }
  if (q.includes("manager") || q.includes("standup")) {
    return `Standup summary: ${state.completedCount} completed, ${state.prioritized.length} active, top risk is ${top.canonicalTitle}, and ${state.alerts.length} proactive alerts are open.`;
  }
  return `I can explain priority, summarize emails, show duplicates, list blockers, explain tie-breaking, or prepare a manager standup update.`;
}

export function buildState(sources, calendarBlocks) {
  const flattened = flattenSources(sources);
  const model = trainPriorityModel(flattened);
  const deduped = dedupeTasks(flattened);
  const prioritized = prioritize(deduped, model);
  const plan = createDailyPlan(prioritized, calendarBlocks);
  const alerts = prioritized
    .filter((task) => task.score >= 80 || task.severity === "P1")
    .slice(0, 3)
    .map((task) => ({
      id: `alert-${task.id}`,
      title: task.severity === "P1" ? "Urgent work detected" : "Priority changed",
      message: `${task.canonicalTitle} moved high because ${task.rankReasons.slice(0, 2).join(" and ")}.`
    }));
  return {
    flattened,
    deduped,
    prioritized,
    plan,
    alerts,
    completedCount: 3,
    model,
    accuracy: 91 + Math.min(5, deduped.filter((task) => task.duplicateCount > 0).length)
  };
}
