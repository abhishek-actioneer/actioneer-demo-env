"use client";

import { Search, Loader2 } from "lucide-react";
import type { ChatEntry } from "@/lib/sidebar-config";
import { SECTION_HEADER, ITEM, PRIMARY, EMPTY } from "@/lib/sidebar-config";

export function HistoryPanel({
  chats,
  activeId,
  onSelect,
  onSearchClick,
  processingChatId,
}: {
  chats: ChatEntry[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onSearchClick?: () => void;
  processingChatId?: string | null;
}) {
  return (
    <>
      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <input
            type="text"
            readOnly
            onClick={onSearchClick}
            placeholder="Search..."
            className="w-full pl-7 pr-2 py-1.5 text-[11.7px] border border-border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring/20 cursor-pointer"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-1.5">
        <p className={SECTION_HEADER}>Recent</p>
        <div>
          {chats.map((chat) => (
            <a
              key={chat.id}
              href={`/?conv=${chat.id}`}
              onClick={(e) => {
                if (!e.metaKey && !e.ctrlKey) {
                  e.preventDefault();
                  onSelect(chat.id);
                }
              }}
              className={`${ITEM} ${chat.id === activeId ? "bg-muted" : ""}`}
            >
              <div className="min-w-0 flex-1">
                <p className={PRIMARY}>{chat.title}</p>
              </div>
              {processingChatId === chat.id && (
                <Loader2 className="w-3 h-3 text-muted-foreground animate-spin shrink-0" />
              )}
            </a>
          ))}
          {chats.length === 0 && <p className={EMPTY}>No chats found</p>}
        </div>
      </div>
    </>
  );
}
