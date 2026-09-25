import { z } from "zod/v4";
import { bdrRoute } from "@/lib/bdr/http";
import { mutateBdrCampaign } from "@/lib/bdr/store";
import { bdrReadiness } from "@/lib/bdr/config";
import { BDR_TEMPLATE_IDS } from "@/lib/bdr/templates";
export const runtime = "nodejs";
const Fields = z.object({ name: z.string().trim().min(1).max(200), script: z.string().trim().min(20).max(15_000), opening: z.string().trim().min(10).max(1200), voiceId: z.uuid(), language: z.enum(["English", "Hindi", "Hinglish"]), templateId: z.enum(BDR_TEMPLATE_IDS).optional(), voicemail: z.string().trim().min(10).max(1600).optional() });
const Input = z.discriminatedUnion("action", [z.object({ action: z.literal("save"), fields: Fields }), z.object({ action: z.enum(["launch", "pause"]) })]);
export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  return bdrRoute(async (userId) => {
    const { id } = await context.params;
    const input = Input.parse(await req.json());
    const campaign = mutateBdrCampaign(id, userId, (current) => {
      if (input.action === "save") {
        if (current.status === "running" || current.recipients.some((r) => ["dispatching", "calling", "connected"].includes(r.status))) throw new Error("Pause the campaign and wait for the active call to finish before editing.");
        Object.assign(current, input.fields);
      } else if (input.action === "pause") {
        if (current.status === "running") current.status = "paused";
      } else {
        if (current.status === "running") return;
        const readiness = bdrReadiness();
        if (!readiness.calling) throw new Error(`Connect these services before calling: ${readiness.missing.join(", ")}`);
        Fields.parse(current);
        if (!current.recipients.some((r) => r.status === "pending")) throw new Error("There are no uncalled contacts left in this campaign.");
        current.status = "running";
        current.error = undefined;
      }
    });
    return Response.json({ campaign });
  });
}
