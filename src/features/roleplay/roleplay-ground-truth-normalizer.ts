import { generateJson } from "@/lib/llm";

interface NormalizedGroundTruth {
  sections: Array<{
    heading: string;
    level: "h1" | "h2" | "h3";
    blocks: Array<{
      label: string;
      bullets: string[];
    }>;
  }>;
}

interface NormalizeOptions {
  datasetId: string;
  productLabel?: string;
  source?: string;
}

interface ProtectedTable {
  token: string;
  markdown: string;
}

interface SourceChunk {
  label: string;
  source?: string;
  text: string;
}

const NORMALIZED_GROUND_TRUTH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["sections"],
  properties: {
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["heading", "level", "blocks"],
        properties: {
          heading: { type: "string" },
          level: { type: "string", enum: ["h1", "h2", "h3"] },
          blocks: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["label", "bullets"],
              properties: {
                label: { type: "string" },
                bullets: {
                  type: "array",
                  items: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
  },
};

function buildNormalizePrompt(text: string, options: NormalizeOptions): string {
  return [
    "You clean and format captured insurance website text into approved product ground-truth for human review.",
    "",
    "This task has TWO steps:",
    "1. Select only text that is useful PRODUCT / POLICY GROUND TRUTH for training insurance sales staff.",
    "2. Format the retained ground truth into clean sections and bullet pointers.",
    "",
    "DROP content that is website chrome or not product ground truth, including:",
    "- Generic website navigation, footer, quick links, menus, breadcrumbs, contact blocks, CTA copy, login/register prompts, download-button labels, and social/share widgets.",
    "- Feedback or rating widgets, including emojis, 'How do you rate our product?', 'Submit Feedback', customer rating, rated-by counts, and sentiment options.",
    "- Generic process pages or operational widgets that do not teach the product, such as 'How To Initiate Claim?' when it only lists website steps like fill details / claim intimation / document submission.",
    "- Duplicate fragments, orphan numbers, repeated source labels, and standalone document-link names when they are not policy facts.",
    "",
    "KEEP content that is product/policy ground truth, including:",
    "- Product category, UIN, eligibility, target customer, plan options, policy term, premium payment term, premium frequency, sum assured, benefits, riders, exclusions, tax wording, disclaimers, conditions, limitations, claim conditions specific to this product, and product-specific FAQ answers.",
    "- Table placeholders like [[POLICY_TABLE_0]] when the table belongs to retained product/policy ground truth.",
    "",
    "STRICT RULES:",
    "- For retained product-ground-truth content: do not add any fact, inference, interpretation, caveat, benefit, product category, eligibility condition, number, date, UIN, amount, percentage, age, term, frequency, rider, tax claim, source name, or disclosure that is not present in the input.",
    "- For retained product-ground-truth content: do not remove any fact-bearing detail.",
    "- Preserve every retained number, date, amount, percentage, UIN, policy term, premium term, age, frequency, option name, rider name, condition, exclusion, and disclosure exactly as given.",
    "- You may split a long sentence into multiple bullets only when all original facts remain present.",
    "- You may join adjacent fragments only when they clearly belong to one sentence and no words are lost.",
    "- If you are unsure whether a rewrite changes meaning, copy the source wording exactly.",
    "- Use concise, complete bullet pointers. Do not create bullets that are only orphan fragments when they can be safely joined with the adjacent fragment.",
    "- Convert labels such as 'Key Features:' into a block label, not a bullet.",
    "- Preserve the original order of retained product-ground-truth sections.",
    "- Do not rewrite, summarize, break down, or convert table placeholders. If a retained table is relevant, include its placeholder exactly as a standalone bullet value, e.g. \"[[POLICY_TABLE_0]]\".",
    "- Prefer multiple small, clearly labelled blocks over one giant block. Split plan options, eligibility groups, premium frequency/loadings, benefits, exclusions, and disclosures into separate blocks when the source already presents them that way.",
    "",
    "Return JSON only. For each section:",
    "- heading: use the source heading text, or a neutral heading already present in the source.",
    "- level: h1, h2, or h3 based on the source heading depth.",
    "- blocks: use label \"\" for unlabeled bullets. Use a label only when the source has a heading-like label such as 'Key Features:'.",
    "",
    `PRODUCT LABEL: ${options.productLabel || "Policy"}`,
    `SOURCE: ${options.source || "Captured source"}`,
    "",
    "SOURCE TEXT:",
    text.trim(),
  ].join("\n");
}

function isMarkdownTableStart(lines: string[], index: number): boolean {
  const line = lines[index]?.trim() ?? "";
  const next = lines[index + 1]?.trim() ?? "";
  return line.includes("|") && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(next);
}

function protectMarkdownTables(text: string): { text: string; tables: ProtectedTable[] } {
  const lines = text.split("\n");
  const out: string[] = [];
  const tables: ProtectedTable[] = [];
  let index = 0;

  while (index < lines.length) {
    if (!isMarkdownTableStart(lines, index)) {
      out.push(lines[index]);
      index += 1;
      continue;
    }

    const tableLines: string[] = [];
    while (index < lines.length && lines[index].includes("|")) {
      tableLines.push(lines[index]);
      index += 1;
    }

    const token = `[[POLICY_TABLE_${tables.length}]]`;
    tables.push({ token, markdown: tableLines.join("\n") });
    out.push(token);
  }

  return { text: out.join("\n"), tables };
}

function headingMarker(level: NormalizedGroundTruth["sections"][number]["level"]): string {
  if (level === "h1") return "#";
  if (level === "h3") return "###";
  return "##";
}

function childHeadingMarker(level: NormalizedGroundTruth["sections"][number]["level"]): string {
  const depth = level === "h1" ? 2 : level === "h2" ? 3 : 4;
  return "#".repeat(depth);
}

function cleanLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripTrailingColon(value: string): string {
  return value.replace(/:\s*$/, "").trim();
}

function normalizedToMarkdown(out: NormalizedGroundTruth, tables: ProtectedTable[]): string {
  const tableTokens = new Set(tables.map((table) => table.token));

  return out.sections
    .map((section) => {
      const heading = cleanLine(section.heading);
      const blocks = section.blocks
        .map((block) => {
          const label = stripTrailingColon(cleanLine(block.label));
          const bullets = block.bullets.map(cleanLine).filter(Boolean);
          if (bullets.length === 0) return "";

          return [
            label ? `${childHeadingMarker(section.level)} ${label}` : "",
            bullets.map((bullet) => (tableTokens.has(bullet) ? bullet : `- ${bullet}`)).join("\n"),
          ]
            .filter(Boolean)
            .join("\n");
        })
        .filter(Boolean)
        .join("\n\n");

      if (!heading || !blocks) return "";
      return `${headingMarker(section.level)} ${heading}\n\n${blocks}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

function restoreTablePlaceholders(markdown: string, tables: ProtectedTable[]): string {
  return tables.reduce(
    (current, table) => current.replaceAll(table.token, table.markdown),
    markdown,
  );
}

function sourceLabelFromChunk(chunk: string, index: number): string {
  const heading = chunk.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;
  return index === 0 ? "Captured page" : `Source ${index + 1}`;
}

function sourceUrlFromChunk(chunk: string): string | undefined {
  return chunk.match(/^Source:\s*(.+)$/m)?.[1]?.trim();
}

function splitSourceChunks(text: string): SourceChunk[] {
  const parts = text
    .split(/\n{2,}---\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  const chunks = (parts.length ? parts : [text.trim()])
    .map((part, index) => ({
      label: sourceLabelFromChunk(part, index),
      source: sourceUrlFromChunk(part),
      text: part,
    }))
    .filter((chunk) => chunk.text.length >= 40);

  return chunks.length ? chunks : [{ label: "Captured source", text: text.trim() }];
}

function isUsableNormalization(normalized: string): boolean {
  if (normalized.trim().length < 40) return false;
  if (!normalized.includes("- ") && !normalized.includes("|")) return false;
  return true;
}

async function normalizeSourceChunk(chunk: SourceChunk, options: NormalizeOptions): Promise<string> {
  const protectedInput = protectMarkdownTables(chunk.text);
  const source = [options.source, chunk.source, chunk.label].filter(Boolean).join(" | ");

  const out = await generateJson<NormalizedGroundTruth>(
    {
      messages: [{ role: "user", content: buildNormalizePrompt(protectedInput.text, { ...options, source }) }],
      jsonSchema: {
        name: "roleplay_ground_truth_review_format",
        schema: NORMALIZED_GROUND_TRUTH_SCHEMA,
        strict: true,
      },
      timeoutMs: 60_000,
      maxOutputTokens: 16_000,
      feature: "roleplay.ground_truth_normalize",
      datasetId: options.datasetId,
      metadata: {
        source: source.slice(0, 500) || "captured-source",
      },
    },
  );

  return restoreTablePlaceholders(normalizedToMarkdown(out, protectedInput.tables), protectedInput.tables);
}

export async function normalizeGroundTruthForReview(text: string, options: NormalizeOptions): Promise<string> {
  const original = text.trim();
  if (original.length < 40) return original;

  const chunks = splitSourceChunks(original);
  const normalizedChunks = await Promise.all(chunks.map((chunk) => normalizeSourceChunk(chunk, options)));
  const normalized = normalizedChunks
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .join("\n\n");

  if (!isUsableNormalization(normalized)) {
    throw new Error("Ground-truth formatter returned an incomplete result");
  }
  return normalized;
}
