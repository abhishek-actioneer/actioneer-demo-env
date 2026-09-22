"use client";

// View switcher for the cohort intelligence section. Hosts the compact cohort
// views over one shared model; the embedding "Map" stays in the parent.

import type { VoiceCampaignCallDetail } from "@/lib/voice-campaign-insights-types";
import type { CohortVM } from "./voice-cohort-model";
import { CohortTable } from "./voice-cohort-table";
import { CohortStages } from "./voice-cohort-stages";

export type CohortView = "table" | "stages" | "map";

export const COHORT_VIEWS: Array<{ id: CohortView; label: string }> = [
  { id: "table", label: "Table" },
  { id: "stages", label: "Stages" },
  { id: "map", label: "Map" },
];

export function CohortViewSwitcher({
  view,
  onChange,
}: {
  view: CohortView;
  onChange: (view: CohortView) => void;
}) {
  return (
    <div className="inline-flex rounded-full p-0.5 shadow-[0_0_0_1px_var(--border)]">
      {COHORT_VIEWS.map((entry) => (
        <button
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            view === entry.id ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
          }`}
          key={entry.id}
          onClick={() => onChange(entry.id)}
          type="button"
        >
          {entry.label}
        </button>
      ))}
    </div>
  );
}

/** Renders the active non-map view; the parent renders the map case itself. */
export function CohortViewBody({
  view,
  cohorts,
  selectedId,
  onSelect,
  callDetails,
  onOpenCall,
}: {
  view: Exclude<CohortView, "map">;
  cohorts: CohortVM[];
  selectedId?: string;
  onSelect: (id: string) => void;
  callDetails: Record<string, VoiceCampaignCallDetail>;
  onOpenCall: (callId: string) => void;
}) {
  switch (view) {
    case "table":
      return (
        <CohortTable
          callDetails={callDetails}
          cohorts={cohorts}
          onOpenCall={onOpenCall}
          onSelect={onSelect}
          selectedId={selectedId}
        />
      );
    case "stages":
      return <CohortStages cohorts={cohorts} onSelect={onSelect} selectedId={selectedId} />;
  }
}
