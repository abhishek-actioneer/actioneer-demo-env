# Dynamic Playbook Seeding Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded playbook list with on-demand LLM generation of a "Company Health Check" playbook when a user first visits `/playbooks` for any dataset.

**Architecture:** The playbooks page detects no playbooks exist for the current dataset, calls the existing `/api/playbook/create` endpoint with a health-check prompt, streams and assembles the result, saves to the in-memory store. Hardcoded data (`PLAYBOOK_LIST`, `MOCK_PLAYBOOK`, `TEMPLATE_PLAYBOOKS`) is removed entirely.

**Tech Stack:** Next.js 16 App Router, React 19, apiFetch, NDJSON streaming, in-memory playbook store

**Spec:** `docs/superpowers/specs/2026-03-17-dynamic-playbook-seeding-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/playbook-data.ts` | Delete | Was hardcoded seed data — no longer needed |
| `src/lib/playbook-store.ts` | Modify | Remove `PLAYBOOK_LIST` import/merge, add `isDatasetSeeded`/`markDatasetSeeded` |
| `src/app/api/playbook/run/route.ts` | Modify | Remove `MOCK_PLAYBOOK` fallback, require playbook in body |
| `src/components/sidebar/panels.tsx` | Modify | Remove `PLAYBOOK_LIST` import, use only `getSavedPlaybookSummaries()` |
| `src/app/playbooks/[id]/page.tsx` | Modify | Remove `MOCK_PLAYBOOK`/`TEMPLATE_PLAYBOOKS` references |
| `src/app/playbooks/page.tsx` | Modify | Add auto-seeding logic with loading state |

---

## Task 1: Remove hardcoded playbook data and fix imports

**Files:**
- Delete: `src/lib/playbook-data.ts`
- Modify: `src/lib/playbook-store.ts:1-14,189-200`
- Modify: `src/app/api/playbook/run/route.ts:1-23`
- Modify: `src/components/sidebar/panels.tsx:15,130-135`
- Modify: `src/app/playbooks/[id]/page.tsx:10,78-91`
- Modify: `src/app/playbooks/page.tsx:8,29-36`

- [ ] **Step 1: Delete `src/lib/playbook-data.ts`**

Remove the file entirely.

- [ ] **Step 2: Update `src/lib/playbook-store.ts`**

Remove the import of `PLAYBOOK_LIST` from `playbook-data` (line 13). Update `getAllPlaybookSummariesMerged` to just return saved summaries filtered by dataset:

```typescript
export function getAllPlaybookSummariesMerged(datasetId?: string): PlaybookSummary[] {
  let saved = Array.from(savedPlaybooks.values());
  if (datasetId) {
    saved = saved.filter((pb) => !pb.datasetId || pb.datasetId === datasetId);
  }
  return saved.map(toPlaybookSummary);
}
```

Add seeded dataset tracking at the top of the file (after the `savedPlaybooks` Map):

```typescript
const seededDatasets = new Set<string>();

export function isDatasetSeeded(datasetId: string): boolean {
  return seededDatasets.has(datasetId);
}

export function markDatasetSeeded(datasetId: string): void {
  seededDatasets.add(datasetId);
}
```

- [ ] **Step 3: Update `src/app/api/playbook/run/route.ts`**

Remove the `MOCK_PLAYBOOK` import. Change the default playbook handling to require it in the body:

```typescript
import { NextRequest } from "next/server";
import { runPlaybookV1, runPlaybookV2 } from "@/lib/playbook-executor";
import type { ModelId } from "@/lib/llm";
import type { Playbook, PlaybookV2, AnyPlaybook } from "@/lib/playbook-types";
import { isPlaybookV2 } from "@/lib/playbook-types";

export async function POST(req: NextRequest) {
  const modelId = (req.headers.get("x-model-id") ?? undefined) as ModelId | undefined;
  const datasetId = req.headers.get("x-dataset-id") ?? undefined;
  let playbook: AnyPlaybook | null = null;
  let paramOverrides: Record<string, string> | undefined;
  try {
    const body = await req.json();
    if (body?.playbook) {
      playbook = body.playbook as AnyPlaybook;
    }
    if (body?.paramOverrides) {
      paramOverrides = body.paramOverrides as Record<string, string>;
    }
  } catch {
    // No body or invalid JSON
  }

  if (!playbook) {
    return Response.json({ error: "playbook is required in request body" }, { status: 400 });
  }
```

The rest of the file stays the same.

- [ ] **Step 4: Update `src/components/sidebar/panels.tsx`**

Remove the `PLAYBOOK_LIST` import (line 15). Update `PlaybooksPanel` to use only saved summaries:

```typescript
export function PlaybooksPanel() {
  const { playbookVersion } = useSidebarContext();
  void playbookVersion;
  const playbooks = getSavedPlaybookSummaries();

  return (
```

Everything else in the component stays the same.

- [ ] **Step 5: Update `src/app/playbooks/[id]/page.tsx`**

Remove imports of `MOCK_PLAYBOOK` and `TEMPLATE_PLAYBOOKS` from `@/lib/playbook-data` (line 10).

Remove the `isMock` variable (line 78).

Simplify the initial state and useEffect to only check the store:

```typescript
const [rawPlaybook, setRawPlaybook] = useState<AnyPlaybook | null>(null);

useEffect(() => {
  const fromStore = getPlaybook(playbookId);
  setRawPlaybook(fromStore ?? null);
}, [playbookId, revision]);
```

- [ ] **Step 6: Update `src/app/playbooks/page.tsx`**

Remove the `PLAYBOOK_LIST` import (line 8). Update `allPlaybooks` to use only saved summaries:

```typescript
const savedSummaries = getSavedPlaybookSummaries();
const allPlaybooks = useMemo(() => savedSummaries, [savedSummaries.length]);
```

- [ ] **Step 7: Verify the build compiles**

Run: `pnpm build 2>&1 | head -50`
Expected: No import errors for `playbook-data` exports.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: remove hardcoded playbook data (PLAYBOOK_LIST, MOCK_PLAYBOOK)"
```

---

## Task 2: Add auto-seeding logic to playbooks page

**Files:**
- Modify: `src/app/playbooks/page.tsx`

- [ ] **Step 1: Add seeding imports and state**

Add imports at the top of `src/app/playbooks/page.tsx`:

```typescript
import { useRef, useEffect, useCallback } from "react";
import { useDataset } from "@/lib/dataset-context";
import { isDatasetSeeded, markDatasetSeeded } from "@/lib/playbook-store";
import { savePlaybook } from "@/lib/playbook-store";
import { apiFetch } from "@/lib/api-client";
import type { PlaybookV2, PlaybookCellV2 } from "@/lib/playbook-types";
```

Add state and refs inside the component:

```typescript
const { datasetId } = useDataset();
const [isSeeding, setIsSeeding] = useState(false);
const [seedRevision, setSeedRevision] = useState(0);
const abortRef = useRef<AbortController | null>(null);
const hasTriggered = useRef(false);
```

- [ ] **Step 2: Add the seed generation function**

Add `seedPlaybook` function inside the component (before the return):

```typescript
const SEED_PROMPT = "Create a comprehensive health check playbook that analyzes overall business performance — key metrics trends, user activity patterns, retention health, and revenue analysis";

const seedPlaybook = useCallback(async (capturedDatasetId: string) => {
  setIsSeeding(true);
  const abort = new AbortController();
  abortRef.current = abort;

  try {
    const res = await apiFetch("/api/playbook/create", {
      method: "POST",
      body: { query: SEED_PROMPT, proceedWithout: true, datasetId: capturedDatasetId },
      stream: true,
      signal: abort.signal,
    }) as Response;

    if (!res.ok || !res.body) throw new Error("Seed generation failed");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let cells: PlaybookCellV2[] = [];
    let meta: { name: string; description: string } | null = null;
    let params: PlaybookV2["params"] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop()!;

      for (const line of lines) {
        if (!line.trim()) continue;
        let event: Record<string, unknown>;
        try { event = JSON.parse(line); } catch { continue; }

        switch (event.type) {
          case "playbook_meta":
            meta = { name: event.name as string, description: event.description as string };
            break;
          case "outline_cell": {
            const cell = event.cell as PlaybookCellV2;
            cells = [...cells, { ...cell, status: "idle", skeleton: true }];
            break;
          }
          case "cell_detail": {
            const cellId = event.cellId as string;
            cells = cells.map((c) =>
              c.id === cellId
                ? { ...c, skeleton: false, sql: (event.sql as string | undefined) ?? c.sql, prompt: (event.prompt as string | undefined) ?? c.prompt, outputs: (event.outputs as string[] | undefined) ?? c.outputs }
                : c
            );
            break;
          }
          case "cell": {
            const cell = event.cell as PlaybookCellV2;
            cells = [...cells, { ...cell, status: "idle" }];
            break;
          }
          case "params":
            params = (event.params as PlaybookV2["params"]) ?? [];
            break;
        }
      }
    }

    // Strip skeleton flags
    cells = cells.map((c) => c.skeleton ? { ...c, skeleton: false } : c);

    if (cells.length > 0) {
      const id = `seed-${capturedDatasetId}-${Date.now().toString(36)}`;
      const pb: PlaybookV2 = {
        id,
        schemaVersion: 2,
        name: meta?.name ?? "Company Health Check",
        description: meta?.description ?? "Comprehensive health analysis of key business metrics",
        category: "Health Check",
        version: "v1.0",
        approvalStatus: "Draft",
        owner: "Auto-generated",
        ownerInitials: "AG",
        cells,
        params,
        produces: [],
        runHistory: [],
        changelog: [],
        datasetId: capturedDatasetId,
      };
      savePlaybook(pb);
    }

    markDatasetSeeded(capturedDatasetId);
    setSeedRevision((r) => r + 1);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      // Dataset switched or unmounted — don't mark as seeded
      return;
    }
    console.error("Playbook seed error:", err);
    markDatasetSeeded(capturedDatasetId);
  } finally {
    setIsSeeding(false);
    abortRef.current = null;
  }
}, []);
```

- [ ] **Step 3: Add the trigger useEffect**

Add the auto-seed trigger after the `seedPlaybook` definition:

```typescript
// Auto-seed on first visit if no playbooks exist for this dataset
useEffect(() => {
  const saved = getSavedPlaybookSummaries();
  const hasPlaybooks = saved.some((p) => p.datasetId === datasetId || !p.datasetId);
  if (!hasPlaybooks && !isDatasetSeeded(datasetId) && !isSeeding) {
    seedPlaybook(datasetId);
  }
}, [datasetId, seedRevision, seedPlaybook, isSeeding]);

// Abort on unmount or dataset switch
useEffect(() => {
  return () => {
    abortRef.current?.abort();
  };
}, [datasetId]);
```

- [ ] **Step 4: Update `allPlaybooks` to include seed revision dependency**

```typescript
const savedSummaries = getSavedPlaybookSummaries();
const allPlaybooks = useMemo(() => {
  return savedSummaries.filter((p) => p.datasetId === datasetId || !p.datasetId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [savedSummaries.length, seedRevision, datasetId]);
```

- [ ] **Step 5: Add loading UI**

Replace the table section in the JSX. Wrap the existing table `<div className="border border-border rounded-lg ...">` with a conditional:

```typescript
{isSeeding ? (
  <div className="flex flex-col items-center justify-center py-24 gap-4">
    <svg className="w-6 h-6 animate-spin text-muted-foreground" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" className="text-border" />
      <path d="M14.5 8a6.5 6.5 0 0 0-6.5-6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-foreground" />
    </svg>
    <p className="text-sm text-muted-foreground">Setting up your first playbook...</p>
  </div>
) : (
  /* existing table JSX */
)}
```

- [ ] **Step 6: Verify dev server works**

Run: `pnpm dev` and visit `/playbooks` — should see loading spinner, then the generated playbook appears.

- [ ] **Step 7: Commit**

```bash
git add src/app/playbooks/page.tsx
git commit -m "feat: auto-seed health check playbook on first visit per dataset"
```

---

## Task 3: Verify end-to-end flow

- [ ] **Step 1: Run build**

Run: `pnpm build 2>&1 | tail -20`
Expected: Build succeeds with no errors.

- [ ] **Step 2: Run existing playbook API tests**

Run: `npx playwright test tests/api/playbooks.spec.ts --reporter=line 2>&1 | tail -20`
Expected: All 5 tests pass. The `/api/playbook/run` test already sends a playbook in the body so it won't be affected by removing the MOCK_PLAYBOOK fallback.

- [ ] **Step 3: Manual verification**

1. Open `/playbooks` — should show spinner, then health check playbook appears
2. Click the playbook — should open detail page with cells
3. Click "Run" — should execute the playbook
4. Navigate back to `/playbooks` — should show the playbook (no re-generation)
5. Switch dataset — visit `/playbooks` again — should seed for new dataset

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address issues from end-to-end verification"
```
