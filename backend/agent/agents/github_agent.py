import json
import os
from .base_agent import BaseAgent
from typing import List, Dict, Any

class GithubAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="GithubAgent",
            provider="openrouter",
            model="google/gemini-2.5-flash",  # OpenRouter model ID
            api_key_name="OPENROUTER_API_KEY"
        )
        self.raw_github: List[Dict[str, Any]] = []

    def load_data(self, dataset_dir: str):
        path = os.path.join(dataset_dir, "github_work.json")
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
                self.raw_github = data.get("items", [])
                self.log(f"Loaded {len(self.raw_github)} Github pull requests/issues.")
        except Exception as e:
            self.log(f"Error loading Github data: {e}", level="ERROR")
            self.raw_github = []

    def extract_domain_tasks(self) -> List[Dict[str, Any]]:
        self.log("Analyzing Github repository updates and review requests...")
        
        items_summary = []
        for g in self.raw_github:
            items_summary.append({
                "id": g.get("id"),
                "title": g.get("title"),
                "body": g.get("body", g.get("description", "")),
                "repo": g.get("repo", "Error-404/main"),
                "status": g.get("status", "open"),
                "owner": g.get("owner", "Unassigned"),
                "type": g.get("type", "pull_request")
            })

        prompt = f"""You are the TaskPilot Github Agent. You are specialized in code review oversight, pull request tracking, and branch release management.
Analyze the following Github items and extract tasks requiring engineer intervention.

Github Items:
{json.dumps(items_summary, indent=2)}

For each item, return a task dictionary containing:
- "id": issue or PR ID (e.g. PR-91)
- "title": descriptive title
- "description": what action the developer needs to take (e.g. review PR, fix conflicts)
- "severity": severity P1-P4
- "due": deadline or null
- "owner": assigned reviewer or contributor
- "dependencies": related issue IDs mentioned in description
- "domain_insight": your comment on code quality, review priority, or release blockers.

Return ONLY a valid JSON array of tasks. No markdown formatting or extra text.
[
  {{ "id": "...", ... }}
]"""
        try:
            raw_res = self.call_llm(prompt)
            tasks = self.extract_json(raw_res)
            if tasks and isinstance(tasks, list):
                self.log(f"Successfully extracted {len(tasks)} tasks from GitHub via OpenRouter.")
                return tasks
        except Exception as e:
            self.log(f"LLM extraction failed. Using fallback: {e}", level="WARN")

        # Fallback parsing
        fallback_tasks = []
        for g in self.raw_github:
            fallback_tasks.append({
                "id": g.get("id"),
                "title": f"Review {(g.get('type') or 'pr').replace('_', ' ')}: {g.get('title')}",
                "description": f"Repo: {g.get('repo')}. Action: {g.get('body')}",
                "severity": "P2" if "urgent" in g.get("body", "").lower() else "P3",
                "due": None,
                "owner": g.get("owner", "Unassigned"),
                "dependencies": [],
                "domain_insight": f"Heuristic extraction of GitHub item {g.get('id')}."
            })
        return fallback_tasks
