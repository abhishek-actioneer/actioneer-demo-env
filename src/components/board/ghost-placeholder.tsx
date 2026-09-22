import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface GhostPlaceholderProps {
  height: number | string;
  className?: string;
}

export function GhostPlaceholder({ height, className }: GhostPlaceholderProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-lg border border-dashed border-border bg-muted/50",
        className
      )}
      style={{ height }}
    >
      <Plus size={20} className="text-muted-foreground/50" />
    </div>
  );
}
