export { buildRoutePrompt } from "@/lib/prompts/route";
import { buildRoutePrompt } from "@/lib/prompts/route";
import type { PromptModule } from "../types";

export const routePromptModule: PromptModule<Parameters<typeof buildRoutePrompt>[0], ReturnType<typeof buildRoutePrompt>> = {
  id: "chat.route",
  version: "1.0.0",
  owner: "chat",
  description: "Routes page-context-aware requests to the correct analytics agent.",
  build: buildRoutePrompt,
};
