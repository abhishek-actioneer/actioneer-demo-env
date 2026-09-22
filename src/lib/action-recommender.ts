import { generateText, type ModelId } from "./llm";
import { buildRecommendationPrompt } from "./prompts/actions";
import type { FollowUpAction } from "./types";

export interface RecommendationInput {
  userQuery: string;
  responseText: string;
  queryResults?: string;
  mode: "quick" | "deep" | "direct";
  modelId?: ModelId;
  /** Domain label from the active dataset (e.g. "ecommerce retail", "food delivery logistics") */
  domain?: string;
}

export interface RecommendationOutput {
  actions: FollowUpAction[];
}

export async function generateRecommendations(
  input: RecommendationInput
): Promise<RecommendationOutput> {
  const userPrompt = [
    `User query: "${input.userQuery}"`,
    `Analysis mode: ${input.mode}`,
    `Analysis response (truncated):\n${input.responseText.slice(0, 3000)}`,
    input.queryResults ? `Raw query results (abbreviated):\n${input.queryResults.slice(0, 2000)}` : "",
  ].filter(Boolean).join("\n\n");

  try {
    const prompt = buildRecommendationPrompt(input.domain);
    const rawText = await generateText(`${prompt}\n\n${userPrompt}`, {
      modelId: input.modelId,
      jsonMode: true,
    });

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      const match = rawText.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : {};
    }

    return transformToOutput(parsed);
  } catch (err) {
    console.error("[action-recommender] generation failed:", err);
    return { actions: [] };
  }
}

const VALID_TYPES = new Set<string>([
  "follow-up-question",
  "create-segment",
  "create-segment-clevertap",
  "create-segment-firebase",
  "create-segment-bigquery",
  "save-playbook",
  "save-memory",
  "view-in-store",
]);

function transformToOutput(raw: Record<string, unknown>): RecommendationOutput {
  const steps = Array.isArray(raw.nextSteps) ? raw.nextSteps : [];

  const actions: FollowUpAction[] = steps
    .filter((s: Record<string, unknown>) => typeof s.label === "string" && VALID_TYPES.has(String(s.type)))
    .slice(0, 5)
    .map((s: Record<string, unknown>, i: number) => ({
      id: `next-step-${i}`,
      label: String(s.label),
      icon: String(s.icon || "message-circle"),
      type: String(s.type) as FollowUpAction["type"],
      payload: (s.payload as Record<string, unknown>) ?? undefined,
    }));

  return { actions };
}
