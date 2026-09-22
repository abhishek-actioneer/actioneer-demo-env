"use client";

import { useState, useRef, useEffect } from "react";
import type { ChatMessage } from "@/lib/types";

interface PlaybookWizardCardProps {
  message: ChatMessage;
  onAnswer: (stepKey: string, answer: string) => void;
}

export function PlaybookWizardCard({ message, onAnswer }: PlaybookWizardCardProps) {
  const wiz = message.playbookWizard;
  if (!wiz) return null;

  const { stepKey, stepIndex, totalSteps, question, inputType, options, chips, placeholder, optional, answered, answer } = wiz;

  if (answered) {
    return <AnsweredCard question={question} answer={answer ?? ""} stepIndex={stepIndex} totalSteps={totalSteps} />;
  }

  return (
    <ActiveCard
      stepKey={stepKey}
      stepIndex={stepIndex}
      totalSteps={totalSteps}
      question={question}
      inputType={inputType}
      options={options}
      chips={chips}
      placeholder={placeholder}
      optional={optional}
      onAnswer={onAnswer}
    />
  );
}

// ── Answered (read-only) state ──

function AnsweredCard({ question, answer, stepIndex, totalSteps }: {
  question: string;
  answer: string;
  stepIndex: number;
  totalSteps: number;
}) {
  return (
    <div className="border border-border/50 rounded-lg px-4 py-3 bg-muted/20 space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-[9.9px] text-muted-foreground">{stepIndex + 1} of {totalSteps}</p>
      </div>
      <p className="text-xs font-medium">{question}</p>
      <p className="text-xs text-foreground/80 bg-muted/40 rounded px-2.5 py-1.5">{answer}</p>
    </div>
  );
}

// ── Active (editable) state ──

function ActiveCard({ stepKey, stepIndex, totalSteps, question, inputType, options, chips, placeholder, optional, onAnswer }: {
  stepKey: string;
  stepIndex: number;
  totalSteps: number;
  question: string;
  inputType: "text" | "options";
  options?: string[];
  chips?: string[];
  placeholder?: string;
  optional?: boolean;
  onAnswer: (stepKey: string, answer: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 80);
  }, []);

  function submit(value?: string) {
    const answer = (value ?? draft).trim();
    if (!answer && !optional) return;
    onAnswer(stepKey, answer || "(skipped)");
  }

  // Progress dots
  const dots = Array.from({ length: totalSteps }, (_, i) => i);

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-card shadow-sm">
      {/* Progress */}
      <div className="px-4 pt-3 pb-2 flex items-center gap-2">
        <div className="flex items-center gap-1">
          {dots.map((i) => (
            <span
              key={i}
              className={`w-1.5 h-1.5 rounded-full ${
                i < stepIndex ? "bg-foreground" : i === stepIndex ? "bg-foreground" : "bg-muted-foreground/25"
              }`}
            />
          ))}
        </div>
        <span className="text-[9.9px] text-muted-foreground ml-1">{stepIndex + 1} of {totalSteps}</span>
      </div>

      {/* Question */}
      <div className="px-4 pb-3">
        <p className="text-sm font-medium mb-3">{question}</p>

        {/* Text input */}
        {inputType === "text" && (
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder={placeholder}
            className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-foreground/20 placeholder:text-muted-foreground/50"
          />
        )}

        {/* Option buttons */}
        {inputType === "options" && options && (
          <div className="flex flex-wrap gap-2">
            {options.map((opt) => (
              <button
                key={opt}
                onClick={() => submit(opt)}
                className="px-3 py-1.5 text-xs border border-border rounded-md hover:bg-muted/50 hover:border-foreground/20 transition-colors"
              >
                {opt}
              </button>
            ))}
          </div>
        )}

        {/* Suggestion chips (for text inputs) */}
        {inputType === "text" && chips && chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {chips.map((chip) => (
              <button
                key={chip}
                onClick={() => { setDraft(chip); setTimeout(() => submit(chip), 0); }}
                className="text-[9.9px] px-2.5 py-1 border border-border rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
              >
                {chip}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer with Continue/Skip */}
      <div className="px-4 pb-3 flex items-center justify-end gap-3">
        {optional && (
          <button
            onClick={() => submit("(skipped)")}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Skip
          </button>
        )}
        {inputType === "text" && (
          <button
            onClick={() => submit()}
            disabled={!draft.trim() && !optional}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-foreground text-background rounded-md hover:bg-foreground/90 disabled:opacity-40 transition-colors"
          >
            Continue
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        )}
      </div>
    </div>
  );
}
