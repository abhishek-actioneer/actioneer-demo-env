/**
 * audit-marketplace.ts — data-integrity + ground-truth correctness audit for a
 * marketplace dataset and the text-to-SQL "chat with your data" tool over it.
 *
 *   Phase 0  Recon: print real schema (tables, columns, types) + enum values + counts.
 *   Phase 1  Data cohesion: ~25 direct-SQL integrity checks (referential, arithmetic,
 *            validity/range, consistency/uniqueness, distribution). → Integrity Report.
 *   Phase 2  Answerability & correctness: ~45 NL questions; ground truth computed here
 *            via direct SQL, then the SAME question run through the real tool
 *            (generateQueries → executeSQL). Verdicts: OK_CORRECT / OK_WRONG / ERROR /
 *            EMPTY_OK / EMPTY_WRONG. → Answerability Scorecard + per-question table.
 *
 * Read-only. Never modifies the dataset. Re-run with:
 *   npx tsx scripts/audit-marketplace.ts <datasetId> [--no-llm]
 *
 * Requires OPENAI_API_KEY in .env.local for Phase 2.
 */
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { executeSQL } from "../src/lib/sql-executor";
import { generateQueries } from "../src/lib/sql-generator";

const auditArgs = process.argv.slice(2);
const datasetId = auditArgs.find((a) => !a.startsWith("--")) || "flipkart-marketplace";
const NO_LLM = auditArgs.includes("--no-llm");

function loadEnv(p: string) {
  if (!existsSync(p)) return;
  for (const raw of readFileSync(p, "utf8").split(/\r?\n/)) {
    const l = raw.trim();
    if (!l || l.startsWith("#")) continue;
    const m = l.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^export\s+/, "").replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  }
}
loadEnv(resolve(".env"));
loadEnv(resolve(".env.local"));

async function q(sql: string): Promise<{ rows: Record<string, unknown>[]; error?: string }> {
  const r = await executeSQL(sql, datasetId);
  return { rows: r.rows ?? [], error: r.error };
}
async function scalar(sql: string): Promise<number | null> {
  const r = await q(sql);
  if (r.error || !r.rows.length) return null;
  const v = Object.values(r.rows[0]).find((x) => typeof x === "number" || (typeof x === "bigint"));
  return v == null ? null : Number(v);
}
function nums(rows: Record<string, unknown>[]): number[] {
  const out: number[] = [];
  for (const row of rows.slice(0, 30)) for (const v of Object.values(row)) {
    if (typeof v === "number" && isFinite(v)) out.push(v);
    else if (typeof v === "bigint") out.push(Number(v));
  }
  return out;
}
function strs(rows: Record<string, unknown>[]): string[] {
  const out: string[] = [];
  for (const row of rows.slice(0, 30)) for (const v of Object.values(row)) {
    if (typeof v === "string") out.push(v.toLowerCase());
  }
  return out;
}
// truth value considered "present" if any tool number matches it, its ×100, or /100
// (covers fraction-vs-percentage representation). Counts match exactly; sums within 1.5%.
function matches(truth: number, candidates: number[]): boolean {
  const targets = [truth, truth * 100, truth / 100];
  const tol = (t: number) => Math.max(1, Math.abs(t) * 0.015);
  return candidates.some((c) => targets.some((t) => Math.abs(c - t) <= tol(t)));
}

// ── Phase 1 checks ──
interface Check { id: string; cat: string; sev: "HIGH" | "MED" | "LOW"; sql: string; sample?: string; note?: string }
const CHECKS: Check[] = [
  // referential integrity
  { id: "items→orders", cat: "Referential", sev: "HIGH", sql: "SELECT COUNT(*) n FROM order_items oi LEFT JOIN orders o ON oi.order_id=o.order_id WHERE o.order_id IS NULL" },
  { id: "items→products", cat: "Referential", sev: "HIGH", sql: "SELECT COUNT(*) n FROM order_items oi LEFT JOIN products p ON oi.product_id=p.product_id WHERE p.product_id IS NULL" },
  { id: "items→sellers", cat: "Referential", sev: "HIGH", sql: "SELECT COUNT(*) n FROM order_items oi LEFT JOIN sellers s ON oi.seller_id=s.seller_id WHERE s.seller_id IS NULL" },
  { id: "orders→customers", cat: "Referential", sev: "HIGH", sql: "SELECT COUNT(*) n FROM orders o LEFT JOIN customers c ON o.customer_id=c.customer_id WHERE c.customer_id IS NULL" },
  { id: "payments→orders", cat: "Referential", sev: "HIGH", sql: "SELECT COUNT(*) n FROM payments p LEFT JOIN orders o ON p.order_id=o.order_id WHERE o.order_id IS NULL" },
  { id: "returns→items", cat: "Referential", sev: "HIGH", sql: "SELECT COUNT(*) n FROM returns r LEFT JOIN order_items oi ON r.order_item_id=oi.order_item_id WHERE oi.order_item_id IS NULL" },
  { id: "reviews→products", cat: "Referential", sev: "HIGH", sql: "SELECT COUNT(*) n FROM reviews r LEFT JOIN products p ON r.product_id=p.product_id WHERE p.product_id IS NULL" },
  { id: "products→sellers", cat: "Referential", sev: "HIGH", sql: "SELECT COUNT(*) n FROM products p LEFT JOIN sellers s ON p.seller_id=s.seller_id WHERE s.seller_id IS NULL" },
  { id: "converted-sessions→orders", cat: "Referential", sev: "MED", sql: "SELECT COUNT(*) n FROM sessions s WHERE s.placed_order_flag=TRUE AND s.order_id NOT IN (SELECT order_id FROM orders)" },
  { id: "orders-with-no-items", cat: "Referential", sev: "HIGH", sql: "SELECT COUNT(*) n FROM orders o WHERE NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id=o.order_id)" },
  // arithmetic consistency
  { id: "order.gmv = sum(line_gmv)", cat: "Arithmetic", sev: "HIGH", sql: "SELECT COUNT(*) n FROM orders o JOIN (SELECT order_id, SUM(line_gmv_inr) s FROM order_items GROUP BY 1) x ON o.order_id=x.order_id WHERE ABS(o.gmv_inr - x.s) > 1.5", sample: "SELECT o.order_id, o.gmv_inr, x.s FROM orders o JOIN (SELECT order_id, SUM(line_gmv_inr) s FROM order_items GROUP BY 1) x ON o.order_id=x.order_id WHERE ABS(o.gmv_inr-x.s)>1.5 LIMIT 3" },
  { id: "order.items_count = count(items)", cat: "Arithmetic", sev: "MED", sql: "SELECT COUNT(*) n FROM orders o JOIN (SELECT order_id, COUNT(*) c FROM order_items GROUP BY 1) x ON o.order_id=x.order_id WHERE o.items_count <> x.c" },
  { id: "line_gmv = unit_price*qty - discount", cat: "Arithmetic", sev: "MED", sql: "SELECT COUNT(*) n FROM order_items WHERE ABS(line_gmv_inr - (unit_price_inr*qty - item_discount_inr)) > 1.5 AND line_gmv_inr > 1" },
  { id: "payment.amount = gmv - discount + shipping", cat: "Arithmetic", sev: "MED", sql: "SELECT COUNT(*) n FROM payments p JOIN orders o ON p.order_id=o.order_id WHERE ABS(p.amount_inr - (o.gmv_inr - o.discount_inr + o.shipping_fee_inr)) > 1.5 AND p.amount_inr > 1" },
  { id: "refund ≤ line_gmv", cat: "Arithmetic", sev: "HIGH", sql: "SELECT COUNT(*) n FROM returns r JOIN order_items oi ON r.order_item_id=oi.order_item_id WHERE r.refund_inr > oi.line_gmv_inr + 1.5" },
  { id: "returns only on delivered items", cat: "Arithmetic", sev: "HIGH", sql: "SELECT COUNT(*) n FROM returns r JOIN order_items oi ON r.order_item_id=oi.order_item_id WHERE oi.item_status NOT IN ('Returned','Delivered')" },
  // validity & ranges
  { id: "qty > 0", cat: "Validity", sev: "HIGH", sql: "SELECT COUNT(*) n FROM order_items WHERE qty <= 0" },
  { id: "prices ≥ 0", cat: "Validity", sev: "HIGH", sql: "SELECT COUNT(*) n FROM order_items WHERE unit_price_inr < 0 OR line_gmv_inr < 0 OR item_discount_inr < 0" },
  { id: "ratings in 1..5", cat: "Validity", sev: "HIGH", sql: "SELECT COUNT(*) n FROM reviews WHERE rating < 1 OR rating > 5" },
  { id: "no future order dates", cat: "Validity", sev: "HIGH", sql: "SELECT COUNT(*) n FROM orders WHERE order_ts > TIMESTAMP '2026-05-31 23:59:59'" },
  { id: "signup ≤ order_ts", cat: "Validity", sev: "MED", sql: "SELECT COUNT(*) n FROM orders o JOIN customers c ON o.customer_id=c.customer_id WHERE c.signup_date > o.order_ts" },
  { id: "return resolved ≥ requested", cat: "Validity", sev: "MED", sql: "SELECT COUNT(*) n FROM returns WHERE resolved_ts IS NOT NULL AND resolved_ts < requested_ts" },
  { id: "review_ts ≥ order_ts", cat: "Validity", sev: "LOW", sql: "SELECT COUNT(*) n FROM reviews r JOIN orders o ON r.order_id=o.order_id WHERE r.review_ts < o.order_ts" },
  // consistency & uniqueness
  { id: "unique order_id", cat: "Uniqueness", sev: "HIGH", sql: "SELECT COUNT(*) n FROM (SELECT order_id FROM orders GROUP BY 1 HAVING COUNT(*) > 1)" },
  { id: "unique product_id", cat: "Uniqueness", sev: "HIGH", sql: "SELECT COUNT(*) n FROM (SELECT product_id FROM products GROUP BY 1 HAVING COUNT(*) > 1)" },
  { id: "unique customer email", cat: "Uniqueness", sev: "MED", sql: "SELECT COUNT(*) n FROM (SELECT email FROM customers GROUP BY 1 HAVING COUNT(*) > 1)", sample: "SELECT email, COUNT(*) c FROM customers GROUP BY 1 HAVING COUNT(*)>1 ORDER BY 2 DESC LIMIT 3", note: "duplicate emails across distinct customers" },
  { id: "null required fields (orders)", cat: "Validity", sev: "HIGH", sql: "SELECT COUNT(*) n FROM orders WHERE order_status IS NULL OR order_ts IS NULL OR gmv_inr IS NULL" },
  { id: "null product price/category", cat: "Validity", sev: "HIGH", sql: "SELECT COUNT(*) n FROM products WHERE list_price_inr IS NULL OR category IS NULL" },
];
// distribution sanity (report only, not failures)
const DIST: Check[] = [
  { id: "products never ordered", cat: "Distribution", sev: "LOW", sql: "SELECT COUNT(*) n FROM products p WHERE NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.product_id=p.product_id)" },
  { id: "categories with no products", cat: "Distribution", sev: "LOW", sql: "SELECT COUNT(*) n FROM (SELECT DISTINCT category FROM order_items) c WHERE c.category NOT IN (SELECT DISTINCT category FROM products)" },
  { id: "customers with no orders", cat: "Distribution", sev: "LOW", sql: "SELECT COUNT(*) n FROM customers c WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id=c.customer_id)" },
  { id: "sellers with no sales", cat: "Distribution", sev: "LOW", sql: "SELECT COUNT(*) n FROM sellers s WHERE NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.seller_id=s.seller_id)" },
];

// ── Phase 2 questions (ground truth) ──
type Cmp = "scalar" | "label" | "zero";
interface Q { q: string; truth: string; cmp?: Cmp; label?: string }
const QUESTIONS: Q[] = [
  { q: "How many orders were placed in total?", truth: "SELECT COUNT(*) n FROM orders" },
  { q: "How many orders were delivered?", truth: "SELECT COUNT(*) n FROM orders WHERE order_status='Delivered'" },
  { q: "What is the total GMV across the marketplace?", truth: "SELECT SUM(line_gmv_inr) g FROM order_items" },
  { q: "What is the average order value?", truth: "SELECT AVG(gmv_inr) a FROM orders" },
  { q: "How many unique buyers placed at least one order?", truth: "SELECT COUNT(DISTINCT customer_id) n FROM orders" },
  { q: "What is the total marketplace commission revenue?", truth: "SELECT SUM(commission_inr) c FROM order_items" },
  { q: "How many active sellers are there?", truth: "SELECT COUNT(*) n FROM sellers WHERE status='Active'" },
  { q: "How many products are listed?", truth: "SELECT COUNT(*) n FROM products" },
  { q: "What is the total refund value from returns?", truth: "SELECT SUM(refund_inr) r FROM returns" },
  { q: "What is the average product review rating?", truth: "SELECT AVG(rating) a FROM reviews" },
  { q: "What share of sessions resulted in an order?", truth: "SELECT AVG(CASE WHEN placed_order_flag THEN 1.0 ELSE 0 END) c FROM sessions" },
  { q: "How many orders used a coupon?", truth: "SELECT COUNT(*) n FROM orders WHERE coupon_code IS NOT NULL" },
  { q: "How many orders were cancelled?", truth: "SELECT COUNT(*) n FROM orders WHERE order_status='Cancelled'" },
  { q: "How many orders came from the mobile app (channel APP)?", truth: "SELECT COUNT(*) n FROM orders WHERE channel='APP'" },
  { q: "How many orders came from iOS devices?", truth: "SELECT COUNT(*) n FROM orders WHERE device='iOS'" },
  { q: "How many orders came from the Safari browser?", truth: "SELECT COUNT(*) n FROM orders WHERE browser='Safari'" },
  { q: "How many orders were each customer's first order?", truth: "SELECT COUNT(*) n FROM orders WHERE is_first_order_flag=TRUE" },
  { q: "What is the on-time delivery rate for delivered orders?", truth: "SELECT AVG(CASE WHEN sla_met_flag THEN 1.0 ELSE 0 END) r FROM orders WHERE order_status='Delivered'" },
  { q: "How many payments have a successful or collected status?", truth: "SELECT COUNT(*) n FROM payments WHERE payment_status IN ('Success','Collected')" },
  { q: "How many returns are still pending resolution?", truth: "SELECT COUNT(*) n FROM returns WHERE resolution='Pending'" },
  { q: "What is the total seller advertising spend?", truth: "SELECT SUM(spend_inr) s FROM ad_campaigns" },
  { q: "What is the blended customer acquisition cost?", truth: "SELECT SUM(marketing_spend_inr)/NULLIF(SUM(new_buyers_acquired),0) cac FROM acquisition_spend" },
  { q: "How many orders were placed in October 2024?", truth: "SELECT COUNT(*) n FROM orders WHERE strftime(order_ts,'%Y-%m')='2024-10'" },
  { q: "What is the total GMV in December 2025?", truth: "SELECT SUM(gmv_inr) g FROM orders WHERE strftime(order_ts,'%Y-%m')='2025-12'" },
  { q: "How many order items were purchased via UPI orders?", truth: "SELECT COUNT(*) n FROM order_items oi JOIN orders o ON oi.order_id=o.order_id WHERE o.payment_method='UPI'" },
  { q: "What is the single highest order value?", truth: "SELECT MAX(gmv_inr) m FROM orders" },
  { q: "What is the average discount per order?", truth: "SELECT AVG(discount_inr) d FROM orders" },
  { q: "How many distinct shipping cities are there?", truth: "SELECT COUNT(DISTINCT city) n FROM orders" },
  { q: "How many orders are still in transit?", truth: "SELECT COUNT(*) n FROM orders WHERE order_status='In Transit'" },
  { q: "How many Flipkart Assured sellers are there?", truth: "SELECT COUNT(*) n FROM sellers WHERE assured_flag=TRUE" },
  { q: "How many buyers were acquired via Google Ads?", truth: "SELECT COUNT(*) n FROM customers WHERE acquisition_channel='Google Ads'" },
  { q: "What is the CAC for the Google Ads channel?", truth: "SELECT SUM(marketing_spend_inr)/NULLIF(SUM(new_buyers_acquired),0) c FROM acquisition_spend WHERE channel='Google Ads'" },
  { q: "How many sessions added an item to cart?", truth: "SELECT COUNT(*) n FROM sessions WHERE added_to_cart_flag=TRUE" },
  { q: "What is the total buyer-acquisition marketing spend?", truth: "SELECT SUM(marketing_spend_inr) s FROM acquisition_spend" },
  { q: "What is the average seller rating?", truth: "SELECT AVG(seller_rating) a FROM sellers" },
  { q: "How many orders came from tier-1 (metro) cities?", truth: "SELECT COUNT(*) n FROM orders o JOIN customers c ON o.customer_id=c.customer_id WHERE c.city_tier=1" },
  { q: "What is the average order value for Plus members?", truth: "SELECT AVG(o.gmv_inr) a FROM orders o JOIN customers c ON o.customer_id=c.customer_id WHERE c.plus_member_flag=TRUE" },
  { q: "How many products have at least 5 reviews?", truth: "SELECT COUNT(*) n FROM (SELECT product_id FROM reviews GROUP BY 1 HAVING COUNT(*)>=5)" },
  { q: "What is the GMV from tier-4 town buyers?", truth: "SELECT SUM(o.gmv_inr) g FROM orders o JOIN customers c ON o.customer_id=c.customer_id WHERE c.city_tier=4" },
  { q: "What is the cart-abandonment rate (added to cart but no order)?", truth: "SELECT 1.0 - (COUNT(*) FILTER(WHERE placed_order_flag)::DOUBLE / COUNT(*) FILTER(WHERE added_to_cart_flag)) r FROM sessions" },
  // top-N / label
  { q: "Which category has the highest total GMV?", truth: "SELECT category FROM order_items GROUP BY 1 ORDER BY SUM(line_gmv_inr) DESC LIMIT 1", cmp: "label", label: "category" },
  { q: "Which payment method is used on the most orders?", truth: "SELECT payment_method FROM orders GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1", cmp: "label", label: "payment_method" },
  { q: "Which category is returned most often?", truth: "SELECT category FROM returns GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1", cmp: "label", label: "category" },
  // should be empty / zero
  { q: "How many orders have a negative GMV?", truth: "SELECT COUNT(*) n FROM orders WHERE gmv_inr < 0", cmp: "zero" },
  { q: "How many reviews have a rating above 5?", truth: "SELECT COUNT(*) n FROM reviews WHERE rating > 5", cmp: "zero" },
];

async function main() {
  console.log(`\n════════ MARKETPLACE AUDIT — ${datasetId} ════════`);

  // Phase 0
  console.log("\n━━━ Phase 0: Recon ━━━");
  await q(`SELECT 1 FROM orders LIMIT 1`); // trigger build
  const cols = await q("SELECT table_name, COUNT(*) cols FROM information_schema.columns WHERE table_schema='main' AND table_name NOT LIKE 'raw_%' AND table_name NOT LIKE 'sentinel_%' GROUP BY 1 ORDER BY 1");
  console.log("Tables (name · #cols · #rows):");
  for (const r of cols.rows) {
    const n = await scalar(`SELECT COUNT(*) c FROM ${r.table_name}`);
    console.log(`  ${String(r.table_name).padEnd(20)} ${String(r.cols).padStart(2)} cols  ${n?.toLocaleString()} rows`);
  }
  const enums: [string, string][] = [["orders", "order_status"], ["order_items", "item_status"], ["payments", "payment_status"], ["returns", "resolution"], ["returns", "return_type"], ["sellers", "seller_tier"], ["sellers", "status"], ["orders", "channel"], ["orders", "browser"], ["customers", "segment"]];
  console.log("\nEnum vocabularies (status/type columns):");
  for (const [t, c] of enums) {
    const r = await q(`SELECT DISTINCT ${c} v FROM ${t} WHERE ${c} IS NOT NULL ORDER BY 1`);
    console.log(`  ${t}.${c}: ${r.rows.map((x) => x.v).join(" | ")}`);
  }

  // Phase 1
  console.log("\n━━━ Phase 1: Data Integrity Report ━━━");
  const issues: { check: Check; n: number; examples: Record<string, unknown>[] }[] = [];
  const errored: Check[] = [];
  for (const c of CHECKS) {
    // Each check is a `SELECT COUNT(*)` → exactly one numeric row, so a null here
    // means the SQL itself ERRORED (e.g. a column was renamed). Surface that as a
    // problem — never let a check that could not run be reported as "clean".
    const n = await scalar(c.sql);
    if (n === null) { errored.push(c); continue; }
    if (n > 0) {
      const ex = c.sample ? (await q(c.sample)).rows : [];
      issues.push({ check: c, n, examples: ex });
    }
  }
  const rank = { HIGH: 0, MED: 1, LOW: 2 } as const;
  issues.sort((a, b) => rank[a.check.sev] - rank[b.check.sev] || b.n - a.n);
  if (errored.length) {
    console.log(`  ⚠ ${errored.length} check(s) FAILED TO RUN (SQL error — NOT validated): ${errored.map((c) => c.id).join(", ")}`);
  }
  if (!issues.length && !errored.length) console.log("  ✓ No integrity violations across", CHECKS.length, "checks.");
  for (const it of issues) {
    console.log(`  [${it.check.sev}] ${it.check.cat} · ${it.check.id}: ${it.n.toLocaleString()} rows${it.check.note ? ` (${it.check.note})` : ""}`);
    if (it.examples.length) console.log(`        e.g. ${JSON.stringify(it.examples[0])}`);
  }
  console.log("\n  Distribution (informational, not errors):");
  for (const d of DIST) console.log(`    ${d.id}: ${(await scalar(d.sql))?.toLocaleString()}`);

  // Phase 2
  if (NO_LLM || !process.env.OPENAI_API_KEY) {
    console.log(`\n━━━ Phase 2: SKIPPED (${NO_LLM ? "--no-llm" : "no OPENAI_API_KEY"}) ━━━`);
    process.exit(0);
  }
  console.log(`\n━━━ Phase 2: Answerability & Correctness (${QUESTIONS.length} questions) ━━━`);
  const results: { q: string; verdict: string; truth: string; tool: string; sql: string }[] = [];
  let i = 0;
  for (const item of QUESTIONS) {
    i++;
    const truthRows = (await q(item.truth)).rows;
    const cmp = item.cmp ?? "scalar";
    let verdict = "ERROR", toolStr = "", sqlStr = "";
    try {
      const gen = await generateQueries(item.q, "quick", datasetId);
      if (!gen.length) { verdict = "REFUSED"; }
      else {
        const r = await executeSQL(gen[0].sql, datasetId);
        sqlStr = gen[0].sql.replace(/\s+/g, " ").slice(0, 200);
        if (r.error) { verdict = "ERROR"; toolStr = r.error.slice(0, 80); }
        else {
          const toolNums = nums(r.rows ?? []);
          toolStr = JSON.stringify((r.rows ?? [])[0] ?? {}).slice(0, 90);
          if (cmp === "zero") {
            const t = Number(Object.values(truthRows[0] ?? { n: 0 })[0] ?? 0);
            verdict = (r.rowCount === 0 || toolNums.every((x) => x === 0)) ? "EMPTY_OK" : (t === 0 && toolNums.includes(0) ? "OK_CORRECT" : "EMPTY_WRONG");
          } else if (cmp === "label") {
            const truthLabel = String(truthRows[0]?.[item.label!] ?? "").toLowerCase();
            verdict = strs(r.rows ?? []).some((s) => s === truthLabel || s.includes(truthLabel)) ? "OK_CORRECT" : "OK_WRONG";
          } else {
            const t = Number(Object.values(truthRows[0] ?? {})[0]);
            if (!isFinite(t)) verdict = "OK_WRONG";
            else if (!(r.rows ?? []).length) verdict = t === 0 ? "EMPTY_OK" : "EMPTY_WRONG";
            else verdict = matches(t, toolNums) ? "OK_CORRECT" : "OK_WRONG";
          }
        }
      }
    } catch (e) { verdict = "ERROR"; toolStr = String(e).slice(0, 80); }
    const truthStr = JSON.stringify(truthRows[0] ?? {}).slice(0, 60);
    results.push({ q: item.q, verdict, truth: truthStr, tool: toolStr, sql: sqlStr });
    if (i % 10 === 0) process.stdout.write(`  ...${i}/${QUESTIONS.length}\n`);
  }

  // Scorecard
  const tally: Record<string, number> = {};
  for (const r of results) tally[r.verdict] = (tally[r.verdict] ?? 0) + 1;
  console.log("\n━━━ Answerability Scorecard ━━━");
  for (const k of ["OK_CORRECT", "OK_WRONG", "ERROR", "REFUSED", "EMPTY_OK", "EMPTY_WRONG"]) console.log(`  ${k.padEnd(12)} ${tally[k] ?? 0}`);
  const correct = (tally.OK_CORRECT ?? 0) + (tally.EMPTY_OK ?? 0);
  console.log(`  ─────────────────────`);
  console.log(`  correct ${correct}/${results.length} (${(100 * correct / results.length).toFixed(0)}%) · errors ${(tally.ERROR ?? 0) + (tally.REFUSED ?? 0)} · wrong ${(tally.OK_WRONG ?? 0) + (tally.EMPTY_WRONG ?? 0)}`);
  console.log("\n  Non-correct questions (review):");
  for (const r of results.filter((x) => !["OK_CORRECT", "EMPTY_OK"].includes(x.verdict))) {
    console.log(`  [${r.verdict}] ${r.q}\n     truth=${r.truth} tool=${r.tool}\n     sql=${r.sql}`);
  }
  console.log(`\n  (verdict heuristic: tool is correct if ground-truth value — or its ×100 — appears in the tool's result.)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
