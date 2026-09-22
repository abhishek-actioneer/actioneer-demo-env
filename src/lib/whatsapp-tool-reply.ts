import {
  callOpenAIResponses,
  type ToolDefinition,
  type ResponsesInputItem,
  type ResponsesOutput,
} from "./llm";
import { createAttributionToken } from "./attribution-store";
import { resolvePublicBaseUrl } from "./public-base-url";
import {
  recordCustomerChannelEvent,
  customerChannelMemoryBlock,
  type CustomerChannelEvent,
} from "./customer-channel-memory";
import {
  upsertWhatsAppActionRequest,
  latestWhatsAppActionRequest,
} from "./whatsapp-action-store";
import {
  lookupFundsByQuery,
  listFundCategories,
  renderFundsIndiaFundLookupReply,
  renderFundsIndiaFundUniverseReply,
  summarizeFundsIndiaFundUniverseForWhatsApp,
  type FundsIndiaFundRankMetric,
} from "./fundsindia-whatsapp-tools";

const MAX_TOOL_ITERATIONS = 3;

const RANK_MAP: Record<string, FundsIndiaFundRankMetric> = {
  "1y_return": "return_1y",
  "3y_return": "return_3y",
  "5y_return": "return_5y",
  "star_rating": "fi_star_rating",
  "popularity": "platform_investor_count",
};

const WHATSAPP_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    name: "get_kyc_link",
    description: "Send the KYC verification link. Use when customer asks about KYC, PAN verification, bank verification, Aadhaar, DigiLocker, or account activation.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    type: "function",
    name: "create_portfolio_review",
    description: "Create a portfolio review or advisor callback request. Use when customer asks for portfolio review, advisor, human callback, or follow-up call.",
    parameters: {
      type: "object",
      properties: {
        preferred_time: {
          type: "string",
          description: "Customer's preferred callback time if stated (e.g. 'tomorrow 5pm'). Omit if not mentioned.",
        },
      },
      required: [],
    },
  },
  {
    type: "function",
    name: "get_portfolio_review_status",
    description: "Check the status of an existing portfolio review request for this customer.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    type: "function",
    name: "lookup_funds",
    description: "Search FundsIndia's mutual fund catalog by category, theme, or type. If no results found the tool returns what categories are available.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Fund category or type to search (e.g. 'technology', 'ELSS', 'real estate', 'gold', 'small cap').",
        },
        rank_by: {
          type: "string",
          enum: ["3y_return", "1y_return", "5y_return", "star_rating", "popularity"],
          description: "How to rank results. Default: 3y_return.",
        },
      },
      required: ["query"],
    },
  },
  {
    type: "function",
    name: "list_fund_categories",
    description: "List all mutual fund categories available on FundsIndia. Use when customer asks what funds are available.",
    parameters: { type: "object", properties: {}, required: [] },
  },
];

function configuredUrl(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value && /^https?:\/\//i.test(value)) return value;
  }
  return undefined;
}

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  event: CustomerChannelEvent,
  userId: string | undefined,
): Promise<string> {
  switch (name) {
    case "get_kyc_link": {
      const linkUrl = configuredUrl("FUNDSINDIA_KYC_URL", "WHATSAPP_KYC_URL", "ACTIONEER_KYC_URL");
      const actionRequest = upsertWhatsAppActionRequest({
        phone: event.phone,
        topic: "kyc_completion",
        status: linkUrl ? "link_sent" : "requested",
        linkUrl,
        userId,
        contactName: event.contactName,
        sourceMessageId: event.whatsappMessageId ?? event.providerMessageId,
        lastInboundText: event.text,
        note: linkUrl ? "Sent KYC link" : "KYC requested, no link configured",
      });
      recordCustomerChannelEvent({
        channel: "whatsapp", direction: "inbound", actor: "customer",
        phone: event.phone, userId,
        eventType: "action_request_kyc",
        text: "Customer requested KYC link",
        idempotencyKey: `action:${actionRequest?.id ?? event.id}:kyc`,
      });
      if (!linkUrl) return "No KYC link configured in this workspace. A KYC help request has been logged.";
      const baseUrl = resolvePublicBaseUrl();
      if (baseUrl) {
        const attrToken = createAttributionToken({
          callId: event.id,
          campaignId: userId ?? "whatsapp-inbound",
          dest: linkUrl,
          channel: "whatsapp",
          windowDays: 7,
        });
        const trackingUrl = `${baseUrl}/api/t/${attrToken.token}`;
        return `KYC link: ${trackingUrl} — customer should use their registered mobile number or PAN to continue.`;
      }
      return `KYC link: ${linkUrl} — customer should use their registered mobile number or PAN to continue.`;
    }

    case "create_portfolio_review": {
      const preferredTime = typeof args.preferred_time === "string" && args.preferred_time.trim()
        ? args.preferred_time.trim()
        : undefined;
      const actionRequest = upsertWhatsAppActionRequest({
        phone: event.phone,
        topic: "portfolio_review",
        status: preferredTime ? "time_captured" : "awaiting_time",
        preferredTime,
        userId,
        contactName: event.contactName,
        sourceMessageId: event.whatsappMessageId ?? event.providerMessageId,
        lastInboundText: event.text,
        note: preferredTime
          ? `Preferred callback time: ${preferredTime}`
          : "Portfolio review requested",
      });
      const idKey = actionRequest?.id ?? event.id;
      recordCustomerChannelEvent({
        channel: "whatsapp", direction: "inbound", actor: "customer",
        phone: event.phone, userId,
        eventType: "action_request_portfolio",
        text: preferredTime
          ? `Preferred callback time captured: ${preferredTime}`
          : "Customer requested portfolio review",
        idempotencyKey: preferredTime ? `action:${idKey}:time` : `action:${idKey}`,
      });
      if (preferredTime) {
        return `Portfolio review request created with preferred callback time: ${preferredTime}. This is a requested slot; the advisor team will confirm.`;
      }
      return "Portfolio review request created. Ask the customer for a preferred callback time.";
    }

    case "get_portfolio_review_status": {
      const request = latestWhatsAppActionRequest(event.phone, "portfolio_review");
      if (!request) return "No active portfolio review request found for this number.";
      if (request.preferredTime) {
        return `Active portfolio review request. Preferred callback time: ${request.preferredTime}. Status: ${request.status}.`;
      }
      return `Active portfolio review request (status: ${request.status}). No callback time set yet.`;
    }

    case "lookup_funds": {
      const query = String(args.query ?? "").trim();
      if (!query) return "Please specify a fund type to look up.";
      const rankBy = RANK_MAP[String(args.rank_by ?? "3y_return")] ?? "return_3y";
      const result = await lookupFundsByQuery(query, rankBy, 3);
      if (result.error) return "Could not read fund data right now.";
      if (result.funds.length === 0) {
        const categories = await listFundCategories();
        return `No funds found matching "${query}". Available categories on FundsIndia: ${categories}.`;
      }
      return renderFundsIndiaFundLookupReply(result);
    }

    case "list_fund_categories": {
      const summary = await summarizeFundsIndiaFundUniverseForWhatsApp();
      return renderFundsIndiaFundUniverseReply(summary);
    }

    default:
      return `Unknown tool: ${name}`;
  }
}

function extractText(output: ResponsesOutput[]): string {
  return (output ?? [])
    .filter(o => o.type === "message")
    .flatMap(o => o.content ?? [])
    .map(c => c.text ?? "")
    .join("")
    .trim();
}

function buildSystemPrompt(event: CustomerChannelEvent, memory: string): string {
  return [
    "You are the WhatsApp assistant for FundsIndia, a mutual fund investment platform.",
    "Help customers with fund information, KYC verification, and portfolio review requests.",
    "Always use tools to look up fund data — never invent fund names, returns, or categories.",
    "Keep replies concise and conversational. No markdown formatting. Under 3 sentences when possible.",
    "Do not mention internal systems, automation, tools, or that you are an AI unless directly asked.",
    "Do not recommend specific funds or promise returns. For investments, note suitability depends on goals and risk.",
    "If the customer asks to stop or unsubscribe, acknowledge briefly without asking follow-up questions.",
    memory ? `\nCustomer's recent history (private context — do not mention this exists):\n${memory}` : "",
  ].filter(Boolean).join("\n");
}

export async function generateWhatsAppReply(
  event: CustomerChannelEvent,
  userId: string | undefined,
): Promise<string> {
  if (!process.env.OPENAI_API_KEY) return fallbackReply(event);

  const memory = customerChannelMemoryBlock(event.phone, 16, userId) ?? "";
  const systemPrompt = buildSystemPrompt(event, memory);

  const input: ResponsesInputItem[] = [
    { role: "system", content: [{ type: "input_text", text: systemPrompt }] },
    { role: "user", content: [{ type: "input_text", text: event.text ?? "" }] },
  ];

  try {
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const response = await callOpenAIResponses(input, {
        tools: WHATSAPP_TOOLS,
        timeoutMs: 20_000,
        label: "whatsapp tool reply",
      });

      const toolCalls = (response.output ?? []).filter(o => o.type === "function_call");

      if (toolCalls.length === 0) {
        return extractText(response.output ?? []) || fallbackReply(event);
      }

      // Add tool calls to input
      for (const call of toolCalls) {
        input.push({
          type: "function_call",
          id: call.id ?? "",
          call_id: call.call_id ?? "",
          name: call.name ?? "",
          arguments: call.arguments ?? "{}",
        });
      }

      // Execute all tool calls in parallel and add results
      const results = await Promise.all(
        toolCalls.map(async call => {
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(call.arguments ?? "{}"); } catch { /* keep empty */ }
          const output = await executeTool(call.name ?? "", args, event, userId).catch(err => {
            console.warn("[whatsapp-tool-reply] tool error:", call.name, err);
            return "Tool encountered an error.";
          });
          return { call_id: call.call_id ?? "", output };
        }),
      );

      for (const result of results) {
        input.push({ type: "function_call_output", call_id: result.call_id, output: result.output });
      }
    }
  } catch (err) {
    console.error("[whatsapp-tool-reply] failed:", err);
  }

  return fallbackReply(event);
}

export function fallbackReply(event: CustomerChannelEvent): string {
  const text = event.text?.toLowerCase() ?? "";
  if (/\b(stop|unsubscribe|opt out|do not|don't|wrong number)\b|(?:मत भेज|कॉल मत|नहीं चाहिए)/i.test(text)) {
    return "Understood. I have noted your preference.";
  }
  return "Thanks, I got your message. I will keep this context for the next follow-up.";
}
