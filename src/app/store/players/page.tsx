"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { getAllPlayers } from "@/lib/store-store";
import type { PlayerStatus } from "@/lib/store-types";

const STATUS_FILTERS: Array<PlayerStatus | "all"> = ["all", "active", "banned"];

function formatCurrency(value: number): string {
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

export default function PlayersPage() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<PlayerStatus | "all">("all");

  const allPlayers = useMemo(() => getAllPlayers(), []);

  const filtered = useMemo(() => {
    let list = allPlayers;
    if (statusFilter !== "all") {
      list = list.filter((p) => p.status === statusFilter);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.email.toLowerCase().includes(q) ||
          p.id.toLowerCase().includes(q)
      );
    }
    return list;
  }, [allPlayers, statusFilter, searchQuery]);

  return (
    <div className="flex flex-col h-full min-w-0">
      <main className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-8 pt-8 pb-6">
          <h1 className="text-xl font-semibold">Players</h1>
        </div>

        <div className="max-w-5xl mx-auto px-6 pb-8 w-full">
          {/* Search */}
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search Players"
              className="w-full max-w-sm pl-10 pr-4 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring/20"
            />
          </div>

          {/* Status filter */}
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
                    Name
                  </th>
                  <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Email
                  </th>
                  <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    LTV
                  </th>
                  <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Purchases
                  </th>
                  <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Last Active
                  </th>
                  <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((player, idx) => (
                  <tr
                    key={player.id}
                    onClick={() => router.push(`/store/players/${player.id}`)}
                    onMouseEnter={() =>
                      router.prefetch(`/store/players/${player.id}`)
                    }
                    className={`cursor-pointer hover:bg-muted/30 transition-colors ${
                      idx < filtered.length - 1
                        ? "border-b border-border"
                        : ""
                    }`}
                  >
                    <td className="py-3 px-4">
                      <span className="text-sm font-medium">{player.name}</span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-sm text-muted-foreground">
                        {player.email}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-sm font-medium">
                        {formatCurrency(player.ltv)}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-sm">{player.purchaseCount}</span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-xs text-muted-foreground">
                        {new Date(player.lastActiveAt).toLocaleDateString(
                          "en-US",
                          { month: "short", day: "numeric" }
                        )}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center px-2 py-0.5 text-[9px] font-medium border border-border rounded-md capitalize">
                        {player.status}
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
                      No players found
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
