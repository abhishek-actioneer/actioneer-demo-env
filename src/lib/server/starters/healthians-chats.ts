import {
  deepResearchThread,
  normalThread,
  type StarterChat,
} from "@/lib/server/starter-chats";

// All figures validated against data/healthians.duckdb via scripts/q.mjs.
// INR amounts written with the ₹ symbol in US K/M notation (e.g. ₹13.35M), never Indian-style notation.

const normals: StarterChat[] = [
  normalThread({
    slug: "repeat-rate-snapshot",
    title: "Which customers actually come back?",
    question:
      "What's our repeat-booking rate, and which customer archetypes carry the most lifetime value?",
    primaryAgent: { id: "cohort-retention", name: "Cohort Retention Agent", icon: "users" },
    answer:
      "## Repeat booking is the business\n\n**92.9%** of the 34,937 customers who have ever booked come back for a **2nd or more** booking [cohort-retention:Q1]. Average lifetime value across the base is **₹3,697**, but it is wildly uneven by archetype.\n\n| Archetype | Customers | Avg bookings | Avg LTV | Active sub |\n|---|---:|---:|---:|---:|\n| Chronic subscriber | 3,899 | 16.9 | **₹10,910** | 54.7% |\n| Health anxious | 2,830 | 10.4 | ₹7,863 | 6.3% |\n| Doctor referred | 4,240 | 5.0 | ₹3,010 | 5.9% |\n| Reactive booker | 7,425 | 3.8 | ₹2,643 | 6.6% |\n| Annual checker | 9,858 | 2.5 | ₹2,246 | 6.1% |\n| One and done | 7,032 | 2.0 | ₹1,401 | 6.3% |\n\nSource: archetype breakdown [cohort-retention:Q2].\n\n### The top decile carries the book\n\nRanking every customer into LTV deciles makes the concentration explicit. The **top decile (3,493 customers) holds 34.1% of all lifetime revenue**, and the **top three deciles together hold 64.6%** [cohort-retention:Q4]. The bottom half of the base contributes almost nothing in comparison.\n\n| LTV decile | Customers | Avg LTV | Avg bookings | Share of revenue |\n|---|---:|---:|---:|---:|\n| Decile 10 (top) | 3,493 | ₹12,595 | 16.9 | **34.1%** |\n| Decile 9 | 3,493 | ₹7,034 | 10.9 | 19.0% |\n| Decile 8 | 3,493 | ₹4,273 | 5.6 | 11.6% |\n| Decile 7 | 3,494 | ₹3,270 | 4.3 | 8.8% |\n\nSource: LTV decile distribution [cohort-retention:Q4].\n\n### Subscription adoption is the dividing line\n\nThe only group with meaningful subscription penetration is chronic subscribers at **54.7%** active; every other archetype sits near **6%** [cohort-retention:Q2]. That single behavioral difference is what separates a ₹10,910 customer from a ₹1,401 one. WhatsApp reach is not the constraint: **82.2%** of the base is WhatsApp opt-in, so the recurring rail can be promoted to almost everyone at near-zero send cost [cohort-retention:Q3].\n\nInterestingly, WhatsApp opt-in is not itself a value signal: opt-in and opt-out customers carry near-identical LTV (₹3,684 vs ₹3,758) and subscription rates (11.6% vs 11.9%) [cohort-retention:Q5]. Opt-in is a reach channel, not a high-value segment, so the play is to use it to push the subscription rail, not to treat opt-in as a proxy for intent.\n\n### First test barely predicts the chronic outcome\n\nThe category a customer lands on first is a weak predictor of whether they become a chronic subscriber. Vitamins-first (12.2% chronic) and diabetes-first (12.0%) edge out full-body-first (10.8%), but the spread is small [cohort-retention:Q6]. This matters: you cannot cherry-pick high-value customers at acquisition by landing category. The conversion happens *after* the first result, through counseling and the recurring prompt, not at the door.\n\n**Takeaway:** chronic subscribers book ~8x more often and are worth ~8x more than one-and-done customers, and they are the only group with meaningful subscription adoption (54.7% vs ~6% everywhere else). Revenue is concentrated in the top three LTV deciles (64.6%), and first-landing category barely predicts who gets there. The growth lever is converting annual_checker and reactive_booker customers (17,283 people, your two biggest segments) onto a recurring panel after their first abnormal result.\n\nWant the conversion path from a first Full Body checkup into a recurring HbA1c or thyroid subscription?",
    followUps: [
      "Which first test best predicts a customer becoming a chronic subscriber?",
      "How much LTV would we add by moving 10% of annual_checkers onto a subscription?",
      "What is the LTV gap between WhatsApp opt-in and opt-out customers?",
      "Which cities have the highest share of one-and-done customers?",
    ],
    work: {
      queries: [
        {
          description: "Base repeat-booking rate and average lifetime value across customers who have ever booked",
          sql: "SELECT COUNT(*) AS ever_booked,\n       ROUND(100.0 * AVG(CASE WHEN total_bookings >= 2 THEN 1 ELSE 0 END), 1) AS repeat_pct,\n       ROUND(AVG(total_spend_inr)) AS avg_ltv\nFROM customers_full\nWHERE total_bookings >= 1;",
          rowCount: 1,
          executionTimeMs: 412,
          columns: ["ever_booked", "repeat_pct", "avg_ltv"],
          data: [{ ever_booked: 34937, repeat_pct: 92.9, avg_ltv: 3697 }],
        },
        {
          description: "Bookings, LTV, and subscription penetration by customer archetype",
          sql: "SELECT archetype,\n       COUNT(*) AS customers,\n       ROUND(AVG(total_bookings), 1) AS avg_bookings,\n       ROUND(AVG(total_spend_inr)) AS avg_ltv,\n       ROUND(100.0 * AVG(CASE WHEN subscription_active THEN 1 ELSE 0 END), 1) AS active_sub_pct\nFROM customers_full\nGROUP BY archetype\nORDER BY avg_ltv DESC;",
          rowCount: 6,
          executionTimeMs: 537,
          columns: ["archetype", "customers", "avg_bookings", "avg_ltv", "active_sub_pct"],
          data: [
            { archetype: "chronic_subscriber", customers: 3899, avg_bookings: 16.9, avg_ltv: 10910, active_sub_pct: 54.7 },
            { archetype: "health_anxious", customers: 2830, avg_bookings: 10.4, avg_ltv: 7863, active_sub_pct: 6.3 },
            { archetype: "doctor_referred", customers: 4240, avg_bookings: 5.0, avg_ltv: 3010, active_sub_pct: 5.9 },
            { archetype: "reactive_booker", customers: 7425, avg_bookings: 3.8, avg_ltv: 2643, active_sub_pct: 6.6 },
            { archetype: "annual_checker", customers: 9858, avg_bookings: 2.5, avg_ltv: 2246, active_sub_pct: 6.1 },
            { archetype: "one_and_done", customers: 7032, avg_bookings: 2.0, avg_ltv: 1401, active_sub_pct: 6.3 },
          ],
        },
        {
          description: "WhatsApp opt-in share of the customer base, used to size the reachable audience for a subscription push",
          sql: "SELECT whatsapp_opt_in,\n       COUNT(*) AS customers,\n       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct_of_base\nFROM customers_full\nGROUP BY whatsapp_opt_in;",
          rowCount: 2,
          executionTimeMs: 298,
          columns: ["whatsapp_opt_in", "customers", "pct_of_base"],
          data: [
            { whatsapp_opt_in: true, customers: 28999, pct_of_base: 82.2 },
            { whatsapp_opt_in: false, customers: 6285, pct_of_base: 17.8 },
          ],
        },
        {
          description: "Lifetime-value concentration: customers ranked into LTV deciles with each decile's share of total revenue",
          sql: "WITH ltv_ranked AS (\n  SELECT customer_id, total_spend_inr, total_bookings,\n         NTILE(10) OVER (ORDER BY total_spend_inr) AS ltv_decile\n  FROM customers_full\n  WHERE total_bookings >= 1\n)\nSELECT ltv_decile,\n       COUNT(*) AS customers,\n       ROUND(AVG(total_spend_inr)) AS avg_ltv,\n       ROUND(AVG(total_bookings), 1) AS avg_bookings,\n       ROUND(100.0 * SUM(total_spend_inr) / SUM(SUM(total_spend_inr)) OVER (), 1) AS pct_of_revenue\nFROM ltv_ranked\nGROUP BY ltv_decile\nORDER BY ltv_decile DESC\nLIMIT 4;",
          rowCount: 4,
          executionTimeMs: 712,
          columns: ["ltv_decile", "customers", "avg_ltv", "avg_bookings", "pct_of_revenue"],
          data: [
            { ltv_decile: 10, customers: 3493, avg_ltv: 12595, avg_bookings: 16.9, pct_of_revenue: 34.1 },
            { ltv_decile: 9, customers: 3493, avg_ltv: 7034, avg_bookings: 10.9, pct_of_revenue: 19.0 },
            { ltv_decile: 8, customers: 3493, avg_ltv: 4273, avg_bookings: 5.6, pct_of_revenue: 11.6 },
            { ltv_decile: 7, customers: 3494, avg_ltv: 3270, avg_bookings: 4.3, pct_of_revenue: 8.8 },
          ],
        },
        {
          description: "LTV, booking frequency, and subscription rate split by WhatsApp opt-in to test whether opt-in is itself a value signal",
          sql: "SELECT whatsapp_opt_in,\n       COUNT(*) AS customers,\n       ROUND(AVG(total_spend_inr)) AS avg_ltv,\n       ROUND(AVG(total_bookings), 1) AS avg_bookings,\n       ROUND(100.0 * AVG(CASE WHEN subscription_active THEN 1 ELSE 0 END), 1) AS sub_pct\nFROM customers_full\nWHERE total_bookings >= 1\nGROUP BY whatsapp_opt_in\nORDER BY avg_ltv DESC;",
          rowCount: 2,
          executionTimeMs: 341,
          columns: ["whatsapp_opt_in", "customers", "avg_ltv", "avg_bookings", "sub_pct"],
          data: [
            { whatsapp_opt_in: false, customers: 6228, avg_ltv: 3758, avg_bookings: 5.3, sub_pct: 11.9 },
            { whatsapp_opt_in: true, customers: 28709, avg_ltv: 3684, avg_bookings: 5.2, sub_pct: 11.6 },
          ],
        },
        {
          description: "First-landing test category as a predictor of becoming a chronic subscriber (categories with > 500 customers)",
          sql: "SELECT first_landing_test_category,\n       COUNT(*) AS customers,\n       ROUND(100.0 * AVG(CASE WHEN archetype = 'chronic_subscriber' THEN 1 ELSE 0 END), 1) AS pct_chronic,\n       ROUND(100.0 * AVG(CASE WHEN subscription_active THEN 1 ELSE 0 END), 1) AS sub_pct,\n       ROUND(AVG(total_spend_inr)) AS avg_ltv\nFROM customers_full\nWHERE total_bookings >= 1\nGROUP BY first_landing_test_category\nHAVING COUNT(*) > 500\nORDER BY pct_chronic DESC\nLIMIT 6;",
          rowCount: 6,
          executionTimeMs: 458,
          columns: ["first_landing_test_category", "customers", "pct_chronic", "sub_pct", "avg_ltv"],
          data: [
            { first_landing_test_category: "vitamins", customers: 3920, pct_chronic: 12.2, sub_pct: 12.1, avg_ltv: 3808 },
            { first_landing_test_category: "diabetes", customers: 4177, pct_chronic: 12.0, sub_pct: 12.2, avg_ltv: 3717 },
            { first_landing_test_category: "fever", customers: 2809, pct_chronic: 11.1, sub_pct: 12.1, avg_ltv: 3644 },
            { first_landing_test_category: "hematology", customers: 3531, pct_chronic: 11.0, sub_pct: 11.4, avg_ltv: 3707 },
            { first_landing_test_category: "full_body", customers: 12108, pct_chronic: 10.8, sub_pct: 11.4, avg_ltv: 3696 },
            { first_landing_test_category: "thyroid", customers: 6275, pct_chronic: 10.8, sub_pct: 11.6, avg_ltv: 3660 },
          ],
        },
      ],
      summary:
        "Confirmed a 92.9% repeat-booking rate on 34,937 ever-booked customers with ₹3,697 average LTV; isolated subscription penetration (54.7% for chronic subscribers vs ~6% elsewhere) as the dividing line, showed the top three LTV deciles hold 64.6% of revenue, and found that neither WhatsApp opt-in nor first-landing category meaningfully predicts high value.",
    },
  }),
  normalThread({
    slug: "package-mix-revenue",
    title: "Which test packages carry our revenue?",
    question:
      "Which test categories and packages drive the most revenue, and what's the average ticket on each?",
    primaryAgent: { id: "rev-opt", name: "Revenue Optimization Agent", icon: "dollar" },
    answer:
      "## Full Body is the anchor, chronic panels are the tail\n\nAcross all booking line items, revenue concentrates in a handful of categories [rev-opt:Q1].\n\n| Test category | Bookings | Revenue | Avg price |\n|---|---:|---:|---:|\n| Full Body | 65,019 | **₹64.6M** | ₹993 |\n| Cardiac (Lipid) | 27,877 | ₹24.8M | ₹889 |\n| Diabetes (HbA1c) | 47,564 | ₹24.1M | ₹506 |\n| Thyroid | 37,150 | ₹18.0M | ₹484 |\n| Fever (Dengue/Typhoid) | 6,596 | ₹8.5M | **₹1,296** |\n| Kidney | 16,759 | ₹7.2M | ₹427 |\n| Vitamins | 8,773 | ₹4.0M | ₹458 |\n\nThe single **Healthy India 2026 Full Body Checkup Lite** alone accounts for **₹64.6M** across 65,019 bookings, the largest line item in the catalog [rev-opt:Q2].\n\n### Revenue is a four-category business\n\nLooking at line-item revenue with a running cumulative share, the top four categories (Full Body, Cardiac, Diabetes, Thyroid) account for **81.3%** of all test revenue [rev-opt:Q4]. Full Body alone is 39.5%. Everything below thyroid (fever, kidney, vitamins, hematology, liver) is a long tail that collectively adds under 19%.\n\n| Category | Revenue | Share | Cumulative |\n|---|---:|---:|---:|\n| Full Body | ₹64.7M | 39.5% | 39.5% |\n| Cardiac | ₹25.3M | 15.4% | 54.9% |\n| Diabetes | ₹24.4M | 14.9% | 69.8% |\n| Thyroid | ₹18.8M | 11.5% | **81.3%** |\n| Fever | ₹9.1M | 5.5% | 86.8% |\n\nSource: line-item revenue with cumulative share [rev-opt:Q4].\n\n### The mix is nearly identical across city tiers\n\nA common assumption is that metros buy premium panels and tier-2 buys cheap single tests. The data says otherwise: full-body share is **36.1% in metro, 36.2% in tier-1, 36.4% in tier-2**, and diabetes, thyroid, and cardiac shares are within a point of each other across all three tiers [rev-opt:Q5]. The catalog mix is essentially the same everywhere, so a single national packaging and pricing strategy holds.\n\n### Clinical risk is concentrated in the chronic panels\n\nWhere the categories differ sharply is in how often they come back abnormal. Vitamins reports carry a **48.2% critical-flag rate**, thyroid 38.6%, and diabetes 38.0%, all well above full body's 35.5% [rev-opt:Q6]. These are exactly the chronic panels that should feed a recurring monitoring subscription, because the customer is statistically likely to get a result that warrants a retest.\n\n| Category | Reports | Critical flag | Abnormal |\n|---|---:|---:|---:|\n| Vitamins | 7,720 | **48.2%** | 98.0% |\n| Thyroid | 32,445 | 38.6% | 97.5% |\n| Diabetes | 41,276 | 38.0% | 97.7% |\n| Full Body | 56,720 | 35.5% | 97.4% |\n\nSource: abnormal/critical rate by report category [rev-opt:Q6].\n\n**Takeaway:** Full Body is the acquisition magnet but a low-margin loss-leader at ₹993; the recurring chronic panels (HbA1c, Lipid, Thyroid, Vitamin D) are smaller tickets that come back quarter after quarter and carry the highest abnormal-result rates, which is exactly what should trigger a subscription. Fever tests have the highest average price but are seasonal and one-off. The mix is uniform across tiers, so acquire on Full Body nationally and monetize on the chronic tail.\n\nWant me to map which Full Body customers convert into a recurring chronic panel?",
    followUps: [
      "What share of Full Body customers ever book a second category?",
      "Which package has the highest abnormal-result rate?",
      "How does test mix differ between metro and tier-2 cities?",
      "Which packages are most often added as a family bundle?",
    ],
    work: {
      queries: [
        {
          description: "Revenue, booking volume, and average price by test category",
          sql: "SELECT test_category,\n       COUNT(*) AS bookings,\n       ROUND(SUM(item_price_inr)) AS revenue,\n       ROUND(AVG(item_price_inr)) AS avg_price\nFROM bookings_full\nGROUP BY test_category\nORDER BY revenue DESC\nLIMIT 10;",
          rowCount: 9,
          executionTimeMs: 624,
          columns: ["test_category", "bookings", "revenue", "avg_price"],
          data: [
            { test_category: "full_body", bookings: 65019, revenue: 64580787, avg_price: 993 },
            { test_category: "cardiac", bookings: 27877, revenue: 24773406, avg_price: 889 },
            { test_category: "diabetes", bookings: 47564, revenue: 24052800, avg_price: 506 },
            { test_category: "thyroid", bookings: 37150, revenue: 17998261, avg_price: 484 },
            { test_category: "fever", bookings: 6596, revenue: 8549448, avg_price: 1296 },
            { test_category: "kidney", bookings: 16759, revenue: 7156093, avg_price: 427 },
            { test_category: "hematology", bookings: 11884, revenue: 4634760, avg_price: 390 },
            { test_category: "vitamins", bookings: 8773, revenue: 4016272, avg_price: 458 },
            { test_category: "liver", bookings: 9319, revenue: 3531901, avg_price: 379 },
          ],
        },
        {
          description: "Top individual test packages by revenue",
          sql: "SELECT test_name,\n       COUNT(*) AS bookings,\n       ROUND(SUM(item_price_inr)) AS revenue\nFROM bookings_full\nGROUP BY test_name\nORDER BY revenue DESC\nLIMIT 5;",
          rowCount: 5,
          executionTimeMs: 581,
          columns: ["test_name", "bookings", "revenue"],
          data: [
            { test_name: "Healthy India 2026 Full Body Checkup Lite", bookings: 65019, revenue: 64580787 },
            { test_name: "Lipid Profile Advance", bookings: 27877, revenue: 24773406 },
            { test_name: "HbA1c", bookings: 47564, revenue: 24052800 },
            { test_name: "Thyroid Package Preventive", bookings: 37150, revenue: 17998261 },
            { test_name: "Dengue Test", bookings: 6596, revenue: 8549448 },
          ],
        },
        {
          description: "Share of Full Body customers who go on to book at least one other test category",
          sql: "WITH fb AS (\n  SELECT DISTINCT customer_id FROM bookings_full WHERE test_category = 'full_body'\n),\ncats AS (\n  SELECT customer_id, COUNT(DISTINCT test_category) AS n FROM bookings_full GROUP BY customer_id\n)\nSELECT COUNT(*) AS full_body_customers,\n       ROUND(100.0 * AVG(CASE WHEN c.n >= 2 THEN 1 ELSE 0 END), 1) AS pct_multi_category\nFROM fb\nJOIN cats c ON c.customer_id = fb.customer_id;",
          rowCount: 1,
          executionTimeMs: 893,
          columns: ["full_body_customers", "pct_multi_category"],
          data: [{ full_body_customers: 19280, pct_multi_category: 79.9 }],
        },
        {
          description: "Line-item revenue by category with each category's revenue share and a running cumulative share (concentration)",
          sql: "WITH cat AS (\n  SELECT test_category, COUNT(*) AS bookings, SUM(item_price_inr) AS revenue, AVG(item_price_inr) AS avg_price\n  FROM booking_items_full\n  GROUP BY test_category\n)\nSELECT test_category,\n       bookings,\n       ROUND(revenue) AS revenue,\n       ROUND(avg_price) AS avg_price,\n       ROUND(100.0 * revenue / SUM(revenue) OVER (), 1) AS pct_rev,\n       ROUND(100.0 * SUM(revenue) OVER (ORDER BY revenue DESC) / SUM(revenue) OVER (), 1) AS cum_pct\nFROM cat\nORDER BY revenue DESC\nLIMIT 8;",
          rowCount: 8,
          executionTimeMs: 947,
          columns: ["test_category", "bookings", "revenue", "avg_price", "pct_rev", "cum_pct"],
          data: [
            { test_category: "full_body", bookings: 66107, revenue: 64688499, avg_price: 979, pct_rev: 39.5, cum_pct: 39.5 },
            { test_category: "cardiac", bookings: 28911, revenue: 25287304, avg_price: 875, pct_rev: 15.4, cum_pct: 54.9 },
            { test_category: "diabetes", bookings: 48441, revenue: 24368520, avg_price: 503, pct_rev: 14.9, cum_pct: 69.8 },
            { test_category: "thyroid", bookings: 39175, revenue: 18817054, avg_price: 480, pct_rev: 11.5, cum_pct: 81.3 },
            { test_category: "fever", bookings: 7725, revenue: 9067659, avg_price: 1174, pct_rev: 5.5, cum_pct: 86.8 },
            { test_category: "kidney", bookings: 17744, revenue: 7576688, avg_price: 427, pct_rev: 4.6, cum_pct: 91.4 },
            { test_category: "vitamins", bookings: 10926, revenue: 5105989, avg_price: 467, pct_rev: 3.1, cum_pct: 94.5 },
            { test_category: "hematology", bookings: 12904, revenue: 5032560, avg_price: 390, pct_rev: 3.1, cum_pct: 97.6 },
          ],
        },
        {
          description: "Category mix as a share of each city tier's bookings, to test whether metro and tier-2 buy a different catalog",
          sql: "SELECT city_tier, test_category,\n       COUNT(*) AS bookings,\n       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (PARTITION BY city_tier), 1) AS pct_of_tier\nFROM booking_items_full\nWHERE test_category IN ('full_body', 'diabetes', 'thyroid', 'cardiac')\nGROUP BY city_tier, test_category\nORDER BY city_tier, bookings DESC;",
          rowCount: 12,
          executionTimeMs: 1063,
          columns: ["city_tier", "test_category", "bookings", "pct_of_tier"],
          data: [
            { city_tier: "metro", test_category: "full_body", bookings: 24898, pct_of_tier: 36.1 },
            { city_tier: "metro", test_category: "diabetes", bookings: 18163, pct_of_tier: 26.3 },
            { city_tier: "metro", test_category: "thyroid", bookings: 15179, pct_of_tier: 22.0 },
            { city_tier: "metro", test_category: "cardiac", bookings: 10795, pct_of_tier: 15.6 },
            { city_tier: "tier1", test_category: "full_body", bookings: 18466, pct_of_tier: 36.2 },
            { city_tier: "tier1", test_category: "diabetes", bookings: 13589, pct_of_tier: 26.6 },
            { city_tier: "tier1", test_category: "thyroid", bookings: 10824, pct_of_tier: 21.2 },
            { city_tier: "tier1", test_category: "cardiac", bookings: 8175, pct_of_tier: 16.0 },
            { city_tier: "tier2", test_category: "full_body", bookings: 22743, pct_of_tier: 36.4 },
            { city_tier: "tier2", test_category: "diabetes", bookings: 16689, pct_of_tier: 26.7 },
            { city_tier: "tier2", test_category: "thyroid", bookings: 13172, pct_of_tier: 21.1 },
            { city_tier: "tier2", test_category: "cardiac", bookings: 9941, pct_of_tier: 15.9 },
          ],
        },
        {
          description: "Abnormal and critical-flag rate by report test category (categories with > 3,000 reports), surfacing where clinical risk concentrates",
          sql: "SELECT test_category,\n       COUNT(*) AS reports,\n       ROUND(100.0 * AVG(CASE WHEN critical_params_count > 0 THEN 1 ELSE 0 END), 1) AS pct_critical,\n       ROUND(100.0 * AVG(CASE WHEN abnormal_params_count > 0 THEN 1 ELSE 0 END), 1) AS pct_abnormal\nFROM reports_full\nGROUP BY test_category\nHAVING COUNT(*) > 3000\nORDER BY pct_critical DESC\nLIMIT 6;",
          rowCount: 6,
          executionTimeMs: 884,
          columns: ["test_category", "reports", "pct_critical", "pct_abnormal"],
          data: [
            { test_category: "vitamins", reports: 7720, pct_critical: 48.2, pct_abnormal: 98.0 },
            { test_category: "thyroid", reports: 32445, pct_critical: 38.6, pct_abnormal: 97.5 },
            { test_category: "diabetes", reports: 41276, pct_critical: 38.0, pct_abnormal: 97.7 },
            { test_category: "hematology", reports: 10415, pct_critical: 35.8, pct_abnormal: 97.6 },
            { test_category: "full_body", reports: 56720, pct_critical: 35.5, pct_abnormal: 97.4 },
            { test_category: "liver", reports: 8154, pct_critical: 35.4, pct_abnormal: 97.4 },
          ],
        },
      ],
      summary:
        "Full Body drives ₹64.6M (its single Healthy India Lite SKU); the top four categories hold 81.3% of line-item revenue; 79.9% of the 19,280 Full Body customers book a second category; the catalog mix is near-identical across city tiers; and clinical risk concentrates in the chronic panels (vitamins 48.2% critical, thyroid 38.6%, diabetes 38.0%), which is exactly where subscriptions should be triggered.",
    },
  }),
];

const deeps: StarterChat[] = [
  deepResearchThread({
    slug: "abnormal-to-followup-leak",
    title: "How much revenue are we leaving on the table from abnormal results?",
    question:
      "When a report comes back abnormal or critical, how often does that turn into a follow-up booking, where do we lose people, and what's the recoverable revenue?",
    report:
      "## The abnormal-to-follow-up gap is our single largest clinical revenue leak\n\nClinical urgency is almost never the bottleneck: **97.5%** of the 201,220 reports contain at least one abnormal parameter and **36.5%** carry a critical flag [data-quality:Q1]. Reports are also seen fast (84.8% viewed, average 4.6 hours to first view) [data-quality:Q1]. The leak is entirely in the journey *after* the result lands. This analysis traces that journey end to end: from report generation, through the view and counseling steps, to the follow-up booking, and then sizes the recoverable revenue with conservative assumptions.\n\n### Executive summary\n\nThe at-home diagnostics funnel does its clinical job well. Abnormal results are detected, reports are released, and customers open them quickly. But the single step that converts an abnormal result into a follow-up booking, the counseling session, is applied almost at random with respect to clinical severity. A customer with a critical flag is barely more likely to be counseled than one whose report is clean, and without counseling the follow-up rate is effectively zero. The result is a large pool of clinically urgent customers who view a worrying result and then do nothing, because nobody walked them through the next test. We size that pool at **46,938 uncounseled critical-flag customers** and the recoverable revenue at **₹13.35M** on conservative assumptions.\n\n### Methodology and data\n\nWe joined the completed-booking ledger (`bookings_full`) to the report ledger (`reports_full`) on `booking_id`, bucketing each report into critical, abnormal-non-critical, or normal by parameter flag counts. Follow-up is measured as `follow_up_booked` on the originating booking. Counseling sessions (`counseling_full`) were analyzed separately by counselor type, latency, and outcome. Revenue is valued at the average repeat (non-first) completed-booking ticket of **₹758** [rev-opt:Q3]. All percentages are computed over completed bookings only, so cancellations and no-shows do not inflate the denominator.\n\n### Follow-up is gated by one thing: counseling\n\n| Report severity | Counseling taken | Bookings | Follow-up rate |\n|---|---|---:|---:|\n| Critical flag | No | 46,938 | **0.0%** |\n| Critical flag | Yes | 26,596 | 37.5% |\n| Abnormal (non-critical) | No | 78,809 | 0.0% |\n| Abnormal (non-critical) | Yes | 43,796 | 37.9% |\n| Normal | Yes | 1,852 | 40.0% |\n\nWithout a counseling session, follow-up booking is effectively **zero**; with one, it jumps to **~38%** regardless of severity [rev-opt:Q1]. Counseling is the on/off switch for the entire follow-up funnel. Notably the follow-up rate barely moves across severity tiers once counseling happens (37.5% critical, 37.9% abnormal, 40.0% normal), which tells us the conversion mechanism is the conversation itself, not the scariness of the result.\n\n### The view step is not the problem\n\nBefore blaming counseling, we checked whether customers simply are not seeing critical results. They are. View rate and view latency are flat across severity: customers with two or more critical parameters view at **84.7%** with a median **4.5 hours** to first view, statistically identical to customers with zero critical flags [data-quality:Q2]. Reports are read on the Android app (61.9% of views), web (19.9%), and iOS (18.1%) [data-quality:Q3]. So the customer sees the bad result, fast, on a channel we control, and still does not book, because the counseling handoff never fires.\n\n### We counsel the sick no better than the well\n\n| Cohort | Bookings | Counseled |\n|---|---:|---:|\n| All completed bookings | 222,455 | **32.5%** |\n| Critical-flag reports | 73,534 | **36.2%** |\n\nA critical result lifts counseling uptake by less than 4 points [rev-opt:Q2]. **46,938 customers with a critical flag never got a counseling session** [rev-opt:Q1] and, predictably, almost none of them booked a follow-up.\n\n### Counseling speed and quality are not the problem either\n\nCounseling latency does not change the outcome: whether the session happens within a day, in two to three days, or in four to seven days, the follow-up recommendation rate holds at 37.6% to 38.0% and satisfaction at ~4.05 [cohort-retention:Q1]. And the counselor type does not matter:\n\n| Counselor | Sessions | Recommends follow-up | Satisfaction |\n|---|---:|---:|---:|\n| AI advisor | 46,407 | 37.7% | 4.05 / 5 |\n| Human advisor | 28,778 | 38.0% | 4.06 / 5 |\n\nAI and human advisors convert and satisfy near-identically [user-segmentation:Q1], and their session-outcome mix is also nearly identical (around 40% lifestyle advice, 32% follow-up tests, 18% normal-dismissed, 10% prescription) [user-segmentation:Q2]. Scaling counseling coverage therefore does not require scaling headcount, and it does not require getting faster. It requires firing the session at all, for the right people.\n\n### Where the leak sits geographically\n\nThe uncounseled-critical pool is spread across all three city tiers, weighted toward metro by sheer volume: **metro holds 39.1% (18,362 customers), tier-2 32.6% (15,283), and tier-1 28.3% (13,293)** [geographic:Q1]. This is not a tier-2 logistics story; it is a system-wide counseling-routing gap.\n\n### Almost everyone in the leak is reachable today\n\nOf the 46,938 uncounseled critical customers, **38,475 (82%) are WhatsApp opt-in** [rev-opt:Q5]. We do not need to acquire a channel or wait for consent. The list of people to message exists, is clinically urgent, and is reachable on the highest-converting rail we run.\n\n### Sizing the recoverable revenue\n\nApplying the proven counseled-critical follow-up rate (37.5%) [rev-opt:Q1] to the 46,938 uncounseled critical customers, at the ₹758 average ticket of a repeat booking [rev-opt:Q3] and validated by an end-to-end SQL computation [rev-opt:Q4]:\n\n| Driver | Value |\n|---|---:|\n| Uncounseled critical-flag customers | 46,938 |\n| Proven counseled follow-up rate | 37.5% |\n| Average repeat-booking value | ₹758 |\n| **Recoverable annual revenue** | **₹13.35M** |\n\n### Risks and caveats\n\n- The ₹13.35M assumes uncounseled critical customers would convert at the *same* 37.5% as those who currently opt into counseling. Customers who were not counseled may be systematically less engaged, so treat this as an upper bound and target half (~₹6.7M) as the realistic first-year recovery.\n- The ₹758 ticket is the historical repeat average; a counseling-driven follow-up may skew toward a specific chronic panel with a different price.\n- Follow-up is attributed at the booking level; some customers may book a follow-up that the data does not link back to the originating critical report.\n\n### Key Findings\n\n- Counseling is binary: **0% follow-up without it, ~38% with it** [rev-opt:Q1]. Nothing else moves the funnel as much.\n- The view step is healthy and severity-blind: critical reports are viewed at 84.7% in a median 4.5 hours [data-quality:Q2], so the gap is the counseling handoff, not awareness.\n- We do **not** prioritize counseling by clinical severity: critical patients are counseled at 36.2% vs 32.5% overall [rev-opt:Q2].\n- **46,938 critical-flag customers** went uncounseled, the bulk of the leak [rev-opt:Q1], and 82% of them are WhatsApp-reachable right now [rev-opt:Q5].\n- AI counseling matches human counseling on conversion, satisfaction, and outcome mix [user-segmentation:Q1][user-segmentation:Q2], so the fix is cheap to scale.\n\n### Recommended Actions\n\n1. **Auto-route every critical-flag report into an AI counseling session** within the same-day view window. Closing even half this gap recovers ~₹6.7M.\n2. **Trigger the counseling nudge over WhatsApp** rather than email, given WhatsApp's far higher open and conversion economics and the 38,475 opt-in customers already sitting in the leak [rev-opt:Q5].\n3. **Set a counseling-coverage SLA on critical reports** (target 80%+) and track it as a clinical-ops KPI, not a marketing one, across all three city tiers given the leak is system-wide [geographic:Q1].\n4. **A/B human vs AI on the highest-severity tier only** to confirm parity holds where stakes are highest, then default the rest to AI.\n5. **Chain counseling into a subscription prompt** so a recommended retest on a chronic parameter rolls straight onto a recurring plan rather than a one-off booking.\n\n```sql\n-- Follow-up conversion gated by counseling, split by report severity\nWITH report_bookings AS (\n  SELECT\n    b.booking_id,\n    b.counseling_taken,\n    b.follow_up_booked,\n    CASE\n      WHEN rep.critical_params_count > 0 THEN 'critical'\n      WHEN rep.abnormal_params_count > 0 THEN 'abnormal_noncritical'\n      ELSE 'normal'\n    END AS severity\n  FROM bookings_full b\n  JOIN reports_full rep ON rep.booking_id = b.booking_id\n  WHERE b.booking_status = 'completed'\n)\nSELECT\n  severity,\n  counseling_taken,\n  COUNT(*)                                                   AS bookings,\n  ROUND(100.0 * AVG(CASE WHEN follow_up_booked THEN 1 ELSE 0 END), 1) AS follow_up_pct\nFROM report_bookings\nGROUP BY severity, counseling_taken\nORDER BY severity, counseling_taken;\n```",
    followUps: [
      "Break the ₹13.34M leak down by city tier so ops can prioritize.",
      "Which test categories produce the most uncounseled critical reports?",
      "What's the follow-up rate when counseling happens within 24 hours vs later?",
      "How many of these uncounseled customers are WhatsApp opt-in and reachable today?",
    ],
    work: {
      "data-quality": {
        queries: [
          {
            description: "Report quality overview: abnormal/critical prevalence and view behavior across all reports",
            sql: "SELECT COUNT(*) AS reports,\n       ROUND(100.0 * AVG(CASE WHEN abnormal_params_count > 0 THEN 1 ELSE 0 END), 1) AS pct_abnormal,\n       ROUND(100.0 * AVG(CASE WHEN critical_params_count > 0 THEN 1 ELSE 0 END), 1) AS pct_critical,\n       ROUND(100.0 * AVG(CASE WHEN report_viewed THEN 1 ELSE 0 END), 1) AS pct_viewed,\n       ROUND(AVG(time_to_view_hours), 1) AS avg_view_hrs\nFROM reports_full;",
            rowCount: 1,
            executionTimeMs: 706,
            columns: ["reports", "pct_abnormal", "pct_critical", "pct_viewed", "avg_view_hrs"],
            data: [{ reports: 201220, pct_abnormal: 97.5, pct_critical: 36.5, pct_viewed: 84.8, avg_view_hrs: 4.6 }],
          },
          {
            description: "View rate and view-latency percentiles by critical-flag bucket, to test whether sicker customers fail to view",
            sql: "SELECT critical_bucket,\n       COUNT(*) AS reports,\n       ROUND(100.0 * AVG(CASE WHEN report_viewed THEN 1 ELSE 0 END), 1) AS pct_viewed,\n       ROUND(quantile_cont(time_to_view_hours, 0.5), 1) AS median_view_hrs,\n       ROUND(quantile_cont(time_to_view_hours, 0.9), 1) AS p90_view_hrs\nFROM reports_full\nGROUP BY critical_bucket\nORDER BY reports DESC;",
            rowCount: 3,
            executionTimeMs: 1142,
            columns: ["critical_bucket", "reports", "pct_viewed", "median_view_hrs", "p90_view_hrs"],
            data: [
              { critical_bucket: "0", reports: 127686, pct_viewed: 84.8, median_view_hrs: 4.5, p90_view_hrs: 8.6 },
              { critical_bucket: "1", reports: 36899, pct_viewed: 84.9, median_view_hrs: 4.5, p90_view_hrs: 8.6 },
              { critical_bucket: "2+", reports: 36635, pct_viewed: 84.7, median_view_hrs: 4.5, p90_view_hrs: 8.6 },
            ],
          },
          {
            description: "Platform mix of report views, confirming the report is read on channels we control",
            sql: "SELECT report_view_platform,\n       COUNT(*) AS reports,\n       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct\nFROM reports_full\nWHERE report_viewed\nGROUP BY report_view_platform\nORDER BY reports DESC\nLIMIT 5;",
            rowCount: 3,
            executionTimeMs: 698,
            columns: ["report_view_platform", "reports", "pct"],
            data: [
              { report_view_platform: "app_android", reports: 105653, pct: 61.9 },
              { report_view_platform: "web", reports: 33979, pct: 19.9 },
              { report_view_platform: "app_ios", reports: 30944, pct: 18.1 },
            ],
          },
        ],
        summary:
          "Clinical urgency is not the bottleneck: 97.5% of 201,220 reports are abnormal, 36.5% critical, and 84.8% are viewed within an average 4.6 hours; the view step is severity-blind (critical reports view at 84.7%, median 4.5 hours) and happens on channels we control (62% Android app).",
      },
      "rev-opt": {
        queries: [
          {
            description: "Follow-up conversion gated by counseling, split by report severity",
            sql: "WITH report_bookings AS (\n  SELECT b.booking_id, b.counseling_taken, b.follow_up_booked,\n    CASE WHEN rep.critical_params_count > 0 THEN 'critical'\n         WHEN rep.abnormal_params_count > 0 THEN 'abnormal_noncritical'\n         ELSE 'normal' END AS severity\n  FROM bookings_full b\n  JOIN reports_full rep ON rep.booking_id = b.booking_id\n  WHERE b.booking_status = 'completed'\n)\nSELECT severity, counseling_taken, COUNT(*) AS bookings,\n       ROUND(100.0 * AVG(CASE WHEN follow_up_booked THEN 1 ELSE 0 END), 1) AS follow_up_pct\nFROM report_bookings\nGROUP BY severity, counseling_taken\nORDER BY severity, counseling_taken;",
            rowCount: 6,
            executionTimeMs: 1842,
            columns: ["severity", "counseling_taken", "bookings", "follow_up_pct"],
            data: [
              { severity: "abnormal_noncritical", counseling_taken: false, bookings: 78809, follow_up_pct: 0 },
              { severity: "abnormal_noncritical", counseling_taken: true, bookings: 43796, follow_up_pct: 37.9 },
              { severity: "critical", counseling_taken: false, bookings: 46938, follow_up_pct: 0 },
              { severity: "critical", counseling_taken: true, bookings: 26596, follow_up_pct: 37.5 },
              { severity: "normal", counseling_taken: false, bookings: 3229, follow_up_pct: 0 },
              { severity: "normal", counseling_taken: true, bookings: 1852, follow_up_pct: 40 },
            ],
          },
          {
            description: "Counseling coverage on all completed bookings versus critical-flag bookings",
            sql: "SELECT 'all_completed' AS cohort, COUNT(*) AS bookings,\n       ROUND(100.0 * AVG(CASE WHEN counseling_taken THEN 1 ELSE 0 END), 1) AS counseled_pct\nFROM bookings_full WHERE booking_status = 'completed'\nUNION ALL\nSELECT 'critical_flag', COUNT(*),\n       ROUND(100.0 * AVG(CASE WHEN b.counseling_taken THEN 1 ELSE 0 END), 1)\nFROM bookings_full b\nJOIN reports_full r ON r.booking_id = b.booking_id\nWHERE b.booking_status = 'completed' AND r.critical_params_count > 0;",
            rowCount: 2,
            executionTimeMs: 1577,
            columns: ["cohort", "bookings", "counseled_pct"],
            data: [
              { cohort: "all_completed", bookings: 222455, counseled_pct: 32.5 },
              { cohort: "critical_flag", bookings: 73534, counseled_pct: 36.2 },
            ],
          },
          {
            description: "Average ticket on a repeat (non-first) completed booking, used to value recovered follow-ups",
            sql: "SELECT ROUND(AVG(total_paid_inr)) AS avg_repeat_ticket\nFROM bookings_full\nWHERE booking_status = 'completed' AND is_first_booking = false;",
            rowCount: 1,
            executionTimeMs: 489,
            columns: ["avg_repeat_ticket"],
            data: [{ avg_repeat_ticket: 758 }],
          },
          {
            description: "End-to-end recoverable-revenue computation: uncounseled critical customers times the proven counseled follow-up rate times the repeat ticket",
            sql: "WITH uncounseled_crit AS (\n  SELECT COUNT(*) AS n\n  FROM bookings_full b\n  JOIN reports_full r ON r.booking_id = b.booking_id\n  WHERE b.booking_status = 'completed' AND r.critical_params_count > 0 AND b.counseling_taken = false\n),\ntkt AS (\n  SELECT AVG(total_paid_inr) AS t\n  FROM bookings_full\n  WHERE booking_status = 'completed' AND is_first_booking = false\n)\nSELECT u.n AS uncounseled_critical,\n       0.375 AS proven_rate,\n       ROUND(t.t) AS avg_ticket,\n       ROUND(u.n * 0.375 * t.t) AS recoverable_inr\nFROM uncounseled_crit u, tkt t;",
            rowCount: 1,
            executionTimeMs: 1934,
            columns: ["uncounseled_critical", "proven_rate", "avg_ticket", "recoverable_inr"],
            data: [{ uncounseled_critical: 46938, proven_rate: 0.375, avg_ticket: 758, recoverable_inr: 13350291 }],
          },
          {
            description: "WhatsApp reachability of the uncounseled critical pool, sizing the audience we can message today",
            sql: "SELECT b.whatsapp_opt_in,\n       COUNT(*) AS uncounseled_critical\nFROM bookings_full b\nJOIN reports_full r ON r.booking_id = b.booking_id\nWHERE b.booking_status = 'completed' AND r.critical_params_count > 0 AND b.counseling_taken = false\nGROUP BY b.whatsapp_opt_in;",
            rowCount: 2,
            executionTimeMs: 1688,
            columns: ["whatsapp_opt_in", "uncounseled_critical"],
            data: [
              { whatsapp_opt_in: true, uncounseled_critical: 38475 },
              { whatsapp_opt_in: false, uncounseled_critical: 8463 },
            ],
          },
        ],
        summary:
          "Follow-up booking is ~0% without counseling and ~38% with it regardless of severity; only 36.2% of critical-flag bookings are counseled (vs 32.5% overall), leaving 46,938 uncounseled critical customers worth ₹13.35M at the ₹758 repeat ticket, and 82% (38,475) of them are WhatsApp-reachable today.",
      },
      "user-segmentation": {
        queries: [
          {
            description: "AI versus human counselor: session volume, follow-up recommendation rate, and satisfaction",
            sql: "SELECT counselor_type,\n       COUNT(*) AS sessions,\n       ROUND(100.0 * AVG(CASE WHEN follow_up_recommended THEN 1 ELSE 0 END), 1) AS rec_pct,\n       ROUND(AVG(satisfaction_score), 2) AS satisfaction\nFROM counseling_full\nGROUP BY counselor_type;",
            rowCount: 2,
            executionTimeMs: 643,
            columns: ["counselor_type", "sessions", "rec_pct", "satisfaction"],
            data: [
              { counselor_type: "ai", sessions: 46407, rec_pct: 37.7, satisfaction: 4.05 },
              { counselor_type: "human_advisor", sessions: 28778, rec_pct: 38.0, satisfaction: 4.06 },
            ],
          },
          {
            description: "Session-outcome distribution by counselor type, using a partitioned window to compute each type's outcome mix",
            sql: "SELECT counselor_type, outcome,\n       COUNT(*) AS sessions,\n       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (PARTITION BY counselor_type), 1) AS pct\nFROM counseling_full\nGROUP BY counselor_type, outcome\nORDER BY counselor_type, sessions DESC;",
            rowCount: 8,
            executionTimeMs: 854,
            columns: ["counselor_type", "outcome", "sessions", "pct"],
            data: [
              { counselor_type: "ai", outcome: "lifestyle_advice", sessions: 18625, pct: 40.1 },
              { counselor_type: "ai", outcome: "follow_up_tests", sessions: 14880, pct: 32.1 },
              { counselor_type: "ai", outcome: "normal_dismissed", sessions: 8329, pct: 17.9 },
              { counselor_type: "ai", outcome: "prescription_given", sessions: 4573, pct: 9.9 },
              { counselor_type: "human_advisor", outcome: "lifestyle_advice", sessions: 11446, pct: 39.8 },
              { counselor_type: "human_advisor", outcome: "follow_up_tests", sessions: 9307, pct: 32.3 },
              { counselor_type: "human_advisor", outcome: "normal_dismissed", sessions: 5088, pct: 17.7 },
              { counselor_type: "human_advisor", outcome: "prescription_given", sessions: 2937, pct: 10.2 },
            ],
          },
        ],
        summary:
          "AI and human advisors convert (37.7% vs 38.0% follow-up recommendation) and satisfy (4.05 vs 4.06) near-identically, and their outcome mix is nearly identical (around 40% lifestyle advice, 32% follow-up tests), so counseling coverage can scale on AI without adding headcount.",
      },
      "cohort-retention": {
        queries: [
          {
            description: "Counseling latency versus follow-up recommendation rate and satisfaction, testing whether speed of counseling matters",
            sql: "SELECT CASE WHEN days_after_report <= 1 THEN '0-1 day'\n            WHEN days_after_report <= 3 THEN '2-3 days'\n            WHEN days_after_report <= 7 THEN '4-7 days'\n            ELSE '8+ days' END AS counsel_latency,\n       COUNT(*) AS sessions,\n       ROUND(100.0 * AVG(CASE WHEN follow_up_recommended THEN 1 ELSE 0 END), 1) AS rec_pct,\n       ROUND(AVG(satisfaction_score), 2) AS satisfaction\nFROM counseling_full\nGROUP BY counsel_latency\nORDER BY counsel_latency;",
            rowCount: 3,
            executionTimeMs: 766,
            columns: ["counsel_latency", "sessions", "rec_pct", "satisfaction"],
            data: [
              { counsel_latency: "0-1 day", sessions: 24953, rec_pct: 37.6, satisfaction: 4.06 },
              { counsel_latency: "2-3 days", sessions: 25050, rec_pct: 37.8, satisfaction: 4.05 },
              { counsel_latency: "4-7 days", sessions: 25182, rec_pct: 38.0, satisfaction: 4.06 },
            ],
          },
        ],
        summary:
          "Counseling speed does not change the outcome: the follow-up recommendation rate holds at 37.6% to 38.0% and satisfaction at ~4.05 whether counseling happens in a day or in a week, so the lever is firing the session at all, not firing it faster.",
      },
      geographic: {
        queries: [
          {
            description: "The uncounseled critical-flag pool split by city tier, with each tier's share of the total leak",
            sql: "SELECT b.city_tier,\n       COUNT(*) AS uncounseled_critical,\n       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct_of_leak\nFROM bookings_full b\nJOIN reports_full r ON r.booking_id = b.booking_id\nWHERE b.booking_status = 'completed' AND r.critical_params_count > 0 AND b.counseling_taken = false\nGROUP BY b.city_tier\nORDER BY uncounseled_critical DESC;",
            rowCount: 3,
            executionTimeMs: 1572,
            columns: ["city_tier", "uncounseled_critical", "pct_of_leak"],
            data: [
              { city_tier: "metro", uncounseled_critical: 18362, pct_of_leak: 39.1 },
              { city_tier: "tier2", uncounseled_critical: 15283, pct_of_leak: 32.6 },
              { city_tier: "tier1", uncounseled_critical: 13293, pct_of_leak: 28.3 },
            ],
          },
        ],
        summary:
          "The uncounseled critical leak is system-wide, not a tier-2 problem: metro holds 39.1% (18,362), tier-2 32.6% (15,283), and tier-1 28.3% (13,293), so the counseling-coverage SLA must apply nationally.",
      },
    },
  }),
  deepResearchThread({
    slug: "repeat-subscription-engine",
    title: "What is our repeat and subscription engine really worth?",
    question:
      "How strong is our repeat-purchase and subscription engine, what's the LTV lift from a subscription, and where is the biggest untapped expansion?",
    report:
      "## Repeats already carry the business; subscriptions are the under-built multiplier\n\n**92.9%** of customers who have ever booked come back [cohort-retention:Q1], and the base averages **₹3,661** lifetime value across 35,284 customers [rev-opt:Q1]. But the recurring engine that should compound this, subscriptions, is barely switched on.\n\n### Executive summary\n\nHealthians has solved retention and not yet solved recurrence. Almost every customer who books once books again, so the top-of-funnel and the product experience are working. What is missing is the rail that turns a loyal repeat customer into a predictable, scheduled, higher-value subscriber. Only 11.6% of the base holds an active subscription, yet a subscription more than doubles lifetime value. The opportunity is not to acquire more customers or to retain them better; it is to convert the large, already-loyal middle of the base onto a recurring plan. The clearest target is the health_anxious archetype, which repeats like a subscriber (99.3%) and carries near-top LTV (₹7,863) but subscribes at only 6.3%.\n\n### Methodology and data\n\nWe measured repeat behavior and LTV from the customer ledger (`customers_full`), splitting by `subscription_active` and by `archetype`. Subscription health (adherence, test mix, run completion) came from `subscriptions_full` and `subscription_runs_full`. We built signup-quarter cohorts with `date_trunc` to confirm the repeat and subscription rates are stable over time rather than an artifact of one acquisition wave. The LTV lift is the difference in average `total_spend_inr` between active subscribers and non-subscribers; the conversion sizing applies that lift to a 10% conversion of the target segment.\n\n### A subscription more than doubles lifetime value\n\n| Customer | Count | Avg bookings | Avg LTV |\n|---|---:|---:|---:|\n| Active subscription | 4,094 | 10.6 | **₹6,976** |\n| No subscription | 31,190 | 4.5 | ₹3,226 |\n\nSubscribers are worth **2.2x** a non-subscriber and book **2.4x** as often [rev-opt:Q1], yet only **11.6%** of the base has an active subscription [rev-opt:Q1]. The gap between ₹6,976 and ₹3,226 is a **+₹3,750** per-customer prize sitting behind a single behavior change.\n\n### LTV is concentrated in two archetypes that already subscribe\n\n| Archetype | Customers | Avg LTV | Active sub | Repeat rate |\n|---|---:|---:|---:|---:|\n| Chronic subscriber | 3,899 | ₹10,910 | **54.7%** | 100% |\n| Health anxious | 2,830 | ₹7,863 | 6.3% | 99.3% |\n| Doctor referred | 4,240 | ₹3,010 | 5.9% | 96.5% |\n| Reactive booker | 7,425 | ₹2,643 | 6.6% | 85.6% |\n| Annual checker | 9,858 | ₹2,246 | 6.1% | 84.1% |\n| One and done | 7,032 | ₹1,401 | 6.3% | 99.5% |\n\nSource: per-archetype penetration [cohort-retention:Q2]. The **health_anxious** segment is the standout opportunity: 99.3% already repeat and ₹7,863 LTV, but only 6.3% subscribe. They behave like subscribers without the recurring rail.\n\n### The pattern is stable across signup cohorts\n\nThis is not a one-off. Splitting customers by signup quarter, repeat rate holds at **95% to 96%** and subscription penetration at **10.6% to 13.0%** in every cohort from 2024-Q3 through 2025-Q4 [cohort-retention:Q3]. The under-penetration of subscriptions is a persistent, structural gap, not a recent dip, which means the fix is a durable product change rather than a campaign.\n\n| Signup cohort | Customers | Repeat rate | Sub rate | Avg LTV |\n|---|---:|---:|---:|---:|\n| 2024-Q3 | 2,413 | 95.8% | 11.6% | ₹3,751 |\n| 2024-Q4 | 2,480 | 96.3% | 10.6% | ₹3,673 |\n| 2025-Q1 | 2,391 | 95.9% | 11.8% | ₹3,747 |\n| 2025-Q2 | 2,443 | 95.6% | 11.5% | ₹3,662 |\n| 2025-Q3 | 2,508 | 95.4% | 11.2% | ₹3,819 |\n\nSource: signup-quarter cohorts [cohort-retention:Q3].\n\n### Subscriptions cluster on the right tests, and adherence holds\n\n| Subscription test | Active subs | Adherence |\n|---|---:|---:|\n| Full Body Checkup Lite | 1,503 | 76.9% |\n| HbA1c | 604 | 76.0% |\n| Lipid Profile Advance | 537 | 76.9% |\n| TSH Ultra Sensitive | 426 | 75.8% |\n\nAcross 3,142 active subscriptions, **adherence sits at ~77%** [user-segmentation:Q1] and the recurring panels people pick (Full Body, HbA1c, Lipid, TSH) are clinically sticky once started [user-segmentation:Q2]. The run ledger confirms it: scheduled subscription runs complete at **88% to 89%** across every frequency band (quarterly, half-yearly, annual) and land on average under two days late [user-segmentation:Q3]. The problem is acquisition into subscriptions, not retention within them.\n\n### The gap is uniform across geography\n\nSubscription penetration barely moves by city tier: **12.1% metro, 11.4% tier-1, 11.4% tier-2** [geographic:Q1], with near-identical LTV. So this is not a metro-only or premium-market play; the recurring rail is under-built everywhere and can be promoted nationally.\n\n### Sizing the nearest win\n\nConverting just **10% of the 2,830 health_anxious customers** (283 customers) onto a subscription, at the proven **+₹3,750** LTV lift, adds an estimated **₹1.06M** in lifetime value [rev-opt:Q2]. That is one narrowly targeted segment; the annual_checker and reactive_booker segments (17,283 customers combined) represent a far larger pool behind the same mechanic.\n\n### Risks and caveats\n\n- The +₹3,750 lift is correlational. Subscribers may be intrinsically higher-intent, so part of the lift is selection, not causation. The realistic causal lift is lower than the headline.\n- The ₹1.06M sizing assumes converted health_anxious customers reach the full subscriber-average LTV, which a freshly converted subscriber will only approach over several cycles.\n- Adherence at ~77% means roughly one in four scheduled cycles slips; sustained value depends on tightening that adherence as the subscriber base grows.\n\n### Key Findings\n\n- Repeat rate is already elite at 92.9% [cohort-retention:Q1]; the unmet lever is **subscription penetration (11.6%)** [rev-opt:Q1].\n- An active subscription is worth **+₹3,750 LTV** versus a non-subscriber [rev-opt:Q1].\n- The pattern is structural: repeat ~95% and subscription ~11% in every signup cohort [cohort-retention:Q3].\n- **health_anxious** customers (2,830, 99.3% repeat, ₹7,863 LTV) are the most obviously under-converted: they repeat like subscribers but only 6.3% subscribe [cohort-retention:Q2]; converting 10% adds ~₹1.06M [rev-opt:Q2].\n- Subscription adherence is stable at ~77% with 88%+ run completion [user-segmentation:Q1][user-segmentation:Q3], so converted subscribers stay converted.\n- The under-penetration is uniform across city tiers (11.4% to 12.1%) [geographic:Q1], so the play is national.\n\n### Recommended Actions\n\n1. **Target health_anxious and chronic-condition repeat customers with a 1-tap subscription offer** on the test they already re-book most. Converting just 10% of health_anxious adds an estimated ₹1.06M in LTV [rev-opt:Q2].\n2. **Default chronic-panel re-bookings (HbA1c, Lipid, TSH) to a subscription prompt** at checkout, since these are exactly the tests subscribers already pick [user-segmentation:Q2].\n3. **Roll the offer out nationally, not just in metros**, since penetration is equally low across tiers [geographic:Q1].\n4. **Build a reactivation play for churned customers** before they leave the catchment entirely.\n5. **Make subscription a post-counseling CTA** so a follow-up recommendation rolls straight into a recurring plan.\n\n```sql\n-- LTV lift from subscription, and per-archetype subscription penetration\nWITH sub_lift AS (\n  SELECT\n    subscription_active,\n    COUNT(*)                 AS customers,\n    ROUND(AVG(total_bookings), 1) AS avg_bookings,\n    ROUND(AVG(total_spend_inr))   AS avg_ltv\n  FROM customers_full\n  GROUP BY subscription_active\n),\narchetype_penetration AS (\n  SELECT\n    archetype,\n    COUNT(*)                                                    AS customers,\n    ROUND(AVG(total_spend_inr))                                 AS avg_ltv,\n    ROUND(100.0 * AVG(CASE WHEN subscription_active THEN 1 ELSE 0 END), 1) AS active_sub_pct,\n    ROUND(100.0 * AVG(CASE WHEN total_bookings >= 2 THEN 1 ELSE 0 END), 1) AS repeat_pct\n  FROM customers_full\n  GROUP BY archetype\n)\nSELECT * FROM archetype_penetration ORDER BY avg_ltv DESC;\n```",
    followUps: [
      "Estimate the LTV gained by moving 10% of health_anxious customers onto a subscription.",
      "Which first test best predicts subscription conversion?",
      "How many churned customers are still WhatsApp-reachable for a reactivation push?",
      "What's the payback period on a discounted first subscription run?",
    ],
    work: {
      "cohort-retention": {
        queries: [
          {
            description: "Base repeat-booking rate across customers who have ever booked",
            sql: "SELECT COUNT(*) AS ever_booked,\n       ROUND(100.0 * AVG(CASE WHEN total_bookings >= 2 THEN 1 ELSE 0 END), 1) AS repeat_pct\nFROM customers_full\nWHERE total_bookings >= 1;",
            rowCount: 1,
            executionTimeMs: 401,
            columns: ["ever_booked", "repeat_pct"],
            data: [{ ever_booked: 34937, repeat_pct: 92.9 }],
          },
          {
            description: "Per-archetype LTV, subscription penetration, and repeat rate",
            sql: "SELECT archetype,\n       COUNT(*) AS customers,\n       ROUND(AVG(total_spend_inr)) AS avg_ltv,\n       ROUND(100.0 * AVG(CASE WHEN subscription_active THEN 1 ELSE 0 END), 1) AS active_sub_pct,\n       ROUND(100.0 * AVG(CASE WHEN total_bookings >= 2 THEN 1 ELSE 0 END), 1) AS repeat_pct\nFROM customers_full\nGROUP BY archetype\nORDER BY avg_ltv DESC;",
            rowCount: 6,
            executionTimeMs: 558,
            columns: ["archetype", "customers", "avg_ltv", "active_sub_pct", "repeat_pct"],
            data: [
              { archetype: "chronic_subscriber", customers: 3899, avg_ltv: 10910, active_sub_pct: 54.7, repeat_pct: 100 },
              { archetype: "health_anxious", customers: 2830, avg_ltv: 7863, active_sub_pct: 6.3, repeat_pct: 99.3 },
              { archetype: "doctor_referred", customers: 4240, avg_ltv: 3010, active_sub_pct: 5.9, repeat_pct: 96.5 },
              { archetype: "reactive_booker", customers: 7425, avg_ltv: 2643, active_sub_pct: 6.6, repeat_pct: 85.6 },
              { archetype: "annual_checker", customers: 9858, avg_ltv: 2246, active_sub_pct: 6.1, repeat_pct: 84.1 },
              { archetype: "one_and_done", customers: 7032, avg_ltv: 1401, active_sub_pct: 6.3, repeat_pct: 99.5 },
            ],
          },
          {
            description: "Signup-quarter cohorts: repeat rate, subscription penetration, and LTV over time to confirm the gap is structural",
            sql: "WITH c AS (\n  SELECT customer_id,\n         CAST(YEAR(signup_date) AS VARCHAR) || '-Q' || CAST(QUARTER(signup_date) AS VARCHAR) AS cohort_q,\n         total_bookings, subscription_active, total_spend_inr\n  FROM customers_full\n  WHERE total_bookings >= 1 AND signup_date >= DATE '2024-07-01'\n)\nSELECT cohort_q,\n       COUNT(*) AS customers,\n       ROUND(100.0 * AVG(CASE WHEN total_bookings >= 2 THEN 1 ELSE 0 END), 1) AS repeat_pct,\n       ROUND(100.0 * AVG(CASE WHEN subscription_active THEN 1 ELSE 0 END), 1) AS sub_pct,\n       ROUND(AVG(total_spend_inr)) AS avg_ltv\nFROM c\nGROUP BY cohort_q\nORDER BY cohort_q\nLIMIT 6;",
            rowCount: 6,
            executionTimeMs: 689,
            columns: ["cohort_q", "customers", "repeat_pct", "sub_pct", "avg_ltv"],
            data: [
              { cohort_q: "2024-Q3", customers: 2413, repeat_pct: 95.8, sub_pct: 11.6, avg_ltv: 3751 },
              { cohort_q: "2024-Q4", customers: 2480, repeat_pct: 96.3, sub_pct: 10.6, avg_ltv: 3673 },
              { cohort_q: "2025-Q1", customers: 2391, repeat_pct: 95.9, sub_pct: 11.8, avg_ltv: 3747 },
              { cohort_q: "2025-Q2", customers: 2443, repeat_pct: 95.6, sub_pct: 11.5, avg_ltv: 3662 },
              { cohort_q: "2025-Q3", customers: 2508, repeat_pct: 95.4, sub_pct: 11.2, avg_ltv: 3819 },
              { cohort_q: "2025-Q4", customers: 2361, repeat_pct: 95.8, sub_pct: 11.2, avg_ltv: 3819 },
            ],
          },
        ],
        summary:
          "92.9% of ever-booked customers repeat; LTV concentrates in chronic_subscriber (₹10,910, 54.7% subscribed) and health_anxious (₹7,863, 99.3% repeat but only 6.3% subscribed); signup-quarter cohorts confirm repeat ~95% and subscription ~11% are stable over time, making the gap structural rather than recent.",
      },
      "rev-opt": {
        queries: [
          {
            description: "Lifetime-value and booking-frequency lift from holding an active subscription, plus overall penetration",
            sql: "SELECT subscription_active,\n       COUNT(*) AS customers,\n       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct_of_base,\n       ROUND(AVG(total_bookings), 1) AS avg_bookings,\n       ROUND(AVG(total_spend_inr)) AS avg_ltv\nFROM customers_full\nGROUP BY subscription_active;",
            rowCount: 2,
            executionTimeMs: 472,
            columns: ["subscription_active", "customers", "pct_of_base", "avg_bookings", "avg_ltv"],
            data: [
              { subscription_active: false, customers: 31190, pct_of_base: 88.4, avg_bookings: 4.5, avg_ltv: 3226 },
              { subscription_active: true, customers: 4094, pct_of_base: 11.6, avg_bookings: 10.6, avg_ltv: 6976 },
            ],
          },
          {
            description: "Sizing a 10% subscription conversion of the health_anxious segment at the proven non-subscriber-to-subscriber LTV lift",
            sql: "WITH ha AS (\n  SELECT COUNT(*) AS n FROM customers_full WHERE archetype = 'health_anxious'\n),\nsub AS (\n  SELECT AVG(total_spend_inr) AS sub_ltv FROM customers_full WHERE subscription_active\n),\nnosub AS (\n  SELECT AVG(total_spend_inr) AS nosub_ltv FROM customers_full WHERE NOT subscription_active\n)\nSELECT ha.n AS health_anxious,\n       ROUND(ha.n * 0.10) AS convert_10pct,\n       ROUND(sub.sub_ltv - nosub.nosub_ltv) AS ltv_lift_each,\n       ROUND(ha.n * 0.10 * (sub.sub_ltv - nosub.nosub_ltv)) AS added_ltv\nFROM ha, sub, nosub;",
            rowCount: 1,
            executionTimeMs: 643,
            columns: ["health_anxious", "convert_10pct", "ltv_lift_each", "added_ltv"],
            data: [{ health_anxious: 2830, convert_10pct: 283, ltv_lift_each: 3750, added_ltv: 1061300 }],
          },
        ],
        summary:
          "Subscribers (11.6% of the 35,284 base) average ₹6,976 LTV and 10.6 bookings versus ₹3,226 and 4.5 for non-subscribers, a +₹3,750 LTV lift; converting 10% of the 2,830 health_anxious customers at that lift adds an estimated ₹1.06M in lifetime value.",
      },
      "user-segmentation": {
        queries: [
          {
            description: "Active subscription count and average adherence across the recurring book",
            sql: "SELECT COUNT(*) AS active_subs,\n       ROUND(AVG(adherence_rate_pct), 1) AS avg_adherence\nFROM subscriptions_full\nWHERE status = 'active';",
            rowCount: 1,
            executionTimeMs: 388,
            columns: ["active_subs", "avg_adherence"],
            data: [{ active_subs: 3142, avg_adherence: 76.6 }],
          },
          {
            description: "Active subscriptions and adherence by subscribed test",
            sql: "SELECT test_name,\n       COUNT(*) AS active_subs,\n       ROUND(AVG(adherence_rate_pct), 1) AS adherence\nFROM subscriptions_full\nWHERE status = 'active'\nGROUP BY test_name\nORDER BY active_subs DESC\nLIMIT 4;",
            rowCount: 4,
            executionTimeMs: 511,
            columns: ["test_name", "active_subs", "adherence"],
            data: [
              { test_name: "Healthy India 2026 Full Body Checkup Lite", active_subs: 1503, adherence: 76.9 },
              { test_name: "HbA1c", active_subs: 604, adherence: 76.0 },
              { test_name: "Lipid Profile Advance", active_subs: 537, adherence: 76.9 },
              { test_name: "TSH Ultra Sensitive", active_subs: 426, adherence: 75.8 },
            ],
          },
          {
            description: "Subscription run completion and lateness by frequency band, testing whether the recurring cadence actually executes",
            sql: "SELECT frequency_days,\n       COUNT(*) AS runs,\n       ROUND(100.0 * AVG(CASE WHEN run_status = 'completed' THEN 1 ELSE 0 END), 1) AS completed_pct,\n       ROUND(AVG(days_late), 1) AS avg_days_late\nFROM subscription_runs_full\nGROUP BY frequency_days\nORDER BY frequency_days;",
            rowCount: 3,
            executionTimeMs: 731,
            columns: ["frequency_days", "runs", "completed_pct", "avg_days_late"],
            data: [
              { frequency_days: 90, runs: 3672, completed_pct: 88.2, avg_days_late: 1.8 },
              { frequency_days: 180, runs: 3869, completed_pct: 89.1, avg_days_late: 1.7 },
              { frequency_days: 365, runs: 2710, completed_pct: 88.4, avg_days_late: 1.7 },
            ],
          },
        ],
        summary:
          "Across 3,142 active subscriptions adherence holds at ~77%, clustered on Full Body, HbA1c, Lipid, and TSH; scheduled runs complete at 88% to 89% across every frequency band under two days late, so once started, subscribers stay and the gap is acquisition, not retention.",
      },
      geographic: {
        queries: [
          {
            description: "Subscription penetration and LTV by city tier, testing whether the recurring gap is metro-only or national",
            sql: "SELECT city_tier,\n       COUNT(*) AS customers,\n       ROUND(100.0 * AVG(CASE WHEN subscription_active THEN 1 ELSE 0 END), 1) AS sub_pct,\n       ROUND(AVG(total_spend_inr)) AS avg_ltv\nFROM customers_full\nWHERE total_bookings >= 1\nGROUP BY city_tier\nORDER BY sub_pct DESC;",
            rowCount: 3,
            executionTimeMs: 466,
            columns: ["city_tier", "customers", "sub_pct", "avg_ltv"],
            data: [
              { city_tier: "metro", customers: 13051, sub_pct: 12.1, avg_ltv: 3724 },
              { city_tier: "tier1", customers: 9853, sub_pct: 11.4, avg_ltv: 3663 },
              { city_tier: "tier2", customers: 12033, sub_pct: 11.4, avg_ltv: 3697 },
            ],
          },
        ],
        summary:
          "Subscription penetration barely moves by tier (12.1% metro, 11.4% tier-1, 11.4% tier-2) with near-identical LTV, so the recurring rail is under-built everywhere and the conversion play should run nationally.",
      },
      "daily-metrics": {
        queries: [
          {
            description: "New subscription starts by quarter with average adherence, testing whether acquisition into subscriptions is flat or growing",
            sql: "SELECT CAST(YEAR(start_date) AS VARCHAR) || '-Q' || CAST(QUARTER(start_date) AS VARCHAR) AS start_q,\n       COUNT(*) AS subs_started,\n       ROUND(AVG(adherence_rate_pct), 1) AS avg_adherence\nFROM subscriptions_full\nWHERE start_date >= DATE '2024-07-01'\nGROUP BY start_q\nORDER BY start_q\nLIMIT 6;",
            rowCount: 6,
            executionTimeMs: 552,
            columns: ["start_q", "subs_started", "avg_adherence"],
            data: [
              { start_q: "2024-Q3", subs_started: 464, avg_adherence: 77.4 },
              { start_q: "2024-Q4", subs_started: 439, avg_adherence: 76.4 },
              { start_q: "2025-Q1", subs_started: 432, avg_adherence: 77.7 },
              { start_q: "2025-Q2", subs_started: 474, avg_adherence: 77.0 },
              { start_q: "2025-Q3", subs_started: 450, avg_adherence: 76.2 },
              { start_q: "2025-Q4", subs_started: 446, avg_adherence: 77.0 },
            ],
          },
        ],
        summary:
          "New subscription starts are flat at ~450 per quarter with steady ~77% adherence, confirming acquisition into subscriptions has plateaued and is the constraint, not adherence which holds across cohorts.",
      },
      "data-quality": {
        queries: [
          {
            description: "Subscription status mix, showing how much of the book is active versus cancelled or paused (churn check)",
            sql: "SELECT status,\n       COUNT(*) AS subs,\n       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct\nFROM subscriptions_full\nGROUP BY status\nORDER BY subs DESC;",
            rowCount: 3,
            executionTimeMs: 384,
            columns: ["status", "subs", "pct"],
            data: [
              { status: "active", subs: 3142, pct: 81.0 },
              { status: "cancelled", subs: 526, pct: 13.6 },
              { status: "paused", subs: 213, pct: 5.5 },
            ],
          },
        ],
        summary:
          "81% of all subscriptions ever created are still active and only 13.6% are cancelled, confirming low subscription churn and reinforcing that the lever is getting customers onto the rail, not keeping them on it.",
      },
    },
  }),
  deepResearchThread({
    slug: "crm-channel-roi",
    title: "Which CRM channel is worth the spend?",
    question:
      "Across our messaging channels, which one delivers the best conversion and return on send cost, and where are we overspending?",
    report:
      "## WhatsApp drives the volume, push delivers the efficiency, email is dead weight\n\nWe sent **787,729** lifecycle messages across four channels [rev-opt:Q1]. They are not close to equal on either conversion or cost.\n\n### Executive summary\n\nThe CRM stack is paying for four channels and getting almost all of its return from two. WhatsApp is the revenue engine: it converts at 4.05% and, because it is delivered and opened at very high rates, it generates more booking revenue than every other channel combined. Push is the efficiency engine: its conversion is lower, but its send cost is so small that the return on spend is the highest in the system. SMS and email are laggards, and email in particular is effectively dead, producing 47 conversions from 28,002 sends. The strategic move is to consolidate revenue-driving campaigns onto WhatsApp, keep push as a free always-on layer, and retire standalone email. Reach is not the blocker: the WhatsApp opt-in base is large and already being messaged, so the constraint is channel allocation, not consent.\n\n### Methodology and data\n\nWe analyzed the full communications log (`comms_full`), one row per send, with delivery, open, click, conversion, and per-send cost. Conversion is the `converted` flag, which links a send to a downstream booking. Each conversion is valued at the **₹758** average repeat (non-first) completed-booking ticket [rev-opt:Q3], so the revenue figures are deliberately conservative (a first booking or a chronic panel can be worth more). Return on send cost is conversion-revenue divided by total spend on that channel. We cross-checked conversion by campaign type, by archetype, by city tier, and over time to make sure the channel ranking is not driven by one campaign or one segment.\n\n### Channel economics\n\n| Channel | Sends | Open rate | Conv rate | Conversions | Spend | Cost / conv |\n|---|---:|---:|---:|---:|---:|---:|\n| WhatsApp | 305,076 | **91.2%** | **4.05%** | 12,365 | ₹36,609 | ₹3.0 |\n| Push | 304,466 | 60.4% | 1.50% | 4,573 | ₹3,045 | **₹0.7** |\n| SMS | 150,185 | 78.7% | 0.87% | 1,306 | ₹12,015 | ₹9.2 |\n| Email | 28,002 | 20.9% | **0.17%** | 47 | ₹560 | ₹11.9 |\n\nSource: per-channel economics [rev-opt:Q1]. Valuing each conversion at the ₹758 average repeat ticket [rev-opt:Q3], returns diverge sharply:\n\n| Channel | Est. revenue | Est. return on send cost |\n|---|---:|---:|\n| WhatsApp | **₹9.37M** | ~256x |\n| Push | ₹3.47M | **~1,139x** |\n| SMS | ₹0.99M | ~82x |\n| Email | ₹0.04M | ~64x |\n\n### Campaign type tells you what to send where\n\n| Campaign | Channel | Sends | Conv rate |\n|---|---|---:|---:|\n| Reactivation | WhatsApp | 4,742 | **4.28%** |\n| Report delivery | WhatsApp | 141,209 | 4.11% |\n| Tax-deduction nudge | WhatsApp | 56,633 | 4.08% |\n| Annual checkup reminder | WhatsApp | 34,164 | 3.97% |\n| Dengue-season alert | WhatsApp | 46,250 | 3.93% |\n| Report delivery | Push | 141,120 | 1.52% |\n\nSource: campaign x channel conversion [rev-opt:Q2]. Every campaign type converts **2.5x to 4x better on WhatsApp** than on push or SMS, and reactivation is the single highest-converting message we send.\n\n### The advantage is stable over time\n\nThis is not a seasonal spike. Monthly blended conversion holds in a tight **1.8% to 2.6%** band across the last seven months, with no month where the channel ranking flips [daily-metrics:Q1]. The dip to 1.81% in November 2025 coincides with a high-volume month skewed toward lower-converting push sends, not a WhatsApp problem. The channel hierarchy is durable.\n\n### WhatsApp converts evenly across every archetype\n\nWhatsApp conversion is remarkably flat across customer archetypes, ranging only from **3.91% (health_anxious) to 4.18% (one_and_done)** [user-segmentation:Q1]. That uniformity is a feature: it means WhatsApp is a reliable rail for the whole base, not a channel that only works for already-engaged customers. There is no segment where WhatsApp underperforms push or SMS.\n\n### Reach is not the constraint\n\nA natural worry is that WhatsApp-opt-in customers are being stranded on lower-converting channels. They are not. Of the 28,999 WhatsApp-opt-in customers who have been messaged at all, **99.6% have received at least one WhatsApp send**; only 0.4% (111 customers) have never been reached on WhatsApp [user-segmentation:Q2]. So the opportunity is not fixing reach, it is shifting *campaign volume* off SMS and email and onto the rail customers already have open.\n\n### The advantage holds across city tiers\n\nWhatsApp's edge over push is consistent geographically: WhatsApp converts at **3.96% in metro, 4.06% in tier-1, and 4.18% in tier-2**, beating push (~1.5%) by roughly 2.6x to 2.8x in every tier [geographic:Q1]. If anything WhatsApp is slightly stronger in tier-2, so there is no market where the strategy should change.\n\n### Risks and caveats\n\n- The ₹758 valuation treats every conversion equally; report-delivery and reactivation conversions may carry different basket values, so the per-channel revenue split is indicative, not exact.\n- WhatsApp template messaging carries per-conversation platform fees that can rise with volume; the ₹3 cost-per-conversion is the current blended rate and should be re-checked as send volume scales.\n- Push's enormous return on send cost is real but capped by its lower conversion ceiling; it cannot simply absorb WhatsApp's revenue-driving campaigns.\n\n### Key Findings\n\n- **WhatsApp is the conversion workhorse**: 4.05% conversion at ₹3 per conversion, driving an estimated ₹9.37M, more than every other channel combined [rev-opt:Q1].\n- **Push is the efficiency leader**: cheapest cost-per-conversion (₹0.7) and the highest return on send cost, but lower absolute conversion [rev-opt:Q1].\n- **Email is effectively dead**: 0.17% conversion, 20.9% open. The 28,002 email sends produced 47 conversions [rev-opt:Q1].\n- **Reactivation over WhatsApp** is the highest-converting message in the system (4.28%) [rev-opt:Q2].\n- The WhatsApp advantage is stable over time [daily-metrics:Q1], across archetypes [user-segmentation:Q1], and across city tiers [geographic:Q1], and reach is essentially saturated for opt-in customers [user-segmentation:Q2].\n\n### Recommended Actions\n\n1. **Make WhatsApp the default channel for every revenue-driving campaign** (report delivery, reactivation, tax nudges, abnormal-result follow-up), gated by opt-in.\n2. **Use push as the free always-on layer** for low-stakes nudges where the ~1,139x return covers the rounding-error cost.\n3. **Retire standalone email campaigns** and reallocate the effort to WhatsApp template approvals.\n4. **Scale reactivation on WhatsApp**: it converts at 4.28% but we only sent 4,742 of them against thousands of dormant customers [rev-opt:Q2].\n5. **Run the same WhatsApp-first playbook nationally**, since the advantage holds in every tier and is strongest in tier-2 [geographic:Q1].\n\n```sql\n-- Per-channel CRM economics: conversion, cost, and AOV-based return\nWITH aov AS (\n  SELECT AVG(total_paid_inr) AS ticket\n  FROM bookings_full\n  WHERE booking_status = 'completed'\n)\nSELECT\n  c.channel,\n  COUNT(*)                                                       AS sends,\n  ROUND(100.0 * AVG(CASE WHEN c.opened THEN 1 ELSE 0 END), 1)    AS open_pct,\n  ROUND(100.0 * AVG(CASE WHEN c.converted THEN 1 ELSE 0 END), 2) AS conv_pct,\n  SUM(CASE WHEN c.converted THEN 1 ELSE 0 END)                   AS conversions,\n  ROUND(SUM(c.send_cost_inr))                                    AS spend_inr,\n  ROUND(SUM(c.send_cost_inr)\n        / NULLIF(SUM(CASE WHEN c.converted THEN 1 ELSE 0 END), 0), 1) AS cost_per_conv\nFROM comms_full c\nGROUP BY c.channel\nORDER BY conversions DESC;\n```",
    followUps: [
      "What share of our base is WhatsApp opt-in but only being reached on email or SMS?",
      "Which campaign types should we move off SMS first?",
      "How does WhatsApp conversion vary by archetype?",
      "What's the incremental revenue from shifting all report-delivery sends to WhatsApp?",
    ],
    work: {
      "rev-opt": {
        queries: [
          {
            description: "Per-channel send volume, open rate, conversion rate, spend, and cost per conversion",
            sql: "SELECT channel,\n       COUNT(*) AS sends,\n       ROUND(100.0 * AVG(CASE WHEN opened THEN 1 ELSE 0 END), 1) AS open_pct,\n       ROUND(100.0 * AVG(CASE WHEN converted THEN 1 ELSE 0 END), 2) AS conv_pct,\n       SUM(CASE WHEN converted THEN 1 ELSE 0 END) AS conversions,\n       ROUND(SUM(send_cost_inr)) AS spend_inr,\n       ROUND(SUM(send_cost_inr) / NULLIF(SUM(CASE WHEN converted THEN 1 ELSE 0 END), 0), 1) AS cost_per_conv\nFROM comms_full\nGROUP BY channel\nORDER BY conversions DESC;",
            rowCount: 4,
            executionTimeMs: 1364,
            columns: ["channel", "sends", "open_pct", "conv_pct", "conversions", "spend_inr", "cost_per_conv"],
            data: [
              { channel: "whatsapp", sends: 305076, open_pct: 91.2, conv_pct: 4.05, conversions: 12365, spend_inr: 36609, cost_per_conv: 3 },
              { channel: "push", sends: 304466, open_pct: 60.4, conv_pct: 1.5, conversions: 4573, spend_inr: 3045, cost_per_conv: 0.7 },
              { channel: "sms", sends: 150185, open_pct: 78.7, conv_pct: 0.87, conversions: 1306, spend_inr: 12015, cost_per_conv: 9.2 },
              { channel: "email", sends: 28002, open_pct: 20.9, conv_pct: 0.17, conversions: 47, spend_inr: 560, cost_per_conv: 11.9 },
            ],
          },
          {
            description: "Conversion rate by campaign type and channel (top combinations)",
            sql: "SELECT campaign_type, channel,\n       COUNT(*) AS sends,\n       ROUND(100.0 * AVG(CASE WHEN converted THEN 1 ELSE 0 END), 2) AS conv_pct\nFROM comms_full\nGROUP BY campaign_type, channel\nORDER BY conv_pct DESC\nLIMIT 8;",
            rowCount: 8,
            executionTimeMs: 1601,
            columns: ["campaign_type", "channel", "sends", "conv_pct"],
            data: [
              { campaign_type: "reactivation", channel: "whatsapp", sends: 4742, conv_pct: 4.28 },
              { campaign_type: "report_delivery", channel: "whatsapp", sends: 141209, conv_pct: 4.11 },
              { campaign_type: "tax_deduction_nudge", channel: "whatsapp", sends: 56633, conv_pct: 4.08 },
              { campaign_type: "annual_checkup_reminder", channel: "whatsapp", sends: 34164, conv_pct: 3.97 },
              { campaign_type: "welcome_series", channel: "whatsapp", sends: 22078, conv_pct: 3.96 },
              { campaign_type: "dengue_season_alert", channel: "whatsapp", sends: 46250, conv_pct: 3.93 },
              { campaign_type: "reactivation", channel: "push", sends: 4774, conv_pct: 1.59 },
              { campaign_type: "report_delivery", channel: "push", sends: 141120, conv_pct: 1.52 },
            ],
          },
          {
            description: "Average repeat-booking ticket used to value each CRM conversion",
            sql: "SELECT ROUND(AVG(total_paid_inr)) AS avg_repeat_ticket\nFROM bookings_full\nWHERE booking_status = 'completed' AND is_first_booking = false;",
            rowCount: 1,
            executionTimeMs: 467,
            columns: ["avg_repeat_ticket"],
            data: [{ avg_repeat_ticket: 758 }],
          },
          {
            description: "Estimated revenue and return on send cost per channel, computed end-to-end as conversions times the repeat ticket over spend",
            sql: "WITH t AS (\n  SELECT AVG(total_paid_inr) AS ticket FROM bookings_full WHERE booking_status = 'completed' AND is_first_booking = false\n),\nch AS (\n  SELECT channel,\n         SUM(CASE WHEN converted THEN 1 ELSE 0 END) AS conv,\n         SUM(send_cost_inr) AS spend\n  FROM comms_full\n  GROUP BY channel\n)\nSELECT ch.channel,\n       ch.conv AS conversions,\n       ROUND(ch.spend) AS spend_inr,\n       ROUND(ch.conv * t.ticket) AS est_revenue_inr,\n       ROUND(ch.conv * t.ticket / NULLIF(ch.spend, 0)) AS return_x\nFROM ch, t\nORDER BY return_x DESC;",
            rowCount: 4,
            executionTimeMs: 1571,
            columns: ["channel", "conversions", "spend_inr", "est_revenue_inr", "return_x"],
            data: [
              { channel: "push", conversions: 4573, spend_inr: 3045, est_revenue_inr: 3468455, return_x: 1139 },
              { channel: "whatsapp", conversions: 12365, spend_inr: 36609, est_revenue_inr: 9378406, return_x: 256 },
              { channel: "sms", conversions: 1306, spend_inr: 12015, est_revenue_inr: 990554, return_x: 82 },
              { channel: "email", conversions: 47, spend_inr: 560, est_revenue_inr: 35648, return_x: 64 },
            ],
          },
        ],
        summary:
          "Across 787,729 sends, WhatsApp converts at 4.05% (12,365 conversions, ~₹9.37M at the ₹758 ticket) at ₹3/conversion; push returns ~1,139x at ₹0.7/conversion; SMS (~82x) and email (~64x, only 47 conversions) lag badly, and WhatsApp reactivation is the single highest-converting message at 4.28%.",
      },
      "data-quality": {
        queries: [
          {
            description: "Delivery, open, and click funnel by channel, exposing why email and SMS underperform downstream",
            sql: "SELECT channel,\n       COUNT(*) AS sends,\n       ROUND(100.0 * AVG(CASE WHEN delivered THEN 1 ELSE 0 END), 1) AS delivered_pct,\n       ROUND(100.0 * AVG(CASE WHEN opened THEN 1 ELSE 0 END), 1) AS open_pct,\n       ROUND(100.0 * AVG(CASE WHEN clicked THEN 1 ELSE 0 END), 1) AS click_pct\nFROM comms_full\nGROUP BY channel\nORDER BY sends DESC;",
            rowCount: 4,
            executionTimeMs: 1187,
            columns: ["channel", "sends", "delivered_pct", "open_pct", "click_pct"],
            data: [
              { channel: "whatsapp", sends: 305076, delivered_pct: 97.0, open_pct: 91.2, click_pct: 29.1 },
              { channel: "push", sends: 304466, delivered_pct: 85.0, open_pct: 60.4, click_pct: 10.9 },
              { channel: "sms", sends: 150185, delivered_pct: 96.0, open_pct: 78.7, click_pct: 6.3 },
              { channel: "email", sends: 28002, delivered_pct: 87.7, open_pct: 20.9, click_pct: 1.2 },
            ],
          },
        ],
        summary:
          "The delivery-to-click funnel explains the conversion gap: WhatsApp delivers 97% and is clicked 29.1% of the time, while email opens at only 20.9% and is clicked 1.2%, so email's weakness is structural engagement, not just attribution.",
      },
      "daily-metrics": {
        queries: [
          {
            description: "Monthly blended send volume and conversion rate over the last seven months, testing whether the channel advantage is stable",
            sql: "SELECT strftime(sent_at, '%Y-%m') AS mth,\n       COUNT(*) AS sends,\n       ROUND(100.0 * AVG(CASE WHEN converted THEN 1 ELSE 0 END), 2) AS conv_pct,\n       SUM(CASE WHEN converted THEN 1 ELSE 0 END) AS conversions\nFROM comms_full\nWHERE sent_at >= TIMESTAMP '2025-11-01'\nGROUP BY mth\nORDER BY mth;",
            rowCount: 7,
            executionTimeMs: 1426,
            columns: ["mth", "sends", "conv_pct", "conversions"],
            data: [
              { mth: "2025-11", sends: 56102, conv_pct: 1.81, conversions: 1015 },
              { mth: "2025-12", sends: 18454, conv_pct: 2.32, conversions: 428 },
              { mth: "2026-01", sends: 24275, conv_pct: 2.37, conversions: 575 },
              { mth: "2026-02", sends: 61624, conv_pct: 2.40, conversions: 1476 },
              { mth: "2026-03", sends: 63361, conv_pct: 2.37, conversions: 1500 },
              { mth: "2026-04", sends: 18316, conv_pct: 2.28, conversions: 417 },
              { mth: "2026-05", sends: 14177, conv_pct: 2.56, conversions: 363 },
            ],
          },
        ],
        summary:
          "Monthly blended conversion holds in a tight 1.8% to 2.6% band over the last seven months with no month where the channel ranking flips, so the WhatsApp advantage is durable rather than a seasonal spike.",
      },
      "user-segmentation": {
        queries: [
          {
            description: "WhatsApp conversion rate by customer archetype, testing whether the channel works for the whole base or only engaged segments",
            sql: "SELECT archetype,\n       COUNT(*) AS sends,\n       ROUND(100.0 * AVG(CASE WHEN converted THEN 1 ELSE 0 END), 2) AS conv_pct\nFROM comms_full\nWHERE channel = 'whatsapp'\nGROUP BY archetype\nORDER BY conv_pct DESC;",
            rowCount: 6,
            executionTimeMs: 1218,
            columns: ["archetype", "sends", "conv_pct"],
            data: [
              { archetype: "one_and_done", sends: 32856, conv_pct: 4.18 },
              { archetype: "chronic_subscriber", sends: 80507, conv_pct: 4.11 },
              { archetype: "doctor_referred", sends: 30785, conv_pct: 4.08 },
              { archetype: "reactive_booker", sends: 48565, conv_pct: 4.05 },
              { archetype: "annual_checker", sends: 70473, conv_pct: 4.00 },
              { archetype: "health_anxious", sends: 41890, conv_pct: 3.91 },
            ],
          },
          {
            description: "Share of WhatsApp-opt-in customers who have actually been reached on WhatsApp, sizing any reach gap",
            sql: "WITH reach AS (\n  SELECT c.customer_id,\n         MAX(CASE WHEN ch.channel = 'whatsapp' THEN 1 ELSE 0 END) AS got_wa\n  FROM customers_full c\n  JOIN comms_full ch ON ch.customer_id = c.customer_id\n  WHERE c.whatsapp_opt_in\n  GROUP BY c.customer_id\n)\nSELECT COUNT(*) AS wa_optin_messaged,\n       SUM(CASE WHEN got_wa = 0 THEN 1 ELSE 0 END) AS never_got_wa,\n       ROUND(100.0 * AVG(CASE WHEN got_wa = 0 THEN 1 ELSE 0 END), 1) AS pct_missed\nFROM reach;",
            rowCount: 1,
            executionTimeMs: 2143,
            columns: ["wa_optin_messaged", "never_got_wa", "pct_missed"],
            data: [{ wa_optin_messaged: 28999, never_got_wa: 111, pct_missed: 0.4 }],
          },
        ],
        summary:
          "WhatsApp conversion is flat across archetypes (3.91% to 4.18%), so it is a reliable rail for the whole base; and 99.6% of messaged opt-in customers already receive WhatsApp sends, so reach is saturated and the lever is shifting campaign volume off SMS and email.",
      },
      geographic: {
        queries: [
          {
            description: "WhatsApp versus push conversion by city tier, testing whether the channel advantage holds geographically",
            sql: "SELECT city_tier, channel,\n       COUNT(*) AS sends,\n       ROUND(100.0 * AVG(CASE WHEN converted THEN 1 ELSE 0 END), 2) AS conv_pct\nFROM comms_full\nWHERE channel IN ('whatsapp', 'push')\nGROUP BY city_tier, channel\nORDER BY city_tier, channel;",
            rowCount: 6,
            executionTimeMs: 1339,
            columns: ["city_tier", "channel", "sends", "conv_pct"],
            data: [
              { city_tier: "metro", channel: "push", sends: 117411, conv_pct: 1.53 },
              { city_tier: "metro", channel: "whatsapp", sends: 126721, conv_pct: 3.96 },
              { city_tier: "tier1", channel: "push", sends: 85601, conv_pct: 1.48 },
              { city_tier: "tier1", channel: "whatsapp", sends: 92557, conv_pct: 4.06 },
              { city_tier: "tier2", channel: "push", sends: 101454, conv_pct: 1.49 },
              { city_tier: "tier2", channel: "whatsapp", sends: 85798, conv_pct: 4.18 },
            ],
          },
        ],
        summary:
          "WhatsApp beats push by roughly 2.6x to 2.8x in every city tier (3.96% metro, 4.06% tier-1, 4.18% tier-2 vs ~1.5% push), and is slightly strongest in tier-2, so the WhatsApp-first playbook should run nationally.",
      },
    },
  }),
  deepResearchThread({
    slug: "phlebotomist-sla-by-tier",
    title: "Where is our home-collection service breaking down?",
    question:
      "How does phlebotomist reliability and report turnaround vary by city tier, what's it doing to NPS, and which cities should ops fix first?",
    report:
      "## Service quality splits hard by city tier, and tier-2 is dragging NPS\n\nVolume is spread fairly evenly across tiers, but the at-home experience is not. Across 230,941 bookings the on-time and reliability gap between metro and tier-2 is severe [daily-metrics:Q1].\n\n### Executive summary\n\nThe home-collection product is two different products depending on where the customer lives. In metro, the phlebotomist arrives on time, the sample reaches the lab in an hour and a half, and the report turns around in well under half a day. In tier-2, one collection in eleven is a no-show, one sample in sixteen is rejected, the sample spends eight and a half hours in transit, and the report takes more than a day. This is not a training gap and not a report-speed problem in isolation; it is a fleet-density and logistics problem concentrated in a handful of tier-2 cities. It shows up directly in NPS, and a single no-show event is catastrophic for advocacy. We size the direct revenue lost to tier-2 no-shows at **₹5.74M** and identify the six cities that should be the first operations sprint.\n\n### Methodology and data\n\nWe measured reliability (on-time, no-show, sample rejection, TAT breach) from the booking ledger (`bookings_full`), logistics (transit hours, lab SLA, temperature breach, TAT percentiles) from the sample-tracking ledger (`sample_tracking_full`), advocacy from `nps_full`, and phlebotomist attributes (certification, tenure) from `phlebotomist_full`. We deliberately separated *reliability* misses (no-show, rejection, late arrival) from *speed* misses (report TAT) because they have different root causes and the NPS analysis shows they matter very differently to customers.\n\n### Service quality by city tier\n\n| City tier | Bookings | On-time | No-show | Sample reject | TAT breach | Avg report TAT |\n|---|---:|---:|---:|---:|---:|---:|\n| Metro | 87,143 | **87.5%** | 2.33% | 1.96% | 17.9% | 9.2 hrs |\n| Tier 1 | 64,649 | 80.8% | 5.83% | 3.43% | 4.9% | 15.4 hrs |\n| Tier 2 | 79,149 | **72.2%** | **9.48%** | **6.04%** | 13.5% | **26.8 hrs** |\n\nTier-2 has **4x the metro no-show rate**, **3x the sample-rejection rate**, and reports take nearly **3x as long** to turn around (26.8 vs 9.2 hours) [daily-metrics:Q1].\n\n### The turnaround gap is a logistics gap, not a lab gap\n\nThe sample-tracking ledger pinpoints where the time goes. Average sample transit time is **1.5 hours in metro, 3.5 in tier-1, and 8.5 in tier-2** [daily-metrics:Q2]. Median TAT follows the same shape (9.2 / 15.4 / 26.7 hours), and tier-2 even shows a small **1.69% temperature-breach rate** on samples that metro never sees [daily-metrics:Q2]. The lab is not slow; the sample is sitting in transit. That is a routing and hub-density problem, fixable with logistics, not with more lab capacity.\n\n### Within tier-2, every slot band is equally bad\n\nWe checked whether tier-2's misses cluster in early-morning or late slots; they do not. On-time rate in tier-2 sits at **71.6% to 72.8% across every slot band** [daily-metrics:Q3], which rules out a scheduling-window fix and points back at raw fleet availability.\n\n### It shows up in NPS\n\n| City tier | Responses | Avg NPS score |\n|---|---:|---:|\n| Tier 1 | 19,175 | 7.22 |\n| Metro | 26,557 | 6.94 |\n| Tier 2 | 23,628 | **6.79** |\n\nNet NPS across the base sits at **-8.6** [geographic:Q2], and tier-2 is the weakest tier despite metro carrying a higher TAT-breach rate [geographic:Q1], which points at the reliability misses (no-shows, rejections) rather than report speed as the NPS driver.\n\n### A no-show is an NPS catastrophe\n\nThe single clearest driver in the data: customers who experienced a no-show score an average NPS of **3.08 (net -96.5)** versus **7.21 (net -3.1)** for those who did not [geographic:Q4]. A no-show does not just lose one booking, it converts a potential promoter into a near-certain detractor. This is why the reliability misses, not the report speed, are the right thing to fix first.\n\n### Certification and tenure are not the lever\n\n| Certification | Collections | On-time | No-show | Avg rating |\n|---|---:|---:|---:|---:|\n| NACO certified | 120,426 | 80.0% | 6.00% | 4.28 |\n| Basic | 53,785 | 81.7% | 5.22% | 4.00 |\n| Advanced | 48,244 | 79.8% | 5.79% | 4.48 |\n\nOn-time and no-show rates are essentially flat across certification levels [user-segmentation:Q1]. Tenure tells the same story: phlebotomists with 36+ months of experience are actually *slightly worse* on no-show (5.95%) than those with under a year (5.23%) [user-segmentation:Q2], so seniority is not protective. This is a **fleet density and dispatch** problem in tier-2, not a training problem.\n\n### The tier-2 cities to fix first\n\n| City | Bookings | No-show | On-time |\n|---|---:|---:|---:|\n| Rajkot | 5,343 | **10.57%** | 71.7% |\n| Gorakhpur | 4,875 | 9.89% | 72.7% |\n| Bareilly | 4,944 | 9.77% | 71.4% |\n| Bhubaneswar | 4,894 | 9.75% | 72.3% |\n| Allahabad | 4,428 | 9.69% | 73.1% |\n| Gwalior | 4,939 | 9.60% | 71.8% |\n\nSource: worst tier-2 cities by no-show [geographic:Q3].\n\n### Sizing the lost revenue\n\nTier-2 absorbed **7,503 no-shows**, and at the tier-2 average completed ticket of **₹765**, that is **₹5.74M** in direct lost booking revenue [rev-opt:Q1], before counting the downstream NPS and churn cost of turning those customers into detractors.\n\n### Risks and caveats\n\n- The ₹5.74M counts only the lost booking value of the no-show itself; it does not capture the lifetime value lost when a -96.5 NPS detractor churns, so the true cost is higher.\n- No-show is recorded at the booking level; some share may be customer-driven (not at home) rather than phlebotomist-driven, which changes the fix (reminders vs fleet).\n- The six priority cities are ranked on no-show rate among cities with > 2,000 bookings; smaller tier-2 cities with thin volume are excluded and may have worse rates on small samples.\n\n### Key Findings\n\n- **Tier-2 is a third of volume but the weakest tier on every reliability metric**: 72.2% on-time, 9.48% no-show, 6.04% sample rejection [daily-metrics:Q1].\n- The turnaround gap is logistics: tier-2 sample transit is 8.5 hours vs 1.5 in metro, with a 1.69% temperature-breach rate [daily-metrics:Q2], and it is uniform across slot bands [daily-metrics:Q3].\n- **A no-show collapses NPS** from 7.21 to 3.08 (net -96.5) [geographic:Q4], so reliability misses, not report speed, are the right first fix.\n- **Neither certification nor tenure predicts reliability** [user-segmentation:Q1][user-segmentation:Q2], so the fix is capacity and routing, not retraining.\n- Tier-2 no-shows cost **₹5.74M** in direct lost revenue [rev-opt:Q1]; six tier-2 cities led by Rajkot are the obvious first sprint [geographic:Q3].\n\n### Recommended Actions\n\n1. **Stand up a tier-2 no-show task force** starting with Rajkot, Gorakhpur, and Bareilly; a 9.5%+ no-show rate is ₹5.74M of direct lost revenue plus a severe NPS hit [rev-opt:Q1][geographic:Q4].\n2. **Tighten the sample-to-hub logistics SLA in tier-2** to pull the 8.5-hour transit and 26.8-hour TAT toward the tier-1 marks [daily-metrics:Q2].\n3. **Add fleet density and backup phlebotomists in the six worst tier-2 cities** rather than investing in higher certifications or relying on senior staff, neither of which moves reliability [user-segmentation:Q1][user-segmentation:Q2].\n4. **Auto-rebook and notify on no-show within the hour** over WhatsApp to recover the booking before the customer churns into a detractor.\n\n```sql\n-- Reliability and turnaround by city tier, with the worst tier-2 cities\nWITH tier_quality AS (\n  SELECT\n    city_tier,\n    COUNT(*)                                                       AS bookings,\n    ROUND(100.0 * AVG(CASE WHEN on_time THEN 1 ELSE 0 END), 1)     AS on_time_pct,\n    ROUND(100.0 * AVG(CASE WHEN no_show THEN 1 ELSE 0 END), 2)     AS no_show_pct,\n    ROUND(100.0 * AVG(CASE WHEN sample_rejected THEN 1 ELSE 0 END), 2) AS reject_pct,\n    ROUND(AVG(tat_hours), 1)                                       AS avg_tat_hours\n  FROM bookings_full\n  GROUP BY city_tier\n)\nSELECT * FROM tier_quality ORDER BY bookings DESC;\n\n-- Worst tier-2 cities by no-show\nSELECT\n  city,\n  COUNT(*)                                                   AS bookings,\n  ROUND(100.0 * AVG(CASE WHEN no_show THEN 1 ELSE 0 END), 2) AS no_show_pct,\n  ROUND(100.0 * AVG(CASE WHEN on_time THEN 1 ELSE 0 END), 1) AS on_time_pct\nFROM bookings_full\nWHERE city_tier = 'tier2'\nGROUP BY city\nHAVING COUNT(*) > 2000\nORDER BY no_show_pct DESC\nLIMIT 6;\n```",
    followUps: [
      "What's the revenue lost to tier-2 no-shows over the last year?",
      "Which slot bands have the worst on-time rates in tier-2?",
      "Do repeat customers in tier-2 churn faster after a no-show?",
      "How many phlebotomists would Rajkot need to hit an 85% on-time rate?",
    ],
    work: {
      "daily-metrics": {
        queries: [
          {
            description: "Reliability and report turnaround by city tier across all bookings",
            sql: "SELECT city_tier,\n       COUNT(*) AS bookings,\n       ROUND(100.0 * AVG(CASE WHEN on_time THEN 1 ELSE 0 END), 1) AS on_time_pct,\n       ROUND(100.0 * AVG(CASE WHEN no_show THEN 1 ELSE 0 END), 2) AS no_show_pct,\n       ROUND(100.0 * AVG(CASE WHEN sample_rejected THEN 1 ELSE 0 END), 2) AS reject_pct,\n       ROUND(100.0 * AVG(CASE WHEN tat_breach THEN 1 ELSE 0 END), 1) AS tat_breach_pct,\n       ROUND(AVG(tat_hours), 1) AS avg_tat_hours\nFROM bookings_full\nGROUP BY city_tier\nORDER BY bookings DESC;",
            rowCount: 3,
            executionTimeMs: 1188,
            columns: ["city_tier", "bookings", "on_time_pct", "no_show_pct", "reject_pct", "tat_breach_pct", "avg_tat_hours"],
            data: [
              { city_tier: "metro", bookings: 87143, on_time_pct: 87.5, no_show_pct: 2.33, reject_pct: 1.96, tat_breach_pct: 17.9, avg_tat_hours: 9.2 },
              { city_tier: "tier2", bookings: 79149, on_time_pct: 72.2, no_show_pct: 9.48, reject_pct: 6.04, tat_breach_pct: 13.5, avg_tat_hours: 26.8 },
              { city_tier: "tier1", bookings: 64649, on_time_pct: 80.8, no_show_pct: 5.83, reject_pct: 3.43, tat_breach_pct: 4.9, avg_tat_hours: 15.4 },
            ],
          },
          {
            description: "Sample logistics by city tier from the tracking ledger: transit time, TAT percentiles, lab SLA, and temperature breach",
            sql: "SELECT city_tier,\n       COUNT(*) AS samples,\n       ROUND(AVG(transit_hours), 1) AS avg_transit,\n       ROUND(quantile_cont(tat_hours, 0.5), 1) AS median_tat,\n       ROUND(quantile_cont(tat_hours, 0.9), 1) AS p90_tat,\n       ROUND(100.0 * AVG(CASE WHEN tat_sla_met THEN 1 ELSE 0 END), 1) AS sla_met_pct,\n       ROUND(100.0 * AVG(CASE WHEN temperature_breach THEN 1 ELSE 0 END), 2) AS temp_breach_pct\nFROM sample_tracking_full\nGROUP BY city_tier\nORDER BY median_tat;",
            rowCount: 3,
            executionTimeMs: 1854,
            columns: ["city_tier", "samples", "avg_transit", "median_tat", "p90_tat", "sla_met_pct", "temp_breach_pct"],
            data: [
              { city_tier: "metro", samples: 81998, avg_transit: 1.5, median_tat: 9.2, p90_tat: 13.2, sla_met_pct: 82.1, temp_breach_pct: 0.0 },
              { city_tier: "tier1", samples: 58520, avg_transit: 3.5, median_tat: 15.4, p90_tat: 22.1, sla_met_pct: 95.1, temp_breach_pct: 0.0 },
              { city_tier: "tier2", samples: 69105, avg_transit: 8.5, median_tat: 26.7, p90_tat: 37.6, sla_met_pct: 86.5, temp_breach_pct: 1.69 },
            ],
          },
          {
            description: "Tier-2 on-time rate by slot band, testing whether the misses cluster in particular collection windows",
            sql: "SELECT slot_band, city_tier,\n       COUNT(*) AS bookings,\n       ROUND(100.0 * AVG(CASE WHEN on_time THEN 1 ELSE 0 END), 1) AS on_time_pct\nFROM bookings_full\nWHERE city_tier = 'tier2'\nGROUP BY slot_band, city_tier\nORDER BY on_time_pct ASC\nLIMIT 5;",
            rowCount: 5,
            executionTimeMs: 1043,
            columns: ["slot_band", "city_tier", "bookings", "on_time_pct"],
            data: [
              { slot_band: "12-2pm", city_tier: "tier2", bookings: 7958, on_time_pct: 71.6 },
              { slot_band: "4-6pm", city_tier: "tier2", bookings: 3996, on_time_pct: 71.6 },
              { slot_band: "8-10am", city_tier: "tier2", bookings: 25331, on_time_pct: 72.1 },
              { slot_band: "6-8am", city_tier: "tier2", bookings: 22054, on_time_pct: 72.2 },
              { slot_band: "10am-12pm", city_tier: "tier2", bookings: 14274, on_time_pct: 72.8 },
            ],
          },
        ],
        summary:
          "Tier-2 is the weakest tier on every reliability metric (72.2% on-time, 9.48% no-show, 6.04% rejection) with 26.8-hour TAT; the tracking ledger shows the gap is logistics (8.5-hour transit vs 1.5 in metro, plus a 1.69% temperature breach) and it is uniform across slot bands (71.6% to 72.8%), so it is fleet density not scheduling.",
      },
      geographic: {
        queries: [
          {
            description: "NPS response volume and average score by city tier",
            sql: "SELECT city_tier,\n       COUNT(*) AS responses,\n       ROUND(AVG(score), 2) AS avg_nps\nFROM nps_full\nGROUP BY city_tier\nORDER BY avg_nps DESC;",
            rowCount: 3,
            executionTimeMs: 643,
            columns: ["city_tier", "responses", "avg_nps"],
            data: [
              { city_tier: "tier1", responses: 19175, avg_nps: 7.22 },
              { city_tier: "metro", responses: 26557, avg_nps: 6.94 },
              { city_tier: "tier2", responses: 23628, avg_nps: 6.79 },
            ],
          },
          {
            description: "Net NPS across the base (promoters minus detractors)",
            sql: "SELECT ROUND(100.0 * (AVG(CASE WHEN score >= 9 THEN 1 ELSE 0 END)\n                    - AVG(CASE WHEN score <= 6 THEN 1 ELSE 0 END)), 1) AS net_nps\nFROM nps_full;",
            rowCount: 1,
            executionTimeMs: 512,
            columns: ["net_nps"],
            data: [{ net_nps: -8.6 }],
          },
          {
            description: "Worst tier-2 cities by no-show rate (cities with > 2,000 bookings)",
            sql: "SELECT city,\n       COUNT(*) AS bookings,\n       ROUND(100.0 * AVG(CASE WHEN no_show THEN 1 ELSE 0 END), 2) AS no_show_pct,\n       ROUND(100.0 * AVG(CASE WHEN on_time THEN 1 ELSE 0 END), 1) AS on_time_pct\nFROM bookings_full\nWHERE city_tier = 'tier2'\nGROUP BY city\nHAVING COUNT(*) > 2000\nORDER BY no_show_pct DESC\nLIMIT 6;",
            rowCount: 6,
            executionTimeMs: 1024,
            columns: ["city", "bookings", "no_show_pct", "on_time_pct"],
            data: [
              { city: "Rajkot", bookings: 5343, no_show_pct: 10.57, on_time_pct: 71.7 },
              { city: "Gorakhpur", bookings: 4875, no_show_pct: 9.89, on_time_pct: 72.7 },
              { city: "Bareilly", bookings: 4944, no_show_pct: 9.77, on_time_pct: 71.4 },
              { city: "Bhubaneswar", bookings: 4894, no_show_pct: 9.75, on_time_pct: 72.3 },
              { city: "Allahabad", bookings: 4428, no_show_pct: 9.69, on_time_pct: 73.1 },
              { city: "Gwalior", bookings: 4939, no_show_pct: 9.60, on_time_pct: 71.8 },
            ],
          },
          {
            description: "NPS score and net NPS split by whether the customer experienced a no-show, isolating the strongest advocacy driver",
            sql: "SELECT b.no_show,\n       COUNT(*) AS responses,\n       ROUND(AVG(n.score), 2) AS avg_nps,\n       ROUND(100.0 * (AVG(CASE WHEN n.score >= 9 THEN 1 ELSE 0 END) - AVG(CASE WHEN n.score <= 6 THEN 1 ELSE 0 END)), 1) AS net_nps\nFROM nps_full n\nJOIN bookings_full b ON b.booking_id = n.booking_id\nGROUP BY b.no_show;",
            rowCount: 2,
            executionTimeMs: 1488,
            columns: ["no_show", "responses", "avg_nps", "net_nps"],
            data: [
              { no_show: false, responses: 65280, avg_nps: 7.21, net_nps: -3.1 },
              { no_show: true, responses: 4080, avg_nps: 3.08, net_nps: -96.5 },
            ],
          },
        ],
        summary:
          "Tier-2 is the weakest NPS tier (6.79) and net NPS is -8.6 base-wide; six tier-2 cities led by Rajkot (10.57% no-show) are the obvious first ops sprint, and a no-show collapses NPS from 7.21 (net -3.1) to 3.08 (net -96.5), making reliability the dominant advocacy driver.",
      },
      "user-segmentation": {
        queries: [
          {
            description: "Reliability and rating by phlebotomist certification level",
            sql: "SELECT certification_level,\n       COUNT(*) AS collections,\n       ROUND(100.0 * AVG(CASE WHEN on_time THEN 1 ELSE 0 END), 1) AS on_time_pct,\n       ROUND(100.0 * AVG(CASE WHEN no_show THEN 1 ELSE 0 END), 2) AS no_show_pct,\n       ROUND(AVG(avg_rating), 2) AS avg_rating\nFROM phlebotomist_full\nGROUP BY certification_level;",
            rowCount: 3,
            executionTimeMs: 731,
            columns: ["certification_level", "collections", "on_time_pct", "no_show_pct", "avg_rating"],
            data: [
              { certification_level: "naco_certified", collections: 120426, on_time_pct: 80.0, no_show_pct: 6.0, avg_rating: 4.28 },
              { certification_level: "basic", collections: 53785, on_time_pct: 81.7, no_show_pct: 5.22, avg_rating: 4.0 },
              { certification_level: "advanced", collections: 48244, on_time_pct: 79.8, no_show_pct: 5.79, avg_rating: 4.48 },
            ],
          },
          {
            description: "Reliability and rating by phlebotomist tenure band, testing whether seniority protects against no-shows",
            sql: "SELECT CASE WHEN experience_months < 12 THEN '0-11mo'\n            WHEN experience_months < 24 THEN '12-23mo'\n            WHEN experience_months < 36 THEN '24-35mo'\n            ELSE '36mo+' END AS tenure,\n       COUNT(*) AS collections,\n       ROUND(100.0 * AVG(CASE WHEN on_time THEN 1 ELSE 0 END), 1) AS on_time_pct,\n       ROUND(100.0 * AVG(CASE WHEN no_show THEN 1 ELSE 0 END), 2) AS no_show_pct,\n       ROUND(AVG(avg_rating), 2) AS avg_rating\nFROM phlebotomist_full\nGROUP BY tenure\nORDER BY tenure;",
            rowCount: 4,
            executionTimeMs: 798,
            columns: ["tenure", "collections", "on_time_pct", "no_show_pct", "avg_rating"],
            data: [
              { tenure: "0-11mo", collections: 23078, on_time_pct: 81.5, no_show_pct: 5.23, avg_rating: 3.97 },
              { tenure: "12-23mo", collections: 25833, on_time_pct: 81.3, no_show_pct: 5.47, avg_rating: 4.11 },
              { tenure: "24-35mo", collections: 28574, on_time_pct: 81.0, no_show_pct: 5.56, avg_rating: 4.13 },
              { tenure: "36mo+", collections: 144970, on_time_pct: 79.9, no_show_pct: 5.95, avg_rating: 4.35 },
            ],
          },
        ],
        summary:
          "On-time (79.8 to 81.7%) and no-show (5.22 to 6.0%) are flat across certification levels, and tenure does not help either (36mo+ staff have a slightly worse 5.95% no-show than 0-11mo at 5.23%), so tier-2 reliability is a fleet-density and dispatch problem, not a training or seniority gap.",
      },
      "rev-opt": {
        queries: [
          {
            description: "Direct revenue lost to tier-2 no-shows, computed as the no-show count times the tier-2 average completed ticket",
            sql: "WITH ns AS (\n  SELECT COUNT(*) AS n FROM bookings_full WHERE city_tier = 'tier2' AND no_show\n),\naov AS (\n  SELECT AVG(total_paid_inr) AS t FROM bookings_full WHERE city_tier = 'tier2' AND booking_status = 'completed'\n)\nSELECT ns.n AS tier2_no_shows,\n       ROUND(aov.t) AS avg_ticket,\n       ROUND(ns.n * aov.t) AS lost_revenue_inr\nFROM ns, aov;",
            rowCount: 1,
            executionTimeMs: 996,
            columns: ["tier2_no_shows", "avg_ticket", "lost_revenue_inr"],
            data: [{ tier2_no_shows: 7503, avg_ticket: 765, lost_revenue_inr: 5741802 }],
          },
        ],
        summary:
          "Tier-2 absorbed 7,503 no-shows at a ₹765 average completed ticket, ₹5.74M in direct lost booking revenue, before counting the downstream churn cost of turning those customers into NPS detractors.",
      },
    },
  }),
  deepResearchThread({
    slug: "smart-report-followup-prioritization",
    title: "Are we recommending the right next test to the right people?",
    question:
      "Our Smart Report recommends follow-up tests. How well do those recommendations convert, are we prioritizing the sickest patients, and how do we lift the booking rate?",
    report:
      "## We make 294K next-test recommendations and convert them blind to clinical risk\n\nThe Smart Report engine generated **294,058** follow-up recommendations, and **42.1%** (123,654) were booked within the recommended window [daily-metrics:Q1]. That headline rate is healthy, but it hides a clinical-prioritization problem.\n\n### Executive summary\n\nThe recommendation engine works as a generic nudge and fails as a clinical-triage tool. It books 42% of its recommendations, which is a strong rate for an automated next-test prompt. But that 42% is eerily constant: the same rate appears whether the underlying report is excellent or poor, whether the recommended test is a lipid panel or a vitamin D, whether the patient has a critical flag or none, and whether the customer lives in a metro or a tier-2 town. The engine is not pushing harder for the patients who clinically need the retest most, because severity is not yet an input to how it recommends, counsels, or nudges. Lifting only the poor-score tier from 42.2% to a 55% target is worth an estimated **₹7.08M** in recoverable clinical revenue and, more importantly, gets the right patients back in for monitoring.\n\n### Methodology and data\n\nWe analyzed the recommendation ledger (`future_tests_full`), one row per next-test recommendation, with the originating report's health score and abnormal/critical parameter counts denormalized onto each row. Conversion is `booked_within_window`. We sliced conversion by health score, by recommended test, by who made the recommendation (the report engine vs a counselor), by recommended frequency, by abnormal-parameter severity, and by city tier, specifically to find any dimension where the engine *does* differentiate by clinical risk. We found none. We then connected the result to the counseling gate from the abnormal-results analysis to explain the mechanism.\n\n### Conversion is flat across every severity tier\n\n| Report health score | Recommendations | Booked in window |\n|---|---:|---:|\n| Poor | 72,977 | 42.2% |\n| Fair | 112,451 | 42.0% |\n| Good | 77,799 | 42.0% |\n| Excellent | 30,831 | 42.1% |\n\nSource: conversion by health score [cohort-retention:Q1]. A customer with a **poor** health report converts at the *same* 42% as one with an **excellent** report. The engine is recommending and nudging uniformly, with no extra push for the patients who clinically need the retest most.\n\n### The same flatness shows up test-by-test\n\n| Recommended test | Recommendations | Booked in window |\n|---|---:|---:|\n| Lipid Profile Advance | 49,180 | 42.1% |\n| Kidney Function Test Advance | 49,027 | 42.0% |\n| HbA1c | 49,017 | 42.0% |\n| Vitamin D Total | 49,006 | 42.0% |\n| TSH Ultra Sensitive | 48,961 | 42.1% |\n| Complete Hemogram | 48,867 | 42.1% |\n\nSource: conversion by recommended test [cohort-retention:Q2]. Recommendation volume and conversion are nearly identical across tests, confirming the nudge is generic rather than tailored to the parameter that came back abnormal.\n\n### It is flat at the parameter level too\n\nWe pushed the severity test down to the actual abnormal-parameter count, the sharpest clinical signal available. Recommendations attached to a report with a critical flag book at **42.0%**, those with three or more abnormal parameters at **42.1%**, and those with only one or two abnormal at **42.1%** [cohort-retention:Q3]. Even at this granularity, clinical severity moves the booking rate by essentially zero. The engine genuinely does not distinguish a sick patient from a borderline one.\n\n### Who recommends and how often does not change it either\n\n| Recommendation source | Recommendations | Booked in window |\n|---|---:|---:|\n| Report advisory (engine) | 191,114 | 42.1% |\n| Counselor | 102,944 | 42.0% |\n\nWhether the next test is suggested by the automated report engine or by a counselor, conversion is identical at ~42% [user-segmentation:Q1]. The same holds across recommended cadence: quarterly, half-yearly, and annual recommendations all convert at ~42% [daily-metrics:Q2]. And it holds geographically: tier-2 42.2%, tier-1 42.1%, metro 41.9% [geographic:Q1]. Every cut lands on the same number, which is the signature of a generic, un-personalized nudge.\n\n### This connects to the counseling gate\n\nFollow-up bookings are effectively zero without a counseling session and ~38% with one [rev-opt:Q1]. The 42% recommendation-booking rate is being carried by the ~33% of customers who get counseled; the rest book on their own initiative regardless of how sick they are. **Severity is not yet a lever we pull.**\n\n### Sizing the upside\n\nThe poor-score tier alone is **72,977 recommendations** converting at 42.2% [cohort-retention:Q1]. Lifting it to a 55% target, at the ₹758 repeat ticket, adds **9,341 extra bookings worth ₹7.08M** [rev-opt:Q3], and those are precisely the clinically urgent, higher-value retests that monitoring programs are built around.\n\n### Risks and caveats\n\n- The 55% target is an aspiration, not a proven achievable rate; the realistic lift depends on how much of the gap is addressable by prioritized counseling versus intrinsic customer reluctance.\n- The ₹7.08M is computed at the historical ₹758 repeat ticket; poor-score retests may skew toward specific chronic panels with different pricing.\n- A flat 42% across every cut could partly reflect a synthetic recommendation generator; in production, re-validate that severity truly does not move conversion before investing heavily in risk-weighting.\n\n### Key Findings\n\n- Smart Report conversion is a flat **~42% across all health scores** [cohort-retention:Q1], all recommended tests [cohort-retention:Q2], all abnormal-parameter counts [cohort-retention:Q3], both recommendation sources [user-segmentation:Q1], all cadences [daily-metrics:Q2], and all city tiers [geographic:Q1].\n- The engine therefore does not prioritize the sickest patients on any available clinical dimension.\n- The booking rate is gated by counseling coverage, which itself ignores severity (36.2% on critical vs 32.5% overall) [rev-opt:Q2].\n- Lifting the poor tier from 42.2% to 55% is worth ~₹7.08M and 9,341 clinically urgent retests [rev-opt:Q3].\n\n### Recommended Actions\n\n1. **Risk-weight the recommendation queue**: route poor and fair health-score reports to priority counseling and WhatsApp follow-up first.\n2. **Personalize the nudge to the abnormal parameter** (\"your HbA1c was high, recheck in 90 days\") instead of a generic next-test list.\n3. **Set a higher conversion target for poor-score reports** (e.g. 55%) and measure the gap to today's 42.2% as recoverable clinical revenue worth ~₹7.08M [rev-opt:Q3].\n4. **Chain recommendation into counseling into subscription** so an abnormal result that needs quarterly monitoring rolls straight onto a recurring plan.\n\n```sql\n-- Smart Report follow-up conversion by clinical severity (health score)\nSELECT\n  health_score_category,\n  COUNT(*)                                                            AS recommendations,\n  SUM(CASE WHEN booked_within_window THEN 1 ELSE 0 END)               AS booked,\n  ROUND(100.0 * AVG(CASE WHEN booked_within_window THEN 1 ELSE 0 END), 1) AS booked_pct\nFROM future_tests_full\nGROUP BY health_score_category\nORDER BY booked_pct DESC;\n```",
    followUps: [
      "How much extra revenue if poor-score reports converted at 55% instead of 42%?",
      "Which abnormal parameters have the lowest follow-up booking rate?",
      "Do personalized recommendations convert better when sent over WhatsApp?",
      "What share of poor-score recommendations also got a counseling session?",
    ],
    work: {
      "daily-metrics": {
        queries: [
          {
            description: "Total Smart Report recommendations and overall in-window booking rate",
            sql: "SELECT COUNT(*) AS recommendations,\n       SUM(CASE WHEN booked_within_window THEN 1 ELSE 0 END) AS booked,\n       ROUND(100.0 * AVG(CASE WHEN booked_within_window THEN 1 ELSE 0 END), 1) AS booked_pct\nFROM future_tests_full;",
            rowCount: 1,
            executionTimeMs: 698,
            columns: ["recommendations", "booked", "booked_pct"],
            data: [{ recommendations: 294058, booked: 123654, booked_pct: 42.1 }],
          },
          {
            description: "Recommendation booking rate by recommended cadence, testing whether urgency of the schedule changes conversion",
            sql: "SELECT recommended_frequency,\n       COUNT(*) AS recs,\n       ROUND(100.0 * AVG(CASE WHEN booked_within_window THEN 1 ELSE 0 END), 1) AS booked_pct\nFROM future_tests_full\nGROUP BY recommended_frequency\nORDER BY recs DESC\nLIMIT 6;",
            rowCount: 3,
            executionTimeMs: 812,
            columns: ["recommended_frequency", "recs", "booked_pct"],
            data: [
              { recommended_frequency: "every_3_months", recs: 147050, booked_pct: 42.0 },
              { recommended_frequency: "every_6_months", recs: 98141, booked_pct: 42.1 },
              { recommended_frequency: "every_1_month", recs: 48867, booked_pct: 42.1 },
            ],
          },
        ],
        summary:
          "The engine generated 294,058 follow-up recommendations and 42.1% (123,654) were booked in window; conversion is also flat across every recommended cadence (~42% for monthly, quarterly, and half-yearly), reinforcing that the nudge is generic.",
      },
      "cohort-retention": {
        queries: [
          {
            description: "Recommendation booking rate by report health-score category (clinical severity)",
            sql: "SELECT health_score_category,\n       COUNT(*) AS recommendations,\n       ROUND(100.0 * AVG(CASE WHEN booked_within_window THEN 1 ELSE 0 END), 1) AS booked_pct\nFROM future_tests_full\nGROUP BY health_score_category\nORDER BY booked_pct DESC;",
            rowCount: 4,
            executionTimeMs: 812,
            columns: ["health_score_category", "recommendations", "booked_pct"],
            data: [
              { health_score_category: "poor", recommendations: 72977, booked_pct: 42.2 },
              { health_score_category: "excellent", recommendations: 30831, booked_pct: 42.1 },
              { health_score_category: "good", recommendations: 77799, booked_pct: 42.0 },
              { health_score_category: "fair", recommendations: 112451, booked_pct: 42.0 },
            ],
          },
          {
            description: "Recommendation booking rate by recommended test",
            sql: "SELECT test_name,\n       COUNT(*) AS recommendations,\n       ROUND(100.0 * AVG(CASE WHEN booked_within_window THEN 1 ELSE 0 END), 1) AS booked_pct\nFROM future_tests_full\nGROUP BY test_name\nORDER BY recommendations DESC\nLIMIT 6;",
            rowCount: 6,
            executionTimeMs: 905,
            columns: ["test_name", "recommendations", "booked_pct"],
            data: [
              { test_name: "Lipid Profile Advance", recommendations: 49180, booked_pct: 42.1 },
              { test_name: "Kidney Function Test Advance", recommendations: 49027, booked_pct: 42.0 },
              { test_name: "HbA1c", recommendations: 49017, booked_pct: 42.0 },
              { test_name: "Vitamin D Total-25 Hydroxy", recommendations: 49006, booked_pct: 42.0 },
              { test_name: "TSH Ultra Sensitive", recommendations: 48961, booked_pct: 42.1 },
              { test_name: "Complete Hemogram", recommendations: 48867, booked_pct: 42.1 },
            ],
          },
          {
            description: "Conversion bucketed by the originating report's abnormal-parameter severity, the sharpest clinical signal available",
            sql: "SELECT CASE WHEN critical_params_count > 0 THEN 'has_critical'\n            WHEN abnormal_params_count >= 3 THEN '3+_abnormal'\n            WHEN abnormal_params_count > 0 THEN '1-2_abnormal'\n            ELSE 'none' END AS severity,\n       COUNT(*) AS recs,\n       ROUND(100.0 * AVG(CASE WHEN booked_within_window THEN 1 ELSE 0 END), 1) AS booked_pct\nFROM future_tests_full\nGROUP BY severity\nORDER BY booked_pct DESC;",
            rowCount: 3,
            executionTimeMs: 934,
            columns: ["severity", "recs", "booked_pct"],
            data: [
              { severity: "1-2_abnormal", recs: 36931, booked_pct: 42.1 },
              { severity: "3+_abnormal", recs: 146772, booked_pct: 42.1 },
              { severity: "has_critical", recs: 110355, booked_pct: 42.0 },
            ],
          },
        ],
        summary:
          "Conversion is a flat ~42% across every health-score tier (poor 42.2% vs excellent 42.1%), all six recommended tests, and even at the abnormal-parameter level (critical 42.0% vs 1-2 abnormal 42.1%), confirming the nudge is generic and ignores clinical severity entirely.",
      },
      "rev-opt": {
        queries: [
          {
            description: "Follow-up conversion gated by counseling, split by report severity (the counseling gate behind the 42% rate)",
            sql: "WITH report_bookings AS (\n  SELECT b.counseling_taken, b.follow_up_booked,\n    CASE WHEN rep.critical_params_count > 0 THEN 'critical'\n         WHEN rep.abnormal_params_count > 0 THEN 'abnormal_noncritical'\n         ELSE 'normal' END AS severity\n  FROM bookings_full b\n  JOIN reports_full rep ON rep.booking_id = b.booking_id\n  WHERE b.booking_status = 'completed'\n)\nSELECT severity, counseling_taken, COUNT(*) AS bookings,\n       ROUND(100.0 * AVG(CASE WHEN follow_up_booked THEN 1 ELSE 0 END), 1) AS follow_up_pct\nFROM report_bookings\nGROUP BY severity, counseling_taken\nORDER BY severity, counseling_taken;",
            rowCount: 6,
            executionTimeMs: 1903,
            columns: ["severity", "counseling_taken", "bookings", "follow_up_pct"],
            data: [
              { severity: "abnormal_noncritical", counseling_taken: false, bookings: 78809, follow_up_pct: 0 },
              { severity: "abnormal_noncritical", counseling_taken: true, bookings: 43796, follow_up_pct: 37.9 },
              { severity: "critical", counseling_taken: false, bookings: 46938, follow_up_pct: 0 },
              { severity: "critical", counseling_taken: true, bookings: 26596, follow_up_pct: 37.5 },
              { severity: "normal", counseling_taken: false, bookings: 3229, follow_up_pct: 0 },
              { severity: "normal", counseling_taken: true, bookings: 1852, follow_up_pct: 40 },
            ],
          },
          {
            description: "Counseling coverage on all completed bookings versus critical-flag bookings",
            sql: "SELECT 'all_completed' AS cohort, COUNT(*) AS bookings,\n       ROUND(100.0 * AVG(CASE WHEN counseling_taken THEN 1 ELSE 0 END), 1) AS counseled_pct\nFROM bookings_full WHERE booking_status = 'completed'\nUNION ALL\nSELECT 'critical_flag', COUNT(*),\n       ROUND(100.0 * AVG(CASE WHEN b.counseling_taken THEN 1 ELSE 0 END), 1)\nFROM bookings_full b\nJOIN reports_full r ON r.booking_id = b.booking_id\nWHERE b.booking_status = 'completed' AND r.critical_params_count > 0;",
            rowCount: 2,
            executionTimeMs: 1612,
            columns: ["cohort", "bookings", "counseled_pct"],
            data: [
              { cohort: "all_completed", bookings: 222455, counseled_pct: 32.5 },
              { cohort: "critical_flag", bookings: 73534, counseled_pct: 36.2 },
            ],
          },
          {
            description: "Upside sizing: extra bookings and revenue if poor-score recommendations converted at 55% instead of today's 42.2%",
            sql: "WITH poor AS (\n  SELECT COUNT(*) AS n FROM future_tests_full WHERE health_score_category = 'poor'\n),\naov AS (\n  SELECT AVG(total_paid_inr) AS t FROM bookings_full WHERE booking_status = 'completed' AND is_first_booking = false\n)\nSELECT poor.n AS poor_recs,\n       ROUND(poor.n * 0.422) AS booked_now,\n       ROUND(poor.n * 0.55) AS booked_at_55,\n       ROUND(poor.n * (0.55 - 0.422)) AS extra_bookings,\n       ROUND(poor.n * (0.55 - 0.422) * aov.t) AS extra_revenue_inr\nFROM poor, aov;",
            rowCount: 1,
            executionTimeMs: 1058,
            columns: ["poor_recs", "booked_now", "booked_at_55", "extra_bookings", "extra_revenue_inr"],
            data: [{ poor_recs: 72977, booked_now: 30796, booked_at_55: 40137, extra_bookings: 9341, extra_revenue_inr: 7084853 }],
          },
        ],
        summary:
          "The 42% recommendation-booking rate is gated by counseling (0% without, ~38% with) which itself ignores severity (36.2% on critical vs 32.5% overall); lifting the 72,977 poor-score recommendations from 42.2% to 55% adds 9,341 bookings worth ₹7.08M.",
      },
      "user-segmentation": {
        queries: [
          {
            description: "Recommendation booking rate split by who made the recommendation, the automated report engine versus a human counselor",
            sql: "SELECT recommended_by,\n       COUNT(*) AS recs,\n       ROUND(100.0 * AVG(CASE WHEN booked_within_window THEN 1 ELSE 0 END), 1) AS booked_pct\nFROM future_tests_full\nGROUP BY recommended_by\nORDER BY recs DESC;",
            rowCount: 2,
            executionTimeMs: 743,
            columns: ["recommended_by", "recs", "booked_pct"],
            data: [
              { recommended_by: "report_advisory", recs: 191114, booked_pct: 42.1 },
              { recommended_by: "counselor", recs: 102944, booked_pct: 42.0 },
            ],
          },
        ],
        summary:
          "Engine-generated and counselor-generated recommendations convert identically at ~42%, so the source of the recommendation does not change the outcome and the genericness is in the nudge itself, not in who issues it.",
      },
      geographic: {
        queries: [
          {
            description: "Recommendation booking rate by city tier, the geographic cut of the severity-blind conversion pattern",
            sql: "SELECT city_tier,\n       COUNT(*) AS recs,\n       ROUND(100.0 * AVG(CASE WHEN booked_within_window THEN 1 ELSE 0 END), 1) AS booked_pct\nFROM future_tests_full\nGROUP BY city_tier\nORDER BY booked_pct DESC;",
            rowCount: 3,
            executionTimeMs: 681,
            columns: ["city_tier", "recs", "booked_pct"],
            data: [
              { city_tier: "tier2", recs: 94652, booked_pct: 42.2 },
              { city_tier: "tier1", recs: 82513, booked_pct: 42.1 },
              { city_tier: "metro", recs: 116893, booked_pct: 41.9 },
            ],
          },
        ],
        summary:
          "Recommendation conversion is flat across city tiers too (tier-2 42.2%, tier-1 42.1%, metro 41.9%), so the generic-nudge pattern is national and not driven by any single geography.",
      },
    },
  }),
];

export const HEALTHIANS_STARTER_CHATS: StarterChat[] = [...normals, ...deeps];
