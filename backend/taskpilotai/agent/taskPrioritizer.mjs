/**
 * Task Prioritization Engine — multi-provider LLM with automatic fallback
 * Supports Gemini, NVIDIA, and Grok with priority chain
 */

import dotenv from 'dotenv';

dotenv.config();

function buildVertexUrl(model) {
  const modelId = (model || "gemini-2.5-flash").replace(/^.*\//, "");
  return `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`;
}

async function callProvider(provider, prompt, { model, maxTokens = 512, temperature = 0.4 } = {}) {
  let apiKey, url, headers, body;

  if (provider === "nvidia") {
    apiKey = process.env.NVIDIA_API_KEY;
    if (!apiKey) throw new Error("NVIDIA_API_KEY not set");
    url = "https://integrate.api.nvidia.com/v1/chat/completions";
    headers = { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` };
    body = { model: model || "nvidia/llama-3.1-nemotron-70b-instruct", messages: [{ role: "user", content: prompt }], temperature, max_tokens: maxTokens };
  } else if (provider === "grok") {
    apiKey = process.env.GROK_API_KEY;
    if (!apiKey) throw new Error("GROK_API_KEY not set");
    url = "https://api.x.ai/v1/chat/completions";
    headers = { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` };
    body = { model: model || "grok-3-mini", messages: [{ role: "user", content: prompt }], temperature, max_tokens: maxTokens };
  } else {
    apiKey = process.env.GEMINI_API_KEY || "";
    if (!apiKey) throw new Error("GEMINI_API_KEY not set");
    const useModel = model || process.env.LLM_MODEL || "gemini-2.5-flash";
    url = buildVertexUrl(useModel) + `?key=${apiKey}`;
    headers = { "Content-Type": "application/json" };
    body = { contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: maxTokens, temperature } };
  }

  const resp = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  if (!resp.ok) throw new Error(`${provider.toUpperCase()} ${resp.status}: ${(await resp.text()).slice(0, 150)}`);
  const data = await resp.json();
  return ((provider === "nvidia" || provider === "grok")
    ? data.choices?.[0]?.message?.content
    : data.candidates?.[0]?.content?.parts?.[0]?.text) || "";
}

async function callGemini(prompt, opts = {}) {
  const primary = process.env.LLM_PROVIDER || "gemini";
  const hasKey = { gemini: Boolean(process.env.GEMINI_API_KEY), nvidia: Boolean(process.env.NVIDIA_API_KEY), grok: Boolean(process.env.GROK_API_KEY) };
  const chain = [primary, ...["gemini", "nvidia", "grok"].filter(p => p !== primary && hasKey[p])];
  let lastErr;
  for (const p of chain) {
    try { return (await callProvider(p, prompt, opts)).trim(); }
    catch (e) { lastErr = e; console.warn(`[Prioritizer] ${p} failed: ${e.message}`); }
  }
  throw new Error(`All LLM providers failed: ${lastErr?.message}`);
}

export class TaskPrioritizer {
  constructor() {
    // Priority weights from environment
    this.weights = {
      severity: parseFloat(process.env.PRIORITY_WEIGHT_SEVERITY || 0.4),
      deadline: parseFloat(process.env.PRIORITY_WEIGHT_DEADLINE || 0.3),
      dependencies: parseFloat(process.env.PRIORITY_WEIGHT_DEPENDENCIES || 0.2),
      businessImpact: parseFloat(process.env.PRIORITY_WEIGHT_BUSINESS_IMPACT || 0.1)
    };
  }

  /**
   * Calculate priority score for a task
   * Returns score (0-100) and detailed reasoning
   */
  calculatePriorityScore(task) {
    const scores = {
      severity: this._scoreSeverity(task),
      deadline: this._scoreDeadline(task),
      dependencies: this._scoreDependencies(task),
      businessImpact: this._scoreBusinessImpact(task)
    };

    // Weighted total
    const totalScore = 
      scores.severity * this.weights.severity +
      scores.deadline * this.weights.deadline +
      scores.dependencies * this.weights.dependencies +
      scores.businessImpact * this.weights.businessImpact;

    return {
      score: Math.round(totalScore),
      breakdown: scores,
      weights: this.weights
    };
  }

  /**
   * Score based on severity (0-100)
   */
  _scoreSeverity(task) {
    const severityMap = {
      5: 100, // Critical
      4: 80,  // High
      3: 60,  // Medium
      2: 40,  // Low
      1: 20   // Trivial
    };
    
    return severityMap[task.severity] || 60;
  }

  /**
   * Score based on deadline urgency (0-100)
   */
  _scoreDeadline(task) {
    if (!task.deadline) return 50; // Default if no deadline

    const now = new Date();
    const deadline = new Date(task.deadline);
    const hoursUntilDeadline = (deadline - now) / (1000 * 60 * 60);

    if (hoursUntilDeadline < 0) return 100; // Past deadline
    if (hoursUntilDeadline < 4) return 95;   // Less than 4 hours
    if (hoursUntilDeadline < 24) return 85;  // Less than 1 day
    if (hoursUntilDeadline < 72) return 70;  // Less than 3 days
    if (hoursUntilDeadline < 168) return 50; // Less than 1 week
    return 30; // More than a week
  }

  /**
   * Score based on dependencies (0-100)
   */
  _scoreDependencies(task) {
    const deps = task.dependencies || [];
    
    // Tasks blocking others get higher priority
    if (deps.length === 0) return 50; // No dependencies info
    if (deps.some(d => d.type === 'blocks')) return 80;
    if (deps.some(d => d.type === 'blocked_by')) return 40;
    return 50;
  }

  /**
   * Score based on business impact (0-100)
   */
  _scoreBusinessImpact(task) {
    const impactKeywords = {
      high: ['customer', 'production', 'revenue', 'security', 'vp', 'ceo', 'escalation'],
      medium: ['feature', 'improvement', 'team', 'efficiency'],
      low: ['refactor', 'cleanup', 'documentation']
    };

    const text = (task.title + ' ' + task.description).toLowerCase();

    if (impactKeywords.high.some(kw => text.includes(kw))) return 90;
    if (impactKeywords.medium.some(kw => text.includes(kw))) return 60;
    if (impactKeywords.low.some(kw => text.includes(kw))) return 30;
    
    return 50; // Default
  }

  /**
   * Use Gemini to generate human-readable explanation
   */
  async generateExplanation(task, priorityData) {
    const prompt = `You are TaskPilot AI, a task prioritization assistant.

Task: ${task.title}
Source: ${task.source}
Priority Score: ${priorityData.score}/100

Score Breakdown:
- Severity (${this.weights.severity * 100}% weight): ${priorityData.breakdown.severity}/100
- Deadline Urgency (${this.weights.deadline * 100}% weight): ${priorityData.breakdown.deadline}/100
- Dependencies (${this.weights.dependencies * 100}% weight): ${priorityData.breakdown.dependencies}/100
- Business Impact (${this.weights.businessImpact * 100}% weight): ${priorityData.breakdown.businessImpact}/100

Generate a concise, one-sentence explanation for why this task has this priority ranking.
Start with "Priority ${priorityData.score}/100 because..."

Keep it clear, specific, and actionable. Mention the most important factor.`;

    try {
      return await callGemini(prompt, { maxTokens: 128, temperature: 0.4 });
    } catch (error) {
      console.error('Error generating explanation:', error);
      return `Priority ${priorityData.score}/100 based on severity, deadline, and business impact.`;
    }
  }

  /**
   * Prioritize a list of tasks
   */
  async prioritizeTasks(tasks) {
    console.log(`🤖 Prioritizing ${tasks.length} tasks...`);
    
    const tasksWithPriority = [];

    for (const task of tasks) {
      const priorityData = this.calculatePriorityScore(task);
      const explanation = await this.generateExplanation(task, priorityData);

      tasksWithPriority.push({
        ...task,
        priorityScore: priorityData.score,
        priorityBreakdown: priorityData.breakdown,
        priorityExplanation: explanation,
        priorityWeights: priorityData.weights
      });
    }

    // Sort by priority score (descending)
    tasksWithPriority.sort((a, b) => b.priorityScore - a.priorityScore);

    console.log(`✅ Tasks prioritized!`);
    return tasksWithPriority;
  }

  /**
   * Deduplicate tasks using semantic similarity
   */
  async deduplicateTasks(tasks) {
    console.log(`🔍 Deduplicating ${tasks.length} tasks...`);
    
    const uniqueTasks = [];
    const duplicateGroups = [];

    for (let i = 0; i < tasks.length; i++) {
      let isDuplicate = false;

      for (let j = 0; j < uniqueTasks.length; j++) {
        const similarity = await this._calculateSimilarity(tasks[i], uniqueTasks[j]);
        
        const threshold = parseFloat(process.env.DEDUP_SIMILARITY_THRESHOLD || 0.85);
        
        if (similarity >= threshold) {
          // Found a duplicate
          isDuplicate = true;
          
          // Merge the tasks
          uniqueTasks[j] = this._mergeTasks(uniqueTasks[j], tasks[i]);
          
          duplicateGroups.push({
            primary: uniqueTasks[j].id,
            duplicate: tasks[i].id,
            similarity: similarity
          });
          
          break;
        }
      }

      if (!isDuplicate) {
        uniqueTasks.push(tasks[i]);
      }
    }

    console.log(`✅ Deduplication complete: ${tasks.length} → ${uniqueTasks.length} tasks`);
    console.log(`   Found ${duplicateGroups.length} duplicates`);

    return {
      tasks: uniqueTasks,
      duplicateGroups: duplicateGroups
    };
  }

  /**
   * Calculate similarity between two tasks using Gemini
   */
  async _calculateSimilarity(task1, task2) {
    const prompt = `Compare these two tasks and rate their similarity from 0.0 to 1.0:

Task A: ${task1.title} — ${task1.description || ""}
Task B: ${task2.title} — ${task2.description || ""}

Are these referring to the same work item? Respond with ONLY a number between 0.0 and 1.0.`;

    try {
      const text = await callGemini(prompt, { maxTokens: 16, temperature: 0.1 });
      const similarity = parseFloat(text);
      return isNaN(similarity) ? 0 : Math.min(Math.max(similarity, 0), 1);
    } catch (error) {
      return this._simpleStringSimilarity(task1.title, task2.title);
    }
  }

  /**
   * Simple string similarity fallback
   */
  _simpleStringSimilarity(str1, str2) {
    const s1 = str1.toLowerCase();
    const s2 = str2.toLowerCase();
    
    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;
    
    if (longer.length === 0) return 1.0;
    
    const editDistance = this._levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  /**
   * Levenshtein distance calculation
   */
  _levenshteinDistance(str1, str2) {
    const matrix = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * Merge duplicate tasks
   */
  _mergeTasks(primary, duplicate) {
    return {
      ...primary,
      sources: [...(primary.sources || [primary.source]), duplicate.source],
      mergedFrom: [...(primary.mergedFrom || []), duplicate.id],
      description: primary.description || duplicate.description,
      // Keep the higher priority/severity
      severity: Math.max(primary.severity || 0, duplicate.severity || 0),
      // Keep the earlier deadline
      deadline: this._earlierDate(primary.deadline, duplicate.deadline),
      // Combine labels
      labels: [...(primary.labels || []), ...(duplicate.labels || [])],
      // Combine dependencies
      dependencies: [...(primary.dependencies || []), ...(duplicate.dependencies || [])]
    };
  }

  /**
   * Return the earlier of two dates
   */
  _earlierDate(date1, date2) {
    if (!date1) return date2;
    if (!date2) return date1;
    return new Date(date1) < new Date(date2) ? date1 : date2;
  }

  /**
   * Generate daily plan from prioritized tasks
   */
  async generateDailyPlan(tasks, engineerName = 'Engineer') {
    const topTasks = tasks.slice(0, 10);
    
    const prompt = `You are TaskPilot AI. Generate a clear, actionable daily plan for ${engineerName}.

Today's top prioritized tasks:
${topTasks.map((task, idx) => `${idx + 1}. ${task.title} — Priority: ${task.priorityScore}/100 — Reason: ${task.priorityExplanation || ""}`).join('\n')}

Write a structured daily plan in markdown with:
1. A motivating opening line
2. Top 3 priorities clearly highlighted
3. Suggested time blocks
4. Alerts or urgent items
5. Brief summary

Keep it concise, clear, and actionable.`;

    try {
      return await callGemini(prompt, { maxTokens: 1024, temperature: 0.6 });
    } catch (error) {
      console.error('Error generating daily plan:', error);
      return this._generateFallbackPlan(topTasks, engineerName);
    }
  }

  /**
   * Fallback plan generator
   */
  _generateFallbackPlan(tasks, engineerName) {
    const top3 = tasks.slice(0, 3);
    
    return `# 📋 Daily Plan for ${engineerName}

## 🎯 Top 3 Priorities

${top3.map((task, idx) => `
### ${idx + 1}. ${task.title}
- **Priority:** ${task.priorityScore}/100
- **Source:** ${task.source}
- **Why:** ${task.priorityExplanation}
`).join('\n')}

## 📝 Additional Tasks

${tasks.slice(3, 10).map((task, idx) => `
${idx + 4}. ${task.title} (${task.priorityScore}/100) - ${task.source}
`).join('\n')}

---

**Total Tasks:** ${tasks.length} | **Focus on completing the top 3 today!**
`;
  }
}

export default TaskPrioritizer;
