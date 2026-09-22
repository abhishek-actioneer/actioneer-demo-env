/**
 * Types for the synthetic live-data system.
 *
 * Synthesis advances each sample dataset's "now" forward via a daily tick.
 * Plans are hand-authored per dataset (declarative). The tick handler reads
 * the plan and produces denormalized rows that match the public view schema.
 */

export interface SyntheticPlan {
  datasetId: string;
  enabled: boolean;
  cadence: {
    /** Wall-clock interval between automatic ticks. Daily = 24h. */
    intervalHours: number;
    /** How much synthetic time advances per tick. 24h = one synthetic day. */
    syntheticHoursPerTick: number;
  };
  /** Tables synthesized in DAG order (parents before children). */
  tables: TableSynthSpec[];
  /** Cleanup work after row generation. */
  postTick?: {
    refreshSummaries?: string[];
    invalidateCaches?: ("metrics" | "explorer" | "entity-catalog")[];
  };
}

import type { GrowthConfig } from "./growth";

export type TableSynthSpec =
  | {
      name: string;
      mode: "generate";
      /** Volume model: business-shape growth curve with seasonality + noise. */
      volume: GrowthConfig;
      /** Per-column generators. Keys are column names, values are generator specs. */
      columns: Record<string, ColumnGenerator>;
      /** Starting integer id for synthetic rows; must be above seed max. */
      idSpace?: { column: string; startAt: number };
    }
  | {
      name: string;
      /** Emit one row per row of the source table, sharing customer_id + date. */
      mode: "oneToOneFromBookings";
      /** Probability that a given source row produces a derived row (0..1). */
      probability?: number;
      columns: Record<string, ColumnGenerator>;
    }
  | {
      name: string;
      /**
       * Imperatively-generated table. The plan declares it for documentation
       * and so that infrastructure (seed view, __live shard, public union view)
       * is set up; row generation is handled by a per-dataset orchestrator
       * keyed on datasetId in tick.ts (or a future dispatch table).
       *
       * Used when generation has constraints the declarative ColumnGenerator
       * primitives can't express: cross-table FK sampling, computed columns,
       * conditional joint distributions, multi-pass UPDATE+INSERT pipelines.
       */
      mode: "custom";
      /** Short summary of what the imperative generator does (for ops). */
      description: string;
    };

export type ColumnGenerator =
  | { kind: "constant"; value: string | number | boolean | null }
  | { kind: "sequentialId"; prefix?: string; startAt: number }
  | { kind: "tickWindow"; granularity: "date" | "timestamp" | "time" }
  | { kind: "weightedChoice"; choices: { value: string; weight: number }[] }
  | { kind: "uniformInt"; min: number; max: number }
  | { kind: "uniformFloat"; min: number; max: number; precision?: number }
  | { kind: "boolean"; trueProbability: number }
  | { kind: "computed"; expr: string };

export interface TickResult {
  datasetId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  syntheticNowBefore: string;
  syntheticNowAfter: string;
  status: "ok" | "error" | "skipped";
  reason?: string;
  rowsInserted: Record<string, number>;
  error?: string;
}

export interface SyntheticClockState {
  baselineNow: Date;
  currentNow: Date;
  lastTickAttemptedAt: Date | null;
  lastTickSucceededAt: Date | null;
  tickCount: number;
  status: "ok" | "degraded" | "error";
  lastDeltas: Record<string, number> | null;
}
