/**
 * Thin wrapper for Parallel's Task API (Deep Research mode).
 *
 * Account is paid (credits, not free tier). No quota gating in code.
 *
 * Docs: https://docs.parallel.ai/task-api/task-deep-research
 */

const PARALLEL_BASE = "https://api.parallel.ai";
const SSE_BETA_HEADER = "events-sse-2025-07-24";

export class ParallelError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "ParallelError";
  }
}

interface CreateTaskOptions {
  input: string;
  processor?: "lite" | "base" | "core" | "pro" | "pro-fast" | "ultra" | "ultra-fast";
  signal?: AbortSignal;
}

export interface ParallelTask {
  runId: string;
}

function apiKey(): string {
  const k = process.env.PARALLEL_API_KEY;
  if (!k) throw new ParallelError("PARALLEL_API_KEY not set");
  return k;
}

/** Extract a usable error message from an unknown JSON error body. */
function extractErrorMessage(body: unknown, fallback: string): string {
  if (typeof body !== "object" || body === null) return fallback;
  const b = body as Record<string, unknown>;
  if (typeof b.error === "string") return b.error;
  if (typeof b.detail === "string") return b.detail;
  if (typeof b.message === "string") return b.message;
  if (typeof b.error === "object" && b.error !== null) {
    const e = b.error as Record<string, unknown>;
    if (typeof e.message === "string") return e.message;
  }
  return fallback;
}

export async function createTask(opts: CreateTaskOptions): Promise<ParallelTask> {
  const res = await fetch(`${PARALLEL_BASE}/v1/tasks/runs`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: opts.input,
      processor: opts.processor ?? "pro-fast",
      enable_events: true,
      task_spec: { output_schema: { type: "text" } },
    }),
    signal: opts.signal,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ParallelError(extractErrorMessage(body, `Parallel ${res.status}`), res.status);
  }
  const data = await res.json().catch(() => {
    throw new ParallelError("Parallel returned an invalid JSON response from createTask");
  });
  return { runId: data.run_id };
}

export interface ParallelEvent {
  type: string;
  [key: string]: unknown;
}

export async function* streamTaskEvents(runId: string, signal?: AbortSignal): AsyncGenerator<ParallelEvent> {
  const res = await fetch(`${PARALLEL_BASE}/v1beta/tasks/runs/${runId}/events`, {
    method: "GET",
    headers: {
      "x-api-key": apiKey(),
      "parallel-beta": SSE_BETA_HEADER,
      Accept: "text/event-stream",
    },
    signal,
  });
  if (!res.ok || !res.body) {
    throw new ParallelError(`Parallel SSE ${res.status}`, res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (err) {
        if (signal?.aborted || (err instanceof Error && err.name === "AbortError")) return;
        throw err;
      }
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });

      // SSE frames are separated by blank lines; each frame may have multiple `data:` lines
      let frameEnd: number;
      while ((frameEnd = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, frameEnd);
        buffer = buffer.slice(frameEnd + 2);

        const dataLines = frame
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim());
        if (dataLines.length === 0) continue;

        const payload = dataLines.join("\n");
        try {
          yield JSON.parse(payload) as ParallelEvent;
        } catch {
          // Skip malformed frames; Parallel sometimes sends `:` keepalive lines we already filtered
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export interface ParallelResult {
  markdown: string;
  basis: unknown[];
}

export async function fetchTaskResult(runId: string, signal?: AbortSignal): Promise<ParallelResult> {
  const res = await fetch(`${PARALLEL_BASE}/v1/tasks/runs/${runId}/result`, {
    method: "GET",
    headers: { "x-api-key": apiKey() },
    signal,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ParallelError(extractErrorMessage(body, `Parallel result ${res.status}`), res.status);
  }
  const data = await res.json().catch(() => {
    throw new ParallelError("Parallel returned an invalid JSON response from fetchTaskResult");
  });
  // Result endpoint shape: { run: {...}, output: { type, content, basis, reasoning, confidence } }
  const output = data?.output ?? {};
  return {
    markdown: typeof output.content === "string" ? output.content : "",
    basis: Array.isArray(output.basis) ? output.basis : [],
  };
}

// ── Search API (synchronous, sub-5s) ──

export interface SearchResult {
  url: string;
  title: string;
  publishDate?: string;
  excerpts: string[];
}

export async function searchWeb(
  objective: string,
  queries: string[],
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  const res = await fetch(`${PARALLEL_BASE}/v1/search`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      objective,
      search_queries: queries,
    }),
    signal,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ParallelError(extractErrorMessage(body, `Parallel search ${res.status}`), res.status);
  }
  const data = await res.json().catch(() => {
    throw new ParallelError("Parallel returned an invalid JSON response from search");
  });
  const results: unknown[] = Array.isArray(data?.results) ? data.results : [];
  return results
    .filter((r): r is { url: string; title?: unknown; publish_date?: unknown; excerpts?: unknown } =>
      typeof r === "object" && r !== null && typeof (r as { url?: unknown }).url === "string",
    )
    .map((r) => ({
      url: r.url,
      title: typeof r.title === "string" ? r.title : r.url,
      publishDate: typeof r.publish_date === "string" ? r.publish_date : undefined,
      excerpts: Array.isArray(r.excerpts) ? (r.excerpts as unknown[]).filter((e): e is string => typeof e === "string") : [],
    }));
}

// ── Extract API (synchronous, returns full markdown of pages/PDFs) ──

export interface ExtractResult {
  url: string;
  title: string;
  excerpts: string[];
  fullContent: string;
}

export interface ExtractError {
  url: string;
  errorType: string;
  httpStatusCode?: number;
  content: string;
}

export async function extractUrls(
  urls: string[],
  objective: string,
  signal?: AbortSignal,
): Promise<{ results: ExtractResult[]; errors: ExtractError[] }> {
  const res = await fetch(`${PARALLEL_BASE}/v1/extract`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      urls,
      objective,
    }),
    signal,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ParallelError(extractErrorMessage(body, `Parallel extract ${res.status}`), res.status);
  }
  const data = await res.json().catch(() => {
    throw new ParallelError("Parallel returned an invalid JSON response from extract");
  });
  const rawResults: unknown[] = Array.isArray(data?.results) ? data.results : [];
  const rawErrors: unknown[] = Array.isArray(data?.errors) ? data.errors : [];

  const results: ExtractResult[] = rawResults
    .filter((r): r is { url: string; title?: unknown; excerpts?: unknown; full_content?: unknown } =>
      typeof r === "object" && r !== null && typeof (r as { url?: unknown }).url === "string",
    )
    .map((r) => {
      const excerpts = Array.isArray(r.excerpts) ? (r.excerpts as unknown[]).filter((e): e is string => typeof e === "string") : [];
      // Parallel returns full_content for HTML pages but null for PDFs — fall back to joining excerpts
      const fullContent = typeof r.full_content === "string" && r.full_content.length > 0
        ? r.full_content
        : excerpts.join("\n\n");
      return {
        url: r.url,
        title: typeof r.title === "string" && r.title.length > 0 ? r.title : r.url,
        excerpts,
        fullContent,
      };
    });

  const errors: ExtractError[] = rawErrors
    .filter((e): e is { url: string; error_type?: unknown; http_status_code?: unknown; content?: unknown } =>
      typeof e === "object" && e !== null && typeof (e as { url?: unknown }).url === "string",
    )
    .map((e) => ({
      url: e.url,
      errorType: typeof e.error_type === "string" ? e.error_type : "unknown",
      httpStatusCode: typeof e.http_status_code === "number" ? e.http_status_code : undefined,
      content: typeof e.content === "string" ? e.content : "",
    }));

  return { results, errors };
}

/** Best-effort cancellation. 404 (already finished) is silently OK. */
export async function cancelTask(runId: string): Promise<void> {
  const res = await fetch(`${PARALLEL_BASE}/v1/tasks/runs/${runId}/cancel`, {
    method: "POST",
    headers: { "x-api-key": apiKey() },
  });
  if (!res.ok && res.status !== 404) {
    // Don't throw — caller is in cleanup path
    console.warn(`[parallel] cancelTask ${runId}: ${res.status}`);
  }
}
