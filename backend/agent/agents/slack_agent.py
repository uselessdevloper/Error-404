import json
import os
from .base_agent import BaseAgent
from typing import List, Dict, Any

class SlackAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="SlackAgent",
            provider="grok",
            model="grok-3-mini",
            api_key_name="GROK_API_KEY"
        )
        self.raw_mentions: List[Dict[str, Any]] = []

    def load_data(self, dataset_dir: str):
        path = os.path.join(dataset_dir, "slack_mentions.json")
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
                self.raw_mentions = data.get("items", [])
                self.log(f"Loaded {len(self.raw_mentions)} Slack mentions.")
        except Exception as e:
            self.log(f"Error loading Slack data: {e}", level="ERROR")
            self.raw_mentions = []

    def extract_domain_tasks(self) -> List[Dict[str, Any]]:
        self.log("Parsing Slack mentions for hidden tasks and team communications...")
        
        items_summary = []
        for m in self.raw_mentions:
            items_summary.append({
                "id": m.get("id"),
                "sender": m.get("sender"),
                "channel": m.get("channel"),
                "body": m.get("body", m.get("description", "")),
                "timestamp": m.get("timestamp", "")
            })

        prompt = f"""You are the TaskPilot Slack Agent. You are specialized in chat scraping, parsing casual team chat for commitments, and finding critical follow-ups.
Analyze these Slack mentions and extract any actionable tasks.

Slack Mentions:
{json.dumps(items_summary, indent=2)}

For each message, if there is an action item or request, return a task dictionary containing:
- "id": generate a Slack task ID (e.g. SLACK-201)
- "title": short descriptive title of the action needed
- "description": what was requested in the chat, including the context
- "severity": severity P1-P4 (upgrade to P1/P2 if it mentions "blocked", "outage", or "urgent")
- "due": deadline if mentioned, or null
- "owner": target person mentioned or assignee
- "dependencies": any issue IDs mentioned (e.g. "fixes JIRA-421" -> ["JIRA-421"])
- "domain_insight": your comment on the urgency and channel dynamics.

Return ONLY a valid JSON array of tasks. No markdown formatting or extra text.
[
  {{ "id": "...", ... }}
]"""
        try:
            raw_res = self.call_llm(prompt)
            tasks = self.extract_json(raw_res)
            if tasks and isinstance(tasks, list):
                self.log(f"Successfully extracted {len(tasks)} tasks from Slack via Grok.")
                return tasks
        except Exception as e:
            self.log(f"LLM extraction failed. Using fallback: {e}", level="WARN")

        # Fallback parsing
        fallback_tasks = []
        for m in self.raw_mentions:
            body = m.get("body", "")
            if "please" in body.lower() or "need" in body.lower() or "fix" in body.lower():
                fallback_tasks.append({
                    "id": m.get("id", f"SLACK-{m.get('sender', 'user')[:3].upper()}"),
                    "title": f"Follow up on Slack mention from {m.get('sender')}",
                    "description": body,
                    "severity": "P2" if "urgent" in body.lower() else "P3",
                    "due": None,
                    "owner": "Utkarsh" if "utkarsh" in body.lower() else "Unassigned",
                    "dependencies": [],
                    "domain_insight": f"Heuristic extraction of mention from {m.get('sender')}."
                })
        return fallback_tasks
