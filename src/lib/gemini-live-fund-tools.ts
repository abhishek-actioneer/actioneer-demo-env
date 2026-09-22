import {
  getFundsIndiaFundDetails,
  searchFundsIndiaFunds,
  type FundsIndiaFundSearchArgs,
} from "./fundsindia-catalogue";
import type { VoiceCustomerContext } from "./voice-customer-context";

type JsonObject = Record<string, unknown>;

export interface GeminiLiveFunctionCall {
  id?: string;
  name: string;
  args: JsonObject;
}

export interface GeminiLiveFunctionResponse {
  id?: string;
  name: string;
  response: JsonObject;
}

export interface GeminiLiveToolExecution {
  responses: GeminiLiveFunctionResponse[];
  metrics: Array<{
    id?: string;
    name: string;
    lookupLatencyMs: number;
    resultCount?: number;
    error?: string;
  }>;
}

const SEARCH_FUNDS_TOOL = "search_fundsindia_funds";
const GET_FUND_DETAILS_TOOL = "get_fundsindia_fund_details";
const FUND_TOOL_NAMES = new Set([SEARCH_FUNDS_TOOL, GET_FUND_DETAILS_TOOL]);

function objectValue(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function boolValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function arrayValue(value: unknown): JsonObject[] {
  return Array.isArray(value)
    ? value.filter((item): item is JsonObject => !!item && typeof item === "object" && !Array.isArray(item))
    : [];
}

function searchArgs(rawArgs: JsonObject): FundsIndiaFundSearchArgs {
  return {
    query: stringValue(rawArgs.query),
    category: stringValue(rawArgs.category),
    risk: stringValue(rawArgs.risk),
    riskLevel: stringValue(rawArgs.risk_level) || stringValue(rawArgs.riskLevel),
    sipRequired: boolValue(rawArgs.sip_required) ?? boolValue(rawArgs.sipRequired),
    elssOnly: boolValue(rawArgs.elss_only) ?? boolValue(rawArgs.elssOnly),
    minRating: numberValue(rawArgs.min_rating) ?? numberValue(rawArgs.minRating),
    maxSipMinimum: numberValue(rawArgs.max_sip_minimum) ?? numberValue(rawArgs.maxSipMinimum),
    maxResults: numberValue(rawArgs.max_results) ?? numberValue(rawArgs.maxResults),
  };
}

export function fundsIndiaToolSystemInstruction(): string {
  return [
    "FundsIndia catalogue tool rules:",
    "- You have access to server-side FundsIndia mutual-fund catalogue tools. The full catalogue is not in this prompt.",
    "- Mandatory: when the caller asks about actual funds, fund names, options, SIP availability, ELSS, fund category, risk level, NAV, returns, or minimum investment, call the catalogue tool before answering.",
    "- Do not answer fund-option questions from general knowledge. Generic answers like 'debt funds are lower risk' are incomplete unless you also call the tool and name specific matching FundsIndia schemes.",
    "- Use search_fundsindia_funds for discovery questions, such as low-risk SIPs, ELSS funds, debt funds, liquid funds, or funds from a specific AMC.",
    "- Use get_fundsindia_fund_details when the caller names a specific fund or scheme code.",
    "- If the caller asks for options or examples, include 3 to 5 specific fund names from the tool results, along with short factual fields such as category, risk, SIP minimum, and 1Y/3Y/5Y returns if available.",
    "- Present catalogue facts briefly. Do not provide personalized investment advice or claim suitability. Offer to connect them with an advisor for recommendations.",
  ].join("\n");
}

export function withFundsIndiaToolInstruction(systemPrompt: string): string {
  if (systemPrompt.includes("FundsIndia catalogue tool rules:")) return systemPrompt;
  return `${systemPrompt.trim()}\n\n${fundsIndiaToolSystemInstruction()}`;
}

export function shouldEnableFundsIndiaTools(input?: {
  datasetId?: string;
  customerContext?: VoiceCustomerContext;
  systemPrompt?: string;
}): boolean {
  const datasetId = input?.datasetId || input?.customerContext?.datasetId;
  if (datasetId === "fundsindia") return true;
  const prompt = input?.systemPrompt || "";
  return /\bFundsIndia\b/i.test(prompt);
}

export function geminiLiveFundsToolDeclarations(): JsonObject[] {
  return [
    {
      name: SEARCH_FUNDS_TOOL,
      description: "Search the server-side FundsIndia mutual-fund catalogue. Use this for factual questions about funds, SIP availability, ELSS/tax-saving funds, categories, risk levels, NAV, returns, and minimum investment amounts. Do not use it for personalized investment advice.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Natural-language search query or fund/AMC/category terms, for example 'low risk SIP', 'ELSS tax saving', 'HDFC liquid', or a fund name.",
          },
          category: {
            type: "string",
            description: "Optional category filter, for example Equity, Debt, Liquid, Tax-Saving/ELSS, Hybrid, Gold, or Silver.",
          },
          risk_level: {
            type: "string",
            enum: ["conservative", "balanced", "aggressive"],
            description: "Optional broad risk bucket requested by the caller.",
          },
          risk: {
            type: "string",
            description: "Optional exact risk label, for example Low, Low to Moderate, Moderate, Moderately High, High, or Very High.",
          },
          sip_required: {
            type: "boolean",
            description: "Set true when the caller asks for SIP options or wants SIP availability.",
          },
          elss_only: {
            type: "boolean",
            description: "Set true when the caller asks for ELSS or tax-saving mutual funds.",
          },
          min_rating: {
            type: "number",
            description: "Optional minimum FundsIndia rating from 0 to 5.",
          },
          max_sip_minimum: {
            type: "number",
            description: "Optional maximum SIP minimum amount in rupees.",
          },
          max_results: {
            type: "number",
            description: "Number of fund matches to return. Use 3 to 5 for voice answers.",
          },
        },
      },
    },
    {
      name: GET_FUND_DETAILS_TOOL,
      description: "Fetch factual details for one FundsIndia mutual-fund scheme by scheme code, or by fund name if the scheme code is not known.",
      parameters: {
        type: "object",
        properties: {
          scheme_code: {
            type: "string",
            description: "FundsIndia scheme code if known.",
          },
          query: {
            type: "string",
            description: "Fund name or search text if scheme code is not known.",
          },
        },
      },
    },
  ];
}

export function geminiLiveFundsTools(): JsonObject[] {
  return [{ functionDeclarations: geminiLiveFundsToolDeclarations() }];
}

export function isGeminiLiveFundToolCall(call: GeminiLiveFunctionCall): boolean {
  return FUND_TOOL_NAMES.has(call.name);
}

export function extractGeminiLiveFunctionCalls(event: JsonObject): GeminiLiveFunctionCall[] {
  const toolCall = objectValue(event.toolCall) ?? objectValue(event.tool_call);
  const functionCalls = arrayValue(toolCall?.functionCalls ?? toolCall?.function_calls);
  const calls: GeminiLiveFunctionCall[] = [];

  for (const call of functionCalls) {
    const name = stringValue(call.name);
    if (!name) continue;
    calls.push({
      id: stringValue(call.id),
      name,
      args: objectValue(call.args) ?? {},
    });
  }

  return calls;
}

export function geminiLiveToolResponsePayload(responses: GeminiLiveFunctionResponse[]): JsonObject {
  return {
    toolResponse: {
      functionResponses: responses,
    },
  };
}

export function executeGeminiLiveFundToolCalls(calls: GeminiLiveFunctionCall[]): GeminiLiveToolExecution {
  const responses: GeminiLiveFunctionResponse[] = [];
  const metrics: GeminiLiveToolExecution["metrics"] = [];

  for (const call of calls) {
    const startedAt = Date.now();
    try {
      if (call.name === SEARCH_FUNDS_TOOL) {
        const result = searchFundsIndiaFunds(searchArgs(call.args));
        const lookupLatencyMs = Date.now() - startedAt;
        responses.push({
          id: call.id,
          name: call.name,
          response: { result },
        });
        metrics.push({
          id: call.id,
          name: call.name,
          lookupLatencyMs,
          resultCount: result.returned,
        });
        continue;
      }

      if (call.name === GET_FUND_DETAILS_TOOL) {
        const result = getFundsIndiaFundDetails({
          schemeCode: stringValue(call.args.scheme_code) || stringValue(call.args.schemeCode),
          query: stringValue(call.args.query),
        });
        const lookupLatencyMs = Date.now() - startedAt;
        responses.push({
          id: call.id,
          name: call.name,
          response: { result },
        });
        metrics.push({
          id: call.id,
          name: call.name,
          lookupLatencyMs,
          resultCount: result.fund ? 1 : result.alternatives?.length ?? 0,
        });
        continue;
      }

      responses.push({
        id: call.id,
        name: call.name,
        response: { error: `Unsupported function ${call.name}` },
      });
      metrics.push({
        id: call.id,
        name: call.name,
        lookupLatencyMs: Date.now() - startedAt,
        error: "unsupported_function",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tool execution failed";
      responses.push({
        id: call.id,
        name: call.name,
        response: { error: message },
      });
      metrics.push({
        id: call.id,
        name: call.name,
        lookupLatencyMs: Date.now() - startedAt,
        error: message,
      });
    }
  }

  return { responses, metrics };
}
