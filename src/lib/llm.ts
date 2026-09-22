import { getOpenAI } from "@/lib/openai-client";
import { captureLLMGeneration } from "@/lib/posthog-server";
import { DEFAULT_MODEL } from "@/lib/model-registry";
import type { ModelId } from "@/lib/model-registry";

export type { ModelId, LLMModel } from "@/lib/model-registry";
export { MODELS, DEFAULT_MODEL } from "@/lib/model-registry";

export type Message = {
  role: "system" | "user" | "assistant";
  content: string;
};

export interface GenerateOptions {
  messages: Message[];
  model?: ModelId;
  modelId?: ModelId;
  systemPrompt?: string;
  jsonMode?: boolean;
  jsonSchema?: { name: string; schema: object; strict?: boolean };
  timeoutMs?: number;
  label?: string;
  feature?: string;
  datasetId?: string;
  traceId?: string;
  metadata?: Record<string, string>;
  maxOutputTokens?: number;
}

export interface LegacyGenerateOptions extends Omit<GenerateOptions, "messages"> {
  systemPrompt?: string;
}

type GenerateInput = string | GenerateOptions;

export interface GenerateMediaPart {
  type: "text" | "image" | "file";
  text?: string;
  dataUrl?: string;
  fileData?: string;
  filename?: string;
  mimeType?: string;
}

export interface GenerateImageOptions {
  prompt: string;
  size?: "1024x1024" | "1536x1024" | "1024x1536" | "auto";
  timeoutMs?: number;
  label?: string;
  feature?: string;
  datasetId?: string;
  traceId?: string;
  metadata?: Record<string, string>;
}

type ResponseFormat =
  | { type: "json_object" }
  | { type: "json_schema"; name: string; schema: object; strict: boolean };

interface OpenAIResponse {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

const DEFAULT_TIMEOUT_MS = 60_000;
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const FALLBACK_MODEL = "gpt-5.4";

function normalizeOptions(input: GenerateInput, opts: LegacyGenerateOptions = {}): GenerateOptions {
  if (typeof input !== "string") return input;
  return {
    ...opts,
    messages: [
      ...(opts.systemPrompt ? [{ role: "system" as const, content: opts.systemPrompt }] : []),
      { role: "user" as const, content: input },
    ],
  };
}

function resolveModel(opts: GenerateOptions): string {
  const requested = (opts.model ?? opts.modelId) as string | undefined;
  if (requested && /^(gpt-|o\d|chatgpt-)/.test(requested)) {
    return requested;
  }
  return process.env.OPENAI_MODEL || DEFAULT_MODEL || FALLBACK_MODEL;
}

function buildFormat(opts: GenerateOptions): ResponseFormat | undefined {
  if (opts.jsonSchema) {
    return {
      type: "json_schema",
      name: opts.jsonSchema.name,
      schema: opts.jsonSchema.schema,
      strict: opts.jsonSchema.strict ?? true,
    };
  }
  if (opts.jsonMode) return { type: "json_object" };
  return undefined;
}

function buildInput(messages: Message[]) {
  return messages.map((message) => ({
    role: message.role,
    content: [{ type: "input_text", text: message.content }],
  }));
}

function buildMediaContent(parts: GenerateMediaPart[]) {
  return parts.map((part) => {
    if (part.type === "text") {
      return { type: "input_text", text: part.text ?? "" };
    }
    if (part.type === "image") {
      return { type: "input_image", image_url: part.dataUrl };
    }
    return {
      type: "input_file",
      filename: part.filename ?? "input.bin",
      file_data: part.fileData,
    };
  });
}

function stringifyInput(messages: Message[]): string {
  return messages.map((m) => `[${m.role}]\n${m.content}`).join("\n\n");
}

function extractOutputText(response: OpenAIResponse): string {
  if (typeof response.output_text === "string") return response.output_text;
  return (response.output ?? [])
    .flatMap((item) => item.content ?? [])
    .map((content) => content.text ?? "")
    .join("");
}

export function parseJsonResponse<T = unknown>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    // Try tolerant extraction below.
  }

  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim()) as T;
    } catch {
      // Try object/array extraction below.
    }
  }

  const trimmed = text.trim();
  const firstArray = trimmed.indexOf("[");
  const lastArray = trimmed.lastIndexOf("]");
  if (firstArray !== -1 && lastArray > firstArray) {
    try {
      return JSON.parse(trimmed.slice(firstArray, lastArray + 1)) as T;
    } catch {
      // Try object extraction below.
    }
  }

  const firstObject = trimmed.indexOf("{");
  const lastObject = trimmed.lastIndexOf("}");
  if (firstObject !== -1 && lastObject > firstObject) {
    try {
      return JSON.parse(trimmed.slice(firstObject, lastObject + 1)) as T;
    } catch {
      // Fall through to the final error.
    }
  }

  throw new Error("Could not parse JSON from OpenAI response");
}

function withTimeout<T>(
  promise: Promise<T>,
  ms = DEFAULT_TIMEOUT_MS,
  label = "OpenAI generateText",
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

async function postResponses(body: Record<string, unknown>, opts: GenerateOptions): Promise<Response> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required but missing from environment");

  const res = await withTimeout(
    fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    }),
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    opts.label ?? "OpenAI Responses API",
  );

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`OpenAI Responses API error ${res.status}: ${errorText}`);
  }

  return res;
}

function buildBody(opts: GenerateOptions, stream = false): Record<string, unknown> {
  const format = buildFormat(opts);
  return {
    model: resolveModel(opts),
    input: buildInput(opts.messages),
    ...(format ? { text: { format } } : {}),
    ...(opts.maxOutputTokens ? { max_output_tokens: opts.maxOutputTokens } : {}),
    ...(opts.metadata ? { metadata: opts.metadata } : {}),
    ...(stream ? { stream: true } : {}),
  };
}

export async function generateText(
  input: GenerateInput,
  legacyOpts: LegacyGenerateOptions = {},
): Promise<string> {
  const opts = normalizeOptions(input, legacyOpts);
  const model = resolveModel(opts);
  const feature = opts.feature ?? opts.label ?? "openai.generateText";
  const t0 = Date.now();
  const loggedInput = stringifyInput(opts.messages);

  try {
    const res = await postResponses(buildBody(opts), opts);
    const data = (await res.json()) as OpenAIResponse;
    const text = extractOutputText(data);

    void captureLLMGeneration({
      provider: "openai",
      model,
      feature,
      input: loggedInput,
      output: text,
      latencyMs: Date.now() - t0,
      inputTokens: data.usage?.input_tokens,
      outputTokens: data.usage?.output_tokens,
      datasetId: opts.datasetId,
      traceId: opts.traceId,
    });

    return text;
  } catch (err) {
    void captureLLMGeneration({
      provider: "openai",
      model,
      feature,
      input: loggedInput,
      output: "",
      latencyMs: Date.now() - t0,
      isError: true,
      error: err instanceof Error ? err.message : String(err),
      datasetId: opts.datasetId,
      traceId: opts.traceId,
    });
    throw err;
  }
}

export async function generateJson<T = unknown>(
  input: GenerateInput,
  legacyOpts: LegacyGenerateOptions = {},
): Promise<T> {
  const opts = normalizeOptions(input, { ...legacyOpts, jsonMode: legacyOpts.jsonMode ?? true });
  const text = await generateText(opts);
  return parseJsonResponse<T>(text);
}

export async function generateTextWithMedia(
  parts: GenerateMediaPart[],
  options: Omit<GenerateOptions, "messages"> = {},
): Promise<string> {
  const model = resolveModel({ ...options, messages: [] });
  const feature = options.feature ?? options.label ?? "openai.generateTextWithMedia";
  const t0 = Date.now();
  const loggedInput = parts
    .map((part) =>
      part.type === "text" ? part.text ?? "" : `[${part.type}:${part.filename ?? part.mimeType ?? "input"}]`
    )
    .join("\n\n");

  const format = buildFormat({ ...options, messages: [] });
  try {
    const res = await postResponses(
      {
        model,
        input: [{ role: "user", content: buildMediaContent(parts) }],
        ...(format ? { text: { format } } : {}),
        ...(options.maxOutputTokens ? { max_output_tokens: options.maxOutputTokens } : {}),
        ...(options.metadata ? { metadata: options.metadata } : {}),
      },
      { ...options, messages: [] },
    );
    const data = (await res.json()) as OpenAIResponse;
    const text = extractOutputText(data);

    void captureLLMGeneration({
      provider: "openai",
      model,
      feature,
      input: loggedInput,
      output: text,
      latencyMs: Date.now() - t0,
      inputTokens: data.usage?.input_tokens,
      outputTokens: data.usage?.output_tokens,
      datasetId: options.datasetId,
      traceId: options.traceId,
    });

    return text;
  } catch (err) {
    void captureLLMGeneration({
      provider: "openai",
      model,
      feature,
      input: loggedInput,
      output: "",
      latencyMs: Date.now() - t0,
      isError: true,
      error: err instanceof Error ? err.message : String(err),
      datasetId: options.datasetId,
      traceId: options.traceId,
    });
    throw err;
  }
}

export async function generateJsonWithMedia<T = unknown>(
  parts: GenerateMediaPart[],
  options: Omit<GenerateOptions, "messages"> = {},
): Promise<T> {
  const text = await generateTextWithMedia(parts, { ...options, jsonMode: options.jsonMode ?? true });
  return parseJsonResponse<T>(text);
}

export async function generateImage(
  options: GenerateImageOptions,
): Promise<{ base64: string; mimeType: string; model: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required but missing from environment");

  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
  const feature = options.feature ?? options.label ?? "openai.generateImage";
  const t0 = Date.now();

  try {
    const result = await withTimeout(
      getOpenAI().images.generate({
        model,
        prompt: options.prompt,
        size: options.size ?? "1536x1024",
        n: 1,
      }),
      options.timeoutMs ?? 120_000,
      options.label ?? "OpenAI Images API",
    );

    const base64 = result.data?.[0]?.b64_json;
    if (!base64) throw new Error("OpenAI returned no image data");

    void captureLLMGeneration({
      provider: "openai",
      model,
      feature,
      input: options.prompt,
      output: "[image]",
      latencyMs: Date.now() - t0,
      datasetId: options.datasetId,
      traceId: options.traceId,
      extra: { image: true, size: options.size ?? "1536x1024" },
    });

    return { base64, mimeType: "image/png", model };
  } catch (err) {
    void captureLLMGeneration({
      provider: "openai",
      model,
      feature,
      input: options.prompt,
      output: "",
      latencyMs: Date.now() - t0,
      isError: true,
      error: err instanceof Error ? err.message : String(err),
      datasetId: options.datasetId,
      traceId: options.traceId,
      extra: { image: true, size: options.size ?? "1536x1024" },
    });
    throw err;
  }
}

export interface ToolDefinition {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type ResponsesInputItem =
  | { role: "system" | "user" | "assistant"; content: Array<{ type: string; text: string }> }
  | { type: "function_call"; id: string; call_id: string; name: string; arguments: string }
  | { type: "function_call_output"; call_id: string; output: string };

export interface ResponsesOutput {
  type?: string;
  id?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  content?: Array<{ type?: string; text?: string }>;
}

export interface OpenAIRawResponse {
  output?: ResponsesOutput[];
  output_text?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export async function callOpenAIResponses(
  input: ResponsesInputItem[],
  opts: {
    model?: string;
    tools?: ToolDefinition[];
    timeoutMs?: number;
    label?: string;
  } = {},
): Promise<OpenAIRawResponse> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY missing");
  const model = opts.model ?? process.env.OPENAI_MODEL ?? DEFAULT_MODEL ?? FALLBACK_MODEL;
  const body: Record<string, unknown> = {
    model,
    input,
    ...(opts.tools?.length ? { tools: opts.tools } : {}),
  };
  const ms = opts.timeoutMs ?? 30_000;
  const label = opts.label ?? "callOpenAIResponses";
  const res = await Promise.race([
    fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI Responses API ${res.status}: ${text}`);
  }
  return res.json() as Promise<OpenAIRawResponse>;
}

export async function generateTextStream(
  input: GenerateInput,
  legacyOpts: LegacyGenerateOptions = {},
): Promise<AsyncIterable<string>> {
  const opts = normalizeOptions(input, legacyOpts);

  async function* streamText(): AsyncIterable<string> {
    const model = resolveModel(opts);
    const feature = opts.feature ?? opts.label ?? "openai.generateTextStream";
    const t0 = Date.now();
    const loggedInput = stringifyInput(opts.messages);
    let full = "";

    try {
      const res = await postResponses(buildBody(opts, true), opts);
      const reader = res.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data: ")) continue;
            const raw = trimmed.slice(6);
            if (raw === "[DONE]") return;

            try {
              const event = JSON.parse(raw) as { type?: string; delta?: string };
              if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
                full += event.delta;
                yield event.delta;
              }
            } catch {
              // Skip malformed SSE chunks.
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (err) {
      void captureLLMGeneration({
        provider: "openai",
        model,
        feature,
        input: loggedInput,
        output: full,
        latencyMs: Date.now() - t0,
        isError: true,
        error: err instanceof Error ? err.message : String(err),
        datasetId: opts.datasetId,
        traceId: opts.traceId,
        extra: { stream: true },
      });
      throw err;
    } finally {
      void captureLLMGeneration({
        provider: "openai",
        model,
        feature,
        input: loggedInput,
        output: full,
        latencyMs: Date.now() - t0,
        datasetId: opts.datasetId,
        traceId: opts.traceId,
        extra: { stream: true },
      });
    }
  }

  return streamText();
}
