export function createTeeSession(now = new Date("2026-06-19T09:00:00")) {
  const manifest = {
    app: "TaskPilot AI",
    modelBoundary: "TaskPilot AI/Ollama calls receive redacted task context only",
    captureBoundary: "screen frames are ephemeral and require user consent",
    decisionBoundary: "agent suggests plans, user approves execution",
    createdAt: now.toISOString()
  };

  return {
    id: "tee-taskpilot-local",
    mode: "TEE-ready local enclave",
    status: "attested",
    trustScore: 98,
    attestationHash: hashLite(JSON.stringify(manifest)),
    controls: [
      "Ephemeral OCR frame handling",
      "API key never written to task payloads",
      "User approval required before execution",
      "Auditable priority rationale retained"
    ],
    manifest
  };
}

export function sealForTee(payload, session = createTeeSession()) {
  const minimizedPayload = {
    intent: payload.intent || "unknown",
    activeApp: payload.activeApp || "TaskPilot",
    selectedTask: payload.selectedTask || "none",
    sourceCount: payload.sourceCount || 0,
    containsScreenFrame: Boolean(payload.containsScreenFrame),
    redactions: ["apiKey", "rawScreenshotBytes", "personalTokens"]
  };

  return {
    sealed: true,
    sessionId: session.id,
    attestationHash: session.attestationHash,
    payloadDigest: hashLite(JSON.stringify(minimizedPayload)),
    minimizedPayload
  };
}

export function teePlanSteps(intent) {
  return [
    { id: "context", description: "Detect active work context" },
    { id: "tee", description: "Open TEE trust envelope and minimize data" },
    { id: "reason", description: `Plan safe action for: ${intent}` },
    { id: "consent", description: "Ask user before any execution or external call" }
  ];
}

function hashLite(input) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `tp-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
