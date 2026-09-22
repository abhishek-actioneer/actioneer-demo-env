import { createHash } from "crypto";
import type { FunnelConfig } from "@/lib/funnel-types";
import type { RetentionConfig } from "@/lib/retention-types";
import { flipkartMarketplaceDataset } from "@/lib/datasets/flipkart-marketplace";
import { executeSQLInternal } from "@/lib/sql-executor";
import { computeFunnelHeadlineConversion, computeD7Retention } from "@/lib/server/seed-metric-helpers";
import { upsertSegment } from "@/lib/server/segment-repo";
import { upsertFunnel } from "@/lib/server/funnel-repo";
import { upsertRetention } from "@/lib/server/retention-repo";

export const FLIPKART_MARKETPLACE_DATASET_ID = "flipkart-marketplace";
const DATA_RANGE = { start: "2024-06-01", end: "2026-05-31" } as const;

function seedId(userId: string, kind: string, slug: string): string {
  const hash = createHash("sha256").update(userId).digest("hex").slice(0, 8);
  return `flipkart_${hash}_${kind}_${slug}`;
}

async function countSegment(sql: string): Promise<number> {
  const wrapped = `SELECT COUNT(*) AS n FROM (${sql}) AS s`;
  const result = await executeSQLInternal(wrapped, FLIPKART_MARKETPLACE_DATASET_ID);
  if (result.error || result.rows.length === 0) return 0;
  return Number((result.rows[0] as Record<string, unknown>).n) || 0;
}

// ── SEGMENTS: customer_id is the buyer entity ──
const SEGMENTS = [
  {
    slug: "vip-core-buyers",
    name: "VIP & Core Buyers",
    description: "The high-value buyer cohort (segment VIP or Core). A small share of buyers that drives a disproportionate share of GMV.",
    sql: "SELECT customer_id, full_name, segment, lifetime_orders, lifetime_gmv_inr FROM customers WHERE segment IN ('VIP','Core') ORDER BY lifetime_gmv_inr DESC",
  },
  {
    slug: "plus-members",
    name: "Flipkart Plus Members",
    description: "Loyalty-program (Plus) members: higher order frequency and basket size than non-members.",
    sql: "SELECT customer_id, full_name, city_tier, lifetime_orders, lifetime_gmv_inr FROM customers WHERE plus_member_flag = TRUE ORDER BY lifetime_gmv_inr DESC",
  },
  {
    slug: "repeat-buyers",
    name: "Repeat Buyers (2+ Orders)",
    description: "Buyers who have placed two or more non-cancelled orders: the retained core of the marketplace.",
    sql: "SELECT customer_id, COUNT(*) AS order_count, SUM(gmv_inr) AS total_gmv FROM orders WHERE order_status <> 'Cancelled' GROUP BY customer_id HAVING COUNT(*) >= 2 ORDER BY order_count DESC",
  },
  {
    slug: "tier-3-4-bharat",
    name: "Tier-3/4 'Bharat' Buyers",
    description: "Buyers in tier-3 and tier-4 towns: the high-growth 'Bharat' cohort with distinct category, payment, and return behavior.",
    sql: "SELECT customer_id, full_name, city, city_tier, acquisition_channel, lifetime_gmv_inr FROM customers WHERE city_tier IN (3,4) ORDER BY lifetime_gmv_inr DESC",
  },
  {
    slug: "cart-abandoners",
    name: "Cart Abandoners (Intent, No Purchase)",
    description: "Buyers who added to cart but never placed any order: high-intent re-marketing targets.",
    sql: "SELECT DISTINCT customer_id FROM sessions WHERE added_to_cart_flag = TRUE AND placed_order_flag = FALSE AND customer_id NOT IN (SELECT customer_id FROM sessions WHERE placed_order_flag = TRUE)",
  },
  {
    slug: "serial-returners",
    name: "Serial Returners (Return-Rate Risk)",
    description: "Buyers with three or more returns: the heavy-return tail that erodes contribution margin and seller ratings.",
    sql: "SELECT customer_id, COUNT(*) AS return_count, SUM(refund_inr) AS total_refunded FROM returns GROUP BY customer_id HAVING COUNT(*) >= 3 ORDER BY return_count DESC",
  },
];

// ── FUNNELS: customer_id-backed events (sessions, orders, payments) ──
const FUNNELS: Array<{ slug: string; name: string; description: string; config: FunnelConfig }> = [
  {
    slug: "browse-to-order",
    name: "Session → Cart → Checkout → Order",
    description: "The full browse-to-buy funnel. The largest drop is view-to-cart; cart-to-checkout and checkout-to-order are progressively tighter. Overall session-to-order lands around the realistic mid-single-digit range for product-intent sessions.",
    config: {
      steps: [{ eventId: "session_start" }, { eventId: "add_to_cart" }, { eventId: "checkout_started" }, { eventId: "order_placed" }],
      conversionWindow: "1d",
      order: "any_order",
      dateRange: DATA_RANGE,
    },
  },
  {
    slug: "checkout-completion",
    name: "Checkout Started → Order Placed",
    description: "The checkout-completion funnel: of sessions that start checkout, how many complete an order. The drop is cart/checkout abandonment — believable for India where COD and UPI fallbacks recover most carts.",
    config: {
      steps: [{ eventId: "checkout_started" }, { eventId: "order_placed" }],
      conversionWindow: "1d",
      order: "any_order",
      dateRange: DATA_RANGE,
    },
  },
  {
    slug: "order-fulfilment",
    name: "Order → Payment → Delivered",
    description: "The fulfilment funnel: of orders placed, how many are paid and how many are delivered. The small leaks are payment failures and cancellations/in-transit, so placed-to-delivered stays high.",
    config: {
      steps: [{ eventId: "order_placed" }, { eventId: "payment" }, { eventId: "order_delivered" }],
      conversionWindow: "30d",
      order: "any_order",
      dateRange: DATA_RANGE,
    },
  },
];

// ── RETENTIONS ──
const RETENTIONS: Array<{ slug: string; name: string; description: string; config: RetentionConfig }> = [
  {
    slug: "buyer-repeat-purchase",
    name: "Buyer Repeat-Purchase Retention (Daily)",
    description: "Of buyers who place a first order, what share order again in later months. The repeat-purchase curve decays over time — the core marketplace retention signal.",
    config: {
      startEventId: "order_placed",
      returnEventIds: ["order_placed"],
      mode: "on_or_after",
      granularity: "daily",
      dateRange: DATA_RANGE,
    },
  },
  {
    slug: "browse-back-session",
    name: "Browse-Back Session Retention (Daily)",
    description: "Of buyers who have a browsing session, what share come back to browse in later weeks. Session re-engagement is healthy for an intent-driven marketplace.",
    config: {
      startEventId: "session_start",
      returnEventIds: ["session_start"],
      mode: "on_or_after",
      granularity: "daily",
      dateRange: DATA_RANGE,
    },
  },
  {
    slug: "post-order-browse-back",
    name: "Post-Order Browse-Back Retention (Daily)",
    description: "Of buyers who place an order, what share return to browse the marketplace in later months. Post-purchase re-engagement is the leading indicator of the next order.",
    config: {
      startEventId: "order_placed",
      returnEventIds: ["session_start"],
      mode: "on_or_after",
      granularity: "daily",
      dateRange: DATA_RANGE,
    },
  },
];

async function funnelConversion(config: FunnelConfig): Promise<number | null> {
  return computeFunnelHeadlineConversion(config, flipkartMarketplaceDataset, FLIPKART_MARKETPLACE_DATASET_ID);
}
async function d7Retention(config: RetentionConfig): Promise<number | null> {
  return computeD7Retention(config, flipkartMarketplaceDataset, FLIPKART_MARKETPLACE_DATASET_ID);
}

export async function seedFlipkartMarketplaceSampleWorkspace(userId: string): Promise<{
  segments: number; funnels: number; retentions: number;
}> {
  let segments = 0;
  for (const seg of SEGMENTS) {
    try {
      const userCount = await countSegment(seg.sql);
      upsertSegment(userId, { id: seedId(userId, "seg", seg.slug), name: seg.name, description: seg.description, sql: seg.sql, userCount, datasetId: FLIPKART_MARKETPLACE_DATASET_ID });
      segments++;
    } catch (err) { console.warn(`[flipkart-seed] segment ${seg.slug} failed:`, err); }
  }
  let funnels = 0;
  for (const f of FUNNELS) {
    try {
      const overallConversion = await funnelConversion(f.config);
      upsertFunnel(userId, { id: seedId(userId, "fun", f.slug), name: f.name, description: f.description, config: f.config, source: "auto", overallConversion, datasetId: FLIPKART_MARKETPLACE_DATASET_ID });
      funnels++;
    } catch (err) { console.warn(`[flipkart-seed] funnel ${f.slug} failed:`, err); }
  }
  let retentions = 0;
  for (const r of RETENTIONS) {
    try {
      const d7 = await d7Retention(r.config);
      upsertRetention(userId, { id: seedId(userId, "ret", r.slug), name: r.name, description: r.description, config: r.config, source: "auto", d7Retention: d7, datasetId: FLIPKART_MARKETPLACE_DATASET_ID });
      retentions++;
    } catch (err) { console.warn(`[flipkart-seed] retention ${r.slug} failed:`, err); }
  }
  return { segments, funnels, retentions };
}
