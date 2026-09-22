import { auth } from "@clerk/nextjs/server";
import { generateText, type ModelId } from "@/lib/llm";
import { getSchemaContext } from "@/lib/schema";
import { getDatasetForUser, DEFAULT_DATASET } from "@/lib/datasets";
import { z } from "zod/v4";

const Schema = z.object({
  description: z.string().min(1).max(4000),
  tables: z.array(z.string()),
});

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });

  const { description, tables } = parsed.data;
  const datasetId = req.headers.get("x-dataset-id") || DEFAULT_DATASET;
  if (!getDatasetForUser(datasetId, userId)) return Response.json({ error: "Not found" }, { status: 404 });
  const modelId = (req.headers.get("x-model-id") ?? undefined) as ModelId | undefined;

  const schemaInfo = getSchemaContext(datasetId);
  const tableList = tables.join(", ");

  const systemPrompt = `You are a data access policy assistant. Given a user's description of what data they want to control access to, identify which database tables are most relevant.

SCHEMA CONTEXT:
${schemaInfo}

AVAILABLE TABLES: ${tableList}

The user wants to create a policy for: "${description}"

Return ONLY a JSON array of table names (strings) that are relevant to this policy description. Include ALL tables that match the user's intent — no cap. Order by relevance (most relevant first).

Example: ["bookings", "booking_unit_economics", "customers"]

Return ONLY the JSON array. No markdown, no explanation.`;

  try {
    const text = await generateText(description, {
      modelId,
      systemPrompt,
      jsonMode: true,
      timeoutMs: 15_000,
      label: "policy table recommendation",
    });
    const cleaned = text.trim().replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "");
    const recommended = JSON.parse(cleaned);
    if (Array.isArray(recommended)) {
      // Filter to only include tables that actually exist
      const valid = recommended.filter((t: unknown) => typeof t === "string" && tables.includes(t as string));
      return Response.json({ tables: valid });
    }
    return Response.json({ tables: [] });
  } catch {
    return Response.json({ tables: [] });
  }
}
