# QA Report: localhost:3003 — 2026-03-20

**Tested by:** qa-analyst skill
**URL:** http://localhost:3003
**Pages tested:** 9 (login, home, metrics, segments, playbooks, scouts, knowledge, decks, connectors, metric-tree)
**Total interactions tested:** ~25
**Duration:** ~5 minutes

---

## Ship-Readiness Verdict: SHIP_WITH_CONCERNS

The app is functional and the core chat-to-analysis flow works. Visual design is intentional and monochrome — clearly crafted, not AI slop. However, a persistent race condition fires on every page load (board-store hydration), the Playbooks page is stuck in a perpetual loading state due to a network error, and mobile responsive layout is fundamentally broken (sidebar overlaps content). The product experience is strong on populated pages but several empty states lack guidance.

---

## Health Scores

| Dimension | Score | Assessment |
|-----------|-------|------------|
| **Functional** | 6/10 | Core flows work but Playbooks page broken, submit button timeout on chat |
| **Aesthetic** | 8/10 | Clean monochrome design, consistent spacing, good typography. Minor connector image issues. |
| **Product Experience** | 7/10 | Good hierarchy on most pages, helpful empty states on Knowledge. Playbooks stuck loading. |
| **Dev Health** | 4/10 | Race condition warning on EVERY page load, Playbook seed network error, 400s on connectors |
| **Overall** | **6/10** | |

---

## Failure Summary

| Metric | Count | Severity |
|--------|-------|----------|
| JS Console Warnings (board-store race) | 9 (every page) | medium |
| JS Console Errors | 5 | high |
| Failed Network Requests (400) | 4 | medium |
| Hydration Mismatches | 0 | — |
| React Error Boundaries | 0 | — |
| Silent Failures | 1 | CRITICAL |
| Pages with Console Errors | 9/9 | — |

### Silent Failures (CRITICAL)

| # | Page | Interaction | Error | User Sees |
|---|------|-------------|-------|-----------|
| 1 | /playbooks | Page load | `Playbook seed error: TypeError: network error` | Infinite spinner "Setting up your first playbook..." — never resolves |

---

## Issues

### Critical

| # | Category | Page | Summary |
|---|----------|------|---------|
| 001 | Functional | /playbooks | Page stuck in perpetual loading state. Console shows `Playbook seed error: TypeError: network error`. User sees spinner + "Setting up your first playbook..." forever. No error state shown. No retry. No way to proceed. |

### High

| # | Category | Page | Summary |
|---|----------|------|---------|
| 002 | Dev/Infra | ALL pages | `apiFetch called before setActiveDatasetId()` — board-store hydration race condition fires on every single page navigation. SidebarProvider calls `getBoardSummaries()` before `DatasetProvider` has mounted and set the active dataset ID. |
| 003 | Functional | / (home) | Chat submit button (`@e45`) times out on click — 5s timeout exceeded. The button appears disabled; clicking the send arrow doesn't reliably trigger submission. May be related to button being disabled until input is non-empty, but filled input still shows disabled state. |
| 004 | Visual/UI | / (mobile 375px) | Mobile layout completely broken: sidebar is fully expanded and overlaps the main content area. Chat input is squished to ~50px wide. Prompt suggestions text wraps to single words per line. App is unusable on mobile. |
| 005 | Dev/Infra | /connectors | 4x `400 Bad Request` errors on page load. Connector logo images failing to load. |

### Medium

| # | Category | Page | Summary |
|---|----------|------|---------|
| 006 | Dev/Infra | /connectors | Next.js image warnings: "Image with src has either width or height modified, but not the other" for TikTok, Mixpanel, Databricks, BigQuery logos. Missing `width: "auto"` or `height: "auto"`. |
| 007 | Performance | /metrics | API call `GET /api/metrics?datasetId=quickhelp` takes 14 seconds (13,977ms). Page renders blank table during this time with no loading skeleton. |
| 008 | Product | /decks | Empty state says "No decks yet. Upload a PDF to get started." — plain text, no icon, no visual hierarchy. Compare to Knowledge page which has a proper empty state with icon + description + CTA buttons. Inconsistent empty state patterns. |
| 009 | Product | /metric-tree | Metric tree visualization is tiny and hard to read at default zoom. Nodes show abbreviated numbers but the tree structure lacks labels explaining relationships. "NEEDS ATTENTION: Customer Acquisition Cost 1 err" — the error is red but no further details on hover or click. |
| 010 | Product | /segments | All segments show "500" users — identical counts suggest mock/seed data. The "DESTINATIONS" column shows "—" for all entries. If this is a demo, the data should look more realistic. |
| 011 | Content | /connectors | ClickHouse logo text clipped ("Clic" visible, rest cut off by card boundary). Singular logo ("Sin" visible, rest cut off). Layout doesn't handle longer connector names gracefully. |

### Low

| # | Category | Page | Summary |
|---|----------|------|---------|
| 012 | Visual/UI | /connectors | Connector card images have inconsistent sizing. Some logos are full-color, some are monochrome. The "Connected" badge (green dot) only appears on BigQuery and AppsFlyer — the visual distinction between connected/not-connected is subtle. |
| 013 | Product | / (home) | "Ask Sentinel" floating button (bottom-right corner) is redundant — the user is already looking at the chat interface. It makes more sense on feature pages like Metrics where chat is hidden. |
| 014 | UX | / (home) | The sidebar "All chats" dropdown and "Boards" dropdown have expand arrows but clicking opens inline, not a modal or panel. The convention is unclear — are these expandable sections or navigation links? |

---

## Per-Page Audit

### Page: / (Home / Chat)

**Information Hierarchy:** CLEAR — Logo + tagline + chat input + prompt suggestions. User immediately knows what to do.
**First 5 Seconds:** PASS — Primary action (ask a question) is obvious and centered.
**Trust & Intentionality:** HIGH TRUST — Clean, minimal, purposeful. No noise.

| Feature | Loading | Empty | Error | Success | Partial |
|---------|---------|-------|-------|---------|---------|
| Chat input | N/A | ✓ (prompts) | ✗ | — | — |
| Autocomplete | ✓ | N/A | ✗ | ✓ | ✓ |

**Aesthetic:** CRAFTED — Warm beige background, consistent monochrome palette, Inter-family font, good spacing.
**PM Verdict:** SHIP — The landing experience is strong and intentional.

### Page: /metrics

**Information Hierarchy:** CLEAR — Title + search + category filters + table.
**First 5 Seconds:** PASS — User can search, filter, and browse metrics immediately.

| Feature | Loading | Empty | Error | Success | Partial |
|---------|---------|-------|-------|---------|---------|
| Metrics table | ✗ (14s blank) | — | ✗ | ✓ | ✗ |
| Search | — | — | — | — | — |

**PM Verdict:** CONCERN — 14-second load with no skeleton/spinner is jarring.

### Page: /playbooks

**Information Hierarchy:** BROKEN — Spinner + "Setting up your first playbook..." forever.
**First 5 Seconds:** FAIL — User waits, nothing happens, no way to recover.

**PM Verdict:** BLOCK — Page is non-functional.

### Page: /segments

**Information Hierarchy:** CLEAR — Clean table with search and Active/Archived tabs.
**First 5 Seconds:** PASS

**PM Verdict:** SHIP — Looks good. Mock data (all 500 users) is a demo concern, not a bug.

### Page: /knowledge

**Information Hierarchy:** CLEAR — Best empty state in the app: icon + heading + description + 4 CTAs.
**First 5 Seconds:** PASS — User immediately knows they can generate, write, upload, or paste.

**PM Verdict:** SHIP — This is how empty states should work everywhere.

### Page: /connectors

**Information Hierarchy:** CLEAR — Categorized connector cards, search.
**First 5 Seconds:** PASS — Good progressive disclosure with collapsible sections.

**PM Verdict:** CONCERN — Logo clipping and 400 errors on load.

### Page: /metric-tree

**Information Hierarchy:** MUDDY — Tiny tree visualization with too-small text. Right panel has useful info but relationship to tree is unclear.

**PM Verdict:** CONCERN — Feature is promising but needs zoom/pan UX and clearer node labels.

---

## Cross-Page Assessment

### Journey Coherence
The sidebar navigation is consistent across all pages. Chat persists via the "Ask Sentinel" floating button. The flow from chat → analysis → segment creation → integration push is conceptually sound. The main dead end is /playbooks (broken).

### Subtraction Opportunities
- The "Ask Sentinel" button on the home page is redundant (you're already in the chat)
- "Boards" section in sidebar — unclear what this is without explanation
- Account popover contains Billing/Usage/Theme/Model/Logout — Theme and Model could live in Settings instead

### Responsive
- **Mobile (375px):** BROKEN — sidebar doesn't collapse, overlaps content entirely
- **Tablet (768px):** Not tested independently
- **Desktop (1280px):** Works well, good use of space

### DOM Growth
- Home: 432 nodes → After navigating all pages: 1143 nodes
- Growth: 165% — **WARNING: significant DOM growth suggesting leaked components or uncleaned state across navigations**

---

## Console Error Log (unique errors)

1. `[warning] [board-store] apiFetch called before setActiveDatasetId()` — **EVERY page load** (race condition in provider mount order: SidebarProvider → EntityCatalogProvider calls board-store before DatasetProvider sets active ID)
2. `[error] Playbook seed error: TypeError: network error` — /playbooks
3. `[error] Failed to load resource: 400 Bad Request` — /connectors (4 instances, connector logos)
4. `[warning] Image with src "..." has either width or height modified` — /connectors (3 instances)
5. `[warning] [board-store] version mismatch: stored="null" expected="6" — clearing storage` — first page load only

---

## Recommendations (prioritized)

1. **[CRITICAL] Fix /playbooks** — Playbook seed fails with network error, page stuck in infinite loading. Needs error state + retry CTA.
2. **[HIGH] Fix board-store race condition** — `apiFetch` called before `setActiveDatasetId()` on every page navigation. The provider mount order in `layout-shell.tsx` shows `DatasetProvider → SidebarProvider` but SidebarProvider's `useEffect` calls `refreshBoards()` which calls `getBoardSummaries()` which calls `ensureInitialized()` → `apiFetch()` before DatasetProvider's `setActiveDatasetId()` has run.
3. **[HIGH] Fix mobile layout** — Sidebar needs to collapse to a hamburger menu on mobile viewports.
4. **[HIGH] Add loading skeleton for /metrics** — 14-second blank table is unacceptable. Show skeleton rows during load.
5. **[MEDIUM] Fix connector image sizing** — Add `width: "auto"` / `height: "auto"` and fix 400 errors on logo URLs.
6. **[MEDIUM] Investigate DOM growth** — 165% DOM node growth after navigating all pages. Check for leaked components, uncleaned event listeners, or sidebar state accumulation.
7. **[LOW] Standardize empty states** — Knowledge has a great empty state pattern. Apply it to Decks and anywhere else that shows plain text.

---

*Report generated by qa-analyst skill on 2026-03-20*
*Screenshots saved to: /tmp/qa-*.png*
