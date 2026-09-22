"use client";

import { useState, useMemo, use } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { getPlayer, updatePlayer, getPlayerTransactions } from "@/lib/store-store";
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

type Tab = "purchases" | "top-items" | "activity";

function formatCurrency(value: number): string {
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border rounded-lg p-4">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-xl font-semibold">{value}</p>
    </div>
  );
}

export default function PlayerProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("purchases");
  const [refreshKey, setRefreshKey] = useState(0);
  const [showBanDialog, setShowBanDialog] = useState(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshKey is intentional to trigger re-fetch after mutations
  const player = useMemo(() => getPlayer(id), [id, refreshKey]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshKey is intentional to trigger re-fetch after mutations
  const transactions = useMemo(() => getPlayerTransactions(id), [id, refreshKey]);

  if (!player) {
    return (
      <div className="flex flex-col h-full min-w-0">
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto px-6 py-8">
            <button
              onClick={() => router.push("/store/players")}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6"
            >
              <ArrowLeft className="w-4 h-4" /> Back to Players
            </button>
            <p className="text-sm text-muted-foreground">Player not found.</p>
          </div>
        </main>
      </div>
    );
  }

  const isBanned = player.status === "banned";

  const handleToggleBan = () => {
    const newStatus = isBanned ? "active" : "banned";
    const success = updatePlayer(id, { status: newStatus });
    if (success) {
      toast.success(isBanned ? "Player unbanned" : "Player banned");
      setRefreshKey((k) => k + 1);
    } else {
      toast.error("Failed to update player status");
    }
    setShowBanDialog(false);
  };

  return (
    <div className="flex flex-col h-full min-w-0">
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 py-8">
          {/* Back + actions */}
          <div className="flex items-center justify-between mb-6">
            <button
              onClick={() => router.push("/store/players")}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-4 h-4" /> Back to Players
            </button>
            <button
              onClick={() => setShowBanDialog(true)}
              className="px-4 py-2 text-sm font-medium border border-border rounded-lg hover:bg-muted transition-colors"
            >
              {isBanned ? "Unban Player" : "Ban Player"}
            </button>
          </div>

          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold">{player.name}</h1>
              <span className="inline-flex items-center px-2 py-0.5 text-[9px] font-medium border border-border rounded-md capitalize">
                {player.status}
              </span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {player.email} · {player.country} · Joined{" "}
              {new Date(player.createdAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </p>
          </div>

          {/* Stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <StatCard label="Lifetime Value" value={formatCurrency(player.ltv)} />
            <StatCard label="AOV" value={formatCurrency(player.aov)} />
            <StatCard label="Purchases" value={String(player.purchaseCount)} />
            <StatCard
              label="Last Active"
              value={new Date(player.lastActiveAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            />
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-0.5 border-b border-border mb-6">
            {(
              [
                { key: "purchases", label: "Purchase History" },
                { key: "top-items", label: "Top Items" },
                { key: "activity", label: "Activity Log" },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  tab === t.key
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Purchase History */}
          {tab === "purchases" && (
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-muted/50 border-b border-border">
                    <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Date
                    </th>
                    <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Tx ID
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
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx, idx) => (
                    <tr
                      key={tx.id}
                      className={
                        idx < transactions.length - 1
                          ? "border-b border-border"
                          : ""
                      }
                    >
                      <td className="py-3 px-4 text-xs text-muted-foreground">
                        {new Date(tx.createdAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}
                      </td>
                      <td className="py-3 px-4 text-sm font-mono text-muted-foreground">
                        {tx.id}
                      </td>
                      <td className="py-3 px-4 text-sm">{tx.skuName}</td>
                      <td className="py-3 px-4 text-sm font-medium">
                        ${tx.amount.toFixed(2)}
                      </td>
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center px-2 py-0.5 text-[9px] font-medium border border-border rounded-md capitalize">
                          {tx.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {transactions.length === 0 && (
                    <tr>
                      <td
                        colSpan={5}
                        className="py-8 text-center text-sm text-muted-foreground"
                      >
                        No transactions yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Top Items */}
          {tab === "top-items" && (
            <div className="space-y-3">
              {player.topItems.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No purchase history
                </p>
              ) : (
                player.topItems.map((item) => (
                  <div
                    key={item.skuId}
                    className="flex items-center justify-between border border-border rounded-lg p-4"
                  >
                    <div>
                      <p className="text-sm font-medium">{item.skuName}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Purchased {item.count} time{item.count !== 1 ? "s" : ""}
                      </p>
                    </div>
                    <p className="text-sm font-medium">
                      {formatCurrency(item.totalSpent)}
                    </p>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Activity Log */}
          {tab === "activity" && (
            <div className="space-y-0">
              {player.activityLog.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No activity recorded
                </p>
              ) : (
                player.activityLog.map((entry, idx) => (
                  <div
                    key={idx}
                    className={`flex items-start gap-4 py-3 ${
                      idx < player.activityLog.length - 1
                        ? "border-b border-border"
                        : ""
                    }`}
                  >
                    <span className="text-xs text-muted-foreground w-[100px] shrink-0 pt-0.5">
                      {new Date(entry.date).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                    <div>
                      <p className="text-sm font-medium">{entry.action}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {entry.detail}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </main>

      <AlertDialog open={showBanDialog} onOpenChange={setShowBanDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isBanned ? "Unban" : "Ban"} {player.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isBanned
                ? "This player will be able to make purchases again."
                : "This player will be unable to make purchases."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleToggleBan}>
              {isBanned ? "Unban" : "Ban"} Player
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
