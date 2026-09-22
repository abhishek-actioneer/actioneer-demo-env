import { auth } from "@clerk/nextjs/server";
import { getDataset } from "@/lib/datasets";
import { loadSchemaMap } from "@/lib/datasets/schema-enricher";
import { resolve, join } from "path";
import { generateJson } from "@/lib/llm";
const DATASETS_DIR = resolve(process.cwd(), "data/datasets");

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const ds = getDataset(id);

  // Verify visibility
  if (ds.ownerId && ds.ownerId !== userId) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // 1. Check if config already has prompts
  if (ds.suggestedPrompts?.length) {
    return Response.json({
      suggestedPrompts: ds.suggestedPrompts,
      welcomeSubtitle: ds.welcomeSubtitle || `Ask anything about your ${ds.label} data.`,
      source: "config",
    });
  }

  // 2. Check schema map
  const sm = loadSchemaMap(join(DATASETS_DIR, id));
  if (sm?.suggestedPrompts?.length) {
    return Response.json({
      suggestedPrompts: sm.suggestedPrompts,
      welcomeSubtitle: sm.welcomeSubtitle || `Ask anything about your ${ds.label} data.`,
      source: "schema-map",
    });
  }

  // 3. Generate on the fly using schema context
  try {
    const json = await generateJson<{
      suggestedPrompts?: string[];
      welcomeSubtitle?: string;
    }>(`You are helping generate starter questions for a data analytics assistant.

Dataset: "${ds.label}"
Schema summary:
${ds.schemaContext.slice(0, 2000)}

Generate a JSON object:
{
  "suggestedPrompts": ["6 natural-language analytics questions a user might ask about this specific dataset. Reference real columns/concepts. Mix simple and complex."],
  "welcomeSubtitle": "One sentence (under 20 words) describing what users can explore in this dataset."
}`, {
      label: "dataset-prompts",
      timeoutMs: 30_000,
      maxOutputTokens: 2048,
    });

    return Response.json({
      suggestedPrompts: (json.suggestedPrompts || []).slice(0, 6),
      welcomeSubtitle: json.welcomeSubtitle || `Ask anything about your ${ds.label} data.`,
      source: "generated",
    });
  } catch {
    return Response.json({
      suggestedPrompts: [],
      welcomeSubtitle: `Ask anything about your ${ds.label} data.`,
      source: "fallback",
    });
  }
}
