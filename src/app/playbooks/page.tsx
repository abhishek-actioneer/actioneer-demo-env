"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Search, Plus, ListChecks, Pencil, Trash2 } from "lucide-react";
import { useScrollRestore } from "@/lib/use-scroll-restore";
import { Badge } from "@/components/ui/badge";
import {
  getAllPlaybookSummariesMerged,
  updatePlaybook,
  deletePlaybook,
} from "@/lib/playbook-store";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { NewPlaybookModal } from "@/components/playbook/new-playbook-modal";
import { useChatPanel } from "@/components/chat/chat-panel-provider";
import { useDataset } from "@/lib/dataset-context";
import { apiFetch } from "@/lib/api-client";

import { FeatureGate } from "@/components/feature-gate";

const CATEGORY_COLORS: Record<string, string> = {
  UA: "bg-muted text-foreground",
  Retention: "bg-muted text-foreground",
  Revenue: "bg-muted text-foreground",
  Analytics: "bg-muted text-foreground",
};

export default function PlaybooksPage() {
  const router = useRouter();
  const { datasetId } = useDataset();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [showNewModal, setShowNewModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [revision, setRevision] = useState(0);
  const scrollRef = useScrollRestore<HTMLElement>();

  // ── Playbook list ──

  const savedSummaries = getAllPlaybookSummariesMerged(datasetId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const allPlaybooks = useMemo(() => savedSummaries, [savedSummaries.length, datasetId, revision]);

  // Push playbooks catalog context into chat
  const { setEntity } = useChatPanel();
  useEffect(() => {
    if (allPlaybooks.length > 0) {
      setEntity({
        id: "playbooks-list",
        name: "Playbooks",
        type: "playbooks-list",
        summary: `${allPlaybooks.length} playbooks`,
        contextPayload: {
          playbooks: allPlaybooks.map((pb) => ({
            name: pb.name,
            category: pb.category,
            description: pb.description,
            lastRunStatus: pb.lastRunStatus,
          })),
        },
      });
    }
  }, [allPlaybooks, setEntity]);

  const categories = ["All", ...Array.from(new Set(allPlaybooks.map((p) => p.category)))];

  const filtered = (() => {
    let list = allPlaybooks;
    if (activeCategory !== "All") {
      list = list.filter((p) => p.category === activeCategory);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q)
      );
    }
    return list;
  })();

  function saveRename(id: string) {
    const trimmed = editingName.trim();
    if (trimmed) {
      updatePlaybook(id, { name: trimmed });
      setRevision((r) => r + 1);
    }
    setEditingId(null);
  }

  function cancelRename() {
    setEditingId(null);
  }

  async function handleDelete(id: string) {
    deletePlaybook(id);
    setRevision((r) => r + 1);
    try {
      await apiFetch(`/api/playbooks/${id}`, { method: "DELETE", skipModel: true });
    } catch {
      // Client store already deleted
    }
  }

  return (
    <FeatureGate feature="playbooks">
    <div className="flex flex-col h-full min-w-0">
      <main ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="w-full min-h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-8 pt-8 pb-6">
              <h1 className="text-xl font-semibold text-foreground">Playbooks</h1>
              <button
                onClick={() => setShowNewModal(true)}
                className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium bg-foreground text-background rounded-lg hover:bg-foreground/90 active:scale-[0.98] transition-[background-color,transform]"
              >
                <Plus className="w-4 h-4" />
                New Playbook
              </button>
            </div>

            <div className="max-w-5xl mx-auto px-6 pb-8 w-full flex-1 flex flex-col">
            {allPlaybooks.length === 0 ? (
              <div className="min-h-[60vh] flex flex-col items-center justify-center text-center">
                <ListChecks className="size-10 text-muted-foreground/50 mb-4" />
                <h2 className="text-base font-medium text-foreground mb-1">No playbooks yet</h2>
                <p className="text-sm text-muted-foreground max-w-sm">
                  Create a playbook to automate your analytics workflows.
                </p>
              </div>
            ) : (
              <>
                {/* Search */}
                <div className="relative mb-4">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search Playbooks..."
                    className="w-full max-w-sm pl-10 pr-4 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring/20"
                  />
                </div>

                {/* Category tabs */}
                <div className="flex items-center gap-1.5 mb-6">
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setActiveCategory(cat)}
                      className={`px-3.5 py-1.5 text-[11.7px] font-medium rounded-full border transition-colors ${
                        activeCategory === cat
                          ? "bg-foreground text-background border-foreground"
                          : "bg-background text-foreground border-border hover:bg-muted"
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                {/* Table */}
                <div className="border border-border rounded-lg overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-muted/50 border-b border-border">
                        <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground tracking-wide w-[44%]">
                          Playbook Name
                        </th>
                        <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground tracking-wide whitespace-nowrap">
                          Category
                        </th>
                        <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground tracking-wide whitespace-nowrap">
                          Last Run
                        </th>
                        <th className="text-left py-2.5 px-4 text-xs font-medium text-muted-foreground tracking-wide whitespace-nowrap">
                          Used By
                        </th>
                        <th className="w-10" />
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((pb, idx) => (
                        <tr
                          key={pb.id}
                          onClick={() => {
                            if (editingId === pb.id) return;
                            router.push(`/playbooks/${pb.id}`);
                          }}
                          onMouseEnter={() => router.prefetch(`/playbooks/${pb.id}`)}
                          className={`group cursor-pointer hover:bg-muted/30 transition-colors ${
                            idx < filtered.length - 1 ? "border-b border-border" : ""
                          }`}
                        >
                          <td className="py-3 px-4">
                            <div className="min-w-0">
                              {editingId === pb.id ? (
                                <input
                                  type="text"
                                  autoFocus={typeof window === "undefined" || !("ontouchstart" in window)}
                                  value={editingName}
                                  onChange={(e) => setEditingName(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") { e.preventDefault(); saveRename(pb.id); }
                                    if (e.key === "Escape") cancelRename();
                                  }}
                                  onBlur={() => saveRename(pb.id)}
                                  onClick={(e) => e.stopPropagation()}
                                  spellCheck={false}
                                  autoComplete="off"
                                  className="text-sm font-medium bg-transparent border-b border-border outline-none w-full"
                                  style={{ fontSize: "14.4px" }}
                                />
                              ) : (
                                <p className="text-sm font-medium">{pb.name}</p>
                              )}
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {pb.description}
                              </p>
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <Badge
                              variant="secondary"
                              className={`text-[9px] px-2 py-0.5 font-medium border-0 ${
                                CATEGORY_COLORS[pb.category] || "bg-muted text-foreground"
                              }`}
                            >
                              {pb.category}
                            </Badge>
                          </td>
                          <td className="py-3 px-4">
                            {pb.lastRunStatus === "never" ? (
                              <span className="text-sm text-muted-foreground/50">No runs</span>
                            ) : (
                              <span
                                className={`inline-block w-2.5 h-2.5 rounded-full ${
                                  pb.lastRunStatus === "failed"
                                    ? "bg-muted-foreground/40"
                                    : "bg-foreground"
                                }`}
                              />
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <span className="text-sm text-muted-foreground whitespace-nowrap">
                              {pb.usedBy}
                            </span>
                          </td>
                          <td className="py-3 px-2">
                            <AlertDialog>
                              <div className="flex items-center gap-0.5">
                                <button
                                  type="button"
                                  aria-label="Rename playbook"
                                  title="Rename"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingId(pb.id);
                                    setEditingName(pb.name);
                                  }}
                                  className="p-1.5 rounded hover:bg-muted transition-colors active:scale-[0.97]"
                                >
                                  <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                                </button>
                                <AlertDialogTrigger asChild>
                                  <button
                                    type="button"
                                    aria-label="Delete playbook"
                                    title="Delete"
                                    onClick={(e) => e.stopPropagation()}
                                    className="p-1.5 rounded hover:bg-red-500/10 transition-colors active:scale-[0.97] group/del"
                                  >
                                    <Trash2 className="w-3.5 h-3.5 text-muted-foreground transition-colors group-hover/del:text-red-500" />
                                  </button>
                                </AlertDialogTrigger>
                              </div>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete Playbook?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This will permanently delete &ldquo;{pb.name}&rdquo; and all its run history. This action cannot be undone.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => handleDelete(pb.id)}>Delete</AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </td>
                        </tr>
                      ))}
                      {filtered.length === 0 && (
                        <tr>
                          <td colSpan={5}>
                            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                              <ListChecks className="size-10 text-muted-foreground" />
                              <div>
                                <p className="font-medium">No playbooks found</p>
                                <p className="text-sm text-muted-foreground mt-1">
                                  Try adjusting your search or category filter.
                                </p>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
          </div>
        </main>
      {showNewModal && (
        <NewPlaybookModal onClose={() => setShowNewModal(false)} />
      )}
    </div>
    </FeatureGate>
  );
}
