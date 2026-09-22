import { auth } from "@clerk/nextjs/server";
import { discoverSchema, formatSchemaForLLM } from "@/lib/schema-discovery";
import { getSystemContext } from "@/lib/schema";
import { DEFAULT_DATASET, getDatasetForUser } from "@/lib/datasets";
import { generateTextStream } from "@/lib/llm";
import type { PlaybookV2, PlaybookAnnotation } from "@/lib/playbook-types";

function buildEditPrompt(
  systemContext: string,
  schemaText: string,
  playbook: PlaybookV2,
  annotations: PlaybookAnnotation[]
): string {
  // Format current cells as readable JSON
  const cellsJson = playbook.cells
    .map((c) => {
      const obj: Record<string, unknown> = {
        id: c.id,
        type: c.type,
        role: c.role,
        label: c.label,
        description: c.description,
        dependsOn: c.dependsOn,
        outputs: c.outputs,
      };
      if (c.sql) obj.sql = c.sql;
      if (c.prompt) obj.prompt = c.prompt;
      return JSON.stringify(obj);
    })
    .join("\n");

  // Format annotations grouped by target
  const annotationLines: string[] = [];
  for (const a of annotations) {
    if (a.cellId) {
      const cell = playbook.cells.find((c) => c.id === a.cellId);
      const label = cell ? `"${cell.label}" (${a.cellId})` : a.cellId;
      annotationLines.push(`- On ${label}: "${a.text}"`);
    } else {
      annotationLines.push(`- General: "${a.text}"`);
    }
  }

  // Determine which cell IDs are directly targeted
  const targetedIds = annotations
    .filter((a) => a.cellId)
    .map((a) => a.cellId!);
  const hasGeneralAnnotation = annotations.some((a) => !a.cellId);

  return `${systemContext}

You are editing an existing analytics playbook based on user annotations (comments).
The playbook is a DAG of execution cells. Apply the user annotations as TARGETED patches.

## Cell Types
- **sql**: Executes a SQL query against DuckDB. Must be a valid SELECT or WITH query.
- **llm**: Calls an AI model to analyze data. Receives dependency cell outputs as context.

## Cell Roles
guardrail, parameter, query, analysis, summary

## CRITICAL: Output ONLY what changed
${hasGeneralAnnotation ? `A general (structural) annotation was provided — output ALL cells in their new order.` : `Only output cells that are MODIFIED, ADDED, or REMOVED. Do NOT output unchanged cells.
Targeted cell IDs: ${targetedIds.join(", ")}`}

## Rules
1. Apply EVERY annotation.
2. For modified cells: output the full updated cell with its EXISTING id.
3. For new cells: output with a new id (use "new_1", "new_2", etc.). Set dependsOn to valid existing cell IDs.
4. For removed cells: output {"type":"remove","cellId":"..."}.
5. For reordering: output {"type":"reorder","cellIds":["c1","c3","c2",...]} with the full ordered list.
6. Keep original cell IDs for modified cells — do NOT renumber.
7. SQL must use ONLY tables/columns from the schema below.
8. Use {{param_name}} for user-configurable values and {{column_name}} for parameter cell outputs.

## Output Format
Output EXACTLY one JSON object per line (NDJSON). No markdown, no code fences.

{"type":"cell","cell":{"id":"c5","type":"sql","role":"query","label":"...","description":"...","dependsOn":[...],"outputs":[...],"sql":"..."}}
{"type":"remove","cellId":"c3"}
{"type":"reorder","cellIds":["c1","c2","c4","c5"]}
{"type":"generation_complete"}

--- AVAILABLE SCHEMA ---
${schemaText}

--- CURRENT PLAYBOOK: "${playbook.name}" ---
${cellsJson}

--- CURRENT PARAMS ---
${JSON.stringify(playbook.params ?? [])}

--- USER ANNOTATIONS (apply all of these) ---
${annotationLines.join("\n")}`;
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const playbook = body.playbook as PlaybookV2 | undefined;
  const annotations = (body.annotations ?? []) as PlaybookAnnotation[];
  const datasetId = body.datasetId || req.headers.get("x-dataset-id") || DEFAULT_DATASET;
  if (!getDatasetForUser(datasetId, userId)) return Response.json({ error: "Not found" }, { status: 404 });

  if (!playbook || annotations.length === 0) {
    return Response.json({ error: "playbook and annotations required" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      function send(event: Record<string, unknown>) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch { /* stream closed */ }
      }

      try {
        send({ type: "phase", phase: "discovering_schema" });
        const schema = await discoverSchema(datasetId);
        const schemaText = formatSchemaForLLM(schema);

        send({ type: "phase", phase: "applying_annotations" });
        const systemContext = getSystemContext(datasetId);
        const prompt = buildEditPrompt(systemContext, schemaText, playbook, annotations);

        const llmStream = await generateTextStream(prompt, {
          label: "playbook-edit",
          timeoutMs: 60_000,
          maxOutputTokens: 8192,
        });

        let buffer = "";
        const sentEvents = new Set<string>();

        function tryParseLine(line: string) {
          let trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("```") || !trimmed.startsWith("{")) return;
          const lastBrace = trimmed.lastIndexOf("}");
          if (lastBrace !== trimmed.length - 1 && lastBrace > 0) {
            trimmed = trimmed.slice(0, lastBrace + 1);
          }
          try {
            const parsed = JSON.parse(trimmed);
            if (
              parsed.type === "cell" ||
              parsed.type === "remove" ||
              parsed.type === "reorder" ||
              parsed.type === "playbook_meta" ||
              parsed.type === "params" ||
              parsed.type === "generation_complete"
            ) {
              const eventKey =
                parsed.type === "cell" ? `cell:${parsed.cell?.id}` :
                parsed.type === "remove" ? `remove:${parsed.cellId}` :
                parsed.type;
              if (!sentEvents.has(eventKey)) {
                sentEvents.add(eventKey);
                send(parsed);
              }
            }
          } catch { /* skip */ }
        }

        for await (const chunk of llmStream) {
          const text = chunk;
          if (!text) continue;
          buffer += text;
          const lines = buffer.split("\n");
          buffer = lines.pop()!;
          for (const line of lines) tryParseLine(line);
        }

        if (buffer.trim()) {
          const remaining = buffer.replace(/```\s*$/g, "").trim();
          for (const line of remaining.split("\n")) tryParseLine(line);
        }

        send({ type: "generation_complete" });
        send({ type: "done" });
      } catch (err) {
        console.error("Playbook edit error:", err);
        send({ type: "error", message: err instanceof Error ? err.message : "Unknown error" });
      } finally {
        closed = true;
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
