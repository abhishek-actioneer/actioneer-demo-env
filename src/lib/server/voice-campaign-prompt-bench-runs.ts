import type {
  PromptBenchRun,
  PromptBenchRunPayload,
} from "@/lib/voice-campaign-prompt-bench-types";

const MAX_RUNS_PER_USER = 20;

const runsByUser = new Map<string, Map<string, PromptBenchRun>>();

function userRuns(userId: string): Map<string, PromptBenchRun> {
  let runs = runsByUser.get(userId);
  if (!runs) {
    runs = new Map<string, PromptBenchRun>();
    runsByUser.set(userId, runs);
  }
  return runs;
}

export function savePromptBenchRun(userId: string, payload: PromptBenchRunPayload): PromptBenchRun {
  const runs = userRuns(userId);
  const run: PromptBenchRun = {
    ...payload,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  runs.set(run.id, run);

  const overflow = runs.size - MAX_RUNS_PER_USER;
  if (overflow > 0) {
    const oldest = [...runs.values()]
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .slice(0, overflow);
    for (const item of oldest) runs.delete(item.id);
  }

  return run;
}

export function getPromptBenchRun(userId: string, runId: string): PromptBenchRun | null {
  return userRuns(userId).get(runId) ?? null;
}
