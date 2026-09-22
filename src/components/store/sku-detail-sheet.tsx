"use client";

import { useState, useEffect } from "react";
import { X, Copy, Check, Plus, Trash2 } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import type { SKU, TerritoryPricing, SKUDiscount } from "@/lib/store-types";

interface SKUDetailSheetProps {
  sku: SKU | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (id: string, changes: Partial<SKU>) => void;
  initialTab?: string;
}

type Tab = "general" | "pricing" | "restrictions";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
      {children}
    </h3>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-sm text-foreground font-medium mb-1.5 block">{label}</label>
      {hint && <p className="text-xs text-muted-foreground mb-1.5">{hint}</p>}
      {children}
    </div>
  );
}

const INPUT =
  "w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring/20";
const SELECT =
  "w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring/20 appearance-none cursor-pointer";
const BADGE_PRESETS = ["Best Value", "Most Popular", "Limited Time", "New"];

export function SKUDetailSheet({ sku, open, onOpenChange, onSave, initialTab }: SKUDetailSheetProps) {
  const [tab, setTab] = useState<Tab>("general");
  const [copied, setCopied] = useState(false);

  // ── Local form state ──
  const [description, setDescription] = useState("");
  const [badge, setBadge] = useState("");
  const [territoryPricing, setTerritoryPricing] = useState<TerritoryPricing[]>([]);
  const [discounts, setDiscounts] = useState<SKUDiscount[]>([]);
  const [trackInventory, setTrackInventory] = useState(false);
  const [inventoryCount, setInventoryCount] = useState(0);
  const [limitPerUser, setLimitPerUser] = useState(false);
  const [purchaseLimit, setPurchaseLimit] = useState(1);
  const [effectiveDate, setEffectiveDate] = useState("");
  const [expirationDate, setExpirationDate] = useState("");
  const [renewalPeriodDays, setRenewalPeriodDays] = useState<number | undefined>();

  // Initialize form when SKU changes
  useEffect(() => {
    if (sku) {
      setDescription(sku.description);
      setBadge(sku.badge ?? "");
      setTerritoryPricing(sku.territoryPricing.map((tp) => ({ ...tp })));
      setDiscounts(sku.discounts.map((d) => ({ ...d })));
      setTrackInventory(sku.trackInventory);
      setInventoryCount(sku.inventoryCount ?? 0);
      setLimitPerUser(sku.limitPerUser);
      setPurchaseLimit(sku.purchaseLimit ?? 1);
      setEffectiveDate(sku.effectiveDate ?? "");
      setExpirationDate(sku.expirationDate ?? "");
      setRenewalPeriodDays(sku.renewalPeriodDays);
      const validTabs: Tab[] = ["general", "pricing", "restrictions"];
      setTab(validTabs.includes(initialTab as Tab) ? (initialTab as Tab) : "general");
    }
  }, [sku, initialTab]);

  if (!sku) return null;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(sku.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleSave = () => {
    onSave(sku.id, {
      description,
      badge: badge || undefined,
      territoryPricing,
      discounts,
      trackInventory,
      inventoryCount: trackInventory ? inventoryCount : undefined,
      limitPerUser,
      purchaseLimit: limitPerUser ? purchaseLimit : undefined,
      effectiveDate: effectiveDate || undefined,
      expirationDate: expirationDate || undefined,
      renewalPeriodDays,
    });
    onOpenChange(false);
  };

  // ── Territory pricing helpers ──
  const addTerritory = () => {
    setTerritoryPricing((prev) => [...prev, { territory: "", price: 0, currency: "USD" }]);
  };
  const updateTerritory = (i: number, field: keyof TerritoryPricing, val: string | number) => {
    setTerritoryPricing((prev) => prev.map((tp, idx) => (idx === i ? { ...tp, [field]: val } : tp)));
  };
  const removeTerritory = (i: number) => {
    setTerritoryPricing((prev) => prev.filter((_, idx) => idx !== i));
  };

  // ── Discount helpers ──
  const addDiscount = () => {
    setDiscounts((prev) => [
      ...prev,
      {
        id: `disc-${Date.now()}`,
        type: "percentage",
        value: 10,
        startDate: new Date().toISOString().split("T")[0],
        endDate: new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0],
      },
    ]);
  };
  const updateDiscount = (i: number, field: string, val: string | number) => {
    setDiscounts((prev) => prev.map((d, idx) => (idx === i ? { ...d, [field]: val } : d)));
  };
  const removeDiscount = (i: number) => {
    setDiscounts((prev) => prev.filter((_, idx) => idx !== i));
  };

  const TABS: { key: Tab; label: string }[] = [
    { key: "general", label: "General" },
    { key: "pricing", label: "Pricing" },
    { key: "restrictions", label: "Restrictions" },
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[560px] max-w-full p-0 flex flex-col [&>button]:hidden"
      >
        {/* ── Header ── */}
        <div className="px-6 py-4 border-b border-border">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-base font-semibold truncate">{sku.name || "Untitled SKU"}</span>
              <span className="inline-flex items-center px-2 py-0.5 text-[9.9px] font-medium border border-border rounded-md shrink-0 capitalize">
                {sku.status}
              </span>
            </div>
            <button
              onClick={() => onOpenChange(false)}
              className="p-1.5 rounded-md hover:bg-muted transition-colors shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-mono">{sku.id}</span>
            <button onClick={handleCopy} className="p-0.5 rounded hover:bg-muted transition-colors">
              {copied ? (
                <Check className="w-3 h-3 text-foreground" />
              ) : (
                <Copy className="w-3 h-3 text-muted-foreground" />
              )}
            </button>
          </div>
          <div className="flex items-center gap-1 mt-2">
            <span className="text-xs text-muted-foreground">{sku.type.replace("_", "-")}</span>
            <span className="text-xs text-muted-foreground">·</span>
            <span className="text-xs text-muted-foreground">${sku.basePrice.toFixed(2)} USD</span>
            {sku.territoryPricing.length > 0 && (
              <>
                <span className="text-xs text-muted-foreground">·</span>
                <span className="text-xs text-muted-foreground">
                  {sku.territoryPricing.length} territories
                </span>
              </>
            )}
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="flex items-center gap-0.5 px-6 pt-3 border-b border-border">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                tab === t.key
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Content ── */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* ── General Tab ── */}
          {tab === "general" && (
            <div className="space-y-5">
              <Field label="Description">
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className={INPUT}
                  placeholder="Product description..."
                />
              </Field>

              <Field label="Badge" hint="Displayed on the storefront card. Pick a preset or type custom text.">
                <div className="flex gap-1.5 flex-wrap mb-2">
                  {BADGE_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      onClick={() => setBadge(badge === preset ? "" : preset)}
                      className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                        badge === preset
                          ? "bg-foreground text-background border-foreground"
                          : "bg-background text-foreground border-border hover:bg-muted"
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                <input
                  value={badge}
                  onChange={(e) => setBadge(e.target.value)}
                  placeholder="Custom badge text..."
                  maxLength={20}
                  className={INPUT}
                />
              </Field>

              {sku.contents && sku.contents.length > 0 && (
                <Field label="Bundle Contents">
                  <div className="space-y-1.5">
                    {sku.contents.map((item) => (
                      <div
                        key={item.skuId}
                        className="flex items-center justify-between px-3 py-2 border border-border rounded-lg text-sm"
                      >
                        <span>{item.skuName}</span>
                        <span className="text-muted-foreground">×{item.quantity}</span>
                      </div>
                    ))}
                  </div>
                </Field>
              )}

              {sku.tags.length > 0 && (
                <Field label="Tags">
                  <div className="flex gap-1.5 flex-wrap">
                    {sku.tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-2 py-0.5 text-xs border border-border rounded-md text-muted-foreground"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </Field>
              )}
            </div>
          )}

          {/* ── Pricing Tab ── */}
          {tab === "pricing" && (
            <div className="space-y-6">
              {/* Territory Pricing Overrides */}
              <div>
                <SectionLabel>Territory Pricing Overrides</SectionLabel>
                <p className="text-xs text-muted-foreground mb-3">
                  Override the base price for specific territories. If no override exists, the base USD price is used.
                </p>

                {territoryPricing.length > 0 && (
                  <div className="space-y-2 mb-3">
                    {/* Header row */}
                    <div className="grid grid-cols-[80px_1fr_80px_32px] gap-2 px-1">
                      <span className="text-[9px] text-muted-foreground uppercase tracking-wider">Region</span>
                      <span className="text-[9px] text-muted-foreground uppercase tracking-wider">Price</span>
                      <span className="text-[9px] text-muted-foreground uppercase tracking-wider">Currency</span>
                      <span />
                    </div>
                    {territoryPricing.map((tp, i) => (
                      <div key={i} className="grid grid-cols-[80px_1fr_80px_32px] gap-2 items-center">
                        <input
                          value={tp.territory}
                          onChange={(e) => updateTerritory(i, "territory", e.target.value.toUpperCase())}
                          placeholder="US"
                          className={`${INPUT} text-center uppercase`}
                          maxLength={5}
                        />
                        <input
                          type="number"
                          value={tp.price}
                          onChange={(e) => updateTerritory(i, "price", parseFloat(e.target.value) || 0)}
                          placeholder="9.99"
                          className={INPUT}
                          step="0.01"
                          min="0"
                        />
                        <input
                          value={tp.currency}
                          onChange={(e) => updateTerritory(i, "currency", e.target.value.toUpperCase())}
                          placeholder="USD"
                          className={`${INPUT} text-center uppercase`}
                          maxLength={3}
                        />
                        <button
                          onClick={() => removeTerritory(i)}
                          className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <button
                  onClick={addTerritory}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Territory Override
                </button>
              </div>

              {/* Discounts */}
              <div>
                <SectionLabel>Discounts</SectionLabel>
                <p className="text-xs text-muted-foreground mb-3">
                  Add strike-through pricing. The original price shows crossed out with the discounted price below.
                </p>

                {discounts.map((disc, i) => (
                  <div key={disc.id} className="border border-border rounded-lg p-3 mb-2 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">
                        Discount {i + 1}
                      </span>
                      <button
                        onClick={() => removeDiscount(i)}
                        className="p-1 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Type</label>
                        <select
                          value={disc.type}
                          onChange={(e) => updateDiscount(i, "type", e.target.value)}
                          className={SELECT}
                        >
                          <option value="percentage">Percentage (%)</option>
                          <option value="fixed">Fixed amount ($)</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">
                          Value {disc.type === "percentage" ? "(%)" : "($)"}
                        </label>
                        <input
                          type="number"
                          value={disc.value}
                          onChange={(e) => updateDiscount(i, "value", parseFloat(e.target.value) || 0)}
                          className={INPUT}
                          step={disc.type === "percentage" ? "1" : "0.01"}
                          min="0"
                          max={disc.type === "percentage" ? "100" : undefined}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Start date</label>
                        <input
                          type="date"
                          value={disc.startDate}
                          onChange={(e) => updateDiscount(i, "startDate", e.target.value)}
                          className={INPUT}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">End date</label>
                        <input
                          type="date"
                          value={disc.endDate}
                          onChange={(e) => updateDiscount(i, "endDate", e.target.value)}
                          className={INPUT}
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Discount badge</label>
                      <input
                        value={disc.badge ?? ""}
                        onChange={(e) => updateDiscount(i, "badge", e.target.value)}
                        placeholder="e.g. 20% OFF"
                        className={INPUT}
                        maxLength={20}
                      />
                    </div>

                    {/* Preview */}
                    <div className="bg-muted/30 rounded-md px-3 py-2">
                      <p className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1">Preview</p>
                      <div className="flex items-center gap-2">
                        <span className="text-sm line-through text-muted-foreground">
                          ${sku.basePrice.toFixed(2)}
                        </span>
                        <span className="text-sm font-semibold">
                          $
                          {disc.type === "percentage"
                            ? (sku.basePrice * (1 - disc.value / 100)).toFixed(2)
                            : Math.max(0, sku.basePrice - disc.value).toFixed(2)}
                        </span>
                        {disc.badge && (
                          <span className="px-1.5 py-0.5 text-[9px] font-medium border border-border rounded">
                            {disc.badge}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}

                <button
                  onClick={addDiscount}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Discount
                </button>
              </div>
            </div>
          )}

          {/* ── Restrictions Tab ── */}
          {tab === "restrictions" && (
            <div className="space-y-6">
              {/* Availability Schedule */}
              <div>
                <SectionLabel>Availability Schedule</SectionLabel>
                <p className="text-xs text-muted-foreground mb-3">
                  Define when this SKU is visible and purchasable. All times are UTC.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Effective date" hint="SKU is hidden before this date">
                    <input
                      type="date"
                      value={effectiveDate}
                      onChange={(e) => setEffectiveDate(e.target.value)}
                      className={INPUT}
                    />
                  </Field>
                  <Field label="Expiration date" hint="SKU is hidden after this date">
                    <input
                      type="date"
                      value={expirationDate}
                      onChange={(e) => setExpirationDate(e.target.value)}
                      className={INPUT}
                    />
                  </Field>
                </div>
              </div>

              {/* Inventory Control */}
              <div>
                <SectionLabel>Inventory Control</SectionLabel>
                <label className="flex items-center gap-2.5 text-sm cursor-pointer mb-2">
                  <input
                    type="checkbox"
                    checked={trackInventory}
                    onChange={(e) => setTrackInventory(e.target.checked)}
                    className="rounded border-border"
                  />
                  Track inventory
                </label>
                <p className="text-xs text-muted-foreground mb-3">
                  When enabled, the SKU shows &quot;Sold Out&quot; when stock reaches 0. The buy button is disabled but the SKU remains visible.
                </p>
                {trackInventory && (
                  <Field label="Stock level">
                    <input
                      type="number"
                      value={inventoryCount}
                      onChange={(e) => setInventoryCount(parseInt(e.target.value) || 0)}
                      className={`${INPUT} w-[140px]`}
                      placeholder="0"
                      min="0"
                    />
                  </Field>
                )}
              </div>

              {/* Purchase Restrictions */}
              <div>
                <SectionLabel>Purchase Restrictions</SectionLabel>
                <label className="flex items-center gap-2.5 text-sm cursor-pointer mb-2">
                  <input
                    type="checkbox"
                    checked={limitPerUser}
                    onChange={(e) => setLimitPerUser(e.target.checked)}
                    className="rounded border-border"
                  />
                  Limit per user
                </label>
                <p className="text-xs text-muted-foreground mb-3">
                  Restrict how many times each user can purchase this SKU. Set to 1 for one-time offers like starter packs.
                </p>
                {limitPerUser && (
                  <Field label="Maximum per user">
                    <input
                      type="number"
                      value={purchaseLimit}
                      onChange={(e) => setPurchaseLimit(parseInt(e.target.value) || 1)}
                      className={`${INPUT} w-[140px]`}
                      placeholder="1"
                      min="1"
                    />
                  </Field>
                )}
              </div>

              {/* Renewal (subscriptions only) */}
              {sku.type === "subscription" && (
                <div>
                  <SectionLabel>Subscription</SectionLabel>
                  <Field label="Renewal period (days)" hint="How often this subscription auto-renews.">
                    <input
                      type="number"
                      value={renewalPeriodDays ?? ""}
                      onChange={(e) =>
                        setRenewalPeriodDays(e.target.value ? parseInt(e.target.value) : undefined)
                      }
                      className={`${INPUT} w-[140px]`}
                      placeholder="e.g. 30"
                      min="1"
                    />
                  </Field>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="px-6 py-4 border-t border-border flex items-center justify-between">
          <button
            onClick={() => onOpenChange(false)}
            className="px-4 py-2 text-sm font-medium border border-border rounded-lg hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 text-sm font-medium bg-foreground text-background rounded-lg hover:bg-foreground/90 transition-colors"
          >
            Save Changes
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
