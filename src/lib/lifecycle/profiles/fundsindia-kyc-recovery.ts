import "server-only";

import { executeSQLInternal } from "@/lib/sql-executor";
import { DEFAULT_GEMINI_VOICE, geminiVoiceDisplayName } from "@/lib/gemini-voices";
import {
  FUNDSINDIA_KYC_RECOVERY_PROFILE_ID,
  PROFILE_ONLY_SEGMENT_ID,
  type ContactPolicy,
  type ExperimentArm,
  type OecMetric,
} from "@/lib/lifecycle-campaign-types";

const INTENT_EVENTS = [
  "fund_searched",
  "fund_page_viewed",
  "fund_watchlisted",
  "sip_flow_started",
  "sip_amount_entered",
  "sip_flow_abandoned",
];

export const FUNDSINDIA_CAMPAIGN_AS_OF_DATE = "2026-05-28";

export const FUNDSINDIA_KYC_RECOVERY_CONTACT_POLICY: ContactPolicy = {
  maxCallsPerInvestor: 1,
  retriesEnabled: false,
  quietHours: {
    start: "10:00",
    end: "18:30",
    timezone: "Asia/Kolkata",
  },
  suppressWrongNumber: true,
  suppressOptOut: true,
  suppressComplaint: true,
  maxCallDurationSeconds: 240,
};

export const FUNDSINDIA_KYC_RECOVERY_GUARDRAILS = [
  "wrong_number",
  "complaint",
  "conduct_flag",
  "opted_out",
];

export function defaultFundsIndiaKycRecoveryArms(experimentId: string): ExperimentArm[] {
  const voiceConfig = {
    provider: "plivo-gemini" as const,
    voice: DEFAULT_GEMINI_VOICE,
    voiceName: geminiVoiceDisplayName(DEFAULT_GEMINI_VOICE),
    language: "English",
  };

  return [
    {
      id: `${experimentId}_control`,
      experimentId,
      type: "control",
      name: "Control",
      allocationPct: 20,
      scriptVariantId: "control",
    },
    {
      id: `${experimentId}_script_a`,
      experimentId,
      type: "treatment",
      name: "Script A",
      allocationPct: 40,
      scriptVariantId: "script_a",
      voiceConfig,
      metadata: {
        scriptSummary: "KYC unblock help with a calm service-led pitch.",
        firstMessage: "Hi, this is Aanya calling from FundsIndia. Am I speaking with you for a quick account activation help call?",
        systemPrompt: fundsIndiaKycRecoverySystemPrompt("A"),
      },
    },
    {
      id: `${experimentId}_script_b`,
      experimentId,
      type: "treatment",
      name: "Script B",
      allocationPct: 40,
      scriptVariantId: "script_b",
      voiceConfig,
      metadata: {
        scriptSummary: "SIP intent recovery with a short advisory follow-up offer.",
        firstMessage: "Hi, this is Aanya from FundsIndia. I noticed you had started exploring mutual funds; may I help with the next activation step?",
        systemPrompt: fundsIndiaKycRecoverySystemPrompt("B"),
      },
    },
  ];
}

export function fundsIndiaKycRecoverySystemPrompt(variant: "A" | "B"): string {
  const variantGuidance = variant === "A"
    ? "Lead with help completing KYC/account activation. Keep the offer framed as service assistance, not investment advice."
    : "Lead with the investor's recent SIP/fund exploration and offer a callback to unblock activation before they invest.";

  return `You are a FundsIndia service caller helping investors who showed fund or SIP intent but did not complete KYC/account activation.

Objective:
- Confirm whether the investor wants help completing account activation.
- If receptive, pitch the assigned FundsIndia activation assistance offer.
- Capture whether they accept, reject, need time, say wrong number, or raise a conduct concern.

Variant guidance:
- ${variantGuidance}

Hard rules:
- Do not promise returns or give personalized investment advice.
- Do not recommend a specific fund unless the customer asks what they were viewing; even then, describe context only.
- Do not mention internal IDs, segment names, model scores, or experiment assignment.
- Stop politely if the customer opts out, says wrong number, complains, or sounds distressed.
- Keep the call concise and ask permission before continuing.`;
}

export function lifecycleProfileLabel(profileId: string): string {
  if (profileId === FUNDSINDIA_KYC_RECOVERY_PROFILE_ID) return "FundsIndia KYC recovery";
  return profileId;
}

export function lifecycleSegmentLabel(segmentId: string, fallback?: string): string {
  if (segmentId === PROFILE_ONLY_SEGMENT_ID) return "Profile eligibility";
  return fallback || segmentId;
}

function quoteIdent(col: string): string {
  return `"${col.replace(/"/g, '""')}"`;
}

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

function assertIsoDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid date: ${value}`);
  }
  return value;
}

function cleanSegmentSql(segmentSql: string | undefined): string | undefined {
  const cleaned = segmentSql?.trim().replace(/;+\s*$/, "");
  return cleaned || undefined;
}

export async function resolveFundsIndiaSegmentColumn(
  datasetId: string,
  segmentSql: string | undefined,
): Promise<"investor_id" | "user_id" | undefined> {
  const sql = cleanSegmentSql(segmentSql);
  if (!sql) return undefined;

  const result = await executeSQLInternal(`SELECT * FROM (${sql}) __segment LIMIT 0`, datasetId);
  if (result.error) {
    throw new Error(`Segment SQL cannot be used for lifecycle enrollment: ${result.error}`);
  }
  if (result.columns.includes("investor_id")) return "investor_id";
  if (result.columns.includes("user_id")) return "user_id";
  throw new Error("Segment SQL must return investor_id or user_id for FundsIndia lifecycle enrollment.");
}

function profileEligibleSql(asOfDate: string): string {
  const date = assertIsoDate(asOfDate);
  const intentList = INTENT_EVENTS.map((event) => `'${event}'`).join(", ");

  return `
    WITH ranked_intent AS (
      SELECT
        ue.investor_id,
        ue.event_name,
        ue.event_timestamp,
        ue.fund_id,
        ue.fund_category,
        ue.amc_name,
        ROW_NUMBER() OVER (PARTITION BY ue.investor_id ORDER BY ue.event_timestamp DESC) AS rn
      FROM user_events_full ue
      WHERE ue.investor_id IS NOT NULL
        AND ue.event_name IN (${intentList})
        AND CAST(ue.event_timestamp AS DATE) <= DATE '${date}'
        AND CAST(ue.event_timestamp AS DATE) >= DATE '${date}' - INTERVAL 45 DAY
    ),
    intent_summary AS (
      SELECT
        investor_id,
        COUNT(*) AS intent_events,
        MAX(CAST(event_timestamp AS TIMESTAMP)) AS last_intent_at
      FROM ranked_intent
      GROUP BY investor_id
    ),
    latest_intent AS (
      SELECT
        investor_id,
        event_name AS last_intent_event,
        fund_id,
        fund_category,
        amc_name
      FROM ranked_intent
      WHERE rn = 1
    )
    SELECT
      CAST(i.investor_id AS VARCHAR) AS investor_id,
      i.name,
      i.city,
      i.state,
      i.city_tier,
      i.investor_type,
      i.acquisition_channel,
      i.kyc_status,
      CAST(i.bank_verified_date AS VARCHAR) AS bank_verified_date,
      CAST(i.account_activated_date AS VARCHAR) AS account_activated_date,
      CAST(intent_summary.last_intent_at AS VARCHAR) AS last_intent_at,
      latest_intent.last_intent_event,
      intent_summary.intent_events,
      latest_intent.fund_id AS target_fund_id,
      COALESCE(f.fund_name, latest_intent.fund_category) AS target_fund_name,
      COALESCE(f.amc_name, latest_intent.amc_name) AS target_amc_name
    FROM raw_investors i
    JOIN intent_summary ON intent_summary.investor_id = i.investor_id
    LEFT JOIN latest_intent ON latest_intent.investor_id = i.investor_id
    LEFT JOIN raw_funds f ON f.fund_id = latest_intent.fund_id
    WHERE (i.account_activated_date IS NULL OR CAST(i.account_activated_date AS DATE) > DATE '${date}')
      AND (
        COALESCE(i.kyc_status, 'pending') <> 'verified'
        OR i.bank_verified_date IS NULL
        OR CAST(i.bank_verified_date AS DATE) > DATE '${date}'
      )
  `;
}

function eligibilitySql({
  segmentSql,
  segmentColumn,
  asOfDate,
}: {
  segmentSql?: string;
  segmentColumn?: "investor_id" | "user_id";
  asOfDate: string;
}): string {
  const profile = profileEligibleSql(asOfDate);
  const cleanSql = cleanSegmentSql(segmentSql);
  if (!cleanSql || !segmentColumn) return profile;

  return `
    WITH profile_eligible AS (${profile}),
    segment_ids AS (
      SELECT DISTINCT CAST(${quoteIdent(segmentColumn)} AS VARCHAR) AS investor_id
      FROM (${cleanSql}) __segment
      WHERE ${quoteIdent(segmentColumn)} IS NOT NULL
    )
    SELECT pe.*
    FROM profile_eligible pe
    JOIN segment_ids si ON si.investor_id = pe.investor_id
  `;
}

function readText(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key];
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim();
  return text || undefined;
}

function readNumber(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

export interface FundsIndiaEligibleInvestor {
  investorId: string;
  name?: string;
  city?: string;
  state?: string;
  kycStatus?: string;
  bankVerifiedDate?: string;
  accountActivatedDate?: string;
  lastIntentAt?: string;
  lastIntentEvent?: string;
  intentEvents: number;
  targetFundId?: string;
  targetFundName?: string;
  targetAmcName?: string;
}

export interface FundsIndiaEligibilityResult {
  eligibleCount: number;
  rows: FundsIndiaEligibleInvestor[];
  segmentColumn?: "investor_id" | "user_id";
}

export async function evaluateFundsIndiaKycRecoveryEligibility({
  datasetId,
  segmentSql,
  asOfDate,
  limit = 500,
}: {
  datasetId: string;
  segmentSql?: string;
  asOfDate: string;
  limit?: number;
}): Promise<FundsIndiaEligibilityResult> {
  const cleanSql = cleanSegmentSql(segmentSql);
  const segmentColumn = await resolveFundsIndiaSegmentColumn(datasetId, cleanSql);
  const sql = eligibilitySql({ segmentSql: cleanSql, segmentColumn, asOfDate });
  const countResult = await executeSQLInternal(`SELECT COUNT(*) AS cnt FROM (${sql}) __eligible`, datasetId);
  if (countResult.error) throw new Error(countResult.error);

  const sampleLimit = Math.max(1, Math.min(10_000, Math.floor(limit)));
  const rowsResult = await executeSQLInternal(
    `SELECT *
     FROM (${sql}) __eligible
     ORDER BY last_intent_at DESC NULLS LAST, intent_events DESC, investor_id ASC
     LIMIT ${sampleLimit}`,
    datasetId,
  );
  if (rowsResult.error) throw new Error(rowsResult.error);

  return {
    eligibleCount: readNumber(countResult.rows[0] ?? {}, "cnt"),
    rows: rowsResult.rows.map((row) => ({
      investorId: readText(row, "investor_id") ?? "",
      name: readText(row, "name"),
      city: readText(row, "city"),
      state: readText(row, "state"),
      kycStatus: readText(row, "kyc_status"),
      bankVerifiedDate: readText(row, "bank_verified_date"),
      accountActivatedDate: readText(row, "account_activated_date"),
      lastIntentAt: readText(row, "last_intent_at"),
      lastIntentEvent: readText(row, "last_intent_event"),
      intentEvents: readNumber(row, "intent_events"),
      targetFundId: readText(row, "target_fund_id"),
      targetFundName: readText(row, "target_fund_name"),
      targetAmcName: readText(row, "target_amc_name"),
    })).filter((row) => row.investorId),
    segmentColumn,
  };
}

function conversionDateColumn(metric: OecMetric): string {
  if (metric === "bank_verified") return "bank_verified_date";
  if (metric === "kyc_completed") return "kyc_submitted_date";
  return "account_activated_date";
}

export async function loadFundsIndiaConversions({
  datasetId,
  investorIds,
  oecMetric,
  startDate,
  endDate,
}: {
  datasetId: string;
  investorIds: string[];
  oecMetric: OecMetric;
  startDate: string;
  endDate: string;
}): Promise<Map<string, string>> {
  if (investorIds.length === 0) return new Map();
  const dateColumn = conversionDateColumn(oecMetric);
  const values = investorIds
    .map((id) => `('${escapeSqlString(id)}')`)
    .join(", ");
  const result = await executeSQLInternal(
    `WITH enrolled(investor_id) AS (VALUES ${values})
     SELECT
       CAST(i.investor_id AS VARCHAR) AS investor_id,
       CAST(i.${quoteIdent(dateColumn)} AS VARCHAR) AS conversion_date
     FROM raw_investors i
     JOIN enrolled e ON e.investor_id = i.investor_id
     WHERE i.${quoteIdent(dateColumn)} IS NOT NULL
       AND CAST(i.${quoteIdent(dateColumn)} AS DATE) > DATE '${assertIsoDate(startDate)}'
       AND CAST(i.${quoteIdent(dateColumn)} AS DATE) <= DATE '${assertIsoDate(endDate)}'`,
    datasetId,
  );
  if (result.error) {
    console.warn("[lifecycle/fundsindia] conversion lookup failed", result.error);
    return new Map();
  }
  return new Map(
    result.rows
      .map((row) => [readText(row, "investor_id"), readText(row, "conversion_date")] as const)
      .filter((entry): entry is readonly [string, string] => Boolean(entry[0] && entry[1])),
  );
}
