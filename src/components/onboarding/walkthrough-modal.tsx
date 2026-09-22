"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X } from "lucide-react";

const SEEN_KEY = "actioneer-walkthrough-seen";
/** Fire `window.dispatchEvent(new Event(OPEN_WALKTHROUGH_EVENT))` to open it large. */
export const OPEN_WALKTHROUGH_EVENT = "actioneer:open-walkthrough";

// Hide Loom's player chrome (title, owner, view count, share bar) so the
// walkthrough shows a clean video instead of the Loom share-page look.
const LOOM_CLEAN_PARAMS = "hideEmbedTopBar=true&hide_title=true&hide_owner=true&hide_share=true";

/** Accepts a Loom share/embed URL and returns a clean, normalized embed URL. */
function toLoomEmbed(raw?: string): string | null {
  const url = raw?.trim();
  if (!url) return null;
  const withParams = (u: string) => (u.includes("?") ? `${u}&${LOOM_CLEAN_PARAMS}` : `${u}?${LOOM_CLEAN_PARAMS}`);
  if (url.includes("/embed/")) return withParams(url);
  const m = url.match(/loom\.com\/(?:share|recordings)\/([a-zA-Z0-9-]+)/);
  return m ? withParams(`https://www.loom.com/embed/${m[1]}`) : url;
}

/**
 * Product walkthrough (Loom).
 *
 * - First login: a small FLOATING card in the bottom-right corner that the user
 *   can dismiss ("cut") if they're not interested. It does not take over the
 *   screen and won't auto-show again once dismissed.
 * - The card's expand button — and the sidebar "Walkthrough" entry — open the
 *   large centered version for intentional viewing.
 *
 * Set NEXT_PUBLIC_WALKTHROUGH_LOOM_URL to a Loom share or embed link.
 */
type Mode = "closed" | "expanded";

export function WalkthroughModal() {
  const [mode, setMode] = useState<Mode>("closed");
  const embed = toLoomEmbed(process.env.NEXT_PUBLIC_WALKTHROUGH_LOOM_URL);

  // First-run is now handled by the single "Get Started" choice modal, so the
  // video no longer auto-shows on landing. It opens large when the user picks
  // "Watch the video" there (or the sidebar "Walkthrough" entry).
  useEffect(() => {
    const handler = () => setMode("expanded");
    window.addEventListener(OPEN_WALKTHROUGH_EVENT, handler);
    return () => window.removeEventListener(OPEN_WALKTHROUGH_EVENT, handler);
  }, []);

  const close = useCallback(() => {
    setMode("closed");
    if (typeof window !== "undefined") localStorage.setItem(SEEN_KEY, "1");
  }, []);

  useEffect(() => {
    if (mode === "closed") return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mode, close]);

  const video = embed ? (
    <iframe
      src={embed}
      title="Actioneer walkthrough"
      className="absolute inset-0 w-full h-full"
      allow="fullscreen; picture-in-picture"
      allowFullScreen
    />
  ) : (
    <div className="absolute inset-0 flex items-center justify-center text-center px-6">
      <p className="text-[11.7px] text-muted-foreground">
        The walkthrough video will appear here once it is added.
      </p>
    </div>
  );

  return (
    <AnimatePresence>
      {mode === "expanded" && (
        <motion.div
          key="expanded"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={close}
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-3xl rounded-2xl bg-card border border-border shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between gap-4 px-6 pt-5 pb-4">
              <h2 className="text-[19.8px] font-semibold text-foreground">A guided tour of the platform.</h2>
              <button
                onClick={close}
                aria-label="Close walkthrough"
                className="text-muted-foreground hover:text-foreground transition-colors p-1 -m-1 shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-6 pb-6">
              <div className="relative w-full aspect-video rounded-xl overflow-hidden border border-border bg-muted">
                {video}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
