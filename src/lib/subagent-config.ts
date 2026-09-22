// ── Shared subagent configuration ──
// Single source of truth for per-agent task checklists, narratives, and prompts.
// Consumed by research-timeline.tsx (task lists) and task-panel.tsx (full config + prompts).

export interface SubagentTaskConfig {
  checklist: string[];
  narrativeActive: string;
  narrativeDone: string;
}

/**
 * Per-agent task definitions: checklist items shown in progress UI,
 * plus narrative strings displayed during active/done states.
 */
export const SUBAGENT_TASKS: Record<string, SubagentTaskConfig> = {
  "data-quality": {
    checklist: [
      "Read schema summary to understand available data fields",
      "Check NULL rates and field completeness",
      "Validate event type distribution",
      "Run anomaly detection on daily volumes",
      "Generate data quality validation report",
    ],
    narrativeActive: "Let me validate data quality and completeness. Starting by checking NULL rates and event distribution.",
    narrativeDone: "Data quality validation complete. Generating the quality report with findings.",
  },
  "daily-metrics": {
    checklist: [
      "Read schema summary to understand available data fields",
      "Compute daily active user metrics",
      "Execute queries for session and engagement trends",
      "Analyze day-over-day growth patterns",
      "Generate daily metrics summary report",
    ],
    narrativeActive: "Let me analyze the daily metrics and user growth trends. Starting by reading the schema and computing DAU metrics.",
    narrativeDone: "Perfect! Now let me compile the daily metrics into a comprehensive trend analysis.",
  },
  "cohort-retention": {
    checklist: [
      "Read schema summary to understand available data fields",
      "Define retention cohorts with SQL logic",
      "Execute queries for repeat purchase analysis",
      "Compute cohort retention rates and LTV indicators",
      "Generate retention analysis summary",
    ],
    narrativeActive: "Let me analyze user retention and repeat purchase behavior. Starting by defining cohorts and computing retention metrics.",
    narrativeDone: "Great! Cohort analysis complete. Let me compile the retention findings into a summary.",
  },
  "rev-opt": {
    checklist: [
      "Read schema summary to understand available data fields",
      "Define revenue analysis dimensions with SQL logic",
      "Execute queries to compute revenue metrics",
      "Analyze conversion funnels and purchase patterns",
      "Generate comprehensive revenue insights summary",
    ],
    narrativeActive: "Let me analyze the revenue metrics and conversion patterns. Starting by reading the schema and executing the analysis query.",
    narrativeDone: "Perfect! Now let me read all the query results and create a comprehensive revenue analysis.",
  },
  "user-segmentation": {
    checklist: [
      "Read schema summary to understand available data fields",
      "Define engagement level segments with SQL logic",
      "Define monetization status segments with SQL logic",
      "Execute queries to quantify each segment",
      "Generate segmentation framework summary",
    ],
    narrativeActive: "Let me create the user segmentation framework. Starting by defining engagement and monetization segments.",
    narrativeDone: "Great! Now I understand the segments. Let me compile the segmentation analysis into a comprehensive summary.",
  },
  geographic: {
    checklist: [
      "Read schema summary to understand available data fields",
      "Analyze category hierarchy and performance",
      "Execute queries for brand market share",
      "Compute cross-category behavior patterns",
      "Generate category & brand performance summary",
    ],
    narrativeActive: "Let me analyze category and brand performance. Starting by reading the schema and computing market share metrics.",
    narrativeDone: "Category and brand analysis complete. Generating the performance report with competitive insights.",
  },
  research: {
    checklist: [
      "Read schema summary to understand available data fields",
      "Search for relevant external benchmarks and context",
      "Cross-reference findings with industry patterns",
      "Compile competitive and contextual insights",
      "Generate research context summary",
    ],
    narrativeActive: "Let me gather external context and benchmarks. Starting by researching industry standards relevant to the data.",
    narrativeDone: "Research complete. Compiling competitive and contextual insights into a summary.",
  },
  "data-analysis": {
    checklist: [
      "Read schema summary to understand available data fields",
      "Compute descriptive statistics and distributions",
      "Run correlation and trend detection analysis",
      "Identify statistical outliers and anomalies",
      "Generate statistical analysis summary",
    ],
    narrativeActive: "Let me perform deep statistical analysis. Starting by computing descriptive statistics and distributions.",
    narrativeDone: "Statistical analysis complete. Generating the analysis summary with key findings.",
  },
  "marketing-optimization": {
    checklist: [
      "Read schema summary to understand available data fields",
      "Analyze channel attribution and acquisition costs",
      "Compute customer lifetime value by segment",
      "Evaluate campaign ROI and conversion metrics",
      "Generate marketing optimization summary",
    ],
    narrativeActive: "Let me analyze marketing effectiveness and channel attribution. Starting by evaluating acquisition costs.",
    narrativeDone: "Marketing analysis complete. Generating optimization summary with ROI findings.",
  },
  critique: {
    checklist: [
      "Review all agent summaries and raw query results",
      "Validate scope — confirm business relevance",
      "Check content quality and statistical claims",
      "Assess methodology and report structure",
      "Generate constructive critique with recommendations",
    ],
    narrativeActive: "Reviewing the analysis outputs from all 6 agents. Let me validate the methodology and cross-check the findings.",
    narrativeDone: "Analysis review complete. Generating the critique report with validated insights and improvement recommendations.",
  },
};

/**
 * Detailed task prompts assigned by Main Agent to each subagent.
 * Shown in the task-panel's expandable subagent accordion.
 */
export const SUBAGENT_TASK_PROMPTS: Record<string, string> = {
  "data-quality": `**Data Quality Agent**
*Data Quality Validation & Anomaly Detection*

**Context:** DuckDB dataset.

**Database:** DuckDB

### Your Task
Validate data quality, completeness, and identify anomalies before other agents begin analysis.

### Required Analyses
1. **Completeness Check** — NULL rates for user_id, event_type, price, category_code, brand
2. **Event Distribution** — Counts by event_type (view, cart, purchase, remove_from_cart)
3. **Consistency Validation** — Price min/max/outliers, session integrity
4. **Anomaly Detection** — Daily volume anomalies, price spikes, bot detection

\`\`\`sql
SELECT COUNT(*) as total,
       SUM(CASE WHEN category_code IS NULL THEN 1 ELSE 0 END) as null_category,
       SUM(CASE WHEN brand IS NULL THEN 1 ELSE 0 END) as null_brand
FROM events
\`\`\`

**IMPORTANT:** Flag data quality issues that could affect downstream analyses.`,

  "daily-metrics": `**Daily Metrics Agent**
*Daily Metrics & User Growth Analysis*

**Context:** DuckDB dataset.

**Database:** DuckDB

### Your Task
Provide comprehensive daily user activity, engagement trends, and growth metrics.

### Required Analyses
1. **DAU Trends (Nov 1-16, 2019)** — Daily active users, day-over-day growth, weekend vs weekday
2. **Session Metrics** — Sessions per user per day, frequency distribution, peak hours
3. **Daily Revenue Trends** — Revenue per day, purchases per day, AOV trends

\`\`\`sql
SELECT date, users, views, purchases, revenue
FROM daily_metrics ORDER BY date
\`\`\`

**IMPORTANT:** Include day-over-day comparisons. Flag significant trend changes.`,

  "cohort-retention": `**Cohort Retention Agent**
*Cohort Retention & Repeat Purchase Analysis*

**Context:** DuckDB dataset.

**Database:** DuckDB

### Your Task
Analyze user retention, repeat purchase behavior, and cohort-based patterns.

### Required Analyses
1. **Repeat Purchase Rate** — One-time vs repeat buyers, revenue contribution, time between purchases
2. **Cohort Behavior** — First-purchase date cohorts, return rate, revenue per cohort
3. **Lifetime Indicators** — Purchase frequency distribution, high-value users, churn risk

\`\`\`sql
-- Use the actual table/column names from the schema context
SELECT user_id, COUNT(*) as transactions,
       MIN(date_column) as first_activity, MAX(date_column) as last_activity
FROM primary_table
GROUP BY user_id
\`\`\`

**IMPORTANT:** Quantify revenue impact of repeat buyers vs one-time buyers.`,

  "rev-opt": `**Revenue Optimization Agent**
*Revenue & Conversion Analysis for eCommerce Analytics*

**Context:** DuckDB dataset. Read schema for full table details.

**Database:** DuckDB

### Your Task
Provide comprehensive revenue analysis including conversion funnels, purchase optimization opportunities, and revenue drivers.

### Required Analyses

1. **Purchase Conversion Rate**
   - View → Cart → Purchase funnel analysis
   - Conversion rates at each stage
   - Drop-off analysis and cart abandonment

2. **Revenue by Category & Brand**
   - Top categories by revenue
   - Top brands by revenue and AOV
   - Category-level conversion rates

3. **Average Order Value Analysis**
   - Overall AOV and distribution
   - AOV by category and brand
   - High-value vs low-value purchase patterns

### Key Tables & Queries
\`\`\`sql
-- Purchase conversion funnel
SELECT event_type, COUNT(DISTINCT user_id) as users
FROM events
WHERE event_type IN ('view', 'cart', 'purchase')
GROUP BY event_type

-- Revenue by category
SELECT category_code, SUM(price) as revenue,
       COUNT(*) as purchases, AVG(price) as aov
FROM events WHERE event_type = 'purchase'
GROUP BY category_code ORDER BY revenue DESC
\`\`\`

### Output Requirements
Write analysis to synthesis agent including: summary metrics tables, conversion funnel breakdown, top revenue drivers, and actionable recommendations.

**IMPORTANT:** Use ONLY actual query results. Include specific numbers and percentages.`,

  "user-segmentation": `**User Segmentation Agent**
*User Segmentation & Behavior Clustering*

**Context:** DuckDB dataset.

**Database:** DuckDB

### Your Task
Create a user segmentation framework based on behavior, spending patterns, and engagement levels.

### Required Segments
1. **By Engagement Level** — Power Users, Regular Users, Casual Users, Browse-Only Users
2. **By Monetization Status** — Paying Users, Non-Paying, High-Value Buyers (top 10%), Low-Value
3. **Cross-Tabulation** — Engagement × Monetization matrix, segment sizes and revenue contribution

\`\`\`sql
SELECT user_id, COUNT(*) as events,
       COUNT(DISTINCT user_session) as sessions,
       SUM(CASE WHEN event_type='purchase' THEN price ELSE 0 END) as spend
FROM events GROUP BY user_id
\`\`\`

**IMPORTANT:** Segment definitions must be reusable. Provide clear SQL CTEs.`,

  geographic: `**Geographic Agent**
*Category & Brand Performance Analysis*

**Context:** DuckDB dataset.

**Database:** DuckDB

### Your Task
Analyze category hierarchy and brand performance to identify market positioning and competitive dynamics.

### Required Analyses
1. **Category Performance** — Top-level category revenue/conversion, sub-category breakdown, growth comparison
2. **Brand Analysis** — Market share by brand, loyalty indicators, price positioning
3. **Cross-Category Behavior** — Users shopping across categories, affinity patterns, brand switching

\`\`\`sql
SELECT SPLIT_PART(category_code, '.', 1) as category,
       COUNT(*) as events, SUM(price) as revenue
FROM events WHERE event_type = 'purchase'
GROUP BY category ORDER BY revenue DESC
\`\`\`

**IMPORTANT:** Include both absolute numbers and relative percentages.`,

  "research": `**Research Agent**
*External Research & Competitive Analysis*

**Context:** DuckDB dataset.

**Database:** DuckDB

### Your Task
Provide external context, competitive benchmarks, and research insights to complement the data analysis.

### Required Analyses
1. **Market Context** — Industry benchmarks and standards for key metrics
2. **Trend Analysis** — External trends relevant to the data patterns
3. **Best Practices** — Recommended strategies based on findings
4. **Competitive Framing** — How results compare to industry norms

**IMPORTANT:** Ground all insights in the actual data. External context should enhance, not replace, data findings.`,

  "data-analysis": `**Data Analysis Agent**
*Statistical Analysis & Trend Detection*

**Context:** DuckDB dataset.

**Database:** DuckDB

### Your Task
Perform deep statistical analysis, identify correlations, and detect significant trends in the data.

### Required Analyses
1. **Descriptive Statistics** — Mean, median, variance, percentiles for key metrics
2. **Correlation Analysis** — Identify statistically significant relationships between variables
3. **Trend Detection** — Time-series decomposition, seasonality, change points
4. **Outlier Detection** — Statistical outliers using IQR and z-score methods

**IMPORTANT:** Include confidence intervals and significance levels where applicable.`,

  "marketing-optimization": `**Marketing Optimization Agent**
*Channel Attribution & Campaign ROI Analysis*

**Context:** DuckDB dataset.

**Database:** DuckDB

### Your Task
Analyze marketing effectiveness, channel attribution, customer acquisition costs, and campaign performance.

### Required Analyses
1. **Channel Attribution** — User acquisition by source/channel, conversion rates per channel
2. **CAC Analysis** — Customer acquisition cost by channel and segment
3. **LTV Analysis** — Customer lifetime value by acquisition cohort and channel
4. **Campaign ROI** — Return on investment for marketing activities

**IMPORTANT:** Connect acquisition metrics to downstream revenue to show true marketing impact.`,

  critique: `**Critique Agent**
*Analysis Quality Review & Validation*

**Context:** Review outputs from all 6 specialized analysis agents (Data Quality, Daily Metrics, Cohort Retention, Revenue Optimization, User Segmentation, Geographic).

### Your Task
Review the final analysis report for quality, accuracy, and actionability. Provide a constructive critique with a quality score.

### Required Checks

1. **Scope Validation**
   - Is the question relevant to business/product analytics?
   - Are all analyses within the requested scope?
   - Flag any out-of-scope content

2. **Content Quality**
   - Are the insights data-driven and well-supported?
   - Are statistical claims properly validated?
   - Is the methodology clearly explained?
   - Are the recommendations appropriate and actionable?

3. **Report Structure**
   - Is the executive summary organized with clear headings?
   - Is the language concise and jargon-free?
   - Are data tables properly formatted?

4. **Critical Review**
   - Any logical gaps or unsupported claims?
   - Are the top insights properly identified and validated?
   - Is there meaningful significance testing for key findings?
   - Are there missed opportunities in the analysis?

### Output Requirements
Generate critique report including: overall quality score (X/10), validated insights with evidence, content quality assessment, and specific improvement recommendations.

**IMPORTANT:** Be constructive but honest. Reference specific numbers from the analysis to validate or challenge claims.`,
};
