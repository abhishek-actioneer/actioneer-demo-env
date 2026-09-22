import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { useSidebarContext } from "@/components/sidebar-context";
import { useDataset } from "@/lib/dataset-context";
import { buildPlaybookFromResearch } from "@/lib/playbook-builder";
import { savePlaybook } from "@/lib/playbook-store";
import { getOwnerInfo, PLAYBOOK_DEFAULTS } from "@/lib/playbook-defaults";
import { saveBoard, saveBoardSection, saveBoardCard } from "@/lib/board-store";
import { markPendingAction, getConversation } from "@/lib/conversation-store";
import { apiFetch } from "@/lib/api-client";
import { toast } from "sonner";
import type { ChatMessage, FollowUpAction } from "@/lib/types";
import type { Board, BoardSection, BoardCard } from "@/lib/board-types";
import type { CellRole, NewCellType, PlaybookCellV2, PlaybookParam, PlaybookProduces, PlaybookV2 } from "@/lib/playbook-types";
import { savePolicy } from "@/lib/policy-store";
import type { DataPolicy } from "@/lib/policy-types";
import { useMetricUpdate } from "@/hooks/use-metric-update";
import type { MetricUpdateResult } from "@/hooks/use-metric-update";
import { getMetric, getAllMetrics, updateMetric, addChangelogEntry } from "@/lib/metric-store";
import type { Metric } from "@/lib/metric-types";

const CELL_ROLES: CellRole[] = ["guardrail", "parameter", "query", "analysis", "summary"];
const PARAM_TYPES = new Set<PlaybookParam["type"]>(["date", "integer", "float", "boolean", "string"]);

function normalizeCellType(value: string | undefined): NewCellType {
  return value === "llm" ? "llm" : "sql";
}

function normalizeCellRole(value: string | undefined, type: NewCellType, index: number, total: number): CellRole {
  if (value && CELL_ROLES.includes(value as CellRole)) return value as CellRole;
  if (type === "llm") return index === total - 1 ? "summary" : "analysis";
  return index === 0 ? "guardrail" : "query";
}

function normalizeStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return items.length > 0 ? items : fallback;
}

function normalizePreviewParams(params: unknown): PlaybookParam[] {
  if (!Array.isArray(params)) return [];
  return params
    .filter((param): param is Record<string, unknown> => !!param && typeof param === "object")
    .map((param, index) => {
      const name = typeof param.name === "string" && param.name.trim() ? param.name : `param_${index + 1}`;
      const rawType = typeof param.type === "string" ? param.type : "string";
      return {
        name,
        label: typeof param.label === "string" && param.label.trim() ? param.label : name.replace(/_/g, " "),
        type: PARAM_TYPES.has(rawType as PlaybookParam["type"]) ? rawType as PlaybookParam["type"] : "string",
        defaultVal: typeof param.defaultVal === "string" ? param.defaultVal : String(param.defaultVal ?? ""),
        ...(typeof param.group === "string" ? { group: param.group } : {}),
      };
    });
}

function normalizePreviewProduces(produces: unknown): PlaybookProduces[] {
  if (!Array.isArray(produces)) return [];
  return produces
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item, index) => ({
      name: typeof item.name === "string" && item.name.trim() ? item.name : `output_${index + 1}`,
      description: typeof item.description === "string" ? item.description : "",
      ...(Array.isArray(item.columns)
        ? {
            columns: item.columns
              .filter((column): column is Record<string, unknown> => !!column && typeof column === "object")
              .map((column) => ({
                name: typeof column.name === "string" ? column.name : "",
                description: typeof column.description === "string" ? column.description : "",
              }))
              .filter((column) => column.name),
          }
        : {}),
    }));
}

interface UseActionHandlersArgs {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  activeConvId: string | null;
  messagesRef: React.RefObject<ChatMessage[]>;
  agentMsgIdRef: React.RefObject<string>;
  handleSend: (text: string) => void;
  openSegmentModal: (sql: string, defaultName: string, pushTo?: string) => void;
}

export function useActionHandlers({
  messages,
  setMessages,
  activeConvId,
  messagesRef,
  agentMsgIdRef,
  handleSend,
  openSegmentModal,
}: UseActionHandlersArgs) {
  const router = useRouter();
  const { user: clerkUser } = useUser();
  const ownerInfo = getOwnerInfo(clerkUser);
  const {
    notifyPlaybookSaved,
    refreshSegments,
    refreshFunnels,
    refreshRetentions,
    notifyBoardChanged,
  } = useSidebarContext();
  const { datasetId } = useDataset();

  // ── Follow-up action handler ──

  const handleFollowUpAction = useCallback(
    async (action: FollowUpAction) => {
      if (action.type === "follow-up-question") {
        handleSend(action.label);
        return;
      }

      if (
        action.type === "create-segment-clevertap" ||
        action.type === "create-segment-firebase" ||
        action.type === "create-segment-bigquery" ||
        action.type === "create-segment"
      ) {
        const agentMsg = messages.find((m) => m.id === agentMsgIdRef.current);

        // Generate proper segment SQL via the LLM endpoint (not reusing analytics queries)
        const userQuery = agentMsg?.content || action.label;
        const payloadName = (action.payload?.name as string | undefined)?.trim();

        let segmentSql = "";
        let llmName = "";
        try {
          const sqlData = await apiFetch<{ sql: string; name?: string }>("/api/segments/generate-sql", {
            method: "POST",
            body: { description: userQuery, datasetId },
          });
          segmentSql = sqlData.sql;
          llmName = (sqlData.name ?? "").trim();
        } catch {
          toast.error("Failed to generate segment SQL. Try creating manually.");
          return;
        }
        if (!segmentSql) {
          toast("Could not generate SQL for this segment.");
          return;
        }

        const defaultName = payloadName || llmName || "User Segment";

        const pushTo = action.type === "create-segment-clevertap" ? "clevertap"
          : action.type === "create-segment-firebase" ? "firebase"
          : action.type === "create-segment-bigquery" ? "bigquery"
          : undefined;
        openSegmentModal(segmentSql, defaultName, pushTo);
        await markPendingActionCompleted(action);
      } else if (action.type === "view-in-store") {
        router.push("/store");
        await markPendingActionCompleted(action);
      }

      async function markPendingActionCompleted(a: FollowUpAction) {
        if (!activeConvId) return;
        const conv = await getConversation(activeConvId);
        const matching = conv?.pendingActions?.find(
          (pa) => pa.type === a.type && !pa.completedAt && !pa.dismissedAt
        );
        if (matching) await markPendingAction(activeConvId, matching.id, "completed");
      }
    },
    [messages, handleSend, router, agentMsgIdRef, openSegmentModal, activeConvId, datasetId]
  );

  // ── Playbook handlers ──

  const handleSaveAsPlaybook = useCallback(
    (userQuery: string) => {
      const playbook = buildPlaybookFromResearch(messages, userQuery, activeConvId ?? undefined, ownerInfo);
      if (!playbook) {
        setMessages((prev) => [
          ...prev,
          {
            id: Math.random().toString(36).slice(2, 10),
            role: "sentinel",
            content: "No queries found to convert into a playbook.",
            timestamp: Date.now(),
          },
        ]);
        return;
      }
      // Tag playbook with the active dataset
      playbook.datasetId = datasetId;
      savePlaybook(playbook);
      notifyPlaybookSaved();
      router.push(`/playbooks/${playbook.id}`);
    },
    [messages, setMessages, router, notifyPlaybookSaved, datasetId, activeConvId]
  );

  const handleConvertToPlaybook = useCallback(
    (userQuery: string) => {
      const playbook = buildPlaybookFromResearch(messages, userQuery, activeConvId ?? undefined, ownerInfo);
      if (!playbook) {
        setMessages((prev) => [
          ...prev,
          {
            id: Math.random().toString(36).slice(2, 10),
            role: "sentinel",
            content:
              "No queries found in this thread to convert into a playbook. Try running some analysis first.",
            timestamp: Date.now(),
          },
        ]);
        return;
      }
      playbook.datasetId = datasetId;
      savePlaybook(playbook);
      notifyPlaybookSaved();

      // Add conversion message
      setMessages((prev) => [
        ...prev,
        {
          id: Math.random().toString(36).slice(2, 10),
          role: "sentinel",
          content: `Converting thread to playbook **${playbook.name}** with ${playbook.cells.length} cells. Opening the canvas for review...`,
          timestamp: Date.now(),
        },
      ]);

      // Navigate to canvas with fromThread flag — skips QnA wizard, shows plan directly
      router.push(`/playbooks/${playbook.id}?wizard=true&fromThread=true`);
    },
    [messages, setMessages, router, notifyPlaybookSaved, datasetId, activeConvId]
  );

  const handleSavePlaybookPreview = useCallback(
    async (msgId: string) => {
      const currentMessages = messagesRef.current.length > 0 ? messagesRef.current : messages;
      const msg = currentMessages.find((m) => m.id === msgId);
      const preview = msg?.playbookPreview;
      if (!preview) {
        toast.error("No generated playbook found to save.");
        return;
      }

      const cells: PlaybookCellV2[] = preview.cells.map((cell, index) => {
        const id = cell.id || `c${index + 1}`;
        const type = normalizeCellType(cell.type);
        const role = normalizeCellRole(cell.role, type, index, preview.cells.length);
        const fallbackDependsOn = index > 0 ? [preview.cells[index - 1]?.id || `c${index}`] : [];
        const dependsOn = normalizeStringArray(cell.dependsOn, fallbackDependsOn);
        const outputs = normalizeStringArray(cell.outputs, [`${role}_${index + 1}`]);
        return {
          id,
          type,
          role,
          label: cell.label || `Step ${index + 1}`,
          description: cell.description || "",
          status: "idle",
          dependsOn,
          outputs,
          ...(type === "sql" && cell.sql ? { sql: cell.sql } : {}),
          ...(type === "llm" && cell.prompt ? { prompt: cell.prompt } : {}),
        };
      });

      if (cells.length === 0) {
        toast.error("The generated playbook has no cells to save.");
        return;
      }

      const params = normalizePreviewParams(preview.params);
      let invalidSqlCount = 0;
      try {
        const validation = await apiFetch<{
          results?: Array<{ cellId: string; valid: boolean; error?: string }>;
        }>("/api/playbook/validate", {
          method: "POST",
          body: { cells, params, datasetId },
          skipModel: true,
        });
        invalidSqlCount = validation.results?.filter((result) => !result.valid).length ?? 0;
      } catch (err) {
        console.warn("[playbook-preview] SQL validation failed before save:", err);
      }

      const id = `pb-${Date.now().toString(36)}`;
      const playbook: PlaybookV2 = {
        id,
        schemaVersion: 2,
        name: preview.name || "Generated Playbook",
        description: preview.description || "",
        category: PLAYBOOK_DEFAULTS.category,
        version: PLAYBOOK_DEFAULTS.version,
        approvalStatus: PLAYBOOK_DEFAULTS.approvalStatus,
        owner: ownerInfo.owner,
        ownerInitials: ownerInfo.ownerInitials,
        datasetId,
        cells,
        params,
        produces: normalizePreviewProduces(preview.produces),
        runHistory: [],
        changelog: [],
        sourceConversationId: activeConvId ?? undefined,
        sourceQuery: msg.userQuery,
      };

      if (!savePlaybook(playbook)) {
        toast.error("Failed to save playbook.");
        return;
      }

      notifyPlaybookSaved();
      if (invalidSqlCount > 0) {
        toast.warning(`Playbook saved with ${invalidSqlCount} SQL validation issue${invalidSqlCount === 1 ? "" : "s"}.`);
      } else {
        toast.success("Playbook saved");
      }
      router.push(`/playbooks/${id}?wizard=true&fromThread=true`);
    },
    [activeConvId, datasetId, messages, messagesRef, notifyPlaybookSaved, ownerInfo, router]
  );

  // ── Knowledge handlers ──

  const handleSaveToKnowledge = useCallback(
    async (content: string, level: "global" | "user") => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { entry } = await apiFetch<{ entry: any }>("/api/knowledge/add", {
          method: "POST",
          body: { content, priority: "High", level, sourceConversationId: activeConvId ?? undefined },
        });
        {
          const { saveKnowledgeEntry } = await import("@/lib/knowledge-store");
          saveKnowledgeEntry(datasetId, { ...entry, sourceConversationId: activeConvId ?? undefined });
        }
      } catch (err) {
        console.error("Failed to save knowledge:", err);
        toast.error("Failed to save to knowledge base.");
      }
    },
    [activeConvId, datasetId]
  );

  const handleDismissKnowledge = useCallback((msgId: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== msgId));
  }, [setMessages]);

  // ── Segment confirm/cancel/refine ──

  const handleSegmentConfirm = useCallback(
    async (msgId: string, name: string) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId && m.segmentConfirm
            ? { ...m, segmentConfirm: { ...m.segmentConfirm, status: "confirming" as const } }
            : m
        )
      );

      try {
        const msg = messagesRef.current.find((m) => m.id === msgId);
        const sql = msg?.segmentConfirm?.sql;
        if (!sql) throw new Error("No SQL found");
        const description = msg?.segmentConfirm?.description;

        const segment = await apiFetch<{ id: string }>("/api/segments", {
          method: "POST",
          body: {
            name,
            sql,
            description,
            sourceConversationId: activeConvId ?? undefined,
            datasetId,
          },
        });

        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId && m.segmentConfirm
              ? { ...m, segmentConfirm: { ...m.segmentConfirm, status: "confirmed" as const, segmentId: segment.id } }
              : m
          )
        );

        toast.success(`Segment "${name}" created`);
        refreshSegments();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to create segment";
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId && m.segmentConfirm
              ? { ...m, segmentConfirm: { ...m.segmentConfirm, status: "error" as const, error: message } }
              : m
          )
        );
      }
    },
    [setMessages, messagesRef, datasetId, activeConvId, refreshSegments]
  );

  const handleSegmentCancel = useCallback(
    (msgId: string) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId && m.segmentConfirm
            ? { ...m, segmentConfirm: { ...m.segmentConfirm, status: "cancelled" as const } }
            : m
        )
      );
    },
    [setMessages]
  );

  const handleSegmentRefine = useCallback(
    async (msgId: string, newDescription: string) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId && m.segmentConfirm
            ? { ...m, variant: "streaming" as const, content: "Refining segment...", segmentConfirm: undefined }
            : m
        )
      );

      try {
        let sql: string;
        let llmName = "";
        let llmDescription = "";
        try {
          const sqlData = await apiFetch<{ sql: string; name?: string; description?: string }>(
            "/api/segments/generate-sql",
            {
              method: "POST",
              body: { description: newDescription, datasetId },
            }
          );
          sql = sqlData.sql;
          llmName = (sqlData.name ?? "").trim();
          llmDescription = (sqlData.description ?? "").trim();
        } catch (sqlErr) {
          const message = sqlErr instanceof Error ? sqlErr.message : "Couldn't generate a segment for that description.";
          setMessages((prev) =>
            prev.map((m) =>
              m.id === msgId
                ? { ...m, variant: undefined, content: message }
                : m
            )
          );
          return;
        }

        let userCount: number | null = null;
        try {
          const countData = await apiFetch<{ count: number }>("/api/segments/count", {
            method: "POST",
            body: { sql },
            skipModel: true,
          });
          userCount = countData.count;
        } catch {
          // Count failed
        }

        const suggestedName =
          llmName ||
          newDescription
            .replace(/^(users?\s+who\s+|customers?\s+who\s+)/i, "")
            .replace(/\b\w/g, (c: string) => c.toUpperCase())
            .slice(0, 50);

        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId
              ? {
                  ...m,
                  variant: "segment-confirm" as const,
                  content: "",
                  segmentConfirm: {
                    suggestedName,
                    sql,
                    description: llmDescription || newDescription,
                    userCount,
                    status: "ready" as const,
                  },
                }
              : m
          )
        );
      } catch {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId
              ? { ...m, variant: undefined, content: "Something went wrong while refining the segment." }
              : m
          )
        );
      }
    },
    [setMessages, datasetId]
  );

  const handleSegmentVoiceCampaign = useCallback(
    async (msgId: string) => {
      const msg = messagesRef.current.find((item) => item.id === msgId);
      const segmentConfirm = msg?.segmentConfirm;
      if (!segmentConfirm) return;

      setMessages((prev) =>
        prev.map((item) =>
          item.id === msgId && item.segmentConfirm
            ? {
                ...item,
                segmentConfirm: {
                  ...item.segmentConfirm,
                  voiceCampaignStatus: "creating" as const,
                  voiceCampaignError: undefined,
                },
              }
            : item
        )
      );

      try {
        const result = await apiFetch<{
          segment: { id: string; name: string; userCount?: number };
          openUrl: string;
        }>("/api/growth-opportunities/voice-campaign", {
          method: "POST",
          body: {
            datasetId,
            segmentId: segmentConfirm.segmentId,
            segmentName: segmentConfirm.segmentId ? undefined : segmentConfirm.suggestedName,
            segmentSql: segmentConfirm.segmentId ? undefined : segmentConfirm.sql,
            segmentDescription: segmentConfirm.description,
            sourceConversationId: activeConvId ?? undefined,
            objective: segmentConfirm.description,
          },
          skipModel: true,
        });

        const userCount = result.segment.userCount ?? segmentConfirm.userCount;
        const countText = typeof userCount === "number" && userCount > 0
          ? ` for ${userCount.toLocaleString()} users`
          : "";

        setMessages((prev) => [
          ...prev.map((item) =>
            item.id === msgId && item.segmentConfirm
              ? {
                  ...item,
                  segmentConfirm: {
                    ...item.segmentConfirm,
                    segmentId: result.segment.id,
                    voiceCampaignStatus: "created" as const,
                    voiceCampaignUrl: result.openUrl,
                    voiceCampaignError: undefined,
                  },
                }
              : item
          ),
          {
            id: `voice-setup-${Date.now()}`,
            role: "sentinel" as const,
            content: `**Voice campaign draft ready**\n\n${result.segment.name} is ready${countText}. I created a saved voice campaign draft with an audience-aware offer and script. Review it, run a live test, then add phone numbers before launching calls.\n\n[Open the voice campaign](${result.openUrl})`,
            timestamp: Date.now(),
          },
        ]);

        toast.success("Voice campaign draft ready");
        refreshSegments();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to create voice campaign draft";
        setMessages((prev) =>
          prev.map((item) =>
            item.id === msgId && item.segmentConfirm
              ? {
                  ...item,
                  segmentConfirm: {
                    ...item.segmentConfirm,
                    voiceCampaignStatus: "error" as const,
                    voiceCampaignError: message,
                  },
                }
              : item
          )
        );
        toast.error(message);
      }
    },
    [activeConvId, datasetId, messagesRef, refreshSegments, setMessages]
  );

  // ── Funnel confirm/cancel/refine ──

  const handleFunnelConfirm = useCallback(
    async (msgId: string, name: string) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId && m.funnelConfirm
            ? { ...m, funnelConfirm: { ...m.funnelConfirm, status: "confirming" as const } }
            : m
        )
      );

      try {
        const msg = messagesRef.current.find((m) => m.id === msgId);
        const funnelData = msg?.funnelConfirm;
        if (!funnelData) throw new Error("No funnel data found");

        const result = await apiFetch<{ id: string }>("/api/funnels", {
          method: "POST",
          body: {
            name,
            description: funnelData.description,
            config: funnelData.config,
            source: "chat",
            datasetId,
          },
        });

        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId && m.funnelConfirm
              ? { ...m, funnelConfirm: { ...m.funnelConfirm, status: "confirmed" as const, funnelId: result.id } }
              : m
          )
        );

        toast.success(`Funnel "${name}" created`);
        refreshFunnels();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to create funnel";
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId && m.funnelConfirm
              ? { ...m, funnelConfirm: { ...m.funnelConfirm, status: "error" as const, error: message } }
              : m
          )
        );
      }
    },
    [setMessages, messagesRef, datasetId, refreshFunnels]
  );

  const handleFunnelCancel = useCallback(
    (msgId: string) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId && m.funnelConfirm
            ? { ...m, funnelConfirm: { ...m.funnelConfirm, status: "cancelled" as const } }
            : m
        )
      );
    },
    [setMessages]
  );

  const handleFunnelRefine = useCallback(
    async (msgId: string, newDescription: string) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId && m.funnelConfirm
            ? { ...m, variant: "streaming" as const, content: "Refining funnel...", funnelConfirm: undefined }
            : m
        )
      );

      try {
        const genData = await apiFetch<{
          config: import("@/lib/funnel-types").FunnelConfig;
          name: string;
          overallConversion: number | null;
        }>("/api/funnels/generate-config", {
          method: "POST",
          body: { description: newDescription },
        });

        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId
              ? {
                  ...m,
                  variant: "funnel-confirm" as const,
                  content: "",
                  funnelConfirm: {
                    suggestedName: genData.name,
                    config: genData.config,
                    description: newDescription,
                    overallConversion: genData.overallConversion,
                    status: "ready" as const,
                  },
                }
              : m
          )
        );
      } catch {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId
              ? { ...m, variant: undefined, content: "Something went wrong while refining the funnel." }
              : m
          )
        );
      }
    },
    [setMessages]
  );

  // ── Retention confirm/cancel/refine ──

  const handleRetentionConfirm = useCallback(
    async (msgId: string, name: string) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId && m.retentionConfirm
            ? { ...m, retentionConfirm: { ...m.retentionConfirm, status: "confirming" as const } }
            : m
        )
      );

      try {
        const msg = messagesRef.current.find((m) => m.id === msgId);
        const retentionData = msg?.retentionConfirm;
        if (!retentionData) throw new Error("No retention data found");

        const result = await apiFetch<{ id: string }>("/api/retentions", {
          method: "POST",
          body: {
            name,
            description: retentionData.description,
            config: retentionData.config,
            source: "chat",
            datasetId,
          },
        });

        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId && m.retentionConfirm
              ? { ...m, retentionConfirm: { ...m.retentionConfirm, status: "confirmed" as const, retentionId: result.id } }
              : m
          )
        );

        toast.success(`Retention "${name}" created`);
        refreshRetentions();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to create retention";
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId && m.retentionConfirm
              ? { ...m, retentionConfirm: { ...m.retentionConfirm, status: "error" as const, error: message } }
              : m
          )
        );
      }
    },
    [setMessages, messagesRef, datasetId, refreshRetentions]
  );

  const handleRetentionCancel = useCallback(
    (msgId: string) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId && m.retentionConfirm
            ? { ...m, retentionConfirm: { ...m.retentionConfirm, status: "cancelled" as const } }
            : m
        )
      );
    },
    [setMessages]
  );

  const handleRetentionRefine = useCallback(
    async (msgId: string, newDescription: string) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId && m.retentionConfirm
            ? { ...m, variant: "streaming" as const, content: "Refining retention...", retentionConfirm: undefined }
            : m
        )
      );

      try {
        const genData = await apiFetch<{
          config: import("@/lib/retention-types").RetentionConfig;
          name: string;
          d7Retention: number | null;
        }>("/api/retentions/generate-config", {
          method: "POST",
          body: { description: newDescription },
        });

        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId
              ? {
                  ...m,
                  variant: "retention-confirm" as const,
                  content: "",
                  retentionConfirm: {
                    suggestedName: genData.name,
                    config: genData.config,
                    description: newDescription,
                    d7Retention: genData.d7Retention,
                    status: "ready" as const,
                  },
                }
              : m
          )
        );
      } catch {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId
              ? { ...m, variant: undefined, content: "Something went wrong while refining the retention analysis." }
              : m
          )
        );
      }
    },
    [setMessages]
  );

  // ── Save as Board handler ──

  const [isSavingBoard, setIsSavingBoard] = useState(false);

  const handleSaveAsBoard = useCallback(
    async (userQuery: string) => {
      const currentMessages = messagesRef.current.length > 0 ? messagesRef.current : messages;
      const reversedMessages = [...currentMessages].reverse();

      // Find the latest agent message with subagent data.
      const agentMsg = reversedMessages.find(
        (m) => m.role === "agent" && m.agent && !m.isDataOnly
      );
      if (!agentMsg?.agent) {
        toast.error("No research data available to create a board.");
        return;
      }

      const reportMsg =
        reversedMessages.find((m) => m.role === "sentinel" && m.isDeepResearchReport && m.content.length > 0) ??
        reversedMessages.find(
          (m) =>
            m.role === "sentinel" &&
            !m.variant &&
            m.content.length > 0 &&
            !m.isAnalyticsResponse
        );

      setIsSavingBoard(true);
      try {
        const res = await apiFetch<{
          name: string;
          description: string;
          sections: Array<{
            id: string;
            boardId: string;
            title: string;
            prose: string;
            order: number;
            collapsed: boolean;
          }>;
          cards: Array<BoardCard>;
        }>("/api/board-from-research", {
          method: "POST",
          body: {
            userQuery,
            subagents: agentMsg.agent.subagents,
            reportMarkdown: reportMsg?.content,
          },
        });

        // Create a new board
        const boardId = `board-${Date.now()}`;
        const now = new Date().toISOString();
        const board: Board = {
          id: boardId,
          name: res.name,
          description: res.description,
          datasetId,
          viewMode: "document",
          createdAt: now,
          updatedAt: now,
        };
        saveBoard(board);

        // Save sections
        for (const section of res.sections) {
          const s: BoardSection = { ...section, boardId };
          saveBoardSection(s);
        }

        // Save cards
        for (const card of res.cards) {
          const c: BoardCard = {
            ...card,
            boardId,
            comments: card.comments ?? [],
          };
          saveBoardCard(c);
        }

        notifyBoardChanged();
        router.push(`/canvas/${boardId}`);
      } catch (err) {
        console.error("[handleSaveAsBoard] error:", err);
        toast.error("Failed to create board from research.");
      } finally {
        setIsSavingBoard(false);
      }
    },
    [messages, messagesRef, datasetId, router, notifyBoardChanged]
  );

  // ── Metric update publish / dismiss ──

  const { publishUpdate } = useMetricUpdate();

  const handleMetricUpdatePublish = useCallback(
    async (msgId: string) => {
      const msg = messagesRef.current.find((m) => m.id === msgId);
      const confirm = msg?.metricUpdateConfirm;
      if (!confirm) return;

      const metric = getMetric(datasetId, confirm.metricId);
      if (!metric) {
        toast.error("Metric not found");
        return;
      }

      // Apply inline name edit if present
      const effectiveName = confirm.newName || confirm.metricName;
      if (confirm.newName && confirm.newName !== metric.name) {
        updateMetric(datasetId, confirm.metricId, { name: confirm.newName });
      }

      const result: MetricUpdateResult = {
        success: true,
        newSql: confirm.newSql,
        newFormula: confirm.newFormula,
        explanation: confirm.explanation,
        affectedMetrics: confirm.affectedMetrics,
      };

      const isNewMetric = metric.version === 0;

      if (isNewMetric) {
        // Persist new metric to server first so it survives navigation
        try {
          const definition = {
            id: confirm.metricId,
            name: effectiveName,
            description: confirm.newDescription || confirm.oldDescription || metric.description,
            type: metric.type || "diagnostic",
            category: metric.category || "Uncategorized",
            valueFormat: metric.valueFormat || "number",
            aggregation: metric.aggregation || "count",
            valueSql: confirm.valueSql || confirm.newSql,
            timeSeriesSql: confirm.timeSeriesSql || confirm.newSql,
            table: confirm.table || metric.table,
            column: metric.column || "",
            timeColumn: metric.timeColumn || "date",
            formula: confirm.newFormula,
            relationships: [],
          };
          const res = await apiFetch<{ success: boolean; metric?: Metric; error?: string }>("/api/metrics", {
            method: "POST",
            body: { definition },
          });
          if (res.success && res.metric) {
            // Update client store with server-computed values but keep version 0
            // so the pending update flow still works (approval bumps to v1)
            updateMetric(datasetId, confirm.metricId, {
              ...res.metric,
              version: 0, // keep at 0 — approval will bump to 1
            });
          }
        } catch (err) {
          console.error("[metric-publish] Failed to persist:", err);
          toast.error("Failed to save metric to server");
        }
      }

      // Both new and existing metrics go through the pending update flow
      // so the user must approve from the metric detail panel
      const metricForPublish = confirm.newName ? { ...metric, name: effectiveName } : metric;
      publishUpdate(metricForPublish, result, confirm.userRequest || confirm.newDescription || confirm.oldDescription);

      // For metric creation flow: save suggested relationships to the metric store
      if (confirm.suggestedRelatedMetrics && confirm.suggestedRelatedMetrics.length > 0) {
        const allM = getAllMetrics(datasetId);
        const relationships = confirm.suggestedRelatedMetrics
          .map((name) => allM.find((m) => m.name === name))
          .filter(Boolean)
          .map((m) => ({
            metricId: m!.id,
            metricName: m!.name,
            direction: "driven_by" as const,
            type: "influence" as const,
          }));
        if (relationships.length > 0) {
          updateMetric(datasetId, confirm.metricId, { relationships });
        }
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId && m.metricUpdateConfirm
            ? { ...m, metricUpdateConfirm: { ...m.metricUpdateConfirm, status: "published" as const } }
            : m
        )
      );

      toast.success("Metric update published for review", {
        action: {
          label: "View metric",
          onClick: () => window.location.assign(`/metrics/${confirm.metricId}`),
        },
      });
    },
    [messagesRef, datasetId, publishUpdate, setMessages]
  );

  const handleMetricUpdateDismiss = useCallback(
    (msgId: string) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId && m.metricUpdateConfirm
            ? { ...m, metricUpdateConfirm: { ...m.metricUpdateConfirm, status: "dismissed" as const } }
            : m
        )
      );
    },
    [setMessages]
  );

  // ── Policy confirm/cancel ──

  const handlePolicyConfirm = useCallback(
    (msgId: string) => {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== msgId || !m.policyConfirm) return m;
          const policy: DataPolicy = {
            id: crypto.randomUUID(),
            name: m.policyConfirm.name,
            description: m.policyConfirm.description,
            datasetId: m.policyConfirm.datasetId,
            tableAccess: m.policyConfirm.tableAccess,
            createdAt: new Date().toISOString(),
            createdBy: "current-user",
          };
          savePolicy(policy);
          toast.success(`Policy "${policy.name}" created`, {
            description: "View it in Settings → Access Control",
          });
          return {
            ...m,
            policyConfirm: { ...m.policyConfirm, status: "confirmed" as const, policyId: policy.id },
          };
        }),
      );
    },
    [setMessages],
  );

  const handlePolicyCancel = useCallback(
    (msgId: string) => {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== msgId || !m.policyConfirm) return m;
          return {
            ...m,
            policyConfirm: { ...m.policyConfirm, status: "cancelled" as const },
          };
        }),
      );
    },
    [setMessages],
  );

  // ── Campaign draft handlers ──

  const handleCampaignFire = useCallback(
    async (msgId: string, edited: { subject: string; body: string; senderName?: string; templateId?: string }) => {
      const msg = messagesRef.current.find((m) => m.id === msgId);
      const draft = msg?.campaignDraft;
      if (!draft) return;

      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId && m.campaignDraft
            ? {
                ...m,
                campaignDraft: {
                  ...m.campaignDraft,
                  subject: edited.subject,
                  body: edited.body,
                  senderName: edited.senderName,
                  status: "firing" as const,
                },
              }
            : m
        )
      );

      try {
        const res = await apiFetch<{ campaignId?: number; dashboardUrl?: string }>(
          `/api/segments/${draft.segmentId}/campaign`,
          {
            method: "POST",
            body: {
              channel: draft.channel,
              subject: edited.subject,
              body: edited.body,
              senderName: edited.senderName,
              senderEmailId: draft.channel === "email" ? draft.senderEmailId : undefined,
              replyTo: draft.channel === "email" ? draft.replyTo : undefined,
              title: edited.subject,
              templateId: edited.templateId,
            },
            skipModel: true,
          }
        );

        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId && m.campaignDraft
              ? {
                  ...m,
                  campaignDraft: {
                    ...m.campaignDraft,
                    status: "sent" as const,
                    campaignId: res.campaignId,
                    dashboardUrl: res.dashboardUrl,
                  },
                }
              : m
          )
        );

        toast.success(`Campaign sent to ${draft.segmentName}`);
        refreshSegments();
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("segment:campaign-fired", { detail: { segmentId: draft.segmentId } }),
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to send campaign";
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId && m.campaignDraft
              ? {
                  ...m,
                  campaignDraft: {
                    ...m.campaignDraft,
                    status: "error" as const,
                    error: message,
                  },
                }
              : m
          )
        );
      }
    },
    [setMessages, messagesRef, refreshSegments]
  );

  const handleCampaignCancel = useCallback(
    (msgId: string) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId && m.campaignDraft
            ? { ...m, campaignDraft: { ...m.campaignDraft, status: "cancelled" as const } }
            : m
        )
      );
    },
    [setMessages]
  );

  const handleCampaignRefine = useCallback(
    async (msgId: string, refineIntent: string) => {
      const msg = messagesRef.current.find((m) => m.id === msgId);
      const draft = msg?.campaignDraft;
      if (!draft) return;

      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId && m.campaignDraft
            ? { ...m, variant: "streaming" as const, content: "Redrafting...", campaignDraft: undefined }
            : m
        )
      );

      try {
        const redraft = await apiFetch<{
          segmentId: string;
          segmentName: string;
          userCount: number | null;
          channel: typeof draft.channel;
          subject: string;
          body: string;
          senderName?: string;
          senderEmailId?: string;
          replyTo?: string;
          rationale?: string;
        }>("/api/campaign-draft", {
          method: "POST",
          body: {
            segmentId: draft.segmentId,
            intent: `${draft.rationale ?? "original campaign"}\n\nRefinement: ${refineIntent}\n\nCurrent subject: ${draft.subject}\nCurrent body: ${draft.body}`,
            channel: draft.channel,
          },
        });

        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId
              ? {
                  ...m,
                  variant: "campaign-draft" as const,
                  content: "",
                  campaignDraft: {
                    segmentId: redraft.segmentId,
                    segmentName: redraft.segmentName,
                    userCount: redraft.userCount,
                    channel: redraft.channel,
                    subject: redraft.subject,
                    body: redraft.body,
                    senderName: redraft.senderName,
                    senderEmailId: redraft.senderEmailId,
                    replyTo: redraft.replyTo,
                    rationale: redraft.rationale,
                    status: "ready" as const,
                  },
                }
              : m
          )
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "Redraft failed";
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId
              ? { ...m, variant: undefined, content: message, campaignDraft: undefined }
              : m
          )
        );
      }
    },
    [setMessages, messagesRef]
  );

  return {
    handleFollowUpAction,
    handleSaveAsPlaybook,
    handleConvertToPlaybook,
    handleSavePlaybookPreview,
    handleSaveToKnowledge,
    handleDismissKnowledge,
    handleSegmentConfirm,
    handleSegmentCancel,
    handleSegmentRefine,
    handleSegmentVoiceCampaign,
    handleFunnelConfirm,
    handleFunnelCancel,
    handleFunnelRefine,
    handleRetentionConfirm,
    handleRetentionCancel,
    handleRetentionRefine,
    handleSaveAsBoard,
    isSavingBoard,
    handleMetricUpdatePublish,
    handleMetricUpdateDismiss,
    handlePolicyConfirm,
    handlePolicyCancel,
    handleCampaignFire,
    handleCampaignCancel,
    handleCampaignRefine,
  };
}
