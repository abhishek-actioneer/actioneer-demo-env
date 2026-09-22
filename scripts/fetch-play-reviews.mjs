// Fetches FundsIndia Play Store reviews using google-play-scraper
// Run: node scripts/fetch-play-reviews.mjs

import { createRequire } from "module";
const require = createRequire(import.meta.url);

let gplay;
try {
  gplay = require("google-play-scraper");
} catch {
  console.error("Run: npm install google-play-scraper --no-save");
  process.exit(1);
}

const APP_ID = "com.fundsindia";

async function main() {
  console.log("Fetching app metadata...\n");

  const appInfo = await gplay.app({ appId: APP_ID, lang: "en", country: "in" });
  console.log("=== APP INFO ===");
  console.log(`Title: ${appInfo.title}`);
  console.log(`Rating: ${appInfo.score} (${appInfo.ratings} ratings)`);
  console.log(`Installs: ${appInfo.installs}`);
  console.log(`Version: ${appInfo.version}`);
  console.log(`Size: ${appInfo.size}`);
  console.log(`Updated: ${appInfo.updated}`);
  console.log(`\nDescription:\n${appInfo.description?.slice(0, 800)}...\n`);
  console.log(`Recent What's New:\n${appInfo.recentChanges}\n`);

  console.log("Fetching reviews (newest 100)...\n");
  const newest = await gplay.reviews({
    appId: APP_ID,
    lang: "en",
    country: "in",
    sort: gplay.sort.NEWEST,
    num: 100,
  });

  console.log("Fetching reviews (most critical — 1-2 stars)...\n");
  const critical = await gplay.reviews({
    appId: APP_ID,
    lang: "en",
    country: "in",
    sort: gplay.sort.RATING,
    num: 100,
  });

  const allReviews = [...newest.data, ...critical.data];

  // Deduplicate
  const seen = new Set();
  const unique = allReviews.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });

  console.log(`=== ${unique.length} UNIQUE REVIEWS ===\n`);

  // Group by star rating
  const byRating = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  for (const r of unique) {
    byRating[r.score]?.push(r);
  }

  for (const stars of [1, 2, 3, 4, 5]) {
    const reviews = byRating[stars];
    if (!reviews.length) continue;
    console.log(`\n${"★".repeat(stars)} (${reviews.length} reviews)`);
    console.log("─".repeat(60));
    for (const r of reviews.slice(0, 15)) {
      console.log(`[${r.date}] ${r.userName}`);
      console.log(`  "${r.text}"`);
      if (r.replyText) console.log(`  ↩ DEV: "${r.replyText?.slice(0, 120)}"`);
      console.log();
    }
  }

  // Pain point summary
  const complaints = unique.filter((r) => r.score <= 2);
  const keywords = {};
  const terms = [
    "kyc", "sip", "crash", "slow", "login", "otp", "redemption", "mandate",
    "support", "advisor", "call", "push", "update", "error", "fail", "stuck",
    "bank", "password", "fund", "nav", "statement", "tax",
  ];
  for (const r of complaints) {
    const text = (r.text || "").toLowerCase();
    for (const term of terms) {
      if (text.includes(term)) keywords[term] = (keywords[term] || 0) + 1;
    }
  }

  console.log("\n=== COMPLAINT KEYWORD FREQUENCY ===");
  const sorted = Object.entries(keywords).sort((a, b) => b[1] - a[1]);
  for (const [term, count] of sorted) {
    console.log(`  ${term.padEnd(15)} ${count} mentions`);
  }
}

main().catch(console.error);
