# Voice Campaign Capability Loop — Demo Script

**Run:** kyc-450-2026-06-09 · **Page:** `/voice-campaign-insights` · **Audience:** Indian FS buyers (FundsIndia / HDFC Credit / TVS / DCB Niyo / Healthians)

## One-line thesis to open and close on

> "Giga turns conversations into recommendations. Actioneer turns conversations
> into **measured outcomes** — because it sits on your data, and because the
> agent can only act with your signed permission."

## Pre-flight (do this before the room is watching)

1. Dev server up; signed in. Page loads at the headline.
2. **Reset to a clean slate:** control bar → `Reset` → `Reset outcomes`. (If no
   control bar is showing, there's no journey state — you're already clean.)
   Reset preserves the tuned `profiles.json`; it only clears dispatches/outcomes.
3. Click the "atak gaya" cluster and confirm its cohort panel shows the
   proposed move (~22 of 52 to KYC done, Awaiting approval).
4. Scroll back to top.

## The arc (≈4 minutes)

**Beat 1 — The readout (15s).** Land on the headline: *"Most KYC non-completion
is recoverable journey friction, not outright refusal."* 450 calls, four lanes.
"This is a finished campaign. Most demos stop here — a dashboard. Watch what
happens next."

**Beat 2 — The map (30s).** Point at the lane strip: Wrong number / No connect /
Busy-decline / **Recoverable blockers (229, 51%)**. "Half the failures are
recoverable. Click into them." Click **Recoverable blockers** → the embedding
map opens, every call a dot. "Each dot is one real call, positioned by what the
customer actually said. These sub-zones — 'atak gaya at document upload',
'selfie permission', 'name mismatch' — are discovered, not configured."

**Beat 3 — The turn: the proposed move (45s).** Click the *"Try kiya tha,
beech mein atak gaya"* cluster. Its cohort panel now carries a **Proposed
move** card. "Here's the shift. For every cohort, the model assessed what
would move its users to the next bucket — and the agent is **asking its
operator for the lever**, backed by cohort evidence, never a single call.
Click around: stuck cohorts get a link, no-connects get smart redial,
mismatches get a human, dead ends get suppressed — each with its own
guardrails." Read this cohort's card aloud:

> *"52 calls in 'Try kiya tha, beech mein atak gaya — baad mein karunga' are
> stuck mid-journey — send_kyc_link would move ~22 of them to KYC done."*

Point at the excerpts — *"mujhe doubt tha data safe rahega na"*. "That's the
vishing-distrust fear, in the customer's words. The agent wants to send an
official link, live, to answer it. Projected: ~22 of the 52 moved to KYC done."

**Beat 4 — The governance moment (30s).** Click **Grant capability**. Stop on
the dialog. "This is the whole pitch for a regulated buyer. The grant is
**scoped to this cluster, template-locked, rate-limited, expires after one
wave, audit-logged.** The agent cannot widen this. It cannot pick the template.
It cannot send to a different number. Governance is the feature." Click **Grant
& run wave**.

**Beat 5 — Outcomes move (45s).** Scroll to the control bar. "The grant just
authorized a second wave — the agent is re-calling those 52 with the tool in
hand." The KYC-completed counter climbs, the funnel fills (sent → delivered → clicked → KYC
done), dots ring then go solid. Grab the scrubber: "This is 72 hours compressed.
Drag it — every outcome is real-time-derived from an event log; nothing is
faked frame to frame." Point at the lift line: **completion vs 0% holdout (+40
pts)**. "We held out 10% as a control, so the lift is honest — that's the number
your CFO trusts."

**Beat 6 — The refusal path (20s).** Back to the rail. On a second card, click
**Reject**, type a reason ("script fix first, not more sends"), confirm. Card
collapses to an audit line. "Approval isn't rubber-stamp. Reject is first-class
and logged. The agent comes back only with new evidence."

**Beat 7 — Close on production (15s).** "Today this is simulated. In production
the grant becomes the function declaration on the live Plivo↔Gemini call; the
send is one SMS or WhatsApp template; completion is **joined from your
warehouse**, not self-reported. Same screen, three adapters swapped." Return to
the thesis line.

## If asked "how is this real?" — the receipts

- **The link:** one URL, opens the app if installed (Universal/App Links) else
  web; the customer's phone decides, not us.
- **The tool call carries no customer data** — the session is already bound to
  the investor; the model decides *when*, the server decides *what and to whom*.
  (Spec: Production contract § tool-call information rule.)
- **Outcome = client's data.** Completion is a join against their event stream
  inside the horizon — the moat Giga doesn't have.
- **Other objectives:** reactivation (`sip_resumed`), feedback (Healthians,
  event-triggered stream), fraud verification — same loop, config swap. Full
  detail in `2026-06-11-voice-campaign-capability-requests-design.md`.

## Knobs (all in `data/voice-simulation-runs/kyc-450-2026-06-09/journey/profiles.json`)

- `clusterCapabilities` — per-cohort lever overrides (cluster_07/cluster_10 →
  route_human); unmapped cohorts infer their lever from the outcome mix, so
  "stop calling me" cohorts propose **suppress**, never a link — restraint
  worth narrating if asked.
- `wave2.clusters.cluster_02` — the distrust cluster's uplift, the planted story.
- Edit and reload; no code change, no rebuild.

## Footguns

- **Two "Reset" controls** — the control-bar trigger and the dialog confirm
  ("Reset outcomes"). Click the trigger first, then the dialog button.
- **Welcome modal** ("Start Exploring") may appear on first load — dismiss before
  presenting.
- **Single grant → 5 holdout**, right at the ≥5 lift-display threshold. If you
  want a chunkier lift number on stage, grant two requests (pools the holdout).
- **Demo must run where the run data lives** (`data/voice-simulation-runs/...`,
  gitignored) and the journey dir must be writable. Confirm it's local, or seed
  the deployed env first.
