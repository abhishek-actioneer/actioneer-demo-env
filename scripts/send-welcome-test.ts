/**
 * One-off: send a TEST of the onboarding welcome email.
 *   npx tsx scripts/send-welcome-test.ts [recipient@example.com]
 */
import { existsSync, readFileSync } from "node:fs";
import { renderWelcomeEmail } from "../src/lib/server/welcome-email";
import { sendProspectEmail } from "../src/lib/server/send-prospect-email";

// A bare `tsx` run doesn't auto-load .env files (Next does). Load .env first,
// then FORCE .env.local to override (matching Next's precedence) so the freshly
// minted GOOGLE_OAUTH_REFRESH_TOKEN in .env.local wins over any stale one in .env.
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

const to = process.argv[2] || "divyanshsinghaneriya@gmail.com";
const calendlyUrl = process.env.CALENDLY_URL?.trim() || "https://calendly.com/aneriya/actioneer-intro";

async function main() {
  const { html, text, subject } = await renderWelcomeEmail({ name: "Divyansh", calendlyUrl });
  const res = await sendProspectEmail({
    to: [to],
    subject: `[TEST] ${subject}`,
    html,
    text,
    fromName: "Divyansh from Actioneer",
    categories: ["actioneer", "onboarding-welcome", "test"],
  });
  console.log(`SENT to ${to} via ${res.provider} (messageId=${res.messageId ?? "n/a"})`);
  process.exit(0);
}

main().catch((e) => {
  console.error("SEND FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
