"use client";

import { Check } from "lucide-react";
import { ConnectorLogo } from "@/components/connectors/connector-logo";

interface ConnectorCardProps {
  name: string;
  description?: string;
  selected: boolean;
  onClick: () => void;
  /** Lucide icon name for fallback (e.g. "Database", "Smartphone") */
  fallbackIcon?: string;
}

export function ConnectorCard({
  name,
  description,
  selected,
  onClick,
  fallbackIcon = "Database",
}: ConnectorCardProps) {
  return (
    <button
      onClick={onClick}
      className={`group relative flex items-center gap-3.5 px-4 py-3.5 rounded-xl text-left w-full transition-all duration-150 ${
        selected
          ? "bg-[#1c1c1c]"
          : "bg-[#151515] hover:bg-[#1a1a1a]"
      }`}
      style={{
        boxShadow: selected
          ? "0 0 0 1px rgba(232,232,232,0.25), 0 4px 12px rgba(0,0,0,0.2), 0 1px 3px rgba(0,0,0,0.15)"
          : "0 0 0 1px rgba(255,255,255,0.06), 0 1px 2px rgba(0,0,0,0.15)",
      }}
    >
      {/* Connector logo */}
      <div className="w-9 h-9 rounded-lg shrink-0 flex items-center justify-center bg-[#1e1e1e] overflow-hidden">
        <ConnectorLogo name={name} fallbackIcon={fallbackIcon} size={22} />
      </div>

      <div className="min-w-0 flex-1">
        <p className={`text-[11.7px] font-medium truncate ${
          selected ? "text-[#f0f0f0]" : "text-[#ccc]"
        }`}>
          {name}
        </p>
        {description && (
          <p className="text-[9.9px] text-[#555] truncate mt-0.5">{description}</p>
        )}
      </div>

      {/* Check indicator */}
      <div
        className={`w-5 h-5 rounded-md shrink-0 flex items-center justify-center transition-all duration-150 ${
          selected
            ? "bg-[#e8e8e8]"
            : "opacity-0 group-hover:opacity-100 bg-[#282828]"
        }`}
      >
        <Check
          className={`w-3 h-3 ${selected ? "text-[#111]" : "text-[#555]"}`}
          strokeWidth={2.5}
        />
      </div>
    </button>
  );
}
