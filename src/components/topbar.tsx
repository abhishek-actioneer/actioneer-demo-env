"use client";

import { ChevronDown, Store } from "lucide-react";
import { useDataset } from "@/lib/dataset-context";

export function Topbar() {
  const { dataset } = useDataset();

  return (
    <header className="h-12 border-b border-border flex items-center px-4 shrink-0">
      {/* Store selector */}
      <button className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-muted transition-colors text-sm">
        <Store className="w-4 h-4 text-muted-foreground" />
        <span>{dataset.label}</span>
        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
      </button>

      <div className="flex-1" />
    </header>
  );
}
