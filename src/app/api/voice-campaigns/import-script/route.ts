import { auth } from "@clerk/nextjs/server";
import { generateText, parseJsonResponse } from "@/lib/llm";
import { DEFAULT_DATASET } from "@/lib/datasets/constants";
import {
  buildVoiceScriptImportPrompt,
  VOICE_SCRIPT_IMPORT_SCHEMA,
  type ScriptImportPromptResult,
} from "@/features/prompts/voice/script-import";
import {
  extractScriptDocument,
  ScriptDocumentError,
  type ScriptDocument,
} from "@/lib/server/voice-script-document";
import {
  buildImportDiagnostics,
  buildImportedScriptText,
  buildPlaceholderRoleMap,
  convertUniversalRouteBindings,
  mapImportedNodeIds,
  normalizeImportGenre,
  normalizeScriptPlaceholders,
  normalizeWorkflowPlaceholders,
  sanitizeImportedWorkflow,
  sanitizeRouteBindings,
  stampWorkflowProvenance,
  verifyVerbatimSpokenLines,
  type ScriptImportResult,
} from "@/lib/voice-script-import";
import { VOICE_CAMPAIGN_EDITABLE_SCRIPT_MAX_CHARS } from "@/lib/voice-campaign-studio-utils";

// DOCX/PDF parsing needs the Node runtime (Buffer, mammoth, unpdf).
export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** Pasted text path — generous but bounded, matching the doc extraction cap. */
const MAX_PASTED_CHARS = 180_000;

function datasetIdFromRequest(req: Request, bodyDatasetId?: string): string {
  const raw = bodyDatasetId
    || new URL(req.url).searchParams.get("datasetId")
    || req.headers.get("x-dataset-id")
    || DEFAULT_DATASET;
  return /^[a-z0-9_-]+$/.test(raw) && raw.length <= 64 ? raw : DEFAULT_DATASET;
}

function trimmedField(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text) return undefined;
  return text.slice(0, max);
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const contentType = (req.headers.get("content-type") || "").toLowerCase();

  let document: ScriptDocument;
  let agentName: string | undefined;
  let companyName: string | undefined;
  let segmentName: string | undefined;
  let datasetId: string;

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return Response.json({ error: "No file provided." }, { status: 400 });
      }
      if (file.size === 0) {
        return Response.json({ error: "That file is empty." }, { status: 400 });
      }
      if (file.size > MAX_FILE_BYTES) {
        return Response.json({ error: "File is too large (max 20MB)." }, { status: 413 });
      }
      agentName = trimmedField(form.get("agentName"), 80);
      companyName = trimmedField(form.get("companyName"), 200);
      segmentName = trimmedField(form.get("segmentName"), 200);
      datasetId = datasetIdFromRequest(req, trimmedField(form.get("datasetId"), 64));
      document = await extractScriptDocument(await file.arrayBuffer(), file.name, file.type);
    } else {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const text = trimmedField(body.text, MAX_PASTED_CHARS);
      if (!text || text.length < 40) {
        return Response.json(
          { error: "Provide a script file, or paste at least a few lines of script text." },
          { status: 400 },
        );
      }
      agentName = trimmedField(body.agentName, 80);
      companyName = trimmedField(body.companyName, 200);
      segmentName = trimmedField(body.segmentName, 200);
      datasetId = datasetIdFromRequest(req, trimmedField(body.datasetId, 64));
      document = {
        text,
        label: trimmedField(body.label, 80) ?? "Pasted script",
        source: "pasted-text",
        truncated: false,
      };
    }
  } catch (err) {
    if (err instanceof ScriptDocumentError) {
      return Response.json({ error: err.message }, { status: 422 });
    }
    console.error("[voice-campaigns/import-script] extraction failed:", err);
    return Response.json({ error: "Could not read that script file." }, { status: 422 });
  }

  const { system, user } = buildVoiceScriptImportPrompt(document.text, {
    fileLabel: document.label,
    companyName,
    segmentName,
  });

  let raw: string;
  try {
    raw = await generateText({
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      jsonSchema: VOICE_SCRIPT_IMPORT_SCHEMA,
      feature: "voice-campaigns.import-script",
      label: "voice campaign script import",
      datasetId,
      timeoutMs: 240_000,
      maxOutputTokens: 32_000,
    });
  } catch (err) {
    console.error("[voice-campaigns/import-script] generation failed:", err);
    return Response.json(
      { error: "Could not index that script. Try again, or split a very long document into separate files." },
      { status: 502 },
    );
  }

  let result: ScriptImportPromptResult;
  try {
    result = parseJsonResponse<ScriptImportPromptResult>(raw);
  } catch {
    return Response.json({ error: "Script import produced invalid JSON." }, { status: 502 });
  }

  const sanitized = sanitizeImportedWorkflow(result.workflow, {
    objective: `Run the ${document.label} script as authored.`,
    audienceHint: segmentName ?? "Imported client audience",
  });

  // Placeholder rewriting is deterministic, not delegated to the model — the
  // prompt tells it to leave tokens untouched precisely so this step is the only
  // thing that changes them, and so verification below stays meaningful.
  const roles = buildPlaceholderRoleMap(result.placeholders);
  const { workflow: normalized, mappings } = normalizeWorkflowPlaceholders(sanitized, { agentName, roles });

  // Everything in an imported workflow was copied out of the client document;
  // provenance marks it so downstream edit gates treat it as approved text.
  const workflow = stampWorkflowProvenance(normalized, "verbatim");

  // The sanitizer renames node ids, so resolve the model's binding targets
  // through the raw→sanitized id map before converting to universal routes.
  const { routes, diagnostics: routeDiagnostics } = convertUniversalRouteBindings(
    sanitizeRouteBindings(result.universalRouteBindings),
    workflow,
    mapImportedNodeIds(result.workflow),
    document.text,
    { agentName, roles },
  );
  workflow.universalRoutes = routes;

  const firstMessage = normalizeScriptPlaceholders(result.firstMessage ?? "", { agentName, roles })
    .text.replace(/\s+/g, " ")
    .trim();

  const verification = verifyVerbatimSpokenLines(workflow, document.text, mappings, {
    agentName,
    roles,
    firstMessage,
  });

  const script = buildImportedScriptText(workflow);
  if (script.length > VOICE_CAMPAIGN_EDITABLE_SCRIPT_MAX_CHARS) {
    return Response.json(
      { error: "That script is too long to import into a single campaign." },
      { status: 413 },
    );
  }

  const genre = normalizeImportGenre(result.genre);
  const diagnostics = [...routeDiagnostics, ...buildImportDiagnostics(verification)];

  console.info("[voice/import-script]", {
    event: "import.complete",
    source: document.source,
    chars: document.text.length,
    truncated: document.truncated,
    genre,
    nodes: workflow.nodes.length,
    edges: workflow.edges.length,
    boundRoutes: routes.length,
    checkedLines: verification.checkedLines,
    verbatim: verification.verbatim,
    drifted: verification.issues.length,
    unbound: verification.unboundPlaceholders.length,
    diagnostics: diagnostics.length,
  });

  const response: ScriptImportResult = {
    campaignName: (result.campaignName || document.label).slice(0, 120),
    firstMessage: firstMessage.slice(0, 300),
    script,
    workflow,
    reasoning: (result.reasoning || "").slice(0, 600),
    detectedLanguage: (result.detectedLanguage || "Hinglish").slice(0, 40),
    genre,
    verification,
    diagnostics,
    source: document.source,
    truncated: document.truncated,
  };

  return Response.json(response, { headers: { "Cache-Control": "no-store" } });
}
