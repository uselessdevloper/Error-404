import json
import os
from .base_agent import BaseAgent
from typing import List, Dict, Any

class ServiceNowAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="ServiceNowAgent",
            provider="grok",
            model="grok-3-mini",
            api_key_name="GROK_API_KEY"
        )
        self.raw_defects: List[Dict[str, Any]] = []

    def load_data(self, dataset_dir: str):
        path = os.path.join(dataset_dir, "servicenow_defects.json")
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
                self.raw_defects = data.get("items", [])
                self.log(f"Loaded {len(self.raw_defects)} ServiceNow defects/incidents.")
        except Exception as e:
            self.log(f"Error loading ServiceNow data: {e}", level="ERROR")
            self.raw_defects = []

    def extract_domain_tasks(self) -> List[Dict[str, Any]]:
        self.log("Retrieving ServiceNow incidents and checking SLA thresholds...")
        
        items_summary = []
        for d in self.raw_defects:
            items_summary.append({
                "id": d.get("id"),
                "title": d.get("title"),
                "body": d.get("body", d.get("description", "")),
                "severity": d.get("severity", "P3"),
                "due": d.get("due", ""),
                "status": d.get("status", "New")
            })

        prompt = f"""You are the TaskPilot ServiceNow Agent. You are specialized in incident response, SLA tracking, and database/infrastructure outages.
Analyze the following ServiceNow defects and extract active tickets that need urgent intervention.

ServiceNow Defects:
{json.dumps(items_summary, indent=2)}

For each defect, return a task dictionary containing:
- "id": incident ID (e.g. INC-7741)
- "title": ticket title
- "description": what system has failed or needs fixing
- "severity": severity P1-P4 (critical outages should be P1)
- "due": SLA resolution date or null
- "owner": assigned staff or Unassigned
- "dependencies": any linked tickets or systems mentioned in description
- "domain_insight": your comment on SLA risk, production impact, or escalation triggers.

Return ONLY a valid JSON array of tasks. No markdown formatting or extra text.
[
  {{ "id": "...", ... }}
]"""
        try:
            raw_res = self.call_llm(prompt)
            tasks = self.extract_json(raw_res)
            if tasks and isinstance(tasks, list):
                self.log(f"Successfully extracted {len(tasks)} tasks from ServiceNow via Grok.")
                return tasks
        except Exception as e:
            self.log(f"LLM extraction failed. Using fallback: {e}", level="WARN")

        # Fallback parsing
        fallback_tasks = []
        for d in self.raw_defects:
            fallback_tasks.append({
                "id": d.get("id"),
                "title": f"Resolve Incident: {d.get('title')}",
                "description": d.get("body", d.get("description", "")),
                "severity": d.get("severity", "P3"),
                "due": d.get("due"),
                "owner": "Unassigned",
                "dependencies": [],
                "domain_insight": f"Heuristic ServiceNow parsing for {d.get('id')}."
            })
        return fallback_tasks
