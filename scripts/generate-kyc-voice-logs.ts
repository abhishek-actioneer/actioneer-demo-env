import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";

type VoiceCallOutcome =
  | "positive"
  | "neutral"
  | "negative"
  | "busy"
  | "wrong_number"
  | "no_answer"
  | "failed"
  | "unknown";

type VoiceCallStatus = "completed" | "failed" | "no_answer";

interface GeneratedTurn {
  role: "assistant" | "user";
  offsetSeconds: number;
  text: string;
}

interface GeneratedCall {
  localId: string;
  status: VoiceCallStatus;
  outcome: VoiceCallOutcome;
  durationSeconds: number;
  startedAtOffsetSeconds: number;
  transcript: GeneratedTurn[];
}

interface GeneratedBatch {
  calls: GeneratedCall[];
}

interface TranscriptTurn extends GeneratedTurn {
  id: string;
  at: string;
  sequence: number;
  itemId: string;
}

interface StructuredCallLog {
  schemaVersion: 1;
  runId: string;
  generatedAt: string;
  campaign: {
    id: string;
    name: string;
    segmentName: string;
    objective: string;
    language: string;
  };
  call: {
    id: string;
    index: number;
    status: VoiceCallStatus;
    outcome: VoiceCallOutcome;
    toNumber: string;
    phoneHash: string;
    startedAt: string;
    endedAt: string;
    durationSeconds: number;
    engaged: boolean;
  };
  measurements: {
    turnCount: number;
    userTurnCount: number;
    assistantTurnCount: number;
    firstUserOffsetSeconds?: number;
    lastTurnOffsetSeconds?: number;
  };
  transcript: TranscriptTurn[];
}

interface CampaignCompatibleCall {
  id: string;
  toNumber: string;
  provider: "plivo-gemini";
  tags: string[];
  status: VoiceCallStatus;
  durationSeconds: number;
  engaged: boolean;
  summary: string;
  transcript: Array<Omit<TranscriptTurn, "offsetSeconds">>;
  startedAt: string;
  endedAt: string;
}

interface Args {
  count: number;
  batchSize: number;
  outDir: string;
  runId: string;
  model: string;
  startAt: string;
  campaignName: string;
  segmentName: string;
  objective: string;
  language: string;
  dryRun: boolean;
}

const DEFAULT_COUNT = 450;
const DEFAULT_BATCH_SIZE = 12;
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`);
    if (index >= 0) return argv[index + 1];
    const inline = argv.find((arg) => arg.startsWith(`--${name}=`));
    return inline?.slice(name.length + 3);
  };
  const has = (name: string) => argv.includes(`--${name}`);
  const runId = get("run-id") ?? `kyc-run-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  return {
    count: Number(get("count") ?? DEFAULT_COUNT),
    batchSize: Number(get("batch-size") ?? DEFAULT_BATCH_SIZE),
    outDir: resolve(get("out-dir") ?? join("data", "voice-simulation-runs", runId)),
    runId,
    model: get("model") ?? process.env.OPENAI_MODEL ?? "gpt-5.4",
    startAt: get("start-at") ?? new Date().toISOString(),
    campaignName: get("campaign-name") ?? "KYC Completion Follow-up",
    segmentName: get("segment-name") ?? "KYC not completed",
    objective: get("objective") ?? "Understand why the customer has not completed KYC and help them continue only if they are willing.",
    language: get("language") ?? "Hinglish, Hindi, and English mix",
    dryRun: has("dry-run"),
  };
}

function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    const value = rawValue
      .replace(/^export\s+/, "")
      .replace(/^"(.*)"$/, "$1")
      .replace(/^'(.*)'$/, "$1");
    process.env[key] = value;
  }
}

function ensureEnv(): void {
  loadEnvFile(resolve(".env"));
  loadEnvFile(resolve(".env.local"));
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is missing. Add it to .env.local or export it before running this script.");
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function fakePhone(index: number): string {
  const base = 7000000000 + ((index + 1) * 7919) % 999999999;
  return `+91${String(base).slice(0, 10)}`;
}

function extractOutputText(response: unknown): string {
  const data = response as {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string }> }>;
  };
  if (typeof data.output_text === "string") return data.output_text;
  return (data.output ?? [])
    .flatMap((item) => item.content ?? [])
    .map((content) => content.text ?? "")
    .join("");
}

function buildPrompt(args: Args, batchStart: number, batchCount: number): string {
  return `Generate ${batchCount} structured outbound voice campaign call transcripts.

Campaign:
- Name: ${args.campaignName}
- Segment: ${args.segmentName}
- Objective: ${args.objective}
- Language surface: ${args.language}

Simulation requirements:
- Simulate both sides: the campaign agent and a lightweight customer-side agent.
- The customer belongs to the segment "KYC not completed", but do not output any hidden cause, cluster, root-cause field, recommendation, issue type, or taxonomy.
- Only output observable call facts and transcript text.
- Calls must be varied. Include unanswered calls, failed attempts, wrong-number calls, busy callbacks, short refusals, neutral information-seeking calls, and calls where the customer accepts a next step.
- For answered calls, vary the number of turns naturally. Some calls should be under 60 seconds, many around 90-210 seconds, and a few longer.
- Let user-stated friction emerge in the transcript language itself. Do not use a fixed list of problems.
- Keep the agent concise, permission-based, and non-pushy.
- Make the customer speech realistic for India consumer KYC follow-up calls, with natural English, Hinglish, or Hindi phrasing.
- Do not include markdown. Return JSON only.

Batch:
- Global call index starts at ${batchStart + 1}.
- localId values must be strings "${batchStart + 1}" through "${batchStart + batchCount}".
- startedAtOffsetSeconds should increase across calls with realistic campaign pacing.

Return exactly ${batchCount} calls.`;
}

const jsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    calls: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          localId: { type: "string" },
          status: { type: "string", enum: ["completed", "failed", "no_answer"] },
          outcome: { type: "string", enum: ["positive", "neutral", "negative", "busy", "wrong_number", "no_answer", "failed", "unknown"] },
          durationSeconds: { type: "integer", minimum: 0, maximum: 900 },
          startedAtOffsetSeconds: { type: "integer", minimum: 0 },
          transcript: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                role: { type: "string", enum: ["assistant", "user"] },
                offsetSeconds: { type: "number", minimum: 0, maximum: 900 },
                text: { type: "string" },
              },
              required: ["role", "offsetSeconds", "text"],
            },
          },
        },
        required: ["localId", "status", "outcome", "durationSeconds", "startedAtOffsetSeconds", "transcript"],
      },
    },
  },
  required: ["calls"],
};

async function generateBatch(args: Args, batchStart: number, batchCount: number): Promise<GeneratedBatch> {
  const body = {
    model: args.model,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: "You generate synthetic but realistic call logs for evaluation. Never output hidden labels, clusters, root causes, recommendations, or ideal fixes. Output only the requested JSON.",
          },
        ],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: buildPrompt(args, batchStart, batchCount) }],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "kyc_voice_transcript_batch",
        strict: true,
        schema: jsonSchema,
      },
    },
    max_output_tokens: Math.max(6000, batchCount * 900),
  };

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI Responses API error ${response.status}: ${text}`);
  }

  const data = await response.json();
  return JSON.parse(extractOutputText(data)) as GeneratedBatch;
}

function sanitizeGeneratedCall(call: GeneratedCall, fallbackIndex: number): GeneratedCall {
  const status: VoiceCallStatus = ["completed", "failed", "no_answer"].includes(call.status)
    ? call.status
    : "completed";
  const outcome: VoiceCallOutcome = [
    "positive",
    "neutral",
    "negative",
    "busy",
    "wrong_number",
    "no_answer",
    "failed",
    "unknown",
  ].includes(call.outcome)
    ? call.outcome
    : status === "no_answer"
      ? "no_answer"
      : status === "failed"
        ? "failed"
        : "unknown";

  const transcript = Array.isArray(call.transcript)
    ? call.transcript
        .filter((turn) => (turn.role === "assistant" || turn.role === "user") && typeof turn.text === "string")
        .map((turn, index) => ({
          role: turn.role,
          offsetSeconds: Math.max(index * 4, Math.round(Number(turn.offsetSeconds) || index * 8)),
          text: turn.text.replace(/\s+/g, " ").trim(),
        }))
        .filter((turn) => turn.text.length > 0)
    : [];

  return {
    localId: call.localId || String(fallbackIndex + 1),
    status,
    outcome,
    durationSeconds: Math.max(0, Math.round(Number(call.durationSeconds) || 0)),
    startedAtOffsetSeconds: Math.max(0, Math.round(Number(call.startedAtOffsetSeconds) || fallbackIndex * 75)),
    transcript,
  };
}

function materializeLog(args: Args, call: GeneratedCall, index: number): StructuredCallLog {
  const runStartMs = new Date(args.startAt).getTime();
  const startedAtMs = runStartMs + call.startedAtOffsetSeconds * 1000;
  const endedAtMs = startedAtMs + call.durationSeconds * 1000;
  const callId = `${args.runId}_call_${String(index + 1).padStart(4, "0")}`;
  const phone = fakePhone(index);
  const transcript = call.transcript.map((turn, turnIndex): TranscriptTurn => {
    const at = new Date(startedAtMs + Math.round(turn.offsetSeconds * 1000)).toISOString();
    return {
      ...turn,
      id: `${callId}_turn_${String(turnIndex + 1).padStart(3, "0")}`,
      itemId: `sim:${callId}:${turnIndex + 1}`,
      sequence: turnIndex + 1,
      at,
    };
  });
  const userTurns = transcript.filter((turn) => turn.role === "user");

  return {
    schemaVersion: 1,
    runId: args.runId,
    generatedAt: new Date().toISOString(),
    campaign: {
      id: `vc_${args.runId}`,
      name: args.campaignName,
      segmentName: args.segmentName,
      objective: args.objective,
      language: args.language,
    },
    call: {
      id: callId,
      index: index + 1,
      status: call.status,
      outcome: call.outcome,
      toNumber: phone,
      phoneHash: hash(`${args.runId}:${phone}`).slice(0, 24),
      startedAt: new Date(startedAtMs).toISOString(),
      endedAt: new Date(endedAtMs).toISOString(),
      durationSeconds: call.durationSeconds,
      engaged: call.durationSeconds >= 20 && userTurns.length > 0,
    },
    measurements: {
      turnCount: transcript.length,
      userTurnCount: userTurns.length,
      assistantTurnCount: transcript.length - userTurns.length,
      firstUserOffsetSeconds: userTurns[0]?.offsetSeconds,
      lastTurnOffsetSeconds: transcript.at(-1)?.offsetSeconds,
    },
    transcript,
  };
}

function campaignCompatibleCall(log: StructuredCallLog): CampaignCompatibleCall {
  return {
    id: log.call.id,
    toNumber: log.call.toNumber,
    provider: "plivo-gemini",
    tags: ["campaign", "synthetic", "kyc"],
    status: log.call.status,
    durationSeconds: log.call.durationSeconds,
    engaged: log.call.engaged,
    summary: `${log.call.outcome} synthetic transcript`,
    transcript: log.transcript.map(({ offsetSeconds: _offsetSeconds, ...turn }) => turn),
    startedAt: log.call.startedAt,
    endedAt: log.call.endedAt,
  };
}

function writeOutputs(args: Args, logs: StructuredCallLog[]): void {
  mkdirSync(args.outDir, { recursive: true });
  const jsonl = logs.map((log) => JSON.stringify(log)).join("\n") + "\n";
  const calls = logs.map(campaignCompatibleCall);
  const summary = {
    runId: args.runId,
    generatedAt: new Date().toISOString(),
    count: logs.length,
    outDir: args.outDir,
    files: {
      jsonl: "transcripts.jsonl",
      calls: "campaign-calls.json",
      sample: "sample.json",
      summary: "summary.json",
    },
    outcomes: logs.reduce<Record<string, number>>((acc, log) => {
      acc[log.call.outcome] = (acc[log.call.outcome] ?? 0) + 1;
      return acc;
    }, {}),
    avgDurationSeconds: Math.round(logs.reduce((sum, log) => sum + log.call.durationSeconds, 0) / Math.max(1, logs.length)),
    avgTurns: Number((logs.reduce((sum, log) => sum + log.measurements.turnCount, 0) / Math.max(1, logs.length)).toFixed(1)),
    note: "No root-cause labels, cluster keys, hidden eval labels, or recommendations are stored in these logs.",
  };

  writeFileSync(join(args.outDir, "transcripts.jsonl"), jsonl);
  writeFileSync(join(args.outDir, "campaign-calls.json"), JSON.stringify(calls, null, 2));
  writeFileSync(join(args.outDir, "sample.json"), JSON.stringify(logs.slice(0, 5), null, 2));
  writeFileSync(join(args.outDir, "summary.json"), JSON.stringify(summary, null, 2));
}

async function main(): Promise<void> {
  ensureEnv();
  const args = parseArgs();
  if (!Number.isFinite(args.count) || args.count <= 0) throw new Error("--count must be positive");
  if (!Number.isFinite(args.batchSize) || args.batchSize <= 0) throw new Error("--batch-size must be positive");

  console.log(`[voice-log-gen] runId=${args.runId}`);
  console.log(`[voice-log-gen] model=${args.model}`);
  console.log(`[voice-log-gen] count=${args.count} batchSize=${args.batchSize}`);
  console.log(`[voice-log-gen] outDir=${args.outDir}`);
  console.log("[voice-log-gen] storing observable logs only; no issue labels or recommendations");

  const logs: StructuredCallLog[] = [];
  for (let start = 0; start < args.count; start += args.batchSize) {
    const batchCount = Math.min(args.batchSize, args.count - start);
    console.log(`[voice-log-gen] generating ${start + 1}-${start + batchCount}`);
    const batch = args.dryRun
      ? { calls: [] }
      : await generateBatch(args, start, batchCount);
    const generatedCalls = batch.calls.slice(0, batchCount);
    if (generatedCalls.length !== batchCount) {
      throw new Error(`Expected ${batchCount} calls, got ${generatedCalls.length}`);
    }
    generatedCalls.forEach((rawCall, offset) => {
      logs.push(materializeLog(args, sanitizeGeneratedCall(rawCall, start + offset), start + offset));
    });
    writeOutputs(args, logs);
    console.log(`[voice-log-gen] wrote ${logs.length}/${args.count}`);
  }

  writeOutputs(args, logs);
  console.log("[voice-log-gen] complete");
}

main().catch((error) => {
  console.error("[voice-log-gen] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
