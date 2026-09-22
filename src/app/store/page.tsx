"use client";

import { useRouter } from "next/navigation";
import { Package, ShoppingBag, Receipt, Users, Tag, ArrowRight } from "lucide-react";
import { StoreKPICards } from "@/components/store/store-kpi-cards";
import { StoreRevenueChart } from "@/components/store/store-revenue-chart";
import { StoreInsightsSection } from "@/components/store/store-insights-section";
import {
  getStoreKPIs,
  getRevenueChartData,
  getAllSKUs,
  getAllTransactions,
  getAllPlayers,
  getAllOffers,
  getStoreInsights,
} from "@/lib/store-store";
import type { StoreInsight } from "@/lib/store-types";
import { FeatureGate } from "@/components/feature-gate";
import { useDataset } from "@/lib/dataset-context";

const quickLinks = [
  {
    label: "Catalog",
    description: "Manage SKUs and pricing",
    icon: Package,
    href: "/store/catalog",
    stat: () => `${getAllSKUs().length} SKUs`,
  },
  {
    label: "Offers",
    description: "Discounts and targeted offers",
    icon: Tag,
    href: "/store/offers",
    stat: () => `${getAllOffers().length} offers`,
  },
  {
    label: "Transactions",
    description: "View and manage transactions",
    icon: Receipt,
    href: "/store/transactions",
    stat: () => `${getAllTransactions().length} total`,
  },
  {
    label: "Players",
    description: "Player management and profiles",
    icon: Users,
    href: "/store/players",
    stat: () => `${getAllPlayers().length} players`,
  },
];

export default function StoreOverviewPage() {
  const { dataset } = useDataset();
  const router = useRouter();

  if (dataset?.isDynamic) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-6">
        <ShoppingBag className="h-10 w-10 text-muted-foreground/50 mb-3" />
        <h2 className="text-lg font-medium mb-1">Store not available</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          The Store is currently available for sample datasets only. Switch to a sample dataset to explore this feature.
        </p>
      </div>
    );
  }

  const kpis = getStoreKPIs();
  const chartData = getRevenueChartData();
  const insights = getStoreInsights();

  const handleInsightAction = (insight: StoreInsight) => {
    const p = insight.actionPayload;
    switch (insight.actionType) {
      case "view-player":
        router.push(`/store/players/${p?.playerId ?? ""}`);
        break;
      case "view-sku":
        router.push("/store/catalog");
        break;
      case "view-transactions":
        router.push("/store/transactions");
        break;
      case "create-offer": {
        const id = `offer-new-${Date.now()}`;
        const params = new URLSearchParams();
        if (p?.skuId) params.set("skuId", p.skuId);
        if (p?.territory) params.set("audienceType", "segment");
        if (p?.territory) params.set("audienceValue", `${p.territory} Players`);
        router.push(`/store/offers/${id}?prefill=${encodeURIComponent(params.toString())}`);
        break;
      }
      default:
        break;
    }
  };

  return (
    <FeatureGate feature="store">
    <div className="flex flex-col h-full min-w-0">
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-8">
          {/* KPI Cards */}
          <div className="mb-6">
            <StoreKPICards kpis={kpis} />
          </div>

          {/* Insights — primary visual weight */}
          <div className="mb-6">
            <StoreInsightsSection insights={insights} onAction={handleInsightAction} />
          </div>

          {/* Revenue Chart */}
          <div className="mb-6">
            <StoreRevenueChart data={chartData} />
          </div>

          {/* Quick Links */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {quickLinks.map((link) => (
              <button
                key={link.href}
                onClick={() => router.push(link.href)}
                onMouseEnter={() => router.prefetch(link.href)}
                className="flex items-start gap-3 p-4 border border-border rounded-lg hover:bg-muted/30 transition-colors text-left group"
              >
                <link.icon className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{link.label}</p>
                    <ArrowRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {link.description}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {link.stat()}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </main>
    </div>
    </FeatureGate>
  );
}
