import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import type { ChatMessage, AgentInfo, FollowUpAction } from "@/lib/types";
import { useSidebarContext } from "@/components/sidebar-context";
import type { Metric } from "@/lib/metric-types";
import { toast } from "sonner";
import { generateCreditCost, deductCredits } from "@/lib/credit-store";
import { buildKnowledgeContext } from "@/lib/knowledge-context";
import { buildEntityContext, buildPageEntityContext } from "@/lib/entity-context";
import { stripDeepDivesStreaming, stripDeepDivesFinal } from "@/lib/extract-deep-dives";
import type { EntityContext } from "@/components/chat/chat-input";
import {
  saveConversation,
  updateConversationMessages,
} from "@/lib/conversation-store";
import { markStepComplete } from "@/lib/onboarding-store";
import type { PanelState } from "@/hooks/use-panel";
import { apiFetch } from "@/lib/api-client";
import { parseAnalyzeEvent } from "@/lib/sse-types";
import { classifyQuery, buildMetricContextData, getAgentDisplay, buildPlanText, createId } from "@/hooks/use-classify";
import type { GenerateVoiceAgentInput } from "@/hooks/use-voice-agent-generation";
import { isVoiceAgentGenerationRequest, type ChatSendOptions } from "@/lib/voice-agent-generation-types";
import { streamDirectResponse } from "@/hooks/use-direct-stream";
import { useMetricUpdate, type MetricUpdateResult } from "@/hooks/use-metric-update";
import { saveMetric, getAllMetrics, getMetric } from "@/lib/metric-store";
import { buildPlaybookFromResearch } from "@/lib/playbook-builder";
import { savePlaybook } from "@/lib/playbook-store";
import { getOwnerInfo, PLAYBOOK_DEFAULTS } from "@/lib/playbook-defaults";
import {
  buildCohortDiscoveryInsight,
  isCohortDiscoveryRequest,
  isDataLookupRequest,
  latestSegmentCandidate,
} from "@/lib/cohort-opportunity";

// ── Helpers ──

function updateAgentMsg(
  messages: ChatMessage[],
  msgId: string,
  updater: (agent: AgentInfo) => AgentInfo
): ChatMessage[] {
  return messages.map((m) => {
    if (m.id === msgId && m.agent) {
      return { ...m, agent: updater(m.agent) };
    }
    return m;
  });
}

// ── Hook ──

interface UseAnalyticsArgs {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  activeConvId: string | null;
  setActiveConvId: (id: string) => void;
  isProcessing: boolean;
  setIsProcessing: (v: boolean) => void;
  agentMsgIdRef: React.RefObject<string>;
  messagesRef: React.RefObject<ChatMessage[]>;
  refreshChats: () => void;
  notifyCreditChanged: () => void;
  setPanel: (panel: PanelState) => void;
  datasetId: string;
  reportMeta?: { totalEvents: string; totalUsers: string };
  handlePlaybookCreate: (query: string) => Promise<void>;
  handlePolicyCreate?: (description: string) => void;
  policyContextRef?: React.MutableRefObject<{
    tableNames: string[];
    description: string;
    conversationHistory: { role: string; content: string }[];
  } | null>;
  pageContextLabel?: string;
  pageEntity?: { id: string; type: string; name: string; summary?: string; contextPayload?: Record<string, unknown> };
  setProcessingPhase: (phase: string | null) => void;
  generateVoiceAgent?: (input: GenerateVoiceAgentInput) => Promise<unknown>;
}

const noopGenerateVoiceAgent = async (_input: GenerateVoiceAgentInput): Promise<undefined> => undefined;

export function useAnalytics({
  messages: _messages,
  setMessages,
  activeConvId,
  setActiveConvId,
  isProcessing,
  setIsProcessing,
  agentMsgIdRef,
  messagesRef,
  refreshChats,
  notifyCreditChanged,
  setPanel,
  datasetId,
  reportMeta: _reportMeta,
  handlePlaybookCreate,
  handlePolicyCreate,
  policyContextRef,
  pageContextLabel,
  pageEntity,
  setProcessingPhase,
  generateVoiceAgent = noopGenerateVoiceAgent,
}: UseAnalyticsArgs) {
  const router = useRouter();
  const { user: clerkUser } = useUser();
  const ownerInfo = getOwnerInfo(clerkUser);
  const { notifyPlaybookSaved, refreshSegments } = useSidebarContext();
  const [deepResearch, setDeepResearch] = useState(false);
  const [generatedReport, setGeneratedReport] = useState<string | undefined>();
  const abortRef = useRef<AbortController | null>(null);
  const metricsCache = useRef<Map<string, Metric>>(new Map());
  const { requestMetricUpdate, publishUpdate } = useMetricUpdate();

  // Lazily fetch and cache dataset metrics for metric context cards.
  const metricsFetched = useRef<string | null>(null);
  const ensureMetricsLoaded = useCallback(() => {
    if (metricsFetched.current === datasetId) return;
    metricsFetched.current = datasetId;
    apiFetch<{ metrics?: Metric[] }>(`/api/metrics?datasetId=${encodeURIComponent(datasetId)}`, { skipModel: true })
      .then((data) => {
        if (data?.metrics) {
          const map = new Map<string, Metric>();
          for (const m of data.metrics) {
            map.set(m.id, m);
          }
          metricsCache.current = map;
        }
      })
      .catch(() => {});
  }, [datasetId]);

  const handleStop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  // ── Inline metric creation from chat ──
  const handleMetricCreate = useCallback(async (name: string, description: string) => {
    console.log("[metric-create] handleMetricCreate called:", { name, description });
    const metricId = `m-${Date.now()}`;
    const now = new Date().toISOString().split("T")[0];
    const newMetric: Metric = {
      id: metricId, name, description,
      type: "diagnostic", category: "Revenue", status: "healthy",
      value: 0, valueFormat: "number", aggregation: "count",
      table: "", column: "", timeColumn: "date", formula: "", sql: "",
      dimensions: [], timeGrain: "daily", granularity: "Store-level",
      relationships: [], owner: "You", ownerInitials: "YO",
      createdAt: now, updatedAt: now, version: 0, errors: 0,
    };
    saveMetric(datasetId, newMetric);

    const existingMetrics = getAllMetrics(datasetId).filter((m) => m.id !== metricId);
    const suggestedRelated = existingMetrics.slice(0, 3).map((m) => m.name);

    // Show table-select card immediately (tables loading)
    const cardMsgId = createId();
    setMessages((prev) => [
      ...prev,
      {
        id: cardMsgId, role: "sentinel" as const, content: "",
        timestamp: Date.now(), variant: "metric-table-select" as const,
        metricTableSelect: {
          metricId, metricName: name, description,
          tables: [],
          status: "pending" as const,
          suggestedRelatedMetrics: suggestedRelated,
        },
      },
    ]);

    // Fetch tables in background, then update the card
    try {
      const schemaData = await apiFetch<{ tables: string[] }>("/api/schema/tables");
      const tables = schemaData.tables ?? [];
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === cardMsgId && msg.metricTableSelect
            ? { ...msg, metricTableSelect: { ...msg.metricTableSelect, tables } }
            : msg,
        ),
      );
    } catch {
      // Tables failed to load — card stays in loading state, user can use custom table input
    }
  }, [datasetId, setMessages]);

  const handleSend = useCallback(
    async (text: string, entityContext?: EntityContext, contextRefs?: Array<{ id: string; displayLabel: string; type: string; contextPayload: Record<string, unknown> }>, silentContext?: string, options?: ChatSendOptions) => {
      if (isProcessing) return;
      const effectiveDeepResearch =
        options?.forceMode === "deep"
          ? true
          : options?.forceMode === "quick"
            ? false
            : deepResearch;
      ensureMetricsLoaded();

      // Check for /playbook command
      if (text.startsWith("/playbook")) {
        const playbookQuery = text.replace(/^\/playbook\s*/, "").replace(/^["']|["']$/g, "");
        if (playbookQuery) {
          await handlePlaybookCreate(playbookQuery);
        } else {
          setMessages((prev) => [
            ...prev,
            { id: createId(), role: "user", content: text, timestamp: Date.now() },
            { id: createId(), role: "sentinel", content: 'Usage: `/playbook "describe your analysis"` — for example, `/playbook "ROAS by channel"`', timestamp: Date.now() },
          ]);
        }
        return;
      }

      // Check for "convert to playbook" intent
      const convertPattern = /\b(convert|turn|make|save|transform)\b.{0,20}\b(into|to|as)\b.{0,20}\b(a\s+)?(playbook|notebook)\b/i;
      if (convertPattern.test(text) || text.toLowerCase().includes("convert to playbook")) {
        setMessages((prev) => [
          ...prev,
          { id: createId(), role: "user", content: text, timestamp: Date.now() },
        ]);

        const playbook = buildPlaybookFromResearch(messagesRef.current, text, activeConvId ?? undefined, ownerInfo);
        if (!playbook) {
          setMessages((prev) => [
            ...prev,
            {
              id: createId(),
              role: "sentinel",
              content: "No queries found in this thread to convert into a playbook. Try running some analysis first.",
              timestamp: Date.now(),
            },
          ]);
          return;
        }
        playbook.datasetId = datasetId;
        savePlaybook(playbook);
        notifyPlaybookSaved();

        setMessages((prev) => [
          ...prev,
          {
            id: createId(),
            role: "sentinel",
            content: `Converting thread to playbook **${playbook.name}** with ${playbook.cells.length} cells. Opening the canvas for review...`,
            timestamp: Date.now(),
          },
        ]);

        router.push(`/playbooks/${playbook.id}?wizard=true&fromThread=true`);
        return;
      }

      // Check for inline playbook run (playbook chip in context refs)
      const playbookRef = contextRefs?.find((r) => r.type === "playbook");
      if (playbookRef) {
        const playbookId = (playbookRef.contextPayload?.playbookId as string) ?? playbookRef.id;
        const { getPlaybook } = await import("@/lib/playbook-store");
        const { isPlaybookV2, migrateToV2 } = await import("@/lib/playbook-types");
        const rawPb = getPlaybook(playbookId);
        if (!rawPb) {
          setMessages((prev) => [
            ...prev,
            { id: createId(), role: "user", content: `Run "${playbookRef.displayLabel}" playbook${text ? ` — ${text}` : ""}`, timestamp: Date.now() },
            { id: createId(), role: "sentinel", content: "Playbook not found.", timestamp: Date.now() },
          ]);
          return;
        }
        const pb = isPlaybookV2(rawPb) ? rawPb : migrateToV2(rawPb);
        const userInstructions = text.trim();

        // Show user message
        const userMsgId = createId();
        setMessages((prev) => [
          ...prev,
          { id: userMsgId, role: "user", content: `Run "${playbookRef.displayLabel}" playbook${userInstructions ? ` — ${userInstructions}` : ""}`, timestamp: Date.now() },
        ]);

        // If playbook has params, ask user for values before running
        let paramOverrides: Record<string, string> = {};
        if (pb.params.length > 0) {
          setIsProcessing(false); // Allow interaction during param collection
          paramOverrides = await new Promise<Record<string, string>>((resolve) => {
            const collected: Record<string, string> = {};
            let currentIdx = 0;

            // Timeout: auto-resolve with defaults after 60s
            const timeoutId = setTimeout(() => {
              window.removeEventListener("playbook-wizard-answer", handleParamAnswer);
              for (const param of pb.params) {
                if (!(param.name in collected)) {
                  collected[param.name] = param.defaultVal;
                }
              }
              resolve(collected);
            }, 60_000);

            function injectNextParam() {
              if (currentIdx >= pb.params.length) {
                // All params collected
                clearTimeout(timeoutId);
                window.removeEventListener("playbook-wizard-answer", handleParamAnswer);
                resolve(collected);
                return;
              }
              const param = pb.params[currentIdx];
              const paramMsg: ChatMessage = {
                id: `run-param-${param.name}-${Date.now()}`,
                role: "sentinel",
                content: "",
                timestamp: Date.now(),
                variant: "playbook-wizard",
                playbookWizard: {
                  stepKey: `runparam-${param.name}`,
                  stepIndex: currentIdx,
                  totalSteps: pb.params.length,
                  question: param.label || param.name,
                  inputType: "text",
                  placeholder: `Default: ${param.defaultVal}`,
                  optional: true,
                },
              };
              setMessages((prev) => [...prev, paramMsg]);
            }

            function handleParamAnswer(e: Event) {
              const { stepKey, answer } = (e as CustomEvent).detail as { stepKey: string; answer: string };
              if (!stepKey.startsWith("runparam-")) return;
              const paramName = stepKey.replace("runparam-", "");
              const param = pb.params.find((p) => p.name === paramName);
              collected[paramName] = (answer === "(skipped)" || !answer.trim()) ? (param?.defaultVal ?? "") : answer;
              currentIdx++;
              injectNextParam();
            }

            window.addEventListener("playbook-wizard-answer", handleParamAnswer);
            injectNextParam();
          });
        }

        // Now execute with collected params
        const agentMsgId = createId();
        setIsProcessing(true);
        setMessages((prev) => [
          ...prev,
          { id: agentMsgId, role: "sentinel", content: "", timestamp: Date.now(), variant: "gathering" },
        ]);

        try {
          // Run the playbook via SSE with param overrides
          const runController = new AbortController();
          abortRef.current = runController;
          const res = await apiFetch("/api/playbook/run", {
            method: "POST",
            body: { playbook: pb, paramOverrides },
            stream: true,
            signal: runController.signal,
          }) as Response;
          if (!res.ok || !res.body) throw new Error("Run failed");

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          const cellResults: Record<string, { content?: string; rowCount?: number; columns?: string[]; preview?: Record<string, unknown>[]; error?: string }> = {};
          let summaryContent = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop()!;
            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const evt = JSON.parse(line);
                if (evt.type === "cell_result") {
                  cellResults[evt.cellId] = {
                    content: evt.content, rowCount: evt.rowCount,
                    columns: evt.columns, preview: evt.preview, error: evt.error,
                  };
                } else if (evt.type === "text") {
                  summaryContent += evt.delta ?? "";
                  // Stream update
                  setMessages((prev) => prev.map((m) =>
                    m.id === agentMsgId ? { ...m, content: summaryContent, variant: "streaming" as const } : m
                  ));
                }
              } catch { /* skip */ }
            }
          }

          // Build final response with tables
          const tableParts: string[] = [];
          for (const cell of pb.cells) {
            const cr = cellResults[cell.id];
            if (cr?.columns && cr.preview && cr.preview.length > 0) {
              const header = `| ${cr.columns.join(" | ")} |`;
              const sep = `| ${cr.columns.map(() => "---").join(" | ")} |`;
              const rows = cr.preview.slice(0, 20).map((row) =>
                `| ${cr.columns!.map((c) => String(row[c] ?? "")).join(" | ")} |`
              );
              tableParts.push(`**${cell.label}** (${cr.rowCount?.toLocaleString() ?? "?"} rows)\n\n${header}\n${sep}\n${rows.join("\n")}`);
            }
          }

          const finalContent = [
            summaryContent || null,
            tableParts.length > 0 ? tableParts.join("\n\n---\n\n") : null,
          ].filter(Boolean).join("\n\n") || "Playbook completed with no output.";

          setMessages((prev) => prev.map((m) =>
            m.id === agentMsgId ? { ...m, content: finalContent, variant: undefined, timestamp: Date.now() } : m
          ));
        } catch (err) {
          setMessages((prev) => prev.map((m) =>
            m.id === agentMsgId
              ? { ...m, content: `Playbook run failed: ${err instanceof Error ? err.message : "Unknown error"}`, variant: undefined }
              : m
          ));
        } finally {
          setIsProcessing(false);
        }
        return;
      }

      let convId = activeConvId;
      if (!convId) {
        convId = createId();
        const title = text.length > 40 ? text.slice(0, 40) + "..." : text;
        await saveConversation({
          id: convId,
          title,
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          datasetId,
        });
        refreshChats();
        setActiveConvId(convId);
      }

      const displayText = text;

      const userMsg: ChatMessage = {
        id: createId(),
        role: "user",
        content: displayText,
        timestamp: Date.now(),
        contextRefs: contextRefs?.map((r) => ({ displayLabel: r.displayLabel, type: r.type })),
      };

      const responseMsgId = createId();
      let streamedAnalyticsText = "";
      let streamedAnalyticsMode: "quick" | "deep" | null = null;
      let streamedAnalyticsMessageId: string | null = null;
      let doneReceived = false;
      let terminalStreamErrorReceived = false;
      setIsProcessing(true);
      setPanel({ type: "closed" });

      const abort = new AbortController();
      abortRef.current = abort;

      const agentMsgId = createId();
      agentMsgIdRef.current = agentMsgId;
      const streamingId = createId();

      setMessages((prev) => [
        ...prev,
        userMsg,
        { id: "gathering-" + agentMsgId, role: "sentinel", content: "", timestamp: Date.now(), variant: "gathering" },
      ]);

      try {
        // For deep research, create the agent message immediately so ack can populate it
        if (effectiveDeepResearch) {
          const instantAck = `Analyzing your question and planning the research approach...`;
          setMessages((prev) => {
            const filtered = prev.filter((m) => m.id !== "gathering-" + agentMsgId);
            return [
              ...filtered,
              {
                id: agentMsgId,
                role: "agent" as const,
                content: "",
                timestamp: Date.now(),
                agent: {
                  status: "gathering" as const,
                  taskCount: 0,
                  subagents: [],
                  planText: instantAck,
                },
              },
            ];
          });

          // Fire ack in parallel
          apiFetch<{ text?: string }>("/api/ack", {
            method: "POST",
            body: { query: text },
            signal: abort.signal,
          })
            .then((data) => {
              if (data.text) {
                setMessages((prev) =>
                  updateAgentMsg(prev, agentMsgId, (agent) => ({
                    ...agent,
                    planText: data.text!,
                  }))
                );
              }
            })
            .catch((err) => console.warn("[ack] failed:", err));
        }

        // Resolve metric from pageEntity (detail page) OR first metric-type contextRef (@ mention)
        let resolvedMetric: Metric | null = null;
        if (pageEntity?.type === "metric" && pageEntity.contextPayload) {
          resolvedMetric = pageEntity.contextPayload as unknown as Metric;
        } else if (contextRefs?.length) {
          const metricRef = contextRefs.find((r) => r.type === "metric");
          if (metricRef?.contextPayload) {
            resolvedMetric = metricRef.contextPayload as unknown as Metric;
          }
        }

        // Build metric entity context for classifier (enables metric_update mode)
        const metricEntityCtx = resolvedMetric
          ? `${resolvedMetric.name}: ${JSON.stringify(resolvedMetric)}`
          : undefined;

        // ── Policy follow-up: if a policy creation conversation is in progress, route directly ──
        if (policyContextRef?.current) {
          const ctx = policyContextRef.current;
          ctx.conversationHistory.push({ role: "user", content: text });

          // Remove gathering placeholder
          setMessages((prev) => prev.filter((m) => m.id !== "gathering-" + agentMsgId && m.id !== agentMsgId));

          const streamMsgId = `policy-gen-${Date.now()}`;
          setMessages((prev) => [
            ...prev,
            { id: streamMsgId, role: "sentinel" as const, content: "Generating policy...", timestamp: Date.now(), variant: "streaming" as const },
          ]);

          try {
            const convContext = ctx.conversationHistory.map((m) => `${m.role}: ${m.content}`).join("\n");
            const result = await apiFetch<{ type: string; message?: string; policy?: Record<string, unknown> }>("/api/policies/generate", {
              method: "POST",
              body: { prompt: text, tableNames: ctx.tableNames, mode: "generate", conversationContext: convContext },
            });

            if (result.type === "clarify" && result.message) {
              ctx.conversationHistory.push({ role: "assistant", content: result.message });
              setMessages((prev) =>
                prev.map((m) => m.id === streamMsgId ? { ...m, content: result.message!, variant: undefined as typeof m.variant } : m)
              );
            } else if (result.type === "policy" && result.policy) {
              const policy = result.policy as { name: string; description: string; tableAccess: import("@/lib/policy-types").DataPolicy["tableAccess"] };
              policyContextRef.current = null; // Clear context — generation complete
              const confirmMsgId = `policy-confirm-${Date.now()}`;
              setMessages((prev) => [
                ...prev.map((m) => m.id === streamMsgId ? { ...m, content: "Here's the policy I've generated:", variant: undefined as typeof m.variant } : m),
                {
                  id: confirmMsgId,
                  role: "sentinel" as const,
                  content: "",
                  timestamp: Date.now(),
                  variant: "policy-confirm" as const,
                  policyConfirm: {
                    name: policy.name,
                    description: policy.description,
                    datasetId,
                    tableAccess: policy.tableAccess,
                    status: "ready" as const,
                  },
                },
              ]);
            }
          } catch {
            setMessages((prev) =>
              prev.map((m) => m.id === streamMsgId ? { ...m, content: "Something went wrong. Please try again.", variant: undefined as typeof m.variant } : m)
            );
          }

          setIsProcessing(false);
          return;
        }

        // Build playbook entity context for classifier (enables playbook_modify mode)
        const playbookEntityCtx = pageEntity?.type === "playbook" && pageEntity.contextPayload
          ? `${pageEntity.name}: cells=${JSON.stringify(pageEntity.contextPayload.cells)}`
          : undefined;

        // Resolve segment from pageEntity (detail page) OR first segment-type contextRef (@ mention)
        let resolvedSegment: { id: string; name: string; description?: string; userCount?: number } | null = null;
        if (pageEntity?.type === "segment") {
          const payload = (pageEntity.contextPayload ?? {}) as Record<string, unknown>;
          resolvedSegment = {
            id: pageEntity.id,
            name: pageEntity.name,
            description: typeof payload.description === "string" ? payload.description : undefined,
            userCount: typeof payload.userCount === "number" ? payload.userCount : undefined,
          };
        } else if (contextRefs?.length) {
          const segmentRef = contextRefs.find((r) => r.type === "segment");
          if (segmentRef) {
            const payload = (segmentRef.contextPayload ?? {}) as Record<string, unknown>;
            resolvedSegment = {
              id: segmentRef.id,
              name: segmentRef.displayLabel.replace(/^[^/]+\/\s*/, ""),
              description: typeof payload.description === "string" ? payload.description : undefined,
              userCount: typeof payload.userCount === "number" ? payload.userCount : undefined,
            };
          }
        }

        const recentSegmentCandidate = latestSegmentCandidate(messagesRef.current);
        const segmentEntityCtx = resolvedSegment
          ? `${resolvedSegment.name}: id=${resolvedSegment.id}${resolvedSegment.userCount !== undefined ? `, userCount=${resolvedSegment.userCount}` : ""}${resolvedSegment.description ? `, description=${resolvedSegment.description}` : ""}`
          : recentSegmentCandidate
            ? `${recentSegmentCandidate.name}: ${recentSegmentCandidate.segmentId ? `id=${recentSegmentCandidate.segmentId}, ` : ""}${recentSegmentCandidate.userCount !== null ? `userCount=${recentSegmentCandidate.userCount}, ` : ""}description=${recentSegmentCandidate.description}`
          : undefined;

        // Classify
        const structuredVoiceRequest = options?.voiceAgentContext?.datasetId === datasetId;
        const dedicatedVoiceRequest = options?.voiceAgentMode === true || structuredVoiceRequest || isVoiceAgentGenerationRequest(text);
        const classified = dedicatedVoiceRequest
          ? {
              mode: "voice_agent_generation" as const,
              complexity: "simple" as const,
              complexityReason: null,
              metricId: null,
              actionType: null,
              extractedDescription: text,
              metricName: null,
              campaignChannel: null,
              campaignTargetDescription: null,
              voiceAgentTargetDescription: options?.voiceAgentContext?.segmentName ?? null,
            }
          : effectiveDeepResearch
            ? await classifyQuery(text, datasetId, metricEntityCtx, playbookEntityCtx, segmentEntityCtx).then((r) =>
                r.mode === "action" || r.mode === "metric_create" || r.mode === "policy_create" || r.mode === "campaign_create" || r.mode === "voice_agent_generation" ? r : { ...r, mode: "analytics" as const }
              )
            : await classifyQuery(text, datasetId, metricEntityCtx, playbookEntityCtx, segmentEntityCtx);
        const queryMode = classified.mode === "campaign_create" && classified.campaignChannel === "voice"
          ? "voice_agent_generation"
          : classified.mode === "direct" && isDataLookupRequest(text)
            ? "analytics"
            : classified.mode;
        markStepComplete("send-query");
        if (abort.signal.aborted) return;

        // ── Auto-upgrade to deep research for genuinely complex queries ──
        // Triggers only when: classifier returned complex, user is on analytics path,
        // and user did NOT explicitly force quick or already toggle deep on.
        let runDeep = effectiveDeepResearch;
        const autoUpgraded =
          !effectiveDeepResearch &&
          options?.forceMode !== "quick" &&
          queryMode === "analytics" &&
          classified.complexity === "complex";

        if (autoUpgraded) {
          runDeep = true;
          const reason = classified.complexityReason ?? "this question needs multi-lens analysis";
          const noticeMsgId = `auto-deep-notice-${agentMsgId}`;

          // Swap gathering placeholder → notice + deep agent message (mirrors the
          // deep pre-flight at the top of handleSend that runs when toggle is on)
          setMessages((prev) => {
            const filtered = prev.filter((m) => m.id !== "gathering-" + agentMsgId);
            return [
              ...filtered,
              {
                id: noticeMsgId,
                role: "sentinel" as const,
                content: "",
                timestamp: Date.now(),
                variant: "auto-deep-notice" as const,
                autoDeepNotice: {
                  reason,
                  agentMsgId,
                  originalText: text,
                  status: "active" as const,
                },
              },
              {
                id: agentMsgId,
                role: "agent" as const,
                content: "",
                timestamp: Date.now(),
                agent: {
                  status: "gathering" as const,
                  taskCount: 0,
                  subagents: [],
                  planText: "Analyzing your question and planning the research approach...",
                },
              },
            ];
          });

          // Fire ack in parallel to populate planText with a richer message
          apiFetch<{ text?: string }>("/api/ack", {
            method: "POST",
            body: { query: text },
            signal: abort.signal,
          })
            .then((data) => {
              if (data.text) {
                setMessages((prev) =>
                  updateAgentMsg(prev, agentMsgId, (agent) => ({
                    ...agent,
                    planText: data.text!,
                  }))
                );
              }
            })
            .catch(() => {});
        }

        // Inject metric context card
        if (classified.metricId) {
          const metricData = buildMetricContextData(classified.metricId, metricsCache.current, datasetId);
          if (metricData) {
            setMessages((prev) => {
              const insertIdx = prev.findIndex((m) => m.id === "gathering-" + agentMsgId || m.id === agentMsgId);
              const metricMsg: ChatMessage = {
                id: "metric-" + createId(),
                role: "sentinel",
                content: "",
                timestamp: Date.now(),
                variant: "metric-context",
                metricContext: metricData,
              };
              if (insertIdx >= 0) {
                const updated = [...prev];
                updated.splice(insertIdx, 0, metricMsg);
                return updated;
              }
              return [...prev, metricMsg];
            });
          }
        }

        // ── Voice-agent generation flow ──
        if (queryMode === "voice_agent_generation") {
          setMessages((prev) => prev.filter((message) =>
            message.id !== "gathering-" + agentMsgId && message.id !== agentMsgId
          ));
          await generateVoiceAgent({
            goal: classified.extractedDescription || text,
            requestId: userMsg.id,
            context: structuredVoiceRequest ? options?.voiceAgentContext : undefined,
            resolvedSegmentId: resolvedSegment?.id || recentSegmentCandidate?.segmentId || undefined,
            targetDescription: classified.voiceAgentTargetDescription,
            signal: abort.signal,
          });
          setIsProcessing(false);
          return;
        }

        // ── Metric creation flow ──
        if (queryMode === "metric_create") {
          const name = classified.metricName || "New Metric";
          const description = classified.extractedDescription || text;
          // Remove the "gathering" placeholder before showing table-select card
          setMessages((prev) => prev.filter((m) => m.id !== "gathering-" + agentMsgId && m.id !== agentMsgId));
          await handleMetricCreate(name, description);
          setIsProcessing(false);
          return;
        }

        // ── Campaign creation flow ──
        if (queryMode === "campaign_create") {
          const wantsVoiceCampaign = classified.campaignChannel === "voice";

          if (wantsVoiceCampaign) {
            if (!resolvedSegment && !recentSegmentCandidate && !classified.campaignTargetDescription) {
              setMessages((prev) =>
                prev
                  .filter((m) => m.id !== "gathering-" + agentMsgId && m.id !== agentMsgId)
                  .concat([{
                    id: responseMsgId,
                    role: "sentinel",
                    content: "Which segment should this voice campaign target? Open a segment detail page, @mention a segment, or ask me to save the cohort first.",
                    timestamp: Date.now(),
                  }])
              );
              setIsProcessing(false);
              return;
            }

            const draftMsgId = `voice-campaign-draft-${Date.now()}`;
            setMessages((prev) =>
              prev
                .filter((m) => m.id !== "gathering-" + agentMsgId && m.id !== agentMsgId)
                .concat([{
                  id: draftMsgId,
                  role: "sentinel",
                  content: "Creating voice campaign draft...",
                  timestamp: Date.now(),
                  variant: "streaming",
                }])
            );

            try {
              let generatedCohortSegment: { name: string; description: string; sql: string } | null = null;
              if (!resolvedSegment && !recentSegmentCandidate && classified.campaignTargetDescription) {
                const generated = await apiFetch<{ sql: string; name?: string }>("/api/segments/generate-sql", {
                  method: "POST",
                  body: {
                    description: classified.campaignTargetDescription,
                    datasetId,
                  },
                  datasetId,
                  signal: abort.signal,
                });
                generatedCohortSegment = {
                  name: generated.name?.trim() || "Discovered Cohort",
                  description: classified.campaignTargetDescription,
                  sql: generated.sql,
                };
              }

              const result = await apiFetch<{
                segment: { id: string; name: string; userCount: number };
                openUrl: string;
              }>("/api/growth-opportunities/voice-campaign", {
                method: "POST",
                body: {
                  ...(resolvedSegment
                    ? { segmentId: resolvedSegment.id }
                    : recentSegmentCandidate?.segmentId
                      ? { segmentId: recentSegmentCandidate.segmentId }
                      : recentSegmentCandidate
                        ? {
                            segmentName: recentSegmentCandidate.name,
                            segmentDescription: recentSegmentCandidate.description,
                            segmentSql: recentSegmentCandidate.sql,
                            sourceConversationId: convId ?? undefined,
                          }
                        : generatedCohortSegment
                      ? {
                          segmentName: generatedCohortSegment.name,
                          segmentDescription: generatedCohortSegment.description,
                          segmentSql: generatedCohortSegment.sql,
                          sourceConversationId: convId ?? undefined,
                        }
                      : {}),
                  objective: classified.extractedDescription || text,
                },
                datasetId,
                signal: abort.signal,
              });

              refreshSegments();
              const openUrl = result.openUrl;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === draftMsgId
                    ? {
                        ...m,
                        variant: undefined,
                        content:
                          `Saved segment **${result.segment.name}** (${result.segment.userCount.toLocaleString()} users) and created a voice campaign draft from it.\n\n` +
                          `[Open the voice campaign](${openUrl})\n\n` +
                          `Review the generated script, run a live test, then add phone numbers before any calls launch.`,
                      }
                    : m
                )
              );
            } catch (err) {
              const message = err instanceof Error ? err.message : "Voice campaign setup failed";
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === draftMsgId
                    ? { ...m, variant: undefined, content: message }
                    : m
                )
              );
            }

            setIsProcessing(false);
            return;
          }

          if (!resolvedSegment) {
            setMessages((prev) =>
              prev
                .filter((m) => m.id !== "gathering-" + agentMsgId && m.id !== agentMsgId)
                .concat([{
                  id: responseMsgId,
                  role: "sentinel",
                  content: "Which segment should this campaign target? Open a segment detail page, or @mention a segment in your message.",
                  timestamp: Date.now(),
                }])
            );
            setIsProcessing(false);
            return;
          }

          const intent = classified.extractedDescription || text;
          const draftMsgId = `campaign-draft-${Date.now()}`;
          setMessages((prev) =>
            prev
              .filter((m) => m.id !== "gathering-" + agentMsgId && m.id !== agentMsgId)
              .concat([{
                id: draftMsgId,
                role: "sentinel",
                content: "Drafting campaign...",
                timestamp: Date.now(),
                variant: "streaming",
              }])
          );

          try {
            const draft = await apiFetch<{
              segmentId: string;
              segmentName: string;
              userCount: number | null;
              channel: "email" | "push" | "sms" | "webpush" | "whatsapp";
              subject: string;
              body: string;
              senderName?: string;
              senderEmailId?: string;
              replyTo?: string;
              rationale?: string;
            }>("/api/campaign-draft", {
              method: "POST",
              body: {
                segmentId: resolvedSegment.id,
                intent,
                channel: "email",
              },
              signal: abort.signal,
            });

            setMessages((prev) =>
              prev.map((m) =>
                m.id === draftMsgId
                  ? {
                      ...m,
                      content: "",
                      variant: "campaign-draft" as const,
                      campaignDraft: {
                        segmentId: draft.segmentId,
                        segmentName: draft.segmentName,
                        userCount: draft.userCount,
                        channel: draft.channel,
                        subject: draft.subject,
                        body: draft.body,
                        senderName: draft.senderName,
                        senderEmailId: draft.senderEmailId,
                        replyTo: draft.replyTo,
                        rationale: draft.rationale,
                        status: "ready" as const,
                      },
                    }
                  : m
              )
            );
          } catch (err) {
            const message = err instanceof Error ? err.message : "Campaign draft failed";
            setMessages((prev) =>
              prev.map((m) =>
                m.id === draftMsgId
                  ? { ...m, variant: undefined, content: message }
                  : m
              )
            );
          }

          setIsProcessing(false);
          return;
        }

        // ── Policy creation flow ──
        if (queryMode === "policy_create") {
          const description = classified.extractedDescription || text;
          setMessages((prev) => prev.filter((m) => m.id !== "gathering-" + agentMsgId && m.id !== agentMsgId));
          handlePolicyCreate?.(description);
          setIsProcessing(false);
          return;
        }

        // ── Segment/cohort creation and discovery flow ──
        const shouldCreateSegmentCandidate =
          (queryMode === "action" && classified.actionType === "create-segment") ||
          (queryMode === "analytics" && !runDeep && isCohortDiscoveryRequest(text));

        if (shouldCreateSegmentCandidate) {
          const description = classified.actionType === "create-segment"
            ? classified.extractedDescription || text
            : text;
          const isDiscovery = queryMode === "analytics";

          setMessages((prev) =>
            prev
              .filter((m) => m.id !== "gathering-" + agentMsgId && m.id !== agentMsgId)
              .concat([{
                id: "segment-generating-" + responseMsgId,
                role: "sentinel",
                content: isDiscovery ? "Finding cohort..." : "Creating segment...",
                timestamp: Date.now(),
                variant: "streaming",
              }])
          );

          try {
            let sql: string;
            let llmName = "";
            try {
              const sqlData = await apiFetch<{ sql: string; name?: string }>("/api/segments/generate-sql", {
                method: "POST",
                body: { description },
                signal: abort.signal,
              });
              sql = sqlData.sql;
              llmName = (sqlData.name ?? "").trim();
            } catch (sqlErr) {
              const errMsg = sqlErr instanceof Error ? sqlErr.message : "Unknown error";
              setMessages((prev) =>
                prev
                  .filter((m) => m.id !== "segment-generating-" + responseMsgId)
                  .concat([{
                    id: responseMsgId,
                    role: "sentinel",
                    content: errMsg || "Couldn't generate a segment for that description. Try being more specific.",
                    timestamp: Date.now(),
                  }])
              );
              return;
            }

            let userCount: number | null = null;
            try {
              const countSql = `SELECT COUNT(*) as cnt FROM (${sql.trim().replace(/;+\s*$/, "")}) __count`;
              const countData = await apiFetch<{ rows?: Record<string, unknown>[] }>("/api/query", {
                method: "POST",
                body: { sql: countSql },
                signal: abort.signal,
              });
              userCount = Number(countData.rows?.[0]?.cnt ?? 0);
            } catch {
              // Count failed
            }

            const fallbackName = (() => {
              const stripped = description
                .replace(/^(create|make|build|find|show|list)\s+(a|an|the)?\s*(segment|cohort|group)?\s*(of|for|with|that|who|where)?\s*/i, "")
                .replace(/^(users?|customers?|investors?)\s+(who|with|that|where|but|have|has|had)?\s*/i, "")
                .split(/[,.;:]/)[0]
                .trim();
              const words = stripped.split(/\s+/).slice(0, 4).join(" ");
              const titled = words.replace(/\b\w/g, (c: string) => c.toUpperCase());
              return titled.length > 30 ? titled.slice(0, titled.lastIndexOf(" ", 30)).trim() || titled.slice(0, 30) : titled;
            })();
            const suggestedName = llmName || fallbackName || "User Segment";
            let discoveryInsight = "";
            if (isDiscovery) {
              discoveryInsight = buildCohortDiscoveryInsight({ description, suggestedName, userCount });
              try {
                const insightData = await apiFetch<{ insight?: string; userCount?: number | null }>("/api/cohort-insight", {
                  method: "POST",
                  body: {
                    userQuery: text,
                    segmentName: suggestedName,
                    segmentDescription: description,
                    segmentSql: sql,
                    userCount,
                    datasetId,
                  },
                  datasetId,
                  signal: abort.signal,
                });
                if (typeof insightData.insight === "string" && insightData.insight.trim()) {
                  discoveryInsight = insightData.insight.trim();
                }
                if (typeof insightData.userCount === "number") {
                  userCount = insightData.userCount;
                }
              } catch {
                // Keep deterministic fallback insight.
              }
            }

            setMessages((prev) =>
              prev
                .filter((m) => m.id !== "segment-generating-" + responseMsgId)
                .concat([{
                  id: responseMsgId,
                  role: "sentinel",
                  content: discoveryInsight,
                  timestamp: Date.now(),
                  variant: "segment-confirm",
                  segmentConfirm: {
                    suggestedName,
                    sql,
                    description,
                    userCount,
                    status: "ready",
                  },
                }])
            );
          } catch (err) {
            if (err instanceof DOMException && err.name === "AbortError") return;
            setMessages((prev) =>
              prev
                .filter((m) => m.id !== "segment-generating-" + responseMsgId)
                .concat([{
                  id: responseMsgId,
                  role: "sentinel",
                  content: "Something went wrong while generating the segment. Please try again.",
                  timestamp: Date.now(),
                }])
            );
          }
          return;
        }

        // ── Playbook modify flow (from playbook detail page chat) ──
        if (queryMode === "playbook_modify" && pageEntity?.type === "playbook") {
          // Immediately supersede any existing plan review cards (remove Approve button)
          setMessages((prev) =>
            prev.map((m) =>
              m.variant === "playbook-plan-review" && m.playbookPlanReview?.status === "pending"
                ? { ...m, playbookPlanReview: { ...m.playbookPlanReview, status: "superseded" as const } }
                : m
            )
          );
          const { triggerPlaybookModify } = await import("@/lib/playbook-modify-event");
          const confirmMsg = await triggerPlaybookModify(text);
          // Replace the gathering message with the handler's response
          setMessages((prev) =>
            prev.map((m) =>
              m.id === agentMsgId || m.id === "gathering-" + agentMsgId
                ? {
                    ...m,
                    id: responseMsgId,
                    role: "sentinel" as const,
                    content: confirmMsg ?? "Could not apply changes — the playbook page may have navigated away.",
                    timestamp: Date.now(),
                    variant: undefined,
                  }
                : m
            )
          );
          setIsProcessing(false);
          return;
        }

        // ── Metric update flow (from detail page OR @ mention) ──
        if (queryMode === "metric_update" && resolvedMetric) {
          // Short-circuit: rename-only requests skip LLM entirely
          const renamePattern = /\b(?:rename|update\s+(?:the\s+)?name|change\s+(?:the\s+)?name|update\s+(?:the\s+)?metric\s+name)\b/i;
          if (renamePattern.test(text)) {
            setMessages((prev) =>
              prev
                .filter((m) => m.id !== "gathering-" + agentMsgId && m.id !== agentMsgId)
                .concat([{
                  id: responseMsgId,
                  role: "sentinel",
                  content: "",
                  timestamp: Date.now(),
                  variant: "metric-update-confirm",
                  metricUpdateConfirm: {
                    metricId: resolvedMetric!.id,
                    metricName: resolvedMetric!.name,
                    oldDescription: resolvedMetric!.description || "",
                    newDescription: resolvedMetric!.description || "",
                    oldSql: resolvedMetric!.sql || "",
                    newSql: resolvedMetric!.sql || "",
                    oldFormula: resolvedMetric!.formula || "",
                    newFormula: resolvedMetric!.formula || "",
                    explanation: "Click the metric name to rename it",
                    affectedMetrics: [],
                    userRequest: text,
                    status: "ready",
                    table: resolvedMetric!.table,
                    computedValue: resolvedMetric!.value,
                    sqlValid: true,
                  },
                }])
            );
            setIsProcessing(false);
            return;
          }

          const tableCardId = "table-update-" + responseMsgId;
          setMessages((prev) =>
            prev
              .filter((m) => m.id !== "gathering-" + agentMsgId && m.id !== agentMsgId)
              .concat([
                // Pre-confirmed table card (shows current table, user can click "Change")
                {
                  id: tableCardId,
                  role: "sentinel" as const,
                  content: "",
                  timestamp: Date.now(),
                  variant: "metric-table-select" as const,
                  metricTableSelect: {
                    metricId: resolvedMetric!.id,
                    metricName: resolvedMetric!.name,
                    description: resolvedMetric!.description || "",
                    tables: [],
                    selectedTable: resolvedMetric!.table,
                    status: "confirmed" as const,
                    suggestedRelatedMetrics: [],
                  },
                },
                {
                  id: "metric-update-" + responseMsgId,
                  role: "sentinel" as const,
                  content: "",
                  timestamp: Date.now(),
                  variant: "streaming" as const,
                },
              ])
          );

          // Load tables in background (for "Change" flow)
          apiFetch<{ tables?: string[] }>("/api/schema/tables", { skipModel: true })
            .then((schemaData) => {
              const tables = schemaData.tables ?? [];
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === tableCardId && msg.metricTableSelect
                    ? { ...msg, metricTableSelect: { ...msg.metricTableSelect, tables } }
                    : msg,
                ),
              );
            })
            .catch(() => {});

          try {
            const result = await requestMetricUpdate(resolvedMetric, text, abort.signal);

            if (!result || !result.success) {
              setMessages((prev) =>
                prev
                  .filter((m) => m.id !== "metric-update-" + responseMsgId)
                  .concat([{
                    id: responseMsgId,
                    role: "sentinel",
                    content: "I couldn't generate the metric update. Please try rephrasing your request.",
                    timestamp: Date.now(),
                  }])
              );
              return;
            }

            setMessages((prev) =>
              prev
                .filter((m) => m.id !== "metric-update-" + responseMsgId)
                .concat([{
                  id: responseMsgId,
                  role: "sentinel",
                  content: "",
                  timestamp: Date.now(),
                  variant: "metric-update-confirm",
                  metricUpdateConfirm: {
                    metricId: resolvedMetric!.id,
                    metricName: resolvedMetric!.name,
                    oldDescription: resolvedMetric!.description || "",
                    newDescription: result.newDescription || resolvedMetric!.description || "",
                    oldSql: resolvedMetric!.sql,
                    newSql: result.newSql,
                    oldFormula: resolvedMetric!.formula,
                    newFormula: result.newFormula,
                    explanation: result.explanation,
                    affectedMetrics: result.affectedMetrics,
                    userRequest: text,
                    status: "ready",
                    table: resolvedMetric!.table,
                  },
                }])
            );
          } catch (err) {
            if (err instanceof DOMException && err.name === "AbortError") return;
            setMessages((prev) =>
              prev
                .filter((m) => m.id !== "metric-update-" + responseMsgId)
                .concat([{
                  id: responseMsgId,
                  role: "sentinel",
                  content: "Something went wrong while generating the metric update. Please try again.",
                  timestamp: Date.now(),
                }])
            );
          }
          return;
        }

        // ── Build context ──
        let knowledgeCtx = buildKnowledgeContext(undefined, datasetId);
        if (silentContext) knowledgeCtx += "\n\n" + silentContext;
        const entityCtx = entityContext ? buildEntityContext(entityContext.entities, entityContext.dateRange) : "";

        let pageCtx = "";
        let pageSqlCtx = "";
        if (pageEntity?.contextPayload) {
          const { sqlContext, synthesisContext } = buildPageEntityContext(pageEntity);
          pageSqlCtx = sqlContext;
          pageCtx = `\n${synthesisContext}\n[FOCUS: The user is viewing this specific entity. Answer their question about it directly. Do NOT produce a broad general analysis.]\n`;
        } else if (pageContextLabel && pageContextLabel !== "Actioneer") {
          pageCtx = `\n[CONTEXT: The user is currently viewing the ${pageContextLabel} page. Focus your analysis on this context.]\n`;
          pageSqlCtx = pageCtx;
        }

        if (contextRefs?.length) {
          const refContextParts: string[] = [];
          const refSqlParts: string[] = [];
          for (const ref of contextRefs) {
            const { sqlContext, synthesisContext } = buildPageEntityContext({
              type: ref.type,
              name: ref.displayLabel.split(" / ").pop() || ref.displayLabel,
              contextPayload: ref.contextPayload,
            });
            refSqlParts.push(sqlContext);
            refContextParts.push(synthesisContext);
          }
          const refCtx = refContextParts.join("\n");
          const refSqlCtx = refSqlParts.join("\n");
          pageCtx = pageCtx ? `${pageCtx}\n${refCtx}` : `\n${refCtx}\n`;
          pageSqlCtx = pageSqlCtx ? `${pageSqlCtx}\n${refSqlCtx}` : refSqlCtx;
        }

        if (queryMode === "direct") {
          // ── Direct LLM flow ──
          setMessages((prev) =>
            prev
              .filter((m) => m.id !== "gathering-" + agentMsgId && m.id !== agentMsgId)
              .concat([
                { id: responseMsgId, role: "sentinel", content: "", timestamp: Date.now(), variant: "streaming" },
              ])
          );
          await streamDirectResponse(text, responseMsgId, abort.signal, setMessages, datasetId, pageCtx + knowledgeCtx + entityCtx);

          // Clear streaming variant immediately so the response renders as normal markdown
          // (not ShimmeringText) while we fetch recommendations in the background
          setMessages((prev) =>
            prev.map((m) => m.id === responseMsgId ? { ...m, variant: undefined } : m)
          );

          let directActions: FollowUpAction[] = [];
          try {
            const currentMsgs = messagesRef.current;
            const responseMsg = currentMsgs.find((m) => m.id === responseMsgId);
            const responseContent = responseMsg?.content || "";
            if (responseContent.length > 0) {
              const recs = await apiFetch<{ actions?: FollowUpAction[] }>("/api/recommend", {
                method: "POST",
                body: { query: text, responseText: responseContent, mode: "direct" },
                signal: abort.signal,
              });
              if (recs.actions?.length) {
                directActions = recs.actions;
              }
            }
          } catch {
            // Fall through
          }

          if (directActions.length) {
            setMessages((prev) =>
              prev.map((m) => m.id === responseMsgId ? { ...m, followUpActions: directActions } : m)
            );
          }
          const directCost = generateCreditCost("direct");
          deductCredits(directCost, {
            source: "chat",
            conversationId: convId,
            messageId: responseMsgId,
            queryMode: "direct",
            questionPreview: text.length > 60 ? text.slice(0, 60) + "..." : text,
          });
          setMessages((prev) =>
            prev.map((m) => m.id === responseMsgId ? { ...m, creditCost: directCost } : m)
          );
          notifyCreditChanged();

        } else {
          // ── Analytics flow ──
          const mode = runDeep ? "deep" : "quick";
          streamedAnalyticsMode = mode;

          if (mode === "deep") {
            setMessages((prev) => prev.filter((m) => m.id !== "gathering-" + agentMsgId));
          } else {
            setMessages((prev) => {
              const filtered = prev.filter((m) => m.id !== "gathering-" + agentMsgId);
              return filtered.concat([{
                id: streamingId,
                role: "sentinel",
                content: "Thinking...",
                timestamp: Date.now(),
                variant: "streaming",
              }]);
            });
          }

          const sqlPageCtx = [pageSqlCtx || pageCtx, silentContext].filter(Boolean).join("\n\n");

          const res = await apiFetch("/api/analyze", {
            method: "POST",
            body: { query: text, mode, knowledgeContext: pageCtx + knowledgeCtx + entityCtx, pageContext: sqlPageCtx },
            signal: abort.signal,
            stream: true,
          });

          if (!res.ok || !res.body) throw new Error("Analyze request failed");

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let responseText = "";
          let isStreaming = false;
          let pendingRecommendations: FollowUpAction[] | null = null;
          let pendingStreamContent: string | null = null;
          let streamFlushRaf: number | null = null;

          // Write `content` into the streaming message, but only if it actually
          // changed — otherwise return the SAME array reference so React bails
          // out of the re-render. `prev.map()` always allocates a new array, so
          // without this guard an identical update still forces a render and can
          // feed an update loop ("Maximum update depth exceeded").
          const writeStreamContent = (content: string) => {
            setMessages((prev) => {
              const target = prev.find((m) => m.id === responseMsgId);
              if (!target || target.content === content) return prev;
              return prev.map((m) =>
                m.id === responseMsgId ? { ...m, content } : m
              );
            });
          };

          const flushStreamContent = () => {
            if (streamFlushRaf !== null) {
              cancelAnimationFrame(streamFlushRaf);
              streamFlushRaf = null;
            }
            const content = pendingStreamContent;
            pendingStreamContent = null;
            if (content === null) return;
            writeStreamContent(content);
          };

          const scheduleStreamContent = (content: string) => {
            pendingStreamContent = content;
            if (streamFlushRaf !== null) return;
            streamFlushRaf = requestAnimationFrame(() => {
              streamFlushRaf = null;
              const latestContent = pendingStreamContent;
              pendingStreamContent = null;
              if (latestContent === null) return;
              writeStreamContent(latestContent);
            });
          };

          while (true) {
            const { done, value } = await reader.read();
            if (done || abort.signal.aborted) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              const event = parseAnalyzeEvent(line);
              if (!event) continue;

              switch (event.type) {
                case "phase": {
                  const phase = event.phase;
                  const phaseLabels: Record<string, string> = {
                    generating_sql: "Generating queries",
                    executing: "Running analysis",
                    synthesizing: "Synthesizing answer",
                  };
                  setProcessingPhase(phaseLabels[phase] ?? phase);
                  if (phase === "generating_sql") {
                    if (mode === "quick") {
                      setMessages((prev) =>
                        prev.map((m) =>
                          m.id === streamingId ? { ...m, content: "Generating query..." } : m
                        )
                      );
                    } else {
                      setMessages((prev) =>
                        updateAgentMsg(prev, agentMsgId, (agent) => ({
                          ...agent,
                          status: "processing",
                          statusLabel: "Generating queries",
                        }))
                      );
                    }
                  } else if (phase === "executing") {
                    if (mode === "quick") {
                      setMessages((prev) =>
                        prev.map((m) =>
                          m.id === streamingId ? { ...m, content: "Running analysis..." } : m
                        )
                      );
                    } else {
                      setMessages((prev) =>
                        updateAgentMsg(prev, agentMsgId, (agent) => ({
                          ...agent,
                          status: "processing",
                          statusLabel: "Running analysis",
                        }))
                      );
                    }
                  } else if (phase === "synthesizing") {
                    if (mode === "quick") {
                      setMessages((prev) =>
                        prev.map((m) =>
                          m.id === streamingId ? { ...m, content: "Preparing answer..." } : m
                        )
                      );
                    } else {
                      setMessages((prev) =>
                        updateAgentMsg(prev, agentMsgId, (agent) => ({
                          ...agent,
                          status: "processing",
                          statusLabel: "Synthesizing answer",
                        }))
                      );
                    }
                  }
                  break;
                }

                case "ack": {
                  if (mode !== "deep") break;
                  const ackText = event.text;
                  setMessages((prev) =>
                    updateAgentMsg(prev, agentMsgId, (agent) => ({
                      ...agent,
                      planText: ackText,
                    }))
                  );
                  break;
                }

                case "plan": {
                  if (mode !== "deep") break;
                  const agents = event.agents;
                  const fallbackPlanText = buildPlanText(agents.map((a) => a.id));
                  setMessages((prev) =>
                    updateAgentMsg(prev, agentMsgId, (agent) => ({
                      ...agent,
                      planText: agent.planText || fallbackPlanText,
                      subagents: agents.map((a) => {
                        const def = getAgentDisplay(a.id);
                        const existing = agent.subagents.find((s) => s.id === a.id);
                        if (existing) {
                          return { ...existing, expectedQueryCount: a.queryCount };
                        }
                        return {
                          id: def.id,
                          name: def.name,
                          icon: def.icon,
                          status: "pending" as const,
                          queries: a.tasks.map((t) => ({
                            sql: "",
                            description: t.description,
                          })),
                          expectedQueryCount: a.queryCount,
                        };
                      }),
                    }))
                  );
                  break;
                }

                case "sql": {
                  const subId = event.subagentId;
                  const def = getAgentDisplay(subId);
                  const eventQueries = event.queries;

                  if (mode === "quick") {
                    setMessages((prev) => {
                      const existing = prev.find((m) => m.id === agentMsgId);
                      if (existing) {
                        return updateAgentMsg(prev, agentMsgId, (agent) => {
                          if (agent.subagents.find((s) => s.id === subId)) return agent;
                          return {
                            ...agent,
                            subagents: [
                              ...agent.subagents,
                              {
                                id: def.id,
                                name: def.name,
                                icon: def.icon,
                                status: "complete" as const,
                                queries: eventQueries.map((q) => ({
                                  sql: q.sql,
                                  description: q.description,
                                })),
                                expectedQueryCount: eventQueries.length,
                              },
                            ],
                          };
                        });
                      }
                      return prev.concat([{
                        id: agentMsgId,
                        role: "agent",
                        content: "",
                        timestamp: Date.now(),
                        isDataOnly: true,
                        agent: {
                          status: "complete",
                          taskCount: 1,
                          subagents: [{
                            id: def.id,
                            name: def.name,
                            icon: def.icon,
                            status: "complete" as const,
                            queries: eventQueries.map((q) => ({
                              sql: q.sql,
                              description: q.description,
                            })),
                            expectedQueryCount: eventQueries.length,
                          }],
                        },
                      }]);
                    });
                    break;
                  }

                  setMessages((prev) =>
                    updateAgentMsg(prev, agentMsgId, (agent) => {
                      const existing = agent.subagents.find((s) => s.id === subId);
                      if (existing) {
                        return {
                          ...agent,
                          subagents: agent.subagents.map((s) =>
                            s.id === subId
                              ? {
                                  ...s,
                                  status: "active" as const,
                                  queries: eventQueries.map((q) => ({
                                    sql: q.sql,
                                    description: q.description,
                                  })),
                                }
                              : s
                          ),
                        };
                      }
                      return {
                        ...agent,
                        subagents: [
                          ...agent.subagents,
                          {
                            id: def.id,
                            name: def.name,
                            icon: def.icon,
                            status: "active" as const,
                            queries: eventQueries.map((q) => ({
                              sql: q.sql,
                              description: q.description,
                            })),
                            expectedQueryCount: eventQueries.length,
                          },
                        ],
                      };
                    })
                  );
                  break;
                }

                case "query_result": {
                  const subId = event.subagentId;
                  const qIdx = event.queryIndex;
                  const err = event.error;
                  // Retain columns + preview data (capped at 50 rows) for board conversion
                  const previewData = event.preview?.slice(0, 50);
                  const cols = event.columns;
                  setMessages((prev) =>
                    updateAgentMsg(prev, agentMsgId, (agent) => ({
                      ...agent,
                      subagents: agent.subagents.map((s) => {
                        if (s.id !== subId) return s;
                        const updatedQueries = (s.queries || []).map((q, i) =>
                          i === qIdx
                            ? {
                                ...q,
                                rowCount: event.rowCount,
                                executionTimeMs: event.timeMs,
                                error: err,
                                columns: cols,
                                data: previewData,
                              }
                            : q
                        );
                        return { ...s, queries: updatedQueries };
                      }),
                    }))
                  );
                  break;
                }

                case "result": {
                  if (mode === "quick") break;
                  const subId = event.subagentId;
                  const err = event.error;
                  setMessages((prev) =>
                    updateAgentMsg(prev, agentMsgId, (agent) => ({
                      ...agent,
                      subagents: agent.subagents.map((s) =>
                        s.id === subId
                          ? {
                              ...s,
                              status: err ? ("error" as const) : ("complete" as const),
                            }
                          : s
                      ),
                    }))
                  );
                  break;
                }

                case "summary": {
                  if (mode === "quick") break;
                  const subId = event.subagentId;
                  const rawSummary = event.content
                    .replace(/^```(?:markdown)?\n?/i, "")
                    .replace(/\n?```$/i, "")
                    .replace(/^---\n?/gm, "")
                    .trim();
                  setMessages((prev) =>
                    updateAgentMsg(prev, agentMsgId, (agent) => ({
                      ...agent,
                      subagents: agent.subagents.map((s) =>
                        s.id === subId
                          ? {
                              ...s,
                              summary: rawSummary,
                              status: "complete" as const,
                            }
                          : s
                      ),
                    }))
                  );
                  break;
                }

                case "text": {
                  if (!isStreaming) {
                    isStreaming = true;
                    setMessages((prev) => {
                      let updated = prev;
                      if (mode === "deep") {
                        updated = updateAgentMsg(prev, agentMsgId, (agent) => ({
                          ...agent,
                          status: "complete",
                        }));
                      }
                      return updated
                        .filter((m) => m.id !== streamingId)
                        .concat([{
                          id: responseMsgId,
                          role: "sentinel",
                          content: "",
                          timestamp: Date.now(),
                          ...(mode === "quick" ? { isAnalyticsResponse: true } : {}),
                          ...(mode === "deep" ? { isDeepResearchReport: true } : {}),
                        }]);
                    });
                    if (mode === "deep") {
                      markStepComplete("view-report");
                    }
                  }
                  responseText += event.delta;
                  const content = mode === "deep"
                    ? stripDeepDivesStreaming(responseText)
                    : responseText;
                  streamedAnalyticsText = content;
                  streamedAnalyticsMessageId = responseMsgId;
                  scheduleStreamContent(content);
                  break;
                }

                case "report": {
                  setGeneratedReport(event.content);
                  break;
                }

                case "recommendations": {
                  pendingRecommendations = event.actions ?? [];
                  if (doneReceived) {
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === responseMsgId ? { ...m, followUpActions: pendingRecommendations! } : m
                      )
                    );
                  }
                  break;
                }

                case "done": {
                  flushStreamContent();
                  doneReceived = true;
                  const analyticsCost = generateCreditCost(mode === "deep" ? "deep" : "quick");
                  const actions = pendingRecommendations ?? [];
                  setMessages((prev) => {
                    let updated = prev.map((m) => {
                      if (m.id !== responseMsgId) return m;
                      const cleanContent = mode === "deep"
                        ? stripDeepDivesFinal(m.content)
                        : m.content;
                      return {
                        ...m,
                        content: cleanContent,
                        followUpActions: actions,
                        creditCost: analyticsCost,
                        ...(mode === "deep" ? { isDeepResearchReport: true } : {}),
                      };
                    });
                    // Append report-cta for deep research
                    if (mode === "deep") {
                      updated = [
                        ...updated,
                        {
                          id: `report-cta-${responseMsgId}`,
                          role: "sentinel" as const,
                          content: "",
                          timestamp: Date.now(),
                          variant: "report-cta" as const,
                          userQuery: text,
                        },
                      ];
                    }
                    return updated;
                  });
                  deductCredits(analyticsCost, {
                    source: "chat",
                    conversationId: convId,
                    messageId: responseMsgId,
                    queryMode: mode === "deep" ? "deep" : "quick",
                    questionPreview: text.length > 60 ? text.slice(0, 60) + "..." : text,
                  });
                  notifyCreditChanged();
                  break;
                }

                case "error": {
                  terminalStreamErrorReceived = true;
                  flushStreamContent();
                  if (isStreaming) {
                    const errorNote = `\n\n> The stream ended early: ${event.message}`;
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === responseMsgId
                          ? {
                              ...m,
                              content: `${m.content.trimEnd()}${errorNote}`,
                              ...(mode === "deep" ? { isDeepResearchReport: true } : {}),
                            }
                          : m
                      )
                    );
                  } else {
                    isStreaming = true;
                    setMessages((prev) =>
                      prev
                        .filter((m) => m.id !== streamingId)
                        .concat([{
                          id: responseMsgId,
                          role: "sentinel",
                          content: `Something went wrong: ${event.message}. Please try again.`,
                          timestamp: Date.now(),
                        }])
                    );
                  }
                  break;
                }
              }
            }
          }

          // Flush remaining buffer
          flushStreamContent();
          buffer += decoder.decode();
          if (buffer.trim()) {
            const event = parseAnalyzeEvent(buffer);
            if (event) {
              if (event.type === "recommendations") {
                pendingRecommendations = event.actions ?? [];
              }
              if (event.type === "done") {
                doneReceived = true;
              }
              if (event.type === "done" || event.type === "recommendations") {
                const actions = pendingRecommendations ?? [];
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === responseMsgId
                      ? { ...m, followUpActions: actions }
                      : m
                  )
                );
              }
            }
          }

          if (isStreaming && !doneReceived && !terminalStreamErrorReceived && !abort.signal.aborted) {
            toast.error("Analysis stream ended early. Partial output was preserved.");
            const errorNote = "\n\n> The connection closed before the completion marker arrived. The partial report above was preserved.";
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== responseMsgId) return m;
                const alreadyNoted =
                  m.content.includes("stream ended before completion") ||
                  m.content.includes("connection closed before the completion marker");
                return {
                  ...m,
                  content: alreadyNoted ? m.content : `${m.content.trimEnd()}${errorNote}`,
                  ...(mode === "deep" ? { isDeepResearchReport: true } : {}),
                  ...(mode === "quick" ? { isAnalyticsResponse: true } : {}),
                };
              })
            );
          }

          // If no text was streamed (edge case), clean up
          if (!isStreaming) {
            setMessages((prev) => {
              const updated = updateAgentMsg(prev, agentMsgId, (agent) => ({
                ...agent,
                status: "complete",
              }));
              return updated
                .filter((m) => m.id !== streamingId)
                .concat([{
                  id: responseMsgId,
                  role: "sentinel",
                  content: "I wasn't able to generate an analysis for that query. Try rephrasing your question.",
                  timestamp: Date.now(),
                }]);
            });
          }
        }
      } catch (err) {
        // Best-effort cleanup if a scheduled stream render was still pending.
        if (err instanceof DOMException && err.name === "AbortError") {
          setMessages((prev) =>
            prev.filter(
              (m) =>
                m.id !== "gathering-" + agentMsgId &&
                m.id !== streamingId &&
                !(m.id === agentMsgId && m.isDataOnly)
            )
          );
        } else {
          console.warn("[analytics] stream handler failed", err);
          if (doneReceived) {
            // The response completed; avoid turning a post-completion UI/storage
            // failure into a misleading "stream ended early" report note.
          } else if (streamedAnalyticsText.trim().length > 0 && streamedAnalyticsMessageId) {
            toast.error("Analysis stream ended early. Partial output was preserved.");
            const errorNote = "\n\n> The stream ended before completion. The partial report above was preserved.";
            const preservedMessageId = streamedAnalyticsMessageId;
            setMessages((prev) => {
              const cleaned = prev.filter(
                (m) =>
                  m.id !== "gathering-" + agentMsgId &&
                  m.id !== streamingId
              );
              let updatedExisting = false;
              const updated = cleaned.map((m) => {
                if (m.id !== preservedMessageId) return m;
                updatedExisting = true;
                const alreadyNoted = m.content.includes("The stream ended before completion");
                return {
                  ...m,
                  variant: undefined,
                  content: alreadyNoted ? m.content : `${m.content.trimEnd()}${errorNote}`,
                  ...(streamedAnalyticsMode === "deep" ? { isDeepResearchReport: true } : {}),
                  ...(streamedAnalyticsMode === "quick" ? { isAnalyticsResponse: true } : {}),
                };
              });
              if (updatedExisting) return updated;
              return updated.concat([{
                id: preservedMessageId,
                role: "sentinel",
                content: `${streamedAnalyticsText.trimEnd()}${errorNote}`,
                timestamp: Date.now(),
                ...(streamedAnalyticsMode === "deep" ? { isDeepResearchReport: true } : {}),
                ...(streamedAnalyticsMode === "quick" ? { isAnalyticsResponse: true } : {}),
              }]);
            });
          } else {
            toast.error("Analysis failed. Please try again.");
            setMessages((prev) =>
              prev
                .filter(
                  (m) =>
                    m.id !== "gathering-" + agentMsgId &&
                    m.id !== streamingId
                )
                .concat([{
                  id: responseMsgId,
                  role: "sentinel",
                  content: "Sorry, something went wrong processing your request. Please try again.",
                  timestamp: Date.now(),
                }])
            );
          }
        }
      } finally {
        setIsProcessing(false);
        setProcessingPhase(null);
        abortRef.current = null;
        if (convId) {
          const cid = convId;
          setTimeout(() => {
            setMessages((latest) => {
              void (async () => {
                await updateConversationMessages(cid, latest);
              })();
              return latest;
            });
          }, 0);
        }
      }
    },
    [deepResearch, isProcessing, activeConvId, handlePlaybookCreate, handlePolicyCreate, policyContextRef, refreshChats, refreshSegments, datasetId, setMessages, setActiveConvId, setIsProcessing, agentMsgIdRef, messagesRef, notifyCreditChanged, setPanel, ensureMetricsLoaded, pageContextLabel, pageEntity, requestMetricUpdate, handleMetricCreate, generateVoiceAgent]
  );

  return {
    handleSend,
    handleStop,
    deepResearch,
    setDeepResearch,
    generatedReport,
  };
}
