# Baby Sentinel: Sidebar & Billing Patterns Research

## Research Date
2026-02-18

## Overview
This document captures the architectural patterns for the sidebar navigation system, billing features, and credit management in Baby Sentinel.

---

## 1. Sidebar Architecture

### High-Level Structure: Three-Zone Pattern

The sidebar is a fixed layout with THREE distinct zones:

```
┌──────────────────────┐
│  Icon Rail (75px)    │  Zone 1: Navigation
│  - Logo              │
│  - Nav icons         │  Static, always visible
│  - Spacer            │  Hover triggers panel
│  - User button       │
└──────────────────────┤
│  Detail Panel (0-220px) │  Zone 2: Context panel
│  - Header            │
│  - Content           │  Slides in/out based on:
│  - Footer            │  - activePanel state
│                      │  - pinned state
└──────────────────────┘
```

### File: `src/components/sidebar.tsx` (780 lines)

**Key Components:**
- `Sidebar()` - Main container (flex layout)
- `RailIcon()` - Individual nav button (icon + label)
- Panel functions: `HistoryPanel()`, `KnowledgePanel()`, `MetricsPanel()`, `SegmentsPanel()`, `PlaybooksPanel()`, `ScoutsPanel()`, `CanvasPanel()`, `ConnectorsPanel()`, `UserPanel()`
- `BillingPanel` - Imported from `@/components/billing/billing-panel`

**State Management:**
```tsx
const [hoveredItem, setHoveredItem] = useState<HoverPanel>(null);
const [pinned, setPinned] = useState(false);  // Persisted to localStorage
```

**Active Panel Logic:**
- When NOT pinned: `activePanel = hoveredItem` (only show on hover)
- When pinned: `activePanel = hoveredItem ?? pageToPanel(activePage)` (show hovered panel OR current page's panel)
- Detail panel width: `w-0` (closed) or `w-[220px]` (open) with `overflow-hidden` + `transition-all`

### HoverPanel Type Union
```tsx
type HoverPanel = "history" | "knowledge" | "metrics" | "segments" | "playbooks" | "scouts" | "canvas" | "connectors" | "billing" | "user" | null;
```

### getActivePage() Logic
Maps URL pathname to a panel name:
- `/` or undefined → `"chat"`
- `/knowledge` → `"knowledge"`
- `/metrics` → `"metrics"`
- `/segments` → `"segments"`
- `/playbooks` → `"playbooks"`
- `/scouts` → `"scouts"`
- `/canvas` → `"canvas"`
- `/connectors` → `"connectors"`
- `/billing` → `"billing"`

### pageToPanel() Logic
Mirrors getActivePage() to associate route with sidebar panel. New routes should:
1. Add to `HoverPanel` type union
2. Add case to `getActivePage()`
3. Add case to `pageToPanel()`
4. Add `RailIcon` to icon rail
5. Add panel rendering in detail section

### Panel Styling Constants
```tsx
const SECTION_HEADER = "text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-widest px-2.5 pt-2 pb-1";
const ITEM = "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-muted transition-colors text-left";
const PRIMARY = "text-[13px] text-foreground truncate";
const SECONDARY = "text-[11px] text-muted-foreground truncate block";
const FOOTER = "mx-1.5 mb-3 mt-1 px-2.5 py-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors text-left w-auto";
const ICON = "w-3.5 h-3.5 text-muted-foreground shrink-0";
const EMPTY = "text-[13px] text-muted-foreground px-2.5 py-4 text-center";
```

**Panel Layout Pattern (used by all panels):**
```tsx
<>
  <div className="flex-1 overflow-y-auto px-1.5">
    <p className={SECTION_HEADER}>Section Title</p>
    <div>
      {items.map((item) => (
        <button key={item.id} className={ITEM}>
          <div className="min-w-0 flex-1">
            <p className={PRIMARY}>{item.title}</p>
            <p className={SECONDARY}>{item.description}</p>
          </div>
        </button>
      ))}
    </div>
  </div>
  <button onClick={() => router.push("/path")} className={FOOTER}>
    View All →
  </button>
</>
```

---

## 2. Sidebar Context Pattern

### File: `src/components/sidebar-context.tsx` (148 lines)

**Context Value Interface:**
```tsx
interface SidebarContextValue {
  // Chat management
  chats: ChatEntry[];
  activeId: string | null;
  onNewChat: () => void;
  onSelect: (id: string) => void;
  onSearchClick?: () => void;
  setChats: (chats: ChatEntry[]) => void;
  setActiveId: (id: string | null) => void;
  setOnNewChat: (fn: () => void) => void;
  setOnSelect: (fn: (id: string) => void) => void;
  setOnSearchClick: (fn: (() => void) | undefined) => void;
  refreshChats: () => Promise<void>;
  
  // Segment management
  segments: SegmentDisplay[];
  refreshSegments: () => Promise<void>;
  
  // Version bump pattern for reactivity
  playbookVersion: number;
  notifyPlaybookSaved: () => void;
  canvasVersion: number;
  notifyCanvasChanged: () => void;
  creditVersion: number;
  notifyCreditChanged: () => void;
}
```

**Callback Storage Pattern (prevents re-renders):**
Uses refs to store callback functions:
```tsx
const onNewChatRef = useRef<() => void>(() => router.push("/"));
const onSelectRef = useRef<(id: string) => void>((id: string) => router.push(`/?conv=${id}`));
const onSearchClickRef = useRef<(() => void) | undefined>(undefined);
```

Then exposes setters that update the ref AND bump a tick counter:
```tsx
const setOnNewChat = useCallback((fn: () => void) => {
  onNewChatRef.current = fn;
  bump();  // Force re-render
}, [bump]);
```

**Version Bump Pattern (for reactive updates):**
When data changes on a page that affects sidebar display:
1. Call `notifyPlaybookSaved()` / `notifyCanvasChanged()` / `notifyCreditChanged()`
2. This increments the version counter (e.g., `playbookVersion`)
3. Panel component reads the version: `void playbookVersion;` (just to subscribe)
4. Component re-renders, fetches fresh data

This avoids needing complex dependency tracking or lifting all data to the context.

---

## 3. Billing Panel Implementation

### File: `src/components/billing/billing-panel.tsx` (95 lines)

**Purpose:** Sidebar panel showing credit balance, recent transactions, and quick access to billing page.

**Key Features:**
1. **Credit Balance Display**
   - Large number showing org balance
   - Org name and unit label
   - Progress bar (blue > 30%, orange 10-30%, red < 10%)

2. **Recent Transactions List**
   - Limited to 10 most recent (in reverse chronological order)
   - Shows transaction type (topup/deduction) with icons
   - Question preview (truncated) for deductions
   - Color-coded amounts: green (+) for topup, red (-) for deduction
   - Relative time display ("just now", "5m ago", "2h ago", "3d ago")

3. **Navigation Button**
   - "View Billing →" button links to full `/billing` page

**Reactivity:**
- Reads `creditVersion` from context to trigger re-render when credits change
- Calls `getOrgCredits()` and `getTransactionHistory()` on each render

**Styling:** Uses same constants as sidebar panels (ITEM, PRIMARY, SECONDARY, etc.)

### File: `src/app/billing/page.tsx` (224 lines)

**Full Billing Page Features:**

1. **Header Section**
   - Title: "Billing"
   - Org name subtitle

2. **Two-Column Layout: Balance + Usage Chart**
   - Balance Card: Large number, "credits remaining" label
   - Usage Chart: Last 7 days bar chart
     - Simple div-based chart (no charting library)
     - Color: blue for usage days, gray for zero days
     - Day labels (Mon, Tue, etc.)
     - Height scaled proportionally to max daily usage
     - Hover title shows exact amount

3. **Credit Packs Section**
   - Three cards (Starter, Growth, Pro)
   - Growth marked as "Popular" with blue styling
   - Shows: name, credit count, price, "Buy" button
   - Popular button: blue background, other: foreground
   - onClick: calls `topUpCredits(packId)` → shows toast with success message

4. **Transaction History Table**
   - Filter dropdown: "All", "Deductions", "Top-ups"
   - Columns: Date, Description, Type, Amount, Balance
   - Date format: "Jan 15"
   - Type badge: green "Top-up" with up arrow, gray "Usage" with down arrow
   - Amount: green (+) or red (-)
   - Balance: tabular numbers
   - Empty state: "No transactions found"

**Reactivity:**
- Reads `creditVersion` to trigger re-render on credit changes
- Calls `notifyCreditChanged()` after purchase to broadcast update

### File: `src/lib/credit-types.ts` (40 lines)

**Type Definitions:**
```tsx
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

---

## 4. Credit Store Pattern

### File: `src/lib/credit-store.ts` (192 lines)

**In-Memory Store + localStorage Pattern** (follows canvas-store / conversation-store pattern):

```tsx
const creditMap = new Map<string, OrgCreditState>();
let initialized = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

const STORAGE_KEY = "baby-sentinel-credits";
const STORAGE_VERSION = 1;
const DEFAULT_ORG_ID = "org-1";
```

**ensureInitialized() Flow:**
1. Check version mismatch BEFORE `initialized` guard
2. If version changed: clear localStorage, reset map, set new version
3. If already initialized: return
4. Try restoring from localStorage
5. If restore fails or localStorage empty: seed with mock data

**Mock Seed Data:**
```tsx
const seedTransactions: CreditTransaction[] = [
  { id: ..., type: "topup", amount: 500, balanceAfter: 500, timestamp: now - 7d, packName: "Growth" },
  { id: ..., type: "deduction", amount: 14, balanceAfter: 486, timestamp: now - 6d, queryMode: "deep", questionPreview: "What are the top revenue drivers..." },
  // ... more transactions
];

creditMap.set(DEFAULT_ORG_ID, {
  orgId: DEFAULT_ORG_ID,
  orgName: "Acme Corp",
  balance: 453,
  transactions: seedTransactions,
});
```

**Persistence:**
- Debounced (300ms) write to localStorage
- Synchronous `flushToStorage()` for unmount/navigation

**Public API:**

```tsx
// Reading
export function getOrgCredits(orgId?: string): OrgCreditState | undefined
export function getBalance(orgId?: string): number
export function getTransactionHistory(orgId?: string, limit?: number): CreditTransaction[]
export function getDailyUsage(days?: number, orgId?: string): { date: string; credits: number }[]

// Mutations
export function generateCreditCost(mode: "deep" | "quick" | "direct"): number
  // deep: 8-20 credits (random)
  // quick: 1-5 credits (random)
  // direct: 1 credit (fixed)

export function deductCredits(amount: number, meta: {...}, orgId?: string): CreditTransaction | null

export function topUpCredits(packId: CreditPackId, orgId?: string): CreditTransaction | null
```

---

## 5. Credit Integration in Chat Flow

### File: `src/app/page.tsx` (relevant sections)

**Context Injection:**
```tsx
const { ..., notifyCreditChanged } = useSidebarContext();
```

**Direct Response Path (line ~914-924):**
```tsx
const directCost = generateCreditCost("direct");  // Always 1
deductCredits(directCost, {
  conversationId: convId,
  messageId: responseMsgId,
  queryMode: "direct",
  questionPreview: text.length > 60 ? text.slice(0, 60) + "..." : text,
});
setMessages((prev) => prev.map((m) => 
  m.id === responseMsgId ? { ...m, creditCost: directCost } : m
));
notifyCreditChanged();
```

**Analytics Response Path (line ~1235-1252):**
```tsx
const analyticsCost = generateCreditCost(mode === "deep" ? "deep" : "quick");
setMessages((prev) => {
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
```

---

## 6. Credit Badge in Chat Messages

### File: `src/components/chat/chat-thread.tsx` (MessageMeta component, line ~340-359)

**Message Meta Rendering:**
```tsx
function MessageMeta({ message }: { message: ChatMessage }) {
  if (message.role === "user" || !message.creditCost) return null;

  const time = new Date(message.timestamp).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="flex items-center justify-end gap-1.5 text-xs text-muted-foreground mt-1">
      <span>{time}</span>
      <span>·</span>
      <span className="inline-flex items-center gap-0.5">
        ⚡ {message.creditCost}
      </span>
    </div>
  );
}
```

**Display Format:** `⚡ 14` (timestamp · credit amount)

**When Rendered:**
- Below sentinel/agent messages that have a creditCost
- NOT shown for user messages
- Uses `message.creditCost` field

---

## 7. Integration Points Checklist

### Pages
- ✅ `/` (home/chat) - integrates credit deduction
- ✅ `/billing` - full billing UI
- ✅ Sidebar billing panel - quick view

### Components
- ✅ `Sidebar` - includes Wallet icon + billing navigation
- ✅ `BillingPanel` - sidebar drawer
- ✅ `ChatThread` - displays credit badge (MessageMeta)

### Context
- ✅ `SidebarContext` - provides `creditVersion`, `notifyCreditChanged()`
- ✅ `useSidebarContext()` hook - consumed by page.tsx, billing/page.tsx, BillingPanel

### Stores
- ✅ `credit-store.ts` - in-memory + localStorage persistence
- ✅ `credit-types.ts` - type definitions
- ✅ `conversation-store.ts` - stores conversation + message data (includes creditCost field)

### Data Model
- ✅ `ChatMessage.creditCost?: number` - cost attached to each response

---

## 8. Key Patterns & Conventions

### Sidebar Panel Pattern
**Every new panel should:**
1. Add to `HoverPanel` type union
2. Add to `getActivePage()` pathname mapping
3. Add to `pageToPanel()` switch
4. Add `RailIcon` button to icon rail (with label and onClick handler)
5. Add panel rendering in detail section:
   ```tsx
   {activePanel === "newpanel" && <NewPanel />}
   ```
6. Add header text in panel title section (line ~250-259)
7. Follow panel layout: scrollable content + footer button

### Version Bump Reactivity
When updating sidebar data:
```tsx
// In context-providing page (e.g., playbooks page)
const { notifyPlaybookSaved } = useSidebarContext();
// ... when data changes ...
notifyPlaybookSaved();

// In sidebar panel
const { playbookVersion } = useSidebarContext();
void playbookVersion;  // Subscribe to updates
const data = getSavedPlaybookSummaries();  // Re-fetches on each render
```

### Store Pattern
```tsx
// In-memory Map + version check
const dataMap = new Map<string, DataType>();
let initialized = false;

function ensureInitialized() {
  // Version check BEFORE initialized guard
  if (storedVersion !== STORAGE_VERSION) { clear & reset }
  if (initialized) return;
  initialized = true;
  // Try restoring, fallback to seed
}

function persistToStorage() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    localStorage.setItem(key, JSON.stringify(Array.from(dataMap.values())));
  }, 300);
}

export function flushToStorage() {
  // Synchronous for unmount
}
```

### Credit Model
- Credit costs are random within mode ranges (simulated)
- Each message gets a `creditCost` field attached when response completes
- Badge displays in message footer with timestamp
- Full transaction history in store includes all metadata for analytics/audit
- Color-coded progress bar on balance (red < 10%, orange 10-30%, blue > 30%)

---

## 9. Visual Design Constants

### Colors
- Blue (active, positive): `#3E63DD`
- Orange (warning): `#F76B15`
- Red (critical): `#E5484D`
- Green (success): emerald-600

### Typography
- Rail labels: `text-[10px]` normal
- Section headers: `text-[10px]` semibold, uppercase, tracking-widest, muted-foreground/70
- Primary item text: `text-[13px]` foreground, truncate
- Secondary item text: `text-[11px]` muted-foreground, truncate
- Timestamp: `text-xs` muted-foreground
- Credit badge: inline-flex with gap-0.5

### Spacing
- Rail width: `w-[75px]`
- Panel width (open): `w-[220px]`
- Panel padding: `px-3` header, `px-1.5` content, `mx-1.5 mb-3` footer
- Item padding: `py-1.5 px-2.5`

### Shadows & Borders
- Progress bar border-radius: rounded-full
- Cards: `border border-border rounded-xl`
- Buttons: rounded-lg with transition-colors

---

## 10. Outstanding Questions / Edge Cases

1. **Multi-org support:** Currently hardcoded to `DEFAULT_ORG_ID` ("org-1") — how should this scale?
2. **Credit warnings:** No UI warning when balance falls below threshold
3. **Failed deductions:** Currently optimistic (deduct, then notify) — should we add confirmation?
4. **Analytics:** No way to view detailed breakdown by agent/query type in current UI
5. **Refunds:** No API endpoint to reverse a deduction
6. **Rate limiting:** No mention of rate limits or daily caps in the model

---

## 11. Key File Paths (Absolute)

- `/Users/sashank/Documents/glitchcraft/repositories/baby-sentinel/src/components/sidebar.tsx`
- `/Users/sashank/Documents/glitchcraft/repositories/baby-sentinel/src/components/sidebar-context.tsx`
- `/Users/sashank/Documents/glitchcraft/repositories/baby-sentinel/src/components/billing/billing-panel.tsx`
- `/Users/sashank/Documents/glitchcraft/repositories/baby-sentinel/src/app/billing/page.tsx`
- `/Users/sashank/Documents/glitchcraft/repositories/baby-sentinel/src/lib/credit-types.ts`
- `/Users/sashank/Documents/glitchcraft/repositories/baby-sentinel/src/lib/credit-store.ts`
- `/Users/sashank/Documents/glitchcraft/repositories/baby-sentinel/src/app/page.tsx` (chat integration)
- `/Users/sashank/Documents/glitchcraft/repositories/baby-sentinel/src/components/chat/chat-thread.tsx` (credit badge)
