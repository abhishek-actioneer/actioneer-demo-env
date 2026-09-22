---
title: "Codebase Style Consistency & Structural Cleanup"
type: refactor
date: 2026-02-18
deepened: 2026-02-18
---

# Codebase Style Consistency & Structural Cleanup

## Enhancement Summary

**Deepened on:** 2026-02-18
**Sections enhanced:** 5 phases + risk mitigation
**Agents used:** TypeScript reviewer, Architecture strategist, Pattern recognition specialist, Code simplicity reviewer, Frontend races reviewer, Performance oracle, React 19 hooks researcher, NDJSON streaming researcher, Store patterns researcher, Learnings researcher

### Key Improvements
1. **`streamDirectResponse` gap identified** — Phase 2B must explicitly migrate the nested helper in `analyze/route.ts` that bypasses `send()`, using raw `controller.enqueue` without `safeStringify` or closed-guard
2. **Dependency inversion fix** — Move `safeStringify` from `gemini.ts` to `streaming.ts` to keep transport-layer dependencies clean
3. **Drop Phase 3B** — Empty `ensureInitialized()` on playbook-store is pure ceremony with no functional value
4. **Race condition protections** — Phase 4 hooks need explicit AbortController lifecycle management, especially for `switchConversation` during active streams
5. **Simplify useChatStream** — Consider keeping it as a plain function (not a hook) since it saves only ~60 lines and doesn't manage state

### New Considerations Discovered
- React 19 compiler is NOT explicitly enabled in `next.config.ts` — callbacks still need `useCallback` wrapping
- NDJSON `start()` method doesn't provide backpressure (vs `pull()`), acceptable for this use case but worth documenting
- The "adjust state during render" pattern (from `segment-detail-panel-ux-patterns.md` learning) should be used in Phase 4 hooks instead of `useEffect` for prop-change state resets
- `request.signal` for client disconnect detection is unreliable in Next.js streaming — the existing `closed` boolean guard is the pragmatic choice

---

## Overview

Multi-phase refactoring to eliminate structural inconsistencies identified in a comprehensive code review. No new features — only deduplication, normalization, and decomposition of the existing codebase.

**Guiding principle:** Each phase produces a working app. Phases are ordered so that earlier phases create foundations that later phases consume.

## Problem Statement

The codebase grew organically and has accumulated:
- **9 duplicate** Gemini client instantiations with inconsistent model resolution
- **3 duplicate** NDJSON streaming implementations (one has a `closed` guard, two don't)
- **6 duplicate** code-fence stripping regexes across 4 files
- **6 stores** with 3 different API shapes (Map vs array, boolean vs void returns, naming inconsistencies)
- **1,676-line `page.tsx`** with 494-line callbacks mixing streaming protocol, state management, and UI
- **1 dead file** (`src/lib/sidebar-context.tsx`)

---

## Phase 1: Shared Utilities

**Goal:** Create foundational modules that Phases 2-4 depend on. Purely additive — no existing code changes.

### 1A. Create `src/lib/gemini.ts`

**New file exports:**

```typescript
// src/lib/gemini.ts
import { GoogleGenAI } from "@google/genai";

/** Single shared Gemini client instance */
export const ai = new GoogleGenAI({
  apiKey: (() => {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY environment variable is required");
    return key;
  })(),
});

/** Always gemini-2.0-flash — use for lightweight tasks (classify, parse, per-agent summaries) */
export const FLASH_MODEL = "gemini-2.0-flash";

/** Reads GEMINI_MODEL env with flash fallback — use for primary generation (synthesis, chat) */
export function getModel(): string {
  return process.env.GEMINI_MODEL || FLASH_MODEL;
}
```

**Design decisions:**
- Export both `FLASH_MODEL` (constant) and `getModel()` (env-aware) because some routes intentionally want cheap Flash regardless of env override
- Eager validation of `GEMINI_API_KEY` — fail fast with clear message instead of cryptic runtime error

### 1B. Create `src/lib/streaming.ts`

**New file exports:**

```typescript
// src/lib/streaming.ts

export type SendFn = (event: { type: string } & Record<string, unknown>) => void;

/** JSON.stringify with BigInt coercion (needed for DuckDB results) */
export function safeStringify(obj: unknown): string {
  return JSON.stringify(obj, (_key, value) =>
    typeof value === "bigint" ? Number(value) : value
  );
}

/** Response headers for NDJSON streaming */
const STREAM_HEADERS = {
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "no-cache",
} as const;

/**
 * Creates an NDJSON streaming response.
 * Provides a `send()` function with closed-guard to the handler.
 * Automatically closes the stream and catches errors.
 */
export function createNDJSONStream(
  handler: (send: SendFn) => Promise<void>
): Response {
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: { type: string } & Record<string, unknown>) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(safeStringify(event) + "\n"));
        } catch {
          // Stream already closed by client disconnect
        }
      }
      try {
        await handler(send);
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : "Unknown error",
        });
      } finally {
        closed = true;
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, { headers: STREAM_HEADERS });
}
```

### Research Insights

**`safeStringify` placement (Architecture review):**
- Originally planned for `gemini.ts`, but this creates a dependency inversion: `streaming.ts` (transport layer) would depend on `gemini.ts` (service layer). Move `safeStringify` to `streaming.ts` where it's actually consumed. This keeps dependency arrows pointing in the right direction and allows `createNDJSONStream` to be used for non-Gemini streaming in the future.

**`SendFn` type refinement (TypeScript review):**
- Add `{ type: string }` to the intersection type instead of bare `Record<string, unknown>`. This gives the NDJSON protocol a minimal type contract, catching typos like `send({ tyep: "done" })` at compile time.

**Backpressure note (NDJSON streaming research):**
- The `start()` method doesn't provide backpressure (vs `pull()` which is demand-driven). For NDJSON event streaming at LLM token frequency (~50-100 events/sec max), this is acceptable. The internal queue high-water mark (default 1) will buffer briefly but won't cause memory issues at this scale. Document this trade-off in a code comment.

**TextEncoder reuse (Performance review):**
- Creating `TextEncoder` per-stream is fine. The constructor is trivial (no internal state beyond encoding name) and the per-stream allocation is negligible compared to the cost of the Gemini API calls and DuckDB queries that drive the stream.

**Client disconnect detection (NDJSON streaming research):**
- `request.signal` for detecting client disconnects is unreliable in Next.js App Router (multiple GitHub issues confirm this). The boolean `closed` guard is the pragmatic, proven approach. The `try/catch` around `controller.enqueue` provides a second safety net — if the client disconnects, the enqueue will throw and be silently caught.

### 1C. Add `stripCodeFences` to `src/lib/streaming.ts`

```typescript
/** Strips markdown code fences from LLM output (```lang ... ```) */
export function stripCodeFences(text: string): string {
  return text.replace(/^```\w*\n?/i, "").replace(/\n?```$/i, "");
}
```

**Design decision:** Universal `\w*` regex — all 6 current call sites strip LLM output wrappers where the language hint is irrelevant. The `page.tsx` location also strips `---` delimiters, which must remain as a separate `.replace()` call at that call site.

**Cohesion note (Architecture review):** `stripCodeFences` is LLM output formatting, not stream transport. Placing it in `streaming.ts` is pragmatic colocation (keeps the file small). If `streaming.ts` grows beyond ~80 lines (e.g., adding SSE support), consider moving it to `src/lib/utils.ts`.

### Phase 1 Testing Plan

| # | Verification | Command / Check | Pass Criteria |
|---|-------------|-----------------|---------------|
| 1 | Files created | `ls src/lib/gemini.ts src/lib/streaming.ts` | Both exist |
| 2 | TypeScript compiles | `pnpm build` | No type errors in new files |
| 3 | Exports are correct | `grep "export" src/lib/gemini.ts src/lib/streaming.ts` | All 7 exports present: `ai`, `FLASH_MODEL`, `getModel`, `safeStringify`, `SendFn`, `createNDJSONStream`, `stripCodeFences` |
| 4 | No existing code changed | `git diff --name-only` | Only new files show as added |
| 5 | App still runs | `pnpm dev` → load localhost:3000 | Chat page renders, no console errors |

---

## Phase 2: Migrate API Routes to Shared Utilities

**Goal:** Replace 9 duplicate Gemini clients, 3 duplicate stream factories, and 6 duplicate regex patterns with shared imports.

### 2A. Replace Gemini client instantiations (9 files)

For each file, replace the local `import { GoogleGenAI } ...` + `const ai = new GoogleGenAI(...)` with `import { ai } from "@/lib/gemini"`.

**Model resolution mapping** (which function to use where):

| File | Current Model | Target Import |
|------|--------------|---------------|
| `src/lib/sql-generator.ts` | Hardcoded `"gemini-2.0-flash"` (3 places) | `FLASH_MODEL` |
| `src/lib/playbook-executor.ts` | Local `FLASH_MODEL` constant | `FLASH_MODEL` from gemini.ts |
| `src/app/api/analyze/route.ts` | Local `FLASH_MODEL` for agents, env for synthesis | `FLASH_MODEL` for agents, `getModel()` for synthesis |
| `src/app/api/chat/route.ts` | `process.env.GEMINI_MODEL \|\| "gemini-2.0-flash"` | `getModel()` |
| `src/app/api/classify/route.ts` | Hardcoded `"gemini-2.0-flash"` | `FLASH_MODEL` |
| `src/app/api/knowledge/add/route.ts` | Hardcoded `"gemini-2.0-flash"` | `FLASH_MODEL` |
| `src/app/api/knowledge/parse/route.ts` | Hardcoded `"gemini-2.0-flash"` | `FLASH_MODEL` |
| `src/app/api/playbook/create/route.ts` | Local `FLASH_MODEL` constant | `FLASH_MODEL` from gemini.ts |
| `src/app/api/segments/generate-sql/route.ts` | `process.env.GEMINI_MODEL \|\| "gemini-2.0-flash"` | `getModel()` |

**After migration:** `@google/genai` should only be imported in `src/lib/gemini.ts`. No other file should import it directly.

### 2B. Replace NDJSON streaming (3 routes)

Replace the manual `ReadableStream` + `TextEncoder` + `send()` + `try/catch/finally` pattern with `createNDJSONStream()`:

| File | Current Pattern | Migration Notes |
|------|----------------|-----------------|
| `src/app/api/analyze/route.ts` | Manual stream + `safeStringify` + no closed guard | Extract handler body into async function passed to `createNDJSONStream`. Remove local `safeStringify`, `encoder`, stream construction. |
| `src/app/api/playbook/create/route.ts` | Manual stream + `JSON.stringify` + closed guard | Remove local `closed`, `encoder`, stream construction. Handler body becomes the callback. |
| `src/app/api/playbook/run/route.ts` | Manual stream + delegates to `runPlaybook(send, ...)` | Simplest migration — pass `send` directly to `runPlaybook`. |

**Note:** `src/app/api/chat/route.ts` is NOT migrated (raw text stream, different protocol).

### Research Insight: Critical `streamDirectResponse` Gap

**[HIGH PRIORITY]** The `streamDirectResponse` helper inside `analyze/route.ts` (line ~576-598) takes `controller` and `encoder` directly and writes NDJSON events by hand (`encoder.encode(JSON.stringify({...}) + "\n")`). After migration to `createNDJSONStream`, this nested helper **bypasses the outer `send()` function entirely**.

**Concrete migration step:** Refactor `streamDirectResponse` in `analyze/route.ts` to accept `send: SendFn` instead of `controller` + `encoder`. Replace internal `controller.enqueue(encoder.encode(JSON.stringify({type: "text", delta}) + "\n"))` calls with `send({ type: "text", delta })`. This ensures:
- BigInt safety via `safeStringify` (currently using raw `JSON.stringify`)
- `closed` guard protection (currently none)
- Consistent serialization across all NDJSON code paths

Without this fix, you retain one code path that bypasses both `safeStringify` and the `closed` guard, defeating the purpose of the abstraction.

### 2C. Replace code-fence stripping (6 locations in 4 files)

| File | Line(s) | Current | Replacement |
|------|---------|---------|-------------|
| `src/lib/sql-generator.ts` | ~170 | `.replace(/^```(?:sql)?\n?/i, "").replace(/\n?```$/i, "")` | `stripCodeFences(raw)` |
| `src/app/api/playbook/create/route.ts` | ~84 | `.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "")` | `stripCodeFences(raw)` |
| `src/app/api/playbook/create/route.ts` | ~127-128 | Same json pattern | `stripCodeFences(raw)` |
| `src/app/api/analyze/route.ts` | ~504-505 | `.replace(/^```(?:markdown)?\n?/i, "").replace(/\n?```$/i, "")` | `stripCodeFences(raw)` |
| `src/app/page.tsx` | ~1144-1145 | Same markdown pattern + extra `---` strip | `stripCodeFences(raw).replace(/^---\n?/gm, "")` (keep `---` strip separate) |

### Phase 2 Testing Plan

| # | Verification | Command / Check | Pass Criteria |
|---|-------------|-----------------|---------------|
| 1 | No direct GoogleGenAI imports remain | `grep -r "new GoogleGenAI" src/ --include="*.ts" --include="*.tsx"` | Zero matches (only `gemini.ts` should have it) |
| 2 | No manual ReadableStream in NDJSON routes | `grep -l "new ReadableStream" src/app/api/analyze/route.ts src/app/api/playbook/create/route.ts src/app/api/playbook/run/route.ts` | Zero matches |
| 3 | No inline code-fence regex remains | `grep -rn "replace.*\`\`\`" src/ --include="*.ts" --include="*.tsx"` | Only `streaming.ts` has it |
| 4 | `streamDirectResponse` uses `send` | Read `src/app/api/analyze/route.ts` | No `controller.enqueue` in `streamDirectResponse` |
| 5 | TypeScript compiles | `pnpm build` | No errors |
| 6 | Smoke: direct chat | Send "Hello" in chat | Raw text streams back correctly |
| 7 | Smoke: quick analysis | Send "How many users?" in quick mode | NDJSON stream works, SQL executes, response renders |
| 8 | Smoke: deep analysis | Send "Analyze retention trends" in deep mode | All 6 agents + critique + report generate |
| 9 | Smoke: playbook create | Type `/playbook` command in chat | Playbook NDJSON stream works, playbook saves |
| 10 | Smoke: classify | Send any query | Classification (analytics vs direct) works correctly |
| 11 | Smoke: knowledge parse | Add a knowledge entry via knowledge page | Gemini categorization works |
| 12 | Smoke: empty query fallback | Send query that generates 0 SQL queries | `streamDirectResponse` via `send()` works correctly (regression test for the gap) |

---

## Phase 3: Store Pattern Normalization

**Goal:** Make all 6 stores follow the same structural conventions.

### Research Insights

**Boolean returns for in-memory Map mutations (Pattern recognition + Code simplicity + Store patterns research):**

The plan proposes wrapping `Map.set()` in try/catch returning boolean. Multiple reviewers flagged this as ceremony:
- `Map.set()` on an in-memory Map will never throw under normal circumstances
- The try/catch is dead code that falsely implies error handling
- A function that always returns `true` misleads callers into thinking failure is possible

However, `canvas-store.ts` and `knowledge-store.ts` **already use this pattern**, and `pin-button.tsx` actively checks the boolean return from `saveCanvasItem`. So the pattern is established in the codebase.

**Recommendation:** Keep the boolean return pattern for consistency with existing stores, but acknowledge it's convention-for-consistency, not error handling. The one caller that checks the return (`pin-button.tsx`) validates the pattern's utility.

**Naming conventions (Store patterns research):**

Community convention (influenced by Prisma): `create`/`findMany`/`findUnique`/`update`/`delete`. The codebase uses `get`/`getAll`/`save`/`delete` which is also standard for simpler stores. The rename `removeCanvasItem` → `deleteCanvasItem` aligns with the `delete` verb used in `knowledge-store.ts` and `conversation-store.ts`. The rename `getAllEntries` → `getAllKnowledgeEntries` adds entity-prefix clarity. Both are correct.

### 3A. Normalize `conversation-store.ts` returns

Change `saveConversation`, `updateConversationMessages`, and `deleteConversation` from `void` to `boolean` returns with try/catch:

```typescript
// Before
export function saveConversation(conv: Conversation): void {
  ensureInitialized();
  conversationMap.set(conv.id, conv);
}

// After
export function saveConversation(conv: Conversation): boolean {
  try {
    ensureInitialized();
    conversationMap.set(conv.id, conv);
    return true;
  } catch { return false; }
}
```

**Callers** (3 files — no changes needed since they don't check return values today):
- `src/app/api/conversations/route.ts`
- `src/app/api/conversations/[id]/route.ts`

### ~~3B. Add `ensureInitialized` guard to `playbook-store.ts`~~

**DROPPED per Architecture and Code Simplicity reviews.** Adding an empty `ensureInitialized()` guard to a store with no seed data is pure ceremony. The function body would be `if (initialized) return; initialized = true;` — it does nothing useful. The playbook store already uses boolean returns (confirmed by reading the file). Instead, add a one-line comment:

```typescript
// No ensureInitialized needed — playbooks are created dynamically, not seeded.
```

### 3C. Split `scout-store.ts` into 3 files

**Current:** 594-line `scout-store.ts` with inline types, inline data, and store functions.

**Target:**

| File | Contents | Exports |
|------|----------|---------|
| `src/lib/scout-types.ts` | `Scout` and `ScoutRun` interfaces | `Scout`, `ScoutRun` |
| `src/lib/scout-data.ts` | `SCOUTS` constant array + `SCOUT_RUNS` data | `SCOUTS`, `SCOUT_RUNS` (internal to store) |
| `src/lib/scout-store.ts` | Store functions only (~30 lines) | `getScouts()`, `getScout(id)`, `getScoutRuns(scoutId)` + re-exports types from `scout-types.ts` |

### Research Insight: Barrel Re-export Pattern

Re-exporting types from `scout-store.ts` is standard barrel pattern practice. Use explicit named re-exports (not `export *`) to prevent accidental internal exposure:

```typescript
// scout-store.ts
export type { Scout, ScoutRun } from "./scout-types";
```

**Import updates required:** None. All existing `import { ... } from "@/lib/scout-store"` continue to work because types are re-exported.

**Note on data file size:** `scout-data.ts` will be ~560 lines of hardcoded markdown strings and seed data. This is expected — the "split" primarily separates type definitions and store functions from the data constants.

### 3D. Rename store functions for consistency

| Store | Current Name | New Name | Callers to Update |
|-------|-------------|----------|-------------------|
| `canvas-store.ts` | `removeCanvasItem` | `deleteCanvasItem` | `src/components/canvas/canvas-page.tsx` (3 call sites) |
| `knowledge-store.ts` | `getAllEntries` | `getAllKnowledgeEntries` | `src/lib/knowledge-context.ts`, `src/components/sidebar.tsx`, `src/app/knowledge/page.tsx` |

### Phase 3 Testing Plan

| # | Verification | Command / Check | Pass Criteria |
|---|-------------|-----------------|---------------|
| 1 | conversation-store returns boolean | Read `src/lib/conversation-store.ts` | All 3 mutating functions return `boolean` with try/catch |
| 2 | playbook-store has comment (not ensureInitialized) | Read `src/lib/playbook-store.ts` | Comment present, no empty `ensureInitialized` |
| 3 | scout-store split | `ls src/lib/scout-types.ts src/lib/scout-data.ts src/lib/scout-store.ts` | All 3 files exist, original is replaced |
| 4 | scout-store is ~30 lines | `wc -l src/lib/scout-store.ts` | Under 50 lines |
| 5 | No broken imports | `pnpm build` | No type errors |
| 6 | Old function names gone | `grep -rn "removeCanvasItem\|getAllEntries" src/ --include="*.ts" --include="*.tsx"` | Zero matches (only new names exist) |
| 7 | Smoke: canvas | Navigate to /canvas, pin/unpin an item | `deleteCanvasItem` works |
| 8 | Smoke: knowledge | Navigate to /knowledge | List renders with `getAllKnowledgeEntries` |
| 9 | Smoke: scouts | Navigate to /scouts, click a scout | Scout data loads from split store |
| 10 | Smoke: playbooks | Navigate to /playbooks | Playbook listing works |
| 11 | Smoke: conversations | Send a message, switch conversations | Conversation save/load works with boolean returns |

---

## Phase 4: `page.tsx` Decomposition

**Goal:** Reduce `src/app/page.tsx` from ~1,676 lines to ~500 lines by extracting 4 custom hooks.

### Research Insights

**React 19 compiler status (Performance review):**
The React compiler is NOT explicitly enabled in `next.config.ts` (no `reactCompiler: true` in `experimental`). It may be auto-enabled by Next.js 16, but callbacks still need `useCallback` wrapping as a safety measure until compiler status is confirmed.

**"Adjust state during render" pattern (from project learning `segment-detail-panel-ux-patterns.md`):**
When hooks need to reset state based on prop changes, use React's recommended pattern of comparing previous props during render instead of `useEffect`:

```typescript
// Inside hook:
const [prevConvId, setPrevConvId] = useState(activeConvId);
if (activeConvId !== prevConvId) {
  setPrevConvId(activeConvId);
  setMessages([]); // reset
}
```

This avoids cascading renders from `useEffect` and is lint-clean.

**AbortController lifecycle (Frontend races review + React 19 hooks research):**
Critical for `useAnalyzeStream` and `useChatStream`:
- Abort on component unmount via `useEffect` cleanup
- Abort previous stream when `startAnalyze`/`startChat` is called again (re-call abort)
- Check `signal.aborted` after every `await` to exit early
- Handle `AbortError` gracefully (it's expected, not an error)

**Coordinating hooks that share state (Architecture review):**
The `useConversation` interface should NOT take the full `SidebarContextValue`. Instead, accept individual callbacks:

```typescript
export function useConversation(opts: {
  onRefreshChats: () => void;
  onSetActiveChat: (id: string) => void;
}): UseConversationReturn;
```

This follows Interface Segregation: the hook depends only on what it needs, not the sidebar's internal shape.

### Hook Interface Contracts

#### 4A. `src/lib/hooks/use-conversation.ts`

**Owns:** `activeConvId`, `messages`, conversation CRUD, URL param sync.

```typescript
interface UseConversationReturn {
  activeConvId: string;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  switchConversation: (id: string) => void;
  handleNewChat: () => void;
  saveMessages: () => void;
}

export function useConversation(opts: {
  onRefreshChats: () => void;
  onSetActiveChat: (id: string) => void;
}): UseConversationReturn;
```

**State moved from page.tsx:**
- `activeConvId` / `setActiveConvId`
- `messages` / `setMessages`
- `chatList` management (delegated via callbacks)
- `switchConversation` callback
- `handleNewChat` callback
- The `useEffect` that saves messages on unmount
- URL `?conv=` parameter reading/writing

**Race condition consideration:** `switchConversation` must abort any active stream before switching. The hook should accept an `abortRef` or expose an `abort()` function that `handleSend` can coordinate with.

**Lines saved:** ~150 lines

#### 4B. `src/lib/hooks/use-analyze-stream.ts`

**Owns:** NDJSON stream parsing for `/api/analyze`, abort controller management.

```typescript
interface AnalyzeStreamCallbacks {
  onPhase: (phase: string) => void;
  onSQL: (agentId: string, sql: string) => void;
  onQueryResult: (agentId: string, result: unknown) => void;
  onSummary: (agentId: string, summary: string) => void;
  onText: (token: string) => void;
  onReport: (markdown: string) => void;
  onResult: (agentId: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

interface UseAnalyzeStreamReturn {
  startAnalyze: (query: string, mode: string, signal: AbortSignal) => Promise<void>;
}

export function useAnalyzeStream(
  callbacks: AnalyzeStreamCallbacks
): UseAnalyzeStreamReturn;
```

### Research Insight: Plain function vs hook?

The Code Simplicity reviewer flagged: 9 named callbacks is a lot of indirection. Consider whether this should be a plain async function (not a hook) since it doesn't manage its own state. The hook pattern is only necessary if it holds internal state (like the line buffer) across renders. Since the line buffer is local to a single `startAnalyze` call, a plain function works too:

```typescript
// Alternative: plain function instead of hook
export async function parseAnalyzeStream(
  response: Response,
  signal: AbortSignal,
  callbacks: AnalyzeStreamCallbacks
): Promise<void>;
```

**Recommendation:** Use the plain function approach. It's simpler, more testable, and avoids the unnecessary hook wrapper. The caller in `handleSend` can call it directly.

**Logic moved from page.tsx:**
- The NDJSON fetch + reader loop from `handleSend` (lines ~900-1200)
- Event type switching (`phase`, `sql`, `query_result`, `summary`, `text`, `report`, `result`, `done`, `error`)
- Line buffer for partial JSON lines

**Lines saved:** ~300 lines

#### 4C. `src/lib/hooks/use-chat-stream.ts`

### Research Insight: Keep inline?

The Code Simplicity reviewer noted: `useChatStream` saves only ~60 lines. The current `streamDirectResponse` function is already a standalone function (not embedded in a hook). Consider keeping it as-is with just a rename + import from a shared location.

**Recommendation:** Move the existing `streamDirectResponse` function to `src/lib/streaming-client.ts` (client-side streaming utilities) as a plain function. No hook wrapper needed. This keeps the extraction minimal while still removing the code from `page.tsx`.

```typescript
// src/lib/streaming-client.ts
export async function streamDirectResponse(
  query: string,
  msgId: string,
  signal: AbortSignal,
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>
): Promise<void>;
```

**Lines saved:** ~60 lines

#### 4D. `src/lib/hooks/use-segment-creation.ts`

**Owns:** Segment creation modal state, API call, toast notification.

```typescript
interface UseSegmentCreationReturn {
  segmentModal: { name: string; sql: string } | null;
  isCreatingSegment: boolean;
  segmentToast: { id: string; name: string } | null;
  openSegmentModal: (name: string, sql: string) => void;
  closeSegmentModal: () => void;
  handleCreateSegment: () => Promise<void>;
  dismissSegmentToast: () => void;
}

export function useSegmentCreation(
  refreshSegments: () => void
): UseSegmentCreationReturn;
```

### Research Insight: Modal close during API call

The Frontend Races reviewer flagged: if the user closes the modal while `handleCreateSegment` is in-flight, the state update on completion will reference stale modal state. Add an `isMounted` ref or check `segmentModal` is still non-null before updating state after the API call.

**State moved from page.tsx:**
- `segmentModal` / `setSegmentModal`
- `isCreatingSegment` / `setIsCreatingSegment`
- `segmentToast` / `setSegmentToast`
- `handleCreateSegment` callback
- Part of `handleFollowUpAction` that routes to segment creation

**Lines saved:** ~80 lines

#### Orchestration: `handleSend` stays in `page.tsx`

After extraction, `handleSend` in `page.tsx` becomes a thin orchestrator:

```typescript
// Pseudocode — ~100 lines instead of ~494
const handleSend = useCallback(async (query: string) => {
  // 1. Create/update conversation via useConversation
  // 2. Add user message to messages
  // 3. Classify query via fetch /api/classify
  // 4. If direct → streamDirectResponse(query, signal, onToken, onDone)
  // 5. If analytics → create agent message scaffold, parseAnalyzeStream(...)
  // 6. Handle abort cleanup
}, [/* deps from hooks */]);
```

### Research Insight: Race condition — double send

The Frontend Races reviewer flagged: what if the user sends a second message before the first completes? The current code has `if (isProcessing) return;` at the top of `handleSend`, which is correct. This guard must be preserved in the orchestrator. The `isProcessing` state should stay in `page.tsx` (not in a hook) since it's orchestration-level state.

**Total lines saved:** ~590 lines (1,676 → ~1,080). The remaining `page.tsx` contains: JSX layout, `handleSend` orchestrator, panel state, search modal, playbook command detection, and follow-up action routing.

### Phase 4 Testing Plan

| # | Verification | Command / Check | Pass Criteria |
|---|-------------|-----------------|---------------|
| 1 | Hooks/functions created | `ls src/lib/hooks/use-conversation.ts src/lib/hooks/use-segment-creation.ts src/lib/streaming-client.ts` | All exist |
| 2 | `parseAnalyzeStream` created | `ls src/lib/hooks/use-analyze-stream.ts` or equivalent location | Exists as plain function |
| 3 | page.tsx reduced | `wc -l src/app/page.tsx` | Under 1,100 lines |
| 4 | TypeScript compiles | `pnpm build` | No errors |
| 5 | No duplicate streaming logic | `grep -c "TextDecoder\|getReader" src/app/page.tsx` | Max 2 (one per stream type reference, not full implementations) |
| 6 | Smoke: direct chat | Send "Hello" | Text streams back, message renders |
| 7 | Smoke: quick analysis | Send "How many users?" in quick mode | SQL generates, executes, response streams |
| 8 | Smoke: deep analysis | Send "Analyze retention" in deep mode | All 6 agents show progress cards, summaries populate, report generates, sources panel works |
| 9 | Smoke: abort mid-stream | Click stop during deep analysis | Stream aborts cleanly, partial messages removed |
| 10 | Smoke: conversation switching | Create 2 conversations, switch between them | Messages persist per conversation |
| 11 | Smoke: switch during active stream | Switch conversations while analysis is streaming | Active stream aborts, new conversation loads cleanly |
| 12 | Smoke: new chat | Click "New Chat" | Fresh conversation, sidebar updates |
| 13 | Smoke: segment creation | Trigger "Create Segment" from follow-up action | Modal opens, creation works, toast shows |
| 14 | Smoke: playbook creation | Type `/playbook` in deep mode | Playbook streams and saves |
| 15 | Smoke: search | Open search modal (Cmd+K) | Search works across conversations |
| 16 | Smoke: panel state | Click agent card → task panel opens; click "Sources" → sources panel opens | Panel state transitions work |

---

## Phase 5: Dead Code & Final Cleanup

**Goal:** Remove dead code and fix remaining minor inconsistencies.

### 5A. Remove dead `src/lib/sidebar-context.tsx`

**Confirm it's dead:** `grep -r "lib/sidebar-context" src/` should return zero matches. The active sidebar context is at `src/components/sidebar-context.tsx`. Architecture reviewer confirmed zero imports.

### 5B. Fix `canvas-page.tsx` export

Change `export default function CanvasPage()` to `export function CanvasPage()`.

**Update caller:** `src/app/canvas/page.tsx` uses `dynamic(() => import(...))` which expects a default export. Update to:

```typescript
const CanvasPage = dynamic(
  () => import("@/components/canvas/canvas-page").then((mod) => mod.CanvasPage),
  { ssr: false }
);
```

### 5C. Final verification pass

Run full build + lint to catch any stragglers.

### Research Insight: Post-merge navigation entry point risk

From project learning `post-merge-missing-navigation-entry-point.md`: After a merge, navigation entry points can silently break. Phase 5C should include a **full navigation audit** — visit every page in the sidebar and verify it loads. The learning documents a case where SegmentsPage became orphaned after a merge because the only UI element calling `setActiveView("segments")` was removed.

### Phase 5 Testing Plan

| # | Verification | Command / Check | Pass Criteria |
|---|-------------|-----------------|---------------|
| 1 | Dead file removed | `ls src/lib/sidebar-context.tsx` | File not found |
| 2 | No imports to dead file | `grep -r "lib/sidebar-context" src/` | Zero matches |
| 3 | Canvas export fixed | `grep "export default" src/components/canvas/canvas-page.tsx` | Zero matches |
| 4 | Canvas dynamic import updated | Read `src/app/canvas/page.tsx` | Uses `.then((mod) => mod.CanvasPage)` |
| 5 | Full build passes | `pnpm build` | Zero errors |
| 6 | Lint passes | `pnpm lint` | Zero errors |
| 7 | Smoke: every page loads | Visit /, /canvas, /playbooks, /scouts, /metrics, /knowledge, /segments, /connectors | All pages render without errors |

---

## Execution Order & Dependencies

```
Phase 3 (independent, low-risk — do first)
  ├── 3A: conversation-store returns
  ├── 3C: scout-store split
  └── 3D: Rename store functions
      │
Phase 1 (additive, no risk)
  ├── 1A: gemini.ts
  ├── 1B: streaming.ts (with safeStringify)
  └── 1C: stripCodeFences
      │
Phase 2 (depends on Phase 1)
  ├── 2A: Replace Gemini clients (depends on 1A)
  ├── 2B: Replace NDJSON streams + streamDirectResponse (depends on 1B)
  └── 2C: Replace code-fence regex (depends on 1C)
      │
Phase 4 (depends on Phase 2 — hooks use streaming.ts)
  ├── 4A: useConversation
  ├── 4B: parseAnalyzeStream (plain function)
  ├── 4C: streamDirectResponse extraction
  └── 4D: useSegmentCreation
      │
Phase 5 (final cleanup — run last)
  ├── 5A: Remove dead sidebar-context
  ├── 5B: Fix canvas-page export
  └── 5C: Final verification + navigation audit
```

### Research Insight: Execution order change

Architecture reviewer recommended executing **Phase 3 before Phases 1-2**, not after. Rationale:
- Phase 3 (store normalization) is lower-risk and touches fewer runtime code paths
- Completing it first gets simpler mechanical changes out of the way
- Reduces the number of files in flight when hitting Phase 2 (highest behavioral risk — streaming protocol changes)
- If Phase 2 introduces a subtle streaming regression, you're not simultaneously debugging store rename issues

---

## Risk Mitigation

| Risk | Severity | Mitigation |
|------|----------|-----------|
| `streamDirectResponse` bypasses `send()` after Phase 2 migration | **High** | Explicit migration step in 2B; dedicated smoke test (empty query fallback) |
| Breaking streaming protocols | Medium | Phase 2 testing includes smoke tests for all 3 stream types (direct, quick, deep) |
| Store rename breaks callers | Low | Phase 3 uses grep to enumerate ALL callers before renaming; build verification after |
| Hook extraction introduces stale closures | Medium | Callback pattern (not closures over state); "adjust state during render" pattern; verify React compiler status |
| Hook extraction introduces render loop | Medium | Explicitly document dependency arrays; no `setMessages` inside `useEffect` that depends on `messages` |
| `switchConversation` during active stream | Medium | Phase 4A hook aborts active stream before switching; dedicated smoke test |
| Modal close during segment creation API call | Low | Check `segmentModal` is non-null before state updates in completion handler |
| Wrong sidebar-context deleted | Low | Phase 5A: grep confirms zero imports before deletion |
| Regression in any phase | Low | Each phase is a separate commit; `git revert` targets a single commit |
| Navigation entry point silently broken | Low | Phase 5C includes full navigation audit (lesson from post-merge learning) |

## Relevant Project Learnings Applied

| Learning | How It Applies |
|----------|---------------|
| `segment-detail-panel-ux-patterns.md` | "Adjust state during render" pattern used in Phase 4 hooks instead of `useEffect` for prop-change resets |
| `post-merge-missing-navigation-entry-point.md` | Phase 5C navigation audit; awareness that refactoring can silently orphan features |
| `classifier-misrouting-composite-queries.md` | Reminder that `page.tsx` and `classify/route.ts` are tightly coupled — Phase 4 extraction must preserve the classify → stream routing logic exactly |
| `follow-up-actions-card-redesign.md` | Documents the ChatInput ↔ page.tsx integration for follow-up actions — Phase 4D must preserve the `handleFollowUpAction` → `setSegmentModal` flow |

## Files Changed Summary

| Phase | New Files | Modified Files | Deleted Files |
|-------|-----------|---------------|---------------|
| 3 | `scout-types.ts`, `scout-data.ts` | 6 stores + ~8 callers = ~14 files | 0 |
| 1 | `gemini.ts`, `streaming.ts` | 0 | 0 |
| 2 | 0 | 9 (Gemini) + 3 (streams) + 4 (regex) = ~12 unique files | 0 |
| 4 | `use-conversation.ts`, `use-analyze-stream.ts`, `streaming-client.ts`, `use-segment-creation.ts` | `page.tsx` | 0 |
| 5 | 0 | `canvas-page.tsx`, `canvas/page.tsx` | `src/lib/sidebar-context.tsx` |

**Total:** ~8 new files, ~25 modified files, 1 deleted file.
