"use client";

import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api-client";
import { ArrowLeft, Users, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Segment, Integration } from "@/lib/types";

interface SegmentDetailProps {
  segment: Segment;
  onBack: () => void;
  onUpdate: () => void;
}

type PushState = Record<string, "idle" | "pushing" | "synced" | "error">;

export function SegmentDetail({ segment, onBack, onUpdate }: SegmentDetailProps) {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [pushStatus, setPushStatus] = useState<PushState>(segment.pushStatus);
  const [detail, setDetail] = useState<{
    userCount: number;
    preview: Record<string, unknown>[];
  } | null>(null);

  useEffect(() => {
    apiFetch<Integration[]>("/api/integrations", { skipModel: true })
      .then(setIntegrations)
      .catch(() => {});

    apiFetch<{ userCount: number; preview?: Record<string, unknown>[] }>(`/api/segments/${segment.id}`, { skipModel: true })
      .then((data) => {
        setDetail({ userCount: data.userCount, preview: data.preview ?? [] });
      })
      .catch(() => {});
  }, [segment.id]);

  const handlePush = async (integrationId: string) => {
    setPushStatus((prev) => ({ ...prev, [integrationId]: "pushing" }));
    try {
      await apiFetch(`/api/segments/${segment.id}/push`, {
        method: "POST",
        body: { integrationId },
        skipModel: true,
      });
      setPushStatus((prev) => ({ ...prev, [integrationId]: "synced" }));
      onUpdate();
    } catch {
      setPushStatus((prev) => ({ ...prev, [integrationId]: "error" }));
    }
  };

  const connectedIntegrations = integrations.filter((i) => i.connected);
  const userCount = detail?.userCount ?? segment.userCount;
  const preview = detail?.preview ?? [];
  const columns = preview.length > 0 ? Object.keys(preview[0]) : [];

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-6">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Segments
        </button>

        <h1 className="text-xl font-semibold mb-1">{segment.name}</h1>
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
          <Users className="w-4 h-4" />
          <span>{userCount.toLocaleString()} users</span>
        </div>

        {/* SQL */}
        <div className="mb-6">
          <h2 className="text-sm font-medium mb-2">SQL Query</h2>
          <pre className="text-xs bg-muted p-3 rounded-md overflow-x-auto whitespace-pre-wrap font-mono max-h-48 overflow-y-auto">
            {segment.sql}
          </pre>
        </div>

        {/* Push to integrations */}
        <div className="mb-6">
          <h2 className="text-sm font-medium mb-3">Push to Integrations</h2>
          {connectedIntegrations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No integrations connected. Go to Data Connectors to connect one.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {connectedIntegrations.map((integration) => {
                const status = pushStatus[integration.id] ?? "idle";
                return (
                  <Button
                    key={integration.id}
                    variant="outline"
                    size="sm"
                    disabled={status === "pushing" || status === "synced"}
                    onClick={() => handlePush(integration.id)}
                    className="gap-1.5"
                  >
                    {status === "pushing" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    {status === "synced" && <CheckCircle2 className="w-3.5 h-3.5 text-foreground" />}
                    {status === "error" && <AlertCircle className="w-3.5 h-3.5 text-foreground" />}
                    {status === "idle" ? `Push to ${integration.name}` : status === "synced" ? `Synced to ${integration.name}` : status === "pushing" ? `Pushing to ${integration.name}...` : `Error: Retry ${integration.name}`}
                  </Button>
                );
              })}
            </div>
          )}
        </div>

        {/* User preview table */}
        <div>
          <h2 className="text-sm font-medium mb-2">
            User Preview {preview.length > 0 && `(${Math.min(50, preview.length)} rows)`}
          </h2>
          {preview.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading preview...
            </div>
          ) : (
            <div className="border rounded-md overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/50">
                    {columns.map((col) => (
                      <th key={col} className="text-left px-3 py-2 font-medium">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.slice(0, 50).map((row, i) => (
                    <tr key={i} className="border-b last:border-0">
                      {columns.map((col) => (
                        <td key={col} className="px-3 py-1.5 truncate max-w-[200px]">
                          {String(row[col] ?? "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
