/**
 * LLM-powered event generation from schema-map data.
 * Calls OpenAI to produce PM-readable EventDefinition[] with retries on failure.
 */

import type { EventDefinition, EventProperty } from "../explorer-types";
import type { SchemaMap } from "./types";
import { generateJson } from "../llm";
import { buildEventGenerationPrompt } from "@/lib/prompts/event-generation";

const MAX_RETRIES = 3;
const TIMEOUT_MS = 120_000;

/**
 * Generate events via LLM. Retries up to 3 times on failure.
 * Returns empty array only if all retries are exhausted.
 */
export async function generateEventsFromSchema(
  schemaMap: SchemaMap,
  label: string,
  datasetDateField?: string,
): Promise<EventDefinition[]> {
  const prompt = buildEventGenerationPrompt(schemaMap, label, datasetDateField);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[event-generator] LLM attempt ${attempt}/${MAX_RETRIES} for "${label}"`);
      const parsed = await generateJson<unknown>(prompt, {
        timeoutMs: TIMEOUT_MS,
        label: "Event generation",
        // Wide multi-table datasets generate many events — 4096 truncated mid-JSON
        maxOutputTokens: 32_768,
      });
      // jsonMode forces a top-level object, so the model may wrap the array (e.g. {"events": [...]})
      const events: EventDefinition[] = Array.isArray(parsed)
        ? parsed
        : ((parsed && typeof parsed === "object"
            ? (Object.values(parsed).find(Array.isArray) as EventDefinition[] | undefined)
            : undefined) ?? []);

      const validated = validateEvents(events);

      if (validated.length === 0) {
        console.warn(`[event-generator] attempt ${attempt}: LLM returned 0 valid events`);
        continue;
      }

      console.log(`[event-generator] generated ${validated.length} events for "${label}"`);
      return validated;
    } catch (err) {
      console.warn(`[event-generator] attempt ${attempt} failed:`, err);
    }
  }

  console.error(`[event-generator] all ${MAX_RETRIES} attempts failed for "${label}"`);
  return [];
}

/** Validate and sanitize LLM-returned events */
function validateEvents(events: EventDefinition[]): EventDefinition[] {
  return events
    .filter((e) => e.id && e.displayName && e.table && Array.isArray(e.properties))
    .map((e) => ({
      id: String(e.id),
      displayName: String(e.displayName),
      ...(e.category ? { category: String(e.category) } : {}),
      table: String(e.table),
      ...(e.filterColumn ? { filterColumn: String(e.filterColumn) } : {}),
      ...(e.filterValue ? { filterValue: String(e.filterValue) } : {}),
      ...(e.filterSQL ? { filterSQL: String(e.filterSQL) } : {}),
      ...(e.countColumn ? { countColumn: String(e.countColumn) } : {}),
      ...(e.valueColumn ? { valueColumn: String(e.valueColumn) } : {}),
      ...(e.dateColumn ? { dateColumn: String(e.dateColumn) } : {}),
      properties: e.properties
        .filter((p: EventProperty) => p.column && p.displayName && p.type)
        .map((p: EventProperty) => ({
          column: String(p.column),
          displayName: String(p.displayName),
          type: (["string", "number", "date"].includes(p.type) ? p.type : "string") as EventProperty["type"],
          ...(p.cardinalityHint ? { cardinalityHint: p.cardinalityHint } : {}),
        })),
    }));
}
