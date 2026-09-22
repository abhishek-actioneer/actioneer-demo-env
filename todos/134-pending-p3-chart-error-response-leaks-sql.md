---
status: pending
priority: p3
issue_id: "134"
tags: [code-review, security, chart-requery, pr-48]
dependencies: []
---

# chart-requery error responses leak full transformed SQL to client

## Problem Statement

`src/app/api/chart-requery/route.ts` returns the full transformed SQL in error responses:

```ts
if (result.error) {
  return NextResponse.json(
    { error: result.error, sql: transformed },  // ← leaks SQL
    { status: 422 },
  );
}
```

On execution failure, the client receives the exact SQL that was executed — including table names, column names, and transformations. An attacker who crafts a query that fails receives internal schema intelligence that can accelerate further attacks.

## Findings

Source: Security Sentinel.

- `chart-requery/route.ts:96–100` — `sql: transformed` in 422 response body
- Severity: Low (requires authenticated access + a failing query)
- Information disclosure risk: exposes internal table/column naming conventions

## Proposed Solutions

**Option A (Recommended): Log SQL server-side only**
```ts
if (result.error) {
  console.error("[chart-requery] SQL error:", result.error, "\nSQL:", transformed);
  return NextResponse.json({ error: result.error }, { status: 422 });
}
```

## Recommended Action

Option A — remove `sql: transformed` from response, add server-side logging.

## Technical Details

- **Affected files:** `src/app/api/chart-requery/route.ts:96–100`

## Acceptance Criteria

- [ ] 422 error response does not include `sql` field
- [ ] SQL is logged server-side on error for debugging

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-23 | Created during PR #48 review (security-sentinel) | |

## Resources

- PR #48: Unified Chart System + Server Persistence
