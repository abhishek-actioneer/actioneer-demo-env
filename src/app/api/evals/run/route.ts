import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import { DEFAULT_DATASET } from "@/lib/datasets/constants";
import { listVoiceEvalAgents } from "@/lib/server/voice-eval-repo";
import { runVoiceEvalAgentTest } from "@/lib/server/voice-eval-runner";

const RunSchema = z.object({
  evalAgentId: z.string().min(1),
  calls: z.array(z.object({
    campaignId: z.string().min(1),
    callId: z.string().min(1),
  })).min(1).max(50),
});

function datasetIdFromRequest(req: Request): string {
  const raw = req.headers.get("x-dataset-id") || DEFAULT_DATASET;
  return /^[a-z0-9-]+$/.test(raw) && raw.length <= 64 ? raw : DEFAULT_DATASET;
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = RunSchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });
  const datasetId = datasetIdFromRequest(req);
  if (!listVoiceEvalAgents({ userId, datasetId }).some((agent) => agent.id === parsed.data.evalAgentId)) {
    return Response.json({ error: "Eval agent not found" }, { status: 404 });
  }

  const queue = [...parsed.data.calls];
  const failures: Array<{ callId: string; error: string }> = [];
  const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
    let next = queue.shift();
    while (next) {
      try {
        await runVoiceEvalAgentTest({
          userId,
          datasetId,
          campaignId: next.campaignId,
          callId: next.callId,
          evalAgentId: parsed.data.evalAgentId,
        });
      } catch (error) {
        failures.push({ callId: next.callId, error: error instanceof Error ? error.message : String(error) });
      }
      next = queue.shift();
    }
  });
  await Promise.all(workers);
  return Response.json({ completed: parsed.data.calls.length - failures.length, failures });
}
