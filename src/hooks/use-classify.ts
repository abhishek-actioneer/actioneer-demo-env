/**
 * Query classification and agent display metadata.
 *
 * Pure functions — no React state. Used by use-analytics.ts.
 */

import type { Metric } from "@/lib/metric-types";
import type { MetricContextData } from "@/lib/types";
import { getMetric } from "@/lib/metric-store";
import { apiFetch } from "@/lib/api-client";
import { toast } from "sonner";

// ── Classification ──

export interface ClassifyResult {
  mode: "analytics" | "direct" | "action" | "metric_update" | "metric_create" | "policy_create" | "playbook_modify" | "campaign_create" | "voice_agent_generation";
  complexity: "simple" | "complex";
  complexityReason: string | null;
  metricId: string | null;
  actionType: string | null;
  extractedDescription: string | null;
  metricName: string | null;
  campaignChannel: "email" | "push" | "sms" | "webpush" | "whatsapp" | "voice" | null;
  campaignTargetDescription: string | null;
  voiceAgentTargetDescription: string | null;
}

export async function classifyQuery(text: string, datasetId?: string, metricEntityContext?: string, playbookEntityContext?: string, segmentEntityContext?: string): Promise<ClassifyResult> {
  try {
    const data = await apiFetch<{ mode?: string; complexity?: string; complexityReason?: string; metricId?: string; actionType?: string; extractedDescription?: string; metricName?: string; campaignChannel?: string; campaignTargetDescription?: string; voiceAgentTargetDescription?: string }>("/api/classify", {
      method: "POST",
      body: {
        query: text,
        ...(metricEntityContext ? { metricEntityContext } : {}),
        ...(playbookEntityContext ? { playbookEntityContext } : {}),
        ...(segmentEntityContext ? { segmentEntityContext } : {}),
      },
      ...(datasetId ? { datasetId } : {}),
    });
    return {
      mode: (data.mode as ClassifyResult["mode"]) ?? "analytics",
      complexity: data.complexity === "complex" ? "complex" : "simple",
      complexityReason: data.complexityReason ?? null,
      metricId: data.metricId ?? null,
      actionType: data.actionType ?? null,
      extractedDescription: data.extractedDescription ?? null,
      metricName: data.metricName ?? null,
      campaignChannel: data.campaignChannel === "email" || data.campaignChannel === "push" || data.campaignChannel === "sms" || data.campaignChannel === "webpush" || data.campaignChannel === "whatsapp" || data.campaignChannel === "voice" ? data.campaignChannel : null,
      campaignTargetDescription: data.campaignTargetDescription ?? null,
      voiceAgentTargetDescription: data.voiceAgentTargetDescription ?? null,
    };
  } catch {
    toast("Falling back to direct chat.", { description: "Could not classify your question." });
    return { mode: "direct", complexity: "simple", complexityReason: null, metricId: null, actionType: null, extractedDescription: null, metricName: null, campaignChannel: null, campaignTargetDescription: null, voiceAgentTargetDescription: null };
  }
}

// ── Metric context card ──

export function buildMetricContextData(metricId: string, cachedMetrics?: Map<string, Metric>, datasetId?: string): MetricContextData | null {
  const m = cachedMetrics?.get(metricId) || (datasetId ? getMetric(datasetId, metricId) : undefined);
  if (!m) return null;
  return {
    metricId: m.id,
    name: m.name,
    category: m.category,
    type: m.type,
    value: m.value,
    valueFormat: m.valueFormat,
    changePercent: m.changePercent,
    timeSeries: m.timeSeries ?? [],
    timeGrain: m.timeGrain,
    aggregation: m.aggregation,
    table: m.table,
    column: m.column,
    granularity: m.granularity,
    formula: m.formula,
  };
}

// ── Agent display metadata ──

const AGENT_DISPLAY: Record<string, { name: string; icon: string }> = {
  "data-quality": { name: "Data Quality Agent", icon: "shield" },
  "daily-metrics": { name: "Daily Metrics Agent", icon: "bar-chart" },
  "cohort-retention": { name: "Cohort Retention Agent", icon: "users" },
  "rev-opt": { name: "Revenue Optimization Agent", icon: "dollar" },
  "user-segmentation": { name: "User Segmentation Agent", icon: "clock" },
  "geographic": { name: "Geographic Agent", icon: "globe" },
  "critique": { name: "Critique Agent", icon: "check" },
  "research": { name: "Research Agent", icon: "search" },
  "data-analysis": { name: "Data Analysis Agent", icon: "line-chart" },
  "marketing-optimization": { name: "Marketing Optimization Agent", icon: "megaphone" },
};

export function getAgentDisplay(agentId: string): { id: string; name: string; icon: string } {
  const known = AGENT_DISPLAY[agentId];
  if (known) return { id: agentId, ...known };
  const name = agentId.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) + " Agent";
  return { id: agentId, name, icon: "bar-chart" };
}

const AGENT_FRIENDLY_NAMES: Record<string, string> = {
  "data-quality": "data quality",
  "daily-metrics": "daily metrics",
  "cohort-retention": "cohort retention",
  "rev-opt": "revenue optimization",
  "user-segmentation": "user segmentation",
  "geographic": "geographic patterns",
  "research": "research",
  "data-analysis": "data analysis",
  "marketing-optimization": "marketing optimization",
};

export function buildPlanText(agentIds: string[]): string {
  const names = agentIds
    .filter((id) => id !== "critique")
    .map((id) => AGENT_FRIENDLY_NAMES[id] || id.replace(/-/g, " "));
  if (names.length === 0) return "Analyzing your data...";
  const last = names.pop()!;
  const list = names.length > 0 ? `${names.join(", ")}, and ${last}` : last;
  return `I will analyze your data across ${names.length + 1} dimensions: ${list}.`;
}

// ── Helpers ──

export function createId() {
  return Math.random().toString(36).slice(2, 10);
}
