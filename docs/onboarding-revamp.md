# Onboarding & Demo Experience Revamp

Status: DRAFT spec, for alignment before build.
Owner: Divyansh. Mode: Builder (real product we own).
Date: 2026-06-18.

---

## 1. Goal & the prospect journey

Today a prospect signs up with a personal email, lands in a generic wizard, and
picks a canned sample dataset. It works, but it feels like a self-serve trial, not
a white-glove enterprise demo.

The revamp turns it into a **guided, personalized, white-glove** experience: the
prospect gets a warm invite from a named person at Actioneer, logs in with
ready-made team credentials, lands on data that looks like *their* business, and
is walked through the product with a short video they can replay anytime.

**Target journey (end to end):**

```
Internal dashboard (us)                Prospect
─────────────────────────              ─────────────────────────
1. Pick company + industry + scale
2. Generate "their" dataset
3. Provision creds + magic link
4. Compose invite (sender, Loom, CC)
5. Send  ───────────────────────────▶  6. Gets warm email "from Divyansh"
                                        7. Clicks magic link → logged in
                                        8. Welcome screen + 90-sec Loom
                                        9. Explores THEIR-looking workspace
                                        10. Re-opens tutorial anytime from nav
```

Plain-language reason for each choice is noted per part below.

---

## 2. The five parts: scope, approach, trade-offs

### Part 1 — Per-prospect synthetic dataset
**What the prospect experiences:** the demo data looks like their own company and
industry, not "GameRamp" or a stranger's app. Reason: people trust and engage
with data that mirrors their world.

**Current state:** 5 handcrafted datasets (presto, vastu-hfc, quickhelp,
fundsindia, healthians), each with a real DuckDB + seeded segments/funnels/
retentions/playbooks/chats (`src/lib/server/*-sample-workspace.ts`,
`src/lib/datasets/*`). Heavy to author from scratch.

**Approaches:**
- **A. Rebrand-an-existing-dataset (recommended first).** Map the prospect to the
  closest existing industry dataset, then override the company name, entity name,
  currency, and labels so it reads as theirs. Cheapest, instant, low risk. The
  numbers are real (from the underlying DuckDB); only the branding changes.
- **B. Parameterized template generation.** Pick an industry template + scale +
  geo and generate a fresh DuckDB (overlaps the `actioneer-demo-data` repo). Most
  faithful, but a real data-engineering effort per prospect.
- **C. LLM-from-description.** Generate from a free-text business description.
  Flexible but slow, non-deterministic, and hard to keep numerically coherent.

**Recommendation:** Ship **A** now (a `prospectBranding` overlay on a chosen base
dataset), keep **B** as the roadmap for industries we don't cover.
**Edge cases:** industry not covered → fall back to the closest base + a note;
company name collisions; keep "Actioneer" branding intact (never expose base
dataset codenames like the old gameramp).

### Part 2 — Provisioned team credentials + internal dashboard
**What the prospect experiences:** no signup friction. They get a working login
(`analysis+acmecorp@actioneer.com` + password) that's clearly "their team's
workspace." Reason: enterprise buyers expect to be set up, not to self-register.

**Current state:** Clerk auth (`src/middleware.ts`), personal-email sign-up,
onboarding writes to Clerk `publicMetadata` via `POST /api/onboarding/complete`.

**Approach:** Stay on Clerk (project rule: don't swap auth). Use the **Clerk
Backend SDK** from a gated internal route to (a) create the user with the
`analysis+company@actioneer.com` email, (b) set an initial password, and (c)
generate a **sign-in token / magic link**. An internal dashboard lists all
provisioned creds (Clerk user list filtered to `analysis+*@actioneer.com`) with
company, who created it, last active, and a "resend link" action.

**Trade-offs:** Clerk-managed (less custom code, MFA/session handling for free)
vs. a homegrown table. Clerk wins. The `+company` alias keeps one real inbox while
giving each prospect a distinct login.
**Edge cases:** who can open the dashboard (gate to an internal-email allowlist in
middleware), password delivery security (show once, never store plaintext), cred
expiry/disable, reusing a cred across multiple prospect contacts.

### Part 3 — Personalized invite email
**What the prospect experiences:** a warm, human email from a specific person at
Actioneer with a Loom, their magic link, and their creds. Reason: a personal
sender + a face on video converts far better than a system email.

**Current state:** email infra exists (`src/lib/twilio-email-client.ts` →
SendGrid; React-Email pattern in `src/lib/server/playbook-output-email.tsx`).
(The generic marketing-email *templates* were removed earlier; the *sending*
plumbing remains.)

**Approach:** A new React-Email invite template + a compose form in the dashboard
with dropdowns/variables: **sender** (Divyansh / Taha / Vivek / Vik), prospect
name + company, **Loom URL**, the generated **magic link**, the **creds**, a
**CC demo-giver** with a personalized one-liner. Preview, then Send via SendGrid,
with a "copy as text" fallback.

**Trade-offs:** send-live vs. preview-and-copy. Offer both; default to preview →
send. **Edge cases:** deliverability on `actioneer.com` (SPF/DKIM must be set),
Loom embed vs. plain link in email clients, magic-link single-use/expiry, do not
leak the password in plaintext if the email is forwarded (consider link-only +
password shown in-app on first login).

### Part 4 — Magic-link landing → welcome + Loom tutorial  ← START HERE
**What the prospect experiences:** clicking the link drops them straight into a
warm welcome with a short Loom tour they can watch or skip, and can replay
anytime. Reason: the first 30 seconds decide whether they explore or bounce.

**Current state:** `src/components/onboarding/welcome-modal.tsx` exists; nav lives
in `src/components/sidebar.tsx`.

**Approach:** On first authenticated landing, show a dismissable welcome
(modal or light full-screen) with an embedded Loom and Skip / Explore actions.
Persist "seen" (Clerk `publicMetadata.tutorialSeen` or local flag) so it does not
re-nag. Add a permanent **Tutorial** entry in the left nav and a slim re-open
**banner** for first-week users. Reuse `welcome-modal.tsx`.

**Trade-offs:** modal (non-disruptive, easy) vs. full-page (more "guided"). Start
with the dismissable modal + nav entry + banner. **Edge cases:** returning users
must not see it again but must be able to reopen; Loom load failure → graceful
text + link fallback; mobile layout.

**Why first:** entirely in this repo, no dependency on the dashboard or email,
highest visible impact for the prospect, fastest to ship.

### Part 5 — Sharper left-nav icons
**What the prospect experiences:** a crisp, coherent icon set. Reason: polish
signals product maturity.

**Current state:** mostly done this session (`src/components/nav-icons.tsx`).
**Approach:** audit coverage for every nav item (All Chats, Metrics, Boards,
Playbooks, Segments, Funnels, Retentions, Voice, Knowledge, + the new Tutorial
entry) and fix any mismatch. Small.

---

## 3. Build order & dependencies

```
Part 4 (welcome + tutorial)   ── no deps ──▶ ship first  (prospect-facing, in-repo)
Part 5 (nav icons)            ── tiny    ──▶ fold in with Part 4 (adds Tutorial icon)
Part 1 (rebrand dataset)      ── overlay ──▶ next (so the invite can point at "their" data)
Part 2 (creds dashboard)      ── enables ──▶ Part 3
Part 3 (invite email)         ── needs 2 ──▶ last (depends on creds + magic link)
```

Rationale: deliver the prospect-visible win first (Parts 4+5), then the
"feels like theirs" data (Part 1), then the internal provisioning + invite
machinery (Parts 2→3) that ties the whole flow together.

---

## 4. File-level task list (first two milestones)

### Milestone 1 — Welcome + Tutorial (Parts 4 + 5)
- [ ] `src/components/onboarding/welcome-modal.tsx` — embed Loom (env-configurable
      URL), Skip / Explore actions, dismissable.
- [ ] Persist seen-state: extend `POST /api/onboarding/complete` (or a small
      `tutorialSeen` flag in Clerk `publicMetadata`); read it in the gate.
- [ ] `src/components/onboarding/onboarding-gate.tsx` — show welcome on first
      authenticated landing only.
- [ ] `src/components/sidebar.tsx` — add a **Tutorial** nav entry that reopens the
      welcome; add a dismissable first-week banner.
- [ ] `src/components/nav-icons.tsx` — add a Tutorial icon; audit the rest.
- [ ] Playwright: magic-link landing shows welcome once; Tutorial nav reopens it.

### Milestone 2 — Rebrand dataset overlay (Part 1, approach A)
- [ ] `prospectBranding` overlay type (company, entityName, currency, label) layered
      over a chosen base dataset in `src/lib/datasets/*`.
- [ ] Resolve branding at read time so labels/entity names render as the prospect's.
- [ ] Setup step to choose base industry + company name.
- [ ] Tests: a rebranded dataset renders the prospect company everywhere, with the
      base numbers intact.

### Milestones 3-4 — Provisioning dashboard (Part 2) then Invite email (Part 3)
- Scoped in detail once Milestones 1-2 land (Clerk Backend SDK user creation +
  sign-in tokens; internal-email-gated `/admin/provision` route; React-Email
  invite template + compose form + SendGrid send).

---

## 6. FINALIZED SPEC — Admin Provisioning Panel (Parts 2 + 3, building now)

Confirmed with owner 2026-06-18. Decisions: no per-prospect rebrand (use the 5
existing datasets as-is); **one or more** industries per prospect (multi-select);
the `analysis+company` address is a **login-only identity** (no inbox); password
is a professional grouped-alphanumeric shown in the email and changeable from the
panel; **Deal Owner is a fixed dropdown** (Taha / Vivek / Divyansh / Vik) whose
`@actioneer.com` address is auto-CC'd and named in the body; email sent from
"Divyansh from Actioneer". Served at `demo.actioneer.com/admin`, restricted to the
six internal people on either `@actioneer.com` or `@gameramp.com`. Panel is
Actioneer-branded and uses Lato.

### What the admin does
Fill a form — Deal Champion (name + email), Deal Owner (team member, name +
email), Company, Industry (one of the 5 datasets), optional CC/BCC — and hit
Generate. The panel then:
1. Creates a Clerk login `analysis+<companyslug>@actioneer.com` + a readable
   password (Clerk Backend SDK `users.createUser`, `skipPasswordChecks`).
2. Sets the prospect's `publicMetadata`: `onboardingComplete: true`,
   `isProspect: true`, `restrictDatasets: true`,
   `selectedSampleDatasets: [industry]`, `orgName: company`.
3. Mints a 48h sign-in token → magic link `…/auth/agent-consume?ticket=<token>`.
4. Stores a record in the new `provisioned_creds` SQLite table.
5. Renders + sends the invite email (SendGrid, from "Divyansh from Actioneer",
   to champion, CC deal owner + extras). Email failure does NOT fail provisioning
   — the cred is saved and flagged so the admin can resend/copy.

### Workspace restriction (plain-language)
Prospect accounts carry `restrictDatasets: true`, so `/api/datasets` shows them
ONLY their one industry. Existing internal/team accounts have no such flag and are
untouched (still see all 5). This is presentation-level focus, not a data guard —
the demo data is synthetic, so there's nothing real to leak; we don't pay for a
per-request identity check on fake data.

### Authorization (plain-language)
Only `taha@, sashank@, indresh@, vivek@, divyansh@, vimarsh@ actioneer.com` can
open the panel or call its APIs. Enforced server-side via `requireAdmin()` (reads
the signed-in user's real email through the Clerk Backend SDK) in the `/admin`
page and every `/api/admin/*` route — so it can't be bypassed by crafting a
request. Those 6 accounts are Google Workspace logins, so "Google-only" falls out
of the allowlist; no separate admin login screen is built.

### Files
New: `src/lib/admin-allowlist.ts`, `src/lib/server/provision-utils.ts`,
`src/lib/server/require-admin.ts`, `src/lib/server/provisioned-creds-repo.ts`,
`src/lib/server/invite-email.tsx`, `src/app/api/admin/provision/route.ts`,
`src/app/api/admin/creds/route.ts`, `src/app/api/admin/creds/[id]/route.ts`,
`src/app/admin/page.tsx`, `src/app/admin/admin-panel.tsx`.
Modified (surgical): `src/lib/meta-db.ts` (v11 table), `src/lib/datasets/index.ts`
(+restrictToSelected), `src/app/api/datasets/route.ts` (read flag),
`src/lib/twilio-email-client.ts` (+cc/bcc/fromName),
`src/app/auth/agent-consume/page.tsx` (neutral copy).

### Trade-off noted: demo password is stored plaintext
The panel shows the current password (so the admin can share it and reflect
changes), which means storing it in our own SQLite behind the admin allowlist.
Acceptable here because the credential guards only synthetic demo data and is
meant to be shared. Not a pattern for real user passwords.

---

## 5. Open questions to settle before Milestone 1
1. **Loom**: one evergreen tour video, or per-industry? (Start: one, env-configurable.)
2. **Welcome surface**: dismissable modal (recommended) vs. full-page?
3. **Tutorial nav placement**: top of nav, or pinned at the bottom near Account?
4. **Banner lifetime**: first session only, first 7 days, or until dismissed?
