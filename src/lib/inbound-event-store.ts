/**
 * Inbound event store — receives downstream conversion signals from client backends.
 *
 * Storage: JSONL append log at {voiceStorageRoot}/inbound-events.jsonl
 * Each event is one JSON line. Re-appending an updated event (with matchedCallId)
 * is handled by last-write-wins in the in-memory map on replay.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { randomBytes } from "crypto";
import { join } from "path";
import { getVoiceStorageRoot } from "./voice-storage";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InboundEvent {
  id: string;
  campaignId: string;
  event: string;
  phone: string;
  phoneNormalized: string;
  timestamp: string;
  receivedAt: string;
  matchedCallId?: string;
  matchedAt?: string;
}

// ---------------------------------------------------------------------------
// Indexes — pinned to globalThis for Next.js dev mode module isolation
// ---------------------------------------------------------------------------

type G = typeof globalThis & {
  __inboundById?:         Map<string, InboundEvent>;
  __inboundByCampaignId?: Map<string, string[]>;
  __inboundLoaded?:       boolean;
};
const g = globalThis as G;
if (!g.__inboundById)         g.__inboundById         = new Map();
if (!g.__inboundByCampaignId) g.__inboundByCampaignId = new Map();
if (g.__inboundLoaded === undefined) g.__inboundLoaded = false;

const byId         = g.__inboundById;
const byCampaignId = g.__inboundByCampaignId;

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

function storePath(): string {
  const root = getVoiceStorageRoot();
  mkdirSync(root, { recursive: true });
  return join(root, "inbound-events.jsonl");
}

function append(ev: InboundEvent): void {
  try {
    appendFileSync(storePath(), JSON.stringify(ev) + "\n", "utf-8");
  } catch (err) {
    console.error("[inbound-event-store] append failed:", err);
  }
}

function load(): void {
  if (g.__inboundLoaded) return;
  g.__inboundLoaded = true;
  const path = storePath();
  if (!existsSync(path)) return;
  try {
    const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const ev = JSON.parse(line) as InboundEvent;
        // last-write-wins for updated records (matched events re-appended)
        byId.set(ev.id, ev);
        if (!byCampaignId.has(ev.campaignId)) byCampaignId.set(ev.campaignId, []);
        const list = byCampaignId.get(ev.campaignId)!;
        if (!list.includes(ev.id)) list.push(ev.id);
      } catch { /* skip malformed */ }
    }
  } catch (err) {
    console.error("[inbound-event-store] load failed:", err);
  }
}

// ---------------------------------------------------------------------------
// Phone normalization
// ---------------------------------------------------------------------------

// Strip non-digits, take last 10 digits.
// Handles: +91XXXXXXXXXX, 91XXXXXXXXXX, 0XXXXXXXXXX, XXXXXXXXXX
export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function recordInboundEvent(opts: {
  campaignId: string;
  event: string;
  phone: string;
  timestamp: string;
  matchedCallId?: string;
}): InboundEvent {
  load();
  const ev: InboundEvent = {
    id:              randomBytes(8).toString("hex"),
    campaignId:      opts.campaignId,
    event:           opts.event,
    phone:           opts.phone,
    phoneNormalized: normalizePhone(opts.phone),
    timestamp:       opts.timestamp,
    receivedAt:      new Date().toISOString(),
    matchedCallId:   opts.matchedCallId,
    matchedAt:       opts.matchedCallId ? new Date().toISOString() : undefined,
  };
  byId.set(ev.id, ev);
  if (!byCampaignId.has(opts.campaignId)) byCampaignId.set(opts.campaignId, []);
  byCampaignId.get(opts.campaignId)!.push(ev.id);
  append(ev);
  return ev;
}

export function markEventMatched(id: string, callId: string): void {
  load();
  const ev = byId.get(id);
  if (!ev || ev.matchedCallId) return;
  ev.matchedCallId = callId;
  ev.matchedAt     = new Date().toISOString();
  append(ev); // re-append; last-write-wins on reload
}

export function getEventsForCampaign(campaignId: string, limit = 50): InboundEvent[] {
  load();
  const ids = byCampaignId.get(campaignId) ?? [];
  return ids
    .slice(-limit)
    .map((id) => byId.get(id))
    .filter((ev): ev is InboundEvent => ev !== undefined)
    .reverse();
}

export function findMatchingCall(
  phone: string,
  calls: Array<{ id: string; toNumber: string; startedAt?: string }>,
  windowDays: number,
  eventTimestamp: string,
): string | undefined {
  const phoneNorm  = normalizePhone(phone);
  const eventMs    = new Date(eventTimestamp).getTime();
  const windowMs   = windowDays * 24 * 60 * 60 * 1000;

  for (const call of calls) {
    if (normalizePhone(call.toNumber) !== phoneNorm) continue;
    const callMs = call.startedAt ? new Date(call.startedAt).getTime() : 0;
    if (!callMs) continue;
    // Event must occur after the call started and within the attribution window
    if (eventMs >= callMs && eventMs <= callMs + windowMs) return call.id;
  }
  return undefined;
}
