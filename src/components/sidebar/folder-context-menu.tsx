"use client";

import { useState } from "react";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const ICON = "size-3.5 shrink-0";

interface FolderContextMenuProps {
  folderId: string;
  folderName: string;
  onRename: (folderId: string) => void;
  onDelete: (folderId: string) => void;
}

export function FolderContextMenu({
  folderId,
  folderName,
  onRename,
  onDelete,
}: FolderContextMenuProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  return (
    <>
      <DropdownMenu>
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
        <DropdownMenuContent align="end" className="w-40 text-[11.7px] [&_[data-slot=dropdown-menu-item]]:text-[11.7px] [&_[data-slot=dropdown-menu-item]]:py-1">
          <DropdownMenuItem onClick={() => onRename(folderId)}>
            <Pencil className={ICON} />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setShowDeleteConfirm(true)}
          >
            <Trash2 className={ICON} />
            Delete Folder
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="Delete folder"
        description={`Delete "${folderName}"? Chats inside will be uncategorized.`}
        confirmLabel="Delete"
        onConfirm={() => onDelete(folderId)}
      />
    </>
  );
}
