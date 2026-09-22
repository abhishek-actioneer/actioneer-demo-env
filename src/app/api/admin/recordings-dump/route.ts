import { requireAdminApi } from "@/lib/server/require-admin";
import { readFileSync, existsSync, readdirSync, createReadStream, statSync } from "fs";
import { join, extname } from "path";
import { getVoiceStorageRoot } from "@/lib/voice-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CallRecord = {
  id?: string;
  toNumber?: string;
  status?: string;
  bridgeRecording?: { sid?: string; storageKey?: string };
  recording?: { sid?: string; storageKey?: string };
};

type CampaignRecord = { name?: string; calls?: CallRecord[] };

function loadData(root: string): Record<string, CampaignRecord> {
  const vcPath = join(root, "voice-campaigns.json");
  if (!existsSync(vcPath)) return {};
  return JSON.parse(readFileSync(vcPath, "utf8")) as Record<string, CampaignRecord>;
}

export async function GET(req: Request) {
  const admin = await requireAdminApi();
  if (admin instanceof Response) return admin;

  const root = getVoiceStorageRoot();
  const url = new URL(req.url);

  // ?serve=<callId> — stream the recording file directly
  const serveCallId = url.searchParams.get("serve");
  if (serveCallId) {
    const recDir = join(root, "voice-recordings", serveCallId);
    if (!existsSync(recDir)) return Response.json({ error: "Recording dir not found" }, { status: 404 });
    const files = readdirSync(recDir);
    const file = files.find(f => f.endsWith(".wav") || f.endsWith(".mp3"));
    if (!file) return Response.json({ error: "No audio file found" }, { status: 404 });
    const filePath = join(recDir, file);
    const stat = statSync(filePath);
    const ext = extname(file).slice(1);
    const mime = ext === "mp3" ? "audio/mpeg" : "audio/wav";
    const stream = createReadStream(filePath);
    // @ts-expect-error Node stream as web ReadableStream
    return new Response(stream, {
      headers: {
        "Content-Type": mime,
        "Content-Length": String(stat.size),
        "Content-Disposition": `attachment; filename="${serveCallId}.${ext}"`,
      },
    });
  }

  // Default: list all recordings grouped by phone
  const data = loadData(root);
  if (!Object.keys(data).length) return Response.json({ error: "voice-campaigns.json not found", root }, { status: 404 });

  const results: Array<{ phone: string; callId: string; campaign: string; status: string; recSid: string; files: string[] }> = [];
  for (const campaign of Object.values(data)) {
    for (const call of campaign.calls ?? []) {
      const rec = call.bridgeRecording ?? call.recording;
      if (!rec?.sid) continue;
      const recDir = join(root, "voice-recordings", call.id ?? "");
      const files = existsSync(recDir) ? readdirSync(recDir) : [];
      results.push({ phone: call.toNumber ?? "", callId: call.id ?? "", campaign: campaign.name ?? "", status: call.status ?? "", recSid: rec.sid, files });
    }
  }

  const byPhone: Record<string, typeof results> = {};
  for (const r of results) (byPhone[r.phone] ??= []).push(r);

  return Response.json({ total: results.length, byPhone, root });
}
