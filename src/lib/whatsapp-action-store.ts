import { randomUUID } from "crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { normalizeCustomerPhone } from "./customer-channel-memory";
import { getVoiceStorageRoot } from "./voice-storage";

export type WhatsAppActionTopic =
  | "portfolio_review"
  | "kyc_completion"
  | "advisor_callback";

export type WhatsAppActionStatus =
  | "requested"
  | "awaiting_time"
  | "time_captured"
  | "link_sent"
  | "cancelled";

export interface WhatsAppActionRequest {
  id: string;
  topic: WhatsAppActionTopic;
  status: WhatsAppActionStatus;
  phone: string;
  channel: "whatsapp";
  createdAt: string;
  updatedAt: string;
  userId?: string;
  contactName?: string;
  preferredTime?: string;
  sourceMessageId?: string;
  lastInboundText?: string;
  linkUrl?: string;
  notes: string[];
}

export interface UpsertWhatsAppActionRequestInput {
  phone: string;
  topic: WhatsAppActionTopic;
  status?: WhatsAppActionStatus;
  userId?: string;
  contactName?: string;
  preferredTime?: string;
  sourceMessageId?: string;
  lastInboundText?: string;
  linkUrl?: string;
  note?: string;
}

type LogRecord = { type: "upsert"; data: WhatsAppActionRequest };

type G = typeof globalThis & {
  __whatsappActionStoreLoaded?: boolean;
  __whatsappActionRequestsById?: Map<string, WhatsAppActionRequest>;
};

const g = globalThis as G;
if (!g.__whatsappActionRequestsById) g.__whatsappActionRequestsById = new Map();
if (g.__whatsappActionStoreLoaded === undefined) g.__whatsappActionStoreLoaded = false;

const requestsById = g.__whatsappActionRequestsById;

function storePath(): string {
  const root = getVoiceStorageRoot();
  mkdirSync(root, { recursive: true });
  return join(root, "whatsapp-actions.jsonl");
}

function append(record: LogRecord): void {
  try {
    appendFileSync(storePath(), JSON.stringify(record) + "\n", "utf-8");
  } catch (error) {
    console.error("[whatsapp-action-store] append failed:", error);
  }
}

function load(): void {
  if (g.__whatsappActionStoreLoaded) return;
  g.__whatsappActionStoreLoaded = true;
  const path = storePath();
  if (!existsSync(path)) return;
  try {
    const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const record = JSON.parse(line) as LogRecord;
        if (record.type === "upsert") requestsById.set(record.data.id, record.data);
      } catch {
        // Ignore malformed log lines.
      }
    }
  } catch (error) {
    console.error("[whatsapp-action-store] load failed:", error);
  }
}

function openStatus(status: WhatsAppActionStatus): boolean {
  return status !== "cancelled";
}

export function listWhatsAppActionRequestsByPhone(
  phone: string,
  topic?: WhatsAppActionTopic,
): WhatsAppActionRequest[] {
  load();
  const normalized = normalizeCustomerPhone(phone);
  if (!normalized) return [];
  return Array.from(requestsById.values())
    .filter((request) => request.phone === normalized && (!topic || request.topic === topic))
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
}

export function latestWhatsAppActionRequest(
  phone: string,
  topic?: WhatsAppActionTopic,
): WhatsAppActionRequest | undefined {
  return listWhatsAppActionRequestsByPhone(phone, topic).at(-1);
}

function latestOpenRequest(
  phone: string,
  topic: WhatsAppActionTopic,
): WhatsAppActionRequest | undefined {
  return listWhatsAppActionRequestsByPhone(phone, topic)
    .filter((request) => openStatus(request.status))
    .at(-1);
}

export function upsertWhatsAppActionRequest(
  input: UpsertWhatsAppActionRequestInput,
): WhatsAppActionRequest | undefined {
  load();
  const phone = normalizeCustomerPhone(input.phone);
  if (!phone) return undefined;

  const now = new Date().toISOString();
  const existing = latestOpenRequest(phone, input.topic);
  const notes = [
    ...(existing?.notes ?? []),
    input.note,
  ].filter((note): note is string => Boolean(note?.trim()));

  const request: WhatsAppActionRequest = {
    id: existing?.id ?? randomUUID(),
    topic: input.topic,
    status: input.status ?? existing?.status ?? "requested",
    phone,
    channel: "whatsapp",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    userId: input.userId ?? existing?.userId,
    contactName: input.contactName ?? existing?.contactName,
    preferredTime: input.preferredTime ?? existing?.preferredTime,
    sourceMessageId: input.sourceMessageId ?? existing?.sourceMessageId,
    lastInboundText: input.lastInboundText ?? existing?.lastInboundText,
    linkUrl: input.linkUrl ?? existing?.linkUrl,
    notes,
  };

  requestsById.set(request.id, request);
  append({ type: "upsert", data: request });
  return request;
}

export function resetWhatsAppActionStoreForTests(): void {
  requestsById.clear();
  g.__whatsappActionStoreLoaded = false;
}
