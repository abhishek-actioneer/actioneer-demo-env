"use client";

import { useState } from "react";
import { X, Copy, Check } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import type { Transaction } from "@/lib/store-types";
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

interface TransactionDetailSheetProps {
  transaction: Transaction | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRefund: (id: string) => void;
  onCancel: (id: string) => void;
}

type Tab = "overview" | "payment" | "settlement";

function truncateId(id: string): string {
  if (id.length <= 16) return id;
  return `${id.slice(0, 8)}...${id.slice(-8)}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Field({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <p className="text-sm">{value ?? "—"}</p>
    </div>
  );
}

export function TransactionDetailSheet({
  transaction,
  open,
  onOpenChange,
  onRefund,
  onCancel,
}: TransactionDetailSheetProps) {
  const [tab, setTab] = useState<Tab>("overview");
  const [copied, setCopied] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"refund" | "cancel" | null>(
    null
  );

  if (!transaction) return null;

  const tx = transaction;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(tx.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const canRefund = tx.status === "completed";
  const canCancel = tx.status === "pending";

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="w-[450px] max-w-full p-0 flex flex-col [&>button]:hidden"
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-border">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium font-mono">
                  {truncateId(tx.id)}
                </span>
                <button
                  onClick={handleCopy}
                  className="p-1 rounded-md hover:bg-muted transition-colors"
                >
                  {copied ? (
                    <Check className="w-3.5 h-3.5 text-foreground" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                  )}
                </button>
              </div>
              <button
                onClick={() => onOpenChange(false)}
                className="p-1 rounded-md hover:bg-muted transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium border border-border rounded-md">
              {tx.status}
            </span>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-0.5 px-6 pt-3 border-b border-border">
            {(["overview", "payment", "settlement"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors capitalize ${
                  tab === t
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {tab === "overview" && (
              <div className="space-y-4">
                <Field label="Transaction ID" value={tx.id} />
                <Field label="Player" value={`${tx.playerName} (${tx.playerId})`} />
                <Field label="SKU" value={`${tx.skuName} (${tx.skuId})`} />
                <Field
                  label="Amount"
                  value={`$${tx.amount.toFixed(2)} ${tx.currency}`}
                />
                <Field label="Status" value={tx.status} />
                <Field label="Date" value={formatDate(tx.createdAt)} />
                {tx.refundedAt && (
                  <Field label="Refunded At" value={formatDate(tx.refundedAt)} />
                )}
              </div>
            )}

            {tab === "payment" && (
              <div className="space-y-4">
                <Field label="Payment Method" value={tx.paymentMethod.replace("_", " ")} />
                <Field label="Gateway Reference" value={tx.gatewayRef} />
                <Field label="IP Address" value={tx.ipAddress} />
                <Field label="Device Type" value={tx.deviceType} />
              </div>
            )}

            {tab === "settlement" && (
              <div className="space-y-4">
                <Field
                  label="Gross Amount"
                  value={`$${tx.amount.toFixed(2)} ${tx.currency}`}
                />
                <Field
                  label="Fees"
                  value={tx.fees != null ? `$${tx.fees.toFixed(2)}` : "—"}
                />
                <Field
                  label="Net Settlement"
                  value={
                    tx.settlementAmount != null
                      ? `$${tx.settlementAmount.toFixed(2)}`
                      : "—"
                  }
                />
                <Field
                  label="Settled At"
                  value={tx.settledAt ? formatDate(tx.settledAt) : "Pending"}
                />
              </div>
            )}
          </div>

          {/* Footer actions */}
          {(canRefund || canCancel) && (
            <div className="px-6 py-4 border-t border-border flex items-center gap-3">
              {canRefund && (
                <button
                  onClick={() => setConfirmAction("refund")}
                  className="px-4 py-2 text-sm font-medium border border-border rounded-lg hover:bg-muted transition-colors"
                >
                  Refund
                </button>
              )}
              {canCancel && (
                <button
                  onClick={() => setConfirmAction("cancel")}
                  className="px-4 py-2 text-sm font-medium border border-border rounded-lg hover:bg-muted transition-colors"
                >
                  Cancel Transaction
                </button>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={confirmAction !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction === "refund"
                ? "Refund this transaction?"
                : "Cancel this transaction?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction === "refund"
                ? `This will refund $${tx.amount.toFixed(2)} to ${tx.playerName}. This action cannot be undone.`
                : `This will cancel the pending transaction for ${tx.playerName}.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go Back</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmAction === "refund") onRefund(tx.id);
                else if (confirmAction === "cancel") onCancel(tx.id);
                setConfirmAction(null);
              }}
            >
              {confirmAction === "refund" ? "Confirm Refund" : "Confirm Cancel"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
