import { auth } from "@clerk/nextjs/server";
import { generateJson, type ModelId } from "@/lib/llm";
import { PARSE_PROMPT } from "@/lib/prompts/knowledge";
import type { KnowledgeEntry, KnowledgeCategory, KnowledgePriority } from "@/lib/knowledge-types";
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

const VALID_PRIORITIES: KnowledgePriority[] = ["Critical", "High", "Good to have"];

const BodySchema = z.object({
  text: z.string().trim().min(1).max(300_000),
  level: z.enum(["global", "user"]).optional(),
});

interface ParsedKnowledgeEntry {
  content: string;
  category: string;
  priority: string;
  sourceUrl: string;
}

const KNOWLEDGE_PARSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    entries: {
      type: "array",
      maxItems: 30,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          content: { type: "string" },
          category: { type: "string", enum: VALID_CATEGORIES },
          priority: { type: "string", enum: VALID_PRIORITIES },
          sourceUrl: { type: "string" },
        },
        required: ["content", "category", "priority", "sourceUrl"],
      },
    },
  },
  required: ["entries"],
};

function fallbackEntries(text: string): ParsedKnowledgeEntry[] {
  let currentUrl = "";
  const candidates: ParsedKnowledgeEntry[] = [];
  const seen = new Set<string>();

  for (const rawBlock of text.split(/\n{2,}|--- NEXT PAGE ---/i)) {
    const urlMatch = rawBlock.match(/SOURCE URL:\s*(https?:\/\/\S+)/i);
    if (urlMatch) currentUrl = urlMatch[1].trim();

    const cleaned = rawBlock
      .replace(/SOURCE URL:.*$/gim, "")
      .replace(/PAGE TITLE:.*$/gim, "")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned.length < 60) continue;

    const chunks = cleaned.length > 700
      ? cleaned.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [cleaned]
      : [cleaned];
    for (const chunk of chunks) {
      const content = chunk.trim();
      if (content.length < 60 || content.length > 600) continue;
      const key = content.toLowerCase().replace(/\W+/g, " ").trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      candidates.push({ content, category: "Insight", priority: "High", sourceUrl: currentUrl });
      if (candidates.length >= 12) return candidates;
    }
  }

  return candidates;
}

function toKnowledgeEntries(
  parsed: ParsedKnowledgeEntry[],
  level: "global" | "user",
): KnowledgeEntry[] {
  const now = new Date().toISOString();
  return parsed
    .filter((item) => typeof item.content === "string" && item.content.trim().length > 0)
    .map((item, index) => ({
      id: `kb-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
      content: item.content.trim(),
      level,
      category: VALID_CATEGORIES.includes(item.category as KnowledgeCategory)
        ? (item.category as KnowledgeCategory)
        : "Insight",
      priority: VALID_PRIORITIES.includes(item.priority as KnowledgePriority)
        ? (item.priority as KnowledgePriority)
        : "High",
      source: "paste-import",
      dateAdded: now,
      addedBy: "You",
      sourceUrl: item.sourceUrl || undefined,
    }));
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const validated = BodySchema.safeParse(body);
  if (!validated.success) {
    return Response.json({ error: "Valid text is required" }, { status: 400 });
  }

  const { text, level = "global" } = validated.data;
  const modelId = (req.headers.get("x-model-id") ?? undefined) as ModelId | undefined;

  try {
    const result = await generateJson<{ entries: ParsedKnowledgeEntry[] }>({
      messages: [
        { role: "system", content: PARSE_PROMPT },
        {
          role: "user",
          content: `Extract knowledge from the text below. When SOURCE URL labels are present, copy the relevant URL into sourceUrl for each entry.\n\n${text}`,
        },
      ],
      modelId,
      jsonSchema: {
        name: "knowledge_entries",
        schema: KNOWLEDGE_PARSE_SCHEMA,
        strict: true,
      },
      maxOutputTokens: 6_000,
      label: "knowledge.parse",
    });
    const parsed = Array.isArray(result.entries) && result.entries.length > 0
      ? result.entries
      : fallbackEntries(text);
    const entries = toKnowledgeEntries(parsed, level);

    return Response.json({ entries });
  } catch (err) {
    console.error("Parse failed:", err);
    const entries = toKnowledgeEntries(fallbackEntries(text), level);
    if (entries.length > 0) return Response.json({ entries, fallback: true });
    return Response.json({ error: "No knowledge could be extracted", entries: [] }, { status: 422 });
  }
}
