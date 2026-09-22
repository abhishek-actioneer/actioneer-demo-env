import { createHash } from "crypto";
import type { FunnelConfig } from "@/lib/funnel-types";
import type { RetentionConfig } from "@/lib/retention-types";
import { yesbankCardsDataset } from "@/lib/datasets/yesbank-cards";
import { executeSQLInternal } from "@/lib/sql-executor";
import { computeFunnelHeadlineConversion, computeD7Retention } from "@/lib/server/seed-metric-helpers";
import { upsertSegment } from "@/lib/server/segment-repo";
import { upsertFunnel } from "@/lib/server/funnel-repo";
import { upsertRetention } from "@/lib/server/retention-repo";

export const YESBANK_CARDS_DATASET_ID = "yesbank-cards";
const DATA_RANGE = { start: "2024-06-01", end: "2026-05-31" } as const;

function seedId(userId: string, kind: string, slug: string): string {
  const hash = createHash("sha256").update(userId).digest("hex").slice(0, 8);
  return `yesbank_${hash}_${kind}_${slug}`;
}

async function countSegment(sql: string): Promise<number> {
  const wrapped = `SELECT COUNT(*) AS n FROM (${sql}) AS s`;
  const result = await executeSQLInternal(wrapped, YESBANK_CARDS_DATASET_ID);
  if (result.error || result.rows.length === 0) return 0;
  return Number((result.rows[0] as Record<string, unknown>).n) || 0;
}

// ── SEGMENTS: customer_id is the entity ──
const SEGMENTS = [
  {
    slug: "cross-sell-whitespace",
    name: "Cross-sell Whitespace (Card-Only Customers)",
    description: "Cardholders with no other bank product (no savings/FD/loan/insurance). The highest-value targets for deepening the relationship.",
    sql: "SELECT c.customer_id FROM customers c WHERE NOT EXISTS (SELECT 1 FROM product_holdings ph WHERE ph.customer_id = c.customer_id)",
  },
  {
    slug: "upi-on-credit-spenders",
    name: "UPI-on-Credit Active Spenders",
    description: "Customers actively transacting on UPI-linked credit: the growth surface for RuPay-credit-on-UPI engagement.",
    sql: "SELECT DISTINCT c.customer_id FROM transactions t JOIN cards c ON t.card_id = c.card_id WHERE t.channel = 'UPI' AND t.response = 'APPROVED'",
  },
  {
    slug: "revolvers",
    name: "Revolvers (Interest-Earning Accounts)",
    description: "Customers carrying a revolving balance: a minority of accounts that drive the large majority of interest revenue.",
    sql: "SELECT DISTINCT c.customer_id FROM statements s JOIN cards c ON s.card_id = c.card_id WHERE s.revolve_flag = true",
  },
  {
    slug: "premium-tier",
    name: "Premium-Tier Cardholders",
    description: "Holders of premium products (YES PREMIA, YES ELITE, ELITE+, RESERV, MARQUEE): the high-spend, high-fee tail of the portfolio.",
    sql: "SELECT DISTINCT customer_id FROM cards WHERE product IN ('YES PREMIA','YES ELITE','ELITE+','RESERV','MARQUEE')",
  },
  {
    slug: "emi-converters",
    name: "EMI Converters (Big-Ticket Financers)",
    description: "Cardholders who have converted a purchase to EMI: high-intent financers and a core interest-revenue and cross-sell cohort.",
    sql: "SELECT DISTINCT c.customer_id FROM transactions t JOIN cards c ON t.card_id = c.card_id WHERE t.emi_converted_flag = true",
  },
  {
    slug: "high-cibil-upgrade-eligible",
    name: "High-CIBIL Cardholders (750+, Upgrade-Eligible)",
    description: "Prime-credit customers (CIBIL 750+): the strongest base for premium upgrades, limit increases, and EMI offers.",
    sql: "SELECT customer_id FROM customers WHERE cibil_band IN ('750-799','800+')",
  },
  {
    slug: "expiring-rewards-nudge",
    name: "Expiring-Rewards Nudge Cohort",
    description: "Customers with reward points expiring in the next 90 days: a natural redemption/engagement nudge trigger.",
    sql: "SELECT DISTINCT customer_id FROM rewards_summary WHERE points_expiring_90d > 0",
  },
];

// ── FUNNELS: customer_id-backed events (campaign_history, propensity_events) ──
const FUNNELS: Array<{ slug: string; name: string; description: string; config: FunnelConfig }> = [
  {
    slug: "campaign-funnel",
    name: "Campaign: Sent → Delivered → Clicked → Converted",
    description: "The full cross-sell/upgrade campaign funnel. Sent-to-delivered is near-total; the real leak is delivered-to-clicked, and click-to-convert is strong. Overall conversion lands in the realistic 1-3% range for cold credit-card campaigns.",
    config: {
      steps: [{ eventId: "campaign_sent" }, { eventId: "campaign_delivered" }, { eventId: "campaign_clicked" }, { eventId: "campaign_converted" }],
      conversionWindow: "30d",
      order: "this_order",
      dateRange: DATA_RANGE,
    },
  },
  {
    slug: "propensity-cross-sell",
    name: "Propensity Signal → Contacted → Converted",
    description: "Warm, signal-triggered cross-sell: of customers who fire a propensity signal, how many are contacted by a campaign and how many convert. Conversion is far higher than the cold blast — the case for trigger-based targeting.",
    config: {
      steps: [{ eventId: "propensity_signal" }, { eventId: "campaign_sent" }, { eventId: "campaign_converted" }],
      conversionWindow: "90d",
      order: "this_order",
      dateRange: DATA_RANGE,
    },
  },
  {
    slug: "campaign-engagement",
    name: "Campaign: Sent → Opened → Converted",
    description: "The engagement view of the campaign funnel: of customers contacted, how many open, and how many of those convert. Isolates the open-rate gate from the convert gate.",
    config: {
      steps: [{ eventId: "campaign_sent" }, { eventId: "campaign_opened" }, { eventId: "campaign_converted" }],
      conversionWindow: "30d",
      order: "this_order",
      dateRange: DATA_RANGE,
    },
  },
];

// ── RETENTIONS ──
const RETENTIONS: Array<{ slug: string; name: string; description: string; config: RetentionConfig }> = [
  {
    slug: "contacted-to-converted",
    name: "Contacted → Converted Over Time (Daily)",
    description: "Of customers who receive a campaign, what share convert in later months. The slow-burn conversion curve of the cross-sell program.",
    config: {
      startEventId: "campaign_sent",
      returnEventIds: ["campaign_converted"],
      mode: "on_or_after",
      granularity: "daily",
      dateRange: DATA_RANGE,
    },
  },
  {
    slug: "propensity-recurrence",
    name: "Propensity-Signal Recurrence (Daily)",
    description: "Of customers who fire a propensity signal, what share fire another later. Recurring signals mark the highest-intent, fastest-moving customers.",
    config: {
      startEventId: "propensity_signal",
      returnEventIds: ["propensity_signal"],
      mode: "on_or_after",
      granularity: "daily",
      dateRange: DATA_RANGE,
    },
  },
  {
    slug: "engaged-customer-stickiness",
    name: "Campaign-Open Recurrence (Daily)",
    description: "Of customers who open a campaign, what share keep opening in later months. The engaged-base stickiness curve — the warm audience the cross-sell program compounds on.",
    config: {
      startEventId: "campaign_opened",
      returnEventIds: ["campaign_opened"],
      mode: "on_or_after",
      granularity: "daily",
      dateRange: DATA_RANGE,
    },
  },
];

async function funnelConversion(config: FunnelConfig): Promise<number | null> {
  return computeFunnelHeadlineConversion(config, yesbankCardsDataset, YESBANK_CARDS_DATASET_ID);
}
async function d7Retention(config: RetentionConfig): Promise<number | null> {
  return computeD7Retention(config, yesbankCardsDataset, YESBANK_CARDS_DATASET_ID);
}

export async function seedYesbankCardsSampleWorkspace(userId: string): Promise<{
  segments: number; funnels: number; retentions: number;
}> {
  let segments = 0;
  for (const seg of SEGMENTS) {
    try {
      const userCount = await countSegment(seg.sql);
      upsertSegment(userId, { id: seedId(userId, "seg", seg.slug), name: seg.name, description: seg.description, sql: seg.sql, userCount, datasetId: YESBANK_CARDS_DATASET_ID });
      segments++;
    } catch (err) { console.warn(`[yesbank-seed] segment ${seg.slug} failed:`, err); }
  }
  let funnels = 0;
  for (const f of FUNNELS) {
    try {
      const overallConversion = await funnelConversion(f.config);
      upsertFunnel(userId, { id: seedId(userId, "fun", f.slug), name: f.name, description: f.description, config: f.config, source: "auto", overallConversion, datasetId: YESBANK_CARDS_DATASET_ID });
      funnels++;
    } catch (err) { console.warn(`[yesbank-seed] funnel ${f.slug} failed:`, err); }
  }
  let retentions = 0;
  for (const r of RETENTIONS) {
    try {
      const d7 = await d7Retention(r.config);
      upsertRetention(userId, { id: seedId(userId, "ret", r.slug), name: r.name, description: r.description, config: r.config, source: "auto", d7Retention: d7, datasetId: YESBANK_CARDS_DATASET_ID });
      retentions++;
    } catch (err) { console.warn(`[yesbank-seed] retention ${r.slug} failed:`, err); }
  }
  return { segments, funnels, retentions };
}
