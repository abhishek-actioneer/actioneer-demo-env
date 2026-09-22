import { existsSync, readFileSync } from "fs";
import { dirname, isAbsolute, join, resolve } from "path";

type JsonObject = Record<string, unknown>;

interface FundsIndiaManifest {
  snapshotId?: string;
  createdAt?: string;
  outputDir?: string;
  counts?: Record<string, number>;
  files?: Record<string, string | null>;
}

interface RawFundsIndiaScheme {
  schemeCode?: unknown;
  name?: unknown;
  fullSchemeName?: unknown;
  category?: unknown;
  subCategory?: unknown;
  amc?: unknown;
  risk?: unknown;
  rating?: unknown;
  nav?: unknown;
  navFormatted?: unknown;
  navAsOn?: unknown;
  aum?: unknown;
  expenseRation?: unknown;
  minimumInvestment?: unknown;
  minimumInvestmentFormatted?: unknown;
  additionalInvestmentMinimum?: unknown;
  additionalInvestmentMinimumFormatted?: unknown;
  sip?: unknown;
  oti?: unknown;
  stp?: unknown;
  nri?: unknown;
  nfo?: unknown;
  superSavings?: unknown;
  sipMinimumInvestment?: unknown;
  sipMinimumInvestmentFormatted?: unknown;
  oneMonthReturns?: unknown;
  threeMonthReturns?: unknown;
  sixMonthReturns?: unknown;
  oneYearReturns?: unknown;
  threeYearReturns?: unknown;
  fiveYearReturns?: unknown;
  option?: unknown;
  schemeType?: unknown;
  exitLoad?: unknown;
  benchmark?: unknown;
  status?: unknown;
  fundType?: unknown;
}

export interface FundsIndiaFund {
  schemeCode: string;
  name: string;
  fullSchemeName: string;
  amc: string;
  category: string;
  subCategory: string;
  risk: string;
  riskBucket: "conservative" | "balanced" | "aggressive" | "unknown";
  rating: number | null;
  nav: number | null;
  navAsOn: string;
  aumCr: number | null;
  expenseRatio: number | null;
  minimumInvestment: number | null;
  additionalInvestmentMinimum: number | null;
  sipAllowed: boolean;
  lumpsumAllowed: boolean;
  stpAllowed: boolean;
  nriAllowed: boolean;
  nfo: boolean;
  superSavings: boolean;
  sipMinimumInvestment: number | null;
  oneMonthReturns: number | null;
  threeMonthReturns: number | null;
  sixMonthReturns: number | null;
  oneYearReturns: number | null;
  threeYearReturns: number | null;
  fiveYearReturns: number | null;
  option: string;
  schemeType: string;
  exitLoad: string;
  benchmark: string;
  status: string;
  fundType: string;
  curatedSelectFund: boolean;
  searchText: string;
}

export interface FundsIndiaCatalogue {
  snapshotId: string;
  createdAt: string;
  manifestPath: string;
  schemesPath: string;
  selectFundsPath?: string;
  loadedAt: string;
  funds: FundsIndiaFund[];
  bySchemeCode: Map<string, FundsIndiaFund>;
  counts: {
    totalFunds: number;
    sipEnabled: number;
    lumpsumEnabled: number;
    curatedSelectFunds: number;
    categories: number;
    amcs: number;
  };
}

export interface FundsIndiaFundSearchArgs {
  query?: string;
  category?: string;
  risk?: string;
  riskLevel?: string;
  sipRequired?: boolean;
  elssOnly?: boolean;
  minRating?: number;
  maxSipMinimum?: number;
  maxResults?: number;
}

export interface FundsIndiaFundSearchHit {
  schemeCode: string;
  name: string;
  fullSchemeName: string;
  amc: string;
  category: string;
  subCategory: string;
  risk: string;
  riskBucket: FundsIndiaFund["riskBucket"];
  rating: number | null;
  nav: number | null;
  navAsOn: string;
  aumCr: number | null;
  minimumInvestment: number | null;
  sipAllowed: boolean;
  sipMinimumInvestment: number | null;
  lumpsumAllowed: boolean;
  oneYearReturns: number | null;
  threeYearReturns: number | null;
  fiveYearReturns: number | null;
  curatedSelectFund: boolean;
}

export interface FundsIndiaFundSearchResult {
  ok: true;
  query: string;
  filters: Record<string, unknown>;
  snapshotId: string;
  catalogueCreatedAt: string;
  totalCatalogueFunds: number;
  matched: number;
  returned: number;
  latencyMs: number;
  results: FundsIndiaFundSearchHit[];
  notes: string[];
}

export interface FundsIndiaFundDetailsResult {
  ok: true;
  snapshotId: string;
  latencyMs: number;
  fund?: FundsIndiaFundSearchHit & {
    expenseRatio: number | null;
    additionalInvestmentMinimum: number | null;
    stpAllowed: boolean;
    nriAllowed: boolean;
    nfo: boolean;
    superSavings: boolean;
    option: string;
    schemeType: string;
    exitLoad: string;
    benchmark: string;
    status: string;
    fundType: string;
  };
  alternatives?: FundsIndiaFundSearchHit[];
  notes: string[];
}

declare global {
  var __fundsIndiaCatalogue: FundsIndiaCatalogue | undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/,/g, "").trim();
  if (!cleaned || cleaned === "-") return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function boolValue(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length >= 2);
}

function riskBucket(risk: string): FundsIndiaFund["riskBucket"] {
  const normalized = normalizeText(risk);
  if (normalized === "low" || normalized === "low to moderate") return "conservative";
  if (normalized === "moderate") return "balanced";
  if (
    normalized === "moderately high" ||
    normalized === "high" ||
    normalized === "very high"
  ) {
    return "aggressive";
  }
  return "unknown";
}

function manifestPath(): string {
  return resolve(process.cwd(), "data/scraped/fundsindia-catalogue/latest/manifest.json");
}

function resolveSnapshotDir(manifest: FundsIndiaManifest, path: string): string {
  const candidates = [
    manifest.outputDir,
    manifest.snapshotId
      ? resolve(process.cwd(), "data/scraped/fundsindia-catalogue/snapshots", manifest.snapshotId)
      : undefined,
    resolve(dirname(path), "..", "snapshots", manifest.snapshotId || ""),
  ].filter((item): item is string => Boolean(item));

  for (const candidate of candidates) {
    const resolved = isAbsolute(candidate) ? candidate : resolve(process.cwd(), candidate);
    if (existsSync(resolved)) return resolved;
  }
  throw new Error("FundsIndia catalogue snapshot directory was not found. Run scripts/scrape-fundsindia-catalogue.ts first.");
}

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function collectSelectFundCodes(selectFundsPath: string): Set<string> {
  if (!existsSync(selectFundsPath)) return new Set();
  const groups = readJsonFile<unknown[]>(selectFundsPath);
  const codes = new Set<string>();

  for (const group of groups) {
    const record = group && typeof group === "object" && !Array.isArray(group)
      ? group as JsonObject
      : undefined;
    const schemes = Array.isArray(record?.schemes) ? record.schemes : [];
    for (const rawScheme of schemes) {
      const scheme = rawScheme && typeof rawScheme === "object" && !Array.isArray(rawScheme)
        ? rawScheme as JsonObject
        : undefined;
      const code = stringValue(scheme?.schemeCode);
      if (code) codes.add(code);
    }
  }

  return codes;
}

function normalizeScheme(raw: RawFundsIndiaScheme, selectFundCodes: Set<string>): FundsIndiaFund | undefined {
  const schemeCode = stringValue(raw.schemeCode);
  const name = stringValue(raw.name);
  const fullSchemeName = stringValue(raw.fullSchemeName) || name;
  if (!schemeCode || !fullSchemeName) return undefined;

  const amc = stringValue(raw.amc);
  const category = stringValue(raw.category);
  const subCategory = stringValue(raw.subCategory);
  const risk = stringValue(raw.risk) || "Unknown";
  const aumCr = numberValue(raw.aum);
  const expenseRatio = numberValue(raw.expenseRation);
  const minimumInvestment = numberValue(raw.minimumInvestment);
  const additionalInvestmentMinimum = numberValue(raw.additionalInvestmentMinimum);
  const sipMinimumInvestment = numberValue(raw.sipMinimumInvestment);
  const rating = numberValue(raw.rating);

  const fund: FundsIndiaFund = {
    schemeCode,
    name,
    fullSchemeName,
    amc,
    category,
    subCategory,
    risk,
    riskBucket: riskBucket(risk),
    rating,
    nav: numberValue(raw.nav),
    navAsOn: stringValue(raw.navAsOn),
    aumCr,
    expenseRatio,
    minimumInvestment,
    additionalInvestmentMinimum,
    sipAllowed: boolValue(raw.sip),
    lumpsumAllowed: boolValue(raw.oti),
    stpAllowed: boolValue(raw.stp),
    nriAllowed: boolValue(raw.nri),
    nfo: boolValue(raw.nfo),
    superSavings: boolValue(raw.superSavings),
    sipMinimumInvestment,
    oneMonthReturns: numberValue(raw.oneMonthReturns),
    threeMonthReturns: numberValue(raw.threeMonthReturns),
    sixMonthReturns: numberValue(raw.sixMonthReturns),
    oneYearReturns: numberValue(raw.oneYearReturns),
    threeYearReturns: numberValue(raw.threeYearReturns),
    fiveYearReturns: numberValue(raw.fiveYearReturns),
    option: stringValue(raw.option),
    schemeType: stringValue(raw.schemeType),
    exitLoad: stringValue(raw.exitLoad),
    benchmark: stringValue(raw.benchmark),
    status: stringValue(raw.status),
    fundType: stringValue(raw.fundType),
    curatedSelectFund: selectFundCodes.has(schemeCode),
    searchText: normalizeText([
      schemeCode,
      name,
      fullSchemeName,
      amc,
      category,
      subCategory,
      risk,
      stringValue(raw.option),
      stringValue(raw.fundType),
    ].join(" ")),
  };

  return fund;
}

function loadFundsIndiaCatalogue(): FundsIndiaCatalogue {
  const path = manifestPath();
  if (!existsSync(path)) {
    throw new Error("FundsIndia catalogue manifest not found. Run scripts/scrape-fundsindia-catalogue.ts first.");
  }

  const manifest = readJsonFile<FundsIndiaManifest>(path);
  const snapshotDir = resolveSnapshotDir(manifest, path);
  const schemesPath = join(snapshotDir, manifest.files?.normalizedSchemesJson || "normalized/fundsindia-schemes.json");
  const selectFundsPath = join(snapshotDir, manifest.files?.normalizedSelectFundsJson || "normalized/fundsindia-select-funds.json");
  if (!existsSync(schemesPath)) {
    throw new Error(`FundsIndia schemes file not found at ${schemesPath}`);
  }

  const selectFundCodes = collectSelectFundCodes(selectFundsPath);
  const rawSchemes = readJsonFile<RawFundsIndiaScheme[]>(schemesPath);
  const funds = rawSchemes
    .map((scheme) => normalizeScheme(scheme, selectFundCodes))
    .filter((fund): fund is FundsIndiaFund => Boolean(fund));
  const bySchemeCode = new Map(funds.map((fund) => [fund.schemeCode, fund]));
  const categories = new Set(funds.map((fund) => fund.category).filter(Boolean));
  const amcs = new Set(funds.map((fund) => fund.amc).filter(Boolean));

  return {
    snapshotId: manifest.snapshotId || "unknown",
    createdAt: manifest.createdAt || "",
    manifestPath: path,
    schemesPath,
    selectFundsPath: existsSync(selectFundsPath) ? selectFundsPath : undefined,
    loadedAt: new Date().toISOString(),
    funds,
    bySchemeCode,
    counts: {
      totalFunds: funds.length,
      sipEnabled: funds.filter((fund) => fund.sipAllowed).length,
      lumpsumEnabled: funds.filter((fund) => fund.lumpsumAllowed).length,
      curatedSelectFunds: funds.filter((fund) => fund.curatedSelectFund).length,
      categories: categories.size,
      amcs: amcs.size,
    },
  };
}

export function getFundsIndiaCatalogue(): FundsIndiaCatalogue {
  if (!global.__fundsIndiaCatalogue) {
    const startedAt = Date.now();
    global.__fundsIndiaCatalogue = loadFundsIndiaCatalogue();
    console.info("[fundsindia/catalogue] loaded", {
      funds: global.__fundsIndiaCatalogue.funds.length,
      snapshotId: global.__fundsIndiaCatalogue.snapshotId,
      durationMs: Date.now() - startedAt,
    });
  }
  return global.__fundsIndiaCatalogue;
}

function includeByCategory(fund: FundsIndiaFund, category: string | undefined): boolean {
  const normalized = normalizeText(category || "");
  if (!normalized) return true;
  return normalizeText(`${fund.category} ${fund.subCategory} ${fund.fundType}`).includes(normalized);
}

function includeByRisk(fund: FundsIndiaFund, risk: string | undefined, riskLevel: string | undefined): boolean {
  const normalizedRisk = normalizeText(risk || "");
  if (normalizedRisk && normalizeText(fund.risk) !== normalizedRisk) return false;

  const normalizedLevel = normalizeText(riskLevel || "");
  if (!normalizedLevel) return true;
  if (["safe", "conservative", "low risk", "low"].includes(normalizedLevel)) {
    return fund.riskBucket === "conservative";
  }
  if (["balanced", "medium", "moderate"].includes(normalizedLevel)) {
    return fund.riskBucket === "balanced";
  }
  if (["aggressive", "risky", "high risk", "growth"].includes(normalizedLevel)) {
    return fund.riskBucket === "aggressive";
  }
  return normalizeText(fund.risk).includes(normalizedLevel);
}

function inferFiltersFromQuery(query: string, args: FundsIndiaFundSearchArgs): Required<Pick<FundsIndiaFundSearchArgs, "sipRequired" | "elssOnly">> & {
  riskLevel?: string;
  category?: string;
} {
  const normalized = normalizeText(query);
  const sipRequired = args.sipRequired ?? /\bsip\b/.test(normalized);
  const elssOnly = args.elssOnly ?? (/\belss\b/.test(normalized) || normalized.includes("tax saving"));
  const riskLevel = args.riskLevel ||
    (/\b(low risk|safe|conservative)\b/.test(normalized) ? "conservative" : undefined) ||
    (/\b(moderate|balanced)\b/.test(normalized) ? "balanced" : undefined) ||
    (/\b(high risk|aggressive|risky)\b/.test(normalized) ? "aggressive" : undefined);
  const category = args.category ||
    (/\bliquid\b/.test(normalized) ? "Liquid" : undefined) ||
    (/\bdebt\b/.test(normalized) ? "Debt" : undefined) ||
    (/\bequity\b/.test(normalized) ? "Equity" : undefined);

  return { sipRequired, elssOnly, riskLevel, category };
}

function queryScore(fund: FundsIndiaFund, query: string): number {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return 0;
  const tokens = tokenize(query);
  let score = 0;

  if (fund.schemeCode === query.trim()) score += 100;
  if (fund.searchText.includes(normalizedQuery)) score += 35;
  if (normalizeText(fund.fullSchemeName).startsWith(normalizedQuery)) score += 18;
  if (normalizeText(fund.name).startsWith(normalizedQuery)) score += 16;

  for (const token of tokens) {
    if (fund.searchText.includes(token)) score += 6;
    if (normalizeText(fund.amc).includes(token)) score += 3;
    if (normalizeText(fund.category).includes(token)) score += 2;
    if (normalizeText(fund.subCategory).includes(token)) score += 2;
  }

  return score;
}

function fundRankScore(fund: FundsIndiaFund, query: string): number {
  const rating = fund.rating ?? 0;
  const threeYear = fund.threeYearReturns ?? 0;
  const fiveYear = fund.fiveYearReturns ?? 0;
  return queryScore(fund, query) +
    (fund.curatedSelectFund ? 10 : 0) +
    rating * 2 +
    Math.max(-5, Math.min(10, threeYear / 3)) +
    Math.max(-5, Math.min(8, fiveYear / 4)) +
    (fund.sipAllowed ? 1 : 0);
}

function toSearchHit(fund: FundsIndiaFund): FundsIndiaFundSearchHit {
  return {
    schemeCode: fund.schemeCode,
    name: fund.name,
    fullSchemeName: fund.fullSchemeName,
    amc: fund.amc,
    category: fund.category,
    subCategory: fund.subCategory,
    risk: fund.risk,
    riskBucket: fund.riskBucket,
    rating: fund.rating,
    nav: fund.nav,
    navAsOn: fund.navAsOn,
    aumCr: fund.aumCr,
    minimumInvestment: fund.minimumInvestment,
    sipAllowed: fund.sipAllowed,
    sipMinimumInvestment: fund.sipMinimumInvestment,
    lumpsumAllowed: fund.lumpsumAllowed,
    oneYearReturns: fund.oneYearReturns,
    threeYearReturns: fund.threeYearReturns,
    fiveYearReturns: fund.fiveYearReturns,
    curatedSelectFund: fund.curatedSelectFund,
  };
}

function clampResultLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 5;
  return Math.max(1, Math.min(8, Math.floor(value || 5)));
}

export function searchFundsIndiaFunds(args: FundsIndiaFundSearchArgs): FundsIndiaFundSearchResult {
  const startedAt = Date.now();
  const catalogue = getFundsIndiaCatalogue();
  const query = (args.query || "").trim();
  const inferred = inferFiltersFromQuery(query, args);
  const maxResults = clampResultLimit(args.maxResults);
  const minRating = Number.isFinite(args.minRating) ? Math.max(0, Number(args.minRating)) : undefined;
  const maxSipMinimum = Number.isFinite(args.maxSipMinimum) ? Number(args.maxSipMinimum) : undefined;

  const matched = catalogue.funds.filter((fund) => {
    if (inferred.sipRequired && !fund.sipAllowed) return false;
    if (inferred.elssOnly && !includeByCategory(fund, "ELSS")) return false;
    if (!includeByCategory(fund, inferred.category)) return false;
    if (!includeByRisk(fund, args.risk, inferred.riskLevel)) return false;
    if (minRating !== undefined && (fund.rating ?? 0) < minRating) return false;
    if (maxSipMinimum !== undefined && (fund.sipMinimumInvestment ?? Number.POSITIVE_INFINITY) > maxSipMinimum) {
      return false;
    }
    if (query && queryScore(fund, query) <= 0) return false;
    return true;
  });

  const ranked = matched
    .map((fund) => ({ fund, score: fundRankScore(fund, query) }))
    .sort((a, b) => b.score - a.score || a.fund.fullSchemeName.localeCompare(b.fund.fullSchemeName))
    .slice(0, maxResults)
    .map(({ fund }) => toSearchHit(fund));

  return {
    ok: true,
    query,
    filters: {
      category: inferred.category,
      risk: args.risk,
      riskLevel: inferred.riskLevel,
      sipRequired: inferred.sipRequired,
      elssOnly: inferred.elssOnly,
      minRating,
      maxSipMinimum,
    },
    snapshotId: catalogue.snapshotId,
    catalogueCreatedAt: catalogue.createdAt,
    totalCatalogueFunds: catalogue.counts.totalFunds,
    matched: matched.length,
    returned: ranked.length,
    latencyMs: Date.now() - startedAt,
    results: ranked,
    notes: [
      "Factual FundsIndia catalogue lookup only; not personalized investment advice.",
      "Returns and NAV are as available in the scraped catalogue snapshot and may change.",
    ],
  };
}

export function getFundsIndiaFundDetails(input: { schemeCode?: string; query?: string }): FundsIndiaFundDetailsResult {
  const startedAt = Date.now();
  const catalogue = getFundsIndiaCatalogue();
  const schemeCode = input.schemeCode?.trim();
  const fund = schemeCode ? catalogue.bySchemeCode.get(schemeCode) : undefined;
  const found = fund || searchFundsIndiaFunds({ query: input.query || schemeCode || "", maxResults: 1 }).results[0];
  const detailedFund = found ? catalogue.bySchemeCode.get(found.schemeCode) : undefined;

  if (!detailedFund) {
    const alternatives = input.query || schemeCode
      ? searchFundsIndiaFunds({ query: input.query || schemeCode, maxResults: 3 }).results
      : [];
    return {
      ok: true,
      snapshotId: catalogue.snapshotId,
      latencyMs: Date.now() - startedAt,
      alternatives,
      notes: ["No exact fund was found for that scheme code or query."],
    };
  }

  return {
    ok: true,
    snapshotId: catalogue.snapshotId,
    latencyMs: Date.now() - startedAt,
    fund: {
      ...toSearchHit(detailedFund),
      expenseRatio: detailedFund.expenseRatio,
      additionalInvestmentMinimum: detailedFund.additionalInvestmentMinimum,
      stpAllowed: detailedFund.stpAllowed,
      nriAllowed: detailedFund.nriAllowed,
      nfo: detailedFund.nfo,
      superSavings: detailedFund.superSavings,
      option: detailedFund.option,
      schemeType: detailedFund.schemeType,
      exitLoad: detailedFund.exitLoad,
      benchmark: detailedFund.benchmark,
      status: detailedFund.status,
      fundType: detailedFund.fundType,
    },
    notes: [
      "Factual FundsIndia catalogue lookup only; not personalized investment advice.",
      "Returns and NAV are as available in the scraped catalogue snapshot and may change.",
    ],
  };
}

export function fundsIndiaCatalogueStats(): FundsIndiaCatalogue["counts"] & {
  snapshotId: string;
  createdAt: string;
  loadedAt: string;
} {
  const catalogue = getFundsIndiaCatalogue();
  return {
    ...catalogue.counts,
    snapshotId: catalogue.snapshotId,
    createdAt: catalogue.createdAt,
    loadedAt: catalogue.loadedAt,
  };
}
