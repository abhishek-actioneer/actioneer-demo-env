/**
 * Client-safe dataset metadata snapshot.
 *
 * Used for first-paint fallback labels in DatasetProvider before
 * /api/datasets resolves. Must stay in sync with the label / reportMeta
 * / currency / entityName fields in each dataset config at
 * src/lib/datasets/<id>.ts.
 *
 * This file must NOT import from ./index.ts or ./<id>.ts — those pull
 * full DatasetConfig (viewSQL, summaryTableSQL, etc.) and Node `fs` via
 * dynamic-registry, which cannot be bundled for client components.
 */

import type { EventDefinition } from "@/lib/explorer-types";

export interface DatasetMeta {
  id: string;
  label: string;
  isDynamic?: boolean;
  /** Company/product name used when generated prompts need a caller identity. Defaults to label. */
  companyName?: string;
  /** Currency symbol for formatting monetary values (e.g. "$", "₹", "€"). Defaults to "$". */
  currency?: string;
  /** Name of the primary entity (e.g. "users", "customers", "patients"). Defaults to "users". */
  entityName?: string;
  /** LLM persona/company/domain context for dataset-aware prompts. */
  systemContext?: string;
  /** Domain-specific guidance for generated prompts and SQL. */
  domainHints?: string;
  suggestedPrompts?: string[];
  welcomeSubtitle?: string;
  reportMeta: {
    totalEvents: string;
    totalUsers: string;
    dateRangeLabel: string;
    dbName: string;
  };
  /** Curated events for the analytics explorer */
  events?: EventDefinition[];
}

/**
 * Static-dataset metadata for first-paint fallback. Only needs entries that
 * are likely active during the pre-/api/datasets window — dynamic datasets and
 * rarely-visited statics fall through to a synthesized fallback in DatasetProvider.
 */
export const DATASET_META: Record<string, DatasetMeta> = {
  presto: {
    id: "presto",
    label: "Presto",
    companyName: "Presto",
    currency: "$",
    entityName: "players",
    reportMeta: {
      totalEvents: "~2.5M impressions",
      totalUsers: "~300K players",
      dateRangeLabel: "Aug 2025–Feb 2026",
      dbName: "presto.duckdb",
    },
  },
  "vastu-hfc": {
    id: "vastu-hfc",
    label: "Housing Finance",
    companyName: "Vastu Housing Finance",
    currency: "₹",
    entityName: "borrowers",
    reportMeta: {
      totalEvents: "1.87L loans",
      totalUsers: "1.20L borrowers",
      dateRangeLabel: "Apr 2022 – Mar 2025 (FY23–FY25)",
      dbName: "vastu-hfc.duckdb",
    },
  },
  "hdfc-creditfraud": {
    id: "hdfc-creditfraud",
    label: "Credit Risk",
    companyName: "HDFC Bank",
    currency: "₹",
    entityName: "customers",
    reportMeta: {
      totalEvents: "19.3L transactions · 33K alerts",
      totalUsers: "5,000 customers · 4,000+ cards",
      dateRangeLabel: "Jun 2024 – May 2026",
      dbName: "hdfc-creditfraud.duckdb",
    },
  },
  "yesbank-cards": {
    id: "yesbank-cards",
    label: "Credit Cards",
    companyName: "YES Bank",
    currency: "₹",
    entityName: "customers",
    reportMeta: {
      totalEvents: "13.5L transactions · 53K campaign contacts",
      totalUsers: "4,000 customers · 4,000+ cards",
      dateRangeLabel: "Jun 2024 – May 2026",
      dbName: "yesbank-cards.duckdb",
    },
  },
  "flipkart-marketplace": {
    id: "flipkart-marketplace",
    label: "E-Commerce",
    companyName: "Flipkart",
    currency: "₹",
    entityName: "customers",
    reportMeta: {
      totalEvents: "109K orders · 184K items · 1.8M sessions",
      totalUsers: "60,000 buyers · 4,000 sellers",
      dateRangeLabel: "Jun 2024 – May 2026",
      dbName: "flipkart-marketplace.duckdb",
    },
  },
  "suvidha-capital": {
    id: "suvidha-capital",
    label: "Consumer Finance",
    companyName: "Suvidha Capital",
    currency: "₹",
    entityName: "borrowers",
    reportMeta: {
      totalEvents: "2.06L loans · 18.3L EMIs · 2.76L applications",
      totalUsers: "1.65L borrowers",
      dateRangeLabel: "Jun 2024 – May 2026",
      dbName: "suvidha-capital.duckdb",
    },
  },
  healthplus: {
    id: "healthplus",
    label: "E-Pharmacy & Health",
    companyName: "Health+",
    currency: "₹",
    entityName: "customers",
    reportMeta: {
      totalEvents: "2.61L orders · 6.91L items · 1.83L Rx checks",
      totalUsers: "38K customers · 38K lab bookings",
      dateRangeLabel: "Jun 2024 – May 2026",
      dbName: "healthplus.duckdb",
    },
  },
};
