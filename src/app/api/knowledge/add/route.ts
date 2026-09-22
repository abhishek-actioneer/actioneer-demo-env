import { auth } from "@clerk/nextjs/server";
import { generateText, type ModelId } from "@/lib/llm";
import type { KnowledgeEntry, KnowledgeCategory } from "@/lib/knowledge-types";
import { z } from "zod/v4";

const VALID_CATEGORIES: KnowledgeCategory[] = [
  "Data validation",
  "External benchmark",
  "Insight",
  "Reporting",
  "Segment",
  "Visualisation",
  "Metric",
  "Metric range",
];

const CATEGORIZATION_PROMPT = `You are a knowledge base categorization assistant. Given a piece of knowledge or context, assign it to exactly ONE of these categories:

- Data validation: Facts about data quality, null rates, field constraints, data freshness
- External benchmark: Industry standards, competitor data, external reference points
- Insight: Key findings, patterns, trends, business context
- Reporting: Preferences for how to present or structure reports and outputs
- Segment: User/customer segment definitions, cohort criteria
- Visualisation: Chart type preferences, visualization guidelines
- Metric: Metric definitions, calculation formulas, what metrics mean
- Metric range: Acceptable ranges, thresholds, targets for metrics

Return ONLY the category name exactly as written above, nothing else.`;

const AddKnowledgeSchema = z.object({
  content: z.string().min(1),
  priority: z.enum(["Critical", "High", "Good to have"]),
  level: z.enum(["global", "user"]),
});

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = AddKnowledgeSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }
  const { content, priority, level } = parsed.data;
  const modelId = (req.headers.get("x-model-id") ?? undefined) as ModelId | undefined;

  let category: KnowledgeCategory = "Insight";

  try {
    const categoryText = (await generateText(`Categorize this knowledge entry:\n\n"${content}"`, {
      modelId,
      systemPrompt: CATEGORIZATION_PROMPT,
    })).trim();

    if (VALID_CATEGORIES.includes(categoryText as KnowledgeCategory)) {
      category = categoryText as KnowledgeCategory;
    }
  } catch (err) {
    console.error("Categorization failed, using fallback:", err);
  }

  const entry: KnowledgeEntry = {
    id: `kb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    content,
    level,
    category,
    priority,
    source: "manual",
    dateAdded: new Date().toISOString(),
    addedBy: "You",
  };

  return Response.json({ entry });
}
