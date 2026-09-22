/**
 * WhatsApp delivery status store.
 *
 * Storage: JSONL append log at {voiceStorageRoot}/whatsapp-message-status.jsonl.
 * Gupshup accepts sends asynchronously, then reports delivery through webhook
 * events. This store links the initial Gupshup messageId to later DLR events.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { getVoiceStorageRoot } from "./voice-storage";

export type WhatsAppMessageDeliveryStatus =
  | "submitted"
  | "enqueued"
  | "failed"
  | "sent"
  | "delivered"
  | "read"
  | "deleted"
  | "unknown";

export interface WhatsAppMessageStatusEvent {
  status: WhatsAppMessageDeliveryStatus;
  receivedAt: string;
  providerTimestamp?: string;
  errorCode?: string;
  errorReason?: string;
}

export interface WhatsAppMessageStatusRecord {
  provider: "gupshup";
  gupshupMessageId?: string;
  whatsappMessageId?: string;
  source?: string;
  destination?: string;
  templateId?: string;
  appName?: string;
  status: WhatsAppMessageDeliveryStatus;
  submittedAt?: string;
  updatedAt: string;
  errorCode?: string;
  errorReason?: string;
  history: WhatsAppMessageStatusEvent[];
}

interface StatusUpdate {
  gupshupMessageId?: string;
  whatsappMessageId?: string;
  source?: string;
  destination?: string;
  templateId?: string;
  appName?: string;
  status: WhatsAppMessageDeliveryStatus;
  providerTimestamp?: string;
  errorCode?: string;
  errorReason?: string;
  submittedAt?: string;
}

type LogEvent =
  | { type: "status"; data: StatusUpdate & { receivedAt: string } };

type G = typeof globalThis & {
  __whatsappStatusByGupshupId?: Map<string, WhatsAppMessageStatusRecord>;
  __whatsappStatusByWhatsAppId?: Map<string, WhatsAppMessageStatusRecord>;
  __whatsappStatusLoaded?: boolean;
};

const g = globalThis as G;
if (!g.__whatsappStatusByGupshupId) g.__whatsappStatusByGupshupId = new Map();
if (!g.__whatsappStatusByWhatsAppId) g.__whatsappStatusByWhatsAppId = new Map();
if (g.__whatsappStatusLoaded === undefined) g.__whatsappStatusLoaded = false;

const byGupshupId = g.__whatsappStatusByGupshupId;
const byWhatsAppId = g.__whatsappStatusByWhatsAppId;

function storePath(): string {
  const root = getVoiceStorageRoot();
  mkdirSync(root, { recursive: true });
  return join(root, "whatsapp-message-status.jsonl");
}

function append(event: LogEvent): void {
  try {
    appendFileSync(storePath(), JSON.stringify(event) + "\n", "utf-8");
  } catch (error) {
    console.error("[whatsapp-message-status-store] append failed:", error);
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

function normalizeStatus(value: unknown): WhatsAppMessageDeliveryStatus {
  const status = stringValue(value)?.toLowerCase();
  if (
    status === "submitted" ||
    status === "enqueued" ||
    status === "failed" ||
    status === "sent" ||
    status === "delivered" ||
    status === "read" ||
    status === "deleted"
  ) {
    return status;
  }
  return "unknown";
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

function indexRecord(record: WhatsAppMessageStatusRecord): void {
  if (record.gupshupMessageId) byGupshupId.set(record.gupshupMessageId, record);
  if (record.whatsappMessageId) byWhatsAppId.set(record.whatsappMessageId, record);
}

function applyStatusUpdate(update: StatusUpdate & { receivedAt: string }): WhatsAppMessageStatusRecord {
  const existing = update.gupshupMessageId
    ? byGupshupId.get(update.gupshupMessageId)
    : update.whatsappMessageId
      ? byWhatsAppId.get(update.whatsappMessageId)
      : undefined;
  const record: WhatsAppMessageStatusRecord = existing ?? {
    provider: "gupshup",
    status: update.status,
    updatedAt: update.receivedAt,
    history: [],
  };

  record.gupshupMessageId = update.gupshupMessageId ?? record.gupshupMessageId;
  record.whatsappMessageId = update.whatsappMessageId ?? record.whatsappMessageId;
  record.source = update.source ?? record.source;
  record.destination = update.destination ?? record.destination;
  record.templateId = update.templateId ?? record.templateId;
  record.appName = update.appName ?? record.appName;
  record.status = update.status;
  record.submittedAt = update.submittedAt ?? record.submittedAt;
  record.updatedAt = update.receivedAt;
  record.errorCode = update.errorCode ?? record.errorCode;
  record.errorReason = update.errorReason ?? record.errorReason;
  record.history.push({
    status: update.status,
    receivedAt: update.receivedAt,
    providerTimestamp: update.providerTimestamp,
    errorCode: update.errorCode,
    errorReason: update.errorReason,
  });
  indexRecord(record);
  return record;
}

function load(): void {
  if (g.__whatsappStatusLoaded) return;
  g.__whatsappStatusLoaded = true;
  const path = storePath();
  if (!existsSync(path)) return;
  try {
    const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const event = JSON.parse(line) as LogEvent;
        if (event.type === "status") applyStatusUpdate(event.data);
      } catch {
        // Skip malformed lines.
      }
    }
  } catch (error) {
    console.error("[whatsapp-message-status-store] load failed:", error);
  }
}

export function recordWhatsAppMessageStatus(update: StatusUpdate): WhatsAppMessageStatusRecord {
  load();
  const event: LogEvent = {
    type: "status",
    data: {
      ...update,
      receivedAt: new Date().toISOString(),
    },
  };
  const record = applyStatusUpdate(event.data);
  append(event);
  return record;
}

export function getWhatsAppMessageStatus(messageId: string): WhatsAppMessageStatusRecord | undefined {
  load();
  const trimmed = messageId.trim();
  return byGupshupId.get(trimmed) ?? byWhatsAppId.get(trimmed);
}

export function listWhatsAppMessageStatuses(limit = 25): WhatsAppMessageStatusRecord[] {
  load();
  return Array.from(byGupshupId.values())
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}

export function gupshupV2StatusUpdates(body: unknown): StatusUpdate[] {
  if (!isRecord(body) || body.type !== "message-event") return [];
  const payload = body.payload;
  if (!isRecord(payload)) return [];

  const eventType = normalizeStatus(payload.type);
  if (eventType === "unknown") return [];

  const nested = isRecord(payload.payload) ? payload.payload : {};
  const gsId = stringValue(payload.gsId);
  const eventId = stringValue(payload.id);
  const whatsappMessageId = stringValue(nested.whatsappMessageId) ?? (gsId ? eventId : undefined);
  const providerTimestamp = timestampFromValue(payload.ts) ??
    timestampFromValue(nested.ts) ??
    timestampFromValue(body.timestamp);

  return [{
    gupshupMessageId: gsId ?? (eventType === "enqueued" || eventType === "failed" ? eventId : undefined),
    whatsappMessageId,
    appName: stringValue(body.app),
    destination: stringValue(payload.destination),
    status: eventType,
    providerTimestamp,
    errorCode: stringValue(nested.code),
    errorReason: stringValue(nested.reason),
  }];
}

export function metaV3StatusUpdates(body: unknown): StatusUpdate[] {
  if (!isRecord(body) || !Array.isArray(body.entry)) return [];
  const updates: StatusUpdate[] = [];
  for (const entry of body.entry) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      if (!isRecord(change)) continue;
      const value = isRecord(change.value) ? change.value : undefined;
      if (!value || !Array.isArray(value.statuses)) continue;
      for (const status of value.statuses) {
        if (!isRecord(status)) continue;
        const firstError = Array.isArray(status.errors) && isRecord(status.errors[0])
          ? status.errors[0]
          : undefined;
        updates.push({
          whatsappMessageId: stringValue(status.id),
          destination: stringValue(status.recipient_id),
          status: normalizeStatus(status.status),
          providerTimestamp: timestampFromValue(status.timestamp),
          errorCode: stringValue(firstError?.code),
          errorReason: stringValue(firstError?.title) ?? stringValue(firstError?.message),
        });
      }
    }
  }
  return updates.filter((update) => update.whatsappMessageId && update.status !== "unknown");
}
