"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Sparkles, Loader2, ChevronLeft, ChevronRight, Check } from "lucide-react";
import {
  ScheduleState,
  parseSchedule,
  toHumanSchedule,
  TEMPLATES,
  isTemplateActive,
  TimePicker,
  DayPicker,
  SELECT_CLS,
  ScheduleMode,
} from "./scheduler-modal";

/* ── Step indicator ──────────────────────────────────────────────── */

function StepIndicator({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`rounded-full transition-all duration-200 ${
            i + 1 === step
              ? "w-4 h-1.5 bg-foreground"
              : i + 1 < step
              ? "w-1.5 h-1.5 bg-foreground/40"
              : "w-1.5 h-1.5 bg-muted-foreground/20"
          }`}
        />
      ))}
    </div>
  );
}

/* ── Create agent modal ──────────────────────────────────────────── */

export interface NewAgent {
  name: string;
  description: string;
  schedule: string;
}

interface CreateAgentModalProps {
  onClose: () => void;
  onCreate: (agent: NewAgent) => void;
}

export function CreateAgentModal({ onClose, onCreate }: CreateAgentModalProps) {
  const [step, setStep] = useState(1);
  const TOTAL_STEPS = 3;

  // Step 1 state
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [improving, setImproving] = useState(false);

  // Step 2 state
  const [schedState, setSchedState] = useState<ScheduleState>(
    () => parseSchedule("Every hour")
  );

  function patch(partial: Partial<ScheduleState>) {
    setSchedState(prev => ({ ...prev, ...partial }));
  }

  const schedulePreview = toHumanSchedule(schedState);

  function handleImprove() {
    setImproving(true);
    setTimeout(() => {
      setDescription(d =>
        d.trimEnd() +
        (d.endsWith(".") ? " Escalates critical findings immediately with zero tolerance for data drift." : ". Escalates critical findings immediately with zero tolerance for data drift.")
      );
      setImproving(false);
    }, 1200);
  }

  function handleCreate() {
    onCreate({ name: name.trim(), description, schedule: schedulePreview });
    onClose();
  }

  const canProceed = step === 1 ? name.trim().length > 0 : true;

  return (
    <div
      className="fixed inset-0 bg-background/60 backdrop-blur-[2px] flex items-center justify-center z-[60] p-4"
      onClick={onClose}
    >
      <motion.div
        className="bg-background border border-border rounded-2xl shadow-xl w-full max-w-[600px] h-[480px] overflow-hidden flex flex-col"
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-[11.7px] font-medium text-foreground">New Agent</span>
            <StepIndicator step={step} total={TOTAL_STEPS} />
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          <AnimatePresence mode="wait">

            {/* ── Step 1: Details ── */}
            {step === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -16 }}
                transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
                className="px-5 py-5 space-y-5"
              >
                {/* Name */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[10.8px] font-medium text-muted-foreground">Name</label>
                    <span className={`text-[9.9px] tabular-nums ${name.length > 180 ? "text-foreground" : "text-muted-foreground/40"}`}>
                      {name.length} / 200
                    </span>
                  </div>
                  <input
                    type="text"
                    value={name}
                    maxLength={200}
                    onChange={e => setName(e.target.value)}
                    placeholder="e.g. Payment table quality"
                    className="w-full text-[11.7px] bg-muted/40 border border-border rounded-lg px-3 py-2.5 text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-ring/20"
                  />
                </div>

                {/* Description */}
                <div className="space-y-1.5">
                  <label className="text-[10.8px] font-medium text-muted-foreground">Description</label>
                  <textarea
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    rows={3}
                    placeholder="Describe what this agent monitors…"
                    className="w-full text-[11.7px] bg-muted/40 border border-border rounded-lg px-3 py-2.5 text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-ring/20 resize-none leading-relaxed"
                  />
                  <button
                    type="button"
                    onClick={handleImprove}
                    disabled={improving || !description.trim()}
                    className="flex items-center gap-1.5 text-[10.8px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                  >
                    {improving ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Sparkles className="w-3 h-3" />
                    )}
                    {improving ? "Improving…" : "Improve with AI"}
                  </button>
                </div>
              </motion.div>
            )}

            {/* ── Step 2: Schedule ── */}
            {step === 2 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -16 }}
                transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
                className="px-5 py-5 space-y-5"
              >
                {/* Quick pick */}
                <div>
                  <span className="text-[9.9px] font-semibold text-muted-foreground uppercase tracking-wider">Quick pick</span>
                  <div className="flex flex-wrap gap-1.5 mt-2.5">
                    {TEMPLATES.map(t => {
                      const active = isTemplateActive(schedState, t.config);
                      return (
                        <button
                          key={t.label}
                          type="button"
                          onClick={() => setSchedState(prev => ({ ...prev, ...t.config }))}
                          className={`px-2.5 py-1 text-[10.8px] font-medium rounded-lg border transition-colors ${
                            active
                              ? "bg-foreground text-background border-foreground"
                              : "bg-background text-foreground border-border hover:bg-muted/50"
                          }`}
                        >
                          {t.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Custom builder */}
                <div>
                  <span className="text-[9.9px] font-semibold text-muted-foreground uppercase tracking-wider">Custom</span>
                  <div className="flex items-center gap-0.5 mt-2.5 p-0.5 rounded-lg w-fit" style={{ background: "var(--connector-surface)", border: "1px solid var(--connector-border)" }}>
                    {(["interval", "daily", "weekly"] as ScheduleMode[]).map(m => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => patch({ mode: m })}
                        className={`px-3 py-1.5 text-[10.8px] font-medium rounded-md transition-colors capitalize ${
                          schedState.mode === m
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>

                  <div className="mt-4">
                    {schedState.mode === "interval" && (
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">Every</span>
                        <input
                          type="number"
                          min={1}
                          max={59}
                          value={schedState.intervalValue}
                          onChange={e => patch({ intervalValue: Math.max(1, parseInt(e.target.value) || 1) })}
                          className="w-16 text-sm border border-border rounded-lg px-2.5 py-1.5 bg-background text-center focus:outline-none focus:ring-2 focus:ring-ring/20"
                        />
                        <select
                          value={schedState.intervalUnit}
                          onChange={e => patch({ intervalUnit: e.target.value as "minutes" | "hours" })}
                          className={SELECT_CLS}
                        >
                          <option value="minutes">minutes</option>
                          <option value="hours">hours</option>
                        </select>
                      </div>
                    )}
                    {schedState.mode === "daily" && (
                      <div className="space-y-3">
                        <TimePicker state={schedState} patch={patch} />
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={schedState.weekdaysOnly}
                            onChange={e => patch({ weekdaysOnly: e.target.checked })}
                            className="rounded"
                          />
                          <span className="text-sm text-muted-foreground">Weekdays only (Mon-Fri)</span>
                        </label>
                      </div>
                    )}
                    {schedState.mode === "weekly" && (
                      <div className="space-y-3">
                        <DayPicker days={schedState.days} onChange={days => patch({ days })} />
                        <TimePicker state={schedState} patch={patch} />
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {/* ── Step 3: Review ── */}
            {step === 3 && (
              <motion.div
                key="step3"
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -16 }}
                transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
                className="px-5 py-5 space-y-4"
              >
                <p className="text-[10.8px] text-muted-foreground">Review your agent before creating it.</p>

                {/* Preview card */}
                <div
                  className="rounded-xl p-4 space-y-3"
                  style={{ background: "var(--connector-surface)", border: "1px solid var(--connector-border)" }}
                >
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      <Sparkles className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12.6px] font-semibold text-foreground">{name || "Unnamed agent"}</p>
                      <p className="text-[10.8px] text-muted-foreground leading-relaxed mt-0.5">{description || "No description."}</p>
                    </div>
                  </div>

                  <div className="border-t border-border" />

                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[9.9px] text-muted-foreground w-20">Schedule</span>
                      <span className="text-[10.8px] text-foreground">{schedulePreview}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[9.9px] text-muted-foreground w-20">Status</span>
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-foreground" />
                        <span className="text-[10.8px] text-foreground">Active on create</span>
                      </div>
                    </div>
                  </div>
                </div>

                <p className="text-[9.9px] text-muted-foreground">
                  The agent will run on your next scheduled interval. You can edit or disable it at any time from this table.
                </p>
              </motion.div>
            )}

          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-border shrink-0">
          <button
            type="button"
            onClick={() => step === 1 ? onClose() : setStep(s => s - 1)}
            className="flex items-center gap-1.5 text-[11.7px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {step > 1 && <ChevronLeft className="w-3.5 h-3.5" />}
            {step === 1 ? "Cancel" : "Back"}
          </button>

          <div className="flex items-center gap-2.5">
            {/* Schedule preview pill in footer when on step 2 */}
            {step === 2 && (
              <span className="text-[10.8px] text-muted-foreground tabular-nums">{schedulePreview}</span>
            )}

            {step < TOTAL_STEPS ? (
              <button
                type="button"
                onClick={() => setStep(s => s + 1)}
                disabled={!canProceed}
                className="flex items-center gap-1.5 px-4 py-2 text-[11.7px] font-medium bg-foreground text-background rounded-lg hover:bg-foreground/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleCreate}
                className="flex items-center gap-1.5 px-4 py-2 text-[11.7px] font-medium bg-foreground text-background rounded-lg hover:bg-foreground/90 transition-colors"
              >
                <Check className="w-3.5 h-3.5" />
                Create Agent
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
