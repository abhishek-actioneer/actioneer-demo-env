"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { RetentionWorkspace } from "@/components/retentions/retention-workspace";
import { apiFetch } from "@/lib/api-client";
import { useBreadcrumbTitle } from "@/lib/breadcrumb-context";
import { useSidebarContext } from "@/components/sidebar-context";
import type { SavedRetention } from "@/lib/retention-types";

export default function RetentionDetailPage() {
  const router = useRouter();
  const params = useParams();
  const retentionId = params.id as string;
  const { refreshRetentions } = useSidebarContext();

  const [retention, setRetention] = useState<SavedRetention | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useBreadcrumbTitle(retention?.name ?? "");

  const fetchRetention = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiFetch<SavedRetention>(`/api/retentions/${retentionId}`);
      setRetention(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load retention");
    } finally {
      setLoading(false);
    }
  }, [retentionId]);

  useEffect(() => {
    fetchRetention();
  }, [fetchRetention]);

  const handleDelete = useCallback(async () => {
    try {
      await apiFetch(`/api/retentions/${retentionId}`, { method: "DELETE" });
      refreshRetentions();
      router.push("/retentions");
    } catch {
      // stay on page
    }
  }, [retentionId, refreshRetentions, router]);

  const handleUpdate = useCallback(async (updates: Partial<SavedRetention>) => {
    try {
      await apiFetch(`/api/retentions/${retentionId}`, {
        method: "PATCH",
        body: updates,
      });
      await fetchRetention();
      refreshRetentions();
    } catch {
      // keep existing state
    }
  }, [retentionId, fetchRetention, refreshRetentions]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !retention) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center">
        <p className="text-sm text-muted-foreground mb-4">
          {error || "Retention not found"}
        </p>
        <button
          onClick={() => router.push("/retentions")}
          className="text-sm text-foreground underline"
        >
          Back to Retentions
        </button>
      </div>
    );
  }

  return (
    <RetentionWorkspace
      retention={retention}
      onDelete={handleDelete}
      onUpdate={handleUpdate}
    />
  );
}
