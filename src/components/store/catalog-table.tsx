"use client";

import { useState, useRef, useCallback } from "react";
import { ChevronRight, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import type { SKU, SKUType, SKUStatus } from "@/lib/store-types";
import { updateSKU, createSKU, deleteSKU } from "@/lib/store-store";
import { EditableCell } from "./editable-cell";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const TYPE_OPTIONS = [
  { value: "consumable", label: "Consumable" },
  { value: "non_consumable", label: "Non-consumable" },
  { value: "subscription", label: "Subscription" },
];

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "draft", label: "Draft" },
  { value: "archived", label: "Archived" },
];

const BADGE_OPTIONS = [
  { value: "", label: "None" },
  { value: "Best Value", label: "Best Value" },
  { value: "Most Popular", label: "Most Popular" },
  { value: "Limited Time", label: "Limited Time" },
  { value: "New", label: "New" },
];

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

interface CatalogTableProps {
  skus: SKU[];
  onRefresh: () => void;
  onOpenDetail: (sku: SKU, tab?: string) => void;
}

export function CatalogTable({ skus, onRefresh, onOpenDetail }: CatalogTableProps) {
  const [editingCell, setEditingCell] = useState<{ rowId: string; column: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SKU | null>(null);
  const pendingFocusId = useRef<string | null>(null);

  const handleCellSave = useCallback(
    (skuId: string, field: string, newValue: string | number) => {
      const success = updateSKU(skuId, { [field]: newValue });
      if (success) {
        onRefresh();
        toast.success("Updated");
      } else {
        toast.error("Failed to update");
      }
    },
    [onRefresh]
  );

  const handleNewSKU = useCallback(() => {
    const id = `sku-${Date.now()}`;
    const now = new Date().toISOString().split("T")[0];
    const newSku: SKU = {
      id,
      name: "",
      description: "",
      type: "consumable",
      status: "draft",
      basePrice: 0,
      currency: "USD",
      territoryPricing: [],
      discounts: [],
      trackInventory: false,
      limitPerUser: false,
      tags: [],
      createdAt: now,
      lastModified: now,
    };
    createSKU(newSku);
    pendingFocusId.current = id;
    onRefresh();
    // Auto-focus the name cell after refresh
    requestAnimationFrame(() => {
      if (pendingFocusId.current === id) {
        setEditingCell({ rowId: id, column: "name" });
        pendingFocusId.current = null;
      }
    });
  }, [onRefresh]);

  const handleNameBlurForNew = useCallback(
    (sku: SKU, newValue: string | number) => {
      const name = String(newValue).trim();
      if (!name) {
        // Empty name on a new SKU — treat as cancelled creation
        deleteSKU(sku.id);
        onRefresh();
        return;
      }
      handleCellSave(sku.id, "name", name);
    },
    [handleCellSave, onRefresh]
  );

  const handleDelete = useCallback(() => {
    if (!deleteTarget) return;
    const success = deleteSKU(deleteTarget.id);
    if (success) {
      toast.success(`"${deleteTarget.name}" deleted`);
      onRefresh();
    } else {
      toast.error("Failed to delete");
    }
    setDeleteTarget(null);
  }, [deleteTarget, onRefresh]);

  const isEditing = (rowId: string, column: string) =>
    editingCell?.rowId === rowId && editingCell?.column === column;

  return (
    <>
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left text-[9.9px] font-medium text-muted-foreground uppercase tracking-wider px-3 py-2 min-w-[200px]">
                Name
              </th>
              <th className="text-left text-[9.9px] font-medium text-muted-foreground uppercase tracking-wider px-3 py-2 w-[140px]">
                Type
              </th>
              <th className="text-left text-[9.9px] font-medium text-muted-foreground uppercase tracking-wider px-3 py-2 w-[100px]">
                Price
              </th>
              <th className="text-left text-[9.9px] font-medium text-muted-foreground uppercase tracking-wider px-3 py-2 w-[100px]">
                Status
              </th>
              <th className="text-left text-[9.9px] font-medium text-muted-foreground uppercase tracking-wider px-3 py-2 w-[120px]">
                Badge
              </th>
              <th className="text-left text-[9.9px] font-medium text-muted-foreground uppercase tracking-wider px-3 py-2 w-[140px]">
                Tags
              </th>
              <th className="text-left text-[9.9px] font-medium text-muted-foreground uppercase tracking-wider px-3 py-2 w-[110px]">
                Modified
              </th>
              <th className="w-[70px] px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {skus.map((sku) => {
              const isNewEmpty = !sku.name && sku.basePrice === 0;
              return (
                <tr
                  key={sku.id}
                  className="group border-b border-border last:border-b-0 hover:bg-muted/20 transition-colors"
                >
                  {/* Name */}
                  <td className="px-2 py-1">
                    <EditableCell
                      value={sku.name}
                      type="text"
                      placeholder="Enter name..."
                      editing={isEditing(sku.id, "name")}
                      onEditStart={() => setEditingCell({ rowId: sku.id, column: "name" })}
                      onEditEnd={() => setEditingCell(null)}
                      onSave={(v) =>
                        isNewEmpty
                          ? handleNameBlurForNew(sku, v)
                          : handleCellSave(sku.id, "name", v)
                      }
                      validate={(v) => v.trim().length > 0}
                      className="font-medium"
                    />
                  </td>

                  {/* Type */}
                  <td className="px-2 py-1">
                    <EditableCell
                      value={sku.type}
                      type="select"
                      options={TYPE_OPTIONS}
                      onSave={(v) => handleCellSave(sku.id, "type", v as SKUType)}
                    />
                  </td>

                  {/* Price — click opens side panel at Pricing tab */}
                  <td className="px-2 py-1">
                    <div
                      onClick={() => onOpenDetail(sku, "pricing")}
                      className="px-1.5 py-0.5 rounded cursor-pointer text-[11.7px] hover:bg-muted/50 transition-colors min-h-[28px] flex items-center"
                    >
                      ${sku.basePrice.toFixed(2)}
                      {sku.territoryPricing.length > 0 && (
                        <span className="ml-1 text-[9px] text-muted-foreground">
                          +{sku.territoryPricing.length}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Status */}
                  <td className="px-2 py-1">
                    <EditableCell
                      value={sku.status}
                      type="select"
                      options={STATUS_OPTIONS}
                      onSave={(v) => handleCellSave(sku.id, "status", v as SKUStatus)}
                    />
                  </td>

                  {/* Badge */}
                  <td className="px-2 py-1">
                    <EditableCell
                      value={sku.badge || ""}
                      type="select"
                      options={BADGE_OPTIONS}
                      onSave={(v) => handleCellSave(sku.id, "badge", v)}
                    />
                  </td>

                  {/* Tags (read-only) */}
                  <td className="px-2 py-1">
                    <div className="flex gap-1 flex-wrap">
                      {sku.tags.length > 0 ? (
                        sku.tags.map((tag) => (
                          <span
                            key={tag}
                            className="px-1.5 py-0.5 text-[9px] border border-border rounded-md text-muted-foreground"
                          >
                            {tag}
                          </span>
                        ))
                      ) : (
                        <span className="text-[11.7px] text-muted-foreground/50">---</span>
                      )}
                    </div>
                  </td>

                  {/* Modified (read-only) */}
                  <td className="px-2 py-1">
                    <span className="text-[11.7px] text-muted-foreground">
                      {formatDate(sku.lastModified)}
                    </span>
                  </td>

                  {/* Actions */}
                  <td className="px-2 py-1">
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => onOpenDetail(sku)}
                        className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                        title="Open details"
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(sku)}
                        className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}

            {skus.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-[11.7px] text-muted-foreground">
                  No SKUs found
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Add row */}
        <button
          onClick={handleNewSKU}
          className="w-full flex items-center gap-2 px-3 py-2 text-[11.7px] text-muted-foreground hover:bg-muted/30 hover:text-foreground transition-colors border-t border-border"
        >
          <Plus className="w-3.5 h-3.5" />
          New SKU
        </button>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={`Delete "${deleteTarget?.name || "SKU"}"?`}
        description="This action cannot be undone."
        confirmLabel="Delete"
        onConfirm={handleDelete}
      />
    </>
  );
}
