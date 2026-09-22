/**
 * Manual smoke test for the Parallel client + competitor-research wrapper prompt.
 *
 * Costs ONE Parallel Deep Research task per run (pro-fast tier).
 *
 * Usage:
 *   PARALLEL_API_KEY=... npx tsx scripts/test-competitor-research.ts "<query>"
 *
 * Logs every SSE event verbatim so you can verify Parallel's actual event
 * field names match the route's `mapParallelEvent` switch.
 */

import { createTask, streamTaskEvents, fetchTaskResult } from "../src/lib/parallel-client";
import { buildCompetitorResearchInput } from "../src/lib/prompts/competitor-research";

async function main() {
  const userMessage = process.argv[2];
  if (!userMessage) {
    console.error("Usage: tsx scripts/test-competitor-research.ts \"<query>\"");
    process.exit(1);
  }

  const input = buildCompetitorResearchInput(userMessage);
  console.log(`[input] ${input.length} chars`);

  const start = Date.now();
  const task = await createTask({ input, processor: "pro-fast" });
  console.log(`[task] runId=${task.runId}`);

  let eventCount = 0;
  const eventTypeCounts = new Map<string, number>();

  for await (const ev of streamTaskEvents(task.runId)) {
    eventCount += 1;
    eventTypeCounts.set(ev.type, (eventTypeCounts.get(ev.type) ?? 0) + 1);
    console.log(`[event #${eventCount}] type=${ev.type}`, JSON.stringify(ev).slice(0, 300));

    if (ev.type === "task_run.state") {
      const status = (ev as { status?: string }).status;
      if (status === "completed") break;
      if (status === "failed" || status === "cancelled") {
        console.error(`[${status}]`);
        process.exit(1);
      }
    }
  }

  const result = await fetchTaskResult(task.runId);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log("\n=== EVENT TYPE SUMMARY ===");
  for (const [type, count] of [...eventTypeCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type.padEnd(30)} ${count}`);
  }

  console.log(`\n[done] ${elapsed}s, ${eventCount} events, ${result.markdown.length} chars`);
  console.log("\n=== REPORT ===\n");
  console.log(result.markdown);

  if (result.basis.length > 0) {
    console.log(`\n=== BASIS (${result.basis.length} entries) ===`);
    console.log(JSON.stringify(result.basis.slice(0, 3), null, 2));
    if (result.basis.length > 3) console.log(`... ${result.basis.length - 3} more entries`);
  }
}

main().catch((err) => {
  console.error("[error]", err);
  process.exit(1);
});
