// src/app/billing/page.tsx
"use client";

import { useCallback, useState, useMemo } from "react";
import { useSidebarContext } from "@/components/sidebar-context";
import {
  getOrgCredits,
  getDailyUsageBySource,
  getTransactionHistory,
  topUpCredits,
} from "@/lib/credit-store";
import { MONTHLY_CREDIT_ALLOWANCE, TOP_UP_OPTIONS } from "@/lib/credit-types";
import { HelpCircle, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { FeatureGate } from "@/components/feature-gate";

function getMonthLabel(date: Date): string {
  return date.toLocaleDateString([], { month: "long", year: "numeric" });
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

type Tab = "usage" | "billing";

export default function BillingPage() {
  const { creditVersion, notifyCreditChanged } = useSidebarContext();
  void creditVersion;

  const org = getOrgCredits();
  const [activeTab, setActiveTab] = useState<Tab>("usage");

  // Month selector state
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(() => ({
    year: now.getFullYear(),
    month: now.getMonth(),
  }));

  const daysInMonth = getDaysInMonth(selectedMonth.year, selectedMonth.month);

  const dailyUsage = useMemo(() => {
    // Build a full month of day slots (1st to last day)
    const all = getDailyUsageBySource(365);
    const usageMap = new Map(all.map((d) => [d.date, d]));
    const result: { date: string; chat: number; agent: number }[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(selectedMonth.year, selectedMonth.month, day);
      const dateStr = d.toISOString().slice(0, 10);
      const existing = usageMap.get(dateStr);
      result.push(existing ?? { date: dateStr, chat: 0, agent: 0 });
    }
    return result;
  }, [selectedMonth, creditVersion, daysInMonth]);

  const periodTotal = useMemo(() => {
    if (!org) return MONTHLY_CREDIT_ALLOWANCE;
    return org.transactions
      .filter((t) => t.type === "grant" || t.type === "topup")
      .reduce((sum, t) => sum + t.amount, 0);
  }, [org, creditVersion]);

  // Only grants and top-ups for the billing tab
  const billingTransactions = useMemo(() => {
    const all = getTransactionHistory(undefined);
    return all.filter((t) => t.type === "grant" || t.type === "topup");
  }, [creditVersion]);

  const handleTopUp = useCallback((credits: number) => {
    const txn = topUpCredits(credits);
    if (txn) {
      notifyCreditChanged();
      toast.success(`Added ${txn.amount.toLocaleString()} credits`);
    }
  }, [notifyCreditChanged]);

  // Generate last 12 months as options
  const monthOptions = useMemo(() => {
    const options: { value: string; label: string }[] = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i);
      options.push({
        value: `${d.getFullYear()}-${d.getMonth()}`,
        label: getMonthLabel(d),
      });
    }
    return options;
  }, []);

  const selectedMonthValue = `${selectedMonth.year}-${selectedMonth.month}`;

  const handleMonthChange = useCallback((value: string) => {
    const [y, m] = value.split("-").map(Number);
    setSelectedMonth({ year: y, month: m });
  }, []);

  if (!org) {
    return (
      <FeatureGate feature="credits">
        <div className="flex flex-col h-full min-w-0">
          <div className="max-w-5xl mx-auto px-6 py-8">
            <p className="text-muted-foreground">No credit data available.</p>
          </div>
        </div>
      </FeatureGate>
    );
  }

  const creditsUsed = periodTotal - org.balance;
  const usagePct = periodTotal > 0 ? Math.min((creditsUsed / periodTotal) * 100, 100) : 0;
  const hasUsage = dailyUsage.some((d) => d.chat + d.agent > 0);
  const maxDaily = hasUsage ? Math.max(...dailyUsage.map((d) => d.chat + d.agent)) : 1;

  return (
    <FeatureGate feature="credits">
      <div className="flex flex-col h-full min-w-0">
        {/* ── Sticky Banner ── */}
        <div className="sticky top-0 z-10 bg-background">
          <div className="max-w-4xl mx-auto px-6 pt-8 pb-4 flex items-center justify-between">
            <div>
              <div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-semibold tabular-nums">
                    {creditsUsed.toLocaleString()}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    / {periodTotal.toLocaleString()} credits used
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{org.orgName} &middot; Resets monthly</p>
              </div>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-foreground text-background hover:bg-foreground/90 transition-colors" />
                }
              >
                Top Up Credits
                <ChevronDown className="w-3.5 h-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {TOP_UP_OPTIONS.map((opt) => (
                  <DropdownMenuItem
                    key={opt.id}
                    onClick={() => handleTopUp(opt.credits)}
                    className="cursor-pointer"
                  >
                    {opt.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* ── Tabs + Month Selector ── */}
          <div className="max-w-4xl mx-auto px-6 flex items-end justify-between border-b border-border mt-4">
            <div className="flex gap-6">
              {(["usage", "billing"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`pb-3 text-sm font-medium border-b-2 -mb-px transition-colors capitalize ${
                    activeTab === tab
                      ? "border-foreground text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
            {activeTab === "usage" && (
              <div className="pb-2">
                <Select value={selectedMonthValue} onValueChange={handleMonthChange}>
                  <SelectTrigger className="w-[160px] h-8 text-xs shadow-none">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {monthOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </div>

        {/* ── Content ── */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto px-6 pt-16 pb-12 space-y-16">
            {activeTab === "usage" ? (
              <>
                {/* ── Usage This Period ── */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-muted-foreground">Usage This Period</span>
                    <span className="text-sm tabular-nums text-muted-foreground">
                      {creditsUsed.toLocaleString()} of {periodTotal.toLocaleString()} used
                    </span>
                  </div>
                  <div className="h-4 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-foreground rounded-full transition-all duration-300"
                      style={{ width: `${Math.max(usagePct, 0.5)}%` }}
                    />
                  </div>
                </div>

                {/* ── Daily Usage Chart ── */}
                <div className="border border-border rounded-xl p-6">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-sm font-medium">Daily Usage</span>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-[2px] bg-foreground" />
                        Chat
                      </span>
                      <span className="flex items-center gap-1.5 relative group/tip">
                        <span className="w-2 h-2 rounded-[2px] bg-foreground/30" />
                        System Processes
                        <HelpCircle className="w-3 h-3 text-muted-foreground/60" />
                        <span className="absolute top-full right-0 mt-1.5 w-52 px-3 py-2 rounded-lg bg-foreground text-background text-[9.9px] leading-relaxed opacity-0 group-hover/tip:opacity-100 transition-opacity pointer-events-none z-30">
                          Credits used by automated processes like schema mapping, playbook runs, and scout runs.
                        </span>
                      </span>
                    </div>
                  </div>

                  <div className="relative">
                    {hasUsage ? (
                      <>
                        <div className="flex items-end gap-[3px] h-56 pt-8">
                          {dailyUsage.map((day) => {
                            const total = day.chat + day.agent;
                            const totalPct = maxDaily > 0 ? (total / maxDaily) * 100 : 0;
                            const label = new Date(day.date + "T12:00:00").toLocaleDateString([], { month: "short", day: "numeric" });

                            return (
                              <div
                                key={day.date}
                                className="flex-1 flex flex-col justify-end h-full group relative"
                              >
                                {total > 0 && (
                                  <div className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none bg-foreground text-background text-[9px] px-2 py-1 rounded whitespace-nowrap z-20">
                                    {label}: {total} credits
                                  </div>
                                )}
                                {total > 0 ? (
                                  <div
                                    className="w-full flex flex-col rounded-t-sm overflow-hidden"
                                    style={{ height: `${Math.max(totalPct, 3)}%` }}
                                  >
                                    {day.agent > 0 && (
                                      <div className="w-full bg-foreground/30" style={{ flex: `${day.agent} 0 0` }} />
                                    )}
                                    {day.chat > 0 && (
                                      <div className="w-full bg-foreground" style={{ flex: `${day.chat} 0 0` }} />
                                    )}
                                  </div>
                                ) : (
                                  <div className="w-full bg-muted rounded-sm" style={{ height: 2 }} />
                                )}
                              </div>
                            );
                          })}
                        </div>
                        <div className="flex justify-between mt-2 text-[9px] text-muted-foreground">
                          {dailyUsage
                            .filter((_, i) => i === 0 || i % 7 === 0 || i === dailyUsage.length - 1)
                            .map((day) => (
                              <span key={day.date}>
                                {new Date(day.date + "T12:00:00").toLocaleDateString([], { month: "short", day: "numeric" })}
                              </span>
                            ))}
                        </div>
                      </>
                    ) : (
                      <div className="h-56 rounded-lg border border-dashed border-border flex items-center justify-center">
                        <p className="text-sm text-muted-foreground">No usage yet this period</p>
                      </div>
                    )}
                  </div>

                </div>
              </>
            ) : (
              <>
                {/* ── Plan ── */}
                <div>
                  <h2 className="text-sm font-medium mb-4">Plan</h2>
                  <div className="border border-border rounded-lg p-5 flex items-center justify-between">
                    <div>
                      <p className="text-base font-semibold">Free Trial</p>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {MONTHLY_CREDIT_ALLOWANCE.toLocaleString()} credits &middot; 14-day trial
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Expires {new Date(now.getTime() + 14 * 86400000).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}
                      </p>
                    </div>
                    <button className="px-3 py-1.5 rounded-lg text-sm font-medium border border-border text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors">
                      Contact Sales
                    </button>
                  </div>
                </div>


                {/* ── Transactions ── */}
                <div>
                  <h2 className="text-sm font-medium mb-4">Transactions</h2>
                  {billingTransactions.length > 0 ? (
                    <div className="border border-border rounded-lg overflow-hidden">
                      <div className="grid grid-cols-[1fr_120px_80px] px-4 py-2.5 border-b border-border bg-muted/30 text-xs text-muted-foreground font-medium">
                        <span>Date</span>
                        <span>Description</span>
                        <span className="text-right">Credits</span>
                      </div>
                      {billingTransactions.map((txn) => {
                        const date = new Date(txn.timestamp);
                        const dateStr = date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
                        const desc = txn.type === "grant" ? "Trial grant" : "Top-up";
                        return (
                          <div
                            key={txn.id}
                            className="grid grid-cols-[1fr_120px_80px] px-4 py-2.5 border-b border-border last:border-b-0 text-sm items-center"
                          >
                            <span>{dateStr}</span>
                            <span className="text-muted-foreground">{desc}</span>
                            <span className="text-right tabular-nums font-medium">+{txn.amount.toLocaleString()}</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="h-24 rounded-lg border border-dashed border-border flex items-center justify-center">
                      <p className="text-sm text-muted-foreground">No transactions yet</p>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </FeatureGate>
  );
}
