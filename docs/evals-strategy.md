# Evals Strategy for Sentinel

## The Core Problem

Two systems with LLM-driven pipelines at every layer. Things that can go wrong:

1. **Classification** — query routed to wrong mode
2. **SQL generation** — wrong SQL, missing filters, OOM, wrong table selection
3. **Agent orchestration** — wrong agents activated, redundant queries, missed dimensions
4. **Synthesis** — hallucinated numbers, missed citations, wrong chart types
5. **Actions** — segment SQL doesn't match description, metric update breaks formula
6. **Cube layer** (production) — wrong measure/dimension selection, bad filter mapping, join errors

Each layer compounds. A misclassification cascades through everything downstream. And you can't unit-test LLM outputs the traditional way.

---

## Eval Framework: Three Tiers

### Tier 1: Deterministic (no LLM judge needed)

These are cheap, fast, run on every PR:

| What | How | Baby Sentinel | Production |
|------|-----|---------------|------------|
| SQL validity | Parse generated SQL, run against empty schema | `validateSQL()` already exists — extend to dry-run against DuckDB | Cube query validation against model schema |
| SQL safety | Regex + AST check for DDL/DML/injection | Already have `BLOCKED_KEYWORDS` — add parameterized tests | Same + BigQuery cost estimation guards |
| Classification accuracy | Golden dataset of 200+ queries → expected mode | Snapshot test: `classify("create a segment for churned users") === "action"` | Same, but 5x larger (more modes, tool calls) |
| SSE protocol conformance | Parse NDJSON stream, validate event sequence | `phase→sql→plan→query_result→result→summary→text→done` order check | LangGraph state transition validation |
| Chart spec validity | JSON schema validation on ` ```chart ` blocks | Parse all charts from golden responses, validate against `{type, xKey, yKeys, data}` schema | Same |
| Metric SQL correctness | Run generated metric SQL, check it returns numeric result | Already have `sqlValid` field in metric-update flow — formalize as eval | Cube measure validation |
| Result sanitization | BigInt, Date, null handling | Already have `sanitize()` — add property-based tests with edge cases | Same for BigQuery types |

### Tier 2: LLM-as-Judge (moderate cost, run nightly)

For things where "correct" is subjective:

| What | Judge Prompt | Dataset |
|------|-------------|---------|
| Response relevance | "Given this question and SQL results, does the response answer the question? Score 1-5" | 50 golden query→response pairs per dataset |
| Citation accuracy | "Does citation [rev-opt:Q1] reference data that actually appears in query result Q1?" | Extract all citations from golden responses, verify against results |
| Chart-data consistency | "Does the chart data match the numbers mentioned in the text?" | Parse chart JSON + surrounding text, check alignment |
| Report completeness (deep) | "Does this report cover: exec summary, key findings, 3+ sections, validated insights, deep-dives?" | 20 deep research golden queries |
| Agent summary quality | "Does this agent summary contain only numbers from the provided query results? Any hallucinated data?" | Per-agent summary + raw results pairs |
| Recommendation relevance | "Are these follow-up actions relevant and actionable given the analysis?" | Query→response→recommendations triples |
| Segment SQL fidelity | "Does this SQL accurately capture the segment description '{description}'?" | 30 description→SQL pairs |

### Tier 3: End-to-End Trace Evals (expensive, run weekly/on-demand)

Full pipeline runs with scoring:

```
Input: "What's our retention rate for users acquired in January?"
Expected trace:
  classify → analytics
  sql-generator → cohort query with date filter
  executor → returns rows with retention %
  synthesis → cites specific numbers, includes line chart
  recommendations → suggests cohort comparison, segment creation

Score each step independently + overall coherence
```

For production with Cube:
```
Input: "Show me D7 retention by acquisition channel"
Expected trace:
  classify → analytics
  cube query → {measures: [retention_d7], dimensions: [channel], timeDimensions: [...]}
  validate → measure exists in model, dimension joinable
  execute → BigQuery via Cube REST API
  synthesis → coherent response with proper gaming domain context
```

---

## What's Different for Production (5x complexity)

### 1. Cube semantic layer adds a new eval dimension

Baby sentinel: LLM → raw SQL → DuckDB (one step)
Production: LLM → Cube query JSON → Cube → optimized SQL → BigQuery (three steps)

New eval needed: **Cube query correctness**
- Does the LLM pick the right cube/view?
- Does it use the right measure type (count vs sum vs avg)?
- Does it construct valid filters (operator, member path)?
- Does it handle time dimensions with correct granularity?
- Does it respect pre-aggregation boundaries?

This is actually *more testable* than raw SQL because Cube queries are structured JSON — you can do schema validation before execution.

### 2. Tool calling needs structured eval

Production has real tool calls (LangGraph). Eval framework:

```
Input: user query
Expected: ordered list of tool calls with approximate args
Actual: captured tool call trace from LangGraph

Score:
- Tool selection accuracy (right tool?)
- Argument correctness (right params?)
- Call order efficiency (minimal steps?)
- Error recovery (retry on failure?)
```

### 3. Multi-agent coordination

Production LangGraph agents have real state machines. Eval:
- Does the orchestrator dispatch to the right subagents?
- Do subagents avoid redundant work?
- Does the critique agent actually catch errors?
- Is the final synthesis faithful to all agent outputs?

### 4. Domain knowledge (Rover/Sensor Tower)

Gaming-specific evals:
- "Is D7 retention of 25% good?" → must reference industry benchmarks
- "Compare our CPI to competitors" → must use Sensor Tower data
- Eval: does the response include external context when appropriate?

---

## Practical Implementation Plan

### Phase 1: Golden dataset creation (1 week)

Build an `evals/` directory:
```
evals/
  datasets/
    classify-golden.jsonl        # 200 queries → expected {mode, actionType}
    sql-golden.jsonl             # 50 queries → expected SQL patterns (not exact match)
    response-golden.jsonl        # 30 query→result→expected response
    chart-golden.jsonl           # 20 responses → expected chart specs
    segment-golden.jsonl         # 30 descriptions → SQL constraints
    cube-query-golden.jsonl      # (production) 50 queries → expected Cube JSON
  judges/
    relevance.txt                # LLM judge prompt
    citation-accuracy.txt
    hallucination-check.txt
    chart-consistency.txt
  runners/
    classify-eval.ts             # Deterministic: exact match
    sql-eval.ts                  # Hybrid: parse + dry-run + LLM judge
    e2e-eval.ts                  # Full pipeline trace
    cube-eval.ts                 # (production) Cube query validation
```

### Phase 2: Deterministic evals in CI (1 week)

- Classification accuracy on every PR (target: >95%)
- SQL validation (parse + blocked keyword check) on every PR
- SSE event sequence conformance on every PR
- Chart JSON schema validation on every PR

### Phase 3: LLM-judge evals nightly (1 week)

- Response relevance scoring (target: avg >4.0/5.0)
- Citation accuracy (target: >90% citations verifiable)
- Hallucination detection (target: <5% hallucinated numbers)
- Run via cron, results to dashboard

### Phase 4: Production-specific evals (2 weeks)

- Cube query correctness eval suite
- Tool call trace evaluation
- LangGraph state transition validation
- Gaming domain knowledge coverage
- Multi-tenant isolation verification (query A's data never leaks to tenant B)

---

## Key Metrics to Track

| Metric | Target | How |
|--------|--------|-----|
| Classification accuracy | >95% | Golden dataset, exact match |
| SQL execution success rate | >85% | Run generated SQL, check no error |
| Response relevance | >4.0/5 | LLM judge |
| Citation accuracy | >90% | Automated citation→result verification |
| Hallucination rate | <5% | LLM judge on numbers |
| Chart validity | >95% | JSON schema validation |
| E2E latency p95 | <15s quick, <60s deep | Trace timing |
| Cube query validity | >90% | Schema validation (production) |
| Tool call accuracy | >85% | Trace comparison (production) |

---

## The Hardest Part: Regression Detection

LLM outputs are non-deterministic. A prompt change that improves 80% of cases might break 20%. The eval system needs to:

1. **Run the full golden set on every prompt change** (not just spot-check)
2. **Track per-query scores over time** (not just averages — one regression hiding behind improvements)
3. **Flag regressions explicitly** ("Query #47 dropped from 5/5 to 2/5 after this prompt change")
4. **Version prompts** — every prompt template gets a version, eval results tagged to version

For the Cube layer specifically: schema changes in the Cube model are the equivalent of prompt changes — they can silently break query generation. Run Cube evals on every model change.

---

## Learning Evals as a PM

### Read These 3 Things (in order, ~45 min total)

1. **Hamel Husain's Evals FAQ** — [hamel.dev/blog/posts/evals-faq](https://hamel.dev/blog/posts/evals-faq/) — Q&A format, covers everything, no jargon. The single best resource.
2. **Eugene Yan's 3-Step Framework** — [eugeneyan.com/writing/product-evals](https://eugeneyan.com/writing/product-evals/) — Most actionable "just do this" guide: label 50 examples, align an LLM judge, run on every change.
3. **Anthropic's Agent Evals Post** — [anthropic.com/engineering/demystifying-evals-for-ai-agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) — How to think about evals for multi-step agent systems specifically.

Bonus PM-specific: **Hamel on Lenny's Newsletter** — [lennysnewsletter.com/p/evals-error-analysis-and-better-prompts](https://www.lennysnewsletter.com/p/evals-error-analysis-and-better-prompts)

---

### Tools Landscape — You Don't Build From Scratch

| Tool | What it is | Cost | Setup | Best for |
|------|-----------|------|-------|----------|
| **Langfuse** | Already used in production Sentinel. Has LLM-as-Judge, datasets, experiments, annotation queues | Free self-hosted, $29/mo cloud | Already deployed | **Start here** — layer evals on existing tracing |
| **Promptfoo** | Open-source CLI. YAML config, no code needed. `npx promptfoo eval` and done | Free | 5 minutes | Prompt regression testing in CI |
| **Braintrust** | Cloud platform — evals + observability unified. Raised $80M at $800M valuation | $249/mo | Medium | Teams wanting polished dashboards |
| **Arize Phoenix** | Open-source, OpenTelemetry-based, runs in Jupyter. 7,800+ GitHub stars | Free | 15 minutes | Python-heavy teams, notebook workflows |
| **OpenAI Evals** | Open-source framework + web dashboard for benchmarking. 17,600 GitHub stars | Free (API costs) | Low | Standardized benchmarks |

**Recommendation for Sentinel**: Langfuse (already there) + Promptfoo (for CI prompt regression). No new vendor needed.

---

### The Mental Model

Evals are not "testing." They're closer to **product quality metrics you track continuously**.

```
Traditional app:  unit tests → integration tests → QA → ship
LLM app:          evals → evals → evals → ship → evals
```

Three types you care about:

| Type | Analogy | When it runs | Who builds it |
|------|---------|-------------|---------------|
| **Deterministic** | Unit tests | Every PR | Engineer, once |
| **LLM-as-Judge** | Automated QA | Nightly | PM defines criteria, engineer wires it |
| **Human review** | Manual QA | Weekly | PM does this directly |

**The PM's job in evals:**
1. **Define what "good" looks like** — You label 50 real outputs as pass/fail. Binary, not scores.
2. **Find the failures** — Manually read 20-30 LLM outputs. The patterns you spot become eval criteria.
3. **Prioritize which evals to build** — Classification accuracy matters more than chart formatting.
4. **Review eval results** — When scores drop, decide if it's a real regression or the eval is wrong.

---

### Hamel's Key Insight (most important thing to internalize)

> "Don't start with tooling. Start with error analysis. Spend 30 minutes reading 20-50 real outputs. The evals you need will become obvious."

The process:
1. Collect 50 real user queries + system outputs
2. Read each one. Mark pass/fail. Write 1 sentence why for each fail.
3. Group the failures. You'll see patterns ("wrong table selected", "hallucinated numbers", "missed the question").
4. Each pattern = one eval to build.
5. Now pick a tool.

**Don't do**: imagine all possible failure modes and build evals speculatively. You'll waste weeks on evals that never trigger.

---

### Extended Reading List

**Foundational (must-read):**
- Hamel Husain: [Your AI Product Needs Evals](https://hamel.dev/blog/posts/evals/) — The foundational argument. Three-level framework.
- Hamel Husain: [Using LLM-as-a-Judge: A Complete Guide](https://hamel.dev/blog/posts/llm-judge/) — When to use it, when not to.
- Hamel Husain: [A Field Guide to Rapidly Improving AI Products](https://hamel.dev/blog/posts/field-guide/) — End-to-end process.
- Eugene Yan: [Task-Specific LLM Evals that Do & Don't Work](https://eugeneyan.com/writing/evals/) — Which approaches work for which tasks.
- Eugene Yan: [Evaluating LLM-Evaluators](https://eugeneyan.com/writing/llm-evaluators/) — Deep dive on LLM-as-Judge reliability (24 papers).

**PM-specific:**
- Langfuse: [LLM Product Development for Product Managers](https://langfuse.com/blog/2024-11-llm-product-management)
- Langfuse: [Evaluating LLM Applications: A Comprehensive Roadmap](https://langfuse.com/blog/2025-11-12-evals)
- Xplainerr: [A-to-Z of LLM Evals for PMs](https://xplainerr.substack.com/p/a-to-z-of-llms-evals-for-product)
- Saptak: [PM's Guide to AI Evaluations](https://saptak.in/writing/2025/04/17/product-managers-guide-ai-evaluations)
- Mind the Product: [How to Implement Effective AI Evaluations](https://www.mindtheproduct.com/how-to-implement-effective-ai-evaluations/)

**Practical case studies:**
- Semgrep: [How We Use Promptfoo](https://semgrep.dev/blog/2024/does-your-llm-thing-work-how-we-use-promptfoo/) — Real-world promptfoo usage.
- Eugene Yan: [AlignEval](https://eugeneyan.com/writing/aligneval/) — His open tool for building LLM evaluators.
- Anthropic: [Evals repo on GitHub](https://github.com/anthropics/evals) — Open-source eval framework + benchmarks.

---

### Hamel's Core Principles (cheat sheet)

- **Start with error analysis, not tooling.** 30 min reviewing 20-50 outputs before building anything.
- **Use binary pass/fail, not Likert scales.** Scales introduce inconsistency and require larger sample sizes.
- **One domain expert ("benevolent dictator") decides quality.** Don't committee it.
- **Notebooks are the best eval tool.** Arbitrary code + visualization + fast iteration.
- **Don't do eval-driven development.** Write evaluators for errors you discover, not errors you imagine.
- **Expect 60-80% of dev time on eval activities.** This is normal.
- **A 70% pass rate is probably good.** 100% means your evals aren't challenging enough.

### Eugene's Core Principles (cheat sheet)

- **Label 50-200 examples** (binary pass/fail).
- **Align LLM evaluators against your labels** (75/25 dev/test split).
- **Run eval harness on every change.**
- **Eval-driven development**: define success criteria before building.
- Both Hamel and Eugene agree: binary labels, small datasets to start, align LLM judges against human judgment.

---

## Paper: PromptEvals (NAACL 2025)

**Paper**: "PromptEvals: A Dataset of Assertions and Guardrails for Custom Production LLM Pipelines"
**Authors**: Reya Vir, Shreya Shankar (UC Berkeley) + Harrison Chase, Will Fu-Hinthorn (LangChain)
**Link**: [arxiv.org/abs/2504.14738](https://arxiv.org/abs/2504.14738)

### What It Is

A dataset of **2,087 real production LLM prompts** (from LangChain Hub, 3M+ weekly downloads) paired with **12,623 human-validated assertion criteria** — the guardrails that check if LLM output is good enough.

### The Problem It Solves

When you ship an LLM pipeline, you need programmatic checks on outputs (assertions/guardrails). But:
- Every pipeline needs different criteria (finance != marketing != healthcare)
- Criteria must catch LLM-specific failures (hallucination, format violations, verbosity)
- Manually writing these for every prompt change is slow
- Using GPT-4o to generate them is expensive and still slow (~8.7s per prompt)

No large real-world dataset of "prompt -> what to check" existed before this.

### Key Finding

Fine-tuned 7B models crush GPT-4o at generating assertion criteria:

| Model | F1 Score | Latency | Cost |
|-------|----------|---------|------|
| GPT-4o | 0.68 | 8.7s | $$$ |
| Fine-tuned Mistral-7B | **0.82** | **2.6s** | $ |
| Fine-tuned Llama-3-8B | **0.82** | **3.6s** | $ |

+20% better quality, 3x faster, fraction of the cost. Trained in <1 hour on 2x A100s with ~1,200 examples.

Base models massively over-generate criteria (Llama produces 28 criteria when ground truth is ~6). Fine-tuning fixes both quality and quantity.

### The 6-Type Constraint Taxonomy

Every LLM output can be checked against these 6 categories:

1. **Structured Output** — Does it follow the required format? (JSON schema, markdown, DSL)
2. **Multiple Choice** — Did it pick from the allowed options?
3. **Length Constraints** — Right word count, list length, paragraph count?
4. **Semantic Constraints** — Right topic? Required terms included/excluded?
5. **Stylistic Constraints** — Right tone, persona, formality level?
6. **Hallucination Prevention** — Factual? Grounded in provided data? No invented actions?

**For Sentinel's analyze pipeline**: SQL output needs (1), response needs (4)(5)(6), charts need (1)(3). Use this as a checklist when reviewing any prompt in `src/lib/prompts/`.

### Their 3-Step Pipeline for Generating Assertions

1. **Generate** — LLM produces initial criteria for a prompt
2. **Augment** — Second pass catches missing criteria (they found ~1.35 missed per prompt on average)
3. **Refine** — Remove redundant/incorrect/unverifiable criteria

This generate-augment-refine pattern works for any labeling workflow, not just assertions.

### Applicability to Sentinel

- **Auto-generate guardrails**: Run their fine-tuned Mistral model against every prompt in `src/lib/prompts/` to auto-generate assertion criteria. Model on HuggingFace: `reyavir/promptevals_mistral`
- **Constraint taxonomy as eval categories**: Each of the 6 types maps to a category of eval in the strategy above
- **Semantic F1 metric**: Embed criteria with cosine similarity instead of exact-match — better for comparing LLM response quality
- **Small fine-tuned judges**: You don't need GPT-4o to evaluate outputs. A small fine-tuned model trained on ~1,200 examples does it better. Applies to LLM-as-Judge evals in Langfuse too — if judges are slow/expensive, fine-tune a small model on your labeled data

### Released Resources

- Dataset: [huggingface.co/datasets/reyavir/PromptEvals](https://huggingface.co/datasets/reyavir/PromptEvals)
- Models: `reyavir/promptevals_mistral` and `reyavir/promptevals_llama` on HuggingFace
- Code: [github.com/reyavir/promptevals](https://github.com/reyavir/promptevals)

---

## Shreya Shankar's Research — Full Body of Work on LLM Evals

Shreya Shankar is a final-year PhD at UC Berkeley. Her work is the academic foundation for production LLM evaluation. Three papers form a coherent trilogy, plus one landmark industry article.

### The Trilogy

#### 1. SPADE (VLDB 2024) — Auto-generating assertions from prompt history

[arxiv.org/abs/2401.03038](https://arxiv.org/abs/2401.03038)

The core insight: when developers iterate on prompts, each edit implicitly encodes a quality requirement. SPADE mines these prompt diffs to auto-generate assertions.

**How it works:**
1. Takes your prompt version history (v1 -> v2 -> v3...)
2. Computes sentence-level diffs between consecutive versions
3. Categorizes each diff into 9 types (format instructions, inclusion/exclusion rules, quantity constraints, qualitative criteria, etc.)
4. GPT-4 generates candidate Python assertion functions from each diff
5. An Integer Linear Program selects the minimal set of assertions that maximizes failure coverage while keeping false failure rate below a threshold

**The 9 delta categories:**
- Structural (35%): Response Format Instruction, Example Demonstration
- Content (65%): Prompt Clarification, Workflow Description, Data Integration, Quantity Instruction, Inclusion Instruction, Exclusion Instruction, Qualitative Criteria

**Results:** 14% fewer assertions, 21% fewer false failures vs. baselines. Deployed in LangSmith for 2,000+ real pipelines. Average 3.3 assertions per pipeline.

**For Sentinel:** The 12 prompt files in `src/lib/prompts/` have git history. SPADE's approach could be applied directly — diff prompt versions, extract what quality requirements each edit was trying to enforce, and auto-generate assertions.

---

#### 2. Who Validates the Validators / EvalGen (UIST 2024) — The human side of evals

[arxiv.org/abs/2404.12272](https://arxiv.org/abs/2404.12272)

This is the most important paper for PMs. It discovered **criteria drift**.

**Criteria drift:** You cannot fully define what "good" means before looking at LLM outputs. Your evaluation criteria change *as you grade outputs*. This is not a bug — it's fundamental to how humans assess quality.

Two types of drift observed:
- **Adding new criteria** — you see a new failure mode you hadn't anticipated
- **Reinterpreting existing criteria** — "proper nouns" initially meant "any entity must be a proper noun" but shifted to "most entities should be proper nouns" after seeing real outputs

**EvalGen's approach:**
1. LLM suggests evaluation criteria in natural language (users said this "alleviates writer's block")
2. User edits/adds/removes criteria
3. LLM generates candidate assertion implementations (code or LLM-grader prompts)
4. User grades a sample of outputs with simple thumbs-up/thumbs-down
5. System selects assertions that best align with user grades
6. Report card shows coverage + false failure rate per criterion

**Key user study findings (9 practitioners):**
- Grading outputs first helps define criteria (the "Grade First" option was most effective)
- Users want per-criterion false failure rate thresholds, not one global threshold
- Code-based assertions preferred for format checks; LLM-based assertions preferred for "fuzzy" semantic checks
- Users wanted to export assertions as unit tests or into CI/CD
- Participants who graded before selecting criteria found criteria they "couldn't have extracted from the prompt directly"

**The catch-22:** You need criteria to grade outputs, but grading outputs helps you define criteria. Tools must support this iterative loop, not assume criteria are fixed upfront.

**For PMs:** This validates the approach Hamel advocates — start by reading outputs, not defining criteria. But it adds nuance: your criteria *will* shift as you review more outputs, and that's expected. Budget for iteration.

---

#### 3. PromptEvals (NAACL 2025) — The dataset + fine-tuned models

Covered in detail above. Completes the progression: SPADE auto-generates from prompt history -> EvalGen adds human alignment -> PromptEvals provides a large-scale dataset to train specialized models.

---

### The Industry Article

#### "What We've Learned From a Year of Building with LLMs" (O'Reilly Radar, 2024)

[applied-llms.org](https://applied-llms.org)

Co-authored with Eugene Yan, Hamel Husain, Bryan Bischof, Charles Frye, Jason Liu. The practitioner bible.

**On eval design:**
- Start with 3+ assertion-based unit tests per pipeline
- Use pairwise LLM-as-Judge comparisons, not Likert scales
- Mitigate position bias by reversing pair order and allowing ties
- Reference-free evals (consistency checks, quality checks) double as both measurement AND runtime guardrails

**On hallucination:**
- 5-10% baseline hallucination rate, hard to push below 2%
- Combine upstream Chain-of-Thought with downstream factual consistency checks
- For structured RAG output, verify sourcing deterministically
- Log probs DO NOT correlate with correctness

**On production monitoring:**
- Daily I/O sampling is mandatory — criteria drift happens in production too
- Check dev-prod skew: structural (formatting changes) AND semantic (topic shift)
- Pin model versions (use `gpt-4-turbo-1106`, not `gpt-4`)
- Model migration always breaks things — run evals before switching

**On system design:**
- "The model isn't the product, the system around it is"
- Prioritize deterministic workflows over agent non-determinism
- Caching is underrated — normalize inputs to increase cache hit rates
- Don't finetune until you've exhausted prompt engineering

---

### Other Relevant Work

**Data Agent Benchmark (2026 preprint)** — [arxiv.org/abs/2603.20576](https://arxiv.org/abs/2603.20576) — 54 queries across 12 datasets, 9 domains, 4 DBMS. Best frontier model (Gemini-3-Pro) achieves only **38% accuracy**. Directly relevant to Sentinel — benchmarks exactly what the system does (natural language -> data queries). The bar is low across the industry.

**DocETL (VLDB 2025)** — [arxiv.org/abs/2410.12189](https://arxiv.org/abs/2410.12189) — Agentic query rewriting for document processing. 25-80% more accurate than baselines. Key idea: LLM outputs are often inaccurate even with good prompts, so the system automatically rewrites and decomposes tasks. Relevant pattern for Sentinel's SQL retry logic.

**Operationalizing ML (CSCW 2024)** — [arxiv.org/abs/2209.09125](https://arxiv.org/abs/2209.09125) — Interview study on ML production systems. Found that ML teams spend most time on data quality, not model quality. The hard part is knowing what "good" looks like.

**AI Evals Course** — Co-taught with Hamel Husain. 4,500+ students from 500+ companies. O'Reilly book coming Spring 2026. The course if you want to go deep.

**RAG Without the Lag (CHI 2026, Best Paper)** — [arxiv.org/abs/2504.13587](https://arxiv.org/abs/2504.13587) — Interactive debugging for RAG pipelines.

**DocWrangler (UIST 2025, Best Paper HM)** — [arxiv.org/abs/2504.14764](https://arxiv.org/abs/2504.14764) — Steering semantic data processing with interactive UI.

---

### The Meta-Insight Across All Her Work

**Evaluation is not a static checkpoint. It's an iterative, human-in-the-loop process where the definition of "good" co-evolves with the system's outputs.**

This challenges every eval tool that assumes you define criteria upfront and then measure against them. The criteria themselves are a living artifact. For Sentinel, this means:

1. Golden datasets will need regular re-labeling as prompts change
2. "Good SQL" and "good analysis" will mean different things for different datasets
3. The PM reviewing outputs is not just QA — it's actively defining what the system should optimize for
4. Budget for criteria drift. Don't treat first eval criteria as permanent

---

### Full Publication List (Eval-Adjacent)

| Year | Paper | Venue | Key Contribution |
|------|-------|-------|-----------------|
| 2026 | Data Agent Benchmark | Preprint | 38% accuracy ceiling for data agents |
| 2026 | Task Cascades | SIGMOD | Efficient unstructured data processing |
| 2026 | RAG Without the Lag | CHI (Best Paper) | Interactive RAG debugging |
| 2025 | DocETL | VLDB | Agentic query rewriting, 25-80% improvement |
| 2025 | DocWrangler | UIST (Best Paper HM) | Steering semantic data processing |
| 2025 | PromptEvals | NAACL (Oral) | 2,087 prompts + 12,623 assertions dataset |
| 2024 | Who Validates the Validators | UIST | Criteria drift, EvalGen mixed-initiative |
| 2024 | SPADE | VLDB | Auto-synthesize assertions from prompt diffs |
| 2024 | Building with LLMs | O'Reilly | Practitioner guide (6 co-authors) |
| 2024 | Operationalizing ML | CSCW | Interview study on ML production |
| 2023 | ML Pipeline Observability | VLDB | Monitoring for production ML |
| 2023 | Auto Data Validation | CIKM | Automatic + precise data validation for ML |
