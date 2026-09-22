# Segments

## Why This Matters

Segments are the bridge between insight and action in Sentinel. A user understands "high-value users who haven't purchased in 30 days" only when they can isolate that group, activate on it, and come back to check how it's trending. If segment creation is heavy, users stay in chat describing groups over and over instead of materializing them. If the segment workspace is shallow, segments become dead-end lists — and the CEO has already flagged this: *"Segments once made is a dead-end. Impossible to ask further questions."* Segments have to feel alive.

---

## 1. Segment Creation Flow

### Why This Matters

The hardest part of creating a segment is translating a business intent ("users about to churn") into an audience definition. Users think in traits and behaviors, not SQL. The creation flow has to meet the user where they are — in chat, in a form, or when a question they just asked has already surfaced the exact group they want.

### 1a. New Segment Button

The `/segments` page has a **"New Segment"** button that opens a modal with two creation paths: Describe and Define.

| Path | Who it's for | How it works |
| --- | --- | --- |
| **Describe** | Users who know the audience but not how to query it | Natural-language textarea. LLM generates the definition from the description. |
| **Define** | Users who know the exact logic (power users, analysts) | Direct rule/expression editor with live preview count as they type. |

**Downstream flow (both paths):**

1. System generates the definition and runs it against the dataset
2. Live audience count appears ("12,483 users") with a warning if the count is suspiciously low (<10) or equals the entire user base
3. User reviews the preview — audience size, top rows, and a plain-English summary of what the segment captures
4. User can **Refine** (describe what to change, system regenerates), **Edit** (switch to Define mode to tweak logic directly), **Confirm** (saves), or **Cancel**
5. On confirm, segment is persisted, appears in the sidebar, and navigates to the segment workspace

### 1b. Chat-Native Creation

When a user says *"create a segment of users who dropped after onboarding"* in chat, Sentinel shouldn't bounce them to a modal. The intent is clear; the flow should be inline.

**Conversion flow:**

1. Classifier detects segment-creation intent and extracts the description
2. Sentinel generates the definition, runs the count, and renders a **Segment Confirm Card** inline in the chat thread
3. Card shows: suggested name (editable), plain-English summary, audience count, collapsible definition preview
4. User can **Confirm**, **Refine** (describe a change in a follow-up), or **Cancel** — all without leaving chat
5. On confirm, the card updates to a success state with a link to open the segment workspace
6. Deep Research mode does not override this — segment-creation intent always takes the confirm-card path

### 1c. Segment-from-Drop-off

After a deep research analysis surfaces a problem group (e.g., a funnel drop-off, a cohort with poor retention, users in a specific geography with low LTV), the user should be one click away from turning that finding into an activatable audience.

| Trigger | Where it appears |
| --- | --- |
| **"Create Segment"** CTA | On drop-off bars in funnel detail, churn buckets in retention detail, and drill-down results in chat |
| **"Save as Segment"** action | On any result table or chart in chat that resolves to a user list |

Clicking any of these opens the Segment Confirm Card pre-filled with the audience definition derived from the source context. No re-asking, no re-deriving.

### 1d. Starter Segments

On a brand-new dataset, the segments page is empty. That's the worst first impression — the user doesn't know what's possible.

A **"Generate Starter Segments"** button produces 8–12 dataset-aware segments covering the standard growth lenses: acquisition, activation, retention, monetization, risk. Each is validated (non-zero audience, non-universal audience) before it's shown. Regenerating replaces auto-generated segments only — user-created segments are preserved.

---

## 2. Segment Workspace

### Why This Matters

A segment is not a saved query — it's a population that changes over time. Users need to answer five questions about it without leaving the workspace: *Is it healthy? What's it made of? Who's moving in and out? How does it behave? Who's actually in it?*

The workspace splits into tabs that enforce this mental model.

### Tabs

| Tab | What it contains | Why it's separated |
| --- | --- | --- |
| **Health** | Audience size + trend, size-over-time chart, comparison against all users on key metrics, comparison against the previous period | Answers *"Is this segment growing, stable, or shrinking — and is it different from everyone else?"* |
| **Composition** | Auto-discovered breakdowns (plan, country, platform, source, tier, etc.) with distribution bars and percentages | Answers *"What is this audience made of?"* Each breakdown value is clickable to filter further. |
| **Movement** | Inflow and outflow between this segment and others — who joined, who left, overlap with similar segments | Answers *"Who's moving in, who's moving out, and where do they go?"* |
| **Explore** | A scoped analytics surface — trends, funnels, retention all run against *only* this segment's users | Answers *"How does this group behave differently?"* The same analytics tools from the rest of the product, scoped to the population. |
| **Users** | Paginated user table with search, sort, and column filters; drill into any individual user | Answers *"Who is actually in this segment?"* — the ground truth. |

### Header Actions

- **Edit** — opens the Define editor with the current logic
- **Delete** — confirmation dialog, then back to `/segments`
- **Push to integration** — sends the audience to a connected destination (Clevertap, Firebase, BigQuery); push status surfaces per destination with last-synced timestamp
- **Chat with this segment** — opens a new analytics thread pre-loaded with the segment as context. Keeps users in-product for follow-up questions instead of re-deriving the audience.

### Chat Panel Integration

The persistent chat panel on the right of the workspace is auto-scoped to the segment. Any question the user asks ("what's their average session length?", "what's the top event in the last 7 days?") runs against just these users. No @-mention needed — the context is implicit from being on the page.

---

## 3. Segment Lifecycle & Freshness

### Why This Matters

Segments drift. A segment defined as "active users in the last 30 days" means something different today than it did a month ago. Users need to know whether what they're looking at is fresh, stale, or snapshotted — and integrations pushed to external destinations need a clear contract about what gets sent.

### Segment Types

| Type | Behavior | When to use |
| --- | --- | --- |
| **Dynamic** | Definition runs fresh on every view, export, and push | Default — any segment defined by rules re-evaluates over time (most useful for ongoing campaigns, monitoring) |
| **Static (snapshot)** | Audience locked to the users who matched at creation time | One-time campaigns, A/B test cohorts, anything where the audience shouldn't drift |

### Refresh Frequency (Dynamic only)

User picks a refresh cadence: **Every 6h · Daily · Weekly · Manual**. This controls when the cached audience count updates in the sidebar and when pushes to integrations re-sync. Manual means the segment only refreshes when the user explicitly clicks refresh or opens the workspace.

### Freshness Indicators

Every segment card and detail page shows:

- **Active** — last computed within the refresh window
- **Stale** — past the refresh window but last count is still shown
- **Failed** — last refresh errored (with the error surfaced in a tooltip)
- **Snapshot** — static segment, no refresh applies

### Integration Push Behavior

When a segment is pushed to an external destination:

- Dynamic segments sync on every refresh (or on manual push)
- Static segments sync once and do not re-sync
- Push status per destination: *idle / pushing / synced / error* with timestamps
- Failed pushes show the reason inline; retrying is one click

---

## 4. Segments in Chat & Across the Product

### Why This Matters

A segment only pays off if it's easy to reference anywhere the user is thinking about users. It has to be a first-class entity across the product.

### @ Mentions

Typing `@` in any chat pulls up the entity picker. Segments appear grouped under "Segments" with their name, audience size, and type. Selecting one injects the full segment as context — the LLM can reason about its definition, its users, and its comparison to others.

### Sidebar Presence

Segments show up in the sidebar under "Segments" with live audience counts. Clicking opens the workspace. The list reflects the active dataset — switching datasets swaps the list.

### Use Anywhere It Makes Sense

Segments can be selected as:

- **Filters on charts and dashboards** (boards, metrics, explorer views) — scope any visualization to a segment
- **Audiences in playbooks** — a playbook can take a segment as a parameter input
- **Comparison groups in funnels and retention** — run the same funnel across multiple segments side-by-side
- **Guardrails in scouts** — monitor a metric only within a segment

---

## What's Deferred

| Item | Why deferred |
| --- | --- |
| Segment approval flow | Segments are lower-risk than playbooks (they describe audiences, not actions). Gating creation behind review would slow the insight loop. Revisit if destinations start driving spend or customer-facing outreach where a bad segment materially matters. |
| Nested / combined segments ("A AND NOT B") via UI | Can be done today by writing the logic directly, but a visual set-builder is deferred until demand is clear. |
| Segment overlap matrix (all vs all) | Per-segment overlap top-N is shown in the workspace. A full matrix view across all segments is a separate exploratory surface. |
| Custom refresh schedules beyond presets | Power-user need; the 6h / Daily / Weekly / Manual set covers the common cases. |
| Segment observability (alerts on size changes) | Adjacent to Scouts. Will live in the monitoring surface, not inside Segments. |

---

## Success Metrics

| Metric | What it measures | Target |
| --- | --- | --- |
| Segments created in Week 0–1 | How quickly the feature is picked up after onboarding | 10+ per workspace |
| % of segments created from chat or drop-off | Whether insight-to-audience is actually shortening | >50% (vs modal-only creation) |
| Segment workspace revisit rate | Whether segments are being used as living artifacts, not one-offs | >2 visits per segment per week |
| % of segments pushed to an integration | Whether segments are driving action, not just analysis | >30% |
