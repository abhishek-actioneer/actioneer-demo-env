"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { getPageContext, type PageContext } from "@/lib/page-context";
import { useChatState } from "@/components/chat/chat-state-provider";
import { apiFetch } from "@/lib/api-client";
import type { ContextReference } from "@/components/chat/context-picker";

export type EntityInfo = NonNullable<PageContext["entity"]>;
export type RightPanelMode = "detail" | "chat";

interface ChatPanelState {
  /** Whether the right panel is visible at all (false on home, true on other pages when triggered) */
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  pageContext: PageContext;
  /** Detail pages call this to declare the entity they're showing */
  setEntity: (entity: EntityInfo | undefined) => void;
  /** Detail pages register their right-panel content here */
  detailContent: ReactNode;
  setDetailContent: (content: ReactNode) => void;
  /** Detail pages can hide the shared detail header when the page already has enough context */
  detailHeaderHidden: boolean;
  setDetailHeaderHidden: (hidden: boolean) => void;
  /** Which tab is active in the right panel */
  rightPanelMode: RightPanelMode;
  setRightPanelMode: (mode: RightPanelMode) => void;
  /** Whether the right panel has detail content registered (convenience) */
  hasDetailContent: boolean;
  /** Switch to a specific conversation and open the chat panel */
  loadConversation: (id: string) => void;
  /** Inject a chart context chip into the chat input and open the chat panel */
  injectChartContext: (ref: ContextReference) => void;
  /** Prefill the chat input with plain text and open the panel — used by follow-up question chips */
  injectText: (text: string, silentContext?: string, sectionId?: string) => void;
  /** Inject commentary as a quoted context bubble (like "add to follow up") and open chat panel */
  injectQuotedContext: (text: string) => void;
  /** Section ID for pin targeting — set when follow-up chip clicked from a board section */
  pinTargetSectionId: string | null;
  /** Open chat panel and append a metric-table-select card, fetching live tables from the API */
  triggerMetricTableSelect: (params: {
    metricId: string;
    metricName: string;
    description: string;
    suggestedRelatedMetrics: string[];
  }) => Promise<void>;
  /** Open chat panel and show table-select card for policy creation */
  triggerPolicyCreate: () => Promise<void>;
}

const ChatPanelContext = createContext<ChatPanelState | null>(null);

export function ChatPanelProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isHomePage = pathname === "/";
  const { messages, pageEntity, setPageEntity, switchConversation, chatInputRef, setMessages } = useChatState();

  const [isOpen, setIsOpen] = useState(false);
  const [detailContent, setDetailContentRaw] = useState<ReactNode>(null);
  const [detailHeaderHidden, setDetailHeaderHidden] = useState(false);
  const [rightPanelMode, setRightPanelMode] = useState<RightPanelMode>("detail");

  const hasDetailContent = detailContent != null;

  // Stable setter that also auto-opens the panel when detail content is first registered.
  // Only switches mode on null → non-null transition to avoid interrupting chat mode
  // when detail pages re-call setDetailContent on state updates (e.g. playbook execution).
  const setDetailContent = useCallback((content: ReactNode) => {
    setDetailContentRaw((prev) => {
      if (content != null && prev == null) {
        setIsOpen(true);
        setRightPanelMode("detail");
      }
      return content;
    });
  }, []);

  // Clear detail content and reset mode on navigation
  const prevPathRef = useRef(pathname);
  useEffect(() => {
    const wasHome = prevPathRef.current === "/";
    const prevPath = prevPathRef.current;
    prevPathRef.current = pathname;

    // Auto-open panel when navigating away from home with an active conversation
    if (wasHome && !isHomePage && messages.length > 0) {
      setIsOpen(true);
      setRightPanelMode("chat");
    }

    // Clear detail content when navigating to a different page
    if (prevPath !== pathname) {
      setDetailContentRaw(null);
      setDetailHeaderHidden(false);
    }
  }, [pathname, isHomePage, messages.length]);

  const open = useCallback(() => {
    setIsOpen(true);
    // If no detail content, always open to chat; otherwise keep current mode
    if (!detailContent) setRightPanelMode("chat");
  }, [detailContent]);

  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => {
    setIsOpen((v) => {
      if (!v && !detailContent) setRightPanelMode("chat");
      return !v;
    });
  }, [detailContent]);

  // Wrap setEntity to also sync to ChatStateProvider (for LLM prompt injection)
  const setEntity = useCallback(
    (e: EntityInfo | undefined) => setPageEntity(e),
    [setPageEntity],
  );

  const loadConversation = useCallback((id: string) => {
    switchConversation(id);
    setIsOpen(true);
    setRightPanelMode("chat");
  }, [switchConversation]);

  // Poll for chatInputRef to be populated (handles panel-not-yet-mounted case)
  const whenInputReady = useCallback((action: () => void) => {
    let attempts = 0;
    const tryAction = () => {
      if (chatInputRef.current) {
        action();
      } else if (attempts < 10) {
        attempts++;
        setTimeout(tryAction, 50);
      }
    };
    requestAnimationFrame(tryAction);
  }, [chatInputRef]);

  const injectChartContext = useCallback((ref: ContextReference) => {
    setIsOpen(true);
    setRightPanelMode("chat");
    whenInputReady(() => {
      chatInputRef.current?.addContextRef(ref);
      chatInputRef.current?.focus();
    });
  }, [chatInputRef, whenInputReady]);

  const [pinTargetSectionId, setPinTargetSectionId] = useState<string | null>(null);

  const injectText = useCallback((text: string, silentContext?: string, sectionId?: string) => {
    setIsOpen(true);
    setRightPanelMode("chat");
    if (sectionId) setPinTargetSectionId(sectionId);
    whenInputReady(() => {
      chatInputRef.current?.setValue(text);
      if (silentContext) chatInputRef.current?.setSilentContext(silentContext);
      chatInputRef.current?.focus();
    });
  }, [chatInputRef, whenInputReady]);

  const triggerMetricTableSelect = useCallback(async (params: {
    metricId: string;
    metricName: string;
    description: string;
    suggestedRelatedMetrics: string[];
  }) => {
    setIsOpen(true);
    setTimeout(() => setRightPanelMode("chat"), 0);
    let tables: string[] = [];
    try {
      const data = await apiFetch<{ tables: string[] }>("/api/schema/tables", { skipModel: true });
      tables = data.tables ?? [];
    } catch {
      tables = [];
    }
    setMessages((prev) => [
      ...prev,
      {
        id: `create-table-select-${Date.now()}`,
        role: "sentinel" as const,
        content: "",
        timestamp: Date.now(),
        variant: "metric-table-select" as const,
        metricTableSelect: {
          ...params,
          tables,
          status: "pending" as const,
        },
      },
    ]);
  }, [setMessages]);

  const triggerPolicyCreate = useCallback(async () => {
    setIsOpen(true);
    setTimeout(() => setRightPanelMode("chat"), 0);
    chatInputRef.current?.focus();
  }, [chatInputRef]);

  const injectQuotedContext = useCallback((text: string) => {
    setIsOpen(true);
    setRightPanelMode("chat");
    whenInputReady(() => {
      chatInputRef.current?.setQuotedContext(text);
      chatInputRef.current?.focus();
    });
  }, [chatInputRef, whenInputReady]);

  // Cmd+J / Ctrl+J — toggle between chat and detail modes (or open panel)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "j") {
        e.preventDefault();
        if (isHomePage) return;

        if (!isOpen) {
          setIsOpen(true);
          setRightPanelMode("chat");
        } else if (hasDetailContent) {
          // Toggle between modes
          setRightPanelMode((m) => (m === "chat" ? "detail" : "chat"));
        } else {
          setIsOpen(false);
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isHomePage, isOpen, hasDetailContent]);

  // The Ask Actioneer chat panel must not persist open across navigation — it
  // should be closed by default on every page. Detail routes (/feature/[id])
  // re-open their own right panel via setDetailContent, so leave those alone.
  useEffect(() => {
    const isDetailRoute = /^\/[^/]+\/[^/]+/.test(pathname);
    if (!isDetailRoute) setIsOpen(false);
  }, [pathname]);

  const basePageContext = useMemo(() => getPageContext(pathname), [pathname]);
  const pageContext = useMemo(
    () => (pageEntity ? { ...basePageContext, entity: pageEntity } : basePageContext),
    [basePageContext, pageEntity],
  );

  const value = useMemo(
    () => ({
      isOpen: isHomePage ? false : isOpen,
      open, close, toggle,
      pageContext, setEntity,
      detailContent, setDetailContent,
      detailHeaderHidden, setDetailHeaderHidden,
      rightPanelMode, setRightPanelMode,
      hasDetailContent,
      loadConversation,
      injectChartContext,
      injectText,
      injectQuotedContext,
      pinTargetSectionId,
      triggerMetricTableSelect,
      triggerPolicyCreate,
    }),
    [isOpen, isHomePage, open, close, toggle, pageContext, setEntity, detailContent, setDetailContent, detailHeaderHidden, rightPanelMode, hasDetailContent, loadConversation, injectChartContext, injectText, injectQuotedContext, pinTargetSectionId, triggerMetricTableSelect, triggerPolicyCreate],
  );

  return (
    <ChatPanelContext.Provider value={value}>
      {children}
    </ChatPanelContext.Provider>
  );
}

export function useChatPanel(): ChatPanelState {
  const ctx = useContext(ChatPanelContext);
  if (!ctx) throw new Error("useChatPanel must be used within ChatPanelProvider");
  return ctx;
}
