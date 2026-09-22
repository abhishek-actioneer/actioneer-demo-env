import { auth } from "@clerk/nextjs/server";
import { z } from "zod/v4";

import { DEFAULT_DATASET } from "@/lib/datasets/constants";
import { generateText, parseJsonResponse } from "@/lib/llm";
import {
  casualSpokenRegisterAuthoringRules,
  isCasualSouthIndianLanguage,
} from "@/lib/voice-casual-spoken-register";
import { VOICE_CAMPAIGN_EDITABLE_SCRIPT_MAX_CHARS } from "@/lib/voice-campaign-studio-utils";

const RewriteScriptSchema = z.object({
  datasetId: z.string().trim().min(1).max(64).optional(),
  script: z.string().trim().min(1).max(VOICE_CAMPAIGN_EDITABLE_SCRIPT_MAX_CHARS),
  spokenLanguage: z.string().trim().min(1).max(80).optional(),
  /**
   * When set, rewrite customer-facing "Say:" lines into this authoring language
   * (Odia/Tamil/Telugu/… native script, or romanized Hinglish). Used when the
   * studio language dropdown changes.
   */
  targetAuthoringLanguage: z.string().trim().min(1).max(80).optional(),
  instruction: z.string().trim().max(2_000).optional(),
  selectedText: z.string().trim().min(1).max(10_000).optional(),
  fullLineText: z.string().trim().max(20_000).optional(),
  sectionTitle: z.string().trim().max(500).optional(),
  sectionNumber: z.string().trim().max(24).optional(),
  lineKind: z.enum(["say", "note", "route", "text"]).optional(),
  segmentName: z.string().trim().max(500).optional(),
  purposeName: z.string().trim().max(500).optional(),
  voiceName: z.string().trim().max(200).optional(),
});

function isRomanizedAuthoringLanguage(language: string): boolean {
  const normalized = language.trim().toLowerCase();
  return normalized === "hinglish" || normalized === "english" || normalized === "en";
}

function authoringLanguageRewritePrompt(targetLanguage: string): string {
  const target = targetLanguage.trim() || "Hinglish";
  if (isRomanizedAuthoringLanguage(target)) {
    return `You rewrite operator-facing voice campaign scripts for Indian outbound calls.

Rewrite only the authoring format. Preserve the campaign logic exactly.

Rules:
- Output romanized Hinglish or simple English that is easy to edit on an English keyboard.
- Do not use Devanagari or other Indic scripts in section titles, labels, notes, or sample spoken lines.
- Transliterate Hindi-script words into romanized Hinglish. For example, "नमस्ते" becomes "namaste".
- Preserve all numbered sections, routing notes, conditions, offer facts, safety limits, names, product names, percentages, and callback rules.
- Convert labels like "कहें:" to "Say:" and "नोट:" / "Note:" to "Note:".
- Keep the top line "Conversation script:".
- Keep sample spoken lines natural and phone-ready.
- Do not add new claims, prices, eligibility, guarantees, discounts, or facts.
- Do not shorten the flow or remove branches.
- The selected spoken runtime language is ${target}; this rewrite is the editable operator script.`;
  }

  const casualBlock = isCasualSouthIndianLanguage(target)
    ? `\n\nCASUAL SPEECH REGISTER (mandatory for ${target}):\n${casualSpokenRegisterAuthoringRules(target)}`
    : "";

  return `You rewrite operator-facing voice campaign scripts so spoken lines match the selected language.

Target spoken/authoring language: ${target}.

Rules:
- Keep structure labels in English: "Conversation script:", numbered section titles, "Say:", "Note:", "Private guidance:", "If …", routing notes.
- Rewrite EVERY customer-facing "Say:" / "VIDYA:" / "कहें:" spoken line into natural casual phone-call ${target} — how a real outbound agent would speak, never formal/literary/textbook phrasing.
- Use the correct native script for ${target} (Odia Odia script, Tamil Tamil script, Telugu Telugu script, Kannada Kannada script, Hindi Devanagari).
- Do NOT hardcode stiff formal lines. Prefer short, warm, spoken rhythm.
- Keep Note: / Private guidance / routing / conditions in clear English (or light romanized English) so operators can edit on a keyboard.
- Preserve placeholders exactly: {{Customer Name}}, {{Selected Language}}, [Customer Name], brand names, rates, facts.
- If the script asks which language the customer prefers, keep that ask, but write the spoken ask in casual ${target} and keep Latin option names (Hindi, English, Tamil, Kannada, Telugu, Odia).
- Preserve all numbered sections, branches, safety limits, and offer facts. Do not invent new facts.
- Do not shorten the flow or remove branches.
- Keep the top line "Conversation script:".${casualBlock}`;
}

function datasetIdFromRequest(req: Request, bodyDatasetId?: string): string {
  const raw = bodyDatasetId || new URL(req.url).searchParams.get("datasetId") || req.headers.get("x-dataset-id") || DEFAULT_DATASET;
  return /^[a-z0-9_-]+$/.test(raw) && raw.length <= 64 ? raw : DEFAULT_DATASET;
}

function cleanScript(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return fallback;
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = RewriteScriptSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid script rewrite payload" }, { status: 400 });
  }

  const datasetId = datasetIdFromRequest(req, parsed.data.datasetId);
  const spokenLanguage = parsed.data.spokenLanguage ?? "Hinglish";
  const targetAuthoringLanguage =
    parsed.data.targetAuthoringLanguage?.trim() || spokenLanguage;
  const instruction = parsed.data.instruction?.trim();
  const romanizedTarget = isRomanizedAuthoringLanguage(targetAuthoringLanguage);

  if (parsed.data.selectedText) {
    const raw = await generateText({
      messages: [
        {
          role: "system",
          content: `You are an AI script editor for Indian outbound voice campaigns.

Edit only the selected script text. Return a replacement for that selected text, not the full script.

Rules:
- Preserve the campaign intent, safety limits, routing logic, product facts, names, percentages, prices, and eligibility.
- Keep the replacement phone-ready for a spoken agent.
- Use the selected spoken runtime language: ${targetAuthoringLanguage}.
${
  romanizedTarget
    ? "- If the text is Hinglish/English, keep it romanized and easy to edit on an English keyboard.\n- Do not use Devanagari or other Indic scripts."
    : `- Write spoken phrases in natural casual ${targetAuthoringLanguage} using the correct native script.\n- For Tamil/Telugu/Kannada: casual phone-agent speech only — never formal literary forms.${
        isCasualSouthIndianLanguage(targetAuthoringLanguage)
          ? `\n${casualSpokenRegisterAuthoringRules(targetAuthoringLanguage)}`
          : ""
      }`
}
- Do not add new claims, guarantees, discounts, prices, eligibility, or unsupported facts.
- If asked to check compliance or pushiness, improve the selected text directly instead of explaining the issue.
- Return concise text that can replace the selected text exactly.`,
        },
        {
          role: "user",
          content: [
            instruction ? `Requested edit: ${instruction}` : "Requested edit: Improve the selected script text.",
            parsed.data.segmentName ? `Audience segment: ${parsed.data.segmentName}` : "",
            parsed.data.purposeName ? `Campaign purpose: ${parsed.data.purposeName}` : "",
            parsed.data.voiceName ? `Agent voice/persona: ${parsed.data.voiceName}` : "",
            parsed.data.sectionTitle ? `Script section: ${parsed.data.sectionNumber ? `${parsed.data.sectionNumber}. ` : ""}${parsed.data.sectionTitle}` : "",
            parsed.data.lineKind ? `Line type: ${parsed.data.lineKind}` : "",
            parsed.data.fullLineText ? `Full line context:\n${parsed.data.fullLineText}` : "",
            `Selected text to replace:\n${parsed.data.selectedText}`,
            `Full script context:\n${parsed.data.script}`,
          ].filter(Boolean).join("\n\n"),
        },
      ],
      jsonSchema: {
        name: "voice_campaign_selection_edit",
        schema: {
          type: "object",
          properties: {
            replacement: { type: "string" },
            reason: { type: "string" },
          },
          required: ["replacement", "reason"],
          additionalProperties: false,
        },
        strict: true,
      },
      feature: "voice-campaigns.rewrite-script-selection",
      label: "voice campaign selected script edit",
      datasetId,
      timeoutMs: 120_000,
      maxOutputTokens: 1600,
    });

    const result = parseJsonResponse<{ replacement?: unknown; reason?: unknown }>(raw);
    const replacement = cleanScript(result.replacement, parsed.data.selectedText);
    return Response.json({
      replacement,
      script: replacement,
      reason: typeof result.reason === "string" ? result.reason.trim() : "",
    });
  }

  const userTask = romanizedTarget
    ? "Rewrite this script into editable romanized Hinglish while preserving its meaning:"
    : `Rewrite every customer-facing spoken ("Say:") line into natural casual ${targetAuthoringLanguage}, keeping operator Note/Private guidance in English:`;

  const raw = await generateText({
    messages: [
      {
        role: "system",
        content: authoringLanguageRewritePrompt(targetAuthoringLanguage),
      },
      {
        role: "user",
        content: `${instruction ? `Apply this editing instruction while preserving the campaign logic:\n${instruction}\n\n` : ""}${userTask}\n\n${parsed.data.script}`,
      },
    ],
    jsonSchema: {
      name: "voice_campaign_rewritten_script",
      schema: {
        type: "object",
        properties: {
          script: { type: "string" },
        },
        required: ["script"],
        additionalProperties: false,
      },
      strict: true,
    },
    feature: "voice-campaigns.rewrite-script",
    label: "voice campaign script rewrite",
    datasetId,
    timeoutMs: 180_000,
    maxOutputTokens: 16_000,
  });

  const result = parseJsonResponse<{ script?: unknown }>(raw);
  return Response.json({
    script: cleanScript(result.script, parsed.data.script),
  });
}
