import "server-only";

import { Browserbase } from "@browserbasehq/sdk";
import * as cheerio from "cheerio";
import { chromium, type BrowserContext, type Page } from "playwright-core";

const NAVIGATION_TIMEOUT_MS = 45_000;
const SESSION_TIMEOUT_SECONDS = 300;
const DISCOVERY_PROBE_LIMIT = 3;
const WORKER_COUNT = 3;
const DISCOVERY_CACHE_TTL_MS = 5 * 60_000;

interface WebsiteCrawlerGlobal {
  __knowledge_discovery_cache__?: Map<string, { expiresAt: number; result: WebsiteDiscoveryResult }>;
}

const crawlerGlobal = globalThis as WebsiteCrawlerGlobal;

function discoveryCache() {
  crawlerGlobal.__knowledge_discovery_cache__ ??= new Map();
  return crawlerGlobal.__knowledge_discovery_cache__;
}

export interface DiscoveredWebsitePage {
  url: string;
  path: string;
  title: string;
}

export interface WebsiteDiscoveryResult {
  name: string;
  seedUrl: string;
  pages: DiscoveredWebsitePage[];
  truncated: boolean;
}

export interface ScrapedWebsitePage {
  url: string;
  title: string;
  text: string;
  truncated: boolean;
}

export interface WebsiteCrawlCallbacks {
  onPageStart?: (url: string, index: number) => void | Promise<void>;
  onPageProgress?: (url: string, progress: number, index: number) => void | Promise<void>;
  onPageComplete?: (page: ScrapedWebsitePage, index: number) => void | Promise<void>;
  onPageError?: (url: string, error: string, index: number) => void | Promise<void>;
}

export async function discoverWebsitePages(rawUrl: string, limit = 100): Promise<WebsiteDiscoveryResult> {
  const seed = parsePublicHttpUrl(rawUrl);
  const cappedLimit = Math.max(1, Math.min(limit, 100));
  const cacheKey = `${canonicalHostname(seed.hostname)}${seed.pathname}${seed.search}:${cappedLimit}`;
  const cached = discoveryCache().get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return {
      ...cached.result,
      pages: cached.result.pages.slice(0, cappedLimit),
      truncated: cached.result.pages.length >= cappedLimit,
    };
  }
  const discovered = new Map<string, DiscoveredWebsitePage>();

  const site = await withBrowserbaseContext(siteHostAliases(seed.hostname), async (context) => {
    const page = await context.newPage();
    const initial = await visitAndCollect(page, seed);
    const canonicalSeed = parsePublicHttpUrl(initial.finalUrl);
    addDiscoveredPage(discovered, canonicalSeed, initial.title || canonicalSeed.hostname, canonicalSeed, cappedLimit);
    initial.links.forEach((link) => addDiscoveredPage(discovered, link.url, link.title, canonicalSeed, cappedLimit));

    if (discovered.size < cappedLimit) {
      const sitemapPage = await context.newPage();
      try {
        const sitemapUrls = await collectSitemapUrls(sitemapPage, canonicalSeed).catch(() => []);
        sitemapUrls.forEach((url) => addDiscoveredPage(discovered, url, titleFromUrl(url), canonicalSeed, cappedLimit));
      } finally {
        await sitemapPage.close().catch(() => {});
      }
    }

    const probes = Array.from(discovered.values())
      .filter((candidate) => candidate.url !== normalizeUrl(seed))
      .slice(0, DISCOVERY_PROBE_LIMIT);
    await runPool(probes, Math.min(WORKER_COUNT, probes.length), async (candidate) => {
      if (discovered.size >= cappedLimit) return;
      const probePage = await context.newPage();
      try {
        const result = await visitAndCollect(probePage, new URL(candidate.url));
        result.links.forEach((link) => addDiscoveredPage(discovered, link.url, link.title, canonicalSeed, cappedLimit));
      } catch {
        // The seed page still provides a usable discovery set.
      } finally {
        await probePage.close().catch(() => {});
      }
    });

    await page.close().catch(() => {});
    return {
      name: initial.title || canonicalSeed.hostname.replace(/^www\./, ""),
      seedUrl: normalizeUrl(canonicalSeed),
    };
  });

  const result = {
    name: site.name,
    seedUrl: site.seedUrl,
    pages: Array.from(discovered.values()).slice(0, cappedLimit),
    truncated: discovered.size >= cappedLimit,
  };
  discoveryCache().set(cacheKey, { expiresAt: Date.now() + DISCOVERY_CACHE_TTL_MS, result });
  return result;
}

export async function scrapeWebsitePages(
  rawUrls: string[],
  callbacks: WebsiteCrawlCallbacks = {},
): Promise<ScrapedWebsitePage[]> {
  const urls = dedupeUrls(rawUrls).slice(0, 100).map(parsePublicHttpUrl);
  if (urls.length === 0) throw new Error("At least one public website URL is required.");
  const hosts = Array.from(new Set(urls.map((url) => url.hostname)));
  const results: Array<ScrapedWebsitePage | undefined> = new Array(urls.length);

  await withBrowserbaseContext(hosts, async (context) => {
    await runPool(urls.map((url, index) => ({ url, index })), Math.min(WORKER_COUNT, urls.length), async ({ url, index }) => {
      await callbacks.onPageStart?.(normalizeUrl(url), index);
      const page = await context.newPage();
      try {
        await callbacks.onPageProgress?.(normalizeUrl(url), 8, index);
        await navigate(page, url, async (progress) => {
          await callbacks.onPageProgress?.(normalizeUrl(url), progress, index);
        });
        const html = await page.content();
        await callbacks.onPageProgress?.(normalizeUrl(url), 88, index);
        const extracted = htmlToKnowledgeText(html);
        if (extracted.text.length < 40) throw new Error("The rendered page did not contain enough readable content.");
        await callbacks.onPageProgress?.(normalizeUrl(url), 96, index);
        const result: ScrapedWebsitePage = {
          url: normalizeUrl(new URL(page.url() || url.toString())),
          title: extracted.title || (await page.title().catch(() => "")) || titleFromUrl(url),
          text: extracted.text,
          truncated: false,
        };
        results[index] = result;
        await callbacks.onPageComplete?.(result, index);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not scrape this page.";
        await callbacks.onPageError?.(normalizeUrl(url), message, index);
      } finally {
        await page.close().catch(() => {});
      }
    });
  });

  return results.filter((page): page is ScrapedWebsitePage => Boolean(page));
}

export function parsePublicHttpUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error("Enter a valid URL beginning with http:// or https://.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only public HTTP and HTTPS URLs are supported.");
  }
  if (isPrivateHostname(url.hostname)) {
    throw new Error("Private and local network URLs are not supported.");
  }
  url.hash = "";
  return url;
}

function browserbaseApiKey(): string {
  const apiKey = process.env.BROWSERBASE_API_KEY?.trim();
  if (!apiKey) throw new Error("The website scraper is not configured.");
  return apiKey;
}

async function withBrowserbaseContext<T>(hosts: string[], run: (context: BrowserContext) => Promise<T>): Promise<T> {
  const allowedDomains = Array.from(new Set(hosts.flatMap(siteHostAliases)));
  const client = new Browserbase({ apiKey: browserbaseApiKey() });
  const session = await client.sessions.create({
    timeout: SESSION_TIMEOUT_SECONDS,
    browserSettings: {
      allowedDomains,
      blockAds: true,
      recordSession: false,
      viewport: { width: 1440, height: 1100 },
    },
    userMetadata: {
      feature: "knowledge.website-source",
      hosts: allowedDomains.slice(0, 10).join(","),
    },
  });
  const browser = await chromium.connectOverCDP(session.connectUrl);
  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    return await run(context);
  } finally {
    await browser.close().catch(() => {});
  }
}

async function navigate(
  page: Page,
  url: URL,
  onProgress?: (progress: number) => void | Promise<void>,
): Promise<void> {
  page.setDefaultTimeout(8_000);
  page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
  await onProgress?.(15);
  await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
  await onProgress?.(65);
  await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => {});
  await onProgress?.(82);
}

async function visitAndCollect(page: Page, url: URL): Promise<{
  title: string;
  finalUrl: string;
  links: Array<{ url: URL; title: string }>;
}> {
  page.setDefaultTimeout(8_000);
  page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
  await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
  await page.locator("a[href]").first().waitFor({ state: "attached", timeout: 1_500 }).catch(() => {});
  const title = (await page.title().catch(() => "")).trim();
  const links = await page.evaluate(String.raw`(() => {
    return Array.from(document.querySelectorAll("a[href]"))
      .map((anchor) => ({
        href: anchor.href,
        title: (anchor.innerText || anchor.getAttribute("aria-label") || anchor.title || "")
          .replace(/\s+/g, " ")
          .trim(),
      }))
      .filter((link) => link.href);
  })()`) as Array<{ href: string; title: string }>;
  return {
    title,
    finalUrl: page.url() || url.toString(),
    links: links.flatMap((link) => {
      try {
        return [{ url: new URL(link.href), title: link.title }];
      } catch {
        return [];
      }
    }),
  };
}

async function collectSitemapUrls(page: Page, seed: URL): Promise<URL[]> {
  const sitemapUrl = new URL("/sitemap.xml", seed.origin);
  await page.goto(sitemapUrl.toString(), { waitUntil: "domcontentloaded", timeout: 12_000 });
  const text = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
  const matches = text.match(/https?:\/\/[^\s<>"']+/g) ?? [];
  return matches.slice(0, 200).flatMap((value) => {
    try {
      return [new URL(value.replace(/&amp;/g, "&"))];
    } catch {
      return [];
    }
  });
}

function addDiscoveredPage(
  pages: Map<string, DiscoveredWebsitePage>,
  candidate: URL,
  title: string,
  seed: URL,
  limit: number,
): void {
  if (pages.size >= limit) return;
  if (!isSameSite(seed, candidate) || !isPageCandidate(candidate)) return;
  const url = normalizeUrl(candidate);
  if (pages.has(url)) return;
  pages.set(url, {
    url,
    path: `${candidate.pathname || "/"}${candidate.search}`,
    title: cleanTitle(title) || titleFromUrl(candidate),
  });
}

function isSameSite(seed: URL, candidate: URL): boolean {
  return (candidate.protocol === "http:" || candidate.protocol === "https:") &&
    canonicalHostname(candidate.hostname) === canonicalHostname(seed.hostname);
}

function canonicalHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

function siteHostAliases(hostname: string): string[] {
  const canonical = canonicalHostname(hostname);
  return [canonical, `www.${canonical}`];
}

function isPageCandidate(url: URL): boolean {
  if (/\.(?:jpg|jpeg|png|gif|webp|svg|ico|zip|gz|mp[34]|avi|mov|woff2?|ttf|css|js)$/i.test(url.pathname)) return false;
  if (/\b(?:logout|signout)\b/i.test(url.pathname)) return false;
  return true;
}

function normalizeUrl(url: URL): string {
  url.hash = "";
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

function dedupeUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  return urls.filter((raw) => {
    try {
      const normalized = normalizeUrl(parsePublicHttpUrl(raw));
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    } catch {
      return false;
    }
  });
}

function htmlToKnowledgeText(html: string): { title: string; text: string } {
  const $ = cheerio.load(html);
  $("script, style, noscript, nav, header, footer, svg, form, iframe, [aria-hidden='true']").remove();
  const title =
    ($('meta[property="og:title"]').attr("content") || "").trim() ||
    $("title").first().text().trim() ||
    $("h1").first().text().trim();
  const root = $("main").length ? $("main") : $("article").length ? $("article") : $("body");
  const text = root
    .text()
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n/g, "\n\n")
    .trim();
  return { title, text };
}

function titleFromUrl(url: URL): string {
  const segment = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || url.hostname);
  return segment.replace(/[-_]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function cleanTitle(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 160);
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return true;
  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  const [first, second] = octets;
  return first === 10 || first === 127 || first === 0 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168);
}

async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const next = async (): Promise<void> => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await worker(item);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => next()));
}
