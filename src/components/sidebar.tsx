"use client";

import { SentinelLogo } from "@/components/ui/sentinel-logo";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { SearchModal } from "@/components/chat/search-modal";
import { useSidebarContext } from "@/components/sidebar-context";
import {
  BarChart3,
  Bot,
  House,
  UsersRound,
  ChevronRight,
  ChevronsUpDown,
  Receipt,
  LogOut,
  Trash2,
  Loader2,
  ShieldCheck,
  Bug,
  Megaphone,
  PhoneCall,
  CircleUser,
  MonitorPlay,
  Plug,
  Settings2,
  ClipboardCheck,
} from "lucide-react";
import { OPEN_GET_STARTED_EVENT } from "@/components/onboarding/get-started-modal";
import { KnowledgeIcon } from "@/components/nav-icons";
import { SignOutButton, useUser } from "@clerk/nextjs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  createFolder,
  renameFolder as renameFolderStore,
  deleteFolder as deleteFolderStore,
  addChatToFolder,
  removeChatFromFolder,
} from "@/lib/folder-store";
import { deleteConversation } from "@/lib/conversation-store";
import { useDataset } from "@/lib/dataset-context";
import { isTeamEmail } from "@/lib/auth-domain";
import { BugReportModal } from "@/components/bug-report-modal";
import { ChatContextMenu } from "@/components/sidebar/chat-context-menu";
import { SyncStatusIndicator } from "@/components/sync-status-indicator";
import { isFeatureEnabled } from "@/lib/feature-flags";

function getActivePage(pathname: string): string {
  if (pathname.startsWith("/voice-campaigns/call-logs")) return "calls";
  if (pathname.startsWith("/voice-campaigns/insights") || pathname.startsWith("/voice-campaign-insights")) return "insights";
  if (pathname.startsWith("/evals")) return "evals";
  if (pathname.startsWith("/agents")) return "agents";
  if (pathname.startsWith("/voice-campaigns/new")) return "campaigns";
  if (pathname.startsWith("/voice-campaigns") || pathname.startsWith("/campaigns")) return "campaigns";
  if (pathname.startsWith("/explore")) return "explore";
  if (pathname.startsWith("/knowledge")) return "knowledge";
  if (pathname.startsWith("/metric-tree")) return "metric-tree";
  if (pathname.startsWith("/metrics")) return "metrics";
  if (pathname.startsWith("/segments")) return "segments";
  if (pathname.startsWith("/funnels")) return "funnels";
  if (pathname.startsWith("/retentions")) return "retentions";
  if (pathname.startsWith("/playbooks")) return "playbooks";
  if (pathname.startsWith("/training")) return "training";
  if (pathname.startsWith("/scouts")) return "scouts";
  if (pathname.startsWith("/canvas")) return "canvas";
  if (pathname.startsWith("/settings/connections")) return "integrations";
  if (pathname.startsWith("/settings") || pathname.startsWith("/data-catalog") || pathname.startsWith("/connectors")) return "settings";
  if (pathname.startsWith("/billing")) return "settings";
  return "chat";
}

export function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const {
    chats, activeId, onNewChat, onSelect,
    searchOpen, setSearchOpen, activeMessages,
    folders, refreshFolders, notifyFolderChanged, refreshChats,
    segments,
    sidebarCollapsed: collapsed, setSidebarCollapsed: setCollapsed,
    processingChatId,
  } = useSidebarContext();
  const { datasetId, dataset, allDatasets, switchDataset } = useDataset();
  const { user } = useUser();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const activePage = getActivePage(pathname);

  const displayName = user?.fullName || user?.firstName || "User";
  const displayEmail = user?.primaryEmailAddress?.emailAddress || "";
  // Only Actioneer team accounts can switch datasets (also enforced server-side).
  const canSwitch = isTeamEmail(displayEmail);

  const [datasetDropdownOpen, setDatasetDropdownOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [bugModalOpen, setBugModalOpen] = useState(false);
  const [bugPageUrl, setBugPageUrl] = useState<string | null>(null);
  const datasetDropdownRef = useRef<HTMLDivElement>(null);
  const accountPopoverRef = useRef<HTMLDivElement>(null);
  const [popoverPos, setPopoverPos] = useState<{ left: number; bottom: number } | null>(null);

  const [isMobile, setIsMobile] = useState(false);

  // Detect mobile and auto-collapse on narrow viewports
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile) setCollapsed(true);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, [setCollapsed]);

  // Persist collapsed state to localStorage
  useEffect(() => {
    const stored = localStorage.getItem("sidebar-collapsed");
    if (stored === "true") setCollapsed(true);
  }, [setCollapsed]);

  useEffect(() => {
    localStorage.setItem("sidebar-collapsed", String(collapsed));
  }, [collapsed]);

  // Close dataset dropdown on outside click
  useEffect(() => {
    if (!datasetDropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (datasetDropdownRef.current && !datasetDropdownRef.current.contains(e.target as Node)) {
        setDatasetDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [datasetDropdownOpen]);

  // Close account popover on outside click
  useEffect(() => {
    if (!accountOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (accountPopoverRef.current && !accountPopoverRef.current.contains(e.target as Node)) {
        setAccountOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [accountOpen]);

  // Folder/chat callbacks
  const handleAddToFolder = useCallback((chatId: string, folderId: string) => {
    addChatToFolder(chatId, folderId);
    refreshChats();
    refreshFolders();
  }, [refreshChats, refreshFolders]);

  const handleRemoveFromFolder = useCallback((chatId: string) => {
    removeChatFromFolder(chatId);
    refreshChats();
    refreshFolders();
  }, [refreshChats, refreshFolders]);

  const handleDeleteChat = useCallback((chatId: string) => {
    deleteConversation(chatId);
    refreshChats();
    refreshFolders();
  }, [refreshChats, refreshFolders]);

  const handleRenameFolder = useCallback((folderId: string, name: string) => {
    renameFolderStore(folderId, name);
    notifyFolderChanged();
  }, [notifyFolderChanged]);

  const handleDeleteFolder = useCallback((folderId: string) => {
    deleteFolderStore(folderId);
    notifyFolderChanged();
    refreshChats();
  }, [notifyFolderChanged, refreshChats]);

  const handleCreateFolderAndAdd = useCallback((chatId: string, folderName: string) => {
    const folder = createFolder(folderName, datasetId);
    addChatToFolder(chatId, folder.id);
    refreshChats();
    notifyFolderChanged();
  }, [datasetId, refreshChats, notifyFolderChanged]);

  const handleConvertToPlaybook = useCallback((chatId: string) => {
    router.push(`/playbooks/new?from=${chatId}`);
  }, [router]);

  // Search modal Cmd+K
  const handleOpenSearch = useCallback(() => {
    setSearchOpen(true);
  }, [setSearchOpen]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        handleOpenSearch();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [handleOpenSearch]);

  const toggleAccountPopover = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setAccountOpen((v) => {
      if (!v) {
        setPopoverPos({ left: rect.left, bottom: window.innerHeight - rect.top + 8 });
      }
      return !v;
    });
  }, []);

  // Open the bug modal synchronously. Screenshot capture happens inside the
  // modal itself so an html2canvas failure can't prevent the modal from showing.
  const handleOpenBugModal = useCallback(() => {
    const url = typeof window !== "undefined" ? window.location.href : null;
    setAccountOpen(false);
    setBugPageUrl(url);
    setBugModalOpen(true);
  }, []);

  const uncategorized = chats.filter((c) => !c.folderId);
  const recentChats = uncategorized.slice(0, 5);

  return (
    <TooltipProvider delayDuration={300}>
      <aside
        className={`bg-sidebar transition-[width] duration-200 ease-in-out overflow-hidden ${
          isMobile
            ? "fixed left-0 top-0 h-full z-50"
            : "relative h-full shrink-0"
        }`}
        style={{ width: collapsed ? (isMobile ? 0 : 50) : 216 }}
      >
        {/* ── Collapsed rail — matches expanded sidebar order ── */}
        <div
          className={`absolute inset-0 flex flex-col items-center pt-5 pb-3 pl-2.5 gap-1 transition-opacity duration-200 ease-in-out ${
            collapsed ? "opacity-100 delay-100" : "opacity-0 pointer-events-none"
          }`}
        >
          <SentinelLogo size={16} className="mb-1" />
          <MiniRailIcon icon={House} label="Home" active={activePage === "chat"} href="/" />
          {isFeatureEnabled("voice-campaigns") && <MiniRailIcon icon={Bot} label="Agents" active={activePage === "agents"} href="/agents" />}
          {isFeatureEnabled("segments") && <MiniRailIcon icon={UsersRound} label="Audiences" active={activePage === "segments"} href="/segments" />}
          {isFeatureEnabled("knowledge") && <MiniRailIcon icon={KnowledgeIcon} label="Knowledge" active={activePage === "knowledge"} href="/knowledge" />}
          {isFeatureEnabled("voice-campaigns") && <MiniRailIcon icon={Megaphone} label="Campaigns" active={activePage === "campaigns"} href="/voice-campaigns" />}
          {isFeatureEnabled("voice-campaigns") && <MiniRailIcon icon={PhoneCall} label="Calls" active={activePage === "calls"} href="/voice-campaigns/call-logs" />}
          {isFeatureEnabled("voice-campaigns") && <MiniRailIcon icon={BarChart3} label="Insights" active={activePage === "insights"} href="/voice-campaigns/insights" />}
          {isFeatureEnabled("voice-campaigns") && <MiniRailIcon icon={ClipboardCheck} label="Evals" active={activePage === "evals"} href="/evals" />}
          <MiniRailIcon icon={Plug} label="Integrations" active={activePage === "integrations"} href="/settings/connections" />
          <div className="flex-1" />
          <div className="w-6 border-t border-border my-1" />
          <MiniRailIcon icon={Settings2} label="Settings" active={activePage === "settings"} href="/settings/access" />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={toggleAccountPopover}
                className="w-8 h-8 rounded-md flex items-center justify-center text-muted-foreground cursor-pointer hover:bg-foreground/[0.06] transition-colors mt-1"
              >
                <CircleUser className="w-[16px] h-[16px]" strokeWidth={1.5} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Account</TooltipContent>
          </Tooltip>
        </div>

        {/* ── Expanded content ── */}
        <div
          className={`absolute inset-0 flex w-[216px] flex-col transition-opacity duration-200 ease-in-out ${
            collapsed ? "opacity-0 pointer-events-none" : "opacity-100 delay-100"
          }`}
        >
        {/* Header — Logo + Dataset */}
        <div className="flex h-16 items-center gap-2 px-4">
          <button
            onClick={onNewChat}
            aria-label="Go to home"
            title="Home"
            className="shrink-0 rounded-md hover:opacity-70 transition-opacity"
          >
            <SentinelLogo size={16} />
          </button>

          {/* Dataset switcher */}
          <div className="relative flex-1 min-w-0" ref={datasetDropdownRef}>
            <button
              data-tour="tour-workspace"
              onClick={() => { if (canSwitch) setDatasetDropdownOpen((v) => !v); }}
              className={`flex items-center gap-1 min-w-0 w-full rounded-md px-1 py-0.5 transition-colors ${canSwitch ? "hover:bg-foreground/[0.06]" : "cursor-default"}`}
            >
              <span className="text-[12.6px] font-semibold text-foreground truncate" suppressHydrationWarning>
                {dataset.label}
              </span>
              {canSwitch && <ChevronsUpDown className="w-3 h-3 text-muted-foreground shrink-0" />}
            </button>

            {canSwitch && datasetDropdownOpen && (
              <div className="absolute left-0 top-full mt-1 w-48 rounded-md border border-border bg-popover shadow-md z-50">
                {allDatasets.map((ds) => (
                  <button
                    key={ds.id}
                    onClick={() => {
                      switchDataset(ds.id);
                      setDatasetDropdownOpen(false);
                    }}
                    className={`flex items-center gap-2 w-full px-3 py-2 text-[12.6px] transition-colors ${
                      ds.id === datasetId
                        ? "bg-foreground/[0.08] text-foreground font-medium"
                        : "text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
                    }`}
                  >
                    <span className="truncate">{ds.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

        </div>

        {/* ── Grouped nav sections ── */}
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-3 pt-2">

          {/* Home */}
          <SidebarGroup
            icon={House}
            label="Home"
            href="/"
            defaultOpen={activePage === "chat"}
            activePage={activePage}
          >
            {/* Folders */}
            {mounted && folders.length > 0 && folders.map((folder) => {
              const folderChats = chats.filter((c) => c.folderId === folder.id);
              return (
                <FolderTreeItem
                  key={folder.id}
                  folder={folder}
                  chats={folderChats}
                  activeId={activeId}
                  onSelect={onSelect}
                  onRename={handleRenameFolder}
                  onDelete={handleDeleteFolder}
                  folders={folders}
                  processingChatId={processingChatId}
                  chatActions={{
                    onAddToFolder: handleAddToFolder,
                    onRemoveFromFolder: handleRemoveFromFolder,
                    onCreateFolderAndAdd: handleCreateFolderAndAdd,
                    onConvertToPlaybook: handleConvertToPlaybook,
                    onDeleteChat: handleDeleteChat,
                  }}
                />
              );
            })}
            {/* Recent uncategorized threads */}
            {mounted && recentChats.length > 0 && recentChats.map((chat) => {
              const isActive = chat.id === activeId;
              const isStreaming = processingChatId === chat.id;
              return (
              <div key={chat.id} className="relative group/chatchild flex items-center">
                <span
                  className="absolute left-0 top-1/2 w-3 border-t border-border/60"
                  style={{ transform: "translateY(-0.5px)" }}
                />
                <button
                  onClick={() => {
                    onSelect(chat.id);
                    if (pathname !== "/") router.push(`/?conv=${chat.id}`);
                  }}
                  className={`flex-1 min-w-0 pl-4 py-1.5 text-[12.6px] text-left truncate transition-colors cursor-pointer ${
                    isActive ? "text-foreground font-medium" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {chat.title}
                </button>
                {/* Gradient fade + actions — visible on hover or when streaming */}
                {isStreaming && (
                  <div className="absolute right-0 top-0 bottom-0 flex items-center gap-0.5 pr-2 pl-12 chat-actions-fade">
                    <Loader2 className="w-3 h-3 text-muted-foreground animate-spin shrink-0" />
                  </div>
                )}
                <div className={`absolute right-0 top-0 bottom-0 flex items-center gap-0.5 pr-1 pl-12 chat-actions-fade ${isStreaming ? "hidden" : "opacity-0 group-hover/chatchild:opacity-100"} transition-opacity`}>
                  <div className="shrink-0 [&_button]:!opacity-100">
                    <ChatContextMenu
                      chatId={chat.id}
                      currentFolderId={chat.folderId}
                      folders={folders}
                      onAddToFolder={handleAddToFolder}
                      onRemoveFromFolder={handleRemoveFromFolder}
                      onCreateFolderAndAdd={handleCreateFolderAndAdd}
                      onConvertToPlaybook={handleConvertToPlaybook}
                      onDelete={handleDeleteChat}
                    />
                  </div>
                </div>
              </div>
              );
            })}
            {mounted && chats.length === 0 && (
              <TreeChild label="Empty" active={false} muted />
            )}
            {mounted && chats.length > 0 && (
              <TreeChild label="See More" active={false} onClick={handleOpenSearch} muted />
            )}
          </SidebarGroup>

          <SectionLabel>Build</SectionLabel>

          {/* Agent library */}
          {isFeatureEnabled("voice-campaigns") && (
          <NavItem
            icon={Bot}
            label="Agents"
            href="/agents"
            active={activePage === "agents"}
            dataTour="tour-nav-voice"
            badge="BETA"
          />
          )}
          {/* Audience segments */}
          {isFeatureEnabled("segments") && (
          <SidebarGroup
            icon={UsersRound}
            label="Audiences"
            href="/segments"
            dataTour="tour-nav-segments"
            defaultOpen={activePage === "segments"}
            activePage={activePage}
          >
            {mounted && segments.slice(0, 5).map((seg) => (
              <TreeChild
                key={seg.id}
                label={seg.name}
                href={`/segments/${seg.id}`}
                active={pathname === `/segments/${seg.id}`}
              />
            ))}
            {mounted && segments.length === 0 && (
              <TreeChild label="Empty" active={false} muted />
            )}
            {mounted && segments.length > 0 && (
              <TreeChild label="See More" href="/segments" active={false} muted />
            )}
          </SidebarGroup>
          )}

          {isFeatureEnabled("knowledge") && <NavItem icon={KnowledgeIcon} label="Knowledge" active={activePage === "knowledge"} href="/knowledge" dataTour="tour-nav-knowledge" />}

          <SectionLabel>Run</SectionLabel>

          {isFeatureEnabled("voice-campaigns") && (
          <NavItem
            icon={Megaphone}
            label="Campaigns"
            href="/voice-campaigns"
            active={activePage === "campaigns"}
            dataTour="tour-nav-campaigns"
          />
          )}
          {isFeatureEnabled("voice-campaigns") && (
          <NavItem
            icon={PhoneCall}
            label="Calls"
            href="/voice-campaigns/call-logs"
            active={activePage === "calls"}
            dataTour="tour-nav-calls"
          />
          )}

          <SectionLabel>Improve</SectionLabel>

          {isFeatureEnabled("voice-campaigns") && (
          <NavItem
            icon={BarChart3}
            label="Insights"
            href="/voice-campaigns/insights"
            active={activePage === "insights"}
            dataTour="tour-nav-insights"
          />
          )}
          {isFeatureEnabled("voice-campaigns") && (
          <NavItem
            icon={ClipboardCheck}
            label="Evals"
            href="/evals"
            active={activePage === "evals"}
            dataTour="tour-nav-evals"
            badge="BETA"
          />
          )}

          <SectionLabel>Integrations</SectionLabel>

          <NavItem
            icon={Plug}
            label="Integrations"
            href="/settings/connections"
            active={activePage === "integrations"}
            dataTour="tour-nav-integrations"
          />
        </nav>

        {/* Footer */}
        <div className="mt-auto border-t border-sidebar-border px-3 py-3">
          <NavItem
            icon={Settings2}
            label="Settings"
            active={activePage === "settings"}
            href="/settings/access"
            dataTour="tour-nav-settings"
          />

          {/* Opens the "Get Started" choice modal: watch the video or take the guided tour. */}
          <NavItem
            icon={MonitorPlay}
            label="Walkthrough"
            shiny
            onClick={() => window.dispatchEvent(new Event(OPEN_GET_STARTED_EVENT))}
          />

          <SyncStatusIndicator />

          {/* Account */}
          <div>
            <button
              onClick={toggleAccountPopover}
              className="w-full flex items-center gap-3 px-2.5 py-2.5 rounded-[2px] hover:bg-sidebar-accent transition-colors text-left"
            >
              <CircleUser className="w-[16px] h-[16px] text-foreground shrink-0" strokeWidth={1.5} />
              <span className="text-[12.6px] text-foreground">Account</span>
            </button>
          </div>
        </div>
        </div>
      </aside>
      {/* Account popover (portaled to avoid sidebar overflow clip) */}
      {mounted && createPortal(
        <div
          ref={accountPopoverRef}
          className={`fixed w-64 rounded-xl border border-border bg-popover shadow-lg z-50 transition-all duration-200 origin-bottom-left ${
            accountOpen
              ? "opacity-100 scale-100 translate-y-0"
              : "opacity-0 scale-95 translate-y-1 pointer-events-none"
          }`}
          style={popoverPos ? { left: popoverPos.left, bottom: popoverPos.bottom } : { left: 0, bottom: 0 }}
        >
          {/* User info */}
          <div className="px-4 pt-4 pb-3">
            <p className="text-[12.6px] font-medium text-foreground">{displayName}</p>
            <p className="text-[12.6px] text-muted-foreground">{displayEmail}</p>
          </div>

          <div className="mx-3 border-t border-border" />

          {/* Links */}
          <div className="py-1.5 px-1.5">
            <AccountPopoverItem icon={Receipt} label="Billing & Usage" onClick={() => { setAccountOpen(false); router.push("/billing"); }} />
            <AccountPopoverItem icon={ShieldCheck} label="Admin" onClick={() => { setAccountOpen(false); router.push("/settings/access"); }} />
            <AccountPopoverItem icon={Plug} label="Integrations" onClick={() => { setAccountOpen(false); router.push("/settings/connections"); }} />
            <AccountPopoverItem icon={Bug} label="Report a Bug" onClick={handleOpenBugModal} />
          </div>

          <div className="mx-3 border-t border-border" />

          <div className="py-1.5 px-1.5">
            <SignOutButton redirectUrl="/auth">
              <AccountPopoverItem icon={LogOut} label="Log Out" onClick={() => setAccountOpen(false)} />
            </SignOutButton>
          </div>
        </div>,
        document.body
      )}

      {/* Search modal */}
      {searchOpen && (
        <SearchModal
          chats={chats}
          folders={folders}
          activeMessages={activeMessages}
          activeId={activeId}
          onSelect={(id) => { onSelect(id); setSearchOpen(false); }}
          onClose={() => setSearchOpen(false)}
        />
      )}

      {/* Bug report modal */}
      <BugReportModal
        open={bugModalOpen}
        onClose={() => setBugModalOpen(false)}
        pageUrl={bugPageUrl}
      />
    </TooltipProvider>
  );
}

// ── Nav Item ──

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2.5 pb-1 pt-5 text-[9px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
      {children}
    </div>
  );
}

// ── Flat sidebar navigation row ──

function SidebarGroup({
  icon: Icon,
  label,
  href,
  headerAction,
  dataTour,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  href?: string;
  defaultOpen?: boolean;
  activePage?: string;
  children: React.ReactNode;
  headerAction?: React.ReactNode;
  dataTour?: string;
}) {
  const pathname = usePathname();
  const destination = href ?? "/";
  const active = destination === "/"
    ? pathname === "/"
    : pathname === destination || pathname.startsWith(`${destination}/`);

  return (
    <Link
      href={destination}
      data-tour={dataTour}
      className={`group/nav-row flex w-full items-center gap-3 rounded-none px-2.5 py-2.5 text-left transition-colors ${
        active ? "bg-[#deded8] font-semibold text-foreground" : "text-foreground hover:bg-sidebar-accent"
      }`}
    >
      <Icon className="h-[16px] w-[16px] shrink-0 text-muted-foreground" strokeWidth={1.5} />
      <span className="min-w-0 flex-1 truncate text-[12.6px]">{label}</span>
      {headerAction && (
        <span className="shrink-0 opacity-0 transition-opacity group-hover/nav-row:opacity-100">
          {headerAction}
        </span>
      )}
    </Link>
  );
}

// ── Tree child item with horizontal connector line ──

function TreeChild({
  label,
  href,
  active,
  onClick,
  muted,
}: {
  label: string;
  href?: string;
  active?: boolean;
  onClick?: () => void;
  muted?: boolean;
}) {
  const className = `relative flex items-center pl-4 py-1.5 text-[12.6px] transition-colors truncate ${
    muted
      ? "text-muted-foreground/60 hover:text-muted-foreground cursor-pointer"
      : active
        ? "text-foreground font-medium cursor-pointer"
        : "text-muted-foreground hover:text-foreground cursor-pointer"
  }`;

  // Horizontal connector line
  const connector = (
    <span
      className="absolute left-0 top-1/2 w-3 border-t border-border/60"
      style={{ transform: "translateY(-0.5px)" }}
    />
  );

  if (href) {
    return (
      <Link href={href} className={className}>
        {connector}
        <span className="truncate">{label}</span>
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={`${className} w-full text-left`}>
      {connector}
      <span className="truncate">{label}</span>
    </button>
  );
}

// ── Folder as a nested tree item inside All Chats ──


function FolderTreeItem({
  folder,
  chats,
  activeId,
  onSelect,
  onRename,
  onDelete,
  folders,
  chatActions,
  processingChatId,
}: {
  folder: import("@/lib/folder-store").Folder;
  chats: import("@/lib/conversation-types").ConversationSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onRename: (folderId: string, name: string) => void;
  onDelete: (folderId: string) => void;
  folders: import("@/lib/folder-store").Folder[];
  processingChatId?: string | null;
  chatActions: {
    onAddToFolder: (chatId: string, folderId: string) => void;
    onRemoveFromFolder: (chatId: string) => void;
    onCreateFolderAndAdd: (chatId: string, folderName: string) => void;
    onConvertToPlaybook: (chatId: string) => void;
    onDeleteChat: (chatId: string) => void;
  };
}) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState(folder.name);
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) renameRef.current?.focus();
  }, [renaming]);

  return (
    <div className="group/folder">
      {/* Folder header row */}
      <div className="relative flex items-center pl-4 py-1.5">
        {/* Horizontal connector — on the row, not the wrapper */}
        <span
          className="absolute left-0 top-1/2 w-3 border-t border-border/60"
          style={{ transform: "translateY(-0.5px)" }}
        />
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 flex-1 min-w-0 text-left text-[12.6px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronRight className={`w-3 h-3 shrink-0 transition-transform duration-150 ${open ? "rotate-90" : ""}`} />
          {renaming ? (
            <input
              ref={renameRef}
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onBlur={() => {
                setRenaming(false);
                if (renameDraft.trim() && renameDraft.trim() !== folder.name) onRename(folder.id, renameDraft.trim());
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.currentTarget.blur(); }
                if (e.key === "Escape") { setRenameDraft(folder.name); setRenaming(false); }
              }}
              onClick={(e) => e.stopPropagation()}
              className="text-[12.6px] bg-transparent outline-none border-b border-foreground/30 text-foreground w-full"
            />
          ) : (
            <span className="truncate">{folder.name}</span>
          )}
        </button>
        {/* Hover actions */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover/folder:opacity-100 transition-opacity shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); setRenameDraft(folder.name); setRenaming(true); }}
            className="p-0.5 rounded text-muted-foreground/50 hover:text-muted-foreground"
            title="Rename"
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(folder.id); }}
            className="p-0.5 rounded text-muted-foreground/50 hover:text-muted-foreground"
            title="Delete folder"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
      {/* Nested children */}
      {open && chats.length > 0 && chats.map((chat) => {
        const isFoldActive = chat.id === activeId;
        const isFoldStreaming = processingChatId === chat.id;
        return (
        <div key={chat.id} className="relative group/foldchat flex items-center ml-7">
          <button
            onClick={() => onSelect(chat.id)}
            className={`flex-1 min-w-0 pl-1 py-1 text-[10.8px] text-left truncate transition-colors cursor-pointer ${
              isFoldActive ? "text-foreground font-medium" : "text-muted-foreground/70 hover:text-foreground"
            }`}
          >
            {chat.title}
          </button>
          {isFoldStreaming && (
            <div className="absolute right-0 top-0 bottom-0 flex items-center gap-0.5 pr-2 pl-12 chat-actions-fade">
              <Loader2 className="w-3 h-3 text-muted-foreground animate-spin shrink-0" />
            </div>
          )}
          <div className={`absolute right-0 top-0 bottom-0 flex items-center gap-0.5 pr-1 pl-12 chat-actions-fade ${isFoldStreaming ? "hidden" : "opacity-0 group-hover/foldchat:opacity-100"} transition-opacity`}>
            <div className="shrink-0 [&_button]:!opacity-100">
              <ChatContextMenu
                chatId={chat.id}
                currentFolderId={folder.id}
                folders={folders}
                onAddToFolder={chatActions.onAddToFolder}
                onRemoveFromFolder={chatActions.onRemoveFromFolder}
                onCreateFolderAndAdd={chatActions.onCreateFolderAndAdd}
                onConvertToPlaybook={chatActions.onConvertToPlaybook}
                onDelete={chatActions.onDeleteChat}
              />
            </div>
          </div>
        </div>
        );
      })}
      {open && chats.length === 0 && (
        <div className="ml-5 pl-4 py-1 text-[10.8px] text-muted-foreground/40">Empty folder</div>
      )}
    </div>
  );
}

function NavItem({
  icon: Icon,
  label,
  active,
  href,
  onClick,
  dataTour,
  shiny,
  badge,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  active?: boolean;
  href?: string;
  onClick?: () => void;
  dataTour?: string;
  shiny?: boolean;
  /** Small right-aligned status pill, e.g. "BETA". Warm rust tone to match the app's cream theme. */
  badge?: string;
}) {
  const className = `w-full flex items-center gap-3 px-2.5 py-2.5 rounded-none transition-colors text-left ${
    shiny ? "nav-shiny-row " : ""
  }${
    active
      ? "bg-[#deded8] font-semibold text-foreground"
      : "text-foreground hover:bg-sidebar-accent"
  }`;
  const children = (
    <>
      <Icon className="w-[16px] h-[16px] shrink-0 text-muted-foreground" strokeWidth={1.5} />
      <span className="text-[12.6px]">{label}</span>
      {badge && (
        <span className="ml-auto rounded-[4px] bg-[#f3e3d8] px-1.5 py-0.5 text-[9px] font-semibold uppercase leading-none tracking-wide text-[#b0491f]">
          {badge}
        </span>
      )}
    </>
  );
  if (href) {
    return <Link href={href} className={className} data-tour={dataTour}>{children}</Link>;
  }
  return (
    <button onClick={onClick} className={className} data-tour={dataTour}>
      {children}
    </button>
  );
}

// ── Account Popover Item ──

function AccountPopoverItem({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-left ${
        danger
          ? "text-foreground hover:bg-muted"
          : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06]"
      }`}
    >
      <Icon className="w-[16px] h-[16px] shrink-0" />
      <span className="text-[12.6px]">{label}</span>
    </button>
  );
}

// ── Mini Rail Icon (collapsed mode) ──

function MiniRailIcon({
  icon: Icon,
  label,
  active,
  href,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  active?: boolean;
  href?: string;
  onClick?: () => void;
}) {
  const className = `flex items-center justify-center w-10 h-10 rounded-lg transition-colors ${
    active
      ? "text-foreground bg-background"
      : "text-muted-foreground hover:text-foreground hover:bg-background"
  }`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {href ? (
          <Link href={href} className={className}>
            <Icon className="w-[16px] h-[16px]" strokeWidth={1.5} />
          </Link>
        ) : (
          <button onClick={onClick} className={className}>
            <Icon className="w-[16px] h-[16px]" strokeWidth={1.5} />
          </button>
        )}
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
