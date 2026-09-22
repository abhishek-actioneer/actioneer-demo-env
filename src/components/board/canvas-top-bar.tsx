"use client";

interface CanvasTopBarProps {
  boardId: string;
  viewMode: "document" | "canvas";
  onViewModeChange: (mode: "document" | "canvas") => void;
}

export function CanvasTopBar(_props: CanvasTopBarProps) {
  return null;
}
