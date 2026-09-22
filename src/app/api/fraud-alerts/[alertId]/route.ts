import { auth } from "@clerk/nextjs/server";
import { withConnection } from "@/lib/db";
import { findCall } from "@/lib/voice-campaign-store";
import type { VoiceTranscriptTurn } from "@/lib/voice-campaign-types";

export const dynamic = "force-dynamic";

export interface FraudCallDetail {
  alert_id: string;
  call_id: string | null;
  customer_id: string;
  full_name: string;
  amount_at_risk_inr: number;
  merchant_name: string;
  txn_city: string;
  recommendation: string | null;
  duress_score: number | null;
  voice_onset_ms: number | null;
  elaboration_ratio: number | null;
  echo_score: number | null;
  stress_class: number | null;
  jitter: number | null;
  shimmer: number | null;
  hnr: number | null;
  background_voice: boolean | null;
  feature_importances: string | null;
  turn_count: number | null;
  called_at: string | null;
  resolved_at: string | null;
  transcript: VoiceTranscriptTurn[];
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ alertId: string }> }
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { alertId } = await params;

  try {
    const detail = await withConnection("hdfc-creditfraud", async (conn) => {
      const result = await conn.run(
        `SELECT * FROM voice_verification_calls WHERE alert_id = '${alertId.replace(/'/g, "''")}' ORDER BY called_at DESC LIMIT 1`
      );
      const cols = Array.from(result.columnNames()).map(String);
      const rawRows = await result.getRows();
      if (rawRows.length === 0) return null;
      const row = rawRows[0]!;
      const r: Record<string, unknown> = {};
      cols.forEach((col, i) => { r[col] = row[i]; });
      return r;
    });

    if (!detail) {
      return Response.json({ error: "No call found for this alert" }, { status: 404 });
    }

    const callId = detail.call_id != null ? String(detail.call_id) : null;

    // Try to get live transcript from voice-campaign-store (enriches pre-seeded rows too)
    let transcript: VoiceTranscriptTurn[] = [];
    if (callId) {
      const found = findCall(callId);
      if (found?.call.transcript && found.call.transcript.length > 0) {
        transcript = found.call.transcript;
      }
    }

    // Fall back to transcript stored in DuckDB
    if (transcript.length === 0 && detail.transcript) {
      try {
        transcript = JSON.parse(String(detail.transcript)) as VoiceTranscriptTurn[];
      } catch {
        transcript = [];
      }
    }

    const out: FraudCallDetail = {
      alert_id: alertId,
      call_id: callId,
      customer_id: String(detail.customer_id ?? ""),
      full_name: String((detail as Record<string, unknown>).full_name ?? ""),
      amount_at_risk_inr: Number(detail.amount_at_risk_inr ?? 0),
      merchant_name: String((detail as Record<string, unknown>).merchant_name ?? ""),
      txn_city: String((detail as Record<string, unknown>).txn_city ?? ""),
      recommendation: detail.recommendation != null ? String(detail.recommendation) : null,
      duress_score: detail.duress_score != null ? Number(detail.duress_score) : null,
      voice_onset_ms: detail.voice_onset_ms != null ? Number(detail.voice_onset_ms) : null,
      elaboration_ratio: detail.elaboration_ratio != null ? Number(detail.elaboration_ratio) : null,
      echo_score: detail.echo_score != null ? Number(detail.echo_score) : null,
      stress_class: detail.stress_class != null ? Number(detail.stress_class) : null,
      jitter: detail.jitter != null ? Number(detail.jitter) : null,
      shimmer: detail.shimmer != null ? Number(detail.shimmer) : null,
      hnr: detail.hnr != null ? Number(detail.hnr) : null,
      background_voice: detail.background_voice != null ? Boolean(detail.background_voice) : null,
      feature_importances: detail.feature_importances != null ? String(detail.feature_importances) : null,
      turn_count: detail.turn_count != null ? Number(detail.turn_count) : null,
      called_at: detail.called_at != null ? String(detail.called_at) : null,
      resolved_at: detail.resolved_at != null ? String(detail.resolved_at) : null,
      transcript,
    };

    return Response.json(out);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Query failed";
    return Response.json({ error: msg }, { status: 500 });
  }
}
