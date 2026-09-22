# Flipkart Marketplace Dataset

A hybrid e-commerce demo dataset where **buyers (customers) and sellers are both
first-class**. Built for prospects in retail / marketplace / e-commerce. Registered
as a static sample dataset (`flipkart-marketplace`, label "Marketplace",
companyName "Flipkart").

## What it covers

Two analytics narratives in one dataset:

- **Buyer growth** — acquisition channels, new vs repeat orders, signup-cohort
  retention, time-to-second-order, Plus membership, buyer segments
  (New / Casual / Core / VIP), the browse → cart → checkout → order funnel.
- **Seller / marketplace ops** — GMV by seller tier, fulfilment model, on-time
  delivery (SLA), seller ratings, returns by seller and category, take-rate
  (commission) revenue, Flipkart Ads ROAS.

## Tables (11)

| Table | Rows | Grain |
|-------|------|-------|
| `customers` | 16,000 | one buyer |
| `sellers` | 2,500 | one marketplace seller |
| `products` | 30,000 | one SKU |
| `orders` | 96,202 | one order (primary fact) |
| `order_items` | 163,557 | one product line in an order |
| `payments` | 96,202 | one per order (1:1) |
| `returns` | 15,287 | one returned line (delivered items only) |
| `reviews` | 49,293 | one product review |
| `ad_campaigns` | 6,296 | one seller × month (Flipkart Ads) |
| `sessions` | 307,846 | one browsing session (funnel) |
| `calendar_events` | 28 | festival / seasonality reference |

Window: Jun 2024 – May 2026 (24 months). GMV ≈ ₹35 Cr, AOV ≈ ₹3,678,
commission (take-rate) revenue ≈ ₹3.6 Cr, return rate ≈ 11% of delivered items.

**Referential integrity is enforced by construction** and verified: order totals
reconcile to the sum of their line items, returns apply only to delivered items,
every order has a payment, every converting session links to a real order, and all
foreign keys resolve. Booleans are real BOOLEAN columns (filter with `= TRUE`).

## Regenerating the data

Generator: `~/projects/actioneer-demo-data/generate_flipkart.py` (reuses
`realism_engine.py` for Indian cities, names, the Big Billion Days / Diwali
calendar, and category-aware amount sampling).

```bash
cd ~/projects/actioneer-demo-data
.venv/bin/python generate_flipkart.py --scale 1.0 --outdir out
# copy into the app (CSVs are gitignored, like every other dataset's data):
cp out/Flipkart_Marketplace_Demo/*.csv ~/projects/baby-sentinel/data/csv/flipkart-marketplace/
```

`--scale 0.05` produces a small set for quick testing. If you change the CSV
schema, bump `setupVersion` in `src/lib/datasets/flipkart-marketplace.ts` and delete
the local `data/flipkart-marketplace.duckdb` so the materialized tables rebuild.

## Deploy data requirement

Like every other dataset, `data/csv/flipkart-marketplace/` is **gitignored**. On a
fresh deploy the repo has the config but NOT the data, so the first query throws
until the CSVs are provisioned. On deploy, copy the generated CSVs to the box (see
command above). On first query the app builds `data/flipkart-marketplace.duckdb`,
materializing `orders`, `order_items`, `payments`, `sessions`.

## Verification

`scripts/verify-flipkart.ts` is the end-to-end harness:

```bash
npx tsx scripts/verify-flipkart.ts --no-llm     # structural only (free)
npx tsx scripts/verify-flipkart.ts --prompts=100 # + 100 NL prompts (needs OPENAI_API_KEY)
```

- **Phase 0** builds the DuckDB and confirms boolean columns parse as BOOLEAN.
- **Phase A** runs 48 deterministic analytical queries covering every table, join,
  and the exact shapes the agent hints / events use.
- **Phase B** runs N natural-language prompts through the real
  `generateQueries → executeSQL` pipeline, surfacing missing/stale events.

Last run: Phase 0 + A all green; **100/100 NL prompts produced working SQL with
non-empty results, 0 failures**. Schema discovery (the playbook-generation
foundation) discovers all tables correctly.
