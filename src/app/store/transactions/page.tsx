"use client";

import { useState, useMemo } from "react";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { getAllTransactions, updateTransaction } from "@/lib/store-store";
import type { TransactionStatus } from "@/lib/store-types";
import { TransactionDetailSheet } from "@/components/store/transaction-detail-sheet";

const DATE_FILTERS = ["Today", "7D", "30D", "All"] as const;
type DateFilter = (typeof DATE_FILTERS)[number];

const STATUS_FILTERS: Array<TransactionStatus | "all"> = [
  "all",
  "completed",
  "pending",
  "refunded",
  "cancelled",
  "failed",
];

function truncateId(id: string): string {
  if (id.length <= 14) return id;
  return `${id.slice(0, 7)}...${id.slice(-4)}`;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

export default function TransactionsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFilter, setDateFilter] = useState<DateFilter>("All");
  const [statusFilter, setStatusFilter] = useState<TransactionStatus | "all">("all");
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshKey is intentional to trigger re-fetch after mutations
  const allTx = useMemo(() => getAllTransactions(), [refreshKey]);

  const filtered = useMemo(() => {
    let list = allTx;

    // Date filter
    if (dateFilter !== "All") {
      const cutoff =
        dateFilter === "Today"
          ? daysAgo(0)
          : dateFilter === "7D"
          ? daysAgo(7)
          : daysAgo(30);
      list = list.filter((t) => new Date(t.createdAt) >= cutoff);
    }

    // Status filter
    if (statusFilter !== "all") {
      list = list.filter((t) => t.status === statusFilter);
    }

    // Search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (t) =>
          t.id.toLowerCase().includes(q) ||
          t.playerName.toLowerCase().includes(q) ||
          t.skuName.toLowerCase().includes(q)
      );
    }

    return list;
  }, [allTx, dateFilter, statusFilter, searchQuery]);

  const selectedTx = selectedTxId
    ? allTx.find((t) => t.id === selectedTxId) ?? null
    : null;

  const handleRefund = (id: string) => {
    const success = updateTransaction(id, {
      status: "refunded",
      refundedAt: new Date().toISOString(),
    });
    if (success) {
      toast.success("Transaction refunded");
      setRefreshKey((k) => k + 1);
      setSelectedTxId(null);
    } else {
      toast.error("Failed to refund transaction");
    }
  };

  const handleCancel = (id: string) => {
    const success = updateTransaction(id, { status: "cancelled" });
    if (success) {
      toast.success("Transaction cancelled");
      setRefreshKey((k) => k + 1);
      setSelectedTxId(null);
    } else {
      toast.error("Failed to cancel transaction");
    }
  };

  return (
    <div className="flex flex-col h-full min-w-0">
      <main className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-8 pt-8 pb-6">
          <h1 className="text-xl font-semibold">Transactions</h1>
        </div>

        <div className="max-w-5xl mx-auto px-6 pb-8 w-full">
          {/* Search */}
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search Transactions"
              className="w-full max-w-sm pl-10 pr-4 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring/20"
            />
          </div>

          {/* Date filter pills */}
          <div className="flex items-center gap-1.5 mb-3">
            <span className="text-xs text-muted-foreground mr-1">Period</span>
            {DATE_FILTERS.map((d) => (
              <button
                key={d}
                onClick={() => setDateFilter(d)}
                className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                  dateFilter === d
                    ? "bg-foreground text-background border-foreground"
                    : "bg-background text-foreground border-border hover:bg-muted"
                }`}
              >
                {d}
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
                className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors capitalize ${
                  statusFilter === s
                    ? "bg-foreground text-background border-foreground"
                    : "bg-background text-foreground border-border hover:bg-muted"
                }`}
              >
                {s === "all" ? "All" : s}
              </button>
            ))}
          </div>

          {/* Table */}
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Tx ID
                  </th>
                  <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Player
                  </th>
                  <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    SKU
                  </th>
                  <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Amount
                  </th>
                  <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Status
                  </th>
                  <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Date
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((tx, idx) => (
                  <tr
                    key={tx.id}
                    onClick={() => setSelectedTxId(tx.id)}
                    className={`cursor-pointer hover:bg-muted/30 transition-colors ${
                      idx < filtered.length - 1
                        ? "border-b border-border"
                        : ""
                    }`}
                  >
                    <td className="py-3 px-4">
                      <span className="text-sm font-mono text-muted-foreground">
                        {truncateId(tx.id)}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-sm">{tx.playerName}</span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-sm truncate max-w-[160px] block">
                        {tx.skuName}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-sm font-medium">
                        ${tx.amount.toFixed(2)}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center px-2 py-0.5 text-[9px] font-medium border border-border rounded-md capitalize">
                        {tx.status}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-xs text-muted-foreground">
                        {new Date(tx.createdAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      No transactions found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      <TransactionDetailSheet
        transaction={selectedTx}
        open={selectedTxId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedTxId(null);
        }}
        onRefund={handleRefund}
        onCancel={handleCancel}
      />
    </div>
  );
}
