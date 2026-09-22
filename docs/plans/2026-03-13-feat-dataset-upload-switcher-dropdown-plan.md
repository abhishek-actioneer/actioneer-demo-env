---
title: "feat: Add dataset upload to workspace switcher dropdown"
type: feat
date: 2026-03-13
---

# feat: Add Dataset Upload to Workspace Switcher Dropdown

## Overview

The dataset upload route (`POST /api/datasets/upload`) exists and is fully functional — it was never removed. There is currently no UI entry point to use it. This plan adds an "Upload dataset..." action at the bottom of the workspace/dataset switcher dropdown in the sidebar, wiring it to a new upload modal that invokes the existing API.

## Problem Statement

Users have no way to upload new datasets (CSV or DuckDB files) from the UI. The upload API supports CSV (≤50MB per file, ≤200MB total) and `.duckdb` files (≤150MB), performs LLM schema enrichment via Gemini, and persists the result to `data/datasets/<id>/config.json`. But there is zero surface area to reach it.

## Proposed Solution

1. Add a separator and "Upload dataset..." item at the bottom of the dataset switcher dropdown in `src/components/sidebar.tsx`
2. Create a new `DatasetUploadModal` component (`src/components/dataset-upload-modal.tsx`) using shadcn Dialog
3. On successful upload: close modal, refresh the dataset list, and switch to the new dataset

## Technical Approach

### Files to Modify

- **`src/components/sidebar.tsx`** — add import, modal state, and "Upload dataset..." button inside the dropdown popover (after the `allDatasets.map(...)` block)
- **`src/components/dataset-upload-modal.tsx`** — new component (see below)

### New Component: `DatasetUploadModal`

```tsx
// src/components/dataset-upload-modal.tsx
interface DatasetUploadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded: (newId: string) => void;
}
```

**Existing pattern to follow:** `src/components/knowledge/knowledge-import.tsx` — uses a custom modal overlay (`fixed inset-0 bg-black/50 flex items-center justify-center z-50`) with a dashed-border file drop zone and hidden `<input type="file" ref={fileInputRef} />`. Follow this pattern exactly (not shadcn Dialog) for visual consistency.

**Modal contents:**
- Header: "Upload dataset" + `X` close button (disabled while upload is in-flight)
- **File drop zone**: dashed-border button (`border-2 border-dashed`) that triggers `fileInputRef.current?.click()`. Shows filename when selected, else "Choose a file / .csv or .duckdb"
- **Hidden file input**: `accept=".csv,.duckdb"` — V1: single file only (no `multiple`; server multi-CSV support deferred)
- **Label input**: text field, auto-populated from the selected filename (strip extension, replace `[-_]` with spaces, title-case). `labelTouched` boolean prevents auto-fill from overwriting a manually edited label. Changing file selection only re-auto-fills if `!labelTouched`.
- **Upload button**: disabled while loading, no file selected, or label is empty; shows `Loader2` spinner + "Uploading..." text during upload
- **In-progress state**: show static message "Processing... This may take up to 2 minutes." below the button; close button is disabled
- **Error display**: `text-xs text-destructive` below label input
- **State reset**: when modal closes (`onOpenChange(false)`), reset all state after a short delay so re-opening is fresh

**Upload logic (inside the modal):**
```typescript
// FormData upload — raw fetch (NOT apiFetch), per CLAUDE.md exception for multipart
const abortController = new AbortController(); // thread signal through fetch
setController(abortController);

const formData = new FormData();
formData.append("label", label.trim());
formData.append("file", file);

const res = await fetch("/api/datasets/upload", {
  method: "POST",
  signal: abortController.signal,
  headers: { "x-dataset-id": datasetId },  // from useDataset()
  body: formData,
});

// Non-JSON guard (handles 504 Gateway Timeout from Railway/Vercel)
let data: { id?: string; error?: string };
try {
  data = await res.json();
} catch {
  throw new Error("Upload timed out — try a smaller file.");
}
if (!res.ok) throw new Error(data.error ?? `Upload failed (${res.status})`);
```

**Client-side pre-flight validation (before fetch):**
```typescript
import { slugify } from "@/lib/datasets/utils"; // import on client for instant feedback

// 1. Label produces valid slug
if (!slugify(label.trim())) {
  setError("Label must contain at least one letter or number.");
  return;
}
// 2. Duplicate check (free — allDatasets is already in context)
if (allDatasets.some(d => d.label.toLowerCase() === label.trim().toLowerCase())) {
  setError("A dataset with this name already exists.");
  return;
}
// 3. File size check
if (file.size > 150 * 1024 * 1024) {
  setError("File exceeds the 150 MB limit.");
  return;
}
```

**Post-success ordering (order matters):**
```typescript
// Must await refreshDatasets BEFORE switchDataset, otherwise the new dataset
// is not yet in allDatasets and the context falls back to a degraded label.
await refreshDatasets();
switchDataset(result.id);
setOpen(false);
```

If `refreshDatasets` resolves but `result.id` is not in the refreshed list, show an inline warning: "Dataset created but could not load — reload the page."

**Dismiss-during-upload behavior:**
- Close button and backdrop click are disabled while `isLoading` is true
- If the user somehow triggers close, call `abortController.abort()` and reset state (server cleans up on abort)

### Sidebar Wiring (`src/components/sidebar.tsx`)

Inside `datasetDropdownOpen && (...)` popover, after the `allDatasets.map(...)` block:

```tsx
{/* Separator */}
<div className="border-t border-border my-1" />
{/* Upload action */}
<button
  onClick={() => {
    setDatasetDropdownOpen(false);
    setUploadModalOpen(true);
  }}
  className="flex items-center gap-2 w-full px-3 py-2 text-[13px] text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
>
  <Upload className="w-3.5 h-3.5 shrink-0" />
  <span>Upload dataset...</span>
</button>
```

Add modal at the end of the sidebar JSX (before the closing `</div>`):
```tsx
<DatasetUploadModal
  open={uploadModalOpen}
  onOpenChange={setUploadModalOpen}
/>
```

> **Collapsed sidebar**: The "Upload dataset..." button only exists in the expanded sidebar tree. In collapsed mode (`collapsed = true`) the dataset name and dropdown button are not rendered — this feature is inaccessible from the collapsed rail. This is acceptable for V1; document as a known limitation.

## Acceptance Criteria

- [x] "Upload dataset..." button appears at the bottom of the dropdown, separated by a divider
- [x] Clicking the button closes the dropdown and opens the upload modal
- [x] File input accepts `.csv` and `.duckdb` files only (single file, V1)
- [x] Label field auto-populates from the selected filename (strip extension, replace `-_` with spaces)
- [x] Auto-fill does NOT overwrite a label the user has already manually edited (`labelTouched` guard)
- [x] Client-side pre-flight: slug check, duplicate check, file size check — all before the fetch
- [x] Upload button disabled and shows "Uploading..." + spinner while request is in-flight
- [x] In-progress: close button disabled; "Processing... This may take up to 2 minutes." shown
- [x] On success: `refreshDatasets()` awaited, THEN `switchDataset(newId)`, THEN modal closes
- [x] On server error (duplicate name, wrong file type, too large): error shown inline, modal stays open
- [x] On 504 / non-JSON response: "Upload timed out — try a smaller file." shown inline
- [x] On network abort (user-triggered close mid-upload): `AbortController.abort()` called, state reset
- [x] Re-opening modal starts with clean state (file, label, error all reset)
- [x] No new Tailwind arbitrary values with CSS variables (use `style={{}}` instead, per convention)
- [x] Strictly monochrome — no color accents on the button or modal chrome

## Error States

| Condition | Server response | UI behavior |
|-----------|----------------|-------------|
| Empty label | 400 "A 'label' field is required" | Inline error below label input |
| Duplicate name | 400 "A dataset with this name already exists" | Inline error below label input |
| Unsupported file type | 400 "Only .csv and .duckdb files are supported" | Inline error below file input |
| File too large | 400 "File size exceeds limit" | Inline error below file input |
| Multiple DuckDB files | 400 | Inline error below file input |
| Server error / LLM failure | 500 | Generic "Upload failed: [message]" inline |
| No files selected | (client-side) | Disable upload button until file is selected |

## Additional Edge Cases

- **Label with only special chars** (`!!!`, `---`): `slugify()` produces empty string → client catches this before fetch with "Label must contain at least one letter or number."
- **Case-insensitive duplicate**: `allDatasets` is in context — synchronous check before fetch prevents the round-trip.
- **File size pre-check**: Check `file.size` client-side (≤150MB for DuckDB, ≤50MB per CSV) before upload begins.
- **504 / non-JSON gateway error**: Wrap `res.json()` in try/catch; show "Upload timed out — try a smaller file." Do not let the modal hang.
- **LLM enrichment silently falls back**: Server returns 200 with generic prompts on enrichment failure. Client treats it as success — acceptable for V1.
- **`switchDataset` before `refreshDatasets` resolves**: Would show a degraded label (id-derived) in the header. Fix: always await refresh first.
- **`refreshDatasets` fails after successful upload**: New dataset on disk but not in dropdown. Show "Dataset created but could not load — reload the page." inline rather than silently closing the modal.
- **Collapsed sidebar**: Feature is inaccessible when sidebar is collapsed — documented known limitation for V1.
- **Concurrent uploads from two tabs**: Duplicate-ID check in server is not atomic. Demo app limitation; not addressed in V1.

## Dependencies & Risks

- **Upload duration**: LLM schema enrichment can take 60–120 seconds. The existing route has `maxDuration = 120`. The modal must show a clear in-progress state so users don't dismiss or re-submit.
- **Railway ephemeral filesystem**: Uploaded datasets in `data/datasets/` are lost on redeploy unless a Railway Volume is mounted at `/app/data/datasets`. This is a deployment concern, not a UI concern — no code change needed here.
- **`apiFetch` exception**: FormData uploads must use raw `fetch` with manual header injection (per CLAUDE.md convention). This is the established pattern already used by `src/lib/deck-upload.ts`.
- **Label auto-fill**: Strip file extension and replace `-_` with spaces for a friendlier default. The server's `slugify()` function handles ID generation from the label.

## References

- Upload route: `src/app/api/datasets/upload/route.ts:600-684`
- Dataset context (refreshDatasets, switchDataset): `src/lib/dataset-context.tsx:95`
- Sidebar dropdown: `src/components/sidebar.tsx:279-298`
- Deck upload pattern (FormData raw fetch): `src/lib/deck-upload.ts`
- Upload modal UI pattern (dashed drop zone): `src/components/knowledge/knowledge-import.tsx:174-458`
- Railway persistence: `docs/solutions/best-practices/railway-ephemeral-filesystem-dynamic-datasets-Deployment-20260223.md`
