import { useRef, useCallback } from "react";
import type { ChatMessage, PlaybookPreviewData } from "@/lib/types";
import { toast } from "sonner";
import {
  saveConversation,
  updateConversationMessages,
} from "@/lib/conversation-store";
import { apiFetch } from "@/lib/api-client";

function createId() {
  return Math.random().toString(36).slice(2, 10);
}

interface UsePlaybookCreationArgs {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  activeConvId: string | null;
  setActiveConvId: (id: string) => void;
  isProcessing: boolean;
  setIsProcessing: (v: boolean) => void;
  refreshChats: () => void;
  datasetId: string;
}

export function usePlaybookCreation({
  setMessages,
  activeConvId,
  setActiveConvId,
  isProcessing,
  setIsProcessing,
  refreshChats,
  datasetId,
}: UsePlaybookCreationArgs) {
  const abortRef = useRef<AbortController | null>(null);

  const handlePlaybookCreate = useCallback(
    async (query: string, proceedWithout = false) => {
      if (isProcessing) return;

      let convId = activeConvId;
      if (!convId) {
        convId = createId();
        const title = `/playbook ${query.length > 30 ? query.slice(0, 30) + "..." : query}`;
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

      setIsProcessing(true);
      const abort = new AbortController();
      abortRef.current = abort;
      const streamingId = createId();
      const responseMsgId = createId();

      if (!proceedWithout) {
        const userMsg: ChatMessage = {
          id: createId(),
          role: "user",
          content: `/playbook "${query}"`,
          timestamp: Date.now(),
        };
        setMessages((prev) => [
          ...prev,
          userMsg,
          { id: "gathering-pb", role: "sentinel", content: "", timestamp: Date.now(), variant: "gathering" },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          { id: "gathering-pb", role: "sentinel", content: "", timestamp: Date.now(), variant: "gathering" },
        ]);
      }

      try {
        const res = await apiFetch("/api/playbook/create", {
          method: "POST",
          body: { query, proceedWithout, datasetId },
          signal: abort.signal,
          stream: true,
        });

        if (!res.ok || !res.body) throw new Error("Playbook creation failed");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let responseText = "";
        let isStreaming = false;

        // Two-phase generation accumulators
        let pbMeta: { name: string; description: string } | undefined;
        const pbOutline: Record<string, unknown>[] = [];
        const pbDetails: Record<string, unknown>[] = [];
        let pbParams: unknown[] = [];
        let pbProduces: unknown[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done || abort.signal.aborted) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.trim()) continue;
            let event: Record<string, unknown>;
            try { event = JSON.parse(line); } catch { continue; }

            switch (event.type) {
              case "phase": {
                const phase = event.phase as string;
                const phaseMsg =
                  phase === "discovering_schema" ? "Discovering your database schema..."
                  : phase === "checking_requirements" ? "Checking data requirements for this analysis..."
                  : phase === "generating_playbook" ? "Generating playbook structure and SQL queries..."
                  : phase === "planning_outline" ? "Planning playbook structure..."
                  : phase === "generating_details" ? "Generating SQL and prompts..."
                  : phase === "generating_cells" ? "Generating playbook cells..."
                  : phase === "validating_sql" ? "Validating generated SQL..."
                  : phase === "repairing_sql" ? "Repairing SQL issues..."
                  : "Processing...";

                if (!isStreaming) {
                  isStreaming = true;
                  setMessages((prev) =>
                    prev
                      .filter((m) => m.id !== "gathering-pb")
                      .concat([{
                        id: streamingId,
                        role: "sentinel",
                        content: phaseMsg,
                        timestamp: Date.now(),
                        variant: "streaming",
                      }])
                  );
                } else {
                  setMessages((prev) =>
                    prev.map((m) => m.id === streamingId ? { ...m, content: phaseMsg } : m)
                  );
                }
                break;
              }

              case "connector_required": {
                setMessages((prev) =>
                  prev
                    .filter((m) => m.id !== streamingId && m.id !== "gathering-pb")
                    .concat([{
                      id: createId(),
                      role: "sentinel",
                      content: "This analysis requires data that isn't currently in your database.",
                      timestamp: Date.now(),
                      variant: "connector-required",
                      connectorInfo: {
                        missing: event.missing as Array<{ description: string; reason: string }>,
                        recommendedCategories: event.recommendedCategories as string[],
                        canProceedWithout: event.canProceedWithout as boolean,
                        degradedDescription: event.degradedDescription as string | undefined,
                        originalQuery: query,
                      },
                    }])
                );
                break;
              }

              case "text": {
                responseText += event.delta as string;
                if (!isStreaming) {
                  isStreaming = true;
                  setMessages((prev) =>
                    prev
                      .filter((m) => m.id !== "gathering-pb")
                      .concat([{
                        id: responseMsgId,
                        role: "sentinel",
                        content: responseText,
                        timestamp: Date.now(),
                      }])
                  );
                } else {
                  setMessages((prev) =>
                    prev
                      .filter((m) => m.id !== streamingId)
                      .map((m) => m.id === responseMsgId ? { ...m, content: responseText } : m)
                      .concat(
                        prev.some((m) => m.id === responseMsgId)
                          ? []
                          : [{
                              id: responseMsgId,
                              role: "sentinel",
                              content: responseText,
                              timestamp: Date.now(),
                            }]
                      )
                  );
                }
                break;
              }

              case "playbook_preview": {
                const pbData = event.playbook as PlaybookPreviewData;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === responseMsgId
                      ? { ...m, variant: "playbook-preview" as const, playbookPreview: pbData }
                      : m
                  )
                );
                break;
              }

              case "error": {
                setMessages((prev) =>
                  prev
                    .filter((m) => m.id !== streamingId && m.id !== "gathering-pb")
                    .concat([{
                      id: responseMsgId,
                      role: "sentinel",
                      content: `Something went wrong: ${event.message}. Please try again.`,
                      timestamp: Date.now(),
                    }])
                );
                break;
              }

              // Two-phase generation events — collect outline cells and detail fills
              case "outline_start":
              case "outline_complete":
              case "detail_start":
              case "detail_complete":
                break;

              case "playbook_meta": {
                pbMeta = { name: event.name as string, description: event.description as string };
                break;
              }

              case "outline_cell":
              case "cell": {
                pbOutline.push(event.cell as Record<string, unknown>);
                break;
              }

              case "cell_detail": {
                pbDetails.push(event);
                break;
              }

              case "params": {
                pbParams = event.params as unknown[];
                break;
              }

              case "produces": {
                pbProduces = event.produces as unknown[];
                break;
              }

              case "generation_complete": {
                // Prefer the server's authoritative validated cells (correct
                // dependsOn + repaired SQL). Fall back to reconstructing from
                // streamed outline + detail events only for older servers.
                const authoritativeCells = Array.isArray(event.cells)
                  ? (event.cells as Record<string, unknown>[])
                  : null;

                const cells: PlaybookPreviewData["cells"] | null =
                  authoritativeCells && authoritativeCells.length > 0
                    ? authoritativeCells.map((cell, index) => {
                        const id = (cell.id as string) || `c${index + 1}`;
                        const type = (cell.type as string) === "llm" ? "llm" : "sql";
                        const dependsOn = Array.isArray(cell.dependsOn)
                          ? (cell.dependsOn as unknown[]).filter((item): item is string => typeof item === "string")
                          : [];
                        const outputs = Array.isArray(cell.outputs)
                          ? (cell.outputs as unknown[]).filter((item): item is string => typeof item === "string")
                          : [];
                        return {
                          id,
                          type,
                          role: (cell.role as string) ?? (type === "llm" ? "analysis" : "query"),
                          label: (cell.label as string) ?? "",
                          description: (cell.description as string) ?? "",
                          status: (cell.status as string) ?? "idle",
                          dependsOn,
                          outputs: outputs.length > 0 ? outputs : [`result_${id}`],
                          ...(cell.sql ? { sql: cell.sql as string } : {}),
                          ...(cell.prompt ? { prompt: cell.prompt as string } : {}),
                        };
                      })
                    : pbOutline.length > 0
                      ? (() => {
                          // Merge outline + details into cells (legacy fallback)
                          const detailMap = new Map<string, Record<string, unknown>>();
                          for (const d of pbDetails) detailMap.set(d.cellId as string, d);

                          return pbOutline.map((cell, index) => {
                            const detail = detailMap.get(cell.id as string);
                            const id = (cell.id as string) || `c${index + 1}`;
                            const type = (cell.type as string) === "llm" ? "llm" : "sql";
                            const dependsOn = Array.isArray(detail?.dependsOn)
                              ? (detail.dependsOn as unknown[]).filter((item): item is string => typeof item === "string")
                              : Array.isArray(cell.dependsOn)
                                ? (cell.dependsOn as unknown[]).filter((item): item is string => typeof item === "string")
                                : [];
                            const outputs = Array.isArray(detail?.outputs)
                              ? (detail.outputs as unknown[]).filter((item): item is string => typeof item === "string")
                              : Array.isArray(cell.outputs)
                                ? (cell.outputs as unknown[]).filter((item): item is string => typeof item === "string")
                                : [];
                            return {
                              id,
                              type,
                              role: (cell.role as string) ?? (type === "llm" ? "analysis" : "query"),
                              label: (cell.label as string) ?? "",
                              description: (cell.description as string) ?? "",
                              status: (cell.status as string) ?? "idle",
                              dependsOn,
                              outputs: outputs.length > 0 ? outputs : [`result_${index + 1}`],
                              ...(detail?.sql ? { sql: detail.sql as string } : cell.sql ? { sql: cell.sql as string } : {}),
                              ...(detail?.prompt ? { prompt: detail.prompt as string } : cell.prompt ? { prompt: cell.prompt as string } : {}),
                            };
                          });
                        })()
                      : null;

                if (cells && cells.length > 0) {
                  const pbData: PlaybookPreviewData = {
                    name: pbMeta?.name ?? "Playbook",
                    description: pbMeta?.description ?? "",
                    cells,
                    params: pbParams as PlaybookPreviewData["params"],
                    produces: pbProduces as PlaybookPreviewData["produces"],
                  };
                  const content = `Generated **${pbData.name}** with ${cells.length} cells. Review the SQL and prompts before running it.`;
                  setMessages((prev) => {
                    const previewMsg: ChatMessage = {
                      id: responseMsgId,
                      role: "sentinel",
                      content,
                      timestamp: Date.now(),
                      variant: "playbook-preview",
                      playbookPreview: pbData,
                      userQuery: query,
                    };
                    const filtered = prev.filter((m) => m.id !== "gathering-pb");
                    const replaceIndex = filtered.findIndex((m) => m.id === responseMsgId || m.id === streamingId);
                    if (replaceIndex === -1) return filtered.concat([previewMsg]);
                    const updated = [...filtered];
                    updated[replaceIndex] = previewMsg;
                    return updated;
                  });
                }
                break;
              }

              case "done":
                break;
            }
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          setMessages((prev) =>
            prev.filter((m) => m.id !== "gathering-pb" && m.id !== streamingId)
          );
        } else {
          toast.error("Could not create playbook. Please try again.");
          setMessages((prev) =>
            prev
              .filter((m) => m.id !== "gathering-pb" && m.id !== streamingId)
              .concat([{
                id: responseMsgId,
                role: "sentinel",
                content: "Sorry, something went wrong creating the playbook. Please try again.",
                timestamp: Date.now(),
              }])
          );
        }
      } finally {
        setIsProcessing(false);
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
    [isProcessing, activeConvId, refreshChats, datasetId, setMessages, setActiveConvId, setIsProcessing]
  );

  const handleProceedWithout = useCallback(
    (originalQuery: string) => {
      handlePlaybookCreate(originalQuery, true);
    },
    [handlePlaybookCreate]
  );

  const handleConnectorClick = useCallback((categoryId: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: createId(),
        role: "sentinel",
        content: `Opening ${categoryId} connectors page... (Coming soon — connect your ${categoryId} data source to enable this analysis.)`,
        timestamp: Date.now(),
      },
    ]);
  }, [setMessages]);

  const handleUploadCSV = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv";
    input.onchange = () => {
      if (input.files?.[0]) {
        setMessages((prev) => [
          ...prev,
          {
            id: createId(),
            role: "sentinel",
            content: `CSV upload received: ${input.files![0].name}. Table creation from CSV coming soon.`,
            timestamp: Date.now(),
          },
        ]);
      }
    };
    input.click();
  }, [setMessages]);

  return {
    handlePlaybookCreate,
    handleProceedWithout,
    handleConnectorClick,
    handleUploadCSV,
    playbookAbortRef: abortRef,
  };
}
