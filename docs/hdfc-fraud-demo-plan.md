# HDFC Credit Fraud Demo — Build Plan
**Demo: Friday | Today: Tuesday June 17**

---

## The Pitch (Two Sentences)

89.6% of HDFC's 32,857 alerts are false positives. 107 customers confirmed "yes I made this purchase" via IVR — but it was confirmed fraud anyway. ₹37L slipped through press-1 confirmation because a coached response sounds identical to a genuine one.

Actioneer's voice agent verifies the specific transaction (merchant, amount, city), detects coached responses through conversation signals, and blocks or clears in the same call.

---

## The Demo — 3 Calls

| # | Hero Case | Customer | Scenario | Delivery |
|---|---|---|---|---|
| Call 1 | H3 — OTP Social Engineering | CUST_ae491c0cfa | Tax-season vishing. ₹74,999 Croma e-com. Customer coached to say yes. Agent detects → escalates. | Pre-recorded |
| Call 2 | H2 — Geo-impossible | CUST_aff442bd32 | Mumbai POS → Dubai electronics ₹1.2L in 22 min. Customer denies → card blocked in-call. | Pre-recorded |
| Call 3 | H6 — HNI Traveller | CUST_c44c32e3ea | Singapore hotel ₹2.1L. Genuine customer who travelled. Agent verifies → clears. | Live call |

---

## Dataset Status

### DuckDB: `data/datasets/hdfc-creditfraud/hdfc-creditfraud.duckdb`

| Table | Rows | Status |
|---|---|---|
| transactions | 1,928,413 | ✅ existing |
| fraud_alerts | 32,857 | ✅ existing |
| customers | 5,000 | ✅ existing (needs demo_phone column) |
| cards | 6,492 | ✅ existing |
| merchants | 2,512 | ✅ existing |
| fraud_episodes | 382 | ✅ existing |
| blocking_actions | 1,388 | ✅ existing |
| case_resolutions | 1,594 | ✅ existing |
| hero_case_index | 15 | ✅ existing |
| calendar_events | 28 | ✅ replaced with FIXED version |
| analyst_roster | 25 | ✅ ingested June 17 |
| benchmarks | 5 | ✅ ingested June 17 |
| device_intelligence | 3,142 | ✅ ingested June 17 |
| fraud_rules | 10 | ✅ ingested June 17 |
| voice_verification_calls | 0 (grows with calls) | ✅ created June 17 |

### Key Numbers From Data

- **₹47.4L** total analyst cost on alerts (Night: ₹20.4L, Evening: ₹16.9L, Day: ₹10.2L)
- **~₹42L** of that spent on false-positive alerts (89.6% FP rate)
- **107 coerced confirmations** via IVR — ₹37,12,898 lost
- **DEV_F68da08b** — mule device, 23 customers, 39 fraud transactions
- AMOUNT_DEVIATION rule: 19,131 alerts, 90.3% false positive rate

### Fraud Rules Summary (for demo narrative)

| Rule | Alerts | FP Rate | Action |
|---|---|---|---|
| AMOUNT_DEVIATION | 19,131 | 90.3% | retune |
| MCC_ANOMALY | 5,799 | 92.8% | retune |
| NIGHT_ANOMALY | 3,889 | 93.6% | keep |
| GEO_IMPOSSIBLE | 2,854 | 72.5% | keep |
| VELOCITY | 1,171 | 42.5% | tighten |
| CARD_TESTING_PATTERN | 376 | 30.3% | keep |

### Industry Benchmarks

| Metric | HDFC | Industry | Position |
|---|---|---|---|
| Fraud transaction rate % | 0.114 | 0.09 | ⚠ worse |
| Alert false-positive share % | 89.6 | 84.0 | ⚠ worse |
| Net fraud loss / attempted % | 32.0 | 38.0 | ✅ better |
| SLA breach rate % | 4.3 | 6.5 | ✅ better |
| False-decline (insult) rate % | 0.3 | 0.45 | ✅ better |

---

## Step-by-Step Build

---

### Step 1 — Demo phone numbers (Tuesday, 30 min)
**File:** Direct DuckDB write

```sql
ALTER TABLE customers ADD COLUMN demo_phone VARCHAR;
UPDATE customers SET demo_phone = '+91XXXXXXXXXX' 
  WHERE customer_id = 'CUST_ae491c0cfa';  -- H3, your phone
UPDATE customers SET demo_phone = '+91XXXXXXXXXX' 
  WHERE customer_id = 'CUST_aff442bd32';  -- H2, team phone 1
UPDATE customers SET demo_phone = '+91XXXXXXXXXX' 
  WHERE customer_id = 'CUST_c44c32e3ea';  -- H6, team phone 2
```

---

### Step 2 — `fraud_call_context` view (Tuesday, 30 min)
**File:** Direct DuckDB write

Single query the voice agent runs at call-initiation time.

```sql
CREATE OR REPLACE VIEW fraud_call_context AS
SELECT
  fa.alert_id, fa.severity, fa.trigger_reasons, fa.risk_score,
  t.txn_id, t.amount_inr, t.txn_city, t.txn_ts,
  t.channel, t.auth_method, t.device_id,
  m.merchant_name, m.category as merchant_category,
  c.customer_id, c.full_name, c.city as home_city, c.state,
  c.segment, c.repeat_fraud_victim_flag, c.demo_phone,
  ca.masked_pan, ca.card_tier, ca.network, ca.product,
  fe.typology,
  d.device_risk_tier, d.shared_device_flag, d.device_risk_score,
  fr.rule_description as trigger_rule_description,
  fr.false_positive_share_pct as rule_fp_rate
FROM fraud_alerts fa
JOIN transactions t ON fa.txn_id = t.txn_id
JOIN merchants m ON t.merchant_id = m.merchant_id
JOIN customers c ON fa.customer_id = c.customer_id
JOIN cards ca ON t.card_id = ca.card_id
LEFT JOIN fraud_episodes fe ON fa.fraud_episode_id = fe.episode_id
LEFT JOIN device_intelligence d ON t.device_id = d.device_id
LEFT JOIN fraud_rules fr ON fa.trigger_reasons LIKE '%' || fr.trigger_reason || '%'
WHERE fa.severity IN ('HIGH', 'CRITICAL');
```

---

### Step 3 — Fraud verification system prompt (Tuesday–Wednesday, 3 hours)
**File:** `src/lib/prompts/fraud-verification.ts` (new)

Function signature: `buildFraudVerificationPrompt(ctx: FraudCallContext): string`

Prompt sections:
1. **Agent identity** — "You are Priya, HDFC Bank fraud prevention team"
2. **Transaction under review** — merchant name, amount, city, time, card last 4, channel, auth method
3. **Private context** (not spoken) — home city vs txn city, device risk tier + shared flag, trigger rule + FP rate, repeat victim flag
4. **Verification flow**:
   - Confirm → ask one follow-up (city or what they bought) → match → `clear_transaction()`
   - Confirm → follow-up fails → `escalate_to_specialist()`
   - Denial → `block_card()` → scam-awareness check
5. **Duress detection** — voice onset > 1s, just "haan" with no elaboration, can't name merchant/city, mentions being told what to say → `escalate_to_specialist()`
6. **Language** — Hindi/Hinglish default, mirror customer's language per turn
7. **Bot disclosure** — if asked "are you AI?" → confirm, never deny
8. **Call close** — on terminal outcome, one line then silence

---

### Step 4 — API route for fraud calls (Wednesday, 2 hours)
**File:** `src/app/api/voice-campaigns/fraud-verify/route.ts` (new)

```
POST /api/voice-campaigns/fraud-verify
Body: { alertId: string, phone?: string }
```

Flow:
1. Query `fraud_call_context WHERE alert_id = alertId`
2. Build prompt via `buildFraudVerificationPrompt(ctx)`
3. `storeCallConfig(callId, { prompt, bridgeType: "deepgram-tts", fraudAlertId: alertId, customerId, amountAtRisk })`
4. `initiateVoiceCall(phone ?? ctx.demo_phone, callId)`
5. Return `{ callId, status: "calling" }`

---

### Step 5 — Gemini tools in Deepgram bridge (Wednesday, 3 hours)
**File:** `src/lib/plivo-deepgram-tts-bridge.ts` (extend)

Three tools injected into the LLM context for fraud calls:

```typescript
const FRAUD_TOOLS = [
  {
    name: "clear_transaction",
    description: "Customer confirmed AND passed verification. Approve the transaction.",
    parameters: {
      verification_method: "string",  // merchant_name | city | amount
      customer_statement: "string"
    }
  },
  {
    name: "block_card",
    description: "Customer denied OR fraud confirmed. Block the card immediately.",
    parameters: {
      reason: "string",               // customer_denied | failed_verification
      run_scam_awareness: "boolean"
    }
  },
  {
    name: "escalate_to_specialist",
    description: "Coached response suspected or customer uncertain. Do not clear.",
    parameters: {
      reason: "string",
      duress_signals: "string"
    }
  }
]
```

When Gemini invokes a tool: log to `pendingFraudToolCalls` map keyed by `callId`. Consumed in post-call handler.

---

### Step 6 — Post-call analysis (Wednesday, 2 hours)
**File:** `src/app/api/voice/plivo-status/route.ts` (extend)

After existing status update, if `callConfig.fraudAlertId` exists, run transcript analysis:

```typescript
// All pure TypeScript — no Python, no ML
const voiceOnsetMs = computeVoiceOnset(agentTurns, customerTurns)
// gap between agent utterance end and customer utterance start (ms)

const elaborationRatio = computeElaboration(agentTurns, customerTurns)
// customer word count / agent word count per turn pair, averaged

const echoScore = computeEchoScore(agentTurns, customerTurns)
// word overlap between agent's last utterance and customer's response

const duressScore = Math.min(
  (voiceOnsetMs > 800  ? 0.30 : 0) +
  (echoScore > 0.75    ? 0.30 : 0) +
  (elaborationRatio < 0.25 ? 0.25 : 0) +
  (voiceOnsetMs > 1200 ? 0.15 : 0),
  1.0
)
```

Write result to `voice_verification_calls` in DuckDB.

---

### Step 7 — Fraud alert queue page (Thursday AM, 3 hours)
**File:** `src/app/fraud-alerts/page.tsx` (new)

Table of HIGH/CRITICAL alerts. 3 hero cases pinned at top.

Columns:
- Customer name + segment
- Amount + merchant
- Trigger reason (plain text from fraud_rules)
- Home city → Txn city (show mismatch visually)
- Device risk tier chip
- Voice status: `Pending` / `Cleared ✓` / `Blocked` / `Escalated ⚠`
- [Call Now] button

**Call Now modal** (inline):
- Transaction summary
- Customer name + home city vs txn city
- Phone field (pre-filled from `demo_phone`, editable)
- [Launch Call] → POST `/api/voice-campaigns/fraud-verify`
- After launch: show call status polling

---

### Step 8 — Call detail screen (Thursday PM, 2 hours)
**File:** `src/app/fraud-alerts/calls/[callId]/page.tsx` (new)

Three sections:

**Outcome banner**
```
ESCALATED TO SPECIALIST
₹74,999 · CROMA · Mumbai  |  Duration: 2m 14s
```

**Signal analysis**
```
Voice onset time     1,340ms    ⚠  (normal: 200–400ms)
Elaboration ratio    0.18       ⚠  (natural: > 0.5)
Echo score           0.81       ⚠  (verbatim repeat of agent)
──────────────────────────────────────────
Duress score         0.83 / 1.0
Recommendation       ESCALATE
```

**Transcript**
Turn-by-turn, agent vs customer. Flag turns with high onset time or low elaboration.

---

### Step 9 — Pre-record 2 calls (Thursday evening, 2 hours)

**H3 — Coached victim (Call 1)**
Team member plays victim who was vished. Script:
- Long pause (1.5s) before "haan"
- Says "haan maine kiya" — nothing more
- Agent asks "CROMA mein kya liya tha?" → another long pause → vague answer
- Agent escalates
- Expected: duress_score ~0.80, recommendation: escalate

**H2 — Clear denial (Call 2)**
Team member plays genuine victim:
- "Nahi nahi yeh mera nahi hai bilkul"
- Can confirm they were in Mumbai all day, not Dubai
- Agent blocks card, runs scam awareness
- Expected: duress_score ~0.05, recommendation: block

After recording: manually compute transcript features, insert rows into `voice_verification_calls`.

---

### Step 10 — Rehearsal (Thursday evening, 30 min)

Run full demo flow:
1. Open `/fraud-alerts` — 3 hero cases visible at top
2. Click into H3 → show pre-recorded call detail (escalated, signals visible)
3. Click into H2 → show pre-recorded call detail (blocked)
4. Click "Call Now" on H6 → dial your phone → answer as genuine traveller
5. Say: *"Haan main Singapore mein tha, hotel ke liye payment kiya tha"*
6. Agent clears → call ends
7. Refresh page → H6 shows "Cleared ✓"
8. Open H6 call detail → show low duress score, clean signals

---

## File Map

| Step | File | Status |
|---|---|---|
| Demo phones | DuckDB UPDATE | ⬜ todo |
| fraud_call_context view | DuckDB CREATE VIEW | ⬜ todo |
| Fraud prompt | `src/lib/prompts/fraud-verification.ts` | ⬜ todo |
| API route | `src/app/api/voice-campaigns/fraud-verify/route.ts` | ⬜ todo |
| Gemini tools | `src/lib/plivo-deepgram-tts-bridge.ts` | ⬜ todo |
| Post-call analysis | `src/app/api/voice/plivo-status/route.ts` | ⬜ todo |
| Alert queue page | `src/app/fraud-alerts/page.tsx` | ⬜ todo |
| Call detail screen | `src/app/fraud-alerts/calls/[callId]/page.tsx` | ⬜ todo |
| Pre-record + seed | DuckDB INSERT | ⬜ todo |

---

## Timeline

| Day | Tasks |
|---|---|
| **Tuesday** | Steps 1–3: phone numbers, view, start prompt |
| **Wednesday** | Steps 3–6: finish prompt, API route, tools, post-call analysis. Test real call. |
| **Thursday AM** | Step 7: alert queue page + Call Now modal |
| **Thursday PM** | Step 8: call detail screen |
| **Thursday Eve** | Steps 9–10: pre-record 2 calls, seed data, full rehearsal |
| **Friday** | Demo |

---

## What's Explicitly Out of Scope for Friday

- Python microservice (transcript features in TypeScript only)
- IP intelligence table
- Semantic features (sentence-transformers)
- Pagination / filtering on alert queue
- Audio ML (duress = transcript signals only)

---

## Post-Friday Roadmap

### Three-Layer Fraud Analysis System

```
TRANSACTION HAPPENS
      ↓
Layer 1 — Transaction Signals (pre-call)
  Amount deviation_factor from customer_spend_profiles ← BUILT (SQL)
  Device risk score from device_intelligence           ← BUILT (ingested)
  Geo mismatch (home_city vs txn_city)                 ← BUILT (in view)
  Velocity, time of day, channel                       ← BUILT (in view)
      ↓
Layer 2 — Transcript Signals (TypeScript, during/post-call)
  Voice onset time                                     ← FRIDAY
  Elaboration ratio                                    ← FRIDAY
  Echo score                                           ← FRIDAY
  Gender mismatch (Gemini Live)                        ← FRIDAY
      ↓
Layer 3 — Audio ML Signals (Python microservice, post-call)
  Jitter / Shimmer / HNR (parselmouth)                 ← PHASE 2
  Pitch F0 mean + variance (librosa)                   ← PHASE 2
  MFCCs 1-13 (librosa)                                 ← PHASE 2
  Background voice detection (pyannote)                ← PHASE 2
  XGBoost stress classifier → class 0/1/2              ← PHASE 3
      ↓
Combined risk score → clear / block / escalate
```

---

### Phase 1 — Behavioral Baseline ✅ DONE (June 17)

**`customer_spend_profiles` table** — 4,996 customer profiles pre-computed.

Key output: `deviation_factor = amount_inr / p95_amt_90d`
- H3 hero (Sachin Bhatia, Lucknow → CROMA Mumbai): **11.4x his P95**
- H6 hero (Devang Mehta, Mumbai → Singapore hotel): **53.7x his P95**
- Top coerced case (Abhishek Trivedi): **41x his P95**

Voice agent says: *"This ₹74,999 transaction is 11x your typical spend of ₹6,597"*

**`fraud_call_context` view** updated with `deviation_factor`, `avg_amt_90d`, `p95_amt_90d`, `usual_country`, `intl_txn_count`.

**`demo_phone` column** added to customers table (populate before Friday).

---

### Phase 2 — Python Microservice (Week 2)

**Stack:** FastAPI + parselmouth-praat + librosa + pyannote.audio + xgboost

**File structure:**
```
analysis-service/
  main.py          # FastAPI, POST /analyze-call
  features.py      # parselmouth + librosa extraction
  model.py         # XGBoost load + predict
  audio.py         # ffmpeg mulaw→WAV, channel split
  Dockerfile
  requirements.txt
```

**Dockerfile:**
```dockerfile
FROM python:3.11-slim
RUN apt-get update && apt-get install -y ffmpeg libsndfile1
RUN pip install fastapi uvicorn parselmouth-praat librosa \
    pyannote.audio xgboost scikit-learn numpy
COPY . .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**Railway:** Second service in same project.
Internal URL: `http://analysis-service.railway.internal:8000`
Image size: ~600MB (no PyTorch — parselmouth + librosa + xgboost only)

**Feature vector per customer turn:**
```python
{
  # parselmouth
  "jitter": float,       # >0.04 = stressed
  "shimmer": float,      # >0.20 = stressed
  "hnr": float,          # <8 = degraded voice quality

  # librosa
  "mean_f0": float,      # average pitch Hz
  "f0_variance": float,  # <15 = unnaturally flat (coached)
  "mfcc_1-13": [...],    # 13 MFCCs
  "speaking_rate": float, # syllables/sec, <1.5 = coached

  # pyannote
  "background_voice": bool,  # second speaker detected

  # from TypeScript transcript (merged in)
  "voice_onset_ms": float,
  "elaboration_ratio": float,
  "echo_score": float,
}
```

**DB additions:**
```sql
ALTER TABLE voice_verification_calls ADD COLUMN stress_class INTEGER;
ALTER TABLE voice_verification_calls ADD COLUMN jitter DOUBLE;
ALTER TABLE voice_verification_calls ADD COLUMN shimmer DOUBLE;
ALTER TABLE voice_verification_calls ADD COLUMN hnr DOUBLE;
ALTER TABLE voice_verification_calls ADD COLUMN mean_f0 DOUBLE;
ALTER TABLE voice_verification_calls ADD COLUMN f0_variance DOUBLE;
ALTER TABLE voice_verification_calls ADD COLUMN background_voice BOOLEAN;
ALTER TABLE voice_verification_calls ADD COLUMN feature_importances JSON;
ALTER TABLE voice_verification_calls ADD COLUMN combined_risk_score DOUBLE;
```

---

### Phase 3 — XGBoost Model (Week 3-4)

**Option A — Rule-based (ships with Phase 2, zero training needed):**
```python
def classify_stress(f):
    score = 0
    if f['jitter'] > 0.04:          score += 1
    if f['shimmer'] > 0.20:         score += 1
    if f['hnr'] < 8:                score += 1
    if f['f0_variance'] < 15:       score += 1
    if f['voice_onset_ms'] > 800:   score += 1
    if f['background_voice']:       score += 2
    return 2 if score >= 4 else (1 if score >= 2 else 0)
```

**Option B — XGBoost on RAVDESS (Week 3):**
7,356 labelled emotional speech recordings. Map emotions → stress classes:
- calm/happy/neutral → 0
- surprised/sad → 1
- angry/fearful/disgust → 2

```python
model = xgb.XGBClassifier(
    n_estimators=100, learning_rate=0.1,
    max_depth=5, objective='multi:softmax', num_class=3
)
model.save_model("stress_model.json")  # 2MB
```

**Option C — Fine-tune on own calls (Week 6+):**
50+ labelled HDFC call recordings → retrain. Best eventual accuracy.

---

### Phase 4 — Combined Risk Score + Audit Trail (Week 4)

```python
def combined_risk_score(row):
    risk = 0.0
    # Layer 1
    if row.deviation_factor > 10:    risk += 0.15
    if row.device_risk_score > 800:  risk += 0.20
    # Layer 2
    risk += row.duress_score * 0.25
    # Layer 3
    if row.stress_class == 2:        risk += 0.20
    if row.background_voice:         risk += 0.10
    if row.gender_mismatch:          risk += 0.15
    # Hard override
    if row.gender_mismatch and row.stress_class == 2:
        return 1.0
    return min(risk, 1.0)
```

**Call detail screen showing audit trail:**
```
ESCALATED — Combined Risk Score: 0.87

Layer 1 — Transaction
  Deviation factor    11.4x P95 (₹6,597)   +0.15
  Device risk         HIGH                  +0.20

Layer 2 — Conversation
  Voice onset         1,340ms               +0.08
  Elaboration ratio   Very low (0.18)       +0.07
  Gender mismatch     Detected              +0.15

Layer 3 — Audio (XGBoost)
  Stress class        HIGH (2)              +0.20
  Jitter              0.048 ↑ elevated
  HNR                 6.2   ↓ degraded
  Background voice    Detected              +0.10

Feature importances:
  voice_onset_ms      31%
  f0_variance         24%
  jitter              19%
  elaboration_ratio   14%
  hnr                 12%
```

---

### Full Timeline

| Phase | What | When | Status |
|---|---|---|---|
| 0 | Friday demo | Tue–Thu this week | 🔨 building |
| 1 | Behavioral baseline SQL | June 17 | ✅ done |
| 2 | Python microservice | Week 2 | ⬜ |
| 3A | Rule-based XGBoost | Week 2 (ships with Phase 2) | ⬜ |
| 3B | XGBoost on RAVDESS | Week 3–4 | ⬜ |
| 3C | Fine-tune on own calls | Week 6+ | ⬜ |
| 4 | Combined score + audit UI | Week 4 | ⬜ |

---

### Evaluation Metric: MCC Not Accuracy

On imbalanced data (0.114% fraud rate), accuracy is meaningless.
A model that classifies everything as genuine gets 99.886% accuracy.
**Use Matthews Correlation Coefficient (MCC)** — the correct metric for fraud detection.
Random Forest + SMOTE achieves MCC 0.9996 on similar datasets (per Dornadula et al. 2019).
