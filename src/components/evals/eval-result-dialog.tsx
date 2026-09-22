"use client";

import { CheckCircle2, FileText, Quote, XCircle } from "lucide-react";
import type { VoiceEvalResult } from "@/lib/voice-evals";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const VERDICT_STYLE: Record<VoiceEvalResult["verdict"], string> = {
  pass: "border-[#9bd8c0] bg-[#e9f8f2] text-[#087b53]",
  fail: "border-[#efb4be] bg-[#fff0f2] text-[#c41431]",
  insufficient_evidence: "border-[#d8d7d0] bg-[#efeee8] text-[#6f6e67]",
  not_applicable: "border-[#d8d7d0] bg-[#efeee8] text-[#6f6e67]",
  error: "border-[#efb4be] bg-[#fff0f2] text-[#c41431]",
};

export function EvalResultDialog({ results, open, onOpenChange }: {
  results: VoiceEvalResult[];
  open: boolean;
  onOpenChange: (value: boolean) => void;
}) {
  const first = results[0];
  if (!first) return null;
  const scored = results.filter((result) => result.score !== null);
  const average = scored.length
    ? Math.round(scored.reduce((sum, result) => sum + (result.score ?? 0), 0) / scored.length)
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] gap-0 overflow-hidden rounded-none border-[#d8d7d0] bg-[#faf9f5] p-0 sm:max-w-[760px]">
        <DialogHeader className="border-b border-[#d8d7d0] bg-white px-6 py-5 text-left">
          <div className="flex items-start justify-between gap-5 pr-8">
            <div>
              <DialogTitle className="text-xl tracking-[-0.03em]">Evaluation output</DialogTitle>
              <DialogDescription className="mt-1 font-mono text-[9.9px]">Call {first.callId}</DialogDescription>
            </div>
            {average !== null && <div className="text-right"><p className="text-2xl font-semibold tabular-nums">{average}</p><p className="font-mono text-[8.1px] uppercase tracking-[0.14em] text-[#8b8a83]">Average score</p></div>}
          </div>
        </DialogHeader>

        <div className="max-h-[calc(86vh-96px)] space-y-4 overflow-y-auto p-5">
          {results.map((result) => (
            <article key={result.id} className="border border-[#d8d7d0] bg-white">
              <div className="flex items-center justify-between gap-4 border-b border-[#e3e2dc] px-5 py-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center bg-[#efeee8] text-[#5f5e58]"><FileText className="size-4" /></span>
                  <div className="min-w-0"><h3 className="truncate text-sm font-semibold">{result.evalAgentName}</h3><p className="mt-0.5 text-[9px] text-[#8b8a83]">Evaluated {new Date(result.createdAt).toLocaleString()}</p></div>
                </div>
                <div className="flex items-center gap-3">
                  {result.score !== null && <span className="text-lg font-semibold tabular-nums">{Math.round(result.score)}</span>}
                  <span className={cn("inline-flex items-center gap-1.5 border px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.1em]", VERDICT_STYLE[result.verdict])}>
                    {result.verdict === "pass" ? <CheckCircle2 className="size-3" /> : result.verdict === "fail" ? <XCircle className="size-3" /> : null}
                    {result.verdict.replaceAll("_", " ")}
                  </span>
                </div>
              </div>

              <div className="px-5 py-5">
                <p className="font-mono text-[8.1px] font-semibold uppercase tracking-[0.15em] text-[#8b8a83]">Judge reasoning</p>
                <p className="mt-2 whitespace-pre-wrap text-[12.6px] leading-6 text-[#34342f]">{result.rationale}</p>

                <div className="mt-5">
                  <p className="font-mono text-[8.1px] font-semibold uppercase tracking-[0.15em] text-[#8b8a83]">Cited evidence</p>
                  {result.evidence.length > 0 ? (
                    <div className="mt-2 space-y-2">
                      {result.evidence.map((evidence, index) => (
                        <blockquote key={`${evidence.turnIndex}-${index}`} className="flex gap-3 border-l-2 border-[#9ec8f7] bg-[#f3f7fb] px-4 py-3 text-[11.7px] leading-5 text-[#4b4a45]">
                          <Quote className="mt-0.5 size-3.5 shrink-0 text-[#397cc5]" />
                          <span><span className="mb-1 block font-mono text-[8.1px] uppercase tracking-[0.12em] text-[#7b7a73]">Turn {evidence.turnIndex}</span>“{evidence.quote}”</span>
                        </blockquote>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 border border-dashed border-[#d8d7d0] px-4 py-3 text-xs text-[#8b8a83]">No transcript quote was attached to this result.</p>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
