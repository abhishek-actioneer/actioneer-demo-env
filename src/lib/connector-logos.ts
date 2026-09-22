/**
 * Connector brand icons via the simple-icons CDN.
 *
 * We map each connector name to a simple-icons slug, then build a URL of the
 * form `https://cdn.simpleicons.org/<slug>/52525b`. The `52525b` color keeps
 * every glyph a neutral dark-gray so the catalog stays strictly monochrome
 * and on-brand. Names without a confident slug return `undefined` and the
 * caller falls back to a lucide category icon.
 *
 * Only slugs verified to resolve on the CDN are included — many for-profit
 * brand marks are not in simple-icons, so partial coverage is expected and
 * graceful.
 *
 * Usage: getConnectorLogoUrl("BigQuery") → URL string or undefined
 */

/** Connector display name → simple-icons slug (verified to resolve). */
const CONNECTOR_SLUGS: Record<string, string> = {
  // ── Warehouses / databases ──
  BigQuery: "googlebigquery",
  Snowflake: "snowflake",
  PostgreSQL: "postgresql",
  Databricks: "databricks",
  ClickHouse: "clickhouse",
  CockroachDB: "cockroachlabs",
  Convex: "convex",
  Firebase: "firebase",

  // AWS RDS / Aurora engine variants → use the engine glyph where it exists
  "Amazon Aurora MySQL": "mysql",
  "Amazon Aurora PostgreSQL": "postgresql",
  "Amazon DocumentDB": "mongodb",
  "Amazon RDS for MariaDB": "mariadb",
  "Amazon RDS for PostgreSQL": "postgresql",

  // Azure engine variants → use the engine glyph where it exists
  "Azure Cosmos DB for MongoDB": "mongodb",
  "Azure Database for MariaDB": "mariadb",
  "Azure Database for MySQL": "mysql",
  "Azure Database for PostgreSQL": "postgresql",

  // Google Cloud SQL engine variants
  "Google Cloud SQL for MySQL": "mysql",
  "Google Cloud SQL for PostgreSQL": "postgresql",
  "Google Cloud SQL for SQL Server": "googlecloud",

  "Elastic Cloud": "elasticcloud",
  "Heroku PostgreSQL": "postgresql",

  // Extra warehouses surfaced in the onboarding grid
  MySQL: "mysql",
  MongoDB: "mongodb",
  Supabase: "supabase",
  PlanetScale: "planetscale",

  // ── MMPs / attribution & misc integrations ──
  Algolia: "algolia",
  AdRoll: "adroll",
  Aircall: "aircall",
  "Amazon Selling Partner": "amazon",
  BigCommerce: "bigcommerce",
  "Bigin by Zoho CRM": "zoho",
  Bitly: "bitly",
  "Brave Ads": "brave",

  // ── Ad networks ──
  "Meta Ads": "meta",
  "Google Ads": "googleads",
  "TikTok Ads": "tiktok",
  "Unity Ads": "unity",
  "Snap Ads": "snapchat",
  "Apple Search Ads": "apple",

  // ── Others: revenue, CRM, analytics ──
  Stripe: "stripe",
  RevenueCat: "revenuecat",
  Mixpanel: "mixpanel",
  HubSpot: "hubspot",
  "Zoho CRM": "zoho",
  "Apple App Store": "apple",
};

const SIMPLE_ICONS_COLOR = "52525b";

export function getConnectorLogoUrl(name: string): string | undefined {
  const slug = CONNECTOR_SLUGS[name];
  if (!slug) return undefined;
  return `https://cdn.simpleicons.org/${slug}/${SIMPLE_ICONS_COLOR}`;
}

export { CONNECTOR_SLUGS };
