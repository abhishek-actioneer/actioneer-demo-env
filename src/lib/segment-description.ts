import type { EventDefinition, EventProperty, PropertyFilter } from "./explorer-types";
import type { SegmentBuilderConfig, SegmentRule } from "./segment-builder-types";
import { OCCURRENCE_OP_LABELS } from "./segment-builder-types";

const DATE_RANGE_LABELS: Record<string, string> = {
  "7d": "in the last 7 days",
  "30d": "in the last 30 days",
  "60d": "in the last 60 days",
  "90d": "in the last 90 days",
  "1y": "in the last year",
};

const FILTER_OPERATOR_LABELS: Record<PropertyFilter["operator"], string> = {
  eq: "=",
  neq: "!=",
  gt: ">",
  lt: "<",
  gte: ">=",
  lte: "<=",
  contains: "contains",
  in: "is one of",
  not_in: "is not one of",
};

export interface SegmentRuleDescription {
  title: string;
  detail: string;
  sentence: string;
}

export interface SegmentDescription {
  description: string;
  metadata: {
    source: "dsl";
    match: "all" | "any";
    timeWindow: string;
    rules: SegmentRuleDescription[];
  };
}

export function isSegmentBuilderConfig(value: unknown): value is SegmentBuilderConfig {
  if (!value || typeof value !== "object") return false;
  const config = value as Partial<SegmentBuilderConfig>;
  if (config.combinator !== "AND" && config.combinator !== "OR") return false;
  if (!Array.isArray(config.rules) || !config.rules.every(isSegmentRule)) return false;
  return isDateRange(config.dateRange);
}

export function describeSegmentConfig(
  config: SegmentBuilderConfig,
  events: EventDefinition[] = [],
): SegmentDescription {
  const rules = config.rules.map((rule) => describeSegmentRule(rule, events));
  const timeWindow = describeSegmentDateRange(config.dateRange);
  const joiner = config.combinator === "AND" ? " and " : " or ";
  const description = rules.length
    ? `Users who ${rules.map((rule) => rule.sentence).join(joiner)} ${timeWindow}.`
    : `Users matching the selected segment rules ${timeWindow}.`;

  return {
    description,
    metadata: {
      source: "dsl",
      match: config.combinator === "AND" ? "all" : "any",
      timeWindow,
      rules,
    },
  };
}

export function describeSegmentRule(
  rule: SegmentRule,
  events: EventDefinition[] = [],
): SegmentRuleDescription {
  if (rule.kind === "attribute") {
    const detail = describeFilter(rule.filter);
    return {
      title: rule.filter.property,
      detail,
      sentence: `has ${detail}`,
    };
  }

  const def = events.find((event) => event.id === rule.eventId);
  const eventName = def?.displayName ?? humanizeId(rule.eventId);
  const properties = def?.properties ?? [];
  const occurrence = rule.action === "did"
    ? rule.occurrence
      ? `${OCCURRENCE_OP_LABELS[rule.occurrence.op]} ${rule.occurrence.value} ${rule.occurrence.value === 1 ? "time" : "times"}`
      : "at least once"
    : "";
  const filters = (rule.filters ?? []).map((filter) => describeFilter(filter, properties));
  const action = rule.action === "did" ? "Did" : "Did not do";
  const sentenceBase = rule.action === "did"
    ? `did ${eventName} ${occurrence}`
    : `did not do ${eventName}`;
  const filterSentence = filters.length > 0 ? ` where ${filters.join(" and ")}` : "";

  return {
    title: `${action} ${eventName}`,
    detail: [occurrence, ...filters].filter(Boolean).join(" - "),
    sentence: `${sentenceBase}${filterSentence}`,
  };
}

export function describeSegmentDateRange(range: SegmentBuilderConfig["dateRange"]): string {
  if ("start" in range) return `from ${range.start} to ${range.end}`;
  if (range.preset === "all") return "across all time";
  return DATE_RANGE_LABELS[range.preset] ?? "in the selected time window";
}

function describeFilter(filter: PropertyFilter, properties: EventProperty[] = []): string {
  const property = properties.find((candidate) => candidate.column === filter.property);
  const value = Array.isArray(filter.value)
    ? filter.value.join(", ")
    : filter.value === "" || filter.value == null
      ? "..."
      : String(filter.value);
  return `${property?.displayName ?? humanizeId(filter.property)} ${FILTER_OPERATOR_LABELS[filter.operator]} ${value}`;
}

function isSegmentRule(value: unknown): value is SegmentRule {
  if (!value || typeof value !== "object") return false;
  const rule = value as Record<string, unknown>;
  if (typeof rule.id !== "string") return false;
  if (rule.kind === "attribute") {
    return isPropertyFilter(rule.filter);
  }
  if (rule.kind === "event") {
    const filters = rule.filters;
    return typeof rule.eventId === "string"
      && (rule.action === "did" || rule.action === "did_not")
      && (filters === undefined || (Array.isArray(filters) && filters.every(isPropertyFilter)));
  }
  return false;
}

function isPropertyFilter(value: unknown): value is PropertyFilter {
  if (!value || typeof value !== "object") return false;
  const filter = value as Record<string, unknown>;
  return typeof filter.property === "string"
    && ["eq", "neq", "gt", "lt", "gte", "lte", "contains", "in", "not_in"].includes(String(filter.operator))
    && filter.value !== undefined;
}

function isDateRange(value: unknown): value is SegmentBuilderConfig["dateRange"] {
  if (!value || typeof value !== "object") return false;
  const range = value as Record<string, unknown>;
  if (range.preset === "all") return true;
  if (typeof range.preset === "string") return ["7d", "30d", "60d", "90d", "1y"].includes(range.preset);
  return typeof range.start === "string" && typeof range.end === "string";
}

function humanizeId(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
