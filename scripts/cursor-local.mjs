import { Agent } from "@cursor/sdk";

const apiKey = process.env.CURSOR_API_KEY;
const task = process.argv.slice(2).join(" ").trim();

if (!apiKey) throw new Error("CURSOR_API_KEY is required (source .env.local)");
if (!task) throw new Error("Pass a task as args, e.g. node scripts/cursor-local.mjs 'Add a comment...'");

const SYSTEM_PROMPT = `
You are working in the baby-sentinel repo.
Stack: Next.js 16, React 19, Tailwind v4, shadcn/ui, DuckDB, OpenAI, Clerk.

Read CLAUDE.md before editing. Follow it strictly:
- All client->server calls go through apiFetch (src/lib/api-client.ts). Never raw fetch.
- Strictly monochrome UI tokens.
- Never hardcode "ecommerce". Use DEFAULT_DATASET.
- Dataset-scoped stores require datasetId as the first parameter.
- pnpm is the package manager. @/* is the src alias.

Keep diffs minimal. Don't add comments unless the why is non-obvious. Run pnpm lint after edits if you change TS/TSX files.
`.trim();

console.log(`[local] task: ${task}\n`);

const agent = await Agent.create({
  apiKey,
  model: { id: "composer-2" },
  local: { cwd: process.cwd() },
});

const run = await agent.send(`${SYSTEM_PROMPT}\n\nTask:\n${task}`);

for await (const event of run.stream()) {
  switch (event.type) {
    case "assistant":
      for (const block of event.message.content) {
        if (block.type === "text") process.stdout.write(block.text);
      }
      break;
    case "thinking":
      process.stdout.write(`\x1b[2m${event.text}\x1b[0m`);
      break;
    case "tool_call":
      console.log(`\n[tool] ${event.name} :: ${event.status}`);
      break;
    case "task":
      if (event.text) console.log(`\n[task] ${event.text}`);
      break;
    case "status":
      console.log(`\n[status] ${event.status}${event.message ? `: ${event.message}` : ""}`);
      break;
  }
}

console.log("\n[done]");
agent.close();
