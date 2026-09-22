"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronLeft, MessageSquare, LayoutDashboard, Plus, X } from "lucide-react";
import { SentinelLogo } from "@/components/ui/sentinel-logo";
import { useChatPanel } from "@/components/chat/chat-panel-provider";
import { useChatState } from "@/components/chat/chat-state-provider";
import { ChatThread } from "@/components/chat/chat-thread";
import { ChatInput } from "@/components/chat/chat-input";
import { useSidebarContext } from "@/components/sidebar-context";
import { getBoardCards, getBoard } from "@/lib/board-store";
import type { PageContext } from "@/lib/page-context";
// buildActionsForContext removed — empty state now shows recent threads
import type { CardComment } from "@/lib/board-types";

// ── Unified Right Panel ──

const DEFAULT_WIDTH = 400;
const MIN_WIDTH = 340;
const MAX_WIDTH = 700;

export function ChatPanel() {
  const {
    isOpen, close, pageContext,
    detailContent, hasDetailContent,
    detailHeaderHidden,
    rightPanelMode, setRightPanelMode,
  } = useChatPanel();
  const chat = useChatState();

  // ── Resize state ──
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      startX.current = e.clientX;
      startWidth.current = width;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [width]
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = startX.current - e.clientX;
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth.current + delta)));
    };
    const handleMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isWizardActive = searchParams.get("wizard") === "true";
  const { activeBoardId } = useSidebarContext();
  const isCanvasPage = pathname?.startsWith("/canvas");
  const hasBoardMode = isCanvasPage && !!activeBoardId;

  // Board view mode: "chat" | "board" (canvas only)
  const [boardViewMode, setBoardViewMode] = useState<"chat" | "board">("chat");

  // Reset board view mode when leaving canvas
  useEffect(() => {
    if (!isCanvasPage) setBoardViewMode("chat");
  }, [isCanvasPage]);

  if (!isOpen) return null;

  const showChat = rightPanelMode === "chat" || !hasDetailContent;
  const showBoardLog = hasBoardMode && boardViewMode === "board";
  const hasMessages = chat.messages.length > 0;
  const showHeader = showChat || !detailHeaderHidden;

  return (
    <div
      className="relative shrink-0 bg-background flex flex-col h-full animate-in slide-in-from-right-4 duration-200"
      style={{ width }}
    >
      {/* Drag handle */}
      <div
        onMouseDown={handleMouseDown}
        className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-foreground/10 active:bg-foreground/20 transition-colors z-10"
      >
        <div className="absolute inset-y-0 -left-1 -right-1" />
      </div>

      {/* Header */}
      {showHeader ? (
        <div className={`flex justify-between px-5 border-b border-border shrink-0 ${hasDetailContent && !showChat ? "items-start py-4" : "items-center py-2.5"}`}>
          <div className="min-w-0 flex-1">
            {hasDetailContent ? (
              /* Title-first: entity name + description as header */
              showChat ? (
                <button
                  onClick={() => setRightPanelMode("detail")}
                  className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors shrink-0"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span className="text-xs font-medium">Back</span>
                </button>
              ) : (
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold leading-snug truncate min-w-0 flex-1">
                      {pageContext.entity?.name ?? pageContext.pageLabel}
                    </h2>
                    <button
                      onClick={() => setRightPanelMode("chat")}
                      className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                      title="Ask Actioneer"
                    >
                      <SentinelLogo size={15} />
                    </button>
                  </div>
                  {pageContext.entity?.summary && (
                    <p className="text-[9.9px] text-muted-foreground mt-0.5 truncate">
                      {pageContext.entity.summary}
                    </p>
                  )}
                </div>
              )
            ) : (
              <span className="text-sm font-semibold ml-1">Chat</span>
            )}
          </div>
          <div className="flex items-center shrink-0 gap-2">
            {showChat && (
              <button
                onClick={() => chat.setMessages([])}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                aria-label="New thread"
              >
                <Plus className="w-3.5 h-3.5" />
                <span className="text-[9.9px] font-medium">New</span>
              </button>
            )}
            {/* Close button — hidden during active wizard creation */}
            {!isWizardActive && (
              <button
                onClick={close}
                className="p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                aria-label="Close panel"
                title="Close panel"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      ) : null}

      {/* Content area */}
      {showBoardLog ? (
        <BoardChatView boardId={activeBoardId!} />
      ) : showChat ? (
        <ChatContent
          chat={chat}
          pageContext={pageContext}
          hasMessages={hasMessages}

        />
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          {detailContent}
        </div>
      )}
    </div>
  );
}

// ── Chat content (messages or empty state + input) ──

function ChatContent({
  chat,
  pageContext,
  hasMessages,
}: {
  chat: ReturnType<typeof useChatState>;
  pageContext: PageContext;
  hasMessages: boolean;
}) {
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const handleSidebarSend = useCallback(
    (
      text: string,
      entityContext?: Parameters<typeof chat.handleSend>[1],
      contextRefs?: Parameters<typeof chat.handleSend>[2],
      silentContext?: Parameters<typeof chat.handleSend>[3],
    ) => {
      chat.handleSend(text, entityContext, contextRefs, silentContext, { forceMode: "quick" });
    },
    [chat],
  );

  const inputBlock = (
    <div className="shrink-0 border-t border-border px-3 pb-3 pt-2">
      <ChatInput
        ref={chat.chatInputRef}
        onSend={handleSidebarSend}
        onStop={chat.handleStop}
        deepResearch={false}
        onToggleDeepResearch={() => {}}
        isProcessing={chat.isProcessing}
        entityCatalog={chat.entityCatalog}
        runCatalog={chat.runCatalog}
        dropUp
        hideDeepResearchToggle
        compactChrome
        contextBadge={
          pageContext.entity
            ? { label: pageContext.entity.name, sublabel: pageContext.pageLabel }
            : undefined
        }
        pendingPrompt={pendingPrompt}
        onPendingPromptConsumed={() => setPendingPrompt(null)}
      />
    </div>
  );

  if (hasMessages) {
    return (
      <>
        <div className="flex-1 overflow-hidden relative">
          <ChatThread
            hideMinimap
            compact
            onAddToFollowUp={(text) => {
              chat.chatInputRef.current?.setQuotedContext(text);
            }}
            onAddToKnowledge={(text) => {
              chat.handleSaveToKnowledge(text, "global");
            }}
          />
        </div>
        {inputBlock}
      </>
    );
  }

  return (
    <>
      <EmptyState
        pageContext={pageContext}
        onSuggest={(text) => setPendingPrompt(text)}
      />
      {inputBlock}
    </>
  );
}

// ── Empty state ──

function EmptyState({
  pageContext: _pageContext,
  onSuggest: _onSuggest,
}: {
  pageContext: PageContext;
  onSuggest: (text: string) => void;
}) {
  const { chats, onSelect } = useSidebarContext();
  const recentChats = chats.slice(0, 3);

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 min-h-0">
      <SentinelLogo size={40} className="mb-4" />
      <h3 className="text-lg font-semibold text-foreground">Actioneer</h3>
      <p className="text-sm text-muted-foreground/60 mt-1.5 text-center leading-relaxed">
        Ask about this page or your data.
      </p>

      {/* Recent threads */}
      {recentChats.length > 0 && (
        <div className="w-full mt-8 pt-5 border-t border-border space-y-0.5">
          <p className="text-[9.9px] text-muted-foreground/50 uppercase tracking-wider px-3 mb-2">Recent threads</p>
          {recentChats.map((chat) => (
            <button
              key={chat.id}
              onClick={() => onSelect(chat.id)}
              className="group w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-[11.7px] text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors text-left"
            >
              <MessageSquare className="w-3.5 h-3.5 shrink-0 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
              <span className="truncate">{chat.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Board comments view (canvas mode) ──

interface CommentEntry {
  cardId: string;
  cardTitle: string;
  cardType: string;
  comment: CardComment;
}

function BoardChatView({ boardId }: { boardId: string }) {
  const board = getBoard(boardId);
  const cards = getBoardCards(boardId);

  // Flatten all comments across cards, sorted by timestamp ascending
  const entries: CommentEntry[] = [];
  for (const card of cards) {
    for (const comment of card.comments) {
      entries.push({
        cardId: card.id,
        cardTitle: card.title,
        cardType: card.type,
        comment,
      });
    }
  }
  entries.sort((a, b) =>
    a.comment.timestamp.localeCompare(b.comment.timestamp)
  );

  const hasComments = entries.length > 0;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Board name header */}
      {board && (
        <div className="px-4 py-2.5 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <LayoutDashboard className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <p className="text-[10.8px] font-medium text-foreground truncate">{board.name}</p>
            <span className="text-[9.9px] text-muted-foreground/60 shrink-0">
              {cards.length} card{cards.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
      )}

      {/* Comment log */}
      <div className="flex-1 overflow-y-auto min-h-0 px-3 py-3 space-y-1">
        {hasComments ? (
          entries.map((entry) => (
            <BoardCommentRow key={entry.comment.id} entry={entry} />
          ))
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <MessageSquare className="w-8 h-8 text-muted-foreground/20 mb-3" />
            <p className="text-[11.7px] font-medium text-muted-foreground/60">No comments yet</p>
            <p className="text-[10.8px] text-muted-foreground/40 mt-1 leading-relaxed max-w-[200px]">
              Comments added to cards on this board will appear here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function BoardCommentRow({ entry }: { entry: CommentEntry }) {
  const isUser = entry.comment.author === "user";
  const time = new Date(entry.comment.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="group py-2 px-2 rounded-md hover:bg-muted/40 transition-colors">
      {/* Card label */}
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[9px] font-medium text-muted-foreground/50 uppercase tracking-wide truncate max-w-[160px]">
          {entry.cardTitle}
        </span>
        <span className="text-[9px] text-muted-foreground/30 shrink-0">{time}</span>
      </div>
      {/* Comment content */}
      <p
        className={`text-[10.8px] leading-relaxed ${
          isUser ? "text-foreground" : "text-muted-foreground"
        }`}
      >
        {entry.comment.content}
      </p>
    </div>
  );
}
