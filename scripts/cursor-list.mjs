import { Agent } from "@cursor/sdk";

const apiKey = process.env.CURSOR_API_KEY;
if (!apiKey) throw new Error("CURSOR_API_KEY is required (source .env.local)");

const runtime = process.argv[2] === "local" ? "local" : "cloud";
const limit = Number(process.argv[3] ?? 20);

const opts = runtime === "local"
  ? { runtime: "local", cwd: process.cwd(), limit }
  : { runtime: "cloud", apiKey, limit };

const { items } = await Agent.list(opts);

if (!items.length) {
  console.log(`No ${runtime} agents found.`);
  process.exit(0);
}

for (const a of items) {
  console.log(
    [
      a.id,
      a.status?.padEnd(10) ?? "—".padEnd(10),
      a.lastModified ? new Date(a.lastModified).toISOString() : "—",
      a.name ?? "(unnamed)",
    ].join("  ")
  );
}
