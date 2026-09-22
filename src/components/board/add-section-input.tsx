"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

interface AddSectionInputProps {
  onSubmit: (query: string) => void;
  loading?: boolean;
}

export function AddSectionInput({ onSubmit, loading }: AddSectionInputProps) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");

  const handleSubmit = () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setQuery("");
    setExpanded(false);
  };

  if (!expanded) {
    return (
      <button
        type="button"
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors py-3 cursor-pointer"
        onClick={() => setExpanded(true)}
      >
        <Plus className="h-4 w-4" />
        Add section
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 py-3">
      <input
        type="text"
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSubmit();
          if (e.key === "Escape") {
            setExpanded(false);
            setQuery("");
          }
        }}
        placeholder="Section name..."
        className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20"
        disabled={loading}
      />
      <button
        type="button"
        onClick={handleSubmit}
        disabled={loading || !query.trim()}
        className="rounded-md bg-foreground text-background px-3 py-2 text-sm font-medium disabled:opacity-50 cursor-pointer"
      >
        {loading ? "Creating..." : "Create"}
      </button>
    </div>
  );
}
