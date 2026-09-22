/**
 * Scrape the public FundsIndia mutual-fund catalogue.
 *
 * This intentionally does not touch DuckDB or app runtime code. It stores a
 * timestamped snapshot under data/scraped/fundsindia-catalogue/snapshots/.
 *
 * Usage:
 *   npx tsx scripts/scrape-fundsindia-catalogue.ts
 *   npx tsx scripts/scrape-fundsindia-catalogue.ts --skip-details
 */

import { mkdirSync, rmSync, writeFileSync } from "fs";
import { resolve } from "path";

const ROOT_DIR = resolve(__dirname, "..");
const OUT_ROOT = resolve(ROOT_DIR, "data/scraped/fundsindia-catalogue");
const SNAPSHOT_ID = new Date().toISOString().replace(/[:.]/g, "-");
const SNAPSHOT_DIR = resolve(OUT_ROOT, "snapshots", SNAPSHOT_ID);
const LATEST_DIR = resolve(OUT_ROOT, "latest");
const LATEST_POINTER = resolve(OUT_ROOT, "LATEST.txt");

const FUNDSINDIA_API = "https://api.fundsindia.com";
const FUNDSINDIA_WEB = "https://www.fundsindia.com";
const FUNDSINDIA_CDN = "https://cdn.fundsindia.com";
const AMFI_NAV_ALL = "https://www.amfiindia.com/spages/NAVAll.txt";

const PAGE_SIZE = 1000;
const DETAIL_CONCURRENCY = 6;
const INCLUDE_DETAILS = !process.argv.includes("--skip-details");

type JsonObject = Record<string, unknown>;

type FundsIndiaScheme = JsonObject & {
  schemeCode?: string;
  name?: string;
  fullSchemeName?: string;
  category?: string;
  subCategory?: string;
  amc?: string;
  amcCode?: string;
};

type FundsIndiaPage = {
  success?: boolean;
  data?: {
    content?: FundsIndiaScheme[];
    count?: number;
    page?: number;
    size?: number;
    totalPages?: number;
  };
};

type SelectFundGroup = JsonObject & {
  id?: string;
  name?: string;
  position?: number;
  schemes?: FundsIndiaScheme[];
};

type SelectFundsResponse = {
  success?: boolean;
  data?: {
    selectFunds?: SelectFundGroup[];
    count?: number;
    totalPages?: number;
  };
};

type AmfiScheme = {
  source: "amfi_navall";
  schemeSection: string;
  amcName: string;
  schemeCode: string;
  isinGrowth: string;
  isinReinvestment: string;
  schemeName: string;
  nav: string;
  navDate: string;
};

type DetailRow = {
  schemeCode: string;
  success: boolean;
  data?: JsonObject;
  error?: string;
};

const sleep = (ms: number) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function ensureDirs() {
  mkdirSync(resolve(SNAPSHOT_DIR, "raw/details"), { recursive: true });
  mkdirSync(resolve(SNAPSHOT_DIR, "normalized"), { recursive: true });
}

async function fetchText(url: string, init: RequestInit = {}, attempts = 3): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: {
          "user-agent": "Mozilla/5.0",
          ...(init.headers ?? {}),
        },
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.text();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(350 * attempt);
    }
  }
  throw lastError;
}

async function fetchJson<T>(url: string, init: RequestInit = {}, attempts = 3): Promise<T> {
  const text = await fetchText(url, init, attempts);
  return JSON.parse(text) as T;
}

async function fundsIndiaJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  return fetchJson<T>(`${FUNDSINDIA_API}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-api-version": "1.0.0",
      ...(init.headers ?? {}),
    },
  });
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonl(path: string, rows: unknown[]) {
  writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value) || typeof value === "object") return csvCell(JSON.stringify(value));
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function writeCsv(path: string, rows: JsonObject[], columns: string[]) {
  const lines = [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
  ];
  writeFileSync(path, `${lines.join("\n")}\n`);
}

function firstNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function stringList(value: unknown): string {
  return Array.isArray(value) ? value.join("|") : "";
}

function schemeUrl(scheme: FundsIndiaScheme): string {
  const name = String(scheme.name ?? scheme.fullSchemeName ?? "scheme")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${FUNDSINDIA_WEB}/s/${name}/${scheme.schemeCode ?? ""}`;
}

function flattenScheme(scheme: FundsIndiaScheme, extra: JsonObject = {}): JsonObject {
  const schemeCode = String(scheme.schemeCode ?? "");
  return {
    source: "fundsindia_api",
    schemeCode,
    name: scheme.name ?? "",
    fullSchemeName: scheme.fullSchemeName ?? "",
    status: scheme.status ?? "",
    amc: scheme.amc ?? "",
    amcCode: scheme.amcCode ?? "",
    category: scheme.category ?? "",
    categoryId: scheme.categoryId ?? "",
    subCategory: scheme.subCategory ?? "",
    subCategoryId: scheme.subCategoryId ?? "",
    schemeType: scheme.schemeType ?? "",
    option: scheme.option ?? "",
    risk: scheme.risk ?? "",
    rating: scheme.rating ?? "",
    rated: scheme.rated ?? "",
    nav: firstNumber(scheme.nav),
    navFormatted: scheme.navFormatted ?? "",
    navAsOn: scheme.navAsOn ?? "",
    aumCr: firstNumber(scheme.aum),
    expenseRatio: scheme.expenseRatio ?? scheme.expenseRation ?? "",
    oneMonthReturns: scheme.oneMonthReturns ?? "",
    threeMonthReturns: scheme.threeMonthReturns ?? "",
    sixMonthReturns: scheme.sixMonthReturns ?? "",
    oneYearReturns: scheme.oneYearReturns ?? "",
    threeYearReturns: scheme.threeYearReturns ?? "",
    fiveYearReturns: scheme.fiveYearReturns ?? "",
    absoluteReturns: scheme.absoluteReturns ?? "",
    sipAllowed: scheme.sip ?? "",
    lumpsumAllowed: scheme.oti ?? "",
    stpAllowed: scheme.stp ?? "",
    nriAllowed: scheme.nri ?? "",
    nfo: scheme.nfo ?? "",
    superSavings: scheme.superSavings ?? "",
    minimumInvestment: scheme.minimumInvestment ?? "",
    additionalInvestmentMinimum: scheme.additionalInvestmentMinimum ?? "",
    sipMinimumInvestment: scheme.sipMinimumInvestment ?? "",
    minimumSipTenure: scheme.minimumSipTenure ?? "",
    minimumSipTenureUnit: scheme.minimumSipTenureUnit ?? "",
    maximumInvestment: scheme.maximumInvestment ?? "",
    sipTypes: stringList(scheme.sipTypes),
    sipDates: stringList(scheme.sipDates),
    swpDates: stringList(scheme.swpDates),
    stpDates: stringList(scheme.stpDates),
    exitLoad: scheme.exitLoad ?? "",
    benchmark: scheme.benchmark ?? "",
    fundType: scheme.fundType ?? "",
    fiRank: scheme.fiRank ?? "",
    trending: scheme.trending ?? "",
    favourites: scheme.favourites ?? "",
    socialProofType: (scheme.socialProof as JsonObject | undefined)?.type ?? "",
    socialProofValue: (scheme.socialProof as JsonObject | undefined)?.value ?? "",
    schemeUrl: schemeUrl(scheme),
    amcLogoUrl: scheme.amcCode
      ? `https://fimobileapp.s3.ap-south-1.amazonaws.com/amc_logo/${scheme.amcCode}.png`
      : "",
    ...extra,
  };
}

function flattenDetail(detail: DetailRow): JsonObject {
  const data = detail.data ?? {};
  const fundHouse = (data.fundHouse as JsonObject | undefined) ?? {};
  const eligibleInvestors = data.eligibleInvestors as JsonObject[] | undefined;
  const documents = data.documents as JsonObject[] | undefined;
  const assetAllocations = (data.assetAllocations as JsonObject | undefined) ?? {};
  const equity = (assetAllocations.equity as JsonObject | undefined) ?? {};
  const debt = (assetAllocations.debt as JsonObject | undefined) ?? {};
  const others = (assetAllocations.others as JsonObject | undefined) ?? {};
  const sipInvestment = (data.sipInvestment as JsonObject | undefined) ?? {};
  const lumpsumInvestment = (data.lumpsumInvestment as JsonObject | undefined) ?? {};
  const redemption = (data.redemption as JsonObject | undefined) ?? {};
  const switchOut = (data.switchOut as JsonObject | undefined) ?? {};

  return {
    schemeCode: detail.schemeCode,
    detailSuccess: detail.success,
    detailError: detail.error ?? "",
    schemeName: data.schemeName ?? data.name ?? "",
    fullSchemeName: data.fullSchemeName ?? "",
    investmentAllowed: data.investmentAllowed ?? "",
    changePercent: data.changePercent ?? "",
    ytm: data.ytm ?? "",
    portfolioTurnover: data.portfolioTurnover ?? "",
    lockInPeriod: data.lockInPeriod ?? "",
    age: data.age ?? "",
    modifiedDuration: data.modifiedDuration ?? "",
    averageMaturity: data.averageMaturity ?? "",
    assetAllocationDate: assetAllocations.detailsAsOn ?? "",
    equityPct: equity.percentage ?? "",
    debtPct: debt.percentage ?? "",
    othersPct: others.percentage ?? "",
    topEquityHolding: Array.isArray(equity.holdings) ? (equity.holdings[0] as JsonObject | undefined)?.name ?? "" : "",
    topDebtHolding: Array.isArray(debt.holdings) ? (debt.holdings[0] as JsonObject | undefined)?.name ?? "" : "",
    topOtherHolding: Array.isArray(others.holdings) ? (others.holdings[0] as JsonObject | undefined)?.name ?? "" : "",
    peerCount: Array.isArray(data.peers) ? data.peers.length : "",
    documentUrl: documents?.[0]?.link ?? "",
    eligibleInvestors: Array.isArray(eligibleInvestors)
      ? eligibleInvestors.map((item) => item.name).join("|")
      : "",
    fundManager: fundHouse.manager ?? "",
    fundManagerSince: fundHouse.managerSince ?? "",
    fundHouseName: fundHouse.fundHouseName ?? "",
    fundHouseEmail: fundHouse.email ?? "",
    fundHousePhone: fundHouse.phone ?? "",
    sipEnabled: sipInvestment.enabled ?? "",
    sipMinAmount: sipInvestment.minimumAmount ?? "",
    sipMinAmountFormatted: sipInvestment.minimumAmountFormatted ?? "",
    lumpsumEnabled: lumpsumInvestment.enabled ?? "",
    lumpsumMinAmount: lumpsumInvestment.minimumAmount ?? "",
    lumpsumMinAmountFormatted: lumpsumInvestment.minimumAmountFormatted ?? "",
    redemptionMinAmount: redemption.minimumAmount ?? "",
    switchOutMinAmount: switchOut.minimumAmount ?? "",
  };
}

function parseAmfiNavAll(text: string): AmfiScheme[] {
  const schemes: AmfiScheme[] = [];
  let schemeSection = "";
  let amcName = "";

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line === "Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date") {
      continue;
    }

    const parts = line.split(";");
    if (parts.length >= 6 && /^\d+$/.test(parts[0].trim())) {
      schemes.push({
        source: "amfi_navall",
        schemeSection,
        amcName,
        schemeCode: parts[0].trim(),
        isinGrowth: parts[1].trim(),
        isinReinvestment: parts[2].trim(),
        schemeName: parts.slice(3, parts.length - 2).join(";").trim(),
        nav: parts[parts.length - 2].trim(),
        navDate: parts[parts.length - 1].trim(),
      });
      continue;
    }

    if (/schemes?\s*\(/i.test(line) || /^interval fund/i.test(line)) {
      schemeSection = line;
      continue;
    }

    amcName = line;
  }

  return schemes;
}

async function scrapeExplorer(): Promise<{ pages: FundsIndiaPage[]; schemes: FundsIndiaScheme[] }> {
  const pages: FundsIndiaPage[] = [];
  const schemes: FundsIndiaScheme[] = [];
  let totalPages = 1;

  for (let page = 1; page <= totalPages; page++) {
    const body = {
      page,
      size: PAGE_SIZE,
      orderBy: "name",
      orderType: "ASC",
      categories: [],
      subCategories: [],
      query: "",
      risk: [],
      ratings: [],
      amcs: [],
      searchCode: [],
    };

    const response = await fundsIndiaJson<FundsIndiaPage>("/core/products/mf", {
      method: "POST",
      body: JSON.stringify(body),
    });

    pages.push(response);
    totalPages = response.data?.totalPages ?? totalPages;
    schemes.push(...(response.data?.content ?? []));
    writeJson(resolve(SNAPSHOT_DIR, "raw", `fundsindia-explorer-page-${String(page).padStart(4, "0")}.json`), response);
    console.log(`  explorer page ${page}/${totalPages}: ${schemes.length.toLocaleString()} schemes`);
  }

  return { pages, schemes };
}

async function fetchDetail(schemeCode: string): Promise<DetailRow> {
  try {
    const response = await fundsIndiaJson<{ success?: boolean; data?: JsonObject }>(
      `/core/product-search/mf/scheme-details?schemeCode=${encodeURIComponent(schemeCode)}`,
      {
        headers: { "channel-id": "10" },
      },
    );
    return {
      schemeCode,
      success: response.success === true,
      data: response.data,
    };
  } catch (error) {
    return {
      schemeCode,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  onItem?: (result: R, index: number) => void,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const index = next++;
      const result = await fn(items[index], index);
      results[index] = result;
      onItem?.(result, index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

async function main() {
  ensureDirs();
  console.log(`Writing snapshot: ${SNAPSHOT_DIR}`);

  console.log("\nStep 1: FundsIndia filter/form metadata");
  const form = await fundsIndiaJson<JsonObject>("/core/products/mf/form");
  writeJson(resolve(SNAPSHOT_DIR, "raw/fundsindia-form.json"), form);

  console.log("\nStep 2: FundsIndia public explorer catalogue");
  const { pages, schemes } = await scrapeExplorer();

  const dedupedSchemes = Array.from(
    new Map(schemes.map((scheme) => [String(scheme.schemeCode ?? ""), scheme])).values(),
  ).filter((scheme) => scheme.schemeCode);

  writeJson(resolve(SNAPSHOT_DIR, "normalized/fundsindia-schemes.json"), dedupedSchemes);
  writeCsv(
    resolve(SNAPSHOT_DIR, "normalized/fundsindia-schemes.csv"),
    dedupedSchemes.map((scheme) => flattenScheme(scheme)),
    [
      "source",
      "schemeCode",
      "name",
      "fullSchemeName",
      "status",
      "amc",
      "amcCode",
      "category",
      "categoryId",
      "subCategory",
      "subCategoryId",
      "schemeType",
      "option",
      "risk",
      "rating",
      "rated",
      "nav",
      "navFormatted",
      "navAsOn",
      "aumCr",
      "expenseRatio",
      "oneMonthReturns",
      "threeMonthReturns",
      "sixMonthReturns",
      "oneYearReturns",
      "threeYearReturns",
      "fiveYearReturns",
      "absoluteReturns",
      "sipAllowed",
      "lumpsumAllowed",
      "stpAllowed",
      "nriAllowed",
      "nfo",
      "superSavings",
      "minimumInvestment",
      "additionalInvestmentMinimum",
      "sipMinimumInvestment",
      "minimumSipTenure",
      "minimumSipTenureUnit",
      "maximumInvestment",
      "sipTypes",
      "sipDates",
      "swpDates",
      "stpDates",
      "exitLoad",
      "benchmark",
      "fundType",
      "fiRank",
      "trending",
      "favourites",
      "socialProofType",
      "socialProofValue",
      "schemeUrl",
      "amcLogoUrl",
    ],
  );
  console.log(`  normalized schemes: ${dedupedSchemes.length.toLocaleString()}`);

  console.log("\nStep 3: FundsIndia Select Funds");
  const selectFunds = await fundsIndiaJson<SelectFundsResponse>("/core/products/mf/select-funds", {
    method: "POST",
    body: JSON.stringify({
      page: 1,
      size: 1000,
      orderBy: "fiRank",
      orderType: "DESC",
      categories: [],
      subCategories: [],
      query: "",
      risk: [],
      ratings: [],
      amcs: [],
      searchCode: [{ value: "recommended", sort: true }],
    }),
  });
  writeJson(resolve(SNAPSHOT_DIR, "raw/fundsindia-select-funds.json"), selectFunds);
  writeJson(resolve(SNAPSHOT_DIR, "normalized/fundsindia-select-funds.json"), selectFunds.data?.selectFunds ?? []);

  const selectRows = (selectFunds.data?.selectFunds ?? []).flatMap((group) =>
    (group.schemes ?? []).map((scheme) =>
      flattenScheme(scheme, {
        selectGroupId: group.id ?? "",
        selectGroupName: group.name ?? "",
        selectGroupPosition: group.position ?? "",
      }),
    ),
  );
  writeCsv(
    resolve(SNAPSHOT_DIR, "normalized/fundsindia-select-funds.csv"),
    selectRows,
    [
      "source",
      "selectGroupId",
      "selectGroupName",
      "selectGroupPosition",
      "schemeCode",
      "name",
      "fullSchemeName",
      "status",
      "amc",
      "amcCode",
      "category",
      "subCategory",
      "risk",
      "rating",
      "nav",
      "navAsOn",
      "aumCr",
      "expenseRatio",
      "oneYearReturns",
      "threeYearReturns",
      "fiveYearReturns",
      "sipAllowed",
      "lumpsumAllowed",
      "stpAllowed",
      "fiRank",
      "schemeUrl",
      "amcLogoUrl",
    ],
  );
  console.log(`  select funds: ${selectRows.length.toLocaleString()} schemes`);

  console.log("\nStep 4: FundsIndia footer/catalogue metadata");
  const footer = await fetchJson<JsonObject>(`${FUNDSINDIA_CDN}/prelogin/data/footer.json`, { cache: "no-cache" });
  writeJson(resolve(SNAPSHOT_DIR, "raw/fundsindia-footer.json"), footer);
  writeJson(resolve(SNAPSHOT_DIR, "normalized/fundsindia-footer.json"), footer);

  console.log("\nStep 5: AMFI NAVAll industry universe");
  const amfiText = await fetchText(AMFI_NAV_ALL);
  const amfiRows = parseAmfiNavAll(amfiText);
  writeFileSync(resolve(SNAPSHOT_DIR, "raw/amfi-navall.txt"), amfiText);
  writeJson(resolve(SNAPSHOT_DIR, "normalized/amfi-navall.json"), amfiRows);
  writeCsv(
    resolve(SNAPSHOT_DIR, "normalized/amfi-navall.csv"),
    amfiRows,
    [
      "source",
      "schemeSection",
      "amcName",
      "schemeCode",
      "isinGrowth",
      "isinReinvestment",
      "schemeName",
      "nav",
      "navDate",
    ],
  );
  console.log(`  AMFI rows: ${amfiRows.length.toLocaleString()}`);

  let detailRows: DetailRow[] = [];
  if (INCLUDE_DETAILS) {
    console.log("\nStep 6: FundsIndia scheme detail records");
    const schemeCodes = dedupedSchemes.map((scheme) => String(scheme.schemeCode));
    detailRows = await mapLimit(
      schemeCodes,
      DETAIL_CONCURRENCY,
      (schemeCode) => fetchDetail(schemeCode),
      (result, index) => {
        writeJson(resolve(SNAPSHOT_DIR, "raw/details", `${result.schemeCode}.json`), result);
        const completed = index + 1;
        if (completed % 100 === 0 || completed === schemeCodes.length) {
          console.log(`  details: ${completed.toLocaleString()}/${schemeCodes.length.toLocaleString()}`);
        }
      },
    );
    writeJsonl(resolve(SNAPSHOT_DIR, "normalized/fundsindia-scheme-details.jsonl"), detailRows);
    writeCsv(
      resolve(SNAPSHOT_DIR, "normalized/fundsindia-scheme-details.csv"),
      detailRows.map((detail) => flattenDetail(detail)),
      [
        "schemeCode",
        "detailSuccess",
        "detailError",
        "schemeName",
        "fullSchemeName",
        "investmentAllowed",
        "changePercent",
        "ytm",
        "portfolioTurnover",
        "lockInPeriod",
        "age",
        "modifiedDuration",
        "averageMaturity",
        "assetAllocationDate",
        "equityPct",
        "debtPct",
        "othersPct",
        "topEquityHolding",
        "topDebtHolding",
        "topOtherHolding",
        "peerCount",
        "documentUrl",
        "eligibleInvestors",
        "fundManager",
        "fundManagerSince",
        "fundHouseName",
        "fundHouseEmail",
        "fundHousePhone",
        "sipEnabled",
        "sipMinAmount",
        "sipMinAmountFormatted",
        "lumpsumEnabled",
        "lumpsumMinAmount",
        "lumpsumMinAmountFormatted",
        "redemptionMinAmount",
        "switchOutMinAmount",
      ],
    );
  }

  const categoryCounts = countBy(dedupedSchemes, (scheme) => String(scheme.category ?? "Unknown"));
  const amcCounts = countBy(dedupedSchemes, (scheme) => String(scheme.amc ?? "Unknown"));
  const detailSuccesses = detailRows.filter((row) => row.success).length;

  const manifest = {
    snapshotId: SNAPSHOT_ID,
    createdAt: new Date().toISOString(),
    outputDir: SNAPSHOT_DIR,
    sources: {
      fundsIndiaApi: FUNDSINDIA_API,
      fundsIndiaWeb: FUNDSINDIA_WEB,
      fundsIndiaCdn: FUNDSINDIA_CDN,
      amfiNavAll: AMFI_NAV_ALL,
    },
    counts: {
      fundsIndiaExplorerPages: pages.length,
      fundsIndiaSchemes: dedupedSchemes.length,
      fundsIndiaSelectFunds: selectRows.length,
      fundsIndiaSchemeDetails: detailRows.length,
      fundsIndiaSchemeDetailSuccesses: detailSuccesses,
      amfiNavAllRows: amfiRows.length,
      fundsIndiaCategories: Object.keys(categoryCounts).length,
      fundsIndiaAmcs: Object.keys(amcCounts).length,
    },
    categoryCounts,
    topAmcCounts: Object.fromEntries(
      Object.entries(amcCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 25),
    ),
    files: {
      rawForm: "raw/fundsindia-form.json",
      rawExplorerPages: "raw/fundsindia-explorer-page-*.json",
      rawSelectFunds: "raw/fundsindia-select-funds.json",
      rawFooter: "raw/fundsindia-footer.json",
      rawAmfiNavAll: "raw/amfi-navall.txt",
      rawSchemeDetails: INCLUDE_DETAILS ? "raw/details/*.json" : null,
      normalizedSchemesJson: "normalized/fundsindia-schemes.json",
      normalizedSchemesCsv: "normalized/fundsindia-schemes.csv",
      normalizedSelectFundsJson: "normalized/fundsindia-select-funds.json",
      normalizedSelectFundsCsv: "normalized/fundsindia-select-funds.csv",
      normalizedSchemeDetailsJsonl: INCLUDE_DETAILS ? "normalized/fundsindia-scheme-details.jsonl" : null,
      normalizedSchemeDetailsCsv: INCLUDE_DETAILS ? "normalized/fundsindia-scheme-details.csv" : null,
      normalizedAmfiJson: "normalized/amfi-navall.json",
      normalizedAmfiCsv: "normalized/amfi-navall.csv",
    },
  };

  writeJson(resolve(SNAPSHOT_DIR, "manifest.json"), manifest);

  rmSync(LATEST_DIR, { recursive: true, force: true });
  mkdirSync(LATEST_DIR, { recursive: true });
  writeJson(resolve(LATEST_DIR, "manifest.json"), manifest);
  rmSync(resolve(OUT_ROOT, "LATEST"), { recursive: true, force: true });
  writeFileSync(LATEST_POINTER, `${SNAPSHOT_ID}\n`);

  console.log("\nDone");
  console.log(`  snapshot: ${SNAPSHOT_DIR}`);
  console.log(`  schemes: ${dedupedSchemes.length.toLocaleString()}`);
  console.log(`  details: ${detailSuccesses.toLocaleString()}/${detailRows.length.toLocaleString()}`);
  console.log(`  AMFI rows: ${amfiRows.length.toLocaleString()}`);
}

function countBy<T>(items: T[], getKey: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = getKey(item) || "Unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
