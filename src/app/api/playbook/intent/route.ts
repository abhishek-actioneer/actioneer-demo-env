import { auth } from "@clerk/nextjs/server";
import { discoverSchema, formatSchemaForLLM } from "@/lib/schema-discovery";
import { generateText } from "@/lib/llm";
import type { PlaybookV2, PlaybookAnnotation } from "@/lib/playbook-types";

interface AnnotationOp {
  action: "remove" | "add" | "modify";
  cellId: string | null;
  label?: string;
  description?: string;
  sql?: string;
  prompt?: string;
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const playbook = body.playbook as PlaybookV2 | undefined;
  const annotations = (body.annotations ?? []) as PlaybookAnnotation[];
  const datasetId = req.headers.get("x-dataset-id") ?? undefined;

  console.log("[intent] POST called with", annotations.length, "annotations, datasetId:", datasetId);
  console.log("[intent] Annotations:", JSON.stringify(annotations, null, 2));

  if (!playbook || annotations.length === 0) {
    console.log("[intent] Missing playbook or no annotations — returning 400");
    return Response.json({ error: "playbook and annotations required" }, { status: 400 });
  }

  console.log("[intent] Playbook:", playbook.name, "with", playbook.cells.length, "cells");

  // Build compact cell list for context
  const cellsSummary = playbook.cells
    .map((c) => {
      let line = `${c.id} [${c.type}/${c.role}] "${c.label}" — ${c.description}`;
      if (c.sql) line += ` | SQL: ${c.sql.slice(0, 120)}...`;
      return line;
    })
    .join("\n");

  const annotationLines = annotations.map((a) => {
    const cell = a.cellId ? playbook.cells.find((c) => c.id === a.cellId) : null;
    const target = cell ? `near cell "${cell.label}" (${a.cellId})` : "general";
    return `- ${target}: "${a.text}"`;
  }).join("\n");

  console.log("[intent] Cells summary:\n" + cellsSummary);
  console.log("[intent] Annotation lines:\n" + annotationLines);

  try {
    console.log("[intent] Discovering schema for datasetId:", datasetId);
    const schema = await discoverSchema(datasetId);
    const schemaText = formatSchemaForLLM(schema);
    console.log("[intent] Schema discovered:", schema.tableNames.length, "tables —", schema.tableNames.join(", "));
    console.log("[intent] Schema text length:", schemaText.length);

    const prompt = `You are parsing user annotations on an analytics playbook into structured operations.

## Current playbook cells:
${cellsSummary}

## Available schema:
${schemaText}

## User annotations:
${annotationLines}

Note: annotations say "near cell X" meaning the user placed the comment near that cell. This does NOT mean they want to modify that cell — read the actual text to determine intent.

For EACH annotation, output a JSON operation. Output a JSON array — one operation per annotation.

Operation types:
1. **remove** — user wants to DELETE/REMOVE an existing cell. Keywords: "remove", "delete", "drop", "get rid of"
   {"action":"remove","cellId":"q_conversion_funnel"}

2. **add** — user wants a NEW cell added that doesn't exist yet. Keywords: "add", "create", "new", "include", "also show", "I also want". ALWAYS use action "add" with cellId null — NEVER modify an existing cell when the user wants something new.
   {"action":"add","cellId":null,"label":"Refund Rate Analysis","description":"Calculate refund rates by category","sql":"SELECT ...","type":"sql","role":"query","dependsOn":["cell1_init"]}

3. **modify** — user wants to CHANGE an existing cell's SQL, label, or description. Keywords: "change", "update", "fix", "rename", "filter by"
   {"action":"modify","cellId":"q_existing_cell","sql":"SELECT ... new query ..."}

## CRITICAL RULES:
- If the user says "add X" or "I want a query for X" — this is ALWAYS "add", even if the annotation is near an existing cell. NEVER use "modify" for this.
- "modify" is ONLY for changing something that already exists (e.g. "change the filter to Samsung", "rename this to X").
- For "add": cellId MUST be null. Write VALID DuckDB SQL using ONLY the schema tables/columns.
- For "remove": cellId must be the ID of the cell to remove.
- Output ONLY the JSON array, no markdown, no code fences, no explanation.`;

    console.log("[intent] Calling OpenAI");
    const result = await generateText(prompt, {
      label: "playbook-intent",
      timeoutMs: 30_000,
      maxOutputTokens: 4096,
    });

    const raw = (result || "[]")
      .replace(/^```(?:json)?\n?/i, "")
      .replace(/\n?```$/i, "")
      .trim();

    console.log("[intent] Raw LLM response:", raw);

    let ops: AnnotationOp[];
    try {
      ops = JSON.parse(raw);
      console.log("[intent] Parsed ops directly:", JSON.stringify(ops, null, 2));
    } catch (parseErr) {
      console.log("[intent] Direct parse failed:", parseErr);
      // Try to extract JSON array from response
      const match = raw.match(/\[[\s\S]*\]/);
      ops = match ? JSON.parse(match[0]) : [];
      console.log("[intent] Extracted ops from regex:", JSON.stringify(ops, null, 2));
    }

    console.log("[intent] Returning", ops.length, "ops");
    return Response.json({ ops });
  } catch (err) {
    console.error("Intent parse error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
