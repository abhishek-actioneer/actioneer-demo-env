# RBAC Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a two-tab RBAC admin settings page (Policies, Users) with AI-powered policy creation via the chat panel.

**Architecture:** Mock RBAC — policies and users stored client-side in localStorage. Policy creation goes through the chat (classify → conversational LLM → confirm card → save to store). The settings page is the browse/manage surface. No real SQL enforcement.

**Tech Stack:** Next.js App Router, React, Tailwind CSS, shadcn/ui, Gemini LLM for policy generation, localStorage persistence.

---

### Task 1: Types and Stores

**Files:**
- Create: `src/lib/policy-types.ts`
- Create: `src/lib/policy-store.ts`
- Create: `src/lib/mock-user-store.ts`

- [ ] **Step 1: Create policy types**

```typescript
// src/lib/policy-types.ts

export interface TableAccessRule {
  tableName: string;
  allowSelectStar: boolean;
  allowAllColumns: boolean;
  allowedColumns: string[];
  rowFilter: string | null;
  rowFilterDescription: string | null;
}

export interface DataPolicy {
  id: string;
  name: string;
  description: string;
  datasetId: string;
  tableAccess: TableAccessRule[];
  createdAt: string;
  createdBy: string;
}

export type WorkspaceRole = "super-admin" | "admin" | "member";

export const WORKSPACE_ROLES: { id: WorkspaceRole; label: string }[] = [
  { id: "super-admin", label: "Super Admin" },
  { id: "admin", label: "Admin" },
  { id: "member", label: "Member" },
];

export interface MockUser {
  id: string;
  name: string;
  email: string;
  initials: string;
  lastActive: string;
  role: WorkspaceRole;
}
```

- [ ] **Step 2: Create policy store**

```typescript
// src/lib/policy-store.ts

import type { DataPolicy } from "./policy-types";

const policyMap = new Map<string, DataPolicy>();
let initialized = false;

const STORAGE_KEY = "baby-sentinel-policies";
const STORAGE_VERSION = 1;

function createId() {
  return Math.random().toString(36).slice(2, 10);
}

function ensureInitialized() {
  if (initialized) return;
  initialized = true;

  if (typeof window !== "undefined") {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const items: DataPolicy[] = JSON.parse(stored);
        items.forEach((p) => policyMap.set(p.id, p));
        localStorage.setItem(STORAGE_KEY + "-version", String(STORAGE_VERSION));
        return;
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
    localStorage.setItem(STORAGE_KEY + "-version", String(STORAGE_VERSION));
  }

  // Seed defaults
  const now = new Date().toISOString();
  const seeds: DataPolicy[] = [
    {
      id: createId(),
      name: "analytics-readonly",
      description: "Limited read access to the events table — only dates and event names, filtered to 2026",
      datasetId: "quickhelp",
      tableAccess: [{
        tableName: "events",
        allowSelectStar: false,
        allowAllColumns: false,
        allowedColumns: ["event_date", "event_name"],
        rowFilter: "event_date >= '2026-01-01'",
        rowFilterDescription: "Only events from 2026 onwards",
      }],
      createdAt: now,
      createdBy: "system",
    },
    {
      id: createId(),
      name: "full-analytics",
      description: "Full read access to the events table with no restrictions",
      datasetId: "quickhelp",
      tableAccess: [{
        tableName: "events",
        allowSelectStar: true,
        allowAllColumns: true,
        allowedColumns: [],
        rowFilter: null,
        rowFilterDescription: null,
      }],
      createdAt: now,
      createdBy: "system",
    },
    {
      id: createId(),
      name: "revenue-access",
      description: "Access to order revenue data, restricted to APAC region",
      datasetId: "quickhelp",
      tableAccess: [{
        tableName: "orders",
        allowSelectStar: false,
        allowAllColumns: false,
        allowedColumns: ["order_id", "order_date", "revenue", "region"],
        rowFilter: "region = 'APAC'",
        rowFilterDescription: "Only APAC region data",
      }],
      createdAt: now,
      createdBy: "system",
    },
    {
      id: createId(),
      name: "pii-restricted",
      description: "Access to user profiles with PII columns removed",
      datasetId: "quickhelp",
      tableAccess: [{
        tableName: "users",
        allowSelectStar: false,
        allowAllColumns: false,
        allowedColumns: ["user_id", "signup_date", "plan_type", "country", "last_active"],
        rowFilter: null,
        rowFilterDescription: null,
      }],
      createdAt: now,
      createdBy: "system",
    },
  ];

  seeds.forEach((p) => policyMap.set(p.id, p));
  persistToStorage();
}

function persistToStorage() {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(policyMap.values())));
  } catch {
    // silent
  }
}

export function getAllPolicies(): DataPolicy[] {
  ensureInitialized();
  return Array.from(policyMap.values());
}

export function getPolicy(id: string): DataPolicy | undefined {
  ensureInitialized();
  return policyMap.get(id);
}

export function savePolicy(policy: DataPolicy): DataPolicy {
  ensureInitialized();
  if (!policy.id) policy.id = createId();
  policyMap.set(policy.id, policy);
  persistToStorage();
  return policy;
}

export function deletePolicy(id: string): boolean {
  ensureInitialized();
  const deleted = policyMap.delete(id);
  if (deleted) persistToStorage();
  return deleted;
}
```

- [ ] **Step 3: Create mock user store**

```typescript
// src/lib/mock-user-store.ts

import type { MockUser, WorkspaceRole } from "./policy-types";

const userMap = new Map<string, MockUser>();
let initialized = false;

const STORAGE_KEY = "baby-sentinel-mock-users";
const STORAGE_VERSION = 1;

function ensureInitialized() {
  if (initialized) return;
  initialized = true;

  if (typeof window !== "undefined") {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const items: MockUser[] = JSON.parse(stored);
        items.forEach((u) => userMap.set(u.id, u));
        localStorage.setItem(STORAGE_KEY + "-version", String(STORAGE_VERSION));
        return;
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
    localStorage.setItem(STORAGE_KEY + "-version", String(STORAGE_VERSION));
  }

  const seeds: MockUser[] = [
    { id: "u1", name: "Aarav Sharma", email: "aarav@acme.co", initials: "AS", lastActive: "2 hours ago", role: "super-admin" },
    { id: "u2", name: "Priya Mehta", email: "priya@acme.co", initials: "PM", lastActive: "1 day ago", role: "member" },
    { id: "u3", name: "Rohan Kumar", email: "rohan@acme.co", initials: "RK", lastActive: "3 days ago", role: "member" },
    { id: "u4", name: "Ananya Gupta", email: "ananya@acme.co", initials: "AG", lastActive: "5 hours ago", role: "admin" },
    { id: "u5", name: "Kiran Patel", email: "kiran@acme.co", initials: "KP", lastActive: "1 day ago", role: "member" },
    { id: "u6", name: "Diya Singh", email: "diya@acme.co", initials: "DS", lastActive: "4 days ago", role: "member" },
    { id: "u7", name: "Vikram Rao", email: "vikram@acme.co", initials: "VR", lastActive: "1 week ago", role: "member" },
    { id: "u8", name: "Neha Joshi", email: "neha@acme.co", initials: "NJ", lastActive: "3 hours ago", role: "admin" },
    { id: "u9", name: "Arjun Verma", email: "arjun@acme.co", initials: "AV", lastActive: "2 days ago", role: "member" },
  ];

  seeds.forEach((u) => userMap.set(u.id, u));
  persistToStorage();
}

function persistToStorage() {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(userMap.values())));
  } catch {
    // silent
  }
}

export function getAllMockUsers(): MockUser[] {
  ensureInitialized();
  return Array.from(userMap.values());
}

export function getMockUser(id: string): MockUser | undefined {
  ensureInitialized();
  return userMap.get(id);
}

export function updateUserRole(id: string, role: WorkspaceRole): MockUser | null {
  ensureInitialized();
  const user = userMap.get(id);
  if (!user) return null;
  const updated = { ...user, role };
  userMap.set(id, updated);
  persistToStorage();
  return updated;
}
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/policy-types.ts src/lib/policy-store.ts src/lib/mock-user-store.ts
git commit -m "feat(rbac): add policy types, policy store, and mock user store"
```

---

### Task 2: Feature Flag and Navigation

**Files:**
- Modify: `src/lib/feature-flags.ts:8-24` — add `"admin"` to FeatureId union
- Modify: `src/components/settings/settings-panel.tsx` — add Access Control item

- [ ] **Step 1: Add feature flag**

In `src/lib/feature-flags.ts`, add `"admin"` to the `FeatureId` union type:

```typescript
export type FeatureId =
  | "scouts"
  | "store"
  | "connectors"
  | "playbooks"
  | "forecasting"
  | "knowledge"
  | "metrics"
  | "explorer"
  | "boards"
  | "catalog"
  | "metric-tree"
  | "segments"
  | "credits"
  | "funnels"
  | "retentions"
  | "ad-creative"
  | "admin";
```

- [ ] **Step 2: Add Access Control to settings panel**

In `src/components/settings/settings-panel.tsx`, add a new button between Billing and Notifications. Import `Shield` from lucide and `isFeatureEnabled` from feature-flags:

```typescript
import { Wallet, Bell, KeyRound, Shield } from "lucide-react";
import { isFeatureEnabled } from "@/lib/feature-flags";
```

Add this button after the Billing button and before the Notifications placeholder:

```tsx
{/* Access Control — navigates to /settings/access */}
{isFeatureEnabled("admin") && (
  <button
    onClick={() => router.push("/settings/access")}
    className={ITEM}
  >
    <Shield className={ICON} />
    <div className="min-w-0 flex-1">
      <p className={PRIMARY}>Access Control</p>
      <p className={SECONDARY}>Policies & roles</p>
    </div>
  </button>
)}
```

- [ ] **Step 3: Verify navigation works**

Run: `pnpm dev`

Open `localhost:3000`, click Settings in the sidebar, verify "Access Control" appears between Billing and Notifications. Click it — should navigate to `/settings/access` (404 for now is expected).

- [ ] **Step 4: Commit**

```bash
git add src/lib/feature-flags.ts src/components/settings/settings-panel.tsx
git commit -m "feat(rbac): add admin feature flag and settings nav item"
```

---

### Task 3: Settings Page Shell with Tabs

**Files:**
- Create: `src/app/settings/access/page.tsx`

- [ ] **Step 1: Create the page with tab structure**

```tsx
// src/app/settings/access/page.tsx
"use client";

import { useState } from "react";
import { FeatureGate } from "@/components/feature-gate";
import { PoliciesTab } from "@/components/admin/policies-tab";
import { UsersTab } from "@/components/admin/users-tab";

type Tab = "policies" | "users";

const TABS: { id: Tab; label: string }[] = [
  { id: "policies", label: "Policies" },
  { id: "users", label: "Users" },
];

export default function AccessControlPage() {
  const [activeTab, setActiveTab] = useState<Tab>("policies");

  return (
    <FeatureGate feature="admin">
      <div className="flex flex-col h-full min-w-0">
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
            {/* Header */}
            <div>
              <h1 className="text-xl font-semibold">Access Control</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Manage data policies and user access
              </p>
            </div>

            {/* Tabs */}
            <div className="flex gap-4 border-b border-border">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`pb-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                    activeTab === tab.id
                      ? "border-foreground text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            {activeTab === "policies" && <PoliciesTab />}
            {activeTab === "users" && <UsersTab />}
          </div>
        </div>
      </div>
    </FeatureGate>
  );
}
```

- [ ] **Step 2: Create placeholder tab components**

Create `src/components/admin/policies-tab.tsx`:

```tsx
"use client";

export function PoliciesTab() {
  return (
    <div className="text-sm text-muted-foreground py-8 text-center">
      Policies tab — coming next
    </div>
  );
}
```

Create `src/components/admin/users-tab.tsx`:

```tsx
"use client";

export function UsersTab() {
  return (
    <div className="text-sm text-muted-foreground py-8 text-center">
      Users tab — coming next
    </div>
  );
}
```

- [ ] **Step 3: Verify the page renders**

Run: `pnpm dev`

Navigate to `/settings/access`. Verify: header, two tabs, clicking between them switches content.

- [ ] **Step 4: Commit**

```bash
git add src/app/settings/access/page.tsx src/components/admin/policies-tab.tsx src/components/admin/users-tab.tsx
git commit -m "feat(rbac): settings page shell with policies and users tabs"
```

---

### Task 4: Users Tab

**Files:**
- Modify: `src/components/admin/users-tab.tsx`

- [ ] **Step 1: Implement the users table**

Replace the placeholder in `src/components/admin/users-tab.tsx`:

```tsx
"use client";

import { useState, useCallback } from "react";
import { getAllMockUsers, updateUserRole } from "@/lib/mock-user-store";
import { WORKSPACE_ROLES, type WorkspaceRole } from "@/lib/policy-types";

export function UsersTab() {
  const [version, setVersion] = useState(0);
  const users = getAllMockUsers();

  const handleRoleChange = useCallback((userId: string, role: WorkspaceRole) => {
    updateUserRole(userId, role);
    setVersion((v) => v + 1);
  }, []);

  void version; // trigger re-render on change

  return (
    <div className="space-y-4">
      {/* Table header */}
      <div className="grid grid-cols-[1fr_160px_120px] gap-4 px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
        <span>User</span>
        <span>Role</span>
        <span>Last Active</span>
      </div>

      {/* User rows */}
      <div className="divide-y divide-border border border-border rounded-xl overflow-hidden">
        {users.map((user) => (
          <div key={user.id} className="grid grid-cols-[1fr_160px_120px] gap-4 px-3 py-3 items-center">
            {/* Avatar + name + email */}
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                <span className="text-xs font-medium text-muted-foreground">{user.initials}</span>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{user.name}</p>
                <p className="text-xs text-muted-foreground truncate">{user.email}</p>
              </div>
            </div>

            {/* Role dropdown */}
            <select
              value={user.role}
              onChange={(e) => handleRoleChange(user.id, e.target.value as WorkspaceRole)}
              className="text-sm bg-background border border-border rounded-md px-2 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20"
            >
              {WORKSPACE_ROLES.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>

            {/* Last active */}
            <span className="text-xs text-muted-foreground">{user.lastActive}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify users tab**

Run: `pnpm dev`

Navigate to `/settings/access` → Users tab. Verify: 9 users displayed, role dropdowns work, changes persist on page refresh (localStorage).

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/users-tab.tsx
git commit -m "feat(rbac): users tab with role assignment dropdowns"
```

---

### Task 5: Policies Tab — List View

**Files:**
- Modify: `src/components/admin/policies-tab.tsx`

- [ ] **Step 1: Implement the policies list**

Replace the placeholder in `src/components/admin/policies-tab.tsx`:

```tsx
"use client";

import { useState, useCallback } from "react";
import { getAllPolicies, deletePolicy } from "@/lib/policy-store";
import type { DataPolicy } from "@/lib/policy-types";
import { MoreHorizontal, Trash2, Plus, Shield } from "lucide-react";
import { PolicyDetailPanel } from "@/components/admin/policy-detail-panel";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function PoliciesTab() {
  const [version, setVersion] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const policies = getAllPolicies();
  const selectedPolicy = selectedId ? policies.find((p) => p.id === selectedId) : null;

  void version;

  const handleDelete = useCallback((id: string) => {
    deletePolicy(id);
    if (selectedId === id) setSelectedId(null);
    setVersion((v) => v + 1);
  }, [selectedId]);

  const handleCreateClick = useCallback(() => {
    // Will be wired to chat in Task 7
  }, []);

  return (
    <div className="flex gap-6">
      {/* List */}
      <div className={`flex-1 min-w-0 space-y-4 ${selectedPolicy ? "max-w-[55%]" : ""}`}>
        {/* Header with create button */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {policies.length} {policies.length === 1 ? "policy" : "policies"}
          </span>
          <button
            onClick={handleCreateClick}
            className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Create Policy
          </button>
        </div>

        {/* Empty state */}
        {policies.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Shield className="w-10 h-10 text-muted-foreground/40 mb-3" />
            <p className="text-sm font-medium text-foreground">No policies yet</p>
            <p className="text-xs text-muted-foreground mt-1">Create a policy via the chat to get started</p>
          </div>
        )}

        {/* Policy rows */}
        {policies.length > 0 && (
          <div className="divide-y divide-border border border-border rounded-xl overflow-hidden">
            {policies.map((policy) => (
              <PolicyRow
                key={policy.id}
                policy={policy}
                isSelected={selectedId === policy.id}
                onSelect={() => setSelectedId(selectedId === policy.id ? null : policy.id)}
                onDelete={() => handleDelete(policy.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Detail panel */}
      {selectedPolicy && (
        <PolicyDetailPanel
          policy={selectedPolicy}
          onClose={() => setSelectedId(null)}
          onDelete={() => handleDelete(selectedPolicy.id)}
          onPolicyChanged={() => setVersion((v) => v + 1)}
        />
      )}
    </div>
  );
}

function PolicyRow({
  policy,
  isSelected,
  onSelect,
  onDelete,
}: {
  policy: DataPolicy;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const firstTable = policy.tableAccess[0];
  const colLabel = firstTable?.allowAllColumns
    ? "All"
    : `${firstTable?.allowedColumns.length ?? 0} cols`;
  const hasFilter = !!firstTable?.rowFilter;

  return (
    <div
      onClick={onSelect}
      className={`group relative flex items-center gap-4 px-3 py-3 cursor-pointer transition-colors ${
        isSelected ? "bg-muted/50" : "hover:bg-muted/30"
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-foreground truncate">{policy.name}</p>
          {firstTable && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono shrink-0">
              {firstTable.tableName}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate mt-0.5">{policy.description}</p>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <span className="text-xs text-muted-foreground">{colLabel}</span>
        {hasFilter && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
            Filtered
          </span>
        )}

        {/* Kebab menu */}
        <div className="opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
          <AlertDialog>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="p-1 rounded hover:bg-muted">
                  <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <AlertDialogTrigger asChild>
                  <DropdownMenuItem className="text-destructive focus:text-destructive">
                    <Trash2 className="w-3.5 h-3.5 mr-2" />
                    Delete
                  </DropdownMenuItem>
                </AlertDialogTrigger>
              </DropdownMenuContent>
            </DropdownMenu>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete policy</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete &ldquo;{policy.name}&rdquo;? This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create a placeholder detail panel**

Create `src/components/admin/policy-detail-panel.tsx`:

```tsx
"use client";

import type { DataPolicy } from "@/lib/policy-types";
import { X } from "lucide-react";

interface PolicyDetailPanelProps {
  policy: DataPolicy;
  onClose: () => void;
  onDelete: () => void;
  onPolicyChanged: () => void;
}

export function PolicyDetailPanel({ policy, onClose }: PolicyDetailPanelProps) {
  return (
    <div className="w-[340px] shrink-0 border border-border rounded-xl p-5 space-y-5 h-fit sticky top-0">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground truncate">{policy.name}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{policy.description}</p>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-muted shrink-0">
          <X className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>
      <p className="text-xs text-muted-foreground">Detail panel — coming next</p>
    </div>
  );
}
```

- [ ] **Step 3: Verify policies list**

Run: `pnpm dev`

Navigate to `/settings/access` → Policies tab. Verify: 4 seeded policies shown with table badges, column counts, filter indicators. Click a row → placeholder detail panel opens on the right. Delete via kebab menu works with confirmation dialog.

- [ ] **Step 4: Commit**

```bash
git add src/components/admin/policies-tab.tsx src/components/admin/policy-detail-panel.tsx
git commit -m "feat(rbac): policies tab list view with delete and selection"
```

---

### Task 6: Policy Detail Panel with Test Section

**Files:**
- Modify: `src/components/admin/policy-detail-panel.tsx`

- [ ] **Step 1: Implement the full detail panel**

Replace the placeholder in `src/components/admin/policy-detail-panel.tsx`:

```tsx
"use client";

import { useState, useCallback } from "react";
import type { DataPolicy } from "@/lib/policy-types";
import { deletePolicy } from "@/lib/policy-store";
import { X, Trash2, CheckCircle2, XCircle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface PolicyDetailPanelProps {
  policy: DataPolicy;
  onClose: () => void;
  onDelete: () => void;
  onPolicyChanged: () => void;
}

interface TestResult {
  allowed: boolean;
  reason: string;
}

function testSqlAgainstPolicy(sql: string, policy: DataPolicy): TestResult {
  const trimmed = sql.trim();
  if (!trimmed) return { allowed: false, reason: "No SQL provided" };

  const upper = trimmed.toUpperCase();

  for (const rule of policy.tableAccess) {
    const tableUpper = rule.tableName.toUpperCase();
    // Check if this table is referenced
    if (!upper.includes(tableUpper)) continue;

    // Check SELECT *
    if (!rule.allowSelectStar && /SELECT\s+\*/i.test(trimmed)) {
      return { allowed: false, reason: `SELECT * is not allowed on ${rule.tableName}` };
    }

    // Check column access
    if (!rule.allowAllColumns && rule.allowedColumns.length > 0) {
      // Extract column-like identifiers from SELECT clause (before FROM)
      const selectMatch = trimmed.match(/SELECT\s+(.*?)\s+FROM/is);
      if (selectMatch) {
        const selectClause = selectMatch[1];
        for (const col of selectClause.split(",")) {
          const colName = col.trim().replace(/^.*\.\s*/, "").replace(/\s+AS\s+.*$/i, "").replace(/["'`]/g, "").trim();
          if (!colName || colName === "*") continue;
          // Skip aggregate functions wrapping allowed columns
          const innerMatch = colName.match(/^\w+\((.+)\)$/);
          const checkCol = innerMatch ? innerMatch[1].trim() : colName;
          if (!rule.allowedColumns.some((ac) => ac.toUpperCase() === checkCol.toUpperCase())) {
            return { allowed: false, reason: `Column "${checkCol}" is not in allowedColumns for ${rule.tableName}` };
          }
        }
      }
    }

    // Check row filter
    if (rule.rowFilter) {
      const filterUpper = rule.rowFilter.toUpperCase().replace(/\s+/g, " ").trim();
      const sqlNormalized = upper.replace(/\s+/g, " ");
      if (!sqlNormalized.includes(filterUpper)) {
        return { allowed: false, reason: `Missing required row filter: ${rule.rowFilter}` };
      }
    }

    return { allowed: true, reason: "All columns are permitted" + (rule.rowFilter ? ", row filter is present" : "") };
  }

  // Table not in policy — no opinion
  return { allowed: true, reason: "Table not covered by this policy" };
}

export function PolicyDetailPanel({ policy, onClose, onDelete }: PolicyDetailPanelProps) {
  const [testSql, setTestSql] = useState("");
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const handleTest = useCallback(() => {
    const result = testSqlAgainstPolicy(testSql, policy);
    setTestResult(result);
  }, [testSql, policy]);

  const handleDelete = useCallback(() => {
    deletePolicy(policy.id);
    onDelete();
  }, [policy.id, onDelete]);

  const firstRule = policy.tableAccess[0];

  return (
    <div className="w-[340px] shrink-0 border border-border rounded-xl p-5 space-y-5 h-fit sticky top-0">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground truncate">{policy.name}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{policy.description}</p>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-muted shrink-0">
          <X className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>

      {/* Datasource */}
      <Section label="Datasource">
        <p className="text-sm text-foreground">{policy.datasetId}</p>
      </Section>

      {/* Table */}
      {firstRule && (
        <>
          <Section label="Table">
            <span className="text-sm font-mono text-foreground">{firstRule.tableName}</span>
          </Section>

          {/* Allowed columns */}
          <Section label="Allowed Columns">
            {firstRule.allowAllColumns ? (
              <p className="text-sm text-foreground">All columns</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {firstRule.allowedColumns.map((col) => (
                  <span
                    key={col}
                    className="text-xs px-2 py-0.5 rounded-md bg-muted text-foreground font-mono"
                  >
                    {col}
                  </span>
                ))}
              </div>
            )}
          </Section>

          {/* Access flags */}
          <Section label="Access Flags">
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">SELECT *</span>
                <span className="text-foreground">{firstRule.allowSelectStar ? "Yes" : "No"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">All columns</span>
                <span className="text-foreground">{firstRule.allowAllColumns ? "Yes" : "No"}</span>
              </div>
            </div>
          </Section>

          {/* Row filter */}
          {firstRule.rowFilter && (
            <Section label="Row Filter">
              <p className="text-xs font-mono text-foreground bg-muted rounded-md px-2 py-1.5">
                {firstRule.rowFilter}
              </p>
              {firstRule.rowFilterDescription && (
                <p className="text-xs text-muted-foreground mt-1">{firstRule.rowFilterDescription}</p>
              )}
            </Section>
          )}
        </>
      )}

      {/* Test policy */}
      <div className="border-t border-border pt-4 space-y-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Test Policy</p>
        <textarea
          value={testSql}
          onChange={(e) => {
            setTestSql(e.target.value);
            setTestResult(null);
          }}
          placeholder="Paste a SQL query to test..."
          className="w-full h-20 text-xs font-mono bg-muted/50 border border-border rounded-md px-2.5 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-foreground/20 placeholder:text-muted-foreground/50"
        />
        <button
          onClick={handleTest}
          disabled={!testSql.trim()}
          className="w-full py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted transition-colors disabled:opacity-40 disabled:pointer-events-none"
        >
          Test Query
        </button>

        {testResult && (
          <div className={`flex items-start gap-2 p-2.5 rounded-md text-xs ${
            testResult.allowed ? "bg-muted/50" : "bg-muted/50"
          }`}>
            {testResult.allowed ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-foreground shrink-0 mt-0.5" />
            ) : (
              <XCircle className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
            )}
            <div>
              <p className="font-medium text-foreground">{testResult.allowed ? "Allowed" : "Blocked"}</p>
              <p className="text-muted-foreground mt-0.5">{testResult.reason}</p>
            </div>
          </div>
        )}
      </div>

      {/* Delete */}
      <div className="border-t border-border pt-4">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <Trash2 className="w-3.5 h-3.5" />
              Delete policy
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete policy</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete &ldquo;{policy.name}&rdquo;? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Verify detail panel and test section**

Run: `pnpm dev`

Navigate to `/settings/access` → Policies tab → click "analytics-readonly". Verify:
- Panel shows datasource, table, 2 column chips, access flags, row filter with description
- Paste `SELECT event_date, event_name FROM events WHERE event_date >= '2026-01-01'` → Test → shows "Allowed"
- Paste `SELECT user_id FROM events` → Test → shows "Blocked: Column user_id not in allowedColumns"
- Paste `SELECT event_date FROM events` (missing row filter) → Test → shows "Blocked: Missing required row filter"
- Delete button shows confirmation dialog

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/policy-detail-panel.tsx
git commit -m "feat(rbac): policy detail panel with test section"
```

---

### Task 7: Schema Columns API Route

**Files:**
- Create: `src/app/api/schema/columns/route.ts`

The policy generation LLM needs to know the columns available in a table. This route returns column names and types for a given table.

- [ ] **Step 1: Create the columns endpoint**

```typescript
// src/app/api/schema/columns/route.ts
import { auth } from "@clerk/nextjs/server";
import { executeSQLInternal } from "@/lib/sql-executor";
import { getDatasetForUser, DEFAULT_DATASET } from "@/lib/datasets";
import { z } from "zod/v4";

const QuerySchema = z.object({
  table: z.string().min(1),
});

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = QuerySchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: "table is required" }, { status: 400 });

  const datasetId = req.headers.get("x-dataset-id") || DEFAULT_DATASET;
  if (!getDatasetForUser(datasetId, userId)) return Response.json({ error: "Not found" }, { status: 404 });

  const { table } = parsed.data;
  const result = await executeSQLInternal(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'main' AND table_name = '${table}' ORDER BY ordinal_position`,
    datasetId,
  );

  if (result.error) {
    return Response.json({ columns: [], error: result.error });
  }

  const columns = result.rows.map((r) => ({
    name: r.column_name as string,
    type: r.data_type as string,
  }));

  return Response.json({ columns });
}
```

- [ ] **Step 2: Verify the endpoint**

Run: `pnpm dev`

```bash
curl -X POST http://localhost:3000/api/schema/columns \
  -H "Content-Type: application/json" \
  -d '{"table":"events"}'
```

Should return a JSON object with a `columns` array (will return 401 without auth — that's fine, just verify no build errors).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/schema/columns/route.ts
git commit -m "feat(rbac): schema columns API endpoint for policy generation"
```

---

### Task 8: Policy Generation API Route

**Files:**
- Create: `src/app/api/policies/generate/route.ts`
- Create: `src/lib/prompts/policy.ts`

- [ ] **Step 1: Create the policy generation prompt**

```typescript
// src/lib/prompts/policy.ts

export function buildPolicyGenerationPrompt(
  schemaInfo: string,
  tableName: string,
  columns: { name: string; type: string }[],
): string {
  const colList = columns.map((c) => `  - ${c.name} (${c.type})`).join("\n");

  return `You are a data access policy generator. Given a user's description of what access they want to grant, generate a structured policy JSON.

SCHEMA CONTEXT:
${schemaInfo}

TARGET TABLE: ${tableName}

AVAILABLE COLUMNS:
${colList}

OUTPUT FORMAT — respond with ONLY a JSON object, no markdown, no explanation:
{
  "name": "kebab-case-policy-name",
  "description": "One-line description of what this policy grants",
  "tableAccess": [{
    "tableName": "${tableName}",
    "allowSelectStar": false,
    "allowAllColumns": false,
    "allowedColumns": ["col1", "col2"],
    "rowFilter": "optional SQL WHERE expression or null",
    "rowFilterDescription": "plain English explanation of the row filter or null"
  }]
}

RULES:
1. Only include columns from the AVAILABLE COLUMNS list above.
2. If the user wants "all columns", set allowAllColumns=true and allowedColumns=[].
3. If the user mentions PII/sensitive data to exclude, set allowAllColumns=false and list only the safe columns.
4. rowFilter must be a valid SQL WHERE expression using only columns from the table.
5. If no row filter is needed, set rowFilter=null and rowFilterDescription=null.
6. allowSelectStar should be false unless the user explicitly says they want SELECT * access.
7. Generate a descriptive kebab-case name that reflects the access level.`;
}

export function buildPolicyClarificationPrompt(
  tableName: string,
  columns: { name: string; type: string }[],
): string {
  const colList = columns.map((c) => `${c.name} (${c.type})`).join(", ");

  return `You are helping an admin create a data access policy for the "${tableName}" table.

Available columns: ${colList}

The admin's request is vague or broad. Ask ONE focused clarifying question to narrow down the policy. Your question should help determine:
- Which specific columns should be accessible (or which to exclude)
- Whether a row-level filter is needed (e.g. by date, region, status)
- The level of access (read-only specific columns vs full access with restrictions)

Present 2-3 options as a bulleted list when possible. Keep it concise. Do not generate the policy yet.

Respond in plain text, not JSON.`;
}
```

- [ ] **Step 2: Create the policy generation API route**

```typescript
// src/app/api/policies/generate/route.ts
import { auth } from "@clerk/nextjs/server";
import { generateText, type ModelId } from "@/lib/llm";
import { executeSQLInternal } from "@/lib/sql-executor";
import { getSchemaContext } from "@/lib/schema";
import { getDatasetForUser, DEFAULT_DATASET } from "@/lib/datasets";
import { buildPolicyGenerationPrompt, buildPolicyClarificationPrompt } from "@/lib/prompts/policy";
import { z } from "zod/v4";

const GenerateSchema = z.object({
  prompt: z.string().min(1).max(4000),
  tableName: z.string().optional(),
  mode: z.enum(["generate", "clarify"]).default("generate"),
  conversationContext: z.string().optional(),
});

async function getTableColumns(tableName: string, datasetId: string) {
  const result = await executeSQLInternal(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'main' AND table_name = '${tableName}' ORDER BY ordinal_position`,
    datasetId,
  );
  if (result.error) return [];
  return result.rows.map((r) => ({
    name: r.column_name as string,
    type: r.data_type as string,
  }));
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = GenerateSchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });

  const { prompt, tableName, mode, conversationContext } = parsed.data;
  const datasetId = req.headers.get("x-dataset-id") || DEFAULT_DATASET;
  if (!getDatasetForUser(datasetId, userId)) return Response.json({ error: "Not found" }, { status: 404 });
  const modelId = (req.headers.get("x-model-id") ?? undefined) as ModelId | undefined;

  // If no table specified, try to infer from prompt or ask
  if (!tableName) {
    return Response.json({
      type: "clarify",
      message: "Which table should this policy apply to? I need to know the target table to generate column-level access rules.",
    });
  }

  const columns = await getTableColumns(tableName, datasetId);
  if (columns.length === 0) {
    return Response.json({ error: `Table "${tableName}" not found or has no columns` }, { status: 400 });
  }

  if (mode === "clarify") {
    const systemPrompt = buildPolicyClarificationPrompt(tableName, columns);
    const fullPrompt = conversationContext
      ? `Previous context:\n${conversationContext}\n\nLatest message: ${prompt}`
      : prompt;
    const text = await generateText(fullPrompt, { modelId, systemPrompt, timeoutMs: 15_000, label: "policy clarification" });
    return Response.json({ type: "clarify", message: text });
  }

  // Generate mode
  const schemaInfo = getSchemaContext(datasetId);
  const systemPrompt = buildPolicyGenerationPrompt(schemaInfo, tableName, columns);
  const fullPrompt = conversationContext
    ? `Previous context:\n${conversationContext}\n\nFinal request: ${prompt}`
    : prompt;

  const text = await generateText(fullPrompt, { modelId, systemPrompt, jsonMode: true, timeoutMs: 30_000, label: "policy generation" });
  const cleaned = text.trim().replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "");

  try {
    const policy = JSON.parse(cleaned);
    return Response.json({ type: "policy", policy });
  } catch {
    return Response.json({ error: "Failed to parse generated policy" }, { status: 500 });
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/prompts/policy.ts src/app/api/policies/generate/route.ts
git commit -m "feat(rbac): policy generation API with LLM prompt and clarification flow"
```

---

### Task 9: Chat Integration — Classifier and Action Handler

**Files:**
- Modify: `src/lib/types.ts:176-182` — add `policy-confirm` variant and `policyConfirm` field
- Modify: `src/lib/prompts/classify.ts` — add `policy_create` intent
- Modify: `src/hooks/use-classify.ts:16` — add `policy_create` to ClassifyResult mode
- Modify: `src/app/api/classify/route.ts:40` — add `policy_create` to mode handling
- Modify: `src/hooks/use-action-handlers.ts` — add policy creation handler

- [ ] **Step 1: Add policy-confirm variant to ChatMessage**

In `src/lib/types.ts`, add `"policy-confirm"` to the variant union on line 182:

```typescript
variant?: "gathering" | "streaming" | "report-cta" | "connector-required" | "playbook-preview" | "save-as-playbook" | "save-to-knowledge" | "metric-context" | "segment-confirm" | "funnel-confirm" | "retention-confirm" | "metric-update-confirm" | "metric-create-confirm" | "metric-table-select" | "metric-generating" | "policy-confirm";
```

Add below the `metricGenerating` field (around line 270):

```typescript
  /** Policy creation confirmation card data */
  policyConfirm?: {
    name: string;
    description: string;
    datasetId: string;
    tableAccess: import("@/lib/policy-types").TableAccessRule[];
    status: "ready" | "confirmed" | "cancelled";
    policyId?: string;
  };
```

- [ ] **Step 2: Add policy_create to classifier**

In `src/hooks/use-classify.ts`, update the `ClassifyResult` interface mode union (line 16):

```typescript
mode: "analytics" | "direct" | "action" | "metric_update" | "metric_create" | "policy_create";
```

In `src/app/api/classify/route.ts`, update line 40 to include `policy_create`:

```typescript
const mode = result.mode === "metric_create" ? "metric_create" : result.mode === "metric_update" ? "metric_update" : result.mode === "action" ? "action" : result.mode === "analytics" ? "analytics" : result.mode === "policy_create" ? "policy_create" : "direct";
```

In `src/lib/prompts/classify.ts`, add `policy_create` to the mode list in `CLASSIFY_SYSTEM` (after the `metric_create` entry):

```
   - "policy_create" — the user wants to CREATE a data access policy. Keywords: "create a policy", "create a data policy", "restrict access", "limit access to", "add a policy for", "set up access control", "policy for the events table". The user is asking to define access rules for a table or datasource.
```

Add these examples to `STATIC_EXAMPLES`:

```typescript
  `- "create a policy for the events table" → {"mode":"policy_create","metricId":null,"actionType":null,"extractedDescription":"policy for the events table","metricName":null}`,
  `- "restrict access to only revenue columns" → {"mode":"policy_create","metricId":null,"actionType":null,"extractedDescription":"restrict access to only revenue columns","metricName":null}`,
  `- "set up a read-only policy for marketing team" → {"mode":"policy_create","metricId":null,"actionType":null,"extractedDescription":"read-only policy for marketing team","metricName":null}`,
```

Add a bias rule:

```
- "create a policy for X" / "restrict access to X" / "set up access control for X" → mode "policy_create"
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts src/hooks/use-classify.ts src/app/api/classify/route.ts src/lib/prompts/classify.ts
git commit -m "feat(rbac): add policy_create classifier intent and policy-confirm chat variant"
```

---

### Task 10: Policy Confirm Card Component

**Files:**
- Create: `src/components/chat/policy-confirm-card.tsx`

- [ ] **Step 1: Create the confirm card**

```tsx
// src/components/chat/policy-confirm-card.tsx
"use client";

import { useState } from "react";
import { Check, X, Shield, ExternalLink } from "lucide-react";
import type { TableAccessRule } from "@/lib/policy-types";

interface PolicyConfirmData {
  name: string;
  description: string;
  datasetId: string;
  tableAccess: TableAccessRule[];
  status: "ready" | "confirmed" | "cancelled";
  policyId?: string;
}

interface PolicyConfirmCardProps {
  data: PolicyConfirmData;
  msgId: string;
  onConfirm: (msgId: string) => void;
  onCancel: (msgId: string) => void;
}

export function PolicyConfirmCard({ data, msgId, onConfirm, onCancel }: PolicyConfirmCardProps) {
  const firstRule = data.tableAccess[0];

  // Cancelled state
  if (data.status === "cancelled") {
    return (
      <div className="text-xs text-muted-foreground/50 italic py-1">
        Policy creation cancelled
      </div>
    );
  }

  // Confirmed state
  if (data.status === "confirmed") {
    return (
      <div className="rounded-lg border border-border bg-background p-3">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-full bg-foreground/10 flex items-center justify-center">
            <Check className="w-3 h-3 text-foreground" />
          </div>
          <span className="text-sm font-medium text-foreground">
            Policy created — {data.name}
          </span>
          <a
            href="/settings/access"
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5 ml-auto"
          >
            View <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    );
  }

  // Ready state — review and confirm
  return (
    <div className="rounded-lg border border-border bg-background p-4 space-y-3 max-w-md">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Shield className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">{data.name}</span>
      </div>
      <p className="text-xs text-muted-foreground">{data.description}</p>

      {/* Policy details */}
      {firstRule && (
        <div className="space-y-2 border-t border-border pt-3">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Table:</span>
            <span className="font-mono text-foreground">{firstRule.tableName}</span>
          </div>

          <div className="text-xs">
            <span className="text-muted-foreground">Columns: </span>
            {firstRule.allowAllColumns ? (
              <span className="text-foreground">All columns</span>
            ) : (
              <span className="text-foreground">{firstRule.allowedColumns.join(", ")}</span>
            )}
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">SELECT *:</span>
            <span className="text-foreground">{firstRule.allowSelectStar ? "Yes" : "No"}</span>
          </div>

          {firstRule.rowFilter && (
            <div className="text-xs">
              <span className="text-muted-foreground">Row filter: </span>
              <span className="font-mono text-foreground">{firstRule.rowFilter}</span>
              {firstRule.rowFilterDescription && (
                <p className="text-muted-foreground mt-0.5">{firstRule.rowFilterDescription}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => onConfirm(msgId)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-foreground text-background hover:bg-foreground/90 transition-colors"
        >
          <Check className="w-3 h-3" />
          Confirm
        </button>
        <button
          onClick={() => onCancel(msgId)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/chat/policy-confirm-card.tsx
git commit -m "feat(rbac): policy confirmation card for chat thread"
```

---

### Task 11: Wire Policy Flow into Chat

**Files:**
- Modify: `src/components/chat/chat-thread.tsx` — render policy-confirm card
- Modify: `src/hooks/use-action-handlers.ts` — handle policy_create classify result
- Modify: `src/hooks/use-analytics.ts` or `src/providers/chat-state-provider.tsx` — route policy_create to handler

This is the integration task. The flow:
1. User types "create a policy for events table"
2. Classifier returns `mode: "policy_create"`
3. Chat state routes to policy handler
4. Handler calls `/api/policies/generate` with clarify/generate modes
5. Conversational back-and-forth until policy is generated
6. Handler emits `policy-confirm` variant message
7. Chat thread renders `PolicyConfirmCard`
8. On confirm → saves to `policy-store`

- [ ] **Step 1: Add policy confirm card rendering to chat thread**

In `src/components/chat/chat-thread.tsx`, add the import:

```typescript
import { PolicyConfirmCard } from "@/components/chat/policy-confirm-card";
```

Find the section where other confirm cards are rendered (near `segment-confirm`, around line 672). Add a similar block for `policy-confirm`:

```tsx
if (msg.variant === "policy-confirm" && msg.policyConfirm) {
  return (
    <div key={msg.id} className="flex justify-start">
      <PolicyConfirmCard
        data={msg.policyConfirm}
        msgId={msg.id}
        onConfirm={handlePolicyConfirm}
        onCancel={handlePolicyCancel}
      />
    </div>
  );
}
```

- [ ] **Step 2: Add policy handlers to use-action-handlers.ts**

In `src/hooks/use-action-handlers.ts`, add imports:

```typescript
import { savePolicy } from "@/lib/policy-store";
import type { DataPolicy } from "@/lib/policy-types";
import { apiFetch } from "@/lib/api-client";
```

Add these handlers inside the `useActionHandlers` function, after the existing handler declarations:

```typescript
// ── Policy creation ──

const handlePolicyCreate = useCallback(
  async (description: string) => {
    const msgId = crypto.randomUUID();

    // Add a sentinel message asking about the table
    setMessages((prev) => [
      ...prev,
      {
        id: msgId,
        role: "sentinel",
        content: "I'll help you create a data access policy. Let me figure out what you need...",
        timestamp: Date.now(),
      },
    ]);

    try {
      // First call — may return clarification or policy
      const result = await apiFetch<{ type: string; message?: string; policy?: Record<string, unknown> }>("/api/policies/generate", {
        method: "POST",
        body: { prompt: description, mode: "generate" },
      });

      if (result.type === "clarify" && result.message) {
        // AI needs more info — show as a sentinel message
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId ? { ...m, content: result.message! } : m,
          ),
        );
        return;
      }

      if (result.type === "policy" && result.policy) {
        const policy = result.policy as { name: string; description: string; tableAccess: DataPolicy["tableAccess"] };
        // Show confirm card
        const confirmMsgId = crypto.randomUUID();
        setMessages((prev) => [
          ...prev.map((m) =>
            m.id === msgId
              ? { ...m, content: `Here's the policy I've generated based on your description:` }
              : m,
          ),
          {
            id: confirmMsgId,
            role: "sentinel" as const,
            content: "",
            timestamp: Date.now(),
            variant: "policy-confirm" as const,
            policyConfirm: {
              name: policy.name,
              description: policy.description,
              datasetId,
              tableAccess: policy.tableAccess,
              status: "ready" as const,
            },
          },
        ]);
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId
            ? { ...m, content: `Sorry, I couldn't generate a policy. ${err instanceof Error ? err.message : "Please try again."}` }
            : m,
        ),
      );
    }
  },
  [datasetId, setMessages],
);

const handlePolicyConfirm = useCallback(
  (msgId: string) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== msgId || !m.policyConfirm) return m;
        const policy: DataPolicy = {
          id: crypto.randomUUID(),
          name: m.policyConfirm.name,
          description: m.policyConfirm.description,
          datasetId: m.policyConfirm.datasetId,
          tableAccess: m.policyConfirm.tableAccess,
          createdAt: new Date().toISOString(),
          createdBy: "current-user",
        };
        savePolicy(policy);
        toast.success(`Policy "${policy.name}" created`, {
          description: "View it in Settings → Access Control",
        });
        return {
          ...m,
          policyConfirm: { ...m.policyConfirm, status: "confirmed" as const, policyId: policy.id },
        };
      }),
    );
  },
  [setMessages],
);

const handlePolicyCancel = useCallback(
  (msgId: string) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== msgId || !m.policyConfirm) return m;
        return {
          ...m,
          policyConfirm: { ...m.policyConfirm, status: "cancelled" as const },
        };
      }),
    );
  },
  [setMessages],
);
```

Return `handlePolicyCreate`, `handlePolicyConfirm`, and `handlePolicyCancel` from the hook.

- [ ] **Step 3: Route policy_create in the chat state**

In the component or provider that handles the classify result (look for the switch/if on `mode === "action"` or `mode === "metric_create"` — likely in `src/providers/chat-state-provider.tsx` or wherever `classifyQuery` result is consumed), add a case for `policy_create`:

```typescript
if (classifyResult.mode === "policy_create") {
  handlePolicyCreate(classifyResult.extractedDescription || text);
  return;
}
```

- [ ] **Step 4: Verify the full chat flow**

Run: `pnpm dev`

1. Open the chat panel
2. Type "create a policy for the events table"
3. Verify classifier routes to `policy_create`
4. Verify LLM generates a policy or asks clarification
5. Verify the confirm card renders with policy details
6. Click Confirm → verify policy saved to store
7. Navigate to `/settings/access` → verify new policy appears in the list

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/chat-thread.tsx src/hooks/use-action-handlers.ts
git commit -m "feat(rbac): wire policy creation chat flow end-to-end"
```

---

### Task 12: Create Policy Button → Chat

**Files:**
- Modify: `src/components/admin/policies-tab.tsx` — wire Create Policy button to open chat

- [ ] **Step 1: Wire the Create Policy button**

In `src/components/admin/policies-tab.tsx`, the `handleCreateClick` callback is currently empty. Import `useChatState` or `useRouter` to navigate and trigger the chat:

```typescript
import { useRouter } from "next/navigation";
```

Update `handleCreateClick`:

```typescript
const router = useRouter();

const handleCreateClick = useCallback(() => {
  // Navigate to home (where chat is) with a query param hint
  router.push("/?action=create-policy");
}, [router]);
```

Alternatively, if the chat panel is available on the settings page via `ChatPanelProvider`, directly inject a starter message. The exact wiring depends on whether the settings page has the chat sidebar. If not, the button navigates to `/` and the user uses the chat there.

For simplicity, the button can show a tooltip or small instruction:

```tsx
<button
  onClick={handleCreateClick}
  className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors"
  title="Opens the chat panel to create a policy"
>
  <Plus className="w-3.5 h-3.5" />
  Create Policy
</button>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/admin/policies-tab.tsx
git commit -m "feat(rbac): wire Create Policy button to chat"
```

---

### Task 13: Build Verification

**Files:** None (verification only)

- [ ] **Step 1: Run lint**

```bash
pnpm lint
```

Fix any lint errors in the new files.

- [ ] **Step 2: Run build**

```bash
pnpm build
```

Fix any type errors or build failures.

- [ ] **Step 3: Manual verification checklist**

1. Settings → Access Control link appears and navigates to `/settings/access`
2. Policies tab: 4 seed policies listed with correct table badges, column counts, filter indicators
3. Click policy → detail panel opens with all fields rendered correctly
4. Policy test: paste allowed SQL → green result; paste blocked SQL → red result
5. Delete policy → confirmation dialog → policy removed from list
6. Users tab: 9 mock users with correct role distribution
7. Change a user's role → persists on page refresh
8. Chat: "create a policy for events" → classifier routes correctly → LLM responds → confirm card renders → confirm saves to store
9. New policy appears in Policies tab after creation via chat

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(rbac): complete admin access control with policies, users, and chat-based policy creation"
```
