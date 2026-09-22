"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { FileText, Workflow } from "lucide-react";
import { PlaybookCanvas } from "@/components/playbook/playbook-canvas";
import { PlaybookInfoPanel } from "@/components/playbook/playbook-info-panel";
import { PlaybookOutputArtifact } from "@/components/playbook/playbook-output-artifact";
import { PlaybookNodeDetail } from "@/components/playbook/playbook-node-detail";
import { RunStatusPane } from "@/components/playbook/run-status-pane";
import { AutofixDiffCard } from "@/components/playbook/autofix-diff-card";
import {
  getPlaybook,
  savePlaybook,
  addRunHistory,
  updatePlaybook,
  updateCellV2,
  deletePlaybook,
} from "@/lib/playbook-store";
import type {
  PlaybookV2,
  PlaybookCellV2,
  PlaybookAnnotation,
  PlaybookChangelogEntry,
  PlaybookExecutionStateV2,
  AnyPlaybook,
  CellDiff,
  PlaybookPendingChanges,
  PlaybookRunHistory,
} from "@/lib/playbook-types";
import { isPlaybookV2, migrateToV2 } from "@/lib/playbook-types";
import { setPlaybookModifyHandler } from "@/lib/playbook-modify-event";
import { toast } from "sonner";
import { useChatPanel } from "@/components/chat/chat-panel-provider";
import { useChatState } from "@/components/chat/chat-state-provider";
import { apiFetch } from "@/lib/api-client";
import { useBreadcrumbTitle } from "@/lib/breadcrumb-context";
import { useDataset } from "@/lib/dataset-context";
import type { ChatMessage } from "@/lib/types";

// ── Annotation op type (returned by /api/playbook/intent) ──

interface AnnotationOp {
  action: "remove" | "add" | "modify";
  cellId: string | null;
  label?: string;
  description?: string;
  sql?: string;
  prompt?: string;
  type?: "sql" | "llm";
  role?: string;
  dependsOn?: string[];
}

/** Generate plausible dummy column names from a cell label for skeleton output variables */
function generateDummyColumns(label: string, role: string): string[] {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (role === "guardrail") return [`${slug}_check`, "is_valid"];
  if (role === "parameter") return [`${slug}_value`, "param_start", "param_end"];
  if (role === "summary" || role === "analysis") return [`${slug}_output`];
  // query role — generate 2-3 plausible columns
  const parts = slug.split("_").filter(Boolean);
  const dim = parts.find((p) => ["by", "per", "group"].some((k) => slug.includes(k + "_" + p))) ?? parts[parts.length - 1] ?? "id";
  return [dim, `${parts[0] ?? "metric"}_value`, "period"];
}

const INITIAL_EXEC_STATE: PlaybookExecutionStateV2 = {
  status: "idle",
  cellStatuses: {},
  cellResults: {},
  streamingText: {},
  context: {},
};

type PlaybookMainView = "builder" | "output";

function PlaybookWorkspaceModeBar({
  view,
  hasOutput,
  latestRunLabel,
  onViewChange,
}: {
  view: PlaybookMainView;
  hasOutput: boolean;
  latestRunLabel?: string;
  onViewChange: (view: PlaybookMainView) => void;
}) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-background px-4">
      <div className="flex items-center gap-1">
        <button
          onClick={() => onViewChange("builder")}
          className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${
            view === "builder"
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Workflow className="size-3.5" />
          Builder
        </button>
        <button
          onClick={() => hasOutput && onViewChange("output")}
          disabled={!hasOutput}
          className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            view === "output"
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <FileText className="size-3.5" />
          Output
        </button>
      </div>
      {latestRunLabel && (
        <span className="ml-auto hidden truncate text-xs text-muted-foreground md:block">
          Latest output: {latestRunLabel}
        </span>
      )}
    </div>
  );
}

function formatWorkspaceRunLabel(run?: PlaybookRunHistory): string | undefined {
  if (!run) return undefined;
  const date = new Date(run.date);
  const dateLabel = Number.isNaN(date.getTime())
    ? run.date
    : date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return `${run.result} · ${dateLabel}`;
}

function summarizeGeneratedCellsForLog(cells: PlaybookCellV2[]) {
  const sqlCells = cells.filter((cell) => cell.type === "sql");
  const llmCells = cells.filter((cell) => cell.type === "llm");
  return {
    total: cells.length,
    sql: sqlCells.length,
    llm: llmCells.length,
    missingSql: sqlCells.filter((cell) => !cell.sql?.trim()).map((cell) => cell.id),
    missingPrompt: llmCells.filter((cell) => !cell.prompt?.trim()).map((cell) => cell.id),
  };
}

function logPlaybookGeneration(clientRequestId: string, stage: string, data?: Record<string, unknown>) {
  console.log(`[playbook-gen:${clientRequestId}] ${stage}${data ? ` ${JSON.stringify(data)}` : ""}`);
}

export default function PlaybookDetailPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const playbookId = params.id as string;

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [execState, setExecState] = useState<PlaybookExecutionStateV2>(INITIAL_EXEC_STATE);
  const execStateRef = useRef<PlaybookExecutionStateV2>(INITIAL_EXEC_STATE);
  const updateExecState = useCallback((updater: React.SetStateAction<PlaybookExecutionStateV2>) => {
    const next = typeof updater === "function"
      ? (updater as (prev: PlaybookExecutionStateV2) => PlaybookExecutionStateV2)(execStateRef.current)
      : updater;
    execStateRef.current = next;
    setExecState(next);
  }, []);
  const [completedRunKey, setCompletedRunKey] = useState(0);
  const [pendingChangesKey, setPendingChangesKey] = useState(0);
  const [canvasExpandedView, setCanvasExpandedView] = useState(false);
  const [mainView, setMainView] = useState<PlaybookMainView>("builder");
  const [revision, setRevision] = useState(0);

  // Auto-fix state
  const [autoFixingCellId, setAutoFixingCellId] = useState<string | null>(null);
  const [pendingFix, setPendingFix] = useState<{
    cellId: string;
    cellLabel: string;
    oldSql: string;
    newSql: string;
    dependsOn?: string[];
    explanation: string;
  } | null>(null);

  // Validation results from dry run — used to reflect status on canvas
  const [validationResults, setValidationResults] = useState<Array<{ cellId: string; valid: boolean; error?: string }> | null>(null);

  // Annotation edit mode
  const [editMode, setEditMode] = useState(false);
  const [annotations, setAnnotations] = useState<PlaybookAnnotation[]>([]);
  const [isApplying, setIsApplying] = useState(false);
  const [applyingCellIds, setApplyingCellIds] = useState<Set<string>>(new Set());

  // Progressive build state
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingCells, setGeneratingCells] = useState<PlaybookCellV2[]>([]);
  const [generatingMeta, setGeneratingMeta] = useState<{ name: string; description: string } | null>(null);
  const [generationPhase, setGenerationPhase] = useState<"idle" | "discovering" | "outline" | "details" | "validating" | "repairing">("idle");
  const [filledCellIds, setFilledCellIds] = useState<Set<string>>(new Set());
  const [isPlanReviewMode, setIsPlanReviewMode] = useState(false);
  const hasStartedGeneration = useRef(false);
  const runStartTimeRef = useRef<number>(0);
  const runParamOverridesRef = useRef<Record<string, string> | undefined>(undefined);
  const generatingCellsRef = useRef<PlaybookCellV2[]>([]);
  // Keep refs in sync so event handlers can read latest values without stale closures
  execStateRef.current = execState;
  generatingCellsRef.current = generatingCells;

  // Load playbook from store
  const [rawPlaybook, setRawPlaybook] = useState<AnyPlaybook | null>(null);

  // Re-runs on mount and whenever `revision` bumps (after mutations like apply annotations).
  // Spread to create a new reference — updatePlaybook mutates in-place via Object.assign,
  // so getPlaybook returns the same ref. React skips re-render if ref is unchanged.
  useEffect(() => {
    const fromStore = getPlaybook(playbookId);
    setRawPlaybook(fromStore ? { ...fromStore } as AnyPlaybook : null);
  }, [playbookId, revision]);

  // Ensure we always work with V2
  const playbook: PlaybookV2 | null = useMemo(() => {
    if (!rawPlaybook) return null;
    if (isPlaybookV2(rawPlaybook)) return rawPlaybook;
    return migrateToV2(rawPlaybook);
  }, [rawPlaybook]);
  const playbookRef = useRef<PlaybookV2 | null>(null);
  playbookRef.current = playbook;
  const latestRun = playbook?.runHistory?.[0];

  useBreadcrumbTitle(rawPlaybook?.name ?? "");
  const { dataset } = useDataset();

  // ── Helper: merge new cell diffs with existing ones (cumulative tracking) ──
  function mergeCellDiffs(existing: CellDiff[], incoming: CellDiff[]): CellDiff[] {
    const merged = new Map<string, CellDiff>();
    // Seed with existing diffs
    for (const d of existing) merged.set(d.cellId, d);
    // Merge incoming
    for (const d of incoming) {
      const prev = merged.get(d.cellId);
      if (!prev) {
        // New diff — append
        merged.set(d.cellId, d);
      } else if (d.changeType === "removed" && prev.changeType === "added") {
        // Was added, now removed — cancel out
        merged.delete(d.cellId);
      } else if (d.changeType === "added" && prev.changeType === "removed") {
        // Was removed, now re-added — replace with the new add
        merged.set(d.cellId, d);
      } else {
        // Update existing: keep original "old" values, take latest "new" values
        merged.set(d.cellId, {
          ...d,
          cellLabel: d.cellLabel,
          changeType: d.changeType,
          sqlDiff: d.sqlDiff
            ? { old: prev.sqlDiff?.old ?? d.sqlDiff.old, new: d.sqlDiff.new }
            : prev.sqlDiff,
          promptDiff: d.promptDiff
            ? { old: prev.promptDiff?.old ?? d.promptDiff.old, new: d.promptDiff.new }
            : prev.promptDiff,
          labelDiff: d.labelDiff
            ? { old: prev.labelDiff?.old ?? d.labelDiff.old, new: d.labelDiff.new }
            : prev.labelDiff,
          descriptionDiff: d.descriptionDiff
            ? { old: prev.descriptionDiff?.old ?? d.descriptionDiff.old, new: d.descriptionDiff.new }
            : prev.descriptionDiff,
        });
      }
    }
    return Array.from(merged.values());
  }

  // Push entity context into chat
  const { setEntity, setDetailContent, setRightPanelMode, open: openChatPanel } = useChatPanel();
  useEffect(() => {
    if (playbook) {
      setEntity({
        id: playbook.id,
        name: playbook.name,
        type: "playbook",
        summary: `${playbook.owner} · ${playbook.cells.length} cells · ${playbook.cells.filter(c => c.type === "sql").length} SQL · ${playbook.cells.filter(c => c.type === "llm").length} LLM`,
        contextPayload: {
          description: playbook.description,
          category: playbook.category,
          sourceQuery: playbook.sourceQuery,
          cells: playbook.cells.map((c) => ({ label: c.label, description: c.description, sql: c.sql })),
          produces: playbook.produces,
        },
      });
    }
  }, [playbook, setEntity]);

  // Detail panel registration moved after selectedCells/handlers are declared (see below)

  // Cells to render: during generation use generatingCells, otherwise use playbook cells
  const displayCells = useMemo(
    () => (isGenerating || isPlanReviewMode ? generatingCells : (playbook?.cells ?? [])),
    [isGenerating, isPlanReviewMode, generatingCells, playbook]
  );

  // ── Chat-based creation wizard ──

  // Guided QnA steps (injected after the mode-choice card)
  // Use dataset-specific suggestions when available, fall back to generic
  const goalChips = useMemo(() =>
    dataset.suggestedPrompts?.slice(0, 5) ?? ["Week-over-week trends", "Revenue drop analysis", "User retention patterns", "Funnel conversion rates", "Performance audit"],
  [dataset.suggestedPrompts]);

  const GUIDED_STEPS = useMemo(() => [
    { key: "goal", question: "What do you want to understand?", inputType: "text" as const, placeholder: "e.g., " + (goalChips[0] ?? "Weekly performance trends"), chips: goalChips },
    { key: "metrics", question: "Which metrics matter most?", inputType: "text" as const, placeholder: "e.g., Revenue, Users, Conversion rate", chips: ["Revenue", "Users", "Conversion rate", "Retention", "Growth rate"] },
    { key: "period", question: "What time period?", inputType: "options" as const, options: ["Last 7 days", "Last 30 days", "Last 90 days", "Last 6 months"] },
    { key: "segments", question: "How should results be segmented? (optional)", inputType: "text" as const, placeholder: "e.g., By region, by category", chips: ["By region", "By category", "By channel", "By user cohort"], optional: true },
  ], [goalChips]);

  const isWizardMode = searchParams.get("wizard") === "true";
  const isFromThread = searchParams.get("fromThread") === "true";
  const isAutoRunMode = searchParams.get("autorun") === "true";
  const { setMessages, handleNewChat } = useChatState();
  const wizardStarted = useRef(false);
  const wizardAnswersRef = useRef<Record<string, string>>({});
  const wizardPathRef = useRef<"guided" | "detailed" | null>(null);
  const wizardLlmQuestionsRef = useRef<Array<{ key: string; question: string }>>([]);
  // True while the user is reviewing the skeleton plan (between outline and "Approve & Generate")

  // ── Auto-run mode state (effects are placed after handleRunPlaybook) ──
  const autoRunStarted = useRef(false);
  const autoRunParamsRef = useRef<Record<string, string>>({});

  // Start wizard: open chat panel and inject mode choice (skipped for thread conversions)
  useEffect(() => {
    if (!isWizardMode || wizardStarted.current || isFromThread) return;
    wizardStarted.current = true;
    setRightPanelMode("chat");
    openChatPanel();

    // Clear any stale wizard messages from prior sessions to prevent duplicate React keys
    setMessages((prev) => prev.filter((m) => !m.id.startsWith("wiz-")));

    const urlMode = searchParams.get("mode") as "guided" | "detailed" | null;

    if (urlMode === "guided") {
      // Skip mode-choice card — inject first guided question directly
      wizardPathRef.current = "guided";
      const introMsg: ChatMessage = {
        id: `wiz-intro-${Date.now()}`,
        role: "sentinel",
        content: "Let's create your playbook. I'll walk you through a few quick questions.",
        timestamp: Date.now(),
      };
      const firstStep: ChatMessage = {
        id: `wiz-step-${GUIDED_STEPS[0].key}`,
        role: "sentinel",
        content: "",
        timestamp: Date.now() + 1,
        variant: "playbook-wizard",
        playbookWizard: {
          stepKey: GUIDED_STEPS[0].key,
          stepIndex: 0,
          totalSteps: GUIDED_STEPS.length + 1,
          question: GUIDED_STEPS[0].question,
          inputType: GUIDED_STEPS[0].inputType,
          chips: (GUIDED_STEPS[0] as { chips?: string[] }).chips,
          placeholder: (GUIDED_STEPS[0] as { placeholder?: string }).placeholder,
          optional: (GUIDED_STEPS[0] as { optional?: boolean }).optional,
        },
      };
      setMessages((prev) => [...prev, introMsg, firstStep]);
    } else if (urlMode === "detailed") {
      // Skip mode-choice card — inject detailed instruction card directly
      wizardPathRef.current = "detailed";
      const introMsg: ChatMessage = {
        id: `wiz-intro-${Date.now()}`,
        role: "sentinel",
        content: "Let's create your playbook. Describe the analysis you'd like to build.",
        timestamp: Date.now(),
      };
      const detailedCard: ChatMessage = {
        id: "wiz-step-detailed",
        role: "sentinel",
        content: "",
        timestamp: Date.now() + 1,
        variant: "playbook-wizard",
        playbookWizard: {
          stepKey: "detailed",
          stepIndex: 0,
          totalSteps: 1,
          question: "Describe the analysis you want to build",
          inputType: "text",
          placeholder: "e.g., Analyze revenue trends by category, compare last 90 days vs prior period, break down by branch and service type, flag any drops > 10%",
          chips: [
            "Revenue drop analysis with category breakdown",
            "User retention cohort analysis",
            "Acquisition funnel by channel and platform",
          ],
        },
      };
      setMessages((prev) => [...prev, introMsg, detailedCard]);
    } else {
      // No mode param — show mode-choice card
      const introMsg: ChatMessage = {
        id: `wiz-intro-${Date.now()}`,
        role: "sentinel",
        content: "Let's create your playbook. How would you like to get started?",
        timestamp: Date.now(),
      };
      const modeCard: ChatMessage = {
        id: "wiz-step-mode",
        role: "sentinel",
        content: "",
        timestamp: Date.now() + 1,
        variant: "playbook-wizard",
        playbookWizard: {
          stepKey: "mode",
          stepIndex: 0,
          totalSteps: 1, // will update once path is chosen
          question: "Choose how to describe your playbook",
          inputType: "options",
          options: ["Guided QnA", "Detailed instruction"],
        },
      };
      setMessages((prev) => [...prev, introMsg, modeCard]);
    }
  }, [isWizardMode, setMessages, setRightPanelMode, openChatPanel, searchParams, GUIDED_STEPS]);

  // ── Thread conversion: skip QnA wizard, show plan review directly ──
  const fromThreadHandled = useRef(false);
  useEffect(() => {
    if (!isFromThread || fromThreadHandled.current || !playbook || playbook.cells.length === 0) return;
    fromThreadHandled.current = true;

    setRightPanelMode("chat");
    openChatPanel();
    setIsPlanReviewMode(true);

    const planCells = playbook.cells.map((c) => ({
      id: c.id, label: c.label, description: c.description,
      type: c.type, role: c.role, dependsOn: c.dependsOn,
    }));

    const introMsg: ChatMessage = {
      id: `thread-convert-intro`,
      role: "sentinel" as const,
      content: `I've analyzed your conversation and created a playbook with ${playbook.cells.length} cells. Review the plan below and approve to finalize, or modify it via chat.`,
      timestamp: Date.now(),
    };
    const planCard: ChatMessage = {
      id: `wiz-plan-${Date.now()}`,
      role: "sentinel" as const,
      content: "",
      timestamp: Date.now() + 1,
      variant: "playbook-plan-review" as const,
      playbookPlanReview: { cells: planCells, status: "pending" as const },
    };
    setMessages((prev) => [...prev, introMsg, planCard]);
  }, [isFromThread, playbook, setMessages, setRightPanelMode, openChatPanel]);

  // Listen for wizard answers and advance to next step (or start generation)
  useEffect(() => {
    if (!isWizardMode) return;

    function injectStep(step: typeof GUIDED_STEPS[number], idx: number, total: number) {
      const msg: ChatMessage = {
        id: `wiz-step-${step.key}`,
        role: "sentinel",
        content: "",
        timestamp: Date.now(),
        variant: "playbook-wizard",
        playbookWizard: {
          stepKey: step.key,
          stepIndex: idx,
          totalSteps: total,
          question: step.question,
          inputType: step.inputType,
          options: (step as { options?: string[] }).options,
          chips: (step as { chips?: string[] }).chips,
          placeholder: (step as { placeholder?: string }).placeholder,
          optional: (step as { optional?: boolean }).optional,
        },
      };
      setMessages((prev) => [...prev, msg]);
    }

    function buildQueryAndGenerate() {
      const a = wizardAnswersRef.current;
      const parts: string[] = [];
      if (a.goal) parts.push(`Analyze: ${a.goal}`);
      if (a.detailed) parts.push(a.detailed); // detailed instruction path
      if (a.metrics && a.metrics !== "(skipped)") parts.push(`Key metrics: ${a.metrics}`);
      if (a.period) parts.push(`Time period: ${a.period}`);
      if (a.segments && a.segments !== "(skipped)") parts.push(`Break down by: ${a.segments}`);
      // Include LLM follow-up answers
      for (const q of wizardLlmQuestionsRef.current) {
        const ans = a[q.key];
        if (ans && ans !== "(skipped)") parts.push(ans);
      }
      const query = parts.join(". ");
      const label = a.goal || a.detailed?.slice(0, 50) || "your analysis";

      const genMsg: ChatMessage = {
        id: `wiz-gen-${Date.now()}`,
        role: "sentinel",
        content: `Creating a plan for: **${label}**. You'll review the structure before I generate the SQL.`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, genMsg]);

      if (!hasStartedGeneration.current) {
        hasStartedGeneration.current = true;
        startGeneration(query, false, true);
      }
    }

    async function fetchLlmFollowUps(): Promise<Array<{ key: string; question: string }>> {
      try {
        const a = wizardAnswersRef.current;
        const context = `Goal: ${a.goal}. Metrics: ${a.metrics}. Period: ${a.period}. Segments: ${a.segments || "none"}.`;
        const res = await apiFetch<{ questions?: string[] }>("/api/playbook/clarify", {
          method: "POST",
          body: { context },
          skipModel: true,
        });
        return (res.questions ?? []).slice(0, 2).map((q, i) => ({
          key: `llm_q${i}`,
          question: q,
        }));
      } catch {
        return []; // If API fails, proceed without LLM questions
      }
    }

    async function handleWizardAnswer(e: Event) {
      const { stepKey, answer } = (e as CustomEvent).detail as { stepKey: string; answer: string };
      wizardAnswersRef.current[stepKey] = answer;

      // ── Mode choice ──
      if (stepKey === "mode") {
        if (answer === "Detailed instruction") {
          wizardPathRef.current = "detailed";
          const msg: ChatMessage = {
            id: "wiz-step-detailed",
            role: "sentinel",
            content: "",
            timestamp: Date.now(),
            variant: "playbook-wizard",
            playbookWizard: {
              stepKey: "detailed",
              stepIndex: 0,
              totalSteps: 1,
              question: "Describe the analysis you want to build",
              inputType: "text",
              placeholder: "e.g., Analyze revenue trends by category, compare last 90 days vs prior period, break down by branch and service type, flag any drops > 10%",
              chips: [
                "Revenue drop analysis with category breakdown",
                "User retention cohort analysis",
                "Acquisition funnel by channel and platform",
              ],
            },
          };
          setMessages((prev) => [...prev, msg]);
        } else {
          wizardPathRef.current = "guided";
          const total = GUIDED_STEPS.length + 1; // +1 for potential LLM questions placeholder
          injectStep(GUIDED_STEPS[0], 0, total);
        }
        return;
      }

      // ── Detailed instruction → generate directly ──
      if (stepKey === "detailed") {
        buildQueryAndGenerate();
        return;
      }

      // ── Guided QnA flow ──
      const guidedIdx = GUIDED_STEPS.findIndex((s) => s.key === stepKey);
      if (guidedIdx >= 0 && guidedIdx < GUIDED_STEPS.length - 1) {
        // More guided questions to go
        const total = GUIDED_STEPS.length + 1;
        injectStep(GUIDED_STEPS[guidedIdx + 1], guidedIdx + 1, total);
        return;
      }

      // Last guided question answered → fetch LLM follow-up questions
      if (guidedIdx === GUIDED_STEPS.length - 1) {
        // Show a brief "thinking" message
        const thinkingId = `wiz-thinking-${Date.now()}`;
        setMessages((prev) => [...prev, {
          id: thinkingId,
          role: "sentinel" as const,
          content: "Checking if I need any clarifications...",
          timestamp: Date.now(),
          variant: "gathering" as const,
        }]);

        const llmQuestions = await fetchLlmFollowUps();
        wizardLlmQuestionsRef.current = llmQuestions;

        // Remove thinking message
        setMessages((prev) => prev.filter((m) => m.id !== thinkingId));

        if (llmQuestions.length > 0) {
          // Inject a brief transition message before LLM follow-up questions
          const transitionMsg: ChatMessage = {
            id: `wiz-llm-transition-${Date.now()}`,
            role: "sentinel",
            content: "Based on your answers, I have a couple more clarifying questions:",
            timestamp: Date.now(),
          };
          // Inject the first LLM question
          const total = GUIDED_STEPS.length + llmQuestions.length;
          const msg: ChatMessage = {
            id: `wiz-step-${llmQuestions[0].key}`,
            role: "sentinel",
            content: "",
            timestamp: Date.now() + 1,
            variant: "playbook-wizard",
            playbookWizard: {
              stepKey: llmQuestions[0].key,
              stepIndex: GUIDED_STEPS.length,
              totalSteps: total,
              question: llmQuestions[0].question,
              inputType: "text",
              placeholder: "Type your answer...",
              optional: true,
            },
          };
          setMessages((prev) => [...prev, transitionMsg, msg]);
        } else {
          // No LLM questions — proceed to generation
          buildQueryAndGenerate();
        }
        return;
      }

      // ── LLM follow-up questions ──
      const llmIdx = wizardLlmQuestionsRef.current.findIndex((q) => q.key === stepKey);
      if (llmIdx >= 0 && llmIdx < wizardLlmQuestionsRef.current.length - 1) {
        // More LLM questions
        const nextQ = wizardLlmQuestionsRef.current[llmIdx + 1];
        const total = GUIDED_STEPS.length + wizardLlmQuestionsRef.current.length;
        const msg: ChatMessage = {
          id: `wiz-step-${nextQ.key}`,
          role: "sentinel",
          content: "",
          timestamp: Date.now(),
          variant: "playbook-wizard",
          playbookWizard: {
            stepKey: nextQ.key,
            stepIndex: GUIDED_STEPS.length + llmIdx + 1,
            totalSteps: total,
            question: nextQ.question,
            inputType: "text",
            placeholder: "Type your answer...",
            optional: true,
          },
        };
        setMessages((prev) => [...prev, msg]);
        return;
      }

      // All LLM questions answered → generate
      buildQueryAndGenerate();
    }

    window.addEventListener("playbook-wizard-answer", handleWizardAnswer);
    return () => window.removeEventListener("playbook-wizard-answer", handleWizardAnswer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWizardMode, GUIDED_STEPS, setMessages]);

  // Listen for plan approval → start full generation (or finalize for thread conversions)
  useEffect(() => {
    if (!isWizardMode) return;

    function handlePlanApproved() {
      if (isGenerating) return; // prevent double-click while actively generating
      setIsPlanReviewMode(false);

      // Mark plan card as generating (shows spinner)
      setMessages((prev) =>
        prev.map((m) =>
          m.variant === "playbook-plan-review" && m.playbookPlanReview
            ? { ...m, playbookPlanReview: { ...m.playbookPlanReview, status: "generating" as const } }
            : m
        )
      );

      // Thread conversion: cells already have SQL — no need to regenerate
      const pb = playbookRef.current;
      const hasExistingSql = isFromThread && pb?.cells.some((c) => c.sql || c.prompt);
      if (hasExistingSql) {
        setMessages((prev) => [
          ...prev,
          {
            id: `thread-complete-${Date.now()}`,
            role: "sentinel" as const,
            content: `Playbook **${pb?.name}** is ready! You can now run it or make further modifications.`,
            timestamp: Date.now(),
          },
        ]);
        return;
      }

      // Normal wizard flow: generate SQL from the outline
      const query = wizardQueryRef.current;
      if (!query) {
        console.warn("[playbook-gen] Plan approved but wizardQueryRef is empty — cannot generate");
        return;
      }

      // Start full generation (detail fill), keeping existing cells visible on canvas
      hasStartedGeneration.current = false;
      const reviewedCells = generatingCellsRef.current.length > 0 ? generatingCellsRef.current : pb?.cells;
      startGeneration(query, false, false, reviewedCells);
    }

    window.addEventListener("playbook-plan-approved", handlePlanApproved);
    return () => window.removeEventListener("playbook-plan-approved", handlePlanApproved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWizardMode, setMessages]);

  // ── Progressive Build: stream cells from generation API ──

  const generateQuery = searchParams.get("query");

  useEffect(() => {
    if (!generateQuery || hasStartedGeneration.current) return;
    hasStartedGeneration.current = true;
    startGeneration(generateQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generateQuery]);

  const wizardQueryRef = useRef<string>("");

  async function startGeneration(query: string, proceedWithout = false, planOnly = false, existingCells?: PlaybookCellV2[]) {
    const clientRequestId = Math.random().toString(36).slice(2, 8);
    logPlaybookGeneration(clientRequestId, "start", {
      playbookId,
      datasetId: dataset.id,
      queryPreview: query.slice(0, 120),
      queryLength: query.length,
      planOnly,
      proceedWithout,
      existingCellCount: existingCells?.length ?? 0,
      existingCells: existingCells ? summarizeGeneratedCellsForLog(existingCells) : undefined,
    });
    if (planOnly) wizardQueryRef.current = query;
    setIsGenerating(true);
    // If we have existing cells (from plan approval), keep them visible with skeleton flag
    // so the canvas shows the structure while SQL fills in
    if (existingCells && existingCells.length > 0) {
      setGeneratingCells(existingCells.map((c) => ({ ...c, skeleton: true })));
    } else {
      setGeneratingCells([]);
    }
    setGeneratingMeta(null);
    setGenerationPhase("discovering");
    setFilledCellIds(new Set());

    try {
      const res = await apiFetch("/api/playbook/create", {
        method: "POST",
        body: { query, proceedWithout, datasetId: dataset.id, clientRequestId },
        datasetId: dataset.id,
        stream: true,
      }) as Response;
      logPlaybookGeneration(clientRequestId, "response", {
        ok: res.ok,
        status: res.status,
        hasBody: !!res.body,
      });
      if (!res.ok || !res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulatedCells: PlaybookCellV2[] = existingCells ? [...existingCells.map((c) => ({ ...c, skeleton: true }))] : [];
      let meta: { name: string; description: string } | null = null;
      let accumulatedParams: PlaybookV2["params"] = [];
      let accumulatedProduces: PlaybookV2["produces"] = [];
      // When re-generating with existing cells, map API cell IDs → existing cell IDs
      const apiIdToExistingId = new Map<string, string>();
      let outlineCellIdx = 0;
      let filled = new Set<string>();
      let completed = false;
      let hadError = false;
      let restartProceedWithout = false;
      let restartExistingCells: PlaybookCellV2[] | undefined;

      function processEvent(event: Record<string, unknown>) {
        const eventType = String(event.type ?? "unknown");
        logPlaybookGeneration(clientRequestId, "event", {
          type: eventType,
          phase: event.phase,
          reqId: event.reqId,
          stage: event.stage,
          cellId: event.cellId,
          repair: event.repair,
          sqlLength: typeof event.sql === "string" ? event.sql.length : undefined,
          promptLength: typeof event.prompt === "string" ? event.prompt.length : undefined,
          message: eventType === "error" ? event.message : undefined,
        });
        switch (event.type) {
          case "phase":
            if (event.phase === "validating_sql") setGenerationPhase("validating");
            else if (event.phase === "repairing_sql") setGenerationPhase("repairing");
            else if (event.phase === "discovering_schema") setGenerationPhase("discovering");
            break;

          case "playbook_meta":
            meta = { name: event.name as string, description: event.description as string };
            setGeneratingMeta(meta);
            break;

          case "outline_start":
            setGenerationPhase("outline");
            break;

          case "outline_cell": {
            const raw = event.cell as PlaybookCellV2;
            if (existingCells && outlineCellIdx < existingCells.length) {
              // Map this API cell ID to the existing cell ID (by position)
              apiIdToExistingId.set(raw.id, existingCells[outlineCellIdx].id);
              outlineCellIdx++;
              // Don't add new cells — we already have the existing ones on canvas
            } else {
              // No existing cells or new cells beyond existing count — add normally
              const cell: PlaybookCellV2 = {
                ...raw,
                status: "idle",
                skeleton: true,
                outputs: planOnly && (!raw.outputs || raw.outputs.length === 0 || raw.outputs[0]?.startsWith("result_"))
                  ? generateDummyColumns(raw.label, raw.role)
                  : raw.outputs,
              };
              accumulatedCells = [...accumulatedCells, cell];
              logPlaybookGeneration(clientRequestId, "outline_cell:add", {
                cellId: cell.id,
                label: cell.label,
                type: cell.type,
                role: cell.role,
                accumulated: summarizeGeneratedCellsForLog(accumulatedCells),
              });
              setGeneratingCells([...accumulatedCells]);
            }
            break;
          }

          case "outline_complete":
            // All skeleton nodes now visible on canvas
            if (planOnly) {
              logPlaybookGeneration(clientRequestId, "plan_only:outline_complete", {
                accumulated: summarizeGeneratedCellsForLog(accumulatedCells),
              });
              reader.cancel();
              completed = true;
              // Don't strip skeleton flag — keep cells as the plan
            }
            break;

          case "detail_start":
            setGenerationPhase("details");
            break;

          case "cell_detail": {
            // Fill SQL/prompt into an existing skeleton cell
            // Map API cell ID to existing cell ID if we have existing cells
            const apiCellId = event.cellId as string;
            const cellId = apiIdToExistingId.get(apiCellId) ?? apiCellId;
            accumulatedCells = accumulatedCells.map((c) =>
              c.id === cellId
                ? {
                    ...c,
                    skeleton: false,
                    sql: (event.sql as string | undefined) ?? c.sql,
                    prompt: (event.prompt as string | undefined) ?? c.prompt,
                    outputs: (event.outputs as string[] | undefined) ?? c.outputs,
                    dependsOn: (event.dependsOn as string[] | undefined) ?? c.dependsOn,
                  }
                : c
            );
            logPlaybookGeneration(clientRequestId, "cell_detail:merged", {
              apiCellId,
              cellId,
              accumulated: summarizeGeneratedCellsForLog(accumulatedCells),
            });
            setGeneratingCells([...accumulatedCells]);
            filled = new Set([...filled, cellId]);
            setFilledCellIds(new Set(filled));
            break;
          }

          case "detail_complete":
            // All details filled
            break;

          // Legacy single-phase fallback: handle old-style `cell` events
          case "cell": {
            const cell: PlaybookCellV2 = {
              ...(event.cell as PlaybookCellV2),
              status: "idle",
            };
            accumulatedCells = [...accumulatedCells, cell];
            logPlaybookGeneration(clientRequestId, "legacy_cell:add", {
              cellId: cell.id,
              accumulated: summarizeGeneratedCellsForLog(accumulatedCells),
            });
            setGeneratingCells([...accumulatedCells]);
            break;
          }

          case "params":
            accumulatedParams = (event.params as PlaybookV2["params"]) ?? [];
            break;

          case "produces":
            accumulatedProduces = (event.produces as PlaybookV2["produces"]) ?? [];
            break;

          case "generation_complete":
            completed = true;
            break;

          case "connector_required":
            if (!proceedWithout) {
              restartProceedWithout = true;
              restartExistingCells = accumulatedCells.length > 0
                ? accumulatedCells.map((cell) => ({ ...cell, skeleton: true }))
                : existingCells;
              logPlaybookGeneration(clientRequestId, "connector_required:restart", {
                planOnly,
                accumulated: summarizeGeneratedCellsForLog(accumulatedCells),
              });
              reader.cancel();
            }
            break;

          case "error":
            hadError = true;
            logPlaybookGeneration(clientRequestId, "server_error", {
              message: event.message,
              accumulated: summarizeGeneratedCellsForLog(accumulatedCells),
            });
            toast.error((event.message as string) || "Generation failed");
            setIsGenerating(false);
            setGenerationPhase("idle");
            break;
        }
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        logPlaybookGeneration(clientRequestId, "chunk", { bytes: value.byteLength });
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop()!;

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            processEvent(JSON.parse(line));
          } catch {
            // skip malformed
          }
        }
      }

      // Process remaining buffer
      if (buffer.trim()) {
        for (const line of buffer.split("\n")) {
          if (!line.trim()) continue;
          try {
            processEvent(JSON.parse(line.trim()));
          } catch {
            // ignore
          }
        }
      }

      if (restartProceedWithout) {
        await startGeneration(query, true, planOnly, restartExistingCells);
        return;
      }

      // Strip skeleton flag so cells show their labels and descriptions on canvas.
      // In planOnly mode cells have no SQL yet, but descriptions should still be visible.
      accumulatedCells = accumulatedCells.map((c) =>
        c.skeleton ? { ...c, skeleton: false } : c
      );

      // Save only after the server validates generated SQL and emits generation_complete.
      logPlaybookGeneration(clientRequestId, "stream_ended", {
        cellCount: accumulatedCells.length,
        completed,
        hadError,
        planOnly,
        filledCount: filled.size,
        accumulated: summarizeGeneratedCellsForLog(accumulatedCells),
      });
      if (!planOnly && !hadError && completed && accumulatedCells.length > 0) {
        // Preserve datasetId from the existing skeleton; fall back to the currently
        // active dataset. Without this every wizard-generated playbook saves with
        // datasetId=undefined and runs/dry-runs against the wrong DuckDB.
        const existing = getPlaybook(playbookId) as PlaybookV2 | null;
        const pb: PlaybookV2 = {
          id: playbookId,
          schemaVersion: 2,
          name: (meta as { name: string; description: string } | null)?.name ?? "Untitled Playbook",
          description: (meta as { name: string; description: string } | null)?.description ?? "",
          category: "AI Generated",
          version: "v1.0",
          approvalStatus: "Draft",
          owner: "You",
          ownerInitials: "YO",
          datasetId: existing?.datasetId ?? dataset.id,
          cells: accumulatedCells,
          params: accumulatedParams,
          produces: accumulatedProduces,
          runHistory: [],
          changelog: [],
        };
        logPlaybookGeneration(clientRequestId, "save:attempt", {
          playbookId: pb.id,
          datasetId: pb.datasetId,
          cells: summarizeGeneratedCellsForLog(pb.cells),
          params: pb.params.map((param) => param.name),
          produces: pb.produces.map((produce) => produce.name),
        });
        const saved = savePlaybook(pb);
        logPlaybookGeneration(clientRequestId, "save:result", {
          playbookId: pb.id,
          saved,
        });
        setRevision((r) => r + 1);
      } else {
        logPlaybookGeneration(clientRequestId, "save:skipped", {
          reason: planOnly
            ? "plan_only"
            : hadError
              ? "server_error"
              : !completed
                ? "missing_generation_complete"
                : accumulatedCells.length === 0
                  ? "no_cells"
                  : "unknown",
          completed,
          hadError,
          planOnly,
          cellCount: accumulatedCells.length,
        });
      }
      setIsGenerating(false);
      setGenerationPhase("idle");

      // Mark any generating plan review cards as approved only after validated generation.
      if (!planOnly) {
        setMessages((prev) => {
          const updated = prev.map((m) =>
            m.variant === "playbook-plan-review" && m.playbookPlanReview?.status === "generating"
              ? {
                  ...m,
                  playbookPlanReview: {
                    ...m.playbookPlanReview,
                    status: !hadError && completed ? "approved" as const : "pending" as const,
                  },
                }
              : m
          );
          if (!hadError && completed && accumulatedCells.length > 0) {
            return [
              ...updated,
              {
                id: `wiz-gen-done-${Date.now()}`,
                role: "sentinel" as const,
                content: `Playbook generated with ${accumulatedCells.length} cells. You can now review and run it.`,
                timestamp: Date.now(),
              },
            ];
          }
          return updated;
        });
      }

      // In planOnly mode, enter plan review mode and inject alignment card
      if (planOnly && accumulatedCells.length > 0) {
        setIsPlanReviewMode(true);
        const planCells = accumulatedCells.map((c) => ({
          id: c.id, label: c.label, description: c.description,
          type: c.type, role: c.role, dependsOn: c.dependsOn,
        }));
        const reviewMsg: ChatMessage = {
          id: `wiz-plan-${Date.now()}`,
          role: "sentinel",
          content: "",
          timestamp: Date.now(),
          variant: "playbook-plan-review",
          playbookPlanReview: {
            cells: planCells,
            status: "pending",
          },
        };
        setMessages((prev) => [...prev, reviewMsg]);
      }
    } catch (err) {
      console.error("Generation error:", err);
      logPlaybookGeneration(clientRequestId, "client_exception", {
        message: err instanceof Error ? err.message : String(err),
      });
      toast.error("Failed to generate playbook");
      setIsGenerating(false);
      setGenerationPhase("idle");
      // Reset any generating plan review cards back to approved on error
      setMessages((prev) =>
        prev.map((m) =>
          m.variant === "playbook-plan-review" && m.playbookPlanReview?.status === "generating"
            ? { ...m, playbookPlanReview: { ...m.playbookPlanReview, status: "approved" as const } }
            : m
        )
      );
    }
  }

  // ── Delete ──

  const handleDeletePlaybook = useCallback(async () => {
    deletePlaybook(playbookId);
    try {
      await apiFetch(`/api/playbooks/${playbookId}`, { method: "DELETE", skipModel: true });
    } catch {
      // Client store already deleted — server will catch up
    }
    toast.success("Playbook deleted");
    router.push("/playbooks");
  }, [playbookId, router]);

  // ── Editing callbacks ──

  const handlePlaybookUpdate = useCallback(
    (changes: Partial<AnyPlaybook>) => {
      updatePlaybook(playbookId, changes);
      setRevision((r) => r + 1);
    },
    [playbookId]
  );

  const handleCellUpdate = useCallback(
    (cellId: string, changes: Partial<PlaybookCellV2>) => {
      updateCellV2(playbookId, cellId, changes);
      setRevision((r) => r + 1);
    },
    [playbookId]
  );

  // ── Auto-audit for pending changes ──

  const triggerAutoAudit = useCallback(
    async (id: string, cells: PlaybookCellV2[], params: PlaybookV2["params"]) => {
      // Mark as running
      updatePlaybook(id, {
        pendingChanges: {
          ...(getPlaybook(id) as PlaybookV2 | null)?.pendingChanges,
          reviewStatus: ((getPlaybook(id) as PlaybookV2 | null)?.pendingChanges?.reviewStatus ?? "none"),
          cellDiffs: ((getPlaybook(id) as PlaybookV2 | null)?.pendingChanges?.cellDiffs ?? []),
          auditStatus: "running",
        } as PlaybookPendingChanges,
      });
      setRevision((r) => r + 1);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30_000);

      try {
        const data = await apiFetch<{
          results?: Array<{ cellId: string; valid: boolean; error?: string }>;
        }>("/api/playbook/validate", {
          method: "POST",
          body: {
            cells,
            params,
            datasetId: (getPlaybook(id) as PlaybookV2 | null)?.datasetId,
          },
          skipModel: true,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const current = (getPlaybook(id) as PlaybookV2 | null)?.pendingChanges;
        if (!current) return;

        const errors = (data.results ?? [])
          .filter((r) => !r.valid)
          .map((r) => ({
            cellId: r.cellId,
            cellLabel: cells.find((c) => c.id === r.cellId)?.label ?? r.cellId,
            error: r.error ?? "Validation failed",
          }));

        updatePlaybook(id, {
          pendingChanges: {
            ...current,
            auditStatus: errors.length > 0 ? "fail" : "pass",
            auditErrors: errors,
          },
        });
        setRevision((r) => r + 1);
      } catch (err) {
        clearTimeout(timeoutId);
        const current = (getPlaybook(id) as PlaybookV2 | null)?.pendingChanges;
        if (!current) return;

        const isTimeout = err instanceof DOMException && err.name === "AbortError";
        updatePlaybook(id, {
          pendingChanges: {
            ...current,
            auditStatus: "fail",
            ...(isTimeout ? { auditErrors: [{ cellId: "", cellLabel: "", error: "Audit timed out" }] } : {}),
          },
        });
        setRevision((r) => r + 1);
      }
    },
    []
  );

  // ── Chat-based playbook modify handler ──
  // Registered with the global event bus so use-analytics.ts can trigger it.

  useEffect(() => {
    if (!playbook) return;
    const handler = async (message: string): Promise<string> => {
      const pb = playbook; // captured in closure
      const oldCellsMap = new Map(pb.cells.map((c) => [c.id, c]));

      // Call LLM to interpret the chat message as playbook modifications
      const normalizedAnnotations = [{ id: "chat_edit", cellId: null, text: message }];
      const intentResult = await apiFetch<{ ops: AnnotationOp[] }>("/api/playbook/intent", {
        method: "POST",
        body: { playbook: pb, annotations: normalizedAnnotations },
      });
      const { ops } = intentResult;
      if (!ops || ops.length === 0) return "No changes needed based on your input.";

      // Apply operations
      let cells = [...pb.cells];
      for (const op of ops) {
        if (op.action === "remove" && op.cellId) {
          cells = cells.filter((c) => c.id !== op.cellId);
          cells = cells.map((c) => ({ ...c, dependsOn: c.dependsOn.filter((dep) => dep !== op.cellId) }));
        } else if (op.action === "add") {
          const newId = `c${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
          const refQueryCell = pb.cells.find((c) => c.role === "query" && c.type === "sql");
          cells.push({
            id: newId,
            label: op.label ?? "New Query",
            description: op.description ?? "",
            type: (op.type as PlaybookCellV2["type"]) ?? "sql",
            role: (op.role as PlaybookCellV2["role"]) ?? "query",
            status: "idle",
            dependsOn: op.dependsOn ?? refQueryCell?.dependsOn ?? [],
            outputs: [`result_${newId}`],
            sql: op.type === "sql" || !op.type ? op.sql : undefined,
            prompt: op.type === "llm" ? op.prompt : undefined,
          });
        } else if (op.action === "modify" && op.cellId) {
          cells = cells.map((c) =>
            c.id !== op.cellId ? c : {
              ...c,
              ...(op.label ? { label: op.label } : {}),
              ...(op.description ? { description: op.description } : {}),
              ...(op.sql ? { sql: op.sql } : {}),
              ...(op.prompt ? { prompt: op.prompt } : {}),
            }
          );
        }
      }

      // ── Plan review mode: direct update (no changelog/diff flow) ──
      if (isPlanReviewMode) {
        // Generate dummy outputs for any new cells
        for (const c of cells) {
          if (!oldCellsMap.has(c.id) && (!c.outputs || c.outputs.length === 0 || c.outputs[0]?.startsWith("result_"))) {
            c.outputs = generateDummyColumns(c.label, c.role);
          }
        }
        const updated: PlaybookV2 = { ...pb, cells };
        savePlaybook(updated);
        setRevision((r) => r + 1);

        // Build change summary
        const changeParts: string[] = [];
        for (const op of ops) {
          if (op.action === "add") changeParts.push(`Added **${op.label ?? "new cell"}**`);
          else if (op.action === "remove") changeParts.push(`Removed **${oldCellsMap.get(op.cellId ?? "")?.label ?? "cell"}**`);
          else if (op.action === "modify") changeParts.push(`Updated **${op.label ?? oldCellsMap.get(op.cellId ?? "")?.label ?? "cell"}**`);
        }

        // Mark old plan review cards as stale (collapse them) and inject a NEW card
        const planCells = cells.map((c) => ({
          id: c.id, label: c.label, description: c.description,
          type: c.type, role: c.role, dependsOn: c.dependsOn,
        }));
        const newPlanCard: ChatMessage = {
          id: `wiz-plan-${Date.now()}`,
          role: "sentinel",
          content: "",
          timestamp: Date.now(),
          variant: "playbook-plan-review",
          playbookPlanReview: {
            cells: planCells,
            status: "pending",
            changeSummary: changeParts.join(". "),
          },
        };
        setMessages((prev) => [
          // Mark previous plan review cards as superseded (removes approve button)
          ...prev.map((m) =>
            m.variant === "playbook-plan-review" && m.playbookPlanReview?.status === "pending"
              ? { ...m, playbookPlanReview: { ...m.playbookPlanReview, status: "superseded" as const } }
              : m
          ),
          newPlanCard,
        ]);
        toast.success(`Plan updated: ${ops.length} change${ops.length > 1 ? "s" : ""}`);
        return `Plan updated. ${changeParts.join(", ")}.`;
      }

      // ── Normal mode: changelog + diff flow ──

      // Compute diffs
      const cellDiffs: CellDiff[] = [];
      for (const op of ops) {
        if (op.action === "add") {
          const nc = cells.find((c) => !oldCellsMap.has(c.id));
          if (nc) cellDiffs.push({ cellId: nc.id, cellLabel: nc.label, changeType: "added", sqlDiff: nc.sql ? { old: "", new: nc.sql } : undefined, promptDiff: nc.prompt ? { old: "", new: nc.prompt } : undefined });
        } else if (op.action === "remove" && op.cellId) {
          const old = oldCellsMap.get(op.cellId);
          cellDiffs.push({ cellId: op.cellId, cellLabel: old?.label ?? op.cellId, changeType: "removed" });
        } else if (op.action === "modify" && op.cellId) {
          const old = oldCellsMap.get(op.cellId);
          const upd = cells.find((c) => c.id === op.cellId);
          cellDiffs.push({
            cellId: op.cellId,
            cellLabel: upd?.label ?? op.label ?? op.cellId,
            changeType: "modified",
            sqlDiff: op.sql && old?.sql && op.sql !== old.sql ? { old: old.sql, new: op.sql } : undefined,
            promptDiff: op.prompt && old?.prompt && op.prompt !== old.prompt ? { old: old.prompt, new: op.prompt } : undefined,
            labelDiff: op.label && old?.label && op.label !== old.label ? { old: old.label, new: op.label } : undefined,
            descriptionDiff: op.description && old?.description && op.description !== old.description ? { old: old.description, new: op.description } : undefined,
          });
        }
      }

      // Build changelog entry
      const parts: string[] = [];
      const addC = cellDiffs.filter((d) => d.changeType === "added").length;
      const modC = cellDiffs.filter((d) => d.changeType === "modified").length;
      const remC = cellDiffs.filter((d) => d.changeType === "removed").length;
      if (addC > 0) parts.push(`Added ${addC} cell${addC > 1 ? "s" : ""}`);
      if (modC > 0) parts.push(`Modified ${modC} cell${modC > 1 ? "s" : ""}`);
      if (remC > 0) parts.push(`Removed ${remC} cell${remC > 1 ? "s" : ""}`);

      const changelogEntry: PlaybookChangelogEntry = {
        date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
        summary: parts.join(", ") || "Applied chat edit",
        changes: ops.map((op) => ({
          type: op.action === "add" ? "add" as const : op.action === "remove" ? "remove" as const : "modify" as const,
          cellLabel: op.label ?? oldCellsMap.get(op.cellId ?? "")?.label ?? "Cell",
          cellId: op.cellId ?? null,
          detail: op.sql ? "Updated SQL query" : op.prompt ? "Updated prompt" : op.label ? "Updated label" : undefined,
        })),
      };

      const mergedDiffs = cellDiffs.length > 0
        ? mergeCellDiffs(pb.pendingChanges?.cellDiffs ?? [], cellDiffs)
        : (pb.pendingChanges?.cellDiffs ?? []);
      const pendingChanges: PlaybookPendingChanges | undefined =
        mergedDiffs.length > 0
          ? { ...(pb.pendingChanges ?? { reviewStatus: "none", cellDiffs: [], auditStatus: "pending" }), cellDiffs: mergedDiffs, auditStatus: "pending" }
          : pb.pendingChanges;

      const updated: PlaybookV2 = {
        ...pb,
        cells,
        pendingChanges,
        changelog: [changelogEntry, ...(pb.changelog ?? [])],
      };
      savePlaybook(updated);
      setRevision((r) => r + 1);
      if (cellDiffs.length > 0) {
        setPendingChangesKey((k) => k + 1);
        triggerAutoAudit(playbookId, cells, pb.params);
      }
      toast.success(`Applied changes from chat`);
      return `Changes applied to **${pb.name}**. Review the diff in the **Changelog** tab and submit for approval when ready.`;
    };

    setPlaybookModifyHandler(handler);
    return () => setPlaybookModifyHandler(null);
  }, [playbook, playbookId, isPlanReviewMode, triggerAutoAudit, setMessages]);

  // ── Annotation callbacks ──

  const handleAddAnnotation = useCallback((cellId: string | null, text: string) => {
    const id = `anno_${Math.random().toString(36).slice(2, 8)}`;
    setAnnotations((prev) => {
      const next = [...prev, { id, cellId, text }];
      return next;
    });
  }, []);

  const handleRemoveAnnotation = useCallback((id: string) => {
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const handleRequestEditMode = useCallback(() => {
    setEditMode(true);
  }, []);

  const handleApplyAnnotations = useCallback(async () => {
    if (!playbook || annotations.length === 0) {
      return;
    }
    setIsApplying(true);
    setSelectedNodeId(null);

    // Capture old cells snapshot for diff computation
    const oldCellsMap = new Map(playbook.cells.map((c) => [c.id, c]));

    // Normalize step: prefixed cellIds — these are step-level annotations
    // For the intent API, send them with cellId: null (general)
    // For spinners, we don't spin specific cells for step-level annotations
    const normalizedAnnotations = annotations.map((a) => {
      if (a.cellId?.startsWith("step:")) {
        return { ...a, cellId: null };
      }
      return a;
    });

    // Compute which cell IDs are targeted for spinners (only for remove/modify, not add)
    // For add ops, spinners are set later on placeholder cells
    const affected = new Set<string>();
    for (const a of normalizedAnnotations) {
      if (a.cellId) {
        const text = a.text.toLowerCase();
        const isAdd = /\b(add|create|new|include|also\s+show|i\s+want|i\s+also|insert|append)\b/.test(text);
        if (!isAdd) {
          affected.add(a.cellId);
        }
      }
    }
    setApplyingCellIds(affected);

    // Classify annotations client-side for immediate UX (placeholder / spinner)
    const existingIds = new Set(playbook.cells.map((c) => c.id));
    const addPattern = /\b(add|create|new|include|also\s+show|i\s+want|i\s+also|insert|append)\b/i;
    const removePattern = /\b(remove|delete|drop|get\s+rid)\b/i;

    const isAddAnnotation = normalizedAnnotations.some((a) => addPattern.test(a.text));
    const _isRemoveAnnotation = normalizedAnnotations.some((a) => removePattern.test(a.text));

    // For add: insert a placeholder cell immediately with a spinner
    const placeholderIds = new Set<string>();
    const cellsSnapshot = [...playbook.cells];

    if (isAddAnnotation) {
      const refQueryCell = playbook.cells.find((c) => c.role === "query" && c.type === "sql");
      const placeholderId = `c${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
      placeholderIds.add(placeholderId);

      // Find insertion point — after an annotated cell, or after last query cell
      const targetAnno = normalizedAnnotations.find((a) => a.cellId && existingIds.has(a.cellId));
      let insertIdx: number;
      if (targetAnno) {
        insertIdx = cellsSnapshot.findIndex((c) => c.id === targetAnno.cellId) + 1;
      } else {
        const lastQueryIdx = cellsSnapshot.map((c, i) => c.role === "query" ? i : -1).filter((i) => i >= 0).pop();
        insertIdx = lastQueryIdx != null ? lastQueryIdx + 1 : cellsSnapshot.length;
      }

      const placeholder: PlaybookCellV2 = {
        id: placeholderId,
        label: "Generating...",
        description: "",
        type: "sql",
        role: refQueryCell?.role ?? "query",
        status: "idle",
        dependsOn: refQueryCell?.dependsOn ?? [],
        outputs: [`result_${placeholderId}`],
      };
      cellsSnapshot.splice(insertIdx, 0, placeholder);
      savePlaybook({ ...playbook, cells: cellsSnapshot });
      setApplyingCellIds(placeholderIds);
      setRevision((r) => r + 1);
    }

    // For remove/modify: spin the targeted cells
    if (!isAddAnnotation) {
      for (const a of normalizedAnnotations) {
        if (a.cellId) affected.add(a.cellId);
      }
      setApplyingCellIds(affected);
    }

    try {
      // Call LLM to parse intent + generate SQL/content
      const intentResult = await apiFetch<{ ops: AnnotationOp[] }>("/api/playbook/intent", {
        method: "POST",
        body: { playbook, annotations: normalizedAnnotations },
      });

      let { ops } = intentResult;

      // Safety: force any modify-with-add-text to be an add op
      ops = ops.map((op) => {
        if (op.action === "modify" && op.cellId) {
          // Check ALL annotations (any might have add intent)
          const hasAddIntent = normalizedAnnotations.some((a) => addPattern.test(a.text));
          if (hasAddIntent) {
            return { ...op, action: "add" as const, cellId: null };
          }
        }
        return op;
      });

      // Apply operations to the current cells (which may include placeholder)
      let cells = [...cellsSnapshot];

      for (const op of ops) {
        if (op.action === "remove" && op.cellId) {
          cells = cells.filter((c) => c.id !== op.cellId);
          cells = cells.map((c) => ({
            ...c,
            dependsOn: c.dependsOn.filter((dep) => dep !== op.cellId),
          }));
        } else if (op.action === "add") {
          // Replace placeholder if one exists, otherwise append
          const phId = [...placeholderIds][0];
          const phIdx = phId ? cells.findIndex((c) => c.id === phId) : -1;
          const newId = phId ?? `c${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
          const newCell: PlaybookCellV2 = {
            id: newId,
            label: op.label ?? "New Query",
            description: op.description ?? "",
            type: (op.type as PlaybookCellV2["type"]) ?? "sql",
            role: (op.role as PlaybookCellV2["role"]) ?? "query",
            status: "idle",
            dependsOn: op.dependsOn ?? cells.find((c) => c.id === phId)?.dependsOn ?? [],
            outputs: [`result_${newId}`],
            sql: op.type === "sql" || !op.type ? op.sql : undefined,
            prompt: op.type === "llm" ? op.prompt : undefined,
          };
          if (phIdx >= 0) {
            cells[phIdx] = newCell; // replace placeholder
          } else {
            cells.push(newCell);
          }
          placeholderIds.delete(phId); // consumed
        } else if (op.action === "modify" && op.cellId) {
          cells = cells.map((c) => {
            if (c.id !== op.cellId) return c;
            return {
              ...c,
              ...(op.label ? { label: op.label } : {}),
              ...(op.description ? { description: op.description } : {}),
              ...(op.sql ? { sql: op.sql } : {}),
              ...(op.prompt ? { prompt: op.prompt } : {}),
            };
          });
        }
      }

      // Remove any unconsumed placeholders (LLM didn't return an add op)
      if (placeholderIds.size > 0) {
        cells = cells.filter((c) => !placeholderIds.has(c.id));
      }

      // Build changelog entry from ops
      const changeItems: PlaybookChangelogEntry["changes"] = [];
      for (const op of ops) {
        if (op.action === "add") {
          changeItems.push({
            type: "add",
            cellLabel: op.label ?? "New cell",
            cellId: null,
          });
        } else if (op.action === "modify" && op.cellId) {
          const cell = playbook.cells.find((c) => c.id === op.cellId);
          changeItems.push({
            type: "modify",
            cellLabel: cell?.label ?? op.cellId,
            cellId: op.cellId,
            detail: op.sql ? "Updated SQL query" : op.prompt ? "Updated prompt" : op.label ? "Updated label" : undefined,
          });
        } else if (op.action === "remove" && op.cellId) {
          const cell = playbook.cells.find((c) => c.id === op.cellId);
          changeItems.push({
            type: "remove",
            cellLabel: cell?.label ?? op.cellId,
            cellId: null,
          });
        }
      }

      const parts: string[] = [];
      const addCount = changeItems.filter((c) => c.type === "add").length;
      const modCount = changeItems.filter((c) => c.type === "modify").length;
      const remCount = changeItems.filter((c) => c.type === "remove").length;
      if (addCount > 0) parts.push(`Added ${addCount} cell${addCount > 1 ? "s" : ""}`);
      if (modCount > 0) parts.push(`Modified ${modCount} cell${modCount > 1 ? "s" : ""}`);
      if (remCount > 0) parts.push(`Removed ${remCount} cell${remCount > 1 ? "s" : ""}`);

      const changelogEntry: PlaybookChangelogEntry = {
        date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
        summary: parts.join(", ") || "Applied annotations",
        changes: changeItems,
      };

      // ── Plan review mode: direct update (no changelog/diff) ──
      if (isPlanReviewMode) {
        for (const c of cells) {
          if (!oldCellsMap.has(c.id) && (!c.outputs || c.outputs.length === 0 || c.outputs[0]?.startsWith("result_"))) {
            c.outputs = generateDummyColumns(c.label, c.role);
          }
        }
        const updatedPlan: PlaybookV2 = { ...playbook, cells };
        savePlaybook(updatedPlan);
        setRevision((r) => r + 1);
        // Build change summary + inject new plan card (mark old as superseded)
        const changeSummary = changeItems.map((c) => `${c.type === "add" ? "Added" : c.type === "remove" ? "Removed" : "Updated"} **${c.cellLabel}**`).join(". ");
        const planCells = cells.map((c) => ({
          id: c.id, label: c.label, description: c.description,
          type: c.type, role: c.role, dependsOn: c.dependsOn,
        }));
        const newPlanCard: ChatMessage = {
          id: `wiz-plan-${Date.now()}`,
          role: "sentinel",
          content: "",
          timestamp: Date.now(),
          variant: "playbook-plan-review",
          playbookPlanReview: { cells: planCells, status: "pending", changeSummary },
        };
        setMessages((prev) => [
          ...prev.map((m) =>
            m.variant === "playbook-plan-review" && m.playbookPlanReview?.status === "pending"
              ? { ...m, playbookPlanReview: { ...m.playbookPlanReview, status: "superseded" as const } }
              : m
          ),
          newPlanCard,
        ]);
        toast.success(`Plan updated: ${annotations.length} change${annotations.length > 1 ? "s" : ""} applied`);
        setAnnotations([]);
        setEditMode(false);
        setIsApplying(false);
        setApplyingCellIds(new Set());
        return;
      }

      // ── Compute cell-level diffs for the review workflow ──
      const cellDiffs: CellDiff[] = [];
      for (const op of ops) {
        if (op.action === "add") {
          const newCell = cells.find((c) => !oldCellsMap.has(c.id));
          if (newCell) {
            cellDiffs.push({
              cellId: newCell.id,
              cellLabel: newCell.label,
              changeType: "added",
              sqlDiff: newCell.sql ? { old: "", new: newCell.sql } : undefined,
              promptDiff: newCell.prompt ? { old: "", new: newCell.prompt } : undefined,
            });
          }
        } else if (op.action === "remove" && op.cellId) {
          const old = oldCellsMap.get(op.cellId);
          cellDiffs.push({
            cellId: op.cellId,
            cellLabel: old?.label ?? op.cellId,
            changeType: "removed",
          });
        } else if (op.action === "modify" && op.cellId) {
          const old = oldCellsMap.get(op.cellId);
          const updated = cells.find((c) => c.id === op.cellId);
          cellDiffs.push({
            cellId: op.cellId,
            cellLabel: updated?.label ?? op.label ?? op.cellId,
            changeType: "modified",
            sqlDiff: op.sql && old?.sql && op.sql !== old.sql ? { old: old.sql, new: op.sql } : undefined,
            promptDiff: op.prompt && old?.prompt && op.prompt !== old.prompt ? { old: old.prompt, new: op.prompt } : undefined,
            labelDiff: op.label && old?.label && op.label !== old.label ? { old: old.label, new: op.label } : undefined,
            descriptionDiff: op.description && old?.description && op.description !== old.description ? { old: old.description, new: op.description } : undefined,
          });
        }
      }

      const mergedDiffs = cellDiffs.length > 0
        ? mergeCellDiffs(playbook.pendingChanges?.cellDiffs ?? [], cellDiffs)
        : (playbook.pendingChanges?.cellDiffs ?? []);
      const pendingChanges: PlaybookPendingChanges | undefined =
        mergedDiffs.length > 0
          ? { ...(playbook.pendingChanges ?? { reviewStatus: "none", cellDiffs: [], auditStatus: "pending" }), cellDiffs: mergedDiffs, auditStatus: "pending" }
          : playbook.pendingChanges;

      const updated: PlaybookV2 = {
        ...playbook,
        cells,
        pendingChanges,
        changelog: [changelogEntry, ...(playbook.changelog ?? [])],
      };
      savePlaybook(updated);
      setRevision((r) => r + 1);
      if (cellDiffs.length > 0) {
        setPendingChangesKey((k) => k + 1);
        // Auto-audit in background
        triggerAutoAudit(playbookId, cells, playbook.params);
      }
      toast.success(`Applied ${annotations.length} change${annotations.length > 1 ? "s" : ""}`);
      setAnnotations([]);
      setEditMode(false);
    } catch (err) {
      console.error("[apply] Error:", err);
      toast.error(err instanceof Error ? err.message : "Failed to apply changes");
    } finally {
      setIsApplying(false);
      setApplyingCellIds(new Set());
    }
  }, [playbook, annotations]);

  // ── Selected cell(s) — a step can contain multiple cells ──

  // Find the step group for the selected node
  const selectedStepCells = useMemo(() => {
    if (!selectedNodeId) return null;
    const clicked = displayCells.find((c) => c.id === selectedNodeId);
    if (!clicked) return null;

    const group = displayCells.filter((c) => c.role === clicked.role);
    const clickedDeps = JSON.stringify([...clicked.dependsOn].sort());
    const sameLevel = group.filter(
      (c) => JSON.stringify([...c.dependsOn].sort()) === clickedDeps
    );
    return sameLevel.length > 0 ? sameLevel : [clicked];
  }, [selectedNodeId, displayCells]);

  // Determine if a specific child cell is selected (vs the whole step).
  // In expanded view every node is an individual cell, so always single-cell.
  const isChildCellSelected = useMemo(() => {
    if (!selectedNodeId || !selectedStepCells) return false;
    // Expanded view: every click targets a single cell
    if (canvasExpandedView) return true;
    if (selectedStepCells.length <= 1) return false;
    // Grouped view: only non-first cells in the group are "child" clicks
    return selectedStepCells[0].id !== selectedNodeId;
  }, [canvasExpandedView, selectedNodeId, selectedStepCells]);

  // What to show in the detail pane
  const selectedCells = useMemo(() => {
    if (!selectedStepCells) return null;
    if (isChildCellSelected) {
      const cell = selectedStepCells.find((c) => c.id === selectedNodeId);
      return cell ? [cell] : selectedStepCells;
    }
    return selectedStepCells;
  }, [selectedStepCells, isChildCellSelected, selectedNodeId]);

  // ── Memoized pending diff cell IDs ──
  const pendingDiffCellIds = useMemo(
    () =>
      playbook?.pendingChanges?.cellDiffs
        ? new Set(playbook.pendingChanges.cellDiffs.map((d) => d.cellId))
        : undefined,
    [playbook?.pendingChanges?.cellDiffs]
  );

  // ── Auto-fix handler ──

  const handleAutoFix = useCallback(async (cellId: string) => {
    if (!playbook) return;
    const cell = playbook.cells.find((c) => c.id === cellId);
    if (!cell) return;
    const error = execState.cellResults[cellId]?.error;
    if (!error) return;

    setAutoFixingCellId(cellId);
    try {
      const data = await apiFetch<{ fixedSql?: string; dependsOn?: string[]; explanation?: string; error?: string }>(
        "/api/playbook/autofix",
        {
          method: "POST",
          body: {
            cell,
            error,
            datasetId: playbook.datasetId,
            playbookContext: {
              name: playbook.name,
              description: playbook.description,
              params: playbook.params,
              cells: playbook.cells.map((c) => ({
                id: c.id,
                label: c.label,
                description: c.description,
                type: c.type,
                role: c.role,
                dependsOn: c.dependsOn,
                outputs: c.outputs,
                sql: c.sql,
              })),
            },
          },
          skipModel: true,
        }
      );
      if (data.error || !data.fixedSql) {
        toast.error(data.error ?? "Could not generate a fix for this error");
        return;
      }
      setPendingFix({
        cellId,
        cellLabel: cell.label,
        oldSql: cell.sql ?? "",
        newSql: data.fixedSql,
        dependsOn: data.dependsOn,
        explanation: data.explanation ?? "Fixed SQL error",
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Auto-fix failed");
    } finally {
      setAutoFixingCellId(null);
    }
  }, [playbook, execState.cellResults]);

  const handleApplyFix = useCallback(() => {
    if (!pendingFix) return;
    handleCellUpdate(pendingFix.cellId, {
      sql: pendingFix.newSql,
      ...(pendingFix.dependsOn ? { dependsOn: pendingFix.dependsOn } : {}),
    });
    setPendingFix(null);
    updateExecState(INITIAL_EXEC_STATE);
    toast.success("Fix applied. Run the playbook to verify");
  }, [pendingFix, handleCellUpdate, updateExecState]);

  // Auto-fix from validation (dry run) — takes explicit error string
  const handleAutoFixFromValidation = useCallback(async (cellId: string, error: string) => {
    if (!playbook) return;
    const cell = playbook.cells.find((c) => c.id === cellId);
    if (!cell) return;

    setAutoFixingCellId(cellId);
    try {
      const data = await apiFetch<{ fixedSql?: string; dependsOn?: string[]; explanation?: string; error?: string }>(
        "/api/playbook/autofix",
        {
          method: "POST",
          body: {
            cell,
            error,
            datasetId: playbook.datasetId,
            playbookContext: {
              name: playbook.name,
              description: playbook.description,
              params: playbook.params,
              cells: playbook.cells.map((c) => ({
                id: c.id,
                label: c.label,
                description: c.description,
                type: c.type,
                role: c.role,
                dependsOn: c.dependsOn,
                outputs: c.outputs,
                sql: c.sql,
              })),
            },
          },
          skipModel: true,
        }
      );
      if (data.error || !data.fixedSql) {
        toast.error(data.error ?? "Could not generate a fix");
        return;
      }
      // Apply directly — no diff preview for validation fixes
      handleCellUpdate(cellId, {
        sql: data.fixedSql,
        ...(data.dependsOn ? { dependsOn: data.dependsOn } : {}),
      });
      toast.success(`Fixed "${cell.label}": ${data.explanation}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Auto-fix failed");
    } finally {
      setAutoFixingCellId(null);
    }
  }, [playbook, handleCellUpdate]);

  // ── Run handler (V2) ──

  const handleSSEEvent = useCallback((event: Record<string, unknown>) => {
    switch (event.type) {
      case "cell_start":
        updateExecState((prev) => ({
          ...prev,
          cellStatuses: {
            ...prev.cellStatuses,
            [event.cellId as string]: "running",
          },
        }));
        break;

      case "cell_result":
        updateExecState((prev) => ({
          ...prev,
          cellStatuses: {
            ...prev.cellStatuses,
            [event.cellId as string]: event.error ? "error" : "done",
          },
          cellResults: {
            ...prev.cellResults,
            [event.cellId as string]: {
              content: event.content as string | undefined,
              footer: event.footer as string | undefined,
              rowCount: event.rowCount as number | undefined,
              timeMs: event.timeMs as number | undefined,
              columns: event.columns as string[] | undefined,
              preview: event.preview as Record<string, unknown>[] | undefined,
              error: event.error as string | undefined,
            },
          },
        }));
        break;

      case "text":
        updateExecState((prev) => ({
          ...prev,
          streamingText: {
            ...prev.streamingText,
            [event.cellId as string]:
              (prev.streamingText[event.cellId as string] || "") +
              (event.delta as string),
          },
        }));
        break;

      case "done": {
        const snap = execStateRef.current;
        const pb = playbookRef.current;
        const summaries = pb?.cells.map((c) => ({
          cellId: c.id,
          label: c.label,
          rowCount: snap.cellResults[c.id]?.rowCount,
          timeMs: snap.cellResults[c.id]?.timeMs,
          status: (snap.cellStatuses[c.id] === "error" ? "error" : snap.cellStatuses[c.id] === "done" ? "done" : "skipped") as "done" | "error" | "skipped",
          columns: snap.cellResults[c.id]?.columns,
          preview: snap.cellResults[c.id]?.preview?.slice(0, 20),
          content: snap.streamingText[c.id] || snap.cellResults[c.id]?.content || undefined,
          error: snap.cellResults[c.id]?.error,
        }));
        const failedCount = summaries?.filter((s) => s.status === "error").length ?? 0;
        const doneCount = summaries?.filter((s) => s.status === "done").length ?? 0;
        const runStatus = failedCount === 0 ? "success" : doneCount > 0 ? "partial" : "failed";
        const run: PlaybookRunHistory = {
          date: new Date().toISOString(),
          who: "You",
          result: runStatus === "success" ? "Completed" : runStatus === "partial" ? "Partial" : "Failed",
          status: runStatus,
          runVia: "playbook",
          durationMs: Date.now() - runStartTimeRef.current,
          cellSummaries: summaries,
          paramOverrides: runParamOverridesRef.current,
        };
        addRunHistory(playbookId, run);
        updateExecState(INITIAL_EXEC_STATE);
        setMainView("output");
        setSelectedNodeId(null);
        setCompletedRunKey((k) => k + 1);
        setRevision((r) => r + 1);
        break;
      }

      case "error": {
        const snap = execStateRef.current;
        const pb = playbookRef.current;
        const failedEntry = Object.entries(snap.cellStatuses).find(([, s]) => s === "error");
        const failedCellId = failedEntry?.[0];
        const failedCell = pb?.cells.find((c) => c.id === failedCellId);
        const errMsg = failedCellId ? snap.cellResults[failedCellId]?.error : (event.message as string | undefined);
        const summaries = pb?.cells.map((c) => ({
          cellId: c.id,
          label: c.label,
          rowCount: snap.cellResults[c.id]?.rowCount,
          timeMs: snap.cellResults[c.id]?.timeMs,
          status: (snap.cellStatuses[c.id] === "error" ? "error" : snap.cellStatuses[c.id] === "done" ? "done" : "skipped") as "done" | "error" | "skipped",
          columns: snap.cellResults[c.id]?.columns,
          preview: snap.cellResults[c.id]?.preview?.slice(0, 20),
          content: snap.streamingText[c.id] || snap.cellResults[c.id]?.content || undefined,
          error: snap.cellResults[c.id]?.error,
        }));
        updateExecState((prev) => ({ ...prev, status: "error" }));
        const run: PlaybookRunHistory = {
          date: new Date().toISOString(),
          who: "You",
          result: "Failed",
          status: "failed",
          runVia: "playbook",
          durationMs: Date.now() - runStartTimeRef.current,
          failedCellId,
          failedCellLabel: failedCell?.label,
          error: errMsg,
          cellSummaries: summaries,
          paramOverrides: runParamOverridesRef.current,
        };
        addRunHistory(playbookId, run);
        setMainView("output");
        setSelectedNodeId(null);
        setRevision((r) => r + 1);
        break;
      }
    }
  }, [playbookId, updateExecState]);

  const handleRunPlaybook = useCallback(async (paramOverrides?: Record<string, string>) => {
    // Ensure playbook is in the store so addRunHistory can find it
    if (playbook && !getPlaybook(playbookId)) {
      savePlaybook(playbook);
    }

    runStartTimeRef.current = Date.now();
    runParamOverridesRef.current = paramOverrides;
    updateExecState({
      status: "running",
      cellStatuses: {},
      cellResults: {},
      streamingText: {},
      context: {},
    });

    try {
      const res = await apiFetch("/api/playbook/run", {
        method: "POST",
        body: { playbook, paramOverrides },
        stream: true,
      }) as Response;
      if (!res.ok || !res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let terminalEventSeen = false;

      function handleRunLine(line: string) {
        if (!line.trim()) return;
        try {
          const event = JSON.parse(line.trim()) as Record<string, unknown>;
          if (event.type === "done" || event.type === "error") terminalEventSeen = true;
          handleSSEEvent(event);
        } catch {
          // skip malformed line
        }
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop()!;

        for (const line of lines) {
          handleRunLine(line);
        }
      }

      // Process remaining buffer — may contain multiple lines
      if (buffer.trim()) {
        for (const line of buffer.split("\n")) {
          handleRunLine(line);
        }
      }

      if (!terminalEventSeen && execStateRef.current.status === "running") {
        console.warn("[playbook-run-ui] Stream closed without terminal event; finalizing from client fallback");
        handleSSEEvent({ type: "done" });
      }
    } catch (err) {
      console.error("Playbook run error:", err);
      updateExecState((prev) => ({ ...prev, status: "error" }));
      toast.error("Playbook execution failed.");
    }
  }, [playbook, playbookId, handleSSEEvent, updateExecState]);

  // ── Auto-run mode: inject param wizard cards then auto-execute ──

  useEffect(() => {
    if (!isAutoRunMode || autoRunStarted.current || !playbook) return;
    autoRunStarted.current = true;

    // Open chat panel so the user can see the param cards
    setRightPanelMode("chat");
    openChatPanel();

    const params = playbook.params ?? [];

    if (params.length === 0) {
      // No params — run immediately
      const runMsg: ChatMessage = {
        id: `autorun-start-${Date.now()}`,
        role: "sentinel",
        content: `Running **${playbook.name}** with default parameters...`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, runMsg]);
      handleRunPlaybook();
      return;
    }

    // Inject intro message + wizard card for first param
    const introMsg: ChatMessage = {
      id: `autorun-intro-${Date.now()}`,
      role: "sentinel",
      content: `Running **${playbook.name}**. Please confirm the parameters below.`,
      timestamp: Date.now(),
    };
    const firstParam = params[0];
    const firstCard: ChatMessage = {
      id: `autorun-param-${firstParam.name}`,
      role: "sentinel",
      content: "",
      timestamp: Date.now() + 1,
      variant: "playbook-wizard",
      playbookWizard: {
        stepKey: `autorun-${firstParam.name}`,
        stepIndex: 0,
        totalSteps: params.length,
        question: firstParam.label,
        inputType: firstParam.type === "boolean" ? "options" : "text",
        options: firstParam.type === "boolean" ? ["Yes", "No"] : undefined,
        placeholder: firstParam.defaultVal ? `Default: ${firstParam.defaultVal}` : undefined,
      },
    };
    setMessages((prev) => [...prev, introMsg, firstCard]);
  }, [isAutoRunMode, playbook, setMessages, setRightPanelMode, openChatPanel, handleRunPlaybook]);

  // Listen for autorun param answers and advance or trigger run
  useEffect(() => {
    if (!isAutoRunMode || !playbook) return;
    const params = playbook.params ?? [];
    if (params.length === 0) return;

    function handleAutoRunAnswer(e: Event) {
      const { stepKey, answer } = (e as CustomEvent).detail as { stepKey: string; answer: string };
      if (!stepKey.startsWith("autorun-")) return;

      const paramName = stepKey.replace("autorun-", "");
      // Store the answer (use default if skipped)
      const matchingParam = params.find((p) => p.name === paramName);
      const resolvedValue = answer === "(skipped)" && matchingParam?.defaultVal
        ? matchingParam.defaultVal
        : answer;
      autoRunParamsRef.current[paramName] = resolvedValue;

      // Find which param index we just answered
      const answeredIdx = params.findIndex((p) => p.name === paramName);
      if (answeredIdx < params.length - 1) {
        // Inject next param card
        const nextParam = params[answeredIdx + 1];
        const card: ChatMessage = {
          id: `autorun-param-${nextParam.name}`,
          role: "sentinel",
          content: "",
          timestamp: Date.now(),
          variant: "playbook-wizard",
          playbookWizard: {
            stepKey: `autorun-${nextParam.name}`,
            stepIndex: answeredIdx + 1,
            totalSteps: params.length,
            question: nextParam.label,
            inputType: nextParam.type === "boolean" ? "options" : "text",
            options: nextParam.type === "boolean" ? ["Yes", "No"] : undefined,
            placeholder: nextParam.defaultVal ? `Default: ${nextParam.defaultVal}` : undefined,
          },
        };
        setMessages((prev) => [...prev, card]);
      } else {
        // All params answered — auto-run with collected values
        const runMsg: ChatMessage = {
          id: `autorun-executing-${Date.now()}`,
          role: "sentinel",
          content: `All parameters confirmed. Running **${playbook!.name}**...`,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, runMsg]);
        handleRunPlaybook({ ...autoRunParamsRef.current });
      }
    }

    window.addEventListener("playbook-wizard-answer", handleAutoRunAnswer);
    return () => window.removeEventListener("playbook-wizard-answer", handleAutoRunAnswer);
  }, [isAutoRunMode, playbook, setMessages, handleRunPlaybook]);

  // Register detail panel content into unified right panel
  useEffect(() => {
    if (!playbook || isGenerating) {
      setDetailContent(null);
      return;
    }

    // In wizard mode, keep the chat panel open during interview and plan review
    if (isWizardMode && (isPlanReviewMode || (playbook.cells.length === 0 && !hasStartedGeneration.current))) {
      setDetailContent(null);
      return;
    }

    // Priority 1: pending auto-fix diff
    if (pendingFix) {
      setDetailContent(
        <AutofixDiffCard
          cellLabel={pendingFix.cellLabel}
          oldSql={pendingFix.oldSql}
          newSql={pendingFix.newSql}
          explanation={pendingFix.explanation}
          onApply={handleApplyFix}
          onDiscard={() => setPendingFix(null)}
        />
      );
      return () => setDetailContent(null);
    }

    // Priority 2: show run status only while running or on error; done collapses back to info panel
    if (execState.status === "running" || execState.status === "error") {
      setDetailContent(
        <RunStatusPane
          playbook={playbook}
          execState={execState}
          onAutoFix={handleAutoFix}
          onNewRun={() => updateExecState(INITIAL_EXEC_STATE)}
          isAutoFixing={autoFixingCellId}
        />
      );
      return () => setDetailContent(null);
    }

    // Priority 3: cell detail or info panel
    setDetailContent(
      selectedCells ? (
        <PlaybookNodeDetail
          cells={selectedCells}
          allCells={playbook.cells}
          owner={playbook.owner}
          ownerInitials={playbook.ownerInitials}
          onBack={() => {
            // In expanded view every cell is a direct click — go straight to info panel.
            // In grouped view, a child-cell click navigates up to the group first.
            if (!canvasExpandedView && isChildCellSelected && selectedStepCells) {
              setSelectedNodeId(selectedStepCells[0].id);
            } else {
              setSelectedNodeId(null);
            }
          }}
          onCellClick={setSelectedNodeId}
          executionState={execState}
          onCellUpdate={handleCellUpdate}
          cellDiffs={playbook.pendingChanges?.cellDiffs}
        />
      ) : (
        <PlaybookInfoPanel
          playbook={playbook}
          onRun={handleRunPlaybook}
          executionState={execState}
          onPlaybookUpdate={handlePlaybookUpdate}
          completedRunKey={completedRunKey}
          pendingChangesKey={pendingChangesKey}
          onOpenLatestOutput={() => setMainView("output")}
          onCellClick={setSelectedNodeId}
          onDelete={handleDeletePlaybook}
          onAutoFixCell={handleAutoFixFromValidation}
          onValidationResults={setValidationResults}
          isGenerating={isGenerating}
          onChatWithRunData={(run) => {
            // Build markdown tables from the run's cell summaries
            const tablesWithData = (run.cellSummaries ?? []).filter((s) => s.columns && s.preview && s.preview.length > 0);
            const tablesMd = tablesWithData.map((s) => {
              const cols = s.columns!;
              const header = `| ${cols.join(" | ")} |`;
              const sep = `| ${cols.map(() => "---").join(" | ")} |`;
              const rows = s.preview!.slice(0, 20).map((row) =>
                `| ${cols.map((c) => String(row[c] ?? "")).join(" | ")} |`
              );
              return `**${s.label}** (${s.rowCount?.toLocaleString() ?? "?"} rows)\n\n${header}\n${sep}\n${rows.join("\n")}`;
            }).join("\n\n---\n\n");

            const d = new Date(run.date);
            const runDate = isNaN(d.getTime()) ? run.date : d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
            const userMsg = `Show the output of the run from ${runDate} of playbook "${playbook.name}"`;

            // Start new chat, inject user message + data as a sentinel response
            handleNewChat();
            setRightPanelMode("chat");
            setTimeout(() => {
              const uid = `run-chat-u-${Date.now()}`;
              const sid = `run-chat-s-${Date.now()}`;
              setMessages([
                { id: uid, role: "user", content: userMsg, timestamp: Date.now() },
                { id: sid, role: "sentinel", content: tablesMd, timestamp: Date.now() + 1 },
              ]);
            }, 100);
          }}
        />
      )
    );
    return () => setDetailContent(null);
  }, [
    playbook,
    isGenerating,
    selectedCells,
    selectedStepCells,
    isChildCellSelected,
    execState,
    completedRunKey,
    pendingChangesKey,
    canvasExpandedView,
    isWizardMode,
    isPlanReviewMode,
    pendingFix,
    autoFixingCellId,
    setDetailContent,
    handleCellUpdate,
    handleRunPlaybook,
    handlePlaybookUpdate,
    handleAutoFix,
    handleApplyFix,
    setSelectedNodeId,
    handleNewChat,
    setMessages,
    setRightPanelMode,
  ]);

  // ── Navigation guard: prevent accidental loss of wizard progress ──
  useEffect(() => {
    if (!isWizardMode || hasStartedGeneration.current) return;

    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isWizardMode]);

  // ── Not found state ──

  if (!playbook && !isGenerating) {
    return (
      <div className="flex-1 flex items-center justify-center h-full">
        <div className="text-center space-y-3">
          <p className="text-lg font-semibold">Playbook not available</p>
          <p className="text-sm text-muted-foreground">
            This playbook hasn&apos;t been created yet.
          </p>
          <button
            onClick={() => router.push("/playbooks")}
            className="mt-1 px-4 py-2 text-sm font-medium border border-border rounded-lg hover:bg-muted transition-colors"
          >
            Back to Playbooks
          </button>
        </div>
      </div>
    );
  }

  const displayName = isGenerating
    ? (generatingMeta?.name ?? "Generating...")
    : (playbook?.name ?? "");

  return (
    <div className="flex flex-col h-full min-w-0">
      {/* Generation progress — only shown while building */}
      {isGenerating && (
        <div className="px-8 py-2 border-b border-border flex items-center gap-2">
          <span className="text-xs text-muted-foreground flex items-center gap-1.5">
            <svg className="w-3 h-3 animate-spin" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" className="text-border" />
              <path d="M14.5 8a6.5 6.5 0 0 0-6.5-6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-foreground" />
            </svg>
            {generationPhase === "discovering" && "Discovering schema..."}
            {generationPhase === "outline" && "Planning playbook..."}
            {generationPhase === "details" && `Generating queries... (${filledCellIds.size}/${generatingCells.length})`}
            {generationPhase === "validating" && "Validating generated SQL..."}
            {generationPhase === "repairing" && "Repairing SQL issues..."}
            {generationPhase === "idle" && "Building..."}
          </span>
        </div>
      )}
      {/* Execution errors are surfaced inline in RunStatusPane */}
      <div className="flex-1 flex min-h-0">
        <div className="flex flex-1 min-w-0 flex-col">
          {!isGenerating && playbook && (
            <PlaybookWorkspaceModeBar
              view={mainView}
              hasOutput={!!latestRun}
              latestRunLabel={formatWorkspaceRunLabel(latestRun)}
              onViewChange={setMainView}
            />
          )}
          <div className="min-h-0 flex flex-1">
            {playbook && mainView === "output" && !isGenerating ? (
              <PlaybookOutputArtifact
                playbook={playbook}
                run={latestRun}
              />
            ) : (
              <PlaybookCanvas
                cells={displayCells}
                onNodeClick={(id) => setSelectedNodeId((prev) => prev === id ? null : id)}
                onDeselect={() => setSelectedNodeId(null)}
                selectedNodeId={selectedNodeId}
                selectedCellId={isChildCellSelected ? selectedNodeId : null}
                executionState={execState}
                isGenerating={isGenerating}
                filledCellIds={filledCellIds}
                editMode={editMode}
                annotations={annotations}
                onAnnotate={handleAddAnnotation}
                onRemoveAnnotation={handleRemoveAnnotation}
                onRequestEditMode={handleRequestEditMode}
                applyingCellIds={applyingCellIds}
                onApplyAnnotations={handleApplyAnnotations}
                onDiscardAnnotations={() => { setAnnotations([]); setEditMode(false); }}
                isApplying={isApplying}
                onExpandedViewChange={setCanvasExpandedView}
                pendingDiffCellIds={pendingDiffCellIds}
                validationResults={validationResults}
              />
            )}
          </div>
        </div>
        {/* Detail panel now rendered in unified right panel via setDetailContent */}
      </div>
    </div>
  );
}
