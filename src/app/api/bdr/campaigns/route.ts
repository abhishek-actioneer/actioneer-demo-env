import { z } from "zod/v4";
import { bdrRoute } from "@/lib/bdr/http";
import { importMonacoAudience } from "@/lib/bdr/monaco";
import { createBdrCampaign, getBdrCampaign } from "@/lib/bdr/store";
import { prepareRecipients } from "@/lib/bdr/types";
import { BDR_TEMPLATE_IDS, getBdrTemplate } from "@/lib/bdr/templates";
import { DEFAULT_CARTESIA_VOICE_ID } from "@/lib/cartesia-voices";
export const runtime = "nodejs";
const Input = z.object({ id: z.uuid(), audienceId: z.uuid(), templateId: z.enum(BDR_TEMPLATE_IDS).default("financial-services") });
export async function POST(req: Request) {
  return bdrRoute(async (userId) => {
    const input = Input.parse(await req.json());
    const existing = getBdrCampaign(input.id, userId);
    if (existing) return Response.json({ campaign: existing });
    const { audience, contacts } = await importMonacoAudience(input.audienceId);
    const now = new Date().toISOString();
    const template = getBdrTemplate(input.templateId);
    const campaign = createBdrCampaign({ id: input.id, userId, name: audience.name, audienceId: audience.id, audienceName: audience.name, templateId: template.id, script: template.script, opening: template.opening, voicemail: template.voicemail, language: "English", voiceId: process.env.CARTESIA_VOICE_ID || DEFAULT_CARTESIA_VOICE_ID, status: "draft", recipients: prepareRecipients(contacts), createdAt: now, updatedAt: now });
    return Response.json({ campaign });
  });
}
