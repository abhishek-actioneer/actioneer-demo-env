# TODO — Baby Sentinel

## Context
Branch `v1-sv`. All features merged and working. Segments consolidated into 3-tier sidebar pattern.

## Current Branch: `v1-sv`

## Completed (Previous Sessions)
- [x] Brainstorm: Split panel segments redesign (`docs/brainstorms/2026-02-17-segments-list-redesign-brainstorm.md`)
- [x] Plan: Full implementation plan (`docs/plans/2026-02-17-feat-segments-split-panel-redesign-plan.md`)
- [x] Phase 1: Split panel layout + mock data + SegmentDisplay type + segment list cards + detail panel
- [x] Phase 4: Create Segment modal with NL Describe + SQL tabs
- [x] Phase 5 (partial): Brand SVG icons, lint fixes, keyboard navigation
- [x] Merge `origin/vimarsh` into `v1-sv` — Resolved 5 conflicted files. Build passes.
- [x] Fix pre-existing vimarsh bugs — Missing types, Suspense, null-safe access, optional props.
- [x] Document segments gap — `docs/solutions/integration-issues/post-merge-missing-navigation-entry-point.md`
- [x] Fix segments navigation — Created `/segments` route, added sidebar icon, removed `activeView` pattern

## Completed (This Session)
- [x] **Segments Sidebar Consolidation** — Migrated from split-panel to 3-tier Metrics/Playbooks pattern:
  - [x] Brainstorm: `docs/brainstorms/2026-02-17-segments-sidebar-consolidation-brainstorm.md`
  - [x] Plan: `docs/plans/2026-02-17-feat-segments-sidebar-consolidation-plan.md`
  - [x] Phase 1: Created `/segments/[id]` detail route (mock fallback → API fetch, loading/not-found states, breadcrumb, callback handlers)
  - [x] Phase 2: Rewrote `/segments` as full-width table landing page (search, active/archived tabs, 5 columns, "New Segment" button)
  - [x] Phase 3: Populated sidebar `SegmentsPanel` with mock segments (status dot + name + description, click → detail route)
  - [x] Phase 4: Wired `handleCreateSegment` in chat to navigate to `/segments/${data.id}` after creation
  - [x] Phase 5: Removed `segments-page.tsx` and `segment-list-card.tsx` (no dangling imports)
  - [x] Phase 6: `pnpm build` passes, all acceptance criteria met

## Completed (This Session — Sidebar Persistence)
- [x] **Fix: Sidebar pinned state resets on navigation** — Lifted Sidebar into root layout via React Context:
  - [x] Phase 1: Created `SidebarContext` provider (`src/components/sidebar-context.tsx`)
  - [x] Phase 2: Modified Sidebar to read from context + `usePathname()` for `activePage`
  - [x] Phase 3: Created `LayoutShell` client component, moved Sidebar into root `layout.tsx`
  - [x] Phase 4: Wired chat page to inject live `chatList`/`activeId`/handlers into context
  - [x] Phase 5: Removed `<Sidebar>` from all 8 non-chat page files
  - [x] Phase 6: `pnpm build` passes, all acceptance criteria met

## Completed — Cross-Feature Consistency
Brainstorm: `docs/brainstorms/2026-02-17-cross-feature-consistency-brainstorm.md`

- [x] **US-1: Chat conversations persist across navigation** — In-memory Map + API routes (knowledge-store pattern). Plan: `docs/plans/2026-02-17-feat-chat-conversation-persistence-plan.md`. Brainstorm: `docs/brainstorms/2026-02-17-chat-persistence-brainstorm.md`.
  - [x] Phase 1: Store + API (conversation-types.ts, conversation-data.ts, conversation-store.ts, 2 API routes)
  - [x] Phase 2: Wire chat page to API (remove savedChatsRef/chatList local state, add save points)
  - [x] Phase 3: Update SidebarContext (remove INITIAL_CHATS dep, add refreshChats)
  - [x] Phase 4: Cleanup + verify (build passes, manual tests pending)
- [x] **US-2: Sidebar history panel shows real conversations** — Fixed default `onSelectRef` to pass conv ID as query param (`/?conv=<id>`). Chat page reads `useSearchParams` on mount to load the conversation. Added `refreshChats` on `SidebarProvider` mount so history appears even when landing on non-chat pages. Wrapped page in `<Suspense>` for Next.js 16 compatibility.
- [x] **US-5: Creating a segment doesn't navigate away from chat** — Replaced `router.push` with inline toast (auto-dismiss 6s) + "View" link. Auto-pushes to target integration when using "Create segment in CleverTap/Firebase" actions. Also fixed wasteful count-check that created+deleted temp segments.
- [x] **US-3: Sidebar segments panel shows real segments** — Added `segments` state + `refreshSegments()` to `SidebarContext`. Fetches from `/api/segments`, merges with mocks, caches in context. `SegmentsPanel` reads from context (sync). `handleCreateSegment` calls `refreshSegments()` after creation.
- [x] **US-4: Segment detail links back to source conversation** — Added "Created from [conversation title]" link in `SegmentDetailPanel` header. Looks up title from `useSidebarContext().chats`. Navigates to `/?conv=<id>`. Hidden for mock segments and segments without `sourceConversationId`.
- [x] **US-6: Playbook sidebar reactivity** — Added `playbookVersion` counter + `notifyPlaybookSaved()` to `SidebarContext`. `PlaybooksPanel` reads version to force re-render. Both `handleSaveAsPlaybook` and `handleSavePlaybookPreview` call `notifyPlaybookSaved()` after `savePlaybook()`.

## PR #1 Review Notes (vimarsh → main)
Reviewed 2026-02-17. All findings are non-blocking for a frontend prototype. Merged as-is.

**Nice-to-have fixes for later:**
- [ ] Delete dead file `src/lib/sidebar-context.tsx` (67 lines, never imported — conflicts with `src/components/sidebar-context.tsx`)
- [ ] ScoutsPanel in `sidebar.tsx:549` hardcodes 4 scouts — replace with `getScouts()` from scout-store (also fixes missing s-5)
- [ ] Fix mislabeled comment `sidebar.tsx:540` — says "Connectors Panel" but precedes ScoutsPanel
- [ ] Remove `excalidraw.log` from repo, add to `.gitignore`
- [ ] Move mid-file import in `page.tsx:52` to top of imports block
- [ ] Replace hardcoded emails in `scout-store.ts` with `user@example.com`
- [ ] Extract scout report markdown from `scout-store.ts` into `scout-data.ts` (matches metric-store pattern)
- [ ] Add wrapper div `<div className="flex flex-col h-full min-w-0">` to scouts list page for consistency

## Completed — Forecasting Weekly + Gemini
- [x] Switched forecast engine from monthly to weekly granularity (9 history weeks, 12 forecast weeks)
- [x] Replaced client-side trend forecasting with Gemini AI API predictions
- [x] New DEFAULT_MODEL with 5 real base metrics (Revenue, Purchases, Page Views, Unique Users, Paying Users) from `daily_metrics`
- [x] 3 derived rows (AOV, Conversion Rate, ARPU) using formula engine
- [x] Created `POST /api/forecast/seed` — executes SQL, auto-fixes via Gemini on failure
- [x] Created `POST /api/forecast/predict` — Gemini time-series forecasting (12 weeks)
- [x] Orchestrated data loading on page mount with loading shimmer states
- [x] "Regenerate Forecast" re-runs Gemini predictions (skips historical SQL re-fetch)
- [x] Hardcoded BASE_SEED_DATA for instant default page load

## Not Started (Other Deferred)
- [ ] Filter popover for segments landing (search works, but filter dropdowns for type/destination/status deferred). Need `npx shadcn add popover` first.

## Key Architecture Notes
- All features use 3-tier pattern: sidebar hover panel → landing page table → `/feature/{id}` detail route
- Sidebar panels use synchronous data from `SidebarContext` (chats, segments) or in-memory stores (knowledge, metrics, playbooks). No `useEffect` in panels.
- `SidebarContext` fetches chats + segments on mount, caches in state. Panels read synchronously.
- Playbook reactivity uses `playbookVersion` counter — bump triggers panel re-render.
- Cross-page navigation uses `/?conv=<id>` query param for conversation selection.
- Segments detail route checks `MOCK_SEGMENTS` first (sync), falls back to API (async) — same as playbooks pattern
- `CreateSegmentModal` works from both chat (follow-up action) and landing page ("New Segment" button)
- Old split-panel components (`segments-page.tsx`, `segment-list-card.tsx`) have been removed
