/**
 * Agent Orchestrator - Main agentic AI controller for TaskPilot
 * Autonomously processes tasks and provides intelligent recommendations
 * Uses Vertex AI endpoint (supports Google Cloud AQ. keys + AI Studio AIza keys)
 */

import { TaskPrioritizer } from './taskPrioritizer.mjs';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';

dotenv.config();

// ─── Vertex AI endpoint builder (handles both key types)
function buildVertexUrl(model) {
  const project  = process.env.VERTEX_AI_PROJECT  || "";
  const location = process.env.VERTEX_AI_LOCATION || "us-central1";
  const modelId  = (model || "gemini-2.5-flash").replace(/^.*\//, "");
  if (project) {
    return `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${modelId}:generateContent`;
  }
  return `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`;
}

async function callGemini(prompt, { model, maxTokens = 2048, temperature = 0.7 } = {}) {
  const apiKey = process.env.GEMINI_API_KEY || "";
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");
  const useModel = model || process.env.LLM_MODEL || "gemini-2.5-flash";
  const url = buildVertexUrl(useModel) + `?key=${apiKey}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens, temperature }
    })
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Gemini ${resp.status}: ${err}`);
  }
  const data = await resp.json();
  return (data.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
}

export class AgentOrchestrator {
  constructor() {
    this.prioritizer = new TaskPrioritizer();
    this.conversationHistory = [];
    this.currentPlan = null;
    this.allTasks = [];

    // Dynamic state properties synchronized from frontend
    this.completedTaskIds = [];
    this.workingTaskIds = [];
    this.taskTimeLogs = {};
    this.managerActivityFeed = [];
    this.managerTaskPosts = [];
    this.engineerPortalPosts = [];
    this.addedTasks = [];
  }

  /**
   * Initialize agent with cleaned task data
   */
  async initialize() {
    console.log('🚀 Initializing TaskPilot AI Agent...');
    
    try {
      // Try to load existing live state if it exists on disk
      const statePath = path.join(process.cwd(), 'datasets', 'live_state.json');
      try {
        const stateData = await fs.readFile(statePath, 'utf-8');
        const liveState = JSON.parse(stateData);
        this.completedTaskIds = liveState.completedTaskIds || [];
        this.workingTaskIds = liveState.workingTaskIds || [];
        this.taskTimeLogs = liveState.taskTimeLogs || {};
        this.managerActivityFeed = liveState.managerActivityFeed || [];
        this.managerTaskPosts = liveState.managerTaskPosts || [];
        this.engineerPortalPosts = liveState.engineerPortalPosts || [];
        this.addedTasks = liveState.addedTasks || [];
        console.log(`✅ Loaded existing live_state.json: ${this.completedTaskIds.length} done, ${this.workingTaskIds.length} working`);
      } catch (err) {
        console.log("No existing live_state.json found, starting fresh.");
      }

      await this.rebuildTasks();
      
      console.log('✅ TaskPilot AI Agent initialized successfully!');
      
      return {
        success: true,
        totalTasks: this.allTasks.length,
        topPriorities: this.allTasks.slice(0, 5).map(t => ({
          id: t.id,
          title: t.title,
          score: t.priorityScore,
          explanation: t.priorityExplanation
        }))
      };
    } catch (error) {
      console.error('❌ Error initializing agent:', error);
      throw error;
    }
  }

  /**
   * Rebuild prioritized tasks list by merging static data with addedTasks and updating statuses
   */
  async rebuildTasks() {
    // Load cleaned tasks
    const dataPath = path.join(process.cwd(), 'datasets', 'cleaned_tasks.json');
    const data = await fs.readFile(dataPath, 'utf-8');
    const cleanedData = JSON.parse(data);
    
    // Flatten all tasks from different sources
    let rawTasks = [];
    for (const [source, tasks] of Object.entries(cleanedData)) {
      rawTasks.push(...tasks);
    }
    
    // Merge manually added tasks
    if (this.addedTasks && this.addedTasks.length > 0) {
      this.addedTasks.forEach(t => {
        if (!rawTasks.some(x => x.id === t.id)) {
          rawTasks.push({
            id: t.id,
            title: t.title,
            body: t.body || "",
            severity: t.severity || "P2",
            due: t.due || "",
            impact: t.impact || 5,
            status: t.status || "Todo",
            owner: t.owner || "",
            team: t.team || "Platform Apps",
            dependencies: t.dependencies || [],
            type: "tracker",
            execution: t.execution || {}
          });
        }
      });
    }

    // Run deduplication
    const dedupResult = await this.prioritizer.deduplicateTasks(rawTasks);
    let tasks = dedupResult.tasks;
    
    // Prioritize tasks
    tasks = await this.prioritizer.prioritizeTasks(tasks);
    
    // Update statuses based on completions and in-progress tasks
    this.allTasks = tasks.map(t => {
      const isDone = this.completedTaskIds.includes(t.id) || (t.aliases && t.aliases.some(a => this.completedTaskIds.includes(a)));
      const isInProgress = this.workingTaskIds.includes(t.id) || (t.aliases && t.aliases.some(a => this.workingTaskIds.includes(a)));
      
      return {
        ...t,
        status: isDone ? "Done" : (isInProgress ? "In progress" : (t.status || "Todo"))
      };
    });
  }

  /**
   * Synchronize the state with frontend payload
   */
  async syncState(liveState) {
    this.completedTaskIds = liveState.completedTaskIds || [];
    this.workingTaskIds = liveState.workingTaskIds || [];
    this.taskTimeLogs = liveState.taskTimeLogs || {};
    this.managerActivityFeed = liveState.managerActivityFeed || [];
    this.managerTaskPosts = liveState.managerTaskPosts || [];
    this.engineerPortalPosts = liveState.engineerPortalPosts || [];
    this.addedTasks = liveState.addedTasks || [];

    await this.rebuildTasks();
  }

  /**
   * Generate daily plan
   */
  async generateDailyPlan(engineerName = 'Engineer', userId = null) {
    console.log(`📋 Generating daily plan for ${engineerName}...`);
    
    // Filter tasks for this engineer if userId provided
    let relevantTasks = this.allTasks;
    if (userId) {
      relevantTasks = this.allTasks.filter(t => 
        t.assignee === userId || t.assignee === engineerName
      );
    }
    
    // If no tasks assigned, show top priorities
    if (relevantTasks.length === 0) {
      relevantTasks = this.allTasks.slice(0, 15);
    }
    
    this.currentPlan = await this.prioritizer.generateDailyPlan(
      relevantTasks.slice(0, 10),
      engineerName
    );
    
    return {
      plan: this.currentPlan,
      totalTasks: relevantTasks.length,
      prioritizedTasks: relevantTasks.slice(0, 10)
    };
  }

  /**
   * Generate weekly summary
   */
  async generateWeeklySummary(engineerName = 'Engineer') {
    const prompt = `You are TaskPilot AI. Generate a weekly summary for ${engineerName}.

Total tasks in queue: ${this.allTasks.length}

Top priorities this week:
${this.allTasks.slice(0, 5).map((task, idx) => `
${idx + 1}. ${task.title} (${task.priorityScore}/100)
`).join('\n')}

Task breakdown by source:
${this._getTaskBreakdownBySource()}

Generate a concise weekly summary that includes:
1. Overall workload status
2. Key priorities for the week
3. Any potential blockers or urgent items
4. A motivating message

Keep it professional and actionable.`;

    try {
      return await callGemini(prompt, { maxTokens: 1024, temperature: 0.6 });
    } catch (error) {
      console.error('Error generating weekly summary:', error);
      return this._generateFallbackWeeklySummary();
    }
  }

  /**
   * Handle natural language conversation
   */
  async chat(userMessage, engineerName = 'Engineer') {
    console.log(`💬 Processing chat: "${userMessage}"`);
    
    this.conversationHistory.push({ role: 'user', content: userMessage });
    
    const context = `You are TaskPilot AI, an intelligent task management assistant for software engineers.

Current Context:
- Total tasks: ${this.allTasks.length}
- Top 3 priorities:
${this.allTasks.slice(0, 3).map((t, idx) => `  ${idx + 1}. ${t.title} (${t.priorityScore}/100)`).join('\n')}

${this.currentPlan ? `Current Daily Plan:\n${this.currentPlan}\n` : ''}

Recent conversation:
${this.conversationHistory.slice(-4).map(m => `${m.role}: ${m.content}`).join('\n')}

User: ${userMessage}

Respond helpfully and concisely. If asked about specific tasks, provide details. Be proactive and insightful.`;

    try {
      const aiResponse = await callGemini(context, { maxTokens: 1024, temperature: 0.7 });
      this.conversationHistory.push({ role: 'assistant', content: aiResponse });
      return aiResponse;
    } catch (error) {
      console.error('Error in chat:', error);
      return "I'm having trouble processing that request. Please try again.";
    }
  }

  /**
   * Detect and alert on urgent items proactively
   */
  async detectUrgentItems() {
    const urgentTasks = this.allTasks.filter(task => {
      // Critical severity
      if (task.severity >= 5) return true;
      
      // Approaching deadline (< 4 hours)
      if (task.deadline) {
        const hoursUntil = (new Date(task.deadline) - new Date()) / (1000 * 60 * 60);
        if (hoursUntil < 4 && hoursUntil > 0) return true;
      }
      
      // High priority score
      if (task.priorityScore >= 90) return true;
      
      return false;
    });
    
    if (urgentTasks.length > 0) {
      return {
        hasUrgent: true,
        count: urgentTasks.length,
        tasks: urgentTasks,
        alert: this._generateUrgentAlert(urgentTasks)
      };
    }
    
    return {
      hasUrgent: false,
      count: 0,
      tasks: [],
      alert: null
    };
  }

  /**
   * Re-prioritize when new task is added
   */
  async addNewTask(newTask) {
    console.log(`➕ Adding new task: ${newTask.title}`);
    
    // Add to task list
    this.allTasks.push(newTask);
    
    // Re-run prioritization
    this.allTasks = await this.prioritizer.prioritizeTasks(this.allTasks);
    
    // Check if it's urgent
    const urgentCheck = await this.detectUrgentItems();
    
    return {
      success: true,
      newTaskPriority: this.allTasks.find(t => t.id === newTask.id),
      urgentAlert: urgentCheck.hasUrgent ? urgentCheck.alert : null
    };
  }

  /**
   * Get task by ID with full details
   */
  getTaskById(taskId) {
    return this.allTasks.find(t => t.id === taskId);
  }

  /**
   * Get all tasks with optional filtering
   */
  getTasks(filters = {}) {
    let tasks = [...this.allTasks];
    
    if (filters.source) {
      tasks = tasks.filter(t => t.source === filters.source);
    }
    
    if (filters.priority) {
      tasks = tasks.filter(t => t.priority === filters.priority);
    }
    
    if (filters.assignee) {
      tasks = tasks.filter(t => t.assignee === filters.assignee);
    }
    
    if (filters.limit) {
      tasks = tasks.slice(0, filters.limit);
    }
    
    return tasks;
  }

  /**
   * Get dashboard statistics
   */
  getDashboardStats() {
    const stats = {
      total: this.allTasks.length,
      byPriority: {
        critical: this.allTasks.filter(t => t.priority === 'critical').length,
        high: this.allTasks.filter(t => t.priority === 'high').length,
        medium: this.allTasks.filter(t => t.priority === 'medium').length,
        low: this.allTasks.filter(t => t.priority === 'low').length
      },
      bySource: {},
      byStatus: {},
      urgentCount: this.allTasks.filter(t => t.priorityScore >= 90).length,
      topTasks: this.allTasks.slice(0, 5)
    };
    
    // Count by source
    this.allTasks.forEach(task => {
      stats.bySource[task.source] = (stats.bySource[task.source] || 0) + 1;
      stats.byStatus[task.status] = (stats.byStatus[task.status] || 0) + 1;
    });
    
    return stats;
  }

  // Helper methods
  
  _getTaskBreakdownBySource() {
    const breakdown = {};
    this.allTasks.forEach(task => {
      breakdown[task.source] = (breakdown[task.source] || 0) + 1;
    });
    
    return Object.entries(breakdown)
      .map(([source, count]) => `- ${source}: ${count} tasks`)
      .join('\n');
  }

  _generateUrgentAlert(urgentTasks) {
    return `🚨 URGENT: ${urgentTasks.length} high-priority item(s) require immediate attention:

${urgentTasks.slice(0, 3).map((task, idx) => `
${idx + 1}. ${task.title}
   Priority: ${task.priorityScore}/100
   ${task.priorityExplanation}
`).join('\n')}

${urgentTasks.length > 3 ? `\n... and ${urgentTasks.length - 3} more urgent items.` : ''}`;
  }

  _generateFallbackWeeklySummary() {
    return `# 📊 Weekly Summary

## Workload Overview
- Total tasks: ${this.allTasks.length}
- High priority: ${this.allTasks.filter(t => t.priorityScore >= 70).length}
- Critical: ${this.allTasks.filter(t => t.severity >= 5).length}

## Top Priorities This Week
${this.allTasks.slice(0, 5).map((task, idx) => `
${idx + 1}. ${task.title} (${task.priorityScore}/100)
`).join('\n')}

## Task Breakdown
${this._getTaskBreakdownBySource()}

Focus on completing the top priorities to stay on track!`;
  }
}

export default AgentOrchestrator;
