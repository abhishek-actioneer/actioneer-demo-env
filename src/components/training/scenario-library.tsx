"use client";

/**
 * Saved-scenario library — the persisted counterpart to "Generate scenarios".
 * Lists trainer-curated bundles for the active dataset; click to load one back
 * into the editor, or delete it. Two-click delete (trash → confirm) avoids a
 * blocking window.confirm while staying lightweight.
 *
 * Monochrome only (project rule).
 */

import { useState } from "react";
import { FolderOpen, Trash2, Check, X } from "lucide-react";
import type { SavedScenarioBundle } from "@/features/roleplay/roleplay-scenario";

interface Props {
  items: SavedScenarioBundle[];
  currentId: string | null;
  onLoad: (bundle: SavedScenarioBundle) => void;
  onDelete: (id: string) => void;
}

export function ScenarioLibrary({ items, currentId, onLoad, onDelete }: Props) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  if (items.length === 0) return null;

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-2">
        <FolderOpen className="w-3.5 h-3.5 text-muted-foreground" />
        <h2 className="text-sm font-medium text-foreground">Saved scenarios</h2>
        <span className="text-xs text-muted-foreground">({items.length})</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((b) => {
          const active = b.id === currentId;
          const confirming = b.id === confirmingId;
          return (
            <div
              key={b.id}
              className={`group relative flex items-center gap-2 rounded-md border pl-3 pr-2 py-1.5 text-sm transition-colors ${
                active ? "border-foreground" : "border-border hover:border-foreground/40"
              }`}
            >
              <button onClick={() => onLoad(b)} className="flex flex-col items-start text-left">
                <span className="text-foreground leading-tight">{b.name}</span>
                <span className="text-[9.9px] text-muted-foreground leading-tight">
                  {b.role} · {b.difficulty} · {b.personas.length} persona{b.personas.length === 1 ? "" : "s"}
                </span>
              </button>
              {confirming ? (
                <span className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      onDelete(b.id);
                      setConfirmingId(null);
                    }}
                    className="text-foreground hover:opacity-70"
                    aria-label="Confirm delete"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setConfirmingId(null)}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Cancel delete"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => setConfirmingId(b.id)}
                  className="text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground transition-opacity"
                  aria-label="Delete scenario"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
