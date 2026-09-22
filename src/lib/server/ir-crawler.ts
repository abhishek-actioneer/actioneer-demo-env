/**
 * IR-page crawler.
 *
 * Strategy: fetch a company's homepage, locate its Investor Relations link from
 * the footer/nav, fetch that page, and harvest every linked PDF along with the
 * surrounding section-heading breadcrumb. Deterministic — no LLM, no
 * classification, no period parsing. Downstream stages (LLM picker) decide
 * relevance and type.
 *
 * Returns `source: "failed"` when the homepage is JS-rendered, behind a CAPTCHA,
 * or doesn't expose an IR link in static HTML — the caller should fall back.
 */

import * as cheerio from "cheerio";

export interface IRDocument {
  url: string;
  title: string;
  /** Heading breadcrumb above this link (e.g. "Financial Results - FY 2025-26 › Q4"). */
  sectionContext?: string;
}

export type CrawlSource = "footer" | "header" | "search-fallback" | "failed";

export interface CrawlResult {
  source: CrawlSource;
  homepageUrl: string;
  irIndexUrl?: string;
  documents: IRDocument[];
  warnings: string[];
}

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

const FETCH_TIMEOUT_MS = 12_000;
const MAX_DOCS_PER_PAGE = 200;

// Link-text scoring for finding the IR index from footer/nav.
// This is *small fixed vocabulary* matching, not data classification — regex is
// the right tool here. Keep narrow.
const IR_LINK_PATTERNS: Array<{ regex: RegExp; weight: number }> = [
  { regex: /financial[\s-]?report/i, weight: 5 },
  { regex: /financial[\s-]?result/i, weight: 5 },
  { regex: /annual[\s-]?report/i, weight: 4 },
  { regex: /investor[\s-]?relations?/i, weight: 3 },
  { regex: /^investors?$/i, weight: 3 },
  { regex: /investor[\s-]?(deck|presentation|update)/i, weight: 2 },
  { regex: /disclosures?/i, weight: 1 },
];

async function fetchHtmlOnce(url: string, signal?: AbortSignal): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  try {
    const res = await fetch(url, { headers: DEFAULT_HEADERS, signal: controller.signal, redirect: "follow" });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html")) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHtml(url: string, signal?: AbortSignal): Promise<string | null> {
  const first = await fetchHtmlOnce(url, signal);
  if (first) return first;
  // One retry — IR servers (Vastu in particular) are intermittent.
  await new Promise((r) => setTimeout(r, 800));
  return fetchHtmlOnce(url, signal);
}

function normalizeUrl(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function looksLikeSPA($: cheerio.CheerioAPI): boolean {
  const linkCount = $("a[href]").length;
  if (linkCount < 5) return true;
  const html = $.html();
  if (/<div\s+id=["'](?:__next|root|app|__nuxt)["']/.test(html) && linkCount < 15) return true;
  return false;
}

function looksLikeCaptcha(html: string): boolean {
  // Real challenge pages are small AND contain a specific marker. Real homepages
  // often mention "cloudflare" in CSP / CDN URLs — that's not a block.
  const isSmall = html.length < 30_000;
  if (!isSmall) return false;
  return (
    /cf-browser-verification|cf-challenge|just a moment\.\.\.|enable javascript and cookies to continue|attention required/i.test(html) ||
    /please verify you are human|please complete the security check/i.test(html) ||
    /<title>[^<]*(?:captcha|access denied|security check)[^<]*<\/title>/i.test(html)
  );
}

function scoreIRLink(text: string): number {
  for (const { regex, weight } of IR_LINK_PATTERNS) {
    if (regex.test(text)) return weight;
  }
  return 0;
}

type CheerioRegion = ReturnType<cheerio.CheerioAPI>;

function findIRLinkIn(
  $region: CheerioRegion,
  $: cheerio.CheerioAPI,
  baseUrl: string,
): { url: string; text: string; score: number } | null {
  let best: { url: string; text: string; score: number } | null = null;
  const baseUrlNoSlash = baseUrl.replace(/\/+$/, "");
  $region.find("a[href]").each((_, el) => {
    const text = $(el).text().trim();
    if (!text) return;
    const score = scoreIRLink(text);
    if (score === 0) return;
    const href = $(el).attr("href");
    if (!href) return;
    if (/^\s*(?:#|javascript:|mailto:|tel:)/i.test(href)) return;
    const abs = normalizeUrl(href, baseUrl);
    if (!abs) return;
    const absNoFragment = abs.split("#")[0]!.replace(/\/+$/, "");
    if (absNoFragment === baseUrlNoSlash) return;
    if (!best || score > best.score) {
      best = { url: abs, text, score };
    }
  });
  return best;
}

function findFooterIRLink(
  $: cheerio.CheerioAPI,
  baseUrl: string,
): { url: string; text: string; source: CrawlSource } | null {
  const $footer = $("footer").first();
  if ($footer.length > 0) {
    const hit = findIRLinkIn($footer, $, baseUrl);
    if (hit) return { url: hit.url, text: hit.text, source: "footer" };
  }
  const $footerLike = $('[class*="footer"], [id*="footer"], [class*="Footer"]').first();
  if ($footerLike.length > 0) {
    const hit = findIRLinkIn($footerLike, $, baseUrl);
    if (hit) return { url: hit.url, text: hit.text, source: "footer" };
  }
  const $nav = $('header, nav, [class*="nav"], [class*="menu"]').first();
  if ($nav.length > 0) {
    const hit = findIRLinkIn($nav, $, baseUrl);
    if (hit) return { url: hit.url, text: hit.text, source: "header" };
  }
  const hit = findIRLinkIn($("body"), $, baseUrl);
  if (hit) return { url: hit.url, text: hit.text, source: "header" };
  return null;
}

/**
 * Walk up from a link, collecting the nearest preceding heading at each
 * ancestor level. Returns a breadcrumb like "Financial Results - FY 2025-26 › Q4".
 * Provides section context the link text alone often misses.
 */
function findSectionContext($el: ReturnType<cheerio.CheerioAPI>, $: cheerio.CheerioAPI): string {
  const headings: string[] = [];
  let $current = $el;
  for (let depth = 0; depth < 8; depth++) {
    const $prevHeading = $current.prevAll("h1, h2, h3, h4, h5, h6").first();
    if ($prevHeading.length > 0) {
      const text = $prevHeading.text().trim().replace(/\s+/g, " ");
      if (text && !headings.includes(text)) {
        headings.unshift(text);
      }
    }
    const $parent = $current.parent();
    if ($parent.length === 0 || $parent.is("body, html")) break;
    $current = $parent;
  }
  return headings.join(" › ").slice(0, 250);
}

function harvestPdfs($: cheerio.CheerioAPI, baseUrl: string): IRDocument[] {
  const seen = new Set<string>();
  const docs: IRDocument[] = [];
  $("a[href]").each((_, el) => {
    const $el = $(el);
    const href = $el.attr("href");
    if (!href) return;
    const abs = normalizeUrl(href, baseUrl);
    if (!abs) return;
    const dedupeKey = abs.split("#")[0]!.split("?")[0]!.toLowerCase();
    if (seen.has(dedupeKey)) return;
    // PDF-extension check on URL is structural (filetype filter), not data classification.
    if (!/\.pdf(?:[?#]|$)/i.test(abs)) return;
    seen.add(dedupeKey);

    let title = $el.text().trim();
    if (!title) {
      title = $el.attr("title")?.trim() ?? $el.attr("aria-label")?.trim() ?? "";
    }
    if (!title) {
      const $row = $el.closest("tr, li, p");
      if ($row.length > 0) title = $row.text().replace(/\s+/g, " ").trim().slice(0, 200);
    }
    if (!title) title = abs.split("/").pop() ?? abs;

    const sectionContext = findSectionContext($el, $);

    docs.push({
      url: abs,
      title: title.slice(0, 300),
      sectionContext: sectionContext || undefined,
    });

    if (docs.length >= MAX_DOCS_PER_PAGE) return false;
  });
  return docs;
}

export async function crawlIRDocs(
  companyName: string,
  websiteGuess?: string,
  signal?: AbortSignal,
): Promise<CrawlResult> {
  const warnings: string[] = [];

  if (!websiteGuess) {
    return {
      source: "failed",
      homepageUrl: "",
      documents: [],
      warnings: [`No websiteGuess for ${companyName}; skipping IR crawl.`],
    };
  }

  const homepageUrl = websiteGuess.startsWith("http") ? websiteGuess : `https://${websiteGuess.replace(/^\/+/, "")}`;

  const homeHtml = await fetchHtml(homepageUrl, signal);
  if (!homeHtml) {
    return {
      source: "failed",
      homepageUrl,
      documents: [],
      warnings: [`Could not fetch ${homepageUrl} (network error or non-HTML response).`],
    };
  }
  if (looksLikeCaptcha(homeHtml)) {
    return { source: "failed", homepageUrl, documents: [], warnings: [`${homepageUrl} returned a CAPTCHA page.`] };
  }

  const $home = cheerio.load(homeHtml);
  if (looksLikeSPA($home)) {
    return { source: "failed", homepageUrl, documents: [], warnings: [`${homepageUrl} appears to be a JS-rendered SPA.`] };
  }

  const irLink = findFooterIRLink($home, homepageUrl);
  if (!irLink) {
    return {
      source: "failed",
      homepageUrl,
      documents: [],
      warnings: [`No "Investor Relations" link found in footer or nav of ${homepageUrl}.`],
    };
  }

  const irHtml = await fetchHtml(irLink.url, signal);
  if (!irHtml) {
    warnings.push(`Found IR link "${irLink.text}" → ${irLink.url} but could not fetch it.`);
    return { source: "failed", homepageUrl, irIndexUrl: irLink.url, documents: [], warnings };
  }
  if (looksLikeCaptcha(irHtml)) {
    return { source: "failed", homepageUrl, irIndexUrl: irLink.url, documents: [], warnings: [`IR page ${irLink.url} returned a CAPTCHA.`] };
  }

  const $ir = cheerio.load(irHtml);
  let docs = harvestPdfs($ir, irLink.url);

  // If the IR page is a hub with sub-pages (e.g. /investor-relations/annual-reports +
  // /investor-relations/financial-results), follow the most promising sub-pages and aggregate.
  if (docs.length < 3) {
    const subPages: string[] = [];
    $ir("a[href]").each((_, el) => {
      const text = $ir(el).text().trim();
      if (!text) return;
      // Use the same small vocabulary as IR_LINK_PATTERNS for sub-page discovery.
      if (scoreIRLink(text) === 0 && !/quarterly|earnings/i.test(text)) return;
      const href = $ir(el).attr("href");
      if (!href) return;
      const abs = normalizeUrl(href, irLink.url);
      if (!abs || abs === irLink.url) return;
      if (/\.pdf(?:[?#]|$)/i.test(abs)) return;
      if (!subPages.includes(abs)) subPages.push(abs);
    });
    const aggregated: IRDocument[] = [...docs];
    const seen = new Set(docs.map((d) => d.url.split("#")[0]!.split("?")[0]!.toLowerCase()));
    for (const sub of subPages.slice(0, 4)) {
      const subHtml = await fetchHtml(sub, signal);
      if (!subHtml) continue;
      const $sub = cheerio.load(subHtml);
      const subDocs = harvestPdfs($sub, sub);
      for (const d of subDocs) {
        const k = d.url.split("#")[0]!.split("?")[0]!.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        aggregated.push(d);
      }
      if (aggregated.length >= MAX_DOCS_PER_PAGE) break;
    }
    docs = aggregated;
  }

  if (docs.length === 0) {
    warnings.push(`Found IR page ${irLink.url} but no PDF documents linked.`);
    return { source: irLink.source, homepageUrl, irIndexUrl: irLink.url, documents: [], warnings };
  }

  return { source: irLink.source, homepageUrl, irIndexUrl: irLink.url, documents: docs, warnings };
}
