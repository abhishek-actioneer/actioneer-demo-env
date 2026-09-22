# Segment Detail Page Redesign

**Date:** 2026-02-18
**Status:** Design
**Approach:** Expanded Stat Bar (4-column grid + enhanced sections)

## Context

The segment detail page (`/segments/[id]`) currently shows: 3-column stat grid (Users, Refresh, Destinations), SQL query, push integrations, and a raw user preview table. Five enhancements requested:

1. Refresh card: add "Refresh Now" button + frequency selector
2. Refresh frequency: dropdown (Every 6h, Daily, Weekly, Manual)
3. Sample users: cap at 5-10 rows with better framing
4. Percentage of total app users in this segment
5. Show 2-3 closest overlapping segments

## Design

### Summary Stats Grid (3 → 4 columns)

**Column 1 — Users**
- Large count with trend arrow (unchanged)
- New: `X.X% of all users` text below count
- Thin progress bar showing percentage visually

**Column 2 — Refresh**
- Status dot + time label (e.g. "4 hours ago")
- "Refresh Now" button (outline, small, with RefreshCw icon)
- Dropdown for frequency: Every 6 hours | Daily | Weekly | Manual only
- Current frequency shown as muted label

**Column 3 — Destinations** (unchanged)

**Column 4 — Similar Segments** (new)
- 2-3 rows, each: clickable segment name + overlap % badge
- e.g. "Top 10% Spenders — 68%"
- Links navigate to that segment's detail page

### SQL Query Section (unchanged)

### Push to Integrations Section (unchanged)

### User Sample Section (enhanced framing)
- Header: "Sample Users (N of total)" instead of "User Preview (N rows)"
- Raw SQL output columns (whatever the segment query returns)
- Capped at 10 rows
- Mock segments show generated fake user rows instead of "Preview not available"

## Data Changes

### Type changes (`SegmentDisplay`)
- Add `refreshFrequency: "6h" | "daily" | "weekly" | "manual"` (default: "daily")
- Add `similarSegments: { id: string; name: string; overlapPercent: number }[]`
- Add `totalUsers: number` (hardcoded total, e.g. 389,000 for mocks)

### Mock data (`mock-segments.ts`)
- Each mock segment gets `refreshFrequency`, `similarSegments` (2-3 entries referencing other mock segments), and mock user preview rows
- `TOTAL_APP_USERS` constant for percentage calculation

### No API changes needed — all new data is mock/client-side computed

## Aesthetic Direction

Maintain existing clean, utilitarian style. The 4th stat card uses the same `rounded-lg border bg-card p-3` pattern. Overlap badges use muted colors. No new fonts or dramatic visual changes — this is a data-dense tool for growth teams.
