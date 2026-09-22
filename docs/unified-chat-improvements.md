# Unified Chat — Reliability & Extension Proposals

## Reliability Problems

### 1. Classification is a single point of failure

One LLM call decides the entire UX path. If "show me high-value users" gets classified as `action` instead of `analytics`, the user gets a segment creation card instead of a data table. There's no recovery — the user has to rephrase and try again. Worse: when `deepResearch` is on, action mode is force-overridden to analytics (use-analytics.ts line 213), which silently eats the user's intent.

### 2. Page context injection is brute-force

`buildPageEntityContext` dumps ALL metrics/segments into the prompt. A dataset with 50 metrics blows ~4k tokens just on context. The LLM has to parse all of it even when the user asks about one thing. The `TOKEN_BUDGET` of 2000 in `buildEntityContext` exists but doesn't apply to page entity context.

### 3. Suggested actions are weak for new users

`getSuggestedActions` pulls from past conversations. New user on a new dataset = zero history = falls back to dataset prompts. Those prompts are generated during schema enrichment and tend to be generic. First impression suffers.

### 4. Intersection cards can't be acted on inline

Cards surface connections ("Your churn analysis created 3 segments") but the only action is "Open" — navigate to the conversation. There's no inline resolution. A pending "Create segment" action should let you confirm right there, not take you to a different conversation.

### 5. `refreshSegments` is lazy and fragile

Sidebar segments only refresh when explicitly called. If a user creates a segment from chat on the home page, the sidebar doesn't update until they navigate to `/segments`. The catalog invalidation pub/sub works for stores but segments come from the API.

---

## High-Impact Extensions

### A. Complete the action vocabulary

The classifier only supports `create-segment`. The architecture (classifier → inline card → confirm) is already built. Extending to other entity types is mechanical but high-value:

| User says | Action | Inline card |
|-----------|--------|-------------|
| "Create a playbook to monitor churn weekly" | `create-playbook` | Steps preview → confirm → saved |
| "Set up an alert when DAU drops below 1000" | `create-scout` | Schedule + threshold + playbook → confirm |
| "Save this insight to knowledge" | `save-knowledge` | Category picker → confirm |
| "Delete the Win-Back segment" | `delete-segment` | Confirm card with user count warning |
| "Rename this to Power Buyers" | `rename-entity` | Old → New preview → confirm |

The point: anything you can do by clicking through 3 pages should be doable in one sentence. The segment creation flow already proves the pattern works.

### B. Result pinning and comparison

When someone asks "what was revenue last week?" then "what about the week before?" — these are related but disconnected. There's no way to see them side by side.

**Pin a result**: Long-press or click a pin icon on any analytics response. Pinned results stay visible as a compact row above the chat. Ask a follow-up and the new result appears next to the pinned one. Useful for:
- Week-over-week comparison
- Segment A vs Segment B
- Before/after an action

This doesn't need a dashboard builder. Just "hold this while I ask another thing."

### C. Conversation search

All conversations are in localStorage. There's zero search. The user who asked about churn 4 days ago has to scroll through the sidebar history. Full-text search across all messages + tags + entity names would make history actually useful. The intersection cards do some of this implicitly but only on page navigation — the user can't actively search.

### D. Proactive insights on page load

When you navigate to `/metrics`, the system injects all metrics as context but waits for you to type. It already has the data — current values, change%, trends. It could proactively surface: "Revenue dropped 12% WoW. 2 of your segments saw >20% user count decline."

This isn't auto-running queries. It's just reading what's already in the stores/cache and presenting a one-liner. The intersection cards try to do this with past conversations, but they don't look at the current state of the data.

### E. Query → scheduled re-run

After any analytics response, add a follow-up action: "Run this weekly." This converts the query into a Scout with a schedule and the original query as the prompt. The gap between "I ran an ad-hoc query" and "I want this monitored" is currently: navigate to Scouts → create new → configure → save. Should be one click.

### F. Multi-turn correction memory

When the user says "no, I meant active users not all users," the current system re-classifies and re-runs from scratch. It doesn't carry the correction forward. Within a conversation session, corrections should accumulate as constraints: "active users = users with event in last 30 days" gets injected into all subsequent SQL generation prompts in that session.

This is different from knowledge entries (which are permanent). Session corrections are ephemeral but prevent the user from repeating themselves 3 times.

### G. Context relevance scoring

Instead of injecting ALL page entities, score them against the query:
- User asks "why did churn increase?" on metrics page
- Score each metric by name/description similarity to the query
- Inject top 5 metrics + the asked-about metric, not all 50

This reduces tokens, reduces LLM confusion, and improves answer quality. The entity catalog already has names and descriptions — cosine similarity on embeddings would be ideal but even keyword overlap would help.

### H. Classify with confidence + graceful fallback

Return a confidence score from the classifier. Below 0.7 → show the user what you understood: "I'll analyze your data. Did you mean to create a segment instead?" as a small disambiguation bar. This is cheaper than re-running after a wrong path.

---

## Prioritization

If picking the next 3 things to ship:

1. **Extend inline actions** (playbook, scout, delete/rename) — highest leverage, pattern exists, mechanical work
2. **Conversation search** — table stakes UX, embarrassing to not have
3. **Proactive insight on page load** — differentiator, makes the tool feel alive instead of waiting

The reliability fixes (classify confidence, context relevance scoring) should be woven into normal work, not separate projects.
