import { processPendingVoiceEvalJobs } from "@/lib/server/voice-eval-runner";

const INTERVAL_MS = 8_000;
let started = false;
let running = false;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await processPendingVoiceEvalJobs();
  } finally {
    running = false;
  }
}

export function startVoiceEvalDispatcher(): void {
  if (started || process.env.NODE_ENV === "test") return;
  started = true;
  void tick();
  const timer = setInterval(() => void tick(), INTERVAL_MS);
  timer.unref?.();
}
