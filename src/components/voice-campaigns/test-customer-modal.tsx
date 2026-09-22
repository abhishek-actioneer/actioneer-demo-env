"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, UserRound } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { VoiceCustomerContext } from "@/lib/voice-customer-context";

interface SampledTestCustomer {
  context: VoiceCustomerContext;
  displayFields: Array<{ label: string; value: string }>;
}

interface TestCustomerModalProps {
  open: boolean;
  datasetId: string;
  segmentSql?: string;
  onConfirm: (context: VoiceCustomerContext) => void;
  onCancel: () => void;
}

export function TestCustomerModal({
  open,
  datasetId,
  segmentSql,
  onConfirm,
  onCancel,
}: TestCustomerModalProps) {
  const [sampled, setSampled] = useState<SampledTestCustomer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCustomer = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<SampledTestCustomer>(
        "/api/voice-campaigns/live-test/sample-customer",
        {
          method: "POST",
          body: { datasetId, segmentSql },
          datasetId,
          skipModel: true,
        },
      );
      setSampled(result);
    } catch (err) {
      const message = err instanceof ApiError
        ? err.message
        : (err as Error).message || "Could not sample a customer from this segment.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [datasetId, segmentSql]);

  useEffect(() => {
    if (open) {
      setSampled(null);
      void fetchCustomer();
    }
  }, [open, fetchCustomer]);

  const genderLabel = sampled?.context.gender;
  const displayName = sampled?.context.displayName || sampled?.context.firstName;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent className="max-w-sm gap-0 p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <UserRound className="size-4 text-muted-foreground" />
            Testing as
          </DialogTitle>
        </DialogHeader>

        <div className="px-5 py-5">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Sampling from segment…
            </div>
          )}

          {error && !loading && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          {sampled && !loading && (
            <div className="space-y-4">
              {/* Name + gender headline */}
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-base font-semibold leading-tight">
                    {displayName ?? "Unknown customer"}
                  </p>
                  {genderLabel && genderLabel !== "unknown" && (
                    <p className="mt-0.5 text-xs capitalize text-muted-foreground">{genderLabel}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void fetchCustomer()}
                  className="mt-0.5 flex shrink-0 items-center gap-1.5 rounded border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted"
                  aria-label="Sample a different customer"
                >
                  <RefreshCw className="size-3" />
                  Re-roll
                </button>
              </div>

              {/* Context fields */}
              {sampled.displayFields.filter((f) => f.label !== "Name" && f.label !== "Gender").length > 0 && (
                <div className="space-y-1.5 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                  {sampled.displayFields
                    .filter((f) => f.label !== "Name" && f.label !== "Gender")
                    .slice(0, 6)
                    .map((field) => (
                      <div key={field.label} className="flex items-baseline justify-between gap-3">
                        <span className="shrink-0 text-xs text-muted-foreground">{field.label}</span>
                        <span className="min-w-0 truncate text-right text-xs text-foreground">{field.value}</span>
                      </div>
                    ))}
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                This context is injected privately — the agent uses it but never reveals it.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-border px-5 py-3">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!sampled || loading}
            onClick={() => sampled && onConfirm(sampled.context)}
          >
            Start test
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
