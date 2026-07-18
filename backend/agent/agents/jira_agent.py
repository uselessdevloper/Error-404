import json
import os
from .base_agent import BaseAgent
from typing import List, Dict, Any

class JiraAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="JiraAgent",
            provider="gemini",
            model="gemini-2.5-flash",
            api_key_name="GEMINI_API_KEY"
        )
        self.raw_tasks: List[Dict[str, Any]] = []

    def load_data(self, dataset_dir: str):
        path = os.path.join(dataset_dir, "jira_sprint_board.json")
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
                self.raw_tasks = data.get("items", [])
                self.log(f"Loaded {len(self.raw_tasks)} sprint board tasks from Jira.")
        except Exception as e:
            self.log(f"Error loading Jira data: {e}", level="ERROR")
            self.raw_tasks = []

    def extract_domain_tasks(self) -> List[Dict[str, Any]]:
        self.log("Analyzing Jira tickets and extracting work items...")
        
        # Prepare content for LLM ingestion
        items_summary = []
        for t in self.raw_tasks:
            items_summary.append({
                "id": t.get("id"),
                "title": t.get("title"),
                "body": t.get("body", t.get("description", "")),
                "severity": t.get("severity", "P3"),
                "due": t.get("due", ""),
                "status": t.get("status", "Todo"),
                "owner": t.get("owner", "Unassigned"),
                "dependencies": t.get("dependencies", [])
            })

        prompt = f"""You are the TaskPilot Jira Agent. You are specialized in sprint planning, ticket tracking, and blocker analysis.
Analyze the following Jira tickets and extract the active tasks that need attention.

Jira Tickets:
{json.dumps(items_summary, indent=2)}

For each ticket, return a standard task dictionary including:
- "id": ticket ID (e.g. JIRA-421)
- "title": ticket title
- "description": concise description
- "severity": severity P1-P4
- "due": deadline or null
- "owner": owner's name
- "dependencies": list of other ticket IDs it depends on
- "domain_insight": your specialized comment on sprint risk or blockers.

Return ONLY a valid JSON array of tasks. No markdown formatting or extra text. Use the array format:
[
  {{ "id": "...", ... }}
]"""
        try:
            raw_res = self.call_llm(prompt)
            tasks = self.extract_json(raw_res)
            if tasks and isinstance(tasks, list):
                self.log(f"Successfully extracted {len(tasks)} tasks via Gemini.")
                return tasks
        except Exception as e:
            self.log(f"LLM extraction failed. Using heuristic fallback: {e}", level="WARN")

        # Heuristic fallback
        fallback_tasks = []
        for t in self.raw_tasks:
            fallback_tasks.append({
                "id": t.get("id"),
                "title": t.get("title"),
                "description": t.get("body", t.get("description", "")),
                "severity": t.get("severity", "P3"),
                "due": t.get("due"),
                "owner": t.get("owner", "Unassigned"),
                "dependencies": t.get("dependencies", []),
                "domain_insight": f"Fallback extraction for Jira issue {t.get('id')}."
            })
        return fallback_tasks
