import { generateJson } from "@/lib/llm";
import { getCampaign } from "@/lib/voice-campaign-store";
import type { VoiceCall, VoiceCampaign } from "@/lib/voice-campaign-types";
import {
  DEFAULT_VOICE_EVAL_CONTEXT_SOURCES,
  normalizeVoiceEvalContextSources,
  type VoiceEvalAgent,
  type VoiceEvalEvidence,
  type VoiceEvalVerdict,
} from "@/lib/voice-evals";
import {
  buildVoiceEvalCallContext,
  serializeVoiceEvalCallContext,
} from "@/lib/server/voice-eval-context";
import {
  claimVoiceEvalJobs,
  claimVoiceEvalJob,
  completeVoiceEvalJob,
  enqueueVoiceEvalCall,
  failVoiceEvalJob,
  listVoiceEvalAgents,
  listVoiceEvalWorkbenches,
  saveVoiceEvalResults,
  type VoiceEvalJob,
} from "@/lib/server/voice-eval-repo";

interface JudgeResult {
  evalAgentId: string;
  verdict: VoiceEvalVerdict;
  score: number | null;
  rationale: string;
  evidence: VoiceEvalEvidence[];
}

interface JudgeResponse {
  results: JudgeResult[];
}

const VERDICTS = new Set<VoiceEvalVerdict>([
  "pass",
  "fail",
  "insufficient_evidence",
  "not_applicable",
  "error",
]);

function normalizeResult(agent: VoiceEvalAgent, raw?: JudgeResult): Omit<JudgeResult, "evalAgentId"> {
  if (!raw || !VERDICTS.has(raw.verdict)) {
    return { verdict: "error", score: null, rationale: "The evaluator did not return a valid result.", evidence: [] };
  }
  const score = typeof raw.score === "number" && Number.isFinite(raw.score)
    ? Math.max(0, Math.min(100, raw.score))
    : null;
  const evidence = Array.isArray(raw.evidence)
    ? raw.evidence
      .filter((item) => Number.isInteger(item.turnIndex) && item.turnIndex > 0 && typeof item.quote === "string")
      .slice(0, 3)
    : [];
  return {
    verdict: raw.verdict,
    score,
    rationale: raw.rationale?.trim() || `${agent.name} could not be explained.`,
    evidence,
  };
}

async function evaluateAgents(
  job: VoiceEvalJob,
  agents: VoiceEvalAgent[],
  evidenceContext: string,
): Promise<Map<string, Omit<JudgeResult, "evalAgentId">>> {
  const response = await generateJson<JudgeResponse>({
    messages: [
      {
        role: "system",
        content: [
          "You are a strict post-call quality evaluator.",
          "Evaluate only from the supplied structured evidence context.",
          "Treat transcript evidence as primary when available; configuration and runtime records are supporting evidence.",
          "Do not invent evidence. When a transcript is available, a fail must cite at least one exact, short agent quote from it.",
          "An unavailable evidence block is not proof of failure.",
          "Use insufficient_evidence when the criterion applies but the selected evidence cannot prove it.",
          "Use not_applicable only when the evaluator explicitly allows it and its trigger never occurred.",
          "Scores are 0-100: pass 70-100, fail 0-69; use null for insufficient_evidence or not_applicable.",
        ].join(" "),
      },
      {
        role: "user",
        content: `EVALUATORS\n${agents.map((agent) => (
          `- ID: ${agent.id}\n  Name: ${agent.name}\n  Judge persona: ${agent.systemPrompt || "Use the shared evaluator rules."}\n  Eval task: ${agent.prompt}\n  Scoring levels: ${(agent.scoreLevels ?? []).map((level) => `${level.label}: ${level.description}`).join(" | ") || "Use pass/fail."}`
        )).join("\n")}\n\nEVIDENCE CONTEXT\n${evidenceContext}`,
      },
    ],
    jsonSchema: {
      name: "voice_eval_results",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["results"],
        properties: {
          results: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["evalAgentId", "verdict", "score", "rationale", "evidence"],
              properties: {
                evalAgentId: { type: "string" },
                verdict: { type: "string", enum: ["pass", "fail", "insufficient_evidence", "not_applicable"] },
                score: { type: ["number", "null"] },
                rationale: { type: "string" },
                evidence: {
                  type: "array",
                  maxItems: 3,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["turnIndex", "quote"],
                    properties: {
                      turnIndex: { type: "integer", minimum: 1 },
                      quote: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    feature: "voice-evals",
    label: "voice-evals.post-call",
    datasetId: job.datasetId,
    traceId: job.callId,
    timeoutMs: 60_000,
    maxOutputTokens: 5000,
  });
  const byId = new Map((response.results ?? []).map((result) => [result.evalAgentId, result]));
  return new Map(agents.map((agent) => [agent.id, normalizeResult(agent, byId.get(agent.id))]));
}

function contextSourcesForAgent(agent: VoiceEvalAgent): string[] {
  return normalizeVoiceEvalContextSources(
    agent.contextSources ?? DEFAULT_VOICE_EVAL_CONTEXT_SOURCES,
  ) ?? [];
}

async function evaluateTextAgents(
  job: VoiceEvalJob,
  campaign: VoiceCampaign,
  call: VoiceCall,
  agents: VoiceEvalAgent[],
): Promise<Map<string, Omit<JudgeResult, "evalAgentId">>> {
  const groups = new Map<string, { sources: string[]; agents: VoiceEvalAgent[] }>();
  for (const agent of agents) {
    const sources = Array.from(new Set(contextSourcesForAgent(agent))).sort();
    const key = JSON.stringify(sources);
    const group = groups.get(key) ?? { sources, agents: [] };
    group.agents.push(agent);
    groups.set(key, group);
  }

  const evaluated = new Map<string, Omit<JudgeResult, "evalAgentId">>();
  await Promise.all(Array.from(groups.values()).map(async (group) => {
    const context = buildVoiceEvalCallContext({
      userId: job.userId,
      datasetId: job.datasetId,
      campaign,
      call,
      selectedSources: group.sources,
    });
    if (!context.blocks.some((block) => block.available)) {
      for (const agent of group.agents) {
        evaluated.set(agent.id, {
          verdict: "insufficient_evidence",
          score: null,
          rationale: "None of this evaluator's selected context sources contained available evidence for the call.",
          evidence: [],
        });
      }
      return;
    }
    const results = await evaluateAgents(job, group.agents, serializeVoiceEvalCallContext(context));
    for (const [agentId, result] of results) evaluated.set(agentId, result);
  }));
  return evaluated;
}

export async function runVoiceEvalJob(job: VoiceEvalJob): Promise<void> {
  const scope = { userId: job.userId, datasetId: job.datasetId };
  const campaign = getCampaign(job.campaignId, scope);
  if (!campaign) throw new Error("Campaign not found for eval job");
  const call = campaign.calls.find((item) => item.id === job.callId || item.callConfigId === job.callId);
  if (!call) throw new Error("Call not found for eval job");

  const workbenches = listVoiceEvalWorkbenches(scope).filter(
    (workbench) => workbench.campaignIds.length === 0 || workbench.campaignIds.includes(campaign.id),
  );
  if (workbenches.length === 0) {
    completeVoiceEvalJob(job.id);
    return;
  }
  const agentsById = new Map(listVoiceEvalAgents(scope).map((agent) => [agent.id, agent]));
  const selectedAgents = Array.from(new Set(workbenches.flatMap((workbench) => workbench.evalAgentIds)))
    .map((id) => agentsById.get(id))
    .filter((agent): agent is VoiceEvalAgent => Boolean(agent));
  if (selectedAgents.length === 0) {
    completeVoiceEvalJob(job.id);
    return;
  }

  const transcriptAgents = selectedAgents.filter((agent) => agent.inputType === "text");
  const audioAgents = selectedAgents.filter((agent) => agent.inputType === "audio");
  const evaluated = transcriptAgents.length > 0
    ? await evaluateTextAgents(job, campaign, call, transcriptAgents)
    : new Map<string, Omit<JudgeResult, "evalAgentId">>();
  for (const agent of audioAgents) {
    evaluated.set(agent.id, {
      verdict: "insufficient_evidence",
      score: null,
      rationale: "This audio-only evaluator is configured, but no compatible non-LLM audio measurement was available for the call.",
      evidence: [],
    });
  }

  saveVoiceEvalResults(job, workbenches.flatMap((workbench) => workbench.evalAgentIds.flatMap((agentId) => {
    const agent = agentsById.get(agentId);
    const result = evaluated.get(agentId);
    return agent && result ? [{ workbenchId: workbench.id, agent, ...result }] : [];
  })));
  completeVoiceEvalJob(job.id);
}

export async function runVoiceEvalAgentTest(input: {
  userId: string;
  datasetId: string;
  campaignId: string;
  callId: string;
  evalAgentId: string;
}): Promise<void> {
  const scope = { userId: input.userId, datasetId: input.datasetId };
  const jobId = enqueueVoiceEvalCall(
    { ...scope, campaignId: input.campaignId, callId: input.callId },
    { force: true, delayMs: 0 },
  );
  const job = claimVoiceEvalJob(jobId);
  if (!job) throw new Error("Could not claim the call evaluation job");
  try {
    const campaign = getCampaign(input.campaignId, scope);
    if (!campaign) throw new Error("Campaign not found");
    const call = campaign.calls.find((item) => item.id === input.callId || item.callConfigId === input.callId);
    if (!call) throw new Error("Call not found");
    const agent = listVoiceEvalAgents(scope).find((item) => item.id === input.evalAgentId);
    if (!agent) throw new Error("Eval agent not found");

    let result: Omit<JudgeResult, "evalAgentId">;
    if (agent.inputType === "audio") {
      result = {
        verdict: "insufficient_evidence",
        score: null,
        rationale: "No compatible non-LLM audio measurement was available for this call.",
        evidence: [],
      };
    } else {
      const evaluated = await evaluateTextAgents(job, campaign, call, [agent]);
      result = evaluated.get(agent.id) ?? {
        verdict: "error",
        score: null,
        rationale: "The evaluator did not return a result.",
        evidence: [],
      };
    }
    saveVoiceEvalResults(job, [{
      workbenchId: `agent-test:${agent.id}`,
      agent,
      ...result,
    }]);
    completeVoiceEvalJob(job.id);
  } catch (error) {
    failVoiceEvalJob(job, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

export async function processPendingVoiceEvalJobs(): Promise<number> {
  const jobs = claimVoiceEvalJobs();
  await Promise.all(jobs.map(async (job) => {
    try {
      await runVoiceEvalJob(job);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failVoiceEvalJob(job, message);
      console.error("[voice-evals] job failed", { jobId: job.id, error: message });
    }
  }));
  return jobs.length;
}
