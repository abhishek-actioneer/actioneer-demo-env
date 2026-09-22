"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Loader2,
  Users,
  ChevronLeft,
  ChevronRight,
  UserPlus,
  Check,
  AlertCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api-client";
import { useDataset } from "@/lib/dataset-context";
import { RetentionsIcon } from "@/components/nav-icons";
import type { RetentionConfig, RetentionResult } from "@/lib/retention-types";

interface UsersTabProps {
  retentionId: string;
  config: RetentionConfig;
  result: RetentionResult | null;
}

interface UserRow {
  uid: string;
}

interface UsersResponse {
  users: UserRow[];
  total: number;
  cohort: string;
  bucket: number;
  status: string;
}

interface SegmentSQLResponse {
  sql: string;
  estimatedCount: number;
  suggestedName: string;
}

const PAGE_SIZE = 50;

export function UsersTab({ retentionId, config, result }: UsersTabProps) {
  const { dataset } = useDataset();
  const entityName = dataset?.entityName ?? "User";
  const cohorts = result?.cohorts ?? [];
  const dayBuckets = result?.dayBuckets ?? [];

  // State
  const [selectedCohort, setSelectedCohort] = useState<string>("");
  const [selectedBucket, setSelectedBucket] = useState<number>(
    dayBuckets.length > 0 ? dayBuckets[0] : 0
  );
  const [status, setStatus] = useState<"retained" | "churned">("churned");
  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Segment creation state
  const [segmentDialogOpen, setSegmentDialogOpen] = useState(false);
  const [segmentLoading, setSegmentLoading] = useState(false);
  const [segmentData, setSegmentData] = useState<SegmentSQLResponse | null>(
    null
  );
  const [segmentName, setSegmentName] = useState("");
  const [segmentCreating, setSegmentCreating] = useState(false);
  const [segmentCreated, setSegmentCreated] = useState(false);
  const [segmentError, setSegmentError] = useState<string | null>(null);

  // Initialize selected cohort when result loads
  useEffect(() => {
    if (cohorts.length > 0 && !selectedCohort) {
      setSelectedCohort(cohorts[0].cohortDate);
    }
  }, [cohorts, selectedCohort]);

  // Initialize selected bucket when result loads
  useEffect(() => {
    if (dayBuckets.length > 0 && !dayBuckets.includes(selectedBucket)) {
      setSelectedBucket(dayBuckets[0]);
    }
  }, [dayBuckets, selectedBucket]);

  // Fetch users for the selected cohort/bucket/status
  const fetchUsers = useCallback(
    async (
      cohort: string,
      bucket: number,
      st: "retained" | "churned",
      off: number
    ) => {
      if (!cohort) return;
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          cohort,
          bucket: String(bucket),
          status: st,
          limit: String(PAGE_SIZE),
          offset: String(off),
        });
        const data = await apiFetch<UsersResponse>(
          `/api/retentions/${retentionId}/users?${params.toString()}`
        );
        setUsers(data.users);
        setTotal(data.total);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load users"
        );
        setUsers([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    },
    [retentionId]
  );

  // Re-fetch when cohort, bucket, status, or offset changes
  useEffect(() => {
    if (cohorts.length === 0 || !selectedCohort) return;
    fetchUsers(selectedCohort, selectedBucket, status, offset);
  }, [selectedCohort, selectedBucket, status, offset, cohorts.length, fetchUsers]);

  // Reset offset when cohort/bucket/status changes
  useEffect(() => {
    setOffset(0);
  }, [selectedCohort, selectedBucket, status]);

  // Handle "Create Segment" click
  const handleCreateSegmentClick = useCallback(async () => {
    setSegmentDialogOpen(true);
    setSegmentLoading(true);
    setSegmentCreated(false);
    setSegmentError(null);
    setSegmentData(null);
    try {
      const data = await apiFetch<SegmentSQLResponse>(
        `/api/retentions/${retentionId}/segment-sql`,
        {
          method: "POST",
          body: {
            cohort: selectedCohort,
            bucket: selectedBucket,
            status,
          },
        }
      );
      setSegmentData(data);
      setSegmentName(data.suggestedName);
    } catch (err) {
      setSegmentError(
        err instanceof Error ? err.message : "Failed to generate segment SQL"
      );
    } finally {
      setSegmentLoading(false);
    }
  }, [retentionId, selectedCohort, selectedBucket, status]);

  // Create the segment
  const handleCreateSegment = useCallback(async () => {
    if (!segmentData) return;
    setSegmentCreating(true);
    setSegmentError(null);
    try {
      await apiFetch("/api/segments", {
        method: "POST",
        body: {
          name: segmentName,
          sql: segmentData.sql,
        },
      });
      setSegmentCreated(true);
    } catch (err) {
      setSegmentError(
        err instanceof Error ? err.message : "Failed to create segment"
      );
    } finally {
      setSegmentCreating(false);
    }
  }, [segmentData, segmentName]);

  // Bucket label helper
  const getBucketLabel = (bucket: number) => {
    if (config.mode === "custom") {
      const brackets = config.customBrackets ?? [];
      const b = brackets[bucket];
      return b ? `${b.from}-${b.to}d` : `Bracket ${bucket}`;
    }
    return `Day ${bucket}`;
  };

  if (!result || cohorts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground text-center">
        <RetentionsIcon className="w-10 h-10 mb-3 opacity-50" />
        <p className="text-sm">
          Run a retention analysis to see users by cohort.
        </p>
      </div>
    );
  }

  const currentEnd = Math.min(offset + PAGE_SIZE, total);
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  // Get cohort size for selected cohort
  const selectedCohortData = cohorts.find(
    (c) => c.cohortDate === selectedCohort
  );

  return (
    <div className="space-y-4">
      {/* Cohort selector */}
      <div className="space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          Cohort
        </span>
        <select
          value={selectedCohort}
          onChange={(e) => setSelectedCohort(e.target.value)}
          className="w-full px-3 py-2 text-sm rounded-md border border-border bg-transparent text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20"
        >
          {cohorts.map((c) => (
            <option key={c.cohortDate} value={c.cohortDate}>
              {c.cohortDate} ({c.cohortSize.toLocaleString()}{" "}
              {entityName.toLowerCase()}s)
            </option>
          ))}
        </select>
      </div>

      {/* Bucket pills */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium text-muted-foreground mr-1">
          Bucket:
        </span>
        {dayBuckets.map((bucket) => (
          <button
            key={bucket}
            onClick={() => setSelectedBucket(bucket)}
            className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
              selectedBucket === bucket
                ? "bg-foreground text-background border-foreground"
                : "bg-transparent text-muted-foreground border-border hover:border-foreground/30 hover:text-foreground"
            }`}
          >
            {getBucketLabel(bucket)}
          </button>
        ))}
      </div>

      {/* Status toggle */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground mr-1">
          Show:
        </span>
        <button
          onClick={() => setStatus("churned")}
          className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
            status === "churned"
              ? "bg-foreground text-background border-foreground"
              : "bg-transparent text-muted-foreground border-border hover:border-foreground/30 hover:text-foreground"
          }`}
        >
          Churned
        </button>
        <button
          onClick={() => setStatus("retained")}
          className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
            status === "retained"
              ? "bg-foreground text-background border-foreground"
              : "bg-transparent text-muted-foreground border-border hover:border-foreground/30 hover:text-foreground"
          }`}
        >
          Retained
        </button>
      </div>

      {/* Cohort summary */}
      {selectedCohortData && !loading && (
        <div className="text-xs text-muted-foreground">
          Cohort {selectedCohort}: {selectedCohortData.cohortSize.toLocaleString()}{" "}
          {entityName.toLowerCase()}s total
          {selectedCohortData.retainedByBucket[selectedBucket] !== undefined && (
            <span>
              {" "}
              &middot;{" "}
              {selectedCohortData.retainedByBucket[selectedBucket].toLocaleString()}{" "}
              retained at {getBucketLabel(selectedBucket)}
              {" "}
              ({Math.round(
                (selectedCohortData.retainedByBucket[selectedBucket] /
                  selectedCohortData.cohortSize) *
                  100
              )}
              %)
            </span>
          )}
        </div>
      )}

      {/* Create Segment button */}
      {!loading && total > 0 && (
        <button
          onClick={handleCreateSegmentClick}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border hover:bg-muted/50 transition-colors text-foreground"
        >
          <UserPlus className="w-3.5 h-3.5" />
          Create Segment from {status} {entityName.toLowerCase()}s (
          {total.toLocaleString()})
        </button>
      )}

      {/* Error state */}
      {error && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 rounded-md px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* User table */}
      {!loading && !error && users.length > 0 && (
        <>
          <div className="border border-border rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">
                    #
                  </th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">
                    {entityName} ID
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.map((user, i) => (
                  <tr
                    key={user.uid}
                    className="border-b border-border last:border-b-0 hover:bg-muted/20 transition-colors"
                  >
                    <td className="px-4 py-2 text-xs text-muted-foreground tabular-nums">
                      {offset + i + 1}
                    </td>
                    <td className="px-4 py-2 text-xs font-mono text-foreground">
                      {user.uid}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Showing {offset + 1}&ndash;{currentEnd} of{" "}
              {total.toLocaleString()}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                disabled={!hasPrev}
                className="p-1 rounded hover:bg-muted/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setOffset(offset + PAGE_SIZE)}
                disabled={!hasNext}
                className="p-1 rounded hover:bg-muted/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </>
      )}

      {/* Empty state */}
      {!loading && !error && users.length === 0 && selectedCohort && (
        <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-center">
          <RetentionsIcon className="w-8 h-8 mb-2 opacity-40" />
          <p className="text-xs">
            No {status} {entityName.toLowerCase()}s found for this
            cohort/bucket.
          </p>
        </div>
      )}

      {/* Create Segment Dialog */}
      <Dialog open={segmentDialogOpen} onOpenChange={setSegmentDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base">
              Create Segment from {status === "churned" ? "Churned" : "Retained"}{" "}
              {entityName}s
            </DialogTitle>
          </DialogHeader>

          {segmentLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {segmentCreated && (
            <div className="flex flex-col items-center justify-center py-8 gap-2">
              <div className="w-10 h-10 rounded-full bg-foreground/10 flex items-center justify-center">
                <Check className="w-5 h-5 text-foreground" />
              </div>
              <p className="text-sm font-medium text-foreground">
                Segment created
              </p>
              <p className="text-xs text-muted-foreground">
                &ldquo;{segmentName}&rdquo; with{" "}
                {segmentData?.estimatedCount.toLocaleString()}{" "}
                {entityName.toLowerCase()}s
              </p>
              <button
                onClick={() => setSegmentDialogOpen(false)}
                className="mt-2 px-4 py-1.5 text-xs rounded-md bg-foreground text-background font-medium hover:bg-foreground/90 transition-colors"
              >
                Done
              </button>
            </div>
          )}

          {!segmentLoading && !segmentCreated && segmentData && (
            <div className="space-y-4">
              {/* Segment name */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Segment name
                </label>
                <input
                  type="text"
                  value={segmentName}
                  onChange={(e) => setSegmentName(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-md border border-border bg-transparent text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20"
                />
              </div>

              {/* Estimated count */}
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Users className="w-3.5 h-3.5" />
                <span>
                  Estimated{" "}
                  {segmentData.estimatedCount.toLocaleString()}{" "}
                  {entityName.toLowerCase()}s in this segment
                </span>
              </div>

              {/* SQL preview */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  SQL definition
                </label>
                <pre className="text-[9.9px] font-mono text-muted-foreground bg-muted/30 rounded-md p-3 max-h-48 overflow-y-auto whitespace-pre-wrap break-all border border-border">
                  {segmentData.sql}
                </pre>
              </div>

              {/* Error */}
              {segmentError && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 rounded-md px-3 py-2">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  {segmentError}
                </div>
              )}

              <DialogFooter className="gap-2">
                <button
                  onClick={() => setSegmentDialogOpen(false)}
                  className="px-4 py-1.5 text-xs rounded-md border border-border hover:bg-muted/50 transition-colors text-muted-foreground"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateSegment}
                  disabled={segmentCreating || !segmentName.trim()}
                  className="flex items-center gap-1.5 px-4 py-1.5 text-xs rounded-md bg-foreground text-background font-medium hover:bg-foreground/90 transition-colors disabled:opacity-50"
                >
                  {segmentCreating && (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  )}
                  Create Segment
                </button>
              </DialogFooter>
            </div>
          )}

          {/* Error loading segment SQL */}
          {!segmentLoading && !segmentCreated && !segmentData && segmentError && (
            <div className="flex flex-col items-center justify-center py-8 gap-2">
              <AlertCircle className="w-8 h-8 text-muted-foreground opacity-50" />
              <p className="text-xs text-muted-foreground">{segmentError}</p>
              <button
                onClick={() => setSegmentDialogOpen(false)}
                className="mt-2 px-4 py-1.5 text-xs rounded-md border border-border hover:bg-muted/50 transition-colors text-muted-foreground"
              >
                Close
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
