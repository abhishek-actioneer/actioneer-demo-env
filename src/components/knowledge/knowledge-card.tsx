"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { KnowledgeSelect } from "@/components/knowledge/knowledge-select";
import {
  X,
  Trash2,
  MessageSquare,
  Bot,
  ClipboardPaste,
  PenLine,
  Pencil,
  Calendar,
  User,
  AlertTriangle,
  Globe,
} from "lucide-react";
import type {
  KnowledgeEntry,
  KnowledgeCategory,
  KnowledgePriority,
} from "@/lib/knowledge-types";
import { KNOWLEDGE_CATEGORIES, KNOWLEDGE_PRIORITIES } from "@/lib/knowledge-types";

const CATEGORY_STYLES: Record<KnowledgeCategory, string> = {
  "Data validation": "bg-muted text-foreground",
  "External benchmark": "bg-muted text-foreground",
  Insight: "bg-muted text-foreground",
  Reporting: "bg-muted text-foreground",
  Segment: "bg-muted text-foreground",
  Visualisation: "bg-muted text-foreground",
  Metric: "bg-muted text-foreground",
  "Metric range": "bg-muted text-foreground",
};


interface KnowledgeCardProps {
  entry: KnowledgeEntry;
  onEdit: (id: string, updates: Partial<KnowledgeEntry>) => void;
  onDelete: (id: string) => void;
}

export function KnowledgeCard({ entry, onEdit, onDelete }: KnowledgeCardProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setIsModalOpen(true)}
        className="w-full text-left border border-border rounded-lg p-4 hover:bg-muted/20 hover:border-foreground/15 transition-colors cursor-pointer"
      >
        {/* Category badge */}
        <div className="flex items-center gap-2 mb-2">
          <Badge
            variant="secondary"
            className={`text-[9px] px-2 py-0.5 font-medium border-0 ${CATEGORY_STYLES[entry.category]}`}
          >
            {entry.category}
          </Badge>
        </div>

        {entry.title && <p className="mb-1 truncate text-sm font-semibold">{entry.title}</p>}

        {/* Content */}
        <p className="text-sm leading-relaxed mb-3 line-clamp-2">{entry.content}</p>

        {/* Source row */}
        <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <SourceIcon source={entry.source} />
          <span>{formatSource(entry.source)}</span>
          <span className="text-muted-foreground/40">·</span>
          <span>{formatDate(entry.dateAdded)}</span>
        </div>
      </button>

      {isModalOpen && (
        <KnowledgeDetailModal
          entry={entry}
          onEdit={onEdit}
          onDelete={onDelete}
          onClose={() => setIsModalOpen(false)}
        />
      )}
    </>
  );
}

// ── Detail Modal ──

function KnowledgeDetailModal({
  entry,
  onEdit,
  onDelete,
  onClose,
}: {
  entry: KnowledgeEntry;
  onEdit: (id: string, updates: Partial<KnowledgeEntry>) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(entry.content);
  const [editPriority, setEditPriority] = useState(entry.priority);
  const [editCategory, setEditCategory] = useState(entry.category);
  const [confirmDelete, setConfirmDelete] = useState(false);

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

  const handleCancelEdit = () => {
    setEditContent(entry.content);
    setEditPriority(entry.priority);
    setEditCategory(entry.category);
    setIsEditing(false);
  };

  const handleDelete = () => {
    onDelete(entry.id);
    onClose();
  };

  const addedBy = entry.addedBy === "Sentinel AI" ? "Actioneer AI" : entry.addedBy;

  return (
    <div
      className="fixed inset-0 bg-background/60 backdrop-blur-md flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-background rounded-lg border border-border shadow-xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header — tags on the left, Edit + Close on the right (in line with the tags) */}
        <div className="flex items-start justify-between p-6 pb-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-[9.9px] px-2.5 py-0.5 font-medium">
              {entry.level === "global" ? "Global" : "User Preference"}
            </Badge>
            {!isEditing && (
              <>
                <Badge variant="outline" className="text-[9.9px] px-2.5 py-0.5 font-medium">
                  {entry.category}
                </Badge>
                <Badge variant="outline" className="text-[9.9px] px-2.5 py-0.5 font-medium">
                  {entry.priority}
                </Badge>
              </>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0 ml-3">
            {!isEditing && (
              <button
                onClick={() => setIsEditing(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground rounded-md transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" />
                Edit
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1 hover:bg-muted rounded-md transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 flex-1 overflow-y-auto space-y-5">
          {isEditing ? (
            <>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Content</label>
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full border border-border rounded-lg p-3.5 text-sm leading-relaxed min-h-[140px] bg-background focus:outline-none focus:ring-2 focus:ring-ring/20 resize-y"
                />
              </div>
              <div className="flex items-start gap-4">
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
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{entry.content}</p>
            </div>
          )}

          {/* Metadata */}
          <div className="pt-4 border-t border-border space-y-2.5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <SourceIcon source={entry.source} />
              <span>{formatSource(entry.source)}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Calendar className="w-3 h-3" />
              <span>Added {formatDate(entry.dateAdded)}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <User className="w-3 h-3" />
              <span>{addedBy}</span>
            </div>
            {entry.sourceUrl && (
              <a
                href={entry.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 text-xs text-foreground/70 hover:text-foreground hover:underline transition-colors"
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

        {/* Footer — Save/Cancel while editing; Delete (bottom-right) otherwise */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border bg-muted/30 shrink-0">
          {isEditing ? (
            <>
              <button
                onClick={handleCancelEdit}
                className="px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!hasChanges}
                className="px-4 py-2 text-sm font-medium bg-foreground text-background rounded-lg hover:bg-foreground/90 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Save Changes
              </button>
            </>
          ) : confirmDelete ? (
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs text-foreground font-medium">Delete this entry?</span>
              <button
                onClick={handleDelete}
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
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground rounded-md transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Helpers ──

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
    case "thread":
      return "From Chat";
    case "manual":
      return "Manual";
    case "paste-import":
      return "Imported";
    case "website":
      return "Website";
    case "auto-generated":
      return "Auto-Generated";
    default:
      return source;
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
