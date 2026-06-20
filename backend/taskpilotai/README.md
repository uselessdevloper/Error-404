# TaskPilot AI Backend

An agentic AI assistant that conquers engineer task overload by automatically aggregating, deduplicating, prioritizing, and managing tasks from multiple sources.

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- Python 3.8+ (for dataset cleaning)
- Gemini API Key
- Supabase Account (optional, for user management)

### Installation

1. **Install Node dependencies:**
```bash
cd backend/taskpilotai
npm install
```

2. **Install Python dependencies** (for dataset cleaning):
```bash
pip3 install python-dotenv
```

3. **Configure environment variables:**
   
   Update `.env` with your credentials:
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   SUPABASE_URL=your_supabase_url
   SUPABASE_ANON_KEY=your_supabase_anon_key
   SUPABASE_SERVICE_KEY=your_supabase_service_key
   ```

4. **Setup Supabase database:**
   
   Run the SQL script in Supabase Dashboard:
   ```bash
   # Navigate to Supabase Dashboard -> SQL Editor
   # Copy and paste contents of supabase/001_taskpilot_profiles.sql
   # Click "Run"
   ```

5. **Clean the datasets:**
```bash
npm run clean-data
```

6. **Start the server:**
```bash
npm start
```

Server will run at `http://127.0.0.1:8787`

## 📋 Features

### Core Capabilities

- **Multi-Source Aggregation**: Ingests tasks from Jira, ServiceNow, GitHub, Outlook, Slack, and meeting notes
- **Intelligent Extraction**: Uses Gemini AI to extract action items from unstructured text (emails, meeting notes)
- **Smart Deduplication**: Detects and merges semantically similar tasks across sources
- **Explainable Prioritization**: Ranks tasks using multi-factor scoring with clear reasoning
- **Daily Plan Generation**: Creates structured, actionable daily plans
- **Conversational Interface**: Natural language chat for task queries
- **Proactive Alerting**: Automatically detects and notifies on urgent items
- **Dynamic Re-prioritization**: Adjusts priorities when new high-priority tasks arrive

### Agent Features

- **Autonomous Reasoning**: Proactively processes and organizes information
- **Context Awareness**: Maintains conversation history and task context
- **Tool Integration**: Uses specialized tools for different operations
- **Gemini-Powered**: Leverages Gemini 1.5 Flash for LLM capabilities

## 🔌 API Endpoints

### Agent Endpoints

#### Initialize Agent
```http
POST /api/agent/initialize
```
Initializes the agent with cleaned task data, runs deduplication, and prioritization.

#### Generate Daily Plan
```http
POST /api/agent/daily-plan
Content-Type: application/json

{
  "engineerName": "John Doe",
  "userId": "user-id-optional"
}
```

#### Generate Weekly Summary
```http
POST /api/agent/weekly-summary
Content-Type: application/json

{
  "engineerName": "John Doe"
}
```

#### Chat with Agent
```http
POST /api/agent/chat
Content-Type: application/json

{
  "message": "What's my top priority?",
  "engineerName": "John Doe"
}
```

#### Check Urgent Items
```http
GET /api/agent/urgent-check
```

#### Get All Tasks
```http
GET /api/agent/tasks?source=jira&limit=10
```

#### Get Task by ID
```http
GET /api/agent/task?id=JIRA-1234
```

#### Get Dashboard Stats
```http
GET /api/agent/stats
```

#### Add New Task
```http
POST /api/agent/add-task
Content-Type: application/json

{
  "id": "NEW-123",
  "title": "New urgent task",
  "source": "manual",
  "priority": "high",
  "severity": 5,
  "deadline": "2024-12-31T23:59:59Z"
}
```

### Settings Endpoints

#### Get User Profile
```http
GET /api/settings/profile?email=engineer@taskpilot.ai
```

#### Update User Profile
```http
PUT /api/settings/profile
Content-Type: application/json

{
  "userId": "uuid-here",
  "updates": {
    "full_name": "Updated Name",
    "timezone": "America/New_York",
    "notification_channels": {
      "slack": true,
      "email": true
    }
  }
}
```

#### Get Source Connections
```http
GET /api/settings/sources?profileId=uuid-here
```

#### Update Source Connection
```http
PUT /api/settings/sources
Content-Type: application/json

{
  "profileId": "uuid-here",
  "sourceType": "jira",
  "updates": {
    "enabled": true,
    "external_account_id": "john.doe@company.com"
  }
}
```

#### Get Execution History
```http
GET /api/settings/history?profileId=uuid-here&limit=50
```

#### Get Team Profiles (Manager)
```http
GET /api/settings/team/profiles?teamId=uuid-here
```

#### Get Team Statistics (Manager)
```http
GET /api/settings/team/stats?teamId=uuid-here
```

## 🧹 Dataset Cleaning

The `clean_datasets.py` script processes raw data from multiple sources into a unified format:

### Supported Sources

1. **Jira Sprint Board** (`jira_sprint_board.json`)
2. **ServiceNow Defects** (`servicenow_defects.json`)
3. **GitHub Work** (`github_work.json`)
4. **Outlook Emails** (`outlook_emails.json`)
5. **Slack Mentions** (`slack_mentions.json`)
6. **Meeting Notes** (`meeting_notes.json`)

### What It Does

- Normalizes task data into common schema
- Extracts action items from unstructured text
- Calculates severity scores
- Infers priorities and deadlines
- Removes duplicates
- Outputs `cleaned_tasks.json`

### Run Cleaning

```bash
npm run clean-data
# or
python3 clean_datasets.py
```

## 🤖 Agent Architecture

### Components

1. **AgentOrchestrator** (`agent/agentOrchestrator.mjs`)
   - Main controller
   - Manages conversation history
   - Coordinates prioritization and planning

2. **TaskPrioritizer** (`agent/taskPrioritizer.mjs`)
   - Multi-factor priority scoring
   - Gemini-powered explanations
   - Semantic deduplication
   - Daily/weekly plan generation

3. **SettingsAPI** (`api/settingsApi.mjs`)
   - User profile management
   - Team statistics
   - Execution history

### Priority Scoring Formula

```
Priority Score = (0.4 × Severity) + (0.3 × Deadline Urgency) + 
                 (0.2 × Dependencies) + (0.1 × Business Impact)
```

Weights are configurable in `.env`:
```env
PRIORITY_WEIGHT_SEVERITY=0.4
PRIORITY_WEIGHT_DEADLINE=0.3
PRIORITY_WEIGHT_DEPENDENCIES=0.2
PRIORITY_WEIGHT_BUSINESS_IMPACT=0.1
```

## 📊 Task Schema

Each task is normalized to this schema:

```javascript
{
  id: "JIRA-1234",
  title: "Fix critical bug",
  description: "Detailed description",
  source: "jira",
  status: "pending",
  priority: "critical",
  severity: 5,
  assignee: "john.doe",
  deadline: "2024-12-31T23:59:59Z",
  created_at: "2024-12-01T10:00:00Z",
  dependencies: [],
  labels: ["bug", "urgent"],
  priorityScore: 95,
  priorityExplanation: "Priority 95/100 because..."
}
```

## 🔐 Security & Privacy

- **Row Level Security (RLS)**: Enabled on all Supabase tables
- **API Key Protection**: Never expose API keys to frontend
- **User Isolation**: Users can only access their own data
- **No PII Leakage**: Gemini prompts are sanitized

## 🧪 Testing

### Check Data Loading
```bash
npm run check
```

### Test Agent Initialization
```bash
curl http://127.0.0.1:8787/api/agent/initialize -X POST
```

### Test Daily Plan
```bash
curl -X POST http://127.0.0.1:8787/api/agent/daily-plan \
  -H "Content-Type: application/json" \
  -d '{"engineerName": "Test Engineer"}'
```

### Test Chat
```bash
curl -X POST http://127.0.0.1:8787/api/agent/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What are my top 3 priorities?"}'
```

## 📁 Project Structure

```
backend/taskpilotai/
├── agent/
│   ├── agentOrchestrator.mjs    # Main agent controller
│   └── taskPrioritizer.mjs      # Task prioritization engine
├── api/
│   └── settingsApi.mjs          # Settings management API
├── datasets/
│   ├── jira_sprint_board.json
│   ├── servicenow_defects.json
│   ├── github_work.json
│   ├── outlook_emails.json
│   ├── slack_mentions.json
│   ├── meeting_notes.json
│   └── cleaned_tasks.json       # Generated after cleaning
├── supabase/
│   ├── 001_taskpilot_profiles.sql
│   └── README.md
├── clean_datasets.py            # Dataset cleaning script
├── server.mjs                   # Express server
├── package.json
├── .env                         # Environment variables
└── README.md
```

## 🐛 Troubleshooting

### Agent not initializing
- Ensure `clean_datasets.py` has been run
- Check that `cleaned_tasks.json` exists in `datasets/`
- Verify Gemini API key is valid

### Supabase connection issues
- Verify `SUPABASE_URL` and keys are correct
- Check that SQL schema has been run
- Ensure RLS policies are properly set

### Priority scores not generating
- Check Gemini API rate limits
- Verify `GEMINI_API_KEY` is set
- Look for errors in server logs

## 📚 Resources

- [Problem Statement](../../docs/problem-statement.pdf)
- [Student Manual](../../docs/student-manual.pdf)
- [Gemini API Docs](https://ai.google.dev/docs)
- [Supabase Docs](https://supabase.com/docs)
- [LangChain Agents](https://python.langchain.com/docs/modules/agents/)

## 📝 License

MIT License - see LICENSE file for details

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests
5. Submit a pull request

---

Built with ❤️ for the Dell Hackathon - TaskPilot AI Challenge
