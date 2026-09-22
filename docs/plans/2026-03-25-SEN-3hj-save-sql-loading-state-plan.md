# SEN-3hj — Save SQL Loading State

**Bead:** SEN-3hj · P2 Bug
**Branch target:** feat-metrics-merge
**File:** `src/components/metric/metric-detail-panel.tsx` — `SqlSectionWithHeader` component
**Date:** 2026-03-25

---

## Problem

When a user edits SQL and clicks **Save SQL**, the button triggers a Gemini LLM call via `/api/metric-update` that takes **10+ seconds**. During that entire time:

- The button shows no spinner and is not disabled
- The cancel button still works (user can abort mid-flight)
- No copy communicates that work is happening
- If the API fails, there is no error shown — the user just gets nothing

The UI appears completely frozen. From the user's perspective this looks like a bug even when everything is fine.

---

## What Good Looks Like

The moment the user clicks **Save SQL** (or presses `Cmd+Enter`):

1. **Button becomes disabled immediately** — no second clicks, no duplicate requests
2. **Check icon morphs → spinner** — animated `Loader2` replaces `Check`, 150ms ease-out
3. **Cancel button is also disabled** — can't interrupt a save in flight
4. **"Analyzing changes…" status label** fades in after a **1.5s delay** — avoids showing for future fast saves, appears when LLM is clearly running
5. **On success** — spinner morphs back to `Check` briefly (200ms) then edit mode closes. No layout shift.
6. **On error** — edit mode stays open, spinner stops, inline error appears below the textarea ("Failed to save — please try again"). User keeps their SQL draft.

---

## Implementation Plan

### Step 1 — Make `onSave` async and thread saving state up

`SqlSectionWithHeader` currently calls `onSave?.(draft.trim())` synchronously. The parent's `onSave` prop needs to become `async` and `SqlSectionWithHeader` needs to await it.

**`SqlSectionWithHeader` signature change:**
```tsx
// Before
{ sql, editEnabled, onSave }: { sql: string; editEnabled?: boolean; onSave?: (newSql: string) => void }

// After
{ sql, editEnabled, onSave }: { sql: string; editEnabled?: boolean; onSave?: (newSql: string) => Promise<void> }
```

**New internal state in `SqlSectionWithHeader`:**
```tsx
const [saving, setSaving] = useState(false);
const [saveError, setSaveError] = useState<string | null>(null);
```

**Updated `handleSave`:**
```tsx
const handleSave = async () => {
  setSaving(true);
  setSaveError(null);
  try {
    await onSave?.(draft.trim());
    setEditing(false);        // exit edit mode only on success
  } catch {
    setSaveError("Failed to save — please try again.");
  } finally {
    setSaving(false);
  }
};
```

The parent's `onSave` callback must return a `Promise` (i.e., await the API call before resolving).

---

### Step 2 — Save button: icon morph + disabled state

Replace the bare `Check` icon button with a state-driven version. **No layout shift** — the button stays the same `p-1` size throughout.

```tsx
<button
  type="button"
  onClick={handleSave}
  disabled={saving}
  className="p-1 rounded text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
  title={saving ? "Saving…" : "Save SQL"}
  aria-label={saving ? "Saving SQL" : "Save SQL"}
>
  {saving ? (
    <Loader2 className="w-4 h-4 animate-spin" />
  ) : (
    <Check className="w-4 h-4" />
  )}
</button>
```

**Animation rules:**
- Icon swap is opacity cross-fade: `transition: opacity 150ms ease-out`
- Spinner uses Tailwind's `animate-spin` (already available)
- Respects `prefers-reduced-motion` — `animate-spin` uses `@media (prefers-reduced-motion: reduce) { animation: none }` via Tailwind's config

**Active state (add to globals.css or inline):**
```css
button:active:not(:disabled) {
  transform: scale(0.97);
}
```

---

### Step 3 — Disable Cancel during save

Cancel while a save is in flight would leave an orphaned in-flight LLM request. Disable it:

```tsx
<button
  type="button"
  onClick={handleCancel}
  disabled={saving}
  className="p-1 rounded text-muted-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
  title="Cancel"
>
  <X className="w-4 h-4" />
</button>
```

---

### Step 4 — Delayed status label ("Analyzing changes…")

Show a status line **only after 1.5 seconds** — this avoids a flash for fast saves while giving clear feedback when the LLM is clearly running.

**Implementation using `useEffect` + `useState`:**
```tsx
const [showAnalyzing, setShowAnalyzing] = useState(false);

useEffect(() => {
  if (!saving) {
    setShowAnalyzing(false);
    return;
  }
  const t = setTimeout(() => setShowAnalyzing(true), 1500);
  return () => clearTimeout(t);
}, [saving]);
```

**Render below the textarea, above Related Metrics:**
```tsx
{showAnalyzing && (
  <p
    className="text-[11px] text-muted-foreground mt-1.5 animate-in fade-in duration-300"
    aria-live="polite"
  >
    Analyzing changes…
  </p>
)}
```

`aria-live="polite"` announces the status to screen readers without interrupting.

---

### Step 5 — Inline error state

If `onSave` throws, show the error below the textarea — colocated with the field, not in a toast:

```tsx
{saveError && (
  <p className="text-[11px] text-muted-foreground mt-1.5" role="alert">
    {saveError}
  </p>
)}
```

The user's SQL draft is preserved in `draft` state so they don't lose their work.

---

### Step 6 — Cmd+Enter keyboard shortcut

The textarea currently has no keyboard submission. Add `onKeyDown` to submit on `Cmd+Enter` / `Ctrl+Enter`:

```tsx
<textarea
  value={draft}
  onChange={(e) => setDraft(e.target.value)}
  onKeyDown={(e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      if (!saving) handleSave();
    }
  }}
  disabled={saving}
  className="w-full bg-zinc-100 dark:bg-zinc-900 rounded-lg p-4 text-xs font-mono leading-relaxed resize-none focus:outline-none focus:ring-1 focus:ring-border disabled:opacity-60"
  rows={Math.max(6, draft.split("\n").length + 1)}
  autoFocus
  spellCheck={false}
/>
```

Also disable the textarea while saving (prevents edits mid-flight).

---

## UI Engineering Checklist

| Rule | Applied |
|------|---------|
| Disable button immediately on submit (forms-controls.md) | ✅ `disabled={saving}` |
| No layout shift on state change (core principle) | ✅ icon swap same `p-1` footprint |
| Only animate `transform` and `opacity` (animations.md) | ✅ fade-in on label, scale on :active |
| User-initiated actions < 300ms animation (animations.md) | ✅ icon cross-fade 150ms |
| `prefers-reduced-motion` respected | ✅ via Tailwind `animate-spin` |
| `aria-live` for async status (touch-accessibility.md) | ✅ `aria-live="polite"` |
| Colocated error messages (forms-controls.md) | ✅ below textarea |
| `Cmd+Enter` keyboard submission (forms-controls.md) | ✅ onKeyDown handler |
| `aria-label` on icon buttons | ✅ dynamic label changes with saving state |
| Active state `scale(0.97)` (animations.md) | ✅ via `:active:not(:disabled)` |

---

## Files to Change

| File | Change |
|------|--------|
| `src/components/metric/metric-detail-panel.tsx` | All changes above live in `SqlSectionWithHeader` |

No new files, no new dependencies. `Loader2` is already available from `lucide-react`.

---

## Out of Scope

- Adding optimistic UI for the metric values (would require predicting LLM output)
- Cancellable in-flight LLM requests (no abort signal support in current API route)
- Progress percentage (API doesn't stream progress)
