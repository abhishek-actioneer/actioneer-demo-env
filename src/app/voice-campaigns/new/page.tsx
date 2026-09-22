"use client";

import { Check, FileCheck, Loader2, Phone, PhoneCall, RefreshCw, Sparkles, TrendingUp, Upload, X } from "lucide-react";
import type { VoicePurposeSuggestion } from "@/lib/voice-campaign-studio-utils";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { VoiceTestPanel } from "@/components/voice-campaigns/voice-test-panel";
import { VoiceFlowCanvas } from "@/components/voice-campaigns/voice-flow-canvas";
import { VoiceFlowInspector } from "@/components/voice-campaigns/voice-flow-inspector";
import { TestCustomerModal } from "@/components/voice-campaigns/test-customer-modal";
import { appendVoiceCustomerContextToSystemPrompt } from "@/lib/voice-customer-context";
import { CampaignConfigPanel } from "@/components/voice-campaigns/campaign-config-panel";
import { SuccessMetricsPanel } from "@/components/voice-campaigns/success-metrics-panel";
import { GuardrailsPanel } from "@/components/voice-campaigns/guardrails-panel";
import { defaultGuardrailsConfig, guardrailsConfigToRules } from "@/lib/voice-campaign-guardrails";
import type { GuardrailsConfig } from "@/lib/voice-campaign-guardrails";
import { ConnectionsPanel } from "@/components/voice-campaigns/connections-panel";
import {
  VoiceCallLogsPanel,
  VoiceCampaignTabList,
  VoiceOverviewPanel,
  VoiceResponsesPanel,
  type VoiceOverviewDrilldown,
} from "@/components/voice-campaigns/voice-campaign-studio";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useCampaignStudio } from "@/hooks/use-campaign-studio";
import {
  normalizeScriptForComparison,
  VOICE_CAMPAIGN_EDITABLE_SCRIPT_MAX_CHARS,
  withDataset,
  type VoiceCampaignTemplateWithRoutes,
  type VoiceScriptOption,
} from "@/lib/voice-campaign-studio-utils";
import type { ScriptImportResult } from "@/lib/voice-script-import";
import { CampaignOpenItems } from "@/components/voice/campaign-open-items";
import type { CampaignDiagnostic } from "@/lib/voice-diagnostics";
import { validateVoiceCampaignWorkflow } from "@/lib/voice-campaign-workflow-validation";
import { apiFetch } from "@/lib/api-client";
import type { Segment } from "@/lib/types";
import type { Purpose } from "@/lib/purpose-types";
import { defaultStarterChips, segmentStarterChips, type StarterChip } from "@/lib/voice-campaign-starters";

// ---------------------------------------------------------------------------
// ScriptEditor — ElevenLabs-style full-height script input with segment chips
// ---------------------------------------------------------------------------

type Chip = { label: string; brief: string; icon: React.ReactNode; purpose?: Purpose };

interface ScriptAiRefineResult {
  script: string;
  reason?: string;
}

type PatchHunkStatus = "pending" | "accepted" | "rejected";

interface ScriptPatchHunk {
  id: string;
  title: string;
  oldStart: number;
  deleteCount: number;
  oldLines: string[];
  newLines: string[];
  beforeLines: string[];
  afterLines: string[];
  status: PatchHunkStatus;
}

interface ScriptPatchReview {
  original: string;
  revised: string;
  instruction: string;
  reason?: string;
  source: "script";
  hunks: ScriptPatchHunk[];
}

type LineDiffOp =
  | { type: "equal"; line: string; oldIndex: number; newIndex: number }
  | { type: "delete"; line: string; oldIndex: number; newIndex: number }
  | { type: "insert"; line: string; oldIndex: number; newIndex: number };

function splitScriptLines(value: string): string[] {
  return value.replace(/\r\n/g, "\n").split("\n");
}

function joinScriptLines(lines: string[]): string {
  return lines.join("\n");
}

function diffScriptLines(original: string[], revised: string[]): LineDiffOp[] {
  const dp: number[][] = Array.from({ length: original.length + 1 }, () =>
    Array.from({ length: revised.length + 1 }, () => 0),
  );

  for (let oldIndex = original.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = revised.length - 1; newIndex >= 0; newIndex -= 1) {
      dp[oldIndex][newIndex] = original[oldIndex] === revised[newIndex]
        ? dp[oldIndex + 1][newIndex + 1] + 1
        : Math.max(dp[oldIndex + 1][newIndex], dp[oldIndex][newIndex + 1]);
    }
  }

  const ops: LineDiffOp[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < original.length && newIndex < revised.length) {
    if (original[oldIndex] === revised[newIndex]) {
      ops.push({ type: "equal", line: original[oldIndex], oldIndex, newIndex });
      oldIndex += 1;
      newIndex += 1;
    } else if (dp[oldIndex + 1][newIndex] >= dp[oldIndex][newIndex + 1]) {
      ops.push({ type: "delete", line: original[oldIndex], oldIndex, newIndex });
      oldIndex += 1;
    } else {
      ops.push({ type: "insert", line: revised[newIndex], oldIndex, newIndex });
      newIndex += 1;
    }
  }

  while (oldIndex < original.length) {
    ops.push({ type: "delete", line: original[oldIndex], oldIndex, newIndex });
    oldIndex += 1;
  }
  while (newIndex < revised.length) {
    ops.push({ type: "insert", line: revised[newIndex], oldIndex, newIndex });
    newIndex += 1;
  }
  return ops;
}

function titleForPatchHunk(lines: string[], start: number): string {
  for (let index = Math.min(start, lines.length - 1); index >= 0; index -= 1) {
    const trimmed = lines[index]?.trim();
    if (!trimmed) continue;
    const numbered = trimmed.match(/^(\d+)\.\s+(.+)$/);
    if (numbered) return numbered[2].slice(0, 80);
    if (/^(say|note|if|when|closing|opener|objection)\b/i.test(trimmed)) {
      return trimmed.replace(/:$/, "").slice(0, 80);
    }
  }
  return "Script change";
}

function buildScriptPatchReview({
  original,
  revised,
  instruction,
  reason,
  source,
}: {
  original: string;
  revised: string;
  instruction: string;
  reason?: string;
  source: ScriptPatchReview["source"];
}): ScriptPatchReview | null {
  const originalLines = splitScriptLines(original);
  const revisedLines = splitScriptLines(revised);
  const ops = diffScriptLines(originalLines, revisedLines);
  const hunks: ScriptPatchHunk[] = [];
  let pending: Omit<ScriptPatchHunk, "id" | "title" | "beforeLines" | "afterLines" | "status"> | null = null;

  const flush = () => {
    if (!pending) return;
    const oldEnd = pending.oldStart + pending.deleteCount;
    const index = hunks.length + 1;
    hunks.push({
      ...pending,
      id: `change-${index}`,
      title: titleForPatchHunk(originalLines, pending.oldStart),
      beforeLines: originalLines.slice(Math.max(0, pending.oldStart - 2), pending.oldStart),
      afterLines: originalLines.slice(oldEnd, oldEnd + 2),
      status: "pending",
    });
    pending = null;
  };

  for (const op of ops) {
    if (op.type === "equal") {
      flush();
      continue;
    }
    if (!pending) {
      pending = {
        oldStart: op.oldIndex,
        deleteCount: 0,
        oldLines: [],
        newLines: [],
      };
    }
    if (op.type === "delete") {
      pending.oldLines.push(op.line);
      pending.deleteCount += 1;
    } else {
      pending.newLines.push(op.line);
    }
  }
  flush();

  if (hunks.length === 0) return null;
  return { original, revised, instruction, reason, source, hunks };
}

function composeAcceptedPatch(review: ScriptPatchReview): string {
  const originalLines = splitScriptLines(review.original);
  const ordered = [...review.hunks].sort((a, b) => a.oldStart - b.oldStart);
  const nextLines: string[] = [];
  let cursor = 0;

  for (const hunk of ordered) {
    nextLines.push(...originalLines.slice(cursor, hunk.oldStart));
    nextLines.push(...(hunk.status === "accepted" ? hunk.newLines : hunk.oldLines));
    cursor = hunk.oldStart + hunk.deleteCount;
  }
  nextLines.push(...originalLines.slice(cursor));
  return joinScriptLines(nextLines);
}

/**
 * Diagnostics arrive on the import response; typed defensively so the studio
 * compiles whether or not the import pipeline reports them yet.
 */
function importResultDiagnostics(result: ScriptImportResult): CampaignDiagnostic[] {
  return (result as ScriptImportResult & { diagnostics?: CampaignDiagnostic[] }).diagnostics ?? [];
}

const STARTER_ICONS: Record<StarterChip["iconKey"], ReactNode> = {
  trending: <TrendingUp className="size-4" />,
  refresh: <RefreshCw className="size-4" />,
  phone: <PhoneCall className="size-4" />,
  file: <FileCheck className="size-4" />,
};


function ScriptEditor({
  scriptText,
  onChange,
  selectedSegment,
  starterChips,
  scriptOptions,
  suggestingScripts,
  rewritingScript,
  campaignBrief,
  setCampaignBrief,
  purposeSuggestions,
  suggestingPurposes,
  generatingDraft,
  onSuggestPurposes,
  onUsePurpose,
  onUseBriefOnly,
  onUsePurposeSuggestion,
  onUseScriptOption,
  onGenerateDraft,
  onAiRefineScript,
  onAiEditAccepted,
  onImportScript,
  onApplyImportedScript,
  openItems,
  onDismissOpenItem,
}: {
  scriptText: string;
  onChange: (s: string) => void;
  selectedSegment: Segment | undefined;
  starterChips: Chip[];
  scriptOptions: VoiceScriptOption[];
  suggestingScripts: boolean;
  rewritingScript: boolean;
  campaignBrief: string;
  setCampaignBrief: (b: string) => void;
  purposeSuggestions: VoicePurposeSuggestion[];
  suggestingPurposes: boolean;
  generatingDraft: boolean;
  onSuggestPurposes: () => void;
  onUsePurpose: (purpose: Purpose) => void;
  onUseBriefOnly: () => void;
  onUsePurposeSuggestion: (s: VoicePurposeSuggestion) => void;
  onUseScriptOption: (option: VoiceScriptOption) => void;
  onGenerateDraft: () => void;
  onAiRefineScript: (instruction: string) => Promise<ScriptAiRefineResult>;
  onAiEditAccepted: () => void;
  onImportScript: (file: File) => Promise<ScriptImportResult | null>;
  onApplyImportedScript: (result: ScriptImportResult, script: string) => Promise<void>;
  openItems: CampaignDiagnostic[];
  onDismissOpenItem?: (id: string) => void;
}) {
  const hasScript = scriptText.trim().length > 0;
  const [patchReview, setPatchReview] = useState<ScriptPatchReview | null>(null);
  const [refineInstruction, setRefineInstruction] = useState("");
  const [aiRefiningScript, setAiRefiningScript] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<ScriptImportResult | null>(null);
  /** Import held for review because a script was already present. */
  const pendingImportRef = useRef<ScriptImportResult | null>(null);
  const scriptTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Grow with content — newline-based `rows` undercounts wrapped lines, and
  // overflow-hidden then clipped the top/bottom of long scripts.
  useEffect(() => {
    const el = scriptTextareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.max(el.scrollHeight, 128)}px`;
  }, [scriptText, patchReview]);

  // Quick-pick chips: AI suggestions take priority over dataset-grounded starters
  const chips: Chip[] =
    scriptOptions.length > 0
      ? scriptOptions.map((o) => ({ label: o.title, brief: o.campaignBrief, icon: <Sparkles className="size-4" /> }))
      : starterChips;

  async function runScriptRefine() {
    const instruction = refineInstruction.trim();
    if (!instruction || aiRefiningScript) return;
    setAiRefiningScript(true);
    setAiError(null);
    setPatchReview(null);
    try {
      const result = await onAiRefineScript(instruction);
      const revised = result.script.trim();
      if (!revised) throw new Error("The AI did not return a revised script.");
      const review = buildScriptPatchReview({
        original: scriptText,
        revised,
        instruction,
        reason: result.reason,
        source: "script",
      });
      if (!review) throw new Error("The AI did not change the script.");
      setPatchReview(review);
      setRefineInstruction("");
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "Could not refine the script.");
    } finally {
      setAiRefiningScript(false);
    }
  }

  async function runImport(file: File) {
    if (importing) return;
    setImporting(true);
    setAiError(null);
    setPatchReview(null);
    pendingImportRef.current = null;
    try {
      const result = await onImportScript(file);
      if (!result) return; // error already surfaced by the handler
      setImportSummary(result);

      // Replacing existing work goes through the same hunk-level diff as an AI
      // refine, so an import can never silently discard an edited script.
      if (hasScript && normalizeScriptForComparison(scriptText) !== normalizeScriptForComparison(result.script)) {
        const review = buildScriptPatchReview({
          original: scriptText,
          revised: result.script,
          instruction: `Imported from ${file.name}`,
          reason: result.reasoning,
          source: "script",
        });
        if (review) {
          pendingImportRef.current = result;
          setPatchReview(review);
          return;
        }
      }
      await onApplyImportedScript(result, result.script);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "Could not import that script.");
    } finally {
      setImporting(false);
    }
  }

  function pickScriptFile() {
    fileInputRef.current?.click();
  }

  function updatePatchHunkStatus(hunkId: string, status: PatchHunkStatus) {
    setPatchReview((current) => current
      ? {
          ...current,
          hunks: current.hunks.map((hunk) => hunk.id === hunkId ? { ...hunk, status } : hunk),
        }
      : current,
    );
  }

  function updateAllPatchHunks(status: PatchHunkStatus) {
    setPatchReview((current) => current
      ? { ...current, hunks: current.hunks.map((hunk) => ({ ...hunk, status })) }
      : current,
    );
  }

  function applyPatchReview() {
    if (!patchReview) return;
    const merged = composeAcceptedPatch(patchReview);
    const pendingImport = pendingImportRef.current;
    onAiEditAccepted();
    setPatchReview(null);
    pendingImportRef.current = null;

    // An imported patch also carries the workflow, name and language, so commit
    // it through the import path rather than only writing script text.
    if (pendingImport) {
      void onApplyImportedScript(pendingImport, merged);
      return;
    }
    onChange(merged);
  }

  function rejectPatchReview() {
    setPatchReview(null);
    if (pendingImportRef.current) {
      pendingImportRef.current = null;
      setImportSummary(null);
    }
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-card">
      {/* Single hidden picker drives both the empty-state button and the prompt-bar icon */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".docx,.pdf,.txt,.md,.rtf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Reset so re-picking the same file fires onChange again.
          e.target.value = "";
          if (file) void runImport(file);
        }}
      />

      {/* Scrollable script — extra bottom padding so last line clears the prompt box */}
      <div className="min-h-0 flex-1 overflow-y-auto px-12 pt-10 pb-[300px]">
        {importSummary && !patchReview ? (
          <ImportSummaryBanner summary={importSummary} onDismiss={() => setImportSummary(null)} />
        ) : null}
        {!patchReview ? (
          <CampaignOpenItems items={openItems} onDismiss={onDismissOpenItem} />
        ) : null}
        {patchReview ? (
          <ScriptPatchReviewPanel
            review={patchReview}
            onSetHunkStatus={updatePatchHunkStatus}
            onSetAllHunks={updateAllPatchHunks}
            onApply={applyPatchReview}
            onReject={rejectPatchReview}
          />
        ) : (
          <textarea
            ref={scriptTextareaRef}
            value={scriptText}
            maxLength={VOICE_CAMPAIGN_EDITABLE_SCRIPT_MAX_CHARS}
            onChange={(e) => {
              setPatchReview(null);
              onChange(e.target.value);
              const el = e.currentTarget;
              el.style.height = "0px";
              el.style.height = `${Math.max(el.scrollHeight, 128)}px`;
            }}
            placeholder="Write your script here, or generate one from the call plan below…"
            rows={4}
            className="w-full resize-none overflow-hidden bg-transparent text-[13.5px] leading-8 text-foreground outline-none placeholder:text-muted-foreground/25"
            spellCheck={false}
          />
        )}

        {/* Empty script — offer the client-script upload where the text would go */}
        {!hasScript && !patchReview && (
          <div className="pointer-events-none flex min-h-[38vh] flex-col items-center justify-center gap-3">
            <button
              type="button"
              onClick={pickScriptFile}
              disabled={importing}
              className="pointer-events-auto flex items-center gap-2 rounded-none border border-border bg-background px-4 py-2.5 text-sm text-foreground/80 transition-colors hover:border-input hover:bg-muted/40 hover:text-foreground disabled:opacity-50"
            >
              {importing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              {importing ? "Reading script…" : "Upload script"}
            </button>
            <p className="pointer-events-none max-w-sm text-center text-xs leading-relaxed text-muted-foreground/60">
              {importing
                ? "Indexing stages and checking every line against the document."
                : "Import an existing client script — .docx, .pdf or text. Spoken lines are kept word for word."}
            </p>
          </div>
        )}
        <div className="mt-3 flex items-center justify-between gap-3 pb-2 text-xs text-muted-foreground">
          {rewritingScript ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="size-3 animate-spin" />
              Updating script
            </span>
          ) : (
            <span />
          )}
          <span
            className={
              scriptText.length >= VOICE_CAMPAIGN_EDITABLE_SCRIPT_MAX_CHARS
                ? "tabular-nums text-foreground"
                : "tabular-nums"
            }
            title="Maximum script length"
          >
            {scriptText.length.toLocaleString()} / {VOICE_CAMPAIGN_EDITABLE_SCRIPT_MAX_CHARS.toLocaleString()} chars
          </span>
        </div>
      </div>

      {/* CALL PLAN — floats at bottom */}
      <div className="absolute bottom-7 left-0 right-0 px-12">
        {/* Chips above */}
        {!campaignBrief && !hasScript && (
          <div className="mb-3">
            <p className="mb-2 text-xs text-muted-foreground/60">
              {selectedSegment ? `Scripts for ${selectedSegment.name}` : "Get started with"}
            </p>
            <div className="flex flex-wrap gap-2">
              {suggestingPurposes ? (
                // Shimmer placeholders while fetching
                ([120, 160, 140] as const).map((w, i) => (
                  <div
                    key={i}
                    style={{ width: w }}
                    className="h-9 rounded-[3px] border border-border bg-muted/30 animate-pulse"
                  />
                ))
              ) : (
                <>
                  {(purposeSuggestions.length > 0
                    ? purposeSuggestions.slice(0, 3).map((s) => ({ label: s.title, brief: s.campaignBrief, icon: <Sparkles className="size-4" />, suggestion: s }))
                    : chips
                  ).map((chip, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        if ("suggestion" in chip) { onUsePurposeSuggestion((chip as typeof chip & { suggestion: VoicePurposeSuggestion }).suggestion); return; }
                        const opt = scriptOptions.find((o) => o.title === chip.label);
                        if (opt) { onUseScriptOption(opt); return; }
                        if (chip.purpose) onUsePurpose(chip.purpose);
                        else onUseBriefOnly();
                        setCampaignBrief(chip.brief);
                      }}
                      className="flex items-center gap-2 rounded-none border border-border bg-background px-3 py-2 text-sm text-foreground/80 transition-colors hover:border-input hover:bg-muted/40 hover:text-foreground"
                    >
                      {chip.icon}
                      {chip.label}
                    </button>
                  ))}
                  {selectedSegment && purposeSuggestions.length === 0 && scriptOptions.length === 0 && !suggestingScripts && (
                    <button type="button" onClick={onSuggestPurposes} className="flex items-center gap-2 rounded-none border border-border bg-background px-3 py-2 text-sm text-foreground/50 transition-colors hover:border-input hover:text-foreground/80">
                      <Sparkles className="size-4" /> More ideas
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* Chat-style input card */}
        <div className="relative rounded-[1px] border border-input bg-background px-4 pt-4 pb-3 shadow-[0_8px_24px_rgb(26_26_22/0.08)]">
          {hasScript ? (
            <textarea
              value={refineInstruction}
              onChange={(e) => setRefineInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void runScriptRefine();
                }
              }}
              rows={2}
              placeholder="Tell AI what to change in this script..."
              className="w-full resize-none bg-transparent text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/50"
            />
          ) : (
            <textarea
              value={campaignBrief}
              onChange={(e) => {
                onUseBriefOnly();
                setCampaignBrief(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (selectedSegment && campaignBrief.trim().length >= 2 && !generatingDraft) onGenerateDraft();
                }
              }}
              rows={2}
              placeholder="What's this call about?"
              className="w-full resize-none bg-transparent text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/50"
            />
          )}
          <div className="flex items-center justify-between pt-1">
            {/* Import stays reachable once a script exists — the empty-state
                button is gone by then, and re-importing is a normal revision. */}
            <button
              type="button"
              onClick={pickScriptFile}
              disabled={importing}
              title="Upload a client script (.docx, .pdf, text)"
              aria-label="Upload a client script"
              className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
            >
              {importing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            </button>
            <button
              type="button"
              onClick={() => hasScript ? void runScriptRefine() : onGenerateDraft()}
              disabled={hasScript
                ? refineInstruction.trim().length < 2 || aiRefiningScript
                : !selectedSegment || campaignBrief.trim().length < 2 || generatingDraft}
              className="flex size-7 items-center justify-center rounded-full bg-foreground text-background transition-opacity disabled:opacity-30"
            >
              {(hasScript ? aiRefiningScript : generatingDraft)
                ? <Loader2 className="size-3.5 animate-spin" />
                : <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
              }
            </button>
          </div>
          {aiError && (
            <p className="mt-2 text-xs text-muted-foreground">{aiError}</p>
          )}
        </div>
      </div>

    </div>
  );
}

/**
 * Post-import report.
 *
 * The point of this panel is the verbatim result. The importer restructures a
 * client document with an LLM, so the operator needs to see whether every spoken
 * line still traces back to the source before this script dials anyone — and
 * exactly which lines do not.
 */
function ImportSummaryBanner({
  summary,
  onDismiss,
}: {
  summary: ScriptImportResult;
  onDismiss: () => void;
}) {
  const { verification: v } = summary;
  const nodeCount = summary.workflow.nodes.length;

  return (
    <div className="mx-auto mb-6 w-full max-w-5xl border border-border bg-background/60 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            Imported {nodeCount} {nodeCount === 1 ? "stage" : "stages"} from {summary.source}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {v.verbatim
              ? `All ${v.checkedLines} spoken lines match the document word for word.`
              : `${v.issues.length} of ${v.checkedLines} spoken lines do not match the document exactly — review them before calling.`}
            {summary.detectedLanguage ? ` Language detected: ${summary.detectedLanguage}.` : ""}
            {summary.truncated ? " The document was long and was clipped before indexing." : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss import summary"
          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {v.issues.length > 0 && (
        <ul className="mt-3 space-y-2 border-t border-border pt-3">
          {v.issues.slice(0, 8).map((issue, i) => (
            <li key={`${issue.nodeId}-${i}`} className="text-xs leading-relaxed">
              <span className="text-muted-foreground">{issue.nodeTitle}</span>
              <p className="mt-0.5 font-mono text-foreground/80">{issue.line}</p>
              {issue.closest ? (
                <p className="mt-0.5 font-mono text-muted-foreground/70">
                  document: {issue.closest}
                </p>
              ) : (
                <p className="mt-0.5 text-muted-foreground/70">No close match found in the document.</p>
              )}
            </li>
          ))}
          {v.issues.length > 8 && (
            <li className="text-xs text-muted-foreground">
              …and {v.issues.length - 8} more.
            </li>
          )}
        </ul>
      )}

      {v.unboundPlaceholders.length > 0 && (
        <p className="mt-3 border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
          These placeholders have no value to fill from and will be skipped on the call —
          set them in Context, or edit the line:{" "}
          <span className="font-mono text-foreground/80">{v.unboundPlaceholders.join(", ")}</span>
        </p>
      )}
    </div>
  );
}

function ScriptPatchReviewPanel({
  review,
  onSetHunkStatus,
  onSetAllHunks,
  onApply,
  onReject,
}: {
  review: ScriptPatchReview;
  onSetHunkStatus: (hunkId: string, status: PatchHunkStatus) => void;
  onSetAllHunks: (status: PatchHunkStatus) => void;
  onApply: () => void;
  onReject: () => void;
}) {
  const acceptedCount = review.hunks.filter((hunk) => hunk.status === "accepted").length;
  const decidedCount = review.hunks.filter((hunk) => hunk.status !== "pending").length;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <div className="sticky top-0 z-10 -mx-2 rounded-xl border border-border bg-background/95 px-4 py-3 shadow-xl backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Review AI patch</p>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
              Whole-script refinement:
              {" "}{review.instruction}
            </p>
            {review.reason ? (
              <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
                {review.reason}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <span className="rounded-md px-2 py-1 text-xs text-muted-foreground shadow-[0_0_0_1px_var(--color-border)]">
              {acceptedCount} accepted · {decidedCount}/{review.hunks.length} decided
            </span>
            <button
              type="button"
              onClick={() => onSetAllHunks("accepted")}
              className="rounded-md px-2.5 py-1.5 text-xs font-medium text-foreground shadow-[0_0_0_1px_var(--color-border)] transition-colors hover:bg-muted"
            >
              Accept all
            </button>
            <button
              type="button"
              onClick={onReject}
              className="rounded-md px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              Reject all
            </button>
            <button
              type="button"
              disabled={acceptedCount === 0}
              onClick={onApply}
              className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-35"
            >
              Apply accepted
            </button>
          </div>
        </div>
      </div>

      {review.hunks.map((hunk, index) => (
        <ScriptPatchHunkCard
          hunk={hunk}
          index={index}
          key={hunk.id}
          onStatus={(status) => onSetHunkStatus(hunk.id, status)}
        />
      ))}
    </div>
  );
}

function ScriptPatchLine({
  prefix,
  line,
  kind,
}: {
  prefix: string;
  line: string;
  kind: "context" | "removed" | "added";
}) {
  const className =
    kind === "removed"
      ? "bg-red-950/20 text-red-100"
      : kind === "added"
        ? "bg-emerald-950/20 text-emerald-100"
        : "text-muted-foreground";

  return (
    <div className={`grid grid-cols-[34px_minmax(0,1fr)] ${className}`}>
      <div className="select-none border-r border-border/50 px-2 py-1.5 text-center font-mono text-xs text-muted-foreground">
        {prefix}
      </div>
      <div className="whitespace-pre-wrap px-3 py-1.5 text-sm leading-6">
        {line || " "}
      </div>
    </div>
  );
}

function ScriptPatchHunkCard({
  hunk,
  index,
  onStatus,
}: {
  hunk: ScriptPatchHunk;
  index: number;
  onStatus: (status: PatchHunkStatus) => void;
}) {
  const statusLabel = hunk.status === "accepted"
    ? "Accepted"
    : hunk.status === "rejected"
      ? "Rejected"
      : "Pending";

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-background shadow-[0_0_0_1px_var(--color-border)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            Change {index + 1}: {hunk.title}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Around line {hunk.oldStart + 1} · {statusLabel}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => onStatus("rejected")}
            className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors ${
              hunk.status === "rejected"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <X className="size-3.5" />
            Reject
          </button>
          <button
            type="button"
            onClick={() => onStatus("accepted")}
            className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${
              hunk.status === "accepted"
                ? "bg-foreground text-background"
                : "text-foreground shadow-[0_0_0_1px_var(--color-border)] hover:bg-muted"
            }`}
          >
            <Check className="size-3.5" />
            Accept
          </button>
        </div>
      </div>

      <div className="divide-y divide-border/50">
        {hunk.beforeLines.map((line, contextIndex) => (
          <ScriptPatchLine
            key={`before-${contextIndex}`}
            kind="context"
            line={line}
            prefix=" "
          />
        ))}
        {hunk.oldLines.map((line, lineIndex) => (
          <ScriptPatchLine
            key={`old-${lineIndex}`}
            kind="removed"
            line={line}
            prefix="-"
          />
        ))}
        {hunk.newLines.map((line, lineIndex) => (
          <ScriptPatchLine
            key={`new-${lineIndex}`}
            kind="added"
            line={line}
            prefix="+"
          />
        ))}
        {hunk.afterLines.map((line, contextIndex) => (
          <ScriptPatchLine
            key={`after-${contextIndex}`}
            kind="context"
            line={line}
            prefix=" "
          />
        ))}
      </div>
    </section>
  );
}

export default function NewVoiceCampaignPage() {
  const studio = useCampaignStudio();
  const { draft, setters, actions, handlers, nodes, edges } = studio;
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [dismissedOpenItems, setDismissedOpenItems] = useState<string[]>([]);

  const draftDiagnostics = draft.diagnostics;
  const draftUniversalRoutes = (draft.template as VoiceCampaignTemplateWithRoutes | null)?.universalRoutes;

  /**
   * Open items = what the import/generation reported plus what the workflow
   * fails right now. Recomputed from live nodes/edges so fixing a gap in the
   * canvas clears the item without a regeneration.
   */
  const openItems = useMemo<CampaignDiagnostic[]>(() => {
    const items: CampaignDiagnostic[] = [...draftDiagnostics];
    if (nodes.length > 0) {
      const { issues } = validateVoiceCampaignWorkflow({
        nodes: nodes.map((node) => ({ id: node.id, kind: node.data.kind })),
        edges: edges.map((edge) => ({
          source: edge.source,
          target: edge.target,
          label: typeof edge.label === "string" ? edge.label : null,
        })),
        universalRoutes: draftUniversalRoutes ?? [],
      });
      // An import already reports each route kind the document had no wording
      // for, and says what happens instead. The validator's bare "Missing
      // universal route: <kind>" is the same fact with less information, so it
      // is dropped rather than listed twice.
      const explainedRouteKinds = new Set(
        draftDiagnostics
          .filter((item) => item.id.startsWith("route-unbound-"))
          .map((item) => item.id.slice("route-unbound-".length)),
      );
      for (const issue of issues) {
        const missingRoute = issue.match(/^Missing universal route: (.+)$/);
        if (missingRoute && explainedRouteKinds.has(missingRoute[1])) continue;
        items.push({ id: `workflow:${issue}`, severity: "warn", source: "workflow", message: issue });
      }
    }
    const dismissed = new Set(dismissedOpenItems);
    const seen = new Set<string>();
    return items.filter((item) => {
      if (dismissed.has(item.id) || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }, [draftDiagnostics, draftUniversalRoutes, nodes, edges, dismissedOpenItems]);

  const dismissOpenItem = useCallback((id: string) => {
    setDismissedOpenItems((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);

  const setDiagnostics = setters.setDiagnostics;
  const generateDraftWithDiagnostics = useCallback(async () => {
    const result = await handlers.handleGenerateDraft();
    // A failed generation (null) keeps the previous draft on screen — its open
    // items must survive too.
    if (!result) return;
    setDismissedOpenItems([]);
    setDiagnostics(result.diagnostics ?? []);
  }, [handlers, setDiagnostics]);

  const applyImportedScriptWithDiagnostics = useCallback(async (
    result: ScriptImportResult,
    script: string,
  ) => {
    await handlers.handleApplyImportedScript(result, script);
    setDismissedOpenItems([]);
    // Verbatim mismatches and unbound placeholders already render in the
    // ImportSummaryBanner from the same verification object — listing them
    // again here would show every issue twice.
    setDiagnostics(
      importResultDiagnostics(result).filter(
        (item) => item.source !== "verbatim" && item.source !== "placeholder",
      ),
    );
  }, [handlers, setDiagnostics]);

  const {
    existingCampaignId,
    campaign, error, activeTab, setActiveTab,
    hasLoadedExistingCampaign, preparingExistingCampaign,
    savingCampaign, savingLanguage,
    showLiveTest, autoStartLiveTest, setAutoStartLiveTest,
    showCustomerModal, sampledCustomer, confirmCustomerAndStartTest, closeCustomerModal, openCustomerModalForPhone,
    preparingLiveTest, liveTestCampaignIdForPanel,
    openLiveTest, handleLiveTestClose,
    requestedCallId, requestedCallLogFilter,
    handleOverviewDrilldown, handleClearCallLogFilter,
    handleLanguageChange,
    promptPreview,
    segments, offers, dataset, loadingOptions,
  } = studio;

  // Dataset-grounded quick-pick chips: derived from the tenant's purpose
  // catalog (and the selected segment when there is one) — never from
  // domain-specific hardcoded lanes.
  const starterChips: Chip[] = useMemo(() => {
    const raw = draft.selectedSegment
      ? segmentStarterChips(draft.selectedSegment, offers, dataset?.entityName)
      : defaultStarterChips(offers, dataset?.entityName);
    return raw.map((chip: StarterChip) => ({
      label: chip.label,
      brief: chip.brief,
      icon: STARTER_ICONS[chip.iconKey],
      purpose: chip.purposeId
        ? offers.find((purpose) => purpose.purposeId === chip.purposeId)
        : undefined,
    }));
  }, [draft.selectedSegment, offers, dataset?.entityName]);

  const handleScriptAiRefine = useCallback(async (instruction: string): Promise<ScriptAiRefineResult> => {
    const result = await apiFetch<{ script?: string; reason?: string }>(
      withDataset("/api/voice-campaigns/rewrite-script", studio.datasetId),
      {
        method: "POST",
        datasetId: studio.datasetId,
        body: {
          datasetId: studio.datasetId,
          script: draft.scriptText,
          spokenLanguage: draft.language,
          instruction,
          segmentName: draft.selectedSegment?.name,
          purposeName: draft.selectedOffer?.name,
          voiceName: draft.agentName || draft.selectedVoiceName,
        },
      },
    );
    return {
      script: result.script ?? draft.scriptText,
      reason: result.reason,
    };
  }, [
    draft.agentName,
    draft.language,
    draft.scriptText,
    draft.selectedOffer?.name,
    draft.selectedSegment?.name,
    draft.selectedVoiceName,
    studio.datasetId,
  ]);

  const handleScriptAiAccepted = useCallback(() => {
    setters.setScriptHistory((prev) => [...prev.slice(-4), draft.scriptText]);
  }, [draft.scriptText, setters]);

  const selectedCallProviderLabel = "Gemini";

  // Inject sampled customer context into the system prompt for the live test panels
  const testSystemPrompt = sampledCustomer
    ? appendVoiceCustomerContextToSystemPrompt(promptPreview.systemPrompt ?? "", sampledCustomer)
    : (promptPreview.systemPrompt ?? "");

  // Restore sessionStorage draft script for new campaigns (no existing campaign, no script yet)
  useEffect(() => {
    if (existingCampaignId || draft.scriptText.trim()) return;
    try {
      const saved = sessionStorage.getItem("vc-draft-script");
      if (saved) setters.setScriptText(saved as Parameters<typeof setters.setScriptText>[0]);
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingCampaignId]);

  // Auto-fetch AI chips when segment selected and no script/brief yet
  const autoSuggestKeyRef = useRef("");
  useEffect(() => {
    if (!draft.selectedSegment || draft.scriptText.trim() || draft.campaignBrief.trim() || draft.purposeSuggestions.length > 0) return;
    const key = draft.segmentId;
    if (autoSuggestKeyRef.current === key) return;
    autoSuggestKeyRef.current = key;
    void handlers.handleSuggestPurposes();
  }, [draft.selectedSegment, draft.segmentId, draft.scriptText, draft.campaignBrief, draft.purposeSuggestions.length, handlers]);

  return (
    <div className="voice-campaign-studio relative flex h-full min-w-0 flex-col overflow-hidden bg-card">
      {error && (
        <div className="shrink-0 border-b border-border bg-muted/30 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Page header */}
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-sidebar px-5">
        <span className="shrink-0 text-[13.5px] font-semibold text-muted-foreground">Voice</span>
        <span className="shrink-0 text-muted-foreground/50">/</span>
        <input
          value={draft.campaignName || ""}
          onChange={(e) => setters.setCampaignName(e.target.value)}
          placeholder="Untitled campaign"
          className="min-w-0 flex-1 bg-transparent text-[13.5px] font-semibold tracking-[-0.015em] text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        <span className="shrink-0 rounded-[2px] border border-[#b9ddc6] bg-[var(--status-green-soft)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.07em] text-[var(--status-green)]">
          {campaign?.status ?? "Draft"}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void openLiveTest()}
          disabled={!draft.template || draft.generatingDraft || preparingLiveTest}
        >
          {preparingLiveTest ? <Loader2 className="size-4 animate-spin" /> : null}
          Talk
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => void actions.handleLaunch()}
          disabled={actions.launching || !draft.template || !draft.selectedSegment}
          className="border-[var(--brand-amber)] bg-[var(--brand-amber)] text-[var(--brand-amber-foreground)] hover:bg-[var(--brand-amber-hover)]"
        >
          {actions.launching ? <Loader2 className="size-4 animate-spin" /> : <Phone className="size-4" />}
          {actions.launching ? "Launching…" : "Launch"}
        </Button>
      </div>

      {preparingExistingCampaign && (
        <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" />
          Loading campaign
        </div>
      )}

      {!preparingExistingCampaign && (
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as Parameters<typeof setActiveTab>[0])}
          className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden"
        >
          {/* Tab bar — spans full width including right panel column */}
          <div className="flex shrink-0 items-center border-b border-border bg-muted/50 px-0">
            <VoiceCampaignTabList isLaunched={hasLoadedExistingCampaign} />
          </div>

          <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Center: tab content */}
          <main className="flex min-h-0 flex-1 flex-col overflow-hidden">

              {/* Script tab — always the text editor */}
              <TabsContent value="script" className="min-h-0 data-[state=active]:flex data-[state=active]:flex-col flex-1 data-[state=inactive]:hidden">
                <ScriptEditor
                  scriptText={draft.scriptText}
                  onChange={setters.setScriptText as (s: string) => void}
                  selectedSegment={draft.selectedSegment}
                  starterChips={starterChips}
                  scriptOptions={draft.scriptOptions}
                  suggestingScripts={draft.suggestingScripts}
                  rewritingScript={draft.rewritingScript}
                  campaignBrief={draft.campaignBrief}
                  setCampaignBrief={setters.setCampaignBrief as (b: string) => void}
                  purposeSuggestions={draft.purposeSuggestions}
                  suggestingPurposes={draft.suggestingPurposes}
                  generatingDraft={draft.generatingDraft}
                  onSuggestPurposes={() => void handlers.handleSuggestPurposes()}
                  onUsePurpose={handlers.handleUsePurpose}
                  onUseBriefOnly={handlers.handleUseBriefOnly}
                  onUsePurposeSuggestion={handlers.handleUsePurposeSuggestion}
                  onUseScriptOption={handlers.handleUseScriptOption}
                  onGenerateDraft={() => void generateDraftWithDiagnostics()}
                  onAiRefineScript={handleScriptAiRefine}
                  onAiEditAccepted={handleScriptAiAccepted}
                  onImportScript={handlers.handleImportScript}
                  onApplyImportedScript={applyImportedScriptWithDiagnostics}
                  openItems={openItems}
                  onDismissOpenItem={dismissOpenItem}
                />
              </TabsContent>

              {/* Workflow — ReactFlow canvas over the same nodes/edges the script compiles from */}
              <TabsContent value="workflow" className="min-h-0 data-[state=active]:flex flex-1 data-[state=inactive]:hidden">
                {draft.template ? (
                  <div className="flex min-h-0 flex-1 overflow-hidden">
                    <VoiceFlowCanvas
                      nodes={nodes}
                      edges={edges}
                      selectedNodeId={selectedNodeId}
                      onNodesChange={setters.onNodesChange}
                      onEdgesChange={setters.onEdgesChange}
                      onSelectNode={setSelectedNodeId}
                    />
                    <VoiceFlowInspector
                      selectedNode={nodes.find((node) => node.id === selectedNodeId) ?? null}
                      nodes={nodes}
                      onSelectNode={setSelectedNodeId}
                      showReadiness={!campaign || campaign.status === "draft"}
                      readiness={[
                        { label: "Campaign name", complete: draft.campaignName.trim().length > 0 },
                        { label: "Audience segment", complete: Boolean(draft.segmentId) },
                        { label: "Call purpose", complete: Boolean(draft.purposeId) },
                        { label: "Script", complete: draft.scriptText.trim().length > 0 },
                        {
                          label: "Start & end steps",
                          complete:
                            nodes.some((node) => node.data.kind === "start") &&
                            nodes.some((node) => node.data.kind === "end"),
                        },
                      ]}
                      onUpdateNode={setters.updateFlowNode}
                      onInsertNode={(afterNodeId, kind) => {
                        const newNodeId = setters.insertFlowNode(afterNodeId, kind);
                        if (newNodeId) setSelectedNodeId(newNodeId);
                      }}
                      onRemoveNode={(nodeId) => {
                        setters.removeFlowNode(nodeId);
                        setSelectedNodeId(null);
                      }}
                      onDeselect={() => setSelectedNodeId(null)}
                    />
                  </div>
                ) : (
                  <div className="flex flex-1 items-center justify-center bg-muted/25 text-sm text-muted-foreground">
                    Pick a segment and generate a script to see its workflow.
                  </div>
                )}
              </TabsContent>

              {/* Spotlight */}
              <TabsContent value="overview" className="min-h-0 overflow-y-auto p-6">
                <VoiceOverviewPanel campaign={campaign} onDrilldown={handleOverviewDrilldown as (d: VoiceOverviewDrilldown) => void} />
              </TabsContent>

              {/* Call Logs */}
              <TabsContent value="call-logs" className="min-h-0 overflow-y-auto p-6">
                <VoiceCallLogsPanel
                  campaign={campaign}
                  selectedCallRef={requestedCallId}
                  filter={requestedCallLogFilter}
                  onClearFilter={handleClearCallLogFilter}
                />
              </TabsContent>

              {/* Voice Analysis */}
              <TabsContent value="voice-analysis" className="min-h-0 overflow-y-auto p-6">
                <VoiceResponsesPanel campaign={campaign} />
              </TabsContent>

              {/* Guardrails */}
              <TabsContent value="guardrails" className="min-h-0 overflow-hidden data-[state=active]:flex data-[state=active]:flex-col data-[state=inactive]:hidden">
                <GuardrailsPanel
                  config={(draft.successDefinition?.guardrailsConfig as GuardrailsConfig | undefined) ?? defaultGuardrailsConfig()}
                  onChange={(nextConfig) => setters.setSuccessDefinition({
                    ...draft.successDefinition,
                    guardrailsConfig: nextConfig,
                    guardrails: guardrailsConfigToRules(nextConfig),
                  })}
                  onSave={() => void actions.handleSaveCampaignEdits()}
                  saving={savingCampaign}
                  canSave={hasLoadedExistingCampaign}
                />
              </TabsContent>

              {/* Success Metrics */}
              <TabsContent value="success-metrics" className="min-h-0 overflow-hidden data-[state=active]:flex data-[state=active]:flex-col data-[state=inactive]:hidden">
                <SuccessMetricsPanel
                  successDefinition={draft.successDefinition}
                  onChangeSuccessDefinition={setters.setSuccessDefinition}
                  onSave={() => void actions.handleSaveMeasurementSettings()}
                  saving={savingCampaign}
                  canSave={hasLoadedExistingCampaign}
                  campaignId={campaign?.id}
                  datasetId={studio.datasetId}
                  footer={hasLoadedExistingCampaign && (
                    <section className="rounded-lg bg-background p-4 shadow-[0_0_0_1px_var(--color-border)]">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <h3 className="text-sm font-semibold">Delete campaign</h3>
                          <p className="mt-1 text-sm text-muted-foreground">Permanently remove this campaign and its call logs.</p>
                        </div>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button type="button" variant="outline" disabled={actions.deletingCampaign} className="shrink-0">
                              {actions.deletingCampaign ? <Loader2 className="size-4 animate-spin" /> : null}
                              Delete campaign
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete voice campaign?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently delete &ldquo;{draft.campaignName || campaign?.name || "this campaign"}&rdquo; and its call logs. This cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => void actions.handleDeleteCampaign()}>Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </section>
                  )}
                />
              </TabsContent>

              {/* Connections + Activity log */}
              <TabsContent value="connections" className="min-h-0 overflow-y-auto data-[state=inactive]:hidden">
                <ConnectionsPanel campaignId={campaign?.id} />
              </TabsContent>
          </main>

          {/* Right config panel — Script tab only */}
          {activeTab === "script" && <CampaignConfigPanel
            segments={segments} loadingOptions={loadingOptions}
            segmentId={draft.segmentId} setSegmentId={setters.setSegmentId as (id: string) => void}
            selectedSegment={draft.selectedSegment}
            savingCampaign={savingCampaign}
            onSaveCampaign={() => void actions.handleSaveCampaignEdits()}
            hasLoadedExistingCampaign={hasLoadedExistingCampaign}
            language={draft.language} onLanguageChange={handleLanguageChange}
            savingLanguage={savingLanguage}
            callProvider={draft.callProvider} onCallProviderChange={setters.setCallProvider}
            agentName={draft.agentName} setAgentName={setters.setAgentName as (n: string) => void}
            companyName={draft.companyName} setCompanyName={setters.setCompanyName as (n: string) => void}
            campaignName={draft.campaignName} setCampaignName={setters.setCampaignName as (n: string) => void}
            personaPrompt={draft.personaPrompt} setPersonaPrompt={setters.setPersonaPrompt as (n: string) => void}
            voice={draft.voice} setVoice={setters.setVoice as (v: string) => void}
            previewingVoice={actions.previewingVoice}
            onPreviewVoice={actions.handlePreviewVoice}
            phoneRaw={draft.phoneRaw} setPhoneRaw={setters.setPhoneRaw as (r: string) => void}
            preparingLiveTest={preparingLiveTest}
            onOpenLiveTest={() => void openLiveTest()}
            onCallLive={async () => {
              if (!draft.phoneRaw.trim()) return;
              try {
                const campaignId = await actions.ensureLiveTestCampaign();
                if (!campaignId) return;
                openCustomerModalForPhone(
                  campaignId,
                  draft.phoneRaw.trim(),
                  async (cid, phone, ctx) => {
                    try {
                      await actions.handleCallUser(cid, undefined, undefined, phone, ctx, true);
                      toast.success("Call initiated — your phone should ring shortly");
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Failed to initiate call");
                    }
                  },
                );
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Failed to initiate call");
              }
            }}
            callLoading={actions.callLoading}
            campaignId={campaign?.id}
          />}
          </div>
        </Tabs>
      )}

      {/* Test customer sampling modal — shown before live test starts */}
      <TestCustomerModal
        open={showCustomerModal}
        datasetId={studio.datasetId}
        segmentSql={draft.selectedSegment?.sql}
        onConfirm={confirmCustomerAndStartTest}
        onCancel={closeCustomerModal}
      />

      {/* Live test overlay */}
      {showLiveTest && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 animate-in fade-in-0 bg-background/25 backdrop-blur-[2px] duration-200" />
          <div className="pointer-events-none absolute bottom-[calc(env(safe-area-inset-bottom)+1.25rem)] left-1/2 w-[min(620px,calc(100vw-24px))] -translate-x-1/2">
            <div className="pointer-events-auto w-full animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2 duration-200 motion-reduce:animate-none">
              <VoiceTestPanel
                campaignId={liveTestCampaignIdForPanel}
                systemPrompt={testSystemPrompt}
                firstMessage={promptPreview.firstMessage ?? ""}
                voice={draft.voice} datasetId={studio.datasetId}
                modelLabel={selectedCallProviderLabel}
                campaignName={draft.campaignName}
                autoStart={autoStartLiveTest}
                onAutoStartConsumed={() => setAutoStartLiveTest(false)}
                onClose={handleLiveTestClose}
                showVoiceMetadata
              />
            </div>
          </div>
        </div>
      )}

      {/* Call user dialog */}
      <Dialog
        open={actions.callDialogRow !== null}
        onOpenChange={(open) => {
          if (!open) { actions.setCallDialogRow(null); actions.setCallPhone(""); }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Call this customer</DialogTitle>
          </DialogHeader>
          {actions.callDialogRow && (
            <div className="space-y-4">
              <div className="space-y-1 rounded-md border border-border p-3 text-sm">
                {[
                  ["Name", actions.callDialogRow.full_name ?? actions.callDialogRow.customer_id],
                  ["Amount", actions.callDialogRow.amount_inr != null ? `₹${Number(actions.callDialogRow.amount_inr).toLocaleString("en-IN")}` : null],
                  ["Merchant", actions.callDialogRow.merchant_name ?? actions.callDialogRow.merchant_id],
                  ["City", actions.callDialogRow.txn_city],
                ]
                  .filter(([, v]) => v != null)
                  .map(([label, value]) => (
                    <div key={String(label)} className="flex gap-2">
                      <span className="w-20 shrink-0 text-muted-foreground">{String(label)}</span>
                      <span className="font-medium text-foreground">{String(value)}</span>
                    </div>
                  ))}
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Your phone number</label>
                <input
                  type="tel"
                  value={actions.callPhone}
                  onChange={(e) => actions.setCallPhone(e.target.value)}
                  placeholder="+91..."
                  className="w-full rounded-md border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-border"
                />
              </div>
              <button
                type="button"
                disabled={actions.callLoading || !actions.callPhone.trim()}
                onClick={async () => {
                  if (!campaign?.id || !actions.callPhone.trim()) return;
                  try {
                    await actions.handleCallUser(
                      campaign.id,
                      actions.callDialogRow?.customer_id ?? Object.values(actions.callDialogRow ?? {})[0],
                      actions.callDialogRow?.txn_id,
                      actions.callPhone.trim(),
                    );
                    toast.success("Call initiated");
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Failed to initiate call");
                  }
                }}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:opacity-90 disabled:opacity-50"
              >
                {actions.callLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Start call
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
