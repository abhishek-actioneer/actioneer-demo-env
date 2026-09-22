"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Play, Compass, X } from "lucide-react";
import { isWizardComplete } from "@/lib/onboarding-wizard-store";
import { START_TOUR_EVENT } from "@/components/onboarding/product-tour";
import { OPEN_WALKTHROUGH_EVENT } from "@/components/onboarding/walkthrough-modal";

/** Fire `window.dispatchEvent(new Event(OPEN_GET_STARTED_EVENT))` to open the choice modal. */
export const OPEN_GET_STARTED_EVENT = "actioneer:open-get-started";

const SEEN_KEY = "actioneer-getstarted-seen";

/**
 * Single first-run surface. Replaces the old welcome popup + floating video card +
 * direct tour launch, which all fired at once and felt redundant.
 *
 * On first login (wizard complete) it auto-opens once. The sidebar "Walkthrough"
 * entry reopens it any time. It presents exactly two ways to learn the platform:
 *   - Watch the video    → opens the Loom player (WalkthroughModal, expanded)
 *   - Take the guided tour → starts the in-app coachmark tour (ProductTour)
 * Either choice, or "Maybe later", closes the modal and marks it seen.
 */
export function GetStartedModal() {
  const [open, setOpen] = useState(false);

  // First authenticated landing after onboarding → show once.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem(SEEN_KEY)) return;
    if (!isWizardComplete()) return;
    setOpen(true);
  }, []);

  // Sidebar "Walkthrough" → reopen on demand.
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener(OPEN_GET_STARTED_EVENT, handler);
    return () => window.removeEventListener(OPEN_GET_STARTED_EVENT, handler);
  }, []);

  const dismiss = useCallback(() => {
    setOpen(false);
    if (typeof window !== "undefined") localStorage.setItem(SEEN_KEY, "1");
  }, []);

  const watchVideo = useCallback(() => {
    dismiss();
    window.dispatchEvent(new Event(OPEN_WALKTHROUGH_EVENT));
  }, [dismiss]);

  const startTour = useCallback(() => {
    dismiss();
    // Let this modal's exit animation clear the DOM before driver.js measures the
    // page, otherwise the overlay would spotlight an element behind the backdrop.
    window.setTimeout(() => window.dispatchEvent(new Event(START_TOUR_EVENT)), 280);
  }, [dismiss]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") dismiss(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, dismiss]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="getstarted"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={dismiss}
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-md rounded-2xl bg-card border border-border p-7 shadow-2xl"
          >
            <button
              onClick={dismiss}
              aria-label="Close"
              className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors p-1 -m-1"
            >
              <X className="w-4 h-4" />
            </button>

            <h2 className="text-[21.6px] font-semibold text-foreground mb-6">Get Started</h2>

            <div className="space-y-3">
              <OptionRow icon={Play} title="Demo Video" onClick={watchVideo} />
              <OptionRow icon={Compass} title="Guided Tour" onClick={startTour} />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function OptionRow({
  icon: Icon,
  title,
  onClick,
}: {
  icon: typeof Play;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group flex w-full items-center gap-4 rounded-xl border border-border bg-background px-4 py-4 text-left transition-colors hover:border-foreground/30 hover:bg-muted/40"
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-foreground">
        <Icon className="w-5 h-5" />
      </span>
      <span className="text-[15.3px] font-medium text-foreground">{title}</span>
    </button>
  );
}
