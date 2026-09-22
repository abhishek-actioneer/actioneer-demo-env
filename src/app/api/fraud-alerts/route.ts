import { auth } from "@clerk/nextjs/server";
import { withConnection } from "@/lib/db";

export const dynamic = "force-dynamic";

export interface FraudAlertRow {
  alert_id: string;
  severity: string;
  risk_score: number;
  amount_inr: number;
  merchant_name: string;
  merchant_category: string;
  txn_city: string;
  txn_ts: string;
  channel: string;
  trigger_reasons: string;
  typology: string | null;
  customer_id: string;
  full_name: string;
  home_city: string;
  segment: string;
  demo_phone: string | null;
  device_risk_tier: string | null;
  geo_mismatch: boolean | null;
  deviation_factor: number | null;
  // joined from voice_verification_calls
  call_id: string | null;
  recommendation: string | null;
  duress_score: number | null;
  voice_onset_ms: number | null;
  elaboration_ratio: number | null;
  echo_score: number | null;
  called_at: string | null;
  resolved_at: string | null;
  is_hero: boolean;
}

// Hero cases pinned to real CRITICAL alerts in our HDFC demo data (CNP intl +
// card-testing, all with geo-mismatch). Regenerating the dataset changes alert
// IDs — repick from fraud_call_context WHERE severity='CRITICAL' if so.
const HERO_ALERT_IDS = ["ALRT_0585b67d4c", "ALRT_21af1bf396", "ALRT_05412415c8"];

export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const rows = await withConnection("hdfc-creditfraud", async (conn) => {
      // Hero cases always appear regardless of severity filter
      const heroList = HERO_ALERT_IDS.map((id) => `'${id}'`).join(", ");
      const result = await conn.run(`
        SELECT
          fc.alert_id,
          fc.severity,
          fc.risk_score,
          fc.amount_inr,
          fc.merchant_name,
          fc.merchant_category,
          fc.txn_city,
          fc.txn_ts,
          fc.channel,
          fc.trigger_reasons,
          fc.typology,
          fc.customer_id,
          fc.full_name,
          fc.home_city,
          fc.segment,
          fc.demo_phone,
          fc.device_risk_tier,
          CASE WHEN fc.txn_city != fc.home_city THEN true ELSE false END AS geo_mismatch,
          fc.deviation_factor,
          v.call_id,
          v.recommendation,
          v.duress_score,
          v.voice_onset_ms,
          v.elaboration_ratio,
          v.echo_score,
          v.called_at,
          v.resolved_at,
          CASE WHEN fc.alert_id IN (${heroList}) THEN true ELSE false END AS is_hero
        FROM fraud_call_context fc
        LEFT JOIN voice_verification_calls v ON v.alert_id = fc.alert_id
        WHERE fc.alert_id IN (${heroList})
           OR fc.severity IN ('HIGH', 'CRITICAL')
        ORDER BY is_hero DESC, fc.risk_score DESC
        LIMIT 50
      `);
      const cols = Array.from(result.columnNames()).map(String);
      const rawRows = await result.getRows();
      return rawRows.map((row) => {
        const r: Record<string, unknown> = {};
        cols.forEach((col, i) => { r[col] = row[i]; });
        return {
          alert_id: String(r.alert_id ?? ""),
          severity: String(r.severity ?? ""),
          risk_score: Number(r.risk_score ?? 0),
          amount_inr: Number(r.amount_inr ?? 0),
          merchant_name: String(r.merchant_name ?? ""),
          merchant_category: String(r.merchant_category ?? ""),
          txn_city: String(r.txn_city ?? ""),
          txn_ts: String(r.txn_ts ?? ""),
          channel: String(r.channel ?? ""),
          trigger_reasons: String(r.trigger_reasons ?? ""),
          typology: r.typology != null ? String(r.typology) : null,
          customer_id: String(r.customer_id ?? ""),
          full_name: String(r.full_name ?? ""),
          home_city: String(r.home_city ?? ""),
          segment: String(r.segment ?? ""),
          demo_phone: r.demo_phone != null ? String(r.demo_phone) : null,
          device_risk_tier: r.device_risk_tier != null ? String(r.device_risk_tier) : null,
          geo_mismatch: r.geo_mismatch != null ? Boolean(r.geo_mismatch) : null,
          deviation_factor: r.deviation_factor != null ? Number(r.deviation_factor) : null,
          call_id: r.call_id != null ? String(r.call_id) : null,
          recommendation: r.recommendation != null ? String(r.recommendation) : null,
          duress_score: r.duress_score != null ? Number(r.duress_score) : null,
          voice_onset_ms: r.voice_onset_ms != null ? Number(r.voice_onset_ms) : null,
          elaboration_ratio: r.elaboration_ratio != null ? Number(r.elaboration_ratio) : null,
          echo_score: r.echo_score != null ? Number(r.echo_score) : null,
          called_at: r.called_at != null ? String(r.called_at) : null,
          resolved_at: r.resolved_at != null ? String(r.resolved_at) : null,
          is_hero: Boolean(r.is_hero),
        } satisfies FraudAlertRow;
      });
    });

    return Response.json({ alerts: rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Query failed";
    return Response.json({ error: msg }, { status: 500 });
  }
}
