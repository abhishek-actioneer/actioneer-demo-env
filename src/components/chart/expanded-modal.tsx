"use client";

import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";

export interface ExpandedModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
}

export function ExpandedModal({ open, onOpenChange, title, children }: ExpandedModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[90vw] h-[85vh] p-0 flex flex-col overflow-hidden">
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <div className="flex-1 min-h-0 overflow-hidden">
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
}
