import type { Conversation } from "./conversation-types";
import type { SubagentInfo, ChatMessage } from "@/lib/types";
import { getAgentDisplay } from "@/hooks/use-classify";

// ── Helpers (moved from page.tsx) ──

const CANONICAL_AGENT_IDS = [
  "data-quality", "daily-metrics", "cohort-retention",
  "rev-opt", "user-segmentation", "geographic",
];

function makeCompleteSubs(): SubagentInfo[] {
  return CANONICAL_AGENT_IDS.map((id) => {
    const def = getAgentDisplay(id);
    return {
      id: def.id, name: def.name, icon: def.icon,
      status: "complete" as const,
      queries: [], expectedQueryCount: 0,
    };
  });
}

function makeCritiqueSub(): SubagentInfo[] {
  const def = getAgentDisplay("critique");
  return [{
    id: def.id, name: def.name, icon: def.icon,
    status: "complete" as const,
    queries: [], expectedQueryCount: 0,
  }];
}

// ── Preloaded message sets ──

const PRELOADED_MESSAGES: Record<string, ChatMessage[]> = {
  funnel: [
    { id: "f-u", role: "user", content: "Show me the shopping funnel: views to cart to purchase", timestamp: 1 },
    { id: "f-a", role: "agent", content: "", timestamp: 2, agent: { status: "complete", taskCount: 3, subagents: [...makeCompleteSubs(), ...makeCritiqueSub()] } },
    { id: "f-s", role: "sentinel", content: `## Shopping Funnel Analysis

| Stage | Users | Conversion Rate |
|-------|-------|----------------|
| View | 2,360,076 | 100% |
| Add to Cart | 487,312 | 20.6% |
| Purchase | 211,073 | 8.9% (43.3% of cart) |

### Key Findings

The overall **view-to-purchase conversion rate is 8.9%**, which is strong for a multi-category eCommerce store. The **cart-to-purchase rate of 43.3%** suggests moderate cart abandonment.

### Drop-off Analysis

- **79.4% of users** never add anything to cart — this is the biggest opportunity
- **56.7% of cart additions** don't convert to purchase — cart abandonment is significant
- Electronics and appliances have the highest cart abandonment rates due to higher price points

**Data Period:** Nov 1-16, 2019 | **Users Analyzed:** 2.36M | **Total Revenue:** $115.3M`, timestamp: 3 },
  ],
  revenue: [
    { id: "r-u", role: "user", content: "What are the daily revenue trends?", timestamp: 1 },
    { id: "r-a", role: "agent", content: "", timestamp: 2, agent: { status: "complete", taskCount: 1, subagents: makeCritiqueSub() } },
    { id: "r-s", role: "sentinel", content: `### Daily Revenue Trends (Nov 1-16, 2019)

| Date | Revenue | Purchases | Avg Order Value |
|------|---------|-----------|----------------|
| Nov 1 | $7.2M | 13,400 | $537 |
| Nov 2 | $6.8M | 12,800 | $531 |
| Nov 5 | $7.5M | 14,100 | $532 |
| Nov 10 | $7.1M | 13,200 | $538 |
| Nov 15 | $7.4M | 13,900 | $532 |

Revenue is relatively stable around **$7.0-7.5M per day** with an average order value of ~$534. Weekend days show slightly lower volume but comparable AOV.

Would you like a breakdown by category or brand?`, timestamp: 3 },
  ],
  brands: [
    { id: "b-u", role: "user", content: "Which are the top performing brands by revenue?", timestamp: 1 },
    { id: "b-a", role: "agent", content: "", timestamp: 2, agent: { status: "complete", taskCount: 1, subagents: makeCritiqueSub() } },
    { id: "b-s", role: "sentinel", content: `### Top 10 Brands by Revenue

| Brand | Revenue | Purchases | Avg Price | Buyers |
|-------|---------|-----------|-----------|--------|
| apple | $24.8M | 28,400 | $873 | 22,100 |
| samsung | $18.2M | 31,200 | $583 | 25,800 |
| huawei | $5.1M | 9,800 | $520 | 8,200 |
| xiaomi | $4.3M | 12,100 | $355 | 10,400 |
| lg | $3.1M | 5,400 | $574 | 4,600 |

**Apple** leads in revenue despite fewer purchases than Samsung, driven by a significantly higher average price ($873 vs $583). **Samsung** leads in purchase volume and unique buyers.

Would you like to see the conversion rates per brand?`, timestamp: 3 },
  ],
  retention: [
    { id: "ret-u", role: "user", content: "How does customer retention look? What's the repeat purchase rate?", timestamp: 1 },
    { id: "ret-a", role: "agent", content: "", timestamp: 2, agent: { status: "complete", taskCount: 3, subagents: [...makeCompleteSubs(), ...makeCritiqueSub()] } },
    { id: "ret-s", role: "sentinel", content: `## Customer Retention Analysis

### Repeat Purchase Metrics

| Metric | Value |
|--------|-------|
| Total Paying Users | 211,073 |
| One-time Buyers | 168,858 (80%) |
| Repeat Buyers (2+) | 42,215 (20%) |
| Revenue from Repeat Buyers | ~45% of total |

### Key Insights

1. **80% of buyers are one-time purchasers** — significant retention opportunity
2. **Repeat buyers contribute ~45% of revenue** despite being only 20% of the customer base
3. **Average gap between purchases** for repeat buyers is ~3-5 days within this 16-day window

### Recommendations

- Focus on converting one-time buyers into repeat customers via targeted follow-up
- Investigate what differentiates the 20% who return (category, price point, brand loyalty)

**Data Period:** Nov 1-16, 2019 | **Paying Users:** 211K`, timestamp: 3 },
  ],
  categories: [
    { id: "c-u", role: "user", content: "What are the top product categories?", timestamp: 1 },
    { id: "c-a", role: "agent", content: "", timestamp: 2, agent: { status: "complete", taskCount: 1, subagents: makeCritiqueSub() } },
    { id: "c-s", role: "sentinel", content: `### Top Categories by Revenue

| Category | Revenue | Views | Conversion |
|----------|---------|-------|-----------|
| electronics | $89.2M | 18.4M | 3.8% |
| appliances | $12.1M | 4.2M | 2.1% |
| computers | $8.4M | 3.1M | 2.9% |
| furniture | $2.8M | 1.8M | 1.4% |
| clothing | $1.2M | 2.1M | 0.8% |

**Electronics dominates** with 77% of total revenue. Despite high view counts, clothing has the lowest conversion rate (0.8%), suggesting a browse-heavy category.

Want me to break down sub-categories within electronics?`, timestamp: 3 },
  ],
  patterns: [
    { id: "p-u", role: "user", content: "What are the peak shopping hours?", timestamp: 1 },
    { id: "p-a", role: "agent", content: "", timestamp: 2, agent: { status: "complete", taskCount: 1, subagents: makeCritiqueSub() } },
    { id: "p-s", role: "sentinel", content: `### Hourly Purchase Patterns

| Time Block | Purchases | Share |
|-----------|-----------|-------|
| 6AM-10AM | Low | ~8% |
| 10AM-2PM | Medium | ~22% |
| 2PM-6PM | **Peak** | ~32% |
| 6PM-10PM | High | ~28% |
| 10PM-2AM | Low | ~10% |

**Peak shopping hours are 2PM-6PM**, accounting for about a third of all purchases. There's also strong evening activity (6PM-10PM). Early morning (2AM-6AM) sees minimal activity.

Would you like to see how these patterns differ by category?`, timestamp: 3 },
  ],
  "ux-frozen": [
    { id: "uxf-u", role: "user", content: "Show me the top revenue segments and which ones are declining", timestamp: 1 },
    { id: "uxf-a", role: "agent", content: "", timestamp: 2, agent: { status: "complete", taskCount: 7, subagents: [...makeCompleteSubs(), ...makeCritiqueSub()] } },
    {
      id: "uxf-s", role: "sentinel", timestamp: 3,
      content: `## Revenue Segment Analysis

| Segment | Revenue | Users | Trend |
|---------|---------|-------|-------|
| High-Value Mobile | $42.1M | 12,448 | +8.2% |
| Desktop Power Users | $28.3M | 8,920 | +3.1% |
| New Buyers (< 30d) | $18.7M | 34,200 | -12.4% |
| Lapsed Re-engaged | $9.2M | 5,100 | -6.8% |
| Bargain Hunters | $7.4M | 22,300 | +1.2% |

### Key Findings

**High-Value Mobile users** are the strongest segment, generating $42.1M with an upward trend of +8.2%. They represent only 5% of the user base but account for 36% of revenue.

**New Buyers are declining** — the -12.4% trend signals weakening acquisition or first-purchase conversion. This cohort dropped from 39K to 34K users month-over-month.

**Lapsed Re-engaged** users also show negative momentum (-6.8%), suggesting re-engagement campaigns may need refreshing.

### Recommendations

1. **Double down on High-Value Mobile** — personalized push notifications and exclusive mobile offers
2. **Investigate New Buyer decline** — check acquisition channel performance and onboarding funnel
3. **Refresh re-engagement playbook** — current win-back campaigns showing fatigue

**Data Period:** Nov 1-16, 2019 | **Segments Analyzed:** 5 | **Total Revenue:** $115.3M`,
      followUpActions: [
        { id: "uxf-q", label: "Drill into the New Buyer decline", icon: "message-circle", type: "follow-up-question" },
        { id: "uxf-seg", label: "Create segment of declining buyers in CleverTap", icon: "users", type: "create-segment" },
        { id: "uxf-q2", label: "Which acquisition channels are most affected?", icon: "message-circle", type: "follow-up-question" },
      ],
    },
  ],
};

// ── Preseeded conversations (matches INITIAL_CHATS ordering) ──

const now = Date.now();

export const PRESEEDED_CONVERSATIONS: Conversation[] = [
  { id: "funnel", title: "Shopping funnel analysis", messages: PRELOADED_MESSAGES.funnel, createdAt: now - 6000, updatedAt: now - 6000 },
  { id: "revenue", title: "Revenue trends", messages: PRELOADED_MESSAGES.revenue, createdAt: now - 5000, updatedAt: now - 5000 },
  { id: "brands", title: "Top brands breakdown", messages: PRELOADED_MESSAGES.brands, createdAt: now - 4000, updatedAt: now - 4000 },
  { id: "retention", title: "Customer retention", messages: PRELOADED_MESSAGES.retention, createdAt: now - 3000, updatedAt: now - 3000 },
  { id: "categories", title: "Category performance", messages: PRELOADED_MESSAGES.categories, createdAt: now - 2000, updatedAt: now - 2000 },
  { id: "patterns", title: "Hourly purchase patterns", messages: PRELOADED_MESSAGES.patterns, createdAt: now - 1000, updatedAt: now - 1000 },
  { id: "ux-frozen", title: "[UX] Revenue segments with actions", messages: PRELOADED_MESSAGES["ux-frozen"], createdAt: now, updatedAt: now },
];
