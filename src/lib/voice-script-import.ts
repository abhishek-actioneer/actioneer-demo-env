/**
 * Client script import — pure transforms.
 * ------------------------------------------------------------------------------
 * Turns an uploaded client voicebot script (Word/PDF/text, any house format) into
 * the campaign artifacts the studio already understands: workflow nodes/edges and
 * the `editableScript` text.
 *
 * The contract that makes this safe: an LLM decides *structure* (which beats
 * belong to which stage, how stages route, what the stage is called), but never
 * *composition*. Every customer-facing line it emits must already exist in the
 * source document. `verifyVerbatimSpokenLines` enforces that mechanically after
 * the fact, so a model that paraphrases an RBI disclosure or a penalty amount is
 * caught rather than trusted — see `docs/` note in the route.
 *
 * Nothing here imports Node built-ins or the LLM client, so it is unit-testable
 * and safe to pull into the client bundle for preview/diff rendering.
 */

import type {
  GeneratedVoiceWorkflow,
  GeneratedVoiceWorkflowNode,
} from "@/lib/prompts/voice-campaign";
import {
  IMPORT_UNIVERSAL_ROUTE_KINDS,
  MAX_IMPORT_NODES,
  MAX_ROUTE_BINDINGS,
  type ScriptImportGenre,
  type ScriptImportRouteBinding,
} from "@/lib/prompts/voice-script-import";
import {
  type VoiceUniversalRoute,
  type VoiceUniversalRouteKind,
} from "@/lib/voice-campaign-flow";
import type { CampaignDiagnostic } from "@/lib/voice-diagnostics";

export type { ScriptImportGenre, ScriptImportRouteBinding };

/**
 * Role assigned to a placeholder by the import model, which reads the sentence
 * the token sits in. Mirrors the enum in `prompts/voice-script-import.ts`.
 */
export type PlaceholderRole =
  | "customer-name"
  | "agent-name"
  | "dataset-field"
  | "runtime-slot";

/**
 * Index model-reported placeholder roles by normalized token, so `<Name>`,
 * `{Name}` and `{{ name }}` all resolve to the same entry.
 */
export function buildPlaceholderRoleMap(
  reported: Array<{ token?: unknown; role?: unknown }> | undefined,
): Record<string, PlaceholderRole> {
  const roles: Record<string, PlaceholderRole> = {};
  if (!Array.isArray(reported)) return roles;
  for (const entry of reported) {
    if (typeof entry?.token !== "string" || typeof entry?.role !== "string") continue;
    const role = entry.role as PlaceholderRole;
    if (!["customer-name", "agent-name", "dataset-field", "runtime-slot"].includes(role)) continue;
    // Strip the delimiters so the key matches the inner-token key used below.
    const inner = entry.token.replace(/^[{<[\s]+|[}>\]\s]+$/g, "");
    const key = normalizeKey(inner);
    if (key) roles[key] = role;
  }
  return roles;
}

/** Placeholder dialects seen in client scripts, mapped to runtime-fillable tokens. */
export interface PlaceholderMapping {
  /** Raw token as it appeared in the source, e.g. `{user_name}` or `<xxxx>`. */
  source: string;
  /** Runtime token we rewrote it to, e.g. `{{Customer Name}}`. */
  target: string;
  /** How the runtime will resolve it at dial time. */
  binding: "customer-name" | "dataset-column" | "agent-name" | "runtime-slot" | "unbound";
}

export interface VerbatimIssue {
  nodeId: string;
  nodeTitle: string;
  /** The spoken line the model emitted that is not present in the source. */
  line: string;
  /** Closest source line we could find, to make the diff reviewable. */
  closest?: string;
}

/**
 * Response shape of `POST /api/voice-campaigns/import-script`.
 *
 * Declared here rather than in the route so the studio can type the fetch
 * without importing a server module.
 */
export interface ScriptImportResult {
  campaignName: string;
  firstMessage: string;
  /** Ready to drop into the Script tab / `editableScript`. */
  script: string;
  workflow: GeneratedVoiceWorkflow;
  reasoning: string;
  /** Language the spoken lines are written in, for the studio dropdown. */
  detectedLanguage: string;
  /** House style of the source document — scales downstream restructuring effort. */
  genre: ScriptImportGenre;
  verification: ScriptImportVerification;
  /** Route/verbatim/placeholder findings in the shared diagnostic shape. */
  diagnostics?: CampaignDiagnostic[];
  source: string;
  /** True when the source document was clipped before indexing. */
  truncated: boolean;
}

export interface ScriptImportVerification {
  /** True when every spoken line traces back to the source document. */
  verbatim: boolean;
  checkedLines: number;
  issues: VerbatimIssue[];
  placeholders: PlaceholderMapping[];
  /** Placeholders with no runtime binding — these would be spoken aloud or dropped. */
  unboundPlaceholders: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Placeholder normalization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tokens meaning "the person we are calling". These must land on
 * `{{Customer Name}}` exactly — that is the one placeholder
 * `applyVoiceCustomerPlaceholders` special-cases from displayName/firstName.
 *
 * Deliberately excludes a bare `name`: in "this is <Name> calling you from TVS
 * Credit" that token is the AGENT, and only the surrounding sentence
 * disambiguates it. Bare name tokens are classified by the model instead (see
 * `roles` on `normalizeScriptPlaceholders`) and fall through to `unbound` here
 * so they surface for review rather than silently becoming the customer.
 */
const CUSTOMER_NAME_KEYS = new Set([
  "username",
  "customername",
  "customer",
  "borrowername",
  "clientname",
  "xxxx",
  "xxx",
  "custname",
]);

/** Bare name-ish tokens that are only resolvable from context. */
const AMBIGUOUS_NAME_KEYS = new Set(["name", "names"]);

/** The agent's own name — never a customer/dataset field. */
const AGENT_NAME_KEYS = new Set([
  "agentname",
  "yourname",
  "callername",
  "executivename",
  "advisorname",
]);

/** Slots the model fills mid-call; `applyVoiceCustomerPlaceholders` leaves them alone. */
const RUNTIME_SLOT_KEYS = new Set([
  "selectedlanguage",
  "tomorrowtoday",
  "phonevideo",
]);

/** Mirrors `normalizeVoicePlaceholderKey` in voice-customer-context.ts. */
function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** `emi_amount` / `EMI Amount` → `Emi Amount` (reads well; normalizes identically). */
function titleizeKey(inner: string): string {
  return inner
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}

/**
 * Matches the placeholder dialects observed across client handoffs:
 *   `{user_name}`  `{{Customer Name}}`  `<Name>`  `<xxxx>`  `[callback_time]`
 * Deliberately does NOT match bare `Sir/Madam` — that is spoken copy, not a slot.
 */
const PLACEHOLDER_RE = /\{\{\s*([^{}]+?)\s*\}\}|\{\s*([^{}<>]+?)\s*\}|<\s*([A-Za-z][^<>]{0,60}?)\s*>|\[\s*([a-z][a-z0-9_ ]{1,40}?)\s*\]/g;

/**
 * Rewrite source placeholders onto runtime-fillable tokens.
 *
 * `agentName`, when supplied, is substituted literally: leaving `{{Agent Name}}`
 * in the script means the runtime finds no matching dataset column, and the
 * prompt's "skip unfilled placeholders" rule drops the agent's own name from the
 * introduction — the bot stops saying who it is.
 */
export interface PlaceholderNormalizeOptions {
  /** Campaign agent name, substituted literally for agent-name tokens. */
  agentName?: string;
  /** Model-assigned roles keyed by normalized token — see `buildPlaceholderRoleMap`. */
  roles?: Record<string, PlaceholderRole>;
}

export function normalizeScriptPlaceholders(
  text: string,
  options?: PlaceholderNormalizeOptions,
): { text: string; mappings: PlaceholderMapping[] } {
  const mappings = new Map<string, PlaceholderMapping>();
  const agentName = options?.agentName?.trim();
  const roles = options?.roles;

  const out = text.replace(
    PLACEHOLDER_RE,
    (match, curlyDouble?: string, curlySingle?: string, angle?: string, bracket?: string) => {
      const inner = (curlyDouble ?? curlySingle ?? angle ?? bracket ?? "").trim();
      if (!inner) return match;

      // Angle-bracket form is ambiguous — `<Name>` is a slot, `<3 days>` is not.
      // Require it to look like an identifier, not a phrase with digits/punctuation.
      if (angle !== undefined && !/^[A-Za-z][A-Za-z0-9_ ]*$/.test(inner)) return match;

      const key = normalizeKey(inner);
      if (!key) return match;

      const record = (target: string, binding: PlaceholderMapping["binding"]) => {
        if (!mappings.has(match)) mappings.set(match, { source: match, target, binding });
        return target;
      };

      const asCustomer = () => record("{{Customer Name}}", "customer-name");
      const asAgent = () =>
        agentName ? record(agentName, "agent-name") : record("{{Agent Name}}", "unbound");

      // A model-assigned role wins: it read the sentence around the token, which
      // is the only thing that separates the agent's name from the customer's.
      const role = roles?.[key] ?? roles?.[normalizeKey(match)];
      if (role === "customer-name") return asCustomer();
      if (role === "agent-name") return asAgent();
      if (role === "runtime-slot") return record(`{{${titleizeKey(inner)}}}`, "runtime-slot");
      if (role === "dataset-field") return record(`{{${titleizeKey(inner)}}}`, "dataset-column");

      if (CUSTOMER_NAME_KEYS.has(key)) return asCustomer();
      if (AGENT_NAME_KEYS.has(key)) return asAgent();
      if (RUNTIME_SLOT_KEYS.has(key)) return record(`{{${titleizeKey(inner)}}}`, "runtime-slot");
      // Unclassified bare name token — refuse to guess which party it names.
      if (AMBIGUOUS_NAME_KEYS.has(key)) return record(`{{${titleizeKey(inner)}}}`, "unbound");

      // Everything else becomes a `{{Label}}` that resolves against the sampled
      // segment row when a like-named column exists.
      return record(`{{${titleizeKey(inner)}}}`, "dataset-column");
    },
  );

  return { text: out, mappings: [...mappings.values()] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Verbatim verification
// ─────────────────────────────────────────────────────────────────────────────

const SENTINEL = "\u0000";

/** Collapse whitespace and neutralize placeholders so both sides compare equal. */
function normalizeForCompare(value: string): string {
  return value
    .replace(PLACEHOLDER_RE, SENTINEL)
    .replace(/[\s ]+/g, " ")
    // Word processors curl quotes and dashes; the model tends to emit ASCII.
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/…/g, "...")
    .trim()
    .toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * True when `line` appears in `source`, treating any placeholder on either side
 * as a wildcard. `{user_name}` in the source and `{{Customer Name}}` in the
 * output are the same line, so a straight substring check would false-alarm on
 * every named beat.
 *
 * Both arguments are expected to have already been through
 * `normalizeScriptPlaceholders` with the same options — a placeholder that was
 * substituted for a literal on one side only (e.g. `{agent_name}` → "Priya")
 * cannot be matched by a wildcard. `verifyVerbatimSpokenLines` handles that.
 */
export function isVerbatimFromSource(line: string, source: string): boolean {
  const needle = normalizeForCompare(line);
  if (!needle) return true;
  const haystack = normalizeForCompare(source);
  if (!needle.includes(SENTINEL)) return haystack.includes(needle);

  const pattern = needle
    .split(SENTINEL)
    .map(escapeRegExp)
    // A placeholder stands in for a name/amount/date — bounded so it can't span beats.
    .join("[^\\n]{0,80}");
  return new RegExp(pattern).test(haystack);
}

/** Lines in a node body that are customer-facing speech, not private guidance. */
export function extractSpokenLines(body: string): string[] {
  const lines: string[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const say = line.match(/^(?:Say|कहें)\s*[:：]\s*(.+)$/i);
    if (say?.[1]) lines.push(say[1].trim());
  }
  return lines;
}

/** Explicitly private, never-spoken guidance prefixes. */
const PRIVATE_LINE_PREFIX = /^(?:note|notes|private|internal|ध्यान दें)\s*[:：]/i;

/** Structural sentinel the sanitizer writes for an empty body — not client copy. */
export const IMPORT_EMPTY_BODY_PLACEHOLDER = "(No content captured for this step.)";

/**
 * Every line of a node body a live call could actually speak.
 *
 * `extractSpokenLines` only sees `Say:`-prefixed lines, but the compiler renders
 * the WHOLE body into the runtime talk track — so a line the model composed
 * without the prefix reaches the customer exactly like a `Say:` line while
 * escaping verification entirely. Anything not explicitly marked private is
 * therefore checked; a dropped `Say: ` prefix must not be an escape hatch.
 */
export function extractVerifiableLines(body: string): string[] {
  const lines: string[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (PRIVATE_LINE_PREFIX.test(line)) continue;
    if (line === IMPORT_EMPTY_BODY_PLACEHOLDER) continue;
    const say = line.match(/^(?:Say|कहें)\s*[:：]\s*(.+)$/i);
    lines.push((say?.[1] ?? line).trim());
  }
  return lines;
}

function closestSourceLine(line: string, source: string): string | undefined {
  const needle = normalizeForCompare(line);
  const words = needle.split(" ").filter((w) => w.length > 3);
  if (words.length === 0) return undefined;
  let best: { score: number; text: string } | undefined;
  for (const raw of source.split(/\r?\n/)) {
    const candidate = raw.trim();
    if (candidate.length < 12) continue;
    const hay = normalizeForCompare(candidate);
    let score = 0;
    for (const word of words) if (hay.includes(word)) score += 1;
    if (score > 0 && (!best || score > best.score)) best = { score, text: candidate };
  }
  // Require meaningful overlap, else the "closest" line is just noise.
  return best && best.score >= Math.max(2, Math.ceil(words.length * 0.3)) ? best.text : undefined;
}

/**
 * Check every spoken line in the workflow against the source document.
 *
 * This is the guarantee behind importing compliance text: the model restructures
 * freely, but if it rewords "750 rupaye ka flat charge" the mismatch surfaces
 * here instead of reaching a live call.
 */
export function verifyVerbatimSpokenLines(
  workflow: Pick<GeneratedVoiceWorkflow, "nodes">,
  sourceText: string,
  placeholders: PlaceholderMapping[] = [],
  options?: PlaceholderNormalizeOptions & { firstMessage?: string },
): ScriptImportVerification {
  const issues: VerbatimIssue[] = [];
  let checkedLines = 0;

  // Compare against a source that has had the SAME placeholder mapping applied.
  // Otherwise substituting `{agent_name}` → "Priya" in the output makes every
  // introduction line look like a rewrite, and the real drift hides in the noise.
  const source = normalizeScriptPlaceholders(sourceText, options).text;

  const check = (line: string, nodeId: string, nodeTitle: string) => {
    checkedLines += 1;
    if (isVerbatimFromSource(line, source)) return;
    issues.push({ nodeId, nodeTitle, line, closest: closestSourceLine(line, source) });
  };

  // The opening line is spoken by the launch code before the model gets a turn,
  // so it needs the same guarantee as any node body.
  const opening = options?.firstMessage?.trim();
  if (opening) check(opening, "__first_message__", "Opening line");

  for (const node of workflow.nodes) {
    // extractVerifiableLines, not extractSpokenLines: the runtime speaks the
    // whole body, so an unprefixed line must be checked too.
    for (const line of extractVerifiableLines(node.body)) check(line, node.id, node.title);
  }

  return {
    verbatim: issues.length === 0,
    checkedLines,
    issues,
    placeholders,
    unboundPlaceholders: placeholders
      .filter((p) => p.binding === "unbound")
      .map((p) => p.target),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Script serialization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Render imported nodes as Script-tab text.
 *
 * Uses the same "Conversation script:" / numbered-section shape that
 * `parseConversationScript` reads back, so the script↔workflow sync in
 * `use-campaign-draft` round-trips an imported script without clobbering it.
 */
export function buildImportedScriptText(workflow: GeneratedVoiceWorkflow): string {
  const sections: string[] = ["Conversation script:"];

  workflow.nodes.forEach((node, index) => {
    sections.push("", `${index + 1}. ${node.title}`);
    const body = node.body.trim();
    sections.push(body || "(Write what the agent should say or do at this step.)");
    if (node.helper?.trim()) sections.push(`Note: ${node.helper.trim()}`);
  });

  const routes = workflow.edges
    .map((edge) => {
      const source = workflow.nodes.find((n) => n.id === edge.source)?.title ?? edge.source;
      const target = workflow.nodes.find((n) => n.id === edge.target)?.title ?? edge.target;
      const label = edge.label?.trim() ? ` when ${edge.label.trim()}` : "";
      return `- ${source} -> ${target}${label}`;
    })
    .filter(Boolean);

  if (routes.length > 0) sections.push("", "Routing notes:", ...routes);

  return sections.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Sanitization
// ─────────────────────────────────────────────────────────────────────────────

const NODE_KINDS = new Set<GeneratedVoiceWorkflowNode["kind"]>([
  "start", "prompt", "question", "condition", "action", "transfer", "end",
]);

/** Node bodies hold every approved alternate for a stage, so the cap is generous. */
const MAX_BODY_CHARS = 12_000;
const MAX_TITLE_CHARS = 90;
const MAX_HELPER_CHARS = 300;

function cleanId(value: unknown, fallback: string): string {
  const raw = typeof value === "string" ? value : fallback;
  const id = raw.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return id || fallback;
}

/** Trim and length-cap without collapsing newlines — body line structure is meaningful. */
function cleanBody(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : "";
  if (!text) return fallback;
  return text.length <= MAX_BODY_CHARS ? text : `${text.slice(0, MAX_BODY_CHARS).trimEnd()}…`;
}

function cleanLine(value: unknown, fallback: string, max: number): string {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (!text) return fallback;
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Id assignment shared by `sanitizeImportedWorkflow` and `mapImportedNodeIds`,
 * so anything referencing a model-emitted node id (route bindings) can be
 * resolved against the post-sanitization id without re-guessing the rename.
 */
function assignImportNodeIds(rawNodes: unknown[]): string[] {
  const seen = new Set<string>();
  return rawNodes.slice(0, MAX_IMPORT_NODES).map((raw, index) => {
    const candidate = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<GeneratedVoiceWorkflowNode>;
    let id = cleanId(candidate.id, index === 0 ? "start" : `step-${index + 1}`);
    if (seen.has(id)) id = `${id}-${index + 1}`;
    seen.add(id);
    return id;
  });
}

/**
 * Model-emitted node id → sanitized node id, for the same raw workflow value
 * later passed to `sanitizeImportedWorkflow`. First occurrence wins on
 * duplicate raw ids, matching how the sanitizer dedupes.
 */
export function mapImportedNodeIds(value: unknown): Record<string, string> {
  const source = (typeof value === "object" && value !== null ? value : {}) as Partial<GeneratedVoiceWorkflow>;
  const rawNodes = Array.isArray(source.nodes) ? source.nodes : [];
  const finalIds = assignImportNodeIds(rawNodes);
  const map: Record<string, string> = {};
  rawNodes.slice(0, MAX_IMPORT_NODES).forEach((raw, index) => {
    const candidate = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<GeneratedVoiceWorkflowNode>;
    if (typeof candidate.id === "string" && candidate.id && !(candidate.id in map)) {
      map[candidate.id] = finalIds[index];
    }
  });
  return map;
}

/**
 * Structurally repair the model's workflow without touching spoken text.
 *
 * Mirrors `sanitizeWorkflow` in the generate-script route, but keeps the higher
 * import node cap and does not truncate node bodies to 800 chars — an imported
 * stage legitimately carries every approved phrasing variant for that stage, and
 * clamping would silently delete client-approved copy.
 */
export function sanitizeImportedWorkflow(
  value: unknown,
  fallbacks: { objective: string; audienceHint: string },
): GeneratedVoiceWorkflow {
  const source = (typeof value === "object" && value !== null ? value : {}) as Partial<GeneratedVoiceWorkflow>;
  const rawNodes = Array.isArray(source.nodes) ? source.nodes : [];

  const nodeIds = assignImportNodeIds(rawNodes);
  const nodes: GeneratedVoiceWorkflowNode[] = rawNodes
    .slice(0, MAX_IMPORT_NODES)
    .map((raw, index) => {
      const candidate = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<GeneratedVoiceWorkflowNode>;
      const kind = candidate.kind && NODE_KINDS.has(candidate.kind) ? candidate.kind : "prompt";
      return {
        id: nodeIds[index],
        kind,
        title: cleanLine(candidate.title, `Step ${index + 1}`, MAX_TITLE_CHARS),
        body: cleanBody(candidate.body, "(No content captured for this step.)"),
        helper: candidate.helper ? cleanLine(candidate.helper, "", MAX_HELPER_CHARS) || null : null,
      };
    });

  // Exactly one start; demote later duplicates rather than dropping their content.
  let hasStart = false;
  for (const node of nodes) {
    if (node.kind !== "start") continue;
    if (hasStart) node.kind = "prompt";
    hasStart = true;
  }
  if (nodes.length > 0 && !hasStart) nodes[0].kind = "start";
  if (nodes.length === 0) {
    nodes.push({
      id: "start",
      kind: "start",
      title: "Call Connect",
      body: "(No content captured for this step.)",
      helper: null,
    });
  }
  if (!nodes.some((n) => n.kind === "end")) {
    nodes[nodes.length - 1].kind = nodes.length === 1 ? nodes[0].kind : "end";
    if (nodes.length === 1) {
      nodes.push({ id: "end", kind: "end", title: "Close Call", body: "Note: Close politely.", helper: null });
    }
  }

  const ids = new Set(nodes.map((n) => n.id));
  const rawEdges = Array.isArray(source.edges) ? source.edges : [];
  const edgeKeys = new Set<string>();
  const edges = rawEdges
    .map((raw) => {
      const candidate = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
      const from = typeof candidate.source === "string" ? cleanId(candidate.source, "") : "";
      const to = typeof candidate.target === "string" ? cleanId(candidate.target, "") : "";
      if (!from || !to || !ids.has(from) || !ids.has(to) || from === to) return null;
      const label = typeof candidate.label === "string" && candidate.label.trim()
        ? cleanLine(candidate.label, "", 120)
        : null;
      const key = `${from}->${to}->${label ?? ""}`;
      if (edgeKeys.has(key)) return null;
      edgeKeys.add(key);
      return { source: from, target: to, label };
    })
    .filter((e): e is GeneratedVoiceWorkflow["edges"][number] => Boolean(e));

  if (edges.length === 0) {
    for (let i = 0; i < nodes.length - 1; i += 1) {
      edges.push({ source: nodes[i].id, target: nodes[i + 1].id, label: null });
    }
  }

  return {
    title: cleanLine(source.title, "Imported client script", MAX_TITLE_CHARS),
    description: cleanLine(source.description, "Imported from a client script document.", 200),
    objective: cleanLine(source.objective, fallbacks.objective, 600),
    audienceHint: cleanLine(source.audienceHint, fallbacks.audienceHint, 240),
    nodes,
    edges,
  };
}

/**
 * Apply placeholder normalization across a generated workflow in place of the
 * raw model output, returning the mappings found anywhere in the talk track.
 */
export function normalizeWorkflowPlaceholders(
  workflow: GeneratedVoiceWorkflow,
  options?: PlaceholderNormalizeOptions,
): { workflow: GeneratedVoiceWorkflow; mappings: PlaceholderMapping[] } {
  const seen = new Map<string, PlaceholderMapping>();

  const run = (value: string): string => {
    const { text, mappings } = normalizeScriptPlaceholders(value, options);
    for (const mapping of mappings) if (!seen.has(mapping.source)) seen.set(mapping.source, mapping);
    return text;
  };

  const nodes: GeneratedVoiceWorkflowNode[] = workflow.nodes.map((node) => ({
    ...node,
    title: run(node.title),
    body: run(node.body),
    helper: node.helper ? run(node.helper) : node.helper,
  }));

  return {
    workflow: { ...workflow, nodes },
    mappings: [...seen.values()],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Genre, provenance, universal-route binding, diagnostics
// ─────────────────────────────────────────────────────────────────────────────

/** Clamp the model's genre claim onto the closed set; anything else is "unknown". */
export function normalizeImportGenre(value: unknown): ScriptImportGenre {
  return value === "voicebot-native" || value === "human-telecaller" ? value : "unknown";
}

/**
 * Stamp every node with a provenance. Import stamps "verbatim": the bodies were
 * copied out of a client document, so downstream edit gates and the fact ledger
 * must treat them as client-approved text, never as model-authored text.
 */
export function stampWorkflowProvenance(
  workflow: GeneratedVoiceWorkflow,
  provenance: NonNullable<GeneratedVoiceWorkflowNode["provenance"]>,
): GeneratedVoiceWorkflow {
  return {
    ...workflow,
    nodes: workflow.nodes.map((node) => ({ ...node, provenance })),
  };
}

const ROUTE_KIND_SET = new Set<string>(IMPORT_UNIVERSAL_ROUTE_KINDS);

/** Neutral, wording-free trigger descriptions — the wording comes from the document. */
const ROUTE_KIND_TRIGGERS: Record<VoiceUniversalRouteKind, string> = {
  end_call: "Customer asks to end the call",
  do_not_call: "Customer asks not to be contacted again",
  not_interested: "Customer declines the offer or pitch",
  busy_callback: "Customer is busy and asks to be called later",
  wrong_person: "The person on the line is not the intended customer",
  change_language: "Customer asks to continue in another language",
  question_confusion: "Customer asks a question or sounds confused",
  escalation: "Customer asks for a human agent or supervisor",
  silence_unclear: "Customer is silent or cannot be heard clearly",
  voicemail_screening: "Voicemail or call screening is detected",
};

/** `wrong_person` → `Wrong Person`. */
function routeKindLabel(kind: VoiceUniversalRouteKind): string {
  return kind
    .split("_")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

/** Drop malformed or unknown-kind entries from the model's binding list. */
export function sanitizeRouteBindings(value: unknown): ScriptImportRouteBinding[] {
  if (!Array.isArray(value)) return [];
  const bindings: ScriptImportRouteBinding[] = [];
  for (const raw of value.slice(0, MAX_ROUTE_BINDINGS)) {
    const candidate = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    if (typeof candidate.kind !== "string" || !ROUTE_KIND_SET.has(candidate.kind)) continue;
    if (typeof candidate.nodeId !== "string" || !candidate.nodeId.trim()) continue;
    const sayLine =
      typeof candidate.sayLine === "string" && candidate.sayLine.trim()
        ? candidate.sayLine.trim()
        : null;
    bindings.push({
      kind: candidate.kind as VoiceUniversalRouteKind,
      nodeId: candidate.nodeId.trim(),
      sayLine,
    });
  }
  return bindings;
}

/**
 * Turn model-reported route bindings into `VoiceUniversalRoute[]` against the
 * SANITIZED workflow, plus diagnostics for everything that could not ship.
 *
 * - A binding whose node id survived sanitization (via `idMap` from
 *   `mapImportedNodeIds`) becomes a route targeting that node.
 * - A binding whose node vanished is dropped; its kind then reads as unbound.
 * - A `sayLine` must pass the same verbatim check as any spoken line — a route
 *   is the one place wording fires without an operator reading it first, so a
 *   paraphrased line is dropped (with a warn) rather than shipped.
 * - Every kind with no surviving binding gets an `info` diagnostic: the
 *   platform default behavior applies there.
 */
export function convertUniversalRouteBindings(
  bindings: ScriptImportRouteBinding[],
  workflow: GeneratedVoiceWorkflow,
  idMap: Record<string, string>,
  sourceText: string,
  options?: PlaceholderNormalizeOptions,
): { routes: VoiceUniversalRoute[]; diagnostics: CampaignDiagnostic[] } {
  const routes: VoiceUniversalRoute[] = [];
  const diagnostics: CampaignDiagnostic[] = [];
  const bound = new Set<VoiceUniversalRouteKind>();
  const nodesById = new Map(workflow.nodes.map((node) => [node.id, node]));
  // Same normalization the verbatim verifier applies to its source side.
  const source = normalizeScriptPlaceholders(sourceText, options).text;

  for (const binding of bindings) {
    if (bound.has(binding.kind)) continue;

    // The model may echo the raw id (mapped) or already emit the cleaned form.
    const mappedId = idMap[binding.nodeId] ?? cleanId(binding.nodeId, "");
    const node = nodesById.get(mappedId);
    if (!node) continue; // dangling — surfaces below as an unbound-kind info

    let sayLine: string | null = null;
    if (binding.sayLine) {
      sayLine = normalizeScriptPlaceholders(binding.sayLine, options)
        .text.replace(/\s+/g, " ")
        .trim();
      if (!isVerbatimFromSource(sayLine, source)) {
        diagnostics.push({
          id: `route-drifted-${binding.kind}`,
          severity: "warn",
          source: "route",
          nodeId: node.id,
          message: `Dropped the ${routeKindLabel(binding.kind)} route: its line is not verbatim from the source document.`,
          data: { kind: binding.kind, sayLine },
        });
        continue;
      }
    }

    bound.add(binding.kind);
    // One rule for imported routes: when the
    // client's document dedicates a stage to the situation (a bound target),
    // soft-terminal kinds continue INTO that stage instead of hanging up —
    // that stage is the client's own approved handling. Hard-terminal kinds
    // (end_call, do_not_call, voicemail_screening) end the call regardless.
    const hardTerminal =
      binding.kind === "end_call" ||
      binding.kind === "do_not_call" ||
      binding.kind === "voicemail_screening";
    routes.push({
      kind: binding.kind,
      label: routeKindLabel(binding.kind),
      trigger: ROUTE_KIND_TRIGGERS[binding.kind],
      behavior: sayLine ?? `Follow the "${node.title}" step`,
      targetNodeId: node.id,
      terminal: hardTerminal,
    });
  }

  for (const kind of IMPORT_UNIVERSAL_ROUTE_KINDS) {
    if (bound.has(kind)) continue;
    diagnostics.push({
      id: `route-unbound-${kind}`,
      severity: "info",
      source: "route",
      message: `No approved wording found for ${kind}; platform default behavior will apply.`,
    });
  }

  return { routes, diagnostics };
}

/**
 * Project the existing verification result into the shared diagnostic shape.
 * The `verification` field stays on the response untouched for the current UI;
 * these entries are the forward-looking surface the diagnostics panel reads.
 */
export function buildImportDiagnostics(
  verification: ScriptImportVerification,
): CampaignDiagnostic[] {
  const diagnostics: CampaignDiagnostic[] = [];

  verification.issues.forEach((issue, index) => {
    diagnostics.push({
      id: `verbatim-${issue.nodeId}-${index}`,
      severity: "error",
      source: "verbatim",
      nodeId: issue.nodeId,
      message: `"${issue.line}" is not verbatim from the source document.`,
      ...(issue.closest ? { data: { closest: issue.closest } } : {}),
    });
  });

  verification.unboundPlaceholders.forEach((token, index) => {
    diagnostics.push({
      id: `placeholder-unbound-${index}`,
      severity: "warn",
      source: "placeholder",
      message: `${token} has no runtime binding — it would be spoken aloud or dropped on the call.`,
      data: { token },
    });
  });

  return diagnostics;
}
