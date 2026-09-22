import { auth } from "@clerk/nextjs/server";
import { randomUUID } from "crypto";
import { generateText, generateTextStream, type ModelId } from "@/lib/llm";
import { generateQueries, getAgentSpecs, retryWithError } from "@/lib/sql-generator";
import type { SubagentQuery } from "@/lib/sql-generator";
import { executeSQL, type QueryResult } from "@/lib/sql-executor";
import { getSystemContext } from "@/lib/schema";
import { getDataset, getDatasetForUser, DEFAULT_DATASET } from "@/lib/datasets";
import { generateRecommendations } from "@/lib/action-recommender";
import { extractDeepDives } from "@/lib/extract-deep-dives";
import { getAgentSummaryTemplate, getCritiqueSummaryTemplate, getReportGenerationTemplate, getQuickResponseTemplate } from "@/lib/prompts/analyze";
import type { AnalyzeSSEEvent } from "@/lib/sse-types";
import { runConcurrent } from "@/lib/concurrent";
import { z } from "zod/v4";
import { safeStringify } from "@/lib/safe-stringify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_QUERY_CONTEXT_CHARS = 40_000;
const DEEP_REPORT_TIMEOUT_MS = Number(process.env.ANALYZE_DEEP_REPORT_TIMEOUT_MS ?? 120_000);
const DEEP_REPORT_MAX_OUTPUT_TOKENS = Number(process.env.ANALYZE_DEEP_REPORT_MAX_OUTPUT_TOKENS ?? 7_000);
const RUN_LLM_AGENT_SUMMARIES = process.env.ANALYZE_DEEP_AGENT_SUMMARIES === "true";

const AnalyzeRequestSchema = z.object({
  query: z.string().min(1).max(8000),
  mode: z.enum(["quick", "deep"]),
  datasetId: z.string().optional(),
  knowledgeContext: z.string().optional(),
  pageContext: z.string().optional(),
});

function formatAgentTitle(agentId: string): string {
  return agentId
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildCompactAgentSummary(agentId: string, results: Array<{ query: SubagentQuery; result: QueryResult }>): string {
  const completed = results.filter((r) => !r.result.error);
  const failed = results.length - completed.length;
  const bullets = results
    .slice(0, 4)
    .map(({ query: q, result: r }) => {
      if (r.error) return `- ${q.description}: failed (${r.error})`;
      return `- ${q.description}: ${r.rowCount.toLocaleString()} returned rows in ${r.executionTimeMs}ms`;
    })
    .join("\n");

  return `## ${formatAgentTitle(agentId)} — Complete

### Analysis Overview

- Ran ${results.length} ${results.length === 1 ? "query" : "queries"} for this focus area.
- ${completed.length} completed successfully${failed ? `; ${failed} returned an error and was still included as context` : ""}.

### Query Checks

${bullets || "- No executable queries were available for this agent."}`;
}

// ── Main handler ──

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = AnalyzeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { query, mode, datasetId: bodyDatasetId, knowledgeContext: clientKnowledgeCtx, pageContext: clientPageCtx } = parsed.data;
  const headerDatasetId = req.headers.get("x-dataset-id");
  const datasetId = bodyDatasetId || headerDatasetId || DEFAULT_DATASET;
  if (!getDatasetForUser(datasetId, userId)) return Response.json({ error: "Not found" }, { status: 404 });
  const modelId = (req.headers.get("x-model-id") ?? undefined) as ModelId | undefined;
  const ds = getDataset(datasetId);
  const systemContext = getSystemContext(datasetId);
  const requestId = req.headers.get("x-railway-request-id") ?? randomUUID();
  const startedAt = Date.now();

  function log(message: string, extra?: Record<string, unknown>) {
    console.log(`[analyze:${requestId}] ${message}`, extra ?? "");
  }

  function logError(message: string, err: unknown, extra?: Record<string, unknown>) {
    console.error(`[analyze:${requestId}] ${message}`, {
      error: err instanceof Error ? err.message : String(err),
      ...extra,
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      function send(event: AnalyzeSSEEvent) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(safeStringify(event) + "\n"));
        } catch {
          closed = true;
        }
      }

      try {
        log("start", { mode, datasetId, modelId, queryLength: query.length });
        // Phase 1: Generate SQL queries
        send({ type: "phase", phase: "generating_sql" });

        const plannedDeepAgents = mode === "deep" ? getAgentSpecs(datasetId) : [];
        if (plannedDeepAgents.length > 0) {
          send({
            type: "plan",
            agents: plannedDeepAgents.map((agent) => ({
              id: agent.id,
              queryCount: agent.queries.length,
              tasks: agent.queries.map((task, queryIndex) => ({
                queryIndex,
                description: task.description,
              })),
            })),
          });
        }

        let sqlHeartbeat: ReturnType<typeof setInterval> | null = setInterval(() => send({ type: "ping" }), 10_000);
        const queries = await generateQueries(query, mode, datasetId, modelId, clientPageCtx).finally(() => {
          if (sqlHeartbeat) { clearInterval(sqlHeartbeat); sqlHeartbeat = null; }
        });
        log("queries generated", { mode, count: queries.length });

        if (queries.length === 0) {
          send({ type: "phase", phase: "synthesizing" });
          await streamDirectResponse(query, controller, encoder, datasetId, modelId, clientKnowledgeCtx);
          send({ type: "done" });
          log("done direct fallback", { elapsedMs: Date.now() - startedAt });
          controller.close();
          return;
        }

        // Group queries by agent
        const agentGroups = new Map<string, SubagentQuery[]>();
        for (const q of queries) {
          const existing = agentGroups.get(q.subagentId) || [];
          existing.push(q);
          agentGroups.set(q.subagentId, existing);
        }

        // Send one "sql" event per agent with all its queries
        for (const [agentId, agentQueries] of agentGroups) {
          send({
            type: "sql",
            subagentId: agentId,
            queries: agentQueries.map((q) => ({
              sql: q.sql,
              description: q.description,
              queryIndex: q.queryIndex,
            })),
          });
        }

        // Send plan event — tells frontend expected agent structure. In deep
        // mode the full plan is emitted before SQL generation, so don't replace
        // it with a smaller set if a slow agent timed out.
        if (mode !== "deep") {
          send({
            type: "plan",
            agents: Array.from(agentGroups.entries()).map(([agentId, agentQueries]) => ({
              id: agentId,
              queryCount: agentQueries.length,
              tasks: agentQueries.map((q) => ({
                queryIndex: q.queryIndex,
                description: q.description,
              })),
            })),
          });
        }

        if (mode === "deep" && plannedDeepAgents.length > 0) {
          const generatedAgentIds = new Set(agentGroups.keys());
          for (const agent of plannedDeepAgents) {
            if (generatedAgentIds.has(agent.id)) continue;
            send({
              type: "result",
              subagentId: agent.id,
              rowCount: 0,
              timeMs: 0,
              columns: [],
              preview: [],
              error: "SQL generation timed out or returned no executable queries",
            });
          }
        }

        // Phase 2: Execute queries — agents in parallel, queries within each sequential
        send({ type: "phase", phase: "executing" });

        type AgentResult = {
          query: SubagentQuery;
          result: QueryResult;
        };

        const allAgentResults: AgentResult[][] = await Promise.all(
          Array.from(agentGroups.entries()).map(async ([, agentQueries]) => {
            const agentResults: AgentResult[] = [];

            for (const q of agentQueries) {
              let result = await executeSQL(q.sql, datasetId);

              if (result.error) {
                try {
                  const fixedSQL = await retryWithError(
                    query,
                    q.sql,
                    result.error,
                    datasetId,
                    modelId,
                    mode === "deep" ? 45_000 : undefined,
                  );
                  if (fixedSQL && fixedSQL !== "UNSUPPORTED_QUERY") {
                    q.sql = fixedSQL;
                    result = await executeSQL(fixedSQL, datasetId);
                  }
                } catch {
                  // Retry failed (e.g. network error) — continue with original error
                }
              }

              agentResults.push({ query: q, result });

              // Stream per-query result
              send({
                type: "query_result",
                subagentId: q.subagentId,
                queryIndex: q.queryIndex,
                rowCount: result.rowCount,
                timeMs: result.executionTimeMs,
                columns: result.columns,
                preview: result.rows.slice(0, 20),
                error: result.error || undefined,
              });
            }

            // Signal this agent's queries are all done
            send({ type: "result", subagentId: agentQueries[0].subagentId });

            return agentResults;
          })
        );

        // Flatten for synthesis
        const allResults = allAgentResults.flat();
        log("queries executed", {
          resultCount: allResults.length,
          errorCount: allResults.filter((r) => r.result.error).length,
          elapsedMs: Date.now() - startedAt,
        });

        // Phase 2.5 (deep mode only): keep the research panel moving without
        // blocking the final report. Detailed LLM summaries can be enabled for
        // local demos, but production defaults to compact summaries so the first
        // report token arrives well inside platform request limits.
        if (mode === "deep" && !RUN_LLM_AGENT_SUMMARIES) {
          for (const agentId of agentGroups.keys()) {
            const agentResults = allResults.filter((r) => r.query.subagentId === agentId);
            send({
              type: "summary",
              subagentId: agentId,
              content: buildCompactAgentSummary(agentId, agentResults),
            });
          }
          send({
            type: "sql",
            subagentId: "critique",
            queries: [{
              sql: "-- Validate query coverage and preserve failed-query caveats",
              description: "Reviewing generated evidence and failed-query caveats",
              queryIndex: 0,
            }],
          });
          send({
            type: "result",
            subagentId: "critique",
            rowCount: 0,
            timeMs: 0,
            columns: [],
            preview: [],
          });
          send({
            type: "summary",
            subagentId: "critique",
            content: `## Critique — Complete

### Validation Summary

- Reviewed ${allResults.length} query ${allResults.length === 1 ? "result" : "results"} across ${agentGroups.size} active ${agentGroups.size === 1 ? "agent" : "agents"}.
- ${allResults.filter((r) => r.result.error).length} query ${allResults.filter((r) => r.result.error).length === 1 ? "error was" : "errors were"} retained as caveats for the final report.
- The report synthesis will cite available SQL evidence and avoid treating failed queries as confirmed facts.`,
          });
          log("compact summaries emitted", {
            summaryCount: agentGroups.size,
            elapsedMs: Date.now() - startedAt,
          });
        } else if (mode === "deep") {
          // Build per-agent data context (all queries for that agent)
          const summaryFactories = Array.from(agentGroups.keys()).map((agentId) => () => {
            const agentResults = allResults.filter((r) => r.query.subagentId === agentId);
            const allErrored = agentResults.every((r) => r.result.error);
            if (allErrored) return Promise.resolve(null);

            const dataContext = agentResults
              .map(({ query: q, result: r }, i) => {
                if (r.error) return `Query ${i + 1} (${q.description}): FAILED — ${r.error}`;
                return `Query ${i + 1} (${q.description}):\nSQL: ${q.sql}\nResults (${r.rowCount} rows, ${r.executionTimeMs}ms):\n${safeStringify(r.rows.slice(0, 30), 2)}`;
              })
              .join("\n\n");

            const fullContext = `User question: "${query}"\n\n${dataContext}`;
            const agentQueryDescs = ds.queryDescriptions[agentId] || [];
            const template = getAgentSummaryTemplate(ds, agentId, agentQueryDescs);

            return generateText(`${template}\n\n--- QUERY RESULTS ---\n${fullContext}`, { modelId, timeoutMs: 60_000, label: `${agentId} summary` })
              .then((text) => ({
                subagentId: agentId,
                summary: text,
              }))
              .catch(() => null);
          });

          const summaryHeartbeat = setInterval(() => send({ type: "ping" }), 10_000);
          const summaries = await runConcurrent(summaryFactories, 3).finally(() => clearInterval(summaryHeartbeat));

          for (const s of summaries) {
            if (s) {
              send({ type: "summary", subagentId: s.subagentId, content: s.summary });
            }
          }
          log("summaries generated", {
            summaryCount: summaries.filter(Boolean).length,
            elapsedMs: Date.now() - startedAt,
          });

          // Generate critique agent
          const allSummaryText = summaries
            .filter(Boolean)
            .map((s) => s!.summary)
            .join("\n\n---\n\n");

          const allResultsContextFull = allResults
            .map(({ query: q, result: r }) => {
              if (r.error) return `${q.subagentId} Q${q.queryIndex + 1}: FAILED — ${r.error}`;
              return `${q.subagentId} Q${q.queryIndex + 1} (${q.description}): ${r.rowCount} rows, ${r.executionTimeMs}ms\nTop results: ${safeStringify(r.rows.slice(0, 10), 2)}`;
            })
            .join("\n\n");
          const allResultsContext = allResultsContextFull.length > MAX_QUERY_CONTEXT_CHARS
            ? allResultsContextFull.slice(0, MAX_QUERY_CONTEXT_CHARS) + "\n\n[... truncated ...]"
            : allResultsContextFull;

          // Activate critique agent in frontend
          send({
            type: "sql",
            subagentId: "critique",
            queries: [{ sql: "-- Validate analysis quality and cross-check findings", description: "Reviewing and validating analysis outputs", queryIndex: 0 }],
          });

          try {
            const activeAgentIds = Array.from(agentGroups.keys());
            const critiqueHeartbeat = setInterval(() => send({ type: "ping" }), 10_000);
            let critiqueText = "";
            try {
              critiqueText = await generateText(
                `${getCritiqueSummaryTemplate(ds, activeAgentIds)}\n\n--- USER QUERY ---\n"${query}"\n\n--- AGENT SUMMARIES ---\n${allSummaryText}\n\n--- RAW RESULTS ---\n${allResultsContext}`,
                { modelId, timeoutMs: 60_000, label: "critique summary" },
              );
            } finally {
              clearInterval(critiqueHeartbeat);
            }

            send({
              type: "result",
              subagentId: "critique",
              rowCount: 0,
              timeMs: 0,
              columns: [],
              preview: [],
            });

            send({
              type: "summary",
              subagentId: "critique",
              content: critiqueText,
            });
            log("critique generated", { elapsedMs: Date.now() - startedAt });
          } catch {
            send({
              type: "result",
              subagentId: "critique",
              rowCount: 0,
              timeMs: 0,
              columns: [],
              preview: [],
              error: "Critique generation failed",
            });
          }
        }

        // Phase 3: Stream response
        send({ type: "phase", phase: "synthesizing" });

        // Build query context with citation IDs: [agent-id:Q#]
        // Track per-agent query numbering for citation references
        const agentQueryCounters = new Map<string, number>();
        const queryContextFull = allResults
          .map(({ query: q, result: r }) => {
            const count = (agentQueryCounters.get(q.subagentId) || 0) + 1;
            agentQueryCounters.set(q.subagentId, count);
            const citationId = `[${q.subagentId}:Q${count}]`;
            if (r.error) {
              return `${citationId} (${q.description}): FAILED — ${r.error}. Use estimates or related data to still visualize this metric.`;
            }
            const preview = safeStringify(r.rows.slice(0, 50), 2);
            return `${citationId} (${q.description}):\nSQL: ${q.sql}\nResults (${r.rowCount} rows, ${r.executionTimeMs}ms):\n${preview}`;
          })
          .join("\n\n");
        const queryContext = queryContextFull.length > MAX_QUERY_CONTEXT_CHARS
          ? queryContextFull.slice(0, MAX_QUERY_CONTEXT_CHARS) + "\n\n[... truncated for memory efficiency ...]"
          : queryContextFull;

        const knowledgeContext = clientKnowledgeCtx || "";
        let recPromise: Promise<void> | null = null;

        if (mode === "deep") {
          // Deep mode: stream the report as the main response
          let reportText = "";
          const reportStartedAt = Date.now();
          const debugCloseAfterChars = process.env.NODE_ENV !== "production"
            ? Number(process.env.ANALYZE_DEBUG_CLOSE_REPORT_AFTER_CHARS ?? 0)
            : 0;
          const reportHeartbeat = setInterval(() => send({ type: "ping" }), 10_000);
          try {
            const reportStream = await generateTextStream(
              `${getReportGenerationTemplate(ds)}\n\n--- USER QUERY ---\n"${query}"\n\n${knowledgeContext ? `--- CONTEXT ---\n${knowledgeContext}\n\n` : ""}--- ALL QUERY RESULTS (use [agent-id:Q#] citations) ---\n${queryContext}`,
              { modelId, label: "Deep research report generation", timeoutMs: DEEP_REPORT_TIMEOUT_MS, maxOutputTokens: DEEP_REPORT_MAX_OUTPUT_TOKENS },
            );

            for await (const text of reportStream) {
              reportText += text;
              send({ type: "text", delta: text });
              if (debugCloseAfterChars > 0 && reportText.length >= debugCloseAfterChars) {
                log("debug close before done", {
                  chars: reportText.length,
                  threshold: debugCloseAfterChars,
                  elapsedMs: Date.now() - startedAt,
                });
                return;
              }
            }
          } catch (err) {
            logError("deep report stream failed", err, {
              partialChars: reportText.length,
              elapsedMs: Date.now() - startedAt,
              reportElapsedMs: Date.now() - reportStartedAt,
            });
            send({
              type: "error",
              message: "Final report generation stream was interrupted before completion. Partial output was preserved.",
            });
            return;
          } finally {
            clearInterval(reportHeartbeat);
          }
          log("deep report streamed", {
            chars: reportText.length,
            elapsedMs: Date.now() - startedAt,
            reportElapsedMs: Date.now() - reportStartedAt,
          });

          // Clean report and extract deep-dives as follow-up actions
          const stripped = reportText
            .replace(/^```(?:markdown)?\n?/i, "")
            .replace(/\n?```$/i, "")
            .trim();
          const { actions: deepDiveActions, cleanedReport } = extractDeepDives(stripped);
          send({ type: "report", content: cleanedReport });

          // Use extracted deep-dives directly — no extra LLM call needed
          if (deepDiveActions.length > 0) {
            send({ type: "recommendations", actions: deepDiveActions });
          }
        } else {
          // Quick mode: stream concise response
          const responsePrompt = getQuickResponseTemplate(systemContext, knowledgeContext, ds, queryContext, query);

          const genStream = await generateTextStream(responsePrompt, { modelId });

          let quickResponseText = "";
          for await (const text of genStream) {
            quickResponseText += text;
            send({ type: "text", delta: text });
          }

          // Fire recommendations in background (don't block done event)
          recPromise = generateRecommendations({
            userQuery: query,
            responseText: quickResponseText.slice(0, 3000),
            queryResults: queryContext.slice(0, 2000),
            mode: "quick",
            modelId,
            domain: ds.label,
          }).then((recs) => {
            if (recs.actions.length > 0) {
              send({ type: "recommendations", actions: recs.actions });
            }
          }).catch((err) => console.error("[analyze] recommendation generation failed:", err));
        }

        // Send done immediately — recommendations arrive as a late event
        send({ type: "done" });
        log("done", { mode, elapsedMs: Date.now() - startedAt });

        // Keep stream open until recommendations resolve (or timeout after 20s)
        if (recPromise) {
          await Promise.race([recPromise, new Promise((r) => setTimeout(r, 20000))]);
        }
      } catch (err) {
        logError("Analyze error", err, { elapsedMs: Date.now() - startedAt });
        send({
          type: "error",
          message: err instanceof Error ? err.message : "Unknown error",
        });
      } finally {
        if (!closed) {
          closed = true;
          controller.close();
          log("closed", { elapsedMs: Date.now() - startedAt });
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}

async function streamDirectResponse(
  query: string,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  datasetId?: string,
  modelId?: ModelId,
  knowledgeContext?: string,
) {
  const systemCtx = getSystemContext(datasetId || DEFAULT_DATASET);
  const fullPrompt = knowledgeContext
    ? `${systemCtx}\n\n--- ADDITIONAL CONTEXT ---\n${knowledgeContext}\n--- END CONTEXT ---`
    : systemCtx;
  const genStream = await generateTextStream(query, {
    modelId,
    systemPrompt: fullPrompt,
  });

  for await (const text of genStream) {
    controller.enqueue(
      encoder.encode(JSON.stringify({ type: "text", delta: text }) + "\n")
    );
  }
}
