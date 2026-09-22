import { createHash } from "crypto";
import type { ChatMessage, SubagentInfo, FollowUpAction, QueryInfo } from "@/lib/types";
import { stmts, getDb } from "@/lib/meta-db";

/**
 * Per-subagent work for a deep-research thread: the queries it ran (real SQL +
 * row counts, surfaced in the Sources panel and as `[agent-id:Q#]` citations in
 * the report) and a one-paragraph summary shown under the agent in the timeline.
 * Keyed by subagent id (e.g. "daily-metrics", "cohort-retention").
 */
export type AgentWork = { queries: QueryInfo[]; summary?: string };
export type DeepResearchWork = Record<string, AgentWork>;

/**
 * A handcrafted starter conversation for a sample dataset. Authored per-dataset
 * so a fresh workspace is never empty — these are seeded server-side, scoped to
 * the dataset, when the workspace is set up during onboarding.
 *
 * Keep threads short and data-accurate: a real question someone at that org
 * would ask, answered with figures pulled from the dataset's own DuckDB.
 */
/**
 * An authored message in a starter thread. `role` + `content` are required; any
 * other ChatMessage field (agent, variant, followUpActions, isDeepResearchReport,
 * etc.) may be set to author a rich deep-research thread. `id`/`timestamp` are
 * filled in automatically if omitted.
 */
export type StarterChatMessage = Partial<ChatMessage> &
  Pick<ChatMessage, "role" | "content">;

export interface StarterChat {
  /** Stable slug — used to build a deterministic, idempotent conversation id. */
  slug: string;
  title: string;
  /** Full message thread. Author at least one user message + one sentinel reply. */
  messages: StarterChatMessage[];
}

// ── Thread builders ───────────────────────────────────────────────────
// Construct correctly-shaped chat threads so authored content renders as the
// real product does. The 6 core analysis agents + the critique agent.

const CORE_AGENTS: ReadonlyArray<{ id: string; name: string; icon: string }> = [
  { id: "data-quality", name: "Data Quality Agent", icon: "shield" },
  { id: "daily-metrics", name: "Daily Metrics Agent", icon: "bar-chart" },
  { id: "cohort-retention", name: "Cohort Retention Agent", icon: "users" },
  { id: "rev-opt", name: "Revenue Optimization Agent", icon: "dollar" },
  { id: "user-segmentation", name: "User Segmentation Agent", icon: "clock" },
  { id: "geographic", name: "Geographic Agent", icon: "globe" },
];
const CRITIQUE_AGENT = { id: "critique", name: "Critique Agent", icon: "check" };

function completeSub(
  a: { id: string; name: string; icon: string },
  work?: AgentWork,
): SubagentInfo {
  const queries = work?.queries ?? [];
  return {
    id: a.id,
    name: a.name,
    icon: a.icon,
    status: "complete",
    queries,
    expectedQueryCount: queries.length,
    ...(work?.summary ? { summary: work.summary } : {}),
  };
}

function followUpChips(questions: string[] | undefined): FollowUpAction[] | undefined {
  if (!questions || questions.length === 0) return undefined;
  return questions.map((q, i) => ({
    id: `fuq-${i}`,
    label: q,
    icon: "message-circle",
    type: "follow-up-question" as const,
  }));
}

/**
 * A multi-agent deep-research thread: user question, the 6 core agents plus
 * critique running to completion, a rich markdown report, the report CTA, and
 * follow-up question chips on the report.
 */
export function deepResearchThread(opts: {
  slug: string;
  title: string;
  question: string;
  report: string;
  followUps?: string[];
  /** Per-subagent queries + summary, keyed by subagent id. Drives the Sources
   *  panel, the `[agent-id:Q#]` citations in the report, and per-agent summaries. */
  work?: DeepResearchWork;
}): StarterChat {
  const work = opts.work ?? {};
  const coreSubs = CORE_AGENTS.map((a) => completeSub(a, work[a.id]));
  // Only agents that actually ran queries count toward the headline task count.
  const ranCount = coreSubs.filter((s) => s.queries.length > 0).length;
  return {
    slug: opts.slug,
    title: opts.title,
    messages: [
      { role: "user", content: opts.question },
      {
        role: "agent",
        content: "",
        agent: {
          status: "complete",
          taskCount: ranCount > 0 ? ranCount : 3,
          subagents: [...coreSubs, completeSub(CRITIQUE_AGENT, work[CRITIQUE_AGENT.id])],
        },
      },
      { role: "sentinel", content: opts.report, followUpActions: followUpChips(opts.followUps) },
      { role: "sentinel", content: "", variant: "report-cta" },
    ],
  };
}

const DATA_ANALYSIS_AGENT = { id: "data-analysis", name: "Data Analysis Agent", icon: "bar-chart" };

/**
 * A quick-answer thread: user question, one primary analysis agent that ran a
 * handful of queries (surfaced in the Sources panel + `[agent-id:Q#]` citations),
 * a critique pass, and a substantial markdown answer with follow-up chips.
 */
export function normalThread(opts: {
  slug: string;
  title: string;
  question: string;
  answer: string;
  followUps?: string[];
  /** The agent shown as the answer's author. Citations use its id. Defaults to Data Analysis. */
  primaryAgent?: { id: string; name: string; icon: string };
  /** Queries + summary the primary agent ran. */
  work?: AgentWork;
}): StarterChat {
  const primary = opts.primaryAgent ?? DATA_ANALYSIS_AGENT;
  const subagents: SubagentInfo[] = [];
  if (opts.work?.queries?.length) subagents.push(completeSub(primary, opts.work));
  subagents.push(completeSub(CRITIQUE_AGENT));
  return {
    slug: opts.slug,
    title: opts.title,
    messages: [
      { role: "user", content: opts.question },
      {
        role: "agent",
        content: "",
        agent: { status: "complete", taskCount: 1, subagents },
      },
      { role: "sentinel", content: opts.answer, followUpActions: followUpChips(opts.followUps) },
    ],
  };
}

function chatId(userId: string, datasetId: string, slug: string): string {
  const hash = createHash("sha256").update(userId).digest("hex").slice(0, 8);
  return `sc_${hash}_${datasetId}_${slug}`;
}

/**
 * Seed a set of starter conversations for a user + dataset. Idempotent: ids are
 * derived from (userId, datasetId, slug), so re-running upserts the same rows
 * rather than duplicating. Spreads updated_at slightly so the sidebar ordering
 * is stable and the first authored chat sits on top.
 */
export function seedStarterChats(
  userId: string,
  datasetId: string,
  chats: StarterChat[],
): number {
  const s = stmts();
  const base = Date.parse("2026-05-20T10:00:00Z");
  let count = 0;

  // Replace any previously-seeded starter chats for this dataset so re-seeding
  // with updated content (slugs may have changed) swaps the set cleanly instead
  // of leaving stale threads behind.
  const hash = createHash("sha256").update(userId).digest("hex").slice(0, 8);
  try {
    getDb()
      .prepare("DELETE FROM conversations WHERE user_id = ? AND id LIKE ?")
      .run(userId, `sc_${hash}_${datasetId}_%`);
  } catch {
    // best effort — fall through to upsert
  }

  chats.forEach((chat, i) => {
    const now = base + i * 60_000;
    const messages: ChatMessage[] = chat.messages.map((m, mi) => ({
      ...m,
      id: m.id ?? `${chat.slug}-m${mi}`,
      role: m.role,
      content: m.content,
      timestamp: m.timestamp ?? now + mi * 1000,
    }));

    try {
      s.upsertFull.run({
        id: chatId(userId, datasetId, chat.slug),
        user_id: userId,
        title: chat.title,
        dataset_id: datasetId,
        folder_id: null,
        origin: "user",
        created_at: now,
        updated_at: now,
        tags: null,
        pending_actions: null,
        messages: JSON.stringify(messages),
      });
      count++;
    } catch (err) {
      console.warn(`[starter-chats] ${datasetId}/${chat.slug} failed:`, err);
    }
  });

  return count;
}
