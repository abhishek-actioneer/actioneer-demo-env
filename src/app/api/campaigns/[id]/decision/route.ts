import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import {
  getDecisionRecord,
  getLifecycleCampaignBundle,
  lifecycleId,
  upsertDecisionRecord,
} from "@/lib/server/lifecycle-campaign-repo";
import type { DecisionRecord } from "@/lib/lifecycle-campaign-types";

const DecisionSchema = z.object({
  decision: z.enum(["ship", "kill", "iterate"]),
  notes: z.string().trim().min(1).max(4000),
  nextStep: z.string().trim().max(1000).optional(),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const bundle = getLifecycleCampaignBundle(userId, id);
  if (!bundle) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({
    decision: getDecisionRecord(id, bundle.experiment.id),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const bundle = getLifecycleCampaignBundle(userId, id);
  if (!bundle) return Response.json({ error: "Not found" }, { status: 404 });
  const parsed = DecisionSchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });
  const current = new Date().toISOString();
  const existing = getDecisionRecord(id, bundle.experiment.id);
  const decision: DecisionRecord = {
    id: existing?.id ?? lifecycleId("dec"),
    campaignId: id,
    experimentId: bundle.experiment.id,
    decision: parsed.data.decision,
    notes: parsed.data.notes,
    nextStep: parsed.data.nextStep,
    createdAt: existing?.createdAt ?? current,
    updatedAt: current,
  };
  return Response.json({ decision: upsertDecisionRecord(decision) }, {
    headers: { "Cache-Control": "no-store" },
  });
}
