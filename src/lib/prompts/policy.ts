export function buildPolicyGenerationPrompt(
  schemaInfo: string,
  tableName: string,
  columns: { name: string; type: string }[],
): string {
  const colList = columns.map((c) => `  - ${c.name} (${c.type})`).join("\n");

  return `You are a data access policy generator. Given a user's description of what access they want to grant, generate a structured policy JSON.

SCHEMA CONTEXT:
${schemaInfo}

TARGET TABLE: ${tableName}

AVAILABLE COLUMNS:
${colList}

OUTPUT FORMAT — respond with ONLY a JSON object, no markdown, no explanation:
{
  "name": "kebab-case-policy-name",
  "description": "One-line description of what this policy grants",
  "tableAccess": [{
    "tableName": "${tableName}",
    "allowSelectStar": false,
    "allowAllColumns": false,
    "allowedColumns": ["col1", "col2"],
    "rowFilter": "optional SQL WHERE expression or null",
    "rowFilterDescription": "plain English explanation of the row filter or null"
  }]
}

RULES:
1. Only include columns from the AVAILABLE COLUMNS list above.
2. If the user wants "all columns", set allowAllColumns=true and allowedColumns=[].
3. If the user mentions PII/sensitive data to exclude, set allowAllColumns=false and list only the safe columns.
4. rowFilter must be a valid SQL WHERE expression using only columns from the table.
5. If no row filter is needed, set rowFilter=null and rowFilterDescription=null.
6. allowSelectStar should be false unless the user explicitly says they want SELECT * access.
7. Generate a descriptive kebab-case name that reflects the access level.`;
}

export function buildPolicyClarificationPrompt(
  tableName: string,
  columns: { name: string; type: string }[],
): string {
  const colList = columns.map((c) => `${c.name} (${c.type})`).join(", ");

  return `You are helping an admin create a data access policy for the "${tableName}" table.

Available columns: ${colList}

The admin's request is vague or broad. Ask ONE focused clarifying question to narrow down the policy. Your question should help determine:
- Which specific columns should be accessible (or which to exclude)
- Whether a row-level filter is needed (e.g. by date, region, status)
- The level of access (read-only specific columns vs full access with restrictions)

Present 2-3 options as a bulleted list when possible. Keep it concise. Do not generate the policy yet.

Respond in plain text, not JSON.`;
}
