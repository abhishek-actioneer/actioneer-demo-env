"use client";

import { useState } from "react";
import { Lightbulb, Loader2 } from "lucide-react";

interface SaveToKnowledgeProps {
  content: string;
  onSave: (level: "global" | "user") => void;
  onDismiss: () => void;
}

export function SaveToKnowledgeWidget({
  content,
  onSave,
  onDismiss,
}: SaveToKnowledgeProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async (level: "global" | "user") => {
    setIsSaving(true);
    try {
      await onSave(level);
      setSaved(true);
    } finally {
      setIsSaving(false);
    }
  };

  if (saved) {
    return (
      <div className="border border-border bg-muted rounded-lg px-4 py-3 flex items-center gap-2">
        <span className="text-xs text-foreground">
          Saved to Knowledge Base
        </span>
      </div>
    );
  }

  const preview =
    content.length > 120 ? content.slice(0, 120) + "..." : content;

  return (
    <div className="border border-border bg-muted/50 rounded-lg p-4">
      <div className="flex items-start gap-3">
        <div className="w-7 h-7 rounded-full bg-foreground/[0.06] flex items-center justify-center shrink-0 mt-0.5">
          <Lightbulb className="w-3.5 h-3.5 text-muted-foreground" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground mb-1">
            Save to Knowledge?
          </p>
          <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
            &ldquo;{preview}&rdquo;
          </p>

          <div className="flex items-center gap-2">
            <button
              onClick={() => handleSave("global")}
              disabled={isSaving}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-foreground text-background rounded-md hover:bg-foreground/90 disabled:opacity-50 transition-colors"
            >
              {isSaving && <Loader2 className="w-3 h-3 animate-spin" />}
              Save as Global
            </button>
            <button
              onClick={() => handleSave("user")}
              disabled={isSaving}
              className="px-3 py-1.5 text-xs font-medium border border-border rounded-md hover:bg-muted transition-colors text-foreground disabled:opacity-50"
            >
              Save as My Preference
            </button>
            <button
              onClick={onDismiss}
              className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
