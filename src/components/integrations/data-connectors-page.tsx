"use client";

import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api-client";
import { ArrowLeft, Database, CheckCircle2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { IntegrationCard } from "@/components/integrations/integration-card";
import type { Integration } from "@/lib/types";

interface DataConnectorsPageProps {
  onBack: () => void;
}

export function DataConnectorsPage({ onBack }: DataConnectorsPageProps) {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<Integration[]>("/api/integrations", { skipModel: true })
      .then((data) => {
        setIntegrations(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleToggle = async (id: string, connected: boolean) => {
    try {
      await apiFetch("/api/integrations", {
        method: "PATCH",
        body: { id, connected },
        skipModel: true,
      });
      setIntegrations((prev) =>
        prev.map((i) =>
          i.id === id
            ? {
                ...i,
                connected,
                lastSynced: connected ? new Date().toISOString() : i.lastSynced,
              }
            : i
        )
      );
    } catch {
      // Silently fail
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-6">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to chat
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
            <Database className="w-5 h-5 text-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Data Connectors</h1>
            <p className="text-sm text-muted-foreground">
              Manage data sources and destination integrations
            </p>
          </div>
        </div>

        <Tabs defaultValue="destinations">
          <TabsList>
            <TabsTrigger value="sources">Sources</TabsTrigger>
            <TabsTrigger value="destinations">Destinations</TabsTrigger>
          </TabsList>

          <TabsContent value="sources" className="mt-4">
            <div className="border rounded-lg p-6 text-center">
              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
                <CheckCircle2 className="w-5 h-5 text-foreground" />
              </div>
              <h3 className="font-medium text-sm mb-1">Dataset Connected</h3>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                DuckDB database connected and ready for analysis.
              </p>
            </div>
          </TabsContent>

          <TabsContent value="destinations" className="mt-4">
            {loading ? (
              <div className="text-sm text-muted-foreground text-center py-8">
                Loading integrations...
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {integrations.map((integration) => (
                  <IntegrationCard
                    key={integration.id}
                    integration={integration}
                    onToggle={(connected) => handleToggle(integration.id, connected)}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
