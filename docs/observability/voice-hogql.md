# Voice E2E Observability — HogQL Roll-ups & Reliability Surface (Layer 3 / U9)

> **No app code ships here (KTD6/R13).** Percentiles, distributions, and the
> latency×sentiment cross-cut are computed in HogQL against the events emitted by
> Layers 1–2. No percentile function lives in `src/`. These queries are the
> single source for the p50/p95/p99 numbers; they deliberately do **not** repoint
> the analytics UI's fabricated `buildFallbackSimulationLatency` chart (deferred).

## Event taxonomy recap (frozen — KTD1)

Every event carries `call_id` and `$ai_trace_id` (= `call_id`) and `pipeline`
(`gemini_live | openai_realtime | sarvam_cascaded`). Join any voice event to the
existing `$ai_generation` LLM traces on `$ai_trace_id`.

| Layer | Event | Key properties |
|---|---|---|
| 1 · lifecycle | `voice_call_triggered` | `campaign_id` |
| 1 · lifecycle | `voice_ws_connected` | — |
| 1 · lifecycle | `voice_setup_complete` | `prewarmed` |
| 1 · lifecycle | `voice_transcript_finalized` | `transcript_source` (`gemini_inline`\|`openai_postcall`\|`realtime_inline`), `trigger_to_transcript_ms` |
| 1 · per-turn | `voice_turn` | `speech_id`, `turn_index`, `eou_proxy_ms`, `eou_source`, `voice_to_voice_ms`, `detection_think_ms`, `response_lag_ms`, `total_turn_ms`, `interrupted` |
| 2 · enrichment | `voice_call_enrichment` | `sentiment_trajectory` (array of `{turn_index,label}`), `question_types`, `script_adherence_scores`, `interruption_handling`, `compliance_violations`, `enriched`, `sample_rate` |

---

## 1. Primary KPI — voice-to-voice latency percentiles (R13)

Barge-in turns have no clean end-of-utterance, so their `voice_to_voice_ms` is
semantically undefined — **filter `interrupted = false`** or they pollute the
distribution.

```sql
SELECT
    quantile(0.50)(toFloat(properties.voice_to_voice_ms)) AS p50_ms,
    quantile(0.95)(toFloat(properties.voice_to_voice_ms)) AS p95_ms,
    quantile(0.99)(toFloat(properties.voice_to_voice_ms)) AS p99_ms,
    count() AS turns
FROM events
WHERE event = 'voice_turn'
  AND properties.interrupted = false
  AND properties.voice_to_voice_ms IS NOT NULL
  AND timestamp > now() - INTERVAL 7 DAY
```

### Movable-component breakout (`response_lag_ms`)

`detection_think_ms` is dominated by Gemini's fixed ≥650 ms silence window (not
movable by this team). `response_lag_ms` is the component turn-taking work can
actually move — track it alongside the headline number.

```sql
SELECT
    quantile(0.50)(toFloat(properties.detection_think_ms)) AS think_p50,
    quantile(0.95)(toFloat(properties.detection_think_ms)) AS think_p95,
    quantile(0.50)(toFloat(properties.response_lag_ms))    AS lag_p50,
    quantile(0.95)(toFloat(properties.response_lag_ms))    AS lag_p95
FROM events
WHERE event = 'voice_turn'
  AND properties.interrupted = false
  AND properties.response_lag_ms IS NOT NULL
  AND timestamp > now() - INTERVAL 7 DAY
```

---

## 2. Secondary KPI — trigger → transcript latency

```sql
SELECT
    properties.transcript_source AS source,
    quantile(0.50)(toFloat(properties.trigger_to_transcript_ms)) AS p50_ms,
    quantile(0.95)(toFloat(properties.trigger_to_transcript_ms)) AS p95_ms,
    count() AS calls
FROM events
WHERE event = 'voice_transcript_finalized'
  AND properties.trigger_to_transcript_ms IS NOT NULL
  AND timestamp > now() - INTERVAL 7 DAY
GROUP BY source
```

The primary (`voice_to_voice_ms`) and secondary (`trigger_to_transcript_ms`)
numbers are **never blended** into one figure.

---

## 3. Flagship cross-cut — does a slow turn correlate with a bad turn? (Success Criteria)

Join `voice_turn` to the exploded `voice_call_enrichment.sentiment_trajectory`
on **both `call_id` and `turn_index`** (enabled by the turn-keyed sentiment
array, KTD1). Answers "do turns above p95 `voice_to_voice_ms` correlate with
negative sentiment at that same turn?"

```sql
WITH p95 AS (
    SELECT quantile(0.95)(toFloat(properties.voice_to_voice_ms)) AS v
    FROM events
    WHERE event = 'voice_turn' AND properties.interrupted = false
      AND properties.voice_to_voice_ms IS NOT NULL
      AND timestamp > now() - INTERVAL 7 DAY
),
turns AS (
    SELECT
        properties.call_id AS call_id,
        toInt(properties.turn_index) AS turn_index,
        toFloat(properties.voice_to_voice_ms) AS v2v_ms
    FROM events
    WHERE event = 'voice_turn' AND properties.interrupted = false
      AND properties.voice_to_voice_ms IS NOT NULL
      AND timestamp > now() - INTERVAL 7 DAY
),
sentiment AS (
    SELECT
        properties.call_id AS call_id,
        toInt(JSONExtractInt(s, 'turn_index')) AS turn_index,
        JSONExtractString(s, 'label') AS label
    FROM events
    ARRAY JOIN JSONExtractArrayRaw(properties.sentiment_trajectory) AS s
    WHERE event = 'voice_call_enrichment'
      AND properties.enriched = true
      AND timestamp > now() - INTERVAL 7 DAY
)
SELECT
    t.v2v_ms > (SELECT v FROM p95) AS above_p95,
    s.label AS sentiment,
    count() AS turns
FROM turns t
INNER JOIN sentiment s ON t.call_id = s.call_id AND t.turn_index = s.turn_index
GROUP BY above_p95, sentiment
ORDER BY above_p95 DESC, turns DESC
```

A non-empty result with rows joined on `call_id` + `turn_index` satisfies
Verification Contract #6 — and there is no `Math.sin` anywhere in the path that
feeds it.

---

## 4. Sentiment distribution, question types, adherence rate

```sql
-- Sentiment label distribution (turn-weighted)
SELECT JSONExtractString(s, 'label') AS label, count() AS turns
FROM events
ARRAY JOIN JSONExtractArrayRaw(properties.sentiment_trajectory) AS s
WHERE event = 'voice_call_enrichment' AND properties.enriched = true
  AND timestamp > now() - INTERVAL 7 DAY
GROUP BY label ORDER BY turns DESC
```

```sql
-- Question / intent type frequency
SELECT qt AS question_type, count() AS occurrences
FROM events
ARRAY JOIN JSONExtractArrayRaw(properties.question_types) AS qt
WHERE event = 'voice_call_enrichment' AND properties.enriched = true
  AND timestamp > now() - INTERVAL 7 DAY
GROUP BY question_type ORDER BY occurrences DESC
```

```sql
-- Script-adherence rate (mean of the 0-100 aggregate score)
SELECT avg(toFloat(JSONExtractInt(properties.script_adherence_scores, 'score'))) AS avg_adherence
FROM events
WHERE event = 'voice_call_enrichment' AND properties.enriched = true
  AND timestamp > now() - INTERVAL 7 DAY
```

---

## 5. Sample-weighted enrichment roll-up (KTD5)

When `VOICE_ENRICHMENT_SAMPLE_RATE < 1.0` only a subset is enriched. Every call
still emits one `voice_call_enrichment` carrying `sample_rate` + `enriched`, so
weight by `1 / sample_rate` to recover an unbiased population estimate.

```sql
SELECT
    count() AS enrichment_events,
    countIf(properties.enriched = true) AS enriched_events,
    sumIf(1.0 / toFloat(properties.sample_rate), properties.enriched = true) AS weighted_enriched_estimate
FROM events
WHERE event = 'voice_call_enrichment'
  AND properties.sample_rate > 0
  AND timestamp > now() - INTERVAL 7 DAY
```

---

## 6. Judge reliability panel (R14 / KTD8) + error-rate alert

`pass^k` is measured **offline** over advisor-009's regression fixtures with
`passAtK` (`src/lib/judge-consistency.ts`) — it does **not** sample production
calls (each judge runs once per call at runtime). Record the offline results
here per release. Runtime, HogQL surfaces the judge **error rate** so a
systematic judge outage is visible, not silently absent:

```sql
-- Compliance-judge error rate — a spike means the judge is timing out, NOT that
-- calls are clean (the U6 fix guarantees an error is never scored as "safe").
SELECT
    countIf(JSONExtractString(properties.compliance_violations, 'judge_status') = 'error') AS errored,
    count() AS enriched_events,
    round(100.0 * countIf(JSONExtractString(properties.compliance_violations, 'judge_status') = 'error') / count(), 2) AS error_pct
FROM events
WHERE event = 'voice_call_enrichment' AND properties.enriched = true
  AND timestamp > now() - INTERVAL 1 DAY
```

Set a PostHog alert on `error_pct > 5` for a rolling day.

---

## 7. Schema-parity smoke check (R7)

All three pipelines must share the `voice_turn` key set. This returns one row per
pipeline; eyeball that each is present and non-zero once each bridge has run a
call (Sarvam is dormant — typecheck-only — so it may legitimately be absent).

```sql
SELECT
    properties.pipeline AS pipeline,
    count() AS turns,
    countIf(properties.voice_to_voice_ms IS NOT NULL) AS with_v2v,
    countIf(properties.eou_source IS NOT NULL) AS with_eou_source
FROM events
WHERE event = 'voice_turn'
  AND timestamp > now() - INTERVAL 30 DAY
GROUP BY pipeline
```

---

## PostHog insight / dashboard setup

1. Create a **PostHog project** insight for each query above (SQL insight type).
2. Group them into a **"Voice E2E Observability"** dashboard.
3. Pin (1) primary percentiles, (3) the flagship cross-cut, and (6) the
   compliance error-rate as the top row.
4. Add the alert from §6.
5. `call_id = $ai_trace_id`, so you can pivot from any voice number straight into
   the underlying `$ai_generation` LLM traces for the same call.
