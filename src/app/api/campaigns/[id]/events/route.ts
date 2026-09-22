import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";
import { getLifecycleCampaignBundle } from "@/lib/server/lifecycle-campaign-repo";
import { createManualCampaignEvent } from "@/lib/server/lifecycle-campaign-service";

const EventSchema = z.object({
  investorId: z.string().trim().min(1).max(120),
  eventType: z.string().trim().min(1).max(120),
  occurredAt: z.string().datetime().optional(),
  source: z.enum(["manual", "simulator", "system", "voice_call", "transcript_analysis", "segment_evaluator", "assignment"]).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const BodySchema = z.object({
  events: z.array(EventSchema).min(1).max(500).optional(),
}).and(EventSchema.partial());

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const bundle = getLifecycleCampaignBundle(userId, id);
  if (!bundle) return Response.json({ error: "Not found" }, { status: 404 });
  const parsed = BodySchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });

  const payload = parsed.data.events ?? (
    parsed.data.investorId && parsed.data.eventType
      ? [parsed.data as z.infer<typeof EventSchema>]
      : []
  );
  if (payload.length === 0) return Response.json({ error: "No events provided" }, { status: 400 });
  const events = payload.map((event) => createManualCampaignEvent({
    userId,
    bundle,
    investorId: event.investorId,
    eventType: event.eventType,
    source: event.source,
    occurredAt: event.occurredAt,
    metadata: event.metadata,
  }));

  return Response.json({ ok: true, events }, { headers: { "Cache-Control": "no-store" } });
}
