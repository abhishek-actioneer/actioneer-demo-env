---
title: "feat: Add Data Catalog button on Metrics page"
type: feat
date: 2026-02-24
---

# feat: Add Data Catalog Button on Metrics Page

Add a secondary "Data Catalog" button beside the existing "+ New Metric" button in the Metrics page header, providing a contextual shortcut from the Metrics list to the Data Catalog page.

## Acceptance Criteria

- [x] A "Data Catalog" button appears to the left of "+ New Metric" in the metrics page header
- [x] Clicking it navigates to `/data-catalog` via `router.push`
- [x] Button uses the secondary (outline) style: `border border-border rounded-lg hover:bg-muted transition-colors`
- [x] Button includes a `<Database>` icon (w-3.5 h-3.5) — matching the sidebar rail icon for that page
- [x] Both buttons are wrapped in `flex items-center gap-2 shrink-0` to prevent layout overflow
- [x] Sidebar active state is fixed: `/data-catalog` maps to `"connectors"` in `getActivePage` (paired fix — currently falls through to `"chat"`)

## Context

The metrics page and data catalog page are closely related — metrics are defined against the data schema, and users frequently need to cross-reference column names and table structures when adding or validating metrics. The Data Catalog page already exists at `/data-catalog` and is accessible via the sidebar `Database` icon, but there's no in-context link from the Metrics page.

The `getActivePage` function in `sidebar.tsx` does not handle `/data-catalog`, causing the Chat icon to appear active after navigating there. This is a pre-existing bug that becomes more visible once the new button is in place, so it is fixed as part of this change.

## Implementation

**Two files, minimal changes:**

### `src/app/metrics/page.tsx` (lines 48–57)

Add `Database` to the lucide-react import. Replace the single `<button>` on the right side of the header with a two-button group:

```tsx
// src/app/metrics/page.tsx — header section
<div className="flex items-center justify-between mb-6">
  <h1 className="text-xl font-semibold">Metrics</h1>
  <div className="flex items-center gap-2">
    <button
      onClick={() => router.push("/data-catalog")}
      className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium border border-border rounded-lg hover:bg-muted transition-colors"
    >
      <Database className="w-3.5 h-3.5" />
      Data Catalog
    </button>
    <button
      onClick={() => setShowCreate(true)}
      className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium bg-foreground text-background rounded-lg hover:bg-foreground/90 active:scale-[0.98] transition-all"
    >
      <Plus className="w-4 h-4" />
      New Metric
    </button>
  </div>
</div>
```

### `src/components/sidebar.tsx` (getActivePage function, ~line 55)

Add one line to map `/data-catalog` to the `"connectors"` active page (Database icon is already under the Connectors section in the sidebar rail):

```tsx
if (pathname.startsWith("/data-catalog")) return "connectors";
```

> **Note:** The sidebar does not have a dedicated `"data-catalog"` HoverPanel entry — the Database icon in the rail links to `/connectors`. If a dedicated data-catalog sidebar panel is added in future, this mapping should be updated.

## References

- Metrics page header: `src/app/metrics/page.tsx:48–57`
- Secondary button style source: `src/app/data-catalog/page.tsx:149–155` ("Manage Connectors")
- Sidebar `getActivePage`: `src/components/sidebar.tsx:47–59`
- Data Catalog page title: `src/app/data-catalog/page.tsx:144`
- `Database` icon already imported in sidebar: `src/components/sidebar.tsx:12`
