import os
import json
import requests
from datetime import datetime
import google.generativeai as genai
from dotenv import load_dotenv
from agent.task_prioritizer import TaskPrioritizer

load_dotenv()

class AgentOrchestrator:
    def __init__(self):
        self.prioritizer = TaskPrioritizer()
        self.api_key = os.getenv("GEMINI_API_KEY") or ""
        self.model_name = os.getenv("LLM_MODEL") or "gemini-2.5-flash"
        self.model = True if self.api_key else None

    async def _call_gemini_vertex(self, prompt, max_tokens=1024, temperature=0.7) -> str:
        if not self.api_key:
            raise ValueError("GEMINI_API_KEY not configured")
        
        project = os.getenv("VERTEX_AI_PROJECT", "")
        location = os.getenv("VERTEX_AI_LOCATION", "us-central1")
        model_id = self.model_name.split("/")[-1]
        
        url = f"https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/publishers/google/models/{model_id}:generateContent?key={self.api_key}"
        
        headers = {"Content-Type": "application/json"}
        body = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"maxOutputTokens": max_tokens, "temperature": temperature}
        }
        
        resp = requests.post(url, headers=headers, json=body, timeout=25)
        if not resp.ok:
            raise Exception(f"Vertex AI request failed: {resp.text}")
        data = resp.json()
        text = data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
        return text.strip()

        self.conversation_history = []
        self.current_plan = None
        self.all_tasks = []

        # Dynamic state properties synchronized from frontend
        self.completed_task_ids = []
        self.working_task_ids = []
        self.task_time_logs = {}
        self.manager_activity_feed = []
        self.manager_task_posts = []
        self.engineer_portal_posts = []
        self.added_tasks = []

    async def initialize(self):
        print("🚀 Initializing TaskPilot AI Python Agent...")
        try:
            # Try to load existing live state if it exists on disk
            dataset_dir = os.getenv("TASKPILOT_DATASET_DIR") or "./datasets"
            state_path = os.path.join(os.getcwd(), dataset_dir, "live_state.json")
            
            try:
                if os.path.exists(state_path):
                    with open(state_path, "r", encoding="utf-8") as f:
                        live_state = json.load(f)
                    self.completed_task_ids = live_state.get("completedTaskIds") or []
                    self.working_task_ids = live_state.get("workingTaskIds") or []
                    self.task_time_logs = live_state.get("taskTimeLogs") or {}
                    self.manager_activity_feed = live_state.get("managerActivityFeed") or []
                    self.manager_task_posts = live_state.get("managerTaskPosts") or []
                    self.engineer_portal_posts = live_state.get("engineerPortalPosts") or []
                    self.added_tasks = live_state.get("addedTasks") or []
                    print(f"✅ Loaded existing live_state.json: {len(self.completed_task_ids)} done, {len(self.working_task_ids)} working")
                else:
                    print("No existing live_state.json found, starting fresh.")
            except Exception as err:
                print(f"Error loading live_state.json: {err}, starting fresh.")

            await self.rebuild_tasks()
            print("✅ TaskPilot AI Agent initialized successfully!")

            return {
                "success": True,
                "totalTasks": len(self.all_tasks),
                "topPriorities": [{
                    "id": t["id"],
                    "title": t["title"],
                    "score": t["priorityScore"],
                    "explanation": t["priorityExplanation"]
                } for t in self.all_tasks[:5]]
            }
        except Exception as e:
            print(f"❌ Error initializing agent: {e}")
            return {"success": False, "error": str(e)}

    async def rebuild_tasks(self):
        dataset_dir = os.getenv("TASKPILOT_DATASET_DIR") or "./datasets"
        data_path = os.path.join(os.getcwd(), dataset_dir, "cleaned_tasks.json")
        
        if not os.path.exists(data_path):
            print(f"⚠️ Cleaned tasks file not found at {data_path}")
            self.all_tasks = []
            return

        with open(data_path, "r", encoding="utf-8") as f:
            cleaned_data = json.load(f)

        raw_tasks = []
        for source, tasks in cleaned_data.items():
            raw_tasks.extend(tasks)

        # Merge manually added tasks
        if self.added_tasks:
            for t in self.added_tasks:
                if not any(x.get("id") == t.get("id") for x in raw_tasks):
                    raw_tasks.append({
                        "id": t.get("id"),
                        "title": t.get("title"),
                        "body": t.get("body") or "",
                        "severity": t.get("severity") or "P2",
                        "due": t.get("due") or "",
                        "impact": t.get("impact") or 5,
                        "status": t.get("status") or "Todo",
                        "owner": t.get("owner") or "",
                        "team": t.get("team") or "Platform Apps",
                        "dependencies": t.get("dependencies") or [],
                        "type": "tracker",
                        "execution": t.get("execution") or {}
                    })

        # Run deduplication
        dedup_result = await self.prioritizer.deduplicateTasks(raw_tasks)
        tasks = dedup_result["tasks"]

        # Prioritize tasks
        tasks = await self.prioritizer.prioritizeTasks(tasks)

        # Update statuses based on completions and working tasks
        updated_tasks = []
        for t in tasks:
            is_done = t.get("id") in self.completed_task_ids or (t.get("aliases") and any(a in self.completed_task_ids for a in t.get("aliases")))
            is_in_progress = t.get("id") in self.working_task_ids or (t.get("aliases") and any(a in self.working_task_ids for a in t.get("aliases")))
            
            t["status"] = "Done" if is_done else ("In progress" if is_in_progress else (t.get("status") or "Todo"))
            updated_tasks.append(t)

        self.all_tasks = updated_tasks

    async def sync_state(self, live_state):
        self.completed_task_ids = live_state.get("completedTaskIds") or []
        self.working_task_ids = live_state.get("workingTaskIds") or []
        self.task_time_logs = live_state.get("taskTimeLogs") or {}
        self.manager_activity_feed = live_state.get("managerActivityFeed") or []
        self.manager_task_posts = live_state.get("managerTaskPosts") or []
        self.engineer_portal_posts = live_state.get("engineerPortalPosts") or []
        self.added_tasks = live_state.get("addedTasks") or []
        
        await self.rebuild_tasks()

    async def generateDailyPlan(self, engineer_name="Engineer", user_id=None):
        print(f"📋 Generating daily plan for {engineer_name}...")
        
        # Filter tasks for this engineer if user_id provided
        relevant_tasks = self.all_tasks
        if user_id:
            relevant_tasks = [t for t in self.all_tasks if t.get("assignee") == user_id or t.get("assignee") == engineer_name]

        # If no tasks assigned, show top priorities
        if not relevant_tasks:
            relevant_tasks = self.all_tasks[:15]

        self.current_plan = await self.prioritizer.generateDailyPlan(relevant_tasks[:10], engineer_name)
        
        return {
            "plan": self.current_plan,
            "totalTasks": len(relevant_tasks),
            "prioritizedTasks": relevant_tasks[:10]
        }

    async def generateWeeklySummary(self, engineer_name="Engineer"):
        local_summary = self._generateFallbackWeeklySummary()
        if not self.api_key:
            return local_summary

        prompt = f"""You are TaskPilot AI. Generate a weekly summary for {engineer_name}.

Total tasks in queue: {len(self.all_tasks)}

Top priorities this week:
{chr(10).join([f"{idx + 1}. {t.get('title')} ({t.get('priorityScore')}/100)" for idx, t in enumerate(self.all_tasks[:5])])}

Task breakdown by source:
{self._getTaskBreakdownBySource()}

Generate a concise weekly summary that includes:
1. Overall workload status
2. Key priorities for the week
3. Any potential blockers or urgent items
4. A motivating message

Keep it professional and actionable. Never use the word Gemini, use TaskPilot AI instead."""

        try:
            text = await self._call_gemini_vertex(prompt, max_tokens=1024, temperature=0.6)
            text = text.replace("Gemini", "TaskPilot AI")
            return text
        except Exception as e:
            print(f"Error generating weekly summary: {e}")
            return local_summary

    async def chat(self, user_message, engineer_name="Engineer"):
        print(f"💬 Processing chat: \"{user_message}\"")
        
        # Add user message to history
        self.conversation_history.append({
            "role": "user",
            "content": user_message
        })
        
        # Build context
        context = f"""You are TaskPilot AI, an intelligent task management assistant for software engineers.

Current Context:
- Total tasks: {len(self.all_tasks)}
- Top 3 priorities:
{chr(10).join([f"  {idx + 1}. {t.get('title')} ({t.get('priorityScore')}/100)" for idx, t in enumerate(self.all_tasks[:3])])}

{f"Current Daily Plan:\n{self.current_plan}\n" if self.current_plan else ""}

Recent conversation:
{chr(10).join([f"{m['role']}: {m['content']}" for m in self.conversation_history[-4:]])}

User: {user_message}

Respond helpfully and concisely. If asked about specific tasks, provide details. If asked to reprioritize, explain what you would do. Be proactive and insightful. Never use the word Gemini, use TaskPilot AI instead."""

        local_answer = self._generateLocalChatAnswer(user_message)

        if not self.api_key:
            self.conversation_history.append({
                "role": "assistant",
                "content": local_answer
            })
            return local_answer

        try:
            ai_response = await self._call_gemini_vertex(context, max_tokens=1024, temperature=0.7)
            ai_response = ai_response.replace("Gemini", "TaskPilot AI")
            
            self.conversation_history.append({
                "role": "assistant",
                "content": ai_response
            })
            return ai_response
        except Exception as e:
            print(f"Error in chat processing: {e}")
            self.conversation_history.append({
                "role": "assistant",
                "content": local_answer
            })
            return local_answer

    def _generateLocalChatAnswer(self, message):
        msg = message.lower().strip()
        
        if "top priority" in msg or "what should i do" in msg or "priority" in msg:
            if not self.all_tasks:
                return "You have no active tasks currently in your queue!"
            top = self.all_tasks[0]
            return f"Your top priority is **{top.get('title')}** (Score: {top.get('priorityScore')}/100). {top.get('priorityExplanation')}"
            
        if "blocker" in msg or "blocked" in msg:
            blockers = [t for t in self.all_tasks if any(isinstance(d, dict) and d.get("type") == "blocked_by" for d in t.get("dependencies", []))]
            if blockers:
                return f"You have {len(blockers)} blocked task(s):\n" + "\n".join([f"- **{t.get('title')}** ({t.get('source')})" for t in blockers])
            return "No active blocker penalties or blocked tasks detected in your queue."

        if "status" in msg or "how am i doing" in msg or "summary" in msg:
            return f"You currently have {len(self.all_tasks)} active tasks in your workspace. Source breakdown:\n{self._getTaskBreakdownBySource()}"

        return "I am TaskPilot AI, your real-time agent. Ask me about your top priorities, blockers, task status, or daily plan, and I will guide you!"

    async def detectUrgentItems(self):
        urgent_tasks = []
        for task in self.all_tasks:
            # Critical severity
            if int(task.get("severity", 3)) >= 5:
                urgent_tasks.append(task)
                continue
                
            # Approaching deadline (< 4 hours)
            deadline_str = task.get("deadline")
            if deadline_str:
                try:
                    now = datetime.now()
                    deadline = datetime.fromisoformat(deadline_str.replace("Z", "+00:00")).replace(tzinfo=None)
                    hours_until = (deadline - now).total_seconds() / 3600.0
                    if 0 < hours_until < 4:
                        urgent_tasks.append(task)
                        continue
                except Exception:
                    pass

            # High priority score
            if task.get("priorityScore", 0) >= 90:
                urgent_tasks.append(task)
                continue

        if urgent_tasks:
            return {
                "hasUrgent": True,
                "count": len(urgent_tasks),
                "tasks": urgent_tasks,
                "alert": self._generateUrgentAlert(urgent_tasks)
            }

        return {
            "hasUrgent": False,
            "count": 0,
            "tasks": [],
            "alert": None
        }

    async def addNewTask(self, new_task):
        print(f"➕ Adding new task: {new_task.get('title')}")
        
        # Add to list
        self.all_tasks.append(new_task)
        
        # Re-prioritize
        self.all_tasks = await self.prioritizer.prioritizeTasks(self.all_tasks)
        
        # Check if urgent
        urgent_check = await self.detectUrgentItems()
        
        return {
            "success": True,
            "newTaskPriority": next((t for t in self.all_tasks if t["id"] == new_task["id"]), None),
            "urgentAlert": urgent_check["alert"] if urgent_check["hasUrgent"] else None
        }

    def getTaskById(self, task_id):
        return next((t for t in self.all_tasks if t["id"] == task_id), None)

    def getTasks(self, filters=None):
        if filters is None:
            filters = {}
            
        tasks = list(self.all_tasks)
        
        if "source" in filters and filters["source"]:
            tasks = [t for t in tasks if t.get("source") == filters["source"]]
            
        if "priority" in filters and filters["priority"]:
            tasks = [t for t in tasks if t.get("priority") == filters["priority"]]
            
        if "assignee" in filters and filters["assignee"]:
            tasks = [t for t in tasks if t.get("assignee") == filters["assignee"]]
            
        if "limit" in filters and filters["limit"]:
            try:
                limit = int(filters["limit"])
                tasks = tasks[:limit]
            except Exception:
                pass
                
        return tasks

    def getDashboardStats(self):
        stats = {
            "total": len(self.all_tasks),
            "byPriority": {
                "critical": len([t for t in self.all_tasks if t.get("priority") == "critical"]),
                "high": len([t for t in self.all_tasks if t.get("priority") == "high"]),
                "medium": len([t for t in self.all_tasks if t.get("priority") == "medium"]),
                "low": len([t for t in self.all_tasks if t.get("priority") == "low"])
            },
            "bySource": {},
            "byStatus": {},
            "urgentCount": len([t for t in self.all_tasks if t.get("priorityScore", 0) >= 90]),
            "topTasks": self.all_tasks[:5]
        }
        
        for task in self.all_tasks:
            src = task.get("source", "unknown")
            stats["bySource"][src] = stats["bySource"].get(src, 0) + 1
            
            status = task.get("status", "unknown")
            stats["byStatus"][status] = stats["byStatus"].get(status, 0) + 1
            
        return stats

    def _getTaskBreakdownBySource(self):
        breakdown = {}
        for task in self.all_tasks:
            src = task.get("source", "unknown")
            breakdown[src] = breakdown.get(src, 0) + 1
            
        return "\n".join([f"- {source}: {count} tasks" for source, count in breakdown.items()])

    def _generateUrgentAlert(self, urgent_tasks):
        lines = [f"🚨 URGENT: {len(urgent_tasks)} high-priority item(s) require immediate attention:\n"]
        for idx, task in enumerate(urgent_tasks[:3]):
            lines.append(f"{idx + 1}. {task.get('title')}")
            lines.append(f"   Priority: {task.get('priorityScore')}/100")
            lines.append(f"   {task.get('priorityExplanation')}\n")
            
        if len(urgent_tasks) > 3:
            lines.append(f"... and {len(urgent_tasks) - 3} more urgent items.")
            
        return "\n".join(lines)

    def _generateFallbackWeeklySummary(self):
        high_pri = len([t for t in self.all_tasks if t.get("priorityScore", 0) >= 70])
        critical = len([t for t in self.all_tasks if int(t.get("severity", 3)) >= 5])
        
        summary = f"# 📊 Weekly Summary\n\n"
        summary += "Generated by **TaskPilot AI**.\n\n"
        summary += "## Workload Overview\n"
        summary += f"- Total tasks in queue: {len(self.all_tasks)}\n"
        summary += f"- High priority tasks: {high_pri}\n"
        summary += f"- Critical items: {critical}\n\n"
        
        summary += "## Top Priorities This Week\n"
        for idx, task in enumerate(self.all_tasks[:5]):
            summary += f"{idx + 1}. {task.get('title')} ({task.get('priorityScore')}/100)\n"
            
        summary += "\n## Task Breakdown by Source\n"
        summary += self._getTaskBreakdownBySource()
        summary += "\n\n*Maintain focus on the critical priorities to prevent SLA failures!*"
        return summary
