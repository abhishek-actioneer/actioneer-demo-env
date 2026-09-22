/**
 * Next.js instrumentation hook — runs once when the server starts.
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 *
 * We use this to register the in-process synthetic scheduler. The scheduler
 * itself gates on SYNTHETIC_ENABLED + SYNTHETIC_LEADER env vars, so this is
 * safe to call unconditionally.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startSyntheticScheduler } = await import("./lib/synthetic/scheduler");
    startSyntheticScheduler();
  }
}
