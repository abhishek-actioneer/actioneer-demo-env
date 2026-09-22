import crypto from "node:crypto";

const url = process.env.SLACK_TEST_URL || "http://localhost:3000/api/agent/slack";
const signingSecret = process.env.SLACK_SIGNING_SECRET;

if (!signingSecret) {
  console.error("SLACK_SIGNING_SECRET is required (source .env.local first)");
  process.exit(1);
}

const taskText = process.argv.slice(2).join(" ").trim() ||
  "Add a single-line comment to src/lib/db.ts saying 'managed via env vars'";

const fields = new URLSearchParams({
  command: "/fix",
  text: taskText,
  user_name: "vimarshh-local-test",
  channel_name: "all-romote-force",
  team_id: "T0AS2HRLUT1",
  channel_id: "C_TEST",
  user_id: "U_TEST",
  response_url: "https://hooks.slack.com/commands/T_TEST/B_TEST/test",
  trigger_id: "test-trigger",
});

const body = fields.toString();
const ts = Math.floor(Date.now() / 1000).toString();
const base = `v0:${ts}:${body}`;
const sig =
  "v0=" + crypto.createHmac("sha256", signingSecret).update(base).digest("hex");

console.log(`POST ${url}`);
console.log(`task: ${taskText}\n`);

const res = await fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    "X-Slack-Signature": sig,
    "X-Slack-Request-Timestamp": ts,
  },
  body,
});

const text = await res.text();
console.log(`status: ${res.status}`);
console.log(`body: ${text}`);

if (res.status === 200) {
  console.log("\n[ok] route is alive, signature verified, reply posted");
} else if (res.status === 401) {
  console.log("\n[fail] signature verification failed — secret mismatch?");
} else {
  console.log("\n[fail] unexpected status");
}
