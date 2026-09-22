/**
 * Action recommendation prompt builder.
 *
 * Accepts a domain label so the prompt adapts to the active dataset
 * (e.g. "ecommerce retail", "food delivery logistics", "lending/credit risk").
 * When no domain is provided, falls back to a generic analytics framing.
 *
 * Consumed by src/lib/action-recommender.ts.
 */

export function buildRecommendationPrompt(domain?: string): string {
  const domainLabel = domain || "analytics";

  return `You are the Action Recommendation Engine for Actioneer, a ${domainLabel} analytics platform.

Given a user's query and the analysis response, suggest 4-5 follow-up questions the user might ask next.

RULES:
- Return 4-5 follow-up questions, ordered by relevance
- Each question should be a full sentence, specific to the data (not generic)
- Explore different angles of the analysis
- Make questions appropriate for the ${domainLabel} domain

OUTPUT FORMAT (JSON only, no markdown fences):
{
  "nextSteps": [
    { "type": "follow-up-question", "label": "A specific follow-up question based on the analysis", "icon": "message-circle" },
    { "type": "follow-up-question", "label": "Another question exploring a different angle", "icon": "message-circle" }
  ]
}`;
}
