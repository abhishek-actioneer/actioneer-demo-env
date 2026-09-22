/**
 * Feature flags — enable/disable features via NEXT_PUBLIC_DISABLED_FEATURES env var.
 *
 * Usage: NEXT_PUBLIC_DISABLED_FEATURES=scouts,store,connectors
 * All features are enabled by default. Only listed features are disabled.
 */

export type FeatureId =
  | "scouts"
  | "store"
  | "connectors"
  | "playbooks"
  | "forecasting"
  | "knowledge"
  | "metrics"
  | "explorer"
  | "boards"
  | "catalog"
  | "metric-tree"
  | "segments"
  | "credits"
  | "funnels"
  | "retentions"
  | "ad-creative"
  | "campaigns"
  | "voice-campaigns"
  | "admin";

const disabled = new Set(
  (process.env.NEXT_PUBLIC_DISABLED_FEATURES ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);

export function isFeatureEnabled(id: FeatureId): boolean {
  return !disabled.has(id);
}
