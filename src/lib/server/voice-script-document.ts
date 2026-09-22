/**
 * Client script document extraction (server-only).
 * ------------------------------------------------------------------------------
 * Uploaded voicebot script (DOCX / PDF / text) → clean markdown-ish text for the
 * script importer.
 *
 * Deliberately separate from `features/roleplay/roleplay-ingest.ts`, which does a
 * superficially similar job: that module imports playwright + browserbase at
 * module scope (it crawls product pages) and its table handling is specialised
 * for insurance product-spec tables. Importing it from a voice route would pull a
 * headless browser into the bundle. What we need here is narrower and different:
 * faithful block structure out of a Word document, with tables preserved as
 * grids so the importer can tell a talk-track table from a version-control
 * header block.
 *
 * `mammoth` / `unpdf` imports are lazy so neither loads unless a matching file
 * type is actually uploaded.
 */

import * as cheerio from "cheerio";

/** Hard cap so a 1.6MB Word file can't blow the LLM context. */
export const MAX_SCRIPT_DOC_CHARS = 180_000;

export interface ScriptDocument {
  /** Cleaned markdown-ish text: headings, paragraphs, pipe tables. */
  text: string;
  /** Human label derived from the filename, used as a default campaign name. */
  label: string;
  /** Original filename. */
  source: string;
  truncated: boolean;
}

/** Thrown for user-actionable problems (wrong type, scanned PDF, legacy .doc). */
export class ScriptDocumentError extends Error {}

const DOCX_EXT = /\.docx$/i;
const LEGACY_DOC_EXT = /\.docx?$/i;
const PDF_EXT = /\.pdf$/i;
const TEXT_EXT = /\.(txt|md|markdown|rtf|html?)$/i;

function collapse(text: string): string {
  return text
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** OLE compound-file magic — a pre-2007 binary `.doc`, which mammoth cannot read. */
function isLegacyDoc(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0
  );
}

/** ZIP magic — every real `.docx`. */
function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

const INLINE_TAGS = new Set([
  "a", "span", "strong", "em", "b", "i", "u", "small", "sup", "sub", "mark", "abbr", "code",
]);

/**
 * Render an HTML table as a markdown pipe table.
 *
 * Structure matters for these documents: every TVS file carries a 16x5
 * version-control block and some carry stage-code lookups. Flattened to prose
 * they read as talk-track and end up spoken on a call; as a grid the importer
 * can recognise and skip them.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tableToMarkdown($: cheerio.CheerioAPI, table: any): string {
  const rows: string[][] = [];
  $(table)
    .find("tr")
    .each((_, tr) => {
      const cells: string[] = [];
      $(tr)
        .children("td, th")
        .each((__, cell) => {
          cells.push(collapse($(cell).text()).replace(/\n/g, " "));
        });
      if (cells.some((c) => c.length > 0)) rows.push(cells);
    });
  if (rows.length === 0) return "";

  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array(width - r.length).fill("")];
  const line = (r: string[]) => `| ${pad(r).map((c) => c.replace(/\|/g, "\\|")).join(" | ")} |`;

  const [head, ...body] = rows;
  return [line(head), `| ${Array(width).fill("---").join(" | ")} |`, ...body.map(line)].join("\n");
}

/** Serialize a cheerio subtree into lightweight markdown, block by block. */
function serialize($: cheerio.CheerioAPI): string {
  const out: string[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const walk = (node: any) => {
    let buffer = "";
    const flush = () => {
      const t = collapse(buffer);
      if (t) out.push(t);
      buffer = "";
    };

    for (const child of $(node).contents().toArray()) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = child as any;
      if (c.type === "text") {
        buffer += " " + (c.data || "");
        continue;
      }
      if (c.type !== "tag") continue;

      const tag = String(c.name || "").toLowerCase();
      const heading = tag.match(/^h([1-6])$/);
      if (heading) {
        flush();
        const t = collapse($(c).text());
        if (t) out.push(`${"#".repeat(Math.min(3, Number(heading[1])))} ${t}`);
      } else if (tag === "table") {
        flush();
        const md = tableToMarkdown($, c);
        if (md) out.push(md);
        // Cells already captured — do not recurse.
      } else if (tag === "li") {
        flush();
        const t = collapse($(c).text());
        if (t) out.push(`- ${t}`);
      } else if (tag === "p" || tag === "blockquote") {
        flush();
        const t = collapse($(c).text());
        if (t) out.push(t);
      } else if (tag === "br") {
        buffer += "\n";
      } else if (INLINE_TAGS.has(tag)) {
        buffer += " " + $(c).text();
      } else {
        flush();
        walk(c);
      }
    }
    flush();
  };

  walk($("body").get(0) ?? $.root().get(0));
  return out.join("\n\n");
}

async function docxToText(bytes: Uint8Array): Promise<string> {
  const mammoth = (await import("mammoth")).default;
  const { value } = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
  return serialize(cheerio.load(value));
}

async function pdfToText(bytes: Uint8Array): Promise<string> {
  const { extractText } = await import("unpdf");
  const { text } = await extractText(bytes, { mergePages: true });
  return Array.isArray(text) ? text.join("\n\n") : text;
}

/** "Collections Bot B1 Script.docx" → "Collections Bot B1 Script". */
function prettyName(raw: string): string {
  return (
    raw
      .replace(LEGACY_DOC_EXT, "")
      .replace(PDF_EXT, "")
      .replace(TEXT_EXT, "")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "Imported script"
  );
}

export async function extractScriptDocument(
  buffer: ArrayBuffer,
  filename: string,
  mimetype = "",
): Promise<ScriptDocument> {
  const name = filename || "document";
  const mt = mimetype.toLowerCase();
  const bytes = new Uint8Array(buffer);

  // Check magic bytes before extension: these files get renamed by hand, and a
  // binary .doc saved as ".docx" otherwise dies inside mammoth with
  // "Could not find the body element", which tells the user nothing.
  if (isLegacyDoc(bytes)) {
    throw new ScriptDocumentError(
      "This is a legacy Word document (.doc). Open it in Word or Google Docs and save as .docx, then upload again.",
    );
  }

  let raw: string;
  if (PDF_EXT.test(name) || mt.includes("application/pdf")) {
    raw = await pdfToText(bytes);
  } else if (DOCX_EXT.test(name) || mt.includes("officedocument.wordprocessingml")) {
    if (!isZip(bytes)) {
      throw new ScriptDocumentError("This file is named .docx but is not a valid Word document.");
    }
    raw = await docxToText(bytes);
  } else if (TEXT_EXT.test(name) || mt.startsWith("text/")) {
    const decoded = new TextDecoder().decode(bytes);
    raw = /\.html?$/i.test(name) || mt.includes("html")
      ? serialize(cheerio.load(decoded))
      : decoded;
  } else if (isZip(bytes)) {
    // Unknown extension but a zip — most likely a .docx with a stripped name.
    raw = await docxToText(bytes);
  } else {
    throw new ScriptDocumentError(
      "Unsupported file type. Upload a .docx, .pdf, or plain-text script.",
    );
  }

  const cleaned = collapse(raw);
  if (cleaned.length < 40) {
    throw new ScriptDocumentError(
      "Couldn't read any text from this file. If it's a scanned document or an image-only PDF, paste the script text instead.",
    );
  }

  const truncated = cleaned.length > MAX_SCRIPT_DOC_CHARS;
  return {
    text: truncated ? cleaned.slice(0, MAX_SCRIPT_DOC_CHARS).trimEnd() : cleaned,
    label: prettyName(name),
    source: name,
    truncated,
  };
}
