# RBAC Admin Feature — Build Log (2026-04-09)

## Goal

Build a mock RBAC admin UI in baby-sentinel as a UX reference for Sentinel's engineering team. Policy-based data access control where admins create policies (via AI chat), assign workspace roles to users, and test policies against SQL queries.

## What Was Built

### Settings Page (`/settings/access`)

Two-tab page behind `<FeatureGate feature="admin">`:

**Policies Tab**
- List view: policy name, target table badge, column count, row filter indicator
- Click row → side detail panel with full policy breakdown
- Detail panel sections: datasource, table, allowed columns (chips), access flags, row filter (SQL + plain English), test section, collapsible JSON view, delete button
- "Create Policy" button opens the sidebar chat panel
- Delete via kebab menu with AlertDialog confirmation
- Empty state with Shield icon

**Users Tab**
- 9 mock team members with avatar (initials), name, email, last active
- Role dropdown: Super Admin / Admin / Member
- Changes persist to localStorage

### Policy Creation via Chat

Full conversational flow:

1. User types intent (e.g., "create a policy for restricting members to access revenue tables")
2. Classifier detects `policy_create` intent → routes to `handlePolicyCreate`
3. System fetches available tables from dataset, then calls LLM (`/api/policies/recommend-tables`) to rank tables by relevance to the user's description
4. **Table select card** appears in chat — recommended tables pre-checked at top, all others collapsed below. Multi-select with checkboxes.
5. User selects tables → clicks "Continue"
6. LLM asks **clarifying questions** about column/row restrictions (presented as numbered selectable buttons, not plain text)
7. User clicks an option (or types a response) → `policyContextRef` tracks conversation state, bypasses classifier, routes directly to policy generation API
8. LLM generates policy JSON with `tableAccess` entries for each table
9. **Policy confirm card** shows all tables with their column/filter rules → Confirm/Cancel
10. On confirm → saves to `policy-store`, toast notification, card collapses to "Policy created" with link to settings

### Policy Detail Panel

- Full breakdown of each `tableAccess` rule
- **SQL Test Section**: paste a query, click "Test Query" → green "Allowed" or red "Blocked" with reason. Client-side string matching (demo-grade, not AST parsing).
- **Policy JSON**: collapsible section with formatted JSON + copy button
- Delete with AlertDialog confirmation

### Data Model

```typescript
interface TableAccessRule {
  tableName: string;
  allowSelectStar: boolean;    // Can user write SELECT *?
  allowAllColumns: boolean;    // Can user query any column by name?
  allowedColumns: string[];    // Whitelist when allowAllColumns=false
  rowFilter: string | null;    // SQL WHERE expression (e.g., "hub_name = 'Sarjapur'")
  rowFilterDescription: string | null; // Plain English explanation
}

interface DataPolicy {
  id: string;
  name: string;
  description: string;
  datasetId: string;
  tableAccess: TableAccessRule[];
  createdAt: string;
  createdBy: string;
}

type WorkspaceRole = "super-admin" | "admin" | "member";
// Super Admin & Admin bypass policies. Member = policies enforced.
```

### Workspace Roles

Three fixed roles (no custom role creation):
- **Super Admin** — full access, bypasses all policies
- **Admin** — full access, can manage policies and assign roles
- **Member** — restricted, policies evaluated on every query

### Seed Data

**4 seed policies** (localStorage, version 2):
- `analytics-readonly` — events table, 2 columns, 2026 row filter
- `full-analytics` — events table, all columns, no filter
- `revenue-access` — orders table, revenue columns, APAC filter
- `pii-restricted` — users table, PII columns excluded

**9 mock users** (localStorage):
- 1 Super Admin (Aarav Sharma)
- 2 Admins (Ananya Gupta, Neha Joshi)
- 6 Members (Priya, Rohan, Kiran, Diya, Vikram, Arjun)

## Files Created

| File | Purpose |
|------|---------|
| `src/lib/policy-types.ts` | Types: TableAccessRule, DataPolicy, WorkspaceRole, MockUser |
| `src/lib/policy-store.ts` | localStorage-persisted CRUD for policies, 4 seeds |
| `src/lib/mock-user-store.ts` | localStorage-persisted mock users, 9 seeds |
| `src/lib/prompts/policy.ts` | LLM prompts for policy generation and clarification |
| `src/app/settings/access/page.tsx` | Settings page with two tabs |
| `src/components/admin/policies-tab.tsx` | Policies list with selection and detail panel |
| `src/components/admin/policy-detail-panel.tsx` | Detail panel with test section and JSON view |
| `src/components/admin/users-tab.tsx` | Users table with role dropdowns |
| `src/components/chat/policy-confirm-card.tsx` | Chat confirm card for policy creation |
| `src/components/chat/policy-table-select-card.tsx` | Multi-select table picker card |
| `src/components/chat/selectable-options.tsx` | Clickable numbered options in chat messages |
| `src/app/api/policies/generate/route.ts` | LLM policy generation (generate + clarify modes) |
| `src/app/api/policies/recommend-tables/route.ts` | LLM table recommendation by description |
| `src/app/api/schema/columns/route.ts` | Column introspection for a table |

## Files Modified

| File | Change |
|------|--------|
| `src/lib/feature-flags.ts` | Added `"admin"` to FeatureId union |
| `src/lib/types.ts` | Added `policy-confirm`, `policy-table-select` variants + `policyConfirm`, `policyTableSelect` fields to ChatMessage |
| `src/lib/prompts/classify.ts` | Added `policy_create` mode, bias rules, 3 examples |
| `src/hooks/use-classify.ts` | Added `policy_create` to ClassifyResult mode union |
| `src/hooks/use-analytics.ts` | Added policy_create routing + policyContextRef follow-up interception |
| `src/hooks/use-action-handlers.ts` | Added handlePolicyConfirm, handlePolicyCancel |
| `src/components/chat/chat-state-provider.tsx` | Added handlePolicyCreate (fetches tables + LLM recommend), policyContextRef, wired to useAnalytics |
| `src/components/chat/chat-thread.tsx` | Added PolicyConfirmCard + PolicyTableSelectCard + SelectableOptions rendering, handlePolicyTableSelect |
| `src/components/chat/chat-panel-provider.tsx` | Added triggerPolicyCreate |
| `src/components/settings/settings-panel.tsx` | Added Access Control nav item with Shield icon |
| `src/app/api/classify/route.ts` | Added policy_create to mode handling chain |

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/policies/generate` | POST | Generate or clarify a policy. Accepts `tableNames[]`, `mode` (generate/clarify), `conversationContext`. Multi-table support. |
| `/api/policies/recommend-tables` | POST | LLM picks relevant tables from the dataset schema based on user's description. No cap on count. |
| `/api/schema/columns` | POST | Returns column names and types for a given table via `information_schema.columns`. |

## Architecture Decisions

1. **Chat-first policy creation** — no forms or dialogs. All policy creation goes through the sidebar chat with AI assistance.
2. **No custom roles** — three fixed workspace roles (Super Admin, Admin, Member). Policies attach to the Member role implicitly.
3. **Multi-turn conversation** — `policyContextRef` in chat-state-provider tracks in-progress policy creation. When active, user messages bypass the classifier and route directly to the policy generation API with full conversation history.
4. **LLM-based table recommendation** — instead of keyword matching, the LLM analyzes the schema context and user description to pick relevant tables.
5. **Selectable options** — LLM clarifying questions with numbered options render as clickable buttons via `SelectableOptions` component. Clicking sends the option text as a chat message.
6. **No real enforcement** — all mock. No changes to `sql-executor.ts` or `sql-generator.ts`. The SQL test in the detail panel uses client-side string matching.
7. **`allowAllColumns` vs `allowSelectStar`** — separate concepts. `allowAllColumns=true` means any column can be queried by name. `allowSelectStar=true` means `SELECT *` is permitted. You can allow all columns but block `SELECT *` to force explicit column listing (audit trail).
8. **`1=0` row filter** — LLM sometimes generates `WHERE 1=0` to mean "block all access to this table." This is a hack; ideally the table should be omitted from the policy entirely.

## Known Issues / Gaps

- Settings sidebar item navigates to `/billing`, not a settings popover. Access Control only reachable via direct URL `/settings/access`.
- Policy test section is demo-grade string matching — doesn't handle CTEs, subqueries, aliases properly.
- Seed policy table names (events, orders, users) are generic and may not exist in all datasets.
- No audit log of policy violations.
- No prompt injection of policies into SQL generation (soft guard not implemented).
- LLM sometimes uses `1=0` row filter instead of omitting blocked tables.
- The `handlePolicyCreate` function lives in `chat-state-provider.tsx` (not `use-action-handlers.ts`) to avoid circular dependency with `useAnalytics`.

## Design Spec & Plan

- Spec: `docs/superpowers/specs/2026-04-09-rbac-admin-design.md`
- Plan: `docs/superpowers/plans/2026-04-09-rbac-admin-plan.md`
