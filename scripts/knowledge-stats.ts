/**
 * One-off: pull headline stats for the datasets that lack a curated
 * knowledge.json, so the curated entries cite REAL numbers (not guesses).
 *   npx tsx scripts/knowledge-stats.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { executeSQLInternal } from "../src/lib/sql-executor";

function loadEnv(file: string) {
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim().replace(/^export\s+/, "");
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv(resolve(".env"));
loadEnv(resolve(".env.local"));

const QUERIES: Record<string, { label: string; sql: string }[]> = {
  "hdfc-creditfraud": [
    { label: "scale", sql: "SELECT COUNT(*) txns, COUNT(DISTINCT customer_id) customers, COUNT(DISTINCT card_id) cards, MIN(txn_ts) min_ts, MAX(txn_ts) max_ts FROM transactions" },
    { label: "fraud_rate", sql: "SELECT SUM(CASE WHEN is_fraud_flag THEN 1 ELSE 0 END) fraud_txns, COUNT(*) total, ROUND(100.0*SUM(CASE WHEN is_fraud_flag THEN 1 ELSE 0 END)/COUNT(*),3) fraud_pct FROM transactions" },
    { label: "episodes", sql: "SELECT COUNT(*) episodes, SUM(amount_attempted_inr) attempted, SUM(amount_prevented_inr) prevented, SUM(amount_lost_inr) lost FROM fraud_episodes" },
    { label: "typology", sql: "SELECT typology, COUNT(*) n FROM fraud_episodes GROUP BY 1 ORDER BY 2 DESC" },
    { label: "alerts_disposition", sql: "SELECT disposition, COUNT(*) n FROM fraud_alerts GROUP BY 1 ORDER BY 2 DESC" },
    { label: "alerts_total", sql: "SELECT COUNT(*) alerts, ROUND(AVG(handle_time_s),0) avg_handle_s, SUM(CASE WHEN sla_breached_flag THEN 1 ELSE 0 END) sla_breaches FROM fraud_alerts" },
    { label: "liability", sql: "SELECT liability_outcome, COUNT(*) n FROM case_resolutions GROUP BY 1 ORDER BY 2 DESC" },
  ],
  "yesbank-cards": [
    { label: "scale", sql: "SELECT COUNT(*) txns, COUNT(DISTINCT card_id) cards, MIN(txn_ts) min_ts, MAX(txn_ts) max_ts FROM transactions" },
    { label: "people", sql: "SELECT (SELECT COUNT(*) FROM customers) customers, (SELECT COUNT(*) FROM cards) cards FROM (SELECT 1)" },
    { label: "campaign_outcome", sql: "SELECT outcome, COUNT(*) n FROM campaign_history GROUP BY 1 ORDER BY 2 DESC" },
    { label: "campaign_conv", sql: "SELECT COUNT(*) contacts, SUM(CASE WHEN outcome='CONVERTED' THEN 1 ELSE 0 END) converted, ROUND(100.0*SUM(CASE WHEN outcome='CONVERTED' THEN 1 ELSE 0 END)/COUNT(*),1) conv_pct FROM campaign_history" },
    { label: "product_mix", sql: "SELECT product, COUNT(*) n FROM cards GROUP BY 1 ORDER BY 2 DESC LIMIT 12" },
    { label: "card_status", sql: "SELECT status, COUNT(*) n FROM cards GROUP BY 1 ORDER BY 2 DESC" },
    { label: "statements", sql: "SELECT ROUND(100.0*SUM(CASE WHEN revolve_flag THEN 1 ELSE 0 END)/COUNT(*),1) revolve_pct, ROUND(AVG(utilization_pct),1) avg_util, SUM(interest_charged_inr) interest, SUM(fees_inr) fees FROM statements" },
    { label: "forex", sql: "SELECT SUM(forex_markup_paid_inr) forex_markup, SUM(CASE WHEN is_intl_flag THEN 1 ELSE 0 END) intl_txns FROM transactions" },
  ],
  "flipkart-marketplace": [
    { label: "scale", sql: "SELECT COUNT(*) orders, COUNT(DISTINCT customer_id) buyers, MIN(order_ts) min_ts, MAX(order_ts) max_ts FROM orders" },
    { label: "sellers_products", sql: "SELECT (SELECT COUNT(*) FROM sellers) sellers, (SELECT COUNT(*) FROM products) products" },
    { label: "gmv", sql: "SELECT SUM(gmv_inr) gmv, ROUND(AVG(gmv_inr),0) aov, SUM(discount_inr) discount FROM orders WHERE order_status<>'Cancelled'" },
    { label: "commission", sql: "SELECT SUM(commission_inr) commission, SUM(line_gmv_inr) line_gmv, ROUND(100.0*SUM(commission_inr)/NULLIF(SUM(line_gmv_inr),0),2) take_rate_pct FROM order_items WHERE item_status<>'Cancelled'" },
    { label: "order_status", sql: "SELECT order_status, COUNT(*) n FROM orders GROUP BY 1 ORDER BY 2 DESC" },
    { label: "sla", sql: "SELECT ROUND(100.0*SUM(CASE WHEN sla_met_flag THEN 1 ELSE 0 END)/COUNT(*),1) sla_met_pct FROM orders WHERE order_status='Delivered'" },
    { label: "session_funnel", sql: "SELECT COUNT(*) sessions, ROUND(100.0*SUM(CASE WHEN viewed_product_flag THEN 1 ELSE 0 END)/COUNT(*),1) viewed_pct, ROUND(100.0*SUM(CASE WHEN added_to_cart_flag THEN 1 ELSE 0 END)/COUNT(*),1) cart_pct, ROUND(100.0*SUM(CASE WHEN started_checkout_flag THEN 1 ELSE 0 END)/COUNT(*),1) checkout_pct, ROUND(100.0*SUM(CASE WHEN placed_order_flag THEN 1 ELSE 0 END)/COUNT(*),2) order_pct FROM sessions" },
    { label: "returns", sql: "SELECT ROUND(100.0*COUNT(*) FILTER (WHERE r.return_id IS NOT NULL)/NULLIF(COUNT(*),0),2) return_pct FROM order_items oi LEFT JOIN returns r ON r.order_item_id=oi.order_item_id WHERE oi.item_status IN ('Delivered','Returned')" },
    { label: "repeat", sql: "SELECT ROUND(100.0*SUM(CASE WHEN lifetime_orders>1 THEN 1 ELSE 0 END)/COUNT(*),1) repeat_buyer_pct FROM customers" },
  ],
};

async function main() {
  for (const [datasetId, queries] of Object.entries(QUERIES)) {
    console.log(`\n========== ${datasetId} ==========`);
    for (const q of queries) {
      try {
        const res = await executeSQLInternal(q.sql, datasetId);
        if (res.error) { console.log(`[${q.label}] ERROR: ${res.error}`); continue; }
        console.log(`[${q.label}]`);
        console.log(JSON.stringify(res.rows.slice(0, 15)));
      } catch (e) {
        console.log(`[${q.label}] THREW: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
