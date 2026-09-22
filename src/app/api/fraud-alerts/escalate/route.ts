import { auth } from "@clerk/nextjs/server";
import { withConnection } from "@/lib/db";
import { ensureVoiceVerificationCallsSchema } from "@/lib/voice-verification-schema";

export const dynamic = "force-dynamic";

/**
 * Flags a verification call for human review. Sets `escalation_status` to
 * `pending_review` on the call's `voice_verification_calls` row (creating a
 * minimal row if forensics hasn't written one yet) so the escalation survives
 * reloads and shows up on every future read of the call.
 */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as
    | { callId?: unknown; datasetId?: unknown; reason?: unknown }
    | null;
  const callId = typeof body?.callId === "string" ? body.callId.trim() : "";
  const datasetId = typeof body?.datasetId === "string" ? body.datasetId.trim() : "";
  const reason = typeof body?.reason === "string" ? body.reason.slice(0, 500) : null;
  if (!callId || !datasetId) {
    return Response.json({ error: "callId and datasetId required" }, { status: 400 });
  }

  const escalatedAt = new Date().toISOString();
  const esc = (value: string) => value.replace(/'/g, "''");

  try {
    await withConnection(datasetId, async (conn) => {
      await ensureVoiceVerificationCallsSchema(conn);
      await conn.run(`
        INSERT INTO voice_verification_calls (call_id, dataset_id)
        VALUES ('${esc(callId)}', '${esc(datasetId)}')
        ON CONFLICT (call_id) DO UPDATE SET
          dataset_id = COALESCE(voice_verification_calls.dataset_id, EXCLUDED.dataset_id)
      `);
      await conn.run(`
        UPDATE voice_verification_calls
        SET escalation_status = 'pending_review',
            escalated_at = '${escalatedAt}',
            escalation_reason = ${reason ? `'${esc(reason)}'` : "NULL"}
        WHERE call_id = '${esc(callId)}'
      `);
    });
    return Response.json({ ok: true, escalation_status: "pending_review", escalated_at: escalatedAt });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Escalation failed";
    return Response.json({ error: msg }, { status: 500 });
  }
}
