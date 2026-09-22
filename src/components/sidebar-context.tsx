"use client";

import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import { getConversationSummaries } from "@/lib/conversation-store";
import type { Segment, SegmentDisplay } from "@/lib/types";
import type { SavedFunnel } from "@/lib/funnel-types";
import type { SavedRetention } from "@/lib/retention-types";
import { getFolders, type Folder } from "@/lib/folder-store";
import { useDataset } from "@/lib/dataset-context";
import type { BoardSummary } from "@/lib/board-types";
import { getBoardSummaries } from "@/lib/board-store";
import type { VoiceCampaign } from "@/lib/voice-campaign-types";

export interface ChatEntry {
  id: string;
  title: string;
  folderId?: string;
}

interface SidebarContextValue {
  chats: ChatEntry[];
  activeId: string | null;
  onNewChat: () => void;
  onSelect: (id: string) => void;
  onSearchClick?: () => void;
  setChats: (chats: ChatEntry[]) => void;
  setActiveId: (id: string | null) => void;
  setOnNewChat: (fn: () => void) => void;
  setOnSelect: (fn: (id: string) => void) => void;
  setOnSearchClick: (fn: (() => void) | undefined) => void;
  refreshChats: () => Promise<void>;
  segments: SegmentDisplay[];
  refreshSegments: () => Promise<void>;
  funnels: SavedFunnel[];
  refreshFunnels: () => Promise<void>;
  retentions: SavedRetention[];
  refreshRetentions: () => Promise<void>;
  voiceCampaigns: VoiceCampaign[];
  refreshVoiceCampaigns: () => Promise<void>;
  playbookVersion: number;
  notifyPlaybookSaved: () => void;
  canvasVersion: number;
  notifyCanvasChanged: () => void;
  boards: BoardSummary[];
  activeBoardId: string | null;
  setActiveBoardId: (id: string | null) => void;
  refreshBoards: () => void;
  boardVersion: number;
  notifyBoardChanged: () => void;
  creditVersion: number;
  notifyCreditChanged: () => void;
  folders: Folder[];
  refreshFolders: () => void;
  folderVersion: number;
  notifyFolderChanged: () => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  activeMessages: import("@/lib/types").ChatMessage[];
  setActiveMessages: (msgs: import("@/lib/types").ChatMessage[]) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  processingChatId: string | null;
  setProcessingChatId: (id: string | null) => void;
  processingPhase: string | null;
  setProcessingPhase: (phase: string | null) => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function useSidebarContext() {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebarContext must be used within SidebarProvider");
  return ctx;
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { datasetId: currentDatasetId } = useDataset();
  const [chats, setChats] = useState<ChatEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [segments, setSegments] = useState<SegmentDisplay[]>([]);
  const [funnels, setFunnels] = useState<SavedFunnel[]>([]);
  const [retentions, setRetentions] = useState<SavedRetention[]>([]);
  const [voiceCampaigns, setVoiceCampaigns] = useState<VoiceCampaign[]>([]);
  const [playbookVersion, setPlaybookVersion] = useState(0);
  const [canvasVersion, setCanvasVersion] = useState(0);
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [activeBoardId, setActiveBoardId] = useState<string | null>(null);
  const [boardVersion, setBoardVersion] = useState(0);
  const [creditVersion, setCreditVersion] = useState(0);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderVersion, setFolderVersion] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeMessages, setActiveMessages] = useState<import("@/lib/types").ChatMessage[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [processingChatId, setProcessingChatId] = useState<string | null>(null);
  const [processingPhase, setProcessingPhase] = useState<string | null>(null);

  // Store callbacks in refs so we can swap them without re-rendering the whole tree
  const onNewChatRef = useRef<() => void>(() => router.push("/"));
  const onSelectRef = useRef<(id: string) => void>((id: string) => router.push(`/?conv=${id}`));
  const onSearchClickRef = useRef<(() => void) | undefined>(undefined);

  // Force re-render when refs change (only needed for the sidebar)
  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);

  const setOnNewChat = useCallback((fn: () => void) => {
    onNewChatRef.current = fn;
    bump();
  }, [bump]);

  const setOnSelect = useCallback((fn: (id: string) => void) => {
    onSelectRef.current = fn;
    bump();
  }, [bump]);

  const setOnSearchClick = useCallback((fn: (() => void) | undefined) => {
    onSearchClickRef.current = fn;
    bump();
  }, [bump]);

  function toSegmentDisplay(segment: Segment): SegmentDisplay {
    return {
      ...segment,
      description: `Segment created from chat analysis`,
      type: "dynamic",
      destinations: Object.entries(segment.pushStatus)
        .filter(([, status]) => status === "synced" || status === "pushing")
        .map(([id]) => id),
      trend: null,
      refreshStatus: "active",
      refreshLabel: "Live query",
      creator: "You",
      statusColor: "green",
      archived: false,
      refreshFrequency: "daily",
      similarSegments: [],
      totalUsers: segment.userCount,
    };
  }

  const refreshChats = useCallback(async () => {
    const summaries = await getConversationSummaries(currentDatasetId);
    setChats(summaries.map(({ id, title, folderId }) => ({ id, title, folderId })));
  }, [currentDatasetId]);

  const refreshSegments = useCallback(async () => {
    try {
      const data = await apiFetch<Segment[]>("/api/segments", {
        skipModel: true,
        datasetId: currentDatasetId,
      });
      setSegments(data.map(toSegmentDisplay));
    } catch {
      // Keep existing data on error
    }
  }, [currentDatasetId]);

  const refreshFunnels = useCallback(async () => {
    try {
      const data = await apiFetch<SavedFunnel[]>("/api/funnels", {
        skipModel: true,
        datasetId: currentDatasetId,
      });
      setFunnels(data);
    } catch {
      // Keep existing data on error
    }
  }, [currentDatasetId]);

  const refreshRetentions = useCallback(async () => {
    try {
      const data = await apiFetch<SavedRetention[]>("/api/retentions", {
        skipModel: true,
        datasetId: currentDatasetId,
      });
      setRetentions(data);
    } catch {
      // Keep existing data on error
    }
  }, [currentDatasetId]);

  const refreshVoiceCampaigns = useCallback(async () => {
    try {
      const data = await apiFetch<{ campaigns: VoiceCampaign[] }>("/api/voice-campaigns", {
        skipModel: true,
        datasetId: currentDatasetId,
      });
      setVoiceCampaigns(data.campaigns);
    } catch {
      // Keep existing data on error
    }
  }, [currentDatasetId]);

  const notifyPlaybookSaved = useCallback(() => {
    setPlaybookVersion((v) => v + 1);
  }, []);

  const notifyCanvasChanged = useCallback(() => {
    setCanvasVersion((v) => v + 1);
  }, []);

  const refreshBoards = useCallback(() => {
    setBoards(getBoardSummaries(currentDatasetId));
  }, [currentDatasetId]);

  const notifyBoardChanged = useCallback(() => {
    setBoardVersion((v) => v + 1);
  }, []);

  const notifyCreditChanged = useCallback(() => {
    setCreditVersion((v) => v + 1);
  }, []);

  const notifyFolderChanged = useCallback(() => {
    setFolderVersion((v) => v + 1);
  }, []);

  const refreshFolders = useCallback(() => {
    setFolders(getFolders(currentDatasetId));
  }, [currentDatasetId]);

  // Refresh segments when dataset changes — fetch real segments from API
  useEffect(() => {
    refreshSegments();
  }, [refreshSegments]);

  // Refresh funnels when dataset changes
  useEffect(() => {
    refreshFunnels();
  }, [refreshFunnels]);

  // Refresh retentions when dataset changes
  useEffect(() => {
    refreshRetentions();
  }, [refreshRetentions]);

  // Refresh voice campaigns on mount
  useEffect(() => {
    refreshVoiceCampaigns();
  }, [refreshVoiceCampaigns]);

  // Refresh boards when dataset or boardVersion changes
  // Guard: skip until datasetId is available (DatasetProvider sets it asynchronously)
  useEffect(() => {
    if (!currentDatasetId) return;
    refreshBoards();
  }, [currentDatasetId, refreshBoards, boardVersion]);

  // Refresh folders when dataset or folderVersion changes
  useEffect(() => {
    refreshFolders();
  }, [refreshFolders, folderVersion]);

  // Fetch chats on mount. Segments are deferred to avoid eagerly initializing
  // DuckDB on non-chat pages (DuckDB init blocks the event loop for large datasets).
  useEffect(() => {
    refreshChats();
  }, [refreshChats]);

  const onNewChat = useCallback(() => onNewChatRef.current(), []);
  const onSelect = useCallback((id: string) => onSelectRef.current(id), []);
  const onSearchClick = useCallback(() => onSearchClickRef.current?.(), []);

  return (
    <SidebarContext.Provider
      value={{
        chats,
        activeId,
        onNewChat,
        onSelect,
        onSearchClick,
        setChats,
        setActiveId,
        setOnNewChat,
        setOnSelect,
        setOnSearchClick,
        refreshChats,
        segments,
        refreshSegments,
        funnels,
        refreshFunnels,
        retentions,
        refreshRetentions,
        voiceCampaigns,
        refreshVoiceCampaigns,
        playbookVersion,
        notifyPlaybookSaved,
        canvasVersion,
        notifyCanvasChanged,
        boards,
        activeBoardId,
        setActiveBoardId,
        refreshBoards,
        boardVersion,
        notifyBoardChanged,
        creditVersion,
        notifyCreditChanged,
        folders,
        refreshFolders,
        folderVersion,
        notifyFolderChanged,
        searchOpen,
        setSearchOpen,
        activeMessages,
        setActiveMessages,
        sidebarCollapsed,
        setSidebarCollapsed,
        processingChatId,
        setProcessingChatId,
        processingPhase,
        setProcessingPhase,
      }}
    >
      {children}
    </SidebarContext.Provider>
  );
}
