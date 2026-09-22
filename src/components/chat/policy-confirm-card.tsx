"use client";

import { Check, X, Shield, ExternalLink } from "lucide-react";
import type { TableAccessRule } from "@/lib/policy-types";

interface PolicyConfirmData {
  name: string;
  description: string;
  datasetId: string;
  tableAccess: TableAccessRule[];
  status: "ready" | "confirmed" | "cancelled";
  policyId?: string;
}

interface PolicyConfirmCardProps {
  data: PolicyConfirmData;
  msgId: string;
  onConfirm: (msgId: string) => void;
  onCancel: (msgId: string) => void;
}

export function PolicyConfirmCard({ data, msgId, onConfirm, onCancel }: PolicyConfirmCardProps) {
  const firstRule = data.tableAccess[0];

  // Cancelled state
  if (data.status === "cancelled") {
    return (
      <div className="text-xs text-muted-foreground/50 italic py-1">
        Policy creation cancelled
      </div>
    );
  }

  // Confirmed state
  if (data.status === "confirmed") {
    return (
      <div className="rounded-lg border border-border bg-background p-3">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-full bg-foreground/10 flex items-center justify-center">
            <Check className="w-3 h-3 text-foreground" />
          </div>
          <span className="text-sm font-medium text-foreground">
            Policy created: {data.name}
          </span>
          <a
            href="/settings/access"
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5 ml-auto"
          >
            View <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    );
  }

  // Ready state — review and confirm
  return (
    <div className="rounded-lg border border-border bg-background p-4 space-y-3 max-w-md">
      <div className="flex items-center gap-2">
        <Shield className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">{data.name}</span>
      </div>
      <p className="text-xs text-muted-foreground">{data.description}</p>

      {data.tableAccess.map((rule) => (
        <div key={rule.tableName} className="space-y-2 border-t border-border pt-3">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Table:</span>
            <span className="font-mono text-foreground">{rule.tableName}</span>
          </div>

          <div className="text-xs">
            <span className="text-muted-foreground">Columns: </span>
            {rule.allowAllColumns ? (
              <span className="text-foreground">All columns</span>
            ) : (
              <span className="text-foreground">{rule.allowedColumns.join(", ")}</span>
            )}
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">SELECT *:</span>
            <span className="text-foreground">{rule.allowSelectStar ? "Yes" : "No"}</span>
          </div>

          {rule.rowFilter && (
            <div className="text-xs">
              <span className="text-muted-foreground">Row filter: </span>
              <span className="font-mono text-foreground">{rule.rowFilter}</span>
              {rule.rowFilterDescription && (
                <p className="text-muted-foreground mt-0.5">{rule.rowFilterDescription}</p>
              )}
            </div>
          )}
        </div>
      ))}

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => onConfirm(msgId)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-foreground text-background hover:bg-foreground/90 transition-colors"
        >
          <Check className="w-3 h-3" />
          Confirm
        </button>
        <button
          onClick={() => onCancel(msgId)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
