import { cn } from "@/lib/utils";
import { OUTCOME_LABELS, formatStatusLabel } from "@/lib/voice-campaign-analysis";
import type {
  VoiceCallOutcome,
  VoiceCallStatus,
  VoiceCampaignStatus,
} from "@/lib/voice-campaign-types";

type SemanticTone = {
  pill: string;
  dot: string;
  cell: string;
};

export const VOICE_OUTCOME_TONE: Record<VoiceCallOutcome, SemanticTone> = {
  positive: {
    pill: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-200",
    dot: "bg-emerald-500",
    cell: "bg-emerald-50/65 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-200",
  },
  callback_scheduled: {
    pill: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-400/25 dark:bg-sky-400/10 dark:text-sky-200",
    dot: "bg-sky-500",
    cell: "bg-sky-50/65 text-sky-800 dark:bg-sky-400/10 dark:text-sky-200",
  },
  neutral: {
    pill: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-200",
    dot: "bg-amber-400",
    cell: "bg-amber-50/65 text-amber-800 dark:bg-amber-400/10 dark:text-amber-200",
  },
  busy: {
    pill: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-200",
    dot: "bg-amber-400",
    cell: "bg-amber-50/65 text-amber-800 dark:bg-amber-400/10 dark:text-amber-200",
  },
  negative: {
    pill: "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-400/25 dark:bg-rose-400/10 dark:text-rose-200",
    dot: "bg-rose-500",
    cell: "bg-rose-50/65 text-rose-800 dark:bg-rose-400/10 dark:text-rose-200",
  },
  wrong_number: {
    pill: "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-400/25 dark:bg-rose-400/10 dark:text-rose-200",
    dot: "bg-rose-400",
    cell: "bg-rose-50/65 text-rose-800 dark:bg-rose-400/10 dark:text-rose-200",
  },
  failed: {
    pill: "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-400/25 dark:bg-rose-400/10 dark:text-rose-200",
    dot: "bg-rose-600",
    cell: "bg-rose-50/65 text-rose-800 dark:bg-rose-400/10 dark:text-rose-200",
  },
  no_answer: {
    pill: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-400/25 dark:bg-slate-400/10 dark:text-slate-300",
    dot: "bg-slate-400",
    cell: "bg-slate-50/80 text-slate-700 dark:bg-slate-400/10 dark:text-slate-300",
  },
  unknown: {
    pill: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-400/25 dark:bg-slate-400/10 dark:text-slate-300",
    dot: "bg-slate-300",
    cell: "bg-slate-50/80 text-slate-700 dark:bg-slate-400/10 dark:text-slate-300",
  },
};

const CAMPAIGN_STATUS_TONE: Record<VoiceCampaignStatus, Pick<SemanticTone, "pill" | "dot">> = {
  draft: {
    pill: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-400/25 dark:bg-slate-400/10 dark:text-slate-300",
    dot: "bg-slate-400",
  },
  launching: {
    pill: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-200",
    dot: "bg-amber-500",
  },
  in_progress: {
    pill: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-400/25 dark:bg-sky-400/10 dark:text-sky-200",
    dot: "bg-sky-500",
  },
  completed: {
    pill: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-200",
    dot: "bg-emerald-500",
  },
};

const CALL_STATUS_LABEL: Record<VoiceCallStatus, string> = {
  queued: "Queued",
  calling: "Calling",
  connected: "Connected",
  completed: "Completed",
  failed: "Failed",
  no_answer: "No answer",
};

const CALL_STATUS_TONE: Record<VoiceCallStatus, Pick<SemanticTone, "pill" | "dot">> = {
  queued: CAMPAIGN_STATUS_TONE.draft,
  calling: CAMPAIGN_STATUS_TONE.launching,
  connected: CAMPAIGN_STATUS_TONE.in_progress,
  completed: CAMPAIGN_STATUS_TONE.completed,
  failed: { pill: VOICE_OUTCOME_TONE.failed.pill, dot: VOICE_OUTCOME_TONE.failed.dot },
  no_answer: { pill: VOICE_OUTCOME_TONE.no_answer.pill, dot: VOICE_OUTCOME_TONE.no_answer.dot },
};

function SemanticPill({ label, tone }: { label: string; tone: Pick<SemanticTone, "pill" | "dot"> }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 whitespace-nowrap rounded-[2px] border px-2 py-1 text-xs font-medium",
      tone.pill,
    )}>
      <span className={cn("size-1.5 rounded-full", tone.dot)} aria-hidden="true" />
      {label}
    </span>
  );
}

export function VoiceCampaignStatusPill({
  status,
  hasScheduledCallback = false,
}: {
  status: VoiceCampaignStatus;
  hasScheduledCallback?: boolean;
}) {
  if (status === "completed" && hasScheduledCallback) {
    return (
      <SemanticPill
        label="Callback scheduled"
        tone={VOICE_OUTCOME_TONE.callback_scheduled}
      />
    );
  }
  return <SemanticPill label={formatStatusLabel(status)} tone={CAMPAIGN_STATUS_TONE[status]} />;
}

export function VoiceCallStatusPill({ status }: { status: VoiceCallStatus }) {
  return <SemanticPill label={CALL_STATUS_LABEL[status]} tone={CALL_STATUS_TONE[status]} />;
}

export function VoiceOutcomePill({ outcome }: { outcome: VoiceCallOutcome }) {
  return <SemanticPill label={OUTCOME_LABELS[outcome]} tone={VOICE_OUTCOME_TONE[outcome]} />;
}

