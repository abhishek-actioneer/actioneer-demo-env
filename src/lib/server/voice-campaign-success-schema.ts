import { z } from "zod/v4";

export const VoiceCampaignSuccessMetricSchema = z.object({
  id: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(160),
  type: z.enum(["call_outcome", "link", "dataset_event", "sql"]),
  outcome: z.enum([
    "positive",
    "neutral",
    "negative",
    "busy",
    "wrong_number",
    "no_answer",
    "failed",
    "unknown",
    "callback_scheduled",
  ]).optional(),
  criterion: z.string().trim().max(2000).optional(),
  destinationUrl: z.string().trim().url().max(2048).optional(),
  followUpTemplate: z.string().trim().max(480).optional(),
  eventName: z.string().trim().max(180).optional(),
  sql: z.string().trim().max(12_000).optional(),
  windowDays: z.number().int().min(0).max(365).optional(),
  description: z.string().trim().max(500).optional(),
});

export const VoiceCampaignSuccessDefinitionSchema = z.object({
  primary: VoiceCampaignSuccessMetricSchema,
  secondary: z.array(VoiceCampaignSuccessMetricSchema).max(5).default([]),
  guardrails: z.array(z.string().trim().min(1).max(600)).max(30).default([]),
  guardrailsConfig: z.any().optional(),
  baseline: z.object({
    source: z.enum(["historical_crm", "holdout", "previous_campaign", "dataset_average", "manual", "unavailable"]),
    rate: z.number().min(0).max(1).optional(),
    label: z.string().trim().max(160).optional(),
    description: z.string().trim().max(500).optional(),
  }),
  attributionWindowDays: z.number().int().min(0).max(365),
});
