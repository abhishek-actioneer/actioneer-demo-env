/**
 * verify-flipkart.ts — end-to-end verification for the flipkart-marketplace dataset.
 *
 * Phase 0: build the DuckDB (first query triggers viewSQL + summaryTableSQL) and
 *          introspect column types (confirms BOOLEAN parsing, materialization).
 * Phase A: run a deterministic battery of analytical SQL covering every table,
 *          join, boolean filter, and the exact shapes the agent hints / events use.
 *          No LLM — this is the structural "shouldn't break" guarantee.
 * Phase B: run N natural-language prompts through the REAL generateQueries ->
 *          executeSQL pipeline (quick mode). Surfaces missing/stale events and
 *          schema-context gaps. Metered on OPENAI_API_KEY; skipped if absent.
 *
 * Usage: npx tsx scripts/verify-flipkart.ts [--prompts=100] [--no-llm]
 * Requires (Phase B): OPENAI_API_KEY in .env.local
 */
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { executeSQL } from "../src/lib/sql-executor";
import { generateQueries } from "../src/lib/sql-generator";
import { getDataset } from "../src/lib/datasets";

const DATASET = "flipkart-marketplace";

function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    const [, key, raw] = m;
    if (process.env[key]) continue;
    process.env[key] = raw.replace(/^export\s+/, "").replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  }
}
loadEnvFile(resolve(".env"));
loadEnvFile(resolve(".env.local"));

const argPrompts = Number((process.argv.find((a) => a.startsWith("--prompts=")) || "").split("=")[1]) || 100;
const noLLM = process.argv.includes("--no-llm");

interface Fail { phase: string; label: string; detail: string; sql?: string }
const fails: Fail[] = [];
const warns: Fail[] = [];

// ── Phase A: deterministic analytical battery ─────────────────────────────────
// Mirrors the SQL shapes in each agent's hints and each event definition.
const BATTERY: { label: string; sql: string; expectRows?: boolean }[] = [
  // table reachability + row counts
  { label: "customers count", sql: "SELECT COUNT(*) n FROM customers" },
  { label: "sellers count", sql: "SELECT COUNT(*) n FROM sellers" },
  { label: "products count", sql: "SELECT COUNT(*) n FROM products" },
  { label: "orders count", sql: "SELECT COUNT(*) n FROM orders" },
  { label: "order_items count", sql: "SELECT COUNT(*) n FROM order_items" },
  { label: "payments count", sql: "SELECT COUNT(*) n FROM payments" },
  { label: "returns count", sql: "SELECT COUNT(*) n FROM returns" },
  { label: "reviews count", sql: "SELECT COUNT(*) n FROM reviews" },
  { label: "ad_campaigns count", sql: "SELECT COUNT(*) n FROM ad_campaigns" },
  { label: "sessions count", sql: "SELECT COUNT(*) n FROM sessions" },
  { label: "calendar_events count", sql: "SELECT COUNT(*) n FROM calendar_events" },
  // boolean filters (the key parsing risk)
  { label: "bool: plus members", sql: "SELECT COUNT(*) n FROM customers WHERE plus_member_flag = TRUE" },
  { label: "bool: sla met delivered", sql: "SELECT COUNT(*) n FROM orders WHERE sla_met_flag = TRUE AND order_status='Delivered'" },
  { label: "bool: first orders", sql: "SELECT COUNT(*) n FROM orders WHERE is_first_order_flag = TRUE" },
  { label: "bool: assured sellers", sql: "SELECT COUNT(*) n FROM sellers WHERE assured_flag = TRUE" },
  { label: "bool: session add_to_cart", sql: "SELECT COUNT(*) n FROM sessions WHERE added_to_cart_flag = TRUE" },
  { label: "bool: session placed_order", sql: "SELECT COUNT(*) n FROM sessions WHERE placed_order_flag = TRUE" },
  // daily-metrics
  { label: "monthly GMV trend", sql: "SELECT strftime(order_ts,'%Y-%m') m, SUM(gmv_inr) gmv, COUNT(*) orders, AVG(gmv_inr) aov FROM orders GROUP BY 1 ORDER BY 1" },
  { label: "BBD festival window", sql: "SELECT strftime(order_ts,'%Y-%m') m, SUM(gmv_inr) gmv FROM orders WHERE order_ts BETWEEN '2024-09-26' AND '2024-10-13' GROUP BY 1" },
  { label: "funnel stages", sql: "SELECT COUNT(*) sessions, COUNT(*) FILTER(WHERE added_to_cart_flag) cart, COUNT(*) FILTER(WHERE started_checkout_flag) checkout, COUNT(*) FILTER(WHERE placed_order_flag) orders FROM sessions" },
  // data-quality
  { label: "order status mix", sql: "SELECT order_status, COUNT(*) n FROM orders GROUP BY 1" },
  { label: "payment success rate", sql: "SELECT payment_status, COUNT(*) n FROM payments GROUP BY 1" },
  { label: "return rate by category", sql: "SELECT category, COUNT(*) FILTER(WHERE item_status='Returned') ret, COUNT(*) FILTER(WHERE item_status IN ('Delivered','Returned')) deliv FROM order_items GROUP BY 1 ORDER BY 2 DESC" },
  { label: "refund leakage", sql: "SELECT category, SUM(refund_inr) refunds, COUNT(*) n FROM returns GROUP BY 1 ORDER BY 2 DESC" },
  { label: "seller fulfilment health", sql: "SELECT s.fulfilment_model, s.seller_tier, COUNT(DISTINCT oi.order_id) orders, SUM(oi.line_gmv_inr) gmv FROM order_items oi JOIN sellers s ON oi.seller_id=s.seller_id GROUP BY 1,2 ORDER BY 4 DESC" },
  // cohort-retention
  { label: "new vs repeat", sql: "SELECT is_first_order_flag, COUNT(*) n, SUM(gmv_inr) gmv FROM orders GROUP BY 1" },
  { label: "repeat purchase rate", sql: "WITH c AS (SELECT customer_id, COUNT(*) o FROM orders GROUP BY 1) SELECT AVG((o>1)::INT) repeat_rate, COUNT(*) buyers FROM c" },
  { label: "signup cohort retention", sql: "SELECT strftime(c.signup_date,'%Y-%m') cohort, date_diff('month', c.signup_date, o.order_ts) months_since, COUNT(*) orders FROM orders o JOIN customers c ON o.customer_id=c.customer_id GROUP BY 1,2 ORDER BY 1,2 LIMIT 200" },
  { label: "time to second order", sql: "WITH r AS (SELECT customer_id, order_ts, ROW_NUMBER() OVER(PARTITION BY customer_id ORDER BY order_ts) rn FROM orders) SELECT AVG(date_diff('day', a.order_ts, b.order_ts)) avg_days FROM r a JOIN r b ON a.customer_id=b.customer_id AND a.rn=1 AND b.rn=2" },
  // rev-opt
  { label: "GMV + take-rate by category", sql: "SELECT category, SUM(line_gmv_inr) gmv, SUM(commission_inr) commission, SUM(commission_inr)/NULLIF(SUM(line_gmv_inr),0) take_rate FROM order_items GROUP BY 1 ORDER BY 2 DESC" },
  { label: "coupon impact", sql: "SELECT coupon_code IS NOT NULL coupon_used, AVG(gmv_inr) aov, AVG(discount_inr) disc FROM orders GROUP BY 1" },
  { label: "ads ROAS by type", sql: "SELECT a.campaign_type, s.seller_tier, SUM(a.spend_inr) spend, SUM(a.attributed_gmv_inr) att_gmv, AVG(a.roas) roas FROM ad_campaigns a JOIN sellers s ON a.seller_id=s.seller_id GROUP BY 1,2 ORDER BY 3 DESC" },
  // user-segmentation
  { label: "segment breakdown", sql: "SELECT segment, COUNT(*) buyers, AVG(lifetime_orders) avg_orders, SUM(lifetime_gmv_inr) gmv FROM customers GROUP BY 1 ORDER BY 4 DESC" },
  { label: "plus vs non-plus", sql: "SELECT c.plus_member_flag, COUNT(DISTINCT o.order_id) orders, AVG(o.gmv_inr) aov FROM orders o JOIN customers c ON o.customer_id=c.customer_id GROUP BY 1" },
  { label: "acquisition channel value", sql: "SELECT c.acquisition_channel, COUNT(DISTINCT c.customer_id) buyers, COUNT(o.order_id) orders, SUM(o.gmv_inr) gmv FROM customers c LEFT JOIN orders o ON o.customer_id=c.customer_id GROUP BY 1 ORDER BY 4 DESC" },
  // geographic
  { label: "GMV by city tier", sql: "SELECT c.city_tier, SUM(o.gmv_inr) gmv, COUNT(*) orders FROM orders o JOIN customers c ON o.customer_id=c.customer_id GROUP BY 1 ORDER BY 1" },
  { label: "top cities", sql: "SELECT city, SUM(gmv_inr) gmv, COUNT(*) orders FROM orders GROUP BY 1 ORDER BY 2 DESC LIMIT 10" },
  { label: "SLA by state", sql: "SELECT state, AVG(sla_met_flag::INT) sla, COUNT(*) n FROM orders WHERE order_status='Delivered' GROUP BY 1 ORDER BY 3 DESC LIMIT 15" },
  { label: "seller GMV by state/tier", sql: "SELECT s.state, s.seller_tier, COUNT(DISTINCT s.seller_id) sellers, SUM(oi.line_gmv_inr) gmv FROM sellers s LEFT JOIN order_items oi ON oi.seller_id=s.seller_id GROUP BY 1,2 ORDER BY 4 DESC LIMIT 20" },
  // event-derived shapes (each event in the config)
  { label: "event order_delivered", sql: "SELECT COUNT(*) n, SUM(gmv_inr) v FROM orders WHERE order_status='Delivered'" },
  { label: "event order_cancelled", sql: "SELECT COUNT(*) n FROM orders WHERE order_status='Cancelled'" },
  { label: "event payment", sql: "SELECT COUNT(*) n, SUM(amount_inr) v FROM payments WHERE payment_status IN ('Success','Collected')" },
  { label: "event return_requested", sql: "SELECT COUNT(*) n, SUM(refund_inr) v FROM returns" },
  { label: "event product_review", sql: "SELECT AVG(rating) r, COUNT(*) n FROM reviews WHERE verified_purchase_flag = TRUE" },
  { label: "event item_purchased", sql: "SELECT category, COUNT(*) n, SUM(line_gmv_inr) v FROM order_items GROUP BY 1" },
  // cross-table joins integrity
  { label: "join items->products->sellers", sql: "SELECT s.seller_tier, p.category, SUM(oi.line_gmv_inr) gmv FROM order_items oi JOIN products p ON oi.product_id=p.product_id JOIN sellers s ON p.seller_id=s.seller_id GROUP BY 1,2 ORDER BY 3 DESC LIMIT 20" },
  { label: "reviews join products", sql: "SELECT p.brand, AVG(r.rating) rating, COUNT(*) n FROM reviews r JOIN products p ON r.product_id=p.product_id GROUP BY 1 ORDER BY 3 DESC LIMIT 15" },
  { label: "sessions->orders converted", sql: "SELECT COUNT(*) n FROM sessions s JOIN orders o ON s.order_id=o.order_id WHERE s.placed_order_flag=TRUE" },
];

// ── Phase B: natural-language prompts (buyer + seller + ops) ───────────────────
const PROMPTS: string[] = [
  // GMV / trend
  "What is our total GMV and how has it trended month over month?",
  "What is the average order value, and how has it changed over time?",
  "How much did the Big Billion Days sale lift orders and GMV versus a normal month?",
  "Which months had the highest GMV and why?",
  "What is our monthly order volume trend?",
  "How does GMV split between festival months and non-festival months?",
  "What share of annual GMV comes from the October festive period?",
  // funnel
  "What is our browse-to-order conversion rate?",
  "Where do buyers drop off in the funnel from session to order?",
  "What is the cart abandonment rate?",
  "How does conversion differ by channel (app vs web)?",
  "What percentage of sessions that add to cart actually place an order?",
  "Which device has the best checkout conversion?",
  // retention / cohort
  "What share of buyers place a second order?",
  "How long does it take a new buyer to place their second order?",
  "What is our repeat purchase rate?",
  "Show signup-cohort retention over the first few months.",
  "What fraction of orders come from repeat buyers versus first-time buyers?",
  "Which signup cohort has the best retention?",
  "How many one-time buyers do we have versus repeat buyers?",
  // segmentation
  "Break down buyers by segment and show GMV share for each.",
  "How do Plus members compare to non-members on order frequency and AOV?",
  "Which acquisition channel brings the highest-value buyers?",
  "What is the lifetime GMV distribution across customer segments?",
  "How many VIP buyers do we have and what's their share of GMV?",
  "Which acquisition channel has the best repeat rate?",
  "What is the average number of orders per buyer by segment?",
  // category / revenue
  "Which categories drive the most GMV?",
  "What is our commission revenue by category?",
  "What is the effective take-rate by category?",
  "Which categories have the highest discount as a percentage of GMV?",
  "What is the impact of coupons on average order value?",
  "Which product brands sell the most?",
  "What are the top 10 products by GMV?",
  "How much marketplace commission did we earn in total?",
  "Which category has the best margin after discounts?",
  // returns
  "What is our overall return rate?",
  "Which categories have the worst return rates?",
  "What are the top reasons for returns?",
  "How much refund value are we leaking to returns?",
  "What share of returns are replacements versus refunds?",
  "How long does it take to resolve a return on average?",
  "Which sellers have the highest return rates?",
  "Are fashion returns higher than electronics returns?",
  // seller / marketplace ops
  "How does GMV split across seller tiers?",
  "Which fulfilment model has the best on-time delivery rate?",
  "What is the on-time delivery rate by seller tier?",
  "How many active sellers do we have versus churned?",
  "Which sellers contribute the most GMV?",
  "Do Flipkart Assured sellers have lower return rates?",
  "What is the average seller rating by tier?",
  "How concentrated is GMV among our top sellers?",
  "Which seller tier has the best ratings and lowest returns?",
  // delivery / SLA
  "What is our overall on-time delivery rate?",
  "Which cities have the worst delivery SLA?",
  "How does delivery performance vary by region?",
  "What is the average delivery time versus promised?",
  // payments
  "What is the payment method mix across orders?",
  "What share of orders are Cash on Delivery?",
  "What is the payment success rate?",
  "How popular is UPI compared to cards?",
  "What percentage of orders use EMI?",
  // geography
  "Which cities generate the most GMV?",
  "How does GMV split across metro versus tier-2 and tier-3 cities?",
  "Where are most of our sellers located?",
  "Which states have the highest order volume?",
  "What is the average order value by city tier?",
  // ads
  "What is our total ad spend and attributed GMV?",
  "What is the ROAS by campaign type?",
  "Which seller tiers get the best return on ad spend?",
  "How efficient are Product Listing Ads versus Search Ads?",
  "What is the average cost per click across campaigns?",
  // mixed / deeper
  "Which categories are growing fastest month over month?",
  "What is the relationship between discount depth and return rate?",
  "Do Plus members return items less often than non-members?",
  "What share of GMV comes from new buyers acquired this year?",
  "Which payment method has the highest order value?",
  "How does AOV differ between app and web channels?",
  "What is the first-order GMV versus repeat-order GMV?",
  "Which category has the most sellers competing in it?",
  "What is the average basket size (items per order)?",
  "How does the return rate trend over time?",
  "Which brands have the highest review ratings?",
  "What share of delivered items get reviewed?",
  "Are higher-rated products returned less often?",
  "Which acquisition channel scales GMV best during festivals?",
  "What is the cancellation rate by payment method?",
  "How much GMV is locked in orders that are still in transit?",
  "What is the average commission rate weighted by GMV?",
  "Which cities have the highest Plus membership penetration?",
  "What share of orders use a coupon, and what's the average discount?",
  "How does seller GMV concentration look (top 10% of sellers)?",
  "What is the monthly active buyer count trend?",
  "Which categories see the biggest festival demand spike?",
  "What is the refund rate as a percentage of GMV?",
  "How does on-time delivery affect review ratings?",
  "What is the GMV contribution of Flipkart Assured products?",
  "Which seller tier grew fastest over the window?",
  "What is the average time from order to delivery by city tier?",
  "How many buyers were acquired each month?",
];

async function runOne(sql: string, label: string, phase: string): Promise<void> {
  try {
    const res = await executeSQL(sql, DATASET);
    if (res.error) {
      fails.push({ phase, label, detail: res.error, sql });
    } else if (res.rowCount === 0) {
      warns.push({ phase, label, detail: "0 rows", sql });
    }
  } catch (e) {
    fails.push({ phase, label, detail: String(e), sql });
  }
}

async function main() {
  const ds = getDataset(DATASET);
  console.log(`\n=== Verifying ${ds.label} (${DATASET}) ===`);
  console.log(`DB: ${ds.dbFile}\n`);

  // Phase 0: build + introspect types (forces viewSQL + summaryTableSQL)
  console.log("── Phase 0: build DuckDB + introspect column types ──");
  const t0 = Date.now();
  const probe = await executeSQL("SELECT COUNT(*) n FROM orders", DATASET);
  if (probe.error) {
    console.error("FATAL: could not build/query orders:", probe.error);
    process.exit(1);
  }
  console.log(`  build + first query: ${((Date.now() - t0) / 1000).toFixed(1)}s, orders=${probe.rows[0].n}`);
  const types = await executeSQL(
    "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_name IN ('orders','sessions','customers','sellers') AND column_name IN ('plus_member_flag','sla_met_flag','is_first_order_flag','assured_flag','added_to_cart_flag','placed_order_flag') ORDER BY 1,2",
    DATASET,
  );
  if (!types.error) {
    const nonBool = types.rows.filter((r) => String(r.data_type).toUpperCase() !== "BOOLEAN");
    for (const r of types.rows) console.log(`  ${r.table_name}.${r.column_name}: ${r.data_type}`);
    if (nonBool.length) {
      console.log(`  ⚠ ${nonBool.length} boolean column(s) NOT parsed as BOOLEAN — '= TRUE' filters will fail!`);
      nonBool.forEach((r) => fails.push({ phase: "0", label: `bool-type ${r.table_name}.${r.column_name}`, detail: `parsed as ${r.data_type}` }));
    } else {
      console.log("  ✓ all probed boolean columns parsed as BOOLEAN");
    }
  }

  // Phase A: deterministic battery
  console.log(`\n── Phase A: ${BATTERY.length} deterministic analytical queries ──`);
  const aStart = Date.now();
  for (const q of BATTERY) await runOne(q.sql, q.label, "A");
  const aFails = fails.filter((f) => f.phase === "A").length;
  const aWarns = warns.filter((f) => f.phase === "A").length;
  console.log(`  ${BATTERY.length - aFails}/${BATTERY.length} passed, ${aWarns} empty, ${aFails} failed (${((Date.now() - aStart) / 1000).toFixed(1)}s)`);

  // Phase B: LLM prompts
  const hasKey = !!process.env.OPENAI_API_KEY;
  if (noLLM || !hasKey) {
    console.log(`\n── Phase B: SKIPPED (${noLLM ? "--no-llm" : "no OPENAI_API_KEY in env"}) ──`);
  } else {
    const list = PROMPTS.slice(0, argPrompts);
    console.log(`\n── Phase B: ${list.length} NL prompts through generateQueries → executeSQL (quick) ──`);
    const bStart = Date.now();
    let i = 0;
    for (const prompt of list) {
      i++;
      try {
        const queries = await generateQueries(prompt, "quick", DATASET);
        if (!queries.length) {
          warns.push({ phase: "B", label: prompt, detail: "no SQL generated" });
          continue;
        }
        for (const q of queries) {
          const res = await executeSQL(q.sql, DATASET);
          if (res.error) fails.push({ phase: "B", label: prompt, detail: res.error, sql: q.sql });
          else if (res.rowCount === 0) warns.push({ phase: "B", label: prompt, detail: "0 rows", sql: q.sql });
        }
      } catch (e) {
        fails.push({ phase: "B", label: prompt, detail: String(e) });
      }
      if (i % 10 === 0) process.stdout.write(`  ...${i}/${list.length}\n`);
    }
    const bFails = fails.filter((f) => f.phase === "B").length;
    const bWarns = warns.filter((f) => f.phase === "B").length;
    console.log(`  ${list.length} prompts run: ${bFails} produced failing SQL, ${bWarns} returned 0 rows (${((Date.now() - bStart) / 1000).toFixed(1)}s)`);
  }

  // Report
  console.log("\n══════════════ REPORT ══════════════");
  console.log(`FAILURES: ${fails.length}`);
  for (const f of fails) {
    console.log(`\n[FAIL ${f.phase}] ${f.label}\n  ${f.detail}`);
    if (f.sql) console.log(`  SQL: ${f.sql.slice(0, 240)}`);
  }
  console.log(`\nWARNINGS (0-row results — may indicate missing/stale events): ${warns.length}`);
  for (const w of warns) {
    console.log(`[warn ${w.phase}] ${w.label} — ${w.detail}`);
    if (w.sql) console.log(`    SQL: ${w.sql.slice(0, 200)}`);
  }
  console.log(`\n${fails.length === 0 ? "✓ ALL CHECKS PASSED" : `✗ ${fails.length} FAILURES`}`);
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
