# Inbound agent session — 2026-07-23

Worktree: `.claude/worktrees/remove-language-checker` (branch `chore/remove-language-checker`, HEAD `94316be8`, dev server on **:3002**).

**Outcome: all code written this session was reverted.** Yesterday's language-checker removal and latency work is untouched. What survives is knowledge — the bugs found and the live phone state changed. Read the "Bugs found and still present" section before touching inbound again; every one of them is real and back in the code.

---

## What we were trying to do

Make an inbound call run the same conversation the outbound campaign runs. The caller dialed us instead of us dialing them; everything else should be the same script, same steps, same routing.

Starting point (built the previous session, uncommitted): `InboundBinding` had a per-number free-text `script` and a `verificationRequired` flag, a `set-script` API action, and `buildInboundAgentSystemPrompt` swapped that script into the framing block. No UI called any of it.

## What was built, then reverted

- **Verification rail actually working** — split `IDENTITY & ACCOUNT SAFETY` into two variants so turning the rail off relaxes disclosure instead of only dropping one sentence.
- **`activate` preserving config** — spread `existing` so pause → resume stops wiping the binding.
- **Campaign workflow as the inbound talk-track** — extracted `renderWorkflowStepLines` / `renderWorkflowRoutingLines` from `compileVoiceCampaignScript` so outbound and inbound share one renderer; added `renderInboundWorkflowTalkTrack`. Verified end to end: an 8-node workflow with 12 routing edges rendered into the inbound prompt, start node re-framed for a caller who dialed in, outbound-only call-screening block dropped, workflow handling rules carried over.
- **`scriptSource: "campaign" | "custom" | "none"`** on the binding, resolved in `resolveInboundAgentConfig`.
- **`/phone-numbers` page** + `GET /api/inbound-numbers` — per-number agent, talk-track, verification toggle.
- **Inbound toggle on the campaign config rail** — pick a number, flip a switch.
- **`scripts/inbound-bind.ts`, `scripts/inbound-prompt-preview.ts`** — CLI binding and a dry-run that builds the exact prompt a call would get.
- ~19 tests across `inbound-agent-script.test.ts` and `inbound-agent-binding.test.ts`.

## Bugs found and still present in the retained code

Each was found by making it fail, and each came back with the revert.

1. **`ensureInboundApp` can never re-point after a tunnel change.** It matches the Plivo app by `answer_url`; when the URL changes it matches nothing, falls through to create, and Plivo rejects with `400 — Application with name baby-sentinel-inbound-gemini already exists`. **This means "Pause inbound → Add to Inbound Numbers" in the agent editor is broken** whenever the tunnel URL has moved. Fix is to match by `app_name` and update the URLs in place. `src/lib/plivo-number-binding.ts`.

2. **`activate` drops binding config.** The `deactivate` branch spreads `existing`; `activate` re-lists fields by hand and loses `knowledgeIds`, `script`, `verificationRequired`. A pause → resume cycle silently resets the line. `src/app/api/inbound-agent/route.ts`.

3. **`verificationRequired: false` is a no-op for its stated purpose.** The rail's blanket line — `Never reveal or confirm any account-specific detail (loan balance, EMI, dues, personal data)` — is unconditional. The flag only strips the *following* sentence. A collections script told to confirm an EMI due date is still forbidden from doing so. `src/lib/inbound-agent-prompt.ts:166`.

4. **`activate` never sets `companyName`, so the agent names the wrong brand.** With no company on the binding the agent identifies itself from the knowledge base. Observed live on a Vastu line: *"Main **Piramal Finance** se bol rahi hoon"* — the KB holds Piramal content. Fix: default to `campaign.companyName`.

5. **The UI cannot bind a second number.** `toggleInbound` in `agent-editor.tsx` never sends `number`, so activate always targets `PLIVO_PHONE_NUMBER`. The API already accepts `body.number`; nothing sends one.

6. **`set-script` has no caller.** The action works; no frontend invokes it. Scripts are editable only via `data/inbound-agents.json` or curl.

7. **Agents are persona-keyed, so `agent.primaryCampaignId` is not the bound campaign.** `agentIdForCampaign` folds campaigns by name + voice, so every "Ananya/Aoede" campaign collapses onto `agt_5pqqz8`. Anything reading the campaign off the agent gets whichever campaign won the fold. Both `resolveInboundAgentConfig` and any new read path must prefer `binding.campaignId`. This bit twice today — once in the resolver, once in a read route — and cost a live call running the wrong script.

8. **The agent editor's "Global Prompt" does nothing on an inbound call.** `InboundAgentConfig` has no `systemPrompt` field; inbound behaviour is built entirely in `inbound-agent-prompt.ts`. The editor shows a prompt box that inbound ignores.

9. **Greetings are script-blind.** `buildInboundGreeting` returns the same generic "bataiye, main aapki kaise madad kar sakti hoon?" regardless of the line's purpose, so a collections line opens by inviting the caller to lead and then pivots to dues.

## The silent-call bug — unresolved, not ours

A real call (`vc-in-856464-1784785141358-5oztr`, 05:39 UTC) went silent after the agent's second turn and ran another 20s of a 44s call. The stored latency record:

```
turn 1:  eouProxyMs 12082   voiceToVoiceMs 987   interrupted: TRUE
```

The agent's turn was **interrupted mid-utterance and never recovered**. This is barge-in / speech-mute recovery in the audio runtime, not the prompt. Likely pre-existing — this branch already carries `tests/unit/plivo-gemini-live-speech-mute-recovery.test.ts`, and the 2026-07-18 notes record the OOD filter eating "Ma'am" and echo-boost tuning. The caller here said "**मैडम**, कहां से बोल रहे हो आप?".

Campaign talk-tracks plausibly *expose* it more: a workflow step is a long spoken paragraph where the old one-line script was short, so there is far more utterance for echo to barge into.

Not yet investigated: the bridge recording `bridge-af6fb4bc-50ef-4712-a422-45ef509696d2` under `vastu-hfc/vc_1784723642976_y82v2/`, with channel-RMS forensics, would settle echo-triggered barge-in vs. the mute never lifting.

## Live state changed today — NOT reverted

- **`912264230614`** and **`912264230490`** were moved off Contacto's Default app (`17533417182972564`) onto `baby-sentinel-inbound-gemini` (`11444745363342202`). They still point there.
- That app's `answer_url` was changed from `ether-rebuilt-skewer.ngrok-free.dev` (:3000) to `seventh-reflected-fruits-spring.trycloudflare.com` (:3002). Still there.
- **Nothing is listening on :3000**, so before today's change the number produced a 502 from ngrok — the silent 1-second call.
- `data/inbound-agents.json` (gitignored) holds all three bindings with today's scripts. Original single-binding backup: `scratchpad/inbound-agents.backup.json`.
- `scripts/inbound-bind.ts` is deleted, so the `--release` path is gone; restoring means direct Plivo API calls.

## Useful things learned

- **`VOICE_ALLOW_UNSIGNED_WEBHOOKS=1`** is set locally, so the inbound answer webhook can be driven without a phone call:
  ```
  curl -X POST http://localhost:3002/api/voice/plivo-answer-inbound \
    -H "Host: <tunnel-host>" -H "X-Forwarded-Proto: https" \
    -d "From=919812345678" -d "To=912269870900" -d "CallUUID=test-$(date +%s)"
  ```
  Returns the `<Stream>` XML and mints a callId; 500s if the agent fails to resolve.
- **`/api/dev/agent-login` is broken** — `CURSOR_AGENT_USER_ID` doesn't resolve in this Clerk instance (`failed to mint sign-in token: Not Found`), so authenticated API routes can't be curl'd.
- **`data/` is gitignored**, so binding state never shows in `git status`.
- **Dev server logs weren't capturable** — the process was started outside this session, so debugging had to be reconstructed from stored call records. Start it as `pnpm dev 2>&1 | tee /tmp/dev-3002.log` to avoid that next time.
- Campaign workflows on the bound campaigns: Vastu Home Improvement Follow-up (8 nodes), Recent Disbursal Feedback + Top-Up Review (8), Vastu Active Borrower Welcome (17), Vastu PD Scheduler (16).
- Rendered inbound prompt sizes ran 20k–32k chars with the KB digest included.

## If this is picked up again

The design that worked and was verified: **campaign workflow rendered through a shared renderer, wrapped in inbound framing, with the rails appended on top so a script can't talk the agent past them.** Two deliberate inbound differences — the start node re-framed for a caller who dialed in, and the outbound call-screening/voicemail block dropped.

Order to fix in: #1 and #2 first (they break the existing UI regardless of any new feature), then #7 (wrong-script class of bug), then #4. The silent-call bug is independent and worth settling before any demo.
