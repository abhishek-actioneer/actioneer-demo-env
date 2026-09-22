import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import { getDatasetForUser } from "@/lib/datasets";
import { DEFAULT_DATASET } from "@/lib/datasets/constants";
import { listCampaigns } from "@/lib/voice-campaign-store";
import { maskPhone } from "@/lib/voice-campaign-transcript-loader";
import {
  listVoiceEvalAgents,
  listVoiceEvalResults,
  listVoiceEvalWorkbenches,
  saveVoiceEvalAgent,
  saveVoiceEvalWorkbench,
} from "@/lib/server/voice-eval-repo";

const CategorySchema = z.enum(["voice", "support", "sales", "scheduling", "quality", "compliance"]);
const ScoreLevelSchema = z.object({
  id: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(500),
  color: z.enum(["red", "yellow", "green", "gray"]),
});

const EvalAgentSchema = z.object({
  kind: z.literal("eval_agent"),
  id: z.string().optional(),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(400),
  prompt: z.string().trim().min(1).max(12000),
  inputType: z.enum(["text", "audio"]).default("text"),
  category: CategorySchema.default("quality"),
  systemPrompt: z.string().max(20000).optional(),
  contextSources: z.array(z.string().min(1).max(80)).max(18).optional(),
  scoreLevels: z.array(ScoreLevelSchema).min(2).max(8).optional(),
});

const WorkbenchSchema = z.object({
  kind: z.literal("workbench"),
  id: z.string().optional(),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).default(""),
  evalAgentIds: z.array(z.string().min(1)).min(1).max(30),
  campaignIds: z.array(z.string().min(1)).max(100).default([]),
  status: z.enum(["active", "archived"]).optional(),
});

const MutationSchema = z.discriminatedUnion("kind", [EvalAgentSchema, WorkbenchSchema]);

function datasetIdFromRequest(req: Request): string {
  const raw = req.headers.get("x-dataset-id") || new URL(req.url).searchParams.get("datasetId") || DEFAULT_DATASET;
  return /^[a-z0-9-]+$/.test(raw) && raw.length <= 64 ? raw : DEFAULT_DATASET;
}

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const datasetId = datasetIdFromRequest(req);
  if (!getDatasetForUser(datasetId, userId)) return Response.json({ error: "Dataset not found" }, { status: 404 });

  const scope = { userId, datasetId };
  const campaignRecords = listCampaigns(scope);
  const campaigns = campaignRecords.map((campaign) => ({
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    callCount: campaign.calls.length,
  }));
  const calls = campaignRecords.flatMap((campaign) => campaign.calls
    .filter((call) => call.status === "completed" || call.status === "failed" || call.status === "no_answer")
    .map((call) => ({
      id: call.id,
      campaignId: campaign.id,
      campaignName: campaign.name,
      agentName: campaign.name,
      status: call.status,
      toNumber: maskPhone(call.toNumber),
      durationSeconds: call.durationSeconds ?? 0,
      startedAt: call.startedAt ?? null,
      endedAt: call.endedAt ?? null,
      hasRecording: call.recording?.status === "completed" || call.bridgeRecording?.status === "completed",
      issueCount: call.analysis?.guardrailViolations?.length ?? 0,
    })))
    .sort((a, b) => (b.endedAt ?? b.startedAt ?? "").localeCompare(a.endedAt ?? a.startedAt ?? ""))
    .slice(0, 500);
  return Response.json({
    agents: listVoiceEvalAgents(scope),
    workbenches: listVoiceEvalWorkbenches(scope),
    results: listVoiceEvalResults(scope),
    campaigns,
    calls,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const datasetId = datasetIdFromRequest(req);
  if (!getDatasetForUser(datasetId, userId)) return Response.json({ error: "Dataset not found" }, { status: 404 });

  const parsed = MutationSchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });
  const scope = { userId, datasetId };
  if (parsed.data.kind === "eval_agent") {
    return Response.json({ agent: saveVoiceEvalAgent(scope, parsed.data) });
  }
  return Response.json({ workbench: saveVoiceEvalWorkbench(scope, parsed.data) });
}
