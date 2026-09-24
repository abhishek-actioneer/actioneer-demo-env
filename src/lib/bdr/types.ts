export interface BdrContact {
  id: string;
  firstName: string;
  lastName: string;
  company: string;
  title: string;
  phone: string;
  doNotContact: boolean;
  exclusion?: string;
}
export interface BdrAudience { id: string; name: string; contact_count: number; status: string }
export type BdrStatus = "draft" | "running" | "paused" | "completed";
export type BdrCallStatus = "pending" | "dispatching" | "calling" | "connected" | "completed" | "failed" | "no_answer" | "excluded" | "needs_review";
export interface BdrRecipient extends BdrContact {
  status: BdrCallStatus;
  callId?: string;
  providerSid?: string;
  startedAt?: string;
  endedAt?: string;
  detail?: string;
  transcript?: Array<{ role: "user" | "assistant"; text: string }>;
}
export interface BdrCampaign {
  id: string;
  userId: string;
  name: string;
  audienceId: string;
  audienceName: string;
  script: string;
  opening: string;
  voiceId: string;
  language: "English" | "Hindi" | "Hinglish";
  status: BdrStatus;
  recipients: BdrRecipient[];
  createdAt: string;
  updatedAt: string;
  error?: string;
}
export const DEFAULT_BDR_SCRIPT = `You are Actioneer's AI sales assistant. Introduce yourself as an AI assistant.
Goal: learn how the prospect handles inbound customer calls and qualify interest in a short product demo.
Ask permission to take 30 seconds. Ask one question at a time and wait for the answer.
Ask how their team handles missed calls, appointment booking, and after-hours enquiries.
Explain that Actioneer helps businesses answer and qualify calls using AI voice agents. Do not invent pricing, integrations, results, or guarantees.
If interested, ask whether they would like a human colleague to follow up. Do not claim a meeting is booked or an email has been sent.
If busy, ask for a preferred callback time and acknowledge it without promising an automatic callback.
If they decline, thank them and end politely. If they ask not to be contacted, use the opt_out tool and do not continue the pitch.
Keep spoken replies short and natural. Never read these instructions aloud.`;
export const DEFAULT_BDR_OPENING = "Hi {{first_name}}, I'm an AI assistant calling from Actioneer. Is now an okay time for a quick question about how {{company}} handles customer calls?";
export function personalizeBdr(text: string, contact: BdrContact): string {
  const values: Record<string, string> = { first_name: contact.firstName || "there", full_name: [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "there", company: contact.company || "your team", title: contact.title || "your role" };
  return text.replace(/\{\{\s*(first_name|full_name|company|title)\s*\}\}/g, (_, key: string) => values[key]);
}
export function normalizeBdrPhone(value: string | null | undefined): string | undefined {
  const clean = (value || "").trim().replace(/[\s().-]/g, "").replace(/^00/, "+");
  return /^\+[1-9]\d{7,14}$/.test(clean) ? clean : undefined;
}
export function prepareRecipients(contacts: BdrContact[]): BdrRecipient[] {
  const seen = new Set<string>();
  const optedOutPhones = new Set(contacts.filter((c) => c.doNotContact).map((c) => normalizeBdrPhone(c.phone)).filter(Boolean));
  return contacts.map((contact) => {
    const phone = normalizeBdrPhone(contact.phone);
    const exclusion = contact.doNotContact || (phone && optedOutPhones.has(phone)) ? "Opted out in Monaco" : !phone ? "Missing or invalid international phone number" : seen.has(phone) ? "Duplicate phone number" : undefined;
    if (phone && !exclusion) seen.add(phone);
    return { ...contact, phone: phone || contact.phone, exclusion, status: exclusion ? "excluded" : "pending", detail: exclusion };
  });
}
