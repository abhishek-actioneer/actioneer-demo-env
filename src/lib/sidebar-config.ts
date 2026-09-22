import {
  Clock,
  LayoutDashboard,
  NotebookPen,
  TrendingUp,
  Database,
  ShoppingBag,
  type LucideIcon,
} from "lucide-react";

// ── Types ──

export interface ChatEntry {
  id: string;
  title: string;
}

export interface SidebarItem {
  readonly label: string;
  readonly route: `/${string}` | "/";
  readonly icon?: LucideIcon;
}

export interface SidebarGroupConfig {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly route: `/${string}` | "/";
  readonly items?: readonly SidebarItem[];
}

// ── Groups ──

export const SIDEBAR_GROUPS = {
  chat: {
    label: "History",
    icon: Clock,
    route: "/",
  },
  canvas: {
    label: "Canvas",
    icon: LayoutDashboard,
    route: "/canvas",
  },
  playbooks: {
    label: "Playbooks",
    icon: NotebookPen,
    route: "/playbooks",
    items: [
      { label: "Playbooks", route: "/playbooks" },
      { label: "Scouts", route: "/scouts" },
    ],
  },
  forecasting: {
    label: "Forecast",
    icon: TrendingUp,
    route: "/forecasting",
  },
  data: {
    label: "Data",
    icon: Database,
    route: "/data-catalog",
    items: [
      { label: "Data Catalog", route: "/data-catalog" },
      { label: "Connectors", route: "/connectors" },
      { label: "Metrics", route: "/metrics" },
      { label: "Metric Tree", route: "/metric-tree" },
      { label: "Segments", route: "/segments" },
      { label: "Knowledge", route: "/knowledge" },
    ],
  },
  actions: {
    label: "Store",
    icon: ShoppingBag,
    route: "/store",
    items: [
      { label: "Overview", route: "/store" },
      { label: "Catalog", route: "/store/catalog" },
      { label: "Offers", route: "/store/offers" },
      { label: "Transactions", route: "/store/transactions" },
      { label: "Players", route: "/store/players" },
    ],
  },
} as const satisfies Record<string, SidebarGroupConfig>;

export type SidebarGroup = keyof typeof SIDEBAR_GROUPS;

// ── Route → Group resolution (longest-prefix match) ──

const ROUTE_PREFIXES: readonly { prefix: string; group: SidebarGroup }[] = [
  { prefix: "/store/", group: "actions" },
  { prefix: "/store", group: "actions" },
  { prefix: "/connectors", group: "data" },
  { prefix: "/data-catalog", group: "data" },
  { prefix: "/metrics", group: "data" },
  { prefix: "/metric-tree", group: "data" },
  { prefix: "/segments", group: "data" },
  { prefix: "/knowledge", group: "data" },
  { prefix: "/playbooks", group: "playbooks" },
  { prefix: "/scouts", group: "playbooks" },
  { prefix: "/canvas", group: "canvas" },
  { prefix: "/forecasting", group: "forecasting" },
];

export function getActiveGroup(pathname: string): SidebarGroup {
  let best: SidebarGroup = "chat";
  let bestLen = 0;
  for (const { prefix, group } of ROUTE_PREFIXES) {
    if (pathname.startsWith(prefix) && prefix.length > bestLen) {
      best = group;
      bestLen = prefix.length;
    }
  }
  return best;
}

// ── Shared CSS constants ──

export const SECTION_HEADER =
  "text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-widest px-2.5 pt-2 pb-1";
export const ITEM =
  "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-muted transition-colors text-left";
export const PRIMARY = "text-[13px] text-foreground truncate";
export const SECONDARY = "text-[11px] text-muted-foreground truncate block";
export const FOOTER =
  "mx-1.5 mb-3 mt-1 px-2.5 py-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors text-left w-auto";
export const ICON_CLASS = "w-3.5 h-3.5 text-muted-foreground shrink-0";
export const EMPTY = "text-[13px] text-muted-foreground px-2.5 py-4 text-center";
