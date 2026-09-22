// ---------------------------------------------------------------------------
// Guardrails config — structured model for campaign guardrails
// ---------------------------------------------------------------------------

export type GuardrailAction =
  | "warn_continue"       // log + continue call
  | "end_conversation"    // graceful close
  | "transfer_to_human"   // hand off to live agent
  | "dnc_end";            // add to DNC list + end call

export type GuardrailSeverity = "low" | "medium" | "high";

export interface GuardrailToggle {
  enabled: boolean;
  action: GuardrailAction;
}

export interface ContentGuardrailToggle {
  enabled: boolean;
  severity: GuardrailSeverity;
}

export interface CustomGuardrail {
  id: string;
  name: string;
  prompt: string;
  action: GuardrailAction;
  enabled: boolean;
}

export interface GuardrailsConfig {
  system: {
    focus: boolean;
  };
  compliance: {
    returnClaims: GuardrailToggle;
    disclosure: GuardrailToggle;
    riskFirst: GuardrailToggle;
  };
  escalation: {
    legalThreat: GuardrailToggle;
    humanRequest: GuardrailToggle;
    optOut: GuardrailToggle;
  };
  content: {
    profanity: ContentGuardrailToggle;
    politicalReligious: ContentGuardrailToggle;
  };
  custom: CustomGuardrail[];
}

export function defaultGuardrailsConfig(): GuardrailsConfig {
  return {
    system: { focus: false },
    compliance: {
      returnClaims: { enabled: false, action: "warn_continue" },
      disclosure:   { enabled: false, action: "warn_continue" },
      riskFirst:    { enabled: false, action: "warn_continue" },
    },
    escalation: {
      legalThreat:   { enabled: false, action: "transfer_to_human" },
      humanRequest:  { enabled: false, action: "transfer_to_human" },
      optOut:        { enabled: false, action: "dnc_end" },
    },
    content: {
      profanity:          { enabled: false, severity: "medium" },
      politicalReligious: { enabled: false, severity: "medium" },
    },
    custom: [],
  };
}

export const GUARDRAIL_ACTION_LABELS: Record<GuardrailAction, string> = {
  warn_continue:      "Warn and continue",
  end_conversation:   "End conversation",
  transfer_to_human:  "Transfer to human",
  dnc_end:            "DNC + end call",
};

export const GUARDRAIL_SEVERITY_LABELS: Record<GuardrailSeverity, string> = {
  low:    "Low",
  medium: "Medium",
  high:   "High",
};

// ---------------------------------------------------------------------------
// Annotated rules — rules with their source category for display
// ---------------------------------------------------------------------------

export interface AnnotatedGuardrailRule {
  category: "System" | "Compliance" | "Escalation" | "Content" | "Custom";
  label: string;   // short human name for the specific rule
  rule: string;    // full text injected into the system prompt
}

export function guardrailsConfigToAnnotatedRules(config: GuardrailsConfig): AnnotatedGuardrailRule[] {
  const rules: AnnotatedGuardrailRule[] = [];

  if (config.system.focus) {
    rules.push({
      category: "System",
      label: "Focus",
      // Additive framing — doesn't conflict with the hardcoded concern-handling section.
      // The hardcoded section says "customer concern overrides campaign goal" which is correct.
      // This rule adds "but don't go deep on unrelated topics" — complementary, not contradictory.
      rule: "Stay on the campaign's defined objective. If the customer raises an unrelated topic, acknowledge briefly and redirect — do not engage at length with topics outside the campaign scope or provide information on unrelated products.",
    });
  }

  if (config.compliance.returnClaims.enabled) {
    rules.push({
      category: "Compliance",
      label: "Return guarantees",
      rule: "Never guarantee returns, quote specific percentages, or promise financial outcomes not explicitly stated in the approved script.",
    });
  }
  if (config.compliance.disclosure.enabled) {
    rules.push({
      category: "Compliance",
      label: "Regulatory disclosure",
      rule: "Always mention the company's SEBI or IRDAI registration number before making any product pitch or investment recommendation.",
    });
  }
  if (config.compliance.riskFirst.enabled) {
    rules.push({
      category: "Compliance",
      label: "Risk-first",
      rule: "Always mention risks or potential downsides before stating any product benefits or projected returns.",
    });
  }

  if (config.escalation.legalThreat.enabled) {
    rules.push({
      category: "Escalation",
      label: "Legal threat",
      rule: "If the customer mentions court action, RBI complaint, ombudsman, or legal proceedings, acknowledge calmly, do not argue, and offer to have a senior team member follow up.",
    });
  }
  if (config.escalation.humanRequest.enabled) {
    rules.push({
      category: "Escalation",
      label: "Human requested",
      rule: "If the customer explicitly asks to speak to a human agent or manager, acknowledge the request and let them know a team member will call them back.",
    });
  }
  if (config.escalation.optOut.enabled) {
    // Removed "Adds number to Do Not Call list" — the LLM can't execute system actions.
    // Plain behavioral instruction only.
    rules.push({
      category: "Escalation",
      label: "Opt-out",
      rule: "If the customer says they do not want to be called again or asks to be removed from the list, apologize once and end the call politely. Do not try to continue the campaign.",
    });
  }

  if (config.content.profanity.enabled) {
    rules.push({
      category: "Content",
      label: "Profanity",
      rule: "Do not use or engage with profane, vulgar, or offensive language under any circumstances.",
    });
  }
  if (config.content.politicalReligious.enabled) {
    rules.push({
      category: "Content",
      label: "Political / religious",
      rule: "Avoid political and religious discussions. If the customer raises these topics, acknowledge briefly and redirect the conversation.",
    });
  }

  for (const guardrail of config.custom) {
    if (guardrail.enabled && guardrail.prompt.trim()) {
      rules.push({
        category: "Custom",
        label: guardrail.name,
        rule: guardrail.prompt.trim(),
      });
    }
  }

  return rules;
}

// Derive the flat string[] used for system prompt injection from annotated rules
export function guardrailsConfigToRules(config: GuardrailsConfig): string[] {
  return guardrailsConfigToAnnotatedRules(config).map((r) => r.rule);
}

// ---------------------------------------------------------------------------
// Built-in rules — hardcoded in compileVoiceCampaignScript, always applied
// These are read-only. Shown in UI for transparency; cannot be toggled.
// ---------------------------------------------------------------------------

export interface BuiltInGuardrailRule {
  label: string;
  rule: string;
  group: "Safety" | "Behaviour" | "Tone";
}

export const BUILTIN_GUARDRAIL_RULES: BuiltInGuardrailRule[] = [
  // Safety
  { group: "Safety", label: "No OTP requests",         rule: "Never ask for OTPs." },
  { group: "Safety", label: "No card details",         rule: "Never ask for card details, CVV, or payment credentials." },
  { group: "Safety", label: "No Aadhaar / PAN",        rule: "Never ask for Aadhaar or PAN numbers." },
  { group: "Safety", label: "No approval promises",    rule: "Never promise approval or guaranteed outcomes." },
  { group: "Safety", label: "No pressure",             rule: "Never pressure or shame the customer." },
  // Behaviour
  { group: "Behaviour", label: "Concern-first",        rule: "The customer's latest concern overrides the campaign goal. Pause the campaign path and address it." },
  { group: "Behaviour", label: "Callback discipline",  rule: "Do not suggest a callback or advisor until the customer's question has been answered using available information." },
  { group: "Behaviour", label: "Opt-out",              rule: "If the customer asks to be removed or stop being called, apologize once and end the call." },
  { group: "Behaviour", label: "Voicemail safe",       rule: "If the call is screened or goes to voicemail, say one safe sentence and stop." },
  { group: "Behaviour", label: "Turn length",          rule: "Default reply: 1–3 short spoken sentences, ~25–55 words. Ask at most one question per turn." },
  // Tone
  { group: "Tone", label: "No filler phrases",         rule: 'Never say "Absolutely", "Great question", "As a valued customer", "I understand your concern", or "Let me explain in detail".' },
  { group: "Tone", label: "No markdown",               rule: "Do not use bullet points, markdown, stage directions, or ellipses in spoken responses." },
  { group: "Tone", label: "Natural acknowledgements",  rule: "Use natural acknowledgements occasionally. Do not overuse them or combine them with long explanations." },
];

// Count enabled guardrails per category
export function countEnabled(config: GuardrailsConfig) {
  return {
    system:     (config.system.focus ? 1 : 0),
    compliance: Object.values(config.compliance).filter((g) => g.enabled).length,
    escalation: Object.values(config.escalation).filter((g) => g.enabled).length,
    content:    Object.values(config.content).filter((g) => g.enabled).length,
    custom:     config.custom.filter((g) => g.enabled).length,
    total:      (config.system.focus ? 1 : 0)
      + Object.values(config.compliance).filter((g) => g.enabled).length
      + Object.values(config.escalation).filter((g) => g.enabled).length
      + Object.values(config.content).filter((g) => g.enabled).length
      + config.custom.filter((g) => g.enabled).length,
  };
}
