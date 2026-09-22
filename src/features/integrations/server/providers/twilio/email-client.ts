interface SendTwilioEmailInput {
  to: string[];
  subject: string;
  html: string;
  text?: string;
  categories?: string[];
  customArgs?: Record<string, string>;
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
  return env("SENDGRID_FROM_NAME") ?? env("TWILIO_SENDGRID_FROM_NAME") ?? "Actioneer Voice";
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

  const recipients = Array.from(
    new Set(input.to.map((email) => email.trim().toLowerCase()).filter((email) => email.includes("@"))),
  );
  if (recipients.length === 0) throw new Error("No email recipients configured");

  const payload = {
    personalizations: recipients.map((email) => ({
      to: [{ email }],
      custom_args: input.customArgs,
    })),
    from: {
      email: fromEmail(),
      name: fromName(),
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
