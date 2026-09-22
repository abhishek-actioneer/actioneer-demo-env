"use client";

import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { X, ArrowRight, MessageSquare, FileText } from "lucide-react";
import { savePlaybook } from "@/lib/playbook-store";
import { getOwnerInfo, PLAYBOOK_DEFAULTS } from "@/lib/playbook-defaults";
import { useDataset } from "@/lib/dataset-context";
import type { PlaybookV2 } from "@/lib/playbook-types";

interface NewPlaybookModalProps {
  onClose: () => void;
}

function createId() {
  return Math.random().toString(36).slice(2, 10);
}

export function NewPlaybookModal({ onClose }: NewPlaybookModalProps) {
  const router = useRouter();
  const { user } = useUser();
  const { owner, ownerInitials } = getOwnerInfo(user);
  const { datasetId } = useDataset();

  function handleNavigate(mode: "guided" | "detailed") {
    const playbookId = `pb-${createId()}`;
    const skeleton: PlaybookV2 = {
      id: playbookId,
      schemaVersion: 2,
      name: "New Playbook",
      description: "",
      category: PLAYBOOK_DEFAULTS.category,
      version: PLAYBOOK_DEFAULTS.version,
      approvalStatus: PLAYBOOK_DEFAULTS.approvalStatus,
      owner,
      ownerInitials,
      datasetId,
      cells: [],
      params: [],
      produces: [],
      runHistory: [],
      changelog: [],
    };
    savePlaybook(skeleton);
    onClose();
    router.push(`/playbooks/${playbookId}?wizard=true&mode=${mode}`);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-md"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-background border border-border rounded-xl shadow-lg w-full max-w-md mx-4 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-base font-semibold">New Playbook</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 pb-5 space-y-3">
          <p className="text-[11.7px] text-muted-foreground leading-relaxed">
            Create a playbook through a guided chat experience.
          </p>

          {/* Two clickable creation path cards */}
          <div className="grid grid-cols-2 gap-2.5">
            <button
              onClick={() => handleNavigate("guided")}
              className="group border border-border rounded-lg px-3 py-2.5 space-y-1.5 text-left hover:border-foreground/20 hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium">Guided QnA</span>
                </div>
                <ArrowRight className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <p className="text-[9.9px] text-muted-foreground leading-relaxed">
                Answer a few quick questions to shape your playbook step by step.
              </p>
            </button>
            <button
              onClick={() => handleNavigate("detailed")}
              className="group border border-border rounded-lg px-3 py-2.5 space-y-1.5 text-left hover:border-foreground/20 hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium">Detailed Instruction</span>
                </div>
                <ArrowRight className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <p className="text-[9.9px] text-muted-foreground leading-relaxed">
                Describe your analysis in one go and let the system figure out the rest.
              </p>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
