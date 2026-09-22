import twilio from "twilio";
import { getEffectiveSmsCredentials } from "@/lib/tenant-connections-store";

function requireValue(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function smsCredentials(userId?: string) {
  const credentials = getEffectiveSmsCredentials(userId);
  return {
    accountSid: requireValue("TWILIO_ACCOUNT_SID", credentials.accountSid),
    authToken: requireValue("TWILIO_AUTH_TOKEN", credentials.authToken),
    from: requireValue("TWILIO_SMS_FROM or TWILIO_PHONE_NUMBER", credentials.from),
  };
}

function client(userId?: string) {
  const credentials = smsCredentials(userId);
  return twilio(credentials.accountSid, credentials.authToken);
}

export function ensureTwilioSmsConfig(userId?: string): void {
  smsCredentials(userId);
}

export interface SendSmsResult {
  sid: string;
  status: string;
  from: string;
  to: string;
}

export async function sendSms(
  to: string,
  body: string,
  options: { userId?: string } = {},
): Promise<SendSmsResult> {
  const credentials = smsCredentials(options.userId);
  const message = await client(options.userId).messages.create({
    from: credentials.from,
    to,
    body,
  });

  return {
    sid: message.sid,
    status: message.status,
    from: credentials.from,
    to,
  };
}
