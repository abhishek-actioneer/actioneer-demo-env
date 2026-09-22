import {
  deepResearchThread,
  normalThread,
  type StarterChat,
} from "@/lib/server/starter-chats";

// QuickHelp: on-demand home-services marketplace.
// All figures validated against data/quickhelp.duckdb (READ_ONLY) over the
// Feb 2025 to Feb 2026 window. Completed = payment_status='success'.

const normals: StarterChat[] = [
  normalThread({
    slug: "gmv-by-service-and-tier",
    title: "Which services drive GMV, and how does it split by tier?",
    question:
      "Which service categories drive the most GMV, and how does that split across our service tiers?",
    answer:
      "Completed GMV (successful bookings only) totals **₹87.7M** over Feb 2025 to Feb 2026 across **199,293** bookings [rev-opt:Q3]. The money is in the big, infrequent jobs, not the high-volume daily chores.\n\n### GMV by service category\n\n| Service type | GMV | Bookings | Avg ticket |\n| --- | ---: | ---: | ---: |\n| Move-in/Move-out Cleaning | ₹8.22M | 7,475 | ₹1,100 |\n| Deep Cleaning | ₹7.47M | 7,485 | ₹998 |\n| After-Party Clean | ₹6.79M | 7,543 | ₹901 |\n| Complete Wardrobe Cleaning | ₹6.36M | 7,452 | ₹853 |\n| Full House Cleaning | ₹5.54M | 10,090 | ₹549 |\n\nThe top five categories are all large, occasional jobs averaging ₹549 to ₹1,100 a ticket [rev-opt:Q1]. None of them is a daily chore. But the book is not as concentrated as a top-five list makes it look: those five categories together carry only **39.2% of total GMV**, and you need ten categories to clear 67.6% [rev-opt:Q4]. Revenue is spread across a long tail of mid-sized cleaning jobs rather than riding on two or three hero services.\n\n### GMV by service tier\n\nBy tier, volume and value pull in opposite directions [rev-opt:Q2]:\n\n| Tier | GMV | Bookings | Avg ticket |\n| --- | ---: | ---: | ---: |\n| Standard | ₹29.17M | 79,547 | ₹367 |\n| Premium | ₹28.84M | 29,955 | ₹963 |\n| Extended | ₹19.72M | 39,856 | ₹495 |\n| Quick | ₹9.97M | 49,935 | ₹200 |\n\n**Premium does nearly as much GMV as Standard (₹28.84M vs ₹29.17M) on roughly a third of the bookings** (29,955 vs 79,547), thanks to a ₹963 average ticket that is 2.6x the Standard ticket [rev-opt:Q2]. Quick services are 25% of bookings (49,935) but under 12% of GMV (₹9.97M) [rev-opt:Q2].\n\n### Premium attach is flat across the map\n\nA natural next question is whether richer city tiers buy more premium. They do not. Premium is a near-constant **15% of bookings and ~33% of GMV in every city tier** [rev-opt:Q5]:\n\n| City tier | Bookings | Premium booking share | Premium GMV share |\n| --- | ---: | ---: | ---: |\n| Semi-Urban | 19,894 | 15.2% | 33.1% |\n| Urban | 30,068 | 15.0% | 32.9% |\n| Metropolitan | 149,331 | 15.0% | 32.9% |\n\nThat flatness is itself the opportunity: premium attach is not capped by geography, so the lever is merchandising and prompting, not market.\n\n### GMV momentum\n\nMonthly GMV is not a straight line. It built from ₹2.99M in Feb 2025 to a ₹9.50M peak in Nov 2025, then slid for three straight months to ₹7.42M in Feb 2026 [rev-opt:Q6]. The recent dip (Dec down 9.2%, Jan down 10.9%) is worth watching, though some of it is seasonal post-festival cooling.\n\nThe takeaway: protect the big-job categories, push premium attach everywhere (not just the metro), and treat the three-month GMV slide as a signal rather than noise. One premium booking is worth almost five quick ones on ticket size alone.",
    followUps: [
      "What's the contribution margin on each of these service categories?",
      "Which service categories quietly lose us money?",
      "How does premium attach vary by city tier?",
    ],
    primaryAgent: { id: "rev-opt", name: "Revenue Optimization Agent", icon: "dollar" },
    work: {
      summary:
        "Pulled completed GMV by service category and by tier, the business-wide totals, a cumulative GMV concentration curve, premium attach by city tier, and a monthly GMV trend to show where revenue concentrates and how it is moving.",
      queries: [
          {
            sql: "SELECT service_type, ROUND(SUM(booking_value) / 1e6, 2) AS gmv_millions, COUNT(*) AS bookings, ROUND(AVG(booking_value), 0) AS avg_ticket FROM bookings WHERE payment_status = 'success' GROUP BY service_type ORDER BY gmv_millions DESC LIMIT 5;",
            description: "Top 5 service categories by completed GMV with avg ticket",
            rowCount: 5,
            executionTimeMs: 612,
            columns: ["service_type", "gmv_millions", "bookings", "avg_ticket"],
            data: [
              { service_type: "Move-in/Move-out Cleaning", gmv_millions: 8.22, bookings: 7475, avg_ticket: 1100 },
              { service_type: "Deep Cleaning", gmv_millions: 7.47, bookings: 7485, avg_ticket: 998 },
              { service_type: "After-Party Clean", gmv_millions: 6.79, bookings: 7543, avg_ticket: 901 },
              { service_type: "Complete Wardrobe Cleaning", gmv_millions: 6.36, bookings: 7452, avg_ticket: 853 },
              { service_type: "Full House Cleaning", gmv_millions: 5.54, bookings: 10090, avg_ticket: 549 },
            ],
          },
          {
            sql: "SELECT service_tier, ROUND(SUM(booking_value) / 1e6, 2) AS gmv_millions, COUNT(*) AS bookings, ROUND(AVG(booking_value), 0) AS avg_ticket FROM bookings WHERE payment_status = 'success' GROUP BY service_tier ORDER BY gmv_millions DESC;",
            description: "Completed GMV, bookings and avg ticket by service tier",
            rowCount: 4,
            executionTimeMs: 488,
            columns: ["service_tier", "gmv_millions", "bookings", "avg_ticket"],
            data: [
              { service_tier: "standard", gmv_millions: 29.17, bookings: 79547, avg_ticket: 367 },
              { service_tier: "premium", gmv_millions: 28.84, bookings: 29955, avg_ticket: 963 },
              { service_tier: "extended", gmv_millions: 19.72, bookings: 39856, avg_ticket: 495 },
              { service_tier: "quick", gmv_millions: 9.97, bookings: 49935, avg_ticket: 200 },
            ],
          },
          {
            sql: "SELECT ROUND(SUM(booking_value) / 1e6, 2) AS gmv_millions, COUNT(*) AS bookings FROM bookings WHERE payment_status = 'success';",
            description: "Business-wide completed GMV and booking count",
            rowCount: 1,
            executionTimeMs: 241,
            columns: ["gmv_millions", "bookings"],
            data: [{ gmv_millions: 87.7, bookings: 199293 }],
          },
          {
            sql: "WITH cat AS (SELECT service_type, SUM(booking_value) AS gmv FROM bookings WHERE payment_status = 'success' GROUP BY service_type), c AS (SELECT service_type, gmv, ROUND(100.0 * SUM(gmv) OVER (ORDER BY gmv DESC) / SUM(gmv) OVER (), 1) AS cum_pct, ROW_NUMBER() OVER (ORDER BY gmv DESC) AS rn FROM cat) SELECT rn, service_type, ROUND(gmv / 1e6, 2) AS gmv_millions, cum_pct FROM c ORDER BY rn LIMIT 10;",
            description: "Cumulative GMV concentration curve across top 10 categories",
            rowCount: 10,
            executionTimeMs: 704,
            columns: ["rn", "service_type", "gmv_millions", "cum_pct"],
            data: [
              { rn: 1, service_type: "Move-in/Move-out Cleaning", gmv_millions: 8.22, cum_pct: 9.4 },
              { rn: 2, service_type: "Deep Cleaning", gmv_millions: 7.47, cum_pct: 17.9 },
              { rn: 3, service_type: "After-Party Clean", gmv_millions: 6.79, cum_pct: 25.6 },
              { rn: 4, service_type: "Complete Wardrobe Cleaning", gmv_millions: 6.36, cum_pct: 32.9 },
              { rn: 5, service_type: "Full House Cleaning", gmv_millions: 5.54, cum_pct: 39.2 },
              { rn: 6, service_type: "Bathroom Cleaning", gmv_millions: 5.29, cum_pct: 45.2 },
              { rn: 7, service_type: "Kitchen Cleaning", gmv_millions: 4.98, cum_pct: 50.9 },
              { rn: 8, service_type: "Laundry", gmv_millions: 4.97, cum_pct: 56.6 },
              { rn: 9, service_type: "Kitchen Cabinet Cleaning", gmv_millions: 4.89, cum_pct: 62.2 },
              { rn: 10, service_type: "Fridge Surface Cleaning", gmv_millions: 4.77, cum_pct: 67.6 },
            ],
          },
          {
            sql: "SELECT city, COUNT(*) AS bookings, ROUND(100.0 * COUNT(*) FILTER (WHERE service_tier = 'premium') / COUNT(*), 1) AS premium_share_pct, ROUND(100.0 * SUM(booking_value) FILTER (WHERE service_tier = 'premium') / SUM(booking_value), 1) AS premium_gmv_pct, ROUND(AVG(booking_value), 0) AS avg_ticket FROM bookings WHERE payment_status = 'success' GROUP BY city ORDER BY premium_gmv_pct DESC;",
            description: "Premium attach (booking share and GMV share) by city tier",
            rowCount: 3,
            executionTimeMs: 533,
            columns: ["city", "bookings", "premium_share_pct", "premium_gmv_pct", "avg_ticket"],
            data: [
              { city: "Semi-Urban", bookings: 19894, premium_share_pct: 15.2, premium_gmv_pct: 33.1, avg_ticket: 441 },
              { city: "Urban", bookings: 30068, premium_share_pct: 15.0, premium_gmv_pct: 32.9, avg_ticket: 441 },
              { city: "Metropolitian", bookings: 149331, premium_share_pct: 15.0, premium_gmv_pct: 32.9, avg_ticket: 440 },
            ],
          },
          {
            sql: "WITH m AS (SELECT DATE_TRUNC('month', booking_date) AS mo, SUM(booking_value) AS gmv, COUNT(*) AS bk FROM bookings WHERE payment_status = 'success' GROUP BY 1) SELECT STRFTIME(mo, '%Y-%m') AS month, ROUND(gmv / 1e6, 2) AS gmv_millions, bk AS bookings, ROUND(100.0 * (gmv - LAG(gmv) OVER (ORDER BY mo)) / LAG(gmv) OVER (ORDER BY mo), 1) AS mom_pct FROM m ORDER BY mo;",
            description: "Monthly completed GMV with month-over-month growth",
            rowCount: 13,
            executionTimeMs: 689,
            columns: ["month", "gmv_millions", "bookings", "mom_pct"],
            data: [
              { month: "2025-02", gmv_millions: 2.99, bookings: 6788, mom_pct: null },
              { month: "2025-05", gmv_millions: 7.35, bookings: 16845, mom_pct: 12.5 },
              { month: "2025-07", gmv_millions: 5.30, bookings: 12041, mom_pct: -15.3 },
              { month: "2025-10", gmv_millions: 9.36, bookings: 21361, mom_pct: 43.1 },
              { month: "2025-11", gmv_millions: 9.50, bookings: 21567, mom_pct: 1.6 },
              { month: "2025-12", gmv_millions: 8.62, bookings: 19457, mom_pct: -9.2 },
              { month: "2026-01", gmv_millions: 7.68, bookings: 17536, mom_pct: -10.9 },
              { month: "2026-02", gmv_millions: 7.42, bookings: 16865, mom_pct: -3.4 },
            ],
          },
        ],
      },
  }),
  normalThread({
    slug: "repeat-booking-rate",
    title: "What's our repeat-booking rate?",
    question:
      "What's our repeat-booking rate, and how fast do first-time customers come back?",
    answer:
      "Of the **14,854** customers who have ever completed a booking, **12,509 (84.2%)** have made 2 or more [cohort-retention:Q1]. For an on-demand home-services marketplace, that is a strong habitual base.\n\nThe habit forms fast for those who return, but the window is tight [cohort-retention:Q2]:\n\n| Milestone after first booking | Customers | Share |\n| --- | ---: | ---: |\n| Re-booked within 14 days | 5,053 | 34.0% |\n| Re-booked within 30 days | 7,926 | 53.4% |\n| Ever re-booked (lifetime) | 12,509 | 84.2% |\n\nSo the headline 84.2% measures *eventual* return, while only **34.0% re-book in the first two weeks** and **53.4% within the first month** [cohort-retention:Q2]. That first fortnight is where one-off trials either become a habit or go cold.\n\n### How fast the second booking actually lands\n\nLooking only at customers who did come back, the timing spread is wide [cohort-retention:Q3]:\n\n| Percentile of repeaters | Days to second booking |\n| --- | ---: |\n| 25th (fast quartile) | 8 days |\n| 50th (median) | 20 days |\n| 75th (slow quartile) | 43 days |\n\nThe median repeater returns in **20 days**, and a slow quartile takes more than six weeks [cohort-retention:Q3]. So even among people who form the habit, half do not re-book inside the three-week mark, which is why a single welcome email on day one is not enough.\n\n### Revenue is carried by a heavy-repeat core\n\nLifetime booking counts are extremely top-heavy [cohort-retention:Q4]:\n\n| Lifetime bookings | Customers | Share of customers | Share of bookings |\n| --- | ---: | ---: | ---: |\n| 1 (one-off) | 2,345 | 15.8% | 1.2% |\n| 2 to 3 | 3,340 | 22.5% | 4.1% |\n| 4 to 9 | 4,624 | 31.1% | 13.9% |\n| 10+ | 4,545 | 30.6% | **80.8%** |\n\nThe **30.6% of customers who book 10 or more times generate 80.8% of all completed bookings** [cohort-retention:Q4]. The one-off cohort, by contrast, is 15.8% of customers but barely 1.2% of bookings. The whole business runs on converting trialists into the heavy-repeat band.\n\n### Repeat rate is steady across acquisition sources\n\nWhere customers came from barely moves the repeat rate: every source lands in a tight **83.1% to 84.9% band** [cohort-retention:Q5]. Meta (84.9%) and Google (84.8%) edge out referral (83.1%) and WhatsApp (83.2%), but the spread is under two points, so channel quality is not the retention lever here.\n\nThe gap between the 34.0% two-week figure and the 84.2% lifetime figure is the prize: roughly half of all eventual repeaters take longer than two weeks to come back, and many of them drift before they form a rhythm. A nudge inside the first 14 days is therefore the single highest-leverage retention move, because it works on the exact window where the habit is still being decided [cohort-retention:Q2].",
    followUps: [
      "Does the first-booking experience predict whether they come back?",
      "Why is newer-cohort retention falling off a cliff?",
      "Which customers drive most of our lifetime revenue?",
    ],
    primaryAgent: { id: "cohort-retention", name: "Cohort Retention Agent", icon: "users" },
    work: {
      summary:
        "Measured the lifetime repeat rate, the 14/30-day re-book windows, the percentile spread of days-to-second-booking, the lifetime-booking distribution that shows revenue concentration, and repeat rate by acquisition source.",
      queries: [
          {
            sql: "WITH c AS (SELECT customer_id, COUNT(*) AS n FROM bookings WHERE payment_status = 'success' GROUP BY customer_id) SELECT COUNT(*) AS total_customers, SUM(CASE WHEN n >= 2 THEN 1 ELSE 0 END) AS repeaters, ROUND(100.0 * SUM(CASE WHEN n >= 2 THEN 1 ELSE 0 END) / COUNT(*), 1) AS repeat_pct FROM c;",
            description: "Lifetime repeat-booking rate across all completed customers",
            rowCount: 1,
            executionTimeMs: 414,
            columns: ["total_customers", "repeaters", "repeat_pct"],
            data: [{ total_customers: 14854, repeaters: 12509, repeat_pct: 84.2 }],
          },
          {
            sql: "WITH firstb AS (SELECT customer_id, MIN(booking_date) AS first_date FROM bookings WHERE payment_status = 'success' GROUP BY customer_id), seconds AS (SELECT b.customer_id, MIN(b.booking_date) AS second_date FROM bookings b JOIN firstb f ON b.customer_id = f.customer_id AND b.booking_date > f.first_date WHERE b.payment_status = 'success' GROUP BY b.customer_id) SELECT COUNT(*) AS total, SUM(CASE WHEN DATE_DIFF('day', f.first_date, s.second_date) <= 14 THEN 1 ELSE 0 END) AS within_14, SUM(CASE WHEN DATE_DIFF('day', f.first_date, s.second_date) <= 30 THEN 1 ELSE 0 END) AS within_30 FROM firstb f LEFT JOIN seconds s ON f.customer_id = s.customer_id;",
            description: "Second-booking speed: re-book within 14 and 30 days of first booking",
            rowCount: 1,
            executionTimeMs: 1126,
            columns: ["total", "within_14", "within_30"],
            data: [{ total: 14854, within_14: 5053, within_30: 7926 }],
          },
          {
            sql: "WITH firstb AS (SELECT customer_id, MIN(booking_date) AS first_date FROM bookings WHERE payment_status = 'success' GROUP BY customer_id), sec AS (SELECT b.customer_id, MIN(b.booking_date) AS second_date FROM bookings b JOIN firstb f ON b.customer_id = f.customer_id AND b.booking_date > f.first_date WHERE b.payment_status = 'success' GROUP BY b.customer_id) SELECT COUNT(*) AS repeaters, ROUND(quantile_cont(DATE_DIFF('day', f.first_date, s.second_date), 0.25), 0) AS p25_days, ROUND(MEDIAN(DATE_DIFF('day', f.first_date, s.second_date)), 0) AS median_days, ROUND(quantile_cont(DATE_DIFF('day', f.first_date, s.second_date), 0.75), 0) AS p75_days FROM firstb f JOIN sec s ON f.customer_id = s.customer_id;",
            description: "Percentile spread of days from first to second booking",
            rowCount: 1,
            executionTimeMs: 1342,
            columns: ["repeaters", "p25_days", "median_days", "p75_days"],
            data: [{ repeaters: 12499, p25_days: 8, median_days: 20, p75_days: 43 }],
          },
          {
            sql: "WITH c AS (SELECT customer_id, COUNT(*) AS n FROM bookings WHERE payment_status = 'success' GROUP BY customer_id) SELECT CASE WHEN n = 1 THEN '1 (one-off)' WHEN n BETWEEN 2 AND 3 THEN '2-3' WHEN n BETWEEN 4 AND 9 THEN '4-9' ELSE '10+' END AS booking_band, COUNT(*) AS customers, ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct_customers, ROUND(100.0 * SUM(n) / SUM(SUM(n)) OVER (), 1) AS pct_bookings FROM c GROUP BY 1 ORDER BY MIN(n);",
            description: "Customer distribution by lifetime booking band vs share of bookings",
            rowCount: 4,
            executionTimeMs: 598,
            columns: ["booking_band", "customers", "pct_customers", "pct_bookings"],
            data: [
              { booking_band: "1 (one-off)", customers: 2345, pct_customers: 15.8, pct_bookings: 1.2 },
              { booking_band: "2-3", customers: 3340, pct_customers: 22.5, pct_bookings: 4.1 },
              { booking_band: "4-9", customers: 4624, pct_customers: 31.1, pct_bookings: 13.9 },
              { booking_band: "10+", customers: 4545, pct_customers: 30.6, pct_bookings: 80.8 },
            ],
          },
          {
            sql: "WITH cnt AS (SELECT customer_id, COUNT(*) AS n, ANY_VALUE(acquisition_source) AS src FROM bookings WHERE payment_status = 'success' GROUP BY customer_id) SELECT src AS acquisition_source, COUNT(*) AS customers, ROUND(100.0 * SUM(CASE WHEN n >= 2 THEN 1 ELSE 0 END) / COUNT(*), 1) AS repeat_pct, ROUND(AVG(n), 1) AS avg_bookings FROM cnt GROUP BY src ORDER BY repeat_pct DESC;",
            description: "Lifetime repeat rate by acquisition source",
            rowCount: 5,
            executionTimeMs: 712,
            columns: ["acquisition_source", "customers", "repeat_pct", "avg_bookings"],
            data: [
              { acquisition_source: "meta", customers: 3017, repeat_pct: 84.9, avg_bookings: 13.1 },
              { acquisition_source: "google", customers: 3715, repeat_pct: 84.8, avg_bookings: 12.5 },
              { acquisition_source: "organic", customers: 5206, repeat_pct: 84.0, avg_bookings: 14.2 },
              { acquisition_source: "whatsapp", customers: 727, repeat_pct: 83.2, avg_bookings: 11.8 },
              { acquisition_source: "referral", customers: 2189, repeat_pct: 83.1, avg_bookings: 14.1 },
            ],
          },
        ],
      },
  }),
];

const deeps: StarterChat[] = [
  deepResearchThread({
    slug: "category-quietly-losing-money",
    title: "Which service category is quietly losing us money?",
    question:
      "Which service categories are quietly losing us money once you account for partner payout and support cost?",
    report:
      "## Executive summary\n\nThe low-ticket daily-chore services are quietly draining margin. Blended contribution margin across the business is a healthy-looking **24.6%** (₹21.6M on ₹87.7M completed GMV, about ₹108 per booking) [rev-opt:Q1], but that single number hides a steep gradient. Margin rises almost monotonically with ticket size: the bottom-fifth of bookings by ticket clears 18.5% while the top fifth clears 27.5% [rev-opt:Q4]. The small recurring chores (dusting, folding, ironing, dishes) sit at the very bottom, earning as little as ₹33 per visit after partner payout and support cost are removed [rev-opt:Q2]. They are not loss-making in the strict sense, but they earn so little that they fail to cover the operational attention they consume, and they almost never graduate the customer into the high-margin big jobs that actually fund the business.\n\nThis is not a geography problem and not a recent decline. Contribution margin is flat across all three city tiers (24.6% to 24.8%) [geographic:Q1], and it has held in a tight 23.3% to 26.0% band every month for a year [daily-metrics:Q1]. The leak is structural and lives entirely in the service mix.\n\n## Methodology and data note\n\nAll figures are computed from `bookings_economics` over the Feb 2025 to Feb 2026 window, restricted to `payment_status = 'success'` so cancelled and refunded jobs do not distort margin. Contribution margin is the table's own `contribution_margin` field (booking value minus partner payout, payment processing fee, promo and referral funding, and allocated support cost). We define a 'low-ticket chore' as any booking under ₹250, which cleanly separates the recurring daily tasks from standard-and-up cleaning jobs. Ticket-size quintiles use an `NTILE(5)` window over booking value so each band holds roughly 39,860 bookings.\n\n## Margin rises with ticket size\n\nGrouping every booking into five equal-size ticket bands shows the gradient directly [rev-opt:Q4]:\n\n| Ticket quintile | Bookings | Ticket range | Avg CM | Margin % |\n| --- | ---: | --- | ---: | ---: |\n| Q1 (smallest) | 39,859 | ₹149 to ₹226 | ₹35 | **18.5%** |\n| Q2 | 39,859 | ₹226 to ₹351 | ₹68 | 22.1% |\n| Q3 | 39,859 | ₹351 to ₹409 | ₹89 | 23.4% |\n| Q4 | 39,858 | ₹409 to ₹535 | ₹113 | 24.5% |\n| Q5 (largest) | 39,858 | ₹535 to ₹1,499 | ₹238 | **27.5%** |\n\nThe top quintile clears nine percentage points more margin than the bottom and earns nearly 7x the absolute CM per booking, on a comparable partner time slot [rev-opt:Q4].\n\n## Contribution margin by service category\n\nThe category view names the culprits [rev-opt:Q2][rev-opt:Q3]:\n\n| Service category | Bookings | Avg ticket | CM / booking | Margin % |\n| --- | ---: | ---: | ---: | ---: |\n| Dusting | 12,439 | ₹181 | **₹33** | 18.3% |\n| Folding & Organizing | 12,296 | ₹199 | ₹37 | 18.7% |\n| Dishes & Utensils | 12,608 | ₹199 | ₹38 | 18.8% |\n| Ironing | 12,592 | ₹219 | ₹42 | 19.3% |\n| Sweeping & Mopping | 13,165 | ₹351 | ₹81 | 23.1% |\n| Full House Cleaning | 10,090 | ₹549 | ₹138 | 25.2% |\n| Deep Cleaning | 7,485 | ₹998 | ₹279 | 28.0% |\n| Move-in/Move-out Cleaning | 7,475 | ₹1,100 | **₹309** | 28.1% |\n\nA ₹181 dusting job clears ₹33; a ₹1,100 move-in clean clears ₹309, roughly 9x more [rev-opt:Q2][rev-opt:Q3]. The four worst categories by margin percentage are all the sub-₹250 chores [rev-opt:Q5].\n\n## Low-ticket vs standard-and-up: the cost structure\n\nGroup every booking by ticket size and the cost structure tells the story [data-quality:Q1]:\n\n| Cohort | Bookings | Partner payout % | Support cost % | Margin % | Total CM |\n| --- | ---: | ---: | ---: | ---: | ---: |\n| Low-ticket chores (under ₹250) | 46,906 | 74.0% | **4.0%** | 18.7% | ₹1.72M |\n| Standard+ jobs (₹250 and up) | 152,387 | 70.7% | 1.5% | 25.3% | ₹19.88M |\n\nBreaking the cost stack down further, the gap is not commission (the platform's commission rate is actually slightly higher on chores at 26.0% of ticket versus 29.3% on big jobs, because payout takes a bigger bite of the small ticket) [data-quality:Q3]. The real drag is that a fixed-ish support cost lands on a tiny ticket: chores carry **23.5% of all bookings and 23.5% of all support spend** (₹371K of ₹1.58M), but because each chore ticket is so small, that same support load reads as 4.0% of GMV instead of 1.5% [data-quality:Q4].\n\n## Segment breakdown: do chore buyers ever grow up?\n\nThe strongest argument for de-emphasizing chores is that the people who mostly buy them do not convert into valuable customers [cohort-retention:Q1]:\n\n| Customer segment | Customers | Avg lifetime bookings | Avg lifetime CM |\n| --- | ---: | ---: | ---: |\n| Mostly big jobs (under 25% chores) | 8,427 | 14.3 | **₹1,627** |\n| Mixed (25% to 75% chores) | 5,656 | 13.7 | ₹1,388 |\n| Mostly chores (75%+ sub-₹250) | 771 | **1.6** | **₹48** |\n\nThe 'mostly chores' customers book only 1.6 times in their life and are worth ₹48 in lifetime contribution margin, roughly 34x less than a big-job customer [cohort-retention:Q1]. They are not a feeder pool for the valuable cohort; they are a thin, one-and-done segment.\n\n## Risks and caveats\n\n- **Chores may be a hook, not a profit center.** A small share of first-ever bookings are chores, and removing them entirely could cost some top-of-funnel demand. The recommendation is to re-price and bundle them, not delete them.\n- **Support-cost allocation is a model, not a meter.** The 4.0% vs 1.5% gap depends on how support cost is spread across bookings; if allocation is roughly per-booking, the directional finding holds, but the exact rupee figure is an estimate [data-quality:Q3][data-quality:Q4].\n- **Margin is stable, so there is no fire.** Because blended margin has not moved in a year [daily-metrics:Q1], this is an optimization, not a crisis. Treat it as a planned merchandising change.\n\n## Key findings\n\n- **Low-ticket chores are 23.5% of all bookings but only 8.0% of total contribution margin** (₹1.72M of ₹21.6M) [data-quality:Q1][data-quality:Q2]. They consume operational attention out of all proportion to what they earn.\n- The margin gap is driven by ticket size, not geography: partner payout eats **74.0%** of a small ticket versus 70.7% on larger jobs, and allocated **support cost is 4.0%** of GMV on chores versus 1.5% elsewhere [data-quality:Q1], while margin is flat 24.6% to 24.8% across all city tiers [geographic:Q1].\n- A move-in/move-out clean earns **₹309 per booking, roughly 9x** what a dusting job earns [rev-opt:Q2][rev-opt:Q3], and the top ticket quintile clears 27.5% margin versus 18.5% at the bottom [rev-opt:Q4].\n- **Chore-heavy customers do not grow into valuable ones**: they book 1.6 times and are worth ₹48 in lifetime CM, versus 14.3 bookings and ₹1,627 for big-job customers [cohort-retention:Q1].\n\n## Recommended actions\n\n1. **Set a floor price or bundle minimum** so sub-₹250 chores are sold only as add-ons to a larger job, not as standalone visits. This lifts the blended ticket without losing the demand, and the quintile data shows even a small ticket lift moves margin materially [rev-opt:Q4].\n2. **Re-rate partner payout on micro-jobs** so payout scales with effort, not just as a flat percentage. Recovering even 3 points of payout on the chore cohort adds roughly ₹0.3M of margin [data-quality:Q1].\n3. **Route chore-only customers into a subscription bundle** (weekly sweep plus monthly deep clean) to convert thin one-off margin into predictable recurring margin, and to pull the 1.6-booking chore segment toward the 14-booking big-job cadence [cohort-retention:Q1].\n4. **Re-allocate support spend toward big-job categories**, where each support rupee defends a ₹309 contribution rather than a ₹33 one [data-quality:Q4].\n\n```sql\nSELECT\n  CASE WHEN booking_value < 250\n       THEN 'Low-ticket chores (<250)'\n       ELSE 'Standard+ jobs (>=250)' END                      AS cohort,\n  COUNT(*)                                                     AS bookings,\n  ROUND(100.0 * SUM(partner_payout)          / SUM(booking_value), 1) AS payout_pct,\n  ROUND(100.0 * SUM(support_cost_allocated)  / SUM(booking_value), 1) AS support_pct,\n  ROUND(100.0 * SUM(contribution_margin)     / SUM(booking_value), 1) AS margin_pct,\n  ROUND(SUM(contribution_margin) / 1e6, 2)                     AS total_cm_millions\nFROM bookings_economics\nWHERE payment_status = 'success'\nGROUP BY cohort\nORDER BY margin_pct DESC;\n```",
    followUps: [
      "What would a ₹250 booking minimum do to total GMV?",
      "Which chore customers also book high-margin jobs?",
      "How much margin would a subscription bundle recover?",
    ],
    work: {
      "rev-opt": {
        summary:
          "Established the blended contribution margin baseline, sliced margin into equal-size ticket quintiles, and ranked every service category by margin to expose the ticket-size gradient.",
        queries: [
          {
            sql: "SELECT ROUND(SUM(contribution_margin) / 1e6, 2) AS cm_millions, ROUND(SUM(booking_value) / 1e6, 2) AS gmv_millions, ROUND(100.0 * SUM(contribution_margin) / SUM(booking_value), 1) AS margin_pct, ROUND(AVG(contribution_margin), 0) AS cm_per_booking FROM bookings_economics WHERE payment_status = 'success';",
            description: "Blended contribution margin, GMV and CM per booking",
            rowCount: 1,
            executionTimeMs: 356,
            columns: ["cm_millions", "gmv_millions", "margin_pct", "cm_per_booking"],
            data: [{ cm_millions: 21.6, gmv_millions: 87.7, margin_pct: 24.6, cm_per_booking: 108 }],
          },
          {
            sql: "SELECT service_type, COUNT(*) AS bookings, ROUND(AVG(booking_value), 0) AS avg_ticket, ROUND(AVG(contribution_margin), 0) AS cm_per_booking, ROUND(100.0 * SUM(contribution_margin) / SUM(booking_value), 1) AS margin_pct FROM bookings_economics WHERE payment_status = 'success' GROUP BY service_type ORDER BY cm_per_booking ASC LIMIT 8;",
            description: "Lowest-margin service categories by CM per booking",
            rowCount: 8,
            executionTimeMs: 731,
            columns: ["service_type", "bookings", "avg_ticket", "cm_per_booking", "margin_pct"],
            data: [
              { service_type: "Dusting", bookings: 12439, avg_ticket: 181, cm_per_booking: 33, margin_pct: 18.3 },
              { service_type: "Folding & Organizing", bookings: 12296, avg_ticket: 199, cm_per_booking: 37, margin_pct: 18.7 },
              { service_type: "Dishes & Utensils", bookings: 12608, avg_ticket: 199, cm_per_booking: 38, margin_pct: 18.8 },
              { service_type: "Ironing", bookings: 12592, avg_ticket: 219, cm_per_booking: 42, margin_pct: 19.3 },
              { service_type: "Sweeping & Mopping", bookings: 13165, avg_ticket: 351, cm_per_booking: 81, margin_pct: 23.1 },
            ],
          },
          {
            sql: "SELECT service_type, COUNT(*) AS bookings, ROUND(AVG(booking_value), 0) AS avg_ticket, ROUND(AVG(contribution_margin), 0) AS cm_per_booking, ROUND(100.0 * SUM(contribution_margin) / SUM(booking_value), 1) AS margin_pct FROM bookings_economics WHERE payment_status = 'success' AND service_type IN ('Full House Cleaning', 'Deep Cleaning', 'Move-in/Move-out Cleaning') GROUP BY service_type ORDER BY cm_per_booking ASC;",
            description: "High-ticket service categories by CM per booking (margin ceiling)",
            rowCount: 3,
            executionTimeMs: 467,
            columns: ["service_type", "bookings", "avg_ticket", "cm_per_booking", "margin_pct"],
            data: [
              { service_type: "Full House Cleaning", bookings: 10090, avg_ticket: 549, cm_per_booking: 138, margin_pct: 25.2 },
              { service_type: "Deep Cleaning", bookings: 7485, avg_ticket: 998, cm_per_booking: 279, margin_pct: 28.0 },
              { service_type: "Move-in/Move-out Cleaning", bookings: 7475, avg_ticket: 1100, cm_per_booking: 309, margin_pct: 28.1 },
            ],
          },
          {
            sql: "WITH d AS (SELECT booking_value, contribution_margin, NTILE(5) OVER (ORDER BY booking_value) AS quintile FROM bookings_economics WHERE payment_status = 'success') SELECT quintile, COUNT(*) AS bookings, MIN(booking_value) AS min_ticket, MAX(booking_value) AS max_ticket, ROUND(AVG(contribution_margin), 0) AS avg_cm, ROUND(100.0 * SUM(contribution_margin) / SUM(booking_value), 1) AS margin_pct FROM d GROUP BY quintile ORDER BY quintile;",
            description: "Contribution margin by equal-size ticket-value quintile",
            rowCount: 5,
            executionTimeMs: 1144,
            columns: ["quintile", "bookings", "min_ticket", "max_ticket", "avg_cm", "margin_pct"],
            data: [
              { quintile: 1, bookings: 39859, min_ticket: 149, max_ticket: 226, avg_cm: 35, margin_pct: 18.5 },
              { quintile: 2, bookings: 39859, min_ticket: 226, max_ticket: 351, avg_cm: 68, margin_pct: 22.1 },
              { quintile: 3, bookings: 39859, min_ticket: 351, max_ticket: 409, avg_cm: 89, margin_pct: 23.4 },
              { quintile: 4, bookings: 39858, min_ticket: 409, max_ticket: 535, avg_cm: 113, margin_pct: 24.5 },
              { quintile: 5, bookings: 39858, min_ticket: 535, max_ticket: 1499, avg_cm: 238, margin_pct: 27.5 },
            ],
          },
          {
            sql: "SELECT service_type, COUNT(*) AS bookings, ROUND(AVG(booking_value), 0) AS avg_ticket, ROUND(100.0 * SUM(contribution_margin) / SUM(booking_value), 1) AS margin_pct, RANK() OVER (ORDER BY 100.0 * SUM(contribution_margin) / SUM(booking_value)) AS margin_rank FROM bookings_economics WHERE payment_status = 'success' GROUP BY service_type ORDER BY margin_pct ASC LIMIT 6;",
            description: "Service categories ranked by margin percent (window RANK)",
            rowCount: 6,
            executionTimeMs: 818,
            columns: ["service_type", "bookings", "avg_ticket", "margin_pct", "margin_rank"],
            data: [
              { service_type: "Dusting", bookings: 12439, avg_ticket: 181, margin_pct: 18.3, margin_rank: 1 },
              { service_type: "Folding & Organizing", bookings: 12296, avg_ticket: 199, margin_pct: 18.7, margin_rank: 2 },
              { service_type: "Dishes & Utensils", bookings: 12608, avg_ticket: 199, margin_pct: 18.8, margin_rank: 3 },
              { service_type: "Ironing", bookings: 12592, avg_ticket: 219, margin_pct: 19.3, margin_rank: 4 },
              { service_type: "Chopping & Kitchen Prep", bookings: 13311, avg_ticket: 350, margin_pct: 23.0, margin_rank: 5 },
              { service_type: "Sweeping & Mopping", bookings: 13165, avg_ticket: 351, margin_pct: 23.1, margin_rank: 6 },
            ],
          },
        ],
      },
      "data-quality": {
        summary:
          "Split the book into sub-₹250 chores vs standard-and-up jobs to quantify the cost structure gap, decomposed the cost stack, and confirmed how little margin (and how much support spend) the chore bucket carries.",
        queries: [
          {
            sql: "SELECT CASE WHEN booking_value < 250 THEN 'Low-ticket chores (<250)' ELSE 'Standard+ jobs (>=250)' END AS cohort, COUNT(*) AS bookings, ROUND(100.0 * SUM(partner_payout) / SUM(booking_value), 1) AS payout_pct, ROUND(100.0 * SUM(support_cost_allocated) / SUM(booking_value), 1) AS support_pct, ROUND(100.0 * SUM(contribution_margin) / SUM(booking_value), 1) AS margin_pct, ROUND(SUM(contribution_margin) / 1e6, 2) AS total_cm_millions FROM bookings_economics WHERE payment_status = 'success' GROUP BY cohort ORDER BY margin_pct DESC;",
            description: "Cost structure: low-ticket chores vs standard-and-up jobs",
            rowCount: 2,
            executionTimeMs: 528,
            columns: ["cohort", "bookings", "payout_pct", "support_pct", "margin_pct", "total_cm_millions"],
            data: [
              { cohort: "Standard+ jobs (>=250)", bookings: 152387, payout_pct: 70.7, support_pct: 1.5, margin_pct: 25.3, total_cm_millions: 19.88 },
              { cohort: "Low-ticket chores (<250)", bookings: 46906, payout_pct: 74.0, support_pct: 4.0, margin_pct: 18.7, total_cm_millions: 1.72 },
            ],
          },
          {
            sql: "SELECT ROUND(100.0 * SUM(CASE WHEN booking_value < 250 THEN 1 ELSE 0 END) / COUNT(*), 1) AS low_booking_share, ROUND(100.0 * SUM(CASE WHEN booking_value < 250 THEN contribution_margin ELSE 0 END) / SUM(contribution_margin), 1) AS low_cm_share FROM bookings_economics WHERE payment_status = 'success';",
            description: "Chore share of bookings vs share of total contribution margin",
            rowCount: 1,
            executionTimeMs: 312,
            columns: ["low_booking_share", "low_cm_share"],
            data: [{ low_booking_share: 23.5, low_cm_share: 8.0 }],
          },
          {
            sql: "SELECT CASE WHEN booking_value < 250 THEN 'Low-ticket chores (<250)' ELSE 'Standard+ jobs (>=250)' END AS cohort, COUNT(*) AS bookings, ROUND(100.0 * SUM(partner_payout) / SUM(booking_value), 1) AS payout_pct, ROUND(100.0 * SUM(commission_earned) / SUM(booking_value), 1) AS commission_pct, ROUND(100.0 * SUM(payment_processing_fee) / SUM(booking_value), 1) AS pay_fee_pct, ROUND(100.0 * SUM(support_cost_allocated) / SUM(booking_value), 1) AS support_pct FROM bookings_economics WHERE payment_status = 'success' GROUP BY cohort ORDER BY cohort;",
            description: "Full cost-stack decomposition by ticket cohort",
            rowCount: 2,
            executionTimeMs: 641,
            columns: ["cohort", "bookings", "payout_pct", "commission_pct", "pay_fee_pct", "support_pct"],
            data: [
              { cohort: "Low-ticket chores (<250)", bookings: 46906, payout_pct: 74.0, commission_pct: 26.0, pay_fee_pct: 1.0, support_pct: 4.0 },
              { cohort: "Standard+ jobs (>=250)", bookings: 152387, payout_pct: 70.7, commission_pct: 29.3, pay_fee_pct: 0.8, support_pct: 1.5 },
            ],
          },
          {
            sql: "SELECT ROUND(SUM(support_cost_allocated) / 1e3, 0) AS total_support_k, ROUND(SUM(support_cost_allocated) FILTER (WHERE booking_value < 250) / 1e3, 0) AS chore_support_k, ROUND(100.0 * SUM(support_cost_allocated) FILTER (WHERE booking_value < 250) / SUM(support_cost_allocated), 1) AS chore_support_share FROM bookings_economics WHERE payment_status = 'success';",
            description: "Support spend concentration: chores vs total (FILTER)",
            rowCount: 1,
            executionTimeMs: 374,
            columns: ["total_support_k", "chore_support_k", "chore_support_share"],
            data: [{ total_support_k: 1581, chore_support_k: 371, chore_support_share: 23.5 }],
          },
        ],
      },
      "geographic": {
        summary:
          "Confirmed the margin leak is not geographic: contribution margin is essentially flat (24.6% to 24.8%) across all three city tiers, so the fix lives in service mix, not market.",
        queries: [
          {
            sql: "SELECT city, COUNT(*) AS bookings, ROUND(AVG(booking_value), 0) AS avg_ticket, ROUND(AVG(contribution_margin), 0) AS cm_per_booking, ROUND(100.0 * SUM(contribution_margin) / SUM(booking_value), 1) AS margin_pct FROM bookings_economics WHERE payment_status = 'success' GROUP BY city ORDER BY margin_pct DESC;",
            description: "Contribution margin by city tier",
            rowCount: 3,
            executionTimeMs: 596,
            columns: ["city", "bookings", "avg_ticket", "cm_per_booking", "margin_pct"],
            data: [
              { city: "Semi-Urban", bookings: 19894, avg_ticket: 441, cm_per_booking: 109, margin_pct: 24.8 },
              { city: "Urban", bookings: 30068, avg_ticket: 441, cm_per_booking: 109, margin_pct: 24.7 },
              { city: "Metropolitian", bookings: 149331, avg_ticket: 440, cm_per_booking: 108, margin_pct: 24.6 },
            ],
          },
        ],
      },
      "cohort-retention": {
        summary:
          "Bucketed every customer by their share of sub-₹250 chore bookings and found the chore-heavy segment books only 1.6 times and is worth ₹48 in lifetime CM, so chores are not a feeder pool for valuable customers.",
        queries: [
          {
            sql: "WITH cust AS (SELECT customer_id, ROUND(100.0 * COUNT(*) FILTER (WHERE booking_value < 250) / COUNT(*), 0) AS chore_share, COUNT(*) AS n, SUM(contribution_margin) AS cm FROM bookings_economics WHERE payment_status = 'success' GROUP BY customer_id) SELECT CASE WHEN chore_share >= 75 THEN 'Mostly chores (>=75% sub-250)' WHEN chore_share >= 25 THEN 'Mixed (25-75%)' ELSE 'Mostly big jobs (<25%)' END AS segment, COUNT(*) AS customers, ROUND(AVG(n), 1) AS avg_bookings, ROUND(AVG(cm), 0) AS avg_lifetime_cm FROM cust GROUP BY 1 ORDER BY avg_lifetime_cm DESC;",
            description: "Lifetime value by chore-intensity segment",
            rowCount: 3,
            executionTimeMs: 1387,
            columns: ["segment", "customers", "avg_bookings", "avg_lifetime_cm"],
            data: [
              { segment: "Mostly big jobs (<25%)", customers: 8427, avg_bookings: 14.3, avg_lifetime_cm: 1627 },
              { segment: "Mixed (25-75%)", customers: 5656, avg_bookings: 13.7, avg_lifetime_cm: 1388 },
              { segment: "Mostly chores (>=75% sub-250)", customers: 771, avg_bookings: 1.6, avg_lifetime_cm: 48 },
            ],
          },
        ],
      },
      "daily-metrics": {
        summary:
          "Tracked blended contribution margin month over month and confirmed it has held in a tight 23.3% to 26.0% band for a year, so this is a structural optimization rather than a recent decline.",
        queries: [
          {
            sql: "WITH m AS (SELECT DATE_TRUNC('month', booking_date) AS mo, SUM(contribution_margin) AS cm, SUM(booking_value) AS gmv FROM bookings_economics WHERE payment_status = 'success' GROUP BY 1) SELECT STRFTIME(mo, '%Y-%m') AS month, ROUND(cm / 1e6, 2) AS cm_millions, ROUND(100.0 * cm / gmv, 1) AS margin_pct, ROUND(100.0 * cm / gmv - LAG(100.0 * cm / gmv) OVER (ORDER BY mo), 1) AS margin_pp_change FROM m ORDER BY mo;",
            description: "Monthly contribution-margin trend with MoM change (LAG)",
            rowCount: 13,
            executionTimeMs: 733,
            columns: ["month", "cm_millions", "margin_pct", "margin_pp_change"],
            data: [
              { month: "2025-02", cm_millions: 0.71, margin_pct: 23.6, margin_pp_change: null },
              { month: "2025-06", cm_millions: 1.47, margin_pct: 23.5, margin_pp_change: -1.5 },
              { month: "2025-09", cm_millions: 1.66, margin_pct: 25.3, margin_pp_change: 0.2 },
              { month: "2025-11", cm_millions: 2.27, margin_pct: 23.9, margin_pp_change: -0.5 },
              { month: "2026-01", cm_millions: 1.92, margin_pct: 25.0, margin_pp_change: 0.3 },
              { month: "2026-02", cm_millions: 1.93, margin_pct: 26.0, margin_pp_change: 1.0 },
            ],
          },
        ],
      },
    },
  }),
  deepResearchThread({
    slug: "who-drives-revenue-whales",
    title: "Who actually drives our revenue?",
    question:
      "Which customers actually drive our revenue, and how concentrated is it in our best repeat customers?",
    report:
      "## Executive summary\n\nThis is a retention business dressed up as an acquisition business. **Whale customers are 26.7% of the base but generate 78.1% of completed GMV** [user-segmentation:Q2], and the concentration is even sharper at the very top: the single richest decile of customers (1,486 people) carries **57.3% of all GMV**, and the top three deciles together carry 80.7% [user-segmentation:Q3]. A whale is worth ₹17,291 in lifetime GMV, roughly 53x a low-value customer [user-segmentation:Q1].\n\nWhat separates a whale from everyone else is not what they buy or where they live, it is how often they come back. Whales re-book every 8.2 days, a near-subscription rhythm, against 42.7 days for low-value customers [cohort-retention:Q1]. Their service mix and city distribution are almost identical to non-whales [rev-opt:Q1][geographic:Q1], so frequency is the whole story. That makes two moves obvious: defend the whales you have (a quarter of them are already showing cooling signals) and build a ladder that compresses the medium tier's re-book gap.\n\n## Methodology and data note\n\nEvery customer is rolled up to a single lifetime row from `bookings` (completed only, `payment_status = 'success'`), keyed on `customer_id`. The LTV tier is the customer's `ltv_bucket`. Re-book cadence is the average and median gap between consecutive bookings per customer, computed with a `LAG` window partitioned by customer and ordered by date. The GMV-decile view uses `NTILE(10)` over lifetime GMV (descending) so each decile holds ~1,486 customers, and staleness is measured as days from a customer's last booking to the latest booking date in the dataset.\n\n## Lifetime value by customer segment\n\n| LTV segment | Customers | Avg lifetime bookings | Avg LTV | Total GMV | Re-book cadence |\n| --- | ---: | ---: | ---: | ---: | ---: |\n| Whale | 3,960 | **39.0** | ₹17,291 | **₹68.47M** | every 8.2 days |\n| High | 4,111 | 7.1 | ₹3,148 | ₹12.94M | every 29.6 days |\n| Medium | 4,965 | 2.8 | ₹1,148 | ₹5.70M | every 38.3 days |\n| Low | 1,818 | 1.1 | ₹326 | ₹0.59M | every 42.7 days |\n\nThe segment sizes and lifetime value come from rolling every customer up to a single row [user-segmentation:Q1]; the cadence column is the average gap between consecutive bookings within each tier [cohort-retention:Q1].\n\n## Just how concentrated is it\n\nThe decile view makes the Pareto curve concrete [user-segmentation:Q3]:\n\n| GMV decile | Customers | GMV | Share of GMV | Cumulative |\n| --- | ---: | ---: | ---: | ---: |\n| 1 (richest) | 1,486 | ₹50.24M | **57.3%** | 57.3% |\n| 2 | 1,486 | ₹12.71M | 14.5% | 71.8% |\n| 3 | 1,486 | ₹7.83M | 8.9% | 80.7% |\n| 4 to 10 | 10,396 | ₹16.91M | 19.3% | 100.0% |\n\nThe bottom seven deciles (10,396 customers, more than two-thirds of the base) together carry under 20% of GMV [user-segmentation:Q3]. This is as concentrated as marketplaces get.\n\n## Frequency, not mix or geography, makes a whale\n\nIt is tempting to assume whales buy the expensive jobs. They do not. Whale and non-whale tier mix are nearly identical (standard ~40% for both, premium 15.4% vs 13.7%) [rev-opt:Q1]. Whale share is also flat across city tiers (26.3% to 27.7%) [geographic:Q1] and flat across acquisition sources (25.2% to 27.4%) [user-segmentation:Q4]. Nothing about a customer's first booking predicts whale status except how fast they come back for the second.\n\n## Cohort breakdown: which whales are slipping\n\nThe whales are not all healthy. Bucketing each whale by days since last booking against their 8.2-day norm [cohort-retention:Q2]:\n\n| Whale status | Whales | Share |\n| --- | ---: | ---: |\n| Active (last booking <=14d) | 2,429 | 61.3% |\n| Cooling (15 to 30d) | 903 | 22.8% |\n| At risk (31 to 60d) | 483 | 12.2% |\n| Likely lapsed (60d+) | 145 | 3.7% |\n\nNearly **39% of whales (1,531 customers) have gone quiet for longer than two weeks**, which for an 8.2-day-cadence customer is a meaningful stall [cohort-retention:Q2]. These are the highest-value churn-risk accounts in the business.\n\n## Risks and caveats\n\n- **The `ltv_bucket` label is partly mechanical.** Customers who joined early have had more calendar time to accumulate bookings, so some of the whale concentration reflects tenure, not just intensity. The cadence finding (8.2 vs 42.7 days) is tenure-independent and is the cleaner signal.\n- **Staleness is measured against a fixed dataset end date**, so a whale whose last booking was 20 days before the cutoff reads as 'cooling' even if they were simply between visits. Use the band as a prioritized call list, not a verdict.\n- **Decile concentration will look extreme in any marketplace** with a long tail; the actionable part is the 39% cooling-whale figure, not the headline 57.3%.\n\n## Key findings\n\n- **Whales are 26.7% of customers and 78.1% of GMV** [user-segmentation:Q2]; the top GMV decile alone is 57.3% [user-segmentation:Q3].\n- **Whales re-book every 8.2 days versus 42.7 for low-value customers** [cohort-retention:Q1]. Cadence is the single clearest signal of who is becoming a whale.\n- A whale is worth **₹17,291**, roughly **53x** a low-value customer's ₹326 [user-segmentation:Q1]. Moving a few hundred medium customers up one tier dwarfs net-new low-tier acquisition.\n- Whale status is **not predictable from service mix, city, or acquisition source** (all flat) [rev-opt:Q1][geographic:Q1][user-segmentation:Q4], so prediction must come from early-cadence behavior.\n- **39% of whales (1,531) are cooling or worse**, more than two weeks past their typical 8.2-day rhythm [cohort-retention:Q2].\n\n## Recommended actions\n\n1. **Protect whales first.** A churn-early-warning on whales whose re-book gap stretches past ~14 days is the highest-ROI retention alert in the business; the 'cooling' and 'at risk' bands (1,386 customers) are the immediate call list [cohort-retention:Q2].\n2. **Build a medium-to-high ladder.** Target the 2-to-3-booking medium segment with a cadence nudge (a standing weekly slot) to compress their 38.3-day gap toward the high-tier 29.6-day mark [cohort-retention:Q1].\n3. **Predict whales from second-booking speed, not channel.** Since source, city, and mix are all flat [user-segmentation:Q4][geographic:Q1][rev-opt:Q1], the cheapest leading indicator is how fast a new customer books their second job; instrument that as the core onboarding KPI.\n4. **Re-weight acquisition spend toward look-alikes of fast-rebooking customers**, not raw signup volume, since one retained whale outvalues dozens of one-off low-tier signups [user-segmentation:Q1].\n\n```sql\nWITH gaps AS (\n  SELECT\n    customer_id, ltv_bucket,\n    DATE_DIFF('day',\n      LAG(booking_date) OVER (PARTITION BY customer_id ORDER BY booking_date),\n      booking_date) AS gap_days\n  FROM bookings\n  WHERE payment_status = 'success'\n)\nSELECT\n  ltv_bucket,\n  ROUND(AVG(gap_days), 1) AS avg_rebook_gap_days,\n  ROUND(MEDIAN(gap_days), 1) AS median_rebook_gap_days\nFROM gaps\nWHERE gap_days IS NOT NULL\nGROUP BY ltv_bucket\nORDER BY avg_rebook_gap_days;\n```",
    followUps: [
      "Which medium customers are most likely to become whales?",
      "How many whales are showing early churn signals?",
      "Which services do whales book most?",
    ],
    work: {
      "user-segmentation": {
        summary:
          "Rolled each customer up to a lifetime row by LTV bucket, measured whale concentration, drew the full GMV-decile Pareto curve, and confirmed whale rate is flat across acquisition sources.",
        queries: [
          {
            sql: "WITH cv AS (SELECT customer_id, MAX(ltv_bucket) AS ltv_bucket, COUNT(*) AS lifetime_bookings, SUM(booking_value) AS lifetime_gmv FROM bookings WHERE payment_status = 'success' GROUP BY customer_id) SELECT ltv_bucket, COUNT(*) AS customers, ROUND(AVG(lifetime_bookings), 1) AS avg_bookings, ROUND(AVG(lifetime_gmv), 0) AS avg_ltv, ROUND(SUM(lifetime_gmv) / 1e6, 2) AS total_gmv_millions FROM cv GROUP BY ltv_bucket ORDER BY avg_ltv DESC;",
            description: "Customer segments by LTV bucket: count, avg bookings, avg LTV, total GMV",
            rowCount: 4,
            executionTimeMs: 902,
            columns: ["ltv_bucket", "customers", "avg_bookings", "avg_ltv", "total_gmv_millions"],
            data: [
              { ltv_bucket: "whale", customers: 3960, avg_bookings: 39.0, avg_ltv: 17291, total_gmv_millions: 68.47 },
              { ltv_bucket: "high", customers: 4111, avg_bookings: 7.1, avg_ltv: 3148, total_gmv_millions: 12.94 },
              { ltv_bucket: "medium", customers: 4965, avg_bookings: 2.8, avg_ltv: 1148, total_gmv_millions: 5.70 },
              { ltv_bucket: "low", customers: 1818, avg_bookings: 1.1, avg_ltv: 326, total_gmv_millions: 0.59 },
            ],
          },
          {
            sql: "WITH cv AS (SELECT customer_id, MAX(ltv_bucket) AS b, SUM(booking_value) AS gmv FROM bookings WHERE payment_status = 'success' GROUP BY customer_id) SELECT ROUND(100.0 * SUM(CASE WHEN b = 'whale' THEN 1 ELSE 0 END) / COUNT(*), 1) AS whale_customer_share, ROUND(100.0 * SUM(CASE WHEN b = 'whale' THEN gmv ELSE 0 END) / SUM(gmv), 1) AS whale_gmv_share FROM cv;",
            description: "Whale share of customers vs share of total GMV (concentration)",
            rowCount: 1,
            executionTimeMs: 588,
            columns: ["whale_customer_share", "whale_gmv_share"],
            data: [{ whale_customer_share: 26.7, whale_gmv_share: 78.1 }],
          },
          {
            sql: "WITH cv AS (SELECT customer_id, SUM(booking_value) AS gmv FROM bookings WHERE payment_status = 'success' GROUP BY customer_id), d AS (SELECT customer_id, gmv, NTILE(10) OVER (ORDER BY gmv DESC) AS decile FROM cv) SELECT decile, COUNT(*) AS customers, ROUND(SUM(gmv) / 1e6, 2) AS gmv_millions, ROUND(100.0 * SUM(gmv) / SUM(SUM(gmv)) OVER (), 1) AS pct_of_gmv, ROUND(100.0 * SUM(SUM(gmv)) OVER (ORDER BY decile) / SUM(SUM(gmv)) OVER (), 1) AS cum_pct FROM d GROUP BY decile ORDER BY decile;",
            description: "GMV concentration by customer decile (Pareto curve)",
            rowCount: 10,
            executionTimeMs: 1216,
            columns: ["decile", "customers", "gmv_millions", "pct_of_gmv", "cum_pct"],
            data: [
              { decile: 1, customers: 1486, gmv_millions: 50.24, pct_of_gmv: 57.3, cum_pct: 57.3 },
              { decile: 2, customers: 1486, gmv_millions: 12.71, pct_of_gmv: 14.5, cum_pct: 71.8 },
              { decile: 3, customers: 1486, gmv_millions: 7.83, pct_of_gmv: 8.9, cum_pct: 80.7 },
              { decile: 4, customers: 1486, gmv_millions: 5.44, pct_of_gmv: 6.2, cum_pct: 86.9 },
              { decile: 5, customers: 1485, gmv_millions: 3.89, pct_of_gmv: 4.4, cum_pct: 91.3 },
              { decile: 6, customers: 1485, gmv_millions: 2.84, pct_of_gmv: 3.2, cum_pct: 94.6 },
              { decile: 10, customers: 1485, gmv_millions: 0.43, pct_of_gmv: 0.5, cum_pct: 100.0 },
            ],
          },
          {
            sql: "WITH cv AS (SELECT customer_id, MAX(ltv_bucket) AS b, ANY_VALUE(acquisition_source) AS src FROM bookings WHERE payment_status = 'success' GROUP BY customer_id) SELECT src AS acquisition_source, COUNT(*) AS customers, ROUND(100.0 * COUNT(*) FILTER (WHERE b = 'whale') / COUNT(*), 1) AS whale_rate_pct FROM cv GROUP BY src ORDER BY whale_rate_pct DESC;",
            description: "Whale conversion rate by acquisition source",
            rowCount: 5,
            executionTimeMs: 794,
            columns: ["acquisition_source", "customers", "whale_rate_pct"],
            data: [
              { acquisition_source: "google", customers: 3715, whale_rate_pct: 27.4 },
              { acquisition_source: "referral", customers: 2189, whale_rate_pct: 26.9 },
              { acquisition_source: "organic", customers: 5206, whale_rate_pct: 26.5 },
              { acquisition_source: "meta", customers: 3017, whale_rate_pct: 26.3 },
              { acquisition_source: "whatsapp", customers: 727, whale_rate_pct: 25.2 },
            ],
          },
        ],
      },
      "cohort-retention": {
        summary:
          "Computed the re-book cadence ladder from whales to low-value customers, then bucketed whales by days since last booking to surface the cooling and at-risk accounts.",
        queries: [
          {
            sql: "WITH gaps AS (SELECT customer_id, ltv_bucket, DATE_DIFF('day', LAG(booking_date) OVER (PARTITION BY customer_id ORDER BY booking_date), booking_date) AS gap_days FROM bookings WHERE payment_status = 'success') SELECT ltv_bucket, ROUND(AVG(gap_days), 1) AS avg_rebook_gap_days, ROUND(MEDIAN(gap_days), 1) AS median_rebook_gap_days FROM gaps WHERE gap_days IS NOT NULL GROUP BY ltv_bucket ORDER BY avg_rebook_gap_days;",
            description: "Re-book cadence (avg/median gap days) by LTV tier",
            rowCount: 4,
            executionTimeMs: 1043,
            columns: ["ltv_bucket", "avg_rebook_gap_days", "median_rebook_gap_days"],
            data: [
              { ltv_bucket: "whale", avg_rebook_gap_days: 8.2, median_rebook_gap_days: 3.0 },
              { ltv_bucket: "high", avg_rebook_gap_days: 29.6, median_rebook_gap_days: 22.0 },
              { ltv_bucket: "medium", avg_rebook_gap_days: 38.3, median_rebook_gap_days: 29.5 },
              { ltv_bucket: "low", avg_rebook_gap_days: 42.7, median_rebook_gap_days: 31.0 },
            ],
          },
          {
            sql: "WITH lastb AS (SELECT customer_id, MAX(booking_date) AS last_date, MAX(ltv_bucket) AS b FROM bookings WHERE payment_status = 'success' GROUP BY customer_id), maxd AS (SELECT MAX(booking_date) AS m FROM bookings WHERE payment_status = 'success') SELECT CASE WHEN DATE_DIFF('day', last_date, (SELECT m FROM maxd)) <= 14 THEN 'Active (<=14d)' WHEN DATE_DIFF('day', last_date, (SELECT m FROM maxd)) <= 30 THEN 'Cooling (15-30d)' WHEN DATE_DIFF('day', last_date, (SELECT m FROM maxd)) <= 60 THEN 'At risk (31-60d)' ELSE 'Likely lapsed (60d+)' END AS whale_status, COUNT(*) AS whales, ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct FROM lastb WHERE b = 'whale' GROUP BY 1 ORDER BY MIN(DATE_DIFF('day', last_date, (SELECT m FROM maxd)));",
            description: "Whale churn-risk bands by days since last booking",
            rowCount: 4,
            executionTimeMs: 968,
            columns: ["whale_status", "whales", "pct"],
            data: [
              { whale_status: "Active (<=14d)", whales: 2429, pct: 61.3 },
              { whale_status: "Cooling (15-30d)", whales: 903, pct: 22.8 },
              { whale_status: "At risk (31-60d)", whales: 483, pct: 12.2 },
              { whale_status: "Likely lapsed (60d+)", whales: 145, pct: 3.7 },
            ],
          },
        ],
      },
      "rev-opt": {
        summary:
          "Compared the service-tier mix of whale bookings against non-whale bookings and found them nearly identical, so whales are not whales because of what they buy.",
        queries: [
          {
            sql: "SELECT service_tier, ROUND(100.0 * COUNT(*) FILTER (WHERE ltv_bucket = 'whale') / SUM(COUNT(*) FILTER (WHERE ltv_bucket = 'whale')) OVER (), 1) AS whale_mix_pct, ROUND(100.0 * COUNT(*) FILTER (WHERE ltv_bucket <> 'whale') / SUM(COUNT(*) FILTER (WHERE ltv_bucket <> 'whale')) OVER (), 1) AS nonwhale_mix_pct FROM bookings WHERE payment_status = 'success' GROUP BY service_tier ORDER BY whale_mix_pct DESC;",
            description: "Service-tier mix: whale bookings vs non-whale bookings",
            rowCount: 4,
            executionTimeMs: 711,
            columns: ["service_tier", "whale_mix_pct", "nonwhale_mix_pct"],
            data: [
              { service_tier: "standard", whale_mix_pct: 39.8, nonwhale_mix_pct: 40.3 },
              { service_tier: "quick", whale_mix_pct: 24.7, nonwhale_mix_pct: 26.2 },
              { service_tier: "extended", whale_mix_pct: 20.1, nonwhale_mix_pct: 19.8 },
              { service_tier: "premium", whale_mix_pct: 15.4, nonwhale_mix_pct: 13.7 },
            ],
          },
        ],
      },
      "geographic": {
        summary:
          "Checked whale share by city tier and found it flat (26.3% to 27.7%), confirming geography does not explain who becomes a whale.",
        queries: [
          {
            sql: "WITH cv AS (SELECT customer_id, MAX(ltv_bucket) AS b, ANY_VALUE(city) AS city FROM bookings WHERE payment_status = 'success' GROUP BY customer_id) SELECT city, COUNT(*) AS customers, ROUND(100.0 * COUNT(*) FILTER (WHERE b = 'whale') / COUNT(*), 1) AS whale_share_pct FROM cv GROUP BY city ORDER BY whale_share_pct DESC;",
            description: "Whale share of customers by city tier",
            rowCount: 3,
            executionTimeMs: 657,
            columns: ["city", "customers", "whale_share_pct"],
            data: [
              { city: "Urban", customers: 2195, whale_share_pct: 27.7 },
              { city: "Semi-Urban", customers: 1472, whale_share_pct: 27.6 },
              { city: "Metropolitian", customers: 11187, whale_share_pct: 26.3 },
            ],
          },
        ],
      },
    },
  }),
  deepResearchThread({
    slug: "where-we-break-sla",
    title: "Where are we breaking SLA the most?",
    question:
      "Where are we breaking our on-time arrival SLA the most, and what's driving the misses?",
    report:
      "## Executive summary\n\nAgainst a roughly 10-minute arrival promise, the business is at SLA in the metro and effectively failing it everywhere else. The headline misses concentrate in two places that compound each other: one geography (the semi-urban Sarjapur hub, at a **3.0% on-time rate** [geographic:Q1][geographic:Q2]) and two environmental conditions (traffic jams and rain). When live traffic is 'Jam', on-time collapses to 17.9% while every other traffic level holds steady near 48.8% [daily-metrics:Q1]; rain and storms cut it to ~26% versus ~49% in clear weather [daily-metrics:Q2]. None of this is partner effort: reassignment runs a flat ~5.3% across all tiers [geographic:Q1] and on-time barely moves across the hours of the day [daily-metrics:Q3].\n\nThe customer cost is large and accumulating. **54% of customers have already been late-arrived three or more times** [cohort-retention:Q1], and 97.1% of all semi-urban GMV is on bookings that arrived late [rev-opt:Q1]. The fix is mostly about the promise (set realistic, condition-aware ETAs) plus a targeted operational push in the worst hub, not a blanket partner crackdown.\n\n## Methodology and data note\n\nAll figures are from `bookings` over Feb 2025 to Feb 2026, completed bookings only (`payment_status = 'success'`). On-time is the table's `on_time` boolean; arrival overage is `arrival_time_min - expected_arrival_min`. Hub-level cuts use a `HAVING COUNT(*) > 2000` floor so thin hubs do not produce noisy rates. Overage percentiles use `quantile_cont`. Note that each city tier maps to a single dominant hub in this dataset, so the city-tier and hub views are two lenses on the same underlying zones.\n\n## On-time arrival by city tier\n\n| City tier | Bookings | On-time % | Avg arrival (min) | Reassigned % |\n| --- | ---: | ---: | ---: | ---: |\n| Metropolitan | 149,331 | 52.2% | 10.5 | 5.3% |\n| Urban | 30,068 | 34.2% | 12.2 | 5.2% |\n| Semi-Urban | 19,894 | **3.0%** | **17.6** | 5.3% |\n\nThe semi-urban tier is the outlier: a 3.0% on-time rate against 52.2% in the metro [geographic:Q1]. The arrival-overage percentiles make the gap visceral: a semi-urban job arrives a **median 8 minutes past** the expected window (90th percentile 13 minutes over), while the metro median overage is 0 [geographic:Q3].\n\n## Worst hubs by on-time rate\n\n| Hub | Tier | Bookings | On-time % | Avg arrival (min) |\n| --- | ---: | ---: | ---: | ---: |\n| Sarjapur Hub | Semi-Urban | 19,894 | **3.0%** | 17.6 |\n| Yelahanka Hub | Urban | 30,068 | 34.2% | 12.2 |\n| BTM Layout Hub | Metropolitan | 39,960 | 44.4% | 11.2 |\n| Indiranagar Hub | Metropolitan | 49,744 | 55.1% | 10.2 |\n| Koramangala Hub | Metropolitan | 59,627 | 55.2% | 10.2 |\n\nSarjapur is in a class of its own, and the two best hubs still only clear 55% [geographic:Q2].\n\n## What actually drives the misses\n\nTraffic is the dominant lever [daily-metrics:Q1]:\n\n| Traffic density | Bookings | On-time % | Avg arrival (min) |\n| --- | ---: | ---: | ---: |\n| Jam | 27,182 | **17.9%** | 14.5 |\n| High | 60,720 | 48.8% | 11.0 |\n| Medium | 72,865 | 48.8% | 11.0 |\n| Low | 38,526 | 48.8% | 11.0 |\n\nWeather is the second lever [daily-metrics:Q2]:\n\n| Weather | Bookings | On-time % | Avg arrival (min) |\n| --- | ---: | ---: | ---: |\n| Rainy | 30,737 | 25.7% | 13.5 |\n| Stormy | 10,000 | 26.3% | 13.5 |\n| Sunny | 72,055 | 49.3% | 10.9 |\n| Cloudy | 46,430 | 49.5% | 11.0 |\n| Foggy | 18,993 | 49.7% | 10.9 |\n\nBoth levers are environmental and binary: a 'Jam' or a storm roughly halves on-time, and everything else sits flat. Time of day, by contrast, does almost nothing: on-time stays in a 43.9% to 44.7% band across the worst eight hours [daily-metrics:Q3], so there is no rush-hour to slot around.\n\n## Customer exposure: the accumulating cost\n\nThe miss is not spread thinly. **8,026 of 14,854 customers (54.0%) have been late-arrived three or more times** [cohort-retention:Q1], and the revenue exposed to a late arrival is heavily skewed to the weak zones [rev-opt:Q1]:\n\n| City tier | Late-arrival GMV | Share of tier GMV |\n| --- | ---: | ---: |\n| Semi-Urban | ₹8.51M | **97.1%** |\n| Urban | ₹8.72M | 65.8% |\n| Metropolitan | ₹31.33M | 47.7% |\n\nIn Sarjapur, late arrival is not an exception, it is the default experience attached to nearly all of the zone's revenue.\n\n## Risks and caveats\n\n- **The 10-minute promise may simply be wrong for some zones.** Much of the 'failure' is the gap between an aggressive uniform ETA and physical travel time; re-setting the displayed window is a labeling fix, not an operational one.\n- **Traffic and weather correlate with geography**, so the Sarjapur effect and the jam/rain effect are partly the same story. Treat the worst hub and the worst conditions as one combined problem, not two independent ones.\n- **`on_time` is a strict boolean.** A job 30 seconds late counts the same as one 10 minutes late, which is why the overage percentiles [geographic:Q3] are a better severity gauge than the on-time rate alone.\n\n## Key findings\n\n- **Sarjapur Hub is the red flag: a 3.0% on-time rate, a 17.6-minute average, and a median 8-minute overage** [geographic:Q1][geographic:Q2][geographic:Q3]. Every customer there is effectively a late arrival.\n- **Traffic jams collapse on-time to 17.9% and rain/storms to ~26%**, while every other condition holds near 48.8% [daily-metrics:Q1][daily-metrics:Q2]. Environment, not partner effort, is the dominant driver.\n- **There is no time-of-day effect** (43.9% to 44.7% across the worst hours) [daily-metrics:Q3] and reassignment is flat at ~5.3% [geographic:Q1], ruling out slotting and partner-swapping as causes.\n- **54% of customers have hit 3+ late arrivals** [cohort-retention:Q1] and 97.1% of semi-urban GMV rides on late jobs [rev-opt:Q1].\n\n## Recommended actions\n\n1. **Re-set the SLA shown to semi-urban customers.** A 15-minute window in Sarjapur would match the 17.6-minute reality and stop manufacturing disappointment on every arrival [geographic:Q1].\n2. **Add jam-aware and weather-aware buffers to the promised ETA.** When live traffic is 'Jam' or weather is rainy/stormy, widen the displayed window so the 17.9% and ~26% on-time rates stop reading as broken promises [daily-metrics:Q1][daily-metrics:Q2].\n3. **Stand up a churn-risk segment for the 8,026 repeatedly-late customers** [cohort-retention:Q1] for a proactive apology or credit before they lapse, prioritizing the semi-urban book where 97.1% of revenue is exposed [rev-opt:Q1].\n4. **Put a dedicated supply and routing push behind Sarjapur specifically**, since it is a single hub carrying the entire semi-urban miss [geographic:Q2].\n\n```sql\nSELECT\n  hub_name,\n  city                                                        AS city_tier,\n  COUNT(*)                                                    AS bookings,\n  ROUND(100.0 * AVG(CASE WHEN on_time THEN 1 ELSE 0 END), 1)  AS on_time_pct,\n  ROUND(AVG(arrival_time_min), 1)                             AS avg_arrival_min\nFROM bookings\nWHERE payment_status = 'success'\nGROUP BY hub_name, city\nHAVING COUNT(*) > 2000\nORDER BY on_time_pct ASC;\n```",
    followUps: [
      "What would a 15-minute semi-urban SLA do to on-time %?",
      "How many customers are exposed to repeated late arrivals?",
      "Which hours of day have the worst on-time rates?",
    ],
    work: {
      "geographic": {
        summary:
          "Broke on-time arrival down by city tier and by hub to localize the SLA misses, confirmed reassignment is flat across tiers, and quantified arrival overage percentiles to show how far past the window semi-urban jobs land.",
        queries: [
          {
            sql: "SELECT city, COUNT(*) AS bookings, ROUND(100.0 * AVG(CASE WHEN on_time THEN 1 ELSE 0 END), 1) AS on_time_pct, ROUND(AVG(arrival_time_min), 1) AS avg_arrival_min, ROUND(100.0 * AVG(CASE WHEN partner_reassigned THEN 1 ELSE 0 END), 1) AS reassigned_pct FROM bookings WHERE payment_status = 'success' GROUP BY city ORDER BY on_time_pct DESC;",
            description: "On-time %, avg arrival and reassignment rate by city tier",
            rowCount: 3,
            executionTimeMs: 743,
            columns: ["city", "bookings", "on_time_pct", "avg_arrival_min", "reassigned_pct"],
            data: [
              { city: "Metropolitian", bookings: 149331, on_time_pct: 52.2, avg_arrival_min: 10.5, reassigned_pct: 5.3 },
              { city: "Urban", bookings: 30068, on_time_pct: 34.2, avg_arrival_min: 12.2, reassigned_pct: 5.2 },
              { city: "Semi-Urban", bookings: 19894, on_time_pct: 3.0, avg_arrival_min: 17.6, reassigned_pct: 5.3 },
            ],
          },
          {
            sql: "SELECT hub_name, city, COUNT(*) AS bookings, ROUND(100.0 * AVG(CASE WHEN on_time THEN 1 ELSE 0 END), 1) AS on_time_pct, ROUND(AVG(arrival_time_min), 1) AS avg_arrival_min FROM bookings WHERE payment_status = 'success' GROUP BY hub_name, city HAVING COUNT(*) > 2000 ORDER BY on_time_pct ASC;",
            description: "Hubs ranked by on-time rate (min 2000 bookings)",
            rowCount: 5,
            executionTimeMs: 826,
            columns: ["hub_name", "city", "bookings", "on_time_pct", "avg_arrival_min"],
            data: [
              { hub_name: "Sarjapur Hub", city: "Semi-Urban", bookings: 19894, on_time_pct: 3.0, avg_arrival_min: 17.6 },
              { hub_name: "Yelahanka Hub", city: "Urban", bookings: 30068, on_time_pct: 34.2, avg_arrival_min: 12.2 },
              { hub_name: "BTM Layout Hub", city: "Metropolitian", bookings: 39960, on_time_pct: 44.4, avg_arrival_min: 11.2 },
              { hub_name: "Indiranagar Hub", city: "Metropolitian", bookings: 49744, on_time_pct: 55.1, avg_arrival_min: 10.2 },
              { hub_name: "Koramangala Hub", city: "Metropolitian", bookings: 59627, on_time_pct: 55.2, avg_arrival_min: 10.2 },
            ],
          },
          {
            sql: "SELECT city, ROUND(AVG(arrival_time_min - expected_arrival_min), 1) AS avg_overage_min, ROUND(quantile_cont(arrival_time_min - expected_arrival_min, 0.5), 1) AS median_overage, ROUND(quantile_cont(arrival_time_min - expected_arrival_min, 0.9), 1) AS p90_overage FROM bookings WHERE payment_status = 'success' GROUP BY city ORDER BY avg_overage_min DESC;",
            description: "Arrival overage vs expected window: avg, median, p90 by city",
            rowCount: 3,
            executionTimeMs: 884,
            columns: ["city", "avg_overage_min", "median_overage", "p90_overage"],
            data: [
              { city: "Semi-Urban", avg_overage_min: 7.7, median_overage: 8.0, p90_overage: 13.0 },
              { city: "Urban", avg_overage_min: 2.2, median_overage: 2.0, p90_overage: 7.0 },
              { city: "Metropolitian", avg_overage_min: 0.5, median_overage: 0.0, p90_overage: 5.0 },
            ],
          },
        ],
      },
      "daily-metrics": {
        summary:
          "Cut on-time arrival by traffic, weather, and hour of day. Only 'Jam' traffic and rain/storm move the needle; time of day is flat, so the drivers are environmental, not scheduling.",
        queries: [
          {
            sql: "SELECT traffic_density, COUNT(*) AS bookings, ROUND(100.0 * AVG(CASE WHEN on_time THEN 1 ELSE 0 END), 1) AS on_time_pct, ROUND(AVG(arrival_time_min), 1) AS avg_arrival_min FROM bookings WHERE payment_status = 'success' GROUP BY traffic_density ORDER BY on_time_pct ASC;",
            description: "On-time % and avg arrival by traffic density",
            rowCount: 4,
            executionTimeMs: 651,
            columns: ["traffic_density", "bookings", "on_time_pct", "avg_arrival_min"],
            data: [
              { traffic_density: "Jam", bookings: 27182, on_time_pct: 17.9, avg_arrival_min: 14.5 },
              { traffic_density: "Low", bookings: 38526, on_time_pct: 48.8, avg_arrival_min: 11.0 },
              { traffic_density: "Medium", bookings: 72865, on_time_pct: 48.8, avg_arrival_min: 11.0 },
              { traffic_density: "High", bookings: 60720, on_time_pct: 48.8, avg_arrival_min: 11.0 },
            ],
          },
          {
            sql: "SELECT weather, COUNT(*) AS bookings, ROUND(100.0 * AVG(CASE WHEN on_time THEN 1 ELSE 0 END), 1) AS on_time_pct, ROUND(AVG(arrival_time_min), 1) AS avg_arrival_min FROM bookings WHERE payment_status = 'success' GROUP BY weather ORDER BY on_time_pct ASC;",
            description: "On-time % and avg arrival by weather condition",
            rowCount: 6,
            executionTimeMs: 698,
            columns: ["weather", "bookings", "on_time_pct", "avg_arrival_min"],
            data: [
              { weather: "Rainy", bookings: 30737, on_time_pct: 25.7, avg_arrival_min: 13.5 },
              { weather: "Stormy", bookings: 10000, on_time_pct: 26.3, avg_arrival_min: 13.5 },
              { weather: "Sunny", bookings: 72055, on_time_pct: 49.3, avg_arrival_min: 10.9 },
              { weather: "Windy", bookings: 21078, on_time_pct: 49.4, avg_arrival_min: 11.0 },
              { weather: "Cloudy", bookings: 46430, on_time_pct: 49.5, avg_arrival_min: 11.0 },
              { weather: "Foggy", bookings: 18993, on_time_pct: 49.7, avg_arrival_min: 10.9 },
            ],
          },
          {
            sql: "SELECT EXTRACT(hour FROM booking_time) AS hour, COUNT(*) AS bookings, ROUND(100.0 * AVG(CASE WHEN on_time THEN 1 ELSE 0 END), 1) AS on_time_pct, ROUND(AVG(arrival_time_min), 1) AS avg_arrival_min FROM bookings WHERE payment_status = 'success' GROUP BY 1 ORDER BY on_time_pct ASC LIMIT 8;",
            description: "Worst 8 booking hours by on-time rate (rules out rush-hour)",
            rowCount: 8,
            executionTimeMs: 612,
            columns: ["hour", "bookings", "on_time_pct", "avg_arrival_min"],
            data: [
              { hour: 21, bookings: 14947, on_time_pct: 43.9, avg_arrival_min: 11.5 },
              { hour: 17, bookings: 14829, on_time_pct: 44.1, avg_arrival_min: 11.5 },
              { hour: 16, bookings: 14789, on_time_pct: 44.3, avg_arrival_min: 11.5 },
              { hour: 9, bookings: 18180, on_time_pct: 44.5, avg_arrival_min: 11.4 },
              { hour: 8, bookings: 18092, on_time_pct: 44.5, avg_arrival_min: 11.5 },
              { hour: 10, bookings: 18519, on_time_pct: 44.7, avg_arrival_min: 11.4 },
            ],
          },
        ],
      },
      "cohort-retention": {
        summary:
          "Counted how many customers have been late-arrived three or more times and found a majority of the base (54%) is already repeatedly exposed to SLA misses.",
        queries: [
          {
            sql: "WITH c AS (SELECT customer_id, COUNT(*) AS n, SUM(CASE WHEN NOT on_time THEN 1 ELSE 0 END) AS late_n FROM bookings WHERE payment_status = 'success' GROUP BY customer_id) SELECT COUNT(*) AS customers, SUM(CASE WHEN late_n >= 3 THEN 1 ELSE 0 END) AS exposed_3plus_late, ROUND(100.0 * SUM(CASE WHEN late_n >= 3 THEN 1 ELSE 0 END) / COUNT(*), 1) AS exposed_pct FROM c;",
            description: "Customers exposed to 3 or more late arrivals",
            rowCount: 1,
            executionTimeMs: 547,
            columns: ["customers", "exposed_3plus_late", "exposed_pct"],
            data: [{ customers: 14854, exposed_3plus_late: 8026, exposed_pct: 54.0 }],
          },
        ],
      },
      "rev-opt": {
        summary:
          "Quantified the revenue riding on late-arrival bookings by city tier and found 97.1% of semi-urban GMV is attached to jobs that arrived late.",
        queries: [
          {
            sql: "SELECT city, ROUND(SUM(booking_value) FILTER (WHERE NOT on_time) / 1e6, 2) AS late_gmv_millions, ROUND(100.0 * SUM(booking_value) FILTER (WHERE NOT on_time) / SUM(booking_value), 1) AS late_gmv_share FROM bookings WHERE payment_status = 'success' GROUP BY city ORDER BY late_gmv_share DESC;",
            description: "GMV attached to late-arrival bookings by city tier (FILTER)",
            rowCount: 3,
            executionTimeMs: 626,
            columns: ["city", "late_gmv_millions", "late_gmv_share"],
            data: [
              { city: "Semi-Urban", late_gmv_millions: 8.51, late_gmv_share: 97.1 },
              { city: "Urban", late_gmv_millions: 8.72, late_gmv_share: 65.8 },
              { city: "Metropolitian", late_gmv_millions: 31.33, late_gmv_share: 47.7 },
            ],
          },
        ],
      },
    },
  }),
  deepResearchThread({
    slug: "promo-efficiency",
    title: "Is our promo spend buying growth or just discounting demand?",
    question:
      "Is our promotional spend actually buying new customers, or just discounting demand we'd have won anyway?",
    report:
      "## Executive summary\n\nMost discount spend is subsidizing demand the business would have won anyway. The platform funded **₹1.16M in promo discounts and ₹326K in referral rewards** over the year, but only **7.5% of all campaign bookings were first-ever bookings** [data-quality:Q1]. The other 92.5% went to existing customers already in the funnel. And the relationship between discount depth and margin is brutally linear: a no-discount booking clears 25.9% margin, an 11% to 20% discount cuts it to 15.4%, and a 21%+ discount collapses it to **6.7%**, all while first-booking share stays flat near 7.4% to 8.1% [rev-opt:Q2]. In other words, going deeper on discount buys margin destruction, not new customers.\n\nThere is one genuine nuance worth holding: discounted first-bookers actually repeat at a slightly higher rate (90.6% vs 83.3%), though they book fewer times over their life (10.6 vs 13.9) [cohort-retention:Q1]. So the discount is not pure waste, it is just an inefficient way to reach new customers compared to the referral channel, which converts invites at ~91% for a ~₹350 reward [user-segmentation:Q2].\n\n## Methodology and data note\n\nAll figures are from `bookings_economics`, completed bookings only (`payment_status = 'success'`), over Feb 2025 to Feb 2026. 'Margin' is contribution margin as a percent of GMV. 'First-booking share' is the percent of a group's bookings flagged `is_first_booking`, used as the proxy for net-new acquisition. Promo funding is `promo_discount_funded` and referral cost is `referral_reward_cost`. Discount-depth bands bucket `discount_pct` with a `CASE` expression. The retention comparison joins each customer's first booking back to their lifetime booking count.\n\n## Margin by campaign type\n\n| Campaign type | Bookings | Avg discount | GMV | Margin % |\n| --- | ---: | ---: | ---: | ---: |\n| No campaign (baseline) | 119,664 | n/a | ₹52.68M | **25.9%** |\n| Promo | 50,042 | 18.0% | ₹22.00M | 24.2% |\n| Referral | 12,225 | n/a | ₹5.38M | 25.9% |\n| Seasonal | 6,981 | 13.2% | ₹3.07M | 18.1% |\n| Festival | 6,296 | 20.1% | ₹2.77M | **13.9%** |\n| Reactivation | 4,085 | 23.9% | ₹1.80M | **14.3%** |\n\nMargin tracks discount depth almost exactly: the no-campaign baseline holds 25.9%, while festival and reactivation, the two deepest-discount campaigns, nearly halve it [rev-opt:Q1].\n\n## The discount-depth gradient\n\nBucketing every booking by how deep the discount was makes the leak unmistakable [rev-opt:Q2]:\n\n| Discount band | Bookings | Avg ticket | First-booking share | Margin % |\n| --- | ---: | ---: | ---: | ---: |\n| 0 (no discount) | 174,832 | ₹440 | 7.4% | **25.9%** |\n| 1 to 10% | 6,038 | ₹441 | 7.8% | 20.0% |\n| 11 to 20% | 14,677 | ₹438 | 7.5% | 15.4% |\n| 21%+ | 3,746 | ₹443 | 8.1% | **6.7%** |\n\nThe ticket size is identical across bands (~₹440), so this is not a case of discounts unlocking bigger jobs. Margin falls by roughly 19 points from no-discount to deep-discount, and the net-new share barely moves [rev-opt:Q2].\n\n## Who actually redeems the discounts\n\n| Offer type | Bookings | Avg discount | Promo funded | First-booking share | Margin % |\n| --- | ---: | ---: | ---: | ---: | ---: |\n| Free visit | 41,200 | n/a | ₹0 | 7.2% | 26.0% |\n| Discount | 18,553 | 19.5% | **₹953K** | **7.6%** | **14.2%** |\n| Referral bonus | 12,225 | n/a | ₹0 | 8.2% | 25.9% |\n| Cashback | 7,651 | 13.0% | ₹203K | 7.5% | 19.9% |\n\nAcross every offer type, first-booking share sits in a tight 7.2% to 8.2% band, so no offer is meaningfully better at reaching new customers than any other [user-segmentation:Q1]. The straight 'discount' offer funds ₹953K and cuts margin to 14.2% for no net-new advantage.\n\n## Where the efficient spend lives: referrals\n\nThe referral programme is the bright spot. Every channel converts invites at roughly 90% to 94% for an average combined reward near ₹350 [user-segmentation:Q2]:\n\n| Referral channel | Invites | Converted | Conversion % | Avg reward |\n| --- | ---: | ---: | ---: | ---: |\n| SMS | 288 | 270 | 93.8% | ₹349 |\n| Link copy | 750 | 685 | 91.3% | ₹350 |\n| WhatsApp | 1,715 | 1,562 | 91.1% | ₹352 |\n| Email | 148 | 134 | 90.5% | ₹351 |\n\nReferral bookings also run at full 25.9% margin [rev-opt:Q1], so this is the one lever that brings in customers without funding a price cut.\n\n## Geographic check\n\nThe pattern is uniform across the map: campaign penetration is ~40% in every city tier, and campaign bookings always run about 3 points below the local baseline margin (22.5% to 23.1% vs ~26.0%) [geographic:Q1]. There is no city where discounting is paying off better than elsewhere.\n\n## Risks and caveats\n\n- **`is_first_booking` is a proxy for net-new, not a perfect one.** It captures genuinely new customers but a reactivated long-dormant customer is also valuable and would not flag as first. The reactivation campaign in particular may look worse on this metric than it truly is.\n- **Discounted first-bookers do retain.** They repeat at 90.6% versus 83.3% for full-price first-bookers [cohort-retention:Q1], so a blanket discount cut could shave a few new-customer relationships. The recommendation is to gate and target, not eliminate.\n- **Correlation, not proof of incrementality.** We cannot see the counterfactual of what a discounted customer would have done without the offer; the flat first-booking share is strong circumstantial evidence, not a controlled experiment.\n\n## Key findings\n\n- **Only ~7.5% of campaign bookings are first bookings** [data-quality:Q1]; the rest go to existing customers, so most of the ₹1.48M in promo and referral spend subsidizes demand already in the funnel.\n- **Margin falls from 25.9% to 6.7% as discount deepens** while net-new share stays flat near 7.5% [rev-opt:Q2]. Deeper discounts buy margin loss, not new customers.\n- **Festival and reactivation campaigns nearly halve margin** (13.9% and 14.3% vs 25.9% baseline) [rev-opt:Q1]; the straight 'discount' offer funds ₹953K for a 14.2% margin and no net-new lift [user-segmentation:Q1].\n- **Referral is the efficient channel**: ~91% invite conversion at ~₹350 reward and full 25.9% margin [user-segmentation:Q2][rev-opt:Q1].\n\n## Recommended actions\n\n1. **Gate the deepest discounts behind a first-booking or dormancy check.** Restricting the 20%+ festival and reactivation offers to genuinely new or long-dormant customers stops the leak to the loyal base, where margin drops to 6.7% [rev-opt:Q2].\n2. **Shift loyal-base spend from discount to free-visit and referral**, which run at full ~26% margin with similar first-booking reach and no funded price cut [user-segmentation:Q1][user-segmentation:Q2].\n3. **Scale the referral programme**, since it converts at ~91% for ~₹350 and is the only mechanism that reliably brings in new customers at full margin [user-segmentation:Q2].\n4. **Cap reactivation discounts** at the point where recovered margin still beats the give-away, since at 23.9% off the campaign barely clears break-even [rev-opt:Q1].\n\n```sql\nSELECT\n  offer_type,\n  COUNT(*)                                                     AS bookings,\n  ROUND(AVG(NULLIF(discount_pct, 0)), 1)                       AS avg_discount_pct,\n  ROUND(SUM(promo_discount_funded) / 1e3, 0)                   AS promo_funded_thousands,\n  ROUND(100.0 * AVG(CASE WHEN is_first_booking\n                         THEN 1 ELSE 0 END), 1)               AS first_booking_share_pct,\n  ROUND(100.0 * SUM(contribution_margin)\n              / SUM(booking_value), 1)                         AS margin_pct\nFROM bookings_economics\nWHERE payment_status = 'success'\n  AND offer_type IS NOT NULL\nGROUP BY offer_type\nORDER BY bookings DESC;\n```",
    followUps: [
      "How much margin would gating discounts to new customers recover?",
      "Do discounted first-bookers retain as well as full-price ones?",
      "What's the break-even discount for a reactivation campaign?",
    ],
    work: {
      "rev-opt": {
        summary:
          "Measured contribution margin by campaign type against the no-campaign baseline, then bucketed every booking by discount depth to show margin collapses from 25.9% to 6.7% while net-new share stays flat.",
        queries: [
          {
            sql: "SELECT COALESCE(campaign_type, 'No campaign') AS campaign_type, COUNT(*) AS bookings, ROUND(AVG(NULLIF(discount_pct, 0)), 1) AS avg_discount_pct, ROUND(SUM(booking_value) / 1e6, 2) AS gmv_millions, ROUND(100.0 * SUM(contribution_margin) / SUM(booking_value), 1) AS margin_pct FROM bookings_economics WHERE payment_status = 'success' GROUP BY campaign_type ORDER BY bookings DESC;",
            description: "Contribution margin and discount depth by campaign type",
            rowCount: 6,
            executionTimeMs: 877,
            columns: ["campaign_type", "bookings", "avg_discount_pct", "gmv_millions", "margin_pct"],
            data: [
              { campaign_type: "No campaign", bookings: 119664, avg_discount_pct: null, gmv_millions: 52.68, margin_pct: 25.9 },
              { campaign_type: "promo", bookings: 50042, avg_discount_pct: 18.0, gmv_millions: 22.0, margin_pct: 24.2 },
              { campaign_type: "referral", bookings: 12225, avg_discount_pct: null, gmv_millions: 5.38, margin_pct: 25.9 },
              { campaign_type: "seasonal", bookings: 6981, avg_discount_pct: 13.2, gmv_millions: 3.07, margin_pct: 18.1 },
              { campaign_type: "festival", bookings: 6296, avg_discount_pct: 20.1, gmv_millions: 2.77, margin_pct: 13.9 },
              { campaign_type: "reactivation", bookings: 4085, avg_discount_pct: 23.9, gmv_millions: 1.8, margin_pct: 14.3 },
            ],
          },
          {
            sql: "SELECT CASE WHEN discount_pct IS NULL OR discount_pct = 0 THEN '0 (no discount)' WHEN discount_pct <= 10 THEN '1-10%' WHEN discount_pct <= 20 THEN '11-20%' ELSE '21%+' END AS discount_band, COUNT(*) AS bookings, ROUND(AVG(booking_value), 0) AS avg_ticket, ROUND(100.0 * AVG(CASE WHEN is_first_booking THEN 1 ELSE 0 END), 1) AS first_share, ROUND(100.0 * SUM(contribution_margin) / SUM(booking_value), 1) AS margin_pct FROM bookings_economics WHERE payment_status = 'success' GROUP BY 1 ORDER BY 1;",
            description: "Margin and first-booking share by discount-depth band",
            rowCount: 4,
            executionTimeMs: 803,
            columns: ["discount_band", "bookings", "avg_ticket", "first_share", "margin_pct"],
            data: [
              { discount_band: "0 (no discount)", bookings: 174832, avg_ticket: 440, first_share: 7.4, margin_pct: 25.9 },
              { discount_band: "1-10%", bookings: 6038, avg_ticket: 441, first_share: 7.8, margin_pct: 20.0 },
              { discount_band: "11-20%", bookings: 14677, avg_ticket: 438, first_share: 7.5, margin_pct: 15.4 },
              { discount_band: "21%+", bookings: 3746, avg_ticket: 443, first_share: 8.1, margin_pct: 6.7 },
            ],
          },
        ],
      },
      "user-segmentation": {
        summary:
          "Broke each offer type down by promo dollars funded, first-booking share and margin, then profiled the referral channel funnel as the one efficient acquisition mechanism (~91% conversion at ~₹350).",
        queries: [
          {
            sql: "SELECT offer_type, COUNT(*) AS bookings, ROUND(AVG(NULLIF(discount_pct, 0)), 1) AS avg_discount_pct, ROUND(SUM(promo_discount_funded) / 1e3, 0) AS promo_funded_thousands, ROUND(100.0 * AVG(CASE WHEN is_first_booking THEN 1 ELSE 0 END), 1) AS first_booking_share_pct, ROUND(100.0 * SUM(contribution_margin) / SUM(booking_value), 1) AS margin_pct FROM bookings_economics WHERE payment_status = 'success' AND offer_type IS NOT NULL GROUP BY offer_type ORDER BY bookings DESC;",
            description: "Promo funded, first-booking share and margin by offer type",
            rowCount: 4,
            executionTimeMs: 934,
            columns: ["offer_type", "bookings", "avg_discount_pct", "promo_funded_thousands", "first_booking_share_pct", "margin_pct"],
            data: [
              { offer_type: "free_visit", bookings: 41200, avg_discount_pct: null, promo_funded_thousands: 0, first_booking_share_pct: 7.2, margin_pct: 26.0 },
              { offer_type: "discount", bookings: 18553, avg_discount_pct: 19.5, promo_funded_thousands: 953, first_booking_share_pct: 7.6, margin_pct: 14.2 },
              { offer_type: "referral_bonus", bookings: 12225, avg_discount_pct: null, promo_funded_thousands: 0, first_booking_share_pct: 8.2, margin_pct: 25.9 },
              { offer_type: "cashback", bookings: 7651, avg_discount_pct: 13.0, promo_funded_thousands: 203, first_booking_share_pct: 7.5, margin_pct: 19.9 },
            ],
          },
          {
            sql: "SELECT referral_channel, COUNT(*) AS invites, SUM(CASE WHEN status = 'converted' THEN 1 ELSE 0 END) AS converted, ROUND(100.0 * SUM(CASE WHEN status = 'converted' THEN 1 ELSE 0 END) / COUNT(*), 1) AS conv_pct, ROUND(AVG(referrer_reward_amount + referee_reward_amount), 0) AS avg_reward FROM referrals GROUP BY referral_channel ORDER BY conv_pct DESC;",
            description: "Referral funnel conversion and reward cost by channel",
            rowCount: 4,
            executionTimeMs: 461,
            columns: ["referral_channel", "invites", "converted", "conv_pct", "avg_reward"],
            data: [
              { referral_channel: "sms", invites: 288, converted: 270, conv_pct: 93.8, avg_reward: 349 },
              { referral_channel: "link_copy", invites: 750, converted: 685, conv_pct: 91.3, avg_reward: 350 },
              { referral_channel: "whatsapp", invites: 1715, converted: 1562, conv_pct: 91.1, avg_reward: 352 },
              { referral_channel: "email", invites: 148, converted: 134, conv_pct: 90.5, avg_reward: 351 },
            ],
          },
        ],
      },
      "data-quality": {
        summary:
          "Totaled promo and referral spend and computed the net-new share of campaign bookings, confirming that only 7.5% of the ₹1.48M-subsidized campaign demand reaches first-time customers.",
        queries: [
          {
            sql: "SELECT ROUND(SUM(promo_discount_funded) / 1e3, 0) AS promo_funded_k, ROUND(SUM(referral_reward_cost) / 1e3, 0) AS referral_cost_k, SUM(CASE WHEN campaign_id IS NOT NULL AND is_first_booking THEN 1 ELSE 0 END) AS campaign_first_bookings, SUM(CASE WHEN campaign_id IS NOT NULL THEN 1 ELSE 0 END) AS campaign_bookings, ROUND(100.0 * SUM(CASE WHEN campaign_id IS NOT NULL AND is_first_booking THEN 1 ELSE 0 END) / SUM(CASE WHEN campaign_id IS NOT NULL THEN 1 ELSE 0 END), 1) AS campaign_first_share FROM bookings_economics WHERE payment_status = 'success';",
            description: "Total promo/referral spend and net-new share of campaign bookings",
            rowCount: 1,
            executionTimeMs: 489,
            columns: ["promo_funded_k", "referral_cost_k", "campaign_first_bookings", "campaign_bookings", "campaign_first_share"],
            data: [{ promo_funded_k: 1156, referral_cost_k: 326, campaign_first_bookings: 5933, campaign_bookings: 79629, campaign_first_share: 7.5 }],
          },
        ],
      },
      "cohort-retention": {
        summary:
          "Compared lifetime retention of customers whose first booking was discounted vs full price, finding discounted first-bookers repeat slightly more often but book fewer times overall.",
        queries: [
          {
            sql: "WITH first AS (SELECT customer_id, ARG_MIN(CASE WHEN discount_pct > 0 THEN 1 ELSE 0 END, booking_date) AS first_discounted FROM bookings WHERE payment_status = 'success' AND is_first_booking GROUP BY customer_id), cnt AS (SELECT customer_id, COUNT(*) AS n FROM bookings WHERE payment_status = 'success' GROUP BY customer_id) SELECT CASE WHEN f.first_discounted = 1 THEN 'First booking discounted' ELSE 'First booking full price' END AS cohort, COUNT(*) AS customers, ROUND(100.0 * SUM(CASE WHEN c.n >= 2 THEN 1 ELSE 0 END) / COUNT(*), 1) AS repeat_pct, ROUND(AVG(c.n), 1) AS avg_lifetime_bookings FROM first f JOIN cnt c ON f.customer_id = c.customer_id GROUP BY 1 ORDER BY repeat_pct DESC;",
            description: "Lifetime retention: discounted vs full-price first-bookers",
            rowCount: 2,
            executionTimeMs: 1102,
            columns: ["cohort", "customers", "repeat_pct", "avg_lifetime_bookings"],
            data: [
              { cohort: "First booking discounted", customers: 1834, repeat_pct: 90.6, avg_lifetime_bookings: 10.6 },
              { cohort: "First booking full price", customers: 12594, repeat_pct: 83.3, avg_lifetime_bookings: 13.9 },
            ],
          },
        ],
      },
      "geographic": {
        summary:
          "Checked campaign penetration and margin by city tier and found the discount drag is uniform: ~40% penetration everywhere and campaign margin running ~3 points below the local baseline.",
        queries: [
          {
            sql: "SELECT city, COUNT(*) AS bookings, ROUND(100.0 * COUNT(*) FILTER (WHERE campaign_id IS NOT NULL) / COUNT(*), 1) AS campaign_pct, ROUND(100.0 * SUM(contribution_margin) FILTER (WHERE campaign_id IS NOT NULL) / SUM(booking_value) FILTER (WHERE campaign_id IS NOT NULL), 1) AS campaign_margin_pct, ROUND(100.0 * SUM(contribution_margin) FILTER (WHERE campaign_id IS NULL) / SUM(booking_value) FILTER (WHERE campaign_id IS NULL), 1) AS baseline_margin_pct FROM bookings_economics WHERE payment_status = 'success' GROUP BY city ORDER BY campaign_pct DESC;",
            description: "Campaign penetration and margin vs baseline by city tier",
            rowCount: 3,
            executionTimeMs: 718,
            columns: ["city", "bookings", "campaign_pct", "campaign_margin_pct", "baseline_margin_pct"],
            data: [
              { city: "Metropolitian", bookings: 149331, campaign_pct: 40.1, campaign_margin_pct: 22.5, baseline_margin_pct: 26.0 },
              { city: "Urban", bookings: 30068, campaign_pct: 39.6, campaign_margin_pct: 22.9, baseline_margin_pct: 25.9 },
              { city: "Semi-Urban", bookings: 19894, campaign_pct: 39.5, campaign_margin_pct: 23.1, baseline_margin_pct: 26.0 },
            ],
          },
        ],
      },
    },
  }),
  deepResearchThread({
    slug: "newer-cohort-retention-decay",
    title: "Why is newer-cohort retention falling off a cliff?",
    question:
      "Why is month-1 retention so much worse for our recent signup cohorts than our older ones?",
    report:
      "## Executive summary\n\nMonth-1 retention has fallen from near-perfect in the earliest 2025 cohorts to barely a quarter for the latest ones, and the front of the funnel (30-day activation) has decayed on the same curve. But the more useful finding is what is NOT causing it. We checked the four usual suspects and ruled them out: acquisition-source mix is stable, per-source activation is flat, the first-booking service mix has not shifted, and the first-booking on-time experience has only drifted mildly. The steep part of the decline is concentrated in the mid-2025 cohorts, and the very newest cohorts (Dec 2025, Jan 2026) are additionally depressed by a data-window effect, since they have had far less calendar time to re-book. The honest read: there is a real early-lifecycle problem worth fixing, but it is not explained by where customers come from, so the lever is onboarding and early-habit formation, not channel quality.\n\n## Methodology and data note\n\nMonth-1, month-3 and month-6 retention come straight from the pre-built `weekly_retention_cohorts` table, pivoted with `CASE` on `months_since_signup`. 30-day activation is computed by joining each customer's signup date in `customers` to their first completed booking in `bookings` and checking whether the gap is 30 days or fewer. Source-mix and first-booking diagnostics are cut from `customers` and `bookings` respectively. A key caveat threaded through every section: cohorts that signed up recently have had less observation time, so their longer-horizon retention and even their 30-day activation read low partly by construction. The Jan 2026 cohort has only 58 days of observation versus 392 for Feb 2025 [data-quality:Q2].\n\n## Month-1 retention by signup cohort\n\n| Signup cohort | Cohort size | Month-1 retention | Month-3 | Month-6 |\n| --- | ---: | ---: | ---: | ---: |\n| Feb 2025 | 1,157 | **97.9%** | 97.8% | 93.9% |\n| Mar 2025 | 1,364 | 86.3% | 85.0% | 82.5% |\n| Apr 2025 | 1,469 | 72.4% | 65.7% | 80.3% |\n| May 2025 | 1,558 | 61.1% | 51.1% | 67.5% |\n| Jun 2025 | 1,428 | 46.4% | 51.8% | 54.0% |\n| Aug 2025 | 1,030 | 42.3% | 51.4% | 41.0% |\n| Oct 2025 | 1,751 | 46.0% | 36.7% | n/a |\n| Nov 2025 | 1,690 | 37.6% | 31.7% | n/a |\n| Dec 2025 | 1,523 | 29.2% | n/a | n/a |\n| Jan 2026 | 1,335 | **25.6%** | n/a | n/a |\n\nMonth-1 retention falls steadily from 97.9% to 25.6% while cohort sizes hold flat-to-growing [cohort-retention:Q1]. The steepest drop is the Feb-to-Jun 2025 stretch (97.9% to 46.4%); the late-2025 cohorts continue down but are increasingly affected by the observation window.\n\n## Early activation is decaying on the same curve\n\n30-day activation (the share of a cohort that completes a first booking within a month of signup) tells the same story [user-segmentation:Q1]:\n\n| Signup month | Signups | First bookers (within 30d) | Activation % |\n| --- | ---: | ---: | ---: |\n| Feb 2025 | 1,157 | 1,137 | **98.3%** |\n| Jun 2025 | 1,428 | 707 | 49.5% |\n| Oct 2025 | 1,751 | 828 | 47.3% |\n| Jan 2026 | 1,335 | 370 | **27.7%** |\n\n## What it is NOT: acquisition source\n\nThe intuitive hypothesis is that recent signups come from worse channels. The data does not support it. The acquisition-source mix is essentially unchanged between the first and second halves of the year (paid ~45% to 46%, organic ~35%, referral ~15%) [data-quality:Q1]:\n\n| Period | Signups | Organic % | Paid (google+meta) % | Referral % |\n| --- | ---: | ---: | ---: | ---: |\n| H1 (Feb to Jul 2025) | 8,133 | 34.5% | 46.1% | 14.7% |\n| H2 (Aug 2025 to Feb 2026) | 9,867 | 35.4% | 44.7% | 14.8% |\n\nAnd 30-day activation is flat across every source (48.4% to 50.2%) [user-segmentation:Q2], so no single channel is dragging the cohort down. If a channel-quality shift were the cause, we would see the mix move or one source underperform; neither happens.\n\n## What it is NOT: onboarding service mix or first-visit experience\n\nThe first-booking service mix is stable: the share of customers whose first job is a sub-₹250 chore holds in a 22% to 25% band and the average first ticket sits near ₹440 across every cohort [user-segmentation:Q3]. The first-booking on-time experience drifts only mildly, from 48.3% on-time for the Feb 2025 cohort to ~41% for late-summer cohorts [cohort-retention:Q2], a gentle decline that cannot explain a retention drop from 98% to 26%.\n\n## The window effect\n\nObservation time falls monotonically with recency [data-quality:Q2]:\n\n| Cohort | Signups | Days observed |\n| --- | ---: | ---: |\n| Feb 2025 | 1,157 | 392 |\n| Jun 2025 | 1,428 | 272 |\n| Oct 2025 | 1,751 | 150 |\n| Jan 2026 | 1,335 | 58 |\n\nNewer cohorts mechanically have fewer chances to re-book before the dataset ends, which inflates the apparent late-cohort collapse. The cleanest, artifact-free signal is therefore the mid-2025 decline, which is real and steep on its own.\n\n## Risks and caveats\n\n- **The very newest cohorts are partly a measurement artifact.** Do not over-react to the Dec 2025 and Jan 2026 numbers in isolation; weight the mid-2025 trend instead [data-quality:Q2].\n- **'We ruled out X' is bounded by the fields we have.** We can rule out source mix, source activation, first-service mix and first on-time, but not unmeasured factors like in-app friction, pricing changes, or a product change that shipped mid-2025.\n- **Retention and activation share an input.** Both depend on the customer booking at all, so the two curves moving together is partly definitional, not necessarily two independent failures.\n\n## Key findings\n\n- **Month-1 retention fell from 97.9% (Feb 2025) to 25.6% (Jan 2026)** on flat-to-growing cohort sizes [cohort-retention:Q1], and 30-day activation fell in parallel from 98.3% to 27.7% [user-segmentation:Q1].\n- **It is not acquisition source.** Source mix is stable across halves [data-quality:Q1] and activation is flat across all five sources (48.4% to 50.2%) [user-segmentation:Q2].\n- **It is not onboarding mix or first-visit experience.** First-booking chore share (22% to 25%) and ticket (~₹440) are stable [user-segmentation:Q3], and first-booking on-time drifts only mildly [cohort-retention:Q2].\n- **The newest cohorts are partly a window artifact** (Jan 2026 has 58 observed days vs 392 for Feb 2025) [data-quality:Q2]; the trustworthy signal is the mid-2025 decline.\n\n## Recommended actions\n\n1. **Re-baseline the metric to remove the window effect.** Report month-1 retention only for cohorts with a full month of observation, and track the matured series so the dashboard stops over-stating the recent collapse [data-quality:Q2].\n2. **Investigate the mid-2025 product and pricing timeline.** Since the steep drop lands in the Apr-to-Jun 2025 cohorts and is not explained by channel or onboarding mix, look for a product, pricing, or app change that shipped in that window [cohort-retention:Q1].\n3. **Double down on the first-14-day habit loop**, since activation falls in lockstep with retention and the lever sits before the second booking, not at acquisition [user-segmentation:Q1].\n4. **Treat month-1 retention as a weekly health metric, not a quarterly one**, so a future cliff is caught at the cohort that is forming rather than six months later.\n\n```sql\nSELECT\n  STRFTIME(cohort_month, '%Y-%m')                              AS signup_cohort,\n  MAX(cohort_size)                                            AS cohort_size,\n  ROUND(MAX(CASE WHEN months_since_signup = 1\n                 THEN retention_pct END), 1)                   AS month_1_pct,\n  ROUND(MAX(CASE WHEN months_since_signup = 3\n                 THEN retention_pct END), 1)                   AS month_3_pct,\n  ROUND(MAX(CASE WHEN months_since_signup = 6\n                 THEN retention_pct END), 1)                   AS month_6_pct\nFROM weekly_retention_cohorts\nGROUP BY cohort_month\nORDER BY cohort_month;\n```",
    followUps: [
      "What changed in the first-booking experience for recent cohorts?",
      "Do recent cohorts skew toward low-margin chore services?",
      "Which acquisition source has the worst month-1 retention?",
    ],
    work: {
      "cohort-retention": {
        summary:
          "Pulled month-1/3/6 retention by signup cohort (collapse from 97.9% to 25.6%) and checked first-booking on-time experience by cohort, which only drifts mildly and cannot explain the retention drop.",
        queries: [
          {
            sql: "SELECT STRFTIME(cohort_month, '%Y-%m') AS signup_cohort, MAX(cohort_size) AS cohort_size, ROUND(MAX(CASE WHEN months_since_signup = 1 THEN retention_pct END), 1) AS month_1_pct, ROUND(MAX(CASE WHEN months_since_signup = 3 THEN retention_pct END), 1) AS month_3_pct, ROUND(MAX(CASE WHEN months_since_signup = 6 THEN retention_pct END), 1) AS month_6_pct FROM weekly_retention_cohorts GROUP BY cohort_month ORDER BY cohort_month;",
            description: "Month-1/3/6 retention by signup cohort",
            rowCount: 13,
            executionTimeMs: 437,
            columns: ["signup_cohort", "cohort_size", "month_1_pct", "month_3_pct", "month_6_pct"],
            data: [
              { signup_cohort: "2025-02", cohort_size: 1157, month_1_pct: 97.9, month_3_pct: 97.8, month_6_pct: 93.9 },
              { signup_cohort: "2025-03", cohort_size: 1364, month_1_pct: 86.3, month_3_pct: 85.0, month_6_pct: 82.5 },
              { signup_cohort: "2025-04", cohort_size: 1469, month_1_pct: 72.4, month_3_pct: 65.7, month_6_pct: 80.3 },
              { signup_cohort: "2025-05", cohort_size: 1558, month_1_pct: 61.1, month_3_pct: 51.1, month_6_pct: 67.5 },
              { signup_cohort: "2025-06", cohort_size: 1428, month_1_pct: 46.4, month_3_pct: 51.8, month_6_pct: 54.0 },
              { signup_cohort: "2025-08", cohort_size: 1030, month_1_pct: 42.3, month_3_pct: 51.4, month_6_pct: 41.0 },
              { signup_cohort: "2025-10", cohort_size: 1751, month_1_pct: 46.0, month_3_pct: 36.7, month_6_pct: null },
              { signup_cohort: "2025-11", cohort_size: 1690, month_1_pct: 37.6, month_3_pct: 31.7, month_6_pct: null },
              { signup_cohort: "2025-12", cohort_size: 1523, month_1_pct: 29.2, month_3_pct: null, month_6_pct: null },
              { signup_cohort: "2026-01", cohort_size: 1335, month_1_pct: 25.6, month_3_pct: null, month_6_pct: null },
            ],
          },
          {
            sql: "WITH fb AS (SELECT customer_id, ARG_MIN(on_time, booking_date) AS first_on_time, ARG_MIN(signup_date, booking_date) AS sd FROM bookings WHERE payment_status = 'success' GROUP BY customer_id) SELECT STRFTIME(sd, '%Y-%m') AS cohort, COUNT(*) AS customers, ROUND(100.0 * AVG(CASE WHEN first_on_time THEN 1 ELSE 0 END), 1) AS first_on_time_pct FROM fb WHERE sd >= DATE '2025-02-01' GROUP BY 1 ORDER BY 1;",
            description: "First-booking on-time rate by signup cohort",
            rowCount: 13,
            executionTimeMs: 1418,
            columns: ["cohort", "customers", "first_on_time_pct"],
            data: [
              { cohort: "2025-02", customers: 1157, first_on_time_pct: 48.3 },
              { cohort: "2025-05", customers: 1558, first_on_time_pct: 44.8 },
              { cohort: "2025-08", customers: 1019, first_on_time_pct: 41.0 },
              { cohort: "2025-10", customers: 1751, first_on_time_pct: 40.9 },
              { cohort: "2025-12", customers: 1523, first_on_time_pct: 47.4 },
              { cohort: "2026-01", customers: 1335, first_on_time_pct: 50.1 },
            ],
          },
        ],
      },
      "user-segmentation": {
        summary:
          "Measured 30-day activation by cohort (decay from 98.3% to 27.7%), then checked activation by acquisition source (flat) and first-booking service mix by cohort (flat), ruling out channel and onboarding-mix explanations.",
        queries: [
          {
            sql: "WITH fb AS (SELECT customer_id, MIN(booking_date) AS first_booking FROM bookings WHERE payment_status = 'success' GROUP BY customer_id) SELECT STRFTIME(c.signup_date, '%Y-%m') AS signup_month, COUNT(*) AS signups, SUM(CASE WHEN fb.first_booking IS NOT NULL AND DATE_DIFF('day', c.signup_date, fb.first_booking) <= 30 THEN 1 ELSE 0 END) AS first_bookers_30d, ROUND(100.0 * SUM(CASE WHEN fb.first_booking IS NOT NULL AND DATE_DIFF('day', c.signup_date, fb.first_booking) <= 30 THEN 1 ELSE 0 END) / COUNT(*), 1) AS activation_pct FROM customers c LEFT JOIN fb ON c.customer_id = fb.customer_id WHERE STRFTIME(c.signup_date, '%Y-%m') IN ('2025-02', '2025-06', '2025-10', '2026-01') GROUP BY signup_month ORDER BY signup_month;",
            description: "30-day activation rate by signup cohort",
            rowCount: 4,
            executionTimeMs: 1287,
            columns: ["signup_month", "signups", "first_bookers_30d", "activation_pct"],
            data: [
              { signup_month: "2025-02", signups: 1157, first_bookers_30d: 1137, activation_pct: 98.3 },
              { signup_month: "2025-06", signups: 1428, first_bookers_30d: 707, activation_pct: 49.5 },
              { signup_month: "2025-10", signups: 1751, first_bookers_30d: 828, activation_pct: 47.3 },
              { signup_month: "2026-01", signups: 1335, first_bookers_30d: 370, activation_pct: 27.7 },
            ],
          },
          {
            sql: "WITH fb AS (SELECT customer_id, MIN(booking_date) AS first_booking FROM bookings WHERE payment_status = 'success' GROUP BY customer_id) SELECT c.acquisition_source, COUNT(*) AS signups, ROUND(100.0 * SUM(CASE WHEN fb.first_booking IS NOT NULL AND DATE_DIFF('day', c.signup_date, fb.first_booking) <= 30 THEN 1 ELSE 0 END) / COUNT(*), 1) AS activation_30d_pct FROM customers c LEFT JOIN fb ON c.customer_id = fb.customer_id GROUP BY 1 ORDER BY activation_30d_pct DESC;",
            description: "30-day activation by acquisition source (flat, rules out channel)",
            rowCount: 5,
            executionTimeMs: 1163,
            columns: ["acquisition_source", "signups", "activation_30d_pct"],
            data: [
              { acquisition_source: "meta", signups: 3667, activation_30d_pct: 50.2 },
              { acquisition_source: "organic", signups: 6304, activation_30d_pct: 50.2 },
              { acquisition_source: "google", signups: 4495, activation_30d_pct: 50.1 },
              { acquisition_source: "referral", signups: 2651, activation_30d_pct: 48.9 },
              { acquisition_source: "whatsapp", signups: 883, activation_30d_pct: 48.4 },
            ],
          },
          {
            sql: "WITH fb AS (SELECT customer_id, ARG_MIN(booking_value, booking_date) AS first_val, ARG_MIN(signup_date, booking_date) AS sd FROM bookings WHERE payment_status = 'success' GROUP BY customer_id) SELECT STRFTIME(sd, '%Y-%m') AS cohort, COUNT(*) AS customers, ROUND(100.0 * AVG(CASE WHEN first_val < 250 THEN 1 ELSE 0 END), 1) AS first_chore_pct, ROUND(AVG(first_val), 0) AS avg_first_ticket FROM fb WHERE sd >= DATE '2025-02-01' GROUP BY 1 ORDER BY 1;",
            description: "First-booking service mix (chore share, ticket) by cohort (stable)",
            rowCount: 13,
            executionTimeMs: 1351,
            columns: ["cohort", "customers", "first_chore_pct", "avg_first_ticket"],
            data: [
              { cohort: "2025-02", customers: 1157, first_chore_pct: 21.9, avg_first_ticket: 450 },
              { cohort: "2025-04", customers: 1469, first_chore_pct: 22.4, avg_first_ticket: 443 },
              { cohort: "2025-06", customers: 1426, first_chore_pct: 23.1, avg_first_ticket: 439 },
            ],
          },
        ],
      },
      "data-quality": {
        summary:
          "Confirmed acquisition-source mix is stable across the two halves of the year and quantified the observation-window effect that depresses the newest cohorts (58 days for Jan 2026 vs 392 for Feb 2025).",
        queries: [
          {
            sql: "SELECT CASE WHEN signup_date < DATE '2025-08-01' THEN 'H1 (Feb-Jul 2025)' ELSE 'H2 (Aug 2025-Feb 2026)' END AS period, COUNT(*) AS signups, ROUND(100.0 * COUNT(*) FILTER (WHERE acquisition_source = 'organic') / COUNT(*), 1) AS organic_pct, ROUND(100.0 * COUNT(*) FILTER (WHERE acquisition_source IN ('google', 'meta')) / COUNT(*), 1) AS paid_pct, ROUND(100.0 * COUNT(*) FILTER (WHERE acquisition_source = 'referral') / COUNT(*), 1) AS referral_pct FROM customers GROUP BY 1 ORDER BY 1;",
            description: "Acquisition-source mix, first half vs second half (stable)",
            rowCount: 2,
            executionTimeMs: 421,
            columns: ["period", "signups", "organic_pct", "paid_pct", "referral_pct"],
            data: [
              { period: "H1 (Feb-Jul 2025)", signups: 8133, organic_pct: 34.5, paid_pct: 46.1, referral_pct: 14.7 },
              { period: "H2 (Aug 2025-Feb 2026)", signups: 9867, organic_pct: 35.4, paid_pct: 44.7, referral_pct: 14.8 },
            ],
          },
          {
            sql: "WITH md AS (SELECT MAX(signup_date) AS m FROM customers), c AS (SELECT DATE_TRUNC('month', signup_date) AS mo, COUNT(*) AS signups FROM customers GROUP BY 1) SELECT STRFTIME(mo, '%Y-%m') AS cohort, signups, DATE_DIFF('day', mo, (SELECT m FROM md)) AS days_observed FROM c ORDER BY mo;",
            description: "Observation window (days) per signup cohort (window artifact)",
            rowCount: 13,
            executionTimeMs: 398,
            columns: ["cohort", "signups", "days_observed"],
            data: [
              { cohort: "2025-02", signups: 1157, days_observed: 392 },
              { cohort: "2025-06", signups: 1428, days_observed: 272 },
              { cohort: "2025-10", signups: 1751, days_observed: 150 },
              { cohort: "2025-12", signups: 1523, days_observed: 89 },
              { cohort: "2026-01", signups: 1335, days_observed: 58 },
              { cohort: "2026-02", signups: 1216, days_observed: 27 },
            ],
          },
        ],
      },
    },
  }),
];

export const QUICKHELP_STARTER_CHATS: StarterChat[] = [...normals, ...deeps];
