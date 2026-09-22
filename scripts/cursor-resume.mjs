import { Agent } from "@cursor/sdk";

const apiKey = process.env.CURSOR_API_KEY;
const agentId = process.argv[2];
const followUp = process.argv.slice(3).join(" ").trim();

if (!apiKey) throw new Error("CURSOR_API_KEY is required (source .env.local)");
if (!agentId) throw new Error("Usage: node scripts/cursor-resume.mjs <agentId> 'follow-up message'");
if (!followUp) throw new Error("Pass a follow-up message after the agentId");

const agent = await Agent.resume(agentId, { apiKey });
const run = await agent.send(followUp);

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
    case "status":
      console.log(`\n[status] ${event.status}${event.message ? `: ${event.message}` : ""}`);
      break;
  }
}

console.log("\n[done]");
agent.close();
