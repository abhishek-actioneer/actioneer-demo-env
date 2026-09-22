"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import {
  Search,
  Plus,
  PenLine,
  ClipboardPaste,
  MessageSquare,
  Bot,
  Calendar,
  User,
  Trash2,
  AlertTriangle,
  Loader2,
  MoreHorizontal,
  X,
  Globe,
} from "lucide-react";
import { KnowledgeIcon } from "@/components/nav-icons";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { KnowledgeSelect } from "@/components/knowledge/knowledge-select";
import { KnowledgeAddForm } from "@/components/knowledge/knowledge-add-form";
import { KnowledgeImport } from "@/components/knowledge/knowledge-import";
import { KnowledgeAddModal } from "@/components/knowledge/knowledge-add-modal";
import { KnowledgeWebsiteSourceFlow } from "@/components/knowledge/knowledge-website-source-flow";
import {
  getAllEntries,
  getKnowledgeEntry,
  deleteKnowledgeEntry,
  updateKnowledgeEntry,
  saveKnowledgeEntry,
  bulkLoadEntries,
} from "@/lib/knowledge-store";
import type {
  KnowledgeEntry,
  KnowledgeCategory,
  KnowledgePriority,
  KnowledgeSource,
  KnowledgeLevel,
} from "@/lib/knowledge-types";
import {
  KNOWLEDGE_CATEGORIES,
  KNOWLEDGE_PRIORITIES,
} from "@/lib/knowledge-types";
import { useChatPanel } from "@/components/chat/chat-panel-provider";
import { useDataset } from "@/lib/dataset-context";
import { apiFetch } from "@/lib/api-client";
import { FeatureGate } from "@/components/feature-gate";

type SortOrder = "newest" | "oldest" | "priority";

const PRIORITY_ORDER: Record<KnowledgePriority, number> = {
  Critical: 0,
  High: 1,
  "Good to have": 2,
};

export default function KnowledgePage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<KnowledgeCategory | "All">("All");
  const [sourceFilter, setSourceFilter] = useState<KnowledgeSource | "All">("All");
  const [scopeFilter, setScopeFilter] = useState<KnowledgeLevel | "All">("All");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [showAddModal, setShowAddModal] = useState(false);
  const [showWebsiteFlow, setShowWebsiteFlow] = useState(false);
  const [addMode, setAddMode] = useState<"none" | "write" | "paste" | "upload" | "url" | "notion">("none");
  const [droppedFile, setDroppedFile] = useState<File | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const { datasetId } = useDataset();

  useEffect(() => {
    let cancelled = false;
    setInitialLoading(true);
    apiFetch<{ entries: KnowledgeEntry[] }>("/api/knowledge", { datasetId })
      .then((res) => {
        if (!cancelled && res.entries.length > 0) {
          bulkLoadEntries(datasetId, res.entries);
          setRefreshKey((key) => key + 1);
        }
      })
      .catch((error) => console.warn("[knowledge] Failed to load from API:", error))
      .finally(() => {
        if (!cancelled) setInitialLoading(false);
      });
    return () => { cancelled = true; };
  }, [datasetId]);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshKey intentionally invalidates the in-memory store snapshot
  const allEntries = useMemo(() => getAllEntries(datasetId), [datasetId, refreshKey]);

  const { setEntity } = useChatPanel();
  useEffect(() => {
    if (allEntries.length === 0) return;
    setEntity({
      id: "knowledge-list",
      name: "Knowledge",
      type: "knowledge-list",
      summary: `${allEntries.length} entries`,
      contextPayload: {
        entries: allEntries.map((entry) => ({
          title: entry.title ?? entry.content.slice(0, 80),
          category: entry.category,
          priority: entry.priority,
          scope: entry.level,
        })),
      },
    });
  }, [allEntries, setEntity]);

  const filtered = useMemo(() => {
    let entries = [...allEntries];
    if (categoryFilter !== "All") entries = entries.filter((entry) => entry.category === categoryFilter);
    if (sourceFilter !== "All") entries = entries.filter((entry) => entry.source === sourceFilter);
    if (scopeFilter !== "All") entries = entries.filter((entry) => entry.level === scopeFilter);
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      entries = entries.filter((entry) =>
        entry.content.toLowerCase().includes(query) ||
        entry.title?.toLowerCase().includes(query) ||
        entry.category.toLowerCase().includes(query) ||
        entry.addedBy.toLowerCase().includes(query)
      );
    }
    return entries.sort((a, b) => {
      if (sortOrder === "priority") return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      const delta = new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime();
      return sortOrder === "newest" ? delta : -delta;
    });
  }, [allEntries, categoryFilter, scopeFilter, searchQuery, sortOrder, sourceFilter]);

  const previewEntry = selectedId ? allEntries.find((entry) => entry.id === selectedId) ?? null : null;
  const defaultAddLevel: KnowledgeLevel = scopeFilter === "user" ? "user" : "global";

  const persistEntries = useCallback(async (entries: KnowledgeEntry[]) => {
    const response = await apiFetch<{ entries: KnowledgeEntry[] }>("/api/knowledge/entries", {
      method: "POST",
      body: { entries },
      datasetId,
      skipModel: true,
    });
    response.entries.forEach((entry) => saveKnowledgeEntry(datasetId, entry));
    return response.entries;
  }, [datasetId]);

  const handleEdit = useCallback(async (id: string, updates: Partial<KnowledgeEntry>) => {
    updateKnowledgeEntry(datasetId, id, updates);
    const updated = getKnowledgeEntry(datasetId, id);
    if (updated) await persistEntries([updated]);
    setRefreshKey((key) => key + 1);
  }, [datasetId, persistEntries]);

  const confirmDeleteEntry = useCallback(async () => {
    if (!deleteTarget) return;
    await apiFetch("/api/knowledge/entries", {
      method: "DELETE",
      body: { id: deleteTarget },
      datasetId,
      skipModel: true,
    });
    deleteKnowledgeEntry(datasetId, deleteTarget);
    setSelectedId(null);
    setRefreshKey((key) => key + 1);
    setDeleteTarget(null);
  }, [datasetId, deleteTarget]);

  const handleAddEntry = useCallback(async (entry: KnowledgeEntry) => {
    await persistEntries([entry]);
    setAddMode("none");
    setRefreshKey((key) => key + 1);
  }, [persistEntries]);

  const handleBulkAdd = useCallback(async (entries: KnowledgeEntry[]) => {
    await persistEntries(entries);
    setAddMode("none");
    setRefreshKey((key) => key + 1);
  }, [persistEntries]);

  const handleWebsiteAdd = useCallback(async (entries: KnowledgeEntry[]) => {
    const saved = await persistEntries(entries);
    setRefreshKey((key) => key + 1);
    return saved;
  }, [persistEntries]);

  return (
    <FeatureGate feature="knowledge">
      <div className="flex h-full min-w-0 flex-col bg-white [color-scheme:light] [--background:#fff] [--border:#deded8] [--foreground:#171714] [--muted:#f1f1ed] [--muted-foreground:#707069]">
        <header className="shrink-0">
          <div className="flex h-14 items-center gap-3 border-b border-border bg-white px-5">
            <span className="shrink-0 text-[13.5px] font-semibold text-muted-foreground">Knowledge</span>
            <span className="shrink-0 text-muted-foreground/50">/</span>
            <h1 className="min-w-0 flex-1 truncate text-[13.5px] font-semibold tracking-[-0.015em] text-foreground">Knowledge base</h1>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-auto p-6">
          <section className="min-h-full border border-border bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-white p-4">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <label className="relative min-w-[220px] flex-1 sm:max-w-[320px]">
                  <span className="sr-only">Search sources</span>
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search sources..."
                    className="h-9 w-full border border-border bg-white pl-9 pr-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-foreground/40"
                  />
                </label>
                <FilterSelect
                  label="Type"
                  value={sourceFilter}
                  onChange={(value) => setSourceFilter(value as KnowledgeSource | "All")}
                  options={[
                    ["All", "All types"],
                    ["manual", "Manual"],
                    ["thread", "From chat"],
                    ["paste-import", "Imported"],
                    ["website", "Website"],
                    ["auto-generated", "Auto-generated"],
                  ]}
                />
                <FilterSelect
                  label="Scope"
                  value={scopeFilter}
                  onChange={(value) => setScopeFilter(value as KnowledgeLevel | "All")}
                  options={[["All", "All scopes"], ["global", "Global"], ["user", "User"]]}
                />
                <FilterSelect
                  label="Category"
                  value={categoryFilter}
                  onChange={(value) => setCategoryFilter(value as KnowledgeCategory | "All")}
                  options={[["All", "All categories"], ...KNOWLEDGE_CATEGORIES.map((category) => [category, category] as [string, string])]}
                />
                </div>
                <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                <span className="px-1 text-xs tabular-nums text-muted-foreground">{filtered.length} total {filtered.length === 1 ? "source" : "sources"}</span>
                <FilterSelect
                  label="Sort"
                  value={sortOrder}
                  onChange={(value) => setSortOrder(value as SortOrder)}
                  options={[["newest", "Newest first"], ["oldest", "Oldest first"], ["priority", "Priority"]]}
                />
                <button
                  type="button"
                  onClick={() => setShowWebsiteFlow(true)}
                  className="flex h-9 items-center gap-1.5 border border-border bg-white px-3 text-sm font-medium text-foreground transition-colors hover:bg-neutral-50"
                >
                  <Globe className="size-4" />
                  Add website
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddModal(true)}
                  className="flex h-9 items-center gap-1.5 bg-foreground px-3 text-sm font-medium text-background transition-opacity hover:opacity-90"
                >
                  <Plus className="size-4" />
                  Add sources
                </button>
                </div>
              </div>

              {addMode === "write" && (
                <div className="border-b border-border p-4">
                  <KnowledgeAddForm
                    defaultLevel={defaultAddLevel}
                    onSave={handleAddEntry}
                    onCancel={() => setAddMode("none")}
                  />
                </div>
              )}

              {filtered.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[960px] border-collapse text-left">
                    <thead className="bg-neutral-50">
                      <tr className="border-b border-border text-[9.9px] uppercase tracking-[0.08em] text-muted-foreground">
                        <th className="w-[34%] px-4 py-3 font-medium">Name</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium">Category</th>
                        <th className="px-4 py-3 font-medium">Priority</th>
                        <th className="px-4 py-3 font-medium">Scope</th>
                        <th className="px-4 py-3 font-medium">Source</th>
                        <th className="px-4 py-3 font-medium">Last updated</th>
                        <th className="w-12 px-3 py-3"><span className="sr-only">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((entry) => (
                        <tr
                          key={entry.id}
                          onClick={() => setSelectedId(entry.id)}
                          className="cursor-pointer border-b border-border bg-white transition-colors last:border-b-0 hover:bg-neutral-50/80"
                        >
                          <td className="px-4 py-4 align-top">
                            <p className="max-w-xl truncate text-sm font-medium text-foreground">{entry.title ?? sourceTitle(entry.content)}</p>
                            <p className="mt-1 max-w-xl truncate text-xs text-muted-foreground">{entry.sourceUrl ?? entry.referenceThread ?? entry.content}</p>
                          </td>
                          <td className="px-4 py-4 align-top">
                            <span className="inline-flex items-center gap-1.5 border border-border px-2 py-1 text-xs font-medium text-foreground">
                              <span className="size-1.5 rounded-full bg-foreground" /> Active
                            </span>
                          </td>
                          <td className="px-4 py-4 align-top text-sm text-muted-foreground">{entry.category}</td>
                          <td className="px-4 py-4 align-top text-sm text-muted-foreground">{entry.priority}</td>
                          <td className="px-4 py-4 align-top text-sm capitalize text-muted-foreground">{entry.level}</td>
                          <td className="px-4 py-4 align-top text-sm text-muted-foreground">{formatSource(entry.source)}</td>
                          <td suppressHydrationWarning className="whitespace-nowrap px-4 py-4 align-top text-sm text-muted-foreground">{formatRelativeDate(entry.dateAdded)}</td>
                          <td className="px-3 py-3 align-top">
                            <button
                              type="button"
                              aria-label={`Open ${entry.title ?? sourceTitle(entry.content)}`}
                              onClick={(event) => { event.stopPropagation(); setSelectedId(entry.id); }}
                              className="flex size-9 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            >
                              <MoreHorizontal className="size-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState
                  hasFilters={categoryFilter !== "All" || sourceFilter !== "All" || scopeFilter !== "All" || searchQuery !== ""}
                  loading={initialLoading}
                />
              )}
          </section>
        </main>

        {previewEntry && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm"
            onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedId(null); }}
          >
            <div className="relative h-[min(680px,88vh)] w-full max-w-2xl overflow-hidden border border-border bg-background shadow-xl">
              <button
                type="button"
                aria-label="Close source details"
                onClick={() => setSelectedId(null)}
                className="absolute right-4 top-4 z-10 flex size-8 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
              <PreviewPanel entry={previewEntry} onEdit={handleEdit} onDelete={setDeleteTarget} />
            </div>
          </div>
        )}

        {showAddModal && (
          <KnowledgeAddModal
            onSelect={(action, file) => {
              setShowAddModal(false);
              if (file) setDroppedFile(file);
              setAddMode(action);
            }}
            onClose={() => setShowAddModal(false)}
          />
        )}

        <KnowledgeWebsiteSourceFlow
          open={showWebsiteFlow}
          onOpenChange={setShowWebsiteFlow}
          datasetId={datasetId}
          defaultLevel={defaultAddLevel}
          onSave={handleWebsiteAdd}
        />

        {(addMode === "paste" || addMode === "upload" || addMode === "url" || addMode === "notion") && (
          <KnowledgeImport
            mode={addMode === "notion" ? "notion" : "paste"}
            defaultLevel={defaultAddLevel}
            defaultInputMode={addMode === "upload" ? "file" : addMode === "url" ? "url" : "paste"}
            initialFile={droppedFile}
            onSave={(entries) => { handleBulkAdd(entries); setDroppedFile(null); }}
            onClose={() => { setAddMode("none"); setDroppedFile(null); }}
          />
        )}

        <ConfirmDialog
          open={deleteTarget !== null}
          onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
          title="Delete knowledge source"
          description="This source will be permanently removed from the knowledge base."
          onConfirm={confirmDeleteEntry}
        />
      </div>
    </FeatureGate>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <KnowledgeSelect
      label={label}
      value={value}
      onValueChange={onChange}
      options={options.map(([optionValue, optionLabel]) => ({ value: optionValue, label: optionLabel }))}
    />
  );
}

function sourceTitle(content: string): string {
  const firstLine = content.split(/\n|(?<=[.!?])\s/)[0]?.trim() || "Untitled source";
  return firstLine.length > 72 ? `${firstLine.slice(0, 69)}…` : firstLine;
}

/* ── Preview Panel ── */

function PreviewPanel({
  entry,
  onEdit,
  onDelete,
}: {
  entry: KnowledgeEntry;
  onEdit: (id: string, updates: Partial<KnowledgeEntry>) => void;
  onDelete: (id: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(entry.content);
  const [editPriority, setEditPriority] = useState(entry.priority);
  const [editCategory, setEditCategory] = useState(entry.category);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Reset edit state when entry changes
  const [prevId, setPrevId] = useState(entry.id);
  if (entry.id !== prevId) {
    setPrevId(entry.id);
    setIsEditing(false);
    setEditContent(entry.content);
    setEditPriority(entry.priority);
    setEditCategory(entry.category);
    setConfirmDelete(false);
  }

  const hasChanges =
    editContent !== entry.content ||
    editPriority !== entry.priority ||
    editCategory !== entry.category;

  const handleSave = () => {
    onEdit(entry.id, {
      content: editContent,
      priority: editPriority,
      category: editCategory,
    });
    setIsEditing(false);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-5 pt-5 pb-4 border-b border-border shrink-0">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[9.9px] px-2.5 py-1 rounded-full border border-border text-foreground font-medium">
            {entry.level === "global" ? "Global" : "User Preference"}
          </span>
          <span className="text-[9.9px] px-2.5 py-1 rounded-full border border-border text-foreground font-medium">
            {entry.category}
          </span>
          <span className="text-[9.9px] px-2.5 py-1 rounded-full border border-border text-foreground font-medium">
            {entry.priority}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
        {isEditing ? (
          <>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">Content</label>
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full border border-border rounded-lg p-3 text-sm leading-relaxed min-h-[160px] bg-background focus:outline-none focus:ring-2 focus:ring-ring/20 resize-y"
              />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Category</label>
                <KnowledgeSelect
                  label="Category"
                  value={editCategory}
                  onValueChange={(value) => setEditCategory(value as KnowledgeCategory)}
                  options={KNOWLEDGE_CATEGORIES.map((category) => ({ value: category, label: category }))}
                  className="w-full"
                />
              </div>
              <div className="flex-1">
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Priority</label>
                <KnowledgeSelect
                  label="Priority"
                  value={editPriority}
                  onValueChange={(value) => setEditPriority(value as KnowledgePriority)}
                  options={KNOWLEDGE_PRIORITIES.map((priority) => ({ value: priority, label: priority }))}
                  className="w-full"
                />
              </div>
            </div>
          </>
        ) : (
          <div>
            {entry.title && <h2 className="mb-3 text-base font-semibold">{entry.title}</h2>}
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{entry.content}</p>
          </div>
        )}

        {/* Metadata */}
        <div className="pt-4 border-t border-border space-y-2.5">
          <div className="flex items-center gap-2 text-[11.7px] text-muted-foreground">
            <SourceIcon source={entry.source} />
            <span>{formatSource(entry.source)}</span>
          </div>
          <div className="flex items-center gap-2 text-[11.7px] text-muted-foreground">
            <Calendar className="w-3 h-3" />
            <span>Added {formatDate(entry.dateAdded)}</span>
          </div>
          <div className="flex items-center gap-2 text-[11.7px] text-muted-foreground">
            <User className="w-3 h-3" />
            <span>{entry.addedBy}</span>
          </div>
          {entry.sourceUrl && (
            <a
              href={entry.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 text-xs text-foreground/70 transition-colors hover:text-foreground hover:underline"
            >
              <Globe className="w-3 h-3" />
              View source website
            </a>
          )}
          {entry.referenceThread && (
            <button className="flex items-center gap-2 text-xs text-foreground/70 hover:text-foreground hover:underline transition-colors">
              <MessageSquare className="w-3 h-3" />
              View source thread
            </button>
          )}
        </div>
      </div>

      {/* Footer actions */}
      <div className="px-5 py-3.5 border-t border-border shrink-0 flex items-center justify-between">
        {confirmDelete ? (
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-medium">Delete?</span>
            <button
              onClick={() => onDelete(entry.id)}
              className="px-2.5 py-1 text-xs font-medium bg-foreground text-background rounded-md hover:bg-foreground/90 transition-colors"
            >
              Delete
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </button>
        )}

        <div className="flex items-center gap-2">
          {isEditing ? (
            <>
              <button
                onClick={() => {
                  setIsEditing(false);
                  setEditContent(entry.content);
                  setEditPriority(entry.priority);
                  setEditCategory(entry.category);
                }}
                className="px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!hasChanges}
                className="px-3.5 py-1.5 text-xs font-medium bg-foreground text-background rounded-md hover:bg-foreground/90 transition-colors disabled:opacity-30"
              >
                Save
              </button>
            </>
          ) : (
            <button
              onClick={() => setIsEditing(true)}
              className="px-3.5 py-1.5 text-xs font-medium border border-border rounded-md hover:bg-muted transition-colors"
            >
              Edit
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Helpers ── */

function SourceIcon({ source }: { source: string }) {
  switch (source) {
    case "thread":
      return <MessageSquare className="w-3 h-3" />;
    case "manual":
      return <PenLine className="w-3 h-3" />;
    case "paste-import":
      return <ClipboardPaste className="w-3 h-3" />;
    case "website":
      return <Globe className="w-3 h-3" />;
    case "auto-generated":
      return <Bot className="w-3 h-3" />;
    default:
      return <PenLine className="w-3 h-3" />;
  }
}

function formatSource(source: string): string {
  switch (source) {
    case "thread": return "From Chat";
    case "manual": return "Manual";
    case "paste-import": return "Imported";
    case "website": return "Website";
    case "auto-generated": return "Auto-Generated";
    default: return source;
  }
}

function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatRelativeDate(isoDate: string): string {
  const timestamp = new Date(isoDate).getTime();
  const elapsed = Date.now() - timestamp;
  if (!Number.isFinite(elapsed) || elapsed < 0) return formatDate(isoDate);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(isoDate);
}

function EmptyState({
  hasFilters,
  loading,
}: {
  hasFilters: boolean;
  loading?: boolean;
}) {
  if (hasFilters) {
    return (
      <div className="min-h-full flex flex-col items-center justify-center text-center px-6 py-12">
        <p className="text-sm text-muted-foreground">
          No entries match your filters.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-full flex flex-col items-center justify-center text-center px-6 py-12">
        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
          <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
        </div>
        <p className="text-sm font-medium mb-1">Loading knowledge base...</p>
      </div>
    );
  }

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-6">
      <KnowledgeIcon className="size-10 text-muted-foreground/50 mb-4" />
      <h2 className="text-base font-medium text-foreground mb-1">No knowledge entries yet</h2>
      <p className="text-sm text-muted-foreground max-w-sm mx-auto">
        Add a website or another source when you are ready.
      </p>
    </div>
  );
}
