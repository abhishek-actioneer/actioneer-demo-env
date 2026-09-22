"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { getWizardState, isWizardComplete } from "@/lib/onboarding-wizard-store";

const SAMPLE_LABELS: Record<string, { name: string; description: string }> = {
  quickhelp: { name: "Quick Help", description: "Q&A platform with service bookings and partner data." },
  gameramp: { name: "GameRamp", description: "Mobile gaming user acquisition and monetization." },
  "vastu-hfc": { name: "Housing Finance", description: "Property lending with loan grades and delinquency tracking." },
  alpha: { name: "Alpha", description: "Mobile app with installs, sessions, and retention tracking." },
};

const WELCOME_SHOWN_KEY = "sentinel-welcome-shown";

/** Animated checkmark that draws itself — Peak-End Rule celebration */
function AnimatedCheck() {
  return (
    <div className="w-14 h-14 rounded-2xl bg-[#1e1e1e] border border-[#333] flex items-center justify-center">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
        <motion.circle
          cx="12"
          cy="12"
          r="10"
          stroke="#e8e8e8"
          strokeWidth="1.5"
          fill="none"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.2, ease: "easeOut" }}
        />
        <motion.path
          d="M8 12.5L11 15.5L16.5 9"
          stroke="#e8e8e8"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.35, delay: 0.6, ease: "easeOut" }}
        />
      </svg>
    </div>
  );
}

export function WelcomeModal() {
  const [show, setShow] = useState(false);
  const [dataset, setDataset] = useState<{ name: string; description: string; isSample: boolean } | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const alreadyShown = localStorage.getItem(WELCOME_SHOWN_KEY);
    if (alreadyShown) return;
    if (!isWizardComplete()) return;

    const state = getWizardState();
    const sampleMatch = SAMPLE_LABELS[state.selectedDataset];
    const ds = sampleMatch
      ? { name: sampleMatch.name, description: sampleMatch.description, isSample: true }
      : { name: state.selectedDataset.replace(/^[a-z0-9]+-/, "").replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()), description: "Your uploaded dataset is ready to explore.", isSample: false };
    setDataset(ds);
    setShow(true);
  }, []);

  function handleDismiss() {
    setShow(false);
    localStorage.setItem(WELCOME_SHOWN_KEY, "1");
  }

  return (
    <AnimatePresence>
      {show && dataset && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
            className="w-full max-w-md rounded-2xl bg-[#1a1a1a] border border-[#282828] p-8 shadow-2xl"
          >
            {/* Animated check icon */}
            <div className="flex justify-center mb-5">
              <AnimatedCheck />
            </div>

            <motion.h2
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, duration: 0.3 }}
              className="text-xl font-semibold text-[#e8e8e8] text-center mb-1.5"
            >
              Welcome to Actioneer
            </motion.h2>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5, duration: 0.3 }}
              className="text-[11.7px] text-[#666] text-center mb-6"
            >
              Your analytics workspace is ready to use
            </motion.p>

            {/* Selected dataset */}
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6, duration: 0.3 }}
              className="rounded-xl bg-[#161616] border border-[#282828] px-4 py-3 mb-6"
            >
              <p className="text-[11.7px] font-medium text-[#e8e8e8] mb-0.5">
                {dataset.isSample ? `Sample Data — ${dataset.name}` : dataset.name}
              </p>
              <p className="text-[10.8px] text-[#555]">{dataset.description}</p>
            </motion.div>

            {/* CTA */}
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.7, duration: 0.3 }}
              onClick={handleDismiss}
              className="w-full h-11 rounded-lg bg-[#e8e8e8] text-[#111] text-[12.6px] font-medium hover:bg-[#d4d4d4] active:scale-[0.97] transition-all shadow-[0_1px_2px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.12)]"
            >
              Start Exploring
            </motion.button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
