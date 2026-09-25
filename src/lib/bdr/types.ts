import { getBdrTemplate, type BdrTemplateId } from "./templates";

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
  answeredBy?: string;
  callOutcome?: "conversation" | "screening" | "voicemail";
  followUpRequested?: boolean;
  sentiment?: { label: "positive" | "negative"; reason: string };
  sentimentState?: "pending" | "complete" | "not_applicable" | "failed";
  sentimentFingerprint?: string;
  sentimentAttempts?: number;
  sentimentUpdatedAt?: string;
  transcript?: Array<{ role: "user" | "assistant"; text: string; delivery?: "played" | "interrupted"; source?: "screening" | "voicemail" }>;
}
export interface BdrCampaign {
  id: string;
  userId: string;
  name: string;
  audienceId: string;
  audienceName: string;
  script: string;
  opening: string;
  templateId?: BdrTemplateId;
  voicemail?: string;
  voiceId: string;
  language: "English" | "Hindi" | "Hinglish";
  status: BdrStatus;
  recipients: BdrRecipient[];
  createdAt: string;
  updatedAt: string;
  error?: string;
}
export const DEFAULT_BDR_SCRIPT = getBdrTemplate().script;
export const DEFAULT_BDR_OPENING = getBdrTemplate().opening;
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
