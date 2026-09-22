import type { CallEventOutboxRow } from "./call-event-outbox-repo";

export interface FivetranDeliveryResult {
  ok: boolean;
  statusCode?: number;
  error?: string;
  sentEventIds: string[];
  invalidEvents: Array<{ id: string; error: string }>;
}

function endpoint(): string {
  const value = process.env.FIVETRAN_CALL_EVENTS_ENDPOINT?.trim();
  if (!value) throw new Error("FIVETRAN_CALL_EVENTS_ENDPOINT is not configured");
  return value;
}

function authHeader(): string | undefined {
  const token = process.env.FIVETRAN_CALL_EVENTS_API_KEY?.trim();
  if (!token) return undefined;
  return `Bearer ${token}`;
}

function requestTimeoutMs(): number {
  const raw = Number.parseInt(process.env.FIVETRAN_CALL_EVENTS_TIMEOUT_MS || "", 10);
  if (!Number.isFinite(raw) || raw <= 0) return 15_000;
  return Math.max(1_000, Math.min(raw, 120_000));
}

export async function deliverCallEventsToFivetran(
  events: CallEventOutboxRow[],
): Promise<FivetranDeliveryResult> {
  if (events.length === 0) return { ok: true, statusCode: 204, sentEventIds: [], invalidEvents: [] };

  const url = endpoint();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const auth = authHeader();
  if (auth) headers.Authorization = auth;

  const invalidEvents: Array<{ id: string; error: string }> = [];
  const serializableEvents: Array<Record<string, unknown>> = [];
  const sentEventIds: string[] = [];

  for (const event of events) {
    try {
      serializableEvents.push({
        id: event.id,
        idempotencyKey: event.idempotencyKey,
        userId: event.userId,
        datasetId: event.datasetId,
        campaignId: event.campaignId,
        callId: event.callId,
        provider: event.provider,
        eventType: event.eventType,
        eventTs: event.eventTs,
        payload: JSON.parse(event.payloadJson),
        createdAt: event.createdAt,
      });
      sentEventIds.push(event.id);
    } catch (error) {
      invalidEvents.push({
        id: event.id,
        error: `Invalid payload_json: ${error instanceof Error ? error.message : "JSON parse failed"}`,
      });
    }
  }

  if (serializableEvents.length === 0) {
    return { ok: true, statusCode: 204, sentEventIds, invalidEvents };
  }

  const body = {
    source: "actioneer-voice.voice-calls",
    emittedAt: new Date().toISOString(),
    events: serializableEvents,
  };

  try {
    const timeoutMs = requestTimeoutMs();
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        statusCode: res.status,
        error: text || `Fivetran API error ${res.status}`,
        sentEventIds,
        invalidEvents,
      };
    }
    return { ok: true, statusCode: res.status, sentEventIds, invalidEvents };
  } catch (error) {
    const timeoutError =
      error instanceof Error &&
      (error.name === "TimeoutError" ||
        error.name === "AbortError" ||
        /timed?\s*out/i.test(error.message));
    return {
      ok: false,
      error: timeoutError
        ? "Fivetran delivery request timed out"
        : error instanceof Error
          ? error.message
          : "Unknown Fivetran delivery error",
      sentEventIds,
      invalidEvents,
    };
  }
}
