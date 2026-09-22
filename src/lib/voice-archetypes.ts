// Archetype library distilled from the Indian BFSI/health telecalling corpus
// (docs/script-generator-design.md, "Archetypes" table). Client-bundle-safe:
// types only from voice-campaign-flow, no Node built-ins, no server imports.
import { UNIVERSAL_ROUTE_TERMINAL, type VoiceUniversalRoute } from "@/lib/voice-campaign-flow";

export interface ArchetypeStage {
  id: string;
  title: string;
  kind: "start" | "prompt" | "question" | "condition" | "action" | "transfer" | "end";
  goal: string;
  acts: string[];
}

export interface ArchetypeSlot {
  name: string;
  type: "enum" | "string" | "number" | "date" | "bool";
  values?: string[];
}

export interface VoiceCampaignArchetype {
  id: string;
  label: string;
  sector: "bfsi-collections" | "bfsi-sales" | "health";
  description: string;
  stages: ArchetypeStage[];
  slots: ArchetypeSlot[];
  defaultUniversalRoutes: VoiceUniversalRoute[];
  guardrailPack: string[];
  safeDefaultFacts: string[];
}

const RECORDING_DISCLOSURE_FACT =
  "This call may be recorded for quality and training purposes.";
const CALLING_HOURS_FACT = "Our calling hours are 10 AM to 6:30 PM.";

function buildDefaultUniversalRoutes(): VoiceUniversalRoute[] {
  return [
    {
      kind: "end_call",
      terminal: UNIVERSAL_ROUTE_TERMINAL.end_call,
      label: "Customer ends the call",
      trigger: "Customer says goodbye or clearly asks to end the call.",
      behavior:
        "Acknowledge politely, thank them for their time, and close the call without adding anything new.",
    },
    {
      kind: "do_not_call",
      terminal: UNIVERSAL_ROUTE_TERMINAL.do_not_call,
      label: "Do-not-call request",
      trigger: "Customer asks not to be contacted again on this number.",
      behavior:
        "Apologize for the inconvenience, confirm the number will be marked as do-not-call, and end the call respectfully.",
    },
    {
      kind: "not_interested",
      terminal: UNIVERSAL_ROUTE_TERMINAL.not_interested,
      label: "Not interested",
      trigger: "Customer clearly declines and does not want to continue.",
      behavior:
        "Acknowledge their decision once without any pressure, thank them for their time, and close politely. Never repeat the pitch after a clear refusal.",
    },
    {
      kind: "busy_callback",
      terminal: UNIVERSAL_ROUTE_TERMINAL.busy_callback,
      label: "Busy, needs callback",
      trigger: "Customer says they are busy, driving, in a meeting, or asks to talk later.",
      behavior:
        "Apologize for the interruption and offer a callback at a time convenient to them within calling hours, 10 AM to 6:30 PM. Confirm the preferred time and close politely.",
    },
    {
      kind: "wrong_person",
      terminal: UNIVERSAL_ROUTE_TERMINAL.wrong_person,
      label: "Wrong person",
      trigger: "The person says this is the wrong number or they are not the named customer.",
      behavior:
        "Apologize for the trouble, do not share any account or personal details, and end the call politely.",
    },
    {
      kind: "change_language",
      terminal: UNIVERSAL_ROUTE_TERMINAL.change_language,
      label: "Language change",
      trigger: "Customer asks to speak in a different language or seems uncomfortable in the current one.",
      behavior:
        "Switch to the requested language if it is supported and continue from the same point. If it is not supported, apologize and continue in the simplest possible wording.",
    },
    {
      kind: "question_confusion",
      terminal: UNIVERSAL_ROUTE_TERMINAL.question_confusion,
      label: "Question or confusion",
      trigger: "Customer asks a question or sounds confused about what was said.",
      behavior:
        "Answer briefly using only approved information. If the answer is not available, say a team member will follow up with the details. Then return to the current step.",
    },
    {
      kind: "escalation",
      terminal: UNIVERSAL_ROUTE_TERMINAL.escalation,
      label: "Escalation",
      trigger: "Customer is upset, raises a complaint, or asks to speak with a human.",
      behavior:
        "Stay calm and courteous, apologize once, and offer to arrange a callback from a human representative. Never argue or talk over the customer.",
    },
    {
      kind: "silence_unclear",
      terminal: UNIVERSAL_ROUTE_TERMINAL.silence_unclear,
      label: "Silence or unclear audio",
      trigger: "There is silence, background noise, or the response cannot be understood.",
      behavior:
        "Politely check whether they can hear you and repeat the last point once, briefly. If there is still no clear response, close the call politely.",
    },
    {
      kind: "voicemail_screening",
      terminal: UNIVERSAL_ROUTE_TERMINAL.voicemail_screening,
      label: "Voicemail or call screening",
      trigger: "A voicemail greeting or automated call-screening system is detected.",
      behavior:
        "Do not disclose any account or personal details. Leave a brief, neutral message requesting a callback, or end the call.",
    },
  ];
}

const BFSI_COLLECTIONS_GUARDRAILS = [
  "Call only within permitted calling hours, 10 AM to 6:30 PM.",
  "Never disclose loan or account details to anyone other than the customer; confirm you are speaking with the right person first.",
  "No harassment, shaming, intimidation, or repeated pressure. Stay courteous even if the customer is angry.",
  "Never make false legal threats or imply police, court, or criminal action.",
  "Do not contact, involve, or mention the customer's employer, family, or references.",
  "If the customer disputes the dues, note the dispute respectfully; never argue about the amount on the call.",
];

const BFSI_SALES_GUARDRAILS = [
  "Never claim assured, guaranteed, or pre-confirmed approval; final approval always rests with the lender.",
  "Never invent or estimate interest rates, fees, tenures, or charges. Quote only approved figures; otherwise say the exact figure will be shared in writing.",
  "Deliver the recording disclosure before the pitch begins.",
  "Do not pressure the customer to decide on the call; offer to share details and follow up.",
  "Never ask for card numbers, OTPs, PINs, CVVs, or passwords.",
];

const HEALTH_GUARDRAILS = [
  "Confirm you are speaking with the right person before mentioning any health-related detail.",
  "Never give medical advice, diagnosis, or dosage guidance; always refer the customer to their doctor.",
  "Do not disclose health information to family members or any third party.",
  "Share only the minimum health detail the reminder requires; treat everything else as private.",
];

export const VOICE_ARCHETYPES: VoiceCampaignArchetype[] = [
  {
    id: "collections-pre-due",
    label: "Collections — pre-due reminder",
    sector: "bfsi-collections",
    description:
      "Courtesy reminder before an EMI due date: confirm the right person, remind about the upcoming due, and check whether payment is arranged.",
    stages: [
      {
        id: "greet-rpc",
        title: "Greeting & identity check",
        kind: "start",
        goal: "Greet the customer and confirm you are speaking with the named customer before any account detail.",
        acts: ["greeting", "question"],
      },
      {
        id: "recording-disclosure",
        title: "Recording disclosure",
        kind: "prompt",
        goal: "Deliver the recording disclosure verbatim before the purpose of the call.",
        acts: ["disclosure"],
      },
      {
        id: "due-reminder",
        title: "Upcoming due reminder",
        kind: "prompt",
        goal: "State the purpose: a reminder about the upcoming EMI due date, in one short turn.",
        acts: ["explanation"],
      },
      {
        id: "payment-check",
        title: "Payment arrangement check",
        kind: "question",
        goal: "Ask whether the payment is already arranged or planned, then wait for the answer.",
        acts: ["question"],
      },
      {
        id: "commitment-branch",
        title: "Commitment branch",
        kind: "condition",
        goal: "Branch on the customer's commitment: arranged, will pay, or unsure.",
        acts: ["acknowledgement"],
      },
      {
        id: "payment-guidance",
        title: "Payment guidance",
        kind: "prompt",
        goal: "Briefly share how the payment can be made if the customer asks or is unsure.",
        acts: ["explanation"],
      },
      {
        id: "close",
        title: "Close",
        kind: "end",
        goal: "Thank the customer and close politely. Nothing may follow this stage.",
        acts: ["close"],
      },
    ],
    slots: [
      { name: "payment_commitment", type: "enum", values: ["arranged", "will_pay", "unsure", "refused"] },
      { name: "callback_time", type: "string" },
    ],
    defaultUniversalRoutes: buildDefaultUniversalRoutes(),
    guardrailPack: [...BFSI_COLLECTIONS_GUARDRAILS],
    safeDefaultFacts: [RECORDING_DISCLOSURE_FACT, CALLING_HOURS_FACT],
  },
  {
    id: "collections-post-due",
    label: "Collections — post-due follow-up",
    sector: "bfsi-collections",
    description:
      "Follow-up after a missed EMI: confirm the right person, discover payment status, and secure a promise-to-pay date without pressure.",
    stages: [
      {
        id: "greet-rpc",
        title: "Greeting & identity check",
        kind: "start",
        goal: "Greet the customer and confirm you are speaking with the named customer before any account detail.",
        acts: ["greeting", "question"],
      },
      {
        id: "recording-disclosure",
        title: "Recording disclosure",
        kind: "prompt",
        goal: "Deliver the recording disclosure verbatim before the purpose of the call.",
        acts: ["disclosure"],
      },
      {
        id: "overdue-notice",
        title: "Overdue notice",
        kind: "prompt",
        goal: "State the purpose: the recent EMI appears pending, in one short neutral turn.",
        acts: ["explanation"],
      },
      {
        id: "payment-status",
        title: "Payment status discovery",
        kind: "question",
        goal: "Ask whether the payment is done, planned, disputed, or refused, then wait.",
        acts: ["question"],
      },
      {
        id: "status-branch",
        title: "Status branch",
        kind: "condition",
        goal: "Branch on payment status: paid, promised, disputed, or refused.",
        acts: ["acknowledgement"],
      },
      {
        id: "gentle-persuasion",
        title: "Gentle persuasion",
        kind: "prompt",
        goal: "If hesitant, explain the benefit of paying on time in neutral terms. No threats, no pressure.",
        acts: ["explanation"],
      },
      {
        id: "ptp-commit",
        title: "Promise-to-pay commitment",
        kind: "question",
        goal: "Ask for a specific payment date and read it back to confirm.",
        acts: ["question", "confirm"],
      },
      {
        id: "close",
        title: "Close",
        kind: "end",
        goal: "Thank the customer and close politely. Nothing may follow this stage.",
        acts: ["close"],
      },
    ],
    slots: [
      { name: "payment_status", type: "enum", values: ["paid", "promised", "disputed", "refused"] },
      { name: "ptp_date", type: "date" },
    ],
    defaultUniversalRoutes: buildDefaultUniversalRoutes(),
    guardrailPack: [...BFSI_COLLECTIONS_GUARDRAILS],
    safeDefaultFacts: [RECORDING_DISCLOSURE_FACT, CALLING_HOURS_FACT],
  },
  {
    id: "welcome-onboarding",
    label: "Welcome & onboarding verification",
    sector: "bfsi-sales",
    description:
      "Welcome call for a new customer: confirm identity, take consent, verify registered details one at a time, and share what happens next.",
    stages: [
      {
        id: "greet-rpc",
        title: "Greeting & identity check",
        kind: "start",
        goal: "Greet the customer and confirm you are speaking with the named customer.",
        acts: ["greeting", "question"],
      },
      {
        id: "recording-disclosure",
        title: "Recording disclosure",
        kind: "prompt",
        goal: "Deliver the recording disclosure verbatim before the welcome message.",
        acts: ["disclosure"],
      },
      {
        id: "welcome-consent",
        title: "Welcome & consent",
        kind: "prompt",
        goal: "Welcome the customer and ask consent to verify their registered details.",
        acts: ["explanation", "question"],
      },
      {
        id: "detail-verify",
        title: "Detail verification",
        kind: "question",
        goal: "Verify registered details one at a time, waiting for confirmation after each.",
        acts: ["question", "confirm"],
      },
      {
        id: "next-steps",
        title: "Next steps",
        kind: "prompt",
        goal: "Briefly share what the customer should expect next, in one short turn.",
        acts: ["explanation"],
      },
      {
        id: "close",
        title: "Close",
        kind: "end",
        goal: "Thank the customer, welcome them once more, and close politely.",
        acts: ["close"],
      },
    ],
    slots: [
      { name: "details_confirmed", type: "bool" },
      { name: "consent_given", type: "bool" },
    ],
    defaultUniversalRoutes: buildDefaultUniversalRoutes(),
    guardrailPack: [...BFSI_SALES_GUARDRAILS],
    safeDefaultFacts: [RECORDING_DISCLOSURE_FACT, CALLING_HOURS_FACT],
  },
  {
    id: "x-sell-pre-approved",
    label: "Cross-sell — pre-approved offer",
    sector: "bfsi-sales",
    description:
      "Outreach for an existing customer's pre-approved offer: confirm the right person, present the offer briefly, gauge interest, and hand off to the preferred channel.",
    stages: [
      {
        id: "greet-rpc",
        title: "Greeting & identity check",
        kind: "start",
        goal: "Greet the customer and confirm you are speaking with the named customer.",
        acts: ["greeting", "question"],
      },
      {
        id: "recording-disclosure",
        title: "Recording disclosure",
        kind: "prompt",
        goal: "Deliver the recording disclosure verbatim before the offer.",
        acts: ["disclosure"],
      },
      {
        id: "offer-intro",
        title: "Offer introduction",
        kind: "prompt",
        goal: "Introduce the offer in one short turn using only approved figures. Never imply guaranteed approval.",
        acts: ["explanation"],
      },
      {
        id: "interest-check",
        title: "Interest check",
        kind: "question",
        goal: "Ask whether the customer would like to know more, then wait.",
        acts: ["question"],
      },
      {
        id: "interest-branch",
        title: "Interest branch",
        kind: "condition",
        goal: "Branch on interest: interested, maybe later, or not interested.",
        acts: ["acknowledgement"],
      },
      {
        id: "channel-handoff",
        title: "Channel handoff",
        kind: "action",
        goal: "Arrange the follow-up on the customer's preferred channel and confirm it back.",
        acts: ["confirm"],
      },
      {
        id: "close",
        title: "Close",
        kind: "end",
        goal: "Thank the customer and close politely.",
        acts: ["close"],
      },
    ],
    slots: [
      { name: "interest", type: "enum", values: ["interested", "maybe_later", "not_interested"] },
      { name: "preferred_channel", type: "enum", values: ["whatsapp", "sms", "email", "call"] },
    ],
    defaultUniversalRoutes: buildDefaultUniversalRoutes(),
    guardrailPack: [...BFSI_SALES_GUARDRAILS],
    safeDefaultFacts: [RECORDING_DISCLOSURE_FACT, CALLING_HOURS_FACT],
  },
  {
    id: "activation-mandate",
    label: "Activation — ECS / auto-debit mandate",
    sector: "bfsi-sales",
    description:
      "Activation call for an ECS or auto-debit mandate: explain the purpose, handle agree/refuse/hesitate, share benefits, and send the activation link.",
    stages: [
      {
        id: "greet-rpc",
        title: "Greeting & identity check",
        kind: "start",
        goal: "Greet the customer and confirm you are speaking with the named customer.",
        acts: ["greeting", "question"],
      },
      {
        id: "recording-disclosure",
        title: "Recording disclosure",
        kind: "prompt",
        goal: "Deliver the recording disclosure verbatim before the purpose.",
        acts: ["disclosure"],
      },
      {
        id: "mandate-purpose",
        title: "Mandate purpose",
        kind: "prompt",
        goal: "Explain what the auto-debit mandate does in one short plain turn.",
        acts: ["explanation"],
      },
      {
        id: "activation-ask",
        title: "Activation ask",
        kind: "question",
        goal: "Ask whether they would like to activate it now, then wait.",
        acts: ["question"],
      },
      {
        id: "response-branch",
        title: "Response branch",
        kind: "condition",
        goal: "Branch on the response: agree, refuse, or hesitate.",
        acts: ["acknowledgement"],
      },
      {
        id: "benefits",
        title: "Benefits for the hesitant",
        kind: "prompt",
        goal: "If hesitant, share the practical benefits briefly. Respect a clear refusal immediately.",
        acts: ["explanation"],
      },
      {
        id: "link-send",
        title: "Activation link send",
        kind: "action",
        goal: "Send the activation link on the agreed channel and confirm it was sent.",
        acts: ["confirm"],
      },
      {
        id: "close",
        title: "Close",
        kind: "end",
        goal: "Thank the customer and close politely.",
        acts: ["close"],
      },
    ],
    slots: [
      { name: "activation_agreed", type: "enum", values: ["agreed", "refused", "hesitant"] },
      { name: "link_channel", type: "enum", values: ["whatsapp", "sms"] },
    ],
    defaultUniversalRoutes: buildDefaultUniversalRoutes(),
    guardrailPack: [...BFSI_SALES_GUARDRAILS],
    safeDefaultFacts: [RECORDING_DISCLOSURE_FACT, CALLING_HOURS_FACT],
  },
  {
    id: "lead-qualification",
    label: "Lead qualification & appointment",
    sector: "bfsi-sales",
    description:
      "Follow-up on an enquiry: acknowledge the source, discover the product need, qualify one question at a time, and book an appointment.",
    stages: [
      {
        id: "greet-rpc",
        title: "Greeting & identity check",
        kind: "start",
        goal: "Greet the customer and confirm you are speaking with the person who enquired.",
        acts: ["greeting", "question"],
      },
      {
        id: "recording-disclosure",
        title: "Recording disclosure",
        kind: "prompt",
        goal: "Deliver the recording disclosure verbatim before the conversation.",
        acts: ["disclosure"],
      },
      {
        id: "source-ack",
        title: "Enquiry acknowledgement",
        kind: "prompt",
        goal: "Acknowledge their recent enquiry and set the purpose in one short turn.",
        acts: ["acknowledgement", "transition"],
      },
      {
        id: "product-discover",
        title: "Product discovery",
        kind: "question",
        goal: "Ask what they are looking for, one question at a time, waiting after each.",
        acts: ["question"],
      },
      {
        id: "qualify",
        title: "Qualification",
        kind: "question",
        goal: "Ask the qualification basics one at a time. Never promise approval.",
        acts: ["question"],
      },
      {
        id: "qualification-branch",
        title: "Qualification branch",
        kind: "condition",
        goal: "Branch on fit: qualified, needs review, or not a fit.",
        acts: ["acknowledgement"],
      },
      {
        id: "appointment",
        title: "Appointment booking",
        kind: "question",
        goal: "Offer an appointment or callback, confirm the slot back to them.",
        acts: ["question", "confirm"],
      },
      {
        id: "close",
        title: "Close",
        kind: "end",
        goal: "Thank the customer and close politely.",
        acts: ["close"],
      },
    ],
    slots: [
      { name: "qualified", type: "enum", values: ["qualified", "needs_review", "not_fit"] },
      { name: "appointment_slot", type: "string" },
    ],
    defaultUniversalRoutes: buildDefaultUniversalRoutes(),
    guardrailPack: [...BFSI_SALES_GUARDRAILS],
    safeDefaultFacts: [RECORDING_DISCLOSURE_FACT, CALLING_HOURS_FACT],
  },
  {
    id: "health-reminder",
    label: "Health — reminder & adherence",
    sector: "health",
    description:
      "Reminder call for an appointment, test, or refill: identity gate first, deliver the reminder, confirm attendance or reschedule.",
    stages: [
      {
        id: "greet-identity",
        title: "Greeting & identity gate",
        kind: "start",
        goal: "Greet and confirm you are speaking with the right person before any health detail is mentioned.",
        acts: ["greeting", "question"],
      },
      {
        id: "reminder",
        title: "Reminder",
        kind: "prompt",
        goal: "Deliver the reminder briefly, sharing only the minimum health detail required.",
        acts: ["explanation"],
      },
      {
        id: "confirm-check",
        title: "Confirmation check",
        kind: "question",
        goal: "Ask whether they will be able to make it or follow through, then wait.",
        acts: ["question"],
      },
      {
        id: "response-branch",
        title: "Response branch",
        kind: "condition",
        goal: "Branch on the response: confirmed, wants to reschedule, or declines.",
        acts: ["acknowledgement"],
      },
      {
        id: "reschedule",
        title: "Reschedule",
        kind: "question",
        goal: "If rescheduling, ask for a convenient time and confirm it back.",
        acts: ["question", "confirm"],
      },
      {
        id: "close",
        title: "Close",
        kind: "end",
        goal: "Thank them, wish them well, and close politely. No medical advice at any point.",
        acts: ["close"],
      },
    ],
    slots: [
      { name: "confirmed", type: "bool" },
      { name: "reschedule_time", type: "date" },
    ],
    defaultUniversalRoutes: buildDefaultUniversalRoutes(),
    guardrailPack: [...HEALTH_GUARDRAILS],
    safeDefaultFacts: [RECORDING_DISCLOSURE_FACT, CALLING_HOURS_FACT],
  },
];

export function getVoiceArchetype(id: string): VoiceCampaignArchetype | null {
  return VOICE_ARCHETYPES.find((archetype) => archetype.id === id) ?? null;
}

export function listVoiceArchetypes(): VoiceCampaignArchetype[] {
  return VOICE_ARCHETYPES;
}
