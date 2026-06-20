import os
import math
import requests
from datetime import datetime
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()

class TaskPrioritizer:
    def __init__(self):
        # Configure API key
        self.api_key = os.getenv("GEMINI_API_KEY") or ""
        self.model_name = os.getenv("LLM_MODEL") or "gemini-2.5-flash"
        self.model = True if self.api_key else None

    def _call_gemini_vertex(self, prompt, max_tokens=1024, temperature=0.7) -> str:
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

        # Priority weights from environment variables
        self.weights = {
            "severity": float(os.getenv("PRIORITY_WEIGHT_SEVERITY", 0.4)),
            "deadline": float(os.getenv("PRIORITY_WEIGHT_DEADLINE", 0.3)),
            "dependencies": float(os.getenv("PRIORITY_WEIGHT_DEPENDENCIES", 0.2)),
            "businessImpact": float(os.getenv("PRIORITY_WEIGHT_BUSINESS_IMPACT", 0.1))
        }

    def calculatePriorityScore(self, task):
        scores = {
            "severity": self._scoreSeverity(task),
            "deadline": self._scoreDeadline(task),
            "dependencies": self._scoreDependencies(task),
            "businessImpact": self._scoreBusinessImpact(task)
        }

        # Weighted total
        total_score = (
            scores["severity"] * self.weights["severity"] +
            scores["deadline"] * self.weights["deadline"] +
            scores["dependencies"] * self.weights["dependencies"] +
            scores["businessImpact"] * self.weights["businessImpact"]
        )

        return {
            "score": round(total_score),
            "breakdown": scores,
            "weights": self.weights
        }

    def _scoreSeverity(self, task):
        severity = task.get("severity", 3)
        severity_map = {
            5: 100, # Critical
            4: 80,  # High
            3: 60,  # Medium
            2: 40,  # Low
            1: 20   # Trivial
        }
        try:
            val = int(severity)
        except Exception:
            val = 3
        return severity_map.get(val, 60)

    def _scoreDeadline(self, task):
        deadline_str = task.get("deadline")
        if not deadline_str:
            return 50  # Default if no deadline

        try:
            now = datetime.now()
            # Clean string format
            deadline_str = deadline_str.replace("Z", "+00:00")
            deadline = datetime.fromisoformat(deadline_str).replace(tzinfo=None)
            hours_until = (deadline - now).total_seconds() / 3600.0

            if hours_until < 0:
                return 100  # Past deadline
            if hours_until < 4:
                return 95   # Less than 4 hours
            if hours_until < 24:
                return 85   # Less than 1 day
            if hours_until < 72:
                return 70   # Less than 3 days
            if hours_until < 168:
                return 50   # Less than 1 week
            return 30       # More than a week
        except Exception:
            return 50

    def _scoreDependencies(self, task):
        deps = task.get("dependencies", [])
        if not deps:
            return 50
        
        # If any dependencies blocks others
        if any(isinstance(d, dict) and d.get("type") == "blocks" for d in deps):
            return 80
        if any(isinstance(d, dict) and d.get("type") == "blocked_by" for d in deps):
            return 40
        return 50

    def _scoreBusinessImpact(self, task):
        impact_keywords = {
            "high": ["customer", "production", "revenue", "security", "vp", "ceo", "escalation"],
            "medium": ["feature", "improvement", "team", "efficiency"],
            "low": ["refactor", "cleanup", "documentation"]
        }

        title = task.get("title", "") or ""
        desc = task.get("description", "") or ""
        text = f"{title} {desc}".lower()

        if any(kw in text for kw in impact_keywords["high"]):
            return 90
        if any(kw in text for kw in impact_keywords["medium"]):
            return 60
        if any(kw in text for kw in impact_keywords["low"]):
            return 30
        
        return 50  # Default

    async def generateExplanation(self, task, priority_data):
        score = priority_data["score"]
        
        # Default local explanation generator to avoid 403 API blocking issues
        local_reason = self._generateLocalExplanation(task, priority_data)
        
        if not self.api_key:
            return local_reason

        prompt = f"""You are TaskPilot AI, an intelligent task management assistant.

Task: {task.get('title')}
Source: {task.get('source')}
Priority Score: {score}/100

Score Breakdown:
- Severity ({self.weights['severity'] * 100}% weight): {priority_data['breakdown']['severity']}/100
- Deadline Urgency ({self.weights['deadline'] * 100}% weight): {priority_data['breakdown']['deadline']}/100
- Dependencies ({self.weights['dependencies'] * 100}% weight): {priority_data['breakdown']['dependencies']}/100
- Business Impact ({self.weights['businessImpact'] * 100}% weight): {priority_data['breakdown']['businessImpact']}/100

Generate a concise, one-sentence explanation for why this task has this priority ranking.
Start with "Priority {score}/100 because..."
Keep it clear, specific, and actionable. Mention the most important factor. Never use the word Gemini, use TaskPilot AI instead."""

        try:
            text = self._call_gemini_vertex(prompt)
            # Safety check: clean any mention of Gemini in the generated text
            text = text.replace("Gemini", "TaskPilot AI")
            return text
        except Exception as e:
            print(f"Error calling generative model for explanation: {e}")
            return local_reason

    def _generateLocalExplanation(self, task, priority_data):
        score = priority_data["score"]
        breakdown = priority_data["breakdown"]
        
        # Identify the highest scoring component
        highest_factor = max(breakdown, key=breakdown.get)
        
        if highest_factor == "severity" and breakdown["severity"] >= 80:
            return f"Priority {score}/100 because this is a critical severity task requiring immediate resolution."
        elif highest_factor == "deadline" and breakdown["deadline"] >= 85:
            return f"Priority {score}/100 because the deadline is highly urgent or has already passed."
        elif highest_factor == "businessImpact" and breakdown["businessImpact"] >= 90:
            return f"Priority {score}/100 because it has a high business impact on core production systems or customers."
        elif highest_factor == "dependencies" and breakdown["dependencies"] >= 80:
            return f"Priority {score}/100 because this task blocks other critical deliverables."
        else:
            return f"Priority {score}/100 calculated by TaskPilot AI based on severity, deadline, and impact factors."

    async def prioritizeTasks(self, tasks):
        print(f"🤖 TaskPilot AI: Prioritizing {len(tasks)} tasks...")
        
        tasks_with_priority = []
        for task in tasks:
            priority_data = self.calculatePriorityScore(task)
            explanation = await self.generateExplanation(task, priority_data)

            tasks_with_priority.append({
                **task,
                "priorityScore": priority_data["score"],
                "priorityBreakdown": priority_data["breakdown"],
                "priorityExplanation": explanation,
                "priorityWeights": priority_data["weights"]
            })

        # Sort by priority score descending
        tasks_with_priority.sort(key=lambda x: x["priorityScore"], reverse=True)
        print("✅ Tasks prioritized successfully!")
        return tasks_with_priority

    async def deduplicateTasks(self, tasks):
        print(f"🔍 TaskPilot AI: Deduplicating {len(tasks)} tasks...")
        
        unique_tasks = []
        duplicate_groups = []
        threshold = float(os.getenv("DEDUP_SIMILARITY_THRESHOLD", 0.85))

        for i, task in enumerate(tasks):
            is_duplicate = False

            for j, unique in enumerate(unique_tasks):
                similarity = await self._calculateSimilarity(task, unique)
                
                if similarity >= threshold:
                    is_duplicate = True
                    # Merge task
                    unique_tasks[j] = self._mergeTasks(unique, task)
                    duplicate_groups.append({
                        "primary": unique_tasks[j]["id"],
                        "duplicate": task["id"],
                        "similarity": similarity
                    })
                    break

            if not is_duplicate:
                unique_tasks.append(task)

        print(f"✅ Deduplication complete: {len(tasks)} -> {len(unique_tasks)} tasks")
        return {
            "tasks": unique_tasks,
            "duplicateGroups": duplicate_groups
        }

    async def _calculateSimilarity(self, task1, task2):
        # We always implement the local string similarity fallback to handle blocked api keys
        local_sim = self._simpleStringSimilarity(task1.get("title", ""), task2.get("title", ""))
        
        if not self.api_key:
            return local_sim

        prompt = f"""Compare these two tasks and rate their similarity from 0.0 to 1.0:

Task A:
Title: {task1.get('title')}
Description: {task1.get('description')}
Source: {task1.get('source')}

Task B:
Title: {task2.get('title')}
Description: {task2.get('description')}
Source: {task2.get('source')}

Are these tasks referring to the same work item or issue?
Respond with ONLY a number between 0.0 (completely different) and 1.0 (identical)."""

        try:
            text = self._call_gemini_vertex(prompt)
            similarity = float(text)
            return min(max(similarity, 0.0), 1.0)
        except Exception:
            return local_sim

    def _simpleStringSimilarity(self, str1, str2):
        s1 = str1.lower()
        s2 = str2.lower()
        
        longer = s1 if len(s1) > len(s2) else s2
        shorter = s2 if len(s1) > len(s2) else s1
        
        if len(longer) == 0:
            return 1.0
            
        edit_dist = self._levenshteinDistance(longer, shorter)
        return (len(longer) - edit_dist) / len(longer)

    def _levenshteinDistance(self, str1, str2):
        matrix = []
        for i in range(len(str2) + 1):
            matrix.append([i])
            
        for j in range(len(str1) + 1):
            matrix[0].append(j)

        for i in range(1, len(str2) + 1):
            for j in range(1, len(str1) + 1):
                if str2[i - 1] == str1[j - 1]:
                    matrix[i].append(matrix[i - 1][j - 1])
                else:
                    matrix[i].append(min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    ))
        return matrix[len(str2)][len(str1)]

    def _mergeTasks(self, primary, duplicate):
        sources = primary.get("sources", [primary.get("source")])
        if duplicate.get("source") not in sources:
            sources.append(duplicate.get("source"))
            
        merged_from = primary.get("mergedFrom", [])
        if duplicate.get("id") not in merged_from:
            merged_from.append(duplicate.get("id"))

        labels = primary.get("labels", [])
        for label in duplicate.get("labels", []):
            if label not in labels:
                labels.append(label)

        deps = primary.get("dependencies", [])
        for dep in duplicate.get("dependencies", []):
            if dep not in deps:
                deps.append(dep)

        return {
            **primary,
            "sources": sources,
            "mergedFrom": merged_from,
            "description": primary.get("description") or duplicate.get("description"),
            "severity": max(primary.get("severity", 0), duplicate.get("severity", 0)),
            "deadline": self._earlierDate(primary.get("deadline"), duplicate.get("deadline")),
            "labels": labels,
            "dependencies": deps
        }

    def _earlierDate(self, date1, date2):
        if not date1:
            return date2
        if not date2:
            return date1
        try:
            d1 = datetime.fromisoformat(date1.replace("Z", "+00:00"))
            d2 = datetime.fromisoformat(date2.replace("Z", "+00:00"))
            return date1 if d1 < d2 else date2
        except Exception:
            return date1

    async def generateDailyPlan(self, tasks, engineerName="Engineer"):
        top_tasks = tasks[:10]
        local_plan = self._generateLocalPlan(top_tasks, engineerName)
        
        if not self.model or not self.api_key:
            return local_plan

        prompt = f"""You are TaskPilot AI. Generate a clear, actionable daily plan for {engineerName}.

Here are today's top prioritized tasks:

{chr(10).join([f"{idx + 1}. {t.get('title')} ({t.get('source')}, Score: {t.get('priorityScore')}/100) - {t.get('priorityExplanation')}" for idx, t in enumerate(top_tasks)])}

Generate a structured daily plan in markdown format with:
1. A motivating opening line
2. Top 3 priorities clearly highlighted
3. Suggested time blocks for each task
4. Any alerts or urgent items
5. A brief summary at the end

Keep it concise, clear, and actionable. Never mention Gemini in the plan, use TaskPilot AI instead."""

        try:
            response = self.model.generate_content(prompt)
            text = response.text.strip()
            # Safety clean
            text = text.replace("Gemini", "TaskPilot AI")
            return text
        except Exception as e:
            print(f"Error calling model for daily plan: {e}")
            return local_plan

    def _generateLocalPlan(self, tasks, engineerName):
        top3 = tasks[:3]
        
        plan = f"# 📋 Daily Plan for {engineerName}\n\n"
        plan += "Generated by **TaskPilot AI** based on real-time priorities.\n\n"
        plan += "## 🎯 Top 3 Priorities\n\n"
        
        for idx, task in enumerate(top3):
            plan += f"### {idx + 1}. {task.get('title')}\n"
            plan += f"- **Priority Score:** {task.get('priorityScore')}/100\n"
            plan += f"- **System Source:** {task.get('source')}\n"
            plan += f"- **Rationale:** {task.get('priorityExplanation')}\n\n"

        plan += "## 📝 Additional Tasks Queue\n\n"
        for idx, task in enumerate(tasks[3:10]):
            plan += f"- **{idx + 4}.** {task.get('title')} (Score: {task.get('priorityScore')}/100) — *{task.get('source')}*\n"
            
        plan += f"\n---\n**Focus on completing the top 3 items first to ensure SLA standards are met!**"
        return plan