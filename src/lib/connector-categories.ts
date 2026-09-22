export interface ConnectorCategory {
  id: string;
  name: string;
  description: string;
  icon: string;
  examples: string[];
  dataTypes: string[];
  connectTime: string;
}

export const CONNECTOR_CATEGORIES: ConnectorCategory[] = [
  {
    id: "warehouse",
    name: "Warehouse",
    description: "Query your tables and build metrics directly from your schema",
    icon: "Database",
    examples: [
      "BigQuery", "Snowflake", "Redshift", "PostgreSQL", "Databricks", "ClickHouse",
      "Amazon Aurora MySQL", "Amazon Aurora PostgreSQL", "Amazon DocumentDB", "Amazon DynamoDB",
      "Amazon RDS for MariaDB", "Amazon RDS for PostgreSQL", "Amazon RDS for SQL Server",
      "Azure Cosmos DB for MongoDB", "Azure Cosmos DB for NoSQL",
      "Azure Database for MariaDB", "Azure Database for MySQL", "Azure Database for PostgreSQL",
      "Azure SQL Database", "Azure SQL Managed Instance",
      "CockroachDB", "Convex", "Db2 for LUW", "Db2 for z/OS",
      "Elastic Cloud", "Epic Clarity", "Firebase",
      "Google Cloud SQL for MySQL", "Google Cloud SQL for PostgreSQL", "Google Cloud SQL for SQL Server",
      "Heroku PostgreSQL", "High Volume Agent Db2 for i",
      "High-Volume Agent Oracle", "High-Volume Agent SQL Server",
      "HVA SAP ECC on Oracle", "HVA SAP ECC on Oracle with NetWeaver",
    ],
    dataTypes: ["any structured data", "custom tables", "existing data warehouse"],
    connectTime: "Instant Connection",
  },
  {
    id: "mmp",
    name: "MMP",
    description: "Ingest attribution, installs, and post-install events",
    icon: "Smartphone",
    examples: [
      "AppsFlyer", "Adjust", "Singular", "Branch", "Kochava",
      "AccuLynx", "ActiveCampaign", "Adobe Analytics", "Adobe Analytics Data Feed",
      "Adobe Commerce", "AdRoll", "Affinity", "Aircall", "Algolia",
      "Amazon Ads", "Amazon Attribution", "Amazon DSP", "Amazon Selling Partner",
      "Apollo", "Apple App Store", "Apple Search Ads", "AppLovin",
      "Ascend by Partnerize", "Attentive", "Attio", "Aura from Unity",
      "AvantLink", "Awin", "BallotReady", "Bazaarvoice", "Betterworks",
      "BigCommerce", "Bigin by Zoho CRM", "BigMarker", "Bing Webmaster Tools",
      "Bitly", "Boostr", "Brave Ads",
    ],
    dataTypes: [
      "install attribution",
      "campaign performance",
      "post-install events",
      "cohort data",
      "ROAS",
      "CPI",
      "retention by source",
    ],
    connectTime: "Connects in 5-10 mins",
  },
  {
    id: "ad-networks",
    name: "Ad Networks",
    description: "Aggregate spend and impressions across channels",
    icon: "Megaphone",
    examples: ["Meta Ads", "Google Ads", "TikTok Ads", "Unity Ads", "AppLovin", "ironSource"],
    dataTypes: [
      "ad spend",
      "impressions",
      "clicks",
      "campaign budgets",
      "creative performance",
      "channel costs",
    ],
    connectTime: "Connects in 5-10 mins",
  },
  {
    id: "others",
    name: "Others",
    description: "Revenue platforms, CRMs, and third-party APIs",
    icon: "Plug",
    examples: ["Salesforce", "HubSpot", "Zoho CRM", "Freshsales", "ActiveCampaign", "Stripe", "RevenueCat", "Firebase", "Amplitude", "Mixpanel"],
    dataTypes: [
      "CRM leads",
      "sales tasks",
      "callback requests",
      "revenue",
      "subscriptions",
      "in-app purchases",
      "analytics events",
      "user properties",
    ],
    connectTime: "Varies",
  },
];

export function getCategoriesById(ids: string[]): ConnectorCategory[] {
  return CONNECTOR_CATEGORIES.filter((c) => ids.includes(c.id));
}

export { CONNECTOR_MAPPING_PROMPT } from "./prompts/connectors";
