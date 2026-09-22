---
status: pending
priority: p1
issue_id: "088"
tags: [code-review, security, segments, pr-41]
dependencies: []
---

# SQL injection via unsanitized `userIdField` in COUNT query

## Problem Statement

`src/app/api/segments/generate-all/route.ts` line 90 interpolates `userIdField` directly into a SQL template as a column identifier:

```ts
`SELECT COUNT(DISTINCT ${userIdField}) AS user_count FROM (${candidate.sql.replace(/\s*LIMIT\s+\d+\s*$/i, "")}) _sub`
```

`userIdField` comes from `ds.userIdField || "user_id"` where `ds` is deserialized from `data/datasets/<id>/config.json` — a file written by the dataset upload/enrichment route. If an attacker can influence that config file (or a future dataset registers a non-standard `userIdField`), they can inject arbitrary SQL into the column identifier position. For example, `userIdField = "x) FROM sentinel_segments --"` produces:

```sql
SELECT COUNT(DISTINCT x) FROM sentinel_segments --) AS user_count FROM (...) _sub
```

`executeSQLPrepared` cannot help here — column identifiers cannot be bound as parameters. The only safe fix is an explicit allowlist check.

## Findings

Source: Security Sentinel agent review.

- File: `src/app/api/segments/generate-all/route.ts`, lines 31 and 90
- `ds.userIdField` is set from a JSON config file, not from a hardcoded enum
- `executeSQL` validates the candidate SQL (lines 81–86) but not the count wrapper
- `LIMIT`-stripping regex on line 90 can also break multi-statement payloads if a semicolon was introduced

## Proposed Solutions

**Option A (Recommended): Validate `userIdField` format before use**
```ts
const userIdField = ds.userIdField || "user_id";
if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(userIdField)) {
  return Response.json({ error: "Invalid userIdField in dataset config" }, { status: 500 });
}
```
- Effort: Trivial | Risk: None

**Option B: Validate in `schema-loader.ts` or `DatasetConfig` type**
- Add a format check when the config is loaded/registered
- Effort: Small | Risk: Low (may reject existing non-standard configs)

**Option C: Use a hardcoded fallback list of known user ID column names**
- Only allow `["user_id", "customer_id", "account_id", "member_id"]`
- Effort: Small | Risk: Medium (may reject legitimate datasets)

## Recommended Action

Option A — add a regex guard immediately before the count query at line 90.

## Technical Details

- **Affected file:** `src/app/api/segments/generate-all/route.ts` lines 31, 90
- **Same issue** exists in the prompt template at `src/lib/prompts/segments.ts` lines 42, 46 — lower risk since it's LLM prompt context not executed SQL, but same fix applies

## Acceptance Criteria

- [ ] `userIdField` is validated against `/^[a-zA-Z_][a-zA-Z0-9_]*$/` before SQL interpolation
- [ ] A dataset config with a malicious `userIdField` value returns a 500 before executing any SQL
- [ ] Normal datasets with `"user_id"` continue to work

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-03-16 | Created during PR #41 review (security-sentinel agent) | Column identifiers cannot be parameterized — only allowlist is safe |

## Resources

- PR #41: feat: generate metric tree relationships + bulk starter segments
