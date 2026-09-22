/** Hardcoded mock: which connectors are "connected". */

export interface ConnectedSource {
  name: string;
  categoryId: string;
  connectedAt: number;
  lastSyncedAt: number;
  connectionName: string;
}

const CONNECTED_SOURCES: ConnectedSource[] = [
  {
    name: "BigQuery",
    categoryId: "warehouse",
    connectedAt: Date.now() - 7 * 86_400_000, // 7 days ago
    lastSyncedAt: Date.now() - 2 * 3_600_000, // 2 hours ago
    connectionName: "Production Analytics",
  },
  {
    name: "CSV Upload",
    categoryId: "warehouse",
    connectedAt: Date.now() - 1 * 86_400_000, // 1 day ago
    lastSyncedAt: Date.now() - 30 * 60_000, // 30 minutes ago
    connectionName: "Uploaded Dataset",
  },
];

export function getConnectedSources(): ConnectedSource[] {
  return CONNECTED_SOURCES;
}

export function isConnectorConnected(name: string): boolean {
  return CONNECTED_SOURCES.some((s) => s.name === name);
}
