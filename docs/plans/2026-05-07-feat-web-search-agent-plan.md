---
title: "feat: Web Search Agent (Competitor Research via Parallel)"
type: feat
date: 2026-05-07
---

# feat: Web Search Agent — Competitor Research via Parallel Deep Research

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax. Implement task-by-task. **DO NOT COMMIT** — Vimarsh handles all git commits manually. Skip every `Commit` step in this plan; just leave the working tree dirty for him to review and commit himself.

**Goal:** Add a chat-driven competitor research agent. User types a question like "compare Vaastu HF to peers on financials and strategy"; the system routes to Parallel's Deep Research Task API, streams its progress (research plan → sources explored → intermediate findings → final report) into the existing research timeline, and renders a markdown report that can be saved as a Board.

**Architecture:** New `competitor_research` classify mode → new `POST /api/competitor-research` route → wraps user message in a structured prompt → creates Parallel Task with `enable_events: true` → opens a server-side SSE connection to Parallel → translates Parallel's event stream into the existing `AnalyzeSSEEvent` shape → forwards to client. No DuckDB, no per-company agent loop — Parallel does the multi-hop research server-side. Reuses the existing research-timeline UI, report renderer, and Save-as-Board flow.

**Tech Stack:** Next.js 16 App Router, Parallel Task API (Deep Research, `pro-fast` processor), NDJSON SSE, Clerk auth, existing prompt + classify infrastructure.

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `src/lib/parallel-client.ts` | Create | Thin Parallel SDK wrapper: `createTask`, `streamTaskEvents`, `fetchTaskResult`, `cancelTask`. No business logic. |
| `src/lib/prompts/competitor-research.ts` | Create | Single export: `buildCompetitorResearchInput(userMessage)` → wraps user message with report structure spec. |
| `src/app/api/competitor-research/route.ts` | Create | Auth → validate body → wrap input → create Parallel task → forward SSE events → emit `report` + `done`. |
| `src/lib/sse-types.ts` | Modify | Add 3 event variants to `AnalyzeSSEEvent`: `web_search`, `web_extract`, `web_finding`. Update `VALID_ANALYZE_TYPES`. |
| `src/lib/prompts/classify.ts` | Modify | Add `competitor_research` mode + 3 few-shot examples + bias rule. Update `ClassifyResult` type. |
| `src/hooks/use-classify.ts` | Modify | Add `competitor_research` to `ClassifyResult["mode"]` union. Add `web-research` agent display metadata. |
| `src/hooks/use-analytics.ts` | Modify | Branch on `mode === "competitor_research"` → call new route. Add cases for the 3 new SSE events in the switch. |
| `.env.local.example` | Modify | Add `PARALLEL_API_KEY=` placeholder. |
| `scripts/test-competitor-research.ts` | Create | Manual smoke script: hits the live Parallel API once for a hardcoded query, logs every event. |
| `src/lib/parallel-client.test.ts` | Create | Unit tests with mocked `fetch`: createTask returns run_id, streamTaskEvents parses events, error mapping. |
| `src/app/api/competitor-research/route.test.ts` | Create | Route test: mock Parallel client, assert SSE event mapping (Parallel `source_explored` → ours `web_search`, etc.). |

---

## Conventions to follow

- `apiFetch()` for all client → backend calls (never raw `fetch`)
- All API routes start with `auth()` from `@clerk/nextjs/server`
- SSE format: NDJSON (one JSON object per line), typed via `AnalyzeSSEEvent`
- Strictly monochrome UI tokens (no color tokens added in this feature)
- Use `safeStringify` from `@/lib/safe-stringify` when serializing SSE events (handles BigInt)
- No `bd` task tracking inside this plan — but run `bd create` if you discover follow-up work

---

## Pre-flight

- [ ] **Step 0a — Verify env**

  Add to `.env.local` (do NOT commit):
  ```
  PARALLEL_API_KEY=<rotate the key Vimarsh shared in chat; use the new one>
  ```

  And to `.env.local.example` (commit this):
  ```
  PARALLEL_API_KEY=
  ```

- [ ] **Step 0b — Confirm SSE beta header is current**

  Per Parallel docs (as of 2026-05-07), the SSE endpoint requires header `parallel-beta: events-sse-2025-07-24`. Open https://docs.parallel.ai/task-api/task-deep-research and verify this header value hasn't changed. Update if it has.

---

## Task 1: Parallel client (lowest layer)

**Files:**
- Create: `src/lib/parallel-client.ts`

> **Note:** This project has no unit-test framework (only Playwright for e2e). Verify this module via the Task 8 smoke script that hits the live Parallel API. Run `pnpm tsc --noEmit` after implementation to verify types compile.

- [ ] **Step 1.1 — Implement `parallel-client.ts`**

```ts
/**
 * Thin wrapper for Parallel's Task API (Deep Research mode).
 *
 * Account is paid (credits, not free tier). No quota gating in code.
 *
 * Docs: https://docs.parallel.ai/task-api/task-deep-research
 */

const PARALLEL_BASE = "https://api.parallel.ai";
const SSE_BETA_HEADER = "events-sse-2025-07-24";

export class ParallelError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "ParallelError";
  }
}

interface CreateTaskOptions {
  input: string;
  processor?: "lite" | "base" | "core" | "pro" | "pro-fast" | "ultra" | "ultra-fast";
}

export interface ParallelTask {
  runId: string;
}

function apiKey(): string {
  const k = process.env.PARALLEL_API_KEY;
  if (!k) throw new ParallelError("PARALLEL_API_KEY not set");
  return k;
}

export async function createTask(opts: CreateTaskOptions): Promise<ParallelTask> {
  const res = await fetch(`${PARALLEL_BASE}/v1/tasks/runs`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: opts.input,
      processor: opts.processor ?? "pro-fast",
      enable_events: true,
      task_spec: { output_schema: { type: "text" } },
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ParallelError(body.error ?? `Parallel ${res.status}`, res.status);
  }
  const data = await res.json();
  return { runId: data.run_id };
}
```

- [ ] **Step 1.2 — Implement `streamTaskEvents`**

Append to `src/lib/parallel-client.ts`:
```ts
export interface ParallelEvent {
  type: string;
  [key: string]: unknown;
}

export async function* streamTaskEvents(runId: string, signal?: AbortSignal): AsyncGenerator<ParallelEvent> {
  const res = await fetch(`${PARALLEL_BASE}/v1beta/tasks/runs/${runId}/events`, {
    method: "GET",
    headers: {
      "x-api-key": apiKey(),
      "parallel-beta": SSE_BETA_HEADER,
      Accept: "text/event-stream",
    },
    signal,
  });
  if (!res.ok || !res.body) {
    throw new ParallelError(`Parallel SSE ${res.status}`, res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by blank lines; each frame may have multiple `data:` lines
    let frameEnd: number;
    while ((frameEnd = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, frameEnd);
      buffer = buffer.slice(frameEnd + 2);

      const dataLines = frame
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim());
      if (dataLines.length === 0) continue;

      const payload = dataLines.join("\n");
      try {
        yield JSON.parse(payload) as ParallelEvent;
      } catch {
        // Skip malformed frames; Parallel sometimes sends `:` keepalive lines we already filtered
      }
    }
  }
}
```

- [ ] **Step 1.3 — Implement `fetchTaskResult` and `cancelTask`**

Append:
```ts
export interface ParallelResult {
  markdown: string;
  basis: unknown[];
}

export async function fetchTaskResult(runId: string): Promise<ParallelResult> {
  const res = await fetch(`${PARALLEL_BASE}/v1/tasks/runs/${runId}/result`, {
    method: "GET",
    headers: { "x-api-key": apiKey() },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ParallelError(body.error ?? `Parallel result ${res.status}`, res.status);
  }
  const data = await res.json();
  const output = data?.result?.output ?? {};
  return {
    markdown: typeof output.content === "string" ? output.content : "",
    basis: Array.isArray(output.basis) ? output.basis : [],
  };
}

/** Best-effort cancellation. 404 (already finished) is silently OK. */
export async function cancelTask(runId: string): Promise<void> {
  const res = await fetch(`${PARALLEL_BASE}/v1/tasks/runs/${runId}/cancel`, {
    method: "POST",
    headers: { "x-api-key": apiKey() },
  });
  if (!res.ok && res.status !== 404) {
    // Don't throw — caller is in cleanup path
    console.warn(`[parallel] cancelTask ${runId}: ${res.status}`);
  }
}
```

- [ ] **Step 1.4 — Verify TypeScript compiles**

```bash
pnpm tsc --noEmit 2>&1 | grep -E "parallel-client|^src/lib/parallel-client" || echo "no errors in parallel-client.ts"
```

Expected: no errors in `parallel-client.ts`. (Other unrelated errors in the repo are OK.)

- [ ] **Step 1.5 — DO NOT COMMIT** (Vimarsh handles commits manually)

---

## Task 2: SSE event types (extend existing union)

**Files:**
- Modify: `src/lib/sse-types.ts`

- [ ] **Step 2.1 — Add three new event variants to `AnalyzeSSEEvent`**

In `src/lib/sse-types.ts`, replace the union with:

```ts
export type AnalyzeSSEEvent =
  | { type: "ack"; text: string }
  | { type: "plan"; agents: PlanAgent[] }
  | { type: "phase"; phase: "generating_sql" | "executing" | "synthesizing" | "researching" }
  | { type: "sql"; subagentId: string; queries: SqlQuery[] }
  | { type: "query_result"; subagentId: string; queryIndex: number; rowCount: number; timeMs: number; columns: string[]; preview: Record<string, unknown>[]; error?: string }
  | { type: "summary"; subagentId: string; content: string }
  | { type: "result"; subagentId: string; rowCount?: number; timeMs?: number; columns?: string[]; preview?: Record<string, unknown>[]; error?: string }
  | { type: "text"; delta: string }
  | { type: "report"; content: string }
  | { type: "recommendations"; actions: FollowUpAction[] }
  | { type: "web_search"; url: string; title: string; excerpt?: string }
  | { type: "web_extract"; url: string; title?: string; contentLength?: number }
  | { type: "web_finding"; content: string }
  | { type: "ping" }
  | { type: "done" }
  | { type: "error"; message: string };
```

- [ ] **Step 2.2 — Update `VALID_ANALYZE_TYPES`**

```ts
const VALID_ANALYZE_TYPES = new Set([
  "ack", "plan", "phase", "sql", "query_result", "summary",
  "result", "text", "report", "recommendations",
  "web_search", "web_extract", "web_finding",
  "ping", "done", "error",
]);
```

- [ ] **Step 2.3 — Verify TypeScript compiles**

```bash
pnpm tsc --noEmit
```
Expected: no new errors. (Existing errors unrelated to this change are OK; eyeball the diff.)

- [ ] **Step 2.4 — Commit**

```bash
git add src/lib/sse-types.ts
git commit -m "feat(competitor-research): add web_search/web_extract/web_finding SSE events"
```

---

## Task 3: Wrapper prompt

**Files:**
- Create: `src/lib/prompts/competitor-research.ts`

- [ ] **Step 3.1 — Create the prompt file**

`src/lib/prompts/competitor-research.ts`:
```ts
/**
 * Wraps a user's competitor-research question with a structured report spec
 * for Parallel's Deep Research Task API.
 *
 * Stays under Parallel's 15,000-char input limit (cap input to 12,000 chars).
 */

const REPORT_SPEC = `Produce a competitor comparison report. Focus on FINANCIALS and STRATEGY.

REPORT STRUCTURE (use exact section headings):
# {Subject company} vs Peers
## Snapshot
A markdown table comparing the subject company to each competitor on the most relevant metrics for their sector. Use whichever metrics the public data supports (e.g. revenue, AUM, employee count, growth %, NPAs, market share, ARR — pick what's actually available).

## Where {Subject} is ahead
3–5 short bullets, each citing a source.

## Where competitors are ahead
3–5 short bullets, each citing a source.

## Recent strategic moves (last 6 months)
For each company: 1–3 bullets on launches, M&A, leadership changes, geographic expansion, or notable news. Cite sources.

## Sources
Bulleted list of all URLs cited above with publish dates where known.

RULES:
- Cite EVERY number with an inline source link in markdown.
- If competitors are not named in the user's request, infer 3–4 from the sector and proceed.
- If the subject company can't be identified, return a one-paragraph response asking for clarification — do NOT fabricate a report.
- Keep the report under 1500 words. Tables and bullets are preferred over prose.`;

const MAX_USER_MESSAGE_CHARS = 12_000;

export function buildCompetitorResearchInput(userMessage: string): string {
  const trimmed = userMessage.slice(0, MAX_USER_MESSAGE_CHARS);
  return `${REPORT_SPEC}\n\n---\n\nUSER REQUEST:\n${trimmed}`;
}
```

- [ ] **Step 3.2 — Commit**

```bash
git add src/lib/prompts/competitor-research.ts
git commit -m "feat(competitor-research): add wrapper prompt with report spec"
```

---

## Task 4: API route — `/api/competitor-research`

**Files:**
- Create: `src/app/api/competitor-research/route.ts`
- Test: `src/app/api/competitor-research/route.test.ts`

- [ ] **Step 4.1 — Failing route test (mocks Parallel client)**

`src/app/api/competitor-research/route.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: "user_test" })),
}));

vi.mock("@/lib/parallel-client", () => ({
  createTask: vi.fn(async () => ({ runId: "run_x" })),
  streamTaskEvents: vi.fn(async function* () {
    yield { type: "task_run.created", run_id: "run_x" };
    yield { type: "source_explored", url: "https://vastuhfc.com/financial-reports", title: "Vastu HF Financial Reports" };
    yield { type: "intermediate_finding", content: "Vaastu's Q4 FY26 AUM grew 28% YoY" };
    yield { type: "task_run.state", status: "completed" };
  }),
  fetchTaskResult: vi.fn(async () => ({ markdown: "# Report\n\nVaastu vs Aavas...", basis: [] })),
  cancelTask: vi.fn(),
}));

import { POST } from "./route";

async function readSseStream(res: Response): Promise<Array<Record<string, unknown>>> {
  const text = await res.text();
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

describe("POST /api/competitor-research", () => {
  it("returns 401 when unauthenticated", async () => {
    const { auth } = await import("@clerk/nextjs/server");
    (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ userId: null });
    const req = new Request("http://localhost/api/competitor-research", {
      method: "POST",
      body: JSON.stringify({ query: "compare us" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("maps Parallel events to AnalyzeSSEEvent shape and emits report+done", async () => {
    const req = new Request("http://localhost/api/competitor-research", {
      method: "POST",
      body: JSON.stringify({ query: "compare Vaastu HF to Aavas" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const events = await readSseStream(res);

    const types = events.map((e) => e.type);
    expect(types).toContain("phase");
    expect(types).toContain("web_search");
    expect(types).toContain("web_finding");
    expect(types).toContain("report");
    expect(types).toContain("done");

    const webSearch = events.find((e) => e.type === "web_search") as { url: string };
    expect(webSearch.url).toBe("https://vastuhfc.com/financial-reports");

    const report = events.find((e) => e.type === "report") as { content: string };
    expect(report.content).toContain("# Report");
  });

  it("emits error event when Parallel createTask fails", async () => {
    const { createTask } = await import("@/lib/parallel-client");
    (createTask as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("quota exceeded"));
    const req = new Request("http://localhost/api/competitor-research", {
      method: "POST",
      body: JSON.stringify({ query: "x" }),
    });
    const res = await POST(req);
    const events = await readSseStream(res);
    const err = events.find((e) => e.type === "error") as { message: string } | undefined;
    expect(err?.message).toContain("quota");
  });
});
```

- [ ] **Step 4.2 — Run test, confirm failure**

```bash
pnpm test src/app/api/competitor-research/route.test.ts
```
Expected: FAIL — route doesn't exist.

- [ ] **Step 4.3 — Implement the route**

`src/app/api/competitor-research/route.ts`:
```ts
import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import type { AnalyzeSSEEvent } from "@/lib/sse-types";
import { safeStringify } from "@/lib/safe-stringify";
import { buildCompetitorResearchInput } from "@/lib/prompts/competitor-research";
import {
  createTask,
  streamTaskEvents,
  fetchTaskResult,
  cancelTask,
  ParallelError,
} from "@/lib/parallel-client";

const RequestSchema = z.object({
  query: z.string().min(1).max(8000),
});

const HARD_TIMEOUT_MS = 5 * 60 * 1000; // 5 min

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { query } = parsed.data;
  const wrappedInput = buildCompetitorResearchInput(query);

  const encoder = new TextEncoder();
  const abort = new AbortController();
  let runId: string | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      function send(event: AnalyzeSSEEvent) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(safeStringify(event) + "\n"));
        } catch {
          closed = true;
        }
      }
      function close() {
        if (closed) return;
        closed = true;
        try { controller.close(); } catch { /* already closed */ }
      }

      // Hard timeout — abort everything if Parallel takes too long
      const timeoutId = setTimeout(() => {
        abort.abort();
        send({ type: "error", message: "Research timed out after 5 minutes." });
        if (runId) void cancelTask(runId);
        close();
      }, HARD_TIMEOUT_MS);

      // Heartbeat to keep the connection warm during long Parallel waits
      const heartbeat = setInterval(() => send({ type: "ping" }), 10_000);

      try {
        send({ type: "phase", phase: "researching" });

        const task = await createTask({ input: wrappedInput, processor: "pro-fast" });
        runId = task.runId;

        for await (const ev of streamTaskEvents(task.runId, abort.signal)) {
          const mapped = mapParallelEvent(ev);
          if (mapped) send(mapped);

          if (ev.type === "task_run.state") {
            const status = (ev as { status?: string }).status;
            if (status === "completed") {
              const result = await fetchTaskResult(task.runId);
              if (result.markdown) {
                // Stream the markdown as text deltas so the UI's typewriter effect runs,
                // then send the full report for "Save as Board".
                send({ type: "text", delta: result.markdown });
                send({ type: "report", content: result.markdown });
              } else {
                send({ type: "error", message: "Research completed but returned no content." });
              }
              break;
            }
            if (status === "failed" || status === "cancelled") {
              send({ type: "error", message: `Research ${status}.` });
              break;
            }
          }
        }

        send({ type: "done" });
      } catch (err) {
        const message = err instanceof ParallelError
          ? (err.status === 429 ? "Web research quota exhausted. Try again next month." : err.message)
          : err instanceof Error ? err.message : "Research failed.";
        send({ type: "error", message });
        if (runId) void cancelTask(runId);
      } finally {
        clearInterval(heartbeat);
        clearTimeout(timeoutId);
        close();
      }
    },
    cancel() {
      abort.abort();
      if (runId) void cancelTask(runId);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * Translate Parallel's event types to our AnalyzeSSEEvent shape.
 * Returns null for events we don't surface (e.g. internal `task_run.created`).
 */
function mapParallelEvent(ev: { type: string; [k: string]: unknown }): AnalyzeSSEEvent | null {
  switch (ev.type) {
    case "task_run.created":
      return null;
    case "research_plan":
      // Parallel may emit the plan as { plan: string } — surface it as a text chunk
      return typeof ev.plan === "string" ? { type: "web_finding", content: `**Research plan:** ${ev.plan}` } : null;
    case "source_explored": {
      const url = typeof ev.url === "string" ? ev.url : "";
      const title = typeof ev.title === "string" ? ev.title : url;
      const excerpt = typeof ev.excerpt === "string" ? ev.excerpt : undefined;
      return url ? { type: "web_search", url, title, excerpt } : null;
    }
    case "source_extracted": {
      const url = typeof ev.url === "string" ? ev.url : "";
      const title = typeof ev.title === "string" ? ev.title : undefined;
      const contentLength = typeof ev.content_length === "number" ? ev.content_length : undefined;
      return url ? { type: "web_extract", url, title, contentLength } : null;
    }
    case "intermediate_finding": {
      const content = typeof ev.content === "string" ? ev.content : "";
      return content ? { type: "web_finding", content } : null;
    }
    case "task_run.state":
      return null; // handled in caller
    default:
      return null;
  }
}
```

- [ ] **Step 4.4 — Run test, confirm pass**

```bash
pnpm test src/app/api/competitor-research/route.test.ts
```
Expected: 3 passing.

> Note on Parallel event names: the exact event types (`source_explored`, `source_extracted`, `intermediate_finding`, `research_plan`) are inferred from Parallel's SSE blog post. If the smoke test in Task 8 reveals different names, update the `mapParallelEvent` switch and re-run tests.

- [ ] **Step 4.5 — Commit**

```bash
git add src/app/api/competitor-research/route.ts src/app/api/competitor-research/route.test.ts
git commit -m "feat(competitor-research): add API route streaming Parallel events"
```

---

## Task 5: Classifier — add `competitor_research` mode

**Files:**
- Modify: `src/lib/prompts/classify.ts`
- Modify: `src/hooks/use-classify.ts`

- [ ] **Step 5.1 — Update `ClassifyResult` mode union (`use-classify.ts`)**

Edit `src/hooks/use-classify.ts:16` — extend the union:
```ts
mode: "analytics" | "direct" | "action" | "metric_update" | "metric_create" | "policy_create" | "playbook_modify" | "campaign_create" | "competitor_research";
```

- [ ] **Step 5.2 — Add classify mode definition (`classify.ts`)**

In `src/lib/prompts/classify.ts`, find the `mode` enumeration block (around line 34-42) and insert a new bullet **before** the `"analytics"` line:

```
   - "competitor_research" — the user wants to research, compare, benchmark, or investigate competitor companies, peers, market position, public financial reports, or industry players. Keywords: "research competitors", "compare us to peers", "competitor analysis", "how is {company} doing vs us", "industry benchmarks", "what are {company} doing lately", "compare our financials to peers", "market position vs", "look up {company}'s annual report", "deep dive on {company}". This mode runs web research (not SQL) — pick it ONLY when the question is about EXTERNAL companies/markets, not the user's own product data. If the question can be answered from the dataset (e.g. "our revenue last quarter"), use "analytics" instead.
```

Also add to the BIAS RULES block (after the existing rules):
```
- "research competitors" / "compare us to {Company X, Company Y}" / "how is {Company} doing financially" / "look up {Company}'s annual report" → mode "competitor_research"
- "what are our top competitors doing" / "deep dive on {Company}" / "industry benchmarks for {sector}" → mode "competitor_research"
```

And add to `STATIC_EXAMPLES`:
```ts
`- "research our competitors and compare financials" → {"mode":"competitor_research","complexity":"simple","complexityReason":null,"metricId":null,"actionType":null,"extractedDescription":null,"metricName":null}`,
`- "compare Vaastu HF to Aavas and Aptus" → {"mode":"competitor_research","complexity":"simple","complexityReason":null,"metricId":null,"actionType":null,"extractedDescription":null,"metricName":null}`,
`- "look up HDFC's latest annual report and compare to us" → {"mode":"competitor_research","complexity":"simple","complexityReason":null,"metricId":null,"actionType":null,"extractedDescription":null,"metricName":null}`,
```

- [ ] **Step 5.3 — Add `web-research` agent display metadata (`use-classify.ts`)**

In `src/hooks/use-classify.ts`, find the `AGENT_DISPLAY` const (around line 77) and add:
```ts
"web-research": { name: "Web Research Agent", icon: "globe" },
```
(Confirm `globe` exists in your icon set; if not, use the same icon as `research`.)

- [ ] **Step 5.4 — Smoke-check the classifier**

```bash
pnpm dev
# In a separate terminal, hit /api/classify with a sample message:
curl -s -X POST http://localhost:3000/api/classify \
  -H "Content-Type: application/json" \
  -H "x-dataset-id: quickhelp" \
  -d '{"query":"research our competitors and compare financials"}' | jq .
```
Expected: `mode: "competitor_research"`. (You'll need to be signed in via Clerk; alternatively run the classifier function directly in a `tsx` REPL.)

If the classifier doesn't pick the new mode, the few-shot examples may not be reaching the prompt — check `buildClassifyPrompt()` to confirm `{EXAMPLES}` template is being substituted.

- [ ] **Step 5.5 — Commit**

```bash
git add src/lib/prompts/classify.ts src/hooks/use-classify.ts
git commit -m "feat(competitor-research): add classify mode + agent display"
```

---

## Task 6: Wire the new mode into `use-analytics`

**Files:**
- Modify: `src/hooks/use-analytics.ts`

- [ ] **Step 6.1 — Locate the mode dispatch**

Open `src/hooks/use-analytics.ts` and locate where `classifyResult.mode` is branched (the route call at line ~1205 is currently `/api/analyze` for analytics mode). The classify normalization at line 611 falls through to `analytics`. We need to add a new branch BEFORE that fallthrough so `competitor_research` routes to the new endpoint.

- [ ] **Step 6.2 — Update the classify normalization (line ~611)**

Find:
```ts
r.mode === "action" || r.mode === "metric_create" || r.mode === "policy_create" || r.mode === "campaign_create" ? r : { ...r, mode: "analytics" as const }
```

Replace with:
```ts
r.mode === "action" || r.mode === "metric_create" || r.mode === "policy_create" || r.mode === "campaign_create" || r.mode === "competitor_research" ? r : { ...r, mode: "analytics" as const }
```

- [ ] **Step 6.3 — Add new branch in the analytics handler**

Locate the call to `apiFetch("/api/analyze", ...)` around line 1205. Wrap the existing analytics block in a mode check:

```ts
const analyzeEndpoint = classifyResult.mode === "competitor_research"
  ? "/api/competitor-research"
  : "/api/analyze";

const analyzeBody = classifyResult.mode === "competitor_research"
  ? { query: text }
  : { query: text, mode, knowledgeContext: pageCtx + knowledgeCtx + entityCtx, pageContext: sqlPageCtx };

const res = await apiFetch(analyzeEndpoint, {
  method: "POST",
  body: analyzeBody,
  signal: abort.signal,
  stream: true,
});
```

- [ ] **Step 6.4 — Add a `web-research` subagent into the deep-mode message scaffold for the new mode**

When the new mode runs, we want the timeline to show a single agent ("Web Research Agent") receiving `web_search` / `web_extract` / `web_finding` events. Just before the `apiFetch` call in 6.3, if `competitor_research`, seed an agent message with one subagent:

```ts
let competitorAgentMsgId: string | null = null;
if (classifyResult.mode === "competitor_research") {
  competitorAgentMsgId = `agent-${Date.now()}`;
  setMessages((prev) => [
    ...prev,
    {
      id: competitorAgentMsgId!,
      role: "assistant",
      type: "agent",
      content: "",
      planText: "Researching competitors on the web...",
      status: "processing",
      statusLabel: "Researching",
      subagents: [{
        id: "web-research",
        name: "Web Research Agent",
        status: "processing",
        queries: [],
        expectedQueryCount: 0,
      }],
      timestamp: Date.now(),
    },
  ]);
}
```

(Match the exact `Message` shape used elsewhere in the file — copy a nearby `setMessages` for the deep-mode `agent` message and adapt. If the local `Message`/`Subagent` types require additional fields, fill them with safe defaults.)

- [ ] **Step 6.5 — Add cases for the 3 new SSE events in the switch (line ~1234)**

Inside the existing `switch (event.type)` block, add:

```ts
case "web_search": {
  if (classifyResult.mode !== "competitor_research") break;
  setMessages((prev) =>
    updateAgentMsg(prev, competitorAgentMsgId!, (agent) => ({
      ...agent,
      subagents: agent.subagents.map((s) =>
        s.id === "web-research"
          ? {
              ...s,
              queries: [
                ...s.queries,
                {
                  queryIndex: s.queries.length,
                  description: event.title,
                  url: event.url,
                  excerpt: event.excerpt ?? "",
                  status: "complete",
                },
              ],
            }
          : s
      ),
    }))
  );
  break;
}

case "web_extract": {
  if (classifyResult.mode !== "competitor_research") break;
  // Extract events get appended to the same web-research subagent's queries
  setMessages((prev) =>
    updateAgentMsg(prev, competitorAgentMsgId!, (agent) => ({
      ...agent,
      subagents: agent.subagents.map((s) =>
        s.id === "web-research"
          ? {
              ...s,
              queries: [
                ...s.queries,
                {
                  queryIndex: s.queries.length,
                  description: event.title ? `Extracted: ${event.title}` : `Extracted ${event.url}`,
                  url: event.url,
                  excerpt: "",
                  status: "complete",
                },
              ],
            }
          : s
      ),
    }))
  );
  break;
}

case "web_finding": {
  if (classifyResult.mode !== "competitor_research") break;
  setMessages((prev) =>
    updateAgentMsg(prev, competitorAgentMsgId!, (agent) => ({
      ...agent,
      subagents: agent.subagents.map((s) =>
        s.id === "web-research"
          ? { ...s, content: (s.content ?? "") + event.content + "\n\n" }
          : s
      ),
    }))
  );
  break;
}
```

> If the local `Subagent`/`SubagentQuery` shapes don't have a `url`/`excerpt` field, add them as optional fields and update `research-timeline.tsx` to render them when present (single conditional `<a href>` per query).

- [ ] **Step 6.6 — Update `phase: "researching"` in the existing `phase` case**

Find the `case "phase"` block (line ~1235) and add a clause:
```ts
} else if (phase === "researching") {
  setMessages((prev) =>
    updateAgentMsg(prev, competitorAgentMsgId!, (agent) => ({
      ...agent,
      status: "processing",
      statusLabel: "Researching the web",
    }))
  );
}
```

- [ ] **Step 6.7 — Verify TypeScript and ESLint**

```bash
pnpm tsc --noEmit
pnpm lint
```
Expected: no new errors related to this feature.

- [ ] **Step 6.8 — Commit**

```bash
git add src/hooks/use-analytics.ts
git commit -m "feat(competitor-research): wire classify mode into analytics hook + SSE handling"
```

---

## Task 7: Render web-research queries in the timeline

**Files:**
- Modify: `src/components/chat/research-timeline.tsx`

- [ ] **Step 7.1 — Inspect the existing query renderer**

```bash
grep -n "queryIndex\|query.description\|query.sql" src/components/chat/research-timeline.tsx | head -20
```

Identify where each query inside a subagent is rendered. The web-research queries use `description` and may have an additional `url` field.

- [ ] **Step 7.2 — Render URL link when present**

In the query render block, after the description, add:

```tsx
{("url" in query && query.url) ? (
  <a
    href={query.url as string}
    target="_blank"
    rel="noopener noreferrer"
    className="text-xs text-muted-foreground hover:text-foreground hover:underline truncate block"
  >
    {query.url as string}
  </a>
) : null}
```

This renders nothing for SQL queries (which don't have `url`) and surfaces a link for web-research queries. Strictly monochrome — uses existing `muted-foreground` / `foreground` tokens only.

- [ ] **Step 7.3 — Manual UI check**

```bash
pnpm dev
```

Open localhost:3000, sign in, switch to a dataset, type:
```
research our competitors in housing finance and compare financials
```

Expected:
- Timeline shows a "Web Research Agent" with status "Researching the web"
- As Parallel emits `source_explored` events, query rows appear with title + URL link
- Streamed `intermediate_finding` text accumulates in the agent's content area
- On completion, the report appears with markdown rendered + "Save as Board" CTA

If anything is missing, debug the specific stage (route, hook, renderer) before proceeding.

- [ ] **Step 7.4 — Commit**

```bash
git add src/components/chat/research-timeline.tsx
git commit -m "feat(competitor-research): render URL links in timeline for web queries"
```

---

## Task 8: Smoke test script (live Parallel call)

**Files:**
- Create: `scripts/test-competitor-research.ts`

- [ ] **Step 8.1 — Create script**

`scripts/test-competitor-research.ts`:
```ts
/**
 * Manual smoke test for the Parallel client.
 *
 * Usage:
 *   PARALLEL_API_KEY=... npx tsx scripts/test-competitor-research.ts "research vaastu hf vs peers"
 *
 * Costs ONE Parallel task per run.
 */

import { createTask, streamTaskEvents, fetchTaskResult } from "../src/lib/parallel-client";
import { buildCompetitorResearchInput } from "../src/lib/prompts/competitor-research";

async function main() {
  const userMessage = process.argv[2];
  if (!userMessage) {
    console.error("Usage: tsx scripts/test-competitor-research.ts \"<query>\"");
    process.exit(1);
  }

  const input = buildCompetitorResearchInput(userMessage);
  console.log(`[input] ${input.length} chars`);

  const start = Date.now();
  const task = await createTask({ input, processor: "pro-fast" });
  console.log(`[task] runId=${task.runId}`);

  let eventCount = 0;
  for await (const ev of streamTaskEvents(task.runId)) {
    eventCount += 1;
    console.log(`[event #${eventCount}] type=${ev.type}`, JSON.stringify(ev).slice(0, 200));
    if (ev.type === "task_run.state" && (ev as { status?: string }).status === "completed") break;
    if (ev.type === "task_run.state" && (ev as { status?: string }).status === "failed") {
      console.error("[failed]");
      process.exit(1);
    }
  }

  const result = await fetchTaskResult(task.runId);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n[done] ${elapsed}s, ${eventCount} events, ${result.markdown.length} chars`);
  console.log("\n=== REPORT ===\n");
  console.log(result.markdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 8.2 — Run it once**

```bash
PARALLEL_API_KEY=<your-key> npx tsx scripts/test-competitor-research.ts "research Vaastu HF vs other Indian housing finance players, compare financials and recent moves"
```

Expected:
- Logs `[task] runId=...` within 1-2s
- Streams events for 30-120s
- Prints final markdown report
- Total elapsed time logged

**Verify the event types in the log match what `mapParallelEvent` expects** (`source_explored`, `source_extracted`, `intermediate_finding`, `research_plan`, `task_run.state`). If any differ, update `mapParallelEvent` in `src/app/api/competitor-research/route.ts` and re-run unit tests in Task 4.

- [ ] **Step 8.3 — Commit**

```bash
git add scripts/test-competitor-research.ts
git commit -m "feat(competitor-research): add smoke test script"
```

---

## Task 9: End-to-end manual test

- [ ] **Step 9.1 — Start dev server**

```bash
pnpm dev
```

- [ ] **Step 9.2 — Sign in, run two scenarios**

**Scenario A — explicit competitors:**
```
compare Vaastu HF to Aavas Financiers and Aptus on financials and recent moves
```

Expected:
- Within ~2s: timeline appears with "Web Research Agent" / "Researching the web"
- Within ~10-30s: source URLs appear in the agent's queries
- Within ~60-120s: report streams in, "Save as Board" CTA visible
- Click "Save as Board" → board created with the report's sections

**Scenario B — implicit competitors:**
```
research our top competitors in housing finance and benchmark our growth
```

Expected: Parallel infers competitors from sector, report includes 3-4 named competitors.

**Scenario C — quota / error path:** (skip if you don't want to burn quota)
Temporarily unset `PARALLEL_API_KEY`, send any competitor research query.
Expected: friendly error in chat, no half-rendered report.

- [ ] **Step 9.3 — Confirm classifier doesn't false-positive**

Send these 3 queries; each should NOT route to `competitor_research`:
```
show me revenue last quarter           → analytics
create a metric for cancellation rate  → metric_create
hi                                     → direct
```

If any false-positive, tighten the BIAS RULES in `classify.ts` and re-test.

- [ ] **Step 9.4 — No commit needed; if any bugs found, file `bd` items**

```bash
bd create "competitor-research: <bug description>" --type bug
```

---

## Task 10: Documentation + final cleanup

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 10.1 — Add a short reference to the new mode**

In `CLAUDE.md`, find the "Two Analysis Modes" section. Add a third bullet:

```
- **Competitor Research**: web-only research path via Parallel's Deep Research API. Triggered by `competitor_research` classify mode. No DuckDB. Streams web sources + findings via the same SSE event shape (with `web_search` / `web_extract` / `web_finding` extensions). Required env: `PARALLEL_API_KEY`.
```

Also update the "Required Environment" section to add:
```
- `PARALLEL_API_KEY` — Parallel.ai API key for competitor-research web search
```

- [ ] **Step 10.2 — Run lint + tests one more time**

```bash
pnpm lint
pnpm test
```
Expected: no new errors.

- [ ] **Step 10.3 — Commit**

```bash
git add CLAUDE.md
git commit -m "docs(competitor-research): document new mode + env var"
```

---

## Acceptance Criteria

- [ ] User typing "compare us to competitors" in chat routes to `/api/competitor-research`
- [ ] Research timeline shows "Web Research Agent" with live URL rows as Parallel discovers sources
- [ ] Streaming intermediate findings appear under the agent
- [ ] Final markdown report renders with "Save as Board" CTA, and saving works end-to-end
- [ ] Errors (quota, timeout, API failures) surface as friendly messages, no half-reports
- [ ] Stream cancellation (dataset switch / user stops) cancels the Parallel task server-side
- [ ] Existing analytics flow is unaffected (regression test: send a SQL question, deep mode still works)
- [ ] No raw `fetch()` calls in client code (all go through `apiFetch`)
- [ ] Strictly monochrome UI — no new color tokens introduced
- [ ] Hardcoded `PARALLEL_API_KEY` secret never committed

---

## Out of Scope (file as `bd` items if needed)

- Persistence of research runs (no "research history" page yet — user saves as Board if wanted)
- Caching duplicate queries
- Multi-turn refinement ("now add Repco" continues the previous research)
- Saved competitor lists per workspace
- Charts inside the report (Parallel returns markdown; if it includes tables we render them; we don't extract numbers for chart blocks in v1)
- Per-workspace Tavily/Parallel quota tracking and throttling
- Enrichment-API hybrid for snapshot tables (defer to v2 once Deep Research output quality is judged)
- Webhook-based completion (we use SSE only; webhook path can be added if running tasks from background jobs)

---

## Open Questions to Resolve Before Merge

- [ ] **Exact SSE event names**: Task 8 smoke test must verify Parallel's actual event field names match `mapParallelEvent`. Update if different.
- [ ] **Processor choice**: `pro-fast` is the v1 default. After 5-10 real runs, decide if `core` (faster, cheaper) or `pro` (slower, deeper) is better for our use case.
- [ ] **Cancel endpoint URL**: `POST /v1/tasks/runs/{id}/cancel` is assumed; verify against Parallel docs/dashboard. If the path differs, update `cancelTask`.
