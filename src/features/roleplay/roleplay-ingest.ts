/**
 * Roleplay document ingestion (server-only).
 * ------------------------------------------------------------------------------
 * Turns a product-page URL or an uploaded brochure (PDF / DOCX / text) into clean
 * policy text that feeds `generateRoleplayScenarios`. Self-contained — reuses
 * `cheerio` (already a dep, see `ir-crawler.ts`) for HTML, `unpdf` for PDF, and
 * `mammoth` for DOCX. Nothing here touches the voice bridge or shared dataset
 * infra.
 *
 * NOTE: imports of `unpdf` / `mammoth` are lazy (dynamic) so the modules only
 * load when a matching file type is actually ingested.
 */

import * as cheerio from "cheerio";
import { Browserbase } from "@browserbasehq/sdk";
import { chromium, type Browser, type Page } from "playwright-core";
import { generateJson } from "@/lib/llm";

/** Hard cap so a giant brochure can't blow up the LLM context / request. */
export const MAX_INGEST_CHARS = 180_000;

export interface IngestResult {
  /** Cleaned, markdown-ish policy content. */
  text: string;
  /** Best-effort human label for the source (page title / file name). */
  productLabel: string;
  /** Where it came from, for the review UI. */
  source: string;
  /** True when the extracted text was truncated to MAX_INGEST_CHARS. */
  truncated: boolean;
}

const FETCH_TIMEOUT_MS = 15_000;
const BROWSERBASE_NAV_TIMEOUT_MS = 45_000;
const BROWSERBASE_INTERACTION_DELAY_MS = 500;
const MAX_BROWSERBASE_INTERACTIONS = 30;
const MAX_RELEVANT_DOCUMENTS = 8;
const MAX_RENDERED_PAGE_CHARS = 35_000;
const MAX_LINKED_SOURCE_CHARS = 20_000;
const FETCH_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  Accept: "text/html,application/xhtml+xml,application/pdf,text/plain,*/*",
  "Accept-Language": "en-US,en;q=0.9",
};

interface BrowserbaseSnapshot {
  label: string;
  title: string;
  text: string;
}

interface BrowserbaseLink {
  text: string;
  href: string;
}

interface SelectedSourceLinks {
  selectedLinks: Array<{
    index: number;
    label: string;
    reason: string;
  }>;
}

const SELECTED_SOURCE_LINKS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["selectedLinks"],
  properties: {
    selectedLinks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "label", "reason"],
        properties: {
          index: { type: "number" },
          label: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
  },
};

function collapse(text: string): string {
  return text
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function clamp(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_INGEST_CHARS) return { text, truncated: false };
  return { text: text.slice(0, MAX_INGEST_CHARS).trimEnd(), truncated: true };
}

function clampTo(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars).trimEnd(), truncated: true };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Inline-level tags whose text folds into the surrounding paragraph. */
const INLINE_TAGS = new Set([
  "a", "span", "strong", "em", "b", "i", "u", "small", "label", "sup", "sub", "mark", "abbr", "code", "time", "cite",
]);

/**
 * Convert an HTML `<table>` into a GitHub-flavored markdown table so the renderer
 * shows it as a grid — product-spec / eligibility / premium tables are the bulk
 * of an insurance page and read as disconnected fragments if flattened to prose.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HtmlNode = any;

interface TableCell {
  text: string;
  rowSpan: number;
  colSpan: number;
  nestedTables: HtmlNode[];
}

interface TableRow {
  cells: TableCell[];
}

function parseSpan(raw: string | undefined): number {
  const parsed = Number.parseInt(raw || "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function directTableRows($: cheerio.CheerioAPI, table: HtmlNode): HtmlNode[] {
  const rows: HtmlNode[] = [];
  $(table)
    .children("thead, tbody, tfoot")
    .children("tr")
    .each((_, tr) => {
      rows.push(tr);
    });
  $(table)
    .children("tr")
    .each((_, tr) => {
      rows.push(tr);
    });
  return rows;
}

function topLevelNestedTables($: cheerio.CheerioAPI, cell: HtmlNode): HtmlNode[] {
  const outerTable = $(cell).closest("table").get(0);
  const tables: HtmlNode[] = [];
  $(cell)
    .find("table")
    .filter((_, nested) => $(nested).parents("table").first().get(0) === outerTable)
    .each((_, nested) => {
      tables.push(nested);
    });
  return tables;
}

function cellText($: cheerio.CheerioAPI, cell: HtmlNode): string {
  const clone = $(cell).clone();
  clone.find("table").remove();
  clone.find("br").replaceWith("\n");
  clone.find("li").each((_, li) => {
    const item = $(li);
    item.prepend("- ");
    item.append("\n");
  });
  clone.find("p, div").each((_, block) => {
    $(block).append("\n");
  });
  return collapse(clone.text()).replace(/\n{2,}/g, "\n");
}

function tableRows($: cheerio.CheerioAPI, table: HtmlNode): TableRow[] {
  return directTableRows($, table)
    .map((tr) => {
      const cells: TableCell[] = [];
      $(tr)
        .children("th, td")
        .each((_, cell) => {
          cells.push({
            text: cellText($, cell),
            rowSpan: parseSpan($(cell).attr("rowspan")),
            colSpan: parseSpan($(cell).attr("colspan")),
            nestedTables: topLevelNestedTables($, cell),
          });
        });
      return { cells };
    })
    .filter((row) => row.cells.length > 0);
}

function escapeTableCell(raw: string): string {
  const text = collapse(raw).replace(/\s*\n\s*/g, " ").trim();
  return (text || "—").replace(/\|/g, "\\|");
}

function markdownTable(rows: string[][]): string {
  if (rows.length === 0) return "";
  const cols = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => {
    const c = [...r];
    while (c.length < cols) c.push("—");
    return c;
  };
  const line = (arr: string[]) => `| ${arr.join(" | ")} |`;
  const header = pad(rows[0]);
  const sep = line(Array(cols).fill("---"));
  const body = rows.slice(1).map((r) => line(pad(r)));
  return [line(header), sep, ...body].join("\n");
}

function genericTableToMarkdown($: cheerio.CheerioAPI, rows: TableRow[]): string {
  const grid: string[][] = [];
  const nestedBlocks: string[] = [];

  rows.forEach((row, rowIndex) => {
    grid[rowIndex] ??= [];
    let colIndex = 0;

    row.cells.forEach((cell) => {
      while (grid[rowIndex][colIndex] !== undefined) colIndex++;

      const text = escapeTableCell(cell.text);
      for (let r = 0; r < cell.rowSpan; r++) {
        const targetRow = rowIndex + r;
        grid[targetRow] ??= [];
        for (let c = 0; c < cell.colSpan; c++) {
          grid[targetRow][colIndex + c] = c === 0 ? text : "—";
        }
      }

      cell.nestedTables.forEach((nested) => {
        const nestedMd = tableToMarkdown($, nested);
        if (nestedMd) nestedBlocks.push(nestedMd);
      });

      colIndex += cell.colSpan;
    });
  });

  const tableMd = markdownTable(grid.map((row) => row.map((cell) => cell || "—")));
  return [tableMd, ...nestedBlocks].filter(Boolean).join("\n\n");
}

function isProductSpecificationTable(rows: TableRow[]): boolean {
  const firstCell = rows[0]?.cells[0];
  return Boolean(firstCell && /product specifications/i.test(firstCell.text));
}

function productSpecificationTableToMarkdown($: cheerio.CheerioAPI, rows: TableRow[]): string {
  const title = rows[0]?.cells[0]?.text || "Product Specifications";
  const tableRowsOut: string[][] = [["Field", "Condition", "Value"]];
  const nestedBlocks: string[] = [];
  let activeField: { text: string; remainingRows: number } | null = null;

  rows.slice(1).forEach((row) => {
    if (row.cells.length === 0) return;

    let field = activeField?.text || "";
    let rest = row.cells;
    if (activeField) {
      activeField.remainingRows -= 1;
      if (activeField.remainingRows <= 0) activeField = null;
    } else {
      const fieldCell = row.cells[0];
      field = fieldCell.text;
      rest = row.cells.slice(1);
      if (fieldCell.rowSpan > 1) {
        activeField = { text: field, remainingRows: fieldCell.rowSpan - 1 };
      }
    }

    if (!field) return;

    let condition = "—";
    let value = "—";
    if (rest.length === 1) {
      value = rest[0].text || `See ${field} table below.`;
    } else if (rest.length >= 2) {
      condition = rest[0].text || "—";
      value = rest.slice(1).map((cell) => cell.text).filter(Boolean).join(" ") || "—";
    }

    const nestedTables = row.cells.flatMap((cell) => cell.nestedTables);
    if (nestedTables.length > 0 && value === "—") {
      value = `See ${field} table below.`;
    }

    tableRowsOut.push([escapeTableCell(field), escapeTableCell(condition), escapeTableCell(value)]);

    nestedTables.forEach((nested, index) => {
      const nestedMd = tableToMarkdown($, nested);
      if (nestedMd) {
        nestedBlocks.push(`### ${field}${nestedTables.length > 1 ? ` ${index + 1}` : ""}\n\n${nestedMd}`);
      }
    });
  });

  return [`## ${title}`, markdownTable(tableRowsOut), ...nestedBlocks].filter(Boolean).join("\n\n");
}

function tableToMarkdown($: cheerio.CheerioAPI, table: HtmlNode): string {
  const rows = tableRows($, table);
  if (rows.length === 0) return "";
  if (isProductSpecificationTable(rows)) return productSpecificationTableToMarkdown($, rows);
  return genericTableToMarkdown($, rows);
}

/**
 * Serialize a cheerio subtree into lightweight markdown, preserving the block
 * structure a product page carries — headings (`#`/`##`/`###`), bullet lists,
 * and paragraphs — so the captured text reads as a formatted document instead
 * of one collapsed run-on blob. Leaf blocks emit their `.text()`; containers are
 * walked so nothing is emitted twice.
 */
function serializeMarkdown($: cheerio.CheerioAPI, root: cheerio.Cheerio<never>): string {
  const out: string[] = [];

  const emitPara = (raw: string) => {
    const t = collapse(raw);
    if (t) out.push(t);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const walk = (node: any) => {
    let buffer = ""; // loose inline text accumulated between block elements
    const flush = () => {
      if (buffer.trim()) emitPara(buffer);
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
        const txt = collapse($(c).text());
        if (txt) out.push(`${"#".repeat(Math.min(3, Number(heading[1])))} ${txt}`);
      } else if (tag === "ul" || tag === "ol") {
        flush();
        // Emit the whole list as one block (items joined by single newlines) so
        // the markdown renderer groups them into a single <ul>, not N one-item lists.
        const items: string[] = [];
        $(c)
          .children("li")
          .each((_, li) => {
            const t = collapse($(li).text());
            if (t) items.push(`- ${t}`);
          });
        if (items.length) out.push(items.join("\n"));
      } else if (tag === "li") {
        flush();
        const t = collapse($(c).text());
        if (t) out.push(`- ${t}`);
      } else if (tag === "p" || tag === "blockquote") {
        flush();
        emitPara($(c).text());
      } else if (tag === "table") {
        flush();
        const md = tableToMarkdown($, c);
        if (md) out.push(md);
        // Do not recurse — cells are already captured as table rows.
      } else if (tag === "br") {
        buffer += "\n";
      } else if (INLINE_TAGS.has(tag)) {
        buffer += " " + $(c).text();
      } else {
        // Block container (div/section/article/table/etc.) — recurse so nested
        // headings and lists are emitted individually rather than flattened.
        flush();
        walk(c);
      }
    }
    flush();
  };

  walk(root.get(0));
  return out.join("\n\n");
}

/** Extract readable body markdown + a title from an HTML string via cheerio. */
function htmlToText(html: string): { text: string; title: string } {
  const $ = cheerio.load(html);
  $("script, style, noscript, nav, header, footer, svg, form, iframe, [aria-hidden='true']").remove();
  const title =
    ($('meta[property="og:title"]').attr("content") || "").trim() ||
    $("title").first().text().trim() ||
    $("h1").first().text().trim();
  // Prefer main/article content when present; otherwise fall back to body.
  const root = $("main").length ? $("main") : $("article").length ? $("article") : $("body");
  const text = serializeMarkdown($, root as cheerio.Cheerio<never>);
  return { text, title };
}

function browserbaseApiKey(): string | undefined {
  return process.env.BROWSERBASE_API_KEY?.trim() || undefined;
}

function sameSiteOrDocumentHost(pageUrl: URL, candidate: URL): boolean {
  if (candidate.protocol !== "http:" && candidate.protocol !== "https:") return false;
  if (candidate.hostname === pageUrl.hostname) return true;
  if (candidate.hostname.endsWith(`.${pageUrl.hostname}`)) return true;
  if (pageUrl.hostname.endsWith(`.${candidate.hostname}`)) return true;
  return /\.(pdf|docx?|rtf|txt|html?)$/i.test(candidate.pathname);
}

function dedupeLinks(links: BrowserbaseLink[], pageUrl: URL): BrowserbaseLink[] {
  const seen = new Set<string>();
  const out: BrowserbaseLink[] = [];
  for (const link of links) {
    let url: URL;
    try {
      url = new URL(link.href);
    } catch {
      continue;
    }
    if (!sameSiteOrDocumentHost(pageUrl, url)) continue;
    const key = url.toString().replace(/#.*$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text: link.text || prettyName(url.pathname), href: key });
  }
  return out;
}

function buildSourceLinkSelectionPrompt(links: BrowserbaseLink[], pageUrl: URL, title: string): string {
  const candidates = links
    .map((link, index) => `${index}. text="${link.text || "(no visible text)"}" href="${link.href}"`)
    .join("\n");

  return [
    "You select source documents linked from an insurance product page.",
    "",
    "Goal: choose the linked documents that should be fetched as product / policy ground truth for training insurance sales staff.",
    "",
    "Select links that are official source material for the product on this page, such as:",
    "- product prospectus / brochure",
    "- policy contract / terms and conditions",
    "- CIS / customer information sheet",
    "- plan-option leaflets or product-specific benefit leaflets",
    "",
    "Do not select generic website navigation, withdrawn-product pages, unrelated category pages, claim process pages, login/contact/social links, rating widgets, or broad forms/download directories.",
    "Do not select rider-only brochures unless the link is clearly needed as a source for a rider that is part of this product page and there is room after the core product documents.",
    "Use only the visible text and href. Do not infer facts that are not present.",
    `Select at most ${MAX_RELEVANT_DOCUMENTS} links, ordered from most important source to least important source.`,
    "",
    `PRODUCT PAGE TITLE: ${title}`,
    `PRODUCT PAGE URL: ${pageUrl.toString()}`,
    "",
    "CANDIDATE LINKS:",
    candidates,
  ].join("\n");
}

async function selectRelevantSourceLinks(links: BrowserbaseLink[], pageUrl: URL, title: string): Promise<BrowserbaseLink[]> {
  if (links.length === 0) return [];

  const candidates = links.slice(0, 120);
  const out = await generateJson<SelectedSourceLinks>({
    messages: [{ role: "user", content: buildSourceLinkSelectionPrompt(candidates, pageUrl, title) }],
    jsonSchema: {
      name: "roleplay_source_link_selection",
      schema: SELECTED_SOURCE_LINKS_SCHEMA,
      strict: true,
    },
    timeoutMs: 45_000,
    maxOutputTokens: 2_000,
    feature: "roleplay.ingest.source_link_selection",
    metadata: {
      source: pageUrl.toString().slice(0, 500),
    },
  });

  const seen = new Set<string>();
  return out.selectedLinks
    .map((selection) => {
      const index = Number.isInteger(selection.index) ? selection.index : -1;
      if (index < 0 || index >= candidates.length) return null;
      return {
        text: selection.label.trim() || candidates[index].text,
        href: candidates[index].href,
      };
    })
    .filter((link): link is BrowserbaseLink => Boolean(link))
    .filter((link) => {
      if (seen.has(link.href)) return false;
      seen.add(link.href);
      return true;
    })
    .slice(0, MAX_RELEVANT_DOCUMENTS);
}

function mergeMarkdownBlocks(snapshots: BrowserbaseSnapshot[]): string {
  const seen = new Set<string>();
  const blocks: string[] = [];

  snapshots.forEach((snapshot, index) => {
    const label = index === 0 ? "Rendered page" : `After opening: ${snapshot.label}`;
    const uniqueBlocks = snapshot.text
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean)
      .filter((block) => {
        const key = block.toLowerCase().replace(/\s+/g, " ").slice(0, 500);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    if (uniqueBlocks.length > 0) {
      blocks.push(`## ${label}\n\n${uniqueBlocks.join("\n\n")}`);
    }
  });

  return blocks.join("\n\n");
}

async function renderedSnapshot(page: Page, label: string): Promise<BrowserbaseSnapshot> {
  const html = await page.content();
  const { text, title } = htmlToText(html);
  return {
    label,
    title: title || (await page.title().catch(() => "")),
    text,
  };
}

async function collectVisibleLinks(page: Page): Promise<BrowserbaseLink[]> {
  return page.evaluate(String.raw`(() => {
    const isVisible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };

    return Array.from(document.querySelectorAll("a[href]"))
      .filter(isVisible)
      .map((anchor) => ({
        text: (anchor.innerText || anchor.getAttribute("aria-label") || anchor.title || "").replace(/\s+/g, " ").trim(),
        href: anchor.href,
      }))
      .filter((link) => link.href);
  })()`) as Promise<BrowserbaseLink[]>;
}

async function markInteractiveCandidates(page: Page): Promise<Array<{ id: string; label: string }>> {
  return page.evaluate(String.raw`(() => {
    const maxCandidates = ${MAX_BROWSERBASE_INTERACTIONS};
    const isVisible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };

    const root = document.querySelector("main") || document.querySelector("article") || document.body;
    const selector = [
      "button",
      "[role='tab']",
      "[role='button']",
      "summary",
      "a[href^='#']",
      "[aria-controls]",
      "[data-bs-toggle]",
      "[data-toggle]",
    ].join(",");
    const seen = new Set();
    const candidates = [];

    Array.from(root.querySelectorAll(selector)).forEach((element) => {
      if (!isVisible(element)) return;
      const label = (element.innerText || element.getAttribute("aria-label") || element.getAttribute("title") || "")
        .replace(/\s+/g, " ")
        .trim();
      if (label.length < 2 || label.length > 90) return;
      if (/\b(download|prospectus|leaflet|policy contract|cis|login|sign in|buy now|call now|whatsapp|facebook|twitter|linkedin)\b/i.test(label)) return;
      const key = element.tagName + ":" + label.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      const id = "sentinel-click-" + candidates.length;
      element.dataset.sentinelClickId = id;
      candidates.push({ id, label });
    });

    return candidates.slice(0, maxCandidates);
  })()`) as Promise<Array<{ id: string; label: string }>>;
}

async function collectRenderedPage(url: URL): Promise<{ title: string; text: string; links: BrowserbaseLink[] }> {
  const apiKey = browserbaseApiKey();
  if (!apiKey) throw new Error("BROWSERBASE_API_KEY is not configured");

  const bb = new Browserbase({ apiKey });
  let browser: Browser | undefined;

  try {
    const session = await bb.sessions.create({
      timeout: 120,
      browserSettings: {
        blockAds: true,
        recordSession: false,
        viewport: { width: 1440, height: 1100 },
      },
      userMetadata: {
        feature: "roleplay.ingest",
        targetHost: url.hostname,
      },
    });

    browser = await chromium.connectOverCDP(session.connectUrl);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    page.setDefaultTimeout(5_000);
    page.setDefaultNavigationTimeout(BROWSERBASE_NAV_TIMEOUT_MS);

    await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: BROWSERBASE_NAV_TIMEOUT_MS });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});

    const snapshots: BrowserbaseSnapshot[] = [await renderedSnapshot(page, "Initial view")];
    let links = await collectVisibleLinks(page);
    const candidates = await markInteractiveCandidates(page);

    for (const candidate of candidates) {
      const locator = page.locator(`[data-sentinel-click-id="${candidate.id}"]`).first();
      try {
        await locator.scrollIntoViewIfNeeded({ timeout: 2_000 });
        await locator.click({ timeout: 3_000 });
        await sleep(BROWSERBASE_INTERACTION_DELAY_MS);
        snapshots.push(await renderedSnapshot(page, candidate.label));
        links = links.concat(await collectVisibleLinks(page));
      } catch {
        // Ignore fragile widgets; other candidates and the initial snapshot still carry value.
      }
    }

    const title = snapshots.find((snapshot) => snapshot.title)?.title || prettyName(url.pathname || url.hostname);
    const candidateLinks = dedupeLinks(links, url);
    const selectedLinks = await selectRelevantSourceLinks(candidateLinks, url, title);
    return {
      title,
      text: mergeMarkdownBlocks(snapshots),
      links: selectedLinks,
    };
  } finally {
    await browser?.close().catch(() => {});
  }
}

async function fetchLinkedSource(link: BrowserbaseLink): Promise<{ text: string; truncated: boolean } | null> {
  let url: URL;
  try {
    url = new URL(link.href);
  } catch {
    return null;
  }

  const res = await fetch(url.toString(), {
    headers: FETCH_HEADERS,
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) return null;

  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  const name = prettyName(link.text || decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || url.hostname));
  let text = "";

  if (contentType.includes("application/pdf") || url.pathname.toLowerCase().endsWith(".pdf")) {
    text = collapse(await pdfToText(new Uint8Array(await res.arrayBuffer())));
  } else if (
    contentType.includes("officedocument.wordprocessingml") ||
    contentType.includes("application/msword") ||
    /\.docx?$/i.test(url.pathname)
  ) {
    text = collapse(await docxToText(Buffer.from(await res.arrayBuffer())));
  } else if (contentType.includes("text/html") || /\.html?$/i.test(url.pathname)) {
    text = htmlToText(await res.text()).text;
  } else if (contentType.startsWith("text/") || /\.(txt|md|markdown|rtf)$/i.test(url.pathname)) {
    text = collapse(await res.text());
  }

  const cleaned = collapse(text);
  if (cleaned.trim().length < 40) return null;
  const clamped = clampTo(cleaned, MAX_LINKED_SOURCE_CHARS);
  return {
    text: `## Linked source: ${name}\n\nSource: ${url.toString()}\n\n${clamped.text}`,
    truncated: clamped.truncated,
  };
}

async function ingestFromBrowserbase(url: URL): Promise<IngestResult | null> {
  if (!browserbaseApiKey()) return null;

  const rendered = await collectRenderedPage(url);
  const linkedSources = (
    await Promise.all(rendered.links.map((link) => fetchLinkedSource(link).catch(() => null)))
  ).filter((source): source is { text: string; truncated: boolean } => Boolean(source));

  const renderedText = clampTo(rendered.text, MAX_RENDERED_PAGE_CHARS);
  const combinedText = [renderedText.text, ...linkedSources.map((source) => source.text)].filter(Boolean).join("\n\n---\n\n");
  const { text, truncated } = clamp(collapse(combinedText));
  ensureUsable(text, "rendered page");
  return {
    text,
    productLabel: rendered.title.slice(0, 80),
    source: url.toString(),
    truncated: truncated || renderedText.truncated || linkedSources.some((source) => source.truncated),
  };
}

/** Fetch a URL and extract policy text (HTML pages and direct-PDF links). */
export async function ingestFromUrl(rawUrl: string): Promise<IngestResult> {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error("Enter a valid URL (including https://).");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http(s) URLs are supported.");
  }

  const res = await fetch(url.toString(), {
    headers: FETCH_HEADERS,
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Couldn't fetch the page (${res.status} ${res.statusText}).`);
  }

  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  const lastPathSeg = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || url.hostname);

  // Direct PDF link.
  if (contentType.includes("application/pdf") || url.pathname.toLowerCase().endsWith(".pdf")) {
    const buf = new Uint8Array(await res.arrayBuffer());
    const text = await pdfToText(buf);
    const { text: clamped, truncated } = clamp(collapse(text));
    ensureUsable(clamped, "PDF");
    const productLabel = prettyName(lastPathSeg);
    return {
      text: clamped,
      productLabel,
      source: url.toString(),
      truncated,
    };
  }

  if (contentType.includes("text/html") || contentType.includes("application/xhtml")) {
    try {
      const rendered = await ingestFromBrowserbase(url);
      if (rendered) return rendered;
    } catch (err) {
      console.error("[roleplay/ingest] Browserbase render failed; falling back to static fetch:", err);
    }
  }

  const html = await res.text();
  const { text, title } = htmlToText(html);
  const { text: clamped, truncated } = clamp(text);
  ensureUsable(clamped, "page");
  const productLabel = (title || prettyName(lastPathSeg)).slice(0, 80);
  return {
    text: clamped,
    productLabel,
    source: url.toString(),
    truncated,
  };
}

const PDF_EXT = /\.pdf$/i;
const DOCX_EXT = /\.docx$/i;
const TEXT_EXT = /\.(txt|md|markdown|csv|json|html?|rtf)$/i;

/** Extract policy text from an uploaded file, dispatching on type. */
export async function ingestFromFile(
  bytes: ArrayBuffer,
  filename: string,
  mimetype: string,
): Promise<IngestResult> {
  const name = filename || "document";
  const mt = (mimetype || "").toLowerCase();

  let raw: string;
  if (PDF_EXT.test(name) || mt.includes("application/pdf")) {
    raw = await pdfToText(new Uint8Array(bytes));
  } else if (
    DOCX_EXT.test(name) ||
    mt.includes("officedocument.wordprocessingml") ||
    mt.includes("application/msword")
  ) {
    raw = await docxToText(Buffer.from(bytes));
  } else if (TEXT_EXT.test(name) || mt.startsWith("text/")) {
    const decoded = new TextDecoder().decode(bytes);
    raw = /\.html?$/i.test(name) || mt.includes("html") ? htmlToText(decoded).text : decoded;
  } else {
    throw new Error("Unsupported file type. Upload a PDF, DOCX, or text file.");
  }

  const { text, truncated } = clamp(collapse(raw));
  ensureUsable(text, "document");
  const productLabel = prettyName(name);
  return {
    text,
    productLabel,
    source: name,
    truncated,
  };
}

async function pdfToText(bytes: Uint8Array): Promise<string> {
  const { extractText } = await import("unpdf");
  const { text } = await extractText(bytes, { mergePages: true });
  return Array.isArray(text) ? text.join("\n\n") : text;
}

async function docxToText(buffer: Buffer): Promise<string> {
  const mammoth = (await import("mammoth")).default;
  const { value } = await mammoth.convertToHtml({ buffer });
  return htmlToText(value).text;
}

/** A PDF that's all images (scanned) or a JS-only page yields ~nothing. */
function ensureUsable(text: string, kind: string): void {
  if (text.trim().length < 40) {
    throw new Error(
      `Couldn't extract readable text from this ${kind}. It may be scanned/image-only or require login — try a different source or paste the facts.`,
    );
  }
}

/** "anmol-akshaya-brochure.pdf" → "Anmol Akshaya Brochure". */
function prettyName(raw: string): string {
  return (
    raw
      .replace(PDF_EXT, "")
      .replace(DOCX_EXT, "")
      .replace(TEXT_EXT, "")
      // Drop a trailing CMS hash token (e.g. "..._Brochure_c0fa96c9a1").
      .replace(/[-_][0-9a-f]{8,}$/i, "")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .slice(0, 80) || "Policy"
  );
}
