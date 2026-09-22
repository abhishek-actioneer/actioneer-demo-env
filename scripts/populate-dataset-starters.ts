/**
 * Pre-populate auto-generated segments, funnels, and retentions for a dynamic
 * dataset — the same generation the /segments, /funnels, and /retentions pages
 * trigger lazily on first visit, run eagerly from the CLI.
 *
 * Usage: npx tsx scripts/populate-dataset-starters.ts <dataset-id> [<clerk-user-id>] [--skip-segments]
 * Requires in .env.local: OPENAI_API_KEY (+ CURSOR_AGENT_USER_ID if user id not passed)
 */

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { loadSchemaMap } from "../src/lib/datasets/schema-enricher";
import { getDynamicDataset } from "../src/lib/datasets/dynamic-registry";
import { generateSegmentsForDataset } from "../src/lib/server/segment-generator";
import { generateFunnelsForDataset } from "../src/lib/server/funnel-generator";
import { generateRetentionsForDataset } from "../src/lib/server/retention-generator";

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

  const args = process.argv.slice(2).filter((a) => a !== "--skip-segments");
  const skipSegments = process.argv.includes("--skip-segments");
  const datasetId = args[0];
  const userId = args[1] || process.env.CURSOR_AGENT_USER_ID;
  if (!datasetId || !userId) {
    console.error("Usage: npx tsx scripts/populate-dataset-starters.ts <dataset-id> [<clerk-user-id>]");
    process.exit(1);
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY missing — add it to .env.local");
    process.exit(1);
  }

  const dataset = getDynamicDataset(datasetId);
  if (!dataset) {
    console.error(`Unknown dynamic dataset: "${datasetId}"`);
    process.exit(1);
  }

  console.log(`Populating starters for "${dataset.label}" (${datasetId}) as ${userId}\n`);

  console.log("1. Segments...");
  const schemaMap = skipSegments ? null : loadSchemaMap(resolve(process.cwd(), "data/datasets", datasetId));
  if (skipSegments) {
    console.log("   skipped (--skip-segments)");
  } else if (!schemaMap) {
    console.warn("   no schema-map.json — skipping segments");
  } else {
    const seg = await generateSegmentsForDataset(userId, datasetId, schemaMap, dataset.userIdField, dataset.label);
    console.log(`   ✓ ${seg.generated} generated, ${seg.failed} failed`);
  }

  console.log("2. Funnels...");
  const fun = await generateFunnelsForDataset(userId, datasetId, dataset);
  console.log(`   ✓ ${fun.generated} generated, ${fun.failed} failed`);

  console.log("3. Retentions...");
  const ret = await generateRetentionsForDataset(userId, datasetId, dataset);
  console.log(`   ✓ ${ret.generated} generated, ${ret.failed} failed`);

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Populate failed:", err);
  process.exit(1);
});
