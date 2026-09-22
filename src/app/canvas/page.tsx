"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import {
  getBoardSummaries,
  saveBoard,
  removeBoard,
} from "@/lib/board-store";
import type { BoardSummary } from "@/lib/board-types";
import { useDataset } from "@/lib/dataset-context";
import { useSidebarContext } from "@/components/sidebar-context";
import { useChatPanel } from "@/components/chat/chat-panel-provider";
import { useDeckUploadToBoard } from "@/hooks/use-deck-upload-to-board";
import { BOARD_TEMPLATES } from "@/lib/board-templates";
import type { BoardTemplate } from "@/lib/board-templates";
import { FeatureGate } from "@/components/feature-gate";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/* ── Monochrome preview illustrations for template cards ── */

function BlankPreview() {
  return (
    <svg viewBox="0 0 240 140" fill="none" className="w-full h-full">
      <rect x="20" y="20" width="200" height="100" rx="8" stroke="currentColor" strokeWidth="1" strokeDasharray="6 4" opacity="0.3" />
      <line x1="110" y1="55" x2="130" y2="55" stroke="currentColor" strokeWidth="1.5" opacity="0.4" />
      <line x1="120" y1="45" x2="120" y2="65" stroke="currentColor" strokeWidth="1.5" opacity="0.4" />
    </svg>
  );
}

function TemplateGridPreview() {
  return (
    <svg viewBox="0 0 240 140" fill="none" className="w-full h-full">
      {/* 2x3 grid of mini chart icons */}
      <rect x="30" y="20" width="50" height="40" rx="4" stroke="currentColor" strokeWidth="1" opacity="0.25" />
      <rect x="95" y="20" width="50" height="40" rx="4" stroke="currentColor" strokeWidth="1" opacity="0.25" />
      <rect x="160" y="20" width="50" height="40" rx="4" stroke="currentColor" strokeWidth="1" opacity="0.25" />
      <rect x="30" y="75" width="50" height="40" rx="4" stroke="currentColor" strokeWidth="1" opacity="0.25" />
      <rect x="95" y="75" width="50" height="40" rx="4" stroke="currentColor" strokeWidth="1" opacity="0.25" />
      <rect x="160" y="75" width="50" height="40" rx="4" stroke="currentColor" strokeWidth="1" opacity="0.25" />
      {/* Bar chart */}
      <rect x="38" y="40" width="6" height="12" rx="1" fill="currentColor" opacity="0.3" />
      <rect x="47" y="35" width="6" height="17" rx="1" fill="currentColor" opacity="0.3" />
      <rect x="56" y="38" width="6" height="14" rx="1" fill="currentColor" opacity="0.3" />
      <rect x="65" y="32" width="6" height="20" rx="1" fill="currentColor" opacity="0.3" />
      {/* Donut */}
      <circle cx="120" cy="40" r="12" stroke="currentColor" strokeWidth="3" opacity="0.2" />
      <path d="M120 28 A12 12 0 0 1 132 40" stroke="currentColor" strokeWidth="3" opacity="0.4" />
      {/* Line chart */}
      <polyline points="168,48 175,38 182,42 189,30 196,35 203,28" stroke="currentColor" strokeWidth="1.5" opacity="0.35" fill="none" />
      {/* Area chart */}
      <path d="M38,107 L47,97 L56,102 L65,92 L72,95 L72,107 Z" fill="currentColor" opacity="0.15" />
      <polyline points="38,107 47,97 56,102 65,92 72,95" stroke="currentColor" strokeWidth="1.5" opacity="0.35" fill="none" />
      {/* Table */}
      <line x1="103" y1="85" x2="137" y2="85" stroke="currentColor" strokeWidth="1" opacity="0.25" />
      <line x1="103" y1="92" x2="137" y2="92" stroke="currentColor" strokeWidth="1" opacity="0.15" />
      <line x1="103" y1="99" x2="137" y2="99" stroke="currentColor" strokeWidth="1" opacity="0.15" />
      <line x1="103" y1="106" x2="137" y2="106" stroke="currentColor" strokeWidth="1" opacity="0.15" />
      {/* KPI number */}
      <rect x="168" y="83" width="34" height="10" rx="2" fill="currentColor" opacity="0.12" />
      <rect x="168" y="98" width="20" height="6" rx="1" fill="currentColor" opacity="0.08" />
    </svg>
  );
}

/** Per-template abstract preview thumbnails */
const TEMPLATE_PREVIEWS: Record<string, () => React.ReactNode> = {
  "product-kpis": () => (
    <svg viewBox="0 0 320 160" fill="none" className="w-full h-full">
      {/* Big KPI number */}
      <rect x="30" y="25" width="80" height="20" rx="3" fill="currentColor" opacity="0.12" />
      <rect x="30" y="52" width="45" height="8" rx="2" fill="currentColor" opacity="0.07" />
      {/* 3 small KPI cards */}
      <rect x="140" y="20" width="50" height="40" rx="4" stroke="currentColor" strokeWidth="1" opacity="0.2" />
      <rect x="200" y="20" width="50" height="40" rx="4" stroke="currentColor" strokeWidth="1" opacity="0.2" />
      <rect x="260" y="20" width="50" height="40" rx="4" stroke="currentColor" strokeWidth="1" opacity="0.2" />
      <rect x="148" y="30" width="24" height="8" rx="1" fill="currentColor" opacity="0.15" />
      <rect x="208" y="30" width="24" height="8" rx="1" fill="currentColor" opacity="0.15" />
      <rect x="268" y="30" width="24" height="8" rx="1" fill="currentColor" opacity="0.15" />
      <rect x="148" y="42" width="16" height="5" rx="1" fill="currentColor" opacity="0.07" />
      <rect x="208" y="42" width="16" height="5" rx="1" fill="currentColor" opacity="0.07" />
      <rect x="268" y="42" width="16" height="5" rx="1" fill="currentColor" opacity="0.07" />
      {/* Wide chart */}
      <rect x="30" y="75" width="280" height="65" rx="4" stroke="currentColor" strokeWidth="1" opacity="0.15" />
      <polyline points="45,125 75,108 105,115 135,95 165,100 195,88 225,92 255,82 285,90 295,85" stroke="currentColor" strokeWidth="1.5" opacity="0.3" fill="none" />
    </svg>
  ),
  "growth": () => (
    <svg viewBox="0 0 320 160" fill="none" className="w-full h-full">
      {/* Upward trending line */}
      <rect x="20" y="15" width="280" height="80" rx="4" stroke="currentColor" strokeWidth="1" opacity="0.15" />
      <polyline points="35,80 65,75 95,70 125,60 155,55 185,40 215,35 245,28 275,22 290,20" stroke="currentColor" strokeWidth="2" opacity="0.35" fill="none" />
      <path d="M35,80 L65,75 L95,70 L125,60 L155,55 L185,40 L215,35 L245,28 L275,22 L290,20 L290,85 L35,85 Z" fill="currentColor" opacity="0.06" />
      {/* Bar comparison at bottom */}
      <rect x="40" y="110" width="24" height="30" rx="2" fill="currentColor" opacity="0.15" />
      <rect x="70" y="118" width="24" height="22" rx="2" fill="currentColor" opacity="0.1" />
      <rect x="120" y="105" width="24" height="35" rx="2" fill="currentColor" opacity="0.15" />
      <rect x="150" y="112" width="24" height="28" rx="2" fill="currentColor" opacity="0.1" />
      <rect x="200" y="100" width="24" height="40" rx="2" fill="currentColor" opacity="0.15" />
      <rect x="230" y="108" width="24" height="32" rx="2" fill="currentColor" opacity="0.1" />
    </svg>
  ),
  "customer-health": () => (
    <svg viewBox="0 0 320 160" fill="none" className="w-full h-full">
      {/* Cohort heatmap grid */}
      {[0, 1, 2, 3, 4, 5].map((row) =>
        [0, 1, 2, 3, 4, 5, 6, 7].map((col) => {
          const opacity = Math.max(0.04, 0.25 - row * 0.03 - col * 0.015);
          return (
            <rect key={`${row}-${col}`} x={55 + col * 32} y={18 + row * 22} width="28" height="18" rx="2" fill="currentColor" opacity={opacity} />
          );
        })
      )}
      {/* Row labels */}
      {[0, 1, 2, 3, 4, 5].map((row) => (
        <rect key={`label-${row}`} x="20" y={22 + row * 22} width="28" height="6" rx="1" fill="currentColor" opacity="0.08" />
      ))}
    </svg>
  ),
  "revenue-deep-dive": () => (
    <svg viewBox="0 0 320 160" fill="none" className="w-full h-full">
      {/* Stacked area chart */}
      <rect x="20" y="15" width="280" height="130" rx="4" stroke="currentColor" strokeWidth="1" opacity="0.15" />
      <path d="M35,130 L75,120 L115,115 L155,105 L195,100 L235,90 L275,85 L290,82 L290,135 L35,135 Z" fill="currentColor" opacity="0.08" />
      <path d="M35,130 L75,125 L115,122 L155,118 L195,115 L235,110 L275,108 L290,106 L290,135 L35,135 Z" fill="currentColor" opacity="0.06" />
      <polyline points="35,130 75,120 115,115 155,105 195,100 235,90 275,85 290,82" stroke="currentColor" strokeWidth="1.5" opacity="0.3" fill="none" />
      <polyline points="35,130 75,125 115,122 155,118 195,115 235,110 275,108 290,106" stroke="currentColor" strokeWidth="1" opacity="0.2" fill="none" />
      {/* Y-axis ticks */}
      {[0, 1, 2, 3].map((i) => (
        <line key={i} x1="30" y1={40 + i * 25} x2="290" y2={40 + i * 25} stroke="currentColor" strokeWidth="0.5" opacity="0.08" />
      ))}
    </svg>
  ),
  "engagement": () => (
    <svg viewBox="0 0 320 160" fill="none" className="w-full h-full">
      {/* Histogram bars */}
      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => {
        const heights = [30, 45, 55, 70, 85, 75, 60, 50, 40, 30, 20, 12];
        const h = heights[i];
        return (
          <rect key={i} x={30 + i * 23} y={130 - h} width="18" height={h} rx="2" fill="currentColor" opacity={0.1 + (h / 85) * 0.15} />
        );
      })}
      {/* Overlay line */}
      <polyline points="39,100 62,85 85,75 108,60 131,45 154,55 177,70 200,80 223,90 246,100 269,110 292,118" stroke="currentColor" strokeWidth="1.5" opacity="0.3" fill="none" strokeDasharray="4 3" />
    </svg>
  ),
  "operational": () => (
    <svg viewBox="0 0 320 160" fill="none" className="w-full h-full">
      {/* Gauge / speedometer arc */}
      <path d="M100 120 A60 60 0 0 1 220 120" stroke="currentColor" strokeWidth="6" opacity="0.1" fill="none" strokeLinecap="round" />
      <path d="M100 120 A60 60 0 0 1 190 68" stroke="currentColor" strokeWidth="6" opacity="0.25" fill="none" strokeLinecap="round" />
      {/* Needle */}
      <line x1="160" y1="120" x2="185" y2="75" stroke="currentColor" strokeWidth="1.5" opacity="0.35" />
      <circle cx="160" cy="120" r="3" fill="currentColor" opacity="0.3" />
      {/* Status bars on right */}
      <rect x="240" y="30" width="60" height="8" rx="4" fill="currentColor" opacity="0.08" />
      <rect x="240" y="30" width="48" height="8" rx="4" fill="currentColor" opacity="0.2" />
      <rect x="240" y="50" width="60" height="8" rx="4" fill="currentColor" opacity="0.08" />
      <rect x="240" y="50" width="35" height="8" rx="4" fill="currentColor" opacity="0.2" />
      <rect x="240" y="70" width="60" height="8" rx="4" fill="currentColor" opacity="0.08" />
      <rect x="240" y="70" width="55" height="8" rx="4" fill="currentColor" opacity="0.2" />
      <rect x="240" y="90" width="60" height="8" rx="4" fill="currentColor" opacity="0.08" />
      <rect x="240" y="90" width="42" height="8" rx="4" fill="currentColor" opacity="0.2" />
    </svg>
  ),
};

export default function CanvasIndexPage() {
  const router = useRouter();
  const { datasetId } = useDataset();
  const { refreshBoards } = useSidebarContext();
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [creating, setCreating] = useState(false);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BoardSummary | null>(null);

  // "New board" menu state
  const [menuOpen, setMenuOpen] = useState(false);
  const [showPdfArea, setShowPdfArea] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const { upload, isUploading, error: uploadError } = useDeckUploadToBoard();

  useEffect(() => {
    const summaries = getBoardSummaries(datasetId);
    setBoards(summaries);
  }, [datasetId, refreshBoards]);

  // Push board list context into chat panel
  const { setEntity } = useChatPanel();
  useEffect(() => {
    if (boards.length > 0) {
      setEntity({
        id: "boards-list",
        name: "Boards",
        type: "boards-list",
        summary: `${boards.length} boards`,
        contextPayload: {
          boards: boards.map((b) => ({
            name: b.name,
            cardCount: b.cardCount,
            updatedAt: b.updatedAt,
          })),
        },
      });
    }
    return () => setEntity(undefined);
  }, [boards, setEntity]);

  const hasBoards = boards.length > 0;

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setShowPdfArea(false);
        setPdfError(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  // Close template modal on Escape
  useEffect(() => {
    if (!templateModalOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setTemplateModalOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [templateModalOpen]);

  function createBoard(opts: { name: string; templateId?: string; description?: string }) {
    if (creating) return;
    setCreating(true);
    setMenuOpen(false);
    setTemplateModalOpen(false);
    const now = new Date().toISOString();
    const board = {
      id: crypto.randomUUID(),
      name: opts.name,
      description: opts.description,
      datasetId,
      templateId: opts.templateId,
      createdAt: now,
      updatedAt: now,
    };
    saveBoard(board);
    refreshBoards();
    router.push(`/canvas/${board.id}`);
  }

  function handleNewBlankBoard() {
    createBoard({ name: "Untitled Board" });
  }

  function handleTemplateSelect(template: BoardTemplate) {
    createBoard({
      name: template.name,
      description: template.description,
      templateId: template.id,
    });
  }

  function handleFileSelect(file: File) {
    if (file.type !== "application/pdf") {
      setPdfError("Please select a PDF file.");
      return;
    }
    setPdfError(null);
    setMenuOpen(false);
    setShowPdfArea(false);
    upload(file);
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave() {
    setIsDragging(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileSelect(file);
  }

  const displayError = pdfError ?? uploadError;

  // ── Template modal (shared between empty state and "New Board" button) ──
  const templateModal = templateModalOpen && (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-background/60 backdrop-blur-md"
        onClick={() => setTemplateModalOpen(false)}
      />
      {/* Modal */}
      <div className="relative w-full max-w-3xl max-h-[85vh] mx-4 rounded-xl border border-border bg-background shadow-2xl overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between p-6 pb-2">
          <div>
            <h2 className="text-sm font-medium text-foreground">Use a Template</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Generates a board from your data using AI. Sections, charts, and metrics are tailored to your dataset.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setTemplateModalOpen(false)}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors -mt-1 -mr-1"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Template grid — 3 columns like Mixpanel */}
        <div className="grid grid-cols-3 gap-3 p-6 pt-4">
          {BOARD_TEMPLATES.map((t) => {
            const Preview = TEMPLATE_PREVIEWS[t.id];
            return (
              <button
                key={t.id}
                type="button"
                disabled={creating}
                onClick={() => handleTemplateSelect(t)}
                className="group text-left rounded-lg border border-border hover:border-foreground/25 transition-all disabled:opacity-50 overflow-hidden"
              >
                {/* Preview thumbnail */}
                <div className="aspect-[2/1] bg-muted/30 group-hover:bg-muted/50 transition-colors text-muted-foreground p-2">
                  {Preview ? <Preview /> : null}
                </div>
                {/* Label */}
                <div className="px-3 py-2.5">
                  <span className="text-xs font-medium text-foreground block">{t.name}</span>
                  <span className="text-[9px] text-muted-foreground leading-snug block mt-0.5">
                    {t.description}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );

  // ── Empty state: Mixpanel-style two hero cards ──
  if (!hasBoards) {
    return (
      <FeatureGate feature="boards">
      <div className="flex flex-col h-full min-w-0">
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="w-full max-w-2xl">
            {/* Two hero cards */}
            <div className="grid grid-cols-2 gap-4">
              {/* Start blank */}
              <button
                type="button"
                disabled={creating}
                onClick={handleNewBlankBoard}
                className="group text-center rounded-xl border border-border hover:border-foreground/25 transition-all disabled:opacity-50 overflow-hidden"
              >
                <div className="aspect-[5/3] bg-muted/20 group-hover:bg-muted/40 transition-colors text-muted-foreground flex items-center justify-center">
                  <BlankPreview />
                </div>
                <div className="px-4 py-4">
                  <span className="text-sm font-medium text-foreground block">Start Blank</span>
                  <span className="text-xs text-muted-foreground mt-1 block">
                    Build a board from scratch
                  </span>
                </div>
              </button>

              {/* Use a template */}
              <button
                type="button"
                disabled={creating}
                onClick={() => setTemplateModalOpen(true)}
                className="group text-center rounded-xl border border-border hover:border-foreground/25 transition-all disabled:opacity-50 overflow-hidden"
              >
                <div className="aspect-[5/3] bg-muted/20 group-hover:bg-muted/40 transition-colors text-muted-foreground flex items-center justify-center">
                  <TemplateGridPreview />
                </div>
                <div className="px-4 py-4">
                  <span className="text-sm font-medium text-foreground block">Use a Template</span>
                  <span className="text-xs text-muted-foreground mt-1 block">
                    Choose from {BOARD_TEMPLATES.length} AI-generated templates
                  </span>
                </div>
              </button>
            </div>

            {/* Upload PDF option below */}
            <div className="mt-4 text-center">
              <label
                className={`inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer ${isUploading ? "opacity-50 pointer-events-none" : ""}`}
              >
                {isUploading ? "Processing PDF..." : "Upload a PDF Deck"}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={handleFileInputChange}
                />
              </label>
              {displayError && (
                <p className="text-xs text-muted-foreground mt-1">{displayError}</p>
              )}
            </div>
          </div>
        </div>

        {templateModal}
      </div>
      </FeatureGate>
    );
  }

  // ── Normal state: board list ──
  return (
    <FeatureGate feature="boards">
    <div className="flex h-full min-w-0 flex-col">
      <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-6 px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-xl font-semibold text-foreground">Boards</h1>
          {/* New board dropdown */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => {
                setMenuOpen((v) => !v);
                setShowPdfArea(false);
                setPdfError(null);
              }}
              disabled={creating || isUploading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-xs font-medium text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              {isUploading ? "Processing..." : "New Board"}
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-border bg-background shadow-md">
                {/* Blank */}
                <button
                  type="button"
                  onClick={handleNewBlankBoard}
                  className="w-full text-left px-3 py-2.5 text-xs text-foreground hover:bg-muted/50 transition-colors rounded-t-lg"
                >
                  <span className="font-medium">Blank</span>
                  <span className="block text-muted-foreground mt-0.5">Start with an empty board</span>
                </button>

                <div className="border-t border-border" />

                {/* From template — opens modal */}
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setTemplateModalOpen(true);
                  }}
                  className="w-full text-left px-3 py-2.5 text-xs text-foreground hover:bg-muted/50 transition-colors"
                >
                  <span className="font-medium">From Template</span>
                  <span className="block text-muted-foreground mt-0.5">AI-generated from your data</span>
                </button>

                <div className="border-t border-border" />

                {/* Upload PDF */}
                {!showPdfArea ? (
                  <button
                    type="button"
                    onClick={() => {
                      setShowPdfArea(true);
                      setPdfError(null);
                    }}
                    className="w-full text-left px-3 py-2.5 text-xs text-foreground hover:bg-muted/50 transition-colors rounded-b-lg"
                  >
                    <span className="font-medium">Upload PDF Deck</span>
                    <span className="block text-muted-foreground mt-0.5">Analyze slides into a board</span>
                  </button>
                ) : (
                  <div className="p-3 rounded-b-lg">
                    <div
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      onClick={() => fileInputRef.current?.click()}
                      className={`
                        rounded-md border-2 border-dashed p-4 text-center cursor-pointer transition-colors
                        ${isDragging ? "border-foreground/40 bg-muted/50" : "border-border hover:border-foreground/30 hover:bg-muted/20"}
                      `}
                    >
                      <p className="text-xs text-muted-foreground">
                        Drop a PDF here or{" "}
                        <span className="text-foreground underline underline-offset-2">browse</span>
                      </p>
                    </div>
                    {displayError && (
                      <p className="text-xs text-muted-foreground mt-2">{displayError}</p>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="application/pdf"
                      className="hidden"
                      onChange={handleFileInputChange}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Board list */}
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
          {boards.map((board) => (
            <div
              key={board.id}
              onClick={() => router.push(`/canvas/${board.id}`)}
              className="w-full text-left p-4 rounded-lg border border-border hover:bg-muted/30 transition-colors cursor-pointer group/board"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">{board.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {board.cardCount} card{board.cardCount !== 1 ? "s" : ""} · Updated {formatDate(board.updatedAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTarget(board);
                    }}
                    className="opacity-0 group-hover/board:opacity-100 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-[opacity,color,background-color]"
                    title="Delete board"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14" />
                    </svg>
                  </button>
                  <svg
                    className="w-4 h-4 text-muted-foreground"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {templateModal}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Delete board"
        description={`"${deleteTarget?.name}" and all its cards will be permanently deleted.`}
        confirmLabel="Delete"
        onConfirm={() => {
          if (!deleteTarget) return;
          removeBoard(deleteTarget.id);
          setBoards((prev) => prev.filter((b) => b.id !== deleteTarget.id));
          refreshBoards();
          setDeleteTarget(null);
        }}
      />
    </div>
    </FeatureGate>
  );
}
