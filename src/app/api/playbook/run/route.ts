import { auth } from "@clerk/nextjs/server";
import { NextRequest } from "next/server";
import { runPlaybookV1, runPlaybookV2 } from "@/lib/playbook-executor";
import {
  isDormantCurrentFundHoldersPlaybook,
  sendDormantCurrentFundHoldersRunEmail,
} from "@/lib/server/dormant-playbook-email";
import type { ModelId } from "@/lib/llm";
import type { Playbook, PlaybookV2, AnyPlaybook, PlaybookRunHistory } from "@/lib/playbook-types";
import { isPlaybookV2 } from "@/lib/playbook-types";
import { getDatasetForUser } from "@/lib/datasets";

type RunCellResult = NonNullable<PlaybookRunHistory["cellSummaries"]>[number];

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const modelId = (req.headers.get("x-model-id") ?? undefined) as ModelId | undefined;
  const headerDatasetId = req.headers.get("x-dataset-id") ?? undefined;
  let playbook: AnyPlaybook | null = null;
  let paramOverrides: Record<string, string> | undefined;
  try {
    const body = await req.json();
    if (body?.playbook) {
      playbook = body.playbook as AnyPlaybook;
    }
    if (body?.paramOverrides) {
      paramOverrides = body.paramOverrides as Record<string, string>;
    }
  } catch {
    // No body or invalid JSON
  }

  if (!playbook) {
    return Response.json({ error: "playbook is required in request body" }, { status: 400 });
  }

  // The playbook's own datasetId is authoritative — header is just a fallback for
  // legacy playbooks. Without this a vastu-hfc playbook run while the UI shows
  // presto would execute against presto.duckdb and every cell fails missing-table.
  const datasetId = (playbook as { datasetId?: string }).datasetId ?? headerDatasetId;
  if (datasetId && !getDatasetForUser(datasetId, userId)) return Response.json({ error: "Not found" }, { status: 404 });

  const requestPlaybook = playbook;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const runCapture = isPlaybookV2(requestPlaybook) && isDormantCurrentFundHoldersPlaybook(requestPlaybook)
        ? createRunCapture(requestPlaybook, paramOverrides)
        : null;

      function send(event: Record<string, unknown>) {
        runCapture?.handle(event);

        try {
          const json = JSON.stringify(event, (_key, value) =>
            typeof value === "bigint" ? Number(value) : value
          );
          controller.enqueue(encoder.encode(json + "\n"));
        } catch (err) {
          console.error("Failed to serialize event:", err, event);
          // Try to send a simplified version
          try {
            controller.enqueue(encoder.encode(JSON.stringify({ type: "error", message: "Serialization error" }) + "\n"));
          } catch { /* stream closed */ }
        }
      }

      try {
        if (isPlaybookV2(requestPlaybook)) {
          await runPlaybookV2(send, requestPlaybook as PlaybookV2, paramOverrides, modelId, datasetId);
          if (runCapture) {
            const run = runCapture.toRun();
            try {
              const result = await sendDormantCurrentFundHoldersRunEmail({
                playbook: requestPlaybook,
                run,
              });
              if (result) {
                console.log(
                  `[playbook-run-email] sent ${requestPlaybook.name} output to ${result.recipients.join(", ")} messageId=${result.messageId ?? "(none)"}`,
                );
              }
            } catch (emailErr) {
              console.error("[playbook-run-email] failed:", emailErr);
            }
          }
        } else {
          await runPlaybookV1(send, requestPlaybook as Playbook, paramOverrides, modelId, datasetId);
        }
      } catch (err) {
        console.error("Playbook execution error:", err);
        send({
          type: "error",
          message: err instanceof Error ? err.message : "Unknown error",
        });
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}

function createRunCapture(playbook: PlaybookV2, paramOverrides?: Record<string, string>) {
  const cellStatuses: Record<string, "done" | "error" | "skipped" | "running"> = {};
  const cellResults: Record<string, Omit<RunCellResult, "cellId" | "label" | "status">> = {};
  const streamingText: Record<string, string> = {};
  const startedAt = Date.now();

  return {
    handle(event: Record<string, unknown>) {
      const type = event.type;
      const cellId = typeof event.cellId === "string" ? event.cellId : undefined;
      if (!cellId) return;

      if (type === "cell_start") {
        cellStatuses[cellId] = "running";
        return;
      }

      if (type === "cell_result") {
        cellStatuses[cellId] = event.error ? "error" : "done";
        cellResults[cellId] = {
          content: typeof event.content === "string" ? event.content : undefined,
          rowCount: typeof event.rowCount === "number" ? event.rowCount : undefined,
          timeMs: typeof event.timeMs === "number" ? event.timeMs : undefined,
          columns: Array.isArray(event.columns)
            ? event.columns.filter((item): item is string => typeof item === "string")
            : undefined,
          preview: Array.isArray(event.preview)
            ? event.preview as Record<string, unknown>[]
            : undefined,
          error: typeof event.error === "string" ? event.error : undefined,
        };
        return;
      }

      if (type === "text") {
        streamingText[cellId] = (streamingText[cellId] ?? "") + (typeof event.delta === "string" ? event.delta : "");
      }
    },

    toRun(): PlaybookRunHistory {
      const cellSummaries = playbook.cells.map((cell) => ({
        cellId: cell.id,
        label: cell.label,
        rowCount: cellResults[cell.id]?.rowCount,
        timeMs: cellResults[cell.id]?.timeMs,
        status: (cellStatuses[cell.id] === "error"
          ? "error"
          : cellStatuses[cell.id] === "done"
            ? "done"
            : "skipped") as "done" | "error" | "skipped",
        columns: cellResults[cell.id]?.columns,
        preview: cellResults[cell.id]?.preview?.slice(0, 20),
        content: streamingText[cell.id] || cellResults[cell.id]?.content || undefined,
        error: cellResults[cell.id]?.error,
      }));

      const failedCount = cellSummaries.filter((summary) => summary.status === "error").length;
      const doneCount = cellSummaries.filter((summary) => summary.status === "done").length;
      const status = failedCount === 0 ? "success" : doneCount > 0 ? "partial" : "failed";

      return {
        date: new Date().toISOString(),
        who: "You",
        result: status === "success" ? "Completed" : status === "partial" ? "Partial" : "Failed",
        status,
        runVia: "playbook",
        durationMs: Date.now() - startedAt,
        cellSummaries,
        paramOverrides,
      };
    },
  };
}
