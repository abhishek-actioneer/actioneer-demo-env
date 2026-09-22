import { isDBReady } from "@/lib/db";
import { getDataset } from "@/lib/datasets";
import { executeSQLInternal, executeSQLPrepared, validateSQL } from "@/lib/sql-executor";
import type { VoiceCampaign } from "@/lib/voice-campaign-types";
import {
  fundsIndiaInactiveBuyerTestContext,
  isFundsIndiaDormantPortfolioCampaign,
  type VoiceCustomerContext,
} from "@/lib/voice-customer-context";

const FUNDSINDIA_DATASET_ID = "fundsindia";
const FUNDSINDIA_AS_OF_DATE = "2026-05-28";
const MAX_CONTEXT_CALLS = 500;
const BOOTSTRAP_SEGMENT_SQL = /^select\s+1\s+as\s+investor_id\s*$/i;

export class VoiceCustomerContextError extends Error {
  readonly status = 503;

  constructor(message: string) {
    super(message);
    this.name = "VoiceCustomerContextError";
  }
}

export type SampleTestCustomerFailureReason =
  | "dataset_unavailable"
  | "invalid_segment_sql"
  | "segment_empty";

export class SampleTestCustomerError extends Error {
  readonly status: number;
  readonly reason: SampleTestCustomerFailureReason;

  constructor(
    message: string,
    reason: SampleTestCustomerFailureReason,
    status?: number,
  ) {
    super(message);
    this.name = "SampleTestCustomerError";
    this.reason = reason;
    this.status = status ?? (reason === "dataset_unavailable" ? 503 : reason === "invalid_segment_sql" ? 400 : 404);
  }
}

export function isSampleTestCustomerError(error: unknown): error is SampleTestCustomerError {
  return error instanceof SampleTestCustomerError;
}

export function isVoiceCustomerContextError(error: unknown): error is VoiceCustomerContextError {
  return error instanceof VoiceCustomerContextError;
}

export function voiceCustomerContextErrorResponse(error: unknown): Response | null {
  if (!isVoiceCustomerContextError(error)) return null;
  return Response.json({ error: error.message }, { status: error.status });
}

export function isManualBootstrapSegmentSql(segmentSql: string | undefined): boolean {
  const normalized = segmentSql?.trim().replace(/;+\s*$/, "") ?? "";
  return BOOTSTRAP_SEGMENT_SQL.test(normalized);
}

export interface PlannedVoiceCustomerCall {
  num: string;
  callConfigId: string;
  customerContext?: VoiceCustomerContext;
}

export async function buildPlannedVoiceCallsWithCustomerContext({
  campaign,
  phoneNumbers,
  callConfigIdForIndex,
  segmentSql,
}: {
  campaign: VoiceCampaign;
  phoneNumbers: string[];
  callConfigIdForIndex: (index: number) => string;
  segmentSql?: string;
}): Promise<PlannedVoiceCustomerCall[]> {
  const plannedCalls = phoneNumbers.map((num, index) => ({
    num,
    callConfigId: callConfigIdForIndex(index),
  }));

  if (campaign.datasetId !== FUNDSINDIA_DATASET_ID || plannedCalls.length === 0) {
    return plannedCalls;
  }

  if (isFundsIndiaDormantPortfolioCampaign(campaign)) {
    return plannedCalls.map((call) => ({
      ...call,
      customerContext: fundsIndiaInactiveBuyerTestContext(),
    }));
  }

  const requiresDataset = Boolean(segmentSql && !isManualBootstrapSegmentSql(segmentSql));
  if (requiresDataset) {
    const ready = await isDBReady(campaign.datasetId);
    if (!ready) {
      throw new VoiceCustomerContextError(
        `Dataset "${campaign.datasetId}" analytics store is not available. Mount dataset files under data/ before launching segment-backed campaigns.`,
      );
    }
  }

  try {
    const investorIds = await resolveFundsIndiaInvestorIds({
      datasetId: campaign.datasetId,
      segmentSql,
      limit: plannedCalls.length,
      strictSegmentSql: requiresDataset,
    });
    if (investorIds.length === 0) return plannedCalls;

    const contexts: VoiceCustomerContext[] = [];
    for (const investorId of investorIds) {
      const context = await buildFundsIndiaVoiceCustomerContext(campaign.datasetId, investorId);
      if (context) contexts.push(context);
    }

    return plannedCalls.map((call, index) => ({
      ...call,
      customerContext: contexts[index],
    }));
  } catch (err) {
    if (isVoiceCustomerContextError(err)) throw err;
    throw new VoiceCustomerContextError(
      `Failed to attach FundsIndia customer context: ${(err as Error).message}`,
    );
  }
}

async function resolveFundsIndiaInvestorIds({
  datasetId,
  segmentSql,
  limit,
  strictSegmentSql,
}: {
  datasetId: string;
  segmentSql?: string;
  limit: number;
  strictSegmentSql: boolean;
}): Promise<string[]> {
  const safeLimit = Math.max(0, Math.min(MAX_CONTEXT_CALLS, Math.floor(limit)));
  if (safeLimit === 0) return [];

  const selected = await investorIdsFromSegmentSql(datasetId, segmentSql, safeLimit, strictSegmentSql);
  if (selected.length >= safeLimit) return selected.slice(0, safeLimit);

  const fallback = await inactiveBuyerInvestorIds(
    datasetId,
    safeLimit - selected.length,
    selected,
    strictSegmentSql,
  );
  return [...selected, ...fallback].slice(0, safeLimit);
}

async function investorIdsFromSegmentSql(
  datasetId: string,
  segmentSql: string | undefined,
  limit: number,
  strict: boolean,
): Promise<string[]> {
  const sql = segmentSql?.trim().replace(/;+\s*$/, "");
  if (!sql) return [];

  const validation = validateSQL(sql);
  if (!validation.valid) {
    if (strict) {
      throw new VoiceCustomerContextError(`Invalid segment SQL for voice context: ${validation.error}`);
    }
    console.warn("[voice/campaigns] Skipping customer context segment SQL", {
      reason: validation.error,
    });
    return [];
  }

  const result = await executeSQLInternal(
    `WITH __segment AS (${sql})
     SELECT DISTINCT CAST(investor_id AS VARCHAR) AS investor_id
     FROM __segment
     WHERE investor_id IS NOT NULL
     LIMIT ${limit}`,
    datasetId,
  );
  if (result.error) {
    if (strict) {
      throw new VoiceCustomerContextError(
        `Could not load investor context from segment SQL: ${result.error}`,
      );
    }
    console.warn("[voice/campaigns] Could not read investor_id from segment for voice context", {
      error: result.error,
    });
    return [];
  }

  return result.rows
    .map((row) => text(row, "investor_id"))
    .filter((item): item is string => Boolean(item));
}

async function inactiveBuyerInvestorIds(
  datasetId: string,
  limit: number,
  excludedInvestorIds: string[],
  strict: boolean,
): Promise<string[]> {
  if (limit <= 0) return [];
  const excludedClause = excludedInvestorIds.length > 0
    ? `AND ips.investor_id NOT IN (${excludedInvestorIds.map(() => "?").join(", ")})`
    : "";
  const result = await executeSQLPrepared(
    `WITH last_events AS (
       SELECT
         investor_id,
         MAX(CAST(event_timestamp AS DATE)) AS last_event_date
       FROM user_events_full
       WHERE investor_id IS NOT NULL
         AND event_timestamp <= DATE '${FUNDSINDIA_AS_OF_DATE}'
       GROUP BY investor_id
     )
     SELECT
       ips.investor_id,
       date_diff('day', COALESCE(le.last_event_date, ips.last_activity_date), DATE '${FUNDSINDIA_AS_OF_DATE}') AS days_inactive
     FROM investor_portfolio_summary ips
     LEFT JOIN last_events le ON le.investor_id = ips.investor_id
     WHERE ips.purchase_count > 0
       AND ips.has_current_holding = true
       AND COALESCE(le.last_event_date, ips.last_activity_date) IS NOT NULL
       AND COALESCE(le.last_event_date, ips.last_activity_date) <= DATE '${FUNDSINDIA_AS_OF_DATE}' - INTERVAL 50 DAY
       ${excludedClause}
     ORDER BY days_inactive ASC, ips.net_invested_inr DESC NULLS LAST
     LIMIT ${limit}`,
    excludedInvestorIds,
    datasetId,
  );
  if (result.error) {
    if (strict) {
      throw new VoiceCustomerContextError(
        `Could not sample inactive FundsIndia buyers for voice context: ${result.error}`,
      );
    }
    console.warn("[voice/campaigns] Could not sample inactive FundsIndia buyers for voice context", {
      error: result.error,
    });
    return [];
  }
  return result.rows
    .map((row) => text(row, "investor_id"))
    .filter((item): item is string => Boolean(item));
}

export async function buildFundsIndiaVoiceCustomerContext(
  datasetId: string,
  investorId: string,
): Promise<VoiceCustomerContext | undefined> {
  const profileResult = await executeSQLPrepared(
    `SELECT
       i.investor_id,
       i.name,
       i.gender,
       i.city,
       i.state,
       i.city_tier,
       i.investor_type,
       i.kyc_status,
       i.bank_verified_date,
       i.account_activated_date,
       i.first_investment_date,
       i.demat_opened_date,
       i.is_active,
       ips.first_purchase_date,
       ips.last_purchase_date,
       ips.last_activity_date AS last_portfolio_activity_date,
       ips.current_fund_count,
       ips.current_category_count,
       ips.dominant_current_category,
       ips.portfolio_status,
       ips.portfolio_value_bucket,
       ips.net_invested_inr,
       ips.has_elss_holding,
       ips.has_sip_linked_holding
     FROM raw_investors i
     LEFT JOIN investor_portfolio_summary ips ON ips.investor_id = i.investor_id
     WHERE i.investor_id = ?
     LIMIT 1`,
    [investorId],
    datasetId,
  );
  if (profileResult.error) {
    console.warn("[voice/campaigns] Could not load FundsIndia customer profile", {
      investorId,
      error: profileResult.error,
    });
    return undefined;
  }
  const profile = profileResult.rows[0];
  if (!profile) return undefined;

  const [lastActivityResult, holdingsResult, purchasesResult, eventsResult] = await Promise.all([
    executeSQLPrepared(
      `SELECT
         CAST(MAX(event_timestamp) AS DATE) AS last_event_date,
         date_diff('day', CAST(MAX(event_timestamp) AS DATE), DATE '${FUNDSINDIA_AS_OF_DATE}') AS days_since_last_event
       FROM user_events_full
       WHERE investor_id = ?
         AND event_timestamp <= DATE '${FUNDSINDIA_AS_OF_DATE}'`,
      [investorId],
      datasetId,
    ),
    executeSQLPrepared(
      `SELECT
         p.fund_name,
         p.fund_category,
         p.fund_subcategory,
         p.net_invested_inr,
         p.is_sip_linked,
         p.is_fi_select,
         p.position_size_bucket,
         rf.return_1y,
         rf.return_3y
       FROM investor_fund_positions p
       LEFT JOIN raw_funds rf ON rf.fund_id = p.fund_id
       WHERE p.investor_id = ?
         AND p.is_current_holding = true
       ORDER BY p.net_invested_inr DESC NULLS LAST, p.last_purchase_date DESC NULLS LAST
       LIMIT 3`,
      [investorId],
      datasetId,
    ),
    executeSQLPrepared(
      `SELECT
         fund_name,
         fund_category,
         activity_type,
         activity_date
       FROM investor_investment_history
       WHERE investor_id = ?
         AND status = 'success'
         AND activity_type IN ('sip_installment', 'lumpsum', 'stp_purchase')
       ORDER BY activity_date DESC NULLS LAST
       LIMIT 3`,
      [investorId],
      datasetId,
    ),
    executeSQLPrepared(
      `SELECT
         event_name,
         CAST(event_timestamp AS DATE) AS event_date
       FROM user_events_full
       WHERE investor_id = ?
         AND event_timestamp <= DATE '${FUNDSINDIA_AS_OF_DATE}'
       ORDER BY event_timestamp DESC
       LIMIT 4`,
      [investorId],
      datasetId,
    ),
  ]);

  const lastActivity = lastActivityResult.rows[0];
  const lastActivityDate =
    text(lastActivity, "last_event_date") ||
    text(profile, "last_portfolio_activity_date") ||
    text(profile, "last_purchase_date");
  const daysSinceLastActivity =
    numberValue(lastActivity, "days_since_last_event") ??
    daysBetween(lastActivityDate, FUNDSINDIA_AS_OF_DATE);
  const boughtFunds = dedupe([
    ...holdingsResult.rows.map((row) => text(row, "fund_name")),
    ...purchasesResult.rows.map((row) => text(row, "fund_name")),
  ]).slice(0, 3);
  const recentActivity = eventsResult.rows
    .map((row) => activityLine(text(row, "event_name"), text(row, "event_date")))
    .filter((item): item is string => Boolean(item));
  const firstName = firstNameFrom(text(profile, "name"));
  const city = text(profile, "city");
  const state = text(profile, "state");
  const dominantCategory = humanizeToken(text(profile, "dominant_current_category"));
  const hasSipLinkedHolding = boolValue(profile, "has_sip_linked_holding");
  const hasElssHolding = boolValue(profile, "has_elss_holding");
  const fundReturnSnapshot = holdingsResult.rows
    .map((row) => fundSnapshotLine(row))
    .filter((item): item is string => Boolean(item));

  return {
    source: "fundsindia",
    datasetId,
    investorId,
    firstName,
    displayName: text(profile, "name"),
    gender: normalizeGender(text(profile, "gender")),
    profile: {
      city,
      state,
      cityTier: text(profile, "city_tier"),
      investorType: text(profile, "investor_type"),
      accountStage: accountStage(profile),
    },
    inactivity: {
      daysSinceLastActivity,
      lastActivityDate,
      reason: inactivityReason(daysSinceLastActivity),
    },
    investmentSummary: {
      boughtFunds,
      currentFundCount: numberValue(profile, "current_fund_count"),
      dominantCategory,
      portfolioStatus: humanizeToken(text(profile, "portfolio_status")),
      portfolioValueBucket: text(profile, "portfolio_value_bucket"),
      netInvestedInr: formatInr(numberValue(profile, "net_invested_inr")),
      returnAsOfDate: FUNDSINDIA_AS_OF_DATE,
      fundReturnSnapshot,
      hasElssHolding,
      hasSipLinkedHolding,
    },
    currentSituation: {
      kycStatus: text(profile, "kyc_status"),
      bankLinkStatus: text(profile, "bank_verified_date") ? "verified" : "not verified",
      mfAccountActive: boolValue(profile, "is_active"),
      dematAccountActive: Boolean(text(profile, "demat_opened_date")),
      firstInvestmentDate: text(profile, "first_investment_date"),
    },
    recentActivity,
    conversationHooks: conversationHooks({
      firstName,
      daysSinceLastActivity,
      dominantCategory,
      hasSipLinkedHolding,
      hasElssHolding,
      boughtFunds,
    }),
    doNotSay: [
      "Do not mention income band, internal risk-profile label, PEP/tax flags, propensity, segment name, SQL, or internal IDs.",
      "Do not say you are calling because an algorithm marked them inactive.",
      "Do not make personalized fund recommendations or promise returns.",
    ],
  };
}

export interface SampledTestCustomer {
  context: VoiceCustomerContext;
  /** Key-value pairs for the modal display (label → value) */
  displayFields: Array<{ label: string; value: string }>;
}

/** Column names that typically hold a person's display name */
const NAME_COLS = ["name", "full_name", "customer_name", "investor_name", "user_name", "display_name", "borrower_name", "policyholder_name"];
/** Column names that typically hold gender */
const GENDER_COLS = ["gender", "sex", "borrower_gender", "customer_gender", "user_gender"];
/** Columns to skip in the generic display (IDs, internal keys) */
const SKIP_COLS_RE = /(_id|_key|_hash|_token|sql|password|secret)$/i;
/** Valid SQL identifier — entityTable/userIdField come from dataset config, but guard anyway */
const SQL_IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Sample one random customer from the segment SQL and build a VoiceCustomerContext
 * suitable for injecting into a test call.
 *
 * For FundsIndia: uses the full enrichment flow (4-table join).
 * For other datasets: samples one row from the segment SQL, then enriches it with the
 * full per-entity row from the dataset's entity table (segments often select only the
 * entity id). Without a segment, samples a random row straight from the entity table.
 */
export async function sampleTestCustomer(
  datasetId: string,
  segmentSql: string | undefined,
  userIdField?: string,
  entityTable?: string,
): Promise<SampledTestCustomer | undefined> {
  if (datasetId === FUNDSINDIA_DATASET_ID) {
    return sampleFundsIndiaTestCustomer(datasetId, segmentSql);
  }
  return sampleGenericTestCustomer(datasetId, segmentSql, userIdField, entityTable);
}

async function sampleFundsIndiaTestCustomer(
  datasetId: string,
  segmentSql: string | undefined,
): Promise<SampledTestCustomer | undefined> {
  const ready = await isDBReady(datasetId);
  if (!ready) {
    throw new SampleTestCustomerError(
      `Dataset "${datasetId}" is not available. Run setup or check that ${getDataset(datasetId).dbFile} exists.`,
      "dataset_unavailable",
    );
  }

  const sql = segmentSql?.trim().replace(/;+\s*$/, "");
  let investorId: string | undefined;

  if (sql && !isManualBootstrapSegmentSql(sql)) {
    const validation = validateSQL(sql);
    if (validation.valid) {
      const result = await executeSQLInternal(
        `WITH __segment AS (${sql})
         SELECT DISTINCT CAST(investor_id AS VARCHAR) AS investor_id
         FROM __segment
         WHERE investor_id IS NOT NULL
         ORDER BY random()
         LIMIT 1`,
        datasetId,
      );
      investorId = result.rows[0] ? text(result.rows[0], "investor_id") : undefined;
    }
  }

  if (!investorId) {
    // Fall back to a random inactive buyer
    const fallback = await inactiveBuyerInvestorIds(datasetId, 1, [], false);
    investorId = fallback[0];
  }

  if (!investorId) {
    throw new SampleTestCustomerError(
      "No customers found in this segment. Try a different segment or check dataset setup.",
      "segment_empty",
    );
  }

  const context = await buildFundsIndiaVoiceCustomerContext(datasetId, investorId);
  if (!context) {
    throw new SampleTestCustomerError(
      "Could not build customer profile from sampled investor.",
      "segment_empty",
    );
  }

  const displayFields: Array<{ label: string; value: string }> = [];
  if (context.displayName) displayFields.push({ label: "Name", value: context.displayName });
  if (context.gender) displayFields.push({ label: "Gender", value: context.gender });
  if (context.profile?.city) displayFields.push({ label: "City", value: [context.profile.city, context.profile.state].filter(Boolean).join(", ") });
  if (context.profile?.accountStage) displayFields.push({ label: "Stage", value: context.profile.accountStage });
  if (context.investmentSummary?.netInvestedInr) displayFields.push({ label: "Net invested", value: context.investmentSummary.netInvestedInr });
  if (context.investmentSummary?.currentFundCount) displayFields.push({ label: "Funds held", value: String(context.investmentSummary.currentFundCount) });
  if (context.inactivity?.daysSinceLastActivity !== undefined) displayFields.push({ label: "Days inactive", value: String(context.inactivity.daysSinceLastActivity) });

  return { context, displayFields };
}

async function sampleRandomEntityRow(
  datasetId: string,
  entityTable: string,
): Promise<Record<string, unknown> | undefined> {
  const sampledEntity = await executeSQLInternal(
    `SELECT * FROM ${entityTable} ORDER BY random() LIMIT 1`,
    datasetId,
  );
  if (sampledEntity.error) {
    console.warn("[voice/sample-customer] Could not sample random entity row", {
      datasetId,
      entityTable,
      error: sampledEntity.error,
    });
    return undefined;
  }
  return sampledEntity.rows[0];
}

async function sampleGenericTestCustomer(
  datasetId: string,
  segmentSql: string | undefined,
  userIdField?: string,
  entityTable?: string,
): Promise<SampledTestCustomer | undefined> {
  const ready = await isDBReady(datasetId);
  if (!ready) {
    const dbFile = (() => {
      try {
        return getDataset(datasetId).dbFile;
      } catch {
        return "data/<dataset>.duckdb";
      }
    })();
    throw new SampleTestCustomerError(
      `Dataset "${datasetId}" is not available. Ensure ${dbFile} exists and the dev server can open it.`,
      "dataset_unavailable",
    );
  }

  const rawSql = segmentSql?.trim().replace(/;+\s*$/, "");
  const sql = rawSql && !isManualBootstrapSegmentSql(rawSql) ? rawSql : undefined;
  const safeEntityTable = entityTable && SQL_IDENT_RE.test(entityTable) ? entityTable : undefined;
  const safeUserIdField = userIdField && SQL_IDENT_RE.test(userIdField) ? userIdField : undefined;

  let segmentRow: Record<string, unknown> | undefined;
  if (sql) {
    const validation = validateSQL(sql);
    if (!validation.valid) {
      throw new SampleTestCustomerError(
        `Segment SQL is invalid: ${validation.error}`,
        "invalid_segment_sql",
      );
    }
    const result = await executeSQLInternal(
      `WITH __segment AS (${sql})
       SELECT * FROM __segment
       ORDER BY random()
       LIMIT 1`,
      datasetId,
    );
    if (result.error) {
      throw new SampleTestCustomerError(
        `Could not run segment SQL: ${result.error}`,
        "invalid_segment_sql",
      );
    }
    segmentRow = result.rows[0];
    if (!segmentRow) {
      throw new SampleTestCustomerError(
        "No customers found in this segment. Try a different segment or re-roll after fixing the SQL.",
        "segment_empty",
      );
    }
  }

  // Segments often select only the entity id — enrich with the full per-entity
  // profile row so the context carries name/gender/attributes on any dataset.
  let entityRow: Record<string, unknown> | undefined;
  if (safeEntityTable && safeUserIdField) {
    const entityId = segmentRow ? text(segmentRow, safeUserIdField) : undefined;
    if (segmentRow && entityId) {
      const enriched = await executeSQLPrepared(
        `SELECT * FROM ${safeEntityTable} WHERE CAST(${safeUserIdField} AS VARCHAR) = ? LIMIT 1`,
        [entityId],
        datasetId,
      );
      entityRow = enriched.rows[0];
    } else if (!segmentRow) {
      // No segment selected — random user context from the entity table
      entityRow = await sampleRandomEntityRow(datasetId, safeEntityTable);
    }
  }

  const row: Record<string, unknown> | undefined =
    entityRow && segmentRow ? { ...entityRow, ...segmentRow } : (segmentRow ?? entityRow);
  if (!row) {
    if (safeEntityTable) {
      throw new SampleTestCustomerError(
        `No rows found in ${safeEntityTable} for dataset "${datasetId}".`,
        "segment_empty",
      );
    }
    throw new SampleTestCustomerError(
      "No customers found for this dataset. Select a segment with at least one customer.",
      "segment_empty",
    );
  }

  // Detect name and gender by convention
  const nameKey = NAME_COLS.find((k) => k in row);
  const genderKey = GENDER_COLS.find((k) => k in row);
  const rawName = nameKey ? text(row, nameKey) : undefined;
  const rawGender = genderKey ? text(row, genderKey) : undefined;

  const normalizedGender = (() => {
    const g = rawGender?.toLowerCase().trim();
    if (g === "male" || g === "m") return "male" as const;
    if (g === "female" || g === "f") return "female" as const;
    return undefined;
  })();

  // Build display fields from remaining columns (skip IDs and skipped cols)
  const displayFields: Array<{ label: string; value: string }> = [];
  const rawFields: Record<string, string> = {};

  for (const [key, val] of Object.entries(row)) {
    if (val === null || val === undefined || val === "") continue;
    const strVal = String(val).trim();
    if (!strVal) continue;
    rawFields[key] = strVal;

    if (SKIP_COLS_RE.test(key)) continue;
    // Skip the name/gender keys since we show them prominently
    if (key === nameKey || key === genderKey) continue;
    displayFields.push({
      label: key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      value: strVal.length > 60 ? strVal.slice(0, 60) + "…" : strVal,
    });
  }

  const userId = userIdField ? text(row, userIdField) : undefined;
  const firstName = rawName?.split(/\s+/)[0];

  const context: VoiceCustomerContext = {
    source: "generic",
    datasetId,
    investorId: userId,
    firstName,
    displayName: rawName,
    gender: normalizedGender,
    rawFields,
    conversationHooks: rawName ? [`The customer's name is ${rawName}. Use it naturally after permission.`] : [],
    doNotSay: [
      "Do not mention internal IDs, segment SQL, propensity scores, or backend field names.",
    ],
  };

  if (rawName) displayFields.unshift({ label: "Name", value: rawName });
  if (normalizedGender) displayFields.unshift({ label: "Gender", value: normalizedGender });

  return { context, displayFields };
}

/** Column names that may hold a phone number, for inbound caller lookup. */
const PHONE_COL_RE = /phone|mobile|msisdn|whatsapp/i;
const MIN_PHONE_MATCH_DIGITS = 7;

/**
 * Identify an inbound caller by phone number against the dataset's entity
 * table, so their voice biomarker enrolls/matches under their own customer
 * identity instead of a phone-derived or tenant-derived key.
 *
 * Matching is a last-10-digit suffix comparison (country-code agnostic) over
 * every phone-like column of the entity table. Exactly one matching row is
 * required — zero or multiple matches return null so an ambiguous number is
 * never attributed to the wrong customer. Datasets without an entity table (or
 * whose DB is not mounted) return null. Never throws: inbound call answering
 * must not depend on this lookup.
 */
export async function lookupVoiceCustomerByPhone(
  datasetId: string,
  phone: string,
): Promise<VoiceCustomerContext | null> {
  try {
    const digits = phone.replace(/\D/g, "");
    const suffix = digits.slice(-10);
    if (suffix.length < MIN_PHONE_MATCH_DIGITS) return null;

    let entityTable: string | undefined;
    let userIdField: string | undefined;
    try {
      const config = getDataset(datasetId);
      entityTable = config.entityTable;
      userIdField = config.userIdField;
    } catch {
      return null;
    }
    if (!entityTable || !SQL_IDENT_RE.test(entityTable)) return null;
    if (!userIdField || !SQL_IDENT_RE.test(userIdField)) return null;
    if (!(await isDBReady(datasetId))) return null;

    const columnsResult = await executeSQLPrepared(
      `SELECT column_name FROM information_schema.columns WHERE lower(table_name) = lower(?)`,
      [entityTable],
      datasetId,
    );
    if (columnsResult.error) return null;
    const phoneColumns = columnsResult.rows
      .map((row) => text(row, "column_name"))
      .filter((col): col is string => Boolean(col && SQL_IDENT_RE.test(col) && PHONE_COL_RE.test(col)));
    if (phoneColumns.length === 0) return null;

    const predicate = phoneColumns
      .map((col) => `regexp_replace(CAST(${col} AS VARCHAR), '[^0-9]', '', 'g') LIKE ?`)
      .join(" OR ");
    const result = await executeSQLPrepared(
      `SELECT * FROM ${entityTable} WHERE ${predicate} LIMIT 2`,
      phoneColumns.map(() => `%${suffix}`),
      datasetId,
    );
    if (result.error || result.rows.length !== 1) {
      if (result.rows?.length > 1) {
        console.warn("[voice/inbound-caller-lookup] phone matches multiple customers; skipping identity", {
          datasetId,
          suffix,
        });
      }
      return null;
    }

    const row = result.rows[0];
    const customerId = text(row, userIdField);
    if (!customerId) return null;

    const nameKey = NAME_COLS.find((k) => k in row);
    const genderKey = GENDER_COLS.find((k) => k in row);
    const rawName = nameKey ? text(row, nameKey) : undefined;
    const gender = normalizeGender(genderKey ? text(row, genderKey) : undefined);

    // Identity-only context: consumed by voice forensics (biomarker key, display
    // name, expected gender). Deliberately no rawFields — inbound prompts are
    // already built before this context is attached and must not change.
    return {
      source: "generic",
      datasetId,
      investorId: customerId,
      firstName: rawName?.split(/\s+/)[0],
      displayName: rawName,
      gender: gender === "unknown" ? undefined : gender,
    };
  } catch (err) {
    console.warn("[voice/inbound-caller-lookup] lookup failed", {
      datasetId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function text(row: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = row?.[key];
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  return trimmed || undefined;
}

function numberValue(row: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = row?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function boolValue(row: Record<string, unknown> | undefined, key: string): boolean | undefined {
  const value = row?.[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return undefined;
}

function normalizeGender(value: string | undefined): "male" | "female" | "unknown" | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "male" || normalized === "m") return "male";
  if (normalized === "female" || normalized === "f") return "female";
  return "unknown";
}

function formatInr(value: number | undefined): string | undefined {
  if (value === undefined) return undefined;
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

function formatPct(value: number | undefined): string | undefined {
  if (value === undefined) return undefined;
  return `${Math.round(value * 10) / 10}%`;
}

function fundSnapshotLine(row: Record<string, unknown>): string | undefined {
  const fundName = text(row, "fund_name");
  if (!fundName) return undefined;
  const details = [
    formatInr(numberValue(row, "net_invested_inr")) ? `net invested ${formatInr(numberValue(row, "net_invested_inr"))}` : undefined,
    formatPct(numberValue(row, "return_1y")) ? `fund 1Y return ${formatPct(numberValue(row, "return_1y"))}` : undefined,
    formatPct(numberValue(row, "return_3y")) ? `fund 3Y return ${formatPct(numberValue(row, "return_3y"))}` : undefined,
    boolValue(row, "is_sip_linked") ? "SIP linked" : undefined,
  ].filter(Boolean);
  return details.length ? `${fundName}: ${details.join(", ")}` : fundName;
}

function firstNameFrom(name: string | undefined): string | undefined {
  return name?.split(/\s+/)[0]?.trim() || undefined;
}

function humanizeToken(value: string | undefined): string | undefined {
  return value?.replace(/_/g, " ").trim() || undefined;
}

function dedupe(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed.toLowerCase())) continue;
    seen.add(trimmed.toLowerCase());
    out.push(trimmed);
  }
  return out;
}

function daysBetween(start: string | undefined, end: string): number | undefined {
  const startDate = parseIsoDate(start);
  const endDate = parseIsoDate(end);
  if (!startDate || !endDate) return undefined;
  return Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000));
}

function parseIsoDate(value: string | undefined): Date | undefined {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return undefined;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function activityLine(eventName: string | undefined, eventDate: string | undefined): string | undefined {
  if (!eventName) return undefined;
  const readable = humanizeEventName(eventName);
  return eventDate ? `${readable} on ${eventDate}` : readable;
}

function humanizeEventName(eventName: string): string {
  const labels: Record<string, string> = {
    dashboard_visited: "dashboard visited",
    portfolio_visited: "portfolio visited",
    fund_searched: "fund searched",
    fund_page_viewed: "fund page viewed",
    fund_watchlisted: "fund watchlisted",
    sip_flow_started: "SIP flow started",
    sip_amount_entered: "SIP amount entered",
    sip_flow_abandoned: "SIP flow abandoned",
    goal_created: "goal created",
    redemption_initiated: "redemption initiated",
  };
  return labels[eventName] || eventName.replace(/_/g, " ");
}

function accountStage(row: Record<string, unknown>): string {
  if (text(row, "first_investment_date")) return "activated mutual fund investor";
  if (text(row, "account_activated_date")) return "account activated, no first investment";
  if (text(row, "bank_verified_date")) return "bank verified, activation pending";
  const kycStatus = text(row, "kyc_status");
  return kycStatus ? `KYC ${humanizeToken(kycStatus)}` : "signup profile";
}

function inactivityReason(days: number | undefined): string {
  if (days === undefined) {
    return "Bought mutual funds earlier, but recent platform activity is not visible.";
  }
  return `Bought mutual funds earlier, but has not shown platform activity for ${days} days.`;
}

function conversationHooks({
  firstName,
  daysSinceLastActivity,
  dominantCategory,
  hasSipLinkedHolding,
  hasElssHolding,
  boughtFunds,
}: {
  firstName?: string;
  daysSinceLastActivity?: number;
  dominantCategory?: string;
  hasSipLinkedHolding?: boolean;
  hasElssHolding?: boolean;
  boughtFunds: string[];
}): string[] {
  const hooks: string[] = [];
  const namePrefix = firstName ? `${firstName} had` : "The customer had";
  if (daysSinceLastActivity !== undefined) {
    hooks.push(`${namePrefix} invested earlier and has had no recent platform activity for ${daysSinceLastActivity} days.`);
  } else {
    hooks.push(`${namePrefix} invested earlier but has not been visibly active recently.`);
  }
  if (boughtFunds.length > 0) {
    hooks.push("If the customer asks what they bought or hold, name up to three funds from the snapshot before suggesting any callback.");
  }
  if (dominantCategory) {
    hooks.push(`Their portfolio context is mainly ${dominantCategory}; use this only for a review-oriented question.`);
  }
  if (hasSipLinkedHolding) {
    hooks.push("Ask whether their SIP plan is still comfortable before offering a review or advisor follow-up.");
  } else if (hasElssHolding) {
    hooks.push("Ask whether they want a quick portfolio or tax-saving fund review.");
  } else {
    hooks.push("Ask what stopped them from checking or continuing their investments recently.");
  }
  return hooks;
}
