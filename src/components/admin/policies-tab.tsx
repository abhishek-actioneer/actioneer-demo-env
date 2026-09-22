"use client";

import { useState } from "react";
import { Trash2, Plus, Shield } from "lucide-react";
import { useChatPanel } from "@/components/chat/chat-panel-provider";
import { useChatState } from "@/components/chat/chat-state-provider";
import { getAllPolicies, deletePolicy } from "@/lib/policy-store";
import type { DataPolicy } from "@/lib/policy-types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { PolicyDetailPanel } from "@/components/admin/policy-detail-panel";

interface PolicyRowProps {
  policy: DataPolicy;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}

function PolicyRow({ policy, isSelected, onSelect, onDelete }: PolicyRowProps) {
  const tableRule = policy.tableAccess[0];
  const tableName = tableRule?.tableName ?? "—";
  const columnCount = tableRule?.allowAllColumns
    ? "All"
    : `${tableRule?.allowedColumns?.length ?? 0} cols`;
  const hasFilter = !!tableRule?.rowFilter;

  return (
    <div
      className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
        isSelected ? "bg-muted/50" : "hover:bg-muted/30"
      }`}
      onClick={onSelect}
    >
      {/* Name + description */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground truncate">{policy.name}</p>
        <p className="text-xs text-muted-foreground truncate">{policy.description}</p>
      </div>

      {/* Badges */}
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">
          {tableName}
        </span>
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">
          {columnCount}
        </span>
        {hasFilter && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">
            Filtered
          </span>
        )}
      </div>

      {/* Delete — always visible; the bin turns red on hover. */}
      <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button
              className="p-1 rounded hover:bg-red-500/10 transition-colors group/bin"
              aria-label="Delete policy"
              title="Delete"
            >
              <Trash2 className="w-4 h-4 text-muted-foreground transition-colors group-hover/bin:text-red-500" />
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Policy</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete &ldquo;{policy.name}&rdquo;? This action cannot be
                undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

export function PoliciesTab() {
  const [version, setVersion] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const policies = getAllPolicies();
  const selectedPolicy = policies.find((p) => p.id === selectedId) ?? null;

  function handleDelete(id: string) {
    deletePolicy(id);
    if (selectedId === id) setSelectedId(null);
    setVersion((v) => v + 1);
  }

  const { open: openChat } = useChatPanel();
  const { chatInputRef } = useChatState();

  function handleCreateClick() {
    openChat();
    setTimeout(() => chatInputRef.current?.focus(), 100);
  }

  return (
    <div className="flex gap-4 items-start">
      {/* Left: list */}
      <div className={`flex flex-col gap-1 ${selectedPolicy ? "max-w-[55%] w-full" : "w-full"}`}>
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-muted-foreground">
            {policies.length} {policies.length === 1 ? "Policy" : "Policies"}
          </p>
          <button
            onClick={handleCreateClick}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Create Policy
          </button>
        </div>

        {/* Empty state */}
        {policies.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <Shield className="w-10 h-10 text-muted-foreground/40" />
            <p className="text-sm font-medium text-foreground">No policies yet</p>
            <p className="text-xs text-muted-foreground">
              Create a policy to control data access for your team.
            </p>
          </div>
        ) : (
          policies.map((policy) => (
            <PolicyRow
              key={`${policy.id}-${version}`}
              policy={policy}
              isSelected={selectedId === policy.id}
              onSelect={() => setSelectedId(policy.id === selectedId ? null : policy.id)}
              onDelete={() => handleDelete(policy.id)}
            />
          ))
        )}
      </div>

      {/* Right: detail panel */}
      {selectedPolicy && (
        <PolicyDetailPanel
          policy={selectedPolicy}
          onClose={() => setSelectedId(null)}
          onDelete={() => handleDelete(selectedPolicy.id)}
          onPolicyChanged={() => setVersion((v) => v + 1)}
        />
      )}
    </div>
  );
}
