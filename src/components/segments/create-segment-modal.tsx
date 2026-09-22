"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-client";
import { useModel } from "@/lib/model-context";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Users, Loader2, Sparkles, Code, AlertCircle } from "lucide-react";

interface CreateSegmentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-filled SQL when creating from chat follow-up action */
  defaultSql?: string;
  /** Pre-filled name when creating from chat */
  defaultName?: string;
  /** Pre-fetched user count when creating from chat */
  defaultUserCount?: number | null;
  onConfirm: (name: string, sql: string) => void;
  isCreating: boolean;
}

export function CreateSegmentModal({
  open,
  onOpenChange,
  defaultSql,
  defaultName,
  defaultUserCount,
  onConfirm,
  isCreating,
}: CreateSegmentModalProps) {
  useModel(); // sync module-level model state for apiFetch
  const [name, setName] = useState(defaultName ?? "");
  const [activeTab, setActiveTab] = useState<string>(defaultSql ? "sql" : "describe");

  // Describe tab state
  const [description, setDescription] = useState("");
  const [generatedSql, setGeneratedSql] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // SQL tab state
  const [manualSql, setManualSql] = useState(defaultSql ?? "");

  // Count preview
  const [userCount, setUserCount] = useState<number | null>(defaultUserCount ?? null);
  const [countLoading, setCountLoading] = useState(false);
  const [countError, setCountError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const countTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [prevOpen, setPrevOpen] = useState(open);

  // Reset state when modal opens (React recommended: adjust state during render)
  if (open && !prevOpen) {
    setPrevOpen(true);
    setName(defaultName ?? "");
    setDescription("");
    setGeneratedSql("");
    setManualSql(defaultSql ?? "");
    setActiveTab(defaultSql ? "sql" : "describe");
    setIsGenerating(false);
    setGenerateError(null);
    setUserCount(defaultUserCount ?? null);
    setCountLoading(false);
    setCountError(null);
  } else if (!open && prevOpen) {
    setPrevOpen(false);
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (countTimerRef.current) clearTimeout(countTimerRef.current);
    };
  }, []);

  const fetchCount = useCallback(
    async (sql: string) => {
      if (!sql.trim()) {
        setUserCount(null);
        setCountError(null);
        return;
      }

      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;

      setCountLoading(true);
      setCountError(null);

      try {
        const data = await apiFetch<{ count: number }>("/api/segments/count", {
          method: "POST",
          body: { sql },
          signal: abort.signal,
          skipModel: true,
        });

        if (abort.signal.aborted) return;

        setUserCount(data.count);
        setCountLoading(false);
      } catch (err) {
        if (abort.signal.aborted) return;
        const message = err instanceof Error ? err.message : "Failed to execute SQL";
        setCountError(message);
        setCountLoading(false);
      }
    },
    []
  );

  const handleGenerate = async () => {
    if (!description.trim()) return;

    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setIsGenerating(true);
    setGenerateError(null);
    setGeneratedSql("");
    setUserCount(null);

    try {
      const data = await apiFetch<{ sql?: string; error?: string }>("/api/segments/generate-sql", {
        method: "POST",
        body: { description },
        signal: abort.signal,
      });

      if (abort.signal.aborted) return;

      if (data.sql) {
        setGeneratedSql(data.sql);
        setIsGenerating(false);
        // Auto-fetch count
        fetchCount(data.sql);
      } else {
        setGenerateError(data.error ?? "Failed to generate SQL");
        setIsGenerating(false);
      }
    } catch (err) {
      if (abort.signal.aborted) return;
      const message = err instanceof Error ? err.message : "Failed to generate SQL. Please try again.";
      setGenerateError(message);
      setIsGenerating(false);
    }
  };

  // Debounced count for manual SQL tab
  const handleManualSqlChange = (value: string) => {
    setManualSql(value);
    setUserCount(null);
    setCountError(null);

    if (countTimerRef.current) clearTimeout(countTimerRef.current);
    countTimerRef.current = setTimeout(() => {
      if (value.trim()) fetchCount(value);
    }, 1000);
  };

  const handleClose = () => {
    abortRef.current?.abort();
    if (countTimerRef.current) clearTimeout(countTimerRef.current);
    onOpenChange(false);
  };

  const currentSql = activeTab === "describe" ? generatedSql : manualSql;
  const canCreate = name.trim() && currentSql.trim() && !isCreating && !isGenerating;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Segment</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Name field - shared across tabs */}
          <div>
            <label className="text-sm font-medium mb-1.5 block">Segment Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. High-value electronics buyers"
            />
          </div>

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="w-full">
              <TabsTrigger value="describe" className="flex-1 gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                Describe
              </TabsTrigger>
              <TabsTrigger value="sql" className="flex-1 gap-1.5">
                <Code className="w-3.5 h-3.5" />
                SQL
              </TabsTrigger>
            </TabsList>

            <TabsContent value="describe" className="space-y-3 mt-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">
                  Describe the users you want in this segment.
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. Users who purchased electronics more than once in the last week"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px] resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <Button
                  size="sm"
                  onClick={handleGenerate}
                  disabled={!description.trim() || isGenerating}
                  className="mt-2 bg-foreground hover:bg-foreground/90 text-background gap-1.5"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      Generate SQL
                    </>
                  )}
                </Button>
              </div>

              {generateError && (
                <div className="flex items-center gap-2 text-sm text-foreground bg-muted rounded-md px-3 py-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {generateError}
                </div>
              )}

              {generatedSql && (
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">
                    Generated SQL
                  </label>
                  <pre className="text-xs bg-muted p-3 rounded-md overflow-x-auto whitespace-pre-wrap font-mono max-h-40 overflow-y-auto">
                    {generatedSql}
                  </pre>
                </div>
              )}
            </TabsContent>

            <TabsContent value="sql" className="space-y-3 mt-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">
                  SQL query (must select user_id)
                </label>
                <textarea
                  value={manualSql}
                  onChange={(e) => handleManualSqlChange(e.target.value)}
                  placeholder="SELECT DISTINCT user_id FROM events WHERE ..."
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono min-h-[120px] resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  spellCheck={false}
                />
              </div>
            </TabsContent>
          </Tabs>

          {/* Count preview */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground pt-1">
            <Users className="w-4 h-4 shrink-0" />
            {countLoading ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Counting users...
              </span>
            ) : countError ? (
              <span className="text-muted-foreground text-xs">{countError}</span>
            ) : userCount !== null ? (
              <span>
                <strong className="text-foreground">{userCount.toLocaleString()}</strong> users
                match this query
              </span>
            ) : (
              <span className="text-xs">Enter SQL to see user count.</span>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={() => onConfirm(name, currentSql)}
            disabled={!canCreate}
            className="bg-foreground hover:bg-foreground/90 text-background"
          >
            {isCreating ? (
              <>
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                Creating...
              </>
            ) : (
              "Create Segment"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
