# Voice call state — demo night 2026-07-18

Context blurb for the call-audio situation as of the pre-demo push (written ~02:35 UTC Jul 18 / ~08:05 IST). Two **separate** problems were in play; one is fixed, one is external and mitigated.

## Where things run

- **Staging**: `baby-sentinel-staging.up.railway.app`, auto-deploys from `fix/voice-gemini-live-turn-ownership` (Railway project `brave-cat`, service `baby-sentinel`, env `staging`).
  - `staging-pull` was force-pushed over that branch (user-approved overwrite). Two remote-only commits were discarded, recoverable by SHA: `693a769` (CampaignConfigPanel context props, PR #122), `abc4c23` (context & persona UI).
  - `BROWSERBASE_API_KEY` set on staging (fixes "The website scraper is not configured" in Create Website Source; the crawler reads only this one var — `knowledge-website-crawler.ts:176`).
  - Deployed head at demo time: `9e0e0d5` (semantic-trap fix, below).
- **Local**: `tsx server.ts` on :3000 (manual restart required for server-side changes), tunneled by ngrok `ether-rebuilt-skewer.ngrok-free.dev` (note: ngrok was repointed from Actioneer's 3001 to 3000 this night).

## Problem 1 — local calls completely silent, both directions (UNRESOLVED, external)

- Calls at 05:31 and 05:51 IST were healthy two-way conversations. **Every call from 07:03 IST onward was dead air**: user hears nothing, agent hears nothing. Clean cutover, not intermittent.
- Forensics (S3 bridge recordings, stereo 8 kHz: LEFT=caller, RIGHT=agent, outbound written at socket-send time):
  - Agent greeting **present** in the right channel of every dead call → our pipeline emitted audio into the connected Plivo stream correctly.
  - Caller channel **pure digital zero** (not mic noise) for entire dead calls → caller RTP never reached Plivo either.
- Ruled out: tunnel (same ngrok URL on good and dead calls), answer XML (identical, `bidirectional="true"`), server restart (dead call preceded it), prod sharing the number (Plivo CDR list shows only local's calls), Bluetooth (user confirmed none), our code (staging calls at 02:24 UTC had working caller audio with the same pipeline).
- Conclusion: audio dies between Plivo's media gateway and the handset (+91 99818 56464). Suspects: handset VoLTE audio path wedged after ~20 h of rapid test calls, or Plivo carrier route degradation starting ~07:00 IST.
- Mitigation: airplane-mode toggle / reboot handset; else test to a different handset to split handset-vs-route. Not yet confirmed which.
- Forensics recipe that worked: storage key from `data/voice-campaigns.json → call.bridgeRecording.storageKey`, fetch from `s3://sentinel-voice-recordings-dev/voice-recordings/<key>` (creds in `.env.local`), per-second channel RMS via python `wave`.

## Problem 2 — agent goes silent mid-call after semantic trap (FIXED, `9e0e0d5`)

- Staging call `vc-test-1784341499503-c6pgg` (02:25 UTC): caller gave the core collections objection ("month salary nahin aayi hai to isliye payment nahin") → `high_stakes_confirm` trap fired **in the same instant** the agent's turn completed (`turn complete audioChunks=83`).
- Bug: `interruptForTrap` (`plivo-gemini-live-semantic-controller.ts`) armed drop-model-audio-until-turn-complete unconditionally. With no turn in flight, the armed gate swallowed the **next** turn — the trap's own instructed confirmation ("Confirm kariye — haan aage badhaun…"). Log signature: `dropped 15 model audio chunk(s) during semantic_trap` → `dropped model turn after semantic_trap`.
- Cascade: caller says "hello?" into the silence → VAD speech with no transcript → `dropped model turn after interrupt` → `customer-speech-mute` eats 18 more chunks → `customer-speech-mute timed out — forcing answer (no transcript)` → caller hangs up. Agent never spoke again after the trap.
- Fix: gate the drop on a model turn actually being in flight (`assistantTurnStartMs !== undefined`; set on first audio chunk of a turn, cleared on every turn-complete path). `clearPlivoAudio()` still always runs (queued frames of a finished turn may still be playing on the phone). Mid-speech trap behavior unchanged.
- Known cosmetic edge: if Gemini streams an unrequested continuation before the confirmation instruction lands, it now plays (old code accidentally muted it) — one extra sentence, strictly better than silence.

## Also shipped this session

- `c862ac8` — script-only campaigns (script-first live tests, pre-workflow records) get a workflow synthesized from the script on load (`bootstrapWorkflowFromScript`), arming the Script↔Workflow sync that previously never engaged for them. Unit-tested incl. round-trip fingerprint stability.

## Open items

- Confirm handset-vs-Plivo-route for Problem 1 (airplane toggle → retest; then different handset).
- Verify the trap fix on a live staging call with the salary objection (deploy was BUILDING at 02:30 UTC).
- Railway MCP token expired (`railway login` session works via CLI); re-auth if MCP tooling is wanted.
- Pre-existing type error in `tests/unit/voice-call-disconnect.test.ts` (VoiceCampaign cast) — untouched, still there.
