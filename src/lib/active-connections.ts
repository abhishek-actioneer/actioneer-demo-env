/* ─────────────────────────────────────────────
   Shared connector mock data
   Used by /connectors (L1) and /connectors/[connectorId] (L2)
   ───────────────────────────────────────────── */

export type SubStatus = "synced" | "syncing" | "error" | "paused";

export interface SubConnection {
  id: string;
  name: string;
  description?: string;
  status: SubStatus;
  version?: string;
  lastSynced?: string;
  tableCount?: number;
  errorMessage?: string;
  createdAt?: string;
}

export interface ActiveConnection {
  name: string;
  categoryId: string;
  connectionName: string;
  refreshedAt?: string;
  subConnections: SubConnection[];
}

export const ACTIVE_CONNECTIONS: ActiveConnection[] = [
  {
    name: "BigQuery",
    categoryId: "warehouse",
    connectionName: "Production Analytics",
    refreshedAt: "12m ago",
    subConnections: [
      { id: "bq-1", name: "analytics_prod",        description: "GA4 events, user snapshots, session metrics and ML churn predictions",     status: "synced",  version: "v3",    lastSynced: "4 min ago",  tableCount: 124, createdAt: "3d" },
      { id: "bq-2", name: "marketing_attribution",  description: "Cross-channel attribution, campaign ROAS curves and ad spend reconciliation", status: "synced",  version: "v1",    lastSynced: "12 min ago", tableCount: 38,  createdAt: "5d" },
      { id: "bq-3", name: "revenue_reporting",      description: "Subscription lifecycle events, daily MRR snapshots and cohort churn curves",  status: "syncing", version: "v2",                              tableCount: 62,  createdAt: "1d" },
      { id: "bq-4", name: "user_events_raw",        description: "Raw ingestion tables before transformation — append-only, partitioned by day", status: "synced",  version: "v1",    lastSynced: "1 hour ago", tableCount: 91,  createdAt: "7d" },
    ],
  },
  {
    name: "AppsFlyer",
    categoryId: "mmp",
    connectionName: "AppsFlyer Prod",
    refreshedAt: "8m ago",
    subConnections: [
      { id: "af-1", name: "com.company.android", description: "Android installs, in-app events, uninstalls and session data",        status: "synced",  version: "v2", lastSynced: "8 min ago", tableCount: 4, createdAt: "2d" },
      { id: "af-2", name: "com.company.ios",     description: "iOS installs with SKAdNetwork attribution, in-app events and sessions",  status: "synced",  version: "v2", lastSynced: "8 min ago", tableCount: 3, createdAt: "2d" },
      { id: "af-3", name: "com.company.web",     description: "Web attribution pipeline — paused pending SDK configuration",           status: "paused",  version: "v1",                            createdAt: "4d" },
    ],
  },
  {
    name: "Meta Ads",
    categoryId: "ad-networks",
    connectionName: "Meta Ads Production",
    refreshedAt: "22m ago",
    subConnections: [
      { id: "meta-1", name: "Brand Awareness Q2",  description: "Q2 brand awareness campaigns — reach, frequency and CPM reporting",  status: "synced",  version: "v1", lastSynced: "22 min ago", tableCount: 8,  createdAt: "6d" },
      { id: "meta-2", name: "Retargeting - iOS",   description: "iOS retargeting campaigns with ATT-adjusted attribution metrics",       status: "synced",  version: "v1", lastSynced: "22 min ago", tableCount: 6,  createdAt: "6d" },
      { id: "meta-3", name: "Prospecting - APAC",  description: "APAC new-user prospecting campaigns across SG, MY, ID and PH",         status: "syncing", version: "v1",                            tableCount: 5,  createdAt: "2d" },
    ],
  },
  {
    name: "Stripe",
    categoryId: "others",
    connectionName: "Stripe Live",
    refreshedAt: "5m ago",
    subConnections: [
      { id: "stripe-1", name: "payments",      description: "Payment intents, charges, disputes and refunds from Stripe live mode",  status: "synced", version: "v2", lastSynced: "5 min ago", tableCount: 11, createdAt: "14d" },
      { id: "stripe-2", name: "subscriptions", description: "Subscription plans, billing intervals, upgrades and churn events",        status: "synced", version: "v2", lastSynced: "5 min ago", tableCount: 7,  createdAt: "14d" },
    ],
  },
];

export function connectorSlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-");
}

export function findConnection(slug: string): ActiveConnection | undefined {
  return ACTIVE_CONNECTIONS.find((c) => connectorSlug(c.name) === slug);
}

export function getSubLabel(categoryId: string): string {
  if (categoryId === "warehouse")   return "dataset";
  if (categoryId === "mmp")         return "app";
  if (categoryId === "ad-networks") return "account";
  return "connection";
}

export const CONNECTION_COUNTS: Record<string, number> = ACTIVE_CONNECTIONS.reduce(
  (acc, conn) => ({ ...acc, [conn.name]: conn.subConnections.length }),
  {} as Record<string, number>
);
