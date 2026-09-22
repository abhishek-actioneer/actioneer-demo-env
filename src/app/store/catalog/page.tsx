"use client";

import { useState, useMemo, useCallback } from "react";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { getAllSKUs, updateSKU } from "@/lib/store-store";
import { SKU_TYPE_LABELS, SKU_STATUS_LABELS } from "@/lib/store-types";
import type { SKU, SKUType, SKUStatus } from "@/lib/store-types";
import { CatalogTable } from "@/components/store/catalog-table";
import { SKUDetailSheet } from "@/components/store/sku-detail-sheet";

const TYPE_FILTERS: Array<SKUType | "all"> = ["all", "consumable", "non_consumable", "subscription"];
const STATUS_FILTERS: Array<SKUStatus | "all"> = ["all", "active", "draft", "archived"];

export default function SKUCatalogPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<SKUType | "all">("all");
  const [statusFilter, setStatusFilter] = useState<SKUStatus | "all">("all");
  const [refreshKey, setRefreshKey] = useState(0);
  const [sheetSKU, setSheetSKU] = useState<SKU | null>(null);
  const [sheetTab, setSheetTab] = useState<string | undefined>();

  // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshKey is an intentional manual invalidation counter
  const allSKUs = useMemo(() => getAllSKUs(), [refreshKey]);

  const filtered = useMemo(() => {
    let list = allSKUs;
    if (typeFilter !== "all") {
      list = list.filter((s) => s.type === typeFilter);
    }
    if (statusFilter !== "all") {
      list = list.filter((s) => s.status === statusFilter);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.id.toLowerCase().includes(q)
      );
    }
    return list;
  }, [allSKUs, typeFilter, statusFilter, searchQuery]);

  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const handleOpenDetail = useCallback((sku: SKU, tab?: string) => {
    setSheetSKU(sku);
    setSheetTab(tab);
  }, []);

  const handleSheetSave = useCallback(
    (id: string, changes: Partial<SKU>) => {
      const success = updateSKU(id, changes);
      if (success) {
        toast.success("Updated");
        handleRefresh();
      } else {
        toast.error("Failed to update");
      }
    },
    [handleRefresh]
  );

  return (
    <div className="flex flex-col h-full min-w-0">
      <main className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-8 pt-8 pb-6">
          <h1 className="text-xl font-semibold">Catalog</h1>
        </div>

        <div className="max-w-5xl mx-auto px-6 pb-8 w-full">
          {/* Search */}
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search SKUs"
              className="w-full max-w-sm pl-10 pr-4 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring/20"
            />
          </div>

          {/* Type filter pills */}
          <div className="flex items-center gap-1.5 mb-3">
            <span className="text-xs text-muted-foreground mr-1">Type</span>
            {TYPE_FILTERS.map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                  typeFilter === t
                    ? "bg-foreground text-background border-foreground"
                    : "bg-background text-foreground border-border hover:bg-muted"
                }`}
              >
                {t === "all" ? "All" : SKU_TYPE_LABELS[t]}
              </button>
            ))}
          </div>

          {/* Status filter pills */}
          <div className="flex items-center gap-1.5 mb-6">
            <span className="text-xs text-muted-foreground mr-1">Status</span>
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                  statusFilter === s
                    ? "bg-foreground text-background border-foreground"
                    : "bg-background text-foreground border-border hover:bg-muted"
                }`}
              >
                {s === "all" ? "All" : SKU_STATUS_LABELS[s]}
              </button>
            ))}
          </div>

          {/* Inline-editable table */}
          <CatalogTable
            skus={filtered}
            onRefresh={handleRefresh}
            onOpenDetail={handleOpenDetail}
          />
        </div>
      </main>

      {/* SKU Detail Sheet */}
      <SKUDetailSheet
        sku={sheetSKU}
        open={sheetSKU !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSheetSKU(null);
            setSheetTab(undefined);
          }
        }}
        onSave={handleSheetSave}
        initialTab={sheetTab}
      />
    </div>
  );
}
