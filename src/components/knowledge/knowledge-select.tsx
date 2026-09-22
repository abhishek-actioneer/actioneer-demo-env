"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface KnowledgeSelectOption {
  value: string;
  label: string;
}

interface KnowledgeSelectProps {
  label: string;
  value: string;
  options: KnowledgeSelectOption[];
  onValueChange: (value: string) => void;
  className?: string;
}

export function KnowledgeSelect({
  label,
  value,
  options,
  onValueChange,
  className,
}: KnowledgeSelectProps) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        aria-label={label}
        className={cn("h-9 min-w-[112px] border-border bg-background shadow-none", className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent
        portalled={false}
        position="popper"
        align="start"
        sideOffset={4}
        className="min-w-[var(--radix-select-trigger-width)]"
      >
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
