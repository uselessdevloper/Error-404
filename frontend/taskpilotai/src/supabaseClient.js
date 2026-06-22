/**
 * Supabase client — task completions, working state, realtime sync.
 * Uses anon key (safe for frontend — RLS is enforced server-side).
 */

const SUPABASE_URL  = "https://pfotrcjqnopvyihwqvhu.supabase.co";
const SUPABASE_ANON = "sb_publishable_zcHEO26770jC8ZG5NdUx0w_lrdz8wuV";

// ─── Minimal REST helper (no npm package needed) ──────────────────────────────
function sbFetch(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...opts,
    headers: {
      "apikey": SUPABASE_ANON,
      "Authorization": `Bearer ${SUPABASE_ANON}`,
      "Content-Type": "application/json",
      "Prefer": opts.prefer || "return=representation",
      ...(opts.headers || {})
    }
  });
}

// ─── Load all completed task IDs for a user ───────────────────────────────────
export async function loadCompletions(userEmail) {
  try {
    const res = await sbFetch(`/task_completions?user_email=eq.${encodeURIComponent(userEmail)}&select=task_id,task_title,severity,source,due_date,score,completed_at,was_on_time,time_spent_min&order=completed_at.desc`);
    if (!res.ok) return [];
    return await res.json(); // array of completion rows
  } catch { return []; }
}

// ─── Mark a task complete ─────────────────────────────────────────────────────
export async function saveCompletion(userEmail, userName, task, timeSpentMin, wasOnTime) {
  try {
    await sbFetch("/task_completions", {
      method: "POST",
      prefer: "resolution=ignore-duplicates",
      body: JSON.stringify({
        user_email:     userEmail,
        user_name:      userName,
        task_id:        task.id,
        task_title:     task.canonicalTitle || task.title,
        severity:       task.severity,
        source:         (task.sources || [task.sourceId]).join(", "),
        due_date:       task.due || null,
        score:          task.score || 0,
        was_on_time:    wasOnTime,
        time_spent_min: timeSpentMin || null
      })
    });
  } catch (err) {
    console.warn("[TaskPilot] Supabase saveCompletion failed:", err.message);
  }
}

// ─── Remove a completion (reopen task) ───────────────────────────────────────
export async function deleteCompletion(userEmail, taskId) {
  try {
    await sbFetch(`/task_completions?user_email=eq.${encodeURIComponent(userEmail)}&task_id=eq.${encodeURIComponent(taskId)}`, {
      method: "DELETE"
    });
  } catch (err) {
    console.warn("[TaskPilot] Supabase deleteCompletion failed:", err.message);
  }
}

// ─── Load working task IDs ────────────────────────────────────────────────────
export async function loadWorkingTasks(userEmail) {
  try {
    const res = await sbFetch(`/task_working?user_email=eq.${encodeURIComponent(userEmail)}&select=task_id`);
    if (!res.ok) return [];
    const rows = await res.json();
    return rows.map(r => r.task_id);
  } catch { return []; }
}

// ─── Save working task ────────────────────────────────────────────────────────
export async function saveWorkingTask(userEmail, userName, taskId, taskTitle) {
  let actualUserName = userName;
  let actualTaskId = taskId;
  let actualTaskTitle = taskTitle;
  if (arguments.length === 3) {
    actualUserName = "Engineer";
    actualTaskId = userName;
    actualTaskTitle = taskId;
  }
  try {
    await sbFetch("/task_working", {
      method: "POST",
      prefer: "resolution=ignore-duplicates",
      body: JSON.stringify({ user_email: userEmail, user_name: actualUserName, task_id: actualTaskId, task_title: actualTaskTitle })
    });
  } catch (err) {
    console.warn("[TaskPilot] Supabase saveWorkingTask failed:", err.message);
  }
}

// ─── Remove working task (started or completed) ───────────────────────────────
export async function deleteWorkingTask(userEmail, taskId) {
  try {
    await sbFetch(`/task_working?user_email=eq.${encodeURIComponent(userEmail)}&task_id=eq.${encodeURIComponent(taskId)}`, {
      method: "DELETE"
    });
  } catch (err) {
    console.warn("[TaskPilot] Supabase deleteWorkingTask failed:", err.message);
  }
}

// ─── Load manager assignments for an engineer ─────────────────────────────────
export async function loadAssignments(engineerEmail) {
  try {
    const res = await sbFetch(`/manager_assignments?assigned_to=eq.${encodeURIComponent(engineerEmail)}&status=eq.pending&select=*&order=created_at.desc`);
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

// ─── Save manager assignment ──────────────────────────────────────────────────
export async function saveAssignment(assignment) {
  try {
    await sbFetch("/manager_assignments", {
      method: "POST",
      prefer: "resolution=ignore-duplicates",
      body: JSON.stringify(assignment)
    });
  } catch (err) {
    console.warn("[TaskPilot] Supabase saveAssignment failed:", err.message);
  }
}

// ─── Realtime subscription for completions (live dashboard) ──────────────────
export function subscribeToCompletions(userEmail, onInsert, onDelete) {
  const wsUrl = SUPABASE_URL.replace("https://", "wss://") + "/realtime/v1/websocket?apikey=" + SUPABASE_ANON + "&vsn=1.0.0";
  let ws;
  try {
    ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      ws.send(JSON.stringify({
        topic: "realtime:public:task_completions",
        event: "phx_join",
        payload: { config: { broadcast: { self: false }, presence: { key: "" }, postgres_changes: [{ event: "*", schema: "public", table: "task_completions", filter: `user_email=eq.${userEmail}` }] } },
        ref: "1"
      }));
    };
    ws.onmessage = (msg) => {
      try {
        const d = JSON.parse(msg.data);
        if (d.event === "postgres_changes" || d?.payload?.data?.type === "INSERT") {
          onInsert && onInsert(d?.payload?.data?.record);
        }
        if (d?.payload?.data?.type === "DELETE") {
          onDelete && onDelete(d?.payload?.data?.old_record);
        }
      } catch {}
    };
    ws.onerror = () => {};
  } catch {}
  return { close: () => ws?.close() };
}

// ─── Load all completions across ALL users ───────────────────────────────────
export async function loadAllCompletions() {
  try {
    const res = await sbFetch(`/task_completions?select=user_email,user_name,task_id,task_title,severity,source,due_date,score,completed_at,was_on_time,time_spent_min&order=completed_at.desc`);
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

// ─── Load all working tasks across ALL users ──────────────────────────────────
export async function loadAllWorkingTasks() {
  try {
    const res = await sbFetch(`/task_working?select=user_email,user_name,task_id,task_title,started_at`);
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

// ─── Subscribe to ALL database completions & working changes (real-time) ──────
export function subscribeToAllDatabaseChanges(onCompletionChange, onWorkingChange) {
  const wsUrl = SUPABASE_URL.replace("https://", "wss://") + "/realtime/v1/websocket?apikey=" + SUPABASE_ANON + "&vsn=1.0.0";
  let ws;
  try {
    ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      ws.send(JSON.stringify({
        topic: "realtime:public:db_all",
        event: "phx_join",
        payload: {
          config: {
            broadcast: { self: false },
            presence: { key: "" },
            postgres_changes: [
              { event: "*", schema: "public", table: "task_completions" },
              { event: "*", schema: "public", table: "task_working" }
            ]
          }
        },
        ref: "1"
      }));
    };
    ws.onmessage = (msg) => {
      try {
        const d = JSON.parse(msg.data);
        if (d.event === "postgres_changes") {
          const table = d.payload?.data?.table;
          const type = d.payload?.data?.type;
          const record = d.payload?.data?.record;
          const old_record = d.payload?.data?.old_record;
          if (table === "task_completions") {
            onCompletionChange && onCompletionChange(type, record || old_record);
          } else if (table === "task_working") {
            onWorkingChange && onWorkingChange(type, record || old_record);
          }
        }
      } catch {}
    };
    ws.onerror = () => {};
  } catch {}
  return { close: () => ws?.close() };
}
