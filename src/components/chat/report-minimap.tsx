"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LayoutGrid, List } from "lucide-react";
import { extractMarkdownHeadings } from "@/lib/markdown-headings";
import { useSidebarContext } from "@/components/sidebar-context";

interface ReportMinimapProps {
  content: string;
  reportId: string;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  visible?: boolean;
  onSaveAsBoard?: () => void;
  isSavingBoard?: boolean;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function ReportMinimap({ content, reportId, scrollRef, visible = true, onSaveAsBoard, isSavingBoard }: ReportMinimapProps) {
  const { sidebarCollapsed } = useSidebarContext();
  // Keep last valid content so headings persist during fade-out
  const lastContentRef = useRef({ content, reportId });
  if (content && reportId) {
    lastContentRef.current = { content, reportId };
  }
  const stableContent = lastContentRef.current.content;
  const stableReportId = lastContentRef.current.reportId;

  const headings = useMemo(
    () => {
      const all = extractMarkdownHeadings(stableContent).map((h) => ({
        ...h,
        domId: `report-${stableReportId}-${h.id}`,
      }));
      // Skip the title; need 3+ headings (title + 2 sections) to show useful outline
      return all.length > 2 ? all.slice(1) : [];
    },
    [stableContent, stableReportId]
  );
  const [activeId, setActiveId] = useState<string | null>(headings[0]?.domId ?? null);
  const [marker, setMarker] = useState({ topPct: 0, heightPct: 18 });
  const [hasRoom, setHasRoom] = useState(false);
  const [rightOffset, setRightOffset] = useState(0);
  const activeIdRef = useRef<string | null>(headings[0]?.domId ?? null);
  const markerRef = useRef({ topPct: 0, heightPct: 18 });
  const hasRoomRef = useRef(false);
  const rightOffsetRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  // Observe the scroll container width to decide whether to show the minimap
  // and compute the correct right offset based on the container's position.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;

    const measure = () => {
      const rect = scroller.getBoundingClientRect();
      // Content column is max-w-5xl (1024px) centered in the scroll area
      const contentMargin = (rect.width - 1024) / 2;
      // Need at least 220px of right margin to fit the minimap without overlap
      const hasEnoughRoom = contentMargin >= 220;
      if (hasRoomRef.current !== hasEnoughRoom) {
        hasRoomRef.current = hasEnoughRoom;
        setHasRoom(hasEnoughRoom);
      }
      // Position from the right edge of the scroll container
      const rightFromViewport = window.innerWidth - rect.right;
      const offset = hasEnoughRoom
        ? rightFromViewport + (contentMargin - 220) / 2
        : rightFromViewport + 12;
      const nextRightOffset = Math.max(12, offset);
      if (Math.abs(rightOffsetRef.current - nextRightOffset) >= 0.5) {
        rightOffsetRef.current = nextRightOffset;
        setRightOffset(nextRightOffset);
      }
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scroller);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [scrollRef]);

  const updateFromScroll = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller || headings.length === 0) return;

    const reportEl = scroller.querySelector<HTMLElement>(`[data-deep-report-id="${CSS.escape(stableReportId)}"]`);
    if (!reportEl) return;

    const headingEls = headings
      .map((h) => ({ h, el: reportEl.querySelector<HTMLElement>(`#${CSS.escape(h.domId)}`) }))
      .filter((x) => !!x.el);

    if (headingEls.length > 0) {
      const scrollerRect = scroller.getBoundingClientRect();
      const viewCenter = scrollerRect.top + scrollerRect.height / 2;
      let current = headingEls[0].h.domId;
      for (const item of headingEls) {
        const rect = item.el!.getBoundingClientRect();
        if (rect.top <= viewCenter) current = item.h.domId;
        else break;
      }
      if (activeIdRef.current !== current) {
        activeIdRef.current = current;
        setActiveId(current);
      }
    }

    const reportTop = reportEl.offsetTop;
    const reportHeight = reportEl.offsetHeight;
    const viewportTop = scroller.scrollTop;
    const viewportHeight = scroller.clientHeight;
    const trackSpan = Math.max(1, reportHeight - viewportHeight);
    const rawTop = (viewportTop - reportTop) / trackSpan;
    const topPct = clamp(rawTop * 100, 0, 100);
    const heightPct = clamp((viewportHeight / Math.max(1, reportHeight)) * 100, 10, 42);
    if (
      Math.abs(markerRef.current.topPct - topPct) >= 0.1 ||
      Math.abs(markerRef.current.heightPct - heightPct) >= 0.1
    ) {
      const nextMarker = { topPct, heightPct };
      markerRef.current = nextMarker;
      setMarker(nextMarker);
    }
  }, [headings, stableReportId, scrollRef]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    updateFromScroll();
    const onScroll = () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        updateFromScroll();
        rafRef.current = null;
      });
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [scrollRef, updateFromScroll]);

  if (headings.length === 0) return null;

  const shouldShow = visible && hasRoom && sidebarCollapsed;

  return (
    <aside
      className={`fixed top-20 bottom-6 w-52 z-10 pointer-events-none transition-opacity duration-300 ease-out ${
        shouldShow ? "opacity-100" : "opacity-0"
      }`}
      style={{ right: rightOffset }}
    >
      <div className={`relative w-full ${shouldShow ? "pointer-events-auto" : "pointer-events-none"}`}>
        <div className="flex items-center gap-2 text-muted-foreground mb-3">
          <List className="w-3.5 h-3.5" />
          <p className="text-xs">Report Outline</p>
        </div>

        <div className="relative pl-3">
          <div className="absolute left-0 top-0 bottom-0 w-px bg-border/70" />
          <div
            className="absolute left-0 w-px bg-foreground/80 rounded-full will-change-[top,height]"
            style={{
              top: `${clamp(marker.topPct, 0, 100)}%`,
              height: `${clamp(marker.heightPct, 0, 100 - clamp(marker.topPct, 0, 100))}%`,
            }}
          />

          <div className="space-y-1 max-h-[70vh] overflow-y-auto pr-1">
            {headings.map((h) => {
              const isActive = activeId === h.domId;
              const depth = h.level - 1;
              return (
                <button
                  key={h.domId}
                  onClick={() => {
                    const scroller = scrollRef.current;
                    if (!scroller) return;
                    const reportEl = scroller.querySelector<HTMLElement>(`[data-deep-report-id="${CSS.escape(stableReportId)}"]`);
                    const target = reportEl?.querySelector<HTMLElement>(`#${CSS.escape(h.domId)}`);
                    if (!target) return;
                    const scrollerRect = scroller.getBoundingClientRect();
                    const targetRect = target.getBoundingClientRect();
                    const scrollTop = scroller.scrollTop + (targetRect.top - scrollerRect.top) - 70;
                    scroller.scrollTo({ top: Math.max(0, scrollTop), behavior: "smooth" });
                    // Flash-highlight the heading so the user sees where to look
                    target.classList.add("minimap-heading-flash");
                    setTimeout(() => target.classList.remove("minimap-heading-flash"), 800);
                  }}
                  className={`relative block w-full text-left text-xs transition-colors truncate py-0.5 ${
                    isActive ? "text-foreground font-medium" : "text-muted-foreground hover:text-foreground"
                  }`}
                  style={{ paddingLeft: `${depth * 12 + 14}px` }}
                  title={h.text}
                >
                  {h.text}
                </button>
              );
            })}
          </div>
        </div>

        {onSaveAsBoard && (
          <button
            onClick={onSaveAsBoard}
            disabled={isSavingBoard}
            className="mt-6 flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card hover:bg-muted/50 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            {isSavingBoard ? "Creating..." : "Save as Board"}
          </button>
        )}
      </div>
    </aside>
  );
}
