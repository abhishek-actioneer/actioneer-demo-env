// Server-only fs persistence for journey dispatches/events. Lives in
// <run>/journey/ — SIBLING to analysis/, which the pipeline regeneration
// recipe deletes. Re-running the analysis pipeline implies resetJourney().

import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join, resolve, sep } from "path";
import { getVoiceStorageRoot } from "@/lib/voice-storage";
import { DEFAULT_JOURNEY_PROFILES, type JourneyProfiles } from "./voice-campaign-journey-sim";
import type { JourneyDispatch, JourneyLogEvent } from "./voice-campaign-journey-types";

function journeyDirForRun(runId: string): string {
  const root = resolve(getVoiceStorageRoot(), "voice-simulation-runs");
  const dir = resolve(root, runId, "journey");
  if (dir === root || !dir.startsWith(`${root}${sep}`)) {
    throw new Error("Invalid journey run path");
  }
  return dir;
}

export function journeyEventsPath(runId: string): string {
  return join(journeyDirForRun(runId), "events.ndjson");
}

export function readDispatches(runId: string): JourneyDispatch[] {
  const path = join(journeyDirForRun(runId), "dispatches.json");
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as JourneyDispatch[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveDispatch(runId: string, dispatch: JourneyDispatch): void {
  const dir = journeyDirForRun(runId);
  mkdirSync(dir, { recursive: true });
  const dispatches = readDispatches(runId);
  dispatches.push(dispatch);
  writeFileSync(join(dir, "dispatches.json"), JSON.stringify(dispatches, null, 2));
}

export function appendEvents(runId: string, events: JourneyLogEvent[]): void {
  if (events.length === 0) return;
  const dir = journeyDirForRun(runId);
  mkdirSync(dir, { recursive: true });
  const lines = events.map((event) => JSON.stringify(event)).join("\n") + "\n";
  appendFileSync(join(dir, "events.ndjson"), lines);
}

export function readEvents(runId: string): JourneyLogEvent[] {
  const path = journeyEventsPath(runId);
  if (!existsSync(path)) return [];
  const events: JourneyLogEvent[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as JourneyLogEvent);
    } catch {
      // Skip torn/corrupt lines — append-only log, never fatal.
    }
  }
  return events;
}

export function readProfiles(runId: string): JourneyProfiles {
  const path = join(journeyDirForRun(runId), "profiles.json");
  if (!existsSync(path)) return DEFAULT_JOURNEY_PROFILES;
  try {
    const file = JSON.parse(readFileSync(path, "utf8")) as Partial<JourneyProfiles>;
    return {
      horizonHours: file.horizonHours ?? DEFAULT_JOURNEY_PROFILES.horizonHours,
      defaults: { ...DEFAULT_JOURNEY_PROFILES.defaults, ...file.defaults },
      clusters: file.clusters ?? {},
      capability: { ...DEFAULT_JOURNEY_PROFILES.capability, ...file.capability },
      wave2: {
        defaults: { ...DEFAULT_JOURNEY_PROFILES.wave2.defaults, ...file.wave2?.defaults },
        clusters: file.wave2?.clusters ?? {},
      },
    };
  } catch {
    return DEFAULT_JOURNEY_PROFILES;
  }
}

/**
 * Demo reset — deletes journey state but PRESERVES profiles.json (the
 * hand-tuned conversion story survives repeated demos). Returns whether any
 * state existed.
 */
export function resetJourney(runId: string): boolean {
  const dir = journeyDirForRun(runId);
  let existed = false;
  for (const file of ["dispatches.json", "events.ndjson"]) {
    const path = join(dir, file);
    if (!existsSync(path)) continue;
    existed = true;
    rmSync(path, { force: true });
  }
  return existed;
}
