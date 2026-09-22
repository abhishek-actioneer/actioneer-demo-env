"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Folder as FolderIcon, FolderOpen, ChevronRight, Plus } from "lucide-react";
import type { Folder } from "@/lib/folder-store";
import type { ConversationSummary } from "@/lib/conversation-types";
import { FolderContextMenu } from "./folder-context-menu";
import { ChatContextMenu } from "./chat-context-menu";
import { SECTION_HEADER, ITEM, PRIMARY } from "./panel-styles";

interface FolderSectionProps {
  folders: Folder[];
  chats: ConversationSummary[];
  activeId: string | null;
  onSelectChat: (id: string) => void;
  onAddToFolder: (chatId: string, folderId: string) => void;
  onRemoveFromFolder: (chatId: string) => void;
  onDeleteChat: (chatId: string) => void;
  onCreateFolder: (name: string) => void;
  onRenameFolder: (folderId: string, name: string) => void;
  onDeleteFolder: (folderId: string) => void;
  onCreateFolderAndAdd: (chatId: string, folderName: string) => void;
  onConvertToPlaybook?: (chatId: string) => void;
  draggingChatId?: string | null;
  dragSourceFolderId?: string | null;
  activeDropTargetId?: string | null;
  onDragChatStart?: (chatId: string, folderId: string) => void;
  onSetActiveDropTarget?: (id: string | null) => void;
  onDragEnd?: () => void;
}

export function FolderSection({
  folders,
  chats,
  activeId,
  onSelectChat,
  onAddToFolder,
  onRemoveFromFolder,
  onDeleteChat,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onCreateFolderAndAdd,
  onConvertToPlaybook,
  draggingChatId = null,
  dragSourceFolderId = null,
  activeDropTargetId = null,
  onDragChatStart,
  onSetActiveDropTarget,
  onDragEnd,
}: FolderSectionProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [createValue, setCreateValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);
  const didDragRef = useRef(false);
  const didDropRef = useRef(false);

  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus();
  }, [renamingId]);

  useEffect(() => {
    if (isCreating) createInputRef.current?.focus();
  }, [isCreating]);


  const toggleExpand = useCallback((folderId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }, []);

  const handleStartRename = useCallback((folderId: string) => {
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) return;
    setRenamingId(folderId);
    setRenameValue(folder.name);
  }, [folders]);

  const handleConfirmRename = useCallback(() => {
    if (renamingId && renameValue.trim()) {
      onRenameFolder(renamingId, renameValue.trim());
    }
    setRenamingId(null);
    setRenameValue("");
  }, [renamingId, renameValue, onRenameFolder]);

  const handleStartCreate = useCallback(() => {
    setIsCreating(true);
    setCreateValue("");
  }, []);

  const handleConfirmCreate = useCallback(() => {
    if (createValue.trim()) {
      onCreateFolder(createValue.trim());
    }
    setIsCreating(false);
    setCreateValue("");
  }, [createValue, onCreateFolder]);

  const chatsInFolder = useCallback((folderId: string) => {
    return chats.filter((c) => c.folderId === folderId);
  }, [chats]);

  return (
    <div>
      {/* Section header */}
      <div className="flex items-center justify-between pr-2.5">
        <p className={SECTION_HEADER}>Folders</p>
        <button
          onClick={handleStartCreate}
          className="p-0.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>

      {/* Create new folder inline input */}
      {isCreating && (
        <div className="px-2.5 py-1">
          <div className="flex items-center gap-2">
            <FolderIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <input
              ref={createInputRef}
              type="text"
              value={createValue}
              onChange={(e) => setCreateValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleConfirmCreate();
                if (e.key === "Escape") {
                  setIsCreating(false);
                  setCreateValue("");
                }
              }}
              onBlur={handleConfirmCreate}
              placeholder="Folder name..."
              maxLength={50}
              className="flex-1 text-[11.7px] bg-transparent border-b border-border focus:border-foreground focus:outline-none py-0.5 min-w-0"
            />
          </div>
        </div>
      )}

      {/* Folder list */}
      {folders.map((folder) => {
        const isExpanded = expandedIds.has(folder.id);
        const isRenaming = renamingId === folder.id;
        const folderChats = chatsInFolder(folder.id);

        return (
          <div key={folder.id}>
            {/* Folder row */}
            <div
              className={`${ITEM} group cursor-pointer ${
                activeDropTargetId === folder.id && draggingChatId
                  ? "bg-muted/30 ring-1 ring-foreground/10 rounded-md"
                  : ""
              } transition-colors duration-150`}
              onMouseDown={() => {
                didDropRef.current = false;
              }}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes("application/x-actioneer-chat")) {
                  e.preventDefault();
                }
              }}
              onDragEnter={() => {
                if (draggingChatId) onSetActiveDropTarget?.(folder.id);
              }}
              onDrop={(e) => {
                e.preventDefault();
                didDropRef.current = true;
                try {
                  const data = JSON.parse(e.dataTransfer.getData("application/x-actioneer-chat"));
                  if (data.chatId && dragSourceFolderId !== folder.id) {
                    onAddToFolder(data.chatId, folder.id);
                  }
                } catch {
                  // ignore
                }
                onDragEnd?.();
              }}
              onClick={() => {
                if (didDropRef.current) {
                  didDropRef.current = false;
                  return;
                }
                toggleExpand(folder.id);
              }}
            >
              <ChevronRight
                className={`w-3 h-3 text-muted-foreground shrink-0 transition-transform duration-200 ${
                  isExpanded ? "rotate-90" : ""
                }`}
              />
              {isExpanded ? (
                <FolderOpen className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              ) : (
                <FolderIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              )}

              {isRenaming ? (
                <input
                  ref={renameInputRef}
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleConfirmRename();
                    if (e.key === "Escape") {
                      setRenamingId(null);
                      setRenameValue("");
                    }
                  }}
                  onBlur={handleConfirmRename}
                  onClick={(e) => e.stopPropagation()}
                  maxLength={50}
                  className="flex-1 text-[11.7px] bg-transparent border-b border-border focus:border-foreground focus:outline-none py-0 min-w-0"
                />
              ) : (
                <span className="text-[11.7px] text-foreground truncate flex-1">
                  {folder.name}
                </span>
              )}

              <span className="text-[9.9px] text-muted-foreground shrink-0">
                {folderChats.length}
              </span>

              <FolderContextMenu
                folderId={folder.id}
                folderName={folder.name}
                onRename={handleStartRename}
                onDelete={onDeleteFolder}
              />
            </div>

            {/* Expanded folder contents */}
            <div
              className="grid transition-[grid-template-rows] duration-300 ease-out"
              style={{ gridTemplateRows: isExpanded ? "1fr" : "0fr" }}
            >
              <div className="overflow-hidden">
                {folderChats.length === 0 ? (
                  <p className="text-[9.9px] text-muted-foreground pl-10 py-1.5">
                    No chats
                  </p>
                ) : (
                  folderChats.map((chat) => (
                    <div
                      key={chat.id}
                      draggable={!renamingId && !isCreating}
                      onMouseDown={() => {
                        didDragRef.current = false;
                      }}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("application/x-actioneer-chat", JSON.stringify({ chatId: chat.id }));
                        e.dataTransfer.setData("text/plain", chat.id);
                        e.dataTransfer.effectAllowed = "move";
                        didDragRef.current = true;
                        onDragChatStart?.(chat.id, folder.id);
                      }}
                      onDragEnd={() => onDragEnd?.()}
                      className={`${ITEM} group pl-10 ${
                        chat.id === activeId ? "bg-muted" : ""
                      } ${draggingChatId === chat.id ? "opacity-50" : ""}`}
                      onClick={() => {
                        if (didDragRef.current) {
                          didDragRef.current = false;
                          return;
                        }
                        onSelectChat(chat.id);
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <p className={PRIMARY}>{chat.title}</p>
                      </div>
                      <ChatContextMenu
                        chatId={chat.id}
                        currentFolderId={folder.id}
                        folders={folders}
                        onAddToFolder={onAddToFolder}
                        onRemoveFromFolder={onRemoveFromFolder}
                        onCreateFolderAndAdd={onCreateFolderAndAdd}
                        onConvertToPlaybook={onConvertToPlaybook}
                        onDelete={onDeleteChat}
                      />
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        );
      })}

      {/* Empty state — only show if no folders and not creating */}
      {folders.length === 0 && !isCreating && (
        <p className="text-[9.9px] text-muted-foreground px-2.5 py-1.5">
          No folders yet
        </p>
      )}
    </div>
  );
}
