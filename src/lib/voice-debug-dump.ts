import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getVoiceStorageRoot } from "./voice-storage";

type JsonObject = Record<string, unknown>;

interface DumpVoiceOutboundPayloadInput {
  endpoint: string;
  method?: string;
  url?: string;
  identityParts?: Array<string | undefined>;
  payload?: unknown;
}

interface UpdateVoiceDumpInput {
  dumpStorageKey: string;
  patch: JsonObject;
}

interface UpdateVoiceOutboundDumpInput {
  dumpStorageKey: string;
  durationMs: number;
  status?: number;
  ok?: boolean;
  body?: unknown;
  error?: string;
}

interface DumpedVoiceForm {
  formData: FormData;
  body: JsonObject;
  dumpStorageKey: string;
}

interface DumpVoiceRequestMetadataInput {
  req: Request;
  endpoint: string;
  body?: unknown;
  parseError?: string;
}

interface VoiceSessionDumpInput {
  endpoint: string;
  identityParts?: Array<string | undefined>;
  metadata?: unknown;
}

export interface VoiceSessionDumpLogger {
  storageKey: string;
  event(type: string, detail?: unknown): void;
  close(summary?: unknown): void;
}

function safePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 160) || "unknown";
}

function objectValue(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function shouldRedactKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized.includes("secret") ||
    normalized.includes("token") ||
    normalized.includes("apikey") ||
    normalized.includes("api_key") ||
    normalized === "authorization";
}

function redactedUrlString(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return value;
  }

  url.searchParams.forEach((_, key) => {
    if (shouldRedactKey(key)) url.searchParams.set(key, "[redacted]");
  });
  return url.toString();
}

function redactValue(value: unknown, key = ""): unknown {
  if (key && shouldRedactKey(key)) return "[redacted]";
  if (typeof value === "string") return redactedUrlString(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as JsonObject).map(([entryKey, entryValue]) => [
      entryKey,
      redactValue(entryValue, entryKey),
    ]),
  );
}

function redactedQuery(url: URL): Record<string, string> {
  const query: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    query[key] = shouldRedactKey(key) ? "[redacted]" : value;
  });
  return query;
}

function identityFromParts(parts: Array<string | undefined> | undefined, fallback: string): string {
  const identity = (parts ?? []).filter((part): part is string => Boolean(part?.trim())).join("_");
  return identity || fallback;
}

function dumpPath(baseKey: string, endpoint: string, identity: string, payloadForHash: unknown): {
  dirKey: string;
  dumpStorageKey: string;
  path: string;
} {
  const hash = createHash("sha256").update(JSON.stringify(payloadForHash ?? "")).digest("hex").slice(0, 10);
  const filename = `${Date.now()}-${safePathPart(identity || hash)}.json`;
  const dirKey = `${baseKey}/${safePathPart(endpoint)}`;
  const dir = join(getVoiceStorageRoot(), dirKey);
  mkdirSync(dir, { recursive: true });
  const dumpStorageKey = `${dirKey}/${filename}`;
  return {
    dirKey,
    dumpStorageKey,
    path: join(dir, filename),
  };
}

export function updateVoiceDump({ dumpStorageKey, patch }: UpdateVoiceDumpInput): void {
  const path = join(getVoiceStorageRoot(), dumpStorageKey);
  if (!existsSync(path)) return;

  const existing = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const record = objectValue(existing) ?? {};
  const redactedPatch = objectValue(redactValue(patch)) ?? {};
  writeFileSync(path, JSON.stringify({
    ...record,
    ...redactedPatch,
  }, null, 2));
}

export function dumpVoiceOutboundPayload({
  endpoint,
  method = "POST",
  url,
  identityParts,
  payload,
}: DumpVoiceOutboundPayloadInput): string {
  const sentAt = new Date().toISOString();
  const identity = identityFromParts(identityParts, "");
  const { dumpStorageKey, path } = dumpPath("voice-outbound-dumps", endpoint, identity, payload);

  writeFileSync(path, JSON.stringify({
    sentAt,
    endpoint,
    method,
    ...(url ? { url: redactedUrlString(url) } : {}),
    payload: redactValue(payload),
  }, null, 2));

  return dumpStorageKey;
}

export function updateVoiceOutboundDump({
  dumpStorageKey,
  durationMs,
  status,
  ok,
  body,
  error,
}: UpdateVoiceOutboundDumpInput): void {
  updateVoiceDump({
    dumpStorageKey,
    patch: {
      response: {
        receivedAt: new Date().toISOString(),
        durationMs,
        ...(status !== undefined ? { status } : {}),
        ...(ok !== undefined ? { ok } : {}),
        ...(body !== undefined ? { body } : {}),
        ...(error ? { error } : {}),
      },
    },
  });
}

export function dumpVoiceRequestMetadata({
  req,
  endpoint,
  body,
  parseError,
}: DumpVoiceRequestMetadataInput): string {
  const receivedAt = new Date().toISOString();
  const url = new URL(req.url);
  const bodyRecord = objectValue(body);
  const identity = identityFromParts([
    typeof bodyRecord?.campaignId === "string" ? bodyRecord.campaignId : undefined,
    typeof bodyRecord?.callId === "string" ? bodyRecord.callId : undefined,
    typeof bodyRecord?.CallUUID === "string" ? bodyRecord.CallUUID : undefined,
    typeof bodyRecord?.RequestUUID === "string" ? bodyRecord.RequestUUID : undefined,
    url.searchParams.get("campaignId") ?? undefined,
    url.searchParams.get("callId") ?? undefined,
    url.searchParams.get("CallUUID") ?? undefined,
    url.searchParams.get("RequestUUID") ?? undefined,
  ], "");
  const { dumpStorageKey, path } = dumpPath("voice-callback-dumps", endpoint, identity, body ?? url.toString());

  writeFileSync(path, JSON.stringify({
    receivedAt,
    endpoint,
    method: req.method,
    path: url.pathname,
    query: redactedQuery(url),
    contentType: req.headers.get("content-type"),
    contentLength: req.headers.get("content-length"),
    ...(parseError ? { rawBody: body, parseError } : { body: redactValue(body) }),
  }, null, 2));

  return dumpStorageKey;
}

function formDataToObject(formData: FormData): JsonObject {
  const body: JsonObject = {};

  formData.forEach((value, key) => {
    const serialized = typeof value === "string"
      ? value
      : {
          name: value.name,
          size: value.size,
          type: value.type,
        };
    const existing = body[key];
    if (existing === undefined) {
      body[key] = serialized;
    } else if (Array.isArray(existing)) {
      existing.push(serialized);
    } else {
      body[key] = [existing, serialized];
    }
  });

  return body;
}

export async function readAndDumpVoiceForm(req: Request, endpoint: string): Promise<DumpedVoiceForm> {
  const formData = await req.formData();
  const body = formDataToObject(formData);
  const dumpStorageKey = dumpVoiceRequestMetadata({ req, endpoint, body });
  return { formData, body, dumpStorageKey };
}

export async function readAndDumpVoiceJson(req: Request, endpoint: string): Promise<{
  body: unknown;
  dumpStorageKey: string;
  parseError?: string;
}> {
  const rawBody = await req.text();
  let body: unknown = null;
  let parseError: string | undefined;

  try {
    body = rawBody ? JSON.parse(rawBody) : null;
  } catch (err) {
    parseError = err instanceof Error ? err.message : "Invalid JSON";
    body = rawBody;
  }

  const dumpStorageKey = dumpVoiceRequestMetadata({ req, endpoint, body, parseError });
  return { body, dumpStorageKey, parseError };
}

export function createVoiceSessionDump({
  endpoint,
  identityParts,
  metadata,
}: VoiceSessionDumpInput): VoiceSessionDumpLogger {
  const startedAt = new Date().toISOString();
  const startedAtMs = Date.now();
  const identity = identityFromParts(identityParts, "");
  const { dumpStorageKey, path } = dumpPath("voice-callback-dumps", endpoint, identity, metadata);
  const events: Array<{ at: string; elapsedMs: number; type: string; detail?: unknown }> = [];
  let closed = false;

  function write(extra: JsonObject = {}): void {
    writeFileSync(path, JSON.stringify({
      startedAt,
      endpoint,
      metadata: redactValue(metadata),
      events,
      ...extra,
    }, null, 2));
  }

  function event(type: string, detail?: unknown): void {
    if (closed && type !== "session.close") return;
    events.push({
      at: new Date().toISOString(),
      elapsedMs: Date.now() - startedAtMs,
      type,
      ...(detail !== undefined ? { detail: redactValue(detail) } : {}),
    });
    write();
  }

  write();

  return {
    storageKey: dumpStorageKey,
    event,
    close(summary?: unknown) {
      if (closed) return;
      closed = true;
      events.push({
        at: new Date().toISOString(),
        elapsedMs: Date.now() - startedAtMs,
        type: "session.close",
        ...(summary !== undefined ? { detail: redactValue(summary) } : {}),
      });
      write({
        closedAt: new Date().toISOString(),
      });
    },
  };
}
