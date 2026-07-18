import json
import os
from .base_agent import BaseAgent
from typing import List, Dict, Any

class MeetingNotesAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="MeetingNotesAgent",
            provider="gemini",
            model="gemini-2.5-flash",
            api_key_name="GEMINI_API_KEY"
        )
        self.raw_notes: List[Dict[str, Any]] = []

    def load_data(self, dataset_dir: str):
        path = os.path.join(dataset_dir, "meeting_notes.json")
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
                self.raw_notes = data.get("items", [])
                self.log(f"Loaded {len(self.raw_notes)} meeting notes.")
        except Exception as e:
            self.log(f"Error loading meeting notes: {e}", level="ERROR")
            self.raw_notes = []

    def extract_domain_tasks(self) -> List[Dict[str, Any]]:
        self.log("Parsing meeting transcripts and standup logs for action items...")
        
        items_summary = []
        for n in self.raw_notes:
            items_summary.append({
                "id": n.get("id"),
                "title": n.get("title"),
                "body": n.get("body", n.get("description", "")),
                "date": n.get("date", "")
            })

        prompt = f"""You are the TaskPilot Meeting Notes Agent. You are specialized in summarizing transcripts, capturing meeting decisions, and identifying assigned actions.
Analyze the following meeting notes and extract any action items that were assigned.

Meeting Notes:
{json.dumps(items_summary, indent=2)}

For each note, identify any explicit or implicit actions. Return a task dictionary for each task including:
- "id": generate a meeting task ID (e.g. MEET-33)
- "title": action item title
- "description": description of what needs to be done, including context
- "severity": severity P1-P4
- "due": deadline if mentioned, or null
- "owner": assigned person's name or Unassigned
- "dependencies": any issue IDs referenced in the notes (e.g. "Acme import JIRA-421" -> ["JIRA-421"])
- "domain_insight": your comment on alignment and deliverables.

Return ONLY a valid JSON array of tasks. No markdown formatting or extra text.
[
  {{ "id": "...", ... }}
]"""
        try:
            raw_res = self.call_llm(prompt)
            tasks = self.extract_json(raw_res)
            if tasks and isinstance(tasks, list):
                self.log(f"Successfully extracted {len(tasks)} tasks from meeting notes via Gemini.")
                return tasks
        except Exception as e:
            self.log(f"LLM extraction failed. Using fallback: {e}", level="WARN")

        # Fallback parsing
        fallback_tasks = []
        for n in self.raw_notes:
            fallback_tasks.append({
                "id": n.get("id"),
                "title": f"Follow up on meeting: {n.get('title')}",
                "description": n.get("body", n.get("description", "")),
                "severity": "P3",
                "due": None,
                "owner": "Unassigned",
                "dependencies": [],
                "domain_insight": f"Heuristic meeting notes extraction for {n.get('id')}."
            })
        return fallback_tasks
