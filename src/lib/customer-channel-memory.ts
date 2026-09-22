import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { randomUUID } from "crypto";
import { join } from "path";
import { getVoiceStorageRoot } from "./voice-storage";
import { getDb } from "./meta-db";
import type Database from "better-sqlite3";

export type CustomerChannel = "whatsapp" | "voice";
export type CustomerChannelDirection = "inbound" | "outbound";
export type CustomerChannelActor = "customer" | "agent" | "system";

export interface CustomerChannelEventInput {
  channel: CustomerChannel;
  direction: CustomerChannelDirection;
  actor: CustomerChannelActor;
  phone: string;
  text?: string;
  at?: string;
  provider?: "gupshup" | "plivo" | "twilio" | "gemini";
  providerMessageId?: string;
  whatsappMessageId?: string;
  callId?: string;
  campaignId?: string;
  userId?: string;
  datasetId?: string;
  recipientId?: string;
  templateId?: string;
  eventType?: string;
  status?: string;
  resolvedAt?: string;
  appName?: string;
  source?: string;
  destination?: string;
  contactName?: string;
  idempotencyKey?: string;
  raw?: unknown;
}

export interface CustomerChannelEvent extends Omit<CustomerChannelEventInput, "phone"> {
  id: string;
  phone: string;
  threadKey: string;
  at: string;
  createdAt: string;
}

export interface CustomerChannelEventRecordResult {
  event: CustomerChannelEvent;
  created: boolean;
}

type LogEvent = { type: "event"; data: CustomerChannelEvent };

type G = typeof globalThis & {
  __channelEventsMigrated__?: boolean;
};
const g = globalThis as G;

const MEMORY_MARKER = "OMNICHANNEL CUSTOMER MEMORY";
const FALLBACK_USER_ID = "default";

function storePath(): string {
  const root = getVoiceStorageRoot();
  mkdirSync(root, { recursive: true });
  return join(root, "customer-channel-events.jsonl");
}

function append(event: LogEvent): void {
  try {
    appendFileSync(storePath(), JSON.stringify(event) + "\n", "utf-8");
  } catch (error) {
    console.error("[customer-channel-memory] append failed:", error);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function timestampFromValue(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 10_000_000_000 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  const asString = stringValue(value);
  if (!asString) return undefined;
  const asNumber = Number(asString);
  if (Number.isFinite(asNumber)) return timestampFromValue(asNumber);
  const ms = Date.parse(asString);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

export function normalizeCustomerPhone(value: string | undefined): string | undefined {
  const digits = value?.replace(/^whatsapp:/i, "").replace(/\D/g, "") ?? "";
  return digits || undefined;
}

export function customerThreadKeyForPhone(phone: string | undefined): string | undefined {
  const normalized = normalizeCustomerPhone(phone);
  return normalized ? `phone:${normalized}` : undefined;
}

function textPreview(value: string | undefined, max = 1000): string | undefined {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function defaultIdempotencyKey(input: CustomerChannelEventInput, threadKey: string): string {
  const identity = [
    input.providerMessageId,
    input.whatsappMessageId,
    input.callId && input.eventType ? `${input.callId}:${input.eventType}` : undefined,
    input.callId && input.text ? `${input.callId}:${input.actor}:${input.at ?? ""}:${input.text}` : undefined,
  ].find(Boolean);
  return [
    threadKey,
    input.channel,
    input.direction,
    input.actor,
    identity ?? input.text ?? input.status ?? "event",
  ].join(":");
}

interface ChannelEventRow {
  id: string;
  user_id: string;
  contact_id: string;
  channel: string;
  direction: string;
  actor: string;
  event_type: string | null;
  content: string | null;
  call_id: string | null;
  campaign_id: string | null;
  template_id: string | null;
  provider: string | null;
  provider_message_id: string | null;
  status: string | null;
  resolved_at: string | null;
  idempotency_key: string | null;
  occurred_at: string;
  created_at: string;
  metadata_json: string | null;
}

function rowToEvent(row: ChannelEventRow, phone: string): CustomerChannelEvent {
  return {
    id: row.id,
    phone,
    threadKey: `phone:${phone}`,
    channel: row.channel as CustomerChannel,
    direction: row.direction as CustomerChannelDirection,
    actor: row.actor as CustomerChannelActor,
    eventType: row.event_type ?? undefined,
    text: row.content ?? undefined,
    callId: row.call_id ?? undefined,
    campaignId: row.campaign_id ?? undefined,
    templateId: row.template_id ?? undefined,
    provider: (row.provider ?? undefined) as CustomerChannelEventInput["provider"],
    providerMessageId: row.provider_message_id ?? undefined,
    whatsappMessageId: row.channel === "whatsapp" ? (row.provider_message_id ?? undefined) : undefined,
    status: row.status ?? undefined,
    resolvedAt: row.resolved_at ?? undefined,
    idempotencyKey: row.idempotency_key ?? undefined,
    at: row.occurred_at,
    createdAt: row.created_at,
    userId: row.user_id !== FALLBACK_USER_ID ? row.user_id : undefined,
  };
}

function resolveOrCreateContact(db: Database.Database, userId: string, normalizedPhone: string): string {
  const existing = db.prepare(
    "SELECT contact_id FROM contact_phones WHERE phone = ? AND user_id = ?",
  ).get(normalizedPhone, userId) as { contact_id: string } | undefined;
  if (existing) return existing.contact_id;

  const contactId = randomUUID();
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(
      "INSERT INTO contacts (id, user_id, created_at, updated_at) VALUES (?, ?, ?, ?)",
    ).run(contactId, userId, now, now);
    db.prepare(
      "INSERT INTO contact_phones (phone, user_id, contact_id) VALUES (?, ?, ?)",
    ).run(normalizedPhone, userId, contactId);
  })();
  return contactId;
}

function migrateJSONLIfNeeded(db: Database.Database): void {
  if (g.__channelEventsMigrated__) return;
  g.__channelEventsMigrated__ = true;

  const count = (db.prepare("SELECT COUNT(*) as cnt FROM channel_events").get() as { cnt: number }).cnt;
  if (count > 0) return;

  const path = storePath();
  if (!existsSync(path)) return;

  try {
    const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean);
    const events: CustomerChannelEvent[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as { type: string; data: CustomerChannelEvent };
        if (parsed.type === "event") events.push(parsed.data);
      } catch { /* skip malformed lines */ }
    }
    if (events.length === 0) return;

    console.info(`[customer-channel-memory] Migrating ${events.length} JSONL events to SQLite`);

    const insertContact = db.prepare(
      "INSERT OR IGNORE INTO contacts (id, user_id, created_at, updated_at) VALUES (?, ?, ?, ?)",
    );
    const insertPhone = db.prepare(
      "INSERT OR IGNORE INTO contact_phones (phone, user_id, contact_id) VALUES (?, ?, ?)",
    );
    const insertEvent = db.prepare(`
      INSERT OR IGNORE INTO channel_events
      (id, user_id, contact_id, channel, direction, actor, event_type, content, call_id, campaign_id,
       template_id, provider, provider_message_id, status, idempotency_key, occurred_at, created_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const contactMap = new Map<string, string>();

    db.transaction(() => {
      for (const event of events) {
        const phone = normalizeCustomerPhone(event.phone);
        if (!phone) continue;
        const userId = event.userId ?? FALLBACK_USER_ID;
        const mapKey = `${userId}:${phone}`;

        let contactId = contactMap.get(mapKey);
        if (!contactId) {
          contactId = randomUUID();
          contactMap.set(mapKey, contactId);
          const now = event.createdAt ?? new Date().toISOString();
          insertContact.run(contactId, userId, now, now);
          insertPhone.run(phone, userId, contactId);
        }

        insertEvent.run(
          event.id, userId, contactId,
          event.channel, event.direction, event.actor,
          event.eventType ?? null,
          event.text ?? null,
          event.callId ?? null,
          event.campaignId ?? null,
          event.templateId ?? null,
          event.provider ?? null,
          event.providerMessageId ?? event.whatsappMessageId ?? null,
          event.status ?? null,
          event.idempotencyKey ?? null,
          event.at,
          event.createdAt,
          null,
        );
      }
    })();

    console.info(`[customer-channel-memory] Migration complete`);
  } catch (error) {
    console.error("[customer-channel-memory] JSONL migration failed:", error);
    g.__channelEventsMigrated__ = false;
  }
}

export function recordCustomerChannelEventWithResult(
  input: CustomerChannelEventInput,
): CustomerChannelEventRecordResult | undefined {
  const db = getDb();
  migrateJSONLIfNeeded(db);

  const phone = normalizeCustomerPhone(input.phone);
  const threadKey = customerThreadKeyForPhone(input.phone);
  if (!phone || !threadKey) return undefined;

  const userId = input.userId ?? FALLBACK_USER_ID;
  const at = timestampFromValue(input.at) ?? new Date().toISOString();
  const idempotencyKey = input.idempotencyKey ?? defaultIdempotencyKey(input, threadKey);

  const existing = db.prepare(
    "SELECT * FROM channel_events WHERE idempotency_key = ? LIMIT 1",
  ).get(idempotencyKey) as ChannelEventRow | undefined;
  if (existing) return { event: rowToEvent(existing, phone), created: false };

  const contactId = resolveOrCreateContact(db, userId, phone);
  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT OR IGNORE INTO channel_events
    (id, user_id, contact_id, channel, direction, actor, event_type, content, call_id, campaign_id,
     template_id, provider, provider_message_id, status, idempotency_key, occurred_at, created_at, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, userId, contactId,
    input.channel, input.direction, input.actor,
    input.eventType ?? null,
    textPreview(input.text) ?? null,
    input.callId ?? null,
    input.campaignId ?? null,
    input.templateId ?? null,
    input.provider ?? null,
    input.providerMessageId ?? input.whatsappMessageId ?? null,
    input.status ?? null,
    idempotencyKey,
    at, now,
    null,
  );

  const event: CustomerChannelEvent = {
    ...input,
    id,
    phone,
    threadKey,
    text: textPreview(input.text),
    at,
    createdAt: now,
    idempotencyKey,
  };

  append({ type: "event", data: event });
  return { event, created: true };
}

export function recordCustomerChannelEvent(
  input: CustomerChannelEventInput,
): CustomerChannelEvent | undefined {
  return recordCustomerChannelEventWithResult(input)?.event;
}

export function listCustomerChannelEventsByPhone(
  phone: string,
  limit = 20,
  userId?: string,
): CustomerChannelEvent[] {
  const db = getDb();
  migrateJSONLIfNeeded(db);

  const normalizedPhone = normalizeCustomerPhone(phone);
  if (!normalizedPhone) return [];

  const effectiveUserId = userId ?? FALLBACK_USER_ID;

  const phoneRow = db.prepare(
    "SELECT contact_id FROM contact_phones WHERE phone = ? AND user_id = ?",
  ).get(normalizedPhone, effectiveUserId) as { contact_id: string } | undefined;
  if (!phoneRow) return [];

  const rows = db.prepare(`
    SELECT * FROM (
      SELECT * FROM channel_events
      WHERE user_id = ? AND contact_id = ?
      ORDER BY occurred_at DESC LIMIT ?
    ) ORDER BY occurred_at ASC
  `).all(effectiveUserId, phoneRow.contact_id, Math.max(1, limit)) as ChannelEventRow[];

  return rows.map(r => rowToEvent(r, normalizedPhone));
}

const WHATSAPP_SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * WhatsApp allows free-form (non-template) business messages only within 24h
 * of the customer's last inbound message. True when that window is open.
 */
export function hasOpenWhatsAppSession(phone: string, userId?: string, now = Date.now()): boolean {
  const events = listCustomerChannelEventsByPhone(phone, 100, userId);
  return events.some(
    (event) =>
      event.channel === "whatsapp" &&
      event.direction === "inbound" &&
      event.actor === "customer" &&
      now - new Date(event.at).getTime() < WHATSAPP_SESSION_WINDOW_MS,
  );
}

// ── Decay scoring ─────────────────────────────────────────────────────────────

const EVENT_DECAY_CONFIG: Record<string, { weight: number; lambdaPerHour: number }> = {
  "action_request_kyc":        { weight: 1.0, lambdaPerHour: 0.001 }, // half-life ~30d
  "action_request_portfolio":  { weight: 0.9, lambdaPerHour: 0.001 },
  "voice.transcript.user":     { weight: 0.8, lambdaPerHour: 0.005 }, // half-life ~6d
  "voice.transcript.assistant":{ weight: 0.5, lambdaPerHour: 0.008 }, // half-life ~3.6d
  "call.agent_disconnect":     { weight: 0.2, lambdaPerHour: 0.1   }, // half-life ~7h
  "whatsapp.text":             { weight: 0.6, lambdaPerHour: 0.02  }, // half-life ~35h
  "whatsapp.message":          { weight: 0.6, lambdaPerHour: 0.02  },
  "whatsapp.button_reply":     { weight: 0.7, lambdaPerHour: 0.015 }, // interactive = more intent
  "whatsapp.list_reply":       { weight: 0.7, lambdaPerHour: 0.015 },
  "whatsapp.quick_reply":      { weight: 0.7, lambdaPerHour: 0.015 },
  "whatsapp.auto_reply":       { weight: 0.3, lambdaPerHour: 0.04  }, // half-life ~17h
  "whatsapp.template_sent":    { weight: 0.4, lambdaPerHour: 0.03  }, // half-life ~23h
};
const DEFAULT_DECAY = { weight: 0.5, lambdaPerHour: 0.02 };

function decayScore(event: CustomerChannelEvent, nowMs: number): number {
  const cfg = EVENT_DECAY_CONFIG[event.eventType ?? ""] ?? DEFAULT_DECAY;
  const ageHours = Math.max(0, (nowMs - Date.parse(event.at)) / 3_600_000);
  const base = cfg.weight * Math.exp(-cfg.lambdaPerHour * ageHours);
  if (!event.eventType?.startsWith("action_request")) return base;
  return base * (event.resolvedAt ? 0.3 : 1.5);
}

interface TieredEvents {
  hot: CustomerChannelEvent[];
  warm: CustomerChannelEvent[];
}

function selectTieredEvents(events: CustomerChannelEvent[], nowMs: number): TieredEvents {
  const HOT_COUNT = 3;
  const WARM_COUNT = 6;
  const hot = events.slice(-HOT_COUNT);
  const rest = events.slice(0, -HOT_COUNT);
  const warm = rest
    .map(e => ({ e, score: decayScore(e, nowMs) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, WARM_COUNT)
    .map(s => s.e)
    .sort((a, b) => a.at.localeCompare(b.at));
  return { hot, warm };
}

function buildContextBlock(
  hot: CustomerChannelEvent[],
  warm: CustomerChannelEvent[],
  backgroundSummary: string | null,
): string | undefined {
  if (hot.length === 0 && warm.length === 0) return undefined;
  const sections: string[] = [MEMORY_MARKER];
  if (hot.length > 0) {
    sections.push("\n[Recent]");
    for (const line of hot.map(formatEventLine).filter(Boolean)) sections.push(line!);
  }
  if (warm.length > 0) {
    sections.push("\n[Relevant history]");
    for (const line of warm.map(formatEventLine).filter(Boolean)) sections.push(line!);
  }
  if (backgroundSummary) {
    sections.push("\n[Background]");
    sections.push(backgroundSummary);
  }
  sections.push(
    "",
    "How to use this memory:",
    "- Use it silently to avoid repeating questions the customer already answered.",
    "- If the customer asks about a prior WhatsApp or call, acknowledge the concrete prior detail.",
    "- Do not read this block aloud or mention internal event ids, templates, transcripts, or storage.",
  );
  return sections.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────

function actorLabel(event: CustomerChannelEvent): string {
  if (event.channel === "whatsapp") {
    return event.actor === "customer" ? "WhatsApp customer" : "WhatsApp agent";
  }
  return event.actor === "customer" ? "Voice customer" : "Voice agent";
}

function formatEventLine(event: CustomerChannelEvent): string | undefined {
  const text = textPreview(event.text, 220);
  const detail = [
    event.callId ? `call ${event.callId}` : undefined,
    event.templateId ? `template ${event.templateId}` : undefined,
    event.status && !text ? `status ${event.status}` : undefined,
  ].filter(Boolean).join(", ");
  const suffix = detail ? ` (${detail})` : "";
  if (text) return `- ${event.at}: ${actorLabel(event)}${suffix}: ${text}`;
  if (event.status) return `- ${event.at}: ${actorLabel(event)}${suffix}: ${event.status}`;
  return undefined;
}

export function customerChannelMemoryBlock(
  phone: string,
  _limit = 12,
  userId?: string,
): string | undefined {
  const db = getDb();
  migrateJSONLIfNeeded(db);

  const normalizedPhone = normalizeCustomerPhone(phone);
  if (!normalizedPhone) return undefined;

  const effectiveUserId = userId ?? FALLBACK_USER_ID;

  const phoneRow = db.prepare(
    "SELECT contact_id FROM contact_phones WHERE phone = ? AND user_id = ?",
  ).get(normalizedPhone, effectiveUserId) as { contact_id: string } | undefined;
  if (!phoneRow) return undefined;

  const rows = db.prepare(`
    SELECT * FROM (
      SELECT * FROM channel_events
      WHERE user_id = ? AND contact_id = ?
      ORDER BY occurred_at DESC LIMIT 100
    ) ORDER BY occurred_at ASC
  `).all(effectiveUserId, phoneRow.contact_id) as ChannelEventRow[];

  if (rows.length === 0) return undefined;

  const contact = db.prepare(
    "SELECT background_summary FROM contacts WHERE id = ? AND user_id = ?",
  ).get(phoneRow.contact_id, effectiveUserId) as { background_summary: string | null } | undefined;

  const events = rows.map(r => rowToEvent(r, normalizedPhone));
  const { hot, warm } = selectTieredEvents(events, Date.now());
  return buildContextBlock(hot, warm, contact?.background_summary ?? null);
}

export function appendCustomerChannelMemoryToSystemPrompt(
  systemPrompt: string,
  phone: string | undefined,
  userId?: string,
): string {
  if (!phone || systemPrompt.includes(MEMORY_MARKER)) return systemPrompt;
  const block = customerChannelMemoryBlock(phone, 12, userId);
  if (!block) return systemPrompt;
  return `${systemPrompt.trim()}\n\n${block}`;
}

export function markChannelEventResolved(id: string, resolvedAt?: string): void {
  const db = getDb();
  db.prepare(
    "UPDATE channel_events SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL",
  ).run(resolvedAt ?? new Date().toISOString(), id);
}

export function resetChannelEventsForTests(): void {
  const db = getDb();
  db.exec("DELETE FROM channel_events; DELETE FROM contact_phones; DELETE FROM contacts;");
  g.__channelEventsMigrated__ = true; // stay true so JSONL is never re-migrated after a clear
}

export function markContactActionEventsResolved(userId: string, phone: string, resolvedAt?: string): void {
  const db = getDb();
  const normalizedPhone = normalizeCustomerPhone(phone);
  if (!normalizedPhone) return;
  const phoneRow = db.prepare(
    "SELECT contact_id FROM contact_phones WHERE phone = ? AND user_id = ?",
  ).get(normalizedPhone, userId) as { contact_id: string } | undefined;
  if (!phoneRow) return;
  db.prepare(`
    UPDATE channel_events SET resolved_at = ?
    WHERE user_id = ? AND contact_id = ?
      AND event_type LIKE 'action_request%'
      AND resolved_at IS NULL
  `).run(resolvedAt ?? new Date().toISOString(), userId, phoneRow.contact_id);
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = stringValue(record[key]);
    if (value) return value;
  }
  return undefined;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function inboundTextFromPayload(type: string | undefined, payload: Record<string, unknown>): string | undefined {
  const nested = objectValue(payload.payload) ?? {};
  if (type === "text") return firstString(nested, ["text", "body"]) ?? firstString(payload, ["text", "body"]);
  if (type === "button_reply" || type === "list_reply" || type === "quick_reply") {
    return firstString(nested, ["title", "text", "body", "id"]) ?? firstString(payload, ["title", "text", "body"]);
  }
  return firstString(nested, ["text", "body", "caption", "title"]) ??
    firstString(payload, ["text", "body", "caption", "title"]);
}

export function gupshupV2InboundWhatsAppEvents(body: unknown): CustomerChannelEventInput[] {
  if (!isRecord(body) || body.type !== "message") return [];
  const payload = objectValue(body.payload);
  if (!payload) return [];

  const sender = objectValue(payload.sender) ?? {};
  const type = stringValue(payload.type)?.toLowerCase();
  const phone = firstString(payload, ["source", "from", "sender"]) ??
    firstString(sender, ["phone", "phoneNumber", "wa_id"]);
  const text = inboundTextFromPayload(type, payload);
  if (!phone || !text) return [];

  const messageId = firstString(payload, ["id", "messageId", "message_id"]);
  return [{
    channel: "whatsapp",
    direction: "inbound",
    actor: "customer",
    phone,
    text,
    at: timestampFromValue(payload.ts) ?? timestampFromValue(body.timestamp),
    provider: "gupshup",
    providerMessageId: messageId,
    whatsappMessageId: messageId,
    eventType: type ? `whatsapp.${type}` : "whatsapp.message",
    appName: stringValue(body.app),
    source: phone,
    destination: firstString(payload, ["destination", "to"]),
    contactName: firstString(sender, ["name", "displayName"]),
    idempotencyKey: messageId ? `gupshup:inbound:${messageId}` : undefined,
    raw: body,
  }];
}

export function metaV3InboundWhatsAppEvents(body: unknown): CustomerChannelEventInput[] {
  if (!isRecord(body) || !Array.isArray(body.entry)) return [];
  const events: CustomerChannelEventInput[] = [];
  for (const entry of body.entry) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      const value = objectValue(isRecord(change) ? change.value : undefined);
      if (!value || !Array.isArray(value.messages)) continue;
      const contacts = Array.isArray(value.contacts) ? value.contacts.filter(isRecord) : [];
      for (const message of value.messages) {
        if (!isRecord(message)) continue;
        const from = stringValue(message.from);
        const text = firstString(objectValue(message.text) ?? {}, ["body"]) ??
          firstString(objectValue(message.button) ?? {}, ["text", "payload"]) ??
          firstString(objectValue(message.interactive) ?? {}, ["title", "body"]);
        if (!from || !text) continue;
        const id = stringValue(message.id);
        const contact = contacts.find((item) => stringValue(item.wa_id) === from);
        const profile = objectValue(contact?.profile);
        events.push({
          channel: "whatsapp",
          direction: "inbound",
          actor: "customer",
          phone: from,
          text,
          at: timestampFromValue(message.timestamp),
          provider: "gupshup",
          providerMessageId: id,
          whatsappMessageId: id,
          eventType: `whatsapp.${stringValue(message.type) ?? "message"}`,
          source: from,
          destination: stringValue(value.phone_number_id),
          contactName: firstString(profile ?? {}, ["name"]),
          idempotencyKey: id ? `meta:inbound:${id}` : undefined,
          raw: body,
        });
      }
    }
  }
  return events;
}
