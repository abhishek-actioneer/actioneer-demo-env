import type { DateRangePreset, PropertyFilter } from "./explorer-types";

// ── Occurrence operator ──

export type OccurrenceOp = "gte" | "gt" | "eq" | "lte" | "lt";

export const OCCURRENCE_OP_LABELS: Record<OccurrenceOp, string> = {
  gte: "at least",
  gt: "more than",
  eq: "exactly",
  lte: "at most",
  lt: "less than",
};

export interface OccurrenceConstraint {
  op: OccurrenceOp;
  value: number;
}

// ── Rule shapes ──

/** User performed (or did not perform) an event. */
export interface EventRule {
  id: string;
  kind: "event";
  eventId: string;
  /** "did" = include users matching; "did_not" = exclude. */
  action: "did" | "did_not";
  /** Occurrence count constraint (only applies to "did" rules). Undefined = at least once. */
  occurrence?: OccurrenceConstraint;
  /** Per-event property filters. */
  filters?: PropertyFilter[];
}

/** User attribute matches a predicate (derived from the user's rows in the primary table). */
export interface AttributeRule {
  id: string;
  kind: "attribute";
  filter: PropertyFilter;
}

export type SegmentRule = EventRule | AttributeRule;

// ── Combinator ──

export type SegmentCombinator = "AND" | "OR";

// ── Config ──

export interface SegmentBuilderConfig {
  rules: SegmentRule[];
  combinator: SegmentCombinator;
  dateRange: { preset: DateRangePreset } | { start: string; end: string } | { preset: "all" };
}

// ── Default factory ──

export function createDefaultSegmentConfig(): SegmentBuilderConfig {
  return {
    rules: [],
    combinator: "AND",
    dateRange: { preset: "all" },
  };
}

// ── Shape predicate ──

export function isValidConfig(config: SegmentBuilderConfig): boolean {
  if (!config.rules.length) return false;
  // Must contain at least one positive rule to anchor the base population.
  return config.rules.some(
    (r) => r.kind === "attribute" || (r.kind === "event" && r.action === "did"),
  );
}
