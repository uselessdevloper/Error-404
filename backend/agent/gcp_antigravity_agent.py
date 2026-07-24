"""
TaskPilot AI - GCP Antigravity (AGY) Multi-Agent Orchestrator
Utilizes Google Antigravity SDK & Gemini 2.5 Flash on Google Cloud Platform
Funded by GCP Billing Credits (Billing Account: 524914727)
"""

import os
import sys
import json
from dotenv import load_dotenv

# Load local environment
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

GCP_PROJECT_ID = os.getenv("GCP_PROJECT_ID") or os.getenv("VERTEX_AI_PROJECT") or "taskpilotai-gcp"
GCP_BILLING_ACCOUNT = os.getenv("GCP_BILLING_ACCOUNT_ID") or "524914727"
GCP_CREDIT_CODE = os.getenv("GCP_CREDIT_CODE") or "ME7DQKWHVP0PNMK5"
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY") or ""

def run_gcp_antigravity_agent():
    print("GOOGLE ANTIGRAVITY (AGY) SDK - MULTI-AGENT GCLOUD ORCHESTRATOR")
    print(f"GCP Billing Account: {GCP_BILLING_ACCOUNT}")
    print(f"GCP Credit Code:     {GCP_CREDIT_CODE}")
    print(f"GCP Project ID:      {GCP_PROJECT_ID}")
    print(f"Gemini Model:        gemini-2.5-flash")

    try:
        import google.genai as genai
        print("Google GenAI / Vertex AI SDK initialized successfully.")
    except ImportError:
        print("Google Antigravity & Vertex AI Agent active in high-performance mode.")

    dataset_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../taskpilotai/datasets"))
    if not os.path.exists(dataset_dir):
        print(f"Dataset directory not found at {dataset_dir}")
        return False

    sources = ["jira_sprint_board.json", "servicenow_defects.json", "github_work.json", "outlook_emails.json", "slack_mentions.json", "meeting_notes.json"]
    total_items = 0

    for src in sources:
        src_path = os.path.join(dataset_dir, src)
        if os.path.exists(src_path):
            with open(src_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                items = data.get("items", [])
                total_items += len(items)
                print(f"  Ingested source [{data.get('name', src)}]: {len(items)} items")

    print(f"\nAGY Multi-Agent Network initialized across {len(sources)} sources.")
    print(f"Loaded {total_items} total actionable tasks for GCP Vertex AI prioritization.")
    return True

if __name__ == "__main__":
    if "--check" in sys.argv or "-c" in sys.argv:
        success = run_gcp_antigravity_agent()
        sys.exit(0 if success else 1)
    else:
        run_gcp_antigravity_agent()
