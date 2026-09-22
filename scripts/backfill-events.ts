/**
 * Backfill events.json for all uploaded datasets that have schema-map.json but no events.json.
 * Run with: npx tsx scripts/backfill-events.ts
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { generateEventsFromSchema } from "../src/lib/datasets/event-generator";
import type { SchemaMap } from "../src/lib/datasets/types";

const DATASETS_DIR = resolve(process.cwd(), "data/datasets");

if (!existsSync(DATASETS_DIR)) {
  console.log("No datasets directory found");
  process.exit(0);
}

async function main() {
let generated = 0;
let skipped = 0;

for (const entry of readdirSync(DATASETS_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;

  const dir = join(DATASETS_DIR, entry.name);
  const eventsPath = join(dir, "events.json");
  const schemaMapPath = join(dir, "schema-map.json");

  if (existsSync(eventsPath)) {
    console.log(`  skip ${entry.name} — events.json already exists`);
    skipped++;
    continue;
  }

  if (!existsSync(schemaMapPath)) {
    console.log(`  skip ${entry.name} — no schema-map.json`);
    skipped++;
    continue;
  }

  try {
    const schemaMap: SchemaMap = JSON.parse(readFileSync(schemaMapPath, "utf-8"));

    // Read dateField from config.json if available
    let dateField: string | undefined;
    const configPath = join(dir, "config.json");
    if (existsSync(configPath)) {
      try {
        const config = JSON.parse(readFileSync(configPath, "utf-8"));
        dateField = config.dateField;
      } catch { /* ignore */ }
    }

    const label = entry.name.replace(/^user\w+-/, "").replace(/-/g, " ");
    const events = await generateEventsFromSchema(schemaMap, label, dateField);
    if (events.length > 0) {
      writeFileSync(eventsPath, JSON.stringify(events, null, 2));
      console.log(`  ✓ ${entry.name} — generated ${events.length} events`);
      generated++;
    } else {
      console.log(`  ⚠ ${entry.name} — 0 events generated (schema may be too sparse)`);
    }
  } catch (err) {
    console.error(`  ✗ ${entry.name} — error:`, err);
  }
}

console.log(`\nDone: ${generated} generated, ${skipped} skipped`);
}

main().catch(console.error);
