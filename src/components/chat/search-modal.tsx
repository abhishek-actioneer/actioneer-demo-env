"use client";

import { SentinelLogo } from "@/components/ui/sentinel-logo";
import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { apiFetch } from "@/lib/api-client";
import { Search, X, Loader2, Maximize2, Minimize2 } from "lucide-react";
import { MarkdownContent } from "@/lib/markdown";
import type { ChatEntry } from "@/components/sidebar-context";
import type { ChatMessage } from "@/lib/types";
import type { Folder } from "@/lib/folder-store";
import { getConversation } from "@/lib/conversation-store";

interface SearchModalProps {
  chats: ChatEntry[];
  folders?: Folder[];
  activeMessages?: ChatMessage[];
  activeId?: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}

/* ── Shared tokens ── */
const TEXT_SM = "text-[11.7px]";
const TEXT_XS = "text-[9.9px]";
const TEXT_MUTED = "text-muted-foreground";
const SECTION_HEADER = "text-[9.9px] font-semibold text-muted-foreground/70 uppercase tracking-wider px-3 pt-3 pb-1.5";
const PANEL_PADDING = "px-2";
const EMPTY = `${TEXT_SM} ${TEXT_MUTED} text-center py-12`;

/* ── Helpers ── */

function getTimeGroup(index: number): string {
  if (index < 2) return "Yesterday";
  if (index < 5) return "Last 7 Days";
  return "Older";
}

function groupChats(chats: ChatEntry[]) {
  const groups: Record<string, ChatEntry[]> = {};
  chats.forEach((chat, i) => {
    const group = getTimeGroup(i);
    if (!groups[group]) groups[group] = [];
    groups[group].push(chat);
  });
  return groups;
}

function getRelativeTime(index: number): string {
  const times = ["11h", "11h", "2d", "2d", "3d", "5d", "5d", "6d"];
  return times[index % times.length];
}

/* ── Keyboard shortcut badge ── */
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center h-5 min-w-5 px-1 rounded border border-border bg-muted/50 text-[9px] text-muted-foreground font-mono">
      {children}
    </kbd>
  );
}

export function SearchModal({ chats, folders, activeMessages, activeId, onSelect, onClose }: SearchModalProps) {
  const [search, setSearch] = useState("");
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(chats[0]?.id ?? null);
  const [previewMessages, setPreviewMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const cacheRef = useRef<Record<string, ChatMessage[]>>({});

  // Build folder name lookup
  const folderLookup = useMemo(() => {
    const map = new Map<string, string>();
    if (folders) {
      for (const f of folders) {
        map.set(f.id, f.name);
      }
    }
    return map;
  }, [folders]);

  const filtered = useMemo(() => {
    let items = chats;
    if (selectedFolderId) {
      items = items.filter((c) => c.folderId === selectedFolderId);
    }
    if (search) {
      const q = search.toLowerCase();
      items = items.filter((c) => c.title.toLowerCase().includes(q));
    }
    return items;
  }, [chats, search, selectedFolderId]);

  const grouped = useMemo(() => groupChats(filtered), [filtered]);
  const flatIds = useMemo(() => filtered.map((c) => c.id), [filtered]);

  // Single keyboard handler for all keys
  const hoveredIdRef = useRef(hoveredId);
  hoveredIdRef.current = hoveredId;

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "Enter" && hoveredIdRef.current) {
        e.preventDefault();
        onSelect(hoveredIdRef.current);
        onClose();
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setHoveredId((prev) => {
          const idx = prev ? flatIds.indexOf(prev) : -1;
          if (e.key === "ArrowDown") {
            return flatIds[idx < flatIds.length - 1 ? idx + 1 : 0] ?? prev;
          }
          return flatIds[idx > 0 ? idx - 1 : flatIds.length - 1] ?? prev;
        });
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose, onSelect, flatIds]);

  // Scroll hovered item into view on keyboard navigation
  useEffect(() => {
    if (!hoveredId) return;
    const el = document.querySelector(`[data-chat-id="${CSS.escape(hoveredId)}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [hoveredId]);

  // Fetch messages for hovered chat (only when expanded)
  const fetchMessages = useCallback(async (chatId: string) => {
    if (chatId === activeId && activeMessages?.length) {
      cacheRef.current[chatId] = activeMessages;
      setPreviewMessages(activeMessages);
      return;
    }

    if (cacheRef.current[chatId]) {
      setPreviewMessages(cacheRef.current[chatId]);
      return;
    }

    const stored = await getConversation(chatId);
    if (stored?.messages?.length) {
      cacheRef.current[chatId] = stored.messages;
      setPreviewMessages(stored.messages);
      return;
    }

    setLoading(true);
    setPreviewMessages([]);
    try {
      const conv = await apiFetch<{ messages?: ChatMessage[] }>(`/api/conversations/${chatId}`, { skipModel: true });
      const msgs: ChatMessage[] = conv.messages ?? [];
      cacheRef.current[chatId] = msgs;
      setPreviewMessages(msgs);
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  }, [activeId, activeMessages]);

  useEffect(() => {
    if (expanded && hoveredId) {
      fetchMessages(hoveredId);
    } else {
      setPreviewMessages([]);
    }
  }, [hoveredId, fetchMessages, expanded]);

  /* ── Thread list (shared between collapsed and expanded) ── */
  const threadList = (
    <div className={`flex-1 overflow-y-auto ${PANEL_PADDING} py-1`}>
      {Object.entries(grouped).map(([group, items]) => (
        <div key={group}>
          <p className={SECTION_HEADER}>{group}</p>
          {items.map((chat) => {
            const globalIdx = chats.findIndex((c) => c.id === chat.id);
            const folderName = chat.folderId ? folderLookup.get(chat.folderId) : undefined;
            return (
              <button
                key={chat.id}
                data-chat-id={chat.id}
                onMouseEnter={() => setHoveredId(chat.id)}
                onClick={() => {
                  onSelect(chat.id);
                  onClose();
                }}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-left transition-colors ${
                  hoveredId === chat.id
                    ? "bg-muted"
                    : "hover:bg-muted/50"
                }`}
              >
                <p className={`${TEXT_SM} text-foreground truncate flex-1`}>{chat.title}</p>
                {folderName && (
                  <span className={`${TEXT_XS} ${TEXT_MUTED} shrink-0 truncate max-w-[100px]`}>
                    {folderName}
                  </span>
                )}
                <span className={`${TEXT_XS} ${TEXT_MUTED} shrink-0 whitespace-nowrap`}>
                  {getRelativeTime(globalIdx)}
                </span>
              </button>
            );
          })}
        </div>
      ))}
      {filtered.length === 0 && (
        <p className={EMPTY}>No threads found</p>
      )}
    </div>
  );

  /* ── Footer ── */
  const footer = (
    <div className="flex items-center gap-4 px-4 py-2.5 border-t border-border shrink-0">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        title={expanded ? "Collapse" : "Expand preview"}
      >
        {expanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
      </button>
      <div className="flex-1" />
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-1.5 text-[9.9px] text-muted-foreground">
          Navigate <Kbd>↑</Kbd> <Kbd>↓</Kbd>
        </span>
        <span className="flex items-center gap-1.5 text-[9.9px] text-muted-foreground">
          Open <Kbd>↵</Kbd>
        </span>
        <span className="flex items-center gap-1.5 text-[9.9px] text-muted-foreground">
          Close <Kbd>esc</Kbd>
        </span>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]" onClick={onClose}>
      <div className="absolute inset-0 bg-background/60 backdrop-blur-md" />
      <div
        className={`relative bg-background border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden transition-[width] duration-200 ${
          expanded ? "w-[1280px] h-[72vh]" : "w-[680px] max-h-[72vh]"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Search header ── */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            autoFocus
            className={`flex-1 ${TEXT_SM} bg-transparent focus:outline-none placeholder:text-muted-foreground`}
          />
          {folders && folders.length > 0 && (
            <select
              value={selectedFolderId ?? ""}
              onChange={(e) => setSelectedFolderId(e.target.value || null)}
              className={`${TEXT_SM} bg-transparent border border-border rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring/20 text-foreground shrink-0`}
            >
              <option value="">All Chats</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          )}
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
        </div>

        {/* ── Body ── */}
        {expanded ? (
          <div className="flex flex-1 min-h-0">
            {/* Left: Thread list */}
            <div className="w-[380px] flex flex-col border-r border-border">
              {threadList}
            </div>

            {/* Right: Chat preview */}
            <div className={`flex-1 overflow-y-auto ${PANEL_PADDING} py-1`}>
              <div className="px-3 py-3 space-y-5">
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  </div>
                ) : previewMessages.length === 0 ? (
                  <p className={EMPTY}>No messages to preview</p>
                ) : (
                  previewMessages.map((msg) => {
                    if (msg.variant === "gathering" || msg.variant === "report-cta" || msg.variant === "save-as-playbook" || msg.variant === "save-to-knowledge") {
                      return null;
                    }

                    if (msg.role === "user") {
                      return (
                        <div key={msg.id} className="flex justify-end">
                          <div className={`bg-foreground text-background dark:bg-muted dark:text-foreground rounded-2xl rounded-br-md px-3 py-2 max-w-[85%] ${TEXT_SM}`}>
                            {msg.content}
                          </div>
                        </div>
                      );
                    }

                    if (msg.role === "agent") {
                      return null;
                    }

                    if (msg.role === "sentinel" && msg.content) {
                      return (
                        <div key={msg.id} className="flex gap-3">
                          <div className="shrink-0 mt-0.5">
                            <SentinelLogo size={16} variant="contained" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`${TEXT_XS} font-semibold text-foreground mb-1`}>Actioneer</p>
                            <div className={`${TEXT_SM} leading-relaxed prose prose-sm prose-neutral max-w-none [&_h1]:text-[12.6px] [&_h2]:text-[12.6px] [&_h3]:text-[12.6px] [&_h4]:text-[11.7px] [&_h1]:mt-3 [&_h2]:mt-3 [&_h3]:mt-3 [&_h1]:mb-1.5 [&_h2]:mb-1.5 [&_h3]:mb-1.5`}>
                              <MarkdownContent content={msg.content} />
                            </div>
                          </div>
                        </div>
                      );
                    }

                    return null;
                  })
                )}
              </div>
            </div>
          </div>
        ) : (
          /* ── Collapsed: just the list ── */
          <div className="flex flex-col flex-1 min-h-0">
            {threadList}
          </div>
        )}

        {/* ── Footer ── */}
        {footer}
      </div>
    </div>
  );
}
