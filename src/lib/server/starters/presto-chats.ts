import {
  deepResearchThread,
  normalThread,
  type StarterChat,
} from "@/lib/server/starter-chats";

// Presto: ad-funded mobile game. Every figure below was validated against the
// dataset's materialized summary tables (payback_analysis, roas_by_cohort,
// cohort_retention_actuals, engagement_analysis, monthly_revenue_summary,
// arpdau_trend, ltv_model_accuracy) plus the raw event tables (installs,
// sessions, ad_impression_events) over the 2025-08 to 2026-02 window.

const normalChats: StarterChat[] = [
  normalThread({
    slug: "countries-worth-the-cost",
    title: "Which countries actually pay back?",
    question:
      "Which countries return more than we pay to acquire them, and which ones are quietly bleeding budget?",
    answer:
      "## Only 4 of 10 countries clear break-even on D90\n\nWeighted across every paid channel, projected D90 LTV vs acquisition cost [geographic:Q1]:\n\n| Country | Installs | CPI | D90 LTV | D90 ROAS |\n|---|---|---:|---:|---:|\n| US | 4,799 | $5.54 | $10.81 | **1.95x** |\n| Others | 1,398 | $1.68 | $2.34 | **1.39x** |\n| GB | 1,358 | $6.61 | $7.19 | 1.09x |\n| CA | 1,001 | $7.99 | $8.34 | 1.04x |\n| FR | 719 | $4.02 | $2.95 | 0.73x |\n| BR | 2,571 | $1.37 | $0.82 | 0.60x |\n| DE | 1,358 | $7.54 | $4.33 | 0.57x |\n| IN | 3,972 | $0.58 | $0.33 | 0.56x |\n| MX | 1,134 | $1.55 | $0.81 | 0.52x |\n| ID | 1,188 | $0.87 | $0.35 | 0.40x |\n\n**The US alone returns 1.95x and is the only Tier-1 market that truly carries the book** [geographic:Q1]. GB and CA scrape past break-even; everything below FR loses money on a 90-day horizon. The cheap-CPI markets (IN, MX, ID, BR) look efficient on cost but monetize so thinly that no install ever pays itself back: IN converts a $0.58 CPI into just $0.33 of D90 LTV (0.56x) [geographic:Q1].\n\n**The leak is large and concentrated.** Across the whole paid book, 6 of 10 countries sit below break-even and together absorb $21,727 of spend, roughly a third of the $67,662 total [geographic:Q2]. Ranking every country by ROAS and accumulating the below-break-even spend from worst to best, the bottom six contribute 32.1% of all paid spend [geographic:Q3].\n\n**The trap is monetization depth, not bad users.** At the raw-install level the cheap geos are not measurably lower quality: high-engagement share holds near 30% and invalid-traffic rates near 8% in essentially every country, including the unprofitable ones [geographic:Q5]. The gap is how much each retained user pays. The cheap geos also mature faster, capturing roughly 90% of their lifetime value by D30, so there is no late LTV tail to wait for [geographic:Q4]. The Tier-1 leaks (DE, FR) are the opposite shape: they keep climbing to D90 (only ~69% of LTV by D30) but start from a CPI so high that the curve never catches the cost.\n\n**Takeaway:** low CPI is not the same as low risk. The 6 below-break-even countries are buying installs that look cheap and return ~50 cents on the dollar, and the data says they are structurally underwater, not just early in their curve.\n\nWant me to find exactly which channel x country pockets are draining the most spend, or pull US payback out by channel?",
    followUps: [
      "Where is the below-break-even spend concentrated by channel?",
      "Break the US down by channel and platform",
      "How much total spend is going to sub-1.0x ROAS markets?",
    ],
    primaryAgent: { id: "geographic", name: "Geographic Agent", icon: "globe" },
    work: {
      summary:
        "Ranked all 10 countries by spend-weighted D90 ROAS, sized the below-break-even leak, traced the LTV maturation curve per geo, and cross-checked raw install quality. Only US, Others, GB and CA clear 1.0x; six markets absorb $21.7K (32.1% of spend) returning under a dollar, and they leak on monetization depth, not user quality.",
      queries: [
        {
          sql: "SELECT country, SUM(installs) AS installs, ROUND(SUM(ua_spend)/SUM(installs),2) AS cpi, ROUND(SUM(d90_ltv*installs)/SUM(installs),2) AS d90_ltv, ROUND(SUM(d90_ltv*installs)/SUM(ua_spend),2) AS roas_d90 FROM payback_analysis GROUP BY country ORDER BY roas_d90 DESC",
          description: "D90 ROAS by country, spend-weighted across every channel",
          rowCount: 10,
          executionTimeMs: 412,
          columns: ["country", "installs", "cpi", "d90_ltv", "roas_d90"],
        },
        {
          sql: "WITH c AS (SELECT country, SUM(ua_spend) AS spend, SUM(d90_ltv*installs)/SUM(ua_spend) AS roas FROM payback_analysis GROUP BY country) SELECT ROUND(SUM(CASE WHEN roas<1 THEN spend END),0) AS below_be_spend, COUNT(CASE WHEN roas<1 THEN 1 END) AS n_countries, ROUND(SUM(spend),0) AS total_spend FROM c",
          description: "Total spend and country count sitting below 1.0x D90 ROAS",
          rowCount: 1,
          executionTimeMs: 305,
          columns: ["below_be_spend", "n_countries", "total_spend"],
        },
        {
          sql: "WITH c AS (SELECT country, SUM(ua_spend) AS spend, SUM(installs) AS installs, SUM(d90_ltv*installs)/SUM(ua_spend) AS roas FROM payback_analysis GROUP BY country) SELECT country, ROUND(spend,0) AS spend, installs, ROUND(roas,2) AS roas_d90, ROW_NUMBER() OVER (ORDER BY roas DESC) AS rank, ROUND(100.0*SUM(CASE WHEN roas<1 THEN spend ELSE 0 END) OVER (ORDER BY roas DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)/SUM(spend) OVER (),1) AS cum_leak_pct FROM c ORDER BY roas DESC",
          description: "Countries ranked by ROAS with running cumulative below-break-even spend share",
          rowCount: 10,
          executionTimeMs: 561,
          columns: ["country", "spend", "installs", "roas_d90", "rank", "cum_leak_pct"],
        },
        {
          sql: "WITH p AS (SELECT country, SUM(d7_ltv*installs)/SUM(installs) AS d7, SUM(d30_ltv*installs)/SUM(installs) AS d30, SUM(d90_ltv*installs)/SUM(installs) AS d90, SUM(d90_ltv*installs)/SUM(ua_spend) AS roas FROM payback_analysis GROUP BY country) SELECT country, ROUND(d7,2) AS d7_ltv, ROUND(d30,2) AS d30_ltv, ROUND(d90,2) AS d90_ltv, ROUND(100.0*d30/NULLIF(d90,0),0) AS pct_ltv_by_d30, ROUND(roas,2) AS roas_d90 FROM p WHERE roas<1 ORDER BY roas",
          description: "LTV maturation D7 to D90 for the below-break-even geos, with share of LTV captured by D30",
          rowCount: 6,
          executionTimeMs: 489,
          columns: ["country", "d7_ltv", "d30_ltv", "d90_ltv", "pct_ltv_by_d30", "roas_d90"],
        },
        {
          sql: "SELECT country, COUNT(*) AS installs, ROUND(100.0*COUNT(*) FILTER(WHERE is_fraud)/COUNT(*),1) AS fraud_pct, ROUND(100.0*COUNT(*) FILTER(WHERE engagement_tier='high')/COUNT(*),1) AS high_eng_pct FROM installs GROUP BY country ORDER BY fraud_pct DESC",
          description: "Raw install-level fraud rate and high-engagement share by country",
          rowCount: 10,
          executionTimeMs: 638,
          columns: ["country", "installs", "fraud_pct", "high_eng_pct"],
        },
      ],
    },
  }),
  normalThread({
    slug: "ad-fraud-leakage",
    title: "How much ad revenue is fraud eating?",
    question:
      "How much of our reported ad revenue never settles because of invalid traffic, and which channels are the worst?",
    answer:
      "## $7.2K (6.7%) of reported ad revenue never settles\n\nReported ad revenue is $107,116 but only **$99,942 settles** after invalid-traffic clawbacks, a $7,174 loss [rev-opt:Q2]. The loss is heavily channel-skewed [rev-opt:Q1]:\n\n| Channel | Reported | Settled | Fraud loss | Fraud % |\n|---|---:|---:|---:|---:|\n| Vungle | $4,923 | $4,114 | $809 | **16.4%** |\n| AdMob | $12,594 | $10,983 | $1,611 | **12.8%** |\n| Moloco | $4,764 | $4,155 | $609 | **12.8%** |\n| Facebook | $46,485 | $43,721 | $2,764 | 5.9% |\n| Organic | $38,350 | $36,969 | $1,381 | 3.6% |\n\n**Vungle loses 16.4% of its ad revenue to fraud, the worst by far,** with AdMob and Moloco both at 12.8% [rev-opt:Q1]. Facebook and organic traffic are clean by comparison (under 6%). Because Vungle already has the thinnest UA payback, fraud erosion compounds the problem there. The raw impression log tells the same story from 485,734 individual events: Vungle settles only 83.6% of impression revenue versus 94.1% for Facebook and 96.4% for organic [rev-opt:Q4].\n\n**Format does not save you.** Rewarded (6.6%) and interstitial (6.8%) leak at almost the same rate, so this is a network-quality problem, not a placement problem [rev-opt:Q3]. The fix is at the channel level.\n\n**Country exposure is concentrated where the money is.** The US carries the largest absolute fraud loss ($4,292) simply because it is the biggest revenue base, but GB has the highest fraud rate of any sizeable market at 8.5% [rev-opt:Q5]. So a channel-level fraud cut also disproportionately protects US and GB revenue.\n\n**The trend is flat, not worsening.** Month over month the blended fraud rate oscillates in a tight 5.6% to 7.4% band with no sustained climb, so this is a steady-state tax to manage, not an escalating breach [rev-opt:Q6].\n\n**Always report settled revenue for channel quality and net revenue ($69,959, after the 30% platform fee) for Finance** so fraud is never double-counted as upside [rev-opt:Q2]. Note: Presto is ad-funded, so this is the full monetization picture.\n\nWant me to split fraud loss by country, or compare rewarded vs interstitial leakage?",
    followUps: [
      "Split settled revenue and fraud by country",
      "Is rewarded or interstitial more exposed to fraud?",
      "What is the trend in fraud rate month over month?",
    ],
    primaryAgent: { id: "rev-opt", name: "Revenue Optimization Agent", icon: "dollar" },
    work: {
      summary:
        "Reconciled reported vs settled ad revenue across channels, formats, countries and months, then corroborated against the raw 485.7K-row impression log. $7.2K (6.7%) is clawed back as invalid traffic, concentrated on Vungle (16.4%), AdMob and Moloco (12.8%); rewarded and interstitial leak at near-identical rates; the blended rate is flat over time.",
      queries: [
        {
          sql: "SELECT channel, ROUND(SUM(reported_revenue),0) AS reported, ROUND(SUM(settled_revenue),0) AS settled, ROUND(SUM(fraud_loss),0) AS fraud_loss, ROUND(100.0*SUM(fraud_loss)/SUM(reported_revenue),1) AS fraud_pct FROM monthly_revenue_summary GROUP BY channel ORDER BY fraud_pct DESC",
          description: "Reported vs settled ad revenue and fraud rate by channel",
          rowCount: 5,
          executionTimeMs: 388,
          columns: ["channel", "reported", "settled", "fraud_loss", "fraud_pct"],
        },
        {
          sql: "SELECT ROUND(SUM(reported_revenue),0) AS reported, ROUND(SUM(settled_revenue),0) AS settled, ROUND(SUM(fraud_loss),0) AS fraud_loss, ROUND(100.0*SUM(fraud_loss)/SUM(reported_revenue),1) AS fraud_pct, ROUND(SUM(net_revenue),0) AS net FROM monthly_revenue_summary",
          description: "Book-wide reported, settled, net revenue and blended fraud rate",
          rowCount: 1,
          executionTimeMs: 264,
          columns: ["reported", "settled", "fraud_loss", "fraud_pct", "net"],
        },
        {
          sql: "SELECT ad_format, ROUND(SUM(reported_revenue),0) AS reported, ROUND(SUM(fraud_loss),0) AS fraud_loss, ROUND(100.0*SUM(fraud_loss)/SUM(reported_revenue),1) AS fraud_pct FROM monthly_revenue_summary GROUP BY ad_format ORDER BY fraud_pct DESC",
          description: "Fraud exposure split by ad format (rewarded vs interstitial)",
          rowCount: 2,
          executionTimeMs: 297,
          columns: ["ad_format", "reported", "fraud_loss", "fraud_pct"],
        },
        {
          sql: "SELECT channel, COUNT(*) AS impressions, ROUND(100.0*AVG(fraud_rate),1) AS avg_fraud_rate, ROUND(100.0*SUM(settled_revenue)/SUM(revenue),1) AS settle_pct FROM ad_impression_events GROUP BY channel ORDER BY avg_fraud_rate DESC",
          description: "Raw impression-log corroboration: per-impression fraud rate and settled share by channel",
          rowCount: 5,
          executionTimeMs: 1840,
          columns: ["channel", "impressions", "avg_fraud_rate", "settle_pct"],
        },
        {
          sql: "SELECT country, ROUND(SUM(reported_revenue),0) AS reported, ROUND(SUM(settled_revenue),0) AS settled, ROUND(SUM(fraud_loss),0) AS fraud_loss, ROUND(100.0*SUM(fraud_loss)/SUM(reported_revenue),1) AS fraud_pct FROM monthly_revenue_summary GROUP BY country ORDER BY fraud_loss DESC LIMIT 8",
          description: "Fraud loss and rate split by country, ranked by absolute loss",
          rowCount: 8,
          executionTimeMs: 421,
          columns: ["country", "reported", "settled", "fraud_loss", "fraud_pct"],
        },
        {
          sql: "WITH m AS (SELECT strftime(month,'%Y-%m') AS mo, SUM(reported_revenue) AS rep, SUM(fraud_loss) AS fl FROM monthly_revenue_summary GROUP BY 1) SELECT mo AS month, ROUND(rep,0) AS reported, ROUND(100.0*fl/rep,1) AS fraud_pct, ROUND(100.0*fl/rep - LAG(100.0*fl/rep) OVER (ORDER BY mo),1) AS mom_chg_pts FROM m ORDER BY mo",
          description: "Month-over-month blended fraud rate with LAG change",
          rowCount: 7,
          executionTimeMs: 396,
          columns: ["month", "reported", "fraud_pct", "mom_chg_pts"],
        },
      ],
    },
  }),
];

const deepChats: StarterChat[] = [
  deepResearchThread({
    slug: "ua-budget-leak",
    title: "Where is our paid UA budget leaking?",
    question:
      "Walk through our entire paid UA book and tell me exactly where the budget is leaking. Which channel x country pockets are below break-even, how much is at stake, and where should I reallocate?",
    report:
      "# Where the paid UA budget is leaking\n\n**Bottom line: $25.2K of $67.7K paid spend (37.2%) is going to channel x country pockets that return less than $1.00 on the dollar at D90** [rev-opt:Q1]. The leak is not one bad channel, it is good channels pointed at the wrong countries. Cutting every below-break-even pocket recovers roughly $9.2K of net loss with no change to the profitable book [rev-opt:Q2].\n\n## Executive summary\n\nThe paid book looks healthy in aggregate at 1.27x blended D90 ROAS, but that single number is the average of a profitable Tier-1 core and a large, structurally unprofitable tail [daily-metrics:Q1]. Twenty-eight distinct channel x country pockets sit below break-even, and they are not random noise: they cluster in two recognizable shapes. The first is expensive Tier-1 geos where the CPI is simply too high for the LTV to ever catch (Germany, France). The second is cheap-CPI emerging markets that look efficient on cost but monetize at a fraction of Tier-1 rates (India, Brazil, Mexico, Indonesia). Both shapes lose money, and together they explain almost the entire leak. The good news is that the waste is concentrated enough that a short list of pauses reclaims most of it, and the destination for the reclaimed budget is unambiguous: the US, where every channel pays back at 1.6x or better with headroom to spend more.\n\n## Methodology and data note\n\nAll ROAS figures are install-weighted projected D90 LTV divided by UA spend, computed at the channel x country grain from payback_analysis and excluding organic [rev-opt:Q1] [geographic:Q1]. The LTV projection behind every verdict has been back-tested: across 7 install months, modeled D30 LTV tracks actuals at a 0.98 mean accuracy ratio [data-quality:Q1]. The model was noisier in the first three months of the dataset (accuracy swung between 0.82 and 1.18) but has tightened to within 1 to 3 percent every month since November [data-quality:Q2], so recent verdicts rest on a stable forecast. We also confirmed the leak is a monetization-and-retention problem rather than a fraud or ad-quality artifact: install-level engagement tier and invalid-traffic rates are nearly identical between leak geos and profit geos [user-segmentation:Q1].\n\n## Paid book at a glance\n\n| Metric | Value |\n|---|---:|\n| Total paid UA spend | $67,662 |\n| Paid installs | 19,498 |\n| Blended CPI | $3.47 |\n| Blended D90 ROAS | **1.27x** |\n| Below-break-even pockets | 28 |\n| Spend below break-even (D90 ROAS < 1.0) | **$25,166 (37.2%)** |\n| Net loss recoverable by cutting them | **$9,234** |\n\nThe blended 1.27x hides a split book: profitable Tier-1 pockets are subsidizing a large tail of unprofitable spend [daily-metrics:Q1] [rev-opt:Q1].\n\n## How the book got here: the spend ramp\n\n| Install month | Spend | Installs | Blended D90 ROAS |\n|---|---:|---:|---:|\n| 2025-08 | $5,247 | 1,798 | 1.57x |\n| 2025-09 | $8,043 | 2,447 | 1.42x |\n| 2025-10 | $9,606 | 2,864 | 1.32x |\n| 2025-11 | $12,708 | 3,582 | 1.26x |\n| 2025-12 | $15,860 | 4,156 | **1.13x** |\n| 2026-01 | $8,591 | 2,476 | 1.20x |\n| 2026-02 | $7,608 | 2,175 | 1.22x |\n\nThe leak is partly a scaling story. Spend tripled from August to December while blended ROAS decayed from 1.57x to 1.13x, the classic signature of pushing budget past the efficient frontier into weaker inventory [daily-metrics:Q2]. The January and February pullback (spend roughly halved) coincided with ROAS recovering toward 1.2x, which is consistent with the marginal December dollars having been the worst [daily-metrics:Q2].\n\n## The leak, ranked by dollars at stake (channel x country)\n\n| Channel | Country | Spend | Installs | D90 ROAS | Cum. leak share | Verdict |\n|---|---|---:|---:|---:|---:|---|\n| Facebook | DE | $5,925 | 607 | 0.60x | 23.5% | Cut or rework |\n| AdMob | DE | $2,126 | 283 | 0.59x | 32.0% | Cut |\n| Facebook | BR | $2,109 | 1,202 | 0.62x | 40.4% | Cut |\n| Facebook | FR | $1,616 | 303 | 0.76x | 46.8% | Cap |\n| Facebook | IN | $1,349 | 1,807 | 0.59x | 52.2% | Cut |\n| Vungle | DE | $1,262 | 321 | 0.49x | 57.2% | Cut |\n| Vungle | GB | $1,120 | 325 | 0.92x | 61.6% | Watch |\n| Facebook | MX | $1,027 | 511 | 0.54x | 65.7% | Cut |\n\nThe cumulative-share column shows how concentrated the waste is: the top eight pockets account for roughly two thirds of all leaked spend [rev-opt:Q3]. Germany is the single most expensive mistake. Across all four channels, DE absorbs $10.2K of spend at a 0.57x blended return, of which $9.3K sits in the three pockets above $1K [geographic:Q1] [geographic:Q4]. India and Brazil on Facebook are the next worst, buying volume that monetizes at roughly 60 cents on the dollar [geographic:Q1].\n\n## The Germany deep-dive\n\n| Channel | Spend | Installs | CPI | D90 ROAS |\n|---|---:|---:|---:|---:|\n| Facebook | $5,925 | 607 | $9.76 | 0.60x |\n| AdMob | $2,126 | 283 | $7.51 | 0.59x |\n| Vungle | $1,262 | 321 | $3.93 | 0.49x |\n| Moloco | $922 | 147 | $6.27 | 0.52x |\n\nGermany loses money on every channel, and the reason is the CPI, not the user. A $9.76 Facebook CPI in DE is 37% above the $7.14 the same channel pays in the US, yet DE LTV is less than half of US LTV [geographic:Q4] [geographic:Q2]. This is a market-fit problem, not a bidding problem: no realistic bid reduction closes a gap that large.\n\n## Where the same dollars should go (the profitable pockets)\n\n| Channel | Country | Spend | CPI | D90 ROAS |\n|---|---|---:|---:|---:|\n| Facebook | US | $16,047 | $7.14 | **2.00x** |\n| AdMob | US | $5,284 | $5.36 | **2.02x** |\n| Vungle | US | $2,995 | $2.85 | **1.67x** |\n| Moloco | US | $2,278 | $4.41 | **1.84x** |\n| Facebook | Others | $1,374 | $2.19 | 1.48x |\n\nEvery US pocket clears 1.6x or better [geographic:Q2]. The US is not saturated at current spend: AdMob US at 2.02x and Moloco US at 1.84x are both under-funded relative to their return [geographic:Q2].\n\n## Why the cheap geos leak: a retention story\n\nThe four below-break-even cheap geos are not buying low-quality users at the install level. They retain them far worse downstream. Across all channels, countries that pay back retain 22.7% of installs at D30, while the leak countries retain just 10.9%, less than half [cohort-retention:Q1]. Combined with thinner per-user monetization, that halved retention is the mechanical reason a $0.58 CPI in India still returns only $0.33 [geographic:Q1]. Buying a cheaper install does nothing if it churns in the first week.\n\n## Data trust check\n\nThe payback model these verdicts rely on has been accurate within 2% on average: across 7 install months, modeled D30 LTV tracks actuals at a 0.98 mean accuracy ratio, so the ROAS calls are not resting on a drifting forecast [data-quality:Q1]. The month-by-month detail shows the early-period noise has resolved, and the four months that matter most for current decisions (November through February) are all within 3% [data-quality:Q2].\n\n## Key Findings\n\n1. **37.2% of paid spend ($25.2K) is below break-even** [rev-opt:Q1]. This is the leak, and it is concentrated in 28 pockets whose top eight hold two thirds of the waste [rev-opt:Q3].\n2. **Germany is the worst geo.** $10.2K across four channels at a 0.57x blended return, with $9.3K above the $1K materiality line [geographic:Q1] [geographic:Q4]. Cutting DE recovers the largest single block of wasted budget.\n3. **Cheap-CPI geos are the trap.** Facebook IN (0.59x) and BR (0.62x) buy huge install volume that never monetizes, and the root cause is halved D30 retention (10.9% vs 22.7%) [geographic:Q1] [cohort-retention:Q1].\n4. **The leak is partly a scaling artifact.** Blended ROAS decayed from 1.57x to 1.13x as spend tripled into December, then recovered on the pullback [daily-metrics:Q2].\n5. **The US is the engine and is under-fed.** AdMob US (2.02x) and Moloco US (1.84x) have room to scale before diminishing returns [geographic:Q2].\n6. **It is not a quality or fraud problem.** Leak and profit geos have nearly identical install-level engagement and invalid-traffic rates [user-segmentation:Q1], so the fix is reallocation, not better targeting.\n\n## Risks and caveats\n\n- **ROAS is projected, not fully observed.** February cohorts in particular are young; their D90 figures lean on the model, which carries roughly 2% average error and was materially noisier before November [data-quality:Q1] [data-quality:Q2].\n- **Cutting volume can raise blended CPI elsewhere.** Pausing cheap-geo volume removes low-cost installs from the blend, so the headline CPI will rise even though profitability improves. Judge the cut on profit, not on CPI.\n- **The Vungle GB and FR pockets are close calls.** At 0.92x and 0.76x they may respond to creative or bid changes rather than a hard cut [geographic:Q1].\n\n## Recommended Actions\n\n1. **Pause Facebook DE, AdMob DE, Vungle DE, Moloco DE, Facebook IN, Facebook BR, Facebook MX.** That reclaims roughly $14.7K currently returning under break-even [rev-opt:Q3] [geographic:Q4].\n2. **Reallocate the reclaimed budget into AdMob US and Moloco US first** (highest ROAS with headroom), then Facebook US [geographic:Q2].\n3. **Cap Facebook FR and watch Vungle GB** rather than cutting outright; both are close to break-even and may respond to creative or bid changes [geographic:Q1].\n4. **Hold a spend ceiling per month per channel,** since the December over-scale shows marginal ROAS decays sharply past roughly $13K of monthly paid spend on this book [daily-metrics:Q2].\n5. **Set a hard 1.0x D90 ROAS floor per channel x country** and route the weekly Scout to flag any pocket that drops below it.\n\n```sql\n-- Channel x country pockets, ranked by leaked spend (D90 ROAS < 1.0)\nWITH pocket AS (\n  SELECT\n    channel,\n    country,\n    SUM(ua_spend)                                AS spend,\n    SUM(installs)                                AS installs,\n    SUM(ua_spend) / SUM(installs)                AS cpi,\n    SUM(d90_ltv * installs) / SUM(ua_spend)      AS roas_d90\n  FROM payback_analysis\n  WHERE channel <> 'organic'\n  GROUP BY channel, country\n)\nSELECT\n  channel,\n  country,\n  ROUND(spend, 0)                                AS spend,\n  installs,\n  ROUND(cpi, 2)                                  AS cpi,\n  ROUND(roas_d90, 3)                             AS roas_d90,\n  ROUND(100.0 * SUM(spend) OVER (ORDER BY spend DESC ROWS UNBOUNDED PRECEDING)\n        / SUM(spend) OVER (), 1)                 AS cum_leak_share\nFROM pocket\nWHERE roas_d90 < 1.0 AND spend > 1000\nORDER BY spend DESC;\n```",
    work: {
      "daily-metrics": {
        summary:
          "Sized the paid book ($67.7K spend, 19,498 installs, $3.47 CPI, 1.27x blended D90 ROAS) and traced the monthly spend ramp. The healthy blended number masks a split book, and ROAS decayed from 1.57x to 1.13x as spend tripled into December before recovering on the pullback.",
        queries: [
          {
            sql: "SELECT ROUND(SUM(ua_spend),0) AS spend, SUM(installs) AS installs, ROUND(SUM(ua_spend)/SUM(installs),2) AS cpi, ROUND(SUM(d90_ltv*installs)/SUM(ua_spend),2) AS roas_d90 FROM payback_analysis WHERE channel <> 'organic'",
            description: "Paid book totals: spend, installs, blended CPI and D90 ROAS",
            rowCount: 1,
            executionTimeMs: 341,
            columns: ["spend", "installs", "cpi", "roas_d90"],
          },
          {
            sql: "WITH m AS (SELECT install_month, SUM(ua_spend) AS spend, SUM(installs) AS inst, SUM(d90_ltv*installs)/SUM(ua_spend) AS roas FROM payback_analysis WHERE channel<>'organic' GROUP BY install_month) SELECT install_month, ROUND(spend,0) AS spend, inst AS installs, ROUND(roas,2) AS roas_d90, ROUND(spend - LAG(spend) OVER (ORDER BY install_month),0) AS spend_mom FROM m ORDER BY install_month",
            description: "Monthly paid spend, installs and blended ROAS with month-over-month spend delta",
            rowCount: 7,
            executionTimeMs: 472,
            columns: ["install_month", "spend", "installs", "roas_d90", "spend_mom"],
          },
          {
            sql: "SELECT channel, ROUND(SUM(ua_spend),0) AS spend, ROUND(SUM(ua_spend)/SUM(installs),2) AS cpi, ROUND(SUM(d90_ltv*installs)/SUM(ua_spend),2) AS roas_d90, RANK() OVER (ORDER BY SUM(d90_ltv*installs)/SUM(ua_spend) DESC) AS roas_rank FROM payback_analysis WHERE channel<>'organic' GROUP BY channel ORDER BY roas_rank",
            description: "Blended CPI vs D90 ROAS by channel, ranked",
            rowCount: 4,
            executionTimeMs: 388,
            columns: ["channel", "spend", "cpi", "roas_d90", "roas_rank"],
          },
        ],
      },
      "rev-opt": {
        summary:
          "Quantified the leak: $25,166 of $67,662 paid spend (37.2%) sits in 28 pockets returning under 1.0x at D90. Cutting them recovers $9,234 of net loss, and the top eight pockets hold two thirds of the waste.",
        queries: [
          {
            sql: "WITH p AS (SELECT channel,country,SUM(ua_spend) AS spend, SUM(d90_ltv*installs)/SUM(ua_spend) AS roas FROM payback_analysis WHERE channel<>'organic' GROUP BY channel,country) SELECT ROUND(SUM(CASE WHEN roas<1 THEN spend END),0) AS leaked, ROUND(SUM(spend),0) AS total, ROUND(100.0*SUM(CASE WHEN roas<1 THEN spend END)/SUM(spend),1) AS pct FROM p",
            description: "Total leaked spend and share of book below 1.0x D90 ROAS",
            rowCount: 1,
            executionTimeMs: 433,
            columns: ["leaked", "total", "pct"],
          },
          {
            sql: "WITH p AS (SELECT channel,country,SUM(ua_spend) AS spend, SUM(d90_ltv*installs) AS ltv, SUM(d90_ltv*installs)/SUM(ua_spend) AS roas FROM payback_analysis WHERE channel<>'organic' GROUP BY channel,country) SELECT ROUND(SUM(spend) FILTER(WHERE roas<1),0) AS leaked_spend, ROUND(SUM(ltv) FILTER(WHERE roas<1),0) AS leaked_ltv_return, ROUND(SUM(spend-ltv) FILTER(WHERE roas<1),0) AS net_loss_recovered, COUNT(*) FILTER(WHERE roas<1) AS pockets FROM p",
            description: "Recoverable net loss and pocket count from cutting every sub-1.0x channel x country cell",
            rowCount: 1,
            executionTimeMs: 506,
            columns: ["leaked_spend", "leaked_ltv_return", "net_loss_recovered", "pockets"],
          },
          {
            sql: "WITH p AS (SELECT channel,country,SUM(ua_spend) AS spend, SUM(d90_ltv*installs)/SUM(ua_spend) AS roas FROM payback_analysis WHERE channel<>'organic' GROUP BY channel,country) SELECT channel,country, ROUND(spend,0) AS spend, ROUND(roas,2) AS roas_d90, ROUND(100.0*SUM(spend) OVER (ORDER BY spend DESC ROWS UNBOUNDED PRECEDING)/SUM(spend) OVER (),1) AS cum_leak_share FROM p WHERE roas<1 ORDER BY spend DESC LIMIT 10",
            description: "Below-break-even pocket leaderboard with running cumulative leak share",
            rowCount: 10,
            executionTimeMs: 588,
            columns: ["channel", "country", "spend", "roas_d90", "cum_leak_share"],
          },
        ],
      },
      geographic: {
        summary:
          "Mapped every channel x country pocket and rolled it up by country. Eight pockets above $1K sit below break-even (DE the worst at $10.2K across four channels); every US pocket clears 1.6x with headroom; DE loses on CPI, not user quality.",
        queries: [
          {
            sql: "SELECT channel, country, ROUND(SUM(ua_spend),0) AS spend, SUM(installs) AS installs, ROUND(SUM(d90_ltv*installs)/SUM(ua_spend),2) AS roas_d90 FROM payback_analysis WHERE channel<>'organic' GROUP BY channel,country HAVING SUM(d90_ltv*installs)/SUM(ua_spend)<1 AND SUM(ua_spend)>1000 ORDER BY spend DESC",
            description: "Below-break-even channel x country pockets above $1K spend",
            rowCount: 8,
            executionTimeMs: 487,
            columns: ["channel", "country", "spend", "installs", "roas_d90"],
          },
          {
            sql: "SELECT channel, country, ROUND(SUM(ua_spend),0) AS spend, ROUND(SUM(ua_spend)/SUM(installs),2) AS cpi, ROUND(SUM(d90_ltv*installs)/SUM(ua_spend),2) AS roas_d90 FROM payback_analysis WHERE channel<>'organic' GROUP BY channel,country HAVING SUM(d90_ltv*installs)/SUM(ua_spend)>=1.4 ORDER BY roas_d90 DESC",
            description: "Profitable reallocation targets (D90 ROAS >= 1.4x)",
            rowCount: 5,
            executionTimeMs: 421,
            columns: ["channel", "country", "spend", "cpi", "roas_d90"],
          },
          {
            sql: "SELECT country, ROUND(SUM(ua_spend),0) AS spend, SUM(installs) AS installs, ROUND(SUM(ua_spend)/SUM(installs),2) AS cpi, ROUND(SUM(d90_ltv*installs)/SUM(ua_spend),2) AS roas_d90, CASE WHEN SUM(d90_ltv*installs)/SUM(ua_spend)>=1 THEN 'profit' ELSE 'leak' END AS verdict FROM payback_analysis WHERE channel<>'organic' GROUP BY country ORDER BY spend DESC",
            description: "Country roll-up across all paid channels with profit/leak verdict",
            rowCount: 10,
            executionTimeMs: 451,
            columns: ["country", "spend", "installs", "cpi", "roas_d90", "verdict"],
          },
          {
            sql: "SELECT channel, ROUND(SUM(ua_spend),0) AS spend, SUM(installs) AS installs, ROUND(SUM(ua_spend)/SUM(installs),2) AS cpi, ROUND(SUM(d90_ltv*installs)/SUM(ua_spend),2) AS roas_d90 FROM payback_analysis WHERE country='DE' AND channel<>'organic' GROUP BY channel ORDER BY spend DESC",
            description: "Germany deep-dive: CPI and D90 ROAS by channel",
            rowCount: 4,
            executionTimeMs: 364,
            columns: ["channel", "spend", "installs", "cpi", "roas_d90"],
          },
        ],
      },
      "cohort-retention": {
        summary:
          "Tested why the cheap geos leak. Countries that pay back retain 22.7% of installs at D30 versus just 10.9% for the leak countries, so halved retention, not cheap installs, is the mechanical cause of sub-1.0x ROAS.",
        queries: [
          {
            sql: "WITH roas AS (SELECT country, SUM(d90_ltv*installs)/SUM(ua_spend) AS r FROM payback_analysis WHERE channel<>'organic' GROUP BY country), ret AS (SELECT country, SUM(d30_active)*1.0/SUM(cohort_size) AS d30 FROM cohort_retention_actuals GROUP BY country) SELECT CASE WHEN roas.r>=1 THEN 'pays back' ELSE 'leaks' END AS bucket, COUNT(*) AS countries, ROUND(100.0*AVG(ret.d30),1) AS avg_d30_ret FROM roas JOIN ret USING(country) GROUP BY 1 ORDER BY 1",
            description: "Average D30 retention for paying-back vs leaking countries (ROAS joined to retention)",
            rowCount: 2,
            executionTimeMs: 524,
            columns: ["bucket", "countries", "avg_d30_ret"],
          },
        ],
      },
      "user-segmentation": {
        summary:
          "Ruled out a quality explanation for the leak. Profit geos and leak geos have nearly identical install-level high-engagement share (25.9% vs 25.3%) and new-targeting penetration, so the leak is reallocation-fixable, not a targeting failure.",
        queries: [
          {
            sql: "SELECT CASE WHEN country IN ('US','GB','CA','others') THEN 'profit_geo' ELSE 'leak_geo' END AS bucket, COUNT(*) AS installs, ROUND(100.0*COUNT(*) FILTER(WHERE engagement_tier='high')/COUNT(*),1) AS high_pct, ROUND(100.0*COUNT(*) FILTER(WHERE is_new_targeting)/COUNT(*),1) AS new_targeting_pct FROM installs WHERE channel<>'organic' GROUP BY 1",
            description: "Install-level engagement tier and new-targeting share, profit geos vs leak geos",
            rowCount: 2,
            executionTimeMs: 612,
            columns: ["bucket", "installs", "high_pct", "new_targeting_pct"],
          },
        ],
      },
      "data-quality": {
        summary:
          "Validated the LTV model behind the ROAS verdicts: across 7 install months modeled D30 LTV tracks actuals at a 0.98 mean accuracy ratio. Early months (Aug to Oct) were noisier (0.82 to 1.18) but the last four months are within 1 to 3 percent.",
        queries: [
          {
            sql: "SELECT ROUND(AVG(accuracy_ratio),2) AS avg_accuracy, COUNT(*) AS months FROM ltv_model_accuracy",
            description: "Mean LTV-model accuracy ratio across all install months",
            rowCount: 1,
            executionTimeMs: 233,
            columns: ["avg_accuracy", "months"],
          },
          {
            sql: "SELECT install_month, ROUND(actual_d30_ltv,2) AS actual_d30_ltv, ROUND(model_d30_ltv,2) AS model_d30_ltv, accuracy_ratio, ROUND(100.0*(model_d30_ltv-actual_d30_ltv)/actual_d30_ltv,1) AS model_bias_pct FROM ltv_model_accuracy ORDER BY install_month",
            description: "Per-month actual vs modeled D30 LTV, accuracy ratio and signed model bias",
            rowCount: 7,
            executionTimeMs: 298,
            columns: ["install_month", "actual_d30_ltv", "model_d30_ltv", "accuracy_ratio", "model_bias_pct"],
          },
        ],
      },
    },
    followUps: [
      "How much profit do I recover if I cut every sub-1.0x pocket?",
      "Does Germany ever pay back if I extend to D180?",
      "How much more can I push into AdMob US before ROAS drops?",
      "Build me a Scout that flags any channel x country below 1.0x",
    ],
  }),
  deepResearchThread({
    slug: "d7-retention-dip",
    title: "Why did D7 retention dip last month?",
    question:
      "Our D7 retention dropped in February. Tear it down: is it a channel-mix problem, a single bad source, or something systemic? I need to know whether to worry.",
    report:
      "# Why D7 retention dipped in February\n\n**Bottom line: D7 fell from 47.0% (Jan) to 36.7% (Feb), a 10.3-point drop, and it is systemic, not a mix shift** [cohort-retention:Q1]. Every channel and every country lost ground in the same month while the channel mix barely moved [cohort-retention:Q2] [cohort-retention:Q3] [geographic:Q1]. That points to a product or release event, not a media-buying problem. The early funnel (day-0 and day-1 behavior) is intact, so the damage is happening in week two, which narrows the suspect list considerably [daily-metrics:Q2].\n\n## Executive summary\n\nFebruary's D7 retention is the lowest in the entire dataset, and it landed immediately after January set the dataset's all-time high. The instinctive worry is that we flooded the funnel with cheap, low-retaining traffic, but the data rejects that cleanly: the channel mix in February is within half a point of January on every source, and the drop hits organic users just as hard as paid ones [cohort-retention:Q2] [cohort-retention:Q3]. Organic users are immune to ad-network quality and attribution fraud, so when organic retention falls by the same magnitude as paid, the cause has to be inside the product. We then confirmed that day-0 and day-1 engagement (session length, first-session level reached, D1 active rate) held at completely normal levels in February, which means new users are still landing and engaging fine on arrival. The loss is concentrated in the days after, showing up as a collapse at D14. The shape of all of this is a week-two retention event: something changed in the experience users hit a few days in, or a January live-ops boost ended and February regressed to a worse baseline. The clock to intervene is now, because February's D30 has not yet elapsed and the long-term damage is still unwritten.\n\n## Methodology and data note\n\nRetention is measured from cohort_retention_actuals at the install-month grain, with rates computed as active users divided by cohort size and decomposed by channel and country [cohort-retention:Q1] [cohort-retention:Q3] [geographic:Q1]. We then cross-checked the early funnel against the raw sessions table (161,997 sessions), measuring day-0 session duration, first-session median level, and the D1 active rate per cohort [daily-metrics:Q2]. The mix decomposition isolates rate change from composition change so we can say definitively whether the dip is who we bought or how they behaved [cohort-retention:Q2].\n\n## The dip in context\n\n| Install month | Cohort | D7 | D14 | D30 |\n|---|---:|---:|---:|---:|\n| 2025-10 | 4,419 | 41.6% | 30.5% | 17.2% |\n| 2025-11 | 5,248 | 42.4% | 31.5% | 16.9% |\n| 2025-12 | 5,994 | 42.3% | 31.3% | 17.3% |\n| 2026-01 | 3,932 | **47.0%** | 34.7% | 18.1% |\n| 2026-02 | 3,481 | **36.7%** | **17.1%** | (not elapsed) |\n\nJanuary was the best D7 month in the dataset; February then dropped below every prior month [cohort-retention:Q1]. The D14 column is the alarming part: February D14 is 17.1% versus January's 34.7%, so the curve does not just start lower, it falls off a cliff in week two [cohort-retention:Q4]. D30 for February is still maturing, so the headline alarm is about D7 and D14.\n\n## Is it the channel mix? No.\n\n| Channel | Jan mix | Feb mix |\n|---|---:|---:|\n| Organic | 37.0% | 37.5% |\n| Facebook | 29.0% | 28.5% |\n| Vungle | 15.7% | 14.2% |\n| AdMob | 12.0% | 13.3% |\n| Moloco | 6.2% | 6.5% |\n\nThe mix is essentially identical month over month [cohort-retention:Q2]. We did not flood in more low-quality Vungle traffic. So mix cannot explain a 10-point swing.\n\n## It is across-the-board (every channel fell)\n\n| Channel | Jan D7 | Feb D7 | Change |\n|---|---:|---:|---:|\n| Facebook | 56.6% | 46.6% | **-10.0 pts** |\n| Organic | 51.0% | 39.5% | **-11.5 pts** |\n| AdMob | 41.4% | 33.8% | -7.7 pts |\n| Moloco | 39.3% | 25.8% | **-13.6 pts** |\n| Vungle | 27.0% | 17.5% | -9.5 pts |\n\nOrganic dropping 11.5 points is the smoking gun: organic users are not affected by ad-network quality or attribution fraud, so a drop that hits organic just as hard as paid means the cause is inside the game (a release, a broken onboarding flow, an event that ended, or a store-listing change), not the acquisition funnel [cohort-retention:Q3].\n\n## It is across-the-board by geography too\n\n| Country | Jan cohort | Jan D7 | Feb D7 | Change |\n|---|---:|---:|---:|---:|\n| Others | 316 | 51.6% | 37.1% | -14.5 pts |\n| US | 926 | 61.0% | 47.0% | -14.0 pts |\n| GB | 280 | 56.4% | 44.6% | -11.8 pts |\n| IN | 801 | 33.2% | 24.3% | -9.0 pts |\n| BR | 507 | 40.0% | 32.2% | -7.8 pts |\n| MX | 244 | 32.4% | 28.6% | -3.7 pts |\n\nEvery single country dropped, including the high-value US (-14.0) and the cheap geos (IN, BR, MX) [geographic:Q1]. A cause that touches every channel and every country simultaneously is almost definitionally a global product or store event, not a localized media issue.\n\n## The early funnel is fine, so look at week two\n\n| Install month | Day-0 avg session (min) | First-session median level | D1 active % |\n|---|---:|---:|---:|\n| 2026-01 | 42.0 | 26 | 68.8% |\n| 2026-02 | 41.2 | 26 | 67.1% |\n\nThe first-touch experience in February is normal: session length, the level a new user reaches in their first session, and the day-1 return rate are all within a point of January [daily-metrics:Q2]. Users are still installing, opening, and engaging on day one. The retention loss is therefore not an onboarding break at install. It manifests later, which is exactly what the D14 collapse confirms.\n\n## How abnormal is this, really?\n\n| Install month | Blended D7 | MoM change |\n|---|---:|---:|\n| 2025-10 | 41.6% | -1.7 pts |\n| 2025-11 | 42.4% | +0.8 pts |\n| 2025-12 | 42.3% | -0.1 pts |\n| 2026-01 | 47.0% | +4.7 pts |\n| 2026-02 | 36.7% | -10.2 pts |\n\nNormal month-over-month D7 movement on this book is plus or minus 2 points [cohort-retention:Q5]. January was a +4.7 spike and February a roughly 10-point plunge, both far outside the noise band. That symmetry is a clue: it is plausible that January was the anomaly (a live-ops or seasonal boost) and February is the regression, possibly to a level slightly below the true baseline.\n\n## Key Findings\n\n1. **D7 fell 10.3 points (47.0% to 36.7%) into February** after January set the dataset's high-water mark, the largest single-month move on record [cohort-retention:Q1] [cohort-retention:Q5].\n2. **Channel mix did not change** (organic and Facebook held ~37% and ~29% in both months), so this is not a quality-of-traffic story [cohort-retention:Q2].\n3. **Every channel and every country dropped,** including organic (-11.5) and the US (-14.0), which rules out any ad-network, fraud, or single-geo explanation [cohort-retention:Q3] [geographic:Q1].\n4. **The week-two collapse is the real signal.** February D14 fell to 17.1% from 34.7%, far steeper than the D7 move, so users are churning a few days in, not on arrival [cohort-retention:Q4].\n5. **The early funnel is intact.** Day-0 session length, first-session level, and D1 active rate are all normal in February, localizing the problem to post-onboarding [daily-metrics:Q2].\n6. **D30 for February is not yet elapsed,** so the long-term damage is still unknown [cohort-retention:Q1]. The clock to intervene is now.\n\n## Risks and caveats\n\n- **February is a partial cohort.** D30 has not elapsed, so the full severity is still projecting. Treat the D14 number as the leading indicator, not the final verdict.\n- **The January spike may be the real anomaly.** If a January promo or event inflated retention, the correct baseline is somewhere between the two months, and February may be less catastrophic than the raw delta suggests [cohort-retention:Q5].\n- **This window overlaps the new 5-game targeting test,** which ramped in January and February. That test changes who we buy on Facebook and could interact with the dip, so the retention decomposition should be re-run holding targeting cohort constant before final root-causing.\n\n## Recommended Actions\n\n1. **Treat this as a product incident, not a UA incident.** Pull the February release notes, app-version split, and the day-3 to day-7 funnel before touching media budgets.\n2. **Compare the week-two funnel (D3 to D7 progression) for the Jan vs Feb cohorts** to localize exactly where the drop-off accelerates, since day-0 and day-1 are confirmed clean [daily-metrics:Q2] [cohort-retention:Q4].\n3. **Check the live-ops calendar:** if a January event or promo ended, the Jan spike may be the anomaly and Feb the regression to a worse-than-normal baseline [cohort-retention:Q5].\n4. **Hold UA spend flat on Facebook and organic** (still the healthiest sources) while the root cause is isolated, rather than cutting blind.\n\n```sql\n-- Decompose the Jan -> Feb D7 move: per-channel rate change vs mix change\nWITH m AS (\n  SELECT\n    install_month,\n    channel,\n    SUM(cohort_size)                                                   AS cohort,\n    SUM(d7_active) * 1.0 / SUM(cohort_size)                            AS d7,\n    SUM(cohort_size) * 1.0\n      / SUM(SUM(cohort_size)) OVER (PARTITION BY install_month)        AS mix\n  FROM cohort_retention_actuals\n  WHERE install_month IN ('2026-01', '2026-02')\n  GROUP BY install_month, channel\n)\nSELECT\n  jan.channel,\n  ROUND(jan.d7, 4)                AS jan_d7,\n  ROUND(feb.d7, 4)                AS feb_d7,\n  ROUND(feb.d7 - jan.d7, 4)       AS d7_change,\n  ROUND(jan.mix, 3)               AS jan_mix,\n  ROUND(feb.mix, 3)               AS feb_mix\nFROM m jan\nJOIN m feb\n  ON jan.channel = feb.channel\n WHERE jan.install_month = '2026-01' AND feb.install_month = '2026-02'\nORDER BY d7_change ASC;\n```",
    work: {
      "cohort-retention": {
        summary:
          "Traced the February D7 dip end to end. D7 fell 10.3 points off a January peak (the largest move in a book that normally swings under 2 points), the channel mix held flat, every channel dropped 8 to 14 points including organic, and D14 collapsed to 17.1%, which fingers a week-two product event over a media problem.",
        queries: [
          {
            sql: "SELECT install_month, SUM(cohort_size) AS cohort, ROUND(100.0*SUM(d7_active)/SUM(cohort_size),1) AS d7, ROUND(100.0*SUM(d30_active)/SUM(cohort_size),1) AS d30 FROM cohort_retention_actuals GROUP BY install_month ORDER BY install_month",
            description: "Monthly D7 and D30 retention trend across all install cohorts",
            rowCount: 7,
            executionTimeMs: 356,
            columns: ["install_month", "cohort", "d7", "d30"],
          },
          {
            sql: "SELECT install_month, channel, SUM(cohort_size) AS cohort, ROUND(100.0*SUM(cohort_size)/SUM(SUM(cohort_size)) OVER (PARTITION BY install_month),1) AS mix_pct FROM cohort_retention_actuals WHERE install_month IN ('2026-01','2026-02') GROUP BY install_month, channel ORDER BY install_month, mix_pct DESC",
            description: "Channel mix share for January vs February cohorts",
            rowCount: 10,
            executionTimeMs: 402,
            columns: ["install_month", "channel", "cohort", "mix_pct"],
          },
          {
            sql: "WITH m AS (SELECT install_month, channel, SUM(d7_active)*1.0/SUM(cohort_size) AS d7 FROM cohort_retention_actuals WHERE install_month IN ('2026-01','2026-02') GROUP BY install_month,channel) SELECT j.channel, ROUND(100*j.d7,1) AS jan_d7, ROUND(100*f.d7,1) AS feb_d7, ROUND(100*(f.d7-j.d7),1) AS chg FROM m j JOIN m f ON j.channel=f.channel WHERE j.install_month='2026-01' AND f.install_month='2026-02' ORDER BY chg",
            description: "Per-channel D7 change from January to February",
            rowCount: 5,
            executionTimeMs: 468,
            columns: ["channel", "jan_d7", "feb_d7", "chg"],
          },
          {
            sql: "SELECT install_month, SUM(cohort_size) AS cohort, ROUND(100.0*SUM(d7_active)/SUM(cohort_size),1) AS d7, ROUND(100.0*SUM(d14_active)/SUM(cohort_size),1) AS d14, ROUND(100.0*SUM(d30_active)/SUM(cohort_size),1) AS d30 FROM cohort_retention_actuals GROUP BY install_month ORDER BY install_month",
            description: "Full D7/D14/D30 retention curve by month, exposing the February D14 collapse",
            rowCount: 7,
            executionTimeMs: 411,
            columns: ["install_month", "cohort", "d7", "d14", "d30"],
          },
          {
            sql: "WITH m AS (SELECT install_month, SUM(d7_active)*1.0/SUM(cohort_size) AS d7 FROM cohort_retention_actuals GROUP BY install_month) SELECT install_month, ROUND(100*d7,1) AS d7, ROUND(100*(d7-LAG(d7) OVER (ORDER BY install_month)),1) AS mom_pts FROM m ORDER BY install_month",
            description: "Blended D7 month-over-month change via LAG, showing the Feb move sits far outside the normal noise band",
            rowCount: 7,
            executionTimeMs: 377,
            columns: ["install_month", "d7", "mom_pts"],
          },
        ],
      },
      geographic: {
        summary:
          "Confirmed the dip is geographically systemic. Every country lost D7 retention from January to February, from -3.7 points (MX) to -14.5 points (Others), including the high-value US at -14.0, so no single market explains it.",
        queries: [
          {
            sql: "WITH m AS (SELECT install_month, country, SUM(d7_active)*1.0/SUM(cohort_size) AS d7, SUM(cohort_size) AS c FROM cohort_retention_actuals WHERE install_month IN ('2026-01','2026-02') GROUP BY install_month,country) SELECT j.country, j.c AS jan_cohort, ROUND(100*j.d7,1) AS jan_d7, ROUND(100*f.d7,1) AS feb_d7, ROUND(100*(f.d7-j.d7),1) AS chg FROM m j JOIN m f ON j.country=f.country WHERE j.install_month='2026-01' AND f.install_month='2026-02' ORDER BY chg",
            description: "Per-country D7 change from January to February",
            rowCount: 10,
            executionTimeMs: 543,
            columns: ["country", "jan_cohort", "jan_d7", "feb_d7", "chg"],
          },
        ],
      },
      "daily-metrics": {
        summary:
          "Cross-checked the early funnel against the raw sessions table. Day-0 session length (41.2 min), first-session median level (26), and the D1 active rate (67.1%) are all normal in February, so new users land and engage fine on arrival and the churn is happening later.",
        queries: [
          {
            sql: "SELECT COUNT(*) AS sessions, COUNT(DISTINCT user_id) AS users, MIN(install_month) AS first_month, MAX(install_month) AS last_month FROM sessions",
            description: "Sessions table coverage check (volume, distinct users, month span)",
            rowCount: 1,
            executionTimeMs: 1320,
            columns: ["sessions", "users", "first_month", "last_month"],
          },
          {
            sql: "WITH d1 AS (SELECT install_month, COUNT(DISTINCT user_id) FILTER(WHERE days_from_install BETWEEN 1 AND 2) AS d1_users, COUNT(DISTINCT user_id) AS total FROM sessions GROUP BY install_month) SELECT s.install_month, ROUND(AVG(s.session_duration_mins),1) AS avg_dur_min, ROUND(quantile_cont(s.level_reached,0.5),0) AS median_level, ROUND(100.0*d1.d1_users/d1.total,1) AS d1_active_pct FROM sessions s JOIN d1 USING(install_month) WHERE s.days_from_install=0 GROUP BY s.install_month, d1.d1_users, d1.total ORDER BY s.install_month",
            description: "Day-0 session length, first-session median level and D1 active rate per cohort from raw sessions",
            rowCount: 7,
            executionTimeMs: 4210,
            columns: ["install_month", "avg_dur_min", "median_level", "d1_active_pct"],
          },
        ],
      },
    },
    followUps: [
      "Did D1 retention move the same way as D7?",
      "Which app version shipped in early February?",
      "Was there a live-ops event that ended in January?",
      "Project February D30 if the curve holds its usual shape",
    ],
  }),
  deepResearchThread({
    slug: "channel-payback-curve",
    title: "Which channel actually pays back, and when?",
    question:
      "For each acquisition channel, when does it cross break-even and what does it return by D90? I want to know which channels to scale, which to hold, and how long my cash is tied up before payback.",
    report:
      "# Which channels pay back, and when\n\n**Bottom line: Facebook (1.31x) and AdMob (1.29x) are the only channels that pay back comfortably, and on the blended book no channel breaks even before roughly D42** [rev-opt:Q1] [rev-opt:Q3]. Cash is tied up for about six weeks on the best channels and almost eleven weeks on the worst, so payback patience is a structural cost of this book.\n\n## Executive summary\n\nEvery channel returns about half its cost by D7 and is still underwater at D30, so the question is never whether a channel pays back but when. Interpolating the curve between the observed D30, D60 and D90 points, Facebook and AdMob cross break-even at roughly day 42 and 43, Moloco at day 55, and Vungle not until day 74 [rev-opt:Q3]. The deeper story is that this is fundamentally a retention ranking wearing a ROAS costume: the order of D90 ROAS is exactly the order of D30 retention, with Facebook retaining more than twice as many users at D30 as Vungle [cohort-retention:Q1]. Vungle is the trap on every axis: it has the cheapest CPI, which makes it look attractive on a cost dashboard, but it retains the worst, pays back the latest, returns the least, and loses the most revenue to fraud [rev-opt:Q1] [cohort-retention:Q1] [data-quality:Q1]. Finally, the blended payback timeline is dragged out almost entirely by weak non-US geos: restricted to the US, every channel including Vungle crosses break-even by D30, so the channels are not slow, the cheap geos are [geographic:Q1].\n\n## Methodology and data note\n\nROAS is install-weighted projected LTV over UA spend at each horizon (D7, D30, D60, D90), computed from payback_analysis and excluding organic [rev-opt:Q1]. Break-even days are linearly interpolated between the bracketing observed horizons, which is a conservative approximation since real LTV curves are concave (so true break-even is likely a few days earlier than the linear estimate) [rev-opt:Q3]. Monthly ROAS dispersion is measured as the population standard deviation of each channel's per-month blended ROAS to gauge stability [daily-metrics:Q1].\n\n## The payback curve by channel (ROAS at each horizon)\n\n| Channel | Spend | CPI | D7 | D30 | D60 | D90 | Break-even day |\n|---|---:|---:|---:|---:|---:|---:|---:|\n| Facebook | $40,236 | $4.49 | 0.55x | 0.91x | 1.15x | **1.31x** | ~D42 |\n| AdMob | $13,683 | $3.36 | 0.55x | 0.90x | 1.13x | **1.29x** | ~D43 |\n| Moloco | $5,787 | $2.91 | 0.52x | 0.83x | 1.04x | 1.18x | ~D55 |\n| Vungle | $7,956 | $1.78 | 0.49x | 0.76x | 0.94x | **1.07x** | ~D74 |\n\nRead the curve left to right: by D7 every channel has returned only about half its cost, by D30 still under 1.0x, and only between D42 and D55 do the strong channels cross into profit [rev-opt:Q1] [rev-opt:Q3]. Vungle does not cross until roughly D74 and barely clears 1.07x even at D90 [rev-opt:Q1] [rev-opt:Q3].\n\n## Scale / hold / watch verdict\n\n| Channel | D90 ROAS | Break-even | Verdict | Why |\n|---|---:|---:|---|---|\n| Facebook | 1.31x | ~D42 | **Scale** | Best absolute return, biggest book, proven at $40K |\n| AdMob | 1.29x | ~D43 | **Scale** | Nearly matches Facebook at a lower CPI, room to grow |\n| Moloco | 1.18x | ~D55 | Hold | Profitable but late and small |\n| Vungle | 1.07x | ~D74 | **Watch / trim** | Thinnest payback, latest break-even, worst retention, highest fraud |\n\n## Retention is the real driver\n\n| Channel | D7 retention | D30 retention |\n|---|---:|---:|\n| Facebook | 48.5% | **18.1%** |\n| AdMob | 38.7% | 14.3% |\n| Moloco | 34.9% | 12.7% |\n| Vungle | 26.4% | **8.6%** |\n\nThe D90 ROAS ranking is identical to the D30 retention ranking, and it is not a coincidence: in an ad-funded game, revenue is just retained sessions times ARPDAU, so the channel that keeps users longest earns the most regardless of CPI [cohort-retention:Q1]. Facebook retains 18.1% of installs at D30 versus Vungle's 8.6%, more than double, which is the mechanical reason Facebook pays back almost a month sooner [cohort-retention:Q1].\n\n## The CPI trap\n\nVungle has by far the cheapest CPI ($1.78, less than half of Facebook's $4.49) yet the worst D90 ROAS [rev-opt:Q1]. **Cheap installs are buying low-retaining, low-monetizing users here.** Facebook's installs cost 2.5x more but return ~22% more per dollar [rev-opt:Q1]. Sorting by CPI would lead you to exactly the wrong channel.\n\n## Stability check: are these returns reliable?\n\n| Channel | Avg monthly ROAS | Min month | Max month | Std dev |\n|---|---:|---:|---:|---:|\n| AdMob | 1.35x | 1.15x | 1.67x | 0.18 |\n| Facebook | 1.34x | 1.18x | 1.62x | 0.14 |\n| Moloco | 1.25x | 0.95x | 1.49x | 0.17 |\n| Vungle | 1.09x | 0.98x | 1.28x | 0.10 |\n\nFacebook and AdMob never had a losing month [daily-metrics:Q1]. Moloco and Vungle each dipped below 1.0x in at least one month (0.95x and 0.98x respectively), so their thin average returns are one weak cohort away from underwater [daily-metrics:Q1]. Vungle's low variance is cold comfort: it is consistently mediocre rather than reliably profitable.\n\n## Fraud compounds the Vungle problem\n\nVungle is not just the slowest to pay back, it also loses the most revenue to invalid traffic: 16.4% of its ad revenue is clawed back, versus 5.9% for Facebook [rev-opt:Q2] [data-quality:Q1]. So its thin 1.07x gross return is even thinner net of fraud.\n\n## The blended timeline is a geo artifact\n\n| Channel (US only) | CPI | D30 | D60 | D90 |\n|---|---:|---:|---:|---:|\n| AdMob | $5.36 | **1.37x** | 1.75x | 2.02x |\n| Facebook | $7.14 | **1.35x** | 1.73x | 2.00x |\n| Moloco | $4.41 | 1.26x | 1.60x | 1.84x |\n| Vungle | $2.85 | **1.16x** | 1.46x | 1.67x |\n\nRestricted to the US, every channel is already profitable by D30, including Vungle at 1.16x [geographic:Q1]. The slow blended payback is therefore not a channel-speed problem, it is the weak non-US geos dragging the blended curve out to D42 and beyond. In the US, this is a fast-payback book.\n\n## Key Findings\n\n1. **No channel breaks even before ~D42 on the blended book.** Every channel sits under 1.0x at D30, so any monthly-payback target is structurally unrealistic on the blend [rev-opt:Q1] [rev-opt:Q3].\n2. **Facebook and AdMob are the twin engines** at 1.31x and 1.29x D90, both crossing break-even around D42 to D43, and AdMob does it at a $1.13 lower CPI, suggesting the most untapped headroom [rev-opt:Q1] [rev-opt:Q3].\n3. **Payback rank equals retention rank.** D30 retention (Facebook 18.1% down to Vungle 8.6%) maps one-to-one onto D90 ROAS, so retention is the lever, not CPI [cohort-retention:Q1].\n4. **Vungle is the value trap:** cheapest CPI, latest break-even (~D74), thinnest D90 return (1.07x), worst retention, and the highest ad fraud (16.4%) [rev-opt:Q1] [rev-opt:Q2] [cohort-retention:Q1].\n5. **Facebook and AdMob never had a losing month;** Moloco and Vungle each dipped below 1.0x at least once [daily-metrics:Q1].\n6. **In the US, every channel pays back by D30.** The slow blended timeline is a weak-geo artifact, not a channel-speed problem [geographic:Q1].\n\n## Risks and caveats\n\n- **Break-even days are interpolated, not observed.** Real LTV curves are concave, so the linear estimates are slightly conservative (true break-even is likely a few days earlier) [rev-opt:Q3].\n- **D90 leans on projection for recent cohorts,** so the most recent months' ROAS carries forecast error and could shift as those cohorts mature.\n- **Vungle's blended figure hides a healthy US pocket.** Trimming Vungle wholesale would also cut its 1.67x US business, so the action is geo-surgical, not a channel-wide kill [geographic:Q1].\n\n## Recommended Actions\n\n1. **Scale Facebook and AdMob,** weighting incremental budget toward AdMob first given its lower CPI, near-equal return, and zero losing months [rev-opt:Q1] [daily-metrics:Q1].\n2. **Hold Moloco flat;** it is profitable but late (~D55) and small, and it has already touched a sub-1.0x month [rev-opt:Q3] [daily-metrics:Q1].\n3. **Trim Vungle to its only profitable pocket (US, 1.67x) and watch it weekly;** its blended 1.07x is one bad cohort away from underwater and fraud is eroding it further [rev-opt:Q1] [rev-opt:Q2] [geographic:Q1].\n4. **Plan UA cash flow on a 45- to 55-day payback assumption,** not D30, so the finance model does not over-penalize healthy channels for being structurally slow [rev-opt:Q3].\n\n```sql\n-- Payback curve per channel with interpolated break-even day\nWITH c AS (\n  SELECT\n    channel,\n    SUM(ua_spend)                                AS spend,\n    SUM(ua_spend) / SUM(installs)                AS cpi,\n    SUM(d30_ltv * installs) / SUM(ua_spend)      AS r30,\n    SUM(d60_ltv * installs) / SUM(ua_spend)      AS r60,\n    SUM(d90_ltv * installs) / SUM(ua_spend)      AS r90\n  FROM payback_analysis\n  WHERE channel <> 'organic'\n  GROUP BY channel\n)\nSELECT\n  channel,\n  ROUND(spend, 0)                                AS spend,\n  ROUND(cpi, 2)                                  AS cpi,\n  ROUND(r30, 2)                                  AS roas_d30,\n  ROUND(r60, 2)                                  AS roas_d60,\n  ROUND(r90, 2)                                  AS roas_d90,\n  CASE\n    WHEN r60 >= 1 THEN ROUND(30 + 30 * (1.0 - r30) / (r60 - r30), 0)\n    WHEN r90 >= 1 THEN ROUND(60 + 30 * (1.0 - r60) / (r90 - r60), 0)\n  END                                            AS breakeven_day\nFROM c\nORDER BY r90 DESC;\n```",
    work: {
      "rev-opt": {
        summary:
          "Built the spend-weighted payback curve per channel (D7 to D90), interpolated break-even days, and cross-checked fraud. Facebook (1.31x, ~D42) and AdMob (1.29x, ~D43) pay back fastest; Moloco crosses ~D55 and Vungle not until ~D74; Vungle is the cheapest CPI but the worst return and highest fraud.",
        queries: [
          {
            sql: "SELECT channel, ROUND(SUM(ua_spend),0) AS spend, ROUND(SUM(ua_spend)/SUM(installs),2) AS cpi, ROUND(SUM(d7_ltv*installs)/SUM(ua_spend),2) AS roas_d7, ROUND(SUM(d30_ltv*installs)/SUM(ua_spend),2) AS roas_d30, ROUND(SUM(d60_ltv*installs)/SUM(ua_spend),2) AS roas_d60, ROUND(SUM(d90_ltv*installs)/SUM(ua_spend),2) AS roas_d90 FROM payback_analysis WHERE channel<>'organic' GROUP BY channel ORDER BY roas_d90 DESC",
            description: "Spend-weighted ROAS at D7/D30/D60/D90 per paid channel",
            rowCount: 4,
            executionTimeMs: 514,
            columns: [
              "channel",
              "spend",
              "cpi",
              "roas_d7",
              "roas_d30",
              "roas_d60",
              "roas_d90",
            ],
          },
          {
            sql: "SELECT channel, ROUND(SUM(reported_revenue),0) AS reported, ROUND(100.0*SUM(fraud_loss)/SUM(reported_revenue),1) AS fraud_pct FROM monthly_revenue_summary WHERE channel<>'organic' GROUP BY channel ORDER BY fraud_pct DESC",
            description: "Ad-revenue fraud rate per paid channel (compounds Vungle's thin payback)",
            rowCount: 4,
            executionTimeMs: 331,
            columns: ["channel", "reported", "fraud_pct"],
          },
          {
            sql: "WITH c AS (SELECT channel, SUM(d30_ltv*installs)/SUM(ua_spend) AS r30, SUM(d60_ltv*installs)/SUM(ua_spend) AS r60, SUM(d90_ltv*installs)/SUM(ua_spend) AS r90 FROM payback_analysis WHERE channel<>'organic' GROUP BY channel) SELECT channel, ROUND(r30,2) AS roas_d30, ROUND(r60,2) AS roas_d60, ROUND(r90,2) AS roas_d90, CASE WHEN r60>=1 THEN ROUND(30 + 30*(1.0-r30)/(r60-r30),0) WHEN r90>=1 THEN ROUND(60 + 30*(1.0-r60)/(r90-r60),0) ELSE NULL END AS breakeven_day FROM c ORDER BY r90 DESC",
            description: "Interpolated break-even day per channel from the D30/D60/D90 ROAS points",
            rowCount: 4,
            executionTimeMs: 462,
            columns: ["channel", "roas_d30", "roas_d60", "roas_d90", "breakeven_day"],
          },
        ],
      },
      "cohort-retention": {
        summary:
          "Showed payback rank equals retention rank. D30 retention runs Facebook 18.1%, AdMob 14.3%, Moloco 12.7%, Vungle 8.6%, exactly the D90 ROAS order, confirming retention (not CPI) is the lever.",
        queries: [
          {
            sql: "SELECT channel, SUM(cohort_size) AS cohort, ROUND(100.0*SUM(d7_active)/SUM(cohort_size),1) AS d7_ret, ROUND(100.0*SUM(d30_active)/SUM(cohort_size),1) AS d30_ret FROM cohort_retention_actuals WHERE channel<>'organic' GROUP BY channel ORDER BY d30_ret DESC",
            description: "D7 and D30 retention by paid channel, the driver behind the payback ranking",
            rowCount: 4,
            executionTimeMs: 388,
            columns: ["channel", "cohort", "d7_ret", "d30_ret"],
          },
        ],
      },
      "daily-metrics": {
        summary:
          "Measured per-month ROAS dispersion. Facebook (std 0.14) and AdMob (0.18) never had a losing month; Moloco dipped to 0.95x and Vungle to 0.98x in their worst months, so their thin averages are fragile.",
        queries: [
          {
            sql: "WITH m AS (SELECT channel, install_month, SUM(d90_ltv*installs)/SUM(ua_spend) AS roas FROM payback_analysis WHERE channel<>'organic' GROUP BY channel,install_month) SELECT channel, ROUND(AVG(roas),2) AS avg_roas, ROUND(MIN(roas),2) AS min_roas, ROUND(MAX(roas),2) AS max_roas, ROUND(STDDEV_POP(roas),3) AS roas_stddev FROM m GROUP BY channel ORDER BY avg_roas DESC",
            description: "Per-month D90 ROAS average, range and standard deviation per channel",
            rowCount: 4,
            executionTimeMs: 433,
            columns: ["channel", "avg_roas", "min_roas", "max_roas", "roas_stddev"],
          },
        ],
      },
      geographic: {
        summary:
          "Re-ran the payback curve for the US only. Every channel including Vungle is already profitable by D30 (1.16x to 1.37x), proving the slow blended timeline is a weak-non-US-geo artifact, not channel speed.",
        queries: [
          {
            sql: "SELECT channel, ROUND(SUM(ua_spend),0) AS spend, ROUND(SUM(ua_spend)/SUM(installs),2) AS cpi, ROUND(SUM(d30_ltv*installs)/SUM(ua_spend),2) AS roas_d30, ROUND(SUM(d60_ltv*installs)/SUM(ua_spend),2) AS roas_d60, ROUND(SUM(d90_ltv*installs)/SUM(ua_spend),2) AS roas_d90 FROM payback_analysis WHERE channel<>'organic' AND country='US' GROUP BY channel ORDER BY roas_d90 DESC",
            description: "US-only payback curve per channel (D30/D60/D90 ROAS)",
            rowCount: 4,
            executionTimeMs: 421,
            columns: ["channel", "spend", "cpi", "roas_d30", "roas_d60", "roas_d90"],
          },
        ],
      },
      "data-quality": {
        summary:
          "Confirmed the fraud overlay on the channel ranking. Vungle clears only 83.6% of impression revenue versus 94.1% for Facebook in the raw event log, so the channel that pays back slowest also leaks the most settled revenue.",
        queries: [
          {
            sql: "SELECT channel, COUNT(*) AS impressions, ROUND(100.0*AVG(fraud_rate),1) AS avg_fraud_rate, ROUND(100.0*SUM(settled_revenue)/SUM(revenue),1) AS settle_pct FROM ad_impression_events WHERE channel<>'organic' GROUP BY channel ORDER BY avg_fraud_rate DESC",
            description: "Raw impression-log fraud rate and settled share per paid channel",
            rowCount: 4,
            executionTimeMs: 1760,
            columns: ["channel", "impressions", "avg_fraud_rate", "settle_pct"],
          },
        ],
      },
    },
    followUps: [
      "How much headroom does AdMob US have before ROAS drops?",
      "What does the payback curve look like for the US only?",
      "If I shift 20% of Vungle spend to AdMob, what is the net ROAS?",
      "Which channel pays back fastest in absolute days?",
    ],
  }),
  deepResearchThread({
    slug: "five-game-targeting-test",
    title: "Is the 5-game-targeting test working?",
    question:
      "We started targeting players who play 5+ games early. It costs more per install. Is the higher quality actually worth the higher CPI, or are we just paying more for the same users?",
    report:
      "# Is the 5-game-targeting test paying off?\n\n**Bottom line: it buys genuinely better users, but the honest control comparison is more nuanced than the headline.** Against the blended legacy book, the new-targeting cohort costs 2.2x more per install yet returns 46% higher D90 LTV, retains better at every horizon, and crosses break-even at D60 (1.12x) while the blended old book does not (0.71x) [user-segmentation:Q1]. But the test runs only on Facebook, and measured strictly against its true control (Facebook old-targeting), the new cohort actually retains better but does not out-earn it [user-segmentation:Q3]. The verdict: the targeting is real and worth expanding, but the eye-popping headline lift is partly a mix illusion, so set expectations on retention quality, not on a 46% LTV jump.\n\n## Executive summary\n\nThe test does exactly what good targeting should: it raises the quality of who you buy. At the install level, new-targeting users are 47.2% high-engagement versus 28.6% for old targeting, and they carry a lower invalid-traffic rate (6.2% versus 8.2%) [data-quality:Q1]. That quality shows up as a cleaner retention curve, higher at D7, D30 and D60 [cohort-retention:Q1]. So far, unambiguously good. The complication is the comparison baseline. The test exists only on Facebook and only in the last two months of data (January and February), which happen to be the months of the company-wide retention dip [daily-metrics:Q1]. The flattering 46% LTV lift and the 1.12x-versus-0.71x break-even gap come from comparing the Facebook-only test against the entire old-targeting book, which includes cheap, low-LTV geos and channels that drag the old average down. When you put the test head to head against Facebook old-targeting specifically, its true control, the new cohort retains better (+2.5 points D7) but its D90 LTV is actually a touch lower ($6.62 versus $6.85) at a slightly higher CPI [user-segmentation:Q3]. None of the numbers are wrong, they just answer two different questions. The right read is: the targeting genuinely improves user quality and is worth scaling, but it is not a free 46% money printer, and its absolute economics are being suppressed by launching into the worst retention months in the dataset.\n\n## Methodology and data note\n\nThe blended comparison aggregates engagement_analysis by the is_new_targeting flag, install-weighting CPI, retention, LTV and the stored D60 ROAS [user-segmentation:Q1]. The controlled comparison restricts both arms to channel = 'facebook', which is the only channel the test ran on, removing the channel and geo mix confound [user-segmentation:Q3]. We separately confirmed the test's timing and scope from the install-month grain [daily-metrics:Q1] and validated user-quality claims against the raw installs table [data-quality:Q1]. Important caveat baked into every number: the stored D60 ROAS for the old cohort (0.71x) is computed against the full old-targeting UA spend, which includes expensive low-LTV geos, so it is not the same cost basis as a like-for-like Facebook comparison [user-segmentation:Q3].\n\n## New vs old targeting, head to head (blended)\n\n| Metric | Old targeting (blended) | New (5-game) targeting | Delta |\n|---|---:|---:|---|\n| Installs | 27,865 | 2,133 | test is ~7% of volume |\n| CPI | $2.31 | $5.17 | **+124%** |\n| D7 retention | 19.2% | 24.8% | **+5.6 pts** |\n| D30 LTV | $3.12 | $4.69 | +50% |\n| D90 LTV | $4.54 | $6.62 | **+46%** |\n| ROAS @ D60 (stored) | 0.71x | **1.12x** | crosses break-even |\n\n## The controlled comparison (Facebook only, the true apples-to-apples)\n\n| Metric | Facebook old targeting | Facebook new targeting | Delta |\n|---|---:|---:|---|\n| Installs | 6,825 | 2,133 | |\n| CPI | $4.99 | $5.17 | +4% |\n| D7 retention | 22.3% | 24.8% | **+2.5 pts** |\n| D90 LTV | $6.85 | $6.62 | **-3%** |\n| ROAS @ D60 (stored) | 1.20x | 1.12x | -0.08x |\n\nThis is the comparison that matters for a scaling decision, and it is sobering: against its real control, the new targeting costs about the same, retains modestly better, but does not out-earn Facebook old targeting on LTV or stored ROAS [user-segmentation:Q3]. The retention edge is real; the LTV edge in the blended table is largely a mix effect.\n\n## Where the headline lift actually comes from\n\nThe blended old-targeting book is diluted by cheap, low-LTV inventory that the test never touched. Old targeting spans every channel and geo, including Vungle and the sub-1.0x emerging markets, so its blended $4.54 D90 LTV is low by construction. The Facebook-only old book earns $6.85, almost identical to the test's $6.62 [user-segmentation:Q3]. The 46% headline is therefore measuring Facebook-quality traffic against an average that includes a lot of non-Facebook junk, not measuring the targeting's incremental lift.\n\n## The quality shift is real (engagement and fraud)\n\n| Cohort | Installs | High-engagement % | Fraud % |\n|---|---:|---:|---:|\n| Old targeting | 27,865 | 28.6% | 8.2% |\n| New (5-game) targeting | 2,133 | **47.2%** | **6.2%** |\n\nThis is the strongest evidence the targeting works as designed: it nearly doubles the high-engagement share and cuts the invalid-traffic rate by a quarter at the install level [data-quality:Q1]. Better users are genuinely entering the funnel; the question is only how much extra LTV that converts into once you control for channel.\n\n## Retention curve confirms the quality\n\n| Horizon | Old targeting | New targeting |\n|---|---:|---:|\n| D7 | 19.2% | **24.8%** |\n| D30 | 6.3% | **8.4%** |\n| D60 | 3.7% | **5.0%** |\n\nNew targeting retains better at every horizon, including the blended comparison [cohort-retention:Q1]. Retention is the leading indicator that the quality is structural rather than a one-off spend bump, and it holds up even in the controlled Facebook view (+2.5 points D7) [user-segmentation:Q3].\n\n## Scope and timing\n\n| Install month | Total installs | New-targeting installs | New-targeting % |\n|---|---:|---:|---:|\n| 2025-08 to 2025-12 | 22,585 | 0 | 0% |\n| 2026-01 | 3,932 | 1,141 | 29.0% |\n| 2026-02 | 3,481 | 992 | 28.5% |\n\nThe test is only ~7% of all installs and ran exclusively in the last two months [user-segmentation:Q1] [daily-metrics:Q1]. Crucially, January and February are the company-wide retention-dip months, so the test's absolute LTV and ROAS are being measured during the worst retention window in the dataset, which suppresses its numbers rather than flatters them.\n\n## Key Findings\n\n1. **The targeting genuinely improves user quality.** New-targeting installs are 47.2% high-engagement vs 28.6% and carry lower fraud (6.2% vs 8.2%) [data-quality:Q1].\n2. **It retains better at every horizon** (D7 24.8% vs 19.2%, D30 8.4% vs 6.3%, D60 5.0% vs 3.7%) [cohort-retention:Q1], and the retention edge survives the controlled Facebook comparison (+2.5 pts D7) [user-segmentation:Q3].\n3. **The 46% LTV headline is partly a mix illusion.** Against its true control (Facebook old targeting), new-targeting D90 LTV is $6.62 vs $6.85, a slight deficit, not a 46% gain [user-segmentation:Q1] [user-segmentation:Q3].\n4. **The CPI premium is modest within Facebook (+4%),** not the +124% the blended table implies, because the blended old book includes much cheaper non-Facebook installs [user-segmentation:Q3].\n5. **The test ran only in the retention-dip months,** so its absolute economics are suppressed by a bad window, not inflated [daily-metrics:Q1].\n\n## Risks and caveats\n\n- **Confounded baseline.** The headline blended comparison mixes channel and geo effects into the targeting effect. Always quote the Facebook-only control for scaling decisions [user-segmentation:Q3].\n- **Tiny, short sample.** 2,133 installs across two months is thin, and those two months are atypical (the retention dip), so durability at scale and in a normal retention environment is unproven [user-segmentation:Q1] [daily-metrics:Q1].\n- **Stored ROAS basis differs by arm.** The old cohort's 0.71x D60 ROAS is computed on full old-targeting spend; do not compare it directly to the new arm's 1.12x without noting the cost-basis mismatch [user-segmentation:Q3].\n\n## Recommended Actions\n\n1. **Keep and modestly expand the test, but justify it on retention quality, not the 46% LTV headline.** Target 15 to 20% of Facebook volume and re-measure against Facebook old targeting only [user-segmentation:Q3].\n2. **Re-run the readout after the retention dip resolves.** The test launched into the worst two months; a clean read needs a normal-retention month to judge true LTV lift [daily-metrics:Q1].\n3. **Extend the targeting to AdMob US** (the other proven-payback pocket) as a second controlled arm, so the next readout is not Facebook-only and the quality lift can be confirmed across channels [user-segmentation:Q1].\n4. **Set a CPI guardrail at roughly $6.50;** if Facebook new-targeting CPI climbs past that without LTV keeping pace, the high-intent inventory is exhausting and the edge is closing [user-segmentation:Q3].\n\n```sql\n-- Controlled comparison: new vs old targeting within Facebook only\nSELECT\n  is_new_targeting,\n  SUM(installs)                                          AS installs,\n  ROUND(SUM(avg_cpi      * installs) / SUM(installs), 2) AS cpi,\n  ROUND(SUM(d7_retention * installs) / SUM(installs), 3) AS d7_retention,\n  ROUND(SUM(d90_ltv      * installs) / SUM(installs), 2) AS d90_ltv,\n  ROUND(SUM(roas_d60     * installs) / SUM(installs), 2) AS roas_d60\nFROM engagement_analysis\nWHERE channel = 'facebook'\nGROUP BY is_new_targeting\nORDER BY is_new_targeting;\n```",
    work: {
      "user-segmentation": {
        summary:
          "Compared the 5-game-targeting test both blended and controlled. Blended, new targeting shows +124% CPI, +46% D90 LTV and a 1.12x-vs-0.71x break-even gap; but the test runs only on Facebook, and against Facebook old targeting its D90 LTV is actually $6.62 vs $6.85, so the headline lift is largely a mix effect while the retention edge (+2.5 pts D7) is real.",
        queries: [
          {
            sql: "SELECT is_new_targeting, SUM(installs) AS installs, ROUND(SUM(avg_cpi*installs)/SUM(installs),2) AS cpi, ROUND(SUM(d7_retention*installs)/SUM(installs),3) AS d7_retention, ROUND(SUM(d30_ltv*installs)/SUM(installs),2) AS d30_ltv, ROUND(SUM(d90_ltv*installs)/SUM(installs),2) AS d90_ltv, ROUND(SUM(roas_d60*installs)/SUM(installs),2) AS roas_d60 FROM engagement_analysis GROUP BY is_new_targeting ORDER BY is_new_targeting",
            description:
              "Blended new vs old targeting: install-weighted CPI, retention, LTV and stored D60 ROAS",
            rowCount: 2,
            executionTimeMs: 372,
            columns: [
              "is_new_targeting",
              "installs",
              "cpi",
              "d7_retention",
              "d30_ltv",
              "d90_ltv",
              "roas_d60",
            ],
          },
          {
            sql: "SELECT is_new_targeting, engagement_tier, SUM(installs) AS installs, ROUND(100.0*SUM(installs)/SUM(SUM(installs)) OVER (PARTITION BY is_new_targeting),0) AS tier_pct FROM engagement_analysis WHERE engagement_tier IS NOT NULL GROUP BY is_new_targeting, engagement_tier ORDER BY is_new_targeting, engagement_tier",
            description:
              "Engagement-tier mix within new vs old targeting cohorts",
            rowCount: 6,
            executionTimeMs: 408,
            columns: ["is_new_targeting", "engagement_tier", "installs", "tier_pct"],
          },
          {
            sql: "SELECT is_new_targeting, SUM(installs) AS installs, ROUND(SUM(avg_cpi*installs)/SUM(installs),2) AS cpi, ROUND(SUM(d7_retention*installs)/SUM(installs),3) AS d7_retention, ROUND(SUM(d90_ltv*installs)/SUM(installs),2) AS d90_ltv, ROUND(SUM(roas_d60*installs)/SUM(installs),2) AS roas_d60 FROM engagement_analysis WHERE channel='facebook' GROUP BY is_new_targeting ORDER BY is_new_targeting",
            description:
              "Controlled comparison within Facebook only (the test's true control arm)",
            rowCount: 2,
            executionTimeMs: 391,
            columns: [
              "is_new_targeting",
              "installs",
              "cpi",
              "d7_retention",
              "d90_ltv",
              "roas_d60",
            ],
          },
        ],
      },
      "cohort-retention": {
        summary:
          "Built the retention curve for both arms. New targeting retains better at every horizon (D7 24.8% vs 19.2%, D30 8.4% vs 6.3%, D60 5.0% vs 3.7%), confirming the quality lift is structural rather than a one-off spend artifact.",
        queries: [
          {
            sql: "SELECT is_new_targeting, ROUND(SUM(d7_retention*installs)/SUM(installs),3) AS d7, ROUND(SUM(d30_retention*installs)/SUM(installs),3) AS d30, ROUND(SUM(d60_retention*installs)/SUM(installs),3) AS d60 FROM engagement_analysis GROUP BY is_new_targeting ORDER BY is_new_targeting",
            description: "Install-weighted D7/D30/D60 retention curve for new vs old targeting",
            rowCount: 2,
            executionTimeMs: 344,
            columns: ["is_new_targeting", "d7", "d30", "d60"],
          },
        ],
      },
      "daily-metrics": {
        summary:
          "Pinned down the test's scope and timing. It ran only in January and February 2026 (29.0% and 28.5% of those months' installs, zero before), which are the company-wide retention-dip months, so the test's absolute economics are measured in an unfavorable window.",
        queries: [
          {
            sql: "SELECT install_month, SUM(installs) AS total, SUM(installs) FILTER(WHERE is_new_targeting) AS new_inst, ROUND(100.0*SUM(installs) FILTER(WHERE is_new_targeting)/SUM(installs),1) AS new_pct FROM engagement_analysis GROUP BY install_month ORDER BY install_month",
            description: "New-targeting install share by month, exposing the test's two-month scope",
            rowCount: 7,
            executionTimeMs: 402,
            columns: ["install_month", "total", "new_inst", "new_pct"],
          },
        ],
      },
      "data-quality": {
        summary:
          "Validated the user-quality claim against the raw installs table. New-targeting installs are 47.2% high-engagement vs 28.6% and carry lower invalid-traffic rates (6.2% vs 8.2%), confirming the targeting genuinely selects better, cleaner users.",
        queries: [
          {
            sql: "SELECT is_new_targeting, COUNT(*) AS installs, ROUND(100.0*COUNT(*) FILTER(WHERE is_fraud)/COUNT(*),1) AS fraud_pct, ROUND(100.0*COUNT(*) FILTER(WHERE engagement_tier='high')/COUNT(*),1) AS high_pct FROM installs GROUP BY is_new_targeting ORDER BY is_new_targeting",
            description: "Raw install-level fraud rate and high-engagement share, new vs old targeting",
            rowCount: 2,
            executionTimeMs: 612,
            columns: ["is_new_targeting", "installs", "fraud_pct", "high_pct"],
          },
        ],
      },
    },
    followUps: [
      "Which channels show the biggest lift from new targeting?",
      "At what CPI does the new-targeting edge disappear?",
      "How does new targeting perform in the US specifically?",
      "What share of high-engagement players come from the new test?",
    ],
  }),
  deepResearchThread({
    slug: "ios-vs-android-value",
    title: "iOS vs Android: where is the real value?",
    question:
      "Android gives us most of our installs but iOS feels more valuable. Quantify the gap: which platform actually drives revenue and ROAS, and how should that change how we buy?",
    report:
      "# iOS vs Android: where the value really is\n\n**Bottom line: iOS earns 3.4x more revenue per active user than Android ($4.40 vs $1.29 ARPDAU) [daily-metrics:Q1] and is the only platform that pays back paid UA (1.30x D90 vs 0.54x) [rev-opt:Q1].** Android delivers the volume; iOS delivers the money. The book is currently over-indexed on the platform that does not pay back. The gap is not a quality artifact (engagement and fraud are platform-neutral) and it is not closing over time, so it is a durable, structural feature of the book [user-segmentation:Q1] [daily-metrics:Q2].\n\n## Executive summary\n\nAndroid supplies roughly 69% of active-user days but monetizes at less than a third of the iOS rate, so the platform mix is inverted relative to where the value sits [daily-metrics:Q1]. The most decision-relevant number is paid payback: iOS paid UA returns 1.30x at D90 while Android returns just 0.54x, meaning every paid Android dollar comes back as about 54 cents [rev-opt:Q1]. The natural objection is that iOS just costs more to acquire, but the CPI gap ($4.32 vs $2.24, a 1.9x premium) is nowhere near large enough to offset a 3.4x LTV advantage, so iOS is under-bid relative to its worth at almost any reasonable price [rev-opt:Q1]. We pressure-tested whether the gap is a measurement quirk and it is not: install-level engagement tiers and invalid-traffic rates are essentially identical across platforms, so the iOS premium is pure monetization per engaged user rather than iOS getting better players [user-segmentation:Q1] [data-quality:Q1]. The gap is also stable, holding between 3.3x and 3.6x every month with no convergence [daily-metrics:Q2]. Android still belongs in the book as a reach and organic-surface engine, but paid Android in low-LTV geos is where the 0.54x blended return comes from, and that is the spend to cut [rev-opt:Q2].\n\n## Methodology and data note\n\nARPDAU is settled revenue divided by active-user days from arpdau_trend, decomposed by platform, country and month [daily-metrics:Q1] [geographic:Q1] [daily-metrics:Q2]. Paid payback is install-weighted from roas_by_cohort by platform [rev-opt:Q1]. We use settled (post-fraud) revenue throughout so the platform comparison is not distorted by invalid traffic, and we separately confirmed fraud is platform-neutral [data-quality:Q1]. Note that roas_by_cohort is a cohort-by-period table whose install counts are inflated relative to the unique install base, so we use it only for install-weighted ratios (ROAS, CPI, LTV), never for absolute spend or install totals.\n\n## The value gap, quantified\n\n| Metric | iOS | Android | iOS advantage |\n|---|---:|---:|---|\n| ARPDAU (settled) | **$4.40** | $1.29 | **3.4x** |\n| Active-user days | 13,690 | 30,900 | Android = 69% of DAU |\n| Total settled ad revenue | $60,185 | $39,757 | iOS earns more on fewer users |\n| CPI | $4.32 | $2.24 | iOS costs 1.9x more |\n| D90 LTV | $9.32 | $2.73 | **3.4x** |\n| D90 ROAS (paid) | **1.30x** | 0.54x | iOS profitable, Android not |\n\n## Reading the split\n\nAndroid is **69% of active-user days but earns less total settled revenue than iOS** ($39.8K vs $60.2K), which is the entire story in one line: most of our usage comes from the platform that earns the least, both per user and in total [daily-metrics:Q1] [data-quality:Q1]. On paid UA specifically, iOS returns 1.30x while Android returns 0.54x, so every paid Android dollar comes back as ~54 cents at D90 [rev-opt:Q1].\n\nThe CPI gap ($4.32 iOS vs $2.24 Android) is real but nowhere near enough to close a 3.4x LTV gap [rev-opt:Q1]. iOS users cost 1.9x more and are worth 3.4x more: the math favors iOS at almost any reasonable bid.\n\n## The gap is stable, not a one-month blip\n\n| Month | iOS ARPDAU | Android ARPDAU | iOS multiple |\n|---|---:|---:|---:|\n| 2025-08 | $4.64 | $1.28 | 3.6x |\n| 2025-10 | $4.12 | $1.23 | 3.4x |\n| 2025-12 | $4.44 | $1.32 | 3.4x |\n| 2026-02 | $4.82 | $1.45 | 3.3x |\n\nAcross every month the iOS multiple sits in a tight 3.3x to 3.6x band [daily-metrics:Q2]. It is neither widening nor closing, so the reallocation thesis is not betting on a transient gap, it is structural. Both platforms even trended up slightly into February.\n\n## Where the iOS value concentrates\n\n| Country | iOS ARPDAU | Android ARPDAU |\n|---|---:|---:|\n| US | **$6.35** | $3.94 |\n| CA | $4.97 | $3.12 |\n| GB | $3.97 | $2.71 |\n| DE | $2.54 | $1.84 |\n\nThe iOS edge is not evenly spread, it is a US-led story: iOS US ARPDAU is $6.35, well ahead of CA ($4.97) and GB ($3.97), and iOS beats Android in every country [geographic:Q1]. That is where the incremental iOS budget should land first. Android US, at $3.94 ARPDAU, is actually the one Android pocket that holds its own and pays back (1.84x), so Android is not worthless everywhere [geographic:Q1] [rev-opt:Q2].\n\n## Why Android still belongs in the book\n\n| Android country | D90 ROAS |\n|---|---:|\n| US | **1.84x** |\n| Others | 1.40x |\n| GB | 1.19x |\n| CA | 1.02x |\n| FR / IN / MX / DE / BR / ID | 0.43x to 0.69x |\n\nAndroid is profitable in the US (1.84x) and Tier-1 English markets, but every emerging market is deeply underwater [rev-opt:Q2]. The problem is not Android the platform, it is **paid Android UA in low-LTV geos** (the IN / BR / MX / ID / FR / DE tail), which is the source of the 0.54x blended ROAS [rev-opt:Q1] [rev-opt:Q2]. Android also retains worse overall (11.6% D30 vs 23.2% for iOS), which compounds the monetization gap [cohort-retention:Q1].\n\n## Key Findings\n\n1. **iOS ARPDAU is $4.40 vs Android $1.29 (3.4x),** and the D90 LTV gap is identical at 3.4x, so the monetization edge is structural [daily-metrics:Q1] [rev-opt:Q1].\n2. **iOS paid UA pays back (1.30x D90); Android paid UA does not (0.54x).** This is the decision-driving number [rev-opt:Q1].\n3. **iOS earns more total settled revenue than Android** ($60.2K vs $39.8K) despite far fewer active-user days, so the install mix is inverted relative to value [daily-metrics:Q1] [data-quality:Q1].\n4. **The gap is stable at 3.3x to 3.6x every month,** so reallocation is not betting on a transient effect [daily-metrics:Q2].\n5. **It is a monetization gap, not a quality gap.** Engagement tiers and fraud rates are platform-neutral, so iOS simply monetizes each engaged user harder [user-segmentation:Q1] [data-quality:Q1].\n6. **Android is salvageable only in Tier-1.** Android US (1.84x) and GB (1.19x) pay back; the emerging-market tail (0.43x to 0.69x) is the leak [rev-opt:Q2].\n\n## Risks and caveats\n\n- **Privacy and signal loss.** iOS attribution is noisier post-ATT, so iOS ROAS estimates carry more measurement uncertainty than Android, even though the LTV gap is large enough to survive it.\n- **roas_by_cohort scale.** That table double-counts installs across periods, so it is used only for ratios here, not for absolute spend; absolute reallocation dollars should be sized from payback_analysis.\n- **iOS scale headroom is unproven.** A 1.30x blended iOS return is healthy, but pushing significant new budget into iOS could raise iOS CPI and compress the advantage, so scale in measured steps.\n\n## Recommended Actions\n\n1. **Shift paid UA weight toward iOS, especially iOS US,** where ARPDAU ($6.35) and ROAS are both highest; iOS can absorb a higher CPI than current bids assume [geographic:Q1] [rev-opt:Q1].\n2. **Stop buying paid Android in sub-1.0x geos** (IN, BR, MX, ID, FR, DE) and let Android there run organic-only [rev-opt:Q2].\n3. **Keep Android paid alive only where it pays back** (US 1.84x, GB 1.19x) and treat the rest as reach, not ROI [rev-opt:Q2].\n4. **Re-bid iOS up to its true LTV ceiling,** since a 3.4x value gap that is stable month over month means the platform is being under-funded at today's CPI [rev-opt:Q1] [daily-metrics:Q2].\n\n```sql\n-- Platform value: settled ARPDAU vs paid-UA ROAS, side by side\nWITH arpdau AS (\n  SELECT\n    platform,\n    SUM(active_users)                                   AS active_user_days,\n    SUM(total_settled_revenue) / SUM(active_users)      AS arpdau\n  FROM arpdau_trend\n  GROUP BY platform\n),\nroas AS (\n  SELECT\n    platform,\n    SUM(avg_cpi  * installs) / SUM(installs)            AS cpi,\n    SUM(d90_ltv  * installs) / SUM(installs)            AS d90_ltv,\n    SUM(roas_d90 * installs) / SUM(installs)            AS roas_d90\n  FROM roas_by_cohort\n  GROUP BY platform\n)\nSELECT\n  a.platform,\n  ROUND(a.arpdau, 2)            AS arpdau,\n  a.active_user_days,\n  ROUND(r.cpi, 2)               AS cpi,\n  ROUND(r.d90_ltv, 2)           AS d90_ltv,\n  ROUND(r.roas_d90, 3)          AS roas_d90\nFROM arpdau a\nJOIN roas r USING (platform)\nORDER BY arpdau DESC;\n```",
    work: {
      "daily-metrics": {
        summary:
          "Measured settled ARPDAU and usage share by platform and tracked the gap over time. iOS earns $4.40 per active-user day vs Android $1.29 (3.4x), Android is 69% of active-user days, and the iOS multiple is stable at 3.3x to 3.6x every month with no convergence.",
        queries: [
          {
            sql: "SELECT platform, SUM(active_users) AS active_user_days, ROUND(SUM(total_settled_revenue)/SUM(active_users),2) AS arpdau FROM arpdau_trend GROUP BY platform ORDER BY arpdau DESC",
            description: "Settled ARPDAU and active-user-day volume by platform",
            rowCount: 2,
            executionTimeMs: 318,
            columns: ["platform", "active_user_days", "arpdau"],
          },
          {
            sql: "WITH m AS (SELECT strftime(month,'%Y-%m') AS mo, platform, SUM(total_settled_revenue)/SUM(active_users) AS arp FROM arpdau_trend GROUP BY 1,2) SELECT i.mo AS month, ROUND(i.arp,2) AS ios_arpdau, ROUND(a.arp,2) AS android_arpdau, ROUND(i.arp/a.arp,2) AS ios_multiple FROM m i JOIN m a ON i.mo=a.mo AND i.platform='ios' AND a.platform='android' ORDER BY i.mo",
            description: "Monthly iOS vs Android ARPDAU with the iOS revenue multiple over time",
            rowCount: 7,
            executionTimeMs: 446,
            columns: ["month", "ios_arpdau", "android_arpdau", "ios_multiple"],
          },
        ],
      },
      "rev-opt": {
        summary:
          "Compared paid-UA economics by platform and located the Android leak. iOS pays back at 1.30x D90 on a $4.32 CPI; Android returns just 0.54x on a $2.24 CPI; Android is profitable only in the US (1.84x) and Tier-1, with the emerging-market tail at 0.43x to 0.69x.",
        queries: [
          {
            sql: "SELECT platform, ROUND(SUM(avg_cpi*installs)/SUM(installs),2) AS cpi, ROUND(SUM(d90_ltv*installs)/SUM(installs),2) AS d90_ltv, ROUND(SUM(roas_d90*installs)/SUM(installs),2) AS roas_d90 FROM roas_by_cohort GROUP BY platform ORDER BY roas_d90 DESC",
            description: "Install-weighted CPI, D90 LTV and D90 ROAS by platform",
            rowCount: 2,
            executionTimeMs: 357,
            columns: ["platform", "cpi", "d90_ltv", "roas_d90"],
          },
          {
            sql: "SELECT country, SUM(installs) AS installs, ROUND(SUM(avg_cpi*installs)/SUM(installs),2) AS cpi, ROUND(SUM(d90_ltv*installs)/SUM(installs),2) AS d90_ltv, ROUND(SUM(d90_ltv*installs)/SUM(avg_cpi*installs),2) AS roas_d90 FROM roas_by_cohort WHERE platform='android' GROUP BY country ORDER BY roas_d90 DESC",
            description: "Android-only D90 ROAS by country, isolating the profitable Tier-1 from the emerging-market leak",
            rowCount: 10,
            executionTimeMs: 468,
            columns: ["country", "installs", "cpi", "d90_ltv", "roas_d90"],
          },
        ],
      },
      geographic: {
        summary:
          "Broke ARPDAU out by country for both platforms. The iOS edge concentrates in the US ($6.35 vs Android $3.94) and iOS beats Android in every market, naming the US as the first destination for reallocated iOS budget.",
        queries: [
          {
            sql: "WITH p AS (SELECT platform, country, SUM(active_users) AS aud, SUM(total_settled_revenue) AS rev FROM arpdau_trend GROUP BY platform, country) SELECT i.country, ROUND(i.rev/i.aud,2) AS ios_arpdau, ROUND(a.rev/a.aud,2) AS android_arpdau FROM p i JOIN p a ON i.country=a.country AND i.platform='ios' AND a.platform='android' ORDER BY ios_arpdau DESC LIMIT 6",
            description: "iOS vs Android settled ARPDAU by country, side by side",
            rowCount: 6,
            executionTimeMs: 401,
            columns: ["country", "ios_arpdau", "android_arpdau"],
          },
        ],
      },
      "cohort-retention": {
        summary:
          "Confirmed retention reinforces the monetization gap. iOS retains 23.2% of installs at D30 versus Android's 11.6%, so iOS users both monetize harder and stay longer, compounding the LTV advantage.",
        queries: [
          {
            sql: "SELECT platform, SUM(cohort_size) AS cohort, ROUND(100.0*SUM(d7_active)/SUM(cohort_size),1) AS d7, ROUND(100.0*SUM(d30_active)/SUM(cohort_size),1) AS d30 FROM cohort_retention_actuals GROUP BY platform ORDER BY d30 DESC",
            description: "D7 and D30 retention by platform",
            rowCount: 2,
            executionTimeMs: 372,
            columns: ["platform", "cohort", "d7", "d30"],
          },
        ],
      },
      "user-segmentation": {
        summary:
          "Ruled out a user-quality explanation for the iOS premium. Install-level high-engagement share is nearly identical across platforms (iOS 30.4% vs Android 29.7%), so the 3.4x ARPDAU gap is pure monetization per engaged user, not iOS getting better players.",
        queries: [
          {
            sql: "SELECT platform, COUNT(*) AS installs, ROUND(100.0*COUNT(*) FILTER(WHERE engagement_tier='high')/COUNT(*),1) AS high_pct, ROUND(100.0*COUNT(*) FILTER(WHERE engagement_tier='low')/COUNT(*),1) AS low_pct FROM installs GROUP BY platform ORDER BY high_pct DESC",
            description: "Install-level engagement-tier mix by platform",
            rowCount: 2,
            executionTimeMs: 588,
            columns: ["platform", "installs", "high_pct", "low_pct"],
          },
        ],
      },
      "data-quality": {
        summary:
          "Validated revenue totals and fraud neutrality by platform. iOS reports $64.5K and Android $42.6K, with near-identical fraud rates (6.8% vs 6.6%), so the platform comparison is clean and not distorted by invalid traffic.",
        queries: [
          {
            sql: "SELECT platform, ROUND(SUM(reported_revenue),0) AS reported, ROUND(SUM(settled_revenue),0) AS settled, ROUND(100.0*SUM(fraud_loss)/SUM(reported_revenue),1) AS fraud_pct FROM monthly_revenue_summary GROUP BY platform ORDER BY reported DESC",
            description: "Reported vs settled ad revenue and fraud rate by platform",
            rowCount: 2,
            executionTimeMs: 341,
            columns: ["platform", "reported", "settled", "fraud_pct"],
          },
        ],
      },
    },
    followUps: [
      "What does iOS look like by country?",
      "How much paid Android spend is in sub-1.0x geos right now?",
      "If I move 30% of Android budget to iOS, what is blended ROAS?",
      "Is the iOS advantage growing or shrinking month over month?",
    ],
  }),
];

export const PRESTO_STARTER_CHATS: StarterChat[] = [
  ...normalChats,
  ...deepChats,
];
