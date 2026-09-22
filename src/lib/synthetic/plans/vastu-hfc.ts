/**
 * Synthesis plan for the vastu-hfc sample dataset (Vastu Housing Finance + Vastu Finserve).
 *
 * Cadence
 * -------
 * 1 day = 1 synthetic day. Daily tick at 1pm IST (07:30 UTC), same scheduler
 * window as quickhelp. The HFC business cycle is monthly (disbursements,
 * EMIs, NPA, provisions) — daily ticks emit only what the calendar dictates
 * for each day:
 *
 *   - new loans / borrowers / employees / branches / borrowings: every day,
 *     proportional fraction of monthly volume
 *   - emi_payments: only loans whose monthly due-day == today's day-of-month
 *   - provisions: month-end ticks only (2 rows, per entity)
 *   - npa_movement: FY-quarter-end ticks only (2 rows, per entity, opening = previous closing)
 *   - assignments: Mar 15 / Jun 15 / Sep 15 / Dec 15 only (~1500 npa_90+ loans batched)
 *   - loan ageing UPDATE pass: every tick (DPD progression, status transitions)
 *
 * Why mode: "custom" everywhere
 * -----------------------------
 * HFC has hard invariants the declarative ColumnGenerator primitives can't
 * express without a heavy type-system extension:
 *
 *   - 12 valid (loan_status, dpd_bucket, stage) tuples — strict state machine
 *   - co_lending_partner is FINSERVE-only (HFC has zero co-lending)
 *   - NTC ⇔ bureau_score=0 — perfect biconditional
 *   - paid_date IS NULL ⇔ amount_paid=0 — strict invariant in 1.8M EMIs
 *   - entity → product hard partition (HFC: home loans; Finserve: vehicle / MSME)
 *   - sourcing_channel asymmetric per entity
 *   - branch_type × city_tier ⇒ employee_count + monthly_rent ranges
 *   - cross-table FKs (borrower_id → raw_borrowers ∪ live, branch_id by entity,
 *     agent_id from active collection_agents)
 *   - computed columns (emi_amount = annuity formula; property_value = disbursed/ltv)
 *   - multi-pass UPDATE+INSERT: ageing the existing book before inserting new EMIs
 *
 * All of these are handled by the imperative HFC orchestrator (added in
 * subsequent steps). The plan exists to scaffold infrastructure setup,
 * declare cadence, and register the dataset with the scheduler.
 *
 * Disabled
 * --------
 * `enabled: false` until imperative generators ship. Scheduler reads
 * listSyntheticDatasets() which filters on plan.enabled, so disabled plans are
 * skipped entirely. Flipped to true at the end of the rollout (after backfill).
 */

import type { SyntheticPlan } from "../types";

export const vastuHfcSynthetic: SyntheticPlan = {
  datasetId: "vastu-hfc",
  enabled: true,
  cadence: { intervalHours: 24, syntheticHoursPerTick: 24 },

  tables: [
    {
      name: "loans",
      mode: "custom",
      description:
        "~250 new loans/day. Entity 56/44 hfc/finserve with monotonic Finserve drift. Entity → product hard partition. Co-lending Finserve-only. Rate by entity (HFC ~15%, Finserve ~20%). Tenure + ticket size by product_type. emi_amount computed via annuity formula. borrower_id 90% from existing pool, 10% from this tick's new borrowers (NTC channel). branch_id matches loan.entity.",
    },
    {
      name: "borrowers",
      mode: "custom",
      description:
        "~33 new borrowers/day, mostly NTC. Gender 60F/40M (Vastu's actual mix). Joint (employment_type, income_category) → income_inr range. NTC ⇔ bureau_score=0 enforced. State+city sampled from seed catalog. Industry from 27-occupation catalog. Property type 70/15/10/5 independent_house/apartment/plot/commercial.",
    },
    {
      name: "branches",
      mode: "custom",
      description:
        "1-3 new branches/month. HFC: main/small/micro/sales_office; Finserve: small/micro/sales_office (no main). branch_type × city_tier ⇒ employee_count + monthly_rent matrix. Expansion-state weighted (UP/MP/Rajasthan for HFC; WB/Bihar for Finserve).",
    },
    {
      name: "employees",
      mode: "custom",
      description:
        "~3-5 hires/day. Function mix sales 45 / ops 12 / collections 12 / credit 12 / ho 10 / legal 8 (%). CTC log-normal within function-bounded range. Gender 30F/70M. Attrition UPDATE pass flips is_active by function (collections 2.0%/mo, sales 1.5%, others 0.8%).",
    },
    {
      name: "borrowings",
      mode: "custom",
      description:
        "~7 new instruments/month. Source mix bank 51 / nhb 36 (HFC-only) / fi_dfi 10 / ecb 2 / ncd 1 (%). Lender from 24-name catalog gated by source_type. Rates 6-10.5% (wholesale). Repayment monthly 37 / quarterly 60 / semi 2 / annual 1. UPDATE pass amortizes outstanding_amount_cr per period; matures when maturity_date crosses tick.",
    },
    {
      name: "emi_payments",
      mode: "custom",
      description:
        "Walks active+npa loan book daily; emits one EMI iff disbursement_date.day == today's day-of-month. Per-loan ageing model decides on_time / 1_30 / 31_60 / 61_90 / 90_plus. paid_date NULL ⇔ amount_paid=0. Bucket deterministic from dpd_at_payment. Bounce TRUE iff bucket != on_time. Payment_mode weighted nach 55 / upi 20 / cash 15 / cheque 5 / neft 5.",
    },
    {
      name: "collections_actions",
      mode: "custom",
      description:
        "Derived from EMIs landing in 31_60+ buckets this tick. action_type by DPD floor: sms/call/field_visit at 30+, demand/legal_notice at 60+, sarfaesi at 90+ only. agent_id sampled from active collection_agents (function_type='collections' AND is_active=true). result from observed (action_type, result) joint distribution.",
    },
    {
      name: "assignments",
      mode: "custom",
      description:
        "Quarterly only (Mar/Jun/Sep/Dec 15). Picks ~1500 npa_90+ loans → flips status='assigned' with bucket='current', stage=1 (the seed pattern). Aggregates into one assignment row with weighted-avg LTV/residual_maturity/holding_period. Buyer rotates SBI/HDFC/ICICI/Bank of Baroda/ARC. amount_assigned_cr = SUM(disbursed)*0.85/1cr (haircut).",
    },
    {
      name: "provisions",
      mode: "custom",
      description:
        "Month-end ticks only. 2 rows (per entity). stage_N_exposure_cr = SUM(disbursed) where stage=N grouped by entity, /1cr. PCR fixed at 0.5 / 15 / 35 % (regulatory). total_ecl_cr = sum of provisions. write_offs_cr + recoveries_cr from this month's status flips.",
    },
    {
      name: "npa_movement",
      mode: "custom",
      description:
        "FY-quarter end only (Mar 31 / Jun 30 / Sep 30 / Dec 31). 2 rows (per entity). opening_gnpa_cr = previous quarter's closing_gnpa_cr (continuous chain — never broken). additions/upgradations/write_offs/recoveries from this quarter's loan transitions. closing = open + add - upgr - writeoff - recoveries.",
    },
  ],

  postTick: {
    invalidateCaches: ["metrics", "explorer", "entity-catalog"],
  },
};
