"use client";

import { useState, useMemo, use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  getOffer,
  createOffer,
  updateOffer,
  deleteOffer,
  getAllSKUs,
  getAllCampaigns,
} from "@/lib/store-store";
import {
  OFFER_TYPES,
  OFFER_TYPE_LABELS,
  OFFER_STATUSES,
  OFFER_STATUS_LABELS,
} from "@/lib/store-types";
import type { Offer, OfferType, OfferAudienceType, OfferStatus } from "@/lib/store-types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Tab = "details" | "performance";

export default function OfferDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>("details");
  const [showDelete, setShowDelete] = useState(false);

  const isNew = id.startsWith("offer-new-");
  const existing = isNew ? undefined : getOffer(id);
  const allSKUs = useMemo(() => getAllSKUs(), []);
  const allCampaigns = useMemo(() => getAllCampaigns(), []);

  // Parse prefill from URL params
  const prefillStr = searchParams.get("prefill");
  const prefill = useMemo(() => {
    if (!prefillStr) return null;
    try {
      return Object.fromEntries(new URLSearchParams(prefillStr));
    } catch {
      return null;
    }
  }, [prefillStr]);

  // Form state
  const defaultSku = prefill?.skuId
    ? allSKUs.find((s) => s.id === prefill.skuId)
    : null;

  const [name, setName] = useState(() => existing?.name ?? "");
  const [skuId, setSkuId] = useState(() => existing?.skuId ?? defaultSku?.id ?? allSKUs[0]?.id ?? "");
  const [offerType, setOfferType] = useState<OfferType>(
    () => (existing?.type ?? (prefill?.type as OfferType) ?? "discount_percentage")
  );
  const [value, setValue] = useState(() =>
    existing ? String(existing.value) : prefill?.value ?? "15"
  );
  const [audienceType, setAudienceType] = useState<OfferAudienceType>(
    () => (existing?.audienceType ?? (prefill?.audienceType as OfferAudienceType) ?? "all")
  );
  const [audienceValue, setAudienceValue] = useState(
    () => existing?.audienceValue ?? prefill?.audienceValue ?? ""
  );
  const [startDate, setStartDate] = useState(
    () => existing?.startDate ?? new Date().toISOString().split("T")[0]
  );
  const [endDate, setEndDate] = useState(() => {
    if (existing?.endDate) return existing.endDate;
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().split("T")[0];
  });
  const [status, setStatus] = useState<OfferStatus>(() => existing?.status ?? "draft");
  const [campaignId, setCampaignId] = useState(() => existing?.campaignId ?? "");

  const selectedSku = allSKUs.find((s) => s.id === skuId);

  if (!isNew && !existing) {
    return (
      <div className="flex flex-col h-full min-w-0">
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-6 py-8">
            <button
              onClick={() => router.push("/store/offers")}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6"
            >
              <ArrowLeft className="w-4 h-4" /> Back to Offers
            </button>
            <p className="text-sm text-muted-foreground">Offer not found.</p>
          </div>
        </main>
      </div>
    );
  }

  const handleSave = () => {
    if (!name.trim()) {
      toast.error("Offer name is required");
      return;
    }
    const numValue = parseFloat(value);
    if (isNaN(numValue) || numValue <= 0) {
      toast.error("Invalid offer value");
      return;
    }

    const offer: Offer = {
      id: isNew ? id : existing!.id,
      name: name.trim(),
      skuId,
      skuName: selectedSku?.name ?? "",
      type: offerType,
      value: numValue,
      audienceType,
      audienceValue: audienceType !== "all" ? audienceValue : undefined,
      startDate,
      endDate,
      status,
      campaignId: campaignId || undefined,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      createdBy: existing?.createdBy ?? "manual",
      performance: existing?.performance ?? { views: 0, conversions: 0, revenue: 0, dailyRevenue: Array(14).fill(0) },
    };

    const success = isNew ? createOffer(offer) : updateOffer(id, offer);
    if (success) {
      toast.success(isNew ? "Offer created" : "Offer updated");
      if (isNew) router.push("/store/offers");
    } else {
      toast.error("Failed to save offer");
    }
  };

  const handleDelete = () => {
    if (deleteOffer(id)) {
      toast.success("Offer deleted");
      router.push("/store/offers");
    } else {
      toast.error("Failed to delete offer");
    }
  };

  const handleTogglePause = () => {
    const newStatus = status === "paused" ? "active" : "paused";
    setStatus(newStatus);
    if (!isNew) {
      updateOffer(id, { status: newStatus });
      toast.success(newStatus === "paused" ? "Offer paused" : "Offer activated");
    }
  };

  const inputClass =
    "w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring/20";
  const labelClass = "block text-sm font-medium mb-1.5";

  return (
    <div className="flex flex-col h-full min-w-0">
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-8">
          {/* Back + actions */}
          <div className="flex items-center justify-between mb-6">
            <button
              onClick={() => router.push("/store/offers")}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-4 h-4" /> Back to Offers
            </button>
            <div className="flex items-center gap-2">
              {!isNew && (
                <>
                  <button
                    onClick={handleTogglePause}
                    className="px-3 py-2 text-sm font-medium border border-border rounded-lg hover:bg-muted transition-colors"
                  >
                    {status === "paused" ? "Activate" : "Pause"}
                  </button>
                  <button
                    onClick={() => setShowDelete(true)}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground border border-border rounded-lg hover:bg-muted transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </button>
                </>
              )}
              <button
                onClick={handleSave}
                className="px-4 py-2 text-sm font-medium bg-foreground text-background rounded-lg hover:bg-foreground/90 active:scale-[0.98] transition-[background-color,transform]"
              >
                {isNew ? "Create Offer" : "Save Changes"}
              </button>
            </div>
          </div>

          {/* Title */}
          <h1 className="text-xl font-semibold mb-1">
            {isNew ? "New Offer" : existing?.name}
          </h1>
          {!isNew && (
            <p className="text-sm text-muted-foreground mb-6">
              {existing?.id} · Created by {existing?.createdBy}
            </p>
          )}
          {isNew && <div className="mb-6" />}

          {/* Tabs */}
          <div className="flex items-center gap-0.5 border-b border-border mb-6">
            {(["details", "performance"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors capitalize ${
                  tab === t
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t === "details" ? "Details" : "Performance"}
              </button>
            ))}
          </div>

          {/* Details tab */}
          {tab === "details" && (
            <div className="space-y-5">
              <div>
                <label className={labelClass}>Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. JP Gem Boost"
                  className={inputClass}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>SKU</label>
                  <select
                    value={skuId}
                    onChange={(e) => setSkuId(e.target.value)}
                    className={inputClass}
                  >
                    {allSKUs.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} (${s.basePrice})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Offer Type</label>
                  <select
                    value={offerType}
                    onChange={(e) => setOfferType(e.target.value as OfferType)}
                    className={inputClass}
                  >
                    {OFFER_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {OFFER_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>
                    {offerType === "discount_percentage"
                      ? "Discount %"
                      : offerType === "discount_fixed"
                      ? "Discount Amount ($)"
                      : "Override Price ($)"}
                  </label>
                  <input
                    type="number"
                    step={offerType === "discount_percentage" ? "1" : "0.01"}
                    min="0"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    className={`${inputClass} max-w-[200px]`}
                  />
                </div>
                <div>
                  <label className={labelClass}>Status</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as OfferStatus)}
                    className={inputClass}
                  >
                    {OFFER_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {OFFER_STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="border-t border-border pt-5">
                <h3 className="text-sm font-medium mb-3">Audience</h3>
                <div className="flex items-center gap-4 mb-3">
                  {(["all", "segment", "player_list"] as OfferAudienceType[]).map((at) => (
                    <label key={at} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="audienceType"
                        checked={audienceType === at}
                        onChange={() => setAudienceType(at)}
                        className="rounded-full border-border"
                      />
                      <span className="text-sm capitalize">
                        {at === "all" ? "All Players" : at === "segment" ? "Segment" : "Player List"}
                      </span>
                    </label>
                  ))}
                </div>
                {audienceType !== "all" && (
                  <input
                    type="text"
                    value={audienceValue}
                    onChange={(e) => setAudienceValue(e.target.value)}
                    placeholder={
                      audienceType === "segment"
                        ? "e.g. JP Players, High LTV Players"
                        : "e.g. player-001, player-002"
                    }
                    className={`${inputClass} max-w-[400px]`}
                  />
                )}
              </div>

              <div className="border-t border-border pt-5">
                <h3 className="text-sm font-medium mb-3">Schedule</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass}>Start Date</label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>End Date</label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                </div>
              </div>

              <div className="border-t border-border pt-5">
                <h3 className="text-sm font-medium mb-3">Campaign</h3>
                <select
                  value={campaignId}
                  onChange={(e) => setCampaignId(e.target.value)}
                  className={`${inputClass} max-w-[300px]`}
                >
                  <option value="">No campaign</option>
                  {allCampaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Performance tab */}
          {tab === "performance" && (
            <div className="space-y-6">
              {isNew ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  Performance data will appear after the offer is created and active.
                </p>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="border border-border rounded-lg p-4">
                    <p className="text-xs text-muted-foreground mb-1">Views</p>
                    <p className="text-xl font-semibold">
                      {existing?.performance.views.toLocaleString()}
                    </p>
                  </div>
                  <div className="border border-border rounded-lg p-4">
                    <p className="text-xs text-muted-foreground mb-1">Conversions</p>
                    <p className="text-xl font-semibold">
                      {existing?.performance.conversions.toLocaleString()}
                    </p>
                  </div>
                  <div className="border border-border rounded-lg p-4">
                    <p className="text-xs text-muted-foreground mb-1">Conversion Rate</p>
                    <p className="text-xl font-semibold">
                      {existing?.performance.views
                        ? `${((existing.performance.conversions / existing.performance.views) * 100).toFixed(1)}%`
                        : "—"}
                    </p>
                  </div>
                  <div className="border border-border rounded-lg p-4">
                    <p className="text-xs text-muted-foreground mb-1">Revenue</p>
                    <p className="text-xl font-semibold">
                      ${existing?.performance.revenue.toFixed(2)}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this offer?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The offer will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
