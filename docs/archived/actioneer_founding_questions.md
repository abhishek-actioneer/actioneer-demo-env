# Actioneer: 50 Questions the Founding Team Must Answer
**Prepared:** April 9, 2026
**Grounded in:** 9 parallel research agents, gstack site visits to competitors, web search across G2/Crunchbase/product pages
**Framework:** Shreyas Doshi (LNO, Taste vs. Metrics) + Elad Gil (high-growth company patterns)

---

> *"The quality of your questions determines the quality of your company."* — Shreyas Doshi
>
> *"Most startups don't fail because they can't build. They fail because they build the wrong thing for the wrong customer at the wrong time."* — Elad Gil

---

## I. THE POSITIONING CRISIS

Your current positioning has three problems: it's too broad ("control plane for consumer businesses"), it claims the unbelievable ("replaces Mixpanel, CleverTap, Firebase, and RevenueCat"), and it buries the strongest idea (institutional memory). Your own ICP strategy doc calls all three of these out. The deep research confirms every criticism and adds a fourth: the "why" positioning space is getting crowded fast.

**1. You have a naming problem before you have a positioning problem.** Our research found 6+ companies already claiming to answer "why" metrics moved (Narrative BI, Tellius, TextQL, ThoughtSpot, Sisu, Amplitude's Automated Insights). If you call this "The Why Engine," you're entering a crowded conversation. If you call it "institutional memory," you'll be confused with Membria ($20/mo knowledge management tool). What is the name that communicates *cross-system context correlation* — the thing nobody else does — without using words the market already associates with someone else?

**2. Complement or replace — you have to choose.** PostHog owns the "replace Mixpanel" positioning with open-source credibility and migration guides. Your ICP doc says the "replace" claim is unbelievable. Our research confirms it. But your one-pager still says it. This is not a messaging tweak — it's a strategic fork. If you complement (layer on top of CleverTap/Mixpanel), you have a faster sale and smaller deal size. If you replace, you need to out-execute PostHog and Amplitude simultaneously. Which road? And what do you stop saying tomorrow?

**3. Your ICP strategy doc identifies the strongest net-new idea (institutional memory) and then says it was "buried rather than led."** This is a Shreyas Doshi "taste" question. Someone on the team chose to bury it. Why? Was it because the concept felt too abstract to sell? Because the product didn't exist yet? Because the gaming ICP didn't need it? Understanding why it was buried is essential to deciding whether it should be unburied — or whether the instinct to bury it was correct.

**4. The Four Question Types framework is your best strategic artifact.** It's intellectually sharp, it's differentiated, and it positions you against every competitor simultaneously. But here's the Elad Gil question: can you sell a framework, or do you need to sell a feature? When a VP of Growth in Bangalore has 15 minutes for your pitch, does "we answer all four types of questions" land? Or do they need "we auto-generate your Monday growth meeting brief"? Which sells the deal, and which sells the vision?

**5. "The Context Engine for Growth Teams" tested better than "The Why Engine" in our analysis — it's less crowded and more descriptive. But Shreyas would ask: does it pass the "tell your mom" test?** Can a founder at a Series B fintech in Jakarta explain to their board in one sentence what they bought? "We bought a context engine" doesn't land. "We bought the thing that tells us why our numbers move" does. Is clarity worth the competitive overlap?

---

## II. THE 12-18 MONTH CLOCK

This is the finding that should change your planning horizon. Amplitude launched "Automated Insights" in December 2025. It "incorporates business context to connect dots across relevant sources into a clear, data-backed story." Their current limitation: it only analyzes data within Amplitude. But ConfigCat already auto-annotates Amplitude charts with feature flag changes. The Slack integration already exists for sharing charts. Pulling context IN is 2-3 engineering quarters away. You have roughly 12-18 months before Amplitude ships comparable cross-tool context ingestion.

**6. What is your 12-month defensibility milestone?** If Amplitude ships external context ingestion by Q2 2027, what does Actioneer need to have by then that Amplitude cannot replicate? Our research says: 12 months of compounding customer context data + cross-customer pattern matching. Is that achievable? What's the minimum number of customers and months of data needed for cross-customer patterns to be valuable?

**7. Amplitude is the real competitor, not Braze.** Our research initially focused on Braze (24-36 months from building this; architecturally orthogonal). But Amplitude is already 60-70% there with Automated Insights + Chart Annotations API + existing Slack integration. Are you tracking Amplitude's roadmap? Do you know when their next Amplify conference is? What do you expect them to announce?

**8. The Elad Gil "build speed" question: can your team ship the context graph in 8 weeks?** Not the full vision — the minimum version that captures deploy events + campaign changes + metric movements and correlates them on a timeline. If you can't ship this in 8 weeks, you're in a feature race you'll lose. If you can, you have 10 months to compound before Amplitude arrives. What is your honest engineering velocity assessment?

**9. Should you build the context ingestion layer and sell it TO Amplitude as a partnership?** This is the Elad Gil "pivot before you need to" question. If Amplitude is going to ship this anyway, could Actioneer be the best implementation of cross-tool context for Amplitude's platform? Is there a world where Actioneer is the institutional memory plugin for existing analytics tools rather than a standalone product? What's the strategic upside and downside?

---

## III. THE SLACK PROBLEM

This is your highest-risk finding. India accounts for 4.78% of Slack's web traffic. A 2019 poll of Indian startup founders showed WhatsApp at 37%, Slack at 29%. A 2025 CTO blog describes moving FROM Slack TO WhatsApp because team members "consistently ignored" Slack. If your ICP is mid-stage growth apps in India/SEA/MENA, and your product depends on capturing context from Slack — you have a structural dependency on a tool your customers may not use.

**10. Have you actually audited what communication tools your existing customers use?** Not what tools they say they use in sales calls — what tools they actually message in daily. If the answer is "we don't know," that's the first thing to find out before writing a line of context-capture code.

**11. Our research recommends starting with structured sources (Git, CI/CD, campaign APIs, feature flags) instead of chat.** These have clean APIs, are universally used, and provide more reliable signal. But does this change the product narrative? "We capture your deploys and campaign changes" is less compelling than "we listen to your team's conversations and connect them to your metrics." Is the technically correct approach also the narratively weakest one?

**12. The Schbang pattern: companies migrate to Slack as they scale past 100-200 people.** Should you narrow the ICP to Series B+ companies that have already adopted Slack/Teams? This filters out the WhatsApp-dependent early-stage companies but also shrinks your addressable market. What percentage of your current pipeline would survive this filter?

**13. Microsoft Teams holds 37-44% global market share vs. Slack's 13-18%. Google Chat is bundled with Google Workspace, which is dominant among Indian startups.** If you build for Slack first, you're building for the minority tool. Teams and Google Chat APIs are robust. What's the integration priority order, and does the team have bandwidth to support three chat platforms from day one?

**14. Here's the uncomfortable question: is chat even the right context source?** Growth teams in India communicate on WhatsApp because it's fast and informal. The important decisions — campaign launches, budget approvals, feature rollouts — happen in *systems*, not in *chat*. A campaign launch shows up in Meta Ads Manager. A deploy shows up in GitHub. A budget change shows up in a spreadsheet. Chat is where people *discuss* these events, but the events themselves are in structured tools. Could the product work without chat integration entirely?

---

## IV. FEATURE VS. PRODUCT

Both Amplitude and Mixpanel have chart annotation features today. Mixpanel has a documented GitHub-to-Mixpanel annotation pipeline. ConfigCat auto-annotates Amplitude charts with feature flag changes. The distance from "annotations" to "context engine" is measured in engineering quarters, not years.

**15. Shreyas Doshi's "Overhead vs. Leverage" framework: is building a standalone product overhead when building a plugin would be leverage?** An Amplitude/Mixpanel plugin that enriches their charts with cross-tool context would have instant distribution (their user bases) and instant credibility (their brand). A standalone product requires you to also build the charting, the analytics, the data pipeline — all of which are commoditizing. Is the standalone product the highest-leverage play?

**16. What is the difference between a chart annotation and true institutional memory — in terms the customer can feel?** Our research says: annotations are point-in-time markers ("launched feature X on March 5"). Institutional memory is the full context graph ("launched X because segment Y churned due to complaint Z, while campaign W ran and iOS release was delayed 3 days"). But does the customer feel that difference in week 1? Or only after 6 months of accumulated context?

**17. If Amplitude adds a Slack integration that auto-annotates charts, what do you still have that they don't?** This is the "day-after" question. If Amplitude ships 80% of your value prop as a feature, what's the remaining 20% that justifies a standalone product? Is it depth of context correlation? Cross-tool coverage? The growth meeting brief? The execution layer? Name the thing that survives.

**18. The Elad Gil "wedge" principle: what is the smallest thing you can sell that creates irreversible adoption?** A weekly Slack message saying "here's why your numbers moved this week" could be the wedge. It requires no dashboard, no login, no onboarding. If 3 customers respond to a manually-crafted version with "holy shit, how do you know this" — you've validated the product. Have you tried this manually?

---

## V. THE WEDGE: GROWTH MEETING AUTOPILOT

Our research confirms white space: no mainstream tool automates growth-specific meeting prep. Growth PMs spend 30-40% of time on operational friction. 2-4 hours per cycle pulling data from multiple sources. The "walk into Monday's meeting with answers assembled" narrative is viscerally compelling and instantly understood.

**19. Is the growth meeting brief the Trojan horse that makes everything else work?** You lead with "we automate your Monday growth meeting." That's understood in one sentence. The customer connects their data sources. The context engine builds silently in the background. Three months later, they can't leave because the system knows their history. Is this the right sequence: meeting → context → memory → moat?

**20. What does the growth meeting brief contain, specifically?** This is where abstract strategy meets concrete product. Sketch the actual artifact. Is it:
- Top 5 metric movements this week + what caused each one?
- Experiment results with statistical significance?
- Anomaly alerts with AI-generated explanations?
- Action items assigned to specific people?
- A comparison to the same week last year?

The answer determines the data connections required, the engineering effort, and the time to value. Don't answer with "all of the above." Rank them.

**21. How is this different from a scheduled Amplitude or Mixpanel report?** Both platforms offer automated reports via email/Slack. The customer will ask this question. Your answer must be: "Because our brief includes context from your deploys, your campaign changes, and your team's decisions — not just the numbers." If that answer doesn't land, you're selling a scheduled report with extra steps.

**22. Shreyas Doshi's "opportunity cost" question: if you build the growth meeting brief, what do you NOT build?** The roadmap currently includes: SDK for each major platform, real-time funnel monitoring, rrweb session replays, on-prem deployment, config-store/ZK-integration, in-app push notifications, SMS/WhatsApp/Email, NL → Rule JSON, MMM for campaign budgets, automated classification models. If the growth meeting brief is the next 8 weeks, which of these gets pushed to 2027? Can you make that trade?

---

## VI. CROSS-CUSTOMER LEARNING

The defensibility research revealed a critical gap: institutional memory creates switching costs (single-tenant moat) but not network effects (platform moat). Without cross-customer learning, each customer's data benefits only that customer. A well-funded competitor with better UX could still win new customers.

**23. What does the cross-customer pattern library look like, concretely?** "Companies similar to yours that paused Meta spend during Ramadan saw X% retention dip" is the example. But how many customers do you need before these patterns are statistically meaningful? 10? 50? 200? If the answer is 50+, this is a 2028 feature, not a 2026 moat.

**24. Is there a privacy-preserving way to share cross-customer patterns?** Your ICP cares about data sovereignty. If you're using Customer A's context to advise Customer B, you need ironclad privacy guarantees. Have you thought about federated learning, differential privacy, or anonymized aggregation? Or is this a "we'll figure it out later" hand-wave?

**25. The Elad Gil "data network effect" test: does your product get meaningfully better for customer #100 than it was for customer #1?** If yes, you have a platform moat. If no, you have a tool. Tools get displaced. Platforms don't. What specifically improves for customer #100?

---

## VII. ICP SHARPNESS

The transition from GameRamp (mobile game studios, $100K+/month UA) to Actioneer ("consumer-facing businesses") lost the specificity that made GameRamp credible. Vertical SaaS companies report 35-60% higher retention than horizontal ones. No successful example was found of a startup going from narrow gaming to broad consumer.

**26. "Who is this NOT for?" — answer in one sentence.** If you can't answer this instantly, your positioning is too broad. The Veeva model: "CRM for pharma, not CRM for everyone." The Toast model: "POS for restaurants, not POS for retail." What's the Actioneer version?

**27. Gaming was your beachhead. You had 50+ studios in JP, VN, IN, TR.** That is real traction with a specific customer. The ICP strategy doc says the shift to Actioneer is "logical as an expedient." But is it premature? Would it be sharper to be "The Context Engine for Mobile Gaming Growth Teams" — own the vertical, build the cross-customer pattern library with gaming data, and THEN expand? Or has the gaming market proven too small?

**28. The ICP strategy doc identifies the sweet spot as "mid-stage growth apps in IN, SEA, MENA, TR, LatAm."** But our research shows this ICP varies enormously by country:
- India: WhatsApp-dominant, $0.03 CPIs, RBI-regulated fintech is high-value
- Turkey: Rising UA costs (+29%), Slack adoption unclear
- SEA: Vietnam/Indonesia have data localization requirements
- MENA: 52% cite market saturation as top challenge

Are you building one product for five markets, or five products disguised as one? Which SINGLE country do you deploy to first, and why?

**29. Shreyas Doshi's "ICP sharpening" exercise: describe your ideal first 10 customers with name-level specificity.** Not "Series B fintech in India." Actual company names. "CRED's growth team." "Swiggy's UA team." "Dream11's monetization team." Can you name 10? If not, you don't know your ICP — you have a hypothesis.

---

## VIII. THE FORWARD-DEPLOYED MODEL

Your one-pager says "a forward-deployed engineering team works alongside you to convert rituals into agentic workflows." This is Palantir's model at pre-seed scale. Palantir did this with $1B+ in funding and a sales team. You're doing it with $5.4M.

**30. Is forward-deployed engineering a feature or a crutch?** Elad Gil's test: if you removed the forward-deployed engineers tomorrow, would the product still deliver value? If yes, the engineers are an accelerant. If no, you don't have a product — you have a services business with software attached. Which is it?

**31. What is the self-serve version of the forward-deployed model?** The one-pager describes converting "steady-state reviews" into agentic workflows. What if this conversion was a product feature? A wizard that says: "Describe your Monday growth meeting format. What metrics do you review? What tools do you pull from? We'll build the automated version." Is that buildable?

**32. Unit economics of forward-deployed: how many customers can one engineer support?** If the answer is 3-5, you need 20-40 engineers to serve 100 customers. At $5.4M in funding, that's unsustainable before Series A. What's the path to 10:1 or 20:1 ratios?

---

## IX. THE FINANCING MARKETPLACE

You have a $10M+ annual disbursement volume financing marketplace. This is real revenue and real distribution. But it's also a completely different product narrative from "The Context Engine for Growth Teams."

**33. Does the financing marketplace help or hurt the context engine positioning?** Three possible answers:
- **Helps:** "We help you understand your growth, then fund it." Full stack.
- **Hurts:** "Wait, are you an analytics tool or a lending platform?" Confusion.
- **Irrelevant:** Financing is a separate business unit with its own GTM.

Which is it? If the answer is "helps," how do you tell that story without it sounding like two companies in a trenchcoat?

**34. The Grow Score is an underexplored application of institutional memory.** If Actioneer knows a company's decision history, metric trajectory, and execution quality over 12 months, that's a fundamentally better credit signal than static financials. Is the financing marketplace actually the BEST customer for the context engine — not the growth team, but the underwriter? Could the differentiator be: "We underwrite growth loans using institutional memory, not just spreadsheets"?

---

## X. EXISTENTIAL QUESTIONS

These are the questions where you need to be honest with yourselves, not with investors.

**35. What is the honest state of the product today?** The roadmap lists KTLO items: deploy in Vastu OCI, get boards running smoothly in prod, hide playbooks from front-end. This reads like stabilization work, not a product ready to add a major new capability. Can the team absorb the context engine build on top of KTLO, or does something have to give?

**36. If Amplitude acquires Interloom ($16.5M, "context graphs" from operational records) or Mem0 ($24M, AI memory infrastructure) — what happens to your strategy?** This is not hypothetical. These companies are in acquisition range. Amplitude's Automated Insights + an acquired context graph = your entire value proposition. What's the contingency?

**37. The memory compound effect has an uncomfortable corollary: you need 6-12 months of data before the product is meaningfully better than a manual spreadsheet.** During that 6-12 months, what is the customer paying for? If the answer is "the same thing they get from Mixpanel, but with a promise it'll get better," that's a hard sell. What delivers value in month 1?

**38. Your ICP is "analytically underserved" — meaning they don't have data teams.** But the Context Engine requires them to have: (a) connected data sources, (b) structured deployment pipelines, (c) campaign tools with API access, (d) ideally Slack/Teams. Are analytically underserved companies actually technically mature enough to be Context Engine customers? Or is there a paradox: the companies that need this most are the ones least equipped to use it?

**39. Elad Gil's "team-market fit" question: does your team's DNA match the product you're building?** GameRamp was built by DeepMind AI researchers + Zynga/EA/King operators + Matrix VC. That team is perfect for ML-powered gaming analytics. Is it also the right team for building a cross-tool context ingestion platform that integrates with Slack, Git, Meta Ads, and 15 other APIs? That's a different engineering challenge — more plumbing, less ML.

---

## XI. VALIDATION & NEXT STEPS

These questions are designed to be answered this week, not next quarter.

**40. Can you validate the context engine without writing code?** Our research recommends: pick 3 existing customers. For 2 weeks, manually watch their Slack, Git deploys, and campaign changes. Annotate their metric charts by hand. Deliver "Here's why your numbers moved this week" as a weekly Slack message on Monday morning. If they respond with urgency and willingness to pay — build it. If they shrug — the intellectual argument is stronger than the market pull.

**41. Call 5 prospects this week and ask one question: "When your metrics move unexpectedly, what's the first thing you do?"** Don't pitch. Don't explain the product. Just listen. If they say "I ask the data team and wait 3 days," you have your opening. If they say "I check the dashboard and move on," the pain isn't acute enough. Record the exact words they use — that's your messaging.

**42. Run the "Monday morning test" with your own team.** Next Monday, have someone prepare the growth meeting brief for one of your customers using only data they can gather from that customer's connected tools + Slack in 90 minutes. Is the output valuable? How long did it take? What was missing? This tells you what the automated version needs to do.

**43. What is the smallest possible version you can put in a customer's hands in 4 weeks?** Not the vision. Not the platform. The single smallest artifact that demonstrates "we know why your numbers moved, and here's the context you were missing." Is it a Slack bot that posts a weekly summary? A Notion page that auto-updates? A PDF? Define it, scope it, ship it.

---

## XII. THE META-QUESTION

**44. Shreyas Doshi asks: "What is the one thing that, if true, makes everything else irrelevant?"**

For Actioneer, that thing might be: *Companies will pay for context-enriched explanations of their metrics if — and only if — the explanations are delivered inside the workflow where they make decisions (Monday meeting, Slack channel, weekly review), not in a separate dashboard they have to log into.*

If this is true, the wedge is the meeting brief, the moat is the context graph, and the dashboard is a nice-to-have. If this is false — if customers want a dashboard with context annotations — you're building a Mixpanel feature, not a company.

**Which is it?**

**45. Elad Gil asks: "What would you need to believe for this to be a $1B company?"**

You'd need to believe:
- (a) Cross-tool context correlation is a new product category, not a feature
- (b) The context graph compounds faster than incumbents can copy it
- (c) Growth teams in emerging markets will pay $500-2,000/month for this
- (d) Cross-customer pattern matching creates defensible network effects
- (e) The ICP expands from consumer apps to all businesses with growth teams

**Which of (a) through (e) are you most confident about? Which keeps you up at night?**

---

## XIII. THE FIVE DECISIONS TO MAKE THIS WEEK

Based on everything in this research, here are the five decisions that cannot wait:

**46. Complement or replace?** Stop saying you replace Mixpanel/CleverTap. Choose: complement layer or full-stack alternative. This changes every piece of sales collateral, every pitch, every integration priority.

**47. Structured sources or chat?** Start context capture with Git/CI/CD + campaign APIs + feature flags. Make chat (Slack/Teams/Google Chat) an enhancement layer, not the foundation. This de-risks the WhatsApp problem and provides more reliable signal.

**48. Growth meeting brief as the wedge?** If yes, define the artifact, build a manual prototype this week for 3 customers, and validate before writing code.

**49. Single country first?** Pick one: India (largest market, WhatsApp risk, RBI fintech opportunity) or a Slack-dominant market (could be a smaller SEA market or Turkey). Deploy there first and learn.

**50. What do you STOP building?** The roadmap has: SDKs for 4 platforms, rrweb session replays, real-time funnel monitoring, config-store/ZK-integration, in-app push, SMS/WhatsApp/Email, NL → Rule JSON, MMM, automated classification models. If the Context Engine is the differentiator, at least half of this list must move to 2027 or later. Which half?

---

*These questions are designed to be uncomfortable. A startup that can answer all 50 honestly has either found product-market fit or knows exactly what it needs to learn next. Either outcome is valuable.*

*Grounded in research from: Amplitude product pages, Braze Forge announcements, G2 reviews, CleverTap/MoEngage gap analysis, AfterChange.io (defunct), Membria.ai, Narrative BI, Tellius, TextQL, ThoughtSpot, Databricks Genie, Slack API documentation, India DPDPA/RBI regulations, EU AI Act Annex III, IdeaLift Decision Decay report, Nucleus Research data half-life study, Panopto institutional knowledge data, McKinsey attrition cost estimates, AppsFlyer/Adjust seasonal analysis, and direct site visits via headless Chromium.*
