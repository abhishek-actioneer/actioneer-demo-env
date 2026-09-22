import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export const dataTableClassNames = {
  table: "w-full border-collapse bg-white text-left text-sm",
  head: "bg-neutral-50",
  headerRow: "border-b border-border",
  headerCell: "whitespace-nowrap px-4 py-3 text-left text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground",
  row: "h-14 border-b border-border bg-white transition-colors last:border-b-0 hover:bg-neutral-50/80",
  cell: "px-4 py-3 align-middle",
  numericCell: "px-4 py-3 text-right align-middle tabular-nums",
};

export function DataTableFrame({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("overflow-hidden border border-border bg-white", className)}
      {...props}
    />
  );
}

export function DataTableToolbar({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex min-h-12 flex-wrap items-center justify-between gap-3 border-b border-border bg-white px-3 py-2", className)}>
      {children}
    </div>
  );
}

export function DataTableScroll({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("overflow-x-auto", className)} {...props} />;
}
