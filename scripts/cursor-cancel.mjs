import { Agent } from "@cursor/sdk";

const apiKey = process.env.CURSOR_API_KEY;
const agentId = process.argv[2];

if (!apiKey) throw new Error("CURSOR_API_KEY is required (source .env.local)");
if (!agentId) throw new Error("Usage: node scripts/cursor-cancel.mjs <agentId>");

const agent = await Agent.resume(agentId, { apiKey });
const { items } = await Agent.listRuns(agentId, { runtime: "cloud", apiKey, limit: 5 });

const active = items.find((r) => r.status === "running" || r.status === "pending");
if (!active) {
  console.log(`No active run found for agent ${agentId}. Recent runs:`);
  items.forEach((r) => console.log(`  ${r.id}  ${r.status}`));
  agent.close();
  process.exit(0);
}

await active.cancel();
console.log(`Cancelled run ${active.id} on agent ${agentId}`);
agent.close();
