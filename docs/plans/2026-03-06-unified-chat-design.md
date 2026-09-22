# Unified Persistent Chat — Design Research

**Date:** 2026-03-06
**Status:** Brainstorming / Mental Model
**Reference:** Rox (run.rox.com) persistent chat panel

---

## Problem Statement

Chat currently lives exclusively on `/` (home page). It's a full-page experience — ChatThread, ChatInput, the 6-agent analytics pipeline. Every other page (segments, playbooks, scouts, metrics, store, etc.) is a standalone CRUD/listing page with zero access to chat.

If a user is looking at their segments and wants to ask "which segment has the highest retention?", they have to navigate away to `/`, ask, then come back.

**Goal:** Make chat a persistent, context-aware layer available on every page — so Sentinel can assist users wherever they are, with awareness of what they're looking at and what they've already discovered.

---

## Reference: How Rox Does It

Analyzed 10 screenshots from run.rox.com. Key patterns:

1. **Persistent right panel** — Not a modal or overlay. A real panel sharing horizontal space with page content (~60/40 split). Page content compresses to accommodate it.

2. **Context-aware input** — Input changes based on location:
   - Account page: "Ask about the selected account" + entity badge (e.g. "Stripe")
   - Different pages shift the context automatically
   - Bottom of input has a context pill showing what entity/page is referenced

3. **Saved commands** — Horizontal scrollable cards with pre-built prompts relevant to current context ("Analyze insight", "Prep for Meetings", "Recap")

4. **Collapsible** — On some pages the panel isn't visible, replaced by a floating action button (FAB) in bottom-right. User toggles it open/closed.

5. **Full-page mode** — Multi-step commands (e.g. account report generation) expand to full left column while right side shows entity context.

6. **Empty state** — When no conversation active: "New Command" + saved commands + input. Clean, not cluttered.

---

## Mental Model: Three Layers

### Layer 1: The Shell

- Floating action button (FAB) on every page
- Clicking opens a right-side panel that compresses page content
- Panel persists across navigation — open on `/segments`, navigate to `/metrics`, stays open
- Closing returns to FAB
- Conversation state maintained across route changes

### Layer 2: Page Awareness

When the panel opens (or when navigating while open), it knows where you are and what you're looking at:

| Signal | List page (e.g. `/segments`) | Detail page (e.g. `/segments/[id]`) |
|--------|------------------------------|--------------------------------------|
| **Input placeholder** | "Ask about your segments..." | "Ask about High-Value Churners..." |
| **Context badge** | `Segments` pill on input | `High-Value Churners - 4,231 users` pill |
| **Suggested actions** | "Which segments are growing fastest?" | "Deep dive into this segment" / "Compare vs. all users" |

The actual prompt sent to the LLM gets page data injected — on a segment detail page, that means the segment's SQL definition, user count, push status. On a metric page, the formula, time series, trend.

### Layer 3: The Intersection

The most powerful layer. Because Sentinel has rich analytical history — deep research reports, SQL queries, generated segments, playbooks — the chat can surface connections between what the user has already discovered and what they're currently looking at.

Three intersection types detailed below.

---

## Intersection Type 1: Creation Provenance

**What it is:** Tracing the origin story — *this thing exists because of that conversation.*

### Segments <- Conversations

`Segment.sourceConversationId` already exists in the data model. When a user clicks "Create Segment" from a follow-up action, the conversation ID is saved.

**On `/segments/[id]`:**
> Created from your research "What drives user churn in the first 30 days?"
> Using SQL from the Cohort Retention Agent — query 2 of 3
> [Resume conversation]

We can show not just which conversation but **which specific agent and query** produced the SQL that defines this segment.

**On `/segments` (list):**
> 3 of your 8 segments were created from Sentinel research
> - "Dormant High-Value" <- "retention patterns" (Mar 2)
> - "Power Buyers" <- "revenue by user cohort" (Feb 28)
> - "New Signups Last 7d" <- "acquisition funnel analysis" (Feb 25)

### Playbooks <- Conversations

`buildPlaybookFromResearch(messages, userQuery)` creates playbooks from agent queries. Each playbook cell's SQL traces back to a specific `SubagentQuery`.

**On `/playbooks/[id]`:**
> Built from your deep research: "ROAS by acquisition channel"
> 6 agents contributed 17 queries -> 6 playbook steps
> [See original research]

Per-cell provenance possible:
> Step 1 (Data Quality) — from Data Quality Agent, Q1
> Step 2 (Daily Metrics) — from Daily Metrics Agent, Q2

### Knowledge <- Conversations

`handleSaveToKnowledge` saves text from chat. Selection popup also saves to knowledge. Currently no tracking of which conversation it came from.

**On `/knowledge`:**
> "Peak ordering hours are 6-8pm on weekdays"
> Saved from your research "daily engagement patterns" — Mar 1
> [See in context]

### Canvas Charts <- Conversations

`PinButton` already passes `sourceConversationId` when pinning.

**On `/canvas`:**
> Revenue by Channel (bar chart)
> Pinned from "revenue optimization deep dive" — using Rev-Opt Agent Q3

### Scouts <- Playbooks <- Conversations

Three-hop provenance chain.

**On `/scouts/[id]`:**
> This scout runs the "Weekly Revenue Check" playbook
> Originally built from your research "revenue trend anomalies" — Feb 20

### Metrics <- Conversations (indirect)

When `/api/classify` detects a metric, a `MetricContextCard` is injected into the conversation.

**On `/metrics/[id]` (e.g. "Daily Active Users"):**
> Referenced in 3 conversations:
> - "How has engagement changed this month?" (Mar 4) — deep research
> - "DAU breakdown by platform" (Mar 1) — quick answer
> - "Compare DAU vs. revenue correlation" (Feb 27) — deep research

---

## Intersection Type 2: Thematic Relevance

**What it is:** No explicit link exists, but the conversation's substance is topically related to the page.

### Tagging Strategy

Derive tags at conversation save time from existing message data:

- **`agent.subagents[].id`** -> domain mapping:
  - `data-quality` -> data catalog, data quality
  - `daily-metrics` -> metrics, forecasting
  - `cohort-retention` -> segments, retention
  - `rev-opt` -> store, revenue, offers
  - `user-segmentation` -> segments
  - `geographic` -> store (geographic breakdown)
- **`metricContext.metricId`** -> specific metric
- **`followUpActions[].type`** -> intended destination (`create-segment` -> segments, `view-in-store` -> store)
- **Query text keywords** -> lightweight extraction
- **SQL table references** -> what data entities were queried

### Examples Per Page

**`/segments`:**
> Related research:
> "What user behaviors predict churn?" — yesterday
> Found 4 behavioral clusters: power users, casual browsers, deal seekers, dormant accounts
> [Open research] [Create segments from these clusters]

**`/segments/[id]` — "Deal Seekers" (manually created, no sourceConversationId):**
> Possibly related:
> "Which promotions drive repeat purchases?" — Mar 3
> The Rev-Opt agent analyzed discount-heavy buyers — similar to this segment's criteria

Fuzzy match: segment SQL mentions `discount_count > 3`, conversation SQL also filtered on discount behavior.

**`/metrics/[id]` — "Average Order Value":**
> Recent analysis:
> "Why is AOV dropping?" — Mar 3
> Found: AOV drop driven by 40% increase in first-time buyers (lower basket size)
> [Resume this analysis]

High-signal because metric ID was detected by classify and injected as MetricContextCard.

**`/store/offers`:**
> Related:
> "Which promotions drove the most revenue?" — last week
> Top 3: BOGO Holiday (32%), Flash Sale Feb (24%), New User 10% (18%)

Surfaces the actual finding, not just "a related conversation exists."

**`/data-catalog` — table detail for `events`:**
> This table was queried in 14 conversations this week
> 2 queries failed: `utm_source` column not found (referenced in "acquisition channel" research)

Data catalog becomes a living document showing actual usage and schema friction.

**`/forecasting`:**
> Your research found strong weekly seasonality in revenue
> Monday-Tuesday = 15% below average, Saturday = 22% above
> This pattern could improve forecast accuracy
> [Apply seasonality to forecast model]

**`/playbooks` (list):**
> Unsaved research with playbook potential:
> "Customer lifetime value by acquisition source" — 17 queries, 6 agents
> "Cohort retention deep dive" — 12 queries, 5 agents
> [Save as playbook]

**`/connectors`:**
> 3 conversations were limited by missing data sources:
> Google Analytics — blocked "acquisition attribution" and "UTM analysis"
> Mixpanel — blocked "funnel conversion analysis"
> [Connect Google Analytics]

---

## Intersection Type 3: Pending Actions

**What it is:** Things Sentinel suggested or the user intended to do, but haven't completed yet. Unfinished business.

### Sources of Pending Actions

1. **`followUpActions`** on messages — pills at bottom of responses
2. **`extractDeepDives()` output** — "Suggested Further Deep-Dives" parsed into actions
3. **Implicit in report text** — critique agent or synthesis may recommend actions
4. **`connectorInfo`** on messages — connector requirements not resolved

### On `/segments`

**Unacted segment creation:**
> From "high-value user retention" (2 days ago):
> "Create a segment of users with LTV > $500 who haven't purchased in 60 days"
> SQL ready — 4,231 matching users
> [Create segment] [Dismiss]

**Segment created but not pushed:**
> "Dormant High-Value" was created 3 days ago but isn't pushed to any integration
> [Push to CleverTap] [Push to Firebase]

**Multiple segments from one research:**
> Your research identified 4 user segments. You created "Power Buyers."
> 3 remaining: "Casual Browsers", "Deal Seekers", "Dormant Accounts"
> [Create all] [Pick which to create]

### On `/playbooks`

**Heavy research never converted:**
> 2 research sessions could become reusable playbooks:
> "ROAS by acquisition channel" — 17 queries, 6 agents (Mar 4)
> "Cohort retention deep dive" — 12 queries, 5 agents (Mar 1)
> [Save as playbook]

**Stale playbook:**
> "Weekly Revenue Check" hasn't run since Feb 20
> 14 days of new data available
> [Run now]

### On `/scouts`

**Recurring questions that should be automated:**
> You've asked about daily engagement trends 3 times this month
> Set up a Scout to monitor this automatically and alert you on anomalies?
> [Create Scout]

**Metric anomalies without monitoring:**
> Your analysis found a 23% DAU drop — no Scout is monitoring DAU
> [Create "DAU Monitor" Scout]

### On `/metrics`

**Ad hoc calculations that should be saved:**
> Your research computed "Customer Acquisition Cost" as
> `SUM(ad_spend) / COUNT(DISTINCT new_user_id)`
> This isn't a saved metric yet — save it?
> [Create CAC metric]

**Uninvestigated anomalies:**
> Revenue dropped 12% last week (flagged in your Mar 2 analysis)
> You asked about something else — want to investigate the revenue drop now?

### On `/store`

**Unacted `view-in-store` actions:**
> Your analysis identified 12 underperforming SKUs
> "Bottom performers by revenue/view ratio"
> [Review in catalog]

**Revenue optimization suggestions from rev-opt agent:**
> Sentinel found: Bundle A outperforms Bundle B by 3.2x at similar price points
> Consider retiring Bundle B or revising its composition

### On `/knowledge`

**Dismissed knowledge suggestions:**
> Previously dismissed insights that may still be relevant:
> "Peak ordering hours are 6-8pm on weekdays" (from Mar 1 research)
> "Mobile users convert 2.1x higher on weekends" (from Feb 28 research)
> [Add to knowledge] [Dismiss permanently]

**Contradictions with existing knowledge:**
> Your research "Q1 revenue analysis" found AOV = $47
> But knowledge base says "Average AOV is $52" (added Feb 15)
> The data may have shifted — update knowledge?
> [Update to $47] [Keep $52] [Investigate]

### On `/connectors`

**Conversations blocked by missing connectors:**
> 5 conversations in the last 2 weeks were limited by missing data:
> Google Analytics (3 conversations) — "acquisition attribution", "UTM analysis", "channel comparison"
> Stripe Billing (2 conversations) — "subscription churn", "MRR forecasting"
> [Connect Google Analytics]

### On `/canvas`

**Charts generated but never pinned:**
> 3 unpinned charts from recent research:
> Revenue by Channel (bar) — from "ROAS analysis"
> Retention Curve (line) — from "cohort retention"
> User Segments (donut) — from "segmentation deep dive"
> [Pin all to canvas]

---

## Implementation Prioritization (Proposed)

**Type 1 (Provenance)** — Easiest. Data links mostly exist (`sourceConversationId` on segments, canvas items). Just surface them in the chat panel. Low effort, high trust-building value.

**Type 3 (Pending Actions)** — Highest impact. Turns the chat panel into a proactive assistant that reminds you of unfinished work. Medium effort — need to track action completion state. Requires persisting unacted-on actions and marking them when completed.

**Type 2 (Thematic Relevance)** — Most complex. Needs conversation tagging at save time, fuzzy matching, and careful UX to avoid noise. Higher effort but makes the system feel intelligent.

---

## Open Questions

1. Should the chat panel support full deep research (6-agent timeline, report minimap) or only light conversational mode? Options:
   - **Full parity** — Panel runs deep research just like home page
   - **Light mode only** — Panel does quick answers; deep research opens home page full-screen
   - **Adaptive** — Quick answers inline, deep research auto-expands to full page

2. How should conversation tagging work for Type 2?
   - Client-side at save time (derive from message data)
   - Server-side post-processing
   - Hybrid

3. How to detect "recurring questions" for the Scout suggestion (Type 3)?
   - Semantic similarity of user queries
   - Same metric ID detected by classify
   - Same agent IDs activated

4. Panel behavior on the home page (`/`) — does the FAB appear there too, or does `/` remain the full-page chat experience?

---

## Existing Data Model Support

**Already has provenance links:**
- `Segment.sourceConversationId`
- Canvas items via `PinButton` `sourceConversationId`
- `ChatMessage.metricContext.metricId`

**Needs new fields:**
- `Playbook.sourceConversationId`
- Knowledge entries: `sourceConversationId`
- Conversation metadata: `tags[]` for thematic relevance
- Conversation metadata: `pendingActions[]` for unacted follow-ups

**Existing message data usable for tagging:**
- `agent.subagents[].id` — which agents ran
- `followUpActions[].type` — what actions were suggested
- `metricContext.metricId` — which metrics were discussed
- `variant` types — what message types were generated
