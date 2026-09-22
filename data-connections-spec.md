# Sentinel — Data Connections
## Product Spec · April 2026

---

## The Problem

Every AI analysis tool makes the same implicit promise: ask a question, get a reliable answer. That promise breaks at the data layer.

When a connected source silently changes its schema, your metrics are wrong. When event tracking has gaps, your AI has no signal to work with. When a sync fails at 2am, your morning analysis is stale. No one tells you any of this until a decision has already been made on bad data.

This is the problem Sentinel's data connections layer must solve — not just connecting to sources, but actively keeping those connections healthy, complete, and trustworthy.

---

## Who This Is For

**Primary:** Growth, product, and data teams at consumer apps who have connected one or more data sources to Sentinel and are actively using it to make decisions.

**Secondary:** Data engineers at those companies who own the pipelines feeding into Sentinel.

**Reference customer — Stable Money:**
₹4,000 crore AUM, 30 lakh customers. Fixed deposits, bonds, recurring deposits, credit cards. Data sources include 200+ bank and NBFC feeds, BSE bond data, UPI payment events, mutual fund NAVs, and KYC flows. Known issues include:
- Gains displaying incorrectly on the dashboard
- Matured FD funds delayed in reaching users
- Video KYC drop-offs with no visibility into where they happen
- UPI and NetBanking payment failures that aren't reconciled

Every one of these problems is a data connection problem. Incorrect gains is a quality failure. KYC drop-off blindness is an instrumentation gap. Payout delays are a freshness failure. Sentinel's data connections layer should surface all of these proactively — before Stable Money's users notice.

---

## Current State

Sentinel today can:
- Connect to data sources (BigQuery, AppsFlyer, Meta Ads, Stripe, and 80+ others)
- Browse the schema of connected datasets — tables, columns, types
- Run natural language queries against connected data
- Generate and manage metrics, segments, and forecasts on top of that data

What's missing is the **operational layer** — the continuous monitoring and intelligence that keeps connections honest over time. Today, if a source breaks, no one knows until a metric looks wrong and someone investigates.

---

## Vision

Data connections in Sentinel should function like a control room, not a settings page.

You connect a source once. From that point, Sentinel watches it — tracking freshness, catching schema changes, finding gaps in what's being tracked, running quality checks, and notifying you when something needs attention. When you ask the AI a question, you can trust the answer because Sentinel has been quietly verifying the data behind it.

The goal is to move data problems from reactive (a user notices something wrong) to proactive (Sentinel catches it first).

---

## Feature Areas

---

### 1. Schema Drift Detection

**The problem:** Source schemas change without warning. A bank renames a column. An event logging library gets updated. A partner changes their export format. Downstream metrics break silently.

**What Sentinel does:**
- Snapshots the schema of every connected source on each sync
- Diffs each snapshot against the previous version
- Classifies changes by severity:
  - **Breaking** — column removed, type changed, table dropped
  - **Additive** — new column, new table (safe, but worth knowing)
  - **Renamed** — high-confidence rename detection via name similarity + type matching
- Shows an impact map: which metrics, segments, and SQL queries reference the changed field
- Blocks downstream runs that would produce incorrect results, with a clear explanation of why

**Alert:** Immediate notification on breaking change. Daily digest for additive changes.

**Stable Money example:** Suryoday bank renames `fd_maturity_date` to `maturity_on`. Sentinel catches the change, flags it as breaking, surfaces the 3 metrics that use that field, and pauses their recalculation until a human confirms the mapping.

---

### 2. Instrumentation Gap Analysis

**The problem:** You can't measure what you haven't tracked. Most teams don't know what they're missing until they try to answer a question and the data isn't there. By then, the window to collect it has passed.

**What Sentinel does:**
- AI analysis of your event schema to map your actual tracking against expected coverage for your product type
- Identifies structural gaps:
  - **Missing counterpart events** — `payment_initiated` without `payment_completed` or `payment_failed`
  - **Orphaned funnels** — `onboarding_started` with no step events and no completion event
  - **Dead-end flows** — events that lead to no further events (likely a tracking drop)
  - **Missing properties** — events firing without dimensions needed for segmentation (e.g. `button_tapped` with no `screen` property)
- Generates an instrumentation coverage score per feature area
- Produces a prioritised list of gaps, ranked by how many existing questions they would unlock

**Output:** A tracking plan diff — what you have vs. what you need, with suggested event names and properties following your existing naming conventions.

**Stable Money example:** Sentinel finds `kyc_started` but no `kyc_step_1_completed`, `kyc_step_2_completed`, or `kyc_video_submitted`. It flags a full funnel gap in the KYC flow — the drop-off Stable Money is experiencing is completely invisible to their data. It suggests 4 events to add, with the exact property schema.

---

### 3. Data Quality Monitors

**The problem:** Data being present isn't the same as data being correct. Tables can be stale, rows can go missing, values can be anomalous. Without checks running continuously, bad data compounds silently into wrong decisions.

**What Sentinel does:**

**Freshness monitors**
- Tracks the last updated timestamp for each connected table
- Alerts when a table hasn't updated within its expected window (configurable; Sentinel suggests a default based on observed sync history)
- Distinguishes between connector failure (sync didn't run) and source failure (sync ran but no new data from the source)

**Completeness monitors**
- Tracks daily/hourly row counts per table and builds a rolling baseline
- Alerts on significant deviations (e.g. today's event count is 60% below the 7-day average)
- Null rate monitoring on key columns — if `user_id` is suddenly 30% null, that's a pipeline problem

**Accuracy monitors**
- Metric-level anomaly detection: if a KPI drops to 0 or spikes 10x, Sentinel flags it before it appears in a report
- Cross-source consistency: reconcile the same figure across two sources (e.g. payment amounts in your app events vs. your payment gateway)

**Custom monitors**
- Users can define their own checks in plain language: "alert me if daily active users drops below 1,000" or "flag if any FD in status='matured' has no corresponding payout event within 48 hours"

**Stable Money example:** A completeness monitor on `fd_payout_events` catches that payout records for Suryoday FDs have stopped arriving. A custom monitor flags any FD that has been in `matured` status for more than 72 hours without a corresponding disbursement record. Both fire before any customer complains.

---

### 4. Connection Health

**The problem:** Connectors fail. Syncs time out. Credentials expire. Rate limits hit. Right now there's no operational view of whether your connections are actually working.

**What Sentinel does:**
- Per-connector health dashboard with:
  - Current status: healthy / degraded / failing
  - Last successful sync timestamp
  - Sync history (30-day timeline)
  - Error log with raw messages
  - p50/p95 sync duration trends
- SLA tracking: each connector has a freshness SLA (configurable) and Sentinel tracks whether it's being met
- Credential expiry warnings before they happen (OAuth token rotation, API key expiry)
- One-click retry for failed syncs

**Aggregate view:** A single health summary across all connections — how many are green, how many need attention.

---

### 5. Sync Agents

**The problem:** Data needs to be fetched, validated, and reconciled on a schedule. Today this requires external orchestration tooling. For most app teams, that means it doesn't happen.

**What Sentinel does:**
- Scheduled sync agents per connector — set a cadence (hourly, daily, post-market-close, etc.)
- Post-sync validation agent — automatically runs quality checks after every pull; marks the sync as validated or flagged
- Reconciliation agent — cross-source, compares two tables that should agree and surfaces discrepancies
- On-demand replay — re-pull a specific time window from a source (for backfilling after a pipeline fix)
- Agent history — full log of every agent run, what it checked, what it found

**Stable Money example:** A nightly reconciliation agent compares bond NAVs from BSE against Stable Money's internal pricing table. Any discrepancy above 0.1% triggers an alert before it surfaces on the customer dashboard.

---

### 6. Notifications

**The problem:** Nothing above is useful if no one sees it.

**What Sentinel delivers:**

**Channels:**
- In-app notification centre (badge + feed)
- Email digest (configurable: immediate, daily, weekly)
- Slack (per-workspace integration, route alerts to specific channels)

**Trigger types:**
- Schema change detected (breaking changes: immediate; additive: digest)
- Quality monitor failed
- Connector sync failed or overdue
- Instrumentation gap report ready
- Reconciliation agent found discrepancies
- Credential expiry upcoming (7-day and 1-day warning)

**Notification design:**
- Every alert links directly to the affected connector, monitor, or metric
- Breaking change alerts include the impact map inline — you see what broke without navigating away
- Digest emails are scannable: status summary at top, flagged items below, all actionable

---

### 7. Data Lineage *(Phase 2)*

**The problem:** Before you change a schema or deprecate a table, you need to know what depends on it. Today this requires manual tracing through queries and metric definitions.

**What Sentinel does:**
- Builds a dependency graph: source tables → SQL queries → metrics → segments → playbooks
- Impact preview: "if this column is removed, these 4 metrics and 2 segments break"
- Change propagation: when a schema changes, Sentinel traces downstream and surfaces the full blast radius
- Visual lineage explorer: interactive graph showing how data flows through the system

---

## User Journey — Stable Money on Sentinel

1. **Connect** — Stable Money connects BigQuery (app events), BSE feed (bond data), and Razorpay (payments). Sentinel crawls each schema.

2. **Baseline** — Over the first 72 hours, Sentinel builds freshness baselines, maps instrumentation coverage, and identifies existing gaps. It surfaces a report: "You have a full KYC funnel gap. Payment failure events are missing. Bond NAV data is reconcilable with your internal table."

3. **Steady state** — Every sync is validated. Quality monitors run continuously. Schema changes are caught the moment they happen.

4. **Alert fired** — At 11pm, Suryoday bank's FD payout table stops updating. A freshness alert fires to Slack within 30 minutes. The on-call person sees it before any customer complains.

5. **Schema drift caught** — BSE changes their bond data format. Sentinel diffs the schema, identifies 2 breaking column renames, surfaces the 3 metrics that are affected, and pauses their recalculation. A Slack message links to a one-click resolution flow.

6. **Instrumentation closed** — The engineering team uses Sentinel's gap report to ship 4 new KYC tracking events. The funnel becomes fully visible. Sentinel confirms coverage is now complete and updates the coverage score.

---

## What This Is Not

- **Not a full data pipeline tool.** Sentinel doesn't replace dbt, Fivetran, or Airbyte. It sits on top of your existing pipelines and monitors them.
- **Not a BI layer.** Sentinel doesn't build dashboards. It answers questions and monitors the data behind them.
- **Not a compliance tool.** Data quality for business accuracy, not regulatory audit trails.

---

## Competitive Positioning

| Tool | What it does | Gap vs. Sentinel |
|------|-------------|-----------------|
| Monte Carlo / Acceldata | Data observability for data engineering teams | Built for engineers, not product/growth teams. No AI analysis layer. |
| dbt tests | Schema and data quality checks in the pipeline | Requires engineering to write and maintain. No natural language. |
| Fivetran / Airbyte | Data movement | Connectivity only. No quality, drift, or gap analysis. |
| Mixpanel / Amplitude | Product analytics | Event-level, single-source. No cross-source or schema-level visibility. |

Sentinel's angle: the only tool that connects data quality monitoring directly to AI-powered analysis. When a monitor fires, you don't just get an alert — you get the AI's interpretation of what it means for your business.

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Time from schema change to alert | < 1 sync cycle |
| Instrumentation gaps surfaced per new connection | ≥ 3 actionable gaps in first 72h |
| Quality monitor false positive rate | < 5% |
| Connector health visibility | 100% of connections have a health status at all times |
| Alert-to-resolution time | Baseline in month 1, improve month-on-month |

---

## Phasing

### Phase 1 — Foundation (now)
- Connection health dashboard (uptime, sync history, error log)
- Schema drift detection + impact map
- Freshness and completeness monitors
- In-app and email notifications

### Phase 2 — Intelligence
- Instrumentation gap analysis
- Sync agents with scheduling
- Accuracy monitors + anomaly detection
- Slack notifications
- Custom monitor builder (plain language)

### Phase 3 — Depth
- Cross-source reconciliation agent
- Data lineage graph
- Credential management + expiry warnings
- On-demand sync replay

---

## UI Representation

---

### Connection Health

**Where:** The connector accordion cards on `/connectors`.

Each card gets a status dot next to the connector name:

```
● BigQuery          last synced 12 min ago
● AppsFlyer         last synced 2 hours ago
● Razorpay          last synced 4 days ago     ← amber
● BSE Bond Feed     sync failed                ← red
```

Green = healthy and within freshness target. Amber = synced but late. Red = failed or never completed.

Expanding the accordion shows a health row above the dataset list:

```
Last sync    Apr 6, 11:43am   ✓ successful
Sync time    1m 42s
Next sync    Apr 6, 12:43pm (hourly)
             [Sync now]  [View history]
```

"View history" opens a 30-day timeline — a row of dots, each dot a sync, colored by outcome. Hover to see timestamp, duration, and any error message.

---

### Schema Drift

**Where:** Two places — the connector card (awareness) and the dataset detail page (resolution).

**Connector card:**
A pill appears when drift is detected:

```
● BigQuery     [1 breaking change]
```

Clicking the pill jumps straight to the drift view.

**Dataset detail page:**
A banner at the top of the affected dataset:

```
⚠ Schema change detected — Apr 5, 11pm
  fd_transactions · 1 breaking, 1 new column
  [Review changes]
```

Clicking "Review changes" opens a diff panel:

```
fd_transactions

  maturity_date   date    → REMOVED
  maturity_on     date    → ADDED (likely renamed)

  branch_code     string  → NEW COLUMN

Affected
  3 metrics use maturity_date — paused until resolved
  1 segment uses maturity_date — paused until resolved

[Confirm rename: maturity_date → maturity_on]   [Map manually]
```

One-click confirm if Sentinel is confident it's a rename. Once confirmed, paused metrics resume automatically.

---

### Data Quality Monitors

**Where:** A "Monitors" tab inside the connector detail page, alongside the existing schema/tables view.

```
Monitors                          [+ Add monitor]

Freshness
  fd_transactions        ✓  Updated 43 min ago   (target: every hour)
  payout_events          ✗  Last updated 4 days ago   (target: daily)
  bond_nav               ✓  Updated today 5:47pm

Completeness
  app_events             ✓  124k rows today  (+3% vs 7d avg)
  fd_transactions        ⚠  1,840 rows today  (-62% vs 7d avg)

Accuracy
  payment_amount         ✓  Razorpay reconciliation passed  (Apr 6)
  bond_nav               ⚠  3 NAVs deviate >0.1% from BSE feed
```

Each row is expandable. Clicking a warning shows a detail view with a bar chart of the last 7 days, a plain-language explanation of what Sentinel thinks caused it, and an "Ask Sentinel about this" button that pre-fills the chat with context.

**Accuracy monitors** surface in two places:
- On the Monitors tab for cross-source reconciliation failures (data ops problem)
- Inline on the metric card and metric detail page for anomaly detection (business problem)

```
Daily Active Users
  48,203    ⚠ Anomaly detected Apr 5 — value was 14x the 7-day average
```

---

### Instrumentation Gap Analysis

**Where:** A "Coverage" tab on the connector detail page.

```
Instrumentation Coverage               Last analysed Apr 6

Feature area        Coverage    Status
─────────────────────────────────────────────────────────
Bond purchase        100%       ████████████  Complete
FD booking            90%       ███████████░  1 gap
Onboarding            85%       ██████████░░  1 gap
Payments              55%       ███████░░░░░  3 gaps
KYC                   30%       ████░░░░░░░░  4 gaps
```

Clicking a row expands it:

```
KYC — 30% coverage

You have
  ✓ kyc_started

Missing
  ✗ kyc_step_completed    Step-level funnel visibility
  ✗ kyc_video_submitted   Can't measure video drop-off
  ✗ kyc_approved          No success confirmation event
  ✗ kyc_failed            No failure tracking

Without these, Sentinel cannot answer:
  · Where do users drop off in KYC?
  · What is the KYC completion rate?
  · How long does KYC take on average?

Suggested event schema
  kyc_step_completed
    step: "document_upload" | "video" | "selfie"
    duration_ms: number
    user_id: string

[Copy tracking plan]   [Send to engineering]
```

"Send to engineering" generates a Linear/Jira ticket or copies a formatted spec depending on what's integrated.

**Coverage score calculation (v1):** Binary presence per expected event, averaged across the set for that feature area. A missing `kyc_failed` counts the same as a missing `kyc_started`. Simple to implement and transparent — users can see exactly which events are present vs. missing. Target state (Phase 2) is question answerability: whether Sentinel can form a valid query for a set of benchmark questions per feature area.

---

### Sync Agents

**Where:** An "Agents" tab on the connector detail page.

```
Agents                              [+ New agent]

Nightly reconciliation              Active  runs daily at 11pm
  Compares bond_nav with BSE feed
  Last run: Apr 5, 11:02pm — ✓ passed (2m 14s)

Post-sync validation                Active  runs after every sync
  Checks freshness + completeness
  Last run: Apr 6, 11:43am — ✓ passed

Payout gap check                    Active  runs hourly
  Flags FDs in 'matured' status >72h with no payout
  Last run: Apr 6, 11:00am — ⚠ 3 records flagged
  [View flagged records]
```

Creating a new agent is a plain-language input:

```
Describe what you want this agent to check...

"Alert me if any FD marked as matured hasn't
received a payout event within 48 hours"

[Create agent]
```

Sentinel generates the check logic, shows what it will do, and the user confirms.

---

### Notifications

**Where:** Bell icon in the top bar. Clicking opens a side panel.

```
Notifications                    [Mark all read]

Today

  ● Breaking change  BigQuery · fd_transactions          11pm
    maturity_date removed. 3 metrics paused.
    [Review]

  ⚠ Completeness    BigQuery · fd_transactions            3am
    Row count 62% below average since 3am.
    [View monitor]

Yesterday

  ⚠ Reconciliation  Razorpay · bond_nav                  11pm
    3 NAVs deviate >0.1% from BSE feed.
    [View details]

  ✓ Coverage        BigQuery · KYC                        2pm
    kyc_step_completed added. Coverage improved 30%→55%.
```

Breaking changes always appear at the top regardless of time. Each notification is one line with a direct action link.

**Slack format for breaking changes:**

```
🔴 Sentinel · BigQuery schema change
fd_transactions · breaking change detected

maturity_date (date) was removed
maturity_on (date) was added — likely renamed

Impact: 3 metrics paused (DAU, Revenue, Retention)

Review in Sentinel →
```

---

### How it connects

The thread running through all of this: every problem surfaces at the connector card level first (a dot, a pill, a count), then the full detail lives inside the connector. The connector list is the health dashboard — clicking in gives you the tools to fix it.

---

## Page Architecture

The current connector UI has two levels:

- **L1** — `/connectors` — list of active connectors, each with datasets in an expandable accordion
- **L2** — `/connectors/[datasetId]` — dataset detail page (schema browser, tables, columns)

There is no connector-level detail page today. BigQuery as a connector has no dedicated page — it only expands inline on L1.

To support the features in this spec, a connector L2 needs to be created.

### New page: `/connectors/[connectorId]`

Connector-level concerns live here — things that apply to the connector as a whole, not to a specific dataset.

**Tabs:**
- **Datasets** — list of datasets under this connector (replaces the current inline accordion expansion)
- **Health** — sync history, last sync time, error log, retry controls
- **Monitors** — freshness, completeness, and accuracy monitors across all datasets
- **Agents** — scheduled and event-triggered agents for this connector
- **Coverage** — instrumentation gap analysis (where applicable, e.g. event sources)

### Updated dataset L2: `/connectors/[connectorId]/[datasetId]`

Or keep the existing `/connectors/[datasetId]` path and scope it to dataset-level detail only — schema browser, table explorer, column types. Monitors that are table-specific (e.g. a completeness check on one table) can surface here as well, linked from the connector-level Monitors tab.

### Navigation flow

```
/connectors
  → click connector name → /connectors/bigquery
      → Datasets tab → click dataset → /connectors/bigquery/ecommerce
      → Health tab
      → Monitors tab
      → Agents tab
      → Coverage tab
```

The L1 connector card retains its status dot and drift pill as the fast awareness layer. The connector L2 is where you go to understand and resolve.

---

## Open Questions

1. **Monitor ownership** — who configures monitors: the Sentinel user, or does Sentinel suggest and auto-configure them based on the schema?
2. **Accuracy monitor placement** — user-configured monitors vs. Sentinel-inferred ones need different presentation; how do we show monitors the user didn't set up?
3. **Source write-back** — should Sentinel eventually be able to push corrections back to a source (e.g. flag a bad record), or is it read-only?
4. **Connector coverage** — which sources get native sync agents first vs. relying on the customer's existing pipeline?
5. **Alerting thresholds** — user-configured vs. AI-inferred baselines. Both needed eventually but which ships first?
