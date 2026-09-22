import { PostHog } from "posthog-node";
import { auth } from "@clerk/nextjs/server";

let _client: PostHog | null = null;

export function getPostHog(): PostHog | null {
  if (!process.env.POSTHOG_API_KEY) return null;
  if (!_client) {
    _client = new PostHog(process.env.POSTHOG_API_KEY, {
      host: process.env.POSTHOG_HOST || "https://us.i.posthog.com",
      flushAt: 1,
      flushInterval: 0,
    });
  }
  return _client;
}

async function getDistinctId(explicit?: string): Promise<string> {
  if (explicit) return explicit;
  try {
    const { userId } = await auth();
    return userId ?? "anonymous";
  } catch {
    return "anonymous";
  }
}

export interface LLMGenerationEvent {
  provider: string;
  model: string;
  feature: string;
  input: string;
  output: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  isError?: boolean;
  error?: string;
  traceId?: string;
  datasetId?: string;
  distinctId?: string;
  extra?: Record<string, unknown>;
}

export async function captureLLMGeneration(ev: LLMGenerationEvent): Promise<void> {
  const ph = getPostHog();
  if (!ph) return;
  const distinctId = await getDistinctId(ev.distinctId);
  ph.capture({
    distinctId,
    event: "$ai_generation",
    properties: {
      $ai_provider: ev.provider,
      $ai_model: ev.model,
      $ai_input: ev.input.slice(0, 50_000),
      $ai_output: ev.output.slice(0, 50_000),
      $ai_input_tokens: ev.inputTokens,
      $ai_output_tokens: ev.outputTokens,
      $ai_latency: ev.latencyMs / 1000,
      $ai_is_error: ev.isError ?? false,
      $ai_error: ev.error,
      $ai_trace_id: ev.traceId,
      feature: ev.feature,
      dataset_id: ev.datasetId,
      ...ev.extra,
    },
  });
  await ph.flush();
}

export async function captureEvent(
  event: string,
  properties: Record<string, unknown> = {},
  distinctIdOverride?: string,
): Promise<void> {
  const ph = getPostHog();
  if (!ph) return;
  const distinctId = await getDistinctId(distinctIdOverride);
  ph.capture({ distinctId, event, properties });
  await ph.flush();
}
