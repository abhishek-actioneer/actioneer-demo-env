# Credit Consumption & Billing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add per-message credit badges, a sidebar credit ledger panel, and a full billing page with top-up functionality — all frontend-only with simulated random credit costs.

**Architecture:** New `credit-store.ts` follows the established `Map + localStorage + ensureInitialized()` store pattern. `ChatMessage` gains a `creditCost` field. Reactivity uses the existing version-counter pattern (`creditVersion` in `SidebarContext`). Sidebar gains a "Billing" rail icon + hover panel. `/billing` is a new page route.

**Tech Stack:** Next.js App Router, React 19, Tailwind CSS v4, shadcn/ui, Lucide icons, Sonner toasts

---

### Task 1: Credit Types

**Files:**
- Create: `src/lib/credit-types.ts`

**Step 1: Create the types file**

```ts
// src/lib/credit-types.ts

export interface CreditTransaction {
  id: string;
  type: "deduction" | "topup";
  amount: number;
  balanceAfter: number;
  timestamp: number;
  // Deduction metadata
  conversationId?: string;
  messageId?: string;
  queryMode?: "deep" | "quick" | "direct";
  questionPreview?: string;
  // Top-up metadata
  packName?: string;
}

export interface OrgCreditState {
  orgId: string;
  orgName: string;
  balance: number;
  transactions: CreditTransaction[];
}

export type CreditPackId = "starter" | "growth" | "pro";

export interface CreditPack {
  id: CreditPackId;
  name: string;
  credits: number;
  price: number;
  popular?: boolean;
}

export const CREDIT_PACKS: CreditPack[] = [
  { id: "starter", name: "Starter", credits: 100, price: 10 },
  { id: "growth", name: "Growth", credits: 500, price: 40, popular: true },
  { id: "pro", name: "Pro", credits: 1000, price: 70 },
];
```

**Step 2: Verify build**

Run: `pnpm build 2>&1 | tail -5`
Expected: Build succeeds (unused file, but no errors)

**Step 3: Commit**

```bash
git add src/lib/credit-types.ts
git commit -m "feat(credits): add credit types and pack definitions"
```

---

### Task 2: Credit Store

**Files:**
- Create: `src/lib/credit-store.ts`

**Step 1: Create the credit store**

Follow the `conversation-store.ts` pattern exactly: `Map + localStorage + STORAGE_VERSION + ensureInitialized() + debounced persistence`.

```ts
// src/lib/credit-store.ts

import type { CreditTransaction, OrgCreditState, CreditPackId } from "./credit-types";
import { CREDIT_PACKS } from "./credit-types";

const creditMap = new Map<string, OrgCreditState>();
let initialized = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

const STORAGE_KEY = "baby-sentinel-credits";
const STORAGE_VERSION = 1;
const DEFAULT_ORG_ID = "org-1";

function createId() {
  return Math.random().toString(36).slice(2, 10);
}

function ensureInitialized() {
  // Version check BEFORE initialized guard
  if (typeof window !== "undefined") {
    const storedVersion = localStorage.getItem(STORAGE_KEY + "-version");
    if (storedVersion !== String(STORAGE_VERSION)) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(STORAGE_KEY + "-version");
      creditMap.clear();
      initialized = false;
      localStorage.setItem(STORAGE_KEY + "-version", String(STORAGE_VERSION));
    }
  }

  if (initialized) return;
  initialized = true;

  // Try restoring from localStorage
  if (typeof window !== "undefined") {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const items: OrgCreditState[] = JSON.parse(stored);
        items.forEach((org) => creditMap.set(org.orgId, org));
        return;
      }
    } catch {
      // Fall through to seed
    }
  }

  // Seed default org with mock data
  const now = Date.now();
  const seedTransactions: CreditTransaction[] = [
    { id: createId(), type: "topup", amount: 500, balanceAfter: 500, timestamp: now - 7 * 86400000, packName: "Growth" },
    { id: createId(), type: "deduction", amount: 14, balanceAfter: 486, timestamp: now - 6 * 86400000, queryMode: "deep", questionPreview: "What are the top revenue drivers..." },
    { id: createId(), type: "deduction", amount: 3, balanceAfter: 483, timestamp: now - 5 * 86400000, queryMode: "quick", questionPreview: "How many active users today?" },
    { id: createId(), type: "deduction", amount: 18, balanceAfter: 465, timestamp: now - 3 * 86400000, queryMode: "deep", questionPreview: "Analyze cohort retention by acq..." },
    { id: createId(), type: "deduction", amount: 1, balanceAfter: 464, timestamp: now - 2 * 86400000, queryMode: "direct", questionPreview: "What tables are available?" },
    { id: createId(), type: "deduction", amount: 11, balanceAfter: 453, timestamp: now - 86400000, queryMode: "deep", questionPreview: "Revenue breakdown by geography..." },
  ];

  creditMap.set(DEFAULT_ORG_ID, {
    orgId: DEFAULT_ORG_ID,
    orgName: "Acme Corp",
    balance: 453,
    transactions: seedTransactions,
  });
}

function persistToStorage() {
  if (typeof window === "undefined") return;
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    try {
      const items = Array.from(creditMap.values());
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // silent
    }
  }, 300);
}

/* ── Public API ── */

export function getOrgCredits(orgId: string = DEFAULT_ORG_ID): OrgCreditState | undefined {
  ensureInitialized();
  return creditMap.get(orgId);
}

export function getBalance(orgId: string = DEFAULT_ORG_ID): number {
  ensureInitialized();
  return creditMap.get(orgId)?.balance ?? 0;
}

export function getTransactionHistory(orgId: string = DEFAULT_ORG_ID, limit?: number): CreditTransaction[] {
  ensureInitialized();
  const org = creditMap.get(orgId);
  if (!org) return [];
  const sorted = [...org.transactions].sort((a, b) => b.timestamp - a.timestamp);
  return limit ? sorted.slice(0, limit) : sorted;
}

/** Generate a random credit cost based on query mode */
export function generateCreditCost(mode: "deep" | "quick" | "direct"): number {
  switch (mode) {
    case "deep": return Math.floor(Math.random() * 13) + 8;   // 8-20
    case "quick": return Math.floor(Math.random() * 5) + 1;   // 1-5
    case "direct": return 1;
  }
}

export function deductCredits(
  amount: number,
  meta: {
    conversationId?: string;
    messageId?: string;
    queryMode?: "deep" | "quick" | "direct";
    questionPreview?: string;
  },
  orgId: string = DEFAULT_ORG_ID,
): CreditTransaction | null {
  ensureInitialized();
  const org = creditMap.get(orgId);
  if (!org) return null;

  const newBalance = Math.max(0, org.balance - amount);
  const txn: CreditTransaction = {
    id: createId(),
    type: "deduction",
    amount,
    balanceAfter: newBalance,
    timestamp: Date.now(),
    ...meta,
  };

  org.balance = newBalance;
  org.transactions.push(txn);
  creditMap.set(orgId, { ...org });
  persistToStorage();
  return txn;
}

export function topUpCredits(
  packId: CreditPackId,
  orgId: string = DEFAULT_ORG_ID,
): CreditTransaction | null {
  ensureInitialized();
  const org = creditMap.get(orgId);
  const pack = CREDIT_PACKS.find((p) => p.id === packId);
  if (!org || !pack) return null;

  const newBalance = org.balance + pack.credits;
  const txn: CreditTransaction = {
    id: createId(),
    type: "topup",
    amount: pack.credits,
    balanceAfter: newBalance,
    timestamp: Date.now(),
    packName: pack.name,
  };

  org.balance = newBalance;
  org.transactions.push(txn);
  creditMap.set(orgId, { ...org });
  persistToStorage();
  return txn;
}

/** Get daily usage totals for the last N days (for the usage chart) */
export function getDailyUsage(days: number = 7, orgId: string = DEFAULT_ORG_ID): { date: string; credits: number }[] {
  ensureInitialized();
  const org = creditMap.get(orgId);
  if (!org) return [];

  const now = new Date();
  const result: { date: string; credits: number }[] = [];

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const dayStart = new Date(dateStr).getTime();
    const dayEnd = dayStart + 86400000;

    const total = org.transactions
      .filter((t) => t.type === "deduction" && t.timestamp >= dayStart && t.timestamp < dayEnd)
      .reduce((sum, t) => sum + t.amount, 0);

    result.push({ date: dateStr, credits: total });
  }

  return result;
}
```

**Step 2: Verify build**

Run: `pnpm build 2>&1 | tail -5`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/lib/credit-store.ts
git commit -m "feat(credits): add credit store with localStorage persistence"
```

---

### Task 3: Add `creditCost` to ChatMessage + creditVersion to SidebarContext

**Files:**
- Modify: `src/lib/types.ts:132-150` — add `creditCost` field to `ChatMessage`
- Modify: `src/components/sidebar-context.tsx` — add `creditVersion` + `notifyCreditChanged`

**Step 1: Add creditCost to ChatMessage**

In `src/lib/types.ts`, add this field to the `ChatMessage` interface (after `cardDismissed?: boolean;` on line 149):

```ts
  /** Simulated credit cost for this response */
  creditCost?: number;
```

**Step 2: Add creditVersion to SidebarContext**

In `src/components/sidebar-context.tsx`:

a) Add to the `SidebarContextValue` interface (after `notifyCanvasChanged: () => void;` on line 27):

```ts
  creditVersion: number;
  notifyCreditChanged: () => void;
```

b) Add state in `SidebarProvider` (after `const [canvasVersion, setCanvasVersion] = useState(0);` on line 46):

```ts
  const [creditVersion, setCreditVersion] = useState(0);
```

c) Add the notify callback (after `notifyCanvasChanged` callback around line 99):

```ts
  const notifyCreditChanged = useCallback(() => {
    setCreditVersion((v) => v + 1);
  }, []);
```

d) Add both to the Provider value object (after `notifyCanvasChanged,` on line 132):

```ts
        creditVersion,
        notifyCreditChanged,
```

**Step 3: Verify build**

Run: `pnpm build 2>&1 | tail -5`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/lib/types.ts src/components/sidebar-context.tsx
git commit -m "feat(credits): add creditCost to ChatMessage and creditVersion to SidebarContext"
```

---

### Task 4: Wire Credit Deduction into Chat Flow

**Files:**
- Modify: `src/app/page.tsx` — import store, generate cost on response complete, deduct credits

**Step 1: Add imports**

At the top of `src/app/page.tsx`, add after the existing imports:

```ts
import { generateCreditCost, deductCredits } from "@/lib/credit-store";
```

Also destructure `notifyCreditChanged` from `useSidebarContext()` (find the existing destructure around line 4 import of `useSidebarContext` and where it's called).

**Step 2: Add credit deduction for direct chat responses**

In the direct chat path, after the `setMessages` call that clears the streaming variant and attaches `followUpActions` (around line 911-913), add credit assignment:

```ts
          // Assign credit cost for direct response
          const directCost = generateCreditCost("direct");
          deductCredits(directCost, {
            conversationId: convId,
            messageId: responseMsgId,
            queryMode: "direct",
            questionPreview: text.length > 60 ? text.slice(0, 60) + "..." : text,
          });
          setMessages((prev) =>
            prev.map((m) => m.id === responseMsgId ? { ...m, creditCost: directCost } : m)
          );
          notifyCreditChanged();
```

**Step 3: Add credit deduction for analytics responses**

In the analytics flow, inside the `case "done":` handler (around line 1222-1234), add credit assignment after the existing `setMessages` call:

```ts
                case "done": {
                  // Attach follow-up actions to the response message
                  const analyticsCost = generateCreditCost(mode === "deep" ? "deep" : "quick");
                  setMessages((prev) => {
                    const agentMsg = prev.find((m) => m.id === agentMsgId);
                    const subagents = agentMsg?.agent?.subagents ?? [];
                    const actions = determineFollowUpActions(subagents, mode);
                    return prev.map((m) =>
                      m.id === responseMsgId
                        ? { ...m, followUpActions: actions, creditCost: analyticsCost }
                        : m
                    );
                  });
                  deductCredits(analyticsCost, {
                    conversationId: convId,
                    messageId: responseMsgId,
                    queryMode: mode === "deep" ? "deep" : "quick",
                    questionPreview: text.length > 60 ? text.slice(0, 60) + "..." : text,
                  });
                  notifyCreditChanged();
                  break;
                }
```

Note: `convId`, `text`, and `mode` are already in scope. `notifyCreditChanged` comes from `useSidebarContext()`.

**Step 4: Verify build**

Run: `pnpm build 2>&1 | tail -5`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(credits): wire credit deduction into chat response flow"
```

---

### Task 5: Per-Message Credit Badge in ChatThread

**Files:**
- Modify: `src/components/chat/chat-thread.tsx` — add metadata line with credit cost below sentinel messages

**Step 1: Add a `MessageMeta` component**

Add this component at the bottom of `chat-thread.tsx`, before the `SentinelAvatar` component:

```tsx
function MessageMeta({ message }: { message: ChatMessage }) {
  if (message.role === "user" || !message.creditCost) return null;

  const time = new Date(message.timestamp).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  // Determine mode label from the message context
  // Agent messages with subagents = deep research, otherwise check if it's a regular sentinel msg
  const isDeep = message.role === "agent" || (message.creditCost && message.creditCost >= 8);
  const modeLabel = message.creditCost === 1 ? "Direct" : isDeep ? "Deep Research" : "Quick Answer";

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1 pl-10">
      <span>{time}</span>
      <span>·</span>
      <span>{modeLabel}</span>
      <span>·</span>
      <span className="inline-flex items-center gap-0.5">
        ⚡ {message.creditCost}
      </span>
    </div>
  );
}
```

**Step 2: Render MessageMeta below sentinel responses**

In the `messages.map` block, find the two places sentinel messages render:

a) After the `DocumentView` return (around line 250-258), wrap the return to include `MessageMeta`:

```tsx
              return (
                <div key={msg.id} className="animate-fade-in-up">
                  <DocumentView
                    content={msg.content}
                    onCitationClick={onCitationClick}
                    activeCitation={activeCitation}
                    renderChartActions={renderChartActions}
                  />
                  <MessageMeta message={msg} />
                </div>
              );
```

b) After the plain `SentinelMessage` return (around line 260), add `MessageMeta`:

```tsx
            return (
              <div key={msg.id} className="animate-fade-in-up">
                <SentinelMessage message={msg} />
                <MessageMeta message={msg} />
              </div>
            );
```

**Step 3: Verify build**

Run: `pnpm build 2>&1 | tail -5`
Expected: Build succeeds

**Step 4: Manual test**

Run: `pnpm dev`
- Send a question in the chat
- After the response completes, verify you see a metadata line like: `2:34 PM · Deep Research · ⚡ 14`

**Step 5: Commit**

```bash
git add src/components/chat/chat-thread.tsx
git commit -m "feat(credits): add per-message credit badge inline with timestamp"
```

---

### Task 6: Sidebar Billing Panel

**Files:**
- Create: `src/components/billing/billing-panel.tsx`
- Modify: `src/components/sidebar.tsx` — add `"billing"` to HoverPanel, add rail icon, add panel render

**Step 1: Create the BillingPanel component**

```tsx
// src/components/billing/billing-panel.tsx
"use client";

import { useRouter } from "next/navigation";
import { useSidebarContext } from "@/components/sidebar-context";
import { getOrgCredits, getTransactionHistory } from "@/lib/credit-store";

const ITEM = "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-muted transition-colors text-left";
const PRIMARY = "text-[13px] text-foreground truncate";
const SECONDARY = "text-[11px] text-muted-foreground truncate block";
const SECTION_HEADER = "text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-widest px-2.5 pt-2 pb-1";
const FOOTER = "mx-1.5 mb-3 mt-1 px-2.5 py-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors text-left w-auto";
const EMPTY = "text-[13px] text-muted-foreground px-2.5 py-4 text-center";

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function BillingPanel() {
  const router = useRouter();
  const { creditVersion } = useSidebarContext();
  void creditVersion; // Read to trigger re-render when bumped

  const org = getOrgCredits();
  const transactions = getTransactionHistory(undefined, 10);

  if (!org) return <p className={EMPTY}>No credit data</p>;

  const maxBalance = 1000; // Visual max for progress bar
  const pct = Math.min(100, Math.round((org.balance / maxBalance) * 100));

  return (
    <>
      {/* Balance overview */}
      <div className="px-3 pb-2">
        <div className="flex items-baseline justify-between mb-1">
          <span className="text-2xl font-semibold tabular-nums">{org.balance}</span>
          <span className="text-[11px] text-muted-foreground">{org.orgName}</span>
        </div>
        <p className="text-[11px] text-muted-foreground mb-2">credits remaining</p>
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{
              width: `${pct}%`,
              backgroundColor: pct > 30 ? "#3E63DD" : pct > 10 ? "#F76B15" : "#E5484D",
            }}
          />
        </div>
      </div>

      {/* Recent transactions */}
      <div className="flex-1 overflow-y-auto px-1.5">
        <p className={SECTION_HEADER}>Recent usage</p>
        <div>
          {transactions.length > 0 ? (
            transactions.map((txn) => (
              <div key={txn.id} className={ITEM}>
                <div className="min-w-0 flex-1">
                  <p className={PRIMARY}>
                    {txn.type === "topup"
                      ? `Credit top-up: ${txn.packName}`
                      : txn.questionPreview || "Query"}
                  </p>
                  <p className={SECONDARY}>{relativeTime(txn.timestamp)}</p>
                </div>
                <span
                  className={`text-[13px] font-medium tabular-nums shrink-0 ${
                    txn.type === "topup" ? "text-emerald-600" : "text-red-500"
                  }`}
                >
                  {txn.type === "topup" ? "+" : "-"}{txn.amount}
                </span>
              </div>
            ))
          ) : (
            <p className={EMPTY}>No transactions yet</p>
          )}
        </div>
      </div>

      <button onClick={() => router.push("/billing")} className={FOOTER}>
        View Billing →
      </button>
    </>
  );
}
```

**Step 2: Add billing to sidebar**

In `src/components/sidebar.tsx`:

a) Add `Wallet` to the lucide imports (line 10 area):

```ts
import { ..., Wallet } from "lucide-react";
```

b) Add `"billing"` to the `HoverPanel` type union (line 47):

```ts
type HoverPanel = "history" | "knowledge" | "metrics" | "segments" | "playbooks" | "scouts" | "canvas" | "connectors" | "billing" | "user" | null;
```

c) Add `"billing"` case to `getActivePage` (before the default return):

```ts
  if (pathname.startsWith("/billing")) return "billing";
```

d) Add `"billing"` case to `pageToPanel`:

```ts
      case "billing": return "billing";
```

e) Add the Billing rail icon — insert after the Connectors `RailIcon` block (after line 208) and before the spacer:

```tsx
        <RailIcon
          icon={Wallet}
          label="Billing"
          active={activePage === "billing"}
          onHover={() => setHoveredItem("billing")}
          onClick={() => router.push("/billing")}
        />
```

f) Add the panel header label (inside the `<h3>` block around line 238-246):

```tsx
              {activePanel === "billing" && "Billing"}
```

g) Add the panel render (after `{activePanel === "connectors" && <ConnectorsPanel />}` around line 279):

```tsx
          {activePanel === "billing" && <BillingPanel />}
```

h) Add the import at the top of the file:

```ts
import { BillingPanel } from "@/components/billing/billing-panel";
```

**Step 3: Verify build**

Run: `pnpm build 2>&1 | tail -5`
Expected: Build succeeds

**Step 4: Manual test**

Run: `pnpm dev`
- Hover over the Wallet icon in the sidebar rail
- Verify you see: balance, progress bar, recent transactions list, "View Billing →" link

**Step 5: Commit**

```bash
git add src/components/billing/billing-panel.tsx src/components/sidebar.tsx
git commit -m "feat(credits): add sidebar billing panel with credit ledger"
```

---

### Task 7: Billing Page

**Files:**
- Create: `src/app/billing/page.tsx`

**Step 1: Create the billing page**

This follows the page shell pattern: `"use client"` + `flex flex-col h-full min-w-0` outer + `max-w-5xl mx-auto px-6 py-8` content area.

```tsx
// src/app/billing/page.tsx
"use client";

import { useState, useCallback } from "react";
import { useSidebarContext } from "@/components/sidebar-context";
import {
  getOrgCredits,
  getTransactionHistory,
  getDailyUsage,
  topUpCredits,
} from "@/lib/credit-store";
import { CREDIT_PACKS } from "@/lib/credit-types";
import type { CreditPackId } from "@/lib/credit-types";
import { Zap, TrendingUp, ArrowUpRight, ArrowDownRight, Filter } from "lucide-react";
import { toast } from "sonner";

export default function BillingPage() {
  const { creditVersion, notifyCreditChanged } = useSidebarContext();
  void creditVersion; // Subscribe to updates

  const org = getOrgCredits();
  const transactions = getTransactionHistory(undefined, 50);
  const dailyUsage = getDailyUsage(7);
  const [filter, setFilter] = useState<"all" | "deduction" | "topup">("all");

  const filteredTxns = filter === "all"
    ? transactions
    : transactions.filter((t) => t.type === filter);

  const handleBuy = useCallback(
    (packId: CreditPackId) => {
      const txn = topUpCredits(packId);
      if (txn) {
        notifyCreditChanged();
        const pack = CREDIT_PACKS.find((p) => p.id === packId);
        toast.success(`Added ${txn.amount} credits`, {
          description: `${pack?.name} pack purchased for $${pack?.price}`,
        });
      }
    },
    [notifyCreditChanged],
  );

  if (!org) {
    return (
      <div className="flex flex-col h-full min-w-0">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <p className="text-muted-foreground">No credit data available.</p>
        </div>
      </div>
    );
  }

  // Usage chart: simple bar chart using divs
  const maxDaily = Math.max(...dailyUsage.map((d) => d.credits), 1);

  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
          {/* ── Header ── */}
          <div>
            <h1 className="text-2xl font-semibold">Billing</h1>
            <p className="text-sm text-muted-foreground mt-1">{org.orgName}</p>
          </div>

          {/* ── Balance + Usage Chart ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Balance card */}
            <div className="border border-border rounded-xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <Zap className="w-5 h-5 text-blue-500" />
                <span className="text-sm font-medium text-muted-foreground">Credit Balance</span>
              </div>
              <p className="text-4xl font-semibold tabular-nums">{org.balance.toLocaleString()}</p>
              <p className="text-sm text-muted-foreground mt-1">credits remaining</p>
            </div>

            {/* Usage chart card */}
            <div className="border border-border rounded-xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="w-5 h-5 text-blue-500" />
                <span className="text-sm font-medium text-muted-foreground">Last 7 Days Usage</span>
              </div>
              <div className="flex items-end gap-1.5 h-20">
                {dailyUsage.map((day) => {
                  const height = day.credits > 0 ? Math.max(8, (day.credits / maxDaily) * 100) : 4;
                  const dayLabel = new Date(day.date).toLocaleDateString([], { weekday: "short" });
                  return (
                    <div key={day.date} className="flex-1 flex flex-col items-center gap-1">
                      <div
                        className="w-full rounded-sm transition-all"
                        style={{
                          height: `${height}%`,
                          backgroundColor: day.credits > 0 ? "#3E63DD" : "#e5e7eb",
                          minHeight: 3,
                        }}
                        title={`${day.credits} credits`}
                      />
                      <span className="text-[10px] text-muted-foreground">{dayLabel}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ── Credit Packs ── */}
          <div>
            <h2 className="text-lg font-semibold mb-4">Top Up Credits</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {CREDIT_PACKS.map((pack) => (
                <div
                  key={pack.id}
                  className={`relative border rounded-xl p-6 flex flex-col items-center text-center transition-colors hover:border-foreground/20 ${
                    pack.popular ? "border-blue-500 bg-blue-50/50 dark:bg-blue-950/20" : "border-border"
                  }`}
                >
                  {pack.popular && (
                    <span className="absolute -top-2.5 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-blue-500 text-white rounded-full">
                      Popular
                    </span>
                  )}
                  <p className="text-sm font-medium text-muted-foreground mb-1">{pack.name}</p>
                  <p className="text-3xl font-semibold tabular-nums">{pack.credits.toLocaleString()}</p>
                  <p className="text-sm text-muted-foreground mb-4">credits</p>
                  <p className="text-xl font-semibold mb-4">${pack.price}</p>
                  <button
                    onClick={() => handleBuy(pack.id)}
                    className={`w-full py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
                      pack.popular
                        ? "bg-blue-500 text-white hover:bg-blue-600"
                        : "bg-foreground text-background hover:bg-foreground/90"
                    }`}
                  >
                    Buy
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* ── Transaction History ── */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Transaction History</h2>
              <div className="flex items-center gap-1">
                <Filter className="w-3.5 h-3.5 text-muted-foreground" />
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value as typeof filter)}
                  className="text-sm border border-border rounded-md px-2 py-1 bg-background"
                >
                  <option value="all">All</option>
                  <option value="deduction">Deductions</option>
                  <option value="topup">Top-ups</option>
                </select>
              </div>
            </div>

            <div className="border border-border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Date</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Description</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Type</th>
                    <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Amount</th>
                    <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTxns.length > 0 ? (
                    filteredTxns.map((txn) => (
                      <tr key={txn.id} className="border-b border-border last:border-0">
                        <td className="px-4 py-2.5 text-muted-foreground tabular-nums whitespace-nowrap">
                          {new Date(txn.timestamp).toLocaleDateString([], {
                            month: "short",
                            day: "numeric",
                          })}
                        </td>
                        <td className="px-4 py-2.5 truncate max-w-[300px]">
                          {txn.type === "topup"
                            ? `Credit top-up: ${txn.packName}`
                            : txn.questionPreview || "Query"}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex items-center gap-1 text-xs font-medium ${
                            txn.type === "topup" ? "text-emerald-600" : "text-muted-foreground"
                          }`}>
                            {txn.type === "topup" ? (
                              <><ArrowUpRight className="w-3 h-3" /> Top-up</>
                            ) : (
                              <><ArrowDownRight className="w-3 h-3" /> Usage</>
                            )}
                          </span>
                        </td>
                        <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${
                          txn.type === "topup" ? "text-emerald-600" : "text-red-500"
                        }`}>
                          {txn.type === "topup" ? "+" : "-"}{txn.amount}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                          {txn.balanceAfter}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                        No transactions found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Verify build**

Run: `pnpm build 2>&1 | tail -5`
Expected: Build succeeds

**Step 3: Manual test**

Run: `pnpm dev`
- Navigate to `/billing`
- Verify: balance card, 7-day usage chart, 3 credit pack cards, transaction history table
- Click "Buy" on a pack → success toast, balance updates, transaction appears in table
- Click "Billing" in sidebar → navigates to this page

**Step 4: Commit**

```bash
git add src/app/billing/page.tsx
git commit -m "feat(credits): add full billing page with balance, packs, and transaction history"
```

---

### Task 8: Final Integration Test + Cleanup

**Files:**
- No new files — just testing and verifying all surfaces work together

**Step 1: Full build check**

Run: `pnpm build 2>&1 | tail -10`
Expected: Build succeeds with no errors

**Step 2: End-to-end manual test**

Run: `pnpm dev` and verify:

1. Send a deep research question → response shows `⚡ 14` (or similar 8-20 range) inline with timestamp
2. Send a quick question → response shows `⚡ 3` (or similar 1-5 range)
3. Hover sidebar Wallet icon → ledger panel shows updated balance and recent transactions
4. Navigate to `/billing` → balance card reflects deductions, usage chart shows today's usage
5. Buy a credit pack → balance increases, transaction appears in both ledger panel and billing page

**Step 3: Lint check**

Run: `pnpm lint 2>&1 | tail -10`
Expected: No new lint errors

**Step 4: Final commit (if any lint fixes needed)**

```bash
git add -A
git commit -m "fix(credits): lint and cleanup"
```
