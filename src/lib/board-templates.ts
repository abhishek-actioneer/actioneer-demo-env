import type { MetricDefinition } from "./metric-types";

// ── Board Template: a domain-agnostic lens that guides LLM board generation ──

export interface BoardTemplate {
  id: string;
  /** Display name shown in template picker */
  name: string;
  /** One-liner shown below the name */
  description: string;
  /** LLM instruction injected into the board-generate prompt to focus content */
  focusPrompt: string;
  /** Optional: prefer metrics whose category contains any of these keywords (case-insensitive) */
  metricCategoryKeywords?: string[];
  /** Suggested section themes — LLM can adapt or ignore based on available data */
  sectionHints?: string[];
}

// ── Template catalog ──

export const BOARD_TEMPLATES: BoardTemplate[] = [
  {
    id: "product-kpis",
    name: "Product KPIs",
    description: "Core business metrics at a glance",
    focusPrompt: `Build a dashboard focused on the CORE BUSINESS METRICS for this product.
Prioritize: primary revenue/volume metric, conversion rate, average transaction value, active users/customers.
Lead with the single most important health indicator. Each section should answer "how is the business doing?"
Avoid operational or diagnostic metrics — keep it executive-level.`,
    metricCategoryKeywords: ["revenue", "conversion", "volume", "kpi", "core", "business"],
    sectionHints: ["North Star Metric", "Revenue", "Volume & Conversion", "User Base"],
  },
  {
    id: "growth",
    name: "Growth",
    description: "Acquisition, activation, and expansion trends",
    focusPrompt: `Build a dashboard focused on GROWTH AND ACQUISITION.
Prioritize: new user/customer acquisition rate, activation metrics, growth rate over time,
new vs returning mix, signup/onboarding funnel, channel-level acquisition if available.
Show trends over time — growth dashboards must surface trajectory, not just snapshots.
Include at least one section on what's driving growth (channels, campaigns, referrals).`,
    metricCategoryKeywords: ["growth", "acquisition", "activation", "new", "signup", "funnel", "onboarding"],
    sectionHints: ["Acquisition Rate", "New vs Returning", "Activation", "Growth Drivers"],
  },
  {
    id: "customer-health",
    name: "Customer Health",
    description: "Retention, churn, LTV, and engagement depth",
    focusPrompt: `Build a dashboard focused on CUSTOMER/USER HEALTH AND RETENTION.
Prioritize: retention rate (D7/D30 or monthly), churn rate, lifetime value (LTV),
repeat usage frequency, cohort-level trends, engagement depth.
Lead with the retention or churn metric — this is the heartbeat of customer health.
Include a section on high-value vs at-risk segments if the data supports it.`,
    metricCategoryKeywords: ["retention", "churn", "ltv", "lifetime", "cohort", "engagement", "repeat", "loyalty"],
    sectionHints: ["Retention", "Churn & LTV", "Engagement Frequency", "Cohort Trends"],
  },
  {
    id: "revenue-deep-dive",
    name: "Revenue Deep Dive",
    description: "Revenue composition, ARPU, and monetization",
    focusPrompt: `Build a dashboard focused on REVENUE AND MONETIZATION.
Prioritize: total revenue trend, revenue per user (ARPU/ARPPU), revenue by segment or category,
pricing impact, transaction value distribution, revenue concentration.
Lead with total revenue + its trend. Break down "where does money come from?"
Include a section on revenue quality — is it concentrated, growing, or at risk?`,
    metricCategoryKeywords: ["revenue", "arpu", "monetization", "pricing", "transaction", "payment", "income"],
    sectionHints: ["Total Revenue", "Revenue Per User", "Revenue Mix", "Revenue Quality"],
  },
  {
    id: "engagement",
    name: "Engagement",
    description: "Usage patterns, session depth, and feature adoption",
    focusPrompt: `Build a dashboard focused on USER ENGAGEMENT AND ACTIVITY.
Prioritize: daily/weekly active users (DAU/WAU), session frequency, session duration,
feature adoption rates, stickiness ratio (DAU/MAU), usage patterns by time.
Lead with the engagement frequency metric. Show how deeply users interact.
Include a section on engagement trends — is usage growing or declining?`,
    metricCategoryKeywords: ["engagement", "session", "active", "dau", "wau", "mau", "usage", "activity", "stickiness"],
    sectionHints: ["Active Users", "Session Depth", "Stickiness", "Usage Trends"],
  },
  {
    id: "operational",
    name: "Operational",
    description: "Efficiency, SLAs, and process performance",
    focusPrompt: `Build a dashboard focused on OPERATIONAL EFFICIENCY AND PERFORMANCE.
Prioritize: processing/delivery/response times, error or failure rates, SLA compliance,
throughput, capacity utilization, cost per operation.
Lead with the primary operational health metric (e.g. on-time rate, error rate).
This dashboard helps ops teams spot bottlenecks — surface what's slow, broken, or expensive.`,
    metricCategoryKeywords: ["operational", "efficiency", "sla", "delivery", "processing", "error", "latency", "cost", "time"],
    sectionHints: ["Operational Health", "Throughput", "Failures & Errors", "Cost Efficiency"],
  },
];

// ── Helpers ──

export function getTemplate(templateId: string): BoardTemplate | undefined {
  return BOARD_TEMPLATES.find((t) => t.id === templateId);
}

export function getAllTemplates(): BoardTemplate[] {
  return BOARD_TEMPLATES;
}

/** Filter metrics by template category preferences. Returns all metrics if no keywords match. */
export function filterMetricsByTemplate(
  metrics: MetricDefinition[],
  template: BoardTemplate,
): MetricDefinition[] {
  if (!template.metricCategoryKeywords?.length) return metrics;

  const keywords = template.metricCategoryKeywords.map((k) => k.toLowerCase());

  const filtered = metrics.filter((m) => {
    const cat = (m.category ?? "").toLowerCase();
    const name = m.name.toLowerCase();
    const desc = (m.description ?? "").toLowerCase();
    return keywords.some((kw) => cat.includes(kw) || name.includes(kw) || desc.includes(kw));
  });

  // Fallback: if filtering leaves too few metrics, return all — let the LLM decide
  return filtered.length >= 3 ? filtered : metrics;
}

/** Pick the best starter templates for a dataset based on available metrics */
export function pickStarterTemplates(
  metrics: MetricDefinition[],
  maxCount = 3,
): BoardTemplate[] {
  // Score each template by how many metrics match its keywords
  const scored = BOARD_TEMPLATES.map((template) => {
    const matching = filterMetricsByTemplate(metrics, template);
    const matchRatio = matching.length < metrics.length ? matching.length / metrics.length : 0.5;
    return { template, score: matching.length * matchRatio };
  });

  // Sort by score descending, take top N
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxCount).map((s) => s.template);
}
