import type { SendTwilioEmailInput } from "./twilio-email-client";

/**
 * Send email AS a real Google Workspace mailbox (e.g. divyansh@actioneer.com)
 * via the Gmail API. The invite then comes from a real person and replies land
 * back in that inbox — true two-way email, not a no-reply blast.
 *
 * Auth uses a one-time OAuth2 refresh token for the sender's own account (no
 * Workspace-admin domain delegation needed). Required env:
 *   GOOGLE_OAUTH_CLIENT_ID
 *   GOOGLE_OAUTH_CLIENT_SECRET
 *   GOOGLE_OAUTH_REFRESH_TOKEN   (issued once for the sender, scope gmail.send)
 *   GOOGLE_WORKSPACE_SENDER      (the mailbox, e.g. divyansh@actioneer.com)
 *
 * No external SDK — pure fetch + Node Buffer.
 */

function env(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

export function isWorkspaceEmailConfigured(): boolean {
  return Boolean(
    env("GOOGLE_OAUTH_CLIENT_ID") &&
      env("GOOGLE_OAUTH_CLIENT_SECRET") &&
      env("GOOGLE_OAUTH_REFRESH_TOKEN") &&
      env("GOOGLE_WORKSPACE_SENDER"),
  );
}

export interface SendWorkspaceEmailResult {
  provider: "google-workspace";
  messageId: string | null;
  recipients: string[];
}

async function getAccessToken(): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env("GOOGLE_OAUTH_CLIENT_ID")!,
      client_secret: env("GOOGLE_OAUTH_CLIENT_SECRET")!,
      refresh_token: env("GOOGLE_OAUTH_REFRESH_TOKEN")!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Google token exchange failed: HTTP ${res.status}${body ? ` ${body.slice(0, 300)}` : ""}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("Google token exchange returned no access_token");
  return data.access_token;
}

/** MIME encoded-word for a header value that may contain non-ASCII characters. */
function encodeHeaderWord(value: string): string {
  const isAscii = [...value].every((c) => c.codePointAt(0)! <= 0x7f);
  if (isAscii) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf-8").toString("base64")}?=`;
}

function normalize(list: string[] | undefined, exclude: Set<string>): string[] {
  return Array.from(
    new Set(
      (list ?? [])
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.includes("@") && !exclude.has(e)),
    ),
  );
}

function buildMime(input: SendTwilioEmailInput, sender: string): { raw: string; recipients: string[] } {
  const to = normalize(input.to, new Set());
  if (to.length === 0) throw new Error("No email recipients configured");
  const cc = normalize(input.cc, new Set(to));
  const bcc = normalize(input.bcc, new Set([...to, ...cc]));

  const fromName = input.fromName?.trim() || "Actioneer";
  const boundary = `actioneer_${crypto.randomUUID().replace(/-/g, "")}`;

  const headers = [
    `From: ${encodeHeaderWord(fromName)} <${sender}>`,
    `To: ${to.join(", ")}`,
    cc.length ? `Cc: ${cc.join(", ")}` : null,
    bcc.length ? `Bcc: ${bcc.join(", ")}` : null,
    `Subject: ${encodeHeaderWord(input.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].filter(Boolean) as string[];

  const b64 = (s: string) => Buffer.from(s, "utf-8").toString("base64").replace(/(.{76})/g, "$1\r\n");

  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64(input.text ?? input.subject),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64(input.html),
    `--${boundary}--`,
    "",
  ];

  const mime = `${headers.join("\r\n")}\r\n\r\n${parts.join("\r\n")}`;
  const raw = Buffer.from(mime, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return { raw, recipients: [...to, ...cc, ...bcc] };
}

export async function sendWorkspaceEmail(input: SendTwilioEmailInput): Promise<SendWorkspaceEmailResult> {
  const sender = env("GOOGLE_WORKSPACE_SENDER");
  if (!sender) throw new Error("GOOGLE_WORKSPACE_SENDER is not set");

  const token = await getAccessToken();
  const { raw, recipients } = buildMime(input, sender);

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gmail send failed: HTTP ${res.status}${body ? ` ${body.slice(0, 400)}` : ""}`);
  }
  const data = (await res.json()) as { id?: string };
  return { provider: "google-workspace", messageId: data.id ?? null, recipients };
}
