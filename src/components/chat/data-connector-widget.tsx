"use client";

import {
  ChevronRight,
  Upload,
  AlertTriangle,
} from "lucide-react";
import type { ConnectorCategory } from "@/lib/connector-categories";
import { ConnectorLogo } from "@/components/connectors/connector-logo";

interface DataConnectorWidgetProps {
  missing: Array<{ description: string; reason: string }>;
  categories: ConnectorCategory[];
  canProceedWithout: boolean;
  degradedDescription?: string;
  onCategoryClick: (categoryId: string) => void;
  onProceedWithout: () => void;
  onUploadCSV: () => void;
}

export function DataConnectorWidget({
  missing,
  categories,
  canProceedWithout,
  degradedDescription,
  onCategoryClick,
  onProceedWithout,
  onUploadCSV,
}: DataConnectorWidgetProps) {
  return (
    <div className="border border-border bg-muted rounded-xl p-5 space-y-4 max-w-[520px]">
      {/* Header */}
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-foreground shrink-0" />
        <h3 className="text-sm font-semibold">Connect required data</h3>
      </div>

      {/* Missing data explanation */}
      <div className="space-y-1.5">
        {missing.map((item, i) => (
          <p key={i} className="text-xs text-muted-foreground leading-relaxed">
            <span className="font-medium text-foreground">{item.description}</span>
            {": "}
            {item.reason}
          </p>
        ))}
      </div>

      {/* Category cards */}
      <div className="space-y-2">
        {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => onCategoryClick(cat.id)}
              className="w-full flex items-start gap-3 border border-border rounded-lg p-3.5 hover:bg-muted/50 cursor-pointer transition-colors text-left group"
            >
              <div className="flex -space-x-1 shrink-0 mt-0.5">
                {cat.examples.slice(0, 3).map((ex) => (
                  <ConnectorLogo key={ex} name={ex} fallbackIcon={cat.icon} size={22} className="rounded-full border-2 border-background" />
                ))}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{cat.name}</span>
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {cat.description}
                </p>
                <p className="text-[9.9px] text-muted-foreground/70 mt-1">
                  {cat.examples.join(" · ")}
                </p>
              </div>
            </button>
          ))}
      </div>

      {/* Bottom actions */}
      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={onUploadCSV}
          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors border border-border rounded-md px-3 py-1.5"
        >
          <Upload className="w-3 h-3" />
          Upload CSV
        </button>
        {canProceedWithout && (
          <button
            onClick={onProceedWithout}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Build with Available Data Only
            {degradedDescription && (
              <span className="text-muted-foreground/70">: {degradedDescription}</span>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
