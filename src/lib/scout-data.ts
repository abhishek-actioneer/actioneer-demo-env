import type { ChatMessage } from "@/lib/types";

export interface ScoutRun {
  id: string;
  number: number;
  runAt: string;
  grade: string;
  summary: string;
  report: string;
  messages: ChatMessage[];
}

export interface Scout {
  id: string;
  name: string;
  description: string;
  prompt: string;
  schedule: string;
  scheduleDay?: string;
  status: "Active" | "Paused";
  playbook: { id: string; name: string };
  emailRecipients: string[];
  lastRun: string;
  runCount: number;
  runs: ScoutRun[];
}

// ── Pre-seeded report content ──

const REVENUE_REPORT = `# Revenue Deep-Dive Analysis: Android Gap, Whale Profiles & Cohort LTV Decline

**Analysis Period:** July 25, 2025 – November 24, 2025
**Report Date:** January 2026

---

## Executive Summary

This deep-dive investigation examines three critical revenue concerns identified in the initial revenue analysis. Key findings reveal interconnected issues across platform performance, whale development, and cohort quality.

### Key Findings at a Glance

| Issue | Root Cause | Severity |
|-------|-----------|----------|
| Android Monetization Gap | Technical performance issues (50% fewer levels completed) + Weak paid UA | Critical |
| Whale Concentration | 64 whales (0.98%) = 85.8% revenue; Fast conversion pattern (50% Day 0) | High Risk |
| Cohort LTV Decline | ARPPU collapsed 90% (Oct→Nov) — Product/pricing change likely | Critical |

### Cross-Cutting Insights

1. All three issues are interconnected: Android's poor conversion → fewer Android whales → revenue concentration risk
2. The cohort LTV decline is NOT an observation window effect — it's a product/pricing problem affecting all channels equally
3. Whale behavior is highly predictable — 50% convert Day 0, 42% start with SKU_4, 55% reach whale status within 1 day

---

## 1. Android Monetization Gap Deep-Dive

### 1.1 The Core Problem

Android has a **13.9x lower conversion rate** than iOS (0.023% vs 0.372%), generating only **5.1% of revenue** despite having 52% more users.

| Metric | Android | iOS | Gap |
|--------|---------|-----|-----|
| Users | 1,812,217 | 1,650,378 | +9.8% Android |
| Payers | 419 | 6,132 | -93.2% |
| Conversion Rate | 0.023% | 0.372% | -93.9% |
| ARPPU | $11.51 | $14.59 | -21.1% |
| Revenue | $4,823 | $89,443 | -94.6% |

### 1.2 Root Causes Identified

**Primary: Technical Performance Issues (High Confidence)**

Evidence: Android users complete 50% fewer levels despite similar session counts

| Metric | Android | iOS | Insight |
|--------|---------|-----|---------|
| Sessions/User | 4.2 | 4.75 | Only 13% difference |
| Levels/User | 9.73 | 19.6 | 101% gap |
| Levels/Session | 2.3 | 4.1 | iOS 78% more efficient |

Hypothesis: Android users open the app but experience technical friction (crashes, lag, performance issues on lower-end devices) that prevents gameplay progression.

**Secondary: Weak Paid User Acquisition**

| Channel | Android Payers | iOS Payers | Android ARPPU |
|---------|---------------|------------|---------------|
| Organic | 597 (93%) | 8,731 (87%) | $6.12 |
| Facebook | 25 (3.9%) | 673 (6.7%) | $25.09 |
| Google | 19 (3.0%) | 486 (4.8%) | $23.30 |

Finding: 93% of Android payers are organic with $6.12 ARPPU. Paid channels (Facebook/Google) show 4x higher ARPPU but are severely underutilized on Android.

**NOT the Problem: Price Sensitivity**

Both platforms show identical purchase distribution (76-77% in $0-5 range). The issue is conversion volume, not pricing resistance.

### 1.3 Key Evidence — Pre-Purchase Behavior

| Metric | Android | iOS |
|--------|---------|-----|
| Median Days to Purchase | 7 days | 3 days |
| Median Sessions Before | 3 | 7 |
| Median Levels Before | 16 | 37 |

**Paradox:** Android users purchase FASTER but with LESS engagement — suggesting frustration-based purchases rather than value-based conversion.

---

## 2. Whale User Profile Analysis

### 2.1 Whale Demographics

64 whale users (purchased 5+ products) generated **$8,690** with average LTV of **$135.78**.

| Attribute | Value | Insight |
|-----------|-------|---------|
| iOS Whales | 60 (93.8%) | Platform dominates |
| Android Whales | 4 (6.2%) | Severely underrepresented |
| iOS Avg LTV | $131.25 | — |
| Android Avg LTV | $203.84 | 55% higher |
| Organic | 40 (62.5%) | Organic drives whales |
| AppLovin | 12 (18.8%) | Best paid channel |

**Critical Insight:** Android has only 4 whales but they spend 55% more. Fixing Android conversion could unlock significant whale revenue.

### 2.2 Whale Prediction Signals

| Signal | Value | Strength |
|--------|-------|----------|
| Day 0 Conversion | 50% of whales | Strongest |
| First Product = SKU_4 | 42% of whales | Strong |
| iOS Platform | 93.8% of whales | Demographic |
| Organic Acquisition | 62.5% of whales | Channel |
| Rapid Product Expansion | 55% whale in 1 day | Behavioral |

### 2.3 Time to Whale Status

Whale behavior is **FAST**:

| Milestone | % of Whales |
|-----------|-------------|
| First purchase on Day 0 | 50% |
| Whale status (5 products) on Day 0 | 28% |
| Whale status within 1 day | 55% |
| Whale status within 2 days | 67% |
| Whale status within 1 week | 88% |

**Key Takeaway:** If a user doesn't show whale behavior within the first week, they're unlikely to become one.

---

## 3. Cohort LTV Decline Investigation

### 3.1 The ARPPU Collapse

| Month | Revenue | Payers | ARPPU | Change |
|-------|---------|--------|-------|--------|
| Oct 2025 | $122,601 | 955 | $128.38 | — |
| Nov 2025 | $82,672 | 6,117 | $13.52 | -89.5% |

**Critical Finding:** Despite 6x more payers in November, revenue dropped 33%. This is an **ARPPU collapse**, not a volume problem.

### 3.2 Root Cause Analysis

**Primary Hypothesis: Product/Pricing Change (95% Confidence)**

Evidence: ALL channels show identical ~90% ARPPU decline:

| Channel | Oct ARPPU | Nov ARPPU | Decline |
|---------|-----------|-----------|---------|
| Organic | $117.58 | $13.34 | -88.7% |
| AppLovin | $129.55 | $13.51 | -89.6% |
| Restricted | $201.54 | $14.59 | -92.8% |
| TikTok | $135.23 | $13.01 | -90.4% |

Uniform decline rules out channel quality — the problem is product-side.

**Most Likely Causes:**

1. Introduction of low-priced starter packs ($1-5 items)
2. Promotional pricing cannibalizing premium IAPs
3. Product catalog shift away from high-value items
4. Whale development funnel disrupted

### 3.3 What It Is and Isn't

The cohort LTV decline is **NOT**:
- An observation window effect
- Channel quality deterioration
- Platform mix shift

The cohort LTV decline **IS**:
- A product/pricing change affecting all users equally
- Disrupting whale development (whales generate 86% of revenue)
- Trading revenue quality for payer volume

---

## 4. Interconnected Issues

The three issues form a reinforcing cycle:

1. **Android Technical Issues** → Low Android Conversion → Few Android Whales
2. **Product/Pricing Change** → ARPPU Collapse → Revenue Decline
3. **Whale Development Disrupted** → Revenue Concentration Risk

Breaking the cycle requires:
1. Fixing Android technical performance
2. Reverting/reviewing product pricing changes
3. Protecting whale development funnel

---

## 5. Recommended Investigations

### Immediate (This Week)

| Investigation | Owner | Expected Insight |
|--------------|-------|-----------------|
| Android crash/performance audit | Engineering | Identify technical blockers |
| Product catalog audit (Oct vs Nov) | Product | Confirm pricing changes |
| Payment funnel analysis | Product | Quantify checkout friction |

### High Priority (This Month)

| Investigation | Owner | Expected Insight |
|--------------|-------|-----------------|
| Android paid UA test | Marketing | Validate $25+ ARPPU from Facebook/Google |
| Whale emergence rate by cohort | Analytics | Separate observation window from real decline |
| D7/D14 LTV by install cohort | Analytics | Track whale funnel health |

### Strategic (Ongoing)

| Investigation | Owner | Expected Insight |
|--------------|-------|-----------------|
| SKU_4 optimization | Product | Improve whale entry point |
| Day 0 conversion tactics | Product | Capture 50% whale potential |
| Asian market expansion | Marketing | High ARPPU ($300-500) opportunity |

---

## 6. Data Methodology

### Data Sources

| Table | Records | Coverage |
|-------|---------|----------|
| stores_rawdata | 77,759 | IAP transactions, revenue |
| events_hybrid | 2.8B | User behavior events |
| installs | 1.3M | Install cohorts |

### Key Definitions

| Metric | Definition |
|--------|-----------|
| Whale | User who purchased 5+ distinct products |
| ARPPU | Total Revenue / Unique Paying Users |
| Conversion Rate | Paying Users / Total Users |
| Day 0 Conversion | First purchase on same day as install |

### Analysis Limitations

- Cohort LTV analysis used revenue-month aggregations instead of true install-cohort tracking due to query resource limits
- Some engagement metrics (session duration, specific level completion patterns) require additional data queries
- Product-level analysis for cohort LTV decline requires follow-up investigation`;

const REVENUE_NORMAL_REPORT = `# Revenue Anomaly Report

## Executive Summary

All metrics within expected range. Revenue up **3%** day-over-day ($13.7K → $14.1K). No anomalies detected across any monitored dimensions.

## Key Findings

| Metric | Current | 7d Avg | Change |
|--------|---------|--------|--------|
| Revenue | $14.1K | $13.7K | ▲ 3% |
| Cart Abandonment | 26% | 25.8% | — flat |
| Sessions | 3,102 | 2,980 | ▲ 4% |
| Conversion | 2.5% | 2.4% | ▲ 0.1pp |
| Avg Order Value | $48.60 | $47.90 | ▲ 1.5% |

## Category Performance

| Category | Revenue | vs 7d Avg |
|----------|---------|-----------|
| Electronics | $9.6K | ▲ 4% |
| Appliances | $2.1K | ▲ 2% |
| Computers | $1.4K | — flat |
| Other | $1.0K | ▲ 1% |

## Recommendations

No action required. All KPIs are healthy. Continue monitoring at standard cadence.`;

const HEALTH_CHECK_REPORT = `# Store Health Check Report

## Executive Summary

Moderate anomaly detected in checkout conversion. Overall store health is **B+** — most metrics are within range but checkout conversion dipped below the alert threshold.

## Key Findings

| Metric | Current | Threshold | Status |
|--------|---------|-----------|--------|
| Uptime | 99.97% | 99.9% | Pass |
| Avg Response Time | 245ms | 500ms | Pass |
| Error Rate | 0.12% | 0.5% | Pass |
| Checkout Conversion | 2.1% | 2.3% | Warning |
| Cart Abandonment | 31% | 30% | Warning |

## Checkout Analysis

Conversion dropped from 2.4% to 2.1% over the past 48 hours. The decline is gradual rather than sudden, suggesting a behavioral shift rather than a technical issue.

### Possible Causes

1. **Seasonal pattern** — similar dip observed in comparable periods last quarter
2. **Price sensitivity** — AOV increased 8% this week (higher-priced items in cart)
3. **Inventory** — 3 popular SKUs went out of stock yesterday

## Recommendations

1. Monitor checkout conversion for 24 more hours before acting
2. Review the 3 out-of-stock SKUs and their impact on conversion
3. Consider whether the AOV increase is masking a volume problem`;

// ── Pre-seeded messages for runs ──

function makeMessages(runSummary: string): ChatMessage[] {
  return [
    {
      id: "scout-msg-1",
      role: "sentinel",
      content: runSummary,
      timestamp: Date.now(),
    },
  ];
}

function makeMessagesWithChat(runSummary: string): ChatMessage[] {
  return [
    {
      id: "scout-msg-1",
      role: "sentinel",
      content: runSummary,
      timestamp: Date.now() - 3600000,
    },
    {
      id: "scout-msg-2",
      role: "user",
      content: "Why are Android whales spending more than iOS whales if Android conversion is so much worse?",
      timestamp: Date.now() - 3500000,
    },
    {
      id: "scout-msg-3",
      role: "sentinel",
      content:
        "Great question. The 4 Android whales have an average LTV of **$203.84** vs **$131.25** for iOS whales — 55% higher. This is likely a **survivorship effect**: Android's technical friction filters out casual spenders, so only the most motivated users convert. Those who push through the performance issues are inherently higher-intent.\n\nThe implication is significant: if we fix Android's technical problems, we wouldn't just get more payers at the current $11.51 ARPPU — we'd likely unlock a whale pipeline with higher LTV than iOS.",
      timestamp: Date.now() - 3400000,
    },
    {
      id: "scout-msg-4",
      role: "user",
      content: "What's the most urgent thing to fix first?",
      timestamp: Date.now() - 3300000,
    },
    {
      id: "scout-msg-5",
      role: "sentinel",
      content:
        "The **ARPPU collapse** is the most urgent. Revenue dropped from $128.38 to $13.52 per payer in one month — that's a 90% decline across every channel. This suggests a product or pricing change went live between October and November that's cannibalizing premium purchases.\n\nI'd recommend:\n1. **Audit the product catalog** — compare Oct vs Nov SKU pricing and availability\n2. **Check for new starter packs** — low-priced items may be displacing premium IAPs\n3. **Review whale funnel** — are new users still reaching 5+ purchases at the same rate?\n\nThe Android fix is critical too, but it's a longer-term engineering effort. The ARPPU issue could potentially be reversed with a pricing rollback.",
      timestamp: Date.now() - 3200000,
    },
  ];
}

// ── Scout data ──

const SCOUTS: Scout[] = [
  {
    id: "s-1",
    name: "Weekly UA Scout",
    description: "Monitors user acquisition metrics and flags anomalies",
    prompt: "Give me a product deep-dive for the app. It should follow the instructions I am giving and try to rationalise the data to the extent possible. Avoid external benchmarks for now:\n1. Key milestones that a new user crosses in the app\n2. Overall milestone completion funnel (on D0 and week 0)\n3. Retention - D1, D3, D7, D15, D30, D60\n4. Retention by D0 milestone completion - D1, D3, D7, D15, D30, D60\n\nCompare the results with last report if any.",
    schedule: "Weekly",
    scheduleDay: "Monday",
    status: "Active",
    playbook: {
      id: "store-health-check",
      name: "Store Health Check",
    },
    emailRecipients: ["admin@example.com"],
    lastRun: "2 hours ago",
    runCount: 14,
    runs: [
      {
        id: "r-1-1",
        number: 14,
        runAt: "Today, 9:00 AM",
        grade: "B+",
        summary: "Moderate anomaly in checkout conversion",
        report: HEALTH_CHECK_REPORT,
        messages: makeMessages(
          "I've completed the weekly health check. Checkout conversion dipped below the alert threshold at 2.1%. Most other metrics are healthy. The full report is on the right — let me know if you want to dig into anything."
        ),
      },
      {
        id: "r-1-2",
        number: 13,
        runAt: "Last Monday, 9:00 AM",
        grade: "A",
        summary: "All metrics within expected range",
        report: REVENUE_NORMAL_REPORT,
        messages: makeMessages(
          "Weekly health check complete. All metrics are within expected range. Revenue is up 3% day-over-day. No action needed."
        ),
      },
    ],
  },
  {
    id: "s-2",
    name: "Daily Revenue Scout",
    description: "Tracks revenue trends and alerts on significant drops",
    prompt: "Run a daily revenue anomaly scan. Check revenue vs 7-day average, cart abandonment rate, session count, and conversion rate. Flag any metric that deviates more than 10% from the 7-day average. Include device-level breakdown if anomalies are found.",
    schedule: "Daily",
    status: "Active",
    playbook: {
      id: "revenue-anomaly-scan",
      name: "Revenue Anomaly Scan",
    },
    emailRecipients: ["admin@example.com", "team@example.com"],
    lastRun: "6 hours ago",
    runCount: 42,
    runs: [
      {
        id: "r-2-1",
        number: 42,
        runAt: "Today, 8:00 AM",
        grade: "A",
        summary: "Android gap critical · ARPPU collapsed 90% · 64 whales = 86% revenue",
        report: REVENUE_REPORT,
        messages: makeMessagesWithChat(
          "I've completed the revenue deep-dive. Three critical findings: Android conversion is **13.9x lower** than iOS despite 52% more users, ARPPU collapsed **90%** from Oct to Nov ($128 → $13.52), and just 64 whale users generate **85.8%** of all revenue. These issues are interconnected — the full report is on the right."
        ),
      },
      {
        id: "r-2-2",
        number: 41,
        runAt: "Yesterday, 8:00 AM",
        grade: "A",
        summary: "All metrics normal. Revenue +3%",
        report: REVENUE_NORMAL_REPORT,
        messages: makeMessages(
          "Daily revenue scan complete. All metrics within expected range. Revenue up 3% day-over-day. No anomalies detected."
        ),
      },
      {
        id: "r-2-3",
        number: 40,
        runAt: "Feb 15, 8:00 AM",
        grade: "B+",
        summary: "Moderate anomaly in checkout conversion",
        report: HEALTH_CHECK_REPORT,
        messages: makeMessages(
          "Revenue scan flagged a moderate anomaly in checkout conversion. It dropped from 2.4% to 2.1% over 48 hours. Could be seasonal — see full report for details."
        ),
      },
      {
        id: "r-2-4",
        number: 39,
        runAt: "Feb 14, 8:00 AM",
        grade: "A",
        summary: "Strong performance across all KPIs",
        report: REVENUE_NORMAL_REPORT,
        messages: makeMessages(
          "All clear. Revenue, sessions, and conversion all within healthy range."
        ),
      },
      {
        id: "r-2-5",
        number: 38,
        runAt: "Feb 13, 8:00 AM",
        grade: "A",
        summary: "Normal day, no anomalies",
        report: REVENUE_NORMAL_REPORT,
        messages: makeMessages(
          "Standard day. All metrics in expected range."
        ),
      },
      {
        id: "r-2-6",
        number: 37,
        runAt: "Feb 12, 8:00 AM",
        grade: "C",
        summary: "ARPPU decline detected · whale funnel under pressure",
        report: REVENUE_REPORT,
        messages: makeMessages(
          "Revenue deep-dive flagged early signs of ARPPU decline and whale concentration risk. Android monetization gap remains critical. See full report for root cause analysis and recommended investigations."
        ),
      },
    ],
  },
  {
    id: "s-3",
    name: "Retention Health Check",
    description: "Weekly scan of retention cohorts and churn indicators",
    prompt: "Analyze retention cohorts for the past week. Break down by D1, D3, D7, D15, D30 retention. Compare with previous week's cohorts. Flag any cohort with >5% drop in retention vs prior period.",
    schedule: "Weekly",
    scheduleDay: "Monday",
    status: "Paused",
    playbook: {
      id: "store-health-check",
      name: "Store Health Check",
    },
    emailRecipients: ["admin@example.com"],
    lastRun: "3 days ago",
    runCount: 8,
    runs: [],
  },
  {
    id: "s-4",
    name: "Revenue Anomaly Scan",
    description:
      "Early morning check for revenue anomalies before business hours",
    prompt: "Pre-market revenue check. Scan overnight revenue, compare with expected run rate. Check for payment processing issues, unusual refund spikes, or conversion drops. Alert if revenue is tracking >15% below forecast.",
    schedule: "Daily",
    status: "Active",
    playbook: {
      id: "revenue-anomaly-scan",
      name: "Revenue Anomaly Scan",
    },
    emailRecipients: ["team@example.com"],
    lastRun: "18 hours ago",
    runCount: 31,
    runs: [
      {
        id: "r-4-1",
        number: 31,
        runAt: "Today, 6:00 AM",
        grade: "A",
        summary: "All clear, no anomalies before market open",
        report: REVENUE_NORMAL_REPORT,
        messages: makeMessages(
          "Early morning scan complete. All revenue metrics within expected range. No anomalies to flag before business hours."
        ),
      },
    ],
  },
  {
    id: "s-5",
    name: "Cart Abandonment Monitor",
    description: "Tracks cart abandonment rate spikes and conversion drops",
    prompt: "Monitor cart abandonment rate every 6 hours. Compare with rolling 24h average. Break down by device type, category, and time of day. Alert if abandonment rate exceeds 30% or increases >5pp from baseline.",
    schedule: "Every 6 hours",
    status: "Active",
    playbook: {
      id: "store-health-check",
      name: "Store Health Check",
    },
    emailRecipients: ["admin@example.com", "team@example.com"],
    lastRun: "1 hour ago",
    runCount: 87,
    runs: [
      {
        id: "r-5-1",
        number: 87,
        runAt: "1 hour ago",
        grade: "A",
        summary: "Cart abandonment at 26%, within range",
        report: REVENUE_NORMAL_REPORT,
        messages: makeMessages(
          "Cart abandonment check complete. Rate at 26%, within normal range. No spikes detected."
        ),
      },
    ],
  },
];

export function getScouts(): Scout[] {
  return SCOUTS;
}

export function getScout(id: string): Scout | undefined {
  return SCOUTS.find((s) => s.id === id);
}

export function getScoutRuns(scoutId: string): ScoutRun[] {
  const scout = getScout(scoutId);
  return scout?.runs ?? [];
}
