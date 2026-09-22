import { randomUUID } from "crypto";
import { createHash } from "crypto";
import { getDb } from "@/lib/meta-db";

export type CallEventExportStatus =
  | "pending"
  | "processing"
  | "failed"
  | "delivered"
  | "dead_letter";

export interface CallEventOutboxRow {
  id: string;
  userId: string;
  datasetId: string;
  campaignId: string | null;
  callId: string;
  provider: string | null;
  eventType: string;
  eventTs: string;
  payloadJson: string;
  idempotencyKey: string;
  exportStatus: CallEventExportStatus;
  attemptCount: number;
  nextAttemptAt: string;
  lastError: string | null;
  fivetranResponseCode: number | null;
  createdAt: string;
  updatedAt: string;
  deliveredAt: string | null;
}

export interface EnqueueCallEventInput {
  userId: string;
  datasetId: string;
  campaignId?: string;
  callId: string;
  provider?: string;
  eventType: string;
  eventTs?: string;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface CallEventOutboxHealth {
  total: number;
  pending: number;
  processing: number;
  failed: number;
  delivered: number;
  deadLetter: number;
  oldestPendingNextAttemptAt: string | null;
  oldestPendingAgeMs: number | null;
  latestDeliveredAt: string | null;
}

function toRow(row: Record<string, unknown>): CallEventOutboxRow {
  return {
    id: String(row.id ?? ""),
    userId: String(row.user_id ?? ""),
    datasetId: String(row.dataset_id ?? ""),
    campaignId: row.campaign_id ? String(row.campaign_id) : null,
    callId: String(row.call_id ?? ""),
    provider: row.provider ? String(row.provider) : null,
    eventType: String(row.event_type ?? ""),
    eventTs: String(row.event_ts ?? ""),
    payloadJson: String(row.payload_json ?? "{}"),
    idempotencyKey: String(row.idempotency_key ?? ""),
    exportStatus: String(row.export_status ?? "pending") as CallEventExportStatus,
    attemptCount: Number(row.attempt_count ?? 0),
    nextAttemptAt: String(row.next_attempt_at ?? ""),
    lastError: row.last_error ? String(row.last_error) : null,
    fivetranResponseCode:
      row.fivetran_response_code === null || row.fivetran_response_code === undefined
        ? null
        : Number(row.fivetran_response_code),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
    deliveredAt: row.delivered_at ? String(row.delivered_at) : null,
  };
}

function defaultIdempotencyKey(input: EnqueueCallEventInput): string {
  const payloadDigest = createHash("sha256")
    .update(JSON.stringify(input.payload))
    .digest("hex")
    .slice(0, 20);
  const ts = input.eventTs ?? "";
  return `${input.userId}:${input.datasetId}:${input.callId}:${input.eventType}:${ts}:${payloadDigest}`;
}

export function enqueueCallEvent(input: EnqueueCallEventInput): string {
  const db = getDb();
  const now = new Date().toISOString();
  const eventTs = input.eventTs ?? now;
  const idempotencyKey = input.idempotencyKey ?? defaultIdempotencyKey(input);
  const id = randomUUID();
  const payloadJson = JSON.stringify(input.payload ?? {});

  db.prepare(`
    INSERT INTO call_event_outbox (
      id, user_id, dataset_id, campaign_id, call_id, provider, event_type, event_ts, payload_json,
      idempotency_key, export_status, attempt_count, next_attempt_at, created_at, updated_at
    ) VALUES (
      @id, @user_id, @dataset_id, @campaign_id, @call_id, @provider, @event_type, @event_ts, @payload_json,
      @idempotency_key, 'pending', 0, @next_attempt_at, @created_at, @updated_at
    )
    ON CONFLICT(idempotency_key) DO UPDATE SET
      payload_json = excluded.payload_json,
      event_ts = excluded.event_ts,
      updated_at = excluded.updated_at
  `).run({
    id,
    user_id: input.userId,
    dataset_id: input.datasetId,
    campaign_id: input.campaignId ?? null,
    call_id: input.callId,
    provider: input.provider ?? null,
    event_type: input.eventType,
    event_ts: eventTs,
    payload_json: payloadJson,
    idempotency_key: idempotencyKey,
    next_attempt_at: now,
    created_at: now,
    updated_at: now,
  });

  return idempotencyKey;
}

export function claimPendingCallEvents(limit: number): CallEventOutboxRow[] {
  const db = getDb();
  const now = new Date().toISOString();
  const safeLimit = Math.max(1, Math.min(limit, 500));

  const tx = db.transaction(() => {
    const candidates = db.prepare(`
      SELECT *
      FROM call_event_outbox
      WHERE export_status IN ('pending', 'failed')
        AND next_attempt_at <= ?
      ORDER BY next_attempt_at ASC
      LIMIT ?
    `).all(now, safeLimit) as Array<Record<string, unknown>>;

    if (candidates.length === 0) return [] as CallEventOutboxRow[];

    const claimStmt = db.prepare(`
      UPDATE call_event_outbox
      SET export_status = 'processing',
          attempt_count = attempt_count + 1,
          updated_at = ?
      WHERE id = ?
        AND export_status IN ('pending', 'failed')
    `);

    const claimed: CallEventOutboxRow[] = [];
    for (const candidate of candidates) {
      const row = toRow(candidate);
      const result = claimStmt.run(now, row.id);
      if (result.changes > 0) {
        claimed.push({
          ...row,
          exportStatus: "processing",
          attemptCount: row.attemptCount + 1,
          updatedAt: now,
        });
      }
    }
    return claimed;
  });

  return tx();
}

export function reclaimStaleProcessingCallEvents(maxStaleMs: number): number {
  const safeMaxStaleMs = Math.max(60_000, maxStaleMs);
  const now = Date.now();
  const cutoff = new Date(now - safeMaxStaleMs).toISOString();
  const nowIso = new Date(now).toISOString();
  const result = getDb().prepare(`
    UPDATE call_event_outbox
    SET export_status = 'failed',
        next_attempt_at = @next_attempt_at,
        updated_at = @updated_at,
        last_error = COALESCE(last_error, @last_error)
    WHERE export_status = 'processing'
      AND updated_at <= @cutoff
  `).run({
    next_attempt_at: nowIso,
    updated_at: nowIso,
    last_error: "Recovered stale processing event",
    cutoff,
  });
  return Number(result.changes ?? 0);
}

export function markCallEventDelivered(id: string, responseCode?: number): void {
  const now = new Date().toISOString();
  getDb().prepare(`
    UPDATE call_event_outbox
    SET export_status = 'delivered',
        delivered_at = @now,
        updated_at = @now,
        last_error = NULL,
        fivetran_response_code = @response_code
    WHERE id = @id
  `).run({
    id,
    now,
    response_code: responseCode ?? null,
  });
}

export function markCallEventFailed(
  id: string,
  opts: { error: string; responseCode?: number; retryAfterMs: number; maxAttempts: number },
): void {
  const now = Date.now();
  const current = getDb().prepare(`
    SELECT attempt_count FROM call_event_outbox WHERE id = ?
  `).get(id) as { attempt_count?: number } | undefined;
  if (!current) return;

  const attempts = Number(current.attempt_count ?? 0);
  const terminal = attempts >= Math.max(1, opts.maxAttempts);
  const nextAttemptAt = new Date(now + Math.max(1_000, opts.retryAfterMs)).toISOString();
  const updatedAt = new Date(now).toISOString();

  getDb().prepare(`
    UPDATE call_event_outbox
    SET export_status = @status,
        next_attempt_at = @next_attempt_at,
        updated_at = @updated_at,
        last_error = @last_error,
        fivetran_response_code = @response_code
    WHERE id = @id
  `).run({
    id,
    status: terminal ? "dead_letter" : "failed",
    next_attempt_at: nextAttemptAt,
    updated_at: updatedAt,
    last_error: opts.error.slice(0, 1000),
    response_code: opts.responseCode ?? null,
  });
}

export function getCallEventOutboxHealth(nowIso = new Date().toISOString()): CallEventOutboxHealth {
  const row = getDb().prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN export_status = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN export_status = 'processing' THEN 1 ELSE 0 END) AS processing,
      SUM(CASE WHEN export_status = 'failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN export_status = 'delivered' THEN 1 ELSE 0 END) AS delivered,
      SUM(CASE WHEN export_status = 'dead_letter' THEN 1 ELSE 0 END) AS dead_letter,
      MIN(CASE WHEN export_status IN ('pending', 'failed') THEN next_attempt_at END) AS oldest_pending_next_attempt_at,
      MAX(delivered_at) AS latest_delivered_at
    FROM call_event_outbox
  `).get() as Record<string, unknown>;

  const oldestPendingNextAttemptAt = row.oldest_pending_next_attempt_at
    ? String(row.oldest_pending_next_attempt_at)
    : null;

  let oldestPendingAgeMs: number | null = null;
  if (oldestPendingNextAttemptAt) {
    const age = Date.parse(nowIso) - Date.parse(oldestPendingNextAttemptAt);
    if (Number.isFinite(age)) oldestPendingAgeMs = Math.max(0, age);
  }

  return {
    total: Number(row.total ?? 0),
    pending: Number(row.pending ?? 0),
    processing: Number(row.processing ?? 0),
    failed: Number(row.failed ?? 0),
    delivered: Number(row.delivered ?? 0),
    deadLetter: Number(row.dead_letter ?? 0),
    oldestPendingNextAttemptAt,
    oldestPendingAgeMs,
    latestDeliveredAt: row.latest_delivered_at ? String(row.latest_delivered_at) : null,
  };
}

