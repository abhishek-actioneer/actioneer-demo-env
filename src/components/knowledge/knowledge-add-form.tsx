"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { KnowledgeSelect } from "@/components/knowledge/knowledge-select";
import { apiFetch } from "@/lib/api-client";
import { useModel } from "@/lib/model-context";
import type {
  KnowledgeEntry,
  KnowledgePriority,
  KnowledgeLevel,
} from "@/lib/knowledge-types";
import { KNOWLEDGE_PRIORITIES } from "@/lib/knowledge-types";

interface KnowledgeAddFormProps {
  defaultLevel: KnowledgeLevel;
  onSave: (entry: KnowledgeEntry) => void;
  onCancel: () => void;
}

export function KnowledgeAddForm({
  defaultLevel,
  onSave,
  onCancel,
}: KnowledgeAddFormProps) {
  useModel(); // sync module-level model state for apiFetch
  const [content, setContent] = useState("");
  const [priority, setPriority] = useState<KnowledgePriority>("High");
  const [level, setLevel] = useState<KnowledgeLevel>(defaultLevel);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!content.trim() || isSubmitting) return;

    setIsSubmitting(true);

    try {
      const { entry } = await apiFetch<{ entry: KnowledgeEntry }>("/api/knowledge/add", {
        method: "POST",
        body: { content: content.trim(), priority, level },
      });
      onSave(entry);
    } catch (err) {
      console.error("Failed to add knowledge:", err);
      // Fallback: save with default category
      onSave({
        id: `kb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        content: content.trim(),
        level,
        category: "Insight",
        priority,
        source: "manual",
        dateAdded: new Date().toISOString(),
        addedBy: "You",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="border border-border rounded-lg p-4 bg-muted/10">
      <p className="text-sm font-medium mb-3">New Knowledge Entry</p>

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Enter knowledge content..."
        className="w-full border border-border rounded-md p-3 text-sm min-h-[100px] bg-background focus:outline-none focus:ring-2 focus:ring-ring/20 mb-3 resize-y"
        autoFocus
      />

      <div className="flex items-center gap-3 mb-3">
        <div>
          <label className="text-[9.9px] text-muted-foreground mb-1 block">
            Priority
          </label>
          <KnowledgeSelect
            label="Priority"
            value={priority}
            onValueChange={(value) => setPriority(value as KnowledgePriority)}
            options={KNOWLEDGE_PRIORITIES.map((item) => ({ value: item, label: item }))}
            className="h-8 text-xs"
          />
        </div>

        <div>
          <label className="text-[9.9px] text-muted-foreground mb-1 block">
            Level
          </label>
          <KnowledgeSelect
            label="Level"
            value={level}
            onValueChange={(value) => setLevel(value as KnowledgeLevel)}
            options={[{ value: "global", label: "Global Context" }, { value: "user", label: "My Preference" }]}
            className="h-8 text-xs"
          />
        </div>

        <p className="text-[9.9px] text-muted-foreground mt-3.5 ml-2">
          Category will be auto-assigned by Actioneer.
        </p>
      </div>

      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!content.trim() || isSubmitting}
          className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium bg-foreground text-background rounded-md hover:bg-foreground/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting && <Loader2 className="w-3 h-3 animate-spin" />}
          {isSubmitting ? "Saving..." : "Save Knowledge"}
        </button>
      </div>
    </div>
  );
}
