import { Agent } from "@cursor/sdk";
import { appendFile } from "node:fs/promises";

const apiKey = process.env.CURSOR_API_KEY;
const task = process.env.TASK;
const repoUrl = process.env.REPO_URL;
const baseRef = process.env.BASE_REF || "feat/clerk-auth-merged";
const summaryPath = process.env.GITHUB_STEP_SUMMARY;

if (!apiKey) throw new Error("CURSOR_API_KEY is required");
if (!task) throw new Error("TASK is required");
if (!repoUrl) throw new Error("REPO_URL is required");

const SYSTEM_PROMPT = `
You are fixing a bug or implementing a small change in the baby-sentinel repo.

Stack: Next.js 16 (App Router), React 19, Tailwind v4, shadcn/ui, DuckDB (node-api), OpenAI, Clerk auth.

Read CLAUDE.md before editing anything. Follow it strictly. Non-negotiables:
- All frontend->backend calls go through apiFetch (src/lib/api-client.ts). Never raw fetch.
- Strictly monochrome UI. Use muted, foreground, border tokens only. No colorful badges/tags.
- Never hardcode "ecommerce". Use DEFAULT_DATASET from @/lib/datasets/constants (client) or @/lib/datasets (server).
- Dataset-scoped stores require datasetId as the first parameter.
- Stores must call invalidateCatalog() on every save/delete (except segments and folders).
- Path alias @/* maps to ./src/*.
- Package manager is pnpm.

Before opening the PR:
1. Run \`pnpm lint\` and fix any errors.
2. Run \`pnpm build\` and fix any TypeScript or build errors.
3. Keep the diff minimal. Don't refactor unrelated code.
4. Don't add comments unless the why is non-obvious.

If the task is ambiguous or you can't reproduce the bug from the description, do not guess. Open the PR with a clear note that more info is needed and what you tried.
`.trim();

const result = await Agent.prompt(
  `${SYSTEM_PROMPT}\n\nTask:\n${task}`,
  {
    apiKey,
    model: { id: "composer-2" },
    cloud: {
      repos: [{ url: repoUrl, startingRef: baseRef }],
      autoCreatePR: true,
      skipReviewerRequest: true,
    },
  }
);

const branch = result.git?.branches?.[0];
const prUrl = branch?.prUrl;
const branchName = branch?.branch ?? "";

console.log(JSON.stringify({
  status: result.status,
  durationMs: result.durationMs,
  prUrl: prUrl ?? null,
  branch: branchName || null,
}, null, 2));

if (summaryPath) {
  const md = [
    `## Cursor agent run`,
    ``,
    `- **Status:** ${result.status}`,
    `- **Duration:** ${Math.round((result.durationMs ?? 0) / 1000)}s`,
    prUrl ? `- **PR:** ${prUrl}` : `- **PR:** none opened`,
    ``,
  ].join("\n");
  await appendFile(summaryPath, md);
}

const outputPath = process.env.GITHUB_OUTPUT;
if (outputPath) {
  await appendFile(
    outputPath,
    `status=${result.status}\npr_url=${prUrl ?? ""}\nbranch=${branchName}\n`,
  );
}

if (result.status !== "finished") {
  process.exit(1);
}
