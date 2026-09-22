# Dashverse Discovery Call — Complete Deep Dive
**Date:** April 2, 2026 | **Prepared for:** Pilot Partnership Discussion  
**Call type:** Discovery + Demo | **Goal:** Secure pilot commitment

---

## PART 1: KNOW YOUR CLIENT

### 1.1 Company Snapshot

| Field | Detail |
|-------|--------|
| **Company** | Dashverse Corp (fka Dashtoon) |
| **Founded** | 2022, Bengaluru → HQ now San Francisco |
| **Founders** | Sanidhya Narain (CEO, FMS Delhi), Lalith Gudipati, Soumyadeep Mukherjee (CTO) |
| **Team Size** | ~305 employees (Feb 2026) |
| **Funding** | $18M total — Seed (2024) + $13M Series A (Aug 2025) |
| **Investors** | Peak XV Partners (lead Series A), Z47, Stellaris Venture Partners |
| **Revenue** | $2M/month (Aug 2025, DashReels alone) |
| **Users** | 20M+ globally across all platforms |
| **Tagline** | "Engineering the future of entertainment with AI" |
| **70% of Series A funds** → AI infrastructure (GPUs, model fine-tuning) |

### 1.2 Founder Profiles

**Sanidhya Narain (CEO)** — FMS Delhi. Business/content strategy. Public-facing, does press interviews. Thinks in terms of "content velocity" and "building global entertainment franchises from existing IP." Key quote: "The biggest challenge in the rapidly growing microdrama market is content velocity."

**Soumyadeep Mukherjee (CTO)** — Technical co-founder. Owns Frameo's AI pipeline. If he's on the call, expect technical depth questions about how Sentinel processes data.

**Lalith Gudipati (Co-founder)** — Lower public profile. Likely owns ops/growth.

**Madhur Sawhney** — Founding team. Hiring for Program & Growth Managers. Ex-ITC, IIM Indore. Likely a key stakeholder for analytics tooling decisions.

### 1.3 Product Ecosystem (Full Stack)

Dashverse is **vertically integrated** — they own creation AND distribution. This is rare in the microdrama space and is their core strategic differentiation.

```
CREATION LAYER                    DISTRIBUTION LAYER
┌─────────────────┐              ┌─────────────────┐
│  Frameo.AI      │──produces──→ │  DashReels      │
│  (Video Studio) │              │  (Microdramas)  │
│                 │              │  10M+ downloads  │
│  AI Models:     │              │  $2M/mo revenue  │
│  Kling 2.6      │              └─────────────────┘
│  Gemini 3       │              ┌─────────────────┐
│  Veo 3.1        │              │  Dashtoon       │
│  ElevenLabs v3  │──produces──→ │  (Webtoons)     │
│                 │              │  640K downloads  │
│  Dashtoon       │              │  3.3% daily buy  │
│  Studio         │              └─────────────────┘
└─────────────────┘
```

#### DashReels — The Growth Engine
- "World's fastest-growing short-drama app"
- **10M+ downloads**, 5M in first month
- 4.39 stars / 380K ratings
- 4.7M downloads in last 30 days (as of Jan 2026)
- Content: AI originals + curated international + creator-led
- Genres: romance, thriller, drama (heavy Hindi)
- Monetization: **INR 399/3 months subscription** (ad-free) + free ad-supported tier
- Key content: "Raftaar" — 1M views in 15 days, 75% completion rate, 90% higher than other shows
- **Operates like YouTube for microdramas** — enables independent creators to develop and monetize shows

#### Dashtoon — The Original Product
- Webtoon/comics app
- 640K downloads, 4.67 stars / 15K ratings
- #1 Free Comics (Google Play UK, Dec 2023)
- Google Play "Best for Fun App 2023"
- Fast Company "Most Innovative Companies 2024"
- Monetization: freemium (1 free episode/day) + **Dashcash micropayments**
- **3.3% daily purchase rate** — dramatically higher than industry
- 20% MoM user growth

#### Frameo.AI — The Production Engine
- Script-to-video, story-to-video
- Multiple AI models (Kling, Gemini, Veo, ElevenLabs)
- Character consistency, batch creation, iterative review
- **50% production time reduction, 75% cost reduction** (vs traditional)
- Traditional microdrama: 30-60 days → Frameo: 3 weeks
- Target: internal production + external creators/studios

### 1.4 Recent Strategic Moves (Last 6 Months)

| Date | Move | Significance |
|------|------|-------------|
| **Mar 30, 2026** | **Harlequin multi-year deal** — 40 animated microdramas from romance titles | IP licensing play. First title launching THIS MONTH. Authors get royalties. |
| **Mar 2026** | **Vigloo partnership** — Korean microdramas adapted for India (The Bedmate Game) | Localization + international content acquisition |
| **Sep 2025** | **Raftaar launch** — India's first AI-generated microdrama | Proof point for AI production. 1M views in 15 days. |
| **Sep 2025** | Plan to release **100 AI microdramas** by year-end | Content velocity is THE strategy |
| **Aug 2025** | **$13M Series A** — Peak XV led | 70% to AI infra + GPUs |
| **2025** | **ElevenLabs v3 integration** | Multilingual dubbing at scale |
| **2025** | **Drama Dangal** content contest | Creator community building |

**What this tells us:** Dashverse is in **hyper-growth mode**. They're scaling content production (100 titles), expanding internationally (Korea→India, Harlequin→global), and betting big on AI infrastructure. They need analytics to make sense of what's working and what's not across all this content.

### 1.5 Their Hiring Signals — What They Need

**DashReels Product Manager JD** (current opening) reveals EXACTLY what metrics they care about:

> **Core metrics:** DAU/MAU, watch-time per install, completion rates, return viewers, series activation rates, P-scores

> **Responsibilities:**
> - "Design and interpret experiments (A/B and multivariate) to optimise core metrics"
> - "Monitor dashboards and conduct deep-dive health analyses"
> - "Identify leading indicators of content fatigue or over-personalization"
> - "Develop measurable product hypotheses from qualitative findings"

> **Required:** SQL fluency, experiment design, metrics frameworks

> **AI integration tasks:** LLM-generated episode summaries, multimodal embeddings for cold-start ranking

**What this means for Sentinel:** Their PMs need SQL fluency to do their jobs. Actioneer removes that bottleneck entirely. This is a direct pain point.

They're also hiring **Program & Growth Managers** — people who need data access but likely don't write SQL.

---

## PART 2: MARKET INTELLIGENCE

### 2.1 The Microdrama Market is Massive

| Metric | Value |
|--------|-------|
| Global revenue 2025 | **$11B** (Omdia) |
| Projected 2026 | **$14B** (Omdia) |
| In-app revenue 2026 | **$7.8B** (Deloitte) |
| Global downloads 2025 | **2.3B+** (doubled YoY) |
| US non-China revenue share | 50% ($1.5B) |
| CAGR through 2032 | 10.6% |

**Milestone (Feb 2026):** Microdrama apps now **overtake Netflix and Prime Video on mobile engagement** (Omdia). ReelShort gets **35.7 min/day** per active user vs Netflix's 24.8 min.

### 2.2 Competitive Landscape

| Company | Revenue | Users | ARPDAU | Retention | Differentiation |
|---------|---------|-------|--------|-----------|----------------|
| **ReelShort** | $2.98B (2025) | 45M MAU | Highest in class | Good | Market leader, US-dominant (69% rev), 70% female users aged 20-35 |
| **DramaBox** | Top 3 | Large | — | **17% at month 6** (best) | Exceptional long-term retention |
| **DashReels** | ~$24M ARR | 20M total | Growing | Unknown | Vertically integrated (creation+distribution), AI-native, India-first |
| **ShortTV** | Growing | — | — | — | Chinese-backed |
| **FlexTV** | Growing | — | — | — | Korean/Chinese content |
| **MoboReels** | Emerging | — | — | — | India-focused |

**Dashverse's position:** They're a fast-growing #3-5 player with a unique structural advantage (vertical integration) but 100x smaller than ReelShort in revenue. To catch up, they need to:
1. Produce content faster (Frameo)
2. Know what content works (ANALYTICS — this is where Sentinel fits)
3. Retain users better
4. Monetize more effectively

### 2.3 Industry Pain Points

**Content Fatigue is Real:**
- 15-20% audience drop-off when content feels formulaic
- "Meme-stacking and formulaic storytelling" cycle is a known problem
- Challenge: "How do you know BEFORE producing a title that it will work?"

**The Content Velocity Trap:**
- CEO Sanidhya Narain himself says: "The biggest challenge is content velocity"
- But velocity without analytics = producing content blind
- Need to measure: which genres, themes, episode lengths, narrative structures resonate

**Retention is the Battleground:**
- DramaBox's 17% month-6 retention is the benchmark to beat
- Hybrid monetization platforms show 25% higher retention
- Gamified reward systems show 35% higher retention

---

## PART 3: THEIR ANALYTICS PAIN POINTS (MAPPED TO SENTINEL)

### The Core Thesis: Dashverse Produces Content Fast. They Need to Learn Fast.

With Frameo, they can produce a microdrama in 3 weeks. But without strong analytics, they're producing blind. Their PM JD literally says they need people who can "identify leading indicators of content fatigue" and "conduct deep-dive health analyses." Sentinel/Actioneer makes that instant.

### 3.1 Content Intelligence (Their #1 Pain)

| Question They Need Answered | How Sentinel Helps |
|---|---|
| Which episodes cause viewer drop-off? | Episode-level retention curves via natural language |
| AI originals vs. curated vs. creator-led — what performs best? | Segment-based content performance comparison |
| What genre/theme combinations drive installs vs. retention vs. revenue? | Multi-dimensional content analytics |
| Is "Raftaar" a repeatable success or a one-hit wonder? | Content cohort analysis — what did Raftaar viewers watch next? |
| Are Harlequin adaptations working? (40 titles launching NOW) | Real-time title performance tracking + cross-title comparison |
| Content fatigue detection — are viewers getting bored of a genre? | Trend analysis on completion rates by genre over time |

### 3.2 User Segmentation & Retention

| Question | How Sentinel Helps |
|---|---|
| What does our D1/D7/D30 retention look like by cohort? | Automated cohort analysis — instant, no SQL |
| Binge watchers vs. casual vs. churning — who are they? | Auto-discovered behavioral segments |
| What's the first content a retained user watches? | First-touch attribution for content |
| Dashtoon readers who become DashReels viewers — how many? | Cross-platform journey analysis |
| Which user segments respond to push notifications? | Segment-to-action pipeline |

### 3.3 Monetization Intelligence

| Question | How Sentinel Helps |
|---|---|
| INR 399/3mo subscription vs. free+ads — which drives more LTV? | Monetization model comparison by segment |
| Dashcash purchase patterns — when, how much, who? | Micropayment funnel analysis |
| What's the optimal episode to paywall for max conversion? | Paywall optimization analysis |
| ARPDAU by geography — where should we spend UA budget? | Geographic revenue segmentation |
| What's user LTV from first 7 days of behavior? | Predictive LTV from early signals |

### 3.4 Growth & Geographic Expansion

| Question | How Sentinel Helps |
|---|---|
| Which UA channels drive highest-LTV users? | Channel attribution + LTV correlation |
| India vs. international — where's the growth? | Geographic cohort comparison |
| Hindi vs. English vs. Korean content — which markets? | Content-language × geography analysis |
| Organic vs. paid installs — content virality measurement | Viral coefficient tracking |
| Brazil (fastest-growing microdrama market) — should we enter? | Market opportunity sizing from existing data |

### 3.5 Creator & IP Analytics (Unique to Dashverse)

| Question | How Sentinel Helps |
|---|---|
| Which creators on Drama Dangal produce the best-performing content? | Creator performance leaderboard |
| Harlequin book popularity vs. drama performance — correlation? | IP adaptation ROI tracking |
| Frameo production cost vs. content revenue — per title | Content P&L analysis |
| Which AI models (Kling vs. Veo vs. Gemini) produce higher-engagement content? | Production tool × outcome analysis |

---

## PART 4: DEMO FLOW — THE IDEAL WALKTHROUGH

### Pre-Demo Setup
Before the call, prepare Baby Sentinel with a **simulated DashReels-like dataset** if possible (or use the closest sample dataset). The demo should feel like it's running on THEIR data.

### Demo Flow (25-30 minutes)

#### Act 1: "The Question You Can't Answer Today" (5 min)

**Open with their world, not yours.**

> "You just launched 40 Harlequin adaptations. Your CEO wants to know: which titles are resonating, which are flopping, and whether you should double down on romance-thriller or romance-comedy for the next batch. Your PM opens Mixpanel [or whatever they use] — but the dashboard doesn't have this view. They Slack the data team. The data team has a 2-day backlog. By the time they get the answer, you've already produced 5 more titles blind."

**Then show:** Open Sentinel. Type in natural language:

```
"Show me completion rates by title for all Harlequin adaptations, 
broken down by genre"
```

→ SQL generated → chart appears → answer in 15 seconds.

**Key moment:** Show the SQL that was generated. Say: "This is real SQL running against your real data. No hallucinations. Every number is traceable."

#### Act 2: "From Insight to Segment" (5 min)

Follow up with:

```
"Which user cohort has the highest completion rate on romance titles 
but hasn't watched any thriller content?"
```

→ Segment auto-created → show user count → show segment definition in SQL

**Then show the action pipeline:**
> "Now, with one click, you can push this segment to your engagement tool and run a targeted campaign: 'You loved A Fairy-Tail Ending — try this thriller next.' Insight to action in 30 seconds, not 3 days."

#### Act 3: "Deep Research Mode" (7 min)

Ask a complex question that would normally take a data analyst a full day:

```
"Give me a comprehensive analysis of our content performance: 
which genres are growing vs. declining in completion rate, 
what's our D7 retention trend by acquisition source, 
and where are we seeing content fatigue signals?"
```

→ Show the 6-agent deep research kicking in  
→ Show the research timeline (Manus-style) with real-time progress  
→ Show the research report with charts, tables, and citations  

**Key moment:** "This is the equivalent of a data analyst spending 8 hours pulling queries, making charts, and writing a report. Sentinel did it in 2 minutes."

#### Act 4: "Content Velocity Intelligence" (5 min)

This is THE hook for Dashverse specifically. Show:

```
"Compare production cost vs. engagement metrics for AI-produced 
content vs. curated content. Which has better ROI?"
```

→ Table comparing content types by cost, views, completion rate, revenue  
→ Clear winner identified  
→ Actionable recommendation: "AI-produced romance-thriller has 3x the ROI of curated content. Prioritize this for your next Frameo production batch."

#### Act 5: "The Metrics Dashboard That Builds Itself" (5 min)

Show the metrics system:
- Pre-generated metrics: DAU, MAU, ARPDAU, completion rates, churn rate
- Show how metrics are computed from real SQL (not hardcoded)
- Show the metric tree — how metrics relate to each other
- Show forecasting — "Where will our D7 retention be in 30 days?"

#### Act 6: "Your Team, Self-Served" (3 min)

Close with the org-level value:

> "Your PMs, growth managers, content heads — they all need data. Today they either write SQL or wait for someone who does. With Sentinel, anyone on your team can ask a question and get an answer in seconds. And every answer comes with a recommended action."

---

## PART 5: THE KILLER POINTERS — MOST USEFUL FOR DASHVERSE

### Top 10 Pointers Ranked by Impact

**1. CONTENT PERFORMANCE AT EPISODE LEVEL**
- They're producing 100+ titles. They NEED to know which episodes cause drop-off.
- ReelShort reportedly uses viewer feedback to modify plotlines in real-time. Dashverse needs similar intelligence.
- Sentinel can show: "Episode 4 of Title X has a 40% drop-off. Episode 5 of Title Y has 95% continuation. What's different?"
- **Impact: Directly improves content quality and reduces wasted production.**

**2. RETENTION COHORT ANALYSIS (D1/D7/D30)**
- DramaBox's 17% month-6 retention is the benchmark. Dashverse needs to know where they stand.
- Break down by: acquisition channel, first content watched, geography, device, language
- **Impact: Identifies which acquisition channels and content types drive sticky users.**

**3. HARLEQUIN TITLE TRACKING (TIMELY)**
- 40 titles launching starting THIS MONTH (April 2026)
- They need real-time performance tracking: which Harlequin adaptations work?
- Book popularity → drama performance correlation analysis
- **Impact: Directly informs which IP to license next. Multi-million dollar decisions.**

**4. CONTENT FATIGUE DETECTION**
- Their own PM JD says: "Identify leading indicators of content fatigue or over-personalization"
- 15-20% drop-off when content is formulaic (industry data)
- Sentinel can track completion rate trends by genre and flag when they decline
- **Impact: Prevents overproduction of content types that viewers are tiring of.**

**5. CROSS-PLATFORM USER JOURNEY (Dashtoon → DashReels)**
- 20M users across platforms. How many convert from comics to drama?
- Which Dashtoon series readers have the highest DashReels activation?
- **Impact: Unlocks cross-sell and increases LTV per user.**

**6. GEOGRAPHIC EXPANSION INTELLIGENCE**
- Brazil is the fastest-growing microdrama market (176M installs in Q3 2025, 6x YoY)
- Where should Dashverse prioritize next?
- Sentinel can analyze: which markets show highest organic growth, best retention, best ARPDAU
- **Impact: Guides $millions in UA spend allocation.**

**7. CREATOR ANALYTICS (YouTube-for-Microdramas Model)**
- DashReels operates like YouTube — creator-led shows alongside originals
- Need: creator performance dashboards, top creators, content quality scores
- Drama Dangal contest entries → which creators to sign?
- **Impact: Scales the supply side of their content marketplace.**

**8. AI PRODUCTION ROI**
- Frameo saves 50% time, 75% cost. But does AI-produced content PERFORM as well?
- Need to compare: AI-original engagement vs. traditionally-produced vs. creator-led
- **Impact: Validates their core thesis that AI production = better economics.**

**9. MONETIZATION MODEL OPTIMIZATION**
- DashReels: subscription (INR 399/3mo) vs. free+ads
- Dashtoon: Dashcash micropayments (3.3% daily purchase rate)
- Which model works for which user segment? Should DashReels add micropayments?
- **Impact: Directly increases ARPU.**

**10. PREDICTIVE LTV FROM EARLY SIGNALS**
- Can you predict LTV from first-week behavior? (first content watched, session count, episodes completed)
- ReelShort's North America RPD is $4.70 vs. $2.00 global. What drives that?
- **Impact: Enables smarter UA bidding and user-level treatment.**

---

## PART 6: OBJECTION HANDLING

| Objection | Response |
|-----------|----------|
| **"We have a data team"** | "Your data team is building AI models and Frameo's production pipeline — they're spending 70% of $13M on AI infra. Actioneer frees them from being the dashboard-building bottleneck. Your PMs and growth managers self-serve." |
| **"We use Mixpanel/Amplitude"** | "Those are event-level tools with predefined dashboards. When your CEO asks 'which Harlequin title is underperforming and why?' — that's an ad-hoc, multi-table question that doesn't fit a Mixpanel board. Sentinel handles that in 15 seconds." |
| **"Our data is sensitive"** | "DuckDB runs locally. No data leaves your infrastructure. We can deploy on your cloud or even on-prem." |
| **"We're a 305-person startup, can't afford another tool"** | "You're producing 100 titles and spending millions on UA. One wrong content bet costs more than a year of Sentinel. The question isn't cost — it's whether you can afford NOT to know what's working." |
| **"AI analytics = hallucinated numbers"** | "Every answer is backed by visible SQL that runs against YOUR data. We show the query, the results, and the reasoning. If the SQL is wrong, you'll see it immediately — unlike a dashboard that silently breaks." |
| **"We need recommendation engine, not analytics"** | "Recommendations tell users what to watch. Analytics tells YOU what to make. You need both. We're the second one. And our segments can feed your recommendation engine." |
| **"We'll build this internally"** | "You could. But your PM job posting requires SQL fluency because your team can't self-serve today. How long before you build a natural-language analytics layer? We're ready now, and your 40 Harlequin titles are launching this month." |

---

## PART 7: PILOT PROPOSAL

### Recommended Scope: DashReels (their growth engine)

**Phase 1 — Connect & Discover (Week 1-2)**
- Connect to event data (likely Firebase/BigQuery + custom pipeline)
- Auto-discover schema, generate entertainment-domain agents
- Auto-generate metrics: DAU, MAU, ARPDAU, completion rate, retention curves, churn
- Deliver first "wow moment": a question they couldn't answer before

**Phase 2 — Self-Serve Analytics (Week 3-4)**
- Onboard 3-5 users: PM, Growth Manager, Content Head, CEO
- Natural language queries on their actual data
- Build segment library: high-LTV, at-risk, binge watchers, genre-specific
- Content performance dashboard: per-title, per-episode, per-genre

**Phase 3 — Action Layer (Week 5-6)**
- Connect segments to their engagement tools (MoEngage/CleverTap/Braze)
- Automated alerts: content fatigue signals, retention drops, revenue anomalies
- Playbooks: re-engagement for churning users, upsell for high-engagement free users

### Success Criteria
| Metric | Target |
|--------|--------|
| Time-to-answer for ad-hoc questions | <30 seconds (vs. hours/days today) |
| Self-serve queries/week by non-SQL users | 20+ |
| Actionable insights discovered | 3+ that influence content/growth decisions |
| Stakeholder NPS | 8+ from pilot users |

### Champion Identification
- **Most likely champion:** PM for DashReels (they're hiring for this role — the incoming PM would LOVE this tool)
- **Executive sponsor:** Sanidhya Narain (CEO) or Madhur Sawhney (Founding team, Growth)
- **Technical evaluator:** Soumyadeep Mukherjee (CTO) — will want to understand data architecture

---

## PART 8: CONVERSATION PLAYBOOK

### Opening (2 min)
> "Congrats on the Harlequin deal — 40 titles launching this month is massive. We've been following Dashverse's trajectory — from Dashtoon's comic platform to DashReels hitting 10M downloads. You're at a really interesting inflection point where content velocity meets content intelligence."

### Discovery Questions (10 min)

**Start broad, go narrow:**

1. "Walk me through how your team decides what content to greenlight next — what data goes into that decision?"
2. "When Raftaar hit 1M views in 15 days, how quickly could your team understand WHY it worked? What was the process?"
3. "With 40 Harlequin titles launching — how will you know within the first week which are resonating?"
4. "Your PM JD mentions 'leading indicators of content fatigue' — have you been able to measure that today?"
5. "Who are the primary data consumers in your org? PMs, growth, content leads, execs?"
6. "What's your analytics stack today? Mixpanel? Amplitude? Custom?"
7. "What's the turnaround time from 'I have a data question' to 'I have an answer'?"
8. "How do you segment your users today — is that a manual process?"

**Listen for pain signals:**
- "We're waiting on the data team" → time-to-insight problem
- "We built a dashboard but it doesn't answer X" → ad-hoc query gap
- "We know what's happening but not why" → depth-of-analysis gap
- "We see the numbers but can't act on them" → insight-to-action gap

### Demo (25 min)
Follow the Act 1-6 flow from Part 4 above.

### Close (5 min)
> "Based on what you've shared, it sounds like [reflect their pain point]. Here's what a 6-week pilot would look like: we connect to your DashReels data, auto-generate your key metrics, and put natural-language analytics in the hands of your PM and growth team. By week 3, your incoming DashReels PM could answer any question about content performance without writing SQL. Does that sound valuable? Who should we loop in to scope the data connection?"

---

## APPENDIX: KEY NUMBERS TO REFERENCE

**Their numbers:**
- 20M users, 10M DashReels downloads
- $2M/mo revenue (Aug 2025)
- 75% completion rate on Raftaar (90% above average)
- 3.3% daily purchase rate on Dashtoon
- 50% production time reduction, 75% cost reduction with Frameo
- 305 employees
- 100 AI microdramas planned
- 40 Harlequin titles launching April 2026

**Market numbers:**
- $14B microdrama market in 2026
- 2.3B global downloads in 2025
- ReelShort: 35.7 min/day per user (vs Netflix 24.8 min)
- ReelShort: $2.98B revenue, 45M MAU
- DramaBox: 17% retention at month 6
- Brazil: 176M installs in Q3 2025 (6x YoY)
- North America RPD: $4.70 (vs $2.00 global average)
- 15-20% audience drop-off when content feels formulaic

**Sentinel numbers (for comparison):**
- Natural language → SQL → answer in <30 seconds
- 6-agent deep research in ~2 minutes (vs 8 hours analyst time)
- Zero SQL required for end users
- Every answer traceable to generated SQL

---

## Sources
- [Dashverse.ai](https://dashverse.ai/)
- [DashReels](https://www.dashreels.com/)
- [Frameo.ai](https://frameo.ai/)
- [Dashverse Series A — Peak XV](https://www.peakxv.com/companies/dashverse/)
- [Dashverse — Z47 Portfolio](https://www.z47.com/news/z47-backed-dashverse-raises-13m-series-a-to-unlock-the-next-wave-of-ai-native-entertainment)
- [Dashverse — Stellaris Portfolio](https://www.stellarisvp.com/portfolio/dashtoon)
- [Inc42 — $13M Funding](https://inc42.com/buzz/ai-entertainment-startup-dashverse-bags-13-mn-from-peak-xv-partners-others/)
- [Harlequin Partnership — BusinessWire](https://www.businesswire.com/news/home/20260330228794/en/Harlequin-and-Dashverse-to-Launch-Animated-Microdrama-Franchises)
- [Raftaar Launch — Mediabrief](https://mediabrief.com/dashverse-launches-ai-generated-microdrama-series-raftaar/)
- [100 Microdramas Plan — Business Standard](https://www.business-standard.com/companies/news/dashverse-to-launch-100-ai-microdramas-with-frameo-ai-platform-125090900320_1.html)
- [Vigloo Partnership — Afaqs](https://www.afaqs.com/news/mktg/dashverse-partners-with-vigloo-to-bring-korean-microdrama-to-india-10651199)
- [Microdrama Market — Omdia](https://omdia.tech.informa.com/pr/2026/feb/microdramas-overtake-streamers-on-mobile-engagement-says-omdia)
- [Microdrama Market — Deloitte](https://www.deloitte.com/us/en/insights/industry/technology/technology-media-and-telecom-predictions/2026/short-form-video-series.html)
- [Short Drama Apps 2025 — Sensor Tower](https://sensortower.com/blog/state-of-short-drama-apps-2025)
- [ReelShort Revenue — Appfigures](https://appfigures.com/resources/insights/short-drama-apps-trend)
- [DashReels PM Job — Weekday](https://jobs.weekday.works/dashtoon-product-manager---dashreels)
- [Content Fatigue — Social Samosa](https://www.socialsamosa.com/experts-speak/micro-dramas-scale-brands-rethink-ad-model-11436201)
- [Microdrama Engagement — Marketing Dive](https://www.marketingdive.com/news/microdrama-apps-stand-out-on-mobile-heres-what-the-numbers-say/812610/)
- [Tracxn Profile](https://tracxn.com/d/companies/dashverse/__BsbjwB9H6PgALkvYMh0Gc6QmvEhSOuRJ90t6UWQHSqU)
