import { auth } from "@clerk/nextjs/server";
import { getAgent } from "@/lib/agent-store";
import { buildKnowledgeDigest } from "@/lib/inbound-agent-prompt";
import { normalizeGeminiVoiceName, DEFAULT_GEMINI_VOICE } from "@/lib/gemini-voices";

/**
 * Compile the ready-to-speak config for the agent editor's live voice preview.
 *
 * The editor POSTs the *draft* fields (unsaved Global Prompt, opening line, and
 * knowledge selection) so "Preview" tests exactly what you're editing — not the
 * last-saved copy. We ground the draft prompt on the selected knowledge the same
 * way a real inbound call does (`buildKnowledgeDigest`), then hand the result to
 * the browser <VoiceTestPanel>, which streams it to Gemini Live.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const agent = getAgent(id);
  if (!agent) return Response.json({ error: "Agent not found" }, { status: 404 });
  if (agent.userId && agent.userId !== userId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // No body → preview the last-saved agent as-is.
  }

  const draftPrompt =
    typeof body.systemPrompt === "string" && body.systemPrompt.trim()
      ? (body.systemPrompt as string)
      : agent.systemPrompt || "";
  const firstMessage =
    typeof body.firstMessage === "string" ? (body.firstMessage as string) : agent.firstMessage || "";
  const knowledgeIds = Array.isArray(body.knowledgeIds)
    ? (body.knowledgeIds as unknown[]).filter((x): x is string => typeof x === "string")
    : body.knowledgeIds === null
      ? undefined
      : agent.knowledgeIds;

  const digest = buildKnowledgeDigest({
    userId: agent.userId,
    datasetId: agent.datasetId,
    knowledgeIds,
  });

  const systemPrompt = digest
    ? `${draftPrompt}\n\n===== KNOWLEDGE BASE (authoritative — answer only from here) =====\n${digest}\n===== END KNOWLEDGE BASE =====`
    : draftPrompt;

  // The browser preview always speaks through Gemini Live, so the voice must be a
  // canonical Gemini voice id. Agents may store a display name ("Priya") or a
  // non-Gemini id (manual/sarvam/cartesia agents) — normalize, else Gemini rejects
  // the setup with close code 1007. Fall back to the default voice on anything unknown.
  const voice = normalizeGeminiVoiceName(agent.voice) ?? DEFAULT_GEMINI_VOICE;

  return Response.json({
    systemPrompt,
    firstMessage,
    voice,
    voiceName: agent.voiceName ?? agent.name,
    datasetId: agent.datasetId,
  });
}
