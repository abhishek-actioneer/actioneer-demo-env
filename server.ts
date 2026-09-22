import "next/dist/server/node-environment";
import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import { handleMediaStream } from "./src/lib/openai-realtime-bridge";
import { handlePlivoGeminiLiveMediaStream } from "./src/lib/plivo-gemini-live-bridge";
import { handlePlivoGeminiProbeStream } from "./src/lib/plivo-gemini-probe-bridge";
import { handleVoiceLiveTranscribeStream } from "./src/lib/voice-live-transcribe-bridge";
import { handleVoiceTestStream } from "./src/lib/voice-test-bridge";
import { startCallEventDispatcher } from "./src/lib/server/call-event-dispatcher";
import { startVoiceEvalDispatcher } from "./src/lib/server/voice-eval-dispatcher";
import { flushAllScheduledCallTranscriptJsonlPersists } from "./src/lib/voice-transcript-storage";
import { assertVoiceRuntimeConfigForStartup } from "./src/lib/voice-runtime-config";

const port = parseInt(process.env.PORT || "3000", 10);

/** Never run Next dev compiler on Railway — it OOMs on 512MB containers. */
function isProductionServer(): boolean {
  if (process.env.NODE_ENV === "production") return true;
  if (process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PUBLIC_DOMAIN) return true;
  if (process.env.VERCEL || process.env.RENDER) return true;
  return false;
}

const dev = !isProductionServer();
const app = next({ dev, port });
const handle = app.getRequestHandler();
const PLIVO_STREAM_PATHS = ["/plivo-media-stream", "/api/voice/plivo-ws"];
const UPGRADE_PATHS = new Set([
  "/media-stream",
  "/plivo-probe-stream",
  "/voice-live-transcribe",
  "/voice-test-stream",
]);

function isPlivoStreamPath(pathname: string | null | undefined): boolean {
  return PLIVO_STREAM_PATHS.some((path) => pathname === path || pathname?.startsWith(`${path}/`));
}

app.prepare().then(() => {
  assertVoiceRuntimeConfigForStartup();
  // Must be obtained after prepare() — Next throws otherwise.
  const upgradeHandler = app.getUpgradeHandler();
  startCallEventDispatcher();
  startVoiceEvalDispatcher();
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  const server = createServer((req, res) => {
    handle(req, res, parse(req.url!, true));
  });
  let shuttingDown = false;
  const gracefulShutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server] graceful shutdown started signal=${signal}`);

    const forceExitTimer = setTimeout(() => {
      console.error("[server] graceful shutdown timeout; forcing exit");
      process.exit(1);
    }, 15_000);

    try {
      await flushAllScheduledCallTranscriptJsonlPersists();
    } catch (error) {
      console.error("[server] failed flushing transcript.jsonl on shutdown", error);
    }

    server.close((error) => {
      clearTimeout(forceExitTimer);
      if (error) {
        console.error("[server] close error during shutdown", error);
        process.exit(1);
        return;
      }
      process.exit(0);
    });
  };
  process.once("SIGTERM", () => {
    void gracefulShutdown("SIGTERM");
  });
  process.once("SIGINT", () => {
    void gracefulShutdown("SIGINT");
  });
  // Long-lived NDJSON routes such as /api/analyze stream progress for several
  // minutes. Disable Node's request/socket timeout and leave timeout enforcement
  // to route-level LLM budgets and the hosting proxy.
  server.requestTimeout = 0;
  server.timeout = 0;
  server.keepAliveTimeout = 75_000;
  server.headersTimeout = 80_000;

  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    console.log(`[server] Raw WebSocket upgrade attempt ${req.url}`);
    const { pathname } = parse(req.url || "/");
    if (UPGRADE_PATHS.has(pathname || "") || isPlivoStreamPath(pathname)) {
      console.log(
        `[server] WebSocket upgrade ${req.url} extensions=${req.headers["sec-websocket-extensions"] ?? "(none)"}`,
      );
      wss.handleUpgrade(req, socket as never, head, (ws) => {
        wss.emit("connection", ws, req);
      });
      return;
    }
    // All other upgrades (notably Next.js HMR / Fast Refresh at
    // /_next/webpack-hmr) must be forwarded to Next's own upgrade handler.
    // With a custom server Next does NOT receive the `upgrade` event on its
    // own, so without this the HMR websocket never connects and browser edits
    // don't hot-reload.
    void upgradeHandler(req, socket, head);
  });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    console.log(`[server] WebSocket connected extensions=${ws.extensions || "(none)"}`);
    const { pathname } = parse(req.url || "/");
    if (pathname === "/plivo-probe-stream") {
      handlePlivoGeminiProbeStream(ws, req);
      return;
    }
    if (pathname === "/voice-test-stream") {
      handleVoiceTestStream(ws, req);
      return;
    }
    if (pathname === "/voice-live-transcribe") {
      handleVoiceLiveTranscribeStream(ws, req);
      return;
    }
    if (isPlivoStreamPath(pathname)) {
      handlePlivoGeminiLiveMediaStream(ws, req);
      return;
    }
    handleMediaStream(ws, req);
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(
      `> Ready on http://localhost:${port} (${dev ? "dev" : "prod"}) NODE_ENV=${process.env.NODE_ENV ?? "(unset)"}`,
    );
  });
}).catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
