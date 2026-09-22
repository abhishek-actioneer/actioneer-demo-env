export type CampaignDiagnosticSeverity = "error" | "warn" | "info";

export interface CampaignDiagnostic {
  id: string;
  severity: CampaignDiagnosticSeverity;
  source: "fact-ledger" | "verbatim" | "placeholder" | "workflow" | "intake" | "compat" | "route";
  message: string;
  nodeId?: string;
  data?: Record<string, unknown>;
}
