import twilio from "twilio";
import { createHmac, timingSafeEqual } from "node:crypto";
import { requirePublicBaseUrl } from "@/lib/public-base-url";
import { updateBdrCall } from "./store";
import type { BdrCallStatus } from "./types";

export function bdrTwilio() {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) throw new Error("Twilio credentials are not configured.");
  return twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN, { autoRetry: false, timeout: 20_000 });
}
export function bdrStreamToken(callId: string): string {
  if (!process.env.TWILIO_AUTH_TOKEN) throw new Error("Twilio is not configured.");
  return createHmac("sha256", process.env.TWILIO_AUTH_TOKEN).update(`bdr-stream:${callId}`).digest("hex");
}
export function validBdrStreamToken(callId: string, token: string): boolean {
  if (typeof callId !== "string" || typeof token !== "string") return false;
  const expected = Buffer.from(bdrStreamToken(callId));
  const actual = Buffer.from(token);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export async function dialBdrContact(phone: string, callId: string): Promise<string> {
  const base = requirePublicBaseUrl();
  const call = await bdrTwilio().calls.create({
    to: phone, from: process.env.TWILIO_PHONE_NUMBER!,
    url: `${base}/api/bdr/twilio/answer?callId=${encodeURIComponent(callId)}`, method: "POST",
    statusCallback: `${base}/api/bdr/twilio/status?callId=${encodeURIComponent(callId)}`,
    statusCallbackMethod: "POST", statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    machineDetection: "DetectMessageEnd", asyncAmd: "true", machineDetectionTimeout: 45,
    asyncAmdStatusCallback: `${base}/api/bdr/twilio/amd?callId=${encodeURIComponent(callId)}`,
    asyncAmdStatusCallbackMethod: "POST",
    timeout: 30, timeLimit: 300,
  });
  return call.sid;
}
export function describeBdrDialError(error: unknown): { rejected: boolean; detail: string; status?: number; code?: number } {
  const cause = error && typeof error === "object" ? error as { status?: unknown; code?: unknown; message?: unknown } : undefined;
  const status = typeof cause?.status === "number" ? cause.status : undefined;
  const code = typeof cause?.code === "number" ? cause.code : undefined;
  if (status !== undefined && status >= 400 && status < 500) {
    const reason = typeof cause?.message === "string" ? cause.message.replace(/\s+/g, " ").trim().slice(0, 240) : "Check the Twilio Debugger for details.";
    return { rejected: true, status, code, detail: `Twilio rejected the call (HTTP ${status}${code === undefined ? "" : `, code ${code}`}): ${reason}` };
  }
  return { rejected: false, status, code, detail: "Twilio dispatch returned an uncertain result. Check the Twilio call log before trying this contact again." };
}
export const TERMINAL_BDR_STATUSES = new Set<BdrCallStatus>(["completed", "failed", "no_answer", "excluded"]);
export function applyBdrCallStatus(callId: string, sid: string, rawStatus: string): void {
  const mapped: Record<string, BdrCallStatus> = { queued: "calling", initiated: "calling", ringing: "calling", "in-progress": "connected", completed: "completed", busy: "no_answer", "no-answer": "no_answer", canceled: "failed", failed: "failed" };
  const status = mapped[rawStatus];
  if (!status) return;
  updateBdrCall(callId, (recipient) => {
    if (recipient.providerSid && recipient.providerSid !== sid) return;
    recipient.providerSid = sid;
    if (TERMINAL_BDR_STATUSES.has(recipient.status)) return;
    if (recipient.status === "connected" && status === "calling") return;
    recipient.status = status;
    if (TERMINAL_BDR_STATUSES.has(status)) recipient.endedAt = new Date().toISOString();
  });
}
