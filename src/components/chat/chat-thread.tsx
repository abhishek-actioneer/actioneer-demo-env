"use client";

import { memo, useRef, useEffect, useCallback, useMemo, useState } from "react";
import { ResearchTimeline } from "@/components/chat/research-timeline";
import { DocumentView } from "@/components/chat/document-view";
import { ReportMinimap } from "@/components/chat/report-minimap";
import { SaveAsPlaybookCTA } from "@/components/chat/research-report";
import { DataConnectorWidget } from "@/components/chat/data-connector-widget";
import { SaveToKnowledgeWidget } from "@/components/chat/save-to-knowledge";
import { PinButton } from "@/components/canvas/pin-button";
import { SentinelLogo } from "@/components/ui/sentinel-logo";
import { ResponseFooter } from "@/components/chat/response-footer";
import { NextSteps } from "@/components/chat/next-steps";
import { SelectionPopup } from "@/components/chat/selection-popup";
import { getCategoriesById } from "@/lib/connector-categories";
import { MarkdownContent } from "@/lib/markdown";
import { ShimmeringText } from "@/components/ui/shimmering-text";
import { QuickModeProgress } from "@/components/chat/quick-mode-progress";
import { MetricContextCard } from "@/components/chat/metric-context-card";
import { AutoDeepNoticeCard } from "@/components/chat/auto-deep-notice-card";
import { Loader2 } from "lucide-react";
import { SegmentConfirmCard } from "@/components/chat/segment-confirm-card";
import { CampaignDraftCard } from "@/components/chat/campaign-draft-card";
import { VoiceAgentGenerationCard } from "@/components/chat/voice-agent-generation-card";
import { FunnelConfirmCard } from "@/components/chat/funnel-confirm-card";
import { RetentionConfirmCard } from "@/components/chat/retention-confirm-card";
import { MetricUpdateConfirmCard } from "@/components/chat/metric-update-confirm-card";
import { MetricCreateConfirmCard } from "@/components/chat/metric-create-confirm-card";
import { MetricTableSelectCard } from "@/components/chat/metric-table-select-card";
import type { MetricTableSelectData } from "@/components/chat/metric-table-select-card";
import { MetricGeneratingCard } from "@/components/chat/metric-generating-card";
import { PolicyConfirmCard } from "@/components/chat/policy-confirm-card";
import { PolicyTableSelectCard } from "@/components/chat/policy-table-select-card";
import { SelectableOptions, hasNumberedOptions, parseNumberedOptions } from "@/components/chat/selectable-options";
import { PlaybookWizardCard } from "@/components/chat/playbook-wizard-card";
import { PlaybookPlanReviewCard } from "@/components/chat/playbook-plan-review-card";
import { useChatState } from "@/components/chat/chat-state-provider";
import { useChatPanel } from "@/components/chat/chat-panel-provider";
import { apiFetch } from "@/lib/api-client";
import { toast } from "sonner";

import type { ChatMessage } from "@/lib/types";
import type { ChartSpec } from "@/lib/chart-types";
import type { DetectableEntity } from "@/lib/entity-types";
import { isVoiceAgentGenerationRequest } from "@/lib/voice-agent-generation-types";


interface ChatThreadProps {
  hideMinimap?: boolean;
  /** Compact mode for right panel — smaller text */
  compact?: boolean;
  onChartPinned?: () => void;
  onAddToFollowUp?: (text: string) => void;
  onAddToKnowledge?: (text: string) => void;
}

export const ChatThread = memo(function ChatThread({
  hideMinimap,
  compact,
  onChartPinned,
  onAddToFollowUp,
  onAddToKnowledge,
}: ChatThreadProps) {
  const chat = useChatState();
  const {
    messages,
    isProcessing,
    handleSubagentClick: onSubagentClick,
    handleCitationClick: onCitationClick,
    activeCitation,
    handleFollowUpAction: onFollowUpAction,
    handleConnectorClick: onConnectorClick,
    handleProceedWithout: onProceedWithout,
    handleUploadCSV: onUploadCSV,
    handleSaveAsPlaybook: onSaveAsPlaybook,
    handleSaveAsBoard: onSaveAsBoard,
    isSavingBoard,
    handleSavePlaybookPreview: onSavePlaybookPreview,
    handleSaveToKnowledge: onSaveToKnowledge,
    handleDismissKnowledge: onDismissKnowledge,
    activeConvId,
    entityLookup,
    handleEntityClick: onEntityClick,
    handleSegmentConfirm: onSegmentConfirm,
    handleSegmentCancel: onSegmentCancel,
    handleSegmentRefine: onSegmentRefine,
    handleSegmentVoiceCampaign: onSegmentVoiceCampaign,
    handleFunnelConfirm: onFunnelConfirm,
    handleFunnelCancel: onFunnelCancel,
    handleFunnelRefine: onFunnelRefine,
    handleRetentionConfirm: onRetentionConfirm,
    handleRetentionCancel: onRetentionCancel,
    handleRetentionRefine: onRetentionRefine,
    handleMetricUpdatePublish: onMetricUpdatePublish,
    handleMetricUpdateDismiss: onMetricUpdateDismiss,
    handlePolicyConfirm: onPolicyConfirm,
    handlePolicyCancel: onPolicyCancel,
    policyContextRef: sharedPolicyContextRef,
    handleCampaignFire: onCampaignFire,
    handleCampaignCancel: onCampaignCancel,
    handleCampaignRefine: onCampaignRefine,
    handleSend,
    setMessages,
    chatInputRef,
  } = chat;
  const { injectText } = useChatPanel();
  const conversationId = activeConvId ?? undefined;

  const handleMetricCreateApprove = useCallback((msgId: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId && m.metricCreateConfirm
          ? { ...m, metricCreateConfirm: { ...m.metricCreateConfirm, status: "approved" } }
          : m
      )
    );
  }, [setMessages]);

  const handleMetricCreateDismiss = useCallback((msgId: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId && m.metricCreateConfirm
          ? { ...m, metricCreateConfirm: { ...m.metricCreateConfirm, status: "dismissed" } }
          : m
      )
    );
  }, [setMessages]);

  const handleMetricCreateSuggestEdits = useCallback((metricName: string) => {
    injectText("", `Editing metric: ${metricName}`);
  }, [injectText]);

  const handleMetricUpdateStatusChange = useCallback((msgId: string, status: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId && m.metricUpdateConfirm
          ? { ...m, metricUpdateConfirm: { ...m.metricUpdateConfirm, status: status as "ready" | "published" | "dismissed" | "editing" } }
          : m
      )
    );
  }, [setMessages]);

  /** Self-contained edit: card calls API with its own data, updates in-place */
  const handleMetricEdit = useCallback(async (msgId: string, editRequest: string) => {
    // 1. Find the card's current data
    const msg = chat.messages.find((m) => m.id === msgId);
    const cardData = msg?.metricUpdateConfirm;
    if (!cardData) return;

    // 2. Set card to editing (shows progress bar + spinner)
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId && m.metricUpdateConfirm
          ? { ...m, metricUpdateConfirm: { ...m.metricUpdateConfirm, status: "editing" as const } }
          : m
      )
    );

    try {
      // 3. Call API with the CARD's current SQL/formula (not client store)
      const result = await apiFetch<{
        success: boolean; valueSql: string; timeSeriesSql: string; newFormula: string;
        newDescription?: string; explanation: string; affectedMetrics: string[];
        computedValue?: number | null; sqlValid?: boolean;
        sqlErrors?: { valueSql?: string | null; timeSeriesSql?: string | null }; error?: string;
      }>("/api/metric-update", {
        method: "POST",
        body: {
          metricName: cardData.metricName,
          currentSql: cardData.newSql || cardData.timeSeriesSql || "",
          currentFormula: cardData.newFormula || "",
          table: cardData.table || "",
          column: "",
          timeColumn: "",
          description: cardData.newDescription || "",
          relationships: [],
          userRequest: editRequest,
        },
      });

      if (!result.success || result.error) throw new Error(result.error || "Generation failed");

      // 4. Update the SAME card in-place with new values
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId && m.metricUpdateConfirm
            ? {
                ...m,
                metricUpdateConfirm: {
                  ...m.metricUpdateConfirm,
                  // Previous "new" values become "old" for inline diff
                  oldFormula: m.metricUpdateConfirm!.newFormula,
                  oldDescription: m.metricUpdateConfirm!.newDescription,
                  oldSql: m.metricUpdateConfirm!.newSql,
                  // New values from API
                  newFormula: result.newFormula,
                  newDescription: result.newDescription || m.metricUpdateConfirm!.newDescription,
                  newSql: result.timeSeriesSql,
                  explanation: result.explanation,
                  affectedMetrics: result.affectedMetrics,
                  valueSql: result.valueSql,
                  timeSeriesSql: result.timeSeriesSql,
                  computedValue: result.computedValue,
                  sqlValid: result.sqlValid,
                  sqlErrors: result.sqlErrors,
                  userRequest: editRequest,
                  status: "ready" as const,
                },
              }
            : m
        )
      );
    } catch (err) {
      console.error("[metric-edit] Error:", err);
      toast.error("Edit failed", {
        description: err instanceof Error ? err.message : "Try again or use a different edit.",
      });
      // Revert to ready state so user can try again
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId && m.metricUpdateConfirm
            ? { ...m, metricUpdateConfirm: { ...m.metricUpdateConfirm, status: "ready" as const } }
            : m
        )
      );
    }
  }, [chat.messages, setMessages]);

  /** Manual SQL update: user edited SQL directly and validated it */
  const handleManualSqlUpdate = useCallback((msgId: string, updateData: {
    newSql: string;
    valueSql?: string;
    computedValue?: number | null;
    sqlValid: boolean;
    sqlErrors?: { valueSql?: string | null; timeSeriesSql?: string | null };
    newFormula?: string;
  }) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId && m.metricUpdateConfirm
          ? {
              ...m,
              metricUpdateConfirm: {
                ...m.metricUpdateConfirm,
                oldSql: m.metricUpdateConfirm!.newSql, // shift diff
                newSql: updateData.newSql,
                valueSql: updateData.valueSql,
                timeSeriesSql: updateData.newSql,
                computedValue: updateData.computedValue ?? m.metricUpdateConfirm!.computedValue,
                sqlValid: updateData.sqlValid,
                sqlErrors: updateData.sqlErrors,
                ...(updateData.newFormula ? {
                  oldFormula: m.metricUpdateConfirm!.newFormula,
                  newFormula: updateData.newFormula,
                } : {}),
              },
            }
          : m
      )
    );
  }, [setMessages]);

  /** Inline name edit on the confirm card */
  const handleMetricNameChange = useCallback((msgId: string, newName: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId && m.metricUpdateConfirm
          ? { ...m, metricUpdateConfirm: { ...m.metricUpdateConfirm, newName } }
          : m
      )
    );
  }, [setMessages]);

  /** Reset a confirmed table-select card back to pending (user clicked "Change") */
  const handleChangeTable = useCallback((msgId: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId && m.metricTableSelect
          ? { ...m, metricTableSelect: { ...m.metricTableSelect, status: "pending" as const, selectedTable: undefined } }
          : m
      )
    );
  }, [setMessages]);

  /** User selected tables for policy creation — ask LLM to clarify column/row restrictions */
  const handlePolicyTableSelect = useCallback(async (msgId: string, tableNames: string[]) => {
    const cardMsg = messages.find((m) => m.id === msgId);
    const description = cardMsg?.policyTableSelect?.description || "";

    // Mark card as confirmed
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId && m.policyTableSelect
          ? { ...m, policyTableSelect: { ...m.policyTableSelect, status: "confirmed" as const, selectedTables: tableNames } }
          : m
      )
    );

    // Store policy context for follow-up handling
    sharedPolicyContextRef.current = { tableNames, description, conversationHistory: [] };

    // Ask LLM to clarify what restrictions the user wants
    const streamMsgId = `policy-clarify-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: streamMsgId, role: "sentinel" as const, content: "Analyzing tables...", timestamp: Date.now(), variant: "streaming" as const },
    ]);

    try {
      const result = await apiFetch<{ type: string; message?: string }>("/api/policies/generate", {
        method: "POST",
        body: { prompt: description, tableNames, mode: "clarify" },
      });

      if (result.message) {
        sharedPolicyContextRef.current.conversationHistory.push({ role: "assistant", content: result.message });
        setMessages((prev) =>
          prev.map((m) => m.id === streamMsgId ? { ...m, content: result.message!, variant: undefined as typeof m.variant } : m)
        );
      }
    } catch {
      setMessages((prev) =>
        prev.map((m) => m.id === streamMsgId ? { ...m, content: "Something went wrong. Please try again.", variant: undefined as typeof m.variant } : m)
      );
    }
  }, [setMessages, messages]);

  const handleMetricTableSelect = useCallback(async (msgId: string, tableName: string, data: MetricTableSelectData) => {
    const loaderId = `loader-${Date.now()}`;

    // 1. Mark table card as confirmed + add loader message
    setMessages((prev) => [
      ...prev.map((m) =>
        m.id === msgId && m.metricTableSelect
          ? { ...m, metricTableSelect: { ...m.metricTableSelect, status: "confirmed" as const, selectedTable: tableName } }
          : m
      ),
      {
        id: loaderId, role: "sentinel" as const, content: "",
        timestamp: Date.now(), variant: "metric-generating" as const,
        metricGenerating: { metricId: data.metricId, metricName: data.metricName, table: tableName, phase: "analyzing" as const },
      },
    ]);

    // 2. Phase: generating (after short delay for perceived progress)
    const phaseTimer = setTimeout(() => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === loaderId && m.metricGenerating
            ? { ...m, metricGenerating: { ...m.metricGenerating, phase: "generating" as const } }
            : m
        )
      );
    }, 1500);

    try {
      // 3. Call metric-update API to generate SQL + formula
      const requestBody = {
        metricName: data.metricName,
        currentSql: "",
        currentFormula: "",
        table: tableName,
        column: "",
        timeColumn: "date",
        description: data.description,
        relationships: [],
        userRequest: `Create a new metric "${data.metricName}" that ${data.description}. Use the "${tableName}" table.`,
      };
      const result = await apiFetch<{
        success: boolean;
        valueSql: string;
        timeSeriesSql: string;
        newFormula: string;
        newDescription?: string;
        explanation: string;
        affectedMetrics: string[];
        computedValue?: number | null;
        sqlValid?: boolean;
        sqlErrors?: { valueSql?: string | null; timeSeriesSql?: string | null };
        error?: string;
      }>("/api/metric-update", {
        method: "POST",
        body: requestBody,
      });

      clearTimeout(phaseTimer);

      if (!result.success || result.error) {
        throw new Error(result.error || "Generation failed");
      }

      // 4. Phase: computing (brief)
      setMessages((prev) =>
        prev.map((m) =>
          m.id === loaderId && m.metricGenerating
            ? { ...m, metricGenerating: { ...m.metricGenerating, phase: "computing" as const } }
            : m
        )
      );

      // 5. Replace loader with metric-update-confirm card after brief delay
      await new Promise((r) => setTimeout(r, 800));
      setMessages((prev) =>
        prev.map((m) =>
          m.id === loaderId
            ? {
                ...m,
                variant: "metric-update-confirm" as const,
                metricGenerating: undefined,
                metricUpdateConfirm: {
                  metricId: data.metricId,
                  metricName: data.metricName,
                  oldDescription: "",
                  newDescription: result.newDescription || data.description,
                  oldSql: "",
                  newSql: result.timeSeriesSql,
                  oldFormula: "",
                  newFormula: result.newFormula,
                  explanation: result.explanation,
                  affectedMetrics: result.affectedMetrics,
                  userRequest: data.description,
                  status: "ready" as const,
                  suggestedRelatedMetrics: data.suggestedRelatedMetrics,
                  table: tableName,
                  valueSql: result.valueSql,
                  timeSeriesSql: result.timeSeriesSql,
                  computedValue: result.computedValue,
                  sqlValid: result.sqlValid,
                  sqlErrors: result.sqlErrors,
                },
              }
            : m
        )
      );
    } catch (err) {
      clearTimeout(phaseTimer);
      const errMsg = err instanceof Error ? err.message : "Failed to generate metric";
      console.error("[metric-create] Error:", errMsg, err);
      // Show error state on loader
      setMessages((prev) =>
        prev.map((m) =>
          m.id === loaderId && m.metricGenerating
            ? { ...m, metricGenerating: { ...m.metricGenerating, phase: "error" as const, error: errMsg } }
            : m
        )
      );
    }
  }, [setMessages]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevMsgCountRef = useRef(0);
  const prevBuildEventCountRef = useRef(0);
  const userScrolledRef = useRef(false);
  const buildEventCount = useMemo(() => messages.reduce(
    (count, message) => count + (message.voiceAgentGeneration?.buildEvents?.length ?? 0),
    0,
  ), [messages]);
  const voiceAgentRequestIds = useMemo(() => new Set(
    messages.flatMap((message) => message.voiceAgentGeneration?.requestId ? [message.voiceAgentGeneration.requestId] : []),
  ), [messages]);

  // Collect all SQL queries from agent messages (for PinButton context)
  const allSql = useMemo(() => {
    const queries: string[] = [];
    for (const m of messages) {
      if (m.role === "agent" && m.agent) {
        for (const sub of m.agent.subagents) {
          if (sub.queries) {
            for (const q of sub.queries) {
              if (q.sql) queries.push(q.sql);
            }
          }
        }
      }
    }
    return queries;
  }, [messages]);

  // Get the latest sentinel response text for pairing with chart pins as insight
  const latestAnalysis = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "sentinel" && m.content && m.content.length > 20) return m.content;
    }
    return undefined;
  }, [messages]);

  // Render PinButton below each chart in document view
  const renderChartActions = useCallback(
    (spec: ChartSpec) => {
      // Use first SQL query as representative (charts are generated from the full dataset)
      const sql = allSql.length > 0 ? allSql.join(";\n") : undefined;
      return (
        <div className="flex items-center gap-2 mt-1 mb-2">
          <PinButton
            cardType="chart"
            title={spec.title || "Untitled Chart"}
            chartSpec={spec}
            sql={sql}
            data={spec.data as Record<string, unknown>[]}
            markdownContent={latestAnalysis}
            sourceConversationId={conversationId}
            onPinned={onChartPinned}
          />
        </div>
      );
    },
    [allSql, conversationId, onChartPinned, latestAnalysis]
  );

  // Render PinButton below each markdown table
  const renderTableActions = useCallback(
    (data: Record<string, unknown>[], title: string) => {
      const sql = allSql.length > 0 ? allSql.join(";\n") : undefined;
      return (
        <div className="flex items-center gap-2 mt-1 mb-2">
          <PinButton
            cardType="table"
            title={title}
            sql={sql}
            data={data}
            sourceConversationId={conversationId}
            onPinned={onChartPinned}
          />
        </div>
      );
    },
    [allSql, conversationId, onChartPinned]
  );

  // Collect all deep-mode reports: msgId → content
  const deepReports = useMemo(() => {
    const map = new Map<string, string>();
    const explicitReports = messages.filter(
      (m) => m.role === "sentinel" && m.isDeepResearchReport && m.content.length > 0
    );
    if (explicitReports.length > 0) {
      for (const m of explicitReports) map.set(m.id, m.content);
      return map;
    }

    // Backwards-compatible fallback for older saved conversations that predate
    // isDeepResearchReport. New messages must be explicitly marked as reports.
    const hasAgentData = messages.some((m) => m.role === "agent" && m.agent && !m.isDataOnly);
    if (!hasAgentData) return map;
    for (const m of messages) {
      if (m.role === "sentinel" && !m.variant && m.content.length > 0 && !m.isAnalyticsResponse) {
        map.set(m.id, m.content);
      }
    }
    return map;
  }, [messages]);

  // Track which deep report is currently visible in the scroll container
  const [visibleReport, setVisibleReport] = useState<{ msgId: string; content: string } | null>(null);
  const visibleReportRef = useRef<string | null>(null);
  const visibleContentRef = useRef<string | null>(null);
  const minimapRafRef = useRef<number | null>(null);

  const checkVisibleReport = useCallback(() => {
    const root = scrollRef.current;
    if (!root || deepReports.size === 0) {
      if (visibleReportRef.current !== null) {
        visibleReportRef.current = null;
        visibleContentRef.current = null;
        setVisibleReport(null);
      }
      return;
    }

    const rootRect = root.getBoundingClientRect();
    const els = root.querySelectorAll<HTMLElement>("[data-deep-report-id]");
    let bestId: string | null = null;
    let bestTop = Infinity;

    for (const el of els) {
      const id = el.dataset.deepReportId!;
      if (!deepReports.has(id)) continue;
      const rect = el.getBoundingClientRect();
      // At least 10% of the element or 100px must be visible
      const visibleTop = Math.max(rect.top, rootRect.top);
      const visibleBottom = Math.min(rect.bottom, rootRect.bottom);
      const visibleHeight = visibleBottom - visibleTop;
      if (visibleHeight > Math.min(rect.height * 0.1, 100)) {
        const relativeTop = rect.top - rootRect.top;
        if (relativeTop < bestTop) {
          bestTop = relativeTop;
          bestId = id;
        }
      }
    }

    const bestContent = bestId ? deepReports.get(bestId) ?? null : null;
    // Update when report changes OR when content for the same report updates (streaming)
    if (bestId !== visibleReportRef.current || (bestId && bestContent !== visibleContentRef.current)) {
      visibleReportRef.current = bestId;
      visibleContentRef.current = bestContent;
      if (bestId && bestContent) {
        setVisibleReport({ msgId: bestId, content: bestContent });
      } else {
        setVisibleReport(null);
      }
    }
  }, [deepReports, scrollRef]);

  // Run visibility check on scroll (rAF-throttled) and when messages change
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;

    // Initial check
    checkVisibleReport();

    const onScroll = () => {
      if (minimapRafRef.current != null) cancelAnimationFrame(minimapRafRef.current);
      minimapRafRef.current = requestAnimationFrame(() => {
        checkVisibleReport();
        minimapRafRef.current = null;
      });
    };

    root.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      root.removeEventListener("scroll", onScroll);
      if (minimapRafRef.current != null) cancelAnimationFrame(minimapRafRef.current);
    };
  }, [checkVisibleReport]);

  // Detect if user scrolled away from bottom
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    userScrolledRef.current = !atBottom;
  }, []);

  // Auto-scroll only when new messages are appended during simulation
  useEffect(() => {
    const prevCount = prevMsgCountRef.current;
    const newCount = messages.length;
    prevMsgCountRef.current = newCount;

    // Bulk load (switching conversations) — scroll to top, not bottom
    if (prevCount === 0 && newCount > 2 && !isProcessing) {
      scrollRef.current?.scrollTo({ top: 0 });
      userScrolledRef.current = false;
      return;
    }

    // Check if any of the newly added messages is a user message
    const newMessages = messages.slice(prevCount);
    const newUserMsg = newMessages.find((m) => m.role === "user");

    if (newUserMsg) {
      userScrolledRef.current = false;
      const scroller = scrollRef.current;
      const container = contentRef.current;
      const msgEl = scroller?.querySelector<HTMLElement>(`[data-user-msg-id="${newUserMsg.id}"]`);
      if (scroller && container && msgEl) {
        const scrollerRect = scroller.getBoundingClientRect();
        const msgRect = msgEl.getBoundingClientRect();
        const topOffset = 16;
        const targetScrollTop = msgRect.top - scrollerRect.top + scroller.scrollTop - topOffset;
        const maxScroll = scroller.scrollHeight - scroller.clientHeight;
        const extraNeeded = Math.max(0, targetScrollTop - maxScroll);

        if (extraNeeded > 0) {
          container.style.paddingBottom = `${160 + extraNeeded}px`;
        }
        scroller.scrollTo({ top: targetScrollTop, behavior: "smooth" });
      }
      return;
    }

    // Simulation updates — scroll to bottom unless user scrolled away
    if (newCount > prevCount && !userScrolledRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isProcessing]);

  useEffect(() => {
    const previous = prevBuildEventCountRef.current;
    prevBuildEventCountRef.current = buildEventCount;
    if (buildEventCount <= previous || userScrolledRef.current) return;
    const frame = requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ block: "end" });
    });
    return () => cancelAnimationFrame(frame);
  }, [buildEventCount]);

  // Shrink padding back once processing completes — clear any inline
  // paddingBottom that was injected to allow scroll-to-user-message.
  useEffect(() => {
    if (!isProcessing && contentRef.current) {
      contentRef.current.style.paddingBottom = "";
    }
  }, [isProcessing]);

  const hasMessages = messages.length > 0;
  const contentClassName = compact
    ? "w-full px-5 pt-5 pb-32 space-y-6"
    : "max-w-5xl mx-auto w-full px-12 pt-10 pb-40 space-y-6";

  return (
    <div className="absolute inset-0 overflow-y-auto overflow-x-hidden" ref={scrollRef} onScroll={handleScroll}>
      {onAddToFollowUp && onAddToKnowledge && (
        <SelectionPopup
          containerRef={scrollRef}
          onAddToFollowUp={onAddToFollowUp}
          onAddToKnowledge={onAddToKnowledge}
        />
      )}
      {hasMessages ? (
        <>
            <div ref={contentRef} className={contentClassName}>
              {messages.map((msg) => {
          // User bubble
          if (msg.role === "user") {
            return <div key={msg.id} data-user-msg-id={msg.id}><UserBubble message={msg} compact={compact} voiceAgentRequest={voiceAgentRequestIds.has(msg.id) || isVoiceAgentGenerationRequest(msg.content)} /></div>;
          }

          // Gathering context indicator
          if (msg.variant === "gathering") {
            return <div key={msg.id} className="animate-fade-in-up"><GatheringIndicator compact={compact} /></div>;
          }

          // Metric context card — full width, no avatar
          if (msg.variant === "metric-context" && msg.metricContext) {
            return (
              <div key={msg.id}>
                <MetricContextCard data={msg.metricContext} />
              </div>
            );
          }

          // Auto-deep-research notice — shown when classifier upgraded a query to deep mode
          if (msg.variant === "auto-deep-notice" && msg.autoDeepNotice) {
            return (
              <div key={msg.id} className="animate-fade-in-up">
                <AutoDeepNoticeCard
                  reason={msg.autoDeepNotice.reason}
                  status={msg.autoDeepNotice.status}
                />
              </div>
            );
          }

          // Streaming intermediate message
          if (msg.variant === "voice-agent-generation" && msg.voiceAgentGeneration) {
            const data = msg.voiceAgentGeneration;
            return (
              <div key={msg.id} className="w-full animate-fade-in-up">
                <VoiceAgentGenerationCard
                    data={data}
                    onRegenerate={() => {
                      if (!data.segmentId) {
                        chatInputRef.current?.setValue(data.goal);
                        chatInputRef.current?.focus();
                        return;
                      }
                      handleSend(data.goal, undefined, undefined, undefined, {
                        voiceAgentContext: {
                          datasetId: data.datasetId,
                          segmentId: data.segmentId,
                          segmentName: data.segmentName,
                          segmentUserCount: data.segmentUserCount,
                        },
                      });
                    }}
                    onRefine={() => {
                      const audience = data.result?.segment.name || data.segmentName || "the selected segment";
                      chatInputRef.current?.setValue(`Refine the voice agent for ${audience}: `);
                      chatInputRef.current?.setVoiceAgentContext({
                        datasetId: data.datasetId,
                        segmentId: data.result?.segment.id || data.segmentId,
                        segmentName: data.result?.segment.name || data.segmentName,
                        segmentUserCount: data.result?.segment.userCount || data.segmentUserCount,
                      });
                      chatInputRef.current?.focus();
                    }}
                />
              </div>
            );
          }

          // Streaming intermediate message
          if (msg.variant === "streaming") {
            return <div key={msg.id}><SentinelMessage message={msg} renderChartActions={renderChartActions} renderTableActions={renderTableActions} compact={compact} /></div>;
          }

          // report-cta: Save as Board is shown in the minimap, skip inline rendering
          if (msg.variant === "report-cta") {
            return null;
          }

          // Save to Knowledge nudge
          if (msg.variant === "save-to-knowledge" && msg.knowledgeSuggestion) {
            return (
              <div key={msg.id} className="pl-10">
                <SaveToKnowledgeWidget
                  content={msg.knowledgeSuggestion.content}
                  onSave={(level) => onSaveToKnowledge?.(msg.knowledgeSuggestion!.content, level)}
                  onDismiss={() => onDismissKnowledge?.(msg.id)}
                />
              </div>
            );
          }

          // Playbook creation wizard card
          if (msg.variant === "playbook-wizard" && msg.playbookWizard) {
            return (
              <div key={msg.id} className="flex gap-3 animate-fade-in-up">
                <SentinelAvatar compact={compact} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold mb-1.5">Actioneer</p>
                  <PlaybookWizardCard
                    message={msg}
                    onAnswer={(stepKey, answer) => {
                      // Mark this card as answered and notify via custom event
                      setMessages((prev) =>
                        prev.map((m) =>
                          m.id === msg.id && m.playbookWizard
                            ? { ...m, playbookWizard: { ...m.playbookWizard, answered: true, answer } }
                            : m
                        )
                      );
                      // Dispatch event for the playbook page to advance the wizard
                      window.dispatchEvent(new CustomEvent("playbook-wizard-answer", { detail: { stepKey, answer } }));
                    }}
                  />
                </div>
              </div>
            );
          }

          // Playbook plan review / alignment card
          if (msg.variant === "playbook-plan-review" && msg.playbookPlanReview) {
            return (
              <div key={msg.id} className="flex gap-3 animate-fade-in-up">
                <SentinelAvatar compact={compact} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold mb-1.5">Actioneer</p>
                  <PlaybookPlanReviewCard
                    cells={msg.playbookPlanReview.cells}
                    status={msg.playbookPlanReview.status}
                    changeSummary={msg.playbookPlanReview.changeSummary}
                    onApprove={() => {
                      // Mark as approved
                      setMessages((prev) =>
                        prev.map((m) =>
                          m.id === msg.id && m.playbookPlanReview
                            ? { ...m, playbookPlanReview: { ...m.playbookPlanReview, status: "approved" as const } }
                            : m
                        )
                      );
                      // Dispatch event for playbook page to start full generation
                      window.dispatchEvent(new CustomEvent("playbook-plan-approved"));
                    }}
                  />
                </div>
              </div>
            );
          }

          // Segment creation confirmation card
          if (msg.variant === "segment-confirm" && msg.segmentConfirm) {
            return (
              <div key={msg.id} className="flex gap-3 animate-fade-in-up">
                <SentinelAvatar compact={compact} />
                <div className="flex-1 min-w-0">
                  {msg.content && (
                    <div className="text-sm leading-relaxed prose prose-sm prose-neutral max-w-none mb-3">
                      <MarkdownContent
                        content={msg.content}
                        entityLookup={entityLookup}
                        onEntityClick={onEntityClick}
                      />
                    </div>
                  )}
                  <SegmentConfirmCard
                    data={msg.segmentConfirm}
                    msgId={msg.id}
                    onConfirm={(id, name) => onSegmentConfirm?.(id, name)}
                    onCancel={(id) => onSegmentCancel?.(id)}
                    onRefine={(id, desc) => onSegmentRefine?.(id, desc)}
                    onCreateVoiceCampaign={(id) => onSegmentVoiceCampaign?.(id)}
                    compact={compact}
                  />
                </div>
              </div>
            );
          }

          // Funnel creation confirmation card
          if (msg.variant === "funnel-confirm" && msg.funnelConfirm) {
            return (
              <div key={msg.id} className="flex gap-3 animate-fade-in-up">
                <SentinelAvatar compact={compact} />
                <div className="flex-1 min-w-0">
                  <FunnelConfirmCard
                    data={msg.funnelConfirm}
                    msgId={msg.id}
                    onConfirm={(id, name) => onFunnelConfirm?.(id, name)}
                    onCancel={(id) => onFunnelCancel?.(id)}
                    onRefine={(id, desc) => onFunnelRefine?.(id, desc)}
                    compact={compact}
                  />
                </div>
              </div>
            );
          }

          // Retention creation confirmation card
          if (msg.variant === "retention-confirm" && msg.retentionConfirm) {
            return (
              <div key={msg.id} className="flex gap-3 animate-fade-in-up">
                <SentinelAvatar compact={compact} />
                <div className="flex-1 min-w-0">
                  <RetentionConfirmCard
                    data={msg.retentionConfirm}
                    msgId={msg.id}
                    onConfirm={(id, name) => onRetentionConfirm?.(id, name)}
                    onCancel={(id) => onRetentionCancel?.(id)}
                    onRefine={(id, desc) => onRetentionRefine?.(id, desc)}
                    compact={compact}
                  />
                </div>
              </div>
            );
          }

          // Policy table selection card
          if (msg.variant === "policy-table-select" && msg.policyTableSelect) {
            return (
              <div key={msg.id} className="flex gap-3 animate-fade-in-up">
                <SentinelAvatar compact={compact} />
                <div className="flex-1 min-w-0">
                  <PolicyTableSelectCard
                    data={msg.policyTableSelect}
                    msgId={msg.id}
                    onSelect={handlePolicyTableSelect}
                  />
                </div>
              </div>
            );
          }

          // Policy creation confirmation card
          if (msg.variant === "policy-confirm" && msg.policyConfirm) {
            return (
              <div key={msg.id} className="flex gap-3 animate-fade-in-up">
                <SentinelAvatar compact={compact} />
                <div className="flex-1 min-w-0">
                  <PolicyConfirmCard
                    data={msg.policyConfirm}
                    msgId={msg.id}
                    onConfirm={(id) => onPolicyConfirm?.(id)}
                    onCancel={(id) => onPolicyCancel?.(id)}
                  />
                </div>
              </div>
            );
          }

          // Metric table selection card
          if (msg.variant === "metric-table-select" && msg.metricTableSelect) {
            return (
              <div key={msg.id} className="flex gap-3 animate-fade-in-up">
                <SentinelAvatar compact={compact} />
                <div className="flex-1 min-w-0">
                  <MetricTableSelectCard
                    data={msg.metricTableSelect}
                    msgId={msg.id}
                    onSelect={handleMetricTableSelect}
                    onChangeTable={handleChangeTable}
                  />
                </div>
              </div>
            );
          }

          // Metric generating loader
          if (msg.variant === "metric-generating" && msg.metricGenerating) {
            return (
              <div key={msg.id} className="flex gap-3 animate-fade-in-up">
                <SentinelAvatar compact={compact} />
                <div className="flex-1 min-w-0">
                  <MetricGeneratingCard data={msg.metricGenerating} />
                </div>
              </div>
            );
          }

          // Metric update confirmation card
          if (msg.variant === "metric-update-confirm" && msg.metricUpdateConfirm) {
            return (
              <div key={msg.id} className="flex gap-3 animate-fade-in-up">
                <SentinelAvatar compact={compact} />
                <div className="flex-1 min-w-0">
                  <MetricUpdateConfirmCard
                    data={msg.metricUpdateConfirm}
                    msgId={msg.id}
                    onPublish={(id) => onMetricUpdatePublish?.(id)}
                    onEdit={handleMetricEdit}
                    onManualSqlUpdate={handleManualSqlUpdate}
                    onNameChange={handleMetricNameChange}
                  />
                </div>
              </div>
            );
          }

          // Campaign draft card
          if (msg.variant === "campaign-draft" && msg.campaignDraft) {
            return (
              <div key={msg.id} className="flex gap-3 animate-fade-in-up">
                <SentinelAvatar compact={compact} />
                <div className="flex-1 min-w-0">
                  <CampaignDraftCard
                    data={msg.campaignDraft}
                    msgId={msg.id}
                    onFire={(id, edited) => onCampaignFire?.(id, edited)}
                    onCancel={(id) => onCampaignCancel?.(id)}
                    onRefine={(id, intent) => onCampaignRefine?.(id, intent)}
                    compact={compact}
                  />
                </div>
              </div>
            );
          }

          // Metric creation confirmation card
          if (msg.variant === "metric-create-confirm" && msg.metricCreateConfirm) {
            return (
              <div key={msg.id} className="flex gap-3 animate-fade-in-up">
                <SentinelAvatar compact={compact} />
                <div className="flex-1 min-w-0">
                  <MetricCreateConfirmCard
                    data={msg.metricCreateConfirm}
                    msgId={msg.id}
                    onApprove={handleMetricCreateApprove}
                    onDismiss={handleMetricCreateDismiss}
                    onSuggestEdits={handleMetricCreateSuggestEdits}
                  />
                </div>
              </div>
            );
          }

          // Save as Playbook standalone (for non-report flows)
          if (msg.variant === "save-as-playbook" && msg.userQuery) {
            return (
              <div key={msg.id} className="pl-10">
                <SaveAsPlaybookCTA onClick={() => onSaveAsPlaybook?.(msg.userQuery!)} />
              </div>
            );
          }

          // Playbook preview with save button
          if (msg.variant === "playbook-preview" && msg.playbookPreview) {
            return (
              <div key={msg.id} className="flex gap-3 animate-fade-in-up">
                <SentinelAvatar compact={compact} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold mb-1.5">Actioneer</p>
                  <div className="text-sm leading-relaxed prose prose-sm prose-neutral max-w-none mb-3">
                    <MarkdownContent content={msg.content} />
                  </div>
                  <button
                    onClick={() => onSavePlaybookPreview?.(msg.id)}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-foreground text-background rounded-lg hover:bg-foreground/90 transition-colors"
                  >
                    Save & Open Playbook
                  </button>
                </div>
              </div>
            );
          }

          // Connector required widget
          if (msg.variant === "connector-required" && msg.connectorInfo) {
            return (
              <div key={msg.id} className="flex gap-3 animate-fade-in-up">
                <SentinelAvatar compact={compact} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold mb-2">Actioneer</p>
                  {msg.content && (
                    <p className="text-sm text-muted-foreground mb-3">{msg.content}</p>
                  )}
                  <DataConnectorWidget
                    missing={msg.connectorInfo.missing}
                    categories={getCategoriesById(msg.connectorInfo.recommendedCategories)}
                    canProceedWithout={msg.connectorInfo.canProceedWithout}
                    degradedDescription={msg.connectorInfo.degradedDescription}
                    onCategoryClick={(catId) => onConnectorClick?.(catId)}
                    onProceedWithout={() => onProceedWithout?.(msg.connectorInfo!.originalQuery)}
                    onUploadCSV={() => onUploadCSV?.()}
                  />
                </div>
              </div>
            );
          }

          // Agent timeline — skip data-only quick-mode vessels (never rendered)
          if (msg.role === "agent" && msg.agent) {
            if (compact) {
              // In compact mode (sidebar), show a minimal phase indicator when processing
              if (msg.agent.status === "processing" && msg.agent.statusLabel) {
                return (
                  <div key={msg.id} className="flex gap-2 items-center py-2">
                    <SentinelAvatar compact />
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-foreground/50 animate-pulse shrink-0" />
                      <span className="text-xs text-muted-foreground">{msg.agent.statusLabel}</span>
                    </div>
                  </div>
                );
              }
              return null;
            }
            if (msg.isDataOnly) return null;
            return (
              <div key={msg.id}>
                <ResearchTimeline
                  agent={msg.agent}
                  onSubagentClick={onSubagentClick}
                />
              </div>
            );
          }

          // Sentinel message — branch order matters: isAnalyticsResponse first, then deep-mode DocumentView
          if (msg.role === "sentinel") {
            // Quick mode analytics: SentinelMessage visual with citation + pin support
            if (msg.isAnalyticsResponse && !msg.variant && msg.content.length > 0) {
              const hasInlinePins = msg.content.includes("```chart") || msg.content.includes("|");
              return (
                <div key={msg.id}>
                  <div className="flex gap-3">
                    <SentinelAvatar compact={compact} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold mb-1.5">Actioneer</p>
                      <div className="text-sm leading-relaxed prose prose-sm prose-neutral max-w-none">
                        <MarkdownContent
                          content={msg.content}
                          onCitationClick={onCitationClick}
                          activeCitation={activeCitation}
                          renderChartActions={renderChartActions}
                          renderTableActions={renderTableActions}
                          entityLookup={entityLookup}
                          onEntityClick={onEntityClick}
                        />
                      </div>
                      {!hasInlinePins && (
                        <div className="flex items-center gap-2 mt-2">
                          <PinButton
                            cardType="text"
                            title="Analysis"
                            markdownContent={msg.content}
                            sourceConversationId={conversationId}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                  <ResponseFooter message={msg} />
                  {msg.followUpActions && msg.followUpActions.length > 0 && onFollowUpAction && (
                    <NextSteps actions={msg.followUpActions} onAction={onFollowUpAction} conversationId={conversationId} />
                  )}
                </div>
              );
            }

            // Deep mode: DocumentView — only render messages explicitly marked as deep reports.
            const agentMsg = [...messages].reverse().find((m) => m.role === "agent" && m.agent && !m.isDataOnly);
            const hasAgentData = !!agentMsg;
            const hasExplicitReports = messages.some((m) => m.role === "sentinel" && m.isDeepResearchReport);
            const isLegacyDeepReport =
              !hasExplicitReports &&
              hasAgentData &&
              !msg.variant &&
              msg.content.length > 0 &&
              !msg.isAnalyticsResponse;
            const isDeepReport = !!msg.isDeepResearchReport || isLegacyDeepReport;

            if (hasAgentData && isDeepReport && !msg.variant && msg.content.length > 0) {
              const headingIdPrefix = `report-${msg.id}`;
              return (
                <div key={msg.id} data-deep-report-id={msg.id}>
                  <DocumentView
                    content={msg.content}
                    onCitationClick={onCitationClick}
                    activeCitation={activeCitation}
                    subagents={agentMsg?.agent?.subagents}
                    renderChartActions={renderChartActions}
                    renderTableActions={renderTableActions}
                    entityLookup={entityLookup}
                    onEntityClick={onEntityClick}
                    headingIdPrefix={headingIdPrefix}
                  />
                  <div className="flex items-center gap-2 mt-2 pl-4">
                    <PinButton
                      cardType="report"
                      title="Research Report"
                      markdownContent={msg.content}
                      sourceConversationId={conversationId}
                    />
                  </div>
                  <ResponseFooter message={msg} />
                  {msg.followUpActions && msg.followUpActions.length > 0 && onFollowUpAction && (
                    <NextSteps actions={msg.followUpActions} onAction={onFollowUpAction} conversationId={conversationId} />
                  )}
                </div>
              );
            }

            return (
              <div key={msg.id}>
                <SentinelMessage message={msg} renderChartActions={renderChartActions} renderTableActions={renderTableActions} entityLookup={entityLookup} onEntityClick={onEntityClick} compact={compact} onOptionSelect={sharedPolicyContextRef?.current ? (text) => handleSend(text) : undefined} />
                <ResponseFooter message={msg} />
                {msg.followUpActions && msg.followUpActions.length > 0 && onFollowUpAction && (
                  <NextSteps actions={msg.followUpActions} onAction={onFollowUpAction} conversationId={conversationId} />
                )}
              </div>
            );
          }

          return null;
        })}
              <div ref={bottomRef} />
            </div>

          {!hideMinimap && !isProcessing && deepReports.size > 0 && (
            <ReportMinimap
              content={visibleReport?.content ?? ""}
              reportId={visibleReport?.msgId ?? ""}
              scrollRef={scrollRef}
              visible={!!visibleReport}
              onSaveAsBoard={onSaveAsBoard ? () => {
                const userMsg = [...messages].reverse().find((m) => m.role === "user");
                if (userMsg) onSaveAsBoard(userMsg.content);
              } : undefined}
              isSavingBoard={isSavingBoard}
            />
          )}
        </>
      ) : (
        <div ref={contentRef} className={contentClassName} />
      )}
    </div>
  );
});

// ── Gathering context ──

function GatheringIndicator({ compact }: { compact?: boolean }) {
  return (
    <div className={`flex ${compact ? "gap-2" : "gap-3"}`}>
      <SentinelAvatar compact={compact} />
      <div className="pt-1">
        <p className={`font-semibold mb-1 ${compact ? "text-xs" : "text-sm"}`}>Actioneer</p>
        <div className="flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
          <ShimmeringText
            text="Understanding your question..."
            className={`${compact ? "text-xs" : "text-sm"} text-muted-foreground`}
            duration={3}
            repeatDelay={0}
          />
        </div>
      </div>
    </div>
  );
}

// ── User bubble ──

function UserBubble({ message, compact, voiceAgentRequest }: { message: ChatMessage; compact?: boolean; voiceAgentRequest?: boolean }) {
  return (
    <div className={voiceAgentRequest ? "max-w-3xl bg-muted/60 px-4 py-3" : "pt-2"}>
      {message.contextRefs && message.contextRefs.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {message.contextRefs.map((ref, i) => (
            <span
              key={i}
              className={`inline-flex items-center gap-1 px-2 py-0.5 font-medium bg-foreground/[0.08] text-foreground/70 rounded-md ${compact ? "text-[9px]" : "text-xs"}`}
            >
              @{ref.displayLabel}
            </span>
          ))}
        </div>
      )}
      <p className={voiceAgentRequest
        ? "text-base font-normal leading-7 text-foreground"
        : `font-medium text-foreground leading-snug ${compact ? "text-[1.1rem]" : "text-2xl"}`
      }>
        {message.content}
      </p>
    </div>
  );
}

// ── Sentinel message ──

function SentinelMessage({ message, entityLookup, onEntityClick, renderChartActions, renderTableActions, compact, onOptionSelect }: {
  message: ChatMessage;
  entityLookup?: Map<string, DetectableEntity>;
  onEntityClick?: (entity: DetectableEntity) => void;
  renderChartActions?: (spec: ChartSpec) => React.ReactNode;
  renderTableActions?: (data: Record<string, unknown>[], title: string) => React.ReactNode;
  compact?: boolean;
  onOptionSelect?: (text: string) => void;
}) {
  const isWaiting = message.variant === "streaming" && !message.content;
  const isStreaming = message.variant === "streaming" && !!message.content;
  const showSelectableOptions = !isStreaming && !isWaiting && onOptionSelect && hasNumberedOptions(message.content);

  // Helper function to detect phase from message content
  const getPhaseFromContent = (content: string) => {
    if (!content || content === "Thinking...") return "gathering";
    if (content.includes("Generating query...")) return "generating_sql";
    if (content.includes("Running analysis...")) return "executing";
    if (content.includes("Preparing answer...")) return "synthesizing";
    return null; // Not a phase message, use regular streaming
  };

  const phase = isStreaming ? getPhaseFromContent(message.content) : null;

  return (
    <div className={`flex ${compact ? "gap-2" : "gap-3"}`}>
      <SentinelAvatar compact={compact} />
      <div className="flex-1 min-w-0">
        <p className={`font-semibold mb-1.5 ${compact ? "text-xs" : "text-sm"}`}>Actioneer</p>
        {isWaiting ? (
          <TypingIndicator />
        ) : isStreaming && phase ? (
          <div className="py-2">
            <QuickModeProgress phase={phase} />
          </div>
        ) : showSelectableOptions ? (
          <div>
            <div className={`${compact ? "text-xs" : "text-sm"} leading-relaxed prose ${compact ? "prose-xs" : "prose-sm"} prose-neutral max-w-none`}>
              <MarkdownContent content={parseNumberedOptions(message.content).preamble} renderChartActions={renderChartActions} renderTableActions={renderTableActions} entityLookup={entityLookup} onEntityClick={onEntityClick} />
            </div>
            <SelectableOptions content={message.content} onSelect={onOptionSelect} />
          </div>
        ) : (
          <div className={`${compact ? "text-xs" : "text-sm"} leading-relaxed prose ${compact ? "prose-xs" : "prose-sm"} prose-neutral max-w-none`}>
            <MarkdownContent content={message.content} renderChartActions={renderChartActions} renderTableActions={renderTableActions} entityLookup={entityLookup} onEntityClick={onEntityClick} />
            {isStreaming && <span className="inline-block w-[2px] h-4 bg-foreground/70 animate-pulse rounded-sm ml-0.5 align-text-bottom" />}
          </div>
        )}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="py-2">
      <span className="inline-block w-[2px] h-4 bg-foreground/70 animate-pulse rounded-sm" />
    </div>
  );
}

// ── Sentinel avatar ──

function SentinelAvatar({ compact }: { compact?: boolean }) {
  return (
    <SentinelLogo
      size={compact ? 14 : 18}
      variant="contained"
      className="mt-0.5"
    />
  );
}
