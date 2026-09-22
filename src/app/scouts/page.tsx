"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Search, Plus, Radar } from "lucide-react";
import { getScouts } from "@/lib/scout-data";
import { useScrollRestore } from "@/lib/use-scroll-restore";
import { useChatPanel } from "@/components/chat/chat-panel-provider";
import { FeatureGate } from "@/components/feature-gate";
import { useDataset } from "@/lib/dataset-context";

const STATUS_TABS = ["All", "Active", "Paused"] as const;

export default function ScoutsPage() {
  const { dataset } = useDataset();
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<string>("All");

  const scrollRef = useScrollRestore<HTMLElement>();
  const scouts = useMemo(() => getScouts(), []);

  // Push scouts context into chat
  const { setEntity } = useChatPanel();
  useEffect(() => {
    if (scouts.length > 0) {
      setEntity({
        id: "scouts-list",
        name: "Scouts",
        type: "scouts-list",
        summary: `${scouts.length} scouts`,
        contextPayload: {
          scouts: scouts.map((s) => ({
            name: s.name,
            playbook: s.playbook.name,
            schedule: s.schedule,
            status: s.status,
          })),
        },
      });
    }
  }, [scouts, setEntity]);

  const filtered = useMemo(() => {
    let list = scouts;
    if (activeTab !== "All") {
      list = list.filter((s) => s.status === activeTab);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.playbook.name.toLowerCase().includes(q)
      );
    }
    return list;
  }, [scouts, activeTab, searchQuery]);

  if (dataset?.isDynamic) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-6">
        <Radar className="h-10 w-10 text-muted-foreground/50 mb-3" />
        <h2 className="text-lg font-medium mb-1">Scouts not available</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          Scouts are currently available for sample datasets only. Switch to a sample dataset to explore this feature.
        </p>
      </div>
    );
  }

  return (
    <FeatureGate feature="scouts">
    <div className="flex flex-col h-full min-w-0">
        <main ref={scrollRef} className="flex-1 overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between px-8 pt-8 pb-6">
              <h1 className="text-xl font-semibold text-foreground">Scouts</h1>
              <button
                onClick={() => router.push("/")}
                className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium bg-foreground text-background rounded-lg hover:bg-foreground/90 active:scale-[0.98] transition-[background-color,transform]"
              >
                <Plus className="w-4 h-4" />
                New Scout
              </button>
            </div>

          <div className="max-w-5xl mx-auto px-6 pb-8 w-full">
            {/* Search */}
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search Scouts"
                className="w-full max-w-sm pl-10 pr-4 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
            </div>

            {/* Status tabs */}
            <div className="flex items-center gap-1.5 mb-6">
              {STATUS_TABS.map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                    activeTab === tab
                      ? "bg-foreground text-background border-foreground"
                      : "bg-background text-foreground border-border hover:bg-muted"
                  }`}
                >
                  {tab}
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
                      Playbook
                    </th>
                    <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Schedule
                    </th>
                    <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Last Run
                    </th>
                    <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((scout, idx) => (
                    <tr
                      key={scout.id}
                      onClick={() => router.push(`/scouts/${scout.id}`)}
                      onMouseEnter={() => router.prefetch(`/scouts/${scout.id}`)}
                      className={`cursor-pointer hover:bg-muted/30 transition-colors ${
                        idx < filtered.length - 1 ? "border-b border-border" : ""
                      }`}
                    >
                      <td className="py-3 px-4">
                        <p className="text-sm font-medium">{scout.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {scout.description}
                        </p>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-sm text-muted-foreground">
                          {scout.playbook.name}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-sm text-muted-foreground">
                          {scout.schedule}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-sm text-muted-foreground">
                          {scout.lastRun}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="inline-flex px-2 py-0.5 text-[9px] font-medium rounded-full border border-border text-foreground">
                          {scout.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={5}>
                        <div className="min-h-[40vh] flex flex-col items-center justify-center gap-3 text-center">
                          <Radar className="size-10 text-muted-foreground/50" />
                          <div>
                            <p className="font-medium">No scouts found</p>
                            <p className="text-sm text-muted-foreground mt-1">
                              {searchQuery || activeTab !== "All"
                                ? "Try adjusting your search or filter."
                                : "Create a scout to monitor your data automatically."}
                            </p>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </main>
    </div>
    </FeatureGate>
  );
}
