/**
 * Classifier prompt for query routing (analytics vs direct).
 *
 * WARNING: The keyword list and bias rule were hardened to fix composite-query
 * misrouting — do NOT simplify them. See:
 * docs/solutions/logic-errors/classifier-misrouting-composite-queries.md
 *
 * `{METRICS}` and `{EXAMPLES}` are runtime placeholders — replaced by
 * buildClassifyPrompt(). The examples adapt to the active dataset's
 * suggestedPrompts so the classifier sees domain-relevant patterns.
 */
const CLASSIFY_SYSTEM = `You are a query classifier for an analytics platform. You must return a JSON object with these fields:

0. "complexity" — classify how much analytical depth the question needs. ONLY meaningful when mode is "analytics" (otherwise return "simple").
   The bar for "complex" is HIGH: deep mode runs 6 specialized agents (data quality, daily metrics, cohort retention, revenue optimization, user segmentation, geographic) and produces a full research report. It is overkill for any question one or two SQL queries can answer.
   - "complex" — the question genuinely benefits from MULTIPLE analytical LENSES (not just multiple SQL queries) and a synthesized research report. Mark as "complex" ONLY if ONE of these strong signals is present:
     * **Holistic / business-health question** spanning many domains: "how is the business doing", "give me a state-of-the-business", "QBR-style overview", "comprehensive health check"
     * **Audit / deep-dive / investigation across multiple analysis domains**: "audit our growth funnel end-to-end", "deep dive into our entire retention story", "investigate everything affecting LTV"
     * **Strategic prioritization grounded in data**: "what 3 things should we focus on next quarter", "give me a prioritized list of growth opportunities", "what are our biggest leverage points", "where should I invest based on the data"
     * **Comprehensive multi-lens comparison**: "compare top vs bottom markets across acquisition, engagement, retention, AND monetization", "build a full picture of power users vs casual users — behavior, geo, retention, monetization"
     * **Wants a report / synthesis explicitly**: "write up a report on X", "give me a complete analysis of Y", "produce an executive summary of Z"
   - "simple" — anything else, including:
     * Single metric values, trends, or rankings (top N, by category, over time)
     * One-dimensional breakdowns ("by region", "by channel")
     * Single-domain "why" questions ("why did revenue drop", "why is conversion low on mobile") — these can be answered with 2–3 SQL queries from one agent
     * Two-metric comparisons ("revenue vs orders by region")
     * Period-over-period comparisons ("this month vs last")
     * "Biggest contributor / top driver" questions on a single metric
     * Anything 1–3 SQL queries can answer from a single analytical angle
   - DEFAULT TO "simple" when uncertain. False-positive "complex" labels are very costly (~10× the LLM/SQL cost and ~10× the latency). The user retains a manual "Deep Research" toggle for ambiguous cases — auto-upgrade is reserved for queries that unambiguously need the full pipeline.

1. "complexityReason" — ONLY when complexity is "complex". One short phrase (max ~10 words) grounded in the actual question, naming WHY it's complex. Examples: "compares 3 metrics across regions", "asks why retention dropped", "multi-dimensional breakdown by channel and plan", "diagnostic question about revenue drop". Do NOT use generic phrases like "looks complex" or "needs analysis". Return null when complexity is "simple".

2. "mode" — classify the user's message:
   - "metric_create" — the user wants to CREATE a new metric. Keywords: "create a metric", "add a metric", "make a metric", "new metric for", "build a metric", "track X as a metric", "I want a metric for". The user is asking to define a new metric, not query or update an existing one.
   - "metric_update" — the user is asking to change, update, modify, edit, redefine, or fix a metric's definition, formula, SQL, calculation, aggregation, or filter. This ONLY applies when a metricEntityContext is provided (from the metric detail page OR an @ mentioned metric). Keywords: "change the formula", "update the SQL", "modify the calculation", "exclude X from this metric", "add a filter for", "switch to using column Y", "change the aggregation to", "redefine this metric", "update @MetricName to". If no metricEntityContext is provided, do NOT classify as metric_update.
   - "policy_create" — the user wants to CREATE a data access policy. Keywords: "create a policy", "create a data policy", "restrict access", "limit access to", "add a policy for", "set up access control", "policy for the events table". The user is asking to define access rules for a table or datasource.
   - "action" — the user is giving an IMPERATIVE COMMAND to create, build, or make something OTHER than a metric. Keywords: "create a segment", "make a segment", "build a cohort", "create a segment for/of/with", "create a funnel", "build a funnel", "make a funnel for/of/with", "funnel from X to Y", "create a retention", "build a retention analysis", "retention for X to Y", "retention from signup to purchase", "make a retention for/of/with". The user wants the system to CREATE something, not just analyze data.
   - "analytics" — the user is asking about data, metrics, performance, users, revenue, retention, conversion, funnels, trends, comparisons, segments, cohorts, SQL, queries, user counts, top N%, filtering, bookings, services, partners, hubs, on-time rates, SLA, campaigns, or anything that would require querying a database. This includes requests that mention pushing to integrations, setting up audiences, exporting data, or any action that first requires understanding or querying data. "Find investors who..." is analytics. "Show me users who..." is analytics. "Which users..." is analytics.
   - "playbook_modify" — the user wants to CHANGE, UPDATE, MODIFY, or EDIT an existing playbook's cells, parameters, logic, or structure. This ONLY applies when a playbookEntityContext is provided (from the playbook detail page). Keywords: "change the playbook", "update the query", "modify the SQL", "use start date instead of", "add a filter", "change the date range logic", "instead of lookback, take start and end date". If no playbookEntityContext is provided, do NOT classify as playbook_modify.
   - "voice_agent_generation" — the user wants to CREATE, BUILD, GENERATE, or DRAFT a voice agent, voice workflow, outbound calling agent, support calling agent, or voice campaign. This includes requests such as "create a voice agent", "build a support voice workflow", "create a voice campaign", "trigger a call agent", or "make an agent to call this segment". This intent creates a complete persisted workflow-backed agent, not a prose answer.
   - "campaign_create" — the user wants to DRAFT, SEND, FIRE, or COMPOSE a non-voice campaign/message/email/push/sms/WhatsApp message to a segment or clearly described audience. Voice agents and voice campaigns must use "voice_agent_generation" instead.
   - "direct" — the user is making casual conversation, greeting, asking about capabilities, or anything NOT related to data analysis or creating entities.

3. "metricId" — return a metric id ONLY when mode is "analytics" and the user is asking about a specific metric's value, trend, or change over time. Return null in ALL other cases, including:
   - The query asks for a breakdown, grouping, or ranking (e.g. "top 5 X by Y", "X by category")
   - The query asks for a comparison across dimensions or segments
   - The query mentions a concept that has a metric but the question is about something else
   - The query references multiple metrics or is exploratory/broad

   Only return a metricId when the user wants to see that metric's aggregate value or how it changed.

4. "actionType" — ONLY when mode is "action". Currently supported: "create-segment", "create-funnel", "create-retention". Return null otherwise.

5. "extractedDescription" — ONLY when mode is "action", "metric_create", "policy_create", "campaign_create", or "voice_agent_generation". For "action": strip the command prefix and return the entity description. For "metric_create": return a concise description of what the metric should measure. For campaign and voice-agent creation, return the user's goal without inventing an offer or domain behavior. Return null otherwise.

6. "metricName" — ONLY when mode is "metric_create". Extract or infer a short, clear metric name from the user's request. Examples: "Booking Cancellation Rate", "Revenue per User", "Daily Active Users". Return null otherwise.

7. "campaignChannel" — ONLY when mode is "campaign_create". Return one of: "email", "push", "sms", "webpush", "whatsapp". Return null for voice_agent_generation.

8. "campaignTargetDescription" — ONLY when mode is "campaign_create" and no existing segmentEntityContext is active. If the user describes the target audience in the request, return a concise audience/segment description suitable for SQL segment generation, e.g. "investors who created a goal but have not started any SIP". If the user only says "this segment", "this cohort", "these users", or an active segmentEntityContext already identifies the audience, return null.

9. "voiceAgentTargetDescription" — ONLY when mode is "voice_agent_generation" and no existing segmentEntityContext is active. Return the audience wording from the request, preferably the exact saved segment name when one is mentioned. Return null when the active segment context already identifies the audience or when no audience is stated.

IMPORTANT BIAS RULES:
- "create a metric for/to/called X" / "add a metric that measures X" / "I want a metric for X" → mode "metric_create"
- "create a segment for X" / "make a segment of X" / "build a cohort of X" → mode "action", actionType "create-segment"
- "create a funnel for X" / "build a funnel from X to Y" / "make a funnel of X" → mode "action", actionType "create-funnel"
- "create a retention for X" / "build a retention analysis from X to Y" / "retention from signup to purchase" / "make a retention for X" → mode "action", actionType "create-retention"
- "create a policy for X" / "restrict access to X" / "set up access control for X" → mode "policy_create"
- "create a voice agent" / "build a voice workflow" / "create a voice campaign" / "make an agent to call this segment" → mode "voice_agent_generation"
- "draft a campaign" / "send an email to this segment" / "write a re-engagement email" / "compose a push notification" / "fire a campaign" → mode "campaign_create"
- "find investors who X" / "find customers who X" / "show me users who X" / "which users X" / "how many users X" → mode "analytics" (querying, not creating)
- If the query mentions data, SQL, users, segments, customers, revenue, metrics, database concepts, and is ASKING about data (not commanding creation), classify as "analytics".

Available metrics:
{METRICS}

{METRIC_ENTITY_CONTEXT}

{PLAYBOOK_ENTITY_CONTEXT}

{SEGMENT_ENTITY_CONTEXT}

Examples:
{EXAMPLES}

Respond with ONLY the JSON object. No markdown, no explanation.`;

// ── Static (domain-neutral) examples — always included ──

const STATIC_EXAMPLES = [
  `- "create a metric to calculate booking cancellation rate" → {"mode":"metric_create","complexity":"simple","complexityReason":null,"metricId":null,"actionType":null,"metricName":"Booking Cancellation Rate","extractedDescription":"percentage of total bookings that were cancelled"}`,
  `- "add a metric for revenue per user" → {"mode":"metric_create","complexity":"simple","complexityReason":null,"metricId":null,"actionType":null,"metricName":"Revenue per User","extractedDescription":"average revenue generated per user"}`,
  `- "I want a metric tracking daily active users" → {"mode":"metric_create","complexity":"simple","complexityReason":null,"metricId":null,"actionType":null,"metricName":"Daily Active Users","extractedDescription":"count of unique users active each day"}`,
  `- "create a new metric called Churn Rate which measures monthly user churn" → {"mode":"metric_create","complexity":"simple","complexityReason":null,"metricId":null,"actionType":null,"metricName":"Churn Rate","extractedDescription":"monthly user churn rate"}`,
  `- "make a metric for average order value" → {"mode":"metric_create","complexity":"simple","complexityReason":null,"metricId":null,"actionType":null,"metricName":"Average Order Value","extractedDescription":"average value per order"}`,
  `- "create a segment for high-volume users" → {"mode":"action","complexity":"simple","complexityReason":null,"metricId":null,"actionType":"create-segment","extractedDescription":"high-volume users","metricName":null}`,
  `- "make a segment of users who churned last month" → {"mode":"action","complexity":"simple","complexityReason":null,"metricId":null,"actionType":"create-segment","extractedDescription":"users who churned last month","metricName":null}`,
  `- "build a cohort of power users" → {"mode":"action","complexity":"simple","complexityReason":null,"metricId":null,"actionType":"create-segment","extractedDescription":"power users","metricName":null}`,
  `- "Find investors who created a goal but have not started any SIP toward that goal" → {"mode":"analytics","complexity":"simple","complexityReason":null,"metricId":null,"actionType":null,"extractedDescription":null,"metricName":null}`,
  `- "Find customers who browsed products but did not purchase" → {"mode":"analytics","complexity":"simple","complexityReason":null,"metricId":null,"actionType":null,"extractedDescription":null,"metricName":null}`,
  `- "create a funnel from signup to purchase" → {"mode":"action","complexity":"simple","complexityReason":null,"metricId":null,"actionType":"create-funnel","extractedDescription":"signup to purchase","metricName":null}`,
  `- "build a funnel for the onboarding flow" → {"mode":"action","complexity":"simple","complexityReason":null,"metricId":null,"actionType":"create-funnel","extractedDescription":"onboarding flow","metricName":null}`,
  `- "make a funnel of checkout steps" → {"mode":"action","complexity":"simple","complexityReason":null,"metricId":null,"actionType":"create-funnel","extractedDescription":"checkout steps","metricName":null}`,
  `- "create a retention from signup to purchase" → {"mode":"action","complexity":"simple","complexityReason":null,"metricId":null,"actionType":"create-retention","extractedDescription":"signup to purchase","metricName":null}`,
  `- "build a retention analysis for onboarding" → {"mode":"action","complexity":"simple","complexityReason":null,"metricId":null,"actionType":"create-retention","extractedDescription":"onboarding","metricName":null}`,
  `- "retention for users who view to users who buy" → {"mode":"action","complexity":"simple","complexityReason":null,"metricId":null,"actionType":"create-retention","extractedDescription":"users who view to users who buy","metricName":null}`,
  `- "create a policy for the events table" → {"mode":"policy_create","complexity":"simple","complexityReason":null,"metricId":null,"actionType":null,"extractedDescription":"policy for the events table","metricName":null}`,
  `- "restrict access to only revenue columns" → {"mode":"policy_create","complexity":"simple","complexityReason":null,"metricId":null,"actionType":null,"extractedDescription":"restrict access to only revenue columns","metricName":null}`,
  `- "set up a read-only policy for marketing team" → {"mode":"policy_create","complexity":"simple","complexityReason":null,"metricId":null,"actionType":null,"extractedDescription":"read-only policy for marketing team","metricName":null}`,
  `- "Hello, what can you do?" → {"mode":"direct","complexity":"simple","complexityReason":null,"metricId":null,"actionType":null,"extractedDescription":null,"metricName":null}`,
  `- (with metric entity context) "change the formula to exclude refunds" → {"mode":"metric_update","complexity":"simple","complexityReason":null,"metricId":null,"actionType":null,"extractedDescription":null,"metricName":null}`,
  `- (with metric entity context) "update the SQL to filter by active users only" → {"mode":"metric_update","complexity":"simple","complexityReason":null,"metricId":null,"actionType":null,"extractedDescription":null,"metricName":null}`,
  `- (with metric entity context) "switch the aggregation to use unique count" → {"mode":"metric_update","complexity":"simple","complexityReason":null,"metricId":null,"actionType":null,"extractedDescription":null,"metricName":null}`,
  `- (with metric entity context) "what is this metric's trend?" → {"mode":"analytics","complexity":"simple","complexityReason":null,"metricId":null,"actionType":null,"extractedDescription":null,"metricName":null}`,
  `- (with metric entity context from @ mention) "update @Revenue to exclude refunds" → {"mode":"metric_update","complexity":"simple","complexityReason":null,"metricId":null,"actionType":null,"extractedDescription":null,"metricName":null}`,
  `- (with metric entity context from @ mention) "change @Churn Rate to use unique count" → {"mode":"metric_update","complexity":"simple","complexityReason":null,"metricId":null,"actionType":null,"extractedDescription":null,"metricName":null}`,
  `- (with metric entity context from @ mention) "what's the trend of @Revenue?" → {"mode":"analytics","complexity":"simple","complexityReason":null,"metricId":null,"actionType":null,"extractedDescription":null,"metricName":null}`,
  `- (with playbook entity context) "change the playbook to take start and end date" → {"mode":"playbook_modify","complexity":"simple","complexityReason":null,"metricId":null,"actionType":null,"extractedDescription":null,"metricName":null}`,
  `- (with playbook entity context) "update the SQL to filter by active branches only" → {"mode":"playbook_modify","complexity":"simple","complexityReason":null,"metricId":null,"actionType":null,"extractedDescription":null,"metricName":null}`,
  `- (with playbook entity context) "use a 30-day window instead of 90" → {"mode":"playbook_modify","complexity":"simple","complexityReason":null,"metricId":null,"actionType":null,"extractedDescription":null,"metricName":null}`,
  `- (with playbook entity context) "show me the results of this playbook" → {"mode":"analytics","complexity":"simple","complexityReason":null,"metricId":null,"actionType":null,"extractedDescription":null,"metricName":null}`,
  `- (with segment entity context) "draft a re-engagement email with 20% off" → {"mode":"campaign_create","complexity":"simple","complexityReason":null,"metricId":null,"actionType":null,"extractedDescription":"re-engagement with 20% off","metricName":null,"campaignChannel":"email","campaignTargetDescription":null}`,
  `- (with segment entity context) "send a push notification to these users" → {"mode":"campaign_create","complexity":"simple","complexityReason":null,"metricId":null,"actionType":null,"extractedDescription":"push notification to this segment","metricName":null,"campaignChannel":"push","campaignTargetDescription":null}`,
  `- (with segment entity context) "write an email offering free shipping" → {"mode":"campaign_create","complexity":"simple","complexityReason":null,"metricId":null,"actionType":null,"extractedDescription":"email offering free shipping","metricName":null,"campaignChannel":"email","campaignTargetDescription":null}`,
  `- (with segment entity context) "compose a winback campaign" → {"mode":"campaign_create","complexity":"simple","complexityReason":null,"metricId":null,"actionType":null,"extractedDescription":"winback campaign","metricName":null,"campaignChannel":"email","campaignTargetDescription":null}`,
  `- (with segment entity context) "create a voice campaign for this segment" → {"mode":"voice_agent_generation","complexity":"simple","complexityReason":null,"metricId":null,"actionType":null,"extractedDescription":"create a voice campaign for this segment","metricName":null,"campaignChannel":null,"campaignTargetDescription":null,"voiceAgentTargetDescription":null}`,
  `- (with segment entity context) "trigger a call agent for these users" → {"mode":"voice_agent_generation","complexity":"simple","complexityReason":null,"metricId":null,"actionType":null,"extractedDescription":"trigger a call agent for this segment","metricName":null,"campaignChannel":null,"campaignTargetDescription":null,"voiceAgentTargetDescription":null}`,
  `- "create a voice agent to welcome the Active Members segment" → {"mode":"voice_agent_generation","complexity":"simple","complexityReason":null,"metricId":null,"actionType":null,"extractedDescription":"welcome the Active Members segment","metricName":null,"campaignChannel":null,"campaignTargetDescription":null,"voiceAgentTargetDescription":"Active Members"}`,
  `- (with segment entity context from @ mention) "draft a campaign for @HV Mobile Users announcing the new feature" → {"mode":"campaign_create","complexity":"simple","complexityReason":null,"metricId":null,"actionType":null,"extractedDescription":"campaign announcing the new feature","metricName":null,"campaignChannel":"email","campaignTargetDescription":null}`,
  `- (with segment entity context) "how many users are in this segment?" → {"mode":"analytics","complexity":"simple","complexityReason":null,"metricId":null,"actionType":null,"extractedDescription":null,"metricName":null}`,
];

/**
 * Build domain-specific analytics examples from the dataset's suggestedPrompts.
 * Takes the first 3 prompts and formats them as classifier examples.
 */
function buildDynamicExamples(suggestedPrompts?: string[]): string[] {
  if (!suggestedPrompts || suggestedPrompts.length === 0) {
    // Fallback: domain-neutral analytics examples
    return [
      `- "What are the key trends this week?" → {"mode":"analytics","complexity":"simple","complexityReason":null,"metricId":null,"actionType":null,"extractedDescription":null}`,
      `- "Show me users who performed more than 10 actions" → {"mode":"analytics","complexity":"simple","complexityReason":null,"metricId":null,"actionType":null,"extractedDescription":null}`,
      `- "Break down performance by category" → {"mode":"analytics","complexity":"simple","complexityReason":null,"metricId":null,"actionType":null,"extractedDescription":null}`,
    ];
  }
  return suggestedPrompts.slice(0, 3).map(
    (prompt) => `- "${prompt}" → {"mode":"analytics","complexity":"simple","complexityReason":null,"metricId":null,"actionType":null,"extractedDescription":null}`
  );
}

/** Return a ready-to-use classifier system prompt with the metric list and examples injected. */
export function buildClassifyPrompt(metricList: string, suggestedPrompts?: string[], metricEntityContext?: string, playbookEntityContext?: string, segmentEntityContext?: string): string {
  const dynamicExamples = buildDynamicExamples(suggestedPrompts);
  const allExamples = [...STATIC_EXAMPLES, ...dynamicExamples].join("\n");
  const safeCtx = metricEntityContext?.replace(/[\r\n]+/g, " ").trim();
  const metricCtx = safeCtx
    ? `A metric entity context is active (from the metric detail page or an @ mentioned metric).\nMetric entity context: ${safeCtx}\nIf the user's query asks to change/update/modify/edit the metric definition, formula, SQL, or calculation, classify as "metric_update". If the user is just asking ABOUT the metric (trend, value, analysis), classify as "analytics".`
    : "No metric entity context is active — do NOT classify as metric_update.";
  const safePbCtx = playbookEntityContext?.replace(/[\r\n]+/g, " ").trim();
  const pbCtx = safePbCtx
    ? `A playbook entity context is active (from the playbook detail page).\nPlaybook entity context: ${safePbCtx}\nIf the user's query asks to change/update/modify/edit the playbook's cells, parameters, SQL, logic, structure, or inputs, classify as "playbook_modify". If the user is just asking ABOUT the playbook or its data, classify as "analytics" or "direct".`
    : "No playbook entity context is active — do NOT classify as playbook_modify.";
  const safeSegCtx = segmentEntityContext?.replace(/[\r\n]+/g, " ").trim();
  const segCtx = safeSegCtx
    ? `A segment entity context is active (from the segment detail page or an @ mentioned segment).\nSegment entity context: ${safeSegCtx}\nVoice-agent or voice-campaign creation is "voice_agent_generation". Non-voice email/push/sms/message creation is "campaign_create". If the user is asking ABOUT the segment's users or data, classify as "analytics".`
    : "No segment entity context is active. For voice-agent generation, put the stated audience in voiceAgentTargetDescription. For non-voice campaign creation, put it in campaignTargetDescription. If the target audience is missing or ambiguous, still return the creation mode so the product can request a segment.";
  return CLASSIFY_SYSTEM
    .replace("{METRICS}", metricList)
    .replace("{METRIC_ENTITY_CONTEXT}", metricCtx)
    .replace("{PLAYBOOK_ENTITY_CONTEXT}", pbCtx)
    .replace("{SEGMENT_ENTITY_CONTEXT}", segCtx)
    .replace("{EXAMPLES}", allExamples);
}
