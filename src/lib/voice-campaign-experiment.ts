import type {
  VoiceCampaignExperimentRandomizationUnit,
  VoiceCampaignExperimentSplit,
  VoiceCampaignSuccessDefinition,
} from "./voice-campaign-types";
import { normalizeVoiceCampaignSuccessDefinition } from "./voice-campaign-success";

const RANDOMIZATION_UNITS = new Set<VoiceCampaignExperimentRandomizationUnit>(["recipient", "phone_number"]);

function cleanLabel(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return (text || fallback).slice(0, 80);
}

function cleanPercent(value: unknown, fallback: number): number {
  const percent = Number(value);
  if (!Number.isFinite(percent)) return fallback;
  return Math.max(0, Math.min(100, Math.round(percent)));
}

export function defaultVoiceCampaignExperimentSplit(enabled = true): VoiceCampaignExperimentSplit {
  return {
    enabled,
    testPercent: enabled ? 80 : 100,
    controlPercent: enabled ? 20 : 0,
    randomizationUnit: "recipient",
    testLabel: "Test group",
    controlLabel: "Control holdout",
    notes: "Control stays in the base segment and does not receive the voice campaign.",
  };
}

export function normalizeVoiceCampaignExperimentSplit(
  split?: Partial<VoiceCampaignExperimentSplit> | null,
  options?: { defaultEnabled?: boolean },
): VoiceCampaignExperimentSplit {
  const fallback = defaultVoiceCampaignExperimentSplit(options?.defaultEnabled ?? false);
  const enabled = typeof split?.enabled === "boolean" ? split.enabled : fallback.enabled;
  const randomizationUnit = RANDOMIZATION_UNITS.has(split?.randomizationUnit as VoiceCampaignExperimentRandomizationUnit)
    ? split?.randomizationUnit as VoiceCampaignExperimentRandomizationUnit
    : fallback.randomizationUnit;
  const testPercent = cleanPercent(split?.testPercent, enabled ? fallback.testPercent : 100);
  const controlPercent = enabled
    ? cleanPercent(split?.controlPercent, Math.max(0, 100 - testPercent))
    : 0;
  const total = Math.max(testPercent + controlPercent, 1);
  const normalizedTest = enabled ? Math.round((testPercent / total) * 100) : 100;
  const normalizedControl = enabled ? Math.max(0, 100 - normalizedTest) : 0;
  const notes = typeof split?.notes === "string" && split.notes.trim()
    ? split.notes.trim().slice(0, 500)
    : fallback.notes;

  return {
    enabled,
    testPercent: normalizedTest,
    controlPercent: normalizedControl,
    randomizationUnit,
    testLabel: cleanLabel(split?.testLabel, fallback.testLabel),
    controlLabel: cleanLabel(split?.controlLabel, fallback.controlLabel),
    ...(notes ? { notes } : {}),
  };
}

export function successDefinitionWithExperimentBaseline(
  definition: Partial<VoiceCampaignSuccessDefinition> | undefined | null,
  split: Partial<VoiceCampaignExperimentSplit> | undefined | null,
): VoiceCampaignSuccessDefinition {
  const successDefinition = normalizeVoiceCampaignSuccessDefinition(definition);
  const experimentSplit = normalizeVoiceCampaignExperimentSplit(split);

  if (!experimentSplit.enabled) {
    if (successDefinition.baseline.source === "holdout" && successDefinition.baseline.rate === undefined) {
      return {
        ...successDefinition,
        baseline: {
          source: "unavailable",
          label: "Baseline unavailable",
          description: "Set a historical, holdout, or manual baseline to calculate lift.",
        },
      };
    }
    return successDefinition;
  }

  if (successDefinition.baseline.source === "holdout") {
    return {
      ...successDefinition,
      baseline: {
        ...successDefinition.baseline,
        label: experimentSplit.controlLabel,
        description: successDefinition.baseline.description ?? "Control holdout from the same base segment. Lift can be calculated after control outcomes are joined.",
      },
    };
  }

  if (successDefinition.baseline.source !== "unavailable") {
    return successDefinition;
  }

  return {
    ...successDefinition,
    baseline: {
      ...successDefinition.baseline,
      source: "holdout",
      label: experimentSplit.controlLabel,
      description: "Control holdout from the same base segment. Lift can be calculated after control outcomes are joined.",
    },
  };
}
