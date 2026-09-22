---
status: pending
priority: p1
issue_id: "049"
tags: [code-review, security, ssrf]
dependencies: []
---

# SSRF vulnerability in /api/knowledge/fetch-url allows internal network access

## Problem Statement
`/api/knowledge/fetch-url/route.ts` accepts an arbitrary `url` string from the request body and performs `fetch(url)` with no validation. An authenticated user can fetch internal network endpoints (AWS IMDS at 169.254.169.254, internal container services, etc.). The full response body up to 100KB is returned to the caller. This exposes cloud credentials, internal service metadata, and any other data reachable from the host network.

## Findings
- **File:** `src/app/api/knowledge/fetch-url/route.ts`
- No URL scheme validation (allows `file://`, `http://`, `ftp://`)
- No private IP range blocking (allows RFC-1918 and link-local addresses)
- Exploitable via: `POST /api/knowledge/fetch-url { "url": "http://169.254.169.254/latest/meta-data/iam/security-credentials/" }`
- Auth middleware protects the route, but any authenticated user can exploit this — not just admins

## Proposed Solutions

### Option A: Scheme allowlist + private IP blocking
**Description:** Validate the URL with `new URL(url)`, reject any scheme that isn't `https:`, then resolve the hostname and reject addresses matching RFC-1918 ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16) and link-local (169.254.0.0/16). Use the `ssrf-req-filter` npm package to handle the IP resolution and range checks reliably.
**Pros:** Blocks the full SSRF surface area. Allows legitimate public HTTPS URLs. `ssrf-req-filter` is battle-tested and handles edge cases (IPv6, DNS rebinding mitigations).
**Cons:** Adds a dependency. DNS rebinding is still theoretically possible without a custom resolver; `ssrf-req-filter` mitigates but does not fully eliminate it.
**Effort:** Small
**Risk:** Low

### Option B: URL allowlist
**Description:** Only allow URLs matching a configured list of known-safe domains (set via environment variable `ALLOWED_FETCH_DOMAINS`). Reject anything not on the list.
**Pros:** Simplest possible fix. Zero false negatives on blocked domains.
**Cons:** Less flexible — any new domain needs an ops change. Does not scale if the feature is meant to fetch arbitrary user-supplied URLs.
**Effort:** Small
**Risk:** Low

## Recommended Action
<!-- Leave blank for triage -->

## Technical Details
- **Affected files:** `src/app/api/knowledge/fetch-url/route.ts`
- **Components:** Knowledge fetch API route
- **Attack vector:** Authenticated POST request with crafted `url` value
- **Impact:** Cloud credential theft (AWS IMDS), internal service enumeration, potential lateral movement

## Acceptance Criteria
- [ ] POST with `http://169.254.169.254/latest/meta-data/` returns 400
- [ ] POST with `file:///etc/passwd` returns 400
- [ ] POST with any private IP (e.g. `http://192.168.1.1`) returns 400
- [ ] POST with `http://` (non-HTTPS) returns 400
- [ ] POST with a valid public HTTPS URL succeeds and returns content

## Work Log
<!-- Dated entries as work progresses -->

## Resources
- PR #33
