import crypto from "node:crypto";
import { NextResponse } from "next/server";

const REPO_OWNER = "Glitchcraft-Inc";
const REPO_NAME = "baby-sentinel";
const WORKFLOW_FILE = "cursor-fix.yml";
const WORKFLOW_REF = "main";

export async function POST(req: Request) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  const githubPat = process.env.GH_AGENT_PAT;

  if (!signingSecret || !githubPat) {
    return NextResponse.json(
      { error: "Server misconfigured: missing SLACK_SIGNING_SECRET or GH_AGENT_PAT" },
      { status: 500 },
    );
  }

  const rawBody = await req.text();
  const timestamp = req.headers.get("x-slack-request-timestamp") ?? "";
  const signature = req.headers.get("x-slack-signature") ?? "";

  if (!verifySlackSignature({ signingSecret, timestamp, rawBody, signature })) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  const params = new URLSearchParams(rawBody);
  const command = params.get("command") ?? "";
  const text = (params.get("text") ?? "").trim();
  const userName = params.get("user_name") ?? "unknown";
  const channelName = params.get("channel_name") ?? "unknown";

  if (command !== "/fix") {
    return ephemeral(`Unknown command: ${command}`);
  }

  if (!text) {
    return ephemeral(
      "Usage: `/fix <bug description with file paths if known>`\n" +
        "Example: `/fix Lint error in src/lib/db.ts — unused variable cap. Remove it.`",
    );
  }

  const dispatchResult = await dispatchWorkflow({
    pat: githubPat,
    task: `[slack:${userName}@${channelName}] ${text}`,
  });

  if (!dispatchResult.ok) {
    return ephemeral(
      `Failed to dispatch workflow (${dispatchResult.status}): ${dispatchResult.message}`,
    );
  }

  const runsUrl = `https://github.com/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE}`;
  return inChannel(
    `Cursor agent dispatched by *${userName}*.\n` +
      `> ${text}\n` +
      `Watching: ${runsUrl}\nPR will be posted here when ready.`,
  );
}

function verifySlackSignature(args: {
  signingSecret: string;
  timestamp: string;
  rawBody: string;
  signature: string;
}): boolean {
  const { signingSecret, timestamp, rawBody, signature } = args;
  if (!timestamp || !signature) return false;

  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > 60 * 5) return false;

  const base = `v0:${timestamp}:${rawBody}`;
  const expected =
    "v0=" +
    crypto.createHmac("sha256", signingSecret).update(base).digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function dispatchWorkflow(args: {
  pat: string;
  task: string;
}): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE}/dispatches`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.pat}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ref: WORKFLOW_REF,
      inputs: { task: args.task, base_ref: WORKFLOW_REF },
    }),
  });

  if (res.status === 204) return { ok: true };
  const message = await res.text().catch(() => "(no body)");
  return { ok: false, status: res.status, message: message.slice(0, 500) };
}

function ephemeral(text: string) {
  return NextResponse.json({ response_type: "ephemeral", text });
}

function inChannel(text: string) {
  return NextResponse.json({ response_type: "in_channel", text });
}
