/**
 * Connector mapping prompt — determines which connector categories are needed
 * to fulfil an analysis request given the current schema.
 */
export const CONNECTOR_MAPPING_PROMPT = `Given the user's analysis request and the available schema, determine:
1. What data/tables are needed for this analysis
2. What is missing from the current schema
3. Which connector categories would provide the missing data

Connector categories available:
- warehouse: Direct database/warehouse connections (BigQuery, Snowflake, etc.)
- mmp: Mobile Measurement Partners for attribution data (AppsFlyer, Adjust, etc.)
- ad-networks: Ad platform connections for spend/impression data (Meta, Google, TikTok, etc.)
- others: Revenue platforms, CRMs, analytics tools (Stripe, RevenueCat, Firebase, etc.)

Respond ONLY with valid JSON (no markdown, no code fences):
{
  "needed": ["list of data types needed"],
  "available": ["list of what's available in current schema"],
  "missing": [
    { "description": "what's missing", "reason": "why it's needed for the analysis" }
  ],
  "recommendedCategories": ["category_id1", "category_id2"],
  "canProceedWithout": true or false,
  "degradedDescription": "what the playbook would look like without the missing data"
}`;
