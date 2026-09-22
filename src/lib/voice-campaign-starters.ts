/**
 * Dataset-driven starter chips for the voice campaign "new" page when no
 * segment is selected. Replaces the hardcoded FundsIndia-specific fallback
 * ("Portfolio review check-in", "SIP activation", ...) with chips derived
 * from the tenant's loaded purposes, padded out with neutral, dataset-aware
 * chips when there are fewer than 4 purposes. Pure — no JSX/DOM — so the
 * page component maps `iconKey` to its own icon components.
 */
import type { Purpose } from "@/lib/purpose-types";

export interface StarterChip {
  label: string;
  brief: string;
  iconKey: "trending" | "refresh" | "phone" | "file";
  purposeId?: string;
}

const PURPOSE_ICON_CYCLE: StarterChip["iconKey"][] = ["trending", "refresh", "file"];

const MAX_CHIPS = 4;
const MAX_PURPOSE_CHIPS = 3;

function neutralPadChips(entity: string): StarterChip[] {
  return [
    {
      label: "Reactivation check-in",
      brief: `Call dormant ${entity}s with a warm check-in to understand their situation and re-engage them.`,
      iconKey: "phone",
    },
    {
      label: "Feedback check-in",
      brief: `Call recent ${entity}s to gather feedback on their experience and surface issues early.`,
      iconKey: "refresh",
    },
    {
      label: "Service follow-up",
      brief: "Follow up on a recent interaction and offer help completing the next step.",
      iconKey: "file",
    },
  ];
}

function fillWithPads(chips: StarterChip[], entity: string): StarterChip[] {
  const includedLabels = new Set(chips.map((chip) => chip.label));
  const filled = [...chips];
  for (const pad of neutralPadChips(entity)) {
    if (filled.length >= MAX_CHIPS) break;
    if (includedLabels.has(pad.label)) continue;
    filled.push(pad);
  }
  return filled;
}

export function defaultStarterChips(purposes: Purpose[], entityName?: string): StarterChip[] {
  const entity = entityName ?? "customer";

  const purposeChips: StarterChip[] = purposes.slice(0, MAX_PURPOSE_CHIPS).map((purpose, index) => ({
    label: purpose.name,
    brief: `${purpose.tagline}. ${purpose.valueProp}.`,
    iconKey: PURPOSE_ICON_CYCLE[index % PURPOSE_ICON_CYCLE.length],
    purposeId: purpose.purposeId,
  }));

  return fillWithPads(purposeChips, entity);
}

/**
 * Chips for the campaign "new" page when a segment IS selected. Replaces the
 * hardcoded FundsIndia keyword ladder (SIP / ELSS / portfolio / premium lanes)
 * that showed investment copy on every dataset. Chips are the dataset's own
 * purpose catalog contextualized to the segment — no domain rules live here.
 */
export function segmentStarterChips(
  segment: { name: string; description?: string | null },
  purposes: Purpose[],
  entityName?: string,
): StarterChip[] {
  const entity = entityName ?? "customer";

  const purposeChips: StarterChip[] = purposes.slice(0, MAX_PURPOSE_CHIPS).map((purpose, index) => ({
    label: purpose.name,
    brief: `Call ${segment.name}: ${purpose.tagline}. ${purpose.valueProp}.`,
    iconKey: PURPOSE_ICON_CYCLE[index % PURPOSE_ICON_CYCLE.length],
    purposeId: purpose.purposeId,
  }));

  return fillWithPads(purposeChips, entity);
}
