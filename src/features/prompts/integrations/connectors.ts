export { CONNECTOR_MAPPING_PROMPT } from "@/lib/prompts/connectors";
import { CONNECTOR_MAPPING_PROMPT } from "@/lib/prompts/connectors";
import type { PromptModule } from "../types";

export const connectorMappingPromptModule: PromptModule<void, string> = {
  id: "integrations.connector-mapping",
  version: "1.0.0",
  owner: "integrations",
  description: "Maps analysis requests and schema context to required connector categories.",
  build: () => CONNECTOR_MAPPING_PROMPT,
};
