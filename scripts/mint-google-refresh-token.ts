/**
 * Mint a fresh GOOGLE_OAUTH_REFRESH_TOKEN for the Workspace send-as transport
 * (the one that powers welcome + provisioning emails).
 *
 *   npx tsx scripts/mint-google-refresh-token.ts
 *
 * Prereqs (one-time, in Google Cloud Console for the OAuth 2.0 Client):
 *   1. APIs & Services → Credentials → your OAuth client → Authorized redirect URIs
 *      → add exactly:  http://localhost:5555/oauth2callback
 *   2. OAuth consent screen has the scope  .../auth/gmail.send  and divyansh@actioneer.com
 *      is a Test user (or the app is Published — Published avoids the 7-day token expiry).
 *
 * Run it, open the printed URL, sign in as divyansh@actioneer.com, approve, and it
 * prints a refresh token to paste into .env.local (and Railway).
 */
import { existsSync } from "node:fs";
import http from "node:http";

for (const f of [".env", ".env.local"]) {
  if (existsSync(f)) process.loadEnvFile(f);
}

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const PORT = 5555;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
const SCOPE = "https://www.googleapis.com/auth/gmail.send";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Missing GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET in .env.local");
  process.exit(1);
}

const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
  }).toString();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", REDIRECT_URI);
  if (!url.pathname.startsWith("/oauth2callback")) {
    res.writeHead(404);
    res.end();
    return;
  }
  const code = url.searchParams.get("code");
  const err = url.searchParams.get("error");
  if (err) {
    res.writeHead(400, { "Content-Type": "text/html" });
    res.end(`<h2>Authorization failed: ${err}</h2>`);
    console.error("Authorization error:", err);
    finish(1);
    return;
  }
  if (!code) {
    res.writeHead(400);
    res.end("No code in callback.");
    return;
  }
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }).toString(),
    });
    const data = (await tokenRes.json()) as { refresh_token?: string; error?: string; error_description?: string };
    if (data.refresh_token) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<h2>Success. Refresh token captured. Return to your terminal.</h2>");
      console.log("\n================ REFRESH TOKEN ================\n");
      console.log(data.refresh_token);
      console.log("\n==============================================\n");
      console.log("Add to .env.local (and Railway):");
      console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${data.refresh_token}\n`);
      finish(0);
    } else {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("No refresh_token returned: " + JSON.stringify(data));
      console.error("No refresh_token returned:", JSON.stringify(data, null, 2));
      console.error("(Tip: a refresh token is only returned with prompt=consent + access_type=offline, which this script sets.)");
      finish(1);
    }
  } catch (e) {
    res.writeHead(500);
    res.end(String(e));
    console.error("Token exchange failed:", e);
    finish(1);
  }
});

function finish(code: number) {
  setTimeout(() => {
    server.close();
    process.exit(code);
  }, 400);
}

server.listen(PORT, () => {
  console.log(`Listening for the OAuth redirect on ${REDIRECT_URI}\n`);
  console.log("1. Make sure that exact URI is an Authorized redirect URI on your OAuth client.");
  console.log("2. Open this URL, sign in as divyansh@actioneer.com, and approve:\n");
  console.log(authUrl + "\n");
});
