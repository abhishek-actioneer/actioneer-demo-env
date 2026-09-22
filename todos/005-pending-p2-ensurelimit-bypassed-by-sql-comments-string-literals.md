---
status: complete
priority: p2
issue_id: "005"
tags: [code-review, security, sql-executor]
dependencies: ["003"]
---

# ensureLimit bypassed by SQL comment or string literal containing "LIMIT"

## Problem Statement

`ensureLimit()` uses a plain `/\bLIMIT\b/i` regex on the raw SQL string. This regex is not comment-aware or string-literal-aware. Two bypass patterns:

**Comment bypass:**
```sql
SELECT * FROM events -- LIMIT 1
SELECT * FROM events /* LIMIT 1 */
```
`ensureLimit` sees `LIMIT` in the comment, returns SQL unchanged. DuckDB ignores the comment token and runs an unbounded query, materializing potentially millions of rows before the JS `.slice(0, 500)` truncates.

**String literal bypass:**
```sql
SELECT * FROM events WHERE event_name LIKE '%LIMIT%'
```
Same result — `LIMIT` in a string literal triggers early return.

The JS `.slice(0, 500)` still caps what's *returned*, but DuckDB fully materializes the result set in native memory first, defeating the OOM-prevention goal.

## Findings

`security-sentinel` confirmed both patterns. Real-world probability: low for Gemini-generated SQL, but non-zero for LIKE queries on user-visible string fields.

## Proposed Solutions

**Option A: Accept the limitation, document it in a code comment**
- The `.slice(0, 500)` backstop still protects the client response
- DuckDB `memory_limit=256MB` still throws a recoverable error if the full result is huge
- Add a comment: `// Note: not comment/literal-aware; DuckDB memory_limit is the safety net`
- Effort: Tiny | Risk: Acceptable for a demo app

**Option B: Strip comments before checking**
```ts
const stripped = normalized.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
if (/\bLIMIT\b/i.test(stripped)) return normalized;
```
- Effort: Small | Risk: Low (comment stripping can have edge cases in strings, but rare)

**Option C: Use lastIndexOf on stripped SQL (combines with fix for 003)**
- Effort: Small | Risk: Low

## Recommended Action

Option A for a demo app. Document the limitation. The DuckDB `memory_limit` is the real safety net; `ensureLimit` is best-effort.

## Technical Details

- Affected file: `src/lib/sql-executor.ts:15-21`

## Acceptance Criteria

- [ ] Either the bypass is explicitly documented with a comment OR comment-stripping is added
- [ ] No silent unlimited queries in the happy path

## Work Log

- 2026-03-02: Found by security-sentinel on PR #29
