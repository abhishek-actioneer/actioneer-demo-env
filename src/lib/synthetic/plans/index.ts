import type { SyntheticPlan } from "../types";
import { quickhelpSynthetic } from "./quickhelp";
import { vastuHfcSynthetic } from "./vastu-hfc";

const PLANS: Record<string, SyntheticPlan> = {
  quickhelp: quickhelpSynthetic,
  "vastu-hfc": vastuHfcSynthetic,
};

export function getSyntheticPlan(datasetId: string): SyntheticPlan | null {
  return PLANS[datasetId] ?? null;
}

export function listSyntheticDatasets(): string[] {
  return Object.keys(PLANS).filter((id) => PLANS[id].enabled);
}
