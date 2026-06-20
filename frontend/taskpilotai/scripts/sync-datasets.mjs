import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const frontendRoot = resolve(".");
const backendRoot = resolve(frontendRoot, "../../backend/taskpilotai");
const datasetDir = join(backendRoot, "datasets");
const sourceFiles = [
  "jira_sprint_board.json",
  "servicenow_defects.json",
  "github_work.json",
  "outlook_emails.json",
  "slack_mentions.json",
  "meeting_notes.json"
];

// Embed logo as base64 data URL so it works in Electron (file://) and browser
const logoPath = join(frontendRoot, "logo.jpg");
let logoDataUrl = "";
try {
  const logoBytes = readFileSync(logoPath);
  logoDataUrl = `data:image/jpeg;base64,${logoBytes.toString("base64")}`;
} catch {
  console.warn("logo.jpg not found, logo will not display");
}

const data = {
  sources: sourceFiles.map((file) => readJson(join(datasetDir, file))),
  calendarBlocks: readJson(join(datasetDir, "calendar_blocks.json")),
  demoProfiles: readJson(join(datasetDir, "profiles.json")),
  meetings: readJson(join(datasetDir, "meetings.json")),
  logoDataUrl
};

writeFileSync(
  join(frontendRoot, "src/generated/backendData.js"),
  `export const backendData = ${JSON.stringify(data, null, 2)};\n`
);
console.log(`Synced ${data.sources.length} backend datasets + meetings into frontend generated data.`);

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}
