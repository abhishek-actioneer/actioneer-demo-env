import type { ChatEntry } from "@/lib/sidebar-config";
import type { ChatMessage, SubagentInfo } from "@/lib/types";
import { getAgentDisplay } from "@/hooks/use-classify";

export const INITIAL_CHATS: ChatEntry[] = [
  { id: "funnel", title: "Shopping funnel analysis" },
  { id: "revenue", title: "Revenue trends" },
  { id: "brands", title: "Top brands breakdown" },
  { id: "retention", title: "Customer retention" },
  { id: "categories", title: "Category performance" },
  { id: "patterns", title: "Hourly purchase patterns" },
];

// ── Pre-loaded conversations (eCommerce) ──

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

export const PRELOADED: Record<string, ChatMessage[]> = {
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
    { id: "f-r", role: "sentinel", content: "", timestamp: 4, variant: "report-cta" },
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
    { id: "ret-r", role: "sentinel", content: "", timestamp: 4, variant: "report-cta" },
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
};

export function getPreloadedMessages(chatId: string): ChatMessage[] {
  return PRELOADED[chatId] ?? [];
}
