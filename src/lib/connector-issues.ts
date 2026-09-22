export type IssueType = "schema_anomaly" | "freshness" | "row_count_drop" | "null_spike";
export type IssueSeverity = "error" | "warning";

export interface ConnectorIssue {
  id: string;
  type: IssueType;
  severity: IssueSeverity;
  title: string;
  description: string;
  agentName: string;
  detectedAt: string;
  connectorName: string;
  datasetId: string;
  datasetName: string;
  tableName?: string;
  columnName?: string;
  suggestedFix?: string;
}

export const MOCK_ISSUES: ConnectorIssue[] = [
  {
    id: "issue-1",
    type: "schema_anomaly",
    severity: "error",
    title: "Column type changed unexpectedly",
    description: "Column 'user_id' changed from INT64 to STRING since the last sync. Downstream queries that cast this column to integer will fail silently or throw a type mismatch error.",
    agentName: "Schema Anomaly Agent",
    detectedAt: "2 hours ago",
    connectorName: "BigQuery",
    datasetId: "bq-1",
    datasetName: "analytics_prod",
    tableName: "ga4_events",
    columnName: "user_id",
    suggestedFix: "Check your ETL pipeline for a recent schema migration. Update any downstream queries that rely on user_id being an integer.",
  },
  {
    id: "issue-2",
    type: "null_spike",
    severity: "warning",
    title: "Null spike in session_id",
    description: "Column 'session_id' has 34% null values in the last 6 hours, up from a baseline of ~2%. This likely indicates a tracking instrumentation issue on a specific platform or app version.",
    agentName: "Data Quality Agent",
    detectedAt: "6 hours ago",
    connectorName: "BigQuery",
    datasetId: "bq-1",
    datasetName: "analytics_prod",
    tableName: "ga4_events",
    columnName: "session_id",
    suggestedFix: "Verify that the analytics SDK is sending session_id on all event types. Cross-check with the platform breakdown to isolate which client version introduced the regression.",
  },
  {
    id: "issue-3",
    type: "row_count_drop",
    severity: "error",
    title: "Row count drop — pipeline stalled",
    description: "Table 'campaign_performance' received 0 rows in the last sync window. The expected volume is ~85k rows per sync based on the 30-day average. The ingestion pipeline may have stalled.",
    agentName: "Freshness Agent",
    detectedAt: "1 hour ago",
    connectorName: "BigQuery",
    datasetId: "bq-1",
    datasetName: "analytics_prod",
    tableName: "campaign_performance",
    suggestedFix: "Check the BigQuery Data Transfer job status. Confirm that the source ad network APIs are returning data and that authentication credentials haven't expired.",
  },
];

export function getIssuesForDataset(datasetId: string): ConnectorIssue[] {
  return MOCK_ISSUES.filter(i => i.datasetId === datasetId);
}

export function getIssuesForTable(datasetId: string, tableName: string): ConnectorIssue[] {
  return MOCK_ISSUES.filter(i => i.datasetId === datasetId && i.tableName === tableName);
}

export function getIssuesForConnector(connectorName: string): ConnectorIssue[] {
  return MOCK_ISSUES.filter(i => i.connectorName === connectorName);
}
