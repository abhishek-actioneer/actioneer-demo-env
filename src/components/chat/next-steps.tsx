"use client";

import type { FollowUpAction } from "@/lib/types";
import { PinButton } from "@/components/canvas/pin-button";

interface NextStepsProps {
  actions: FollowUpAction[];
  onAction: (action: FollowUpAction) => void;
  /** Used for provenance tracking when pinning a follow-up */
  conversationId?: string;
}

function isFollowUp(action: FollowUpAction) {
  return action.type === "follow-up-question";
}

function PromptArrowIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      className="shrink-0 text-muted-foreground"
    >
      <polyline
        points="15 14 20 9 15 4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 20v-7a4 4 0 0 1 4-4h12"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function NextSteps({ actions, onAction, conversationId }: NextStepsProps) {
  if (!actions.length) return null;

  // Group: follow-up questions first, then actions
  const followUps = actions.filter(isFollowUp);
  const actionItems = actions.filter((a) => !isFollowUp(a));
  const sorted = [...followUps, ...actionItems];

  return (
    <div className="mt-10">
      <h3 className="text-base font-semibold text-foreground mb-2">Follow-ups</h3>
      <div className="border-t border-border">
        {sorted.map((action, index) => (
          <div
            key={action.id}
            className="flex items-center gap-1 border-b border-border group opacity-0 animate-fade-in-up"
            style={{ 
              animationDelay: `${index * 30}ms`,
              animationFillMode: 'forwards'
            }}
          >
            <button
              onClick={() => onAction(action)}
              className="flex items-center gap-3 flex-1 px-1 py-3 text-sm text-left text-foreground/80 hover:text-foreground transition-colors"
            >
              <PromptArrowIcon />
              {action.label}
            </button>
            {/* Pin icon — shown on row hover */}
            <div className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 pr-1">
              <PinButton
                cardType="follow-up"
                title={action.label}
                markdownContent={action.label}
                sourceConversationId={conversationId}
                iconOnly
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
