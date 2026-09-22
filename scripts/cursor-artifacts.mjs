import { Agent } from "@cursor/sdk";

const apiKey = process.env.CURSOR_API_KEY;
if (!apiKey) throw new Error("CURSOR_API_KEY required");

const { items } = await Agent.list({ runtime: "cloud", apiKey, limit: 5 });

console.log("=== Recent cloud runs ===");
for (const a of items) {
  console.log(JSON.stringify({ agentId: a.agentId, name: a.name, status: a.status, lastModified: a.lastModified }, null, 0));
}

// Most recent matching run (sorted desc by lastModified)
items.sort((x, y) => (y.lastModified ?? 0) - (x.lastModified ?? 0));
const ours = items.find(a => a.name?.includes("Browser tab title"));
if (!ours?.agentId) {
  console.log("\nNo matching run found.");
  process.exit(0);
}

console.log("\n=== Artifacts for", ours.agentId, "===");
const agent = await Agent.get({ runtime: "cloud", apiKey, id: ours.agentId });
const artifacts = await agent.listArtifacts();
console.log(JSON.stringify(artifacts, null, 2));
