export interface SendTwilioEmailInput {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  html: string;
  text?: string;
  categories?: string[];
  customArgs?: Record<string, string>;
  /** Per-send From display name override (defaults to SENDGRID_FROM_NAME / "Actioneer"). */
  fromName?: string;
}

export interface SendTwilioEmailResult {
  provider: "twilio-sendgrid";
  messageId: string | null;
  status: number;
  recipients: string[];
}

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function requireEnv(name: string, fallbackName?: string): string {
  const value = env(name) ?? (fallbackName ? env(fallbackName) : undefined);
  if (!value) {
    throw new Error(`${name}${fallbackName ? ` or ${fallbackName}` : ""} is not set`);
  }
  return value;
}

function apiKey(): string {
  return requireEnv("SENDGRID_API_KEY", "TWILIO_SENDGRID_API_KEY");
}

function fromEmail(): string {
  return requireEnv("SENDGRID_FROM_EMAIL", "TWILIO_SENDGRID_FROM_EMAIL");
}

function fromName(): string {
  return env("SENDGRID_FROM_NAME") ?? env("TWILIO_SENDGRID_FROM_NAME") ?? "Actioneer";
}

function replyTo(): string | undefined {
  return env("SENDGRID_REPLY_TO") ?? env("TWILIO_SENDGRID_REPLY_TO") ?? fromEmail();
}

export function ensureTwilioEmailConfig(): void {
  apiKey();
  fromEmail();
}

export async function sendTwilioEmail(input: SendTwilioEmailInput): Promise<SendTwilioEmailResult> {
  ensureTwilioEmailConfig();

  const normalize = (list: string[] | undefined, exclude: Set<string>): string[] =>
    Array.from(
      new Set(
        (list ?? [])
          .map((email) => email.trim().toLowerCase())
          .filter((email) => email.includes("@") && !exclude.has(email)),
      ),
    );

  const recipients = normalize(input.to, new Set());
  if (recipients.length === 0) throw new Error("No email recipients configured");

  // SendGrid rejects an address that appears in more than one field of the same
  // personalization, so cc excludes the to-list and bcc excludes both.
  const ccList = normalize(input.cc, new Set(recipients));
  const bccList = normalize(input.bcc, new Set([...recipients, ...ccList]));
  const hasCcOrBcc = ccList.length > 0 || bccList.length > 0;

  // With cc/bcc we send ONE personalization (a real "to + cc" email); without,
  // we keep the existing per-recipient fan-out (each sees only themselves).
  const personalizations = hasCcOrBcc
    ? [
        {
          to: recipients.map((email) => ({ email })),
          ...(ccList.length > 0 ? { cc: ccList.map((email) => ({ email })) } : {}),
          ...(bccList.length > 0 ? { bcc: bccList.map((email) => ({ email })) } : {}),
          custom_args: input.customArgs,
        },
      ]
    : recipients.map((email) => ({
        to: [{ email }],
        custom_args: input.customArgs,
      }));

  const payload = {
    personalizations,
    from: {
      email: fromEmail(),
      name: input.fromName?.trim() || fromName(),
    },
    reply_to: replyTo() ? { email: replyTo() } : undefined,
    subject: input.subject,
    content: [
      ...(input.text ? [{ type: "text/plain", value: input.text }] : []),
      { type: "text/html", value: input.html },
    ],
    categories: input.categories,
  };

  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (res.status !== 202) {
    const body = await res.text().catch(() => "");
    throw new Error(`SendGrid mail/send failed: HTTP ${res.status}${body ? ` ${body.slice(0, 500)}` : ""}`);
  }

  return {
    provider: "twilio-sendgrid",
    messageId: res.headers.get("x-message-id"),
    status: res.status,
    recipients,
  };
}
