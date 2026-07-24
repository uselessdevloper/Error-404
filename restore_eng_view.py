import sys

filepath = '/Users/utkarshsinha/Documents/GitHub/Error-404/frontend/taskpilotai/src/main.js'
with open(filepath, 'r') as f:
    content = f.read()

start_marker = '  // ─── OVERVIEW ALL SOURCES WHITEBOARD VIEW ───\n  if (activeProfile === "manager") {\n    return renderManagerWFHWhiteboard();\n  }'
end_marker = '\n// Page: Meeting Agent'

start_idx = content.find(start_marker)
if start_idx == -1:
    print("Error: start_marker not found")
    sys.exit(1)

end_idx = content.find(end_marker, start_idx)
if end_idx == -1:
    print("Error: end_marker not found")
    sys.exit(1)

replacement = """  if (activeProfile === "manager") {
    return renderManagerWFHWhiteboard();
  }

  // ─── OVERVIEW ALL SOURCES GRID VIEW ───
  // Show ONLY tasks that fit in TODAY's working hours (capacity-based)
  const todayStr = TODAY;

  const myName = activeProfile === "manager" ? "Manager" : (settingsProfile?.name || getUserName());
  const todayCapacityTasks = buildTodayCapacityQueue(state.prioritized, myName, taskTimeLogs);

  const tiles = sources.map(src => {
    const meta = SOURCE_META[src.id] || { label: src.name, icon: "◎", color: src.color || "#64748b", emoji: "📌" };

    const sourcePool = state.prioritized.filter(t => taskMatchesSource(t, src.id) && !isTaskCompleted(t.id));

    // Pick a balanced priority mix: 1 P1 (Red), 1 P2 (Yellow), 1 P3 (Purple), 1 P4 (Slate)
    const p1 = sourcePool.find(t => (t.severity || '').toUpperCase() === "P1");
    const p2 = sourcePool.find(t => (t.severity || '').toUpperCase() === "P2");
    const p3 = sourcePool.find(t => (t.severity || '').toUpperCase() === "P3");
    const p4 = sourcePool.find(t => (t.severity || '').toUpperCase() === "P4");

    // Display 1-2 tasks per card matching today's calendar schedule
    const topTasks = [p1, p2, p3, p4].filter(Boolean).slice(0, 2);

    // If empty, fallback to first 2 available
    if (topTasks.length === 0) {
      topTasks.push(...sourcePool.slice(0, 2));
    }

    let cardUrgency = "cream";
    for (const t of topTasks) {
      if (t.severity === "P1") { cardUrgency = "red"; break; }
      if (t.severity === "P2" && cardUrgency !== "red") cardUrgency = "amber";
    }

    const p1Count = sourcePool.filter(t => t.severity === "P1").length;

    return { src, meta, pending: sourcePool, topTasks, cardUrgency, p1Count };
  });

  const totalPending = tiles.reduce((s, t) => s + t.pending.length, 0);
  const totalP1 = tiles.reduce((s, t) => s + t.p1Count, 0);

  // ── 3-colour palette (card-level and task-row-level) ──────────────────────
  const CARD_PAL = {
    red: { bg: "#fdecea", border: "#e8a09a", accent: "#c0392b", label: "#922b21", divider: "rgba(200,80,60,0.15)" },
    amber: { bg: "#fef6e4", border: "#f0c080", accent: "#b7600a", label: "#935005", divider: "rgba(200,140,40,0.15)" },
    cream: { bg: "#fdf8f0", border: "#d9c8ae", accent: "#7a5c3a", label: "#5d4226", divider: "rgba(180,150,100,0.18)" }
  };

  const tileGrid = tiles.map(tile => {
    const { src, meta, pending, topTasks, cardUrgency, p1Count } = tile;
    const pal = CARD_PAL[cardUrgency];
    const logo = SOURCE_LOGO_MAP[src.id];

    // Card-level badge
    const cardBadge = cardUrgency === "red"
      ? `<span style="font-size:10px;font-weight:800;padding:3px 10px;border-radius:999px;background:#fdecea;color:#c0392b;border:1px solid #e8a09a;white-space:nowrap;">● Due Today</span>`
      : cardUrgency === "amber"
        ? `<span style="font-size:10px;font-weight:800;padding:3px 10px;border-radius:999px;background:#fef6e4;color:#b7600a;border:1px solid #f0c080;white-space:nowrap;">◐ Approaching</span>`
        : "";

    const p1Badge = p1Count > 0
      ? `<span style="font-size:10px;font-weight:800;padding:3px 9px;border-radius:999px;background:#fdecea;color:#c0392b;border:1px solid #e8a09a;white-space:nowrap;">⚡ ${p1Count} P1</span>`
      : "";

    // Per-task urgency → row colour
    function rowUrgency(t) {
      if (isTaskCompleted(t.id)) return "cream";
      if (t.severity === "P1") return "red";
      if (!t.due) return t.severity === "P2" ? "amber" : "cream";
      const dl = Math.ceil((new Date(t.due) - new Date(TODAY)) / 86400000);
      if (dl <= 0) return "red";
      if (dl <= 3 || t.severity === "P2") return "amber";
      return "cream";
    }

    const ROW_BG = { red: "#fdecea", amber: "#fef6e4", cream: "rgba(255,255,255,0.6)" };
    const ROW_BDR = { red: "#e8a09a", amber: "#f0c080", cream: "rgba(180,140,90,0.22)" };
    const DUE_CLR = { red: "#c0392b", amber: "#b7600a", cream: "#8a6a3a" };
    const SEV_BG = { P1: "#fdecea", P2: "#fef6e4", P3: "#d1fae5", P4: "#f1f5f9" };
    const SEV_CLR = { P1: "#c0392b", P2: "#b7600a", P3: "#065f46", P4: "#64748b" };

    if (src.id === "notes") {
      const upcomingMeetings = meetingsList.filter(m => m.status === "Pending" || m.status === "Scheduled").slice(0, 3);
      return `
        <div style="background:${pal.bg};border:1.5px solid ${pal.border};border-radius:14px;overflow:hidden;
                    box-shadow:0 2px 10px rgba(100,60,20,0.07),0 1px 2px rgba(100,60,20,0.04);
                    cursor:pointer;transition:box-shadow 0.18s,transform 0.18s;display:flex;flex-direction:column;height:100%;min-height:0;"
             onmouseover="this.style.boxShadow='0 8px 24px rgba(100,60,20,0.13)';this.style.transform='translateY(-2px)'"
             onmouseout="this.style.boxShadow='0 2px 10px rgba(100,60,20,0.07)';this.style.transform='none'"
             data-nav="meetings">

          <!-- Header -->
          <div style="padding:10px 14px 8px;flex-shrink:0;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
              <div style="display:flex;align-items:center;gap:8px;min-width:0;">
                <div style="width:30px;height:30px;border-radius:8px;flex-shrink:0;
                            background:${logo ? logo.bg : "#f1f5f9"};
                            display:flex;align-items:center;justify-content:center;
                            box-shadow:0 1px 3px rgba(0,0,0,0.08);">
                  ${logo ? logo.svg : `<span style="font-size:16px;">${meta.emoji}</span>`}
                </div>
                <div style="min-width:0;">
                  <div style="font-size:12.5px;font-weight:800;color:#2d1505;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(meta.label)}</div>
                  <div style="font-size:10px;color:${pal.label};margin-top:1px;font-weight:600;">
                    ${meetingsList.length} meeting${meetingsList.length !== 1 ? "s" : ""} found
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Divider -->
          <div style="height:1px;background:${pal.divider};margin:0 10px;flex-shrink:0;"></div>

          <!-- Stats -->
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;padding:0 2px;flex-shrink:0;">
            <div style="padding:6px 4px;text-align:center;border-right:1px solid ${pal.divider};">
              <div style="font-size:20px;font-weight:900;color:${pal.accent};line-height:1;">${meetingsList.length}</div>
              <div style="font-size:8.5px;font-weight:700;color:${pal.label};letter-spacing:0.05em;margin-top:2px;opacity:0.75;text-transform:uppercase;">Total</div>
            </div>
            <div style="padding:6px 4px;text-align:center;border-right:1px solid ${pal.divider};">
              <div style="font-size:20px;font-weight:900;color:${meetingsList.filter(m => m.priority === "Critical" || m.priority === "High").length > 0 ? "#c0392b" : pal.accent};line-height:1;">${meetingsList.filter(m => m.priority === "Critical" || m.priority === "High").length}</div>
              <div style="font-size:8.5px;font-weight:700;color:${pal.label};letter-spacing:0.05em;margin-top:2px;opacity:0.75;text-transform:uppercase;">Urgent</div>
            </div>
            <div style="padding:6px 4px;text-align:center;">
              <div style="font-size:20px;font-weight:900;color:${pal.accent};line-height:1;">${upcomingMeetings.length}</div>
              <div style="font-size:8.5px;font-weight:700;color:${pal.label};letter-spacing:0.05em;margin-top:2px;opacity:0.75;text-transform:uppercase;">Upcoming</div>
            </div>
          </div>

          <!-- Divider -->
          <div style="height:1px;background:${pal.divider};margin:0 10px;flex-shrink:0;"></div>

          <!-- Meeting rows -->
          <div style="padding:8px 10px;flex:1;min-height:0;overflow-y:auto;display:grid;gap:4px;">
            ${upcomingMeetings.length === 0
          ? `<div style="text-align:center;padding:10px 0;color:${pal.label};font-size:11px;opacity:0.6;">No upcoming meetings</div>`
          : upcomingMeetings.map(m => `
                <div style="display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:7px;background:rgba(255,255,255,0.6);border:1px solid rgba(180,140,90,0.22);" data-nav="meetings">
                  <span style="font-size:8.5px;font-weight:800;padding:1px 5px;border-radius:4px;background:#d1fae5;color:#065f46;flex-shrink:0;">${m.time || "Today"}</span>
                  <div style="flex:1;min-width:0;">
                    <div style="font-size:11.5px;font-weight:600;color:#2d1505;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(m.title)}</div>
                    <div style="font-size:9.5px;color:#8a6a3a;">${m.participants ? m.participants.slice(0, 2).join(", ") : "Team"}</div>
                  </div>
                </div>
              `).join("")
        }
          </div>
        </div>
      `;
    }

    return `
      <div style="background:${pal.bg};border:1.5px solid ${pal.border};border-radius:14px;overflow:hidden;
                  box-shadow:0 2px 10px rgba(100,60,20,0.07),0 1px 2px rgba(100,60,20,0.04);
                  cursor:pointer;transition:box-shadow 0.18s,transform 0.18s;display:flex;flex-direction:column;height:100%;min-height:0;"
           onmouseover="this.style.boxShadow='0 8px 24px rgba(100,60,20,0.13)';this.style.transform='translateY(-2px)'"
           onmouseout="this.style.boxShadow='0 2px 10px rgba(100,60,20,0.07)';this.style.transform='none'"
           data-scrum-source="${src.id}">

        <!-- Header -->
        <div style="padding:10px 14px 8px;flex-shrink:0;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <div style="display:flex;align-items:center;gap:8px;min-width:0;">
              <div style="width:30px;height:30px;border-radius:8px;flex-shrink:0;
                          background:${logo ? logo.bg : "#f1f5f9"};
                          display:flex;align-items:center;justify-content:center;
                          box-shadow:0 1px 3px rgba(0,0,0,0.08);">
                ${logo ? logo.svg : `<span style="font-size:16px;">${meta.emoji}</span>`}
              </div>
              <div style="min-width:0;">
                <div style="font-size:12.5px;font-weight:800;color:#2d1505;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(meta.label)}</div>
                <div style="font-size:10px;color:${pal.label};margin-top:1px;font-weight:600;">
                  ${pending.length} task${pending.length !== 1 ? "s" : ""} pending
                </div>
              </div>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex-shrink:0;">
              ${cardBadge}${p1Badge}
            </div>
          </div>
        </div>

        <!-- Divider -->
        <div style="height:1px;background:${pal.divider};margin:0 10px;flex-shrink:0;"></div>

        <!-- Stats -->
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;padding:0 2px;flex-shrink:0;">
          <div style="padding:6px 4px;text-align:center;border-right:1px solid ${pal.divider};">
            <div style="font-size:20px;font-weight:900;color:${pal.accent};line-height:1;">${pending.length}</div>
            <div style="font-size:8.5px;font-weight:700;color:${pal.label};letter-spacing:0.05em;margin-top:2px;opacity:0.75;text-transform:uppercase;">Pending</div>
          </div>
          <div style="padding:6px 4px;text-align:center;border-right:1px solid ${pal.divider};">
            <div style="font-size:20px;font-weight:900;color:${p1Count > 0 ? "#c0392b" : pal.accent};line-height:1;">${p1Count}</div>
            <div style="font-size:8.5px;font-weight:700;color:${pal.label};letter-spacing:0.05em;margin-top:2px;opacity:0.75;text-transform:uppercase;">P1 Urgent</div>
          </div>
          <div style="padding:6px 4px;text-align:center;">
            <div style="font-size:20px;font-weight:900;color:${cardUrgency === "red" ? "#c0392b" : cardUrgency === "amber" ? "#b7600a" : pal.accent};line-height:1;">${topTasks.length}</div>
            <div style="font-size:8.5px;font-weight:700;color:${pal.label};letter-spacing:0.05em;margin-top:2px;opacity:0.75;text-transform:uppercase;">Showing</div>
          </div>
        </div>

        <!-- Divider -->
        <div style="height:1px;background:${pal.divider};margin:0 10px;flex-shrink:0;"></div>

        <!-- Task rows list with internal scrollbar -->
        <div class="eng-task-list-scrollable" style="padding:8px 10px;flex:1;min-height:0;overflow-y:auto;display:grid;gap:4px;">
          ${topTasks.length === 0
        ? `<div style="text-align:center;padding:10px 0;color:${pal.label};font-size:11px;opacity:0.6;">✅ All clear!</div>`
        : topTasks.map(t => {
          const isDone = isTaskCompleted(t.id);
          const isWorking = isTaskWorking(t.id);
          const urg = rowUrgency(t);
          const taskDl = t.due ? Math.ceil((new Date(t.due) - new Date(TODAY)) / 86400000) : null;
          const dueLabel = !t.due ? "" : taskDl <= 0 ? "Overdue" : taskDl === 1 ? "Tomorrow" : taskDl <= 6 ? `${taskDl}d left` : formatDue(t.due);
          return `
                  <div style="display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:7px;
                               background:${isDone ? "rgba(255,255,255,0.4)" : ROW_BG[urg]};
                               border:1px solid ${isDone ? "rgba(180,150,100,0.15)" : ROW_BDR[urg]};
                               cursor:pointer;transition:filter 0.1s;opacity:${isDone ? 0.55 : 1};"
                       onmouseover="this.style.filter='brightness(0.95)'" onmouseout="this.style.filter='none'"
                       data-task="${t.id}">
                    <span style="font-size:8.5px;font-weight:800;padding:1px 5px;border-radius:4px;background:${SEV_BG[t.severity] || "#f1f5f9"};color:${SEV_CLR[t.severity] || "#64748b"};flex-shrink:0;">${t.severity}</span>
                    <div style="flex:1;min-width:0;">
                      <div style="font-size:11.5px;font-weight:600;color:${isDone ? "#a0856a" : "#2d1505"};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${isDone ? "text-decoration:line-through;" : ""}">${escapeHtml(t.canonicalTitle)}</div>
                      <div style="font-size:9.5px;display:flex;gap:4px;margin-top:1px;">
                        <span style="color:#8a6a3a;">${t.owner || "Unassigned"}</span>
                        ${dueLabel ? `<span style="color:${DUE_CLR[urg]};font-weight:${urg !== "cream" ? 700 : 400};">${dueLabel}</span>` : ""}
                      </div>
                    </div>
                    ${isWorking ? `<span style="font-size:8.5px;color:#065f46;font-weight:800;flex-shrink:0;">● Active</span>` : ""}
                    ${isDone ? `<span style="font-size:8.5px;color:#065f46;font-weight:800;flex-shrink:0;">✓</span>` : ""}
                    ${!isDone && !isWorking ? `<button class="tp-btn-start" data-task-start="${t.id}" style="font-size:9.5px;padding:2px 6px;flex-shrink:0;background:rgba(255,255,255,0.8);color:${pal.accent};border:1px solid ${pal.border};border-radius:4px;cursor:pointer;">▶</button>` : ""}
                  </div>`;
        }).join("")}
          ${pending.length > (src.id === "jira" || src.id === "github" ? 1 : 8) ? `<div style="text-align:center;padding:3px;font-size:10px;color:${pal.accent};font-weight:700;opacity:0.85;">+ ${pending.length - (src.id === "jira" || src.id === "github" ? 1 : 8)} more →</div>` : ""}
        </div>
      </div>`;
  }).join("");

  return `
    <div style="display:flex;flex-direction:column;height:calc(100vh - 84px);max-height:calc(100vh - 84px);overflow:hidden;padding:12px 18px 0;box-sizing:border-box;background:#f7f4ee;">
      <!-- Header -->
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-shrink:0;">
        <div>
          <p class="eyebrow" style="margin:0;">Unified Work Intelligence</p>
          <h2 style="margin:1px 0 0;color:#17202a;font-size:18px;">All Sources</h2>
          <p style="font-size:11px;color:#65717d;margin:1px 0 0;">
            Today's queue: ${totalPending} pending · ${totalP1} P1 · All 6 sources locked on 1 screen
          </p>
        </div>
        ${activeProfile === "manager" ? `<button class="primary" style="font-size:11px;padding:6px 11px;background:#152238;color:#fff;border:none;border-radius:6px;font-weight:700;" id="openAddJiraModalBtn">+ Add Task</button>` : ""}
      </div>

      <!-- Tile grid — 3x2 fixed grid fitting 100% viewport height with ZERO scroll -->
      <div style="display:grid;grid-template-columns:repeat(3, 1fr);grid-template-rows:1fr 1fr;gap:10px;flex:1;min-height:0;overflow:hidden;">
        ${tileGrid}
      </div>
    </div>
  `;
}
"""

new_content = content[:start_idx] + replacement + content[end_idx:]
with open(filepath, 'w') as f:
    f.write(new_content)

print("SUCCESSFULLY RESTORED ORIGINAL ENGINEER ALL SOURCES GRID VIEW!")
