"use client";

import { useState, useRef, useEffect } from "react";
import { MoreHorizontal, FolderPlus, FolderInput, FolderMinus, Trash2, ChevronLeft, NotebookPen } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { Folder } from "@/lib/folder-store";

const ICON = "size-3.5 shrink-0";

interface ChatContextMenuProps {
  chatId: string;
  currentFolderId?: string;
  folders: Folder[];
  onAddToFolder: (chatId: string, folderId: string) => void;
  onRemoveFromFolder: (chatId: string) => void;
  onCreateFolderAndAdd: (chatId: string, folderName: string) => void;
  onConvertToPlaybook?: (chatId: string) => void;
  onDelete: (chatId: string) => void;
}

type View = "main" | "folders" | "create";

export function ChatContextMenu({
  chatId,
  currentFolderId,
  folders,
  onAddToFolder,
  onRemoveFromFolder,
  onCreateFolderAndAdd,
  onConvertToPlaybook,
  onDelete,
}: ChatContextMenuProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [view, setView] = useState<View>("main");
  const [folderName, setFolderName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const isInFolder = !!currentFolderId;
  const otherFolders = folders.filter((f) => f.id !== currentFolderId);

  useEffect(() => {
    if (view === "create") {
      // Small delay so the input is rendered before focusing
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [view]);

  const handleCreate = () => {
    const trimmed = folderName.trim();
    if (trimmed) {
      onCreateFolderAndAdd(chatId, trimmed);
    }
    setFolderName("");
    setView("main");
  };

  return (
    <>
      <DropdownMenu onOpenChange={(open) => { if (!open) { setView("main"); setFolderName(""); } }}>
        <DropdownMenuTrigger
          render={
            <button
              draggable={false}
              onDragStart={(e) => e.stopPropagation()}
              className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-muted transition-[opacity,background-color] shrink-0"
              onClick={(e) => e.stopPropagation()}
            />
          }
        >
          <MoreHorizontal className="w-3.5 h-3.5 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44 text-[11.7px] [&_[data-slot=dropdown-menu-item]]:text-[11.7px] [&_[data-slot=dropdown-menu-item]]:py-1">
          {view === "main" && (
            <>
              <DropdownMenuItem closeOnClick={false} onClick={() => setView("folders")}>
                {isInFolder ? <FolderInput className={ICON} /> : <FolderPlus className={ICON} />}
                {isInFolder ? "Move To Folder" : "Add To Folder"}
              </DropdownMenuItem>

              {isInFolder && (
                <DropdownMenuItem onClick={() => onRemoveFromFolder(chatId)}>
                  <FolderMinus className={ICON} />
                  Remove From Folder
                </DropdownMenuItem>
              )}

              {onConvertToPlaybook && (
                <DropdownMenuItem onClick={() => onConvertToPlaybook(chatId)}>
                  <NotebookPen className={ICON} />
                  Convert To Playbook
                </DropdownMenuItem>
              )}

              <DropdownMenuSeparator />

              <DropdownMenuItem
                variant="destructive"
                onClick={() => setShowDeleteConfirm(true)}
              >
                <Trash2 className={ICON} />
                Delete Chat
              </DropdownMenuItem>
            </>
          )}

          {view === "folders" && (
            <>
              <DropdownMenuItem closeOnClick={false} onClick={() => setView("main")}>
                <ChevronLeft className={ICON} />
                Back
              </DropdownMenuItem>
              <DropdownMenuSeparator />

              {otherFolders.length > 0 ? (
                <>
                  {otherFolders.map((folder) => (
                    <DropdownMenuItem
                      key={folder.id}
                      onClick={() => onAddToFolder(chatId, folder.id)}
                    >
                      {folder.name}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                </>
              ) : (
                <div className="px-2 py-1.5 text-[11.7px] text-muted-foreground">
                  No folders
                </div>
              )}

              <DropdownMenuItem closeOnClick={false} onClick={() => setView("create")}>
                <FolderPlus className={ICON} />
                Create Folder
              </DropdownMenuItem>
            </>
          )}

          {view === "create" && (
            <>
              <DropdownMenuItem closeOnClick={false} onClick={() => setView("folders")}>
                <ChevronLeft className={ICON} />
                Back
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {/* Inline folder name input */}
              <div className="px-2 py-1.5">
                <input
                  ref={inputRef}
                  type="text"
                  value={folderName}
                  onChange={(e) => setFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") handleCreate();
                    if (e.key === "Escape") { setView("folders"); setFolderName(""); }
                  }}
                  placeholder="Folder name..."
                  maxLength={50}
                  className="w-full text-[11.7px] bg-transparent border-b border-border focus:border-foreground focus:outline-none py-0.5"
                />
              </div>
              <DropdownMenuItem
                disabled={!folderName.trim()}
                closeOnClick={false}
                onClick={handleCreate}
              >
                <FolderPlus className={ICON} />
                Create & Add
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="Delete conversation"
        description="Delete this conversation? This cannot be undone."
        confirmLabel="Delete"
        onConfirm={() => onDelete(chatId)}
      />
    </>
  );
}
