"use client";

import { Suspense, useState, useEffect, useRef, useCallback } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { SidebarProvider, useSidebarContext } from "@/components/sidebar-context";
import { DatasetProvider } from "@/lib/dataset-context";
import { ModelProvider } from "@/lib/model-context";
import { Sidebar } from "@/components/sidebar";
import { EntityCatalogProvider } from "@/components/chat/entity-catalog-provider";
import { ChatStateProvider } from "@/components/chat/chat-state-provider";
import { ChatPanelProvider } from "@/components/chat/chat-panel-provider";
import { ChatPanel } from "@/components/chat/chat-panel";
import { useChatPanel } from "@/components/chat/chat-panel-provider";
import { BreadcrumbProvider, useBreadcrumb } from "@/lib/breadcrumb-context";
import { GetStartedModal } from "@/components/onboarding/get-started-modal";
import { WalkthroughModal } from "@/components/onboarding/walkthrough-modal";
import { ProductTour } from "@/components/onboarding/product-tour";
import { OnboardingGate } from "@/components/onboarding/onboarding-gate";
import { LiveTickToast } from "@/components/synthetic/live-tick-toast";

/** Route-based breadcrumb mapping */
const _ROUTE_LABELS: Record<string, { label: string; parent?: string; parentHref?: string }> = {
  "/": { label: "" },
  "/explore": { label: "Explore" },
  "/metrics": { label: "Metrics" },
  "/metric-tree": { label: "Metric Tree" },
  "/playbooks": { label: "Playbooks" },
  "/scouts": { label: "Scouts" },
  "/segments": { label: "Segments" },
  "/knowledge": { label: "Knowledge" },
  "/canvas": { label: "Boards" },
  "/connectors": { label: "Data" },
  "/data-catalog": { label: "Data Catalog" },
  "/billing": { label: "Settings" },
  "/forecasting": { label: "Forecasting" },
  "/store": { label: "Store" },
  "/funnels": { label: "Funnels" },
  "/retentions": { label: "Retentions" },
  "/voice-campaigns": { label: "Campaigns" },
  "/voice-campaigns/new": { label: "Campaign Studio" },
  "/agents": { label: "Agents" },
  "/voice-campaigns/call-logs": { label: "Calls" },
  "/voice-campaigns/insights": { label: "Insights" },
  "/settings/connections": { label: "Integrations" },
  "/settings/access": { label: "Settings" },
  "/training": { label: "Training" },
};

/** Detail page patterns: /section/[id] → parent breadcrumb */
const DETAIL_PARENTS: Record<string, { parentLabel: string; parentHref: string; sectionLabel: string }> = {
  "/metrics/": { parentLabel: "Metrics", parentHref: "/metrics", sectionLabel: "Metrics" },
  "/segments/": { parentLabel: "Segments", parentHref: "/segments", sectionLabel: "Segments" },
  "/playbooks/": { parentLabel: "Playbooks", parentHref: "/playbooks", sectionLabel: "Playbooks" },
  "/canvas/": { parentLabel: "Board", parentHref: "/canvas", sectionLabel: "Board" },
  "/scouts/": { parentLabel: "Scouts", parentHref: "/scouts", sectionLabel: "Scouts" },
  "/funnels/": { parentLabel: "Funnels", parentHref: "/funnels", sectionLabel: "Funnels" },
  "/retentions/": { parentLabel: "Retentions", parentHref: "/retentions", sectionLabel: "Retentions" },
  "/training/program/": { parentLabel: "Training", parentHref: "/training", sectionLabel: "Training" },
  "/training/scenario/": { parentLabel: "Training", parentHref: "/training", sectionLabel: "Training" },
  "/training/draft/": { parentLabel: "Training", parentHref: "/training", sectionLabel: "Training" },
};

function Breadcrumb() {
  const pathname = usePathname();
  const { title: detailTitle } = useBreadcrumb();

  // Check detail pages first (e.g. /metrics/some-id)
  for (const [prefix, detail] of Object.entries(DETAIL_PARENTS)) {
    if (pathname.startsWith(prefix) && pathname !== prefix.slice(0, -1)) {
      return (
        <div className="flex items-center gap-1.5 text-[13px] min-w-0 px-6 py-3.5">
          <Link href={detail.parentHref} className="text-muted-foreground hover:text-foreground transition-colors shrink-0">
            {detail.parentLabel}
          </Link>
          <span className="text-muted-foreground/50 shrink-0">/</span>
          {detailTitle ? (
            <span className="text-foreground font-medium truncate">{detailTitle}</span>
          ) : (
            <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
          )}
        </div>
      );
    }
  }

  // Top-level pages render their own title inline with the page actions, so the
  // header strip stays clean (just the centered search) — no redundant breadcrumb.
  return null;
}

/** Thin edge handle between sidebar and content — icon follows cursor Y on hover */
function SidebarEdgeToggle() {
  const { sidebarCollapsed, setSidebarCollapsed } = useSidebarContext();
  const [mouseY, setMouseY] = useState<number | null>(null);
  const ref = useRef<HTMLButtonElement>(null);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const scaleY = rect.height / ref.current.offsetHeight || 1;
    const y = (e.clientY - rect.top) / scaleY;
    // Clamp so the 36px icon stays within bounds
    setMouseY(Math.max(18, Math.min(y, rect.height - 18)));
  }, []);

  return (
    <button
      ref={ref}
      onClick={() => { setSidebarCollapsed(!sidebarCollapsed); setMouseY(null); }}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setMouseY(null)}
      className="group/edge relative w-px shrink-0 cursor-pointer z-20"
      aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
    >
      {/* Wider invisible hit area */}
      <div className="absolute inset-y-0 -left-2 -right-2" />
      {/* Icon — follows cursor Y, centered exactly on the edge line */}
      {mouseY !== null && (
        <>
          <div
            className="absolute flex items-center justify-center rounded-none border border-border bg-card shadow-sm"
            style={{ width: 36, height: 36, top: mouseY - 18, right: -18, pointerEvents: "auto" }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-foreground">
              {sidebarCollapsed ? (
                <polyline points="9 6 15 12 9 18" />
              ) : (
                <polyline points="15 6 9 12 15 18" />
              )}
            </svg>
          </div>
          <div
            role="tooltip"
            className="pointer-events-none absolute z-50 whitespace-nowrap bg-foreground px-3 py-1.5 text-xs font-normal text-background"
            style={{ top: mouseY - 15, left: 27 }}
          >
            <span className="absolute -left-1 top-1/2 size-2 -translate-y-1/2 rotate-45 bg-foreground" />
            {sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          </div>
        </>
      )}
    </button>
  );
}

function LayoutInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const voiceStudioRoute = pathname.startsWith("/voice-campaigns/new");
  const hasBreadcrumbHeader = !voiceStudioRoute && Object.keys(DETAIL_PARENTS).some(
    (prefix) => pathname.startsWith(prefix) && pathname !== prefix.slice(0, -1),
  );
  const { isOpen: chatOpen } = useChatPanel();
  const { sidebarCollapsed, setSidebarCollapsed, onNewChat } = useSidebarContext();
  const [isMobile, setIsMobile] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;

      // ⇧⌘S — Toggle left sidebar
      if (meta && e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        setSidebarCollapsed(!sidebarCollapsed);
        return;
      }

      // ⇧⌘O — New chat
      if (meta && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        onNewChat();
        return;
      }

      // ⌘/ — Show keyboard shortcuts
      if (meta && e.key === "/") {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
        return;
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [setSidebarCollapsed, sidebarCollapsed, onNewChat]);

  return (
    // Locked to the viewport: the app frame never scrolls — inner panels own their scrolling.
    <div className="flex h-dvh overflow-hidden bg-sidebar text-[13.5px]">
      {/* Backdrop — only on mobile when sidebar is open */}
      {isMobile && !sidebarCollapsed && (
        <div
          className="fixed inset-0 bg-black/40 z-40"
          onClick={() => setSidebarCollapsed(true)}
        />
      )}
      <Sidebar />
      {!isMobile && <SidebarEdgeToggle />}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Header strip: detail-page breadcrumb on the left. */}
        {hasBreadcrumbHeader && (
          <div className="relative flex h-14 shrink-0 items-center bg-sidebar">
            <Breadcrumb />
            <div className="flex-1" />
          </div>
        )}
        <LiveTickToast />
        {/* Content + chat panel with gap */}
        <div className={`flex flex-1 min-w-0 overflow-hidden pb-3 pr-3 transition-[padding,gap] duration-200 ${hasBreadcrumbHeader ? "" : "pt-3"} ${chatOpen ? "gap-3" : "gap-0"}`}>
          {/* Main content */}
          <main className="min-w-0 flex-1 overflow-hidden rounded-[1px] border border-border bg-card transition-all duration-200">
            {children}
          </main>
          {/* Chat panel — separate rounded container, only visible when open */}
          <div className={`overflow-hidden bg-card border border-border transition-all duration-200 ${chatOpen ? "shrink-0 opacity-100" : "w-0 opacity-0 border-0"}`}>
            <ChatPanel />
          </div>
        </div>
      </div>

      {/* Keyboard shortcuts modal */}
      {shortcutsOpen && <ShortcutsModal onClose={() => setShortcutsOpen(false)} />}
    </div>
  );
}

// ── Keyboard shortcuts modal ──

const SHORTCUTS = [
  { label: "Search", keys: ["⌘", "K"] },
  { label: "Toggle chat panel", keys: ["⌘", "J"] },
  { label: "Toggle sidebar", keys: ["⇧", "⌘", "S"] },
  { label: "New chat", keys: ["⇧", "⌘", "O"] },
  { label: "Show shortcuts", keys: ["⌘", "/"] },
] as const;

function ShortcutsModal({ onClose }: { onClose: () => void }) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className="bg-background rounded-xl border border-border shadow-xl w-[340px] animate-in fade-in-0 zoom-in-95 duration-150">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold">Keyboard shortcuts</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors p-1 -m-1"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="px-5 py-3 space-y-1">
          {SHORTCUTS.map((s) => (
            <div key={s.label} className="flex items-center justify-between py-2">
              <span className="text-sm text-foreground">{s.label}</span>
              <div className="flex items-center gap-0.5">
                {s.keys.map((k, i) => (
                  <kbd
                    key={i}
                    className="text-[11px] leading-none px-1.5 py-1 rounded border border-border/60 bg-muted/40 font-sans text-muted-foreground min-w-[24px] text-center"
                  >
                    {k}
                  </kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/" || pathname.startsWith("/bdr")) return <>{children}</>;

  if (pathname.startsWith("/auth") || pathname.startsWith("/sign-in") || pathname.startsWith("/sign-up") || pathname.startsWith("/onboarding") || pathname.startsWith("/admin")) {
    return <>{children}</>;
  }

  return (
    <OnboardingGate>
    <DatasetProvider>
      <ModelProvider>
        <SidebarProvider>
          <Suspense>
            <BreadcrumbProvider>
            <EntityCatalogProvider>
            <ChatStateProvider>
              <ChatPanelProvider>
                <LayoutInner>{children}</LayoutInner>
                <GetStartedModal />
                <WalkthroughModal />
                <ProductTour />
              </ChatPanelProvider>
            </ChatStateProvider>
            </EntityCatalogProvider>
            </BreadcrumbProvider>
          </Suspense>
        </SidebarProvider>
      </ModelProvider>
    </DatasetProvider>
    </OnboardingGate>
  );
}
