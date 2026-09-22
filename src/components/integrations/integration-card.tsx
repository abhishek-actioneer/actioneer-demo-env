"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import type { Integration } from "@/lib/types";
import { ConnectorLogo } from "@/components/connectors/connector-logo";

interface IntegrationCardProps {
  integration: Integration;
  onToggle: (connected: boolean) => void;
}

export function IntegrationCard({ integration, onToggle }: IntegrationCardProps) {
  const [toggling, setToggling] = useState(false);

  const handleToggle = async () => {
    setToggling(true);
    try {
      await onToggle(!integration.connected);
    } finally {
      setToggling(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <ConnectorLogo name={integration.name} size={28} className="rounded-lg" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-medium text-sm">{integration.name}</h3>
              <Badge
                variant="secondary"
                className={`text-[9px] px-1.5 py-0 border-0 ${
                  integration.connected
                    ? "bg-muted text-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {integration.connected ? "Connected" : "Disconnected"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mb-3 line-clamp-2">
              {integration.description}
            </p>
            <div className="flex items-center justify-between">
              {integration.lastSynced && (
                <span className="text-xs text-muted-foreground">
                  Last synced:{" "}
                  {new Date(integration.lastSynced).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              )}
              <Switch
                checked={integration.connected}
                onCheckedChange={handleToggle}
                disabled={toggling}
                className="ml-auto data-[state=checked]:bg-foreground"
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
