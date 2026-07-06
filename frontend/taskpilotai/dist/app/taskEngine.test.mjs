import assert from "node:assert/strict";
import { buildState, completeAndAssignNext, createExecutionBrief, similarity } from "./taskEngine.js";
import { calendarBlocks, sources } from "./data.js";
import { createTeeSession, sealForTee, teePlanSteps } from "./teeTrust.js";

const state = buildState(sources, calendarBlocks);
const csvTasks = state.flattened.filter((task) => /csv upload/i.test(`${task.title} ${task.body}`));

assert.equal(state.flattened.length >= 10, true, "should ingest at least 10 raw tasks");
assert.equal(state.deduped.length < state.flattened.length, true, "should merge duplicate work");
assert.equal(state.prioritized[0].severity, "P1", "top priority should be the urgent P1");
assert.equal(state.plan.length, 5, "should create five daily plan slots");
assert.equal(state.alerts.length > 0, true, "should produce proactive alerts");
assert.equal(similarity(csvTasks[0], csvTasks[1]) > 0.28, true, "CSV upload items should be recognized as duplicates");

const tee = createTeeSession();
const sealed = sealForTee({ intent: "scan screen", activeApp: "Outlook", containsScreenFrame: true }, tee);
assert.equal(tee.status, "attested", "TEE session should be attested");
assert.equal(sealed.sealed, true, "TEE payload should be sealed");
assert.equal(sealed.minimizedPayload.redactions.includes("apiKey"), true, "TEE payload should declare key redaction");
assert.equal(teePlanSteps("prioritize").length, 4, "TEE plan should expose auditable steps");

const brief = createExecutionBrief(state.prioritized[0]);
assert.equal(Boolean(brief.definitionOfDone), true, "execution brief should define done state");
assert.equal(brief.process.length > 2, true, "execution brief should include process steps");
const assignment = completeAndAssignNext(state.prioritized, state.prioritized[0].id);
assert.equal(assignment.next.id, state.prioritized[1].id, "next priority should be assigned after completion");

console.log("Task engine checks passed");
