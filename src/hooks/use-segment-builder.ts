"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import type {
  SegmentBuilderConfig,
  SegmentRule,
  SegmentCombinator,
  EventRule,
  AttributeRule,
} from "@/lib/segment-builder-types";
import { createDefaultSegmentConfig, isValidConfig } from "@/lib/segment-builder-types";

type NewRule = Omit<EventRule, "id"> | Omit<AttributeRule, "id">;

interface PreviewResponse {
  sql: string | null;
  count: number | null;
  ruleCounts?: RulePreviewCount[];
  warnings: string[];
  error?: string;
}

export interface RulePreviewCount {
  ruleId: string;
  count: number | null;
  error?: string;
}

export interface SegmentPreviewPoint {
  period: string;
  count: number;
  breakdown?: string;
}

export interface SegmentVsAllUsersRow {
  metric: string;
  segment: number;
  allUsers: number;
  diff: string;
}

export interface SegmentVsPreviousPeriodRow {
  metric: string;
  now: number;
  d30: number;
  d60: number;
  d90: number;
}

interface SegmentPreviewOverview {
  sizeOverTime: SegmentPreviewPoint[];
  vsAllUsers?: SegmentVsAllUsersRow[];
  vsPreviousPeriod?: SegmentVsPreviousPeriodRow[];
}

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export interface UseSegmentBuilder {
  config: SegmentBuilderConfig;
  setConfig: (updater: (prev: SegmentBuilderConfig) => SegmentBuilderConfig) => void;
  addRule: (rule: NewRule) => void;
  updateRule: (id: string, patch: Partial<SegmentRule>) => void;
  removeRule: (id: string) => void;
  setCombinator: (c: SegmentCombinator) => void;
  setDateRange: (r: SegmentBuilderConfig["dateRange"]) => void;
  sql: string | null;
  count: number | null;
  ruleCounts: RulePreviewCount[];
  sizeOverTime: SegmentPreviewPoint[];
  vsAllUsers: SegmentVsAllUsersRow[];
  vsPreviousPeriod: SegmentVsPreviousPeriodRow[];
  warnings: string[];
  error: string | null;
  loading: boolean;
}

export function useSegmentBuilder(initial?: SegmentBuilderConfig, breakdown?: string): UseSegmentBuilder {
  const [config, setConfigState] = useState<SegmentBuilderConfig>(
    initial ?? createDefaultSegmentConfig(),
  );

  const [sql, setSql] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [ruleCounts, setRuleCounts] = useState<RulePreviewCount[]>([]);
  const [sizeOverTime, setSizeOverTime] = useState<SegmentPreviewPoint[]>([]);
  const [vsAllUsers, setVsAllUsers] = useState<SegmentVsAllUsersRow[]>([]);
  const [vsPreviousPeriod, setVsPreviousPeriod] = useState<SegmentVsPreviousPeriodRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const setConfig = useCallback(
    (updater: (prev: SegmentBuilderConfig) => SegmentBuilderConfig) => {
      setConfigState(updater);
    },
    [],
  );

  const addRule = useCallback((rule: NewRule) => {
    setConfigState((prev) => ({
      ...prev,
      rules: [...prev.rules, { ...rule, id: newId() } as SegmentRule],
    }));
  }, []);

  const updateRule = useCallback((id: string, patch: Partial<SegmentRule>) => {
    setConfigState((prev) => ({
      ...prev,
      rules: prev.rules.map((r) => (r.id === id ? ({ ...r, ...patch } as SegmentRule) : r)),
    }));
  }, []);

  const removeRule = useCallback((id: string) => {
    setConfigState((prev) => ({
      ...prev,
      rules: prev.rules.filter((r) => r.id !== id),
    }));
  }, []);

  const setCombinator = useCallback((c: SegmentCombinator) => {
    setConfigState((prev) => ({ ...prev, combinator: c }));
  }, []);

  const setDateRange = useCallback((r: SegmentBuilderConfig["dateRange"]) => {
    setConfigState((prev) => ({ ...prev, dateRange: r }));
  }, []);

  useEffect(() => {
    if (!isValidConfig(config)) {
      setSql(null);
      setCount(null);
      setRuleCounts([]);
      setSizeOverTime([]);
      setVsAllUsers([]);
      setVsPreviousPeriod([]);
      setWarnings([]);
      setError(null);
      setLoading(false);
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;
      setLoading(true);
      setError(null);
      try {
        const data = await apiFetch<PreviewResponse>("/api/segments/preview", {
          method: "POST",
          body: { config },
          signal: abort.signal,
          skipModel: true,
        });
        if (abort.signal.aborted) return;
        setSql(data.sql);
        setCount(data.count);
        setRuleCounts(data.ruleCounts ?? []);
        setWarnings(data.warnings ?? []);
        setError(data.error ?? null);
        if (data.sql) {
          try {
            const overview = await apiFetch<SegmentPreviewOverview>("/api/segments/__preview__/overview", {
              method: "POST",
              body: { sql: data.sql, config, breakdown, dateRange: config.dateRange },
              signal: abort.signal,
              skipModel: true,
            });
            if (!abort.signal.aborted) {
              setSizeOverTime(overview.sizeOverTime ?? []);
              setVsAllUsers(overview.vsAllUsers ?? []);
              setVsPreviousPeriod(overview.vsPreviousPeriod ?? []);
            }
          } catch {
            if (!abort.signal.aborted) {
              setSizeOverTime([]);
              setVsAllUsers([]);
              setVsPreviousPeriod([]);
            }
          }
        } else {
          setSizeOverTime([]);
          setVsAllUsers([]);
          setVsPreviousPeriod([]);
        }
      } catch (err) {
        if (abort.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Preview failed");
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    }, 350);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [config, breakdown]);

  return {
    config,
    setConfig,
    addRule,
    updateRule,
    removeRule,
    setCombinator,
    setDateRange,
    sql,
    count,
    ruleCounts,
    sizeOverTime,
    vsAllUsers,
    vsPreviousPeriod,
    warnings,
    error,
    loading,
  };
}
