// NDJSON replay-then-tail stream over the run's journey event log — same
// framing as /api/analyze. Simulated (pre-written) and future real webhook
// events flow through this one pipe; the client demo clock decides visibility.

import { existsSync, readFileSync } from "fs";
import { auth } from "@clerk/nextjs/server";
import { safeVoiceInsightRunId } from "@/lib/voice-campaign-insights-loader";
import { journeyEventsPath } from "@/lib/voice-campaign-journey-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POLL_MS = 2000;
const KEEPALIVE_MS = 15000;

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const runId = safeVoiceInsightRunId(params.get("runId") ?? params.get("run"));
  if (!runId) return Response.json({ error: "Invalid runId" }, { status: 400 });

  const path = journeyEventsPath(runId);
  const encoder = new TextEncoder();
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const cleanup = () => {
    closed = true;
    if (pollTimer) clearInterval(pollTimer);
    if (pingTimer) clearInterval(pingTimer);
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Byte offset into the append-only log; partial trailing lines are
      // carried in `remainder` until the next append completes them.
      let offset = 0;
      let remainder = "";

      const send = (payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(payload) + "\n"));
        } catch {
          cleanup();
        }
      };

      const drain = () => {
        if (closed || !existsSync(path)) return;
        const buffer = readFileSync(path);
        // Shrunk file ⇒ journey was reset and re-dispatched; start over.
        if (buffer.length < offset) {
          offset = 0;
          remainder = "";
        }
        if (buffer.length <= offset) return;
        const chunk = remainder + buffer.subarray(offset).toString("utf8");
        offset = buffer.length;
        const lines = chunk.split("\n");
        remainder = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            send({ type: "journey", event: JSON.parse(trimmed) });
          } catch {
            // Torn line — skip, never fatal.
          }
        }
      };

      drain();
      send({ type: "caught_up" });
      pollTimer = setInterval(drain, POLL_MS);
      pingTimer = setInterval(() => send({ type: "ping" }), KEEPALIVE_MS);
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
