export interface VoiceCustomerContext {
  source: "fundsindia-test" | "fundsindia" | "generic";
  datasetId: string;
  /** For generic datasets: raw columns from the sampled segment row */
  rawFields?: Record<string, string>;
  investorId?: string;
  firstName?: string;
  displayName?: string;
  gender?: "male" | "female" | "unknown";
  profile?: {
    city?: string;
    state?: string;
    cityTier?: string;
    investorType?: string;
    accountStage?: string;
  };
  inactivity?: {
    daysSinceLastActivity?: number;
    lastActivityDate?: string;
    reason?: string;
  };
  investmentSummary?: {
    boughtFunds?: string[];
    currentFundCount?: number;
    dominantCategory?: string;
    portfolioStatus?: string;
    portfolioValueBucket?: string;
    netInvestedInr?: string;
    currentValueInr?: string;
    unrealizedGainInr?: string;
    absoluteReturnPct?: string;
    xirrPct?: string;
    sipAmountInr?: string;
    returnAsOfDate?: string;
    fundReturnSnapshot?: string[];
    hasElssHolding?: boolean;
    hasSipLinkedHolding?: boolean;
  };
  currentSituation?: {
    kycStatus?: string;
    bankLinkStatus?: string;
    mfAccountActive?: boolean;
    dematAccountActive?: boolean;
    firstInvestmentDate?: string;
  };
  recentActivity?: string[];
  conversationHooks?: string[];
  doNotSay?: string[];
}

const CUSTOMER_CONTEXT_MARKER = "PRIVATE CUSTOMER CONTEXT FOR THIS CALL";

/** Display name to speak on the call — prefers full name, then first name. */
export function resolveVoiceCustomerDisplayName(
  context?: Pick<VoiceCustomerContext, "displayName" | "firstName"> | null,
): string | undefined {
  const name = clean(context?.displayName) || clean(context?.firstName);
  return name;
}

/** Normalize placeholder / column keys for matching (`Disbursed Amount` ↔ `disbursed_amount`). */
export function normalizeVoicePlaceholderKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const RUNTIME_PLACEHOLDER_KEYS = new Set([
  "selectedlanguage",
  "tomorrowtoday",
  "phonevideo",
  "customername",
]);

/**
 * Look up a {{Placeholder}} value in sampled rawFields.
 * Matches display labels to snake_case columns (e.g. Disbursed Amount → disbursed_amount).
 */
export function resolveRawFieldPlaceholder(
  rawFields: Record<string, string> | undefined,
  placeholderInner: string,
): string | undefined {
  if (!rawFields) return undefined;
  const target = normalizeVoicePlaceholderKey(placeholderInner);
  if (!target || RUNTIME_PLACEHOLDER_KEYS.has(target)) return undefined;
  for (const [key, value] of Object.entries(rawFields)) {
    if (!value?.trim()) continue;
    if (normalizeVoicePlaceholderKey(key) === target) return value.trim();
  }
  return undefined;
}

/**
 * Fill script/system-prompt placeholders that are known at dial time from the
 * sampled / recipient customer context. Leaves unknown runtime slots
 * ({{Selected Language}}, {{Tomorrow / Today}}, {{Phone / Video}}, etc.) alone
 * for the model to resolve mid-call.
 *
 * Placeholders matched:
 *   {{Customer Name}}, {{customerName}}, [Customer Name], [name], [नाम]
 *   {{Any Label}} when it matches a rawFields column (Disbursed Amount ↔ disbursed_amount)
 */
export function applyVoiceCustomerPlaceholders(
  text: string,
  context?: Pick<VoiceCustomerContext, "displayName" | "firstName" | "rawFields"> | null,
): string {
  if (!text) return text;
  let result = text;
  const name = resolveVoiceCustomerDisplayName(context);
  if (name) {
    result = result
      .replace(/\{\{\s*Customer\s*Name\s*\}\}/gi, name)
      .replace(/\{\{\s*customerName\s*\}\}/g, name)
      .replace(/\[\s*Customer\s*Name\s*\]/gi, name)
      .replace(/\[\s*name\s*\]/gi, name)
      .replace(/\[नाम\]/g, name);
  }
  if (context?.rawFields && Object.keys(context.rawFields).length > 0) {
    result = result.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (match, inner: string) => {
      const value = resolveRawFieldPlaceholder(context.rawFields, inner);
      return value !== undefined ? value : match;
    });
  }
  return result;
}

function editableScriptHasCustomerNamePlaceholder(editableScript: string): boolean {
  return (
    /\{\{\s*Customer\s*Name\s*\}\}/i.test(editableScript) ||
    /\{\{\s*customerName\s*\}\}/.test(editableScript) ||
    /\[\s*Customer\s*Name\s*\]/i.test(editableScript) ||
    /\[\s*name\s*\]/i.test(editableScript) ||
    /\[नाम\]/.test(editableScript)
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Campaigns compiled before we stopped baking "the customer" into the system
 * prompt still have that fallback where {{Customer Name}} used to be, even
 * though editableScript still has the placeholder. Restore only those exact
 * occurrences (using surrounding context from editableScript) so a nearby
 * instructional "wait for the customer" is not rewritten into a name slot.
 */
export function restoreCustomerNamePlaceholdersFromEditableScript(
  systemPrompt: string,
  editableScript?: string | null,
): string {
  if (!systemPrompt || !editableScript?.trim()) return systemPrompt;
  if (!editableScriptHasCustomerNamePlaceholder(editableScript)) return systemPrompt;
  if (editableScriptHasCustomerNamePlaceholder(systemPrompt)) return systemPrompt;

  const placeholderRe =
    /\{\{\s*Customer\s*Name\s*\}\}|\{\{\s*customerName\s*\}\}|\[\s*Customer\s*Name\s*\]|\[\s*name\s*\]|\[नाम\]/gi;
  let restored = systemPrompt;
  let match: RegExpExecArray | null;
  while ((match = placeholderRe.exec(editableScript)) !== null) {
    const start = Math.max(0, match.index - 48);
    const end = Math.min(editableScript.length, match.index + match[0].length + 48);
    const left = editableScript.slice(start, match.index);
    const right = editableScript.slice(match.index + match[0].length, end);
    const bakedSnippet = `${left}the customer${right}`;
    const placeholderSnippet = `${left}{{Customer Name}}${right}`;
    if (restored.includes(bakedSnippet)) {
      restored = restored.replace(bakedSnippet, placeholderSnippet);
      continue;
    }
    // Fallback when surrounding whitespace/punctuation drifted slightly during compile.
    const leftTail = left.slice(-24);
    const rightHead = right.slice(0, 24);
    if (!leftTail && !rightHead) continue;
    const flexible = new RegExp(
      `${escapeRegExp(leftTail)}the customer${escapeRegExp(rightHead)}`,
      "i",
    );
    restored = restored.replace(flexible, `${leftTail}{{Customer Name}}${rightHead}`);
  }
  return restored;
}

export function isFundsIndiaDormantPortfolioCampaign(campaign: {
  datasetId?: string;
  name?: string;
  segmentName?: string;
  purposeId?: string;
  purposeName?: string;
}): boolean {
  if (campaign.datasetId !== "fundsindia") return false;
  const segmentText = `${campaign.name ?? ""} ${campaign.segmentName ?? ""}`.toLowerCase();
  const purposeText = `${campaign.purposeId ?? ""} ${campaign.purposeName ?? ""}`.toLowerCase();
  return /dormant|inactive|holder/.test(segmentText) &&
    (/portfolio\s+review/.test(purposeText) || campaign.purposeId === "FI_PORTFOLIO_REVIEW");
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  return trimmed || undefined;
}

function line(label: string, value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (Array.isArray(value)) {
    const values = value.map((item) => clean(String(item))).filter(Boolean);
    return values.length ? `- ${label}: ${values.join(", ")}` : undefined;
  }
  if (typeof value === "boolean") return `- ${label}: ${value ? "yes" : "no"}`;
  return `- ${label}: ${clean(String(value))}`;
}

function compactLines(lines: Array<string | undefined>): string {
  return lines.filter((item): item is string => Boolean(item)).join("\n");
}

export function fundsIndiaInactiveBuyerTestContext(): VoiceCustomerContext {
  return {
    source: "fundsindia-test",
    datasetId: "fundsindia",
    investorId: "TEST_INACTIVE_DEMO",
    profile: {
      city: "Bengaluru",
      state: "Karnataka",
      cityTier: "t30",
      investorType: "resident",
      accountStage: "activated mutual fund investor",
    },
    inactivity: {
      daysSinceLastActivity: 50,
      lastActivityDate: "2026-04-08",
      reason: "Bought mutual funds earlier, but has not visited portfolio, dashboard, or SIP flows in the last 50 days.",
    },
    investmentSummary: {
      boughtFunds: [
        "Parag Parikh Flexi Cap Fund",
        "Mirae Asset ELSS Tax Saver Fund",
        "HDFC Balanced Advantage Fund",
      ],
      currentFundCount: 3,
      dominantCategory: "equity and hybrid mutual funds",
      portfolioStatus: "active",
      portfolioValueBucket: "50K-2L",
      netInvestedInr: "₹1,24,000",
      returnAsOfDate: "2026-05-28",
      fundReturnSnapshot: [
        "Parag Parikh Flexi Cap Fund: invested ₹50,000, absolute return 11.8%",
        "Mirae Asset ELSS Tax Saver Fund: invested ₹39,000, absolute return 7.9%",
        "HDFC Balanced Advantage Fund: invested ₹35,000, absolute return 4.7%",
      ],
      hasElssHolding: true,
      hasSipLinkedHolding: true,
    },
    currentSituation: {
      kycStatus: "verified",
      bankLinkStatus: "verified",
      mfAccountActive: true,
      dematAccountActive: false,
      firstInvestmentDate: "2025-11-18",
    },
    recentActivity: [
      "No portfolio visit in the last 50 days",
      "No SIP flow activity in the last 50 days",
      "No recent fund search or watchlist activity",
    ],
    conversationHooks: [
      "After permission, acknowledge that the customer had invested earlier and it has been a while since the last activity.",
      "If they ask what they bought, tell them the fund names from the snapshot before suggesting anything.",
      "If they ask about returns, answer with the portfolio snapshot values first. Say these are snapshot values, not live investment advice.",
      "Ask whether they want to quickly review the portfolio or SIP plan before suggesting any advisor callback.",
    ],
    doNotSay: [
      "Do not mention internal investor id, segment name, SQL, propensity, income band, or risk-profile labels.",
      "Do not imply investment advice, guaranteed returns, or a recommendation to buy/sell a specific fund.",
    ],
  };
}

export function appendVoiceCustomerContextToSystemPrompt(
  systemPrompt: string,
  context?: VoiceCustomerContext,
): string {
  if (!context) return systemPrompt;
  // Fill {{Customer Name}} / {{Disbursed Amount}} / etc. from sampled context
  // BEFORE appending the private block — otherwise the talk track still speaks
  // the literal braces even though the values are sitting in private context.
  const filled = applyVoiceCustomerPlaceholders(systemPrompt, context);
  const base = filled.trim();
  if (base.includes(CUSTOMER_CONTEXT_MARKER)) return base;

  const name = resolveVoiceCustomerDisplayName(context);
  const profile = context.profile;
  const inactivity = context.inactivity;
  const investment = context.investmentSummary;
  const situation = context.currentSituation;
  // Generic datasets carry their sampled entity row in rawFields — inject the
  // human-readable attributes so the agent has real customer context.
  const rawAttributeLines = context.rawFields
    ? Object.entries(context.rawFields)
        .filter(([key]) => !/(_id|_key|_hash|_token|sql|password|secret)$/i.test(key))
        .slice(0, 14)
        .map(([key, value]) => `${key.replace(/_/g, " ")}: ${value}`)
    : undefined;

  const contextBlock = compactLines([
    CUSTOMER_CONTEXT_MARKER,
    line("Customer name", name),
    line("First name to use naturally", context.firstName),
    line("Customer gender", context.gender),
    line("Location", [profile?.city, profile?.state].filter(Boolean)),
    line("Account stage", profile?.accountStage),
    line("Investor type", profile?.investorType),
    line("Inactivity", inactivity?.daysSinceLastActivity !== undefined
      ? `${inactivity.daysSinceLastActivity} days since last known activity`
      : undefined),
    line("Last known activity date", inactivity?.lastActivityDate),
    line("Why this customer is being called", inactivity?.reason),
    line("Funds or fund categories already bought", investment?.boughtFunds),
    line("Current fund count", investment?.currentFundCount),
    line("Dominant portfolio category", investment?.dominantCategory),
    line("Portfolio status", investment?.portfolioStatus),
    line("Net invested amount", investment?.netInvestedInr),
    line("Current snapshot value", investment?.currentValueInr),
    line("Unrealized gain", investment?.unrealizedGainInr),
    line("Absolute return snapshot", investment?.absoluteReturnPct),
    line("XIRR snapshot", investment?.xirrPct),
    line("Snapshot as-of date", investment?.returnAsOfDate),
    line("SIP detail", investment?.sipAmountInr),
    line("Per-fund return snapshot", investment?.fundReturnSnapshot),
    line("Has ELSS holding", investment?.hasElssHolding),
    line("Has SIP-linked holding", investment?.hasSipLinkedHolding),
    line("KYC status", situation?.kycStatus),
    line("Bank link status", situation?.bankLinkStatus),
    line("Mutual-fund account active", situation?.mfAccountActive),
    line("Demat account active", situation?.dematAccountActive),
    line("First investment date", situation?.firstInvestmentDate),
    line("Recent behavior", context.recentActivity),
    line("Customer profile attributes", rawAttributeLines),
    line("Conversation hooks", context.conversationHooks),
    line("Never say", context.doNotSay),
  ]);

  return `${base}

${contextBlock}

How to use this private customer context:
- Do not read this block aloud and do not reveal internal fields.
- Use the customer name exactly as shown in the private context. Do not invent, infer, or substitute another name.
- When the Campaign workflow has an identity / right-person line (loan under a name, "am I speaking with…"), you MUST speak that customer name aloud. Skipping the name is a failure.
- After the customer gives permission to speak, use at most one relevant fact to make the call feel remembered.
- Ask one useful diagnostic question before suggesting an advisor, specialist, or callback.
- Do not suggest a callback until the customer's latest question has been answered.
- Do not mention income band, risk-profile labels, propensity, segment SQL, internal IDs, or exact backend logic.
- Customer gender: if "Customer gender" is listed above, use it immediately — do not wait to detect from speech. If gender is male, use only masculine second-person forms ("aap kar rahe hain", "kar sakte hain", "samajh gaye"). If gender is female, use only feminine second-person forms ("aap kar rahi hain", "kar sakti hain", "samajh gayi"). Never use the wrong gendered form for this customer.
- Do not give personalized investment advice or guarantees. Offer a review, explanation, or next step only if the customer is receptive.`;
}

export function sanitizeFundsIndiaLiveTestPrompt(systemPrompt: string): string {
  return systemPrompt
    // Strip any lingering hardcoded customer name references
    .replace(/\bTaha\b/g, "the customer")
    .replace(/\bTAHA\b/g, "THE CUSTOMER")
    // Replace placeholder name tokens
    .replace(/क्या मैं \[नाम\] से बात कर रही हूँ\?/g, "क्या आप हमारे investor हैं?")
    .replace(/क्या मैं \[name\] से बात कर रही हूँ\?/gi, "क्या आप हमारे investor हैं?")
    .replace(/क्या मैं Taha से बात कर रही हूँ\?/g, "क्या आप हमारे investor हैं?")
    // Fix feminine to neutral Hindi pronoun forms
    .replace(/आपने portfolio हाल में check नहीं किया क्योंकि busy थीं, कहीं और track कर रही हैं, या अभी changes plan नहीं कर रही हैं/g, "आपने portfolio हाल में check नहीं किया क्योंकि busy थे, कहीं और track कर रहे हैं, या अभी changes plan नहीं कर रहे हैं")
    .replace(/अगर customer busy है या अभी बात नहीं करना चाहती/g, "अगर customer busy है या अभी बात नहीं करना चाहते")
    .replace(/अगर customer कहीं और manage करती है/g, "अगर customer कहीं और manage करते हैं");
}
