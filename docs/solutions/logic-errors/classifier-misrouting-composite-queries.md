---
title: "Fix composite query classification and attach follow-up actions to direct responses"
date: 2026-02-16
category: logic-errors
tags:
  - classifier
  - follow-up-actions
  - direct-response
  - analytics
  - llm-prompt
severity: high
component:
  - src/app/api/classify/route.ts
  - src/app/page.tsx
symptom: |
  Composite queries combining analytics requests with action directives (e.g., "Show top 10% customers AND create segment in Firebase") were misclassified as "direct" due to action phrasing in the prompt, and follow-up actions were never attached to direct response paths.
root_cause: |
  Classifier prompt lacked explicit signals for analytics keywords (segment, SQL, integration, audience); follow-up action attachment logic was wired only into analytics event-stream handling, not direct chat responses.
status: completed
---

# Classifier Misrouting Composite Queries

## Problem

Composite queries like *"Show me the top 10% of customers with the highest value. Create the SQL and set up a segment in Firebase"* were broken in two ways:

1. The `/api/classify` prompt misclassified them as `"direct"` — the action phrasing ("Create", "set up", "Firebase") confused the LLM into thinking it was a non-data request
2. Even when queries were correctly classified as direct, the direct response path never attached follow-up action buttons

**Impact:** Users asking analytics questions with action intent got a plain LLM response with no SQL, no subagent analysis, and no action buttons.

## Root Cause

### 1. Narrow classifier prompt

The system instruction in `src/app/api/classify/route.ts` only listed traditional analytics keywords (revenue, retention, conversion, etc.) but had **no mention of**:
- Segments, audiences, cohorts
- SQL, queries, database concepts
- Integrations (Firebase, CleverTap, BigQuery)
- Action verbs that imply data work (create segment, push to, export)

### 2. Follow-up actions wired to one code path only

In `src/app/page.tsx`, the `determineFollowUpActions()` call and attachment to the response message only existed inside `case "done"` of the analytics event stream handler. The direct response path (`queryMode === "direct"`) had no follow-up action logic at all.

## Solution

### Fix 1: Hardened Classifier Prompt

**File:** `src/app/api/classify/route.ts`

Updated the system instruction with three changes:

1. **Expanded analytics definition** — added segment/SQL/integration/audience keywords:
   ```
   segments, cohorts, SQL, queries, user counts, top N%, filtering,
   creating segments, pushing to integrations (Firebase, CleverTap, BigQuery),
   setting up audiences, exporting data
   ```

2. **Explicit bias rule:**
   ```
   If the query mentions data, SQL, users, segments, customers, revenue, metrics,
   database concepts, or any action that implies working with data (e.g. "create a
   segment", "push to Firebase", "set up an audience"), ALWAYS classify as "analytics"
   even if the query also asks for actions, integrations, or non-analytical steps.
   ```

3. **Concrete examples** (6 total covering composite queries):
   ```
   - "Show me the top 10% of customers... set up a segment in Firebase" -> analytics
   - "Which users bought electronics more than 3 times? Create a segment" -> analytics
   - "Create a segment of high-value users and push to CleverTap" -> analytics
   - "Hello, what can you do?" -> direct
   ```

### Fix 2: Follow-Up Actions on Direct Responses

**File:** `src/app/page.tsx`

After `streamDirectResponse` completes and the streaming variant is cleared, generic follow-up actions are now attached:

```typescript
const directActions: FollowUpAction[] = [
  { id: "schedule-report", label: "Schedule Report", icon: "calendar-clock", type: "schedule-report" },
  { id: "share-slack", label: "Share via Slack", icon: "share-2", type: "share-slack" },
  { id: "set-alert", label: "Set Alert", icon: "bell", type: "set-alert" },
];
setMessages((prev) =>
  prev.map((m) => m.id === responseMsgId
    ? { ...m, variant: undefined, followUpActions: directActions }
    : m
  )
);
```

Direct responses intentionally **do not** get "Create Segment" or "Refine Filters" — those require subagent SQL to extract user_id queries from.

## Verification Steps

1. Ask: *"Show me the top 10% of customers with the highest value. Create the SQL and then set up a segment in Firebase"* -> analytics path, SQL results, "Create Segment" + "Push" pills
2. Ask: *"Hello, what can you do?"* -> direct path, generic follow-up actions (Schedule Report, Share, Alert)
3. Ask: *"What's the average order value by category?"* -> analytics path, action pills appear

## Prevention Strategies

### Classifier Drift Prevention

- **Keyword inventory:** Maintain a curated list of analytics-signal keywords and update whenever a misclassification occurs
- **Bias rule tiers:** Organize override rules by strength (data + action verbs = always analytics)
- **Negative examples:** For every misclassification, add a counter-example to the prompt

### Feature Parity Across Code Paths

- **Checklist before shipping:** Every new feature that affects UX must be verified in both the analytics AND direct response paths
- **Extract shared utilities:** When the same feature applies to multiple paths, extract it into a reusable function rather than duplicating inline

### Suggested Test Cases

```typescript
// Composite queries must classify as analytics
const COMPOSITE_CASES = [
  "Show me revenue by category and export to CSV",
  "Find customers who churned and create a segment",
  "Set up a segment for users who viewed 5+ products",
  "Create a segment of high-value users and push to Firebase",
];

// Paraphrase robustness
const PARAPHRASE_VARIANTS = [
  "Show me top customers and create a segment",
  "Create a segment for my top customers",
  "I want to identify top customers and set up a segment",
  "Top customers — segment creation needed",
];

// Pure direct queries must stay direct
const DIRECT_CASES = [
  "Hello, what can you do?",
  "Thanks!",
  "How do I use this tool?",
];
```

## Related Documentation

- `docs/brainstorms/2026-02-16-segments-and-actions-brainstorm.md` — original brainstorm for segments/actions feature
- `docs/reviews/race-conditions-review-segments-plan.md` — race conditions review for segments plan
- `src/lib/action-heuristic.ts` — follow-up action determination logic
- `src/lib/types.ts` — `FollowUpAction` type definition
