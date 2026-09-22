# Segment Detail Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enhance the segment detail page with refresh controls, user percentage, sample users framing, and similar segment suggestions.

**Architecture:** Extend `SegmentDisplay` type with 3 new fields, enrich mock data, then update `segment-detail-panel.tsx` to render the expanded 4-column stat grid and improved user sample section. All new data is mock/client-side — no API changes.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, shadcn/ui (Button, Badge, DropdownMenu, Select), Lucide icons

---

### Task 1: Extend SegmentDisplay type

**Files:**
- Modify: `src/lib/types.ts:56-66`

**Step 1: Add new fields to SegmentDisplay interface**

Add these three fields after `archived: boolean`:

```typescript
export interface SegmentDisplay extends Segment {
  description: string;
  type: "dynamic" | "static";
  destinations: string[];
  trend: number | null;
  refreshStatus: "active" | "stale" | "failed" | "snapshot";
  refreshLabel: string;
  creator: string;
  statusColor: "green" | "blue" | "yellow" | "red";
  archived: boolean;
  refreshFrequency: "6h" | "daily" | "weekly" | "manual";
  similarSegments: { id: string; name: string; overlapPercent: number }[];
  totalUsers: number;
}
```

**Step 2: Verify build**

Run: `pnpm build` (expect type errors in mock-segments.ts and toSegmentDisplay — that's correct, we fix those in Task 2)

**Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat(segments): extend SegmentDisplay with refreshFrequency, similarSegments, totalUsers"
```

---

### Task 2: Enrich mock data

**Files:**
- Modify: `src/components/segments/mock-segments.ts`

**Step 1: Add TOTAL_APP_USERS constant and enrich every mock segment**

At the top of the file, add:

```typescript
export const TOTAL_APP_USERS = 389_000;
```

Add the three new fields to every mock segment in `MOCK_SEGMENTS`. Use these values:

| Segment ID | refreshFrequency | similarSegments (name → overlap%) |
|---|---|---|
| mock-hv-mobile | "6h" | Top 10% Spenders → 72%, Electronics Enthusiasts → 58% |
| mock-summer-churn | "manual" | Win-Back Campaign → 65%, New Signups (Last 7d) → 34% |
| mock-abandoned-cart | "daily" | Summer Churn Risk → 41%, New Signups (Last 7d) → 29% |
| mock-flash-sale | "daily" | Electronics Enthusiasts → 81%, HV Mobile Users → 45% |
| mock-top-spenders | "6h" | HV Mobile Users → 72%, VIP Loyalty Tier → 88% |
| mock-new-signups | "daily" | Summer Churn Risk → 34%, Abandoned Cart 2024 → 29% |
| mock-win-back | "weekly" | Summer Churn Risk → 65%, APAC Region Users → 22% |
| mock-electronics-buyers | "daily" | Flash Sale Urgent → 81%, HV Mobile Users → 58% |
| mock-geo-apac | "weekly" | HV Mobile Users → 38%, Electronics Enthusiasts → 31% |
| mock-vip-loyalty | "6h" | Top 10% Spenders → 88%, HV Mobile Users → 55% |
| mock-archived-holiday | "manual" | Win-Back Campaign → 42%, APAC Region Users → 28% |
| mock-archived-beta | "manual" | New Signups (Last 7d) → 19%, VIP Loyalty Tier → 12% |

Set `totalUsers: TOTAL_APP_USERS` for all mock segments.

Each `similarSegments` entry should reference the actual mock segment id. Example for mock-hv-mobile:

```typescript
similarSegments: [
  { id: "mock-top-spenders", name: "Top 10% Spenders", overlapPercent: 72 },
  { id: "mock-electronics-buyers", name: "Electronics Enthusiasts", overlapPercent: 58 },
],
totalUsers: TOTAL_APP_USERS,
```

**Step 2: Update toSegmentDisplay**

Add defaults for the three new fields:

```typescript
export function toSegmentDisplay(segment: import("@/lib/types").Segment): SegmentDisplay {
  return {
    ...segment,
    description: `Segment created from chat analysis`,
    type: "dynamic",
    destinations: Object.entries(segment.pushStatus)
      .filter(([, status]) => status === "synced" || status === "pushing")
      .map(([id]) => id),
    trend: null,
    refreshStatus: "active",
    refreshLabel: "Live query",
    creator: "You",
    statusColor: "green",
    archived: false,
    refreshFrequency: "daily",
    similarSegments: [],
    totalUsers: TOTAL_APP_USERS,
  };
}
```

**Step 3: Verify build**

Run: `pnpm build`
Expected: No type errors.

**Step 4: Commit**

```bash
git add src/components/segments/mock-segments.ts
git commit -m "feat(segments): enrich mock data with refresh frequency, similar segments, total users"
```

---

### Task 3: Add shadcn Select component (if not present)

**Files:**
- Check: `src/components/ui/select.tsx`

**Step 1: Check if Select exists**

Run: `ls src/components/ui/select.tsx`

If it does NOT exist, install it:

Run: `npx shadcn@latest add select`

If it already exists, skip to Task 4.

**Step 2: Commit (only if added)**

```bash
git add src/components/ui/select.tsx
git commit -m "chore: add shadcn select component"
```

---

### Task 4: Redesign the stat grid — Users card with percentage

**Files:**
- Modify: `src/components/segments/segment-detail-panel.tsx`

**Step 1: Update the Users stat card (Column 1)**

Find the Users card (the first `<div className="rounded-lg border bg-card p-3">` inside the grid). Replace it with:

```tsx
<div className="rounded-lg border bg-card p-3">
  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
    <Users className="w-3.5 h-3.5" />
    Users
  </div>
  <div className="flex items-center gap-1.5">
    <span className="text-lg font-semibold">{userCount.toLocaleString()}</span>
    {segment.trend !== null && (
      <span
        className={`flex items-center gap-0.5 text-xs font-medium ${
          segment.trend > 0 ? "text-emerald-600" : segment.trend < 0 ? "text-red-500" : "text-muted-foreground"
        }`}
      >
        {segment.trend > 0 ? (
          <TrendingUp className="w-3 h-3" />
        ) : (
          <TrendingDown className="w-3 h-3" />
        )}
        {Math.abs(segment.trend)}%
      </span>
    )}
  </div>
  {segment.totalUsers > 0 && (
    <div className="mt-2">
      <div className="text-[10px] text-muted-foreground mb-1">
        {((userCount / segment.totalUsers) * 100).toFixed(1)}% of all users
      </div>
      <div className="h-1 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-emerald-500 rounded-full transition-all"
          style={{ width: `${Math.min((userCount / segment.totalUsers) * 100, 100)}%` }}
        />
      </div>
    </div>
  )}
</div>
```

**Step 2: Change grid to 4 columns**

Change `grid grid-cols-3` to `grid grid-cols-4`.

**Step 3: Verify dev server renders correctly**

Run: `pnpm dev` and navigate to `/segments/mock-hv-mobile`

**Step 4: Commit**

```bash
git add src/components/segments/segment-detail-panel.tsx
git commit -m "feat(segments): add user percentage bar to stats grid"
```

---

### Task 5: Redesign the Refresh card with controls

**Files:**
- Modify: `src/components/segments/segment-detail-panel.tsx`

**Step 1: Add imports**

Add to the existing imports from `@/components/ui/`:

```typescript
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
```

**Step 2: Add state for frequency**

Inside the component, after `const [refreshing, setRefreshing] = useState(false);`, add:

```typescript
const [refreshFrequency, setRefreshFrequency] = useState(segment.refreshFrequency);
```

Also add to the reset block (where `segment.id !== prevSegmentId`):

```typescript
setRefreshFrequency(segment.refreshFrequency);
```

**Step 3: Replace the Refresh card (Column 2)**

Replace the existing Refresh card with:

```tsx
<div className="rounded-lg border bg-card p-3">
  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
    <Clock className="w-3.5 h-3.5" />
    Refresh
  </div>
  <div className="flex items-center gap-1.5 mb-2">
    <span
      className={`w-2 h-2 rounded-full shrink-0 ${
        refreshing
          ? "bg-blue-500 animate-pulse"
          : segment.refreshStatus === "active"
            ? "bg-emerald-500"
            : segment.refreshStatus === "stale"
              ? "bg-amber-500"
              : segment.refreshStatus === "failed"
                ? "bg-red-500"
                : "bg-blue-500"
      }`}
    />
    <span className="text-sm truncate">{refreshing ? "Refreshing..." : refreshLabel}</span>
  </div>
  <Button
    variant="outline"
    size="sm"
    className="w-full h-7 text-xs mb-2"
    onClick={handleRefresh}
    disabled={refreshing || segment.id.startsWith("mock-")}
  >
    <RefreshCw className={`w-3 h-3 mr-1.5 ${refreshing ? "animate-spin" : ""}`} />
    Refresh Now
  </Button>
  <Select value={refreshFrequency} onValueChange={(v) => setRefreshFrequency(v as typeof refreshFrequency)}>
    <SelectTrigger className="h-7 text-xs">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="6h">Every 6 hours</SelectItem>
      <SelectItem value="daily">Daily</SelectItem>
      <SelectItem value="weekly">Weekly</SelectItem>
      <SelectItem value="manual">Manual only</SelectItem>
    </SelectContent>
  </Select>
</div>
```

**Step 4: Verify in dev server**

Navigate to `/segments/mock-hv-mobile`, confirm the Refresh card shows status, "Refresh Now" button, and frequency dropdown.

**Step 5: Commit**

```bash
git add src/components/segments/segment-detail-panel.tsx
git commit -m "feat(segments): add refresh button and frequency selector to refresh card"
```

---

### Task 6: Add Similar Segments card (Column 4)

**Files:**
- Modify: `src/components/segments/segment-detail-panel.tsx`

**Step 1: Add Link/navigation import**

The component already imports `useRouter` from `next/navigation`. We'll use `router.push`.

Add `GitCompareArrows` to the lucide imports (or use `Users` — actually, use `Waypoints` for overlap):

```typescript
import { Waypoints } from "lucide-react";
```

**Step 2: Add the Similar Segments card after the Destinations card**

After the Destinations card `</div>`, add:

```tsx
<div className="rounded-lg border bg-card p-3">
  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
    <Waypoints className="w-3.5 h-3.5" />
    Similar Segments
  </div>
  {segment.similarSegments.length > 0 ? (
    <div className="space-y-1.5">
      {segment.similarSegments.map((sim) => (
        <button
          key={sim.id}
          onClick={() => router.push(`/segments/${sim.id}`)}
          className="flex items-center justify-between w-full text-left group"
        >
          <span className="text-xs truncate group-hover:text-emerald-600 transition-colors">
            {sim.name}
          </span>
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0 ml-1.5">
            {sim.overlapPercent}%
          </Badge>
        </button>
      ))}
    </div>
  ) : (
    <span className="text-xs text-muted-foreground">No similar segments</span>
  )}
</div>
```

**Step 3: Verify in dev server**

Navigate to `/segments/mock-hv-mobile`, confirm the 4-column grid renders with Similar Segments showing "Top 10% Spenders — 72%" and "Electronics Enthusiasts — 58%". Click one to navigate.

**Step 4: Commit**

```bash
git add src/components/segments/segment-detail-panel.tsx
git commit -m "feat(segments): add similar segments card with overlap percentages"
```

---

### Task 7: Improve User Sample section framing

**Files:**
- Modify: `src/components/segments/segment-detail-panel.tsx`

**Step 1: Update the User Preview header**

Find the `<h3>` that says "User Preview". Replace the entire header block:

```tsx
<h3 className="text-sm font-medium mb-2">
  Sample Users{" "}
  {preview.length > 0 && (
    <span className="text-muted-foreground font-normal">
      ({preview.length} of {userCount.toLocaleString()})
    </span>
  )}
</h3>
```

**Step 2: For mock segments, show fake user data instead of "Preview not available"**

Replace the mock segment empty state block:

```tsx
{segment.id.startsWith("mock-") ? (
  <div className="rounded-lg border border-dashed p-6 text-center">
    <p className="text-sm text-muted-foreground">
      Preview not available for demo segments
    </p>
  </div>
)
```

With mock preview data. Add a constant at the top of the file (outside the component):

```typescript
const MOCK_PREVIEW_USERS = [
  { user_id: "usr_8f2a1b", event_type: "purchase", event_date: "2026-02-17", brand: "samsung", price: 249.99 },
  { user_id: "usr_3c7d4e", event_type: "purchase", event_date: "2026-02-16", brand: "apple", price: 1099.00 },
  { user_id: "usr_9e1f6a", event_type: "purchase", event_date: "2026-02-16", brand: "xiaomi", price: 189.50 },
  { user_id: "usr_2b5c8d", event_type: "purchase", event_date: "2026-02-15", brand: "apple", price: 799.00 },
  { user_id: "usr_7a4e3f", event_type: "purchase", event_date: "2026-02-15", brand: "huawei", price: 349.99 },
  { user_id: "usr_1d6b9c", event_type: "cart", event_date: "2026-02-14", brand: "samsung", price: 599.00 },
  { user_id: "usr_5f8a2e", event_type: "purchase", event_date: "2026-02-14", brand: "apple", price: 449.99 },
  { user_id: "usr_4c3d7b", event_type: "view", event_date: "2026-02-13", brand: "xiaomi", price: 129.99 },
];
```

Then update the mock segment condition to show this data:

```tsx
{segment.id.startsWith("mock-") ? (
  (() => {
    const mockCols = Object.keys(MOCK_PREVIEW_USERS[0]);
    return (
      <div className="border rounded-md overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b bg-muted/50">
              {mockCols.map((col) => (
                <th key={col} className="text-left px-3 py-2 font-medium">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MOCK_PREVIEW_USERS.map((row, i) => (
              <tr key={i} className="border-b last:border-0">
                {mockCols.map((col) => (
                  <td key={col} className="px-3 py-1.5 truncate max-w-[200px]">
                    {String(row[col as keyof typeof row] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  })()
)
```

Also update the mock header to show count:

For mock segments, the header should say `(8 of 12,448)` — use `MOCK_PREVIEW_USERS.length` and `userCount`:

```tsx
<h3 className="text-sm font-medium mb-2">
  Sample Users{" "}
  <span className="text-muted-foreground font-normal">
    ({segment.id.startsWith("mock-") ? MOCK_PREVIEW_USERS.length : preview.length} of {userCount.toLocaleString()})
  </span>
</h3>
```

**Step 3: Verify both mock and real segment user previews**

Navigate to `/segments/mock-hv-mobile` — should show 8 mock rows with "Sample Users (8 of 12,448)".

**Step 4: Commit**

```bash
git add src/components/segments/segment-detail-panel.tsx
git commit -m "feat(segments): improve user sample framing with count context and mock data"
```

---

### Task 8: Final polish and responsive check

**Files:**
- Modify: `src/components/segments/segment-detail-panel.tsx` (if needed)

**Step 1: Check narrow viewport behavior**

The 4-column grid may be tight below ~768px. If needed, change:

```tsx
<div className="grid grid-cols-4 gap-3 mb-6">
```

to:

```tsx
<div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
```

This stacks to 2 columns on smaller viewports.

**Step 2: Verify build passes**

Run: `pnpm build`
Expected: Clean build, no errors.

**Step 3: Final commit**

```bash
git add src/components/segments/segment-detail-panel.tsx
git commit -m "feat(segments): responsive 4-column grid for segment stats"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Extend SegmentDisplay type | `types.ts` |
| 2 | Enrich mock data | `mock-segments.ts` |
| 3 | Add shadcn Select (if needed) | `ui/select.tsx` |
| 4 | Users card with % bar | `segment-detail-panel.tsx` |
| 5 | Refresh card with controls | `segment-detail-panel.tsx` |
| 6 | Similar Segments card | `segment-detail-panel.tsx` |
| 7 | User sample framing | `segment-detail-panel.tsx` |
| 8 | Responsive polish | `segment-detail-panel.tsx` |
