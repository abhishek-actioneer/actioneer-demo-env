import { auth } from "@clerk/nextjs/server";
import { listAccountNumbers } from "@/lib/plivo-number-binding";
import { getAllInboundBindings } from "@/lib/inbound-agent-store";
import { getCampaign } from "@/lib/voice-campaign-store";

/**
 * The account's inbound DIDs, each annotated with what currently answers it.
 * Feeds the campaign studio's Inbound card so the user picks a real number
 * (with Plivo's own alias) instead of typing one, and can see at a glance that
 * a number is already claimed by a different campaign.
 */

function digits(value: string): string {
  return value.replace(/\D/g, "");
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let numbers;
  try {
    numbers = await listAccountNumbers();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not list numbers";
    console.error("[api/voice/numbers]", message);
    return Response.json({ error: message }, { status: 502 });
  }

  const bindings = new Map(getAllInboundBindings().map((b) => [digits(b.number), b]));

  return Response.json({
    numbers: numbers.map((n) => {
      const binding = bindings.get(digits(n.number));
      // Truthful live state: the stored flag only counts if Plivo still points
      // the DID at the app we bound it to.
      const live = Boolean(binding?.live && binding.appId && binding.appId === n.appId);
      const campaign = binding?.campaignId ? getCampaign(binding.campaignId) : undefined;
      return {
        number: n.number,
        alias: n.alias ?? null,
        live,
        mode: binding?.mode ?? null,
        campaignId: binding?.campaignId ?? null,
        campaignName: campaign?.name ?? null,
        greeting: binding?.greeting ?? null,
      };
    }),
  });
}
