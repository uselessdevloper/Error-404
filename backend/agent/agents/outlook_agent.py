import json
import os
from .base_agent import BaseAgent
from typing import List, Dict, Any

class OutlookAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="OutlookAgent",
            provider="gemini",
            model="gemini-2.5-flash",
            api_key_name="GEMINI_API_KEY"
        )
        self.raw_emails: List[Dict[str, Any]] = []

    def load_data(self, dataset_dir: str):
        path = os.path.join(dataset_dir, "outlook_emails.json")
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
                self.raw_emails = data.get("items", [])
                self.log(f"Loaded {len(self.raw_emails)} emails from Outlook.")
        except Exception as e:
            self.log(f"Error loading Outlook data: {e}", level="ERROR")
            self.raw_emails = []

    def extract_domain_tasks(self) -> List[Dict[str, Any]]:
        self.log("Scanning Outlook inbox for executive escalations and client requests...")
        
        items_summary = []
        for e in self.raw_emails:
            items_summary.append({
                "id": e.get("id"),
                "sender": e.get("sender"),
                "title": e.get("title"),
                "body": e.get("body", e.get("description", "")),
                "severity": e.get("severity", "P3"),
                "due": e.get("due", "")
            })

        prompt = f"""You are the TaskPilot Outlook Agent. You are specialized in inbox management, identifying critical corporate escalations, and extracting action items from long threads.
Analyze the following emails and extract tasks requiring attention. Pay special attention to emails from VP senders, executives, or critical clients.

Emails:
{json.dumps(items_summary, indent=2)}

For each email, return a task dictionary containing:
- "id": email task ID (e.g. MAIL-920)
- "title": concise task title
- "description": what needs to be done, including sender context
- "severity": severity P1-P4 (flag as P1 if from a VP/executive with urgent wording)
- "due": deadline if specified, or null
- "owner": target person or Unassigned
- "dependencies": any ticket IDs mentioned in the email body
- "domain_insight": your comment on the stakeholder's identity and urgency level.

Return ONLY a valid JSON array of tasks. No markdown formatting or extra text.
[
  {{ "id": "...", ... }}
]"""
        try:
            raw_res = self.call_llm(prompt)
            tasks = self.extract_json(raw_res)
            if tasks and isinstance(tasks, list):
                self.log(f"Successfully extracted {len(tasks)} tasks from Outlook via Gemini.")
                return tasks
        except Exception as e:
            self.log(f"LLM extraction failed. Using fallback: {e}", level="WARN")

        # Fallback parsing
        fallback_tasks = []
        for e in self.raw_emails:
            sender = e.get("sender", "").lower()
            title = e.get("title", "").lower()
            is_vip = "vp" in sender or "vp" in title or "vice president" in sender
            
            fallback_tasks.append({
                "id": e.get("id"),
                "title": f"Process email: {e.get('title')}",
                "description": f"From {e.get('sender')}: {e.get('body')}",
                "severity": "P1" if is_vip else e.get("severity", "P3"),
                "due": e.get("due"),
                "owner": "Utkarsh" if "utkarsh" in e.get("body", "").lower() else "Unassigned",
                "dependencies": [],
                "domain_insight": f"Heuristic email scan. VIP status = {is_vip}."
            })
        return fallback_tasks
