---
date: 2026-02-20
topic: category-revenue-breakdown
---

# Category Revenue Breakdown — Brainstorm

## What We're Building

Replace the current flat default metrics with a **hierarchical category revenue breakdown**. Revenue (base, from SQL) sits at indent 0 with four category rows (Electronics, Appliances, Clothing, Furniture) indented below it. An "Others" derived row captures the remainder. Purchases, Unique Users, Paying Users stay as base rows. Derived metrics (AOV, Conversion Rate, ARPU) remain.

### Table Layout

```
 Revenue            $51.2M   $53.8M   ...   (base: SUM(revenue) from daily_metrics)
   Electronics      $32.1M   $33.7M   ...   (base: SQL from events + Gemini forecast)
   Appliances       $10.8M   $11.4M   ...   (base: SQL from events + Gemini forecast)
   Clothing          $4.2M    $4.5M   ...   (base: SQL from events + Gemini forecast)
   Furniture         $4.1M    $4.2M   ...   (base: SQL from events + Gemini forecast)
   Others            $0.1M    $0.2M   ...   (derived: {Revenue} - {Electronics} - {Appliances} - {Clothing} - {Furniture})
 Purchases         170,000  182,000   ...   (base)
 Unique Users     1.42M    1.53M     ...   (base)
 Paying Users      64,000   69,000   ...   (base)
 AOV               $281     $282     ...   (derived: {Revenue} / {Purchases})
 Conversion Rate    1.73%    1.75%   ...   (derived: {Purchases} / {Page Views} * 100)
 ARPU              $36.10   $37.20   ...   (derived: {Revenue} / {Unique Users})
```

### Category SQL

Categories use `events` table (not `category_metrics` which lacks a date column for weekly aggregation):

```sql
SELECT DATE_TRUNC('week', event_time::TIMESTAMP) AS week,
       SUM(price) AS value
FROM events
WHERE event_type = 'purchase'
  AND SPLIT_PART(category_code, '.', 1) = 'electronics'
GROUP BY 1
ORDER BY 1
```

### Adding Custom Metrics (AI-powered)

Flow: Click "Add Metric" row → new empty row → Inspect panel → type natural-language description (e.g. "Weekly revenue for smartphones") → click "Generate SQL" button → `POST /api/forecast/generate-sql` (Gemini + schema context) → SQL shown for confirmation → user confirms → row populates.

## Key Decisions

- **Revenue stays base** (authoritative total from `daily_metrics`). Categories are also base. "Others" is derived (remainder).
- **Top 4 categories by revenue**: Electronics, Appliances, Clothing, Furniture
- **Indent 1** for category rows + Others (visual hierarchy)
- **AI SQL generation** in inspect panel for adding new base metrics via natural language
- **Page Views removed from default base rows** — not needed for category revenue focus. Conversion Rate formula updated if needed or removed.

## Next Steps

→ `/workflows:plan` for implementation details
