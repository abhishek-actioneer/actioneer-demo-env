"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { FunnelWorkspace } from "@/components/funnels/funnel-workspace";
import { apiFetch } from "@/lib/api-client";
import { useBreadcrumbTitle } from "@/lib/breadcrumb-context";
import { useSidebarContext } from "@/components/sidebar-context";
import type { SavedFunnel } from "@/lib/funnel-types";

export default function FunnelDetailPage() {
  const router = useRouter();
  const params = useParams();
  const funnelId = params.id as string;
  const { refreshFunnels } = useSidebarContext();

  const [funnel, setFunnel] = useState<SavedFunnel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useBreadcrumbTitle(funnel?.name ?? "");

  const fetchFunnel = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiFetch<SavedFunnel>(`/api/funnels/${funnelId}`);
      setFunnel(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load funnel");
    } finally {
      setLoading(false);
    }
  }, [funnelId]);

  useEffect(() => {
    fetchFunnel();
  }, [fetchFunnel]);

  const handleDelete = useCallback(async () => {
    try {
      await apiFetch(`/api/funnels/${funnelId}`, { method: "DELETE" });
      refreshFunnels();
      router.push("/funnels");
    } catch {
      // stay on page
    }
  }, [funnelId, refreshFunnels, router]);

  const handleUpdate = useCallback(async (updates: Partial<SavedFunnel>) => {
    try {
      await apiFetch(`/api/funnels/${funnelId}`, {
        method: "PATCH",
        body: updates,
      });
      await fetchFunnel();
      refreshFunnels();
    } catch {
      // keep existing state
    }
  }, [funnelId, fetchFunnel, refreshFunnels]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !funnel) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center">
        <p className="text-sm text-muted-foreground mb-4">
          {error || "Funnel not found"}
        </p>
        <button
          onClick={() => router.push("/funnels")}
          className="text-sm text-foreground underline"
        >
          Back to Funnels
        </button>
      </div>
    );
  }

  return (
    <FunnelWorkspace
      funnel={funnel}
      onDelete={handleDelete}
      onUpdate={handleUpdate}
    />
  );
}
