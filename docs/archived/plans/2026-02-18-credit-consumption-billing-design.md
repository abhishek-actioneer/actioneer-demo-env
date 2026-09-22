# Credit Consumption & Billing Design

**Date:** 2026-02-18
**Status:** Approved
**Scope:** Frontend-only feature — no backend, no real payments

## Overview

Show per-question credit consumption throughout the chat experience, provide a sidebar ledger for quick visibility, and a full billing page for top-ups and transaction history. All credits are simulated with random costs based on query mode.

## Data Model

### CreditTransaction
```ts
interface CreditTransaction {
  id: string;
  type: "deduction" | "topup";
  amount: number;
  balanceAfter: number;
  timestamp: number;
  conversationId?: string;
  messageId?: string;
  queryMode?: "deep" | "quick" | "direct";
  questionPreview?: string;    // first ~60 chars
  packName?: string;           // for top-ups
}
```

### OrgCreditState
```ts
interface OrgCreditState {
  orgId: string;
  orgName: string;
  balance: number;
  transactions: CreditTransaction[];
}
```

### ChatMessage Extension
Add `creditCost?: number` to the existing `ChatMessage` interface.

## Credit Store (`src/lib/credit-store.ts`)

Follows the established store pattern: `Map<string, OrgCreditState>` + localStorage + `ensureInitialized()`.

- Seeds default org "org-1" / "Acme Corp" with 500 credits and ~5 mock historical transactions
- Exports: `getOrgCredits()`, `deductCredits()`, `topUpCredits()`, `getTransactionHistory()`
- Uses `STORAGE_VERSION` pattern for cache invalidation

## Tiered Credit Costs

| Query Mode    | Credit Range | Formula                              |
|---------------|-------------|--------------------------------------|
| Deep Research | 8–20        | `Math.floor(Math.random() * 13) + 8` |
| Quick Answer  | 1–5         | `Math.floor(Math.random() * 5) + 1`  |
| Direct Chat   | 1           | Fixed                                |

Credits assigned when the response completes, stored on `ChatMessage.creditCost`.

## UI Surface 1: Per-Message Credit Badge

**Location:** Inline metadata line below each sentinel/agent message in `ChatThread`.

**Format:** `2:34 PM · Deep Research · ⚡ 14`

- Only on sentinel/agent messages, not user messages
- Styled `text-muted-foreground text-xs`
- Lightning bolt icon (⚡) prefix

## UI Surface 2: Sidebar Ledger Panel

**Navigation:** New rail icon (Wallet from lucide) → hover panel.

**Panel contents:**
- Header: "Credit Usage" + org name
- Balance bar with visual progress indicator
- Last 10 transactions: question preview, amount (red deduction / green top-up), relative time
- Footer: "View billing →" link to `/billing`

**Implementation:** Add `"billing"` to `HoverPanel` type union, create `BillingPanel` component.

## UI Surface 3: Billing Page (`/billing`)

**Route:** `/billing` — full page following page shell pattern.

### Top Section — Balance Overview
- Large balance number with org name
- "credits remaining" subtitle
- Mini usage chart (last 7 days consumption)

### Middle Section — Credit Packs
3 pricing cards in a grid:

| Pack    | Credits | Price | Note     |
|---------|---------|-------|----------|
| Starter | 100     | $10   |          |
| Growth  | 500     | $40   | Popular  |
| Pro     | 1,000   | $70   |          |

"Buy" button → success toast + balance update + transaction recorded.

### Bottom Section — Transaction History
- Table: Date, Description, Type, Amount, Balance After
- Filterable by type (deduction/topup)
- Last 50 transactions, scrollable

## Reactivity

Use the existing version-counter pattern in `SidebarContext`:
- Add `creditVersion` counter
- Bump on deduction or top-up
- Sidebar ledger panel and billing page subscribe to trigger re-renders

## Files to Create/Modify

**New files:**
- `src/lib/credit-types.ts` — types
- `src/lib/credit-store.ts` — store
- `src/components/billing/billing-panel.tsx` — sidebar ledger panel
- `src/app/billing/page.tsx` — full billing page

**Modified files:**
- `src/lib/types.ts` — add `creditCost` to `ChatMessage`
- `src/components/chat/chat-thread.tsx` — render credit badge
- `src/components/sidebar.tsx` — add billing rail icon + panel
- `src/components/sidebar-context.tsx` — add `creditVersion` counter
- `src/app/page.tsx` — call `deductCredits()` on response complete
