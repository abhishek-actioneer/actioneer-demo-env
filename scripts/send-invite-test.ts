/**
 * One-off: send a TEST of the prospect INVITE email (the one with login creds,
 * magic link, and Loom). Uses sample values — not real credentials.
 *   npx tsx scripts/send-invite-test.ts [recipient@example.com ...]
 */
import { existsSync, readFileSync } from "node:fs";
import { renderInviteEmail } from "../src/lib/server/invite-email";
import { sendProspectEmail } from "../src/lib/server/send-prospect-email";

// Load .env then force .env.local to override (matching Next's precedence).
if (existsSync(".env")) process.loadEnvFile(".env");
if (existsSync(".env.local")) {
  for (const raw of readFileSync(".env.local", "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

const recipients = process.argv.slice(2);
const to = recipients.length ? recipients : ["divyanshsinghaneriya@gmail.com"];

async function main() {
  const { html, text, subject } = await renderInviteEmail({
    championName: "Divyansh",
    dealOwnerName: "Taha",
    senderName: "Divyansh",
    loginEmail: "analysis+acme@actioneer.com",
    password: "actioneer-demo-7f3k", // sample only
    magicLink: "https://demo.actioneer.com/auth/magic?token=sample-test-token",
    loomUrl: process.env.INVITE_LOOM_URL?.trim() || undefined,
  });

  for (const r of to) {
    const res = await sendProspectEmail({
      to: [r],
      subject: `[TEST] ${subject}`,
      html,
      text,
      fromName: "Divyansh from Actioneer",
      categories: ["actioneer", "prospect-invite", "test"],
    });
    console.log(`SENT invite test to ${r} via ${res.provider} (messageId=${res.messageId ?? "n/a"})`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("SEND FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
