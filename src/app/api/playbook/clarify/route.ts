import { auth } from "@clerk/nextjs/server";
import { generateText } from "@/lib/llm";

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { context } = await req.json();
  if (!context || typeof context !== "string") {
    return Response.json({ error: "context is required" }, { status: 400 });
  }

  const systemPrompt = `You are a data analytics assistant helping a user create an analysis playbook. Based on the context they've provided so far, generate 1-2 brief clarifying questions that would improve the quality of the analysis.

Rules:
- Return a JSON object: { "questions": ["question1", "question2"] }
- Each question should be 1 sentence, under 15 words
- Only ask questions that would meaningfully change the analysis structure
- If the context is already clear enough, return { "questions": [] }
- Focus on: comparison baselines, anomaly thresholds, specific dimensions to include/exclude, or output priorities
- Do NOT ask about time period, metrics, or segmentation (already answered)

Respond with ONLY the JSON object. No markdown.`;

  try {
    const text = await generateText(context, { systemPrompt, jsonMode: true });
    const cleaned = text.trim().replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "");
    const result = JSON.parse(cleaned);
    const questions = Array.isArray(result.questions)
      ? result.questions.filter((q: unknown) => typeof q === "string" && q.length > 0).slice(0, 2)
      : [];
    return Response.json({ questions });
  } catch {
    return Response.json({ questions: [] });
  }
}
