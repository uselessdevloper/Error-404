# TaskPilot AI

A desktop productivity tool that helps engineering teams manage tasks across multiple platforms. TaskPilot consolidates work from Jira, GitHub, ServiceNow, Outlook, and Slack into a single prioritized queue.

## What It Does

TaskPilot watches your work sources and builds a unified task list. It removes duplicates, ranks by urgency, and gives you a clear view of what needs attention today. Managers get team visibility and workload distribution tools. Engineers get a focused daily queue without the noise.

## Features

**Task Management**
- Aggregates tasks from Jira, ServiceNow, GitHub PRs, emails, and Slack
- Automatic deduplication across platforms
- Dynamic priority ranking based on deadlines and severity
- Real-time status updates

**Meeting Intelligence**
- Scans calendar for upcoming meetings
- Extracts action items and decisions
- Tracks follow-ups and meeting notes
- Calendar integration

**Team Coordination**
- Manager dashboard with workload view
- Task assignment with capacity checks
- Team portal for announcements
- End-of-day reports

**Security**
- Row-level security via Supabase
- Engineers see only their data
- Managers get read access for oversight
- All credentials stored in .env

## Setup

### Requirements

- Node.js 18+
- Python 3.10+ (optional, for alternative server)
- LLM API key (Gemini, NVIDIA, or Grok)

### Installation

1. Clone the repository
```bash
git clone https://github.com/yourusername/Error-404.git
cd Error-404
```

2. Configure environment variables

Create `backend/taskpilotai/.env`:
```env
# Choose your LLM provider: gemini, nvidia, or grok
LLM_PROVIDER=gemini

# API Keys (provide at least one based on your provider)
GEMINI_API_KEY=your_key_here
NVIDIA_API_KEY=your_key_here
GROK_API_KEY=your_key_here

# LLM Configuration
LLM_MODEL=gemini-2.5-flash
LLM_TEMPERATURE=0.7
LLM_MAX_TOKENS=2048

# Database (optional - works without Supabase in demo mode)
SUPABASE_URL=your_project_url
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_KEY=your_service_key

# Server Configuration
TASKPILOT_PORT=8787
TASKPILOT_DATASET_DIR=./datasets
```

3. Start the backend
```bash
cd backend/taskpilotai
npm install
node server.mjs
```

4. Start the frontend
```bash
cd frontend/taskpilotai
npm install
npm run dev
```

Access the app at `http://localhost:5173`

### Desktop App (Electron)

Build and run as a desktop application:
```bash
cd frontend/taskpilotai
npm run build
npm run electron
```

## LLM Provider Setup

TaskPilot supports three LLM providers. Configure your choice in `.env`:

### Option 1: Google Gemini (Default)
```env
LLM_PROVIDER=gemini
GEMINI_API_KEY=your_gemini_key
LLM_MODEL=gemini-2.5-flash
```
Get your API key: [Google AI Studio](https://aistudio.google.com/app/apikey)

### Option 2: NVIDIA
```env
LLM_PROVIDER=nvidia
NVIDIA_API_KEY=your_nvidia_key
LLM_MODEL=nvidia/llama-3.1-nemotron-70b-instruct
```
Get your API key: [NVIDIA API Catalog](https://build.nvidia.com/)

### Option 3: Grok (xAI)
```env
LLM_PROVIDER=grok
GROK_API_KEY=your_grok_key
LLM_MODEL=grok-beta
```
Get your API key: [xAI Console](https://console.x.ai/)

## Usage

### Engineer View
- Login with your email (or use demo mode)
- See your prioritized task queue
- Mark tasks as working/done
- Chat with AI agent for task assistance
- Generate end-of-day reports

### Manager View
- View team workload distribution
- Assign tasks to engineers
- Post team announcements
- Track completion metrics
- Generate team analytics

### AI Agent Chat
The agent understands natural language:
- "show my tasks for today"
- "start working on task-1"
- "mark done"
- "what's blocking the team?"

## Architecture

**Frontend**: Vanilla JavaScript, CSS, Electron
**Backend**: Node.js with Express-like routing
**Database**: Supabase (PostgreSQL with RLS)
**LLM**: Multi-provider support (Gemini/NVIDIA/Grok)

## Data Security

- Row-level security enforced in Supabase
- Engineers can only access their own profiles and logs
- Managers have read-only access to team data
- API keys stored in .env (never committed to git)
- All sensitive data redacted in logs

## Project Structure

```
Error-404/
├── backend/
│   └── taskpilotai/
│       ├── agent/                 # AI agent logic
│       ├── api/                   # API endpoints
│       ├── datasets/              # Sample data
│       ├── supabase/              # Database migrations
│       └── server.mjs             # Backend server
├── frontend/
│   └── taskpilotai/
│       ├── electron/              # Desktop app
│       ├── src/                   # Frontend code
│       └── index.html             # Entry point
└── README.md
```

## Development

Run tests:
```bash
cd frontend/taskpilotai
npm test
```

Build for production:
```bash
cd frontend/taskpilotai
npm run build
```

## Troubleshooting

**Port already in use:**
```bash
lsof -ti:8787 | xargs kill -9
```

**LLM API errors:**
- Check your API key in `.env`
- Verify LLM_PROVIDER matches your key
- Check API rate limits

**No tasks showing:**
- Backend must be running on port 8787
- Check browser console for errors
- Verify dataset files exist in `backend/taskpilotai/datasets/`

## Contributing

Pull requests welcome. For major changes, open an issue first.

## License

MIT

## Support

For issues or questions, check the troubleshooting section or open a GitHub issue.
