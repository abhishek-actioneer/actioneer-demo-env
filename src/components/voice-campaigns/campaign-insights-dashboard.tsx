"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  Clock3,
  Download,
  PhoneCall,
  PhoneIncoming,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import {
  VOICE_OUTCOME_TONE,
  VoiceCampaignStatusPill,
} from "@/components/voice-campaigns/voice-status-pill";
import {
  DataTableFrame,
  DataTableScroll,
  dataTableClassNames,
} from "@/components/ui/data-table";
import { downloadCSV } from "@/lib/csv-export";
import { cn } from "@/lib/utils";
import {
  OUTCOME_LABELS,
  OUTCOME_ORDER,
  classifyVoiceCallOutcome,
  formatVoicePercent,
  getVoiceCallStageFacts,
  hasCallbackScheduledSignal,
  isTestCall,
  maskPhone,
  metricsForCalls,
  productionCalls,
} from "@/lib/voice-campaign-analysis";
import type { VoiceCall, VoiceCallOutcome, VoiceCampaign } from "@/lib/voice-campaign-types";

type DateRange = "7d" | "30d" | "90d" | "all";
type TimeGrain = "daily" | "weekly";

type CallRow = {
  campaign: VoiceCampaign;
  call: VoiceCall;
  timestamp: number;
};

type PeriodBucket = {
  key: string;
  label: string;
  calls: number;
  answered: number;
  answerRate: number;
  positiveRate: number;
  callbacks: number;
  outcomes: Record<VoiceCallOutcome, number>;
};

const RANGE_DAYS: Record<Exclude<DateRange, "all">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

const numberFormatter = new Intl.NumberFormat();

type MetricTone = "slate" | "blue" | "violet" | "emerald" | "cyan";

const METRIC_TONE_CLASS: Record<MetricTone, { card: string; icon: string; value: string }> = {
  slate: {
    card: "border-slate-200/80 bg-slate-50/70 dark:border-slate-400/20 dark:bg-slate-400/5",
    icon: "bg-slate-100 text-slate-600 dark:bg-slate-400/10 dark:text-slate-300",
    value: "text-slate-900 dark:text-slate-100",
  },
  blue: {
    card: "border-blue-200/70 bg-blue-50/65 dark:border-blue-400/20 dark:bg-blue-400/5",
    icon: "bg-blue-100 text-blue-700 dark:bg-blue-400/10 dark:text-blue-300",
    value: "text-blue-900 dark:text-blue-200",
  },
  violet: {
    card: "border-violet-200/70 bg-violet-50/60 dark:border-violet-400/20 dark:bg-violet-400/5",
    icon: "bg-violet-100 text-violet-700 dark:bg-violet-400/10 dark:text-violet-300",
    value: "text-violet-900 dark:text-violet-200",
  },
  emerald: {
    card: "border-emerald-200/70 bg-emerald-50/60 dark:border-emerald-400/20 dark:bg-emerald-400/5",
    icon: "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300",
    value: "text-emerald-900 dark:text-emerald-200",
  },
  cyan: {
    card: "border-cyan-200/70 bg-cyan-50/65 dark:border-cyan-400/20 dark:bg-cyan-400/5",
    icon: "bg-cyan-100 text-cyan-700 dark:bg-cyan-400/10 dark:text-cyan-300",
    value: "text-cyan-900 dark:text-cyan-200",
  },
};

function campaignHref(campaignId: string): string {
  return `/voice-campaigns/new?${new URLSearchParams({ campaignId }).toString()}`;
}

function campaignCalls(campaign: VoiceCampaign): VoiceCall[] {
  const tagged = productionCalls(campaign);
  if (tagged.length > 0) return tagged;
  return (campaign.calls ?? []).filter((call) => !isTestCall(call));
}

function callTimestamp(call: VoiceCall, campaign: VoiceCampaign): number {
  const raw = call.startedAt ?? call.endedAt ?? campaign.launchedAt ?? campaign.createdAt;
  const value = new Date(raw).getTime();
  return Number.isFinite(value) ? value : 0;
}

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function startOfWeek(timestamp: number): number {
  const date = new Date(startOfDay(timestamp));
  const day = date.getDay();
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  return date.getTime();
}

function bucketStart(timestamp: number, grain: TimeGrain): number {
  return grain === "weekly" ? startOfWeek(timestamp) : startOfDay(timestamp);
}

function bucketLabel(timestamp: number, grain: TimeGrain): string {
  const date = new Date(timestamp);
  if (grain === "weekly") {
    return `Week of ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function percentage(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 1000) / 10 : 0;
}

function groupByPeriod(rows: CallRow[], grain: TimeGrain): PeriodBucket[] {
  const groups = new Map<number, VoiceCall[]>();
  rows.forEach(({ call, timestamp }) => {
    const key = bucketStart(timestamp, grain);
    groups.set(key, [...(groups.get(key) ?? []), call]);
  });

  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([timestamp, calls]) => {
      const metrics = metricsForCalls(calls);
      return {
        key: String(timestamp),
        label: bucketLabel(timestamp, grain),
        calls: metrics.attempted,
        answered: metrics.pickedUp,
        answerRate: percentage(metrics.pickedUp, metrics.attempted),
        positiveRate: percentage(metrics.positive, metrics.attempted),
        callbacks: calls.filter(hasCallbackScheduledSignal).length,
        outcomes: metrics.outcomes,
      };
    });
}

function rateDelta(currentValue: number, currentTotal: number, previousValue: number, previousTotal: number) {
  if (previousTotal === 0) return null;
  return percentage(currentValue, currentTotal) - percentage(previousValue, previousTotal);
}

function countDelta(current: number, previous: number) {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function Delta({ value, unit = "%" }: { value: number | null; unit?: "%" | "pp" }) {
  if (value === null) return <span>No prior-period data</span>;
  const up = value >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn(
      "inline-flex items-center gap-1 font-medium tabular-nums",
      up ? "text-[color:var(--delta-up)]" : "text-[color:var(--delta-down)]",
    )}>
      <Icon className="size-3" aria-hidden="true" />
      {up ? "+" : ""}{value.toFixed(1)}{unit}
    </span>
  );
}

function MetricCard({
  label,
  value,
  delta,
  deltaUnit,
  comparisonLabel,
  comparisonEnabled,
  tone,
  icon: Icon,
}: {
  label: string;
  value: string;
  delta: number | null;
  deltaUnit?: "%" | "pp";
  comparisonLabel: string;
  comparisonEnabled: boolean;
  tone: MetricTone;
  icon: LucideIcon;
}) {
  const toneClass = METRIC_TONE_CLASS[tone];
  return (
    <div className={cn("border px-4 py-4", toneClass.card)}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <span className={cn("flex size-7 items-center justify-center rounded-full", toneClass.icon)}>
          <Icon className="size-3.5" aria-hidden="true" />
        </span>
      </div>
      <p className={cn("mt-1.5 text-2xl font-semibold tracking-tight tabular-nums", toneClass.value)}>{value}</p>
      <p className="mt-2 flex flex-wrap items-center gap-x-1.5 text-[9.9px] text-muted-foreground">
        {comparisonEnabled && <Delta value={delta} unit={deltaUnit} />}
        <span>{comparisonLabel}</span>
      </p>
    </div>
  );
}

function SectionHeader({ title, description, aside }: { title: string; description: string; aside?: React.ReactNode }) {
  return (
    <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      {aside}
    </div>
  );
}

function PerformanceRate({
  value,
  total,
  goodAt,
  cautionAt,
}: {
  value: number;
  total: number;
  goodAt: number;
  cautionAt: number;
}) {
  const rate = percentage(value, total);
  const className = rate >= goodAt
    ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-200"
    : rate >= cautionAt
      ? "bg-amber-50 text-amber-800 dark:bg-amber-400/10 dark:text-amber-200"
      : "bg-rose-50 text-rose-800 dark:bg-rose-400/10 dark:text-rose-200";
  return (
    <span className={cn("inline-flex min-w-14 justify-end px-2 py-1 font-medium tabular-nums", className)}>
      {formatVoicePercent(value, total)}
    </span>
  );
}

export function CampaignInsightsDashboard({ campaigns }: { campaigns: VoiceCampaign[] }) {
  const [dateRange, setDateRange] = useState<DateRange>("30d");
  const [grain, setGrain] = useState<TimeGrain>("daily");
  const [campaignId, setCampaignId] = useState("all");

  const allRows = useMemo<CallRow[]>(() => (
    campaigns
      .flatMap((campaign) => campaignCalls(campaign).map((call) => ({
        campaign,
        call,
        timestamp: callTimestamp(call, campaign),
      })))
      .filter(({ timestamp }) => timestamp > 0)
      .sort((a, b) => b.timestamp - a.timestamp)
  ), [campaigns]);

  const selectedSourceRows = useMemo(() => (
    campaignId === "all" ? allRows : allRows.filter(({ campaign }) => campaign.id === campaignId)
  ), [allRows, campaignId]);

  const rangeWindow = useMemo(() => {
    const latestTimestamp = selectedSourceRows[0]?.timestamp ?? 0;
    const anchor = latestTimestamp > 0 ? startOfDay(latestTimestamp) + 86_400_000 : 0;
    if (dateRange === "all") return { start: 0, previousStart: 0, anchor };
    const duration = RANGE_DAYS[dateRange] * 86_400_000;
    return { start: anchor - duration, previousStart: anchor - duration * 2, anchor };
  }, [dateRange, selectedSourceRows]);

  const filteredRows = useMemo(() => (
    selectedSourceRows.filter(({ timestamp }) => timestamp >= rangeWindow.start && timestamp < rangeWindow.anchor)
  ), [rangeWindow, selectedSourceRows]);

  const previousRows = useMemo(() => {
    if (dateRange === "all") return [];
    return selectedSourceRows.filter(({ timestamp }) => (
      timestamp >= rangeWindow.previousStart && timestamp < rangeWindow.start
    ));
  }, [dateRange, rangeWindow, selectedSourceRows]);

  const calls = useMemo(() => filteredRows.map(({ call }) => call), [filteredRows]);
  const previousCalls = useMemo(() => previousRows.map(({ call }) => call), [previousRows]);
  const metrics = useMemo(() => metricsForCalls(calls), [calls]);
  const previousMetrics = useMemo(() => metricsForCalls(previousCalls), [previousCalls]);
  const callbacks = useMemo(() => calls.filter(hasCallbackScheduledSignal).length, [calls]);
  const previousCallbacks = useMemo(() => previousCalls.filter(hasCallbackScheduledSignal).length, [previousCalls]);
  const periods = useMemo(() => groupByPeriod(filteredRows, grain), [filteredRows, grain]);
  const visiblePeriods = useMemo(() => periods.slice(grain === "daily" ? -14 : -12), [grain, periods]);
  const comparisonEnabled = dateRange !== "all";
  const comparisonLabel = dateRange === "all" ? "All available call history" : `vs previous ${RANGE_DAYS[dateRange]} days`;

  const activeOutcomes = useMemo(() => OUTCOME_ORDER.filter((outcome) => (
    visiblePeriods.some((period) => period.outcomes[outcome] > 0)
  )), [visiblePeriods]);

  const campaignRows = useMemo(() => {
    const grouped = new Map<string, { campaign: VoiceCampaign; calls: VoiceCall[] }>();
    filteredRows.forEach(({ campaign, call }) => {
      const current = grouped.get(campaign.id) ?? { campaign, calls: [] };
      current.calls.push(call);
      grouped.set(campaign.id, current);
    });
    return [...grouped.values()]
      .map(({ campaign, calls: campaignCallRows }) => ({
        campaign,
        calls: campaignCallRows,
        metrics: metricsForCalls(campaignCallRows),
        callbacks: campaignCallRows.filter(hasCallbackScheduledSignal).length,
      }))
      .sort((a, b) => b.metrics.attempted - a.metrics.attempted);
  }, [filteredRows]);

  const funnel = [
    { label: "Attempted", value: metrics.attempted, dot: "bg-slate-600", bar: "bg-slate-600" },
    { label: "Answered", value: metrics.pickedUp, dot: "bg-sky-500", bar: "bg-sky-500" },
    { label: "Engaged 20s+", value: metrics.engaged20s, dot: "bg-violet-500", bar: "bg-violet-500" },
    { label: "Positive outcome", value: metrics.positive, dot: "bg-emerald-500", bar: "bg-emerald-500" },
  ];

  const selectedCampaignName = campaigns.find((campaign) => campaign.id === campaignId)?.name ?? "All campaigns";

  function exportFilteredCalls() {
    downloadCSV(filteredRows.map(({ campaign, call }) => ({
      campaign: campaign.name,
      audience: campaign.segmentName || "No audience",
      customer: maskPhone(call.toNumber),
      started_at: call.startedAt ?? call.endedAt ?? "",
      status: call.status,
      outcome: OUTCOME_LABELS[classifyVoiceCallOutcome(call)],
      duration_seconds: call.durationSeconds ?? 0,
      answered: getVoiceCallStageFacts(call).pickedUp,
      engaged_20s: getVoiceCallStageFacts(call).engaged20s,
      callback_scheduled: hasCallbackScheduledSignal(call),
    })), `campaign-insights-${dateRange}.csv`);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4 border border-border bg-background p-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
            Campaign
            <select
              value={campaignId}
              onChange={(event) => setCampaignId(event.target.value)}
              className="h-10 min-w-56 border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="all">All campaigns</option>
              {campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
            </select>
          </label>
          <fieldset className="grid gap-1.5">
            <legend className="text-xs font-medium text-muted-foreground">Date range</legend>
            <div className="flex border border-border" aria-label="Date range">
              {(["7d", "30d", "90d", "all"] as DateRange[]).map((range) => (
                <button
                  key={range}
                  type="button"
                  aria-pressed={dateRange === range}
                  onClick={() => setDateRange(range)}
                  className={cn(
                    "h-10 min-w-12 border-r border-border px-3 text-xs font-medium last:border-r-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    dateRange === range ? "bg-foreground text-background" : "bg-background text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  {range === "all" ? "All" : range.toUpperCase()}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
        <Button variant="outline" className="h-10" onClick={exportFilteredCalls} disabled={filteredRows.length === 0}>
          <Download className="size-4" aria-hidden="true" />
          Export CSV
        </Button>
      </div>

      {filteredRows.length === 0 ? (
        <div className="border border-border bg-background px-6 py-16 text-center">
          <h2 className="text-sm font-semibold">No calls in this period</h2>
          <p className="mt-1 text-sm text-muted-foreground">Choose a wider date range or another campaign.</p>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <MetricCard
              label="Calls"
              value={numberFormatter.format(metrics.attempted)}
              tone="slate"
              icon={PhoneCall}
              delta={dateRange === "all" ? null : countDelta(metrics.attempted, previousMetrics.attempted)}
              comparisonLabel={comparisonLabel}
              comparisonEnabled={comparisonEnabled}
            />
            <MetricCard
              label="Answer rate"
              value={formatVoicePercent(metrics.pickedUp, metrics.attempted)}
              tone="blue"
              icon={PhoneIncoming}
              delta={dateRange === "all" ? null : rateDelta(metrics.pickedUp, metrics.attempted, previousMetrics.pickedUp, previousMetrics.attempted)}
              deltaUnit="pp"
              comparisonLabel={comparisonLabel}
              comparisonEnabled={comparisonEnabled}
            />
            <MetricCard
              label="Engaged 20s+"
              value={formatVoicePercent(metrics.engaged20s, metrics.attempted)}
              tone="violet"
              icon={Clock3}
              delta={dateRange === "all" ? null : rateDelta(metrics.engaged20s, metrics.attempted, previousMetrics.engaged20s, previousMetrics.attempted)}
              deltaUnit="pp"
              comparisonLabel={comparisonLabel}
              comparisonEnabled={comparisonEnabled}
            />
            <MetricCard
              label="Positive rate"
              value={formatVoicePercent(metrics.positive, metrics.attempted)}
              tone="emerald"
              icon={Sparkles}
              delta={dateRange === "all" ? null : rateDelta(metrics.positive, metrics.attempted, previousMetrics.positive, previousMetrics.attempted)}
              deltaUnit="pp"
              comparisonLabel={comparisonLabel}
              comparisonEnabled={comparisonEnabled}
            />
            <MetricCard
              label="Callbacks"
              value={numberFormatter.format(callbacks)}
              tone="cyan"
              icon={CalendarClock}
              delta={dateRange === "all" ? null : countDelta(callbacks, previousCallbacks)}
              comparisonLabel={comparisonLabel}
              comparisonEnabled={comparisonEnabled}
            />
          </div>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
            <section className="min-w-0 border border-border bg-background">
              <SectionHeader
                title="Call volume and conversion"
                description={`${selectedCampaignName} · ${grain === "daily" ? "Daily" : "Weekly"} performance`}
                aside={(
                  <div className="flex border border-border" aria-label="Chart interval">
                    {(["daily", "weekly"] as TimeGrain[]).map((value) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={grain === value}
                        onClick={() => setGrain(value)}
                        className={cn(
                          "h-9 px-3 text-xs font-medium capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                          grain === value ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                )}
              />
              <figure
                className="p-4"
                role="img"
                aria-label={`Call volume chart for ${selectedCampaignName}. ${metrics.attempted} calls with a ${formatVoicePercent(metrics.pickedUp, metrics.attempted)} answer rate.`}
              >
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={visiblePeriods} margin={{ top: 12, right: 4, bottom: 0, left: -18 }}>
                      <CartesianGrid vertical={false} stroke="var(--color-border)" strokeOpacity={0.65} />
                      <XAxis
                        dataKey="label"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 9, fill: "var(--color-muted-foreground)" }}
                        interval="preserveStartEnd"
                        minTickGap={28}
                      />
                      <YAxis
                        yAxisId="count"
                        axisLine={false}
                        tickLine={false}
                        allowDecimals={false}
                        tick={{ fontSize: 9, fill: "var(--color-muted-foreground)" }}
                      />
                      <YAxis
                        yAxisId="rate"
                        orientation="right"
                        domain={[0, 100]}
                        tickFormatter={(value) => `${value}%`}
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 9, fill: "var(--color-muted-foreground)" }}
                      />
                      <Tooltip
                        cursor={{ fill: "var(--color-muted)", opacity: 0.45 }}
                        contentStyle={{
                          border: "1px solid var(--color-border)",
                          borderRadius: 0,
                          background: "var(--color-popover)",
                          color: "var(--color-foreground)",
                          fontSize: 10.8,
                        }}
                        formatter={(value, name) => [name === "Calls" ? Number(value).toLocaleString() : `${value}%`, name]}
                      />
                      <Bar yAxisId="count" dataKey="calls" name="Calls" fill="var(--color-sky-400)" fillOpacity={0.28} maxBarSize={34} />
                      <Line yAxisId="rate" type="monotone" dataKey="answerRate" name="Answer rate" stroke="var(--color-sky-600)" strokeWidth={2} dot={{ r: 2.5, fill: "var(--color-sky-600)" }} activeDot={{ r: 4 }} />
                      <Line yAxisId="rate" type="monotone" dataKey="positiveRate" name="Positive rate" stroke="var(--color-emerald-600)" strokeWidth={2} strokeDasharray="5 4" dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <figcaption className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-2"><span className="size-2 bg-sky-300" />Calls</span>
                  <span className="inline-flex items-center gap-2"><span className="h-0.5 w-4 bg-sky-600" />Answer rate</span>
                  <span className="inline-flex items-center gap-2"><span className="w-4 border-t-2 border-dashed border-emerald-600" />Positive rate</span>
                </figcaption>
              </figure>
            </section>

            <section className="border border-border bg-background">
              <SectionHeader title="Call funnel" description="Conversion from attempt to positive outcome" />
              <div className="space-y-5 p-4">
                {funnel.map((stage, index) => {
                  const width = percentage(stage.value, metrics.attempted);
                  return (
                    <div key={stage.label}>
                      <div className="mb-1.5 flex items-end justify-between gap-4">
                        <div>
                          <p className="flex items-center gap-2 text-xs font-medium text-foreground">
                            <span className={cn("size-2 rounded-full", stage.dot)} aria-hidden="true" />
                            {stage.label}
                          </p>
                          {index > 0 && <p className="mt-0.5 text-[9.9px] text-muted-foreground">{width.toFixed(1)}% of attempted</p>}
                        </div>
                        <span className="text-sm font-semibold tabular-nums">{numberFormatter.format(stage.value)}</span>
                      </div>
                      <div className="h-2 bg-muted" aria-hidden="true">
                        <div className={cn("h-full", stage.bar)} style={{ width: `${Math.max(stage.value > 0 ? 2 : 0, width)}%`, opacity: 1 - index * 0.08 }} />
                      </div>
                    </div>
                  );
                })}
                <div className="border border-sky-100 bg-sky-50/60 p-3 dark:border-sky-400/20 dark:bg-sky-400/5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="flex items-center gap-2 text-xs font-medium text-sky-800 dark:text-sky-200">
                        <span className="size-2 rounded-full bg-sky-500" aria-hidden="true" />
                        Callback scheduled
                      </p>
                      <p className="mt-0.5 text-[9.9px] text-muted-foreground">Tracked separately from conversion</p>
                    </div>
                    <span className="text-sm font-semibold text-sky-800 tabular-nums dark:text-sky-200">{numberFormatter.format(callbacks)}</span>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <section className="border border-border bg-background">
            <SectionHeader
              title={`Outcome distribution · ${grain === "daily" ? "Daily" : "Weekly"}`}
              description="Count and share of calls in each outcome; most recent periods are shown first"
            />
            <DataTableScroll>
              <table className={cn(dataTableClassNames.table, "min-w-[900px]")}>
                <thead className={dataTableClassNames.head}>
                  <tr className={dataTableClassNames.headerRow}>
                    <th className={cn(dataTableClassNames.headerCell, "sticky left-0 z-10 w-48 bg-neutral-50")}>Outcome</th>
                    {[...visiblePeriods].reverse().map((period) => (
                      <th key={period.key} className={cn(dataTableClassNames.headerCell, "min-w-28 text-right")}>{period.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activeOutcomes.map((outcome) => (
                    <tr key={outcome} className={dataTableClassNames.row}>
                      <th scope="row" className={cn(dataTableClassNames.cell, "sticky left-0 z-10 bg-white text-left text-xs font-medium")}>
                        <span className="inline-flex items-center gap-2">
                          <span className={cn("size-2 rounded-full", VOICE_OUTCOME_TONE[outcome].dot)} aria-hidden="true" />
                          {OUTCOME_LABELS[outcome]}
                        </span>
                      </th>
                      {[...visiblePeriods].reverse().map((period) => {
                        const count = period.outcomes[outcome];
                        return (
                          <td key={period.key} className={cn(
                            dataTableClassNames.numericCell,
                            count > 0 && VOICE_OUTCOME_TONE[outcome].cell,
                          )}>
                            <span className={count > 0 ? "font-medium" : undefined}>{numberFormatter.format(count)}</span>{" "}
                            <span className={cn("text-xs", count > 0 ? "opacity-70" : "text-muted-foreground")}>({percentage(count, period.calls).toFixed(1)}%)</span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </DataTableScroll>
          </section>

          <DataTableFrame>
            <SectionHeader
              title="Campaign performance"
              description={`${campaignRows.length} campaign${campaignRows.length === 1 ? "" : "s"} with call activity in the selected period`}
            />
            <DataTableScroll>
              <table className={cn(dataTableClassNames.table, "min-w-[900px]")}>
                <thead className={dataTableClassNames.head}>
                  <tr className={dataTableClassNames.headerRow}>
                    <th className={dataTableClassNames.headerCell}>Campaign</th>
                    <th className={cn(dataTableClassNames.headerCell, "text-right")}>Calls</th>
                    <th className={cn(dataTableClassNames.headerCell, "text-right")}>Answer rate</th>
                    <th className={cn(dataTableClassNames.headerCell, "text-right")}>20s+</th>
                    <th className={cn(dataTableClassNames.headerCell, "text-right")}>Positive</th>
                    <th className={cn(dataTableClassNames.headerCell, "text-right")}>Callbacks</th>
                    <th className={cn(dataTableClassNames.headerCell, "text-right")}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {campaignRows.map(({ campaign, metrics: campaignMetric, callbacks: campaignCallbacks }) => (
                    <tr key={campaign.id} className={dataTableClassNames.row}>
                      <td className={dataTableClassNames.cell}>
                        <Link href={campaignHref(campaign.id)} className="font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          {campaign.name}
                        </Link>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{campaign.segmentName || "No audience"}</p>
                      </td>
                      <td className={dataTableClassNames.numericCell}>{numberFormatter.format(campaignMetric.attempted)}</td>
                      <td className={dataTableClassNames.numericCell}>
                        <PerformanceRate value={campaignMetric.pickedUp} total={campaignMetric.attempted} goodAt={75} cautionAt={45} />
                      </td>
                      <td className={dataTableClassNames.numericCell}>
                        <PerformanceRate value={campaignMetric.engaged20s} total={campaignMetric.attempted} goodAt={50} cautionAt={25} />
                      </td>
                      <td className={dataTableClassNames.numericCell}>
                        <PerformanceRate value={campaignMetric.positive} total={campaignMetric.attempted} goodAt={15} cautionAt={5} />
                      </td>
                      <td className={dataTableClassNames.numericCell}>
                        <span className={cn(
                          "inline-flex min-w-10 justify-end px-2 py-1 font-medium tabular-nums",
                          campaignCallbacks > 0
                            ? "bg-sky-50 text-sky-800 dark:bg-sky-400/10 dark:text-sky-200"
                            : "text-muted-foreground",
                        )}>
                          {numberFormatter.format(campaignCallbacks)}
                        </span>
                      </td>
                      <td className={dataTableClassNames.numericCell}>
                        <VoiceCampaignStatusPill
                          status={campaign.status}
                          hasScheduledCallback={campaignCallbacks > 0}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DataTableScroll>
          </DataTableFrame>
        </>
      )}
    </div>
  );
}
