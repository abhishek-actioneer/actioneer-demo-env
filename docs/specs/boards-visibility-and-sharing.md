# Boards: Visibility and Sharing (Private + Global)

**Status:** Draft v0.1 — extends the parent Boards spec (`boards-handoff.md`).
**Target:** Main Sentinel app.
**Related:** GR-1220 (Solution Boards), incoming RBAC layer (Tarun).

---

## Why

The parent Boards spec ships boards as a personal artifact — one user, one board. As a team adopts Sentinel, that breaks in two predictable ways:

- The same dashboard gets rebuilt three times by three different people on the same team, because no one can see what the others already built.
- A senior analyst builds a great board and it dies with them. There's no path to make it the team's official "Acquisition Health" board that the next person opens by default.

This spec extends boards from a personal artifact to a two-tier system: boards stay private by default, but can be promoted to **global** so the rest of the workspace can find and use them.

This spec does not introduce data permissions. Whether a user can see the data behind a card is governed by the SQL/RBAC layer (separate workstream). This spec governs only who can *find, open, edit, and delete* a board.

---

## The two tiers

**Private boards** are owned by one user and visible only to that user. This is today's behavior, unchanged. Users keep building their personal exploratory boards without thinking about visibility.

**Global boards** are owned by one user (the original author) but visible to everyone in the workspace who has access to the underlying dataset. They appear in every workspace member's sidebar under a "Global" section.

Boards default to private. Promoting a board to global is an explicit action by the owner.

---

## What users see when they open a global board

The same scrollable document as today. The only differences:

- A small **Global** chip next to the board title.
- A "Last edited by [name] · [time]" line in the header.
- If a card's underlying SQL is denied by RBAC for this user, **the card is silently omitted** from the layout. The board reflows as if the card weren't there. No "access denied" placeholder, no broken slot, no error.

Two users opening the same global board can see different sets of cards. This is expected, by design — the board describes a layout; RBAC decides what renders.

---

## Roles

A board has one **Owner** and, for global boards, a set of **Editors** and **Viewers**. The owner is always the original creator unless ownership is explicitly transferred.

**Workspace Admins are automatically co-owners of every global board in their workspace.** They don't need to be granted access; promotion to global is what grants them ownership. Private boards are not co-owned by admins — admins only get owner-equivalent rights when a board is published to the workspace.

|  | Owner / Admin | Editor | Viewer |
|---|:---:|:---:|:---:|
| Open and read the board | ✓ | ✓ | ✓ |
| Change filters / date range / grain (session-only) | ✓ | ✓ | ✓ |
| Add, edit, delete cards and sections | ✓ directly | ✓ via review | — |
| Rename the board, edit description | ✓ directly | ✓ via review | — |
| Change the global date filter (persists) | ✓ directly | ✓ via review | — |
| Approve / reject pending updates | ✓ | — | — |
| Toggle visibility (private ↔ global) | ✓ | — | — |
| Delete the board | ✓ | — | — |
| Transfer ownership | ✓ | — | — |

**Editor changes never land on the live board automatically.** Every edit an Editor makes lives in their personal draft until they explicitly submit it for review and an owner or admin approves. Owners and admins skip the queue — their edits apply directly to live, since they are the approvers anyway.

**Default policy when a board goes global:** every workspace member becomes an **Editor** on that board. This matches how small teams actually work — everyone trusts everyone — but the propose-and-approve flow protects the live board from drift, churn, or accidental destruction.

**Viewer-mode interactions** (changing date range, drilling into a card) are session-only. They do not persist.

---

## How users promote a board to global

The board owner toggles visibility from the board header (alongside the existing edit/delete icons) and clicks **Make Global**. A small confirmation dialog asks "Make this board visible to everyone in [workspace]?" with two buttons: Cancel / Make Global.

Promotion is reversible. The owner can flip back to Private at any time from the same menu. Demoting to Private removes the board from everyone else's sidebar but does not delete any of their work — the board still exists, just no longer visible to them.

---

## How users discover global boards

**The sidebar does not change.** It continues to show a flat list of all boards the user can read (their private ones plus all global ones in the workspace), exactly as today.

The split between tiers happens on the **`/boards` page** — the main boards index. At the top of that page is a tabbed pill:

```
[ All (16) ]  [ Global (4) ]  [ My Boards (12) ]
```

Default tab is **All**. Switching tabs filters the grid below. Each board card shows the owner's avatar, last-edited timestamp, and a small chip indicating Global or Private. Sort by last-edited descending across all tabs.

When a board is newly promoted to global, every workspace member sees a one-time toast: "[Author] published a new board: Retention Health." This is the discovery mechanism — without it, global boards exist but no one notices.

---

## How editors propose changes (propose-and-approve)

Editors never push to the live board directly. Every edit lands in their **personal draft** of the board — visible only to them, never to anyone else. When they want their changes to go live, they hit **Submit for review**, which sends them as a single update to the board's owner and admins for approval.

The flow:

1. Editor opens a global board → sees the live view, same as everyone else.
2. They toggle into **My draft** to start editing. Cards, sections, layout, prose, filters — anything they change goes into their personal draft only.
3. They keep editing. Nothing they do is visible to anyone else.
4. When ready, they click **Submit for review**. Their pending changes bundle into one update sent to the owner. Once submitted, it's sent — there is no withdraw, no edit-while-pending. The owner takes it from there.
5. Owner approves → all operations in that update apply to live for everyone, and an entry lands in the changelog.

An editor can have **N pending updates** against the same board at once — each independently reviewable. Multiple editors can have pending updates against the same board concurrently; the queue is per-board, ordered by submission time.

**Owners and admins skip the queue** — their edits apply directly to live since they're the approvers anyway. Every direct edit is logged in the changelog the same way an approved update is.

**Conflict handling (owner-side):** when the owner approves an update that touches the same field as another pending update, the system shows the owner the conflict at review time. The owner decides what to do — approve both in order, approve one and dismiss the other, etc. Editors don't manage conflict resolution.

**Stale updates:** any pending update with no activity after 60 days clears from the queue automatically.

---

## How owners review and approve

Owners and admins discover pending updates through three existing UI surfaces — no notification center, no bell, no new global infra:

- **Sidebar** — boards with pending updates show a count next to the board name in the existing nav: "Product KPIs · 3"
- **Board page** — a "Pending (3)" pill appears in the board header, alongside the existing edit/delete icons
- **`/boards` index** — each board card shows a "3 pending" chip alongside its existing card count and last-edited line

Optional v1.5: a transient toast bottom-left when a new update arrives while the owner is in the app. Skippable for v1 — the badges do the work.

Clicking any of these surfaces opens the **pending queue** for that board: a list of pending updates ordered by submission time, each row showing proposer + auto-generated change summary + timestamp + a conflict warning if applicable.

### The review modal

Click any pending update → a popover modal opens:

- **Title:** "Pending changes from [Sarah]"
- **Subtitle:** timestamp ("submitted 2h ago")
- **Conflict callout** (single line, top): if the update touches the same field as another pending update
- **Operation list**, each row expandable inline to its diff:
  - **Card SQL edit** → inline before/after SQL diff, syntax highlighted
  - **Card add** → rendered preview of the new card
  - **Card delete** → snapshot of what's being removed
  - **Chart type / breakdown change** → before/after mini-chart
  - **Section add / rename / delete / reorder** → before/after section snippet
  - **Prose / title / description edit** → text diff
  - **Layout change** (drags, resizes, span) → before/after thumbnail
  - **Global date filter change** → "30d → 90d"
- **Actions:** [Dismiss]   [Approve]

For destructive approvals (deleting a section that contains cards, deleting more than 3 cards, dropping the SQL the board is anchored on), a one-step inline confirmation appears next to Approve before the operation commits.

### What the actions do

- **Approve** → all operations in the update apply atomically to live. A changelog entry is created (proposer, approver, timestamp, summary). The update clears from the queue.
- **Dismiss** → the update simply clears from the queue. No managed lifecycle, no editor notification, live is untouched.

---

## Ownership transfer

When the original owner of a global board wants to hand it off: they trigger **Transfer Ownership** from the board header and pick a new owner from a list of workspace members. The new named owner inherits all owner capabilities; the previous owner is downgraded to Editor. Workspace admins remain co-owners regardless.

If the original owner leaves the workspace without transferring, **the board does not orphan** — workspace admins are already co-owners and the board continues to function. Admins can name a new explicit owner from the board header, or leave it admin-owned.

For private boards (which have no admin co-owner), departure transfers ownership to a workspace admin by default; the admin can then reassign or archive.

---

## Changelog

Every board has a **History** panel, accessible from the board header. It captures every change that has actually landed on the live board — i.e. every approved update from an editor and every direct edit by an owner or admin. Reverse-chronological, persistent.

Each entry covers:

- Card added, removed, edited (SQL, title, chart type, breakdown)
- Section added, removed, renamed, reordered
- Layout changes (cards moved, resized, span changed)
- Prose / description edits
- Visibility toggled (private ↔ global)
- Role grants
- Ownership transfers
- Global date filter changes

Each entry shows: **proposer**, **approver** (if different), action description, timestamp, and (where useful) a small preview diff of what changed. An approved update with N operations renders as one entry with N lines of detail. Filterable by actor and date range.

Anyone who can read the board can read its history. The changelog is a trust mechanic — editors see what other editors did before they make their own changes; viewers see why a number on the board changed since yesterday.

Pending and dismissed updates do **not** appear in the changelog (they didn't change the live board). They live in the audit log instead.

The History panel is **read-only in v1.** Restore-to-version is v2.

---

## Audit log (admin-only)

Distinct from the per-board changelog above, the **audit log** captures org-level governance events: board deletes, ownership transfers, visibility changes across all boards, admin claim of an orphaned board, role grant changes.

Workspace admins access it from settings. The log captures: actor, action, target board, before/after state, timestamp. Append-only, retained indefinitely.

This is invisible to most users. The changelog is for the team; the audit log is for the day a customer asks "who deleted the QBR board?" and we need a defensible answer.

---

## What this is NOT

- **Not per-card permissions.** Whether a card renders is decided by the SQL/RBAC layer at query time, not by the board layer. A global board is a layout shared with everyone; what each viewer actually sees is filtered by their data permissions.
- **Not real-time collaborative editing.** Two editors can both have the board open, but there's no live cursor presence or operational-transform sync. Last save wins, with a soft conflict notice.
- **Not external sharing.** Public-link sharing ("anyone with this link can view") is out of scope for v1. Global means "global within the workspace," not "global to the internet."
- **Not nested.** Boards-inside-boards (Mixpanel-style nesting) is out of scope. Flat list under Global / My Boards.
- **Not granular per-user grants in v1.** A board is either private (you only) or global (whole workspace). The middle case — "global to me + 3 specific teammates" — is deferred to v2.

---

## Success criteria

- [ ] Owners can promote a private board to global with one action
- [ ] Owners can revert a global board back to private without losing data
- [ ] Global boards appear in every workspace member's sidebar (flat list, unchanged from today)
- [ ] The `/boards` page has a tabbed pill — All / Global / My Boards — with counts on each tab
- [ ] Editors can edit a global board freely in their own personal draft, with no visibility to others
- [ ] Editors must explicitly Submit for review to send their changes to the owner; nothing leaves the draft otherwise
- [ ] Once submitted, an update cannot be withdrawn or edited by the proposer — it's the owner's to act on
- [ ] Editors can have multiple pending updates against the same board simultaneously; each is independently reviewable
- [ ] Owners and admins can edit a global board directly without going through the queue
- [ ] On approval, an update applies to live for everyone and creates a changelog entry
- [ ] When the owner approves a conflicting update, the conflict is surfaced to the owner at review time
- [ ] Owners discover pending updates via three existing surfaces: sidebar count, board header pill, `/boards` index chip — no global notification center required
- [ ] Clicking a pending update opens a popover modal with proposer, change summary, per-operation diffs, and Approve / Dismiss actions
- [ ] Destructive approvals require an inline confirmation before applying
- [ ] Dismiss clears the update from the queue without creating any live change or notification
- [ ] Viewers see the board read-only; their interactions don't persist
- [ ] RBAC-denied cards are silently hidden, not rendered as broken slots
- [ ] Two users opening the same global board can see different sets of cards based on their data access
- [ ] Concurrent edits show a soft conflict notice, not silent overwrites
- [ ] Owner can transfer ownership to another workspace member
- [ ] Workspace admins are automatically co-owners of every global board, with full owner capabilities
- [ ] When a global board's named owner leaves the workspace, the board does not orphan — admins remain owners
- [ ] When a new global board is published, workspace members get a discovery toast
- [ ] Every board has a History panel showing all changes, accessible to anyone who can read the board
- [ ] History entries identify the actor, action, timestamp, and where useful a preview of what changed
- [ ] All visibility / role / ownership changes are logged and queryable by admins via the audit log

