"use client";

import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { deltaColorClass } from "@/lib/delta-colors";
import type { StoreKPI } from "@/lib/store-types";

interface StoreKPICardsProps {
  kpis: StoreKPI;
}

interface KPICardProps {
  label: string;
  value: string;
  change: number;
  invertTrend?: boolean;
}

function KPICard({ label, value, change, invertTrend }: KPICardProps) {
  const isPositive = invertTrend ? change <= 0 : change >= 0;
  const isFlat = Math.abs(change) < 0.1;

  return (
    <div className="border border-border rounded-lg p-4">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
      <div className="flex items-center gap-1 mt-1.5">
        {isFlat ? (
          <Minus className="w-3 h-3 text-muted-foreground" />
        ) : isPositive ? (
          <TrendingUp className="w-3 h-3 text-foreground" />
        ) : (
          <TrendingDown className="w-3 h-3 text-muted-foreground" />
        )}
        <span
          className={`text-xs font-medium ${deltaColorClass(change)}`}
        >
          {change > 0 ? "+" : ""}
          {change.toFixed(1)}%
        </span>
        <span className="text-xs text-muted-foreground">vs last period</span>
      </div>
    </div>
  );
}

function formatCurrency(value: number): string {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

export function StoreKPICards({ kpis }: StoreKPICardsProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      <KPICard
        label="Gross Revenue"
        value={formatCurrency(kpis.grossRevenue)}
        change={kpis.grossRevenueChange}
      />
      <KPICard
        label="Transactions"
        value={kpis.transactions.toLocaleString()}
        change={kpis.transactionsChange}
      />
      <KPICard
        label="ARPU"
        value={formatCurrency(kpis.arpu)}
        change={kpis.arpuChange}
      />
      <KPICard
        label="AOV"
        value={formatCurrency(kpis.aov)}
        change={kpis.aovChange}
      />
      <KPICard
        label="Refunds"
        value={kpis.refunds.toLocaleString()}
        change={kpis.refundsChange}
        invertTrend
      />
    </div>
  );
}
