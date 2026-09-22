/**
 * Regenerate metrics.json and events.json for an existing dynamic dataset
 * from its saved schema-map.json — without re-importing CSVs or re-running
 * the column/prompt enrichment steps.
 *
 * Useful when metric/event generation failed (e.g. LLM output truncation)
 * but the schema map itself is good.
 *
 * Usage: npx tsx scripts/regen-dataset-enrichment.ts <dataset-id>
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve, join } from "path";
import { loadSchemaMap } from "../src/lib/datasets/schema-enricher";
import { generateMetricDefinitions } from "../src/lib/datasets/metric-generator";
import { generateEventsFromSchema } from "../src/lib/datasets/event-generator";

function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue
      .replace(/^export\s+/, "")
      .replace(/^"(.*)"$/, "$1")
      .replace(/^'(.*)'$/, "$1");
  }
}

async function main() {
  loadEnvFile(resolve(".env"));
  loadEnvFile(resolve(".env.local"));

  const datasetId = process.argv[2];
  if (!datasetId) {
    console.error("Usage: npx tsx scripts/regen-dataset-enrichment.ts <dataset-id>");
    process.exit(1);
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY missing — add it to .env.local");
    process.exit(1);
  }

  const datasetDir = resolve(process.cwd(), "data/datasets", datasetId);
  const configPath = join(datasetDir, "config.json");
  if (!existsSync(configPath)) {
    console.error(`No config.json at ${datasetDir} — is "${datasetId}" a dynamic dataset?`);
    process.exit(1);
  }
  const config = JSON.parse(readFileSync(configPath, "utf-8")) as { label: string };

  const schemaMap = loadSchemaMap(datasetDir);
  if (!schemaMap) {
    console.error(`No schema-map.json at ${datasetDir} — run full enrichment first.`);
    process.exit(1);
  }

  console.log(`Regenerating metrics + events for "${config.label}" (${datasetId})\n`);

  console.log("1. Metric definitions...");
  try {
    const metrics = await generateMetricDefinitions(schemaMap, config.label);
    if (metrics.length > 0) {
      writeFileSync(join(datasetDir, "metrics.json"), JSON.stringify(metrics, null, 2));
      console.log(`   ✓ saved ${metrics.length} metrics`);
    } else {
      console.warn("   no metrics generated");
    }
  } catch (err) {
    console.error("   metric generation failed:", err);
  }

  console.log("2. Events...");
  try {
    const events = await generateEventsFromSchema(schemaMap, config.label, schemaMap.dateField);
    if (events.length > 0) {
      writeFileSync(join(datasetDir, "events.json"), JSON.stringify(events, null, 2));
      console.log(`   ✓ saved ${events.length} events`);
    } else {
      console.warn("   no events generated");
    }
  } catch (err) {
    console.error("   event generation failed:", err);
  }

  console.log("\nDone. Restart the dev server (or trigger reloadDynamicDatasets) to pick up changes.");
}

main().catch((err) => {
  console.error("Regen failed:", err);
  process.exit(1);
});
