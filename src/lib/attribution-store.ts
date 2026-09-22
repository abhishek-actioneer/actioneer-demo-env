/**
 * Attribution token store — tracks per-call trackable links for link-based success metrics.
 *
 * Storage: JSONL append log at {voiceStorageRoot}/attribution-tokens.jsonl
 *   - Each line is a JSON event: { type: "token" | "click", data: {...} }
 *   - Append-only writes are atomic at the OS level (no lock needed for concurrent clicks)
 *   - On server start, replay the log into in-memory maps for fast lookups
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { createHash, randomBytes } from "crypto";
import { join } from "path";
import { getVoiceStorageRoot } from "./voice-storage";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AttributionToken {
  token: string;
  callId: string;
  campaignId: string;
  recipientId?: string;
  dest: string;
  channel: "sms" | "whatsapp";
  createdAt: string;
  expiresAt: string;
}

export interface AttributionClick {
  clickedAt: string;
  isBot: boolean;
  sequence: number;
  ipHash?: string;
  userAgent?: string;
}

interface StoredRecord {
  token: AttributionToken;
  clicks: AttributionClick[];
  attributedAt?: string;
}

type LogEvent =
  | { type: "token"; data: AttributionToken }
  | { type: "click"; data: AttributionClick & { token: string } }
  | { type: "attributed"; data: { token: string; attributedAt: string } };

// ---------------------------------------------------------------------------
// In-memory indexes — pinned to globalThis so Next.js hot-reload and
// per-route module isolation don't lose state between API calls.
// ---------------------------------------------------------------------------

type G = typeof globalThis & {
  __attrByToken?:  Map<string, StoredRecord>;
  __attrByCallId?: Map<string, string[]>;
  __attrLoaded?:   boolean;
};
const g = globalThis as G;
if (!g.__attrByToken)  g.__attrByToken  = new Map();
if (!g.__attrByCallId) g.__attrByCallId = new Map();
if (g.__attrLoaded === undefined) g.__attrLoaded = false;

const byToken  = g.__attrByToken;
const byCallId = g.__attrByCallId;

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

function storePath(): string {
  const root = getVoiceStorageRoot();
  mkdirSync(root, { recursive: true });
  return join(root, "attribution-tokens.jsonl");
}

function appendEvent(event: LogEvent): void {
  try {
    appendFileSync(storePath(), JSON.stringify(event) + "\n", "utf-8");
  } catch (err) {
    console.error("[attribution-store] append failed:", err);
  }
}

function load(): void {
  if (g.__attrLoaded) return;
  g.__attrLoaded = true;

  const path = storePath();
  if (!existsSync(path)) return;

  try {
    const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const event = JSON.parse(line) as LogEvent;
        if (event.type === "token") {
          const record: StoredRecord = { token: event.data, clicks: [] };
          byToken.set(event.data.token, record);
          const existing = byCallId.get(event.data.callId) ?? [];
          existing.push(event.data.token);
          byCallId.set(event.data.callId, existing);
        } else if (event.type === "click") {
          const { token: tok, ...click } = event.data;
          const record = byToken.get(tok);
          if (record) record.clicks.push(click);
        } else if (event.type === "attributed") {
          const record = byToken.get(event.data.token);
          if (record && !record.attributedAt) record.attributedAt = event.data.attributedAt;
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch (err) {
    console.error("[attribution-store] load failed:", err);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createAttributionToken(opts: {
  callId: string;
  campaignId: string;
  dest: string;
  channel: "sms" | "whatsapp";
  windowDays: number;
  recipientId?: string;
}): AttributionToken {
  load();

  const token = randomBytes(9).toString("base64url"); // 12-char URL-safe, ~96 bits entropy
  const now = new Date();
  // Backstop: a window of 0 mints a token that is expired the instant it is
  // created, so the customer always sees "This link has expired." That is never
  // what a caller means — clamp and warn rather than shipping a dead link.
  let windowDays = opts.windowDays;
  if (!Number.isFinite(windowDays) || windowDays <= 0) {
    console.warn(
      `[attribution-store] windowDays=${opts.windowDays} for campaign ${opts.campaignId}` +
        ` would expire immediately — falling back to 7 days.`,
    );
    windowDays = 7;
  }
  const expiresAt = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000).toISOString();

  const record: AttributionToken = {
    token,
    callId: opts.callId,
    campaignId: opts.campaignId,
    recipientId: opts.recipientId,
    dest: opts.dest,
    channel: opts.channel,
    createdAt: now.toISOString(),
    expiresAt,
  };

  byToken.set(token, { token: record, clicks: [] });
  const existing = byCallId.get(opts.callId) ?? [];
  existing.push(token);
  byCallId.set(opts.callId, existing);

  appendEvent({ type: "token", data: record });
  return record;
}

export function getAttributionRecord(token: string): StoredRecord | undefined {
  load();
  return byToken.get(token);
}

export function recordClick(
  token: string,
  opts: { isBot: boolean; userAgent?: string; ip?: string },
): { isFirstHuman: boolean } {
  load();

  const record = byToken.get(token);
  if (!record) return { isFirstHuman: false };

  // Debounce: same IP, same bot-status, within 10s → skip
  if (opts.ip) {
    const ipHash = createHash("sha256").update(opts.ip).digest("hex").slice(0, 16);
    const tenSecondsAgo = Date.now() - 10_000;
    const recentDuplicate = record.clicks.some(
      (c) => c.ipHash === ipHash && !c.isBot === !opts.isBot && new Date(c.clickedAt).getTime() > tenSecondsAgo,
    );
    if (recentDuplicate) return { isFirstHuman: false };
  }

  const ipHash = opts.ip
    ? createHash("sha256").update(opts.ip).digest("hex").slice(0, 16)
    : undefined;

  const click: AttributionClick = {
    clickedAt: new Date().toISOString(),
    isBot: opts.isBot,
    sequence: record.clicks.length + 1,
    ipHash,
    userAgent: opts.userAgent?.slice(0, 160),
  };

  record.clicks.push(click);
  appendEvent({ type: "click", data: { ...click, token } });

  const isFirstHuman = !opts.isBot && !record.attributedAt;
  if (isFirstHuman) {
    record.attributedAt = click.clickedAt;
    appendEvent({ type: "attributed", data: { token, attributedAt: click.clickedAt } });
  }

  return { isFirstHuman };
}

export function getCallAttribution(callId: string): {
  attributed: boolean;
  attributedAt?: string;
  humanClickCount: number;
  channels: Array<"sms" | "whatsapp">;
} {
  load();

  const tokens = byCallId.get(callId) ?? [];
  let attributed = false;
  let attributedAt: string | undefined;
  let humanClickCount = 0;
  const channels: Array<"sms" | "whatsapp"> = [];

  for (const tok of tokens) {
    const record = byToken.get(tok);
    if (!record) continue;
    humanClickCount += record.clicks.filter((c) => !c.isBot).length;
    channels.push(record.token.channel);
    if (record.attributedAt) {
      attributed = true;
      if (!attributedAt || record.attributedAt < attributedAt) {
        attributedAt = record.attributedAt;
      }
    }
  }

  return { attributed, attributedAt, humanClickCount, channels };
}
