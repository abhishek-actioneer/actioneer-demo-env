# RBAC Admin — Design Spec

## Overview

A mock RBAC admin UI in baby-sentinel for engineering UX reference. Two-tab settings page (Policies, Users) with AI-powered policy creation via the chat panel. Policies gate member-role users' access to specific tables, columns, and rows. No real enforcement — demo-grade only.

## Data Model

### Policy

```typescript
interface TableAccessRule {
  tableName: string;                  // e.g. "events", "orders"
  allowSelectStar: boolean;
  allowAllColumns: boolean;
  allowedColumns: string[];           // whitelist when allowAllColumns=false
  rowFilter: string | null;           // SQL WHERE expression
  rowFilterDescription: string | null; // plain English explanation
}

interface DataPolicy {
  id: string;
  name: string;                       // e.g. "analytics-readonly"
  description: string;                // AI-generated summary
  datasetId: string;                  // which datasource this applies to
  tableAccess: TableAccessRule[];
  createdAt: string;
  createdBy: string;                  // mock user id
}
```

### Workspace Roles

Three fixed roles — no CRUD, no custom roles:

- **Super Admin** — full access, bypasses all policies
- **Admin** — full access, can manage policies and assign roles
- **Member** — restricted, policies are evaluated on every query

### Mock Users

```typescript
interface MockUser {
  id: string;
  name: string;
  email: string;
  avatar: string;                     // initials
  lastActive: string;
  role: "super-admin" | "admin" | "member";
}
```

9 seed users: 1 super admin, 2 admins, 6 members.

## Navigation

- Entry: Settings popover in sidebar → "Access Control" item (Shield icon), below Billing, above Notifications
- Route: `/settings/access`
- Feature-gated: `<FeatureGate feature="admin">`

## Page Layout

Standard page shell. Two tabs: Policies, Users. Tabs are monochrome underline-style. Tab state in React (URL does not change).

```
┌─────────────────────────────────────────┐
│ Access Control                          │
│ Manage data policies and user access    │
│                                         │
│ [Policies]  [Users]           ← tabs    │
│─────────────────────────────────────────│
│  Tab content                            │
└─────────────────────────────────────────┘
```

## Policies Tab

### List View

Table rows. Each row shows:
- Policy name (bold) + description (muted, truncated)
- Target table as monochrome badge
- Column count (e.g. "2 cols" or "All")
- Row filter indicator (present/absent)
- Kebab menu on `group-hover`: Delete (AlertDialog confirmation)

"Create Policy" button at top-right → opens chat panel with a starter prompt.

No inline edit. Delete and recreate via chat (AI-native philosophy).

### Detail Side Panel

Click a policy row → right-side detail panel. Shows:

- Policy name + description
- Datasource
- Table name
- Allowed columns as monochrome badge chips
- Access flags: SELECT * (yes/no), All columns (yes/no)
- Row filter: SQL expression + plain English description
- Test Policy section (see below)
- Delete button at bottom (AlertDialog)

### Policy Test Section

Inside the detail side panel. Lets the admin paste SQL and see allowed/blocked.

- Textarea input for SQL
- "Test Query" button
- Result: green "Allowed" with reason, or red "Blocked" with reason
- Client-side string matching (demo-grade, not AST parsing)

Test logic checks:
1. Does the SQL reference columns outside `allowedColumns`?
2. Does the SQL use `SELECT *` when `allowSelectStar` is false?
3. Is the required `rowFilter` present in the WHERE clause?

## Users Tab

Table of 9 mock users. Each row:
- Avatar (initials in monochrome circle) + name (bold) + email (muted), stacked
- Role dropdown: Super Admin / Admin / Member. On change → updates mock-user-store immediately.
- Last active: relative time (static mock values)

No side panel. Everything is inline.

### Seed Data

| Name | Email | Role | Last Active |
|------|-------|------|-------------|
| Aarav Sharma | aarav@acme.co | Super Admin | 2 hours ago |
| Priya Mehta | priya@acme.co | Member | 1 day ago |
| Rohan Kumar | rohan@acme.co | Member | 3 days ago |
| Ananya Gupta | ananya@acme.co | Admin | 5 hours ago |
| Kiran Patel | kiran@acme.co | Member | 1 day ago |
| Diya Singh | diya@acme.co | Member | 4 days ago |
| Vikram Rao | vikram@acme.co | Member | 1 week ago |
| Neha Joshi | neha@acme.co | Admin | 3 hours ago |
| Arjun Verma | arjun@acme.co | Member | 2 days ago |

## Chat Integration

### Classification

New intent: `policy_create`. Triggered by prompts like "create a policy", "restrict access to events table", "limit what marketing can see".

### Conversational Flow

The AI walks the admin through policy creation with follow-up questions:

1. AI asks what kind of access (column-restricted, row-filtered, or both)
2. AI shows available columns from the dataset schema, asks which to include
3. AI asks about row-level filtering
4. If the initial prompt is vague, AI asks clarifying questions before proceeding
5. AI generates the policy and shows a confirm card

Max 2-3 rounds of clarification before generating.

### Confirm Card

New ChatMessage variant: `policy-confirm`. Read-only with selectable options where ambiguity exists.

```
┌─────────────────────────────────────────┐
│ Policy: events-2026-readonly            │
│                                         │
│ Limited read access to events table,    │
│ filtered to 2026 data only              │
│                                         │
│ Table: events                           │
│ Columns: event_date, event_name, country│
│ SELECT *: No                            │
│ Row filter: event_date >= '2026-01-01'  │
│   "Only events from 2026 onwards"       │
│                                         │
│          [Confirm]    [Cancel]           │
└─────────────────────────────────────────┘
```

- Confirm → saves to policy-store, toast notification
- Cancel → discards, AI acknowledges in chat

### API Route

`POST /api/policies/generate` — takes a prompt + datasetId, returns generated policy JSON. Uses Gemini with the dataset's schema context injected. Handles follow-up question logic (returns questions or a final policy).

## Stores

### policy-store.ts

Client-side, localStorage-persisted. `ensureInitialized()` pattern. Seeded with 4 policies:

- `analytics-readonly` — events table, 2 columns (event_date, event_name), row filter to 2026
- `full-analytics` — events table, all columns, no row filter
- `revenue-access` — orders table, revenue columns only, row filter to APAC region
- `pii-restricted` — users table, blocks PII columns (email, phone, ip)

Public API: `getAllPolicies()`, `getPolicy(id)`, `savePolicy(policy)`, `deletePolicy(id)`.

### mock-user-store.ts

Client-side, localStorage-persisted. Seeded with 9 users (see table above).

Public API: `getAllMockUsers()`, `getMockUser(id)`, `updateUserRole(id, role)`.

## Feature Flag

Add `"admin"` to the feature flags list in `feature-flags.ts`. Default enabled.

## What Is NOT Built

- No SQL AST parser or real policy evaluation in the query pipeline
- No changes to `sql-executor.ts` or `sql-generator.ts`
- No real Clerk org member listing
- No `jsonColumnPolicies` UI
- No audit log
- No per-query "blocked by policy" error in chat
- No prompt injection of policies into SQL generation
