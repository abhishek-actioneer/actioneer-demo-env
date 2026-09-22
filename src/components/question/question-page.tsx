"use client";

import { useRef, useEffect } from "react";
import { Zap, Search } from "lucide-react";
import { MarkdownContent } from "@/lib/markdown";
import { ReportCTA } from "@/components/chat/research-report";
import { WorkingTrace } from "./working-trace";
import { FollowUpInput } from "./follow-up-input";
import type { QuestionState } from "@/lib/types";

interface QuestionPageProps {
  question: QuestionState;
  onFollowUp: (text: string) => void;
  onOpenReport: () => void;
}

export function QuestionPage({ question, onFollowUp, onOpenReport }: QuestionPageProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);
  const prevAnswerLenRef = useRef(0);

  // Auto-scroll when answer grows
  useEffect(() => {
    if (!scrollRef.current) return;
    const newLen = question.answer.length;
    if (newLen > prevAnswerLenRef.current && !userScrolledRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    prevAnswerLenRef.current = newLen;
  }, [question.answer]);

  // Reset scroll tracking when switching questions
  useEffect(() => {
    userScrolledRef.current = false;
    prevAnswerLenRef.current = 0;
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [question.id]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 60;
    userScrolledRef.current = !atBottom;
  };

  const isProcessing = question.status === "processing";
  const hasAnswer = question.answer.length > 0;
  const showTrace = question.mode !== "direct" && (isProcessing || question.trace.subagents.length > 0);

  return (
    <div className="flex flex-col h-full">
      {/* Scrollable content */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto"
      >
        <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
          {/* Question title */}
          <div>
            <h1 className="text-xl font-semibold leading-snug text-foreground">
              {question.question}
            </h1>
            <div className="mt-2">
              <ModeBadge mode={question.mode} />
            </div>
          </div>

          {/* Working trace */}
          {showTrace && (
            <WorkingTrace
              trace={question.trace}
              status={question.status}
              startedAt={question.startedAt}
              completedAt={question.completedAt}
              answerStarted={hasAnswer}
            />
          )}

          {/* Answer prose */}
          {hasAnswer && (
            <div className="prose prose-sm prose-neutral max-w-none text-sm leading-relaxed">
              <MarkdownContent content={question.answer} />
            </div>
          )}

          {/* Streaming cursor */}
          {isProcessing && hasAnswer && (
            <span className="inline-block w-2 h-4 bg-foreground/60 animate-pulse rounded-sm" />
          )}

          {/* Report CTA */}
          {question.hasReport && question.status === "complete" && (
            <ReportCTA onClick={onOpenReport} />
          )}

          {/* Bottom spacer */}
          <div className="h-4" />
        </div>
      </div>

      {/* Follow-up input */}
      <FollowUpInput onSend={onFollowUp} disabled={isProcessing} />
    </div>
  );
}

// ── Mode badge ──

function ModeBadge({ mode }: { mode: QuestionState["mode"] }) {
  if (mode === "deep") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted text-foreground text-xs font-medium border border-border">
        <Zap className="w-3 h-3" />
        Deep Research
      </span>
    );
  }
  if (mode === "quick") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted text-foreground text-xs font-medium border border-border">
        <Zap className="w-3 h-3" />
        Quick
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted text-muted-foreground text-xs font-medium border border-border">
      <Search className="w-3 h-3" />
      Direct
    </span>
  );
}
