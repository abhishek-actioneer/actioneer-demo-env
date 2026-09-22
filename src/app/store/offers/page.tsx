"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Search, Plus, ArrowRight } from "lucide-react";
import { getAllOffers, getAllCampaigns, getOffersByCampaign } from "@/lib/store-store";
import { OFFER_TYPE_LABELS, OFFER_STATUS_LABELS } from "@/lib/store-types";
import type { OfferStatus, Campaign } from "@/lib/store-types";
import { Sparkline } from "@/components/store/sparkline";

const STATUS_FILTERS: Array<OfferStatus | "all"> = ["all", "active", "scheduled", "draft", "paused", "expired"];

function CampaignCard({ campaign, onClick }: { campaign: Campaign; onClick: () => void }) {
  const offers = getOffersByCampaign(campaign.id);
  const totalRevenue = offers.reduce((s, o) => s + o.performance.revenue, 0);
  const totalConversions = offers.reduce((s, o) => s + o.performance.conversions, 0);
  const totalViews = offers.reduce((s, o) => s + o.performance.views, 0);
  const convRate = totalViews > 0 ? (totalConversions / totalViews) * 100 : 0;

  // Merge all dailyRevenue arrays into a single 14-day total
  const mergedDaily = Array(14).fill(0);
  offers.forEach((o) => {
    o.performance.dailyRevenue.forEach((v, i) => {
      mergedDaily[i] += v;
    });
  });

  return (
    <button
      onClick={onClick}
      className="border border-border rounded-lg p-4 text-left hover:bg-muted/20 transition-colors group"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{campaign.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{campaign.description}</p>
        </div>
        <Sparkline data={mergedDaily} width={72} height={24} />
      </div>
      <div className="flex items-center gap-4 mt-3">
        <div>
          <p className="text-base font-semibold">${totalRevenue.toFixed(0)}</p>
          <p className="text-[9px] text-muted-foreground">Revenue</p>
        </div>
        <div>
          <p className="text-base font-semibold">{totalConversions}</p>
          <p className="text-[9px] text-muted-foreground">Conversions</p>
        </div>
        <div>
          <p className="text-base font-semibold">{convRate.toFixed(1)}%</p>
          <p className="text-[9px] text-muted-foreground">Conv. Rate</p>
        </div>
        <div className="ml-auto flex items-center gap-1 text-[9px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
          {offers.length} offers
          <ArrowRight className="w-3 h-3" />
        </div>
      </div>
    </button>
  );
}

export default function OffersPage() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<OfferStatus | "all">("all");
  const [campaignFilter, setCampaignFilter] = useState<string>("all");

  const allOffers = useMemo(() => getAllOffers(), []);
  const allCampaigns = useMemo(() => getAllCampaigns(), []);

  const filtered = useMemo(() => {
    let list = allOffers;
    if (statusFilter !== "all") {
      list = list.filter((o) => o.status === statusFilter);
    }
    if (campaignFilter !== "all") {
      list = list.filter((o) => o.campaignId === campaignFilter);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (o) =>
          o.name.toLowerCase().includes(q) ||
          o.skuName.toLowerCase().includes(q) ||
          o.id.toLowerCase().includes(q)
      );
    }
    return list;
  }, [allOffers, statusFilter, campaignFilter, searchQuery]);

  return (
    <div className="flex flex-col h-full min-w-0">
      <main className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-8 pt-8 pb-6">
          <h1 className="text-xl font-semibold">Offers</h1>
          <button
            onClick={() => {
              const id = `offer-new-${Date.now()}`;
              router.push(`/store/offers/${id}`);
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium bg-foreground text-background rounded-lg hover:bg-foreground/90 active:scale-[0.98] transition-[background-color,transform]"
          >
            <Plus className="w-4 h-4" />
            New Offer
          </button>
        </div>

        <div className="max-w-5xl mx-auto px-6 pb-8 w-full">
          {/* Campaign summary cards */}
          {allCampaigns.length > 0 && (
            <div className="mb-6">
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Campaigns
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {allCampaigns.map((c) => (
                  <CampaignCard
                    key={c.id}
                    campaign={c}
                    onClick={() => setCampaignFilter(c.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Search */}
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search Offers"
              className="w-full max-w-sm pl-10 pr-4 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring/20"
            />
          </div>

          {/* Status filter pills */}
          <div className="flex items-center gap-1.5 mb-3">
            <span className="text-xs text-muted-foreground mr-1">Status</span>
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors capitalize ${
                  statusFilter === s
                    ? "bg-foreground text-background border-foreground"
                    : "bg-background text-foreground border-border hover:bg-muted"
                }`}
              >
                {s === "all" ? "All" : OFFER_STATUS_LABELS[s]}
              </button>
            ))}
          </div>

          {/* Campaign filter pills */}
          <div className="flex items-center gap-1.5 mb-6">
            <span className="text-xs text-muted-foreground mr-1">Campaign</span>
            <button
              onClick={() => setCampaignFilter("all")}
              className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                campaignFilter === "all"
                  ? "bg-foreground text-background border-foreground"
                  : "bg-background text-foreground border-border hover:bg-muted"
              }`}
            >
              All
            </button>
            {allCampaigns.map((c) => (
              <button
                key={c.id}
                onClick={() => setCampaignFilter(c.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                  campaignFilter === c.id
                    ? "bg-foreground text-background border-foreground"
                    : "bg-background text-foreground border-border hover:bg-muted"
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>

          {/* Table */}
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-muted/30 border-b border-border">
                  <th className="text-left py-2.5 px-3 text-[9.9px] font-medium text-muted-foreground uppercase tracking-wider">
                    Name
                  </th>
                  <th className="text-left py-2.5 px-3 text-[9.9px] font-medium text-muted-foreground uppercase tracking-wider w-[80px]">
                    14d Trend
                  </th>
                  <th className="text-left py-2.5 px-3 text-[9.9px] font-medium text-muted-foreground uppercase tracking-wider w-[100px]">
                    Type
                  </th>
                  <th className="text-left py-2.5 px-3 text-[9.9px] font-medium text-muted-foreground uppercase tracking-wider w-[100px]">
                    Audience
                  </th>
                  <th className="text-left py-2.5 px-3 text-[9.9px] font-medium text-muted-foreground uppercase tracking-wider w-[80px]">
                    Status
                  </th>
                  <th className="text-right py-2.5 px-3 text-[9.9px] font-medium text-muted-foreground uppercase tracking-wider w-[70px]">
                    Views
                  </th>
                  <th className="text-right py-2.5 px-3 text-[9.9px] font-medium text-muted-foreground uppercase tracking-wider w-[60px]">
                    Conv.
                  </th>
                  <th className="text-right py-2.5 px-3 text-[9.9px] font-medium text-muted-foreground uppercase tracking-wider w-[80px]">
                    Revenue
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((offer, idx) => {
                  const convRate =
                    offer.performance.views > 0
                      ? ((offer.performance.conversions / offer.performance.views) * 100).toFixed(1)
                      : "—";
                  return (
                    <tr
                      key={offer.id}
                      onClick={() => router.push(`/store/offers/${offer.id}`)}
                      onMouseEnter={() => router.prefetch(`/store/offers/${offer.id}`)}
                      className={`cursor-pointer hover:bg-muted/20 transition-colors ${
                        idx < filtered.length - 1 ? "border-b border-border" : ""
                      }`}
                    >
                      <td className="py-2.5 px-3">
                        <p className="text-[11.7px] font-medium">{offer.name}</p>
                        <p className="text-[9.9px] text-muted-foreground mt-0.5">
                          {offer.skuName}
                          {offer.createdBy === "sentinel" && (
                            <span className="ml-1.5 text-[9px] text-muted-foreground/60">· Actioneer</span>
                          )}
                        </p>
                      </td>
                      <td className="py-2.5 px-3">
                        <Sparkline
                          data={offer.performance.dailyRevenue}
                          width={64}
                          height={20}
                        />
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="text-[11.7px] text-muted-foreground">
                          {OFFER_TYPE_LABELS[offer.type]}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="text-[11.7px]">
                          {offer.audienceType === "all" ? "All" : offer.audienceValue ?? "—"}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="inline-flex items-center px-2 py-0.5 text-[9px] font-medium border border-border rounded-md">
                          {OFFER_STATUS_LABELS[offer.status]}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <span className="text-[11.7px] tabular-nums text-muted-foreground">
                          {offer.performance.views > 0 ? offer.performance.views.toLocaleString() : "—"}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <span className="text-[11.7px] tabular-nums">
                          {offer.performance.conversions > 0
                            ? `${offer.performance.conversions}`
                            : "—"}
                        </span>
                        {convRate !== "—" && (
                          <span className="text-[9px] text-muted-foreground ml-1">
                            {convRate}%
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <span className="text-[11.7px] font-medium tabular-nums">
                          {offer.performance.revenue > 0 ? `$${offer.performance.revenue.toFixed(0)}` : "—"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td
                      colSpan={8}

                      className="py-8 text-center text-[11.7px] text-muted-foreground"
                    >
                      No offers found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
