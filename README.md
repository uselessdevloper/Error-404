# TaskPilot AI

TaskPilot AI is a cross-platform desktop assistant for software engineers and engineering managers. It aggregates work from Jira, ServiceNow, GitHub, Outlook, Slack, and meeting notes, removes duplicate tasks, extracts hidden action items from unstructured text, scores priority, and creates a daily execution plan.

The project is built as an Electron desktop application with a floating companion agent, a local task-prioritization engine, backend sample datasets, optional Supabase authentication, optional Gemini vision/LLM support, and TEE-style approval gates for sensitive screen/OCR workflows.

## Why This Exists

Software engineers receive work from too many places: sprint boards, incidents, email, Slack, pull requests, meetings, and manager follow-ups. Important actions are often duplicated or buried in unstructured messages. TaskPilot AI turns those scattered signals into one trusted queue so engineers know what to do next and managers can see team delivery risks.

## Core Features

- Aggregates tasks from Jira, ServiceNow, GitHub, Outlook, Slack, and meeting notes.
- Deduplicates overlapping work across systems using text similarity, shared IDs, and phrase matching.
- Extracts hidden action items from emails, Slack mentions, and meeting notes.
- Prioritizes work using severity, deadline, business impact, blockers, duplicate confidence, owner pressure, and NLP extraction signals.
- Provides separate dashboards for engineers and managers.
- Gives execution briefs with definition of done, estimated timeline, process steps, and approval gates.
- Includes a floating desktop companion agent for quick actions, OCR-style context scanning, and task guidance.
- Supports Supabase Google login and profile tables.
- Supports Gemini API integration through backend environment variables.
- Packages as an Electron app for macOS and Windows.

## Dashboards

### Engineer Dashboard

The engineer view focuses on personal execution:

- Current highest-priority task.
- Deduped and ranked work queue.
- Explanation for why a task is ranked where it is.
- Daily plan based on priority and calendar blocks.
- Execution brief with process steps and definition of done.
- Natural-language task questions.
- "Complete and assign next" flow that moves the user to the next highest-priority task.

### Manager Dashboard

The manager view focuses on team-level decisions:

- SLA and escalation risks.
- Team blockers and handoff needs.
- Workload by owner from dataset-derived task pressure.
- Priority lanes grouped by P1/P2/P3.
- Source intelligence showing signals by system.
- Decision brief for the highest-risk item.
- Live scoring features used by the priority model.

## Tech Stack

- Frontend: Vanilla JavaScript, HTML, CSS
- Desktop shell: Electron
- Backend: Node.js
- Optional database/auth: Supabase
- Optional AI provider: Gemini API
- Sample data: JSON datasets
- Packaging: electron-builder

## Project Structure

```text
Error-404/
├── backend/
│   └── taskpilotai/
│       ├── agent/                  # Agent orchestration and prioritization helpers
│       ├── api/                    # Settings/API helpers
│       ├── datasets/               # Sample task datasets
│       ├── supabase/               # SQL migrations and Supabase setup notes
│       ├── .env.example            # Environment variable template
│       ├── server.mjs              # Node backend server
│       └── package.json
├── frontend/
│   └── taskpilotai/
│       ├── electron/               # Electron main/preload/floating companion windows
│       ├── scripts/                # Build, serve, and dataset sync scripts
│       ├── src/                    # App UI, task engine, TEE helper, generated data
│       ├── public/                 # Static assets
│       ├── package.json
│       └── index.html
└── README.md
```

## Sample Data

Sample datasets are included in:

```text
backend/taskpilotai/datasets/
```

Important files:

- `jira_sprint_board.json`
- `servicenow_defects.json`
- `github_work.json`
- `outlook_emails.json`
- `slack_mentions.json`
- `meeting_notes.json`
- `calendar_blocks.json`
- `profiles.json`
- `cleaned_tasks.json`
- `live_state.json`

The frontend build syncs these backend datasets into:

```text
frontend/taskpilotai/src/generated/backendData.js
```

This lets the demo run with realistic local data even when external integrations are not connected.

## Prerequisites

- Node.js 18 or newer
- npm
- macOS or Windows for the desktop app
- Optional: Supabase project for Google login
- Optional: Gemini API key for live AI/vision workflows

## Environment Setup

Create an environment file from the example:

```bash
cd backend/taskpilotai
cp .env.example .env
```

Example `.env`:

```env
TASKPILOT_PORT=8787
TASKPILOT_DATASET_DIR=./datasets

LLM_PROVIDER=gemini
GEMINI_API_KEY=your_gemini_key_here
LLM_MODEL=gemini-2.5-flash
LLM_TEMPERATURE=0.7
LLM_MAX_TOKENS=2048

SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_KEY=your_supabase_service_key
```

The app can run in demo mode without Supabase or Gemini. Add keys only when testing real auth or AI-backed summaries.

## Supabase Setup

SQL migrations are in:

```text
backend/taskpilotai/supabase/
```

Run these in the Supabase SQL editor:

```text
001_taskpilot_profiles.sql
002_task_completions.sql
```

For Google auth, configure the redirect URLs in Supabase and Google Cloud according to:

```text
backend/taskpilotai/supabase/README.md
```

## Install Dependencies

Backend:

```bash
cd backend/taskpilotai
npm install
```

Frontend:

```bash
cd frontend/taskpilotai
npm install
```

## Run the Project

Start the backend:

```bash
cd backend/taskpilotai
npm run dev
```

Start the web preview:

```bash
cd frontend/taskpilotai
npm run dev
```

Run the Electron desktop app:

```bash
cd frontend/taskpilotai
npm run desktop
```

Build the static frontend:

```bash
cd frontend/taskpilotai
npm run build
```

Package the desktop app:

```bash
cd frontend/taskpilotai
npm run dist
```

The `dist` command uses `electron-builder`. The config targets macOS DMG and Windows NSIS installers.

## Testing

Run task-engine tests:

```bash
cd frontend/taskpilotai
npm test
```

The tests verify:

- Dataset ingestion.
- Duplicate detection.
- Priority ordering.
- Daily plan generation.
- Proactive alert generation.
- TEE payload sealing helpers.
- Next-task assignment after completion.

## How Prioritization Works

The local priority engine is in:

```text
frontend/taskpilotai/src/taskEngine.js
```

The scoring pipeline:

1. Flatten source datasets into raw task signals.
2. Normalize text with lightweight NLP tokenization.
3. Detect duplicates using token overlap, shared work IDs, and phrase boosts.
4. Merge duplicate work into canonical tasks.
5. Train a lightweight local priority model from the current dataset.
6. Score each task using:
   - severity
   - due date
   - business impact
   - dependency/blocker risk
   - duplicate confidence
   - source type
   - owner pressure
   - NLP-extracted hidden action signals
7. Create ranked queues, alerts, daily plans, and execution briefs.

## TEE and Approval-Gated Execution

TaskPilot includes a TEE-style trust layer in:

```text
frontend/taskpilotai/src/teeTrust.js
```

For the hackathon POC, the TEE layer demonstrates:

- minimized context payloads
- redaction declarations
- attestation-style hashes
- approval-first execution plans
- no final send/commit/close action without user confirmation

This models how sensitive OCR and screen-context workflows would be protected in a production implementation.

## Demo Flow

1. Launch the desktop app with `npm run desktop`.
2. Sign in with Google or use demo mode if auth is not configured.
3. Switch between Engineer and Manager roles.
4. In Engineer mode, review the highest-priority task and its execution brief.
5. Click "Complete & assign next" to show automatic next-task allocation.
6. In Manager mode, inspect SLA risk, blockers, owner workload, and priority lanes.
7. Click "Run autonomous scan" to show the agent workflow.
8. Open the floating companion to demonstrate always-on desktop assistance.

## Where Codex Accelerated the Workflow

Codex was used as the main engineering pair-programmer during implementation. It accelerated the project in these areas:

- Converted the hackathon problem statement into a working product architecture.
- Created the Electron desktop shell and cross-platform packaging setup.
- Built the floating companion agent with its own Electron window.
- Implemented the dataset ingestion and frontend dataset sync flow.
- Added task deduplication, ranking, next-task assignment, and explanation logic.
- Separated engineer and manager dashboard experiences.
- Added Supabase Google login wiring and SQL profile schema guidance.
- Added TEE-style redaction and approval-gated execution helpers.
- Improved UI/UX iteratively from screenshots and user feedback.
- Ran repeated tests/builds to keep changes working while iterating quickly.

## Key Product Decisions Made With Codex

- Use Electron so the assistant can work as a desktop application on macOS and Windows.
- Keep API keys in the backend `.env`, never in the frontend UI.
- Use sample JSON datasets to make the POC demo reliable without live Jira/Slack/Outlook credentials.
- Build separate role-specific dashboards instead of one generic dashboard.
- Keep the floating companion small, movable, and approval-first.
- Make prioritization explainable instead of a black-box ranking.
- Show where each task came from and why duplicate work was merged.
- Treat screen/OCR actions as sensitive workflows that require a trust boundary.

## How GPT-5.6 and Codex Were Used

GPT-5.6 and Codex were used as implementation accelerators and design reasoning partners:

- GPT-5.6 helped reason through the product concept, user personas, and prioritization criteria.
- Codex translated those decisions into code across frontend, backend, Electron, datasets, and docs.
- GPT-style prompting was used to refine the task-agent behavior, dashboard copy, and demo narrative.
- Codex performed codebase inspection, targeted edits, build checks, and test runs.
- The workflow made it possible to move from idea sketches to a functioning desktop POC much faster than manual implementation alone.

The human team still made the final product decisions: target users, feature scope, dashboard direction, security posture, and demo expectations.

## Known Limitations

- External Jira, Slack, Outlook, GitHub, and ServiceNow connectors are represented through sample datasets for the POC.
- TEE behavior is modeled as a trust-envelope workflow; production deployment would require a real trusted execution environment.
- Gemini and Supabase are optional and require valid keys/project configuration.
- Windows packaging should be verified on a Windows machine or CI runner before final submission.

## Troubleshooting

Port already in use:

```bash
lsof -ti:8787 | xargs kill -9
```

Frontend dev server port already in use:

```bash
lsof -ti:5173 | xargs kill -9
```

No tasks appear:

- Confirm dataset files exist in `backend/taskpilotai/datasets/`.
- Run `npm run build` from `frontend/taskpilotai` to sync datasets.
- Check the terminal for dataset sync errors.

Google login fails:

- Confirm `SUPABASE_URL` and `SUPABASE_ANON_KEY` are set.
- Confirm Google provider is enabled in Supabase.
- Confirm redirect URLs are configured as described in `backend/taskpilotai/supabase/README.md`.

Gemini summary fails:

- Confirm `GEMINI_API_KEY` exists in `backend/taskpilotai/.env`.
- Confirm the backend server is running.
- The app still works in demo mode without Gemini.

## Submission Checklist

- `README.md` with setup and run instructions.
- Sample datasets in `backend/taskpilotai/datasets/`.
- Supabase SQL in `backend/taskpilotai/supabase/`.
- Desktop app source in `frontend/taskpilotai/electron/`.
- Task engine tests via `npm test`.
- Demo video showing engineer view, manager view, floating companion, and prioritization explanation.
- Zip or repository submission including frontend, backend, datasets, and docs.
