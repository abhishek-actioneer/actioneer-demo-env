"use client";

import { useEffect, useRef, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { toast } from "sonner";

const MAX_CHARS = 2000;

interface BugReportModalProps {
  open: boolean;
  onClose: () => void;
  /** Page URL captured at the moment the modal opened. */
  pageUrl: string | null;
}

export function BugReportModal({ open, onClose, pageUrl }: BugReportModalProps) {
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (open) {
      setDescription("");
      // Focus after the panel mounts
      const t = setTimeout(() => textareaRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Esc closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, submitting, onClose]);

  if (!open) return null;

  const charsUsed = description.length;
  const canSend = description.trim().length > 0 && charsUsed <= MAX_CHARS && !submitting;

  async function handleSend() {
    if (!canSend) return;
    setSubmitting(true);
    try {
      await apiFetch<{ id: string }>("/api/bugs", {
        method: "POST",
        body: {
          description: description.trim(),
          pageUrl,
        },
        skipModel: true,
      });
      toast.success("Bug report sent");
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to send";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div
        data-bug-report-backdrop
        className="fixed inset-0 z-[60] bg-black/60"
        onClick={() => {
          if (!submitting) onClose();
        }}
      />
      <div
        data-bug-report-root
        role="dialog"
        aria-modal="true"
        aria-label="Report a bug"
        className="fixed left-1/2 top-1/2 z-[61] w-[min(560px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-background p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between">
          <h2 className="text-[13.5px] font-medium text-foreground">Report An Issue</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
            className="rounded-md p-1 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4">
          <textarea
            ref={textareaRef}
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, MAX_CHARS))}
            disabled={submitting}
            placeholder="Describe what went wrong and what you expected to happen."
            rows={6}
            className="w-full resize-none rounded-md border border-border bg-muted/30 px-3 py-2 text-[11.7px] text-foreground placeholder:text-muted-foreground/60 focus:border-foreground/40 focus:outline-none focus:ring-1 focus:ring-foreground/20 disabled:opacity-50"
          />
          <div className="mt-1 text-right text-[9.9px] text-muted-foreground">
            {charsUsed} / {MAX_CHARS} characters used
          </div>
        </div>

        <p className="mt-3 text-[10.8px] leading-relaxed text-muted-foreground">
          Anything you share helps us improve Actioneer. Need a hand?{" "}
          <a
            href="mailto:support@sentinel.app"
            className="underline underline-offset-2 hover:text-foreground"
          >
            Contact support
          </a>
          .
        </p>

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-4 py-1.5 text-[11.7px] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {submitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Sending…
              </>
            ) : (
              "Send"
            )}
          </button>
        </div>
      </div>
    </>
  );
}
