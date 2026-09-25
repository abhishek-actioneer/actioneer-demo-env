import { bdrReadiness } from "./config";
import { claimBdrRecipient, getBdrCampaign, isBdrSuppressed, listBdrCampaigns, mutateBdrCampaign, updateBdrCall } from "./store";
import { getMonacoContact } from "./monaco";
import { applyBdrCallStatus, bdrTwilio, describeBdrDialError, dialBdrContact } from "./telephony";
import { normalizeBdrPhone } from "./types";
import { analyzeBdrSentimentsTick } from "./sentiment";

export async function dispatchBdrTick(): Promise<void> {
  if (!bdrReadiness().calling) return;
  // Reconcile callbacks missed during a restart; never blindly redial a claim.
  for (const campaign of listBdrCampaigns()) {
    for (const recipient of campaign.recipients) {
      if (!["dispatching", "calling", "connected"].includes(recipient.status)) continue;
      if (Date.now() - Date.parse(recipient.startedAt || "") < 420_000) continue;
      if (recipient.providerSid) {
        try {
          const live = await bdrTwilio().calls(recipient.providerSid).fetch();
          applyBdrCallStatus(recipient.callId!, live.sid, live.status);
          continue;
        } catch { /* Keep an uncertain call out of the queue. */ }
      }
      updateBdrCall(recipient.callId!, (row, current) => {
        row.status = "needs_review";
        row.detail = "Call outcome is uncertain. Check Twilio's call log; this contact will not be redialed automatically.";
        current.status = "paused";
        current.error = row.detail;
      });
    }
    if (campaign.status === "running") mutateBdrCampaign(campaign.id, undefined, (current) => {
      if (!current.recipients.some((r) => ["pending", "dispatching", "calling", "connected"].includes(r.status))) current.status = "completed";
    });
  }
  const claim = claimBdrRecipient(1);
  if (!claim) return;
  const { campaign, recipient } = claim;
  let attemptingDial = false;
  try {
    const fresh = await getMonacoContact(recipient.id);
    if (fresh.doNotContact || isBdrSuppressed(recipient.phone) || normalizeBdrPhone(fresh.phone) !== recipient.phone) {
      updateBdrCall(recipient.callId!, (row) => { row.status = "excluded"; row.detail = fresh.doNotContact ? "Opted out in Monaco" : "Contact phone or permission changed since import. Import a fresh segment."; });
      return;
    }
    if (getBdrCampaign(campaign.id)?.status !== "running") {
      updateBdrCall(recipient.callId!, (row) => { row.status = "pending"; row.callId = undefined; row.startedAt = undefined; });
      return;
    }
    attemptingDial = true;
    const sid = await dialBdrContact(recipient.phone, recipient.callId!);
    applyBdrCallStatus(recipient.callId!, sid, "initiated");
  } catch (error) {
    const failure = attemptingDial ? describeBdrDialError(error) : undefined;
    if (failure) console.error("[bdr] Twilio dispatch failed", {
      callId: recipient.callId,
      status: failure.status,
      code: failure.code,
      message: error instanceof Error ? error.message : "Unknown error",
    });
    updateBdrCall(recipient.callId!, (row, current) => {
      // A transport timeout can happen after Twilio accepted the call.
      if (row.status === "dispatching") row.status = attemptingDial ? (failure?.rejected ? "failed" : "needs_review") : "pending";
      row.detail = failure?.detail || "Could not recheck this contact in Monaco. Reconnect Monaco and resume.";
      current.status = "paused";
      current.error = row.detail;
    });
  }
}

export function startBdrDispatcher(): () => void {
  let busy = false;
  let analyzing = false;
  const analysisTimer = setInterval(() => {
    if (analyzing) return;
    analyzing = true;
    void analyzeBdrSentimentsTick().catch((error: unknown) => console.error("[bdr] sentiment job failed", error instanceof Error ? error.message : "Unknown error")).finally(() => { analyzing = false; });
  }, 5000);
  analysisTimer.unref();
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    void dispatchBdrTick().catch((error: unknown) => console.error("[bdr] dispatcher failed", error instanceof Error ? error.message : "Unknown error")).finally(() => { busy = false; });
  }, 3000);
  timer.unref();
  return () => { clearInterval(timer); clearInterval(analysisTimer); };
}
