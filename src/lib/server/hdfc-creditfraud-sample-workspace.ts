import { createHash } from "crypto";
import type { FunnelConfig } from "@/lib/funnel-types";
import type { RetentionConfig } from "@/lib/retention-types";
import { hdfcCreditfraudDataset } from "@/lib/datasets/hdfc-creditfraud";
import { executeSQLInternal } from "@/lib/sql-executor";
import { computeFunnelHeadlineConversion, computeD7Retention } from "@/lib/server/seed-metric-helpers";
import { upsertSegment } from "@/lib/server/segment-repo";
import { upsertFunnel } from "@/lib/server/funnel-repo";
import { upsertRetention } from "@/lib/server/retention-repo";

export const HDFC_CREDITFRAUD_DATASET_ID = "hdfc-creditfraud";
const DATA_RANGE = { start: "2024-06-01", end: "2026-05-31" } as const;

function seedId(userId: string, kind: string, slug: string): string {
  const hash = createHash("sha256").update(userId).digest("hex").slice(0, 8);
  return `hdfc_${hash}_${kind}_${slug}`;
}

async function countSegment(sql: string): Promise<number> {
  const wrapped = `SELECT COUNT(*) AS n FROM (${sql}) AS s`;
  const result = await executeSQLInternal(wrapped, HDFC_CREDITFRAUD_DATASET_ID);
  if (result.error || result.rows.length === 0) return 0;
  return Number((result.rows[0] as Record<string, unknown>).n) || 0;
}

// ── SEGMENTS: handcrafted SQL, customer_id is the entity ──
const SEGMENTS = [
  {
    slug: "high-alert-fatigue",
    name: "High Alert-Fatigue Customers (3+ Alerts)",
    description: "Customers who have received 3 or more fraud alerts: at risk of alert fatigue and false-decline friction, a key CX cost of low precision.",
    sql: "SELECT customer_id, COUNT(*) AS alert_count FROM fraud_alerts GROUP BY customer_id HAVING COUNT(*) >= 3 ORDER BY alert_count DESC",
  },
  {
    slug: "declined-transaction-customers",
    name: "Declined-Transaction Customers",
    description: "Cardholders who have had at least one transaction declined: the friction-and-risk surface where genuine spend and fraud attempts both get blocked.",
    sql: "SELECT DISTINCT cu.customer_id, cu.full_name, cu.segment FROM transactions t JOIN cards c ON c.card_id = t.card_id JOIN customers cu ON cu.customer_id = c.customer_id WHERE t.response = 'DECLINED'",
  },
  {
    slug: "revolving-cardholders",
    name: "Revolving Cardholders (Interest-Earning)",
    description: "Customers carrying a revolving balance on at least one statement: the interest-earning book, and a higher-stress cohort for delinquency and fraud loss.",
    sql: "SELECT DISTINCT cu.customer_id, cu.full_name, cu.segment FROM statements s JOIN cards c ON c.card_id = s.card_id JOIN customers cu ON cu.customer_id = c.customer_id WHERE s.revolve_flag = true",
  },
  {
    slug: "premium-cardholders",
    name: "Premium Cardholders (Imperia + Preferred)",
    description: "Top-tier Imperia and Preferred customers: highest spend and international exposure, so absolute fraud exposure is high even when the fraud rate is similar.",
    sql: "SELECT customer_id, full_name, segment, city, income_band FROM customers WHERE segment IN ('Imperia','Preferred') ORDER BY segment",
  },
  {
    slug: "intl-enabled-cnp-exposure",
    name: "International-Enabled Cardholders (CNP Exposure)",
    description: "Customers holding an internationally-enabled card: the card-not-present and cross-border fraud surface, the highest-loss typology in the book.",
    sql: "SELECT DISTINCT customer_id FROM cards WHERE intl_enabled_flag = true",
  },
  {
    slug: "false-decline-complainers",
    name: "False-Decline Complainers",
    description: "Customers who raised a false-decline complaint: genuine transactions blocked by the fraud system, the direct CX cost of a high false-positive rate.",
    sql: "SELECT DISTINCT customer_id FROM service_interactions WHERE category = 'FALSE_DECLINE_COMPLAINT'",
  },
];

// ── FUNNELS: customer_id-backed events (fraud_alerts, case_resolutions, service_interactions) ──
const FUNNELS: Array<{ slug: string; name: string; description: string; config: FunnelConfig }> = [
  {
    slug: "fraud-alert-resolution",
    name: "Alert Raised → Confirmed → Case Opened",
    description: "The fraud-resolution chain: of customers who get a fraud alert, how many are analyst-confirmed as real fraud, and how many of those have a case opened. The big drop from raised to confirmed is the precision tax — most alerts are false positives.",
    config: {
      steps: [{ eventId: "alert_raised" }, { eventId: "alert_confirmed" }, { eventId: "case_opened" }],
      conversionWindow: "30d",
      order: "this_order",
      dateRange: DATA_RANGE,
    },
  },
  {
    slug: "confirmed-fraud-to-chargeback",
    name: "Confirmed Fraud → Case → Chargeback Raised",
    description: "Containment-to-recovery: of customers with confirmed fraud, how many have a case opened, and how many of those escalate to a chargeback. Each step is a place recovery can stall.",
    config: {
      steps: [{ eventId: "alert_confirmed" }, { eventId: "case_opened" }, { eventId: "chargeback_raised" }],
      conversionWindow: "90d",
      order: "this_order",
      dateRange: DATA_RANGE,
    },
  },
  {
    slug: "alert-to-friction-complaint",
    name: "Alert Raised → False-Decline Complaint",
    description: "The customer-friction leak: of customers who receive a fraud alert, how many come back with a false-decline complaint. This sizes the CX cost of low alert precision.",
    config: {
      steps: [{ eventId: "alert_raised" }, { eventId: "false_decline_complaint" }],
      conversionWindow: "30d",
      order: "this_order",
      dateRange: DATA_RANGE,
    },
  },
];

// ── RETENTIONS ──
const RETENTIONS: Array<{ slug: string; name: string; description: string; config: RetentionConfig }> = [
  {
    slug: "repeat-victim-recurrence",
    name: "Repeat-Victim Alert Recurrence (Daily)",
    description: "Of customers who get a first fraud alert, what share get another alert in later months. A sticky minority recurs — never near 0% or 100% — which is the repeat-victim signal.",
    config: {
      startEventId: "alert_raised",
      returnEventIds: ["alert_raised"],
      mode: "on_or_after",
      granularity: "daily",
      dateRange: DATA_RANGE,
    },
  },
  {
    slug: "confirmed-fraud-recompromise",
    name: "Confirmed-Fraud Re-Compromise (Daily)",
    description: "Of customers with a first confirmed fraud, what share are confirmed again later. Re-compromise is real but a minority tail — the account-takeover persistence signal.",
    config: {
      startEventId: "alert_confirmed",
      returnEventIds: ["alert_confirmed"],
      mode: "on_or_after",
      granularity: "daily",
      dateRange: DATA_RANGE,
    },
  },
  {
    slug: "alert-to-friction-recurrence",
    name: "Alert → Recurring Friction Complaint (Daily)",
    description: "Of customers who receive a fraud alert, what share lodge a false-decline complaint in later months. Friction complaints recur for a frustrated minority — the alert-fatigue cost curve.",
    config: {
      startEventId: "alert_raised",
      returnEventIds: ["false_decline_complaint"],
      mode: "on_or_after",
      granularity: "daily",
      dateRange: DATA_RANGE,
    },
  },
];

async function funnelConversion(config: FunnelConfig): Promise<number | null> {
  return computeFunnelHeadlineConversion(config, hdfcCreditfraudDataset, HDFC_CREDITFRAUD_DATASET_ID);
}
async function d7Retention(config: RetentionConfig): Promise<number | null> {
  return computeD7Retention(config, hdfcCreditfraudDataset, HDFC_CREDITFRAUD_DATASET_ID);
}

export async function seedHdfcCreditfraudSampleWorkspace(userId: string): Promise<{
  segments: number; funnels: number; retentions: number;
}> {
  let segments = 0;
  for (const seg of SEGMENTS) {
    try {
      const userCount = await countSegment(seg.sql);
      upsertSegment(userId, { id: seedId(userId, "seg", seg.slug), name: seg.name, description: seg.description, sql: seg.sql, userCount, datasetId: HDFC_CREDITFRAUD_DATASET_ID });
      segments++;
    } catch (err) { console.warn(`[hdfc-seed] segment ${seg.slug} failed:`, err); }
  }
  let funnels = 0;
  for (const f of FUNNELS) {
    try {
      const overallConversion = await funnelConversion(f.config);
      upsertFunnel(userId, { id: seedId(userId, "fun", f.slug), name: f.name, description: f.description, config: f.config, source: "auto", overallConversion, datasetId: HDFC_CREDITFRAUD_DATASET_ID });
      funnels++;
    } catch (err) { console.warn(`[hdfc-seed] funnel ${f.slug} failed:`, err); }
  }
  let retentions = 0;
  for (const r of RETENTIONS) {
    try {
      const d7 = await d7Retention(r.config);
      upsertRetention(userId, { id: seedId(userId, "ret", r.slug), name: r.name, description: r.description, config: r.config, source: "auto", d7Retention: d7, datasetId: HDFC_CREDITFRAUD_DATASET_ID });
      retentions++;
    } catch (err) { console.warn(`[hdfc-seed] retention ${r.slug} failed:`, err); }
  }
  return { segments, funnels, retentions };
}
