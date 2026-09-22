// Fact ledger: the generated-content sibling of verifyVerbatimSpokenLines
// (docs/script-generator-design.md, Principle 2). Deterministic — no LLM calls.
import type { CampaignDiagnostic } from "@/lib/voice-diagnostics";

export interface FactAtom {
  raw: string;
  kind: "currency" | "percentage" | "number" | "date" | "tenure";
  index: number;
}

export interface FactSources {
  brief?: string;
  purposeText?: string;
  datasetColumns?: string[];
  archetypeSafeDefaults?: string[];
  operatorAnswers?: string[];
  extraSourceTexts?: string[];
}

const MONTH_NAMES =
  "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

// Must END on a digit — "[\\d,]*" alone swallows a sentence comma ("₹5,000, aur…"
// captured "5,000,"), which broke source matching for correctly sourced values
// and deleted the comma from the rewritten body.
const NUM = "\\d(?:[\\d,]*\\d)?(?:\\.\\d+)?";

// Ordered by priority — earlier patterns claim their span first.
const ATOM_PATTERNS: Array<{ kind: FactAtom["kind"]; pattern: RegExp }> = [
  // Tenure ranges: "6 to 24 months", "6-48 months", "12 se 24 mahine"
  {
    kind: "tenure",
    pattern: new RegExp(
      `\\b\\d+(?:\\.\\d+)?\\s*(?:to|se|-|–)\\s*\\d+(?:\\.\\d+)?\\s*(?:months?|years?|mahine|mahino|mahina|saal)\\b`,
      "gi",
    ),
  },
  // Single tenure: "24 months", "5 saal"
  {
    kind: "tenure",
    pattern: new RegExp(`\\b\\d+(?:\\.\\d+)?\\s*(?:months?|years?|mahine|mahino|mahina|saal)\\b`, "gi"),
  },
  // Currency with prefix marker: "₹5,000", "Rs. 2500", "INR 1.5 lakh"
  {
    kind: "currency",
    pattern: new RegExp(
      `(?:₹|(?<![a-z])rs\\.?(?![a-z])|(?<![a-z])inr(?![a-z]))\\s*${NUM}\\s*(?:lakhs?|lacs?|crores?|hazaar|thousand|k\\b)?`,
      "gi",
    ),
  },
  // Currency with unit/word suffix: "2 lakh", "500 rupaye", "1.5 crore rupees"
  {
    kind: "currency",
    pattern: new RegExp(
      `\\b${NUM}\\s*(?:lakhs?|lacs?|crores?|hazaar)(?:\\s*(?:rupees|rupaye|rupay|rs\\.?))?|\\b${NUM}\\s*(?:rupees|rupaye|rupay)\\b`,
      "gi",
    ),
  },
  // Percentages: "2%", "2.5 percent", "12 pratishat"
  {
    kind: "percentage",
    pattern: new RegExp(`\\b${NUM}\\s*(?:%|percent|per\\s+cent|pratishat)`, "gi"),
  },
  // Numeric dates: "15/08/2026", "15-08-26", "2026-08-15"
  {
    kind: "date",
    pattern: /\b\d{1,4}[\/-]\d{1,2}[\/-]\d{2,4}\b/g,
  },
  // Day-first month-name dates: "15 August", "3rd Sept 2026"
  {
    kind: "date",
    pattern: new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH_NAMES}\\.?(?:\\s+\\d{4})?\\b`, "gi"),
  },
  // Month-first dates: "August 15", "Sept 3, 2026"
  {
    kind: "date",
    pattern: new RegExp(`\\b${MONTH_NAMES}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b`, "gi"),
  },
];

const STANDALONE_NUMBER = /(?<![A-Za-z0-9])\d(?:[\d,]*\d)?(?:\.\d+)?(?![A-Za-z0-9])/g;

/**
 * Blank out (preserving offsets) the regions extraction must ignore:
 * {{...}} / {...} placeholder tokens and entire "Note:"-prefixed lines.
 * Only "Say:"-prefixed lines and bare body text count.
 */
function maskIgnoredRegions(text: string): string {
  let masked = text.replace(/\{\{[^}]*\}\}|\{[^{}]*\}/g, (match) => " ".repeat(match.length));
  masked = masked
    .split("\n")
    .map((line) => (/^\s*note\s*:/i.test(line) ? " ".repeat(line.length) : line))
    .join("\n");
  return masked;
}

function overlaps(spans: Array<[number, number]>, start: number, end: number): boolean {
  return spans.some(([s, e]) => start < e && end > s);
}

export function extractFactAtoms(text: string): FactAtom[] {
  const masked = maskIgnoredRegions(text);
  const atoms: FactAtom[] = [];
  const claimed: Array<[number, number]> = [];

  for (const { kind, pattern } of ATOM_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of masked.matchAll(pattern)) {
      const start = match.index;
      const raw = match[0].trim();
      const end = start + match[0].length;
      if (raw.length === 0 || overlaps(claimed, start, end)) continue;
      claimed.push([start, end]);
      atoms.push({ raw, kind, index: start });
    }
  }

  // Standalone numbers >= 100 (skips B1/G2-style labels via the alnum lookbehind,
  // and list indices / small counts via the floor).
  STANDALONE_NUMBER.lastIndex = 0;
  for (const match of masked.matchAll(STANDALONE_NUMBER)) {
    const start = match.index;
    const raw = match[0];
    const end = start + raw.length;
    if (overlaps(claimed, start, end)) continue;
    const value = Number.parseFloat(raw.replace(/,/g, ""));
    if (!Number.isFinite(value) || value < 100) continue;
    claimed.push([start, end]);
    atoms.push({ raw, kind: "number", index: start });
  }

  return atoms.sort((a, b) => a.index - b.index);
}

/** Lowercase, collapse whitespace, strip commas inside numbers. */
function normalizeFactText(text: string): string {
  return text
    .toLowerCase()
    .replace(/(\d),(?=\d)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function collectSourceTexts(sources: FactSources): string[] {
  return [
    sources.brief,
    sources.purposeText,
    ...(sources.datasetColumns ?? []),
    ...(sources.archetypeSafeDefaults ?? []),
    ...(sources.operatorAnswers ?? []),
    ...(sources.extraSourceTexts ?? []),
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map(normalizeFactText);
}

const PLACEHOLDER_BASE: Record<FactAtom["kind"], string> = {
  currency: "Amount",
  percentage: "Rate",
  date: "Date",
  tenure: "Tenure",
  number: "Number",
};

export function applyFactLedgerToWorkflow(
  workflow: { nodes: Array<{ id: string; body: string; provenance?: string }> },
  sources: FactSources,
): { diagnostics: CampaignDiagnostic[]; rewrittenNodes: Array<{ id: string; body: string }> } {
  const normalizedSources = collectSourceTexts(sources);
  const diagnostics: CampaignDiagnostic[] = [];
  const rewrittenNodes: Array<{ id: string; body: string }> = [];

  // Deterministic placeholder assignment: same normalized atom always maps to
  // the same token; new atoms of a kind get a numeric suffix ({{Amount2}}, ...).
  const placeholderByAtom = new Map<string, string>();
  const kindCounters: Record<FactAtom["kind"], number> = {
    currency: 0,
    percentage: 0,
    number: 0,
    date: 0,
    tenure: 0,
  };

  for (const node of workflow.nodes) {
    if (node.provenance === "verbatim" || node.provenance === "operator") continue;

    const atoms = extractFactAtoms(node.body);
    const unsourced = atoms.filter((atom) => {
      const normalized = normalizeFactText(atom.raw);
      return !normalizedSources.some((source) => source.includes(normalized));
    });
    if (unsourced.length === 0) continue;

    // Assign placeholders in reading order so suffixes are deterministic,
    // then replace back-to-front so earlier indices stay valid.
    for (const atom of unsourced) {
      const atomKey = `${atom.kind}:${normalizeFactText(atom.raw)}`;
      if (placeholderByAtom.has(atomKey)) continue;
      kindCounters[atom.kind] += 1;
      const suffix = kindCounters[atom.kind] === 1 ? "" : String(kindCounters[atom.kind]);
      placeholderByAtom.set(atomKey, `{{${PLACEHOLDER_BASE[atom.kind]}${suffix}}}`);
    }

    let body = node.body;
    for (const atom of [...unsourced].sort((a, b) => b.index - a.index)) {
      const placeholder = placeholderByAtom.get(`${atom.kind}:${normalizeFactText(atom.raw)}`) ?? "";
      body = body.slice(0, atom.index) + placeholder + body.slice(atom.index + atom.raw.length);
    }

    for (const atom of unsourced) {
      const placeholder = placeholderByAtom.get(`${atom.kind}:${normalizeFactText(atom.raw)}`) ?? "";
      diagnostics.push({
        id: `fact-ledger-${node.id}-${atom.index}`,
        severity: "error",
        source: "fact-ledger",
        message: `"${atom.raw}" (${atom.kind}) has no source in the brief, dataset, or answers. Replaced with ${placeholder} — provide the value or remove the claim.`,
        nodeId: node.id,
        data: { raw: atom.raw, kind: atom.kind, placeholder },
      });
    }

    rewrittenNodes.push({ id: node.id, body });
  }

  return { diagnostics, rewrittenNodes };
}
