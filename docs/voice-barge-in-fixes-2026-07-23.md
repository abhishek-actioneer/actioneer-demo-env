# Voice barge-in + first-utterance fixes — 2026-07-23

Worktree: `.claude/worktrees/remove-language-checker` (branch `chore/remove-language-checker`, dev server on **:3002**, cloudflared tunnel `seventh-reflected-fruits-spring.trycloudflare.com`).

**Outcome: two live-call defects fixed and committed locally as `1df9adef`. Not pushed.** That commit also lands ~47 files of previously uncommitted branch work (language-checker / Spanish-guard removal, turn-latency instrumentation, the inbound-agent session notes).

---

## The symptoms, in the client's words

1. "Barge-in is not working" — talking over the agent did nothing.
2. "The agent doesn't capture my first message ever, until I shout 2-3 times. Then it works fine."

Both are real, both reproduced on every call, and they are **independent bugs** that happen to fire in the same window right after the greeting.

## How they were diagnosed

There was no dev-server log — the server had been started outside a capturable session. Everything below was reconstructed from the session dumps in `data/voice-callback-dumps/plivo-gemini-live-session/*.json`, which record a timestamped event stream per call. **The console does not print the OOD / ambient-drop events; only the dumps have them.** Start the server as

```bash
cd .claude/worktrees/remove-language-checker && PORT=3002 pnpm dev 2>&1 | tee /tmp/dev-3002.log
```

so both sources exist next time.

Decisive timeline, call `vc-test-1784788099176-uotur`:

```
 8.44  model_audio_interrupted  reason:"ambient_noise_low_signal" text:"" phase:"flush"  ← drop guard ARMED
 8.46  transcript.assistant     (greeting finally committed)
 8.53  ...caller talking, nothing registers for 9 seconds...
17.60  awaiting_customer_cleared
17.86  activity_start
19.12  model_audio_drop_guard_cleared  previousDropReason:"ambient_noise"                 ← held 10.7s
```

`eou_proxy_ms: 17954` on turn 1. Note `voice_to_voice_ms: 1554` — once the words landed the agent answered in 1.5s. Nothing was ever slow; the audio simply never arrived.

## Bug 1 — barge-in dead for ~10s after every greeting

At the end of the opening turn, `flushPendingUserTranscript()` runs with an **empty** pending transcript. `isLowSignalTranscript("")` is true, so it calls `suppressAmbientFalseReply("ambient_noise_low_signal", …)` → `interruptCurrentModelAudio()` → sets `dropModelAudioUntilTurnComplete`.

`localBargeInAllowedNow()` (`plivo-gemini-live-barge-in.ts`) returns **false** whenever that guard is set. So barge-in is hard-disabled for as long as it holds.

The two protections in `shouldArmAmbientModelAudioDrop` that exist to prevent exactly this both failed, purely on **ordering** — the flush fires ~20ms *before* `turn_complete`:

- `awaitingCustomer` was still `false` (`markOpeningTurnComplete()` hadn't run)
- `lastAssistantText` was still `""` (greeting not yet committed), so `lastAssistantAskedQuestion()` could not see the "क्या मेरी बात … हो रही है?" question mark

**Fix** (`plivo-gemini-live-transcript-guards.ts`): bail out when no assistant turn has been committed yet.

```ts
if (!params.lastAssistantText?.trim()) return false;
```

Before any assistant turn exists we are still inside the opening line, where an ambient drop can never be correct. Deliberately narrow: **every mid-call ambient drop behaves exactly as before**, so anti-babble protection against TV/background noise is untouched. Suppressing the drop for *all* empty transcripts was considered and rejected — it would weaken real mid-call noise suppression.

## Bug 2 — the caller's first utterance never reaches Gemini

`awaitingCustomerResponse` is armed once, by `markOpeningTurnComplete()`. While set, it lowers every VAD threshold by `AWAITING_CUSTOMER_VAD_SENSITIVITY` (0.6) — RMS 2400→1440, peak 6500→3900 — precisely so a quiet, phone-at-distance first answer is audible.

In `handleLocalBargeInVad`, the first frame to cross that *lowered* bar immediately called `releaseAwaitingCustomerResponse()`, restoring the strict bar. But opening the Gemini window needs `ACTIVITY_START_MIN_SPEECH_FRAMES` (4) **consecutive** speech frames, and `activitySpeechFrames` reset to 0 on any non-speech frame. Frame 1 passed at the sensitive bar and set the counter to 1; frames 2-4 were judged at the strict bar, failed, and reset it. The counter never reached 4.

Because `automaticActivityDetection` is disabled (local VAD owns turn boundaries) and audio only flows inside `activityStart → activityEnd`, no window means **Gemini never receives the audio at all** — not "hears and ignores". The only escape is 4 consecutive frames over the strict bar, i.e. shouting.

This is why it is *always* the first message: the self-disabling boost is only ever armed for that one utterance.

**Fix** (`plivo-gemini-live-barge-in.ts`, 3 edits):
- release moved out of the energetic-frame path and into `signalActivityStart()`, so the boost survives until it has done its job. This mirrors `notifySileroSpeechStart()`, which already released only *after* `signalActivityStart` — the amplitude path was the outlier.
- `activitySpeechFrames` now decays by 1 instead of hard-resetting, so one flickering frame during a soft onset cannot wipe the run-up.

## Verification

- 1328/1328 unit tests pass, 0 type errors in `src/`.
- The one `seed-content.test.ts` failure seen mid-session is a pre-existing 5s timeout under parallel load — passes standalone, on both the changed and unchanged tree.

On the next call, look for:
- **no** `model_audio_interrupted reason=ambient_noise_low_signal` just before `turn complete` — expect `noise_cleared_without_audio_drop` instead
- `activityStart` within a few hundred ms of the caller speaking, not 9s
- `eou_proxy_ms` on turn 1 near the actual utterance length, not ~18000
- interrupting the agent mid-sentence actually cuts it

## Open / not fixed

- **`GET /api/funnels 200 in 44s` and `GET /api/segments 200 in 47s`** — heavy DuckDB queries in the *same Node process* as the media-stream WebSocket. Not proven to harm audio and not the cause of either bug above, but a 44s render alongside real-time audio is an unmeasured risk. Practical demo mitigation: **close browser tabs on `/funnels`, `/explore`, `/segments` before dialling** — those pages poll and nothing else triggers those queries. Proper next step: measure event-loop lag during one of those requests.
- **The OOD filter still eats short utterances.** `isOutOfDomainTranscript` discards ≤3 words / <22 chars unless a reply-signal regex matches, and that regex has no greetings or attention-getters — `"Hello"`, `"Hallo"`, `"मैडम"`, `"मेरे को"` are all classified as noise. The 2026-07-18 "Ma'am" exemption was never committed (`git log -S` across all branches finds nothing). This cost ~12s on the inbound calls from earlier today and is still live.
- **The drop guard is sticky.** Once `activeDropReason` is set, new caller speech hits `interrupt_ignored_existing_drop_guard` rather than clearing it, so speaking again genuinely does not help — recovery comes only from the 3.5s mute-probe timeout. Bug 1 removes the most common way it gets armed, but the stickiness itself remains.
- The inbound-agent bug list in `docs/inbound-agent-session-2026-07-23.md` is untouched and still accurate.

## Process note

The Bug 2 fix was written, reverted at the user's request ("back to the point where we stripped everything for latency"), then re-applied after the next call reproduced the symptom. The revert was done by reverse-applying the three hunks by hand rather than `git checkout`, because that file also carried the branch's uncommitted latency work — a checkout would have destroyed it. Worth remembering: **on this branch, `git checkout <file>` is dangerous** until everything is committed. As of `1df9adef` it is.
