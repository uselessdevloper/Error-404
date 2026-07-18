import os
import sys
import json
from dotenv import load_dotenv
from agents.coordinator_agent import CoordinatorAgent

# Load local environment variables from .env
dotenv_path = os.path.join(os.path.dirname(__file__), ".env")
load_dotenv(dotenv_path)

def main():
    print("=" * 60)
    print("🌟 TASKPILOT AI — MULTI-AGENT COORDINATION PIPELINE 🌟")
    print("=" * 60)

    # Resolve dataset directory path
    dataset_dir = os.environ.get("TASKPILOT_DATASET_DIR") or "../taskpilotai/datasets"
    abs_dataset_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), dataset_dir))
    
    if not os.path.exists(abs_dataset_dir):
        print(f"Error: Dataset directory not found at {abs_dataset_dir}")
        print("Please check your TASKPILOT_DATASET_DIR environment variable.")
        sys.exit(1)

    print(f"Loading datasets from: {abs_dataset_dir}")

    # Instantiate Coordinator Agent
    coordinator = CoordinatorAgent()
    coordinator.initialize_agents(abs_dataset_dir)
    
    # Run the pipeline (Domain analysis -> Debate -> NVIDIA Synthesis)
    pipeline_result = coordinator.run_multi_agent_pipeline()

    # Generate Observability Report in Markdown
    report_path = os.path.join(os.path.dirname(__file__), "agent_observability_report.md")
    generate_observability_report(pipeline_result, report_path)

    print("\n" + "=" * 60)
    print("🎉 PIPELINE COMPLETED SUCCESSFULLY!")
    print(f"Observability Report generated at: {report_path}")
    print("=" * 60)

def generate_observability_report(result: dict, output_path: str):
    dialogue_log = result.get("dialogue_log", [])
    all_extracted_tasks = result.get("all_extracted_tasks", {})
    final_priorities = result.get("final_priorities", {})
    
    markdown_content = []
    
    markdown_content.append("# TaskPilot AI — Multi-Agent Coordination & Observability Report\n")
    markdown_content.append("## 🛡️ Observability Attestation")
    attestation = final_priorities.get("observability_attestation", {})
    markdown_content.append(f"- **Primary Coordinator**: {attestation.get('coordinator', 'N/A')}")
    markdown_content.append(f"- **Final Synthesizer**: {attestation.get('final_synthesizer', 'N/A')}")
    markdown_content.append(f"- **Attestation Status**: `{attestation.get('status', 'N/A')}`\n")
    
    markdown_content.append("---")
    markdown_content.append("## 🗣️ Agent Roundtable & Consensus Dialogue Transcript")
    markdown_content.append("Below is the dialogue transcript from the roundtable debate where individual agents communicated to identify overlaps, check escalations, and agree on merges.\n")
    
    for turn in dialogue_log:
        agent = turn.get("agent", "Unknown")
        statement = turn.get("statement", "")
        markdown_content.append(f"> **{agent}**: {statement}\n")

    markdown_content.append("---")
    markdown_content.append("## 📦 Domain Task Extractions")
    markdown_content.append("Summary of tasks initially extracted by specialized agents before consolidation:\n")
    for domain, tasks in all_extracted_tasks.items():
        markdown_content.append(f"### {domain.upper()} Agent ({len(tasks)} items)")
        for t in tasks:
            markdown_content.append(f"- **[{t.get('id')}] {t.get('title')}** (Severity: {t.get('severity')}, Owner: {t.get('owner')})")
            markdown_content.append(f"  * {t.get('description')}")
            if t.get("domain_insight"):
                markdown_content.append(f"  * _Domain Insight:_ {t.get('domain_insight')}")
        markdown_content.append("")

    markdown_content.append("---")
    markdown_content.append("## 🏆 NVIDIA NIM Prioritized Daily Plan")
    markdown_content.append("The final prioritized tasks and execution schedule synthesized by the **NVIDIA NIM (Nemotron)** model:\n")
    
    for t in final_priorities.get("canonical_tasks", []):
        markdown_content.append(f"### 🎯 [{t.get('id')}] {t.get('title')} (Score: {t.get('priority_score')}/100 | Severity: {t.get('severity')})")
        markdown_content.append(f"- **Owner**: {t.get('owner')}")
        markdown_content.append(f"- **Sources**: {', '.join(t.get('sources', []))} (Original IDs: {', '.join(t.get('original_ids', []))})")
        markdown_content.append(f"- **Description**: {t.get('description')}")
        markdown_content.append(f"- **Priority Reasoning**: {t.get('reasoning')}\n")

    markdown_content.append("### 🗓️ Recommended Daily Schedule")
    for item in final_priorities.get("daily_plan", []):
        markdown_content.append(f"{item.get('rank')}. **[{item.get('task_id')}] {item.get('title')}** (~{item.get('time_estimate_mins')} mins)")

    with open(output_path, "w", encoding="utf-8") as f:
        f.write("\n".join(markdown_content))

if __name__ == "__main__":
    main()
