import { randomUUID } from "crypto";
import { getDb } from "@/lib/meta-db";
import {
  BUILT_IN_VOICE_EVAL_AGENTS,
  normalizeVoiceEvalContextSources,
  type VoiceEvalAgent,
  type VoiceEvalCategory,
  type VoiceEvalInputType,
  type VoiceEvalResult,
  type VoiceEvalVerdict,
  type VoiceEvalWorkbench,
  type VoiceEvalScoreLevel,
} from "@/lib/voice-evals";

interface Scope {
  userId: string;
  datasetId: string;
}

interface EvalAgentRow {
  id: string;
  name: string;
  description: string;
  prompt: string;
  input_type: VoiceEvalInputType;
  category: VoiceEvalCategory;
  config_json: string | null;
  created_at: string;
  updated_at: string;
}

interface WorkbenchRow {
  id: string;
  user_id: string;
  dataset_id: string;
  name: string;
  description: string;
  status: "active" | "archived";
  eval_agent_ids_json: string;
  campaign_ids_json: string;
  created_at: string;
  updated_at: string;
}

interface ResultRow {
  id: string;
  job_id: string;
  workbench_id: string;
  eval_agent_id: string;
  eval_agent_name: string;
  campaign_id: string;
  call_id: string;
  verdict: VoiceEvalVerdict;
  score: number | null;
  rationale: string;
  evidence_json: string;
  created_at: string;
  updated_at: string;
}

export interface VoiceEvalJob {
  id: string;
  userId: string;
  datasetId: string;
  campaignId: string;
  callId: string;
  attemptCount: number;
}

function parseList(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function mapAgent(row: EvalAgentRow): VoiceEvalAgent {
  let config: { systemPrompt?: string; contextSources?: string[]; scoreLevels?: VoiceEvalScoreLevel[] } = {};
  try {
    config = row.config_json ? JSON.parse(row.config_json) as typeof config : {};
  } catch {
    config = {};
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    prompt: row.prompt,
    inputType: row.input_type,
    category: row.category,
    source: "custom",
    ...config,
    contextSources: normalizeVoiceEvalContextSources(config.contextSources),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapWorkbench(row: WorkbenchRow): VoiceEvalWorkbench {
  return {
    id: row.id,
    userId: row.user_id,
    datasetId: row.dataset_id,
    name: row.name,
    description: row.description,
    status: row.status,
    evalAgentIds: parseList(row.eval_agent_ids_json),
    campaignIds: parseList(row.campaign_ids_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listVoiceEvalAgents(scope: Scope): VoiceEvalAgent[] {
  const custom = getDb().prepare(`
    SELECT id, name, description, prompt, input_type, category, config_json, created_at, updated_at
    FROM voice_eval_agents
    WHERE user_id = ? AND dataset_id = ? AND archived_at IS NULL
    ORDER BY updated_at DESC
  `).all(scope.userId, scope.datasetId) as EvalAgentRow[];
  return [...BUILT_IN_VOICE_EVAL_AGENTS, ...custom.map(mapAgent)];
}

export function saveVoiceEvalAgent(
  scope: Scope,
  input: {
    id?: string;
    name: string;
    description: string;
    prompt: string;
    inputType: VoiceEvalInputType;
    category: VoiceEvalCategory;
    systemPrompt?: string;
    contextSources?: string[];
    scoreLevels?: VoiceEvalScoreLevel[];
  },
): VoiceEvalAgent {
  const now = new Date().toISOString();
  const existing = input.id?.startsWith("custom:")
    ? getDb().prepare(`
      SELECT id FROM voice_eval_agents WHERE id = ? AND user_id = ? AND dataset_id = ?
    `).get(input.id, scope.userId, scope.datasetId) as { id: string } | undefined
    : undefined;
  const id = existing?.id ?? `custom:${randomUUID()}`;
  getDb().prepare(`
    INSERT INTO voice_eval_agents (
      id, user_id, dataset_id, name, description, prompt, input_type, category, config_json,
      created_at, updated_at, archived_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      prompt = excluded.prompt,
      input_type = excluded.input_type,
      category = excluded.category,
      config_json = excluded.config_json,
      updated_at = excluded.updated_at,
      archived_at = NULL
  `).run(
    id,
    scope.userId,
    scope.datasetId,
    input.name.trim(),
    input.description.trim(),
    input.prompt.trim(),
    input.inputType,
    input.category,
    JSON.stringify({
      systemPrompt: input.systemPrompt,
      contextSources: normalizeVoiceEvalContextSources(input.contextSources),
      scoreLevels: input.scoreLevels,
    }),
    now,
    now,
  );
  return {
    id,
    name: input.name.trim(),
    description: input.description.trim(),
    prompt: input.prompt.trim(),
    inputType: input.inputType,
    category: input.category,
    source: "custom",
    systemPrompt: input.systemPrompt,
    contextSources: normalizeVoiceEvalContextSources(input.contextSources),
    scoreLevels: input.scoreLevels,
    createdAt: now,
    updatedAt: now,
  };
}

export function listVoiceEvalWorkbenches(scope: Scope, includeArchived = false): VoiceEvalWorkbench[] {
  const rows = getDb().prepare(`
    SELECT * FROM voice_eval_workbenches
    WHERE user_id = ? AND dataset_id = ? ${includeArchived ? "" : "AND status = 'active'"}
    ORDER BY updated_at DESC
  `).all(scope.userId, scope.datasetId) as WorkbenchRow[];
  return rows.map(mapWorkbench);
}

export function saveVoiceEvalWorkbench(
  scope: Scope,
  input: {
    id?: string;
    name: string;
    description: string;
    evalAgentIds: string[];
    campaignIds: string[];
    status?: "active" | "archived";
  },
): VoiceEvalWorkbench {
  const existing = input.id
    ? getDb().prepare(`SELECT * FROM voice_eval_workbenches WHERE id = ? AND user_id = ? AND dataset_id = ?`)
      .get(input.id, scope.userId, scope.datasetId) as WorkbenchRow | undefined
    : undefined;
  const now = new Date().toISOString();
  const id = existing?.id ?? `eval_wb_${randomUUID()}`;
  const createdAt = existing?.created_at ?? now;
  const status = input.status ?? existing?.status ?? "active";
  const evalAgentIds = Array.from(new Set(input.evalAgentIds));
  const campaignIds = Array.from(new Set(input.campaignIds));
  getDb().prepare(`
    INSERT INTO voice_eval_workbenches (
      id, user_id, dataset_id, name, description, status, eval_agent_ids_json,
      campaign_ids_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      status = excluded.status,
      eval_agent_ids_json = excluded.eval_agent_ids_json,
      campaign_ids_json = excluded.campaign_ids_json,
      updated_at = excluded.updated_at
  `).run(
    id,
    scope.userId,
    scope.datasetId,
    input.name.trim(),
    input.description.trim(),
    status,
    JSON.stringify(evalAgentIds),
    JSON.stringify(campaignIds),
    createdAt,
    now,
  );
  return {
    id,
    ...scope,
    name: input.name.trim(),
    description: input.description.trim(),
    status,
    evalAgentIds,
    campaignIds,
    createdAt,
    updatedAt: now,
  };
}

export function listVoiceEvalResults(scope: Scope, limit = 100): VoiceEvalResult[] {
  const rows = getDb().prepare(`
    SELECT id, job_id, workbench_id, eval_agent_id, eval_agent_name, campaign_id,
      call_id, verdict, score, rationale, evidence_json, created_at, updated_at
    FROM voice_eval_results
    WHERE user_id = ? AND dataset_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(scope.userId, scope.datasetId, Math.max(1, Math.min(limit, 500))) as ResultRow[];
  return rows.map((row) => ({
    id: row.id,
    jobId: row.job_id,
    workbenchId: row.workbench_id,
    evalAgentId: row.eval_agent_id,
    evalAgentName: row.eval_agent_name,
    campaignId: row.campaign_id,
    callId: row.call_id,
    verdict: row.verdict,
    score: row.score,
    rationale: row.rationale,
    evidence: (() => {
      try {
        const value = JSON.parse(row.evidence_json) as VoiceEvalResult["evidence"];
        return Array.isArray(value) ? value : [];
      } catch {
        return [];
      }
    })(),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function enqueueVoiceEvalCall(
  scope: Scope & { campaignId: string; callId: string },
  options: { force?: boolean; delayMs?: number } = {},
): string {
  const now = new Date().toISOString();
  const nextAttemptAt = new Date(Date.now() + (options.delayMs ?? 20_000)).toISOString();
  const id = `eval_job_${randomUUID()}`;
  getDb().prepare(`
    INSERT INTO voice_eval_jobs (
      id, user_id, dataset_id, campaign_id, call_id, status, attempt_count,
      next_attempt_at, last_error, created_at, updated_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, NULL, ?, ?, NULL)
    ON CONFLICT(user_id, dataset_id, campaign_id, call_id) DO UPDATE SET
      status = CASE
        WHEN ? = 1 THEN 'pending'
        WHEN voice_eval_jobs.status = 'completed' THEN voice_eval_jobs.status
        ELSE 'pending'
      END,
      next_attempt_at = excluded.next_attempt_at,
      updated_at = excluded.updated_at
  `).run(
    id,
    scope.userId,
    scope.datasetId,
    scope.campaignId,
    scope.callId,
    nextAttemptAt,
    now,
    now,
    options.force ? 1 : 0,
  );
  const row = getDb().prepare(`
    SELECT id FROM voice_eval_jobs
    WHERE user_id = ? AND dataset_id = ? AND campaign_id = ? AND call_id = ?
  `).get(scope.userId, scope.datasetId, scope.campaignId, scope.callId) as { id: string };
  return row.id;
}

export function claimVoiceEvalJobs(limit = 3): VoiceEvalJob[] {
  const db = getDb();
  const now = new Date().toISOString();
  const rows = db.prepare(`
    SELECT id, user_id, dataset_id, campaign_id, call_id, attempt_count
    FROM voice_eval_jobs
    WHERE status IN ('pending', 'failed') AND next_attempt_at <= ? AND attempt_count < 4
    ORDER BY created_at ASC
    LIMIT ?
  `).all(now, Math.max(1, Math.min(limit, 10))) as Array<{
    id: string;
    user_id: string;
    dataset_id: string;
    campaign_id: string;
    call_id: string;
    attempt_count: number;
  }>;
  const update = db.prepare(`
    UPDATE voice_eval_jobs
    SET status = 'running', attempt_count = attempt_count + 1, updated_at = ?
    WHERE id = ? AND status IN ('pending', 'failed')
  `);
  const claimed: VoiceEvalJob[] = [];
  const transaction = db.transaction(() => {
    for (const row of rows) {
      const result = update.run(now, row.id);
      if (result.changes === 1) {
        claimed.push({
          id: row.id,
          userId: row.user_id,
          datasetId: row.dataset_id,
          campaignId: row.campaign_id,
          callId: row.call_id,
          attemptCount: row.attempt_count + 1,
        });
      }
    }
  });
  transaction();
  return claimed;
}

export function claimVoiceEvalJob(jobId: string): VoiceEvalJob | undefined {
  const db = getDb();
  const row = db.prepare(`
    SELECT id, user_id, dataset_id, campaign_id, call_id, attempt_count
    FROM voice_eval_jobs WHERE id = ? AND status IN ('pending', 'failed')
  `).get(jobId) as {
    id: string;
    user_id: string;
    dataset_id: string;
    campaign_id: string;
    call_id: string;
    attempt_count: number;
  } | undefined;
  if (!row) return undefined;
  const now = new Date().toISOString();
  const update = db.prepare(`
    UPDATE voice_eval_jobs
    SET status = 'running', attempt_count = attempt_count + 1, updated_at = ?
    WHERE id = ? AND status IN ('pending', 'failed')
  `).run(now, jobId);
  if (update.changes !== 1) return undefined;
  return {
    id: row.id,
    userId: row.user_id,
    datasetId: row.dataset_id,
    campaignId: row.campaign_id,
    callId: row.call_id,
    attemptCount: row.attempt_count + 1,
  };
}

export function completeVoiceEvalJob(jobId: string): void {
  const now = new Date().toISOString();
  getDb().prepare(`
    UPDATE voice_eval_jobs SET status = 'completed', completed_at = ?, updated_at = ?, last_error = NULL
    WHERE id = ?
  `).run(now, now, jobId);
}

export function failVoiceEvalJob(job: VoiceEvalJob, error: string): void {
  const now = new Date();
  const retryAt = new Date(now.getTime() + Math.min(15 * 60_000, 30_000 * 2 ** Math.max(0, job.attemptCount - 1)));
  getDb().prepare(`
    UPDATE voice_eval_jobs
    SET status = 'failed', next_attempt_at = ?, last_error = ?, updated_at = ?
    WHERE id = ?
  `).run(retryAt.toISOString(), error.slice(0, 1000), now.toISOString(), job.id);
}

export function saveVoiceEvalResults(
  job: VoiceEvalJob,
  results: Array<{
    workbenchId: string;
    agent: VoiceEvalAgent;
    verdict: VoiceEvalVerdict;
    score: number | null;
    rationale: string;
    evidence: VoiceEvalResult["evidence"];
  }>,
): void {
  const db = getDb();
  const now = new Date().toISOString();
  const statement = db.prepare(`
    INSERT INTO voice_eval_results (
      id, job_id, user_id, dataset_id, campaign_id, call_id, workbench_id,
      eval_agent_id, eval_agent_name, eval_agent_snapshot_json, verdict, score,
      rationale, evidence_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(job_id, workbench_id, eval_agent_id) DO UPDATE SET
      eval_agent_name = excluded.eval_agent_name,
      eval_agent_snapshot_json = excluded.eval_agent_snapshot_json,
      verdict = excluded.verdict,
      score = excluded.score,
      rationale = excluded.rationale,
      evidence_json = excluded.evidence_json,
      updated_at = excluded.updated_at
  `);
  const transaction = db.transaction(() => {
    for (const result of results) {
      statement.run(
        `eval_result_${randomUUID()}`,
        job.id,
        job.userId,
        job.datasetId,
        job.campaignId,
        job.callId,
        result.workbenchId,
        result.agent.id,
        result.agent.name,
        JSON.stringify(result.agent),
        result.verdict,
        result.score,
        result.rationale,
        JSON.stringify(result.evidence),
        now,
        now,
      );
    }
  });
  transaction();
}
