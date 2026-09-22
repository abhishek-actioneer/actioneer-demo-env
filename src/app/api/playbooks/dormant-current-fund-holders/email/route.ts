import { randomUUID } from "node:crypto";
import { auth } from "@clerk/nextjs/server";
import { recordEmailEvent } from "@/lib/server/email-event-repo";
import { DORMANT_CURRENT_FUND_HOLDERS_EMAIL_RECIPIENTS } from "@/lib/server/dormant-playbook-email";
import { renderPlaybookOutputEmail } from "@/lib/server/playbook-output-email";
import {
  FUNDSINDIA_DATASET_ID,
  seedFundsIndiaPlaybooks,
} from "@/lib/server/fundsindia-sample-workspace";
import {
  getPlaybook,
  listPlaybookSummaries,
  upsertPlaybook,
} from "@/lib/server/playbook-repo";
import { runPlaybookV2 } from "@/lib/playbook-executor";
import { rewriteForTracking, trackingBaseUrl } from "@/lib/email-tracking";
import { sendTwilioEmail } from "@/lib/twilio-email-client";
import { isPlaybookV2, type PlaybookRunHistory, type PlaybookV2 } from "@/lib/playbook-types";
import type { ModelId } from "@/lib/llm";

const DORMANT_PLAYBOOK_NAME = "Dormant Current Fund Holders";

const HARDCODED_RECIPIENT_EMAILS = DORMANT_CURRENT_FUND_HOLDERS_EMAIL_RECIPIENTS;

type RunCellResult = NonNullable<PlaybookRunHistory["cellSummaries"]>[number];

interface RequestBody {
  forceRun?: boolean;
  subject?: string;
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const modelId = (req.headers.get("x-model-id") ?? undefined) as ModelId | undefined;
  const body = await parseBody(req);
  const recipients = configuredRecipients();
  if (recipients.length === 0) {
    return Response.json(
      { error: "Hardcoded recipient emails are not configured yet." },
      { status: 400 },
    );
  }

  let playbook = findDormantPlaybook(userId);
  if (!playbook) {
    return Response.json({ error: `${DORMANT_PLAYBOOK_NAME} playbook not found` }, { status: 404 });
  }

  let run = body.forceRun ? undefined : playbook.runHistory?.[0];
  let runSource: "existing" | "generated" = "existing";
  if (!run) {
    run = await runDormantPlaybook(playbook, modelId);
    playbook = {
      ...playbook,
      runHistory: [run, ...(playbook.runHistory ?? [])].slice(0, 50),
    };
    upsertPlaybook(userId, playbook);
    runSource = "generated";
  }

  const subject = body.subject?.trim() || "Dormant Current Fund Holders activation brief";
  const rendered = await renderPlaybookOutputEmail({ playbook, run, subject });

  const trackingCampaignId = randomUUID();
  const variantId = "default";
  const trackingEnabled = Boolean(trackingBaseUrl());
  const sendBody = trackingEnabled
    ? rewriteForTracking(rendered.html, { campaignId: trackingCampaignId, variantId })
    : rendered.html;

  let sendResult: Awaited<ReturnType<typeof sendTwilioEmail>>;
  try {
    sendResult = await sendTwilioEmail({
      to: recipients,
      subject,
      html: sendBody,
      text: rendered.markdown,
      categories: ["sentinel", "playbook", "dormant-current-fund-holders"],
      customArgs: {
        campaignId: trackingCampaignId,
        playbookId: playbook.id,
      },
    });
  } catch (err) {
    return Response.json(
      { error: (err as Error).message },
      { status: 400 },
    );
  }

  recordEmailEvent({
    campaignId: trackingCampaignId,
    variantId,
    eventType: "sent",
    meta: {
      recipientCount: recipients.length,
      recipients,
      provider: sendResult.provider,
      sendGridMessageId: sendResult.messageId,
      playbookId: playbook.id,
      runDate: run.date,
    },
  });

  return Response.json({
    ok: true,
    playbookId: playbook.id,
    playbookName: playbook.name,
    runSource,
    runDate: run.date,
    recipients,
    provider: sendResult.provider,
    sendGridMessageId: sendResult.messageId,
    trackingCampaignId,
  });
}

async function parseBody(req: Request): Promise<RequestBody> {
  try {
    const body = await req.json();
    if (!body || typeof body !== "object") return {};
    const record = body as Record<string, unknown>;
    return {
      forceRun: record.forceRun === true,
      subject: typeof record.subject === "string" ? record.subject : undefined,
    };
  } catch {
    return {};
  }
}

function configuredRecipients(): string[] {
  return HARDCODED_RECIPIENT_EMAILS
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.includes("@"))
    .filter((email) => !email.endsWith("@example.com"));
}

function findDormantPlaybook(userId: string): PlaybookV2 | null {
  seedFundsIndiaPlaybooks(userId);

  const summaries = listPlaybookSummaries(userId, FUNDSINDIA_DATASET_ID);
  const summary = summaries.find((item) => item.name === DORMANT_PLAYBOOK_NAME)
    ?? summaries.find((item) => item.name === "Dormant Current Fund Holder");
  if (!summary) return null;

  const playbook = getPlaybook(userId, summary.id);
  if (!playbook || !isPlaybookV2(playbook)) return null;
  return playbook;
}

async function runDormantPlaybook(playbook: PlaybookV2, modelId?: ModelId): Promise<PlaybookRunHistory> {
  const cellStatuses: Record<string, "done" | "error" | "skipped" | "running"> = {};
  const cellResults: Record<string, Omit<RunCellResult, "cellId" | "label" | "status">> = {};
  const streamingText: Record<string, string> = {};
  const startedAt = Date.now();

  function send(event: Record<string, unknown>) {
    const type = event.type;
    const cellId = typeof event.cellId === "string" ? event.cellId : undefined;
    if (!cellId && type !== "done") return;

    if (type === "cell_start" && cellId) {
      cellStatuses[cellId] = "running";
      return;
    }

    if (type === "cell_result" && cellId) {
      cellStatuses[cellId] = event.error ? "error" : "done";
      cellResults[cellId] = {
        content: typeof event.content === "string" ? event.content : undefined,
        rowCount: typeof event.rowCount === "number" ? event.rowCount : undefined,
        timeMs: typeof event.timeMs === "number" ? event.timeMs : undefined,
        columns: Array.isArray(event.columns) ? event.columns.filter((item): item is string => typeof item === "string") : undefined,
        preview: Array.isArray(event.preview) ? event.preview as Record<string, unknown>[] : undefined,
        error: typeof event.error === "string" ? event.error : undefined,
      };
      return;
    }

    if (type === "text" && cellId) {
      streamingText[cellId] = (streamingText[cellId] ?? "") + (typeof event.delta === "string" ? event.delta : "");
    }
  }

  await runPlaybookV2(send, playbook, undefined, modelId, playbook.datasetId);

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
    who: "Actioneer",
    result: status === "success" ? "Completed" : status === "partial" ? "Partial" : "Failed",
    status,
    runVia: "playbook",
    durationMs: Date.now() - startedAt,
    cellSummaries,
  };
}
