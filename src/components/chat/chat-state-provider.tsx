"use client";

import {
  createContext,
  useContext,
  useRef,
  useState,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { useSidebarContext } from "@/components/sidebar-context";
import { getPageContext } from "@/lib/page-context";
import { useDataset } from "@/lib/dataset-context";
import { useModel } from "@/lib/model-context";
import { useConversation } from "@/hooks/use-conversation";
import { useAnalytics } from "@/hooks/use-analytics";
import { usePanel, type PanelState } from "@/hooks/use-panel";
import { useSegmentCreation } from "@/hooks/use-segment-creation";
import { usePlaybookCreation } from "@/hooks/use-playbook-creation";
import { useActionHandlers } from "@/hooks/use-action-handlers";
import { useVoiceAgentGeneration } from "@/hooks/use-voice-agent-generation";
import { useEntityCatalog } from "@/components/chat/entity-catalog-provider";
import { apiFetch } from "@/lib/api-client";
import { onDatasetSwitch } from "@/lib/dataset-switch";
import type { ChatMessage, FollowUpAction } from "@/lib/types";
import type { ChatInputHandle, EntityContext } from "@/components/chat/chat-input";
import type { DetectableEntity } from "@/lib/entity-types";
import type { SubagentInfo } from "@/lib/types";
import type { ChatSendOptions } from "@/lib/voice-agent-generation-types";

// ── DB health micro-hook ──

const healthCache = new Map<string, boolean>();

function useDbHealth(datasetId: string) {
  const [dbStatus, setDbStatus] = useState<"checking" | "ready" | "offline">(
    healthCache.get(datasetId) ? "ready" : "checking"
  );

  const checkHealth = useCallback(() => {
    if (healthCache.get(datasetId)) { setDbStatus("ready"); return; }
    setDbStatus("checking");
    apiFetch<{ dbReady: boolean }>(`/api/health?datasetId=${datasetId}`, { skipModel: true })
      .then((data) => {
        if (data.dbReady) healthCache.set(datasetId, true);
        setDbStatus(data.dbReady ? "ready" : "offline");
      })
      .catch(() => setDbStatus("offline"));
  }, [datasetId]);

  const [prevDataset, setPrevDataset] = useState(datasetId);
  if (prevDataset !== datasetId) {
    setPrevDataset(datasetId);
    if (healthCache.get(datasetId)) setDbStatus("ready");
    else setDbStatus("ready");
  }

  return { dbStatus, checkHealth };
}

// ── Context type ──

interface ChatStateContextValue {
  // Conversation
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  activeConvId: string | null;
  isProcessing: boolean;
  sourceCanvasItemId: string | null;
  agentMsgIdRef: React.RefObject<string>;
  messagesRef: React.RefObject<ChatMessage[]>;
  handleNewChat: () => void;
  ensureConversation: (title: string) => Promise<string>;
  saveCurrentConversation: (convId: string) => void;
  switchConversation: (id: string) => void;
  refreshChats: () => void;

  // Analytics / Send
  handleSend: (
    text: string,
    entityContext?: EntityContext,
    contextRefs?: import("./context-picker").ContextReference[],
    silentContext?: string,
    options?: ChatSendOptions,
  ) => void;
  handleStop: () => void;
  deepResearch: boolean;
  setDeepResearch: React.Dispatch<React.SetStateAction<boolean>>;
  generatedReport: string | undefined;

  // Panel
  panel: PanelState;
  setPanel: (p: PanelState) => void;
  activeCitation: string | null;
  handleViewTask: () => void;
  handleSubagentClick: (id: string) => void;
  handleClosePanel: () => void;
  handleCitationClick: (agentId: string, queryIndex: number) => void;
  sourcesAgents: SubagentInfo[];

  // Segment creation
  segmentModal: {
    open: boolean;
    sql: string;
    defaultName: string;
    userCount: number | null;
    pushTo?: string;
  } | null;
  isCreatingSegment: boolean;
  segmentToast: { name: string; id: string } | null;
  handleCreateSegment: (name: string, sql?: string, description?: string) => void;
  closeSegmentModal: () => void;
  dismissSegmentToast: () => void;

  // Follow-up / Playbook / Knowledge handlers
  handleFollowUpAction: (action: FollowUpAction) => void;
  handleSaveAsPlaybook: (userQuery: string) => void;
  handleConvertToPlaybook: (userQuery: string) => void;
  handleSavePlaybookPreview: (msgId: string) => void;
  handleSaveToKnowledge: (content: string, level: "global" | "user") => Promise<void>;
  handleDismissKnowledge: (msgId: string) => void;
  handleConnectorClick: (categoryId: string) => void;
  handleProceedWithout: (originalQuery: string) => void;
  handleUploadCSV: () => void;

  // Segment confirm handlers
  handleSegmentConfirm: (msgId: string, name: string) => void;
  handleSegmentCancel: (msgId: string) => void;
  handleSegmentRefine: (msgId: string, newDescription: string) => void;
  handleSegmentVoiceCampaign: (msgId: string) => void;

  // Funnel confirm handlers
  handleFunnelConfirm: (msgId: string, name: string) => void;
  handleFunnelCancel: (msgId: string) => void;
  handleFunnelRefine: (msgId: string, newDescription: string) => void;

  // Retention confirm handlers
  handleRetentionConfirm: (msgId: string, name: string) => void;
  handleRetentionCancel: (msgId: string) => void;
  handleRetentionRefine: (msgId: string, newDescription: string) => void;

  // Board from research
  handleSaveAsBoard: (userQuery: string) => void;
  isSavingBoard: boolean;

  // Metric update handlers
  handleMetricUpdatePublish: (msgId: string) => void;
  handleMetricUpdateDismiss: (msgId: string) => void;

  // Policy confirm handlers
  handlePolicyConfirm: (msgId: string) => void;
  handlePolicyCancel: (msgId: string) => void;

  // Policy creation context ref (for follow-up handling)
  policyContextRef: React.MutableRefObject<{
    tableNames: string[];
    description: string;
    conversationHistory: { role: string; content: string }[];
  } | null>;

  // Campaign draft handlers
  handleCampaignFire: (msgId: string, edited: { subject: string; body: string; senderName?: string }) => void;
  handleCampaignCancel: (msgId: string) => void;
  handleCampaignRefine: (msgId: string, refineIntent: string) => void;

  // Entities
  entityCatalog: DetectableEntity[];
  runCatalog: DetectableEntity[];
  entityLookup: Map<string, DetectableEntity>;
  handleEntityClick: (entity: DetectableEntity) => void;

  // Refs
  chatInputRef: React.RefObject<ChatInputHandle | null>;
  liveResponseIds: React.MutableRefObject<Set<string>>;

  // Page entity (set by detail pages via ChatPanelProvider)
  pageEntity: { id: string; name: string; type: string; summary?: string; contextPayload?: Record<string, unknown> } | undefined;
  setPageEntity: (e: { id: string; name: string; type: string; summary?: string; contextPayload?: Record<string, unknown> } | undefined) => void;

  // DB
  dbStatus: "checking" | "ready" | "offline";
  checkHealth: () => void;
}

const ChatStateContext = createContext<ChatStateContextValue | null>(null);

// ── Provider ──

export function ChatStateProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { notifyCreditChanged, setProcessingPhase, segments, refreshVoiceCampaigns } = useSidebarContext();
  const { datasetId, dataset } = useDataset();
  useModel(); // sync module-level model state for apiFetch
  const pageContextLabel = useMemo(() => getPageContext(pathname).pageLabel, [pathname]);
  const [pageEntity, setPageEntity] = useState<{ id: string; name: string; type: string; summary?: string; contextPayload?: Record<string, unknown> } | undefined>();

  // Reset entity on pathname change
  const prevPathForEntity = useRef(pathname);
  if (prevPathForEntity.current !== pathname) {
    prevPathForEntity.current = pathname;
    if (pageEntity) setPageEntity(undefined);
  }

  const chatInputRef = useRef<ChatInputHandle | null>(null);
  const liveResponseIds = useRef<Set<string>>(new Set());
  const policyContextRef = useRef<{
    tableNames: string[];
    description: string;
    conversationHistory: { role: string; content: string }[];
  } | null>(null);

  // Panel ref for onSwitch callback (breaks circular dep)
  const setPanelRef = useRef<(p: PanelState) => void>(() => {});

  // ── Conversation state ──
  const {
    messages, setMessages,
    activeConvId, setActiveConvId,
    isProcessing, setIsProcessing,
    sourceCanvasItemId,
    agentMsgIdRef, messagesRef,
    handleNewChat,
    ensureConversation,
    saveCurrentConversation,
    switchConversation,
    refreshChats,
  } = useConversation(() => {
    setPanelRef.current({ type: "closed" });
  });

  // ── Panel state ──
  const {
    panel, setPanel, activeCitation,
    handleViewTask, handleSubagentClick, handleClosePanel, handleCitationClick,
    sourcesAgents,
  } = usePanel(messages, agentMsgIdRef);
  setPanelRef.current = setPanel;

  // ── Segment creation ──
  const {
    segmentModal, isCreatingSegment, segmentToast,
    openSegmentModal, handleCreateSegment,
    closeSegmentModal, dismissSegmentToast,
  } = useSegmentCreation(activeConvId);

  // ── Playbook creation ──
  const {
    handlePlaybookCreate, handleProceedWithout,
    handleConnectorClick, handleUploadCSV,
  } = usePlaybookCreation({
    messages, setMessages,
    activeConvId, setActiveConvId,
    isProcessing, setIsProcessing,
    refreshChats, datasetId,
  });

  // ── Policy creation (defined before useAnalytics to avoid circular deps) ──
  const handlePolicyCreate = useCallback(
    async (description: string) => {
      const msgId = crypto.randomUUID();

      // Show loading card immediately (empty tables = loading state)
      setMessages((prev) => [
        ...prev,
        {
          id: msgId,
          role: "sentinel" as const,
          content: "",
          timestamp: Date.now(),
          variant: "policy-table-select" as const,
          policyTableSelect: {
            tables: [],
            recommendedTables: [],
            description,
            status: "pending" as const,
          },
        },
      ]);

      // Fetch available tables
      let tables: string[] = [];
      try {
        const data = await apiFetch<{ tables: string[] }>("/api/schema/tables", { skipModel: true });
        tables = (data.tables ?? []).filter((t: string) => !t.startsWith("sentinel_"));
      } catch {
        tables = [];
      }

      // Ask LLM to pick the most relevant tables — run in parallel with showing all tables
      let recommendedTables: string[] = [];
      const recommendPromise = apiFetch<{ tables: string[] }>("/api/policies/recommend-tables", {
        method: "POST",
        body: { description, tables },
      }).then((rec) => { recommendedTables = rec.tables ?? []; }).catch(() => {});

      // Update card with all tables immediately (before LLM finishes)
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId && m.policyTableSelect
            ? { ...m, policyTableSelect: { ...m.policyTableSelect, tables } }
            : m,
        ),
      );

      // Wait for LLM recommendations, then update card with them
      await recommendPromise;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId && m.policyTableSelect
            ? { ...m, policyTableSelect: { ...m.policyTableSelect, recommendedTables } }
            : m,
        ),
      );
    },
    [setMessages],
  );

  const { generateVoiceAgent } = useVoiceAgentGeneration({
    datasetId,
    segments,
    setMessages,
    refreshVoiceCampaigns,
  });

  // ── Analytics / Send ──
  const {
    handleSend, handleStop,
    deepResearch, setDeepResearch,
    generatedReport,
  } = useAnalytics({
    messages, setMessages,
    activeConvId, setActiveConvId,
    isProcessing, setIsProcessing,
    agentMsgIdRef, messagesRef,
    refreshChats, notifyCreditChanged,
    setPanel, datasetId,
    reportMeta: dataset.reportMeta,
    handlePlaybookCreate,
    handlePolicyCreate,
    policyContextRef,
    pageContextLabel: pageEntity
      ? `${pageContextLabel}: ${pageEntity.name}${pageEntity.summary ? ` (${pageEntity.summary})` : ""}`
      : pageContextLabel,
    pageEntity,
    setProcessingPhase,
    generateVoiceAgent,
  });

  // ── DB health ──
  const { dbStatus, checkHealth } = useDbHealth(datasetId);

  // ── Dataset switch cleanup ──
  useEffect(() => {
    return onDatasetSwitch(() => {
      handleStop();
      setDeepResearch(false);
      setPanel({ type: "closed" });
      closeSegmentModal();
    });
  }, [handleStop, setDeepResearch, setPanel, closeSegmentModal]);

  // ── Entity catalog (from EntityCatalogProvider) ──
  const { entityCatalog, runCatalog, entityLookup, handleEntityClick } = useEntityCatalog();

  // ── Action handlers (extracted hook) ──
  const {
    handleFollowUpAction,
    handleSaveAsPlaybook,
    handleConvertToPlaybook,
    handleSavePlaybookPreview,
    handleSaveToKnowledge,
    handleDismissKnowledge,
    handleSegmentConfirm,
    handleSegmentCancel,
    handleSegmentRefine,
    handleSegmentVoiceCampaign,
    handleFunnelConfirm,
    handleFunnelCancel,
    handleFunnelRefine,
    handleRetentionConfirm,
    handleRetentionCancel,
    handleRetentionRefine,
    handleSaveAsBoard,
    isSavingBoard,
    handleMetricUpdatePublish,
    handleMetricUpdateDismiss,
    handlePolicyConfirm,
    handlePolicyCancel,
    handleCampaignFire,
    handleCampaignCancel,
    handleCampaignRefine,
  } = useActionHandlers({
    messages, setMessages,
    activeConvId, messagesRef, agentMsgIdRef,
    handleSend, openSegmentModal,
  });

  // ── Context value ──

  const value = useMemo<ChatStateContextValue>(
    () => ({
      messages, setMessages,
      activeConvId, isProcessing,
      sourceCanvasItemId,
      agentMsgIdRef, messagesRef,
      handleNewChat, ensureConversation, saveCurrentConversation, switchConversation, refreshChats,

      handleSend, handleStop,
      deepResearch, setDeepResearch, generatedReport,

      panel, setPanel, activeCitation,
      handleViewTask, handleSubagentClick, handleClosePanel, handleCitationClick,
      sourcesAgents,

      segmentModal, isCreatingSegment, segmentToast,
      handleCreateSegment, closeSegmentModal, dismissSegmentToast,

      handleFollowUpAction,
      handleSaveAsPlaybook, handleConvertToPlaybook, handleSavePlaybookPreview,
      handleSaveToKnowledge, handleDismissKnowledge,
      handleConnectorClick, handleProceedWithout, handleUploadCSV,

      handleSegmentConfirm, handleSegmentCancel, handleSegmentRefine, handleSegmentVoiceCampaign,

      handleFunnelConfirm, handleFunnelCancel, handleFunnelRefine,

      handleRetentionConfirm, handleRetentionCancel, handleRetentionRefine,

      handleSaveAsBoard, isSavingBoard,

      handleMetricUpdatePublish, handleMetricUpdateDismiss,

      handlePolicyConfirm, handlePolicyCancel, policyContextRef,

      handleCampaignFire, handleCampaignCancel, handleCampaignRefine,

      entityCatalog, runCatalog, entityLookup, handleEntityClick,

      chatInputRef, liveResponseIds,

      pageEntity, setPageEntity,

      dbStatus, checkHealth,
    }),
    [
      messages, activeConvId, isProcessing, sourceCanvasItemId,
      handleNewChat, ensureConversation, saveCurrentConversation, switchConversation, refreshChats,
      handleSend, handleStop, deepResearch, generatedReport,
      panel, setPanel, activeCitation,
      handleViewTask, handleSubagentClick, handleClosePanel, handleCitationClick,
      sourcesAgents,
      segmentModal, isCreatingSegment, segmentToast,
      handleCreateSegment, closeSegmentModal, dismissSegmentToast,
      handleFollowUpAction,
      handleSaveAsPlaybook, handleConvertToPlaybook, handleSavePlaybookPreview,
      handleSaveToKnowledge, handleDismissKnowledge,
      handleConnectorClick, handleProceedWithout, handleUploadCSV,
      handleSegmentConfirm, handleSegmentCancel, handleSegmentRefine, handleSegmentVoiceCampaign,
      handleFunnelConfirm, handleFunnelCancel, handleFunnelRefine,
      handleRetentionConfirm, handleRetentionCancel, handleRetentionRefine,
      handleSaveAsBoard, isSavingBoard,
      handleMetricUpdatePublish, handleMetricUpdateDismiss,
      handlePolicyConfirm, handlePolicyCancel,
      handleCampaignFire, handleCampaignCancel, handleCampaignRefine,
      entityCatalog, runCatalog, entityLookup, handleEntityClick,
      pageEntity,
      agentMsgIdRef, messagesRef, setDeepResearch, setMessages,
      dbStatus, checkHealth,
    ]
  );

  return (
    <ChatStateContext.Provider value={value}>
      {children}
    </ChatStateContext.Provider>
  );
}

export function useChatState(): ChatStateContextValue {
  const ctx = useContext(ChatStateContext);
  if (!ctx) throw new Error("useChatState must be used within ChatStateProvider");
  return ctx;
}
