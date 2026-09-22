"use client";

import { useCallback, useState } from "react";
import { Check, Copy, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PromptPreview } from "@/components/voice-campaigns/voice-campaign-studio";

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(() => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);

  return (
    <button
      type="button"
      onClick={copy}
      title="Copy to clipboard"
      className={cn(
        "flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function PromptBlock({
  label,
  value,
  mono = false,
  defaultOpen = false,
}: {
  label: string;
  value: string | undefined;
  mono?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const text = value?.trim() ?? "";

  if (!text) {
    return (
      <div className="rounded-md border border-border/60 px-3 py-2.5">
        <p className="text-[9.9px] font-semibold uppercase tracking-wider text-muted-foreground/60">{label}</p>
        <p className="mt-1 text-xs text-muted-foreground/40 italic">Not yet compiled</p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border/60">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
      >
        <span className="text-[9.9px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className="flex items-center gap-2">
          <span className="text-[9px] text-muted-foreground/60">{text.length.toLocaleString()} chars</span>
          <ChevronDown className={cn("size-3 text-muted-foreground/60 transition-transform", open && "rotate-180")} />
        </span>
      </button>

      {open && (
        <div className="border-t border-border/60">
          <div className="flex items-center justify-between border-b border-border/40 px-3 py-1.5">
            <span className="text-[9px] text-muted-foreground/50">{text.split("\n").length} lines</span>
            <CopyButton text={text} />
          </div>
          <pre
            className={cn(
              "max-h-[360px] overflow-auto px-3 py-3 text-xs leading-relaxed text-foreground",
              mono ? "font-mono" : "whitespace-pre-wrap break-words",
            )}
          >
            {text}
          </pre>
        </div>
      )}
    </div>
  );
}

interface VoicePromptInspectorProps {
  prompt: PromptPreview;
  className?: string;
}

export function VoicePromptInspector({ prompt, className }: VoicePromptInspectorProps) {
  const hasContent = Boolean(prompt.firstMessage || prompt.systemPrompt);

  return (
    <div className={cn("space-y-2", className)}>
      {/* Metadata row */}
      <div className="grid grid-cols-2 gap-1.5 text-[9.9px]">
        {[
          ["Segment", prompt.segmentName],
          ["Purpose", prompt.purposeName],
          ["Voice", prompt.voice],
          ["Language", prompt.language],
        ].map(([label, value]) => value ? (
          <div key={label} className="flex items-center justify-between rounded-md border border-border/40 px-2.5 py-1.5">
            <span className="text-muted-foreground/70">{label}</span>
            <span className="truncate font-medium text-foreground">{value}</span>
          </div>
        ) : null)}
      </div>

      {!hasContent && (
        <p className="text-xs text-muted-foreground/50 italic">
          Select an audience, offer, and generate a script to preview the compiled prompt.
        </p>
      )}

      <PromptBlock
        label="Opening line (first message)"
        value={prompt.firstMessage}
        defaultOpen={true}
      />

      <PromptBlock
        label="System prompt"
        value={prompt.systemPrompt}
        mono={true}
        defaultOpen={false}
      />

      {prompt.reasoning && (
        <PromptBlock
          label="Script reasoning"
          value={prompt.reasoning}
          defaultOpen={false}
        />
      )}
    </div>
  );
}

// Standalone full-page prompt view (for the monitoring "prompts" tab)
export function VoicePromptsFullView({ prompt }: { prompt: PromptPreview }) {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h2 className="text-sm font-semibold">Compiled prompts</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          What the AI model receives at the start of each call. These are compiled from the script, audience, and offer.
        </p>
      </div>
      <VoicePromptInspector prompt={prompt} />
    </div>
  );
}
