import type { EventDefinition, EventProperty } from "../explorer-types";

type PropType = EventProperty["type"];

function prop(
  column: string,
  displayName: string,
  type: PropType = "string",
  cardinalityHint: EventProperty["cardinalityHint"] = "low",
): EventProperty {
  return { column, displayName, type, cardinalityHint };
}

function uniqueProperties(...groups: EventProperty[][]): EventProperty[] {
  const seen = new Set<string>();
  const out: EventProperty[] = [];
  for (const group of groups) {
    for (const item of group) {
      if (seen.has(item.column)) continue;
      seen.add(item.column);
      out.push(item);
    }
  }
  return out;
}

function e(def: Omit<EventDefinition, "properties"> & { properties?: EventProperty[] }): EventDefinition {
  return {
    countColumn: "*",
    ...def,
    properties: def.properties ?? [],
  };
}

function userEvent(
  id: string,
  displayName: string,
  eventName: string,
  category: string,
  options: Partial<Omit<EventDefinition, "id" | "displayName" | "table" | "dateColumn" | "filterColumn" | "filterValue" | "category">> = {},
): EventDefinition {
  return e({
    id,
    displayName,
    category,
    table: "user_events_full",
    dateColumn: "event_timestamp",
    filterColumn: "event_name",
    filterValue: eventName,
    properties: USER_EVENT_PROPERTIES,
    ...options,
  });
}

const INVESTOR_PROPERTIES = [
  prop("city_tier", "City Tier"),
  prop("city", "City", "string", "medium"),
  prop("state", "State", "string", "medium"),
  prop("risk_profile", "Risk Profile"),
  prop("acquisition_channel", "Acquisition Channel"),
  prop("annual_income", "Annual Income"),
  prop("occupation", "Occupation"),
  prop("investor_type", "Investor Type"),
  prop("gender", "Gender"),
  prop("age", "Age", "number", "medium"),
  prop("kyc_status", "KYC Status"),
  prop("kyc_method", "KYC Method"),
  prop("bank_name", "Bank"),
  prop("bank_link_method", "Bank Link Method"),
];

const FUND_PROPERTIES = [
  prop("fund_category", "Fund Category"),
  prop("fund_subcategory", "Subcategory", "string", "medium"),
  prop("amc_name", "AMC", "string", "medium"),
  prop("risk_level", "Fund Risk Level"),
  prop("is_fi_select", "FI Select"),
  prop("fi_star_rating", "FI Star Rating", "number", "medium"),
];

const TXN_PROPERTIES = uniqueProperties(
  FUND_PROPERTIES,
  INVESTOR_PROPERTIES,
  [
    prop("txn_type", "Transaction Type"),
    prop("status", "Transaction Status"),
    prop("channel", "Channel"),
    prop("payment_mode", "Payment Mode"),
    prop("amount_range", "Amount Range"),
    prop("sip_id", "SIP ID", "string", "high"),
    prop("goal_id", "Goal ID", "string", "high"),
  ],
);

const SIP_PROPERTIES = uniqueProperties(
  FUND_PROPERTIES,
  INVESTOR_PROPERTIES,
  [
    prop("sip_type", "SIP Type"),
    prop("status", "SIP Status"),
    prop("mandate_type", "Mandate Type"),
    prop("amount_range", "Amount Range"),
    prop("frequency", "Frequency"),
    prop("cancellation_reason", "Cancellation Reason"),
    prop("step_up_pct", "Step-Up %", "number", "medium"),
  ],
);

const SIP_ENDING_PROPERTIES = uniqueProperties(
  SIP_PROPERTIES,
  [
    prop("sip_end_window", "SIP End Window"),
    prop("days_to_end", "Days to End", "number", "medium"),
    prop("as_of_date", "As Of Date", "date"),
  ],
);

const SYSTEMATIC_PROPERTIES = uniqueProperties(
  INVESTOR_PROPERTIES,
  [
    prop("plan_type", "Plan Type"),
    prop("status", "Plan Status"),
    prop("frequency", "Frequency"),
    prop("amount_range", "Amount Range"),
    prop("source_fund_category", "Source Fund Category"),
    prop("source_amc_name", "Source AMC", "string", "medium"),
    prop("target_fund_category", "Target Fund Category"),
    prop("target_amc_name", "Target AMC", "string", "medium"),
  ],
);

const GOAL_PROPERTIES = uniqueProperties(
  INVESTOR_PROPERTIES,
  [
    prop("goal_type", "Goal Type"),
    prop("status", "Goal Status"),
    prop("created_by", "Created By"),
    prop("target_bucket", "Target Bucket"),
  ],
);

const COMMS_PROPERTIES = uniqueProperties(
  INVESTOR_PROPERTIES,
  [
    prop("channel", "Channel"),
    prop("campaign_type", "Campaign Type", "string", "medium"),
    prop("delivered", "Delivered"),
    prop("opened", "Opened"),
    prop("clicked", "Clicked"),
    prop("converted", "Converted"),
    prop("action_taken", "Action Taken"),
  ],
);

const ADVISORY_PROPERTIES = uniqueProperties(
  INVESTOR_PROPERTIES.slice(0, 7),
  [
    prop("advisor_type", "Advisor Type"),
    prop("session_type", "Session Type"),
    prop("recommendation_type", "Recommendation"),
    prop("outcome", "Outcome"),
    prop("triggered_by", "Triggered By"),
    prop("portfolio_value_bucket", "Portfolio Value Bucket"),
  ],
);

const SUPPORT_PROPERTIES = uniqueProperties(
  INVESTOR_PROPERTIES.slice(0, 6),
  [
    prop("category", "Issue Category"),
    prop("channel", "Support Channel"),
    prop("priority", "Priority"),
    prop("status", "Ticket Status"),
    prop("kyc_status", "KYC Status"),
    prop("resolution_bucket", "Resolution Time"),
    prop("nps_bucket", "NPS Bucket"),
  ],
);

const USER_EVENT_PROPERTIES = uniqueProperties(
  [
    prop("platform", "Platform"),
    prop("page_path", "Page Path", "string", "medium"),
    prop("source_medium", "Source Medium", "string", "medium"),
    prop("session_id", "Session ID", "string", "high"),
    prop("fund_id", "Fund ID", "string", "high"),
    prop("fund_category", "Fund Category"),
    prop("fund_subcategory", "Subcategory", "string", "medium"),
    prop("amc_name", "AMC", "string", "medium"),
    prop("risk_level", "Fund Risk Level"),
    prop("is_fi_select", "FI Select"),
    prop("calculator_type", "Calculator Type"),
    prop("article_slug", "Article", "string", "medium"),
    prop("campaign_type", "Campaign Type", "string", "medium"),
    prop("search_query", "Search Query", "string", "medium"),
    prop("amount_range", "Amount Range"),
    prop("sip_id", "SIP ID", "string", "high"),
    prop("goal_type", "Goal Type"),
    prop("step_name", "Step"),
    prop("drop_reason", "Drop Reason"),
  ],
  INVESTOR_PROPERTIES,
);

// investor_fund_positions / investor_portfolio_summary only carry these
// investor columns (the cashflows/base CTEs group by exactly this set — they
// do NOT include occupation, investor_type, kyc_*, or bank_* fields).
const POSITION_INVESTOR_PROPERTIES = [
  prop("city_tier", "City Tier"),
  prop("city", "City", "string", "medium"),
  prop("state", "State", "string", "medium"),
  prop("risk_profile", "Risk Profile"),
  prop("acquisition_channel", "Acquisition Channel"),
  prop("annual_income", "Annual Income"),
  prop("gender", "Gender"),
  prop("age", "Age", "number", "medium"),
];

const POSITION_PROPERTIES = uniqueProperties(
  FUND_PROPERTIES,
  POSITION_INVESTOR_PROPERTIES,
  [
    prop("position_status", "Position Status"),
    prop("position_size_bucket", "Position Size"),
    prop("is_current_holding", "Current Holding"),
    prop("has_purchase_in_window", "Purchased in Window"),
    prop("has_redemption_in_window", "Redeemed in Window"),
    prop("is_sip_linked", "SIP Linked"),
    prop("is_repeat_buyer", "Repeat Buyer"),
    prop("has_sip_investment", "Has SIP Investment"),
    prop("has_lumpsum_investment", "Has Lumpsum Investment"),
    prop("has_stp_investment", "Has STP Investment"),
  ],
);

const PORTFOLIO_PROPERTIES = uniqueProperties(
  POSITION_INVESTOR_PROPERTIES,
  [
    prop("portfolio_status", "Portfolio Status"),
    prop("portfolio_value_bucket", "Portfolio Value"),
    prop("portfolio_breadth_bucket", "Portfolio Breadth"),
    prop("dominant_current_category", "Dominant Category"),
    prop("dominant_current_amc", "Dominant AMC", "string", "medium"),
    prop("has_current_holding", "Has Current Holding"),
    prop("has_fi_select_holding", "Has FI Select Holding"),
    prop("has_elss_holding", "Has ELSS Holding"),
    prop("has_sip_linked_holding", "Has SIP-Linked Holding"),
    prop("current_fund_count", "Current Fund Count", "number", "medium"),
    prop("current_category_count", "Current Category Count", "number", "medium"),
    prop("current_amc_count", "Current AMC Count", "number", "medium"),
  ],
);

function txnEvent(
  id: string,
  displayName: string,
  filterSQL: string,
  options: Partial<Omit<EventDefinition, "id" | "displayName" | "table" | "dateColumn" | "filterSQL" | "category">> = {},
): EventDefinition {
  return e({
    id,
    displayName,
    category: "Investments",
    table: "transactions_full",
    dateColumn: "txn_date",
    filterSQL,
    valueColumn: "amount_inr",
    properties: TXN_PROPERTIES,
    ...options,
  });
}

function sipEvent(
  id: string,
  displayName: string,
  dateColumn: string,
  filterSQL?: string,
  options: Partial<Omit<EventDefinition, "id" | "displayName" | "table" | "dateColumn" | "filterSQL" | "category">> = {},
): EventDefinition {
  return e({
    id,
    displayName,
    category: "SIP Lifecycle",
    table: "sips_full",
    dateColumn,
    filterSQL,
    valueColumn: "amount_inr",
    properties: SIP_PROPERTIES,
    ...options,
  });
}

function systematicEvent(
  id: string,
  displayName: string,
  dateColumn: string,
  filterSQL?: string,
  options: Partial<Omit<EventDefinition, "id" | "displayName" | "table" | "dateColumn" | "filterSQL" | "category">> = {},
): EventDefinition {
  return e({
    id,
    displayName,
    category: "Systematic Plans",
    table: "systematic_plans_full",
    dateColumn,
    filterSQL,
    valueColumn: "amount_inr",
    properties: SYSTEMATIC_PROPERTIES,
    ...options,
  });
}

function positionEvent(
  id: string,
  displayName: string,
  dateColumn: string,
  filterSQL?: string,
  options: Partial<Omit<EventDefinition, "id" | "displayName" | "table" | "dateColumn" | "filterSQL" | "category">> = {},
): EventDefinition {
  return e({
    id,
    displayName,
    category: "Product Holdings",
    table: "investor_fund_positions",
    dateColumn,
    filterSQL,
    valueColumn: "net_invested_inr",
    properties: POSITION_PROPERTIES,
    ...options,
  });
}

function portfolioEvent(
  id: string,
  displayName: string,
  dateColumn: string,
  filterSQL?: string,
  options: Partial<Omit<EventDefinition, "id" | "displayName" | "table" | "dateColumn" | "filterSQL" | "category">> = {},
): EventDefinition {
  return e({
    id,
    displayName,
    category: "Portfolio Summary",
    table: "investor_portfolio_summary",
    dateColumn,
    filterSQL,
    valueColumn: "net_invested_inr",
    properties: PORTFOLIO_PROPERTIES,
    ...options,
  });
}

const clickstreamEvents: EventDefinition[] = [
  userEvent("signup_started_event", "Signup Started", "signup_started", "Onboarding"),
  userEvent("pan_step_loaded", "PAN Step Loaded", "pan_step_loaded", "Onboarding"),
  userEvent("pan_confirmed_event", "PAN Confirmed", "pan_confirmed", "Onboarding"),
  userEvent("kyc_details_submitted_event", "KYC Details Submitted", "kyc_details_submitted", "Onboarding"),
  userEvent("fatca_submitted", "FATCA Submitted", "fatca_submitted", "Onboarding"),
  userEvent("kyc_on_hold_event", "KYC Put On Hold", "kyc_on_hold", "Onboarding", { funnelEligible: false }),
  userEvent("bank_auto_detect_started", "Bank Auto-Detect Started", "bank_auto_detect_started", "Onboarding"),
  userEvent("bank_auto_detect_success", "Bank Auto-Detect Succeeded", "bank_auto_detect_success", "Onboarding"),
  userEvent("bank_verified_event", "Bank Verified", "bank_verified", "Onboarding"),
  userEvent("account_activated_event", "Account Activated", "account_activated", "Onboarding"),
  userEvent("demat_cta_clicked", "Demat CTA Clicked", "demat_cta_clicked", "Onboarding"),
  userEvent("fund_searched", "Fund Searched", "fund_searched", "Discovery"),
  userEvent("fund_page_viewed", "Fund Page Viewed", "fund_page_viewed", "Discovery"),
  userEvent("fund_watchlisted", "Fund Watchlisted", "fund_watchlisted", "Discovery"),
  userEvent("academy_article_viewed", "Academy Article Viewed", "academy_article_viewed", "Discovery"),
  userEvent("sip_flow_started", "SIP Flow Started", "sip_flow_started", "SIP Funnel"),
  userEvent("sip_fund_selected", "SIP Fund Selected", "sip_fund_selected", "SIP Funnel"),
  userEvent("sip_amount_entered", "SIP Amount Entered", "sip_amount_entered", "SIP Funnel", { valueColumn: "amount_inr" }),
  userEvent("sip_created_app_event", "SIP Created in App", "sip_created", "SIP Funnel", { valueColumn: "amount_inr" }),
  userEvent("sip_flow_abandoned", "SIP Flow Abandoned", "sip_flow_abandoned", "SIP Funnel", { funnelEligible: false }),
  userEvent("sip_cancelled_app_event", "SIP Cancelled in App", "sip_cancelled", "SIP Funnel", { funnelEligible: false }),
  userEvent("calculator_opened", "Calculator Opened", "calculator_opened", "Calculators"),
  userEvent("calculator_computed", "Calculator Computed", "calculator_computed", "Calculators", { valueColumn: "calc_input_amount" }),
  userEvent("calculator_invest_cta_clicked", "Calculator Invest CTA Clicked", "calculator_invest_cta_clicked", "Calculators"),
  userEvent("dashboard_visited", "Dashboard Visited", "dashboard_visited", "Engagement"),
  userEvent("portfolio_visited", "Portfolio Visited", "portfolio_visited", "Engagement"),
  userEvent("email_opened_event", "Email Opened", "email_opened", "CRM"),
  userEvent("email_link_clicked_event", "Email Link Clicked", "email_link_clicked", "CRM"),
  userEvent("redemption_initiated_event", "Redemption Initiated", "redemption_initiated", "Redemption", { valueColumn: "amount_inr" }),
  userEvent("pre_redemption_call_offered_event", "Pre-Redemption Call Offered", "pre_redemption_call_offered", "Redemption"),
  userEvent("pre_redemption_call_accepted_event", "Pre-Redemption Call Accepted", "pre_redemption_call_accepted", "Redemption"),
  userEvent("pre_redemption_call_declined_event", "Pre-Redemption Call Declined", "pre_redemption_call_declined", "Redemption", { funnelEligible: false }),
  userEvent("redemption_completed_event", "Redemption Completed", "redemption_completed", "Redemption", { valueColumn: "amount_inr" }),
  userEvent("redemption_cancelled_event", "Redemption Cancelled", "redemption_cancelled", "Redemption"),
  userEvent("goal_created_app_event", "Goal Created in App", "goal_created", "Goals"),
];

const investorLifecycleEvents: EventDefinition[] = [
  e({ id: "investor_signup", displayName: "Signed Up", category: "Investor Lifecycle", table: "raw_investors", dateColumn: "signup_date", properties: INVESTOR_PROPERTIES }),
  e({ id: "pan_confirmed", displayName: "PAN Confirmed", category: "Investor Lifecycle", table: "raw_investors", dateColumn: "pan_confirmed_date", filterSQL: "pan_confirmed_date IS NOT NULL", properties: INVESTOR_PROPERTIES }),
  e({ id: "kyc_submitted", displayName: "KYC Submitted", category: "Investor Lifecycle", table: "raw_investors", dateColumn: "kyc_submitted_date", filterSQL: "kyc_submitted_date IS NOT NULL", properties: INVESTOR_PROPERTIES }),
  e({ id: "kyc_verified", displayName: "KYC Verified", category: "Investor Lifecycle", table: "raw_investors", dateColumn: "kyc_submitted_date", filterSQL: "kyc_status = 'verified'", properties: INVESTOR_PROPERTIES }),
  e({ id: "kyc_on_hold", displayName: "KYC On Hold", category: "Investor Lifecycle", table: "raw_investors", dateColumn: "kyc_submitted_date", filterSQL: "kyc_status = 'on_hold'", funnelEligible: false, properties: INVESTOR_PROPERTIES }),
  e({ id: "bank_verified", displayName: "Bank Verified", category: "Investor Lifecycle", table: "raw_investors", dateColumn: "bank_verified_date", filterSQL: "bank_verified_date IS NOT NULL", properties: INVESTOR_PROPERTIES }),
  e({ id: "account_activated", displayName: "Account Activated", category: "Investor Lifecycle", table: "raw_investors", dateColumn: "account_activated_date", filterSQL: "account_activated_date IS NOT NULL", properties: INVESTOR_PROPERTIES }),
  e({ id: "first_investment", displayName: "First Investment", category: "Investor Lifecycle", table: "raw_investors", dateColumn: "first_investment_date", filterSQL: "first_investment_date IS NOT NULL", properties: INVESTOR_PROPERTIES }),
  e({ id: "demat_opened", displayName: "Demat Account Opened", category: "Investor Lifecycle", table: "raw_investors", dateColumn: "demat_opened_date", filterSQL: "demat_opened_date IS NOT NULL", properties: INVESTOR_PROPERTIES }),
  e({ id: "mf_account_active", displayName: "MF Account Active", category: "Investor Lifecycle", table: "raw_investors", dateColumn: "account_activated_date", filterSQL: "mf_account_active = true", funnelEligible: false, properties: INVESTOR_PROPERTIES }),
  e({ id: "demat_account_active", displayName: "Demat Account Active", category: "Investor Lifecycle", table: "raw_investors", dateColumn: "demat_opened_date", filterSQL: "demat_account_active = true", funnelEligible: false, properties: INVESTOR_PROPERTIES }),
  e({ id: "aa_consent_given", displayName: "Account Aggregator Consent Given", category: "Investor Lifecycle", table: "raw_investors", dateColumn: "account_activated_date", filterSQL: "aa_consent_given = true", funnelEligible: false, properties: INVESTOR_PROPERTIES }),
  e({ id: "nri_signup", displayName: "NRI Signup", category: "Investor Lifecycle", table: "raw_investors", dateColumn: "signup_date", filterSQL: "investor_type = 'nri'", properties: INVESTOR_PROPERTIES }),
  e({ id: "calculator_acquired_signup", displayName: "Calculator-Acquired Signup", category: "Investor Lifecycle", table: "raw_investors", dateColumn: "signup_date", filterSQL: "acquisition_channel = 'calculator'", properties: INVESTOR_PROPERTIES }),
  e({ id: "wealth_conversations_signup", displayName: "Wealth Conversations Signup", category: "Investor Lifecycle", table: "raw_investors", dateColumn: "signup_date", filterSQL: "acquisition_channel = 'wealth_conversations'", properties: INVESTOR_PROPERTIES }),
];

const investmentEvents: EventDefinition[] = [
  txnEvent("purchase", "Any Purchase", "txn_type IN ('sip_installment','lumpsum','stp_purchase') AND status = 'success'"),
  txnEvent("successful_transaction", "Successful Transaction", "status = 'success'"),
  txnEvent("failed_transaction", "Failed Transaction", "status = 'failed'", { funnelEligible: false }),
  txnEvent("pending_transaction", "Pending Transaction", "status = 'pending'", { funnelEligible: false }),
  txnEvent("sip_installment", "SIP Installment", "txn_type = 'sip_installment' AND status = 'success'"),
  txnEvent("sip_installment_failed", "SIP Installment Failed", "txn_type = 'sip_installment' AND status = 'failed'", { funnelEligible: false }),
  txnEvent("sip_installment_pending", "SIP Installment Pending", "txn_type = 'sip_installment' AND status = 'pending'", { funnelEligible: false }),
  txnEvent("lumpsum_purchase", "Lumpsum Purchase", "txn_type = 'lumpsum' AND status = 'success'"),
  txnEvent("lumpsum_failed", "Lumpsum Failed", "txn_type = 'lumpsum' AND status = 'failed'", { funnelEligible: false }),
  txnEvent("redemption", "Redemption", "txn_type = 'redemption' AND status = 'success'"),
  txnEvent("redemption_failed", "Redemption Failed", "txn_type = 'redemption' AND status = 'failed'", { funnelEligible: false }),
  txnEvent("stp_purchase", "STP Purchase", "txn_type = 'stp_purchase' AND status = 'success'"),
  txnEvent("app_purchase", "App Purchase", "txn_type IN ('sip_installment','lumpsum','stp_purchase') AND status = 'success' AND channel = 'app'"),
  txnEvent("web_purchase", "Web Purchase", "txn_type IN ('sip_installment','lumpsum','stp_purchase') AND status = 'success' AND channel = 'web'"),
  txnEvent("email_link_purchase", "Email Link Purchase", "txn_type IN ('sip_installment','lumpsum','stp_purchase') AND status = 'success' AND channel = 'email_link'"),
  txnEvent("advisor_assisted_purchase", "Advisor-Assisted Purchase", "txn_type IN ('sip_installment','lumpsum','stp_purchase') AND status = 'success' AND channel = 'advisor_assisted'"),
  txnEvent("nach_investment", "NACH Investment", "txn_type IN ('sip_installment','lumpsum','stp_purchase') AND payment_mode = 'nach'"),
  txnEvent("upi_investment", "UPI Investment", "txn_type IN ('sip_installment','lumpsum','stp_purchase') AND payment_mode = 'upi'"),
  txnEvent("netbanking_investment", "Netbanking Investment", "txn_type IN ('sip_installment','lumpsum','stp_purchase') AND payment_mode = 'netbanking'"),
  txnEvent("bank_transfer_investment", "Bank Transfer Investment", "txn_type IN ('sip_installment','lumpsum','stp_purchase') AND payment_mode = 'bank_transfer'"),
  txnEvent("fi_select_purchase", "FI Select Purchase", "txn_type IN ('sip_installment','lumpsum','stp_purchase') AND status = 'success' AND is_fi_select = true"),
  txnEvent("non_fi_select_purchase", "Non-FI Select Purchase", "txn_type IN ('sip_installment','lumpsum','stp_purchase') AND status = 'success' AND is_fi_select = false"),
  txnEvent("equity_purchase", "Equity Purchase", "txn_type IN ('sip_installment','lumpsum','stp_purchase') AND status = 'success' AND fund_category = 'equity'"),
  txnEvent("elss_purchase", "ELSS Purchase", "txn_type IN ('sip_installment','lumpsum','stp_purchase') AND status = 'success' AND fund_category = 'elss'"),
  txnEvent("debt_purchase", "Debt Purchase", "txn_type IN ('sip_installment','lumpsum','stp_purchase') AND status = 'success' AND fund_category = 'debt'"),
  txnEvent("liquid_purchase", "Liquid Fund Purchase", "txn_type IN ('sip_installment','lumpsum','stp_purchase') AND status = 'success' AND fund_category = 'liquid'"),
  txnEvent("gold_purchase", "Gold Fund Purchase", "txn_type IN ('sip_installment','lumpsum','stp_purchase') AND status = 'success' AND fund_category = 'gold'"),
  txnEvent("global_purchase", "Global Fund Purchase", "txn_type IN ('sip_installment','lumpsum','stp_purchase') AND status = 'success' AND fund_category = 'global'"),
  txnEvent("index_purchase", "Index Fund Purchase", "txn_type IN ('sip_installment','lumpsum','stp_purchase') AND status = 'success' AND fund_category = 'index'"),
  txnEvent("daaf_purchase", "Dynamic Asset Allocation Purchase", "txn_type IN ('sip_installment','lumpsum','stp_purchase') AND status = 'success' AND fund_category = 'daaf'"),
  txnEvent("high_value_purchase", "High-Value Purchase", "txn_type IN ('sip_installment','lumpsum','stp_purchase') AND status = 'success' AND amount_inr >= 50000"),
];

const sipEvents: EventDefinition[] = [
  sipEvent("sip_created", "SIP Created", "start_date"),
  sipEvent("sip_active", "Active SIP", "start_date", "status = 'active'", { funnelEligible: false }),
  e({ id: "sip_ending_soon", displayName: "SIP Ending Soon", category: "SIP Lifecycle", table: "sips_ending_soon", dateColumn: "end_date", filterSQL: "is_ending_soon = true", valueColumn: "amount_inr", properties: SIP_ENDING_PROPERTIES }),
  e({ id: "sip_ending_30d", displayName: "SIP Ending in 30 Days", category: "SIP Lifecycle", table: "sips_ending_soon", dateColumn: "end_date", filterSQL: "sip_end_window = 'ending_0_30d'", valueColumn: "amount_inr", properties: SIP_ENDING_PROPERTIES }),
  e({ id: "sip_ending_90d", displayName: "SIP Ending in 90 Days", category: "SIP Lifecycle", table: "sips_ending_soon", dateColumn: "end_date", filterSQL: "is_ending_soon = true", valueColumn: "amount_inr", properties: SIP_ENDING_PROPERTIES }),
  sipEvent("sip_cancelled", "SIP Cancelled", "end_date", "status = 'cancelled' AND end_date IS NOT NULL"),
  sipEvent("sip_paused", "SIP Paused", "end_date", "status = 'paused' AND end_date IS NOT NULL", { funnelEligible: false }),
  sipEvent("sip_completed", "SIP Completed", "end_date", "status = 'completed' AND end_date IS NOT NULL"),
  sipEvent("power_sip_created", "Power SIP Created", "start_date", "sip_type = 'power_sip'"),
  sipEvent("regular_sip_created", "Regular SIP Created", "start_date", "sip_type = 'regular'"),
  sipEvent("super_savings_sip_created", "Super Savings SIP Created", "start_date", "sip_type = 'super_savings'"),
  sipEvent("elss_sip_created", "ELSS SIP Created", "start_date", "fund_category = 'elss'"),
  sipEvent("fi_select_sip_created", "FI Select SIP Created", "start_date", "is_fi_select = true"),
  sipEvent("nach_mandate_sip_created", "NACH Mandate SIP Created", "start_date", "mandate_type = 'nach'"),
  sipEvent("upi_autopay_sip_created", "UPI Autopay SIP Created", "start_date", "mandate_type = 'upi_autopay'"),
  sipEvent("small_sip_created", "Small SIP Created", "start_date", "amount_range = '<2K'"),
  sipEvent("mid_sip_created", "Mid-Value SIP Created", "start_date", "amount_range = '2-5K'"),
  sipEvent("large_sip_created", "Large SIP Created", "start_date", "amount_range IN ('5-15K','>15K')"),
  sipEvent("step_up_sip_created", "Step-Up SIP Created", "start_date", "step_up_pct IS NOT NULL AND step_up_pct > 0"),
];

const systematicEvents: EventDefinition[] = [
  systematicEvent("systematic_plan_started", "Systematic Plan Started", "start_date"),
  systematicEvent("stp_started", "STP Started", "start_date", "plan_type = 'stp'"),
  systematicEvent("swp_started", "SWP Started", "start_date", "plan_type = 'swp'"),
  systematicEvent("super_savings_started", "Super Savings Started", "start_date", "plan_type = 'super_savings'"),
  systematicEvent("systematic_plan_cancelled", "Systematic Plan Cancelled", "end_date", "status = 'cancelled' AND end_date IS NOT NULL"),
  systematicEvent("stp_cancelled", "STP Cancelled", "end_date", "plan_type = 'stp' AND status = 'cancelled' AND end_date IS NOT NULL"),
  systematicEvent("swp_cancelled", "SWP Cancelled", "end_date", "plan_type = 'swp' AND status = 'cancelled' AND end_date IS NOT NULL"),
  systematicEvent("super_savings_cancelled", "Super Savings Cancelled", "end_date", "plan_type = 'super_savings' AND status = 'cancelled' AND end_date IS NOT NULL"),
  systematicEvent("systematic_plan_completed", "Systematic Plan Completed", "end_date", "status = 'completed' AND end_date IS NOT NULL"),
  systematicEvent("stp_completed", "STP Completed", "end_date", "plan_type = 'stp' AND status = 'completed' AND end_date IS NOT NULL"),
  systematicEvent("swp_completed", "SWP Completed", "end_date", "plan_type = 'swp' AND status = 'completed' AND end_date IS NOT NULL"),
  systematicEvent("super_savings_completed", "Super Savings Completed", "end_date", "plan_type = 'super_savings' AND status = 'completed' AND end_date IS NOT NULL"),
];

const goalEvents: EventDefinition[] = [
  e({ id: "goal_created", displayName: "Goal Created", category: "Goals", table: "goals_full", dateColumn: "created_date", valueColumn: "target_amount_inr", properties: GOAL_PROPERTIES }),
  e({ id: "goal_achieved", displayName: "Goal Achieved", category: "Goals", table: "goals_full", dateColumn: "achieved_date", filterSQL: "status = 'achieved' AND achieved_date IS NOT NULL", valueColumn: "current_value_inr", properties: GOAL_PROPERTIES }),
  e({ id: "goal_at_risk", displayName: "Goal At Risk", category: "Goals", table: "goals_full", dateColumn: "flagged_at_risk_date", filterSQL: "status IN ('at_risk','off_track') AND flagged_at_risk_date IS NOT NULL", funnelEligible: false, properties: GOAL_PROPERTIES }),
  ...["retirement", "wealth_creation", "tax_saving", "education", "home_purchase", "emergency_fund", "vacation"].map((goalType) =>
    e({ id: `${goalType}_goal_created`, displayName: `${goalType.replace(/_/g, " ")} Goal Created`, category: "Goals", table: "goals_full", dateColumn: "created_date", filterSQL: `goal_type = '${goalType}'`, valueColumn: "target_amount_inr", properties: GOAL_PROPERTIES }),
  ),
  ...["money_mitr", "advisor", "self"].map((creator) =>
    e({ id: `${creator}_goal_created`, displayName: `${creator.replace(/_/g, " ")} Goal Created`, category: "Goals", table: "goals_full", dateColumn: "created_date", filterSQL: `created_by = '${creator}'`, valueColumn: "target_amount_inr", properties: GOAL_PROPERTIES }),
  ),
];

const commsEvents: EventDefinition[] = [
  e({ id: "comms_sent", displayName: "Message Sent", category: "CRM", table: "comms_full", dateColumn: "sent_at", properties: COMMS_PROPERTIES }),
  e({ id: "comms_delivered", displayName: "Message Delivered", category: "CRM", table: "comms_full", dateColumn: "sent_at", filterSQL: "delivered = true", funnelEligible: false, properties: COMMS_PROPERTIES }),
  e({ id: "comms_opened", displayName: "Message Opened", category: "CRM", table: "comms_full", dateColumn: "sent_at", filterSQL: "opened = true", funnelEligible: false, properties: COMMS_PROPERTIES }),
  e({ id: "comms_clicked", displayName: "Message Clicked", category: "CRM", table: "comms_full", dateColumn: "sent_at", filterSQL: "clicked = true", funnelEligible: false, properties: COMMS_PROPERTIES }),
  e({ id: "comms_converted", displayName: "Campaign Converted", category: "CRM", table: "comms_full", dateColumn: "sent_at", filterSQL: "converted = true", funnelEligible: false, properties: COMMS_PROPERTIES }),
  ...["email", "push", "sms", "whatsapp"].map((channel) =>
    e({ id: `${channel}_sent`, displayName: `${channel.toUpperCase()} Sent`, category: "CRM", table: "comms_full", dateColumn: "sent_at", filterSQL: `channel = '${channel}'`, properties: COMMS_PROPERTIES }),
  ),
  ...[
    ["welcome_series", "Welcome Series Sent"],
    ["sip_nudge", "SIP Nudge Sent"],
    ["portfolio_review", "Portfolio Review Campaign Sent"],
    ["fund_recommendation", "Fund Recommendation Sent"],
    ["tax_saving", "Tax Saving Campaign Sent"],
    ["market_alert", "Market Alert Sent"],
    ["kyc_reminder", "KYC Reminder Sent"],
    ["dormant_activation", "Dormant Activation Sent"],
    ["step_up_nudge", "Step-Up Nudge Sent"],
    ["pre_redemption", "Pre-Redemption Campaign Sent"],
    ["elss_lapse_warning", "ELSS Lapse Warning Sent"],
    ["market_commentary", "Market Commentary Sent"],
    ["wealth_conversations", "Wealth Conversations Sent"],
  ].map(([campaignType, displayName]) =>
    e({ id: `${campaignType}_campaign`, displayName, category: "CRM", table: "comms_full", dateColumn: "sent_at", filterSQL: `campaign_type = '${campaignType}'`, properties: COMMS_PROPERTIES }),
  ),
  e({ id: "campaign_sip_created", displayName: "Campaign Led to SIP Creation", category: "CRM", table: "comms_full", dateColumn: "sent_at", filterSQL: "converted = true AND action_taken = 'sip_created'", funnelEligible: false, properties: COMMS_PROPERTIES }),
  e({ id: "campaign_lumpsum_done", displayName: "Campaign Led to Lumpsum", category: "CRM", table: "comms_full", dateColumn: "sent_at", filterSQL: "converted = true AND action_taken = 'lumpsum_done'", funnelEligible: false, properties: COMMS_PROPERTIES }),
  e({ id: "campaign_goal_created", displayName: "Campaign Led to Goal Creation", category: "CRM", table: "comms_full", dateColumn: "sent_at", filterSQL: "converted = true AND action_taken = 'goal_created'", funnelEligible: false, properties: COMMS_PROPERTIES }),
];

const advisoryEvents: EventDefinition[] = [
  e({ id: "advisor_session", displayName: "Advisor Session", category: "Advisory", table: "advisory_full", dateColumn: "session_date", valueColumn: "portfolio_value_at_time", properties: ADVISORY_PROPERTIES }),
  e({ id: "money_mitr_session", displayName: "Money Mitr Session", category: "Advisory", table: "advisory_full", dateColumn: "session_date", filterSQL: "advisor_type = 'money_mitr'", valueColumn: "portfolio_value_at_time", properties: ADVISORY_PROPERTIES }),
  e({ id: "human_advisor_session", displayName: "Human Advisor Session", category: "Advisory", table: "advisory_full", dateColumn: "session_date", filterSQL: "advisor_type = 'human_advisor'", valueColumn: "portfolio_value_at_time", properties: ADVISORY_PROPERTIES }),
  ...["goal_planning", "portfolio_review", "fund_selection", "risk_assessment", "pre_redemption_call"].map((sessionType) =>
    e({ id: `${sessionType}_session`, displayName: `${sessionType.replace(/_/g, " ")} Session`, category: "Advisory", table: "advisory_full", dateColumn: "session_date", filterSQL: `session_type = '${sessionType}'`, valueColumn: "portfolio_value_at_time", properties: ADVISORY_PROPERTIES }),
  ),
  ...["followed", "partial", "ignored"].map((outcome) =>
    e({ id: `advisory_${outcome}`, displayName: `Advisory ${outcome}`, category: "Advisory", table: "advisory_full", dateColumn: "session_date", filterSQL: `outcome = '${outcome}'`, funnelEligible: outcome !== "ignored", valueColumn: "portfolio_value_at_time", properties: ADVISORY_PROPERTIES }),
  ),
  ...["increase_sip", "fund_switch", "start_sip", "add_elss", "rebalance", "stay_invested"].map((recommendation) =>
    e({ id: `${recommendation}_recommendation`, displayName: `${recommendation.replace(/_/g, " ")} Recommendation`, category: "Advisory", table: "advisory_full", dateColumn: "session_date", filterSQL: `recommendation_type = '${recommendation}'`, valueColumn: "portfolio_value_at_time", properties: ADVISORY_PROPERTIES }),
  ),
];

const supportEvents: EventDefinition[] = [
  e({ id: "support_ticket", displayName: "Support Ticket", category: "Support", table: "support_full", dateColumn: "created_at", properties: SUPPORT_PROPERTIES }),
  e({ id: "support_resolved", displayName: "Support Ticket Resolved", category: "Support", table: "support_full", dateColumn: "resolved_at", filterSQL: "status = 'resolved' AND resolved_at IS NOT NULL", properties: SUPPORT_PROPERTIES }),
  e({ id: "support_open", displayName: "Support Ticket Open", category: "Support", table: "support_full", dateColumn: "created_at", filterSQL: "status = 'open'", funnelEligible: false, properties: SUPPORT_PROPERTIES }),
  e({ id: "support_escalated", displayName: "Support Ticket Escalated", category: "Support", table: "support_full", dateColumn: "created_at", filterSQL: "status = 'escalated'", funnelEligible: false, properties: SUPPORT_PROPERTIES }),
  ...["kyc", "sip_failure", "bank_mandate", "redemption", "login", "statement", "complaint", "other"].map((category) =>
    e({ id: `${category}_support_ticket`, displayName: `${category.replace(/_/g, " ")} Support Ticket`, category: "Support", table: "support_full", dateColumn: "created_at", filterSQL: `category = '${category}'`, properties: SUPPORT_PROPERTIES }),
  ),
  ...["phone", "email", "chat", "in_app"].map((channel) =>
    e({ id: `${channel}_support_ticket`, displayName: `${channel.replace(/_/g, " ")} Support Ticket`, category: "Support", table: "support_full", dateColumn: "created_at", filterSQL: `channel = '${channel}'`, properties: SUPPORT_PROPERTIES }),
  ),
  e({ id: "high_priority_support", displayName: "High Priority Support Ticket", category: "Support", table: "support_full", dateColumn: "created_at", filterSQL: "priority = 'high'", funnelEligible: false, properties: SUPPORT_PROPERTIES }),
  e({ id: "low_nps_support", displayName: "Low NPS Support Ticket", category: "Support", table: "support_full", dateColumn: "created_at", filterSQL: "nps_score IS NOT NULL AND nps_score <= 6", funnelEligible: false, properties: SUPPORT_PROPERTIES }),
];

const productHoldingEvents: EventDefinition[] = [
  positionEvent("fund_position_opened", "Fund Position Opened", "first_purchase_date", "has_purchase_in_window = true", { valueColumn: "gross_purchased_inr" }),
  positionEvent("current_fund_position_opened", "Current Fund Position Opened", "first_purchase_date", "is_current_holding = true AND has_purchase_in_window = true"),
  positionEvent("current_fund_holding", "Current Fund Holding", "last_activity_date", "is_current_holding = true", { funnelEligible: false }),
  positionEvent("fi_select_position_opened", "FI Select Position Opened", "first_purchase_date", "is_current_holding = true AND is_fi_select = true AND has_purchase_in_window = true"),
  positionEvent("elss_position_opened", "ELSS Position Opened", "first_purchase_date", "is_current_holding = true AND fund_category = 'elss' AND has_purchase_in_window = true"),
  positionEvent("equity_position_opened", "Equity Position Opened", "first_purchase_date", "is_current_holding = true AND fund_category = 'equity' AND has_purchase_in_window = true"),
  positionEvent("debt_position_opened", "Debt Position Opened", "first_purchase_date", "is_current_holding = true AND fund_category = 'debt' AND has_purchase_in_window = true"),
  positionEvent("liquid_position_opened", "Liquid Position Opened", "first_purchase_date", "is_current_holding = true AND fund_category = 'liquid' AND has_purchase_in_window = true"),
  positionEvent("sip_linked_position_opened", "SIP-Linked Position Opened", "first_purchase_date", "is_current_holding = true AND is_sip_linked = true AND has_purchase_in_window = true"),
  positionEvent("lumpsum_position_opened", "Lumpsum Position Opened", "first_purchase_date", "is_current_holding = true AND has_lumpsum_investment = true AND has_purchase_in_window = true"),
  positionEvent("repeat_buyer_position", "Repeat Buyer Position", "last_activity_date", "is_current_holding = true AND is_repeat_buyer = true", { funnelEligible: false }),
  positionEvent("high_value_position", "High-Value Position", "first_purchase_date", "is_current_holding = true AND position_size_bucket IN ('50K-2L','>2L') AND has_purchase_in_window = true"),
  positionEvent("position_reduced", "Position Reduced", "last_redemption_date", "position_status = 'current_reduced'", { valueColumn: "redeemed_inr" }),
  positionEvent("position_fully_redeemed", "Position Fully Redeemed", "last_redemption_date", "position_status = 'fully_redeemed'", { valueColumn: "redeemed_inr" }),
  positionEvent("prior_position_redeemed", "Prior Position Redeemed", "last_redemption_date", "position_status = 'redemption_only_prior_position'", { valueColumn: "redeemed_inr", funnelEligible: false }),
];

const portfolioEvents: EventDefinition[] = [
  portfolioEvent("portfolio_started", "Portfolio Started", "first_purchase_date", "has_purchase_in_window = true", { valueColumn: "gross_purchased_inr" }),
  portfolioEvent("active_portfolio", "Active Portfolio", "last_activity_date", "has_current_holding = true", { funnelEligible: false }),
  portfolioEvent("single_fund_portfolio", "Single-Fund Portfolio", "last_activity_date", "has_current_holding = true AND current_fund_count = 1", { funnelEligible: false }),
  portfolioEvent("diversified_portfolio", "Diversified Portfolio", "last_purchase_date", "has_current_holding = true AND current_fund_count >= 3"),
  portfolioEvent("five_plus_fund_portfolio", "5+ Fund Portfolio", "last_purchase_date", "has_current_holding = true AND current_fund_count >= 5"),
  portfolioEvent("fi_select_portfolio", "FI Select Portfolio", "last_purchase_date", "has_fi_select_holding = true"),
  portfolioEvent("elss_portfolio", "ELSS Portfolio", "last_purchase_date", "has_elss_holding = true"),
  portfolioEvent("sip_linked_portfolio", "SIP-Linked Portfolio", "last_purchase_date", "has_sip_linked_holding = true"),
  portfolioEvent("high_value_portfolio", "High-Value Portfolio", "last_purchase_date", "has_current_holding = true AND portfolio_value_bucket = '>2L'"),
  portfolioEvent("portfolio_redeemed", "Portfolio Had Redemption", "last_redemption_date", "has_redemption_in_window = true", { valueColumn: "redeemed_inr" }),
  portfolioEvent("closed_portfolio", "Closed Portfolio", "last_redemption_date", "portfolio_status = 'fully_redeemed'", { valueColumn: "redeemed_inr" }),
];

export const FUNDSINDIA_EVENTS: EventDefinition[] = [
  ...clickstreamEvents,
  ...investorLifecycleEvents,
  ...investmentEvents,
  ...sipEvents,
  ...systematicEvents,
  ...goalEvents,
  ...commsEvents,
  ...advisoryEvents,
  ...supportEvents,
  ...productHoldingEvents,
  ...portfolioEvents,
];

export function getFundsIndiaViewSQL(): string[] {
  return [
    `CREATE OR REPLACE VIEW transactions_full AS
    SELECT
      t.txn_id, t.investor_id, t.fund_id, t.sip_id, t.goal_id,
      t.txn_date, t.txn_type, t.amount_inr, t.units, t.nav_at_txn,
      t.status, t.channel, t.payment_mode,
      CASE WHEN t.amount_inr < 2000 THEN '<2K'
           WHEN t.amount_inr < 5000 THEN '2-5K'
           WHEN t.amount_inr < 15000 THEN '5-15K'
           WHEN t.amount_inr < 50000 THEN '15-50K'
           ELSE '>50K' END AS amount_range,
      f.fund_name, f.amc_name,
      f.category AS fund_category,
      f.subcategory AS fund_subcategory,
      f.risk_level, f.trailing_commission_pct,
      f.return_1y, f.return_3y, f.return_5y,
      f.is_fi_select, f.fi_star_rating,
      i.city_tier, i.risk_profile, i.occupation,
      i.acquisition_channel, i.annual_income,
      i.state, i.city, i.gender, i.age,
      i.signup_date, i.account_activated_date,
      i.investor_type, i.kyc_status, i.kyc_method,
      i.bank_name, i.bank_link_method
    FROM raw_transactions t
    LEFT JOIN raw_funds f ON t.fund_id = f.fund_id
    LEFT JOIN raw_investors i ON t.investor_id = i.investor_id`,

    `CREATE OR REPLACE VIEW sips_full AS
    SELECT
      s.sip_id, s.investor_id, s.fund_id,
      s.start_date, s.end_date, s.frequency,
      s.amount_inr, s.step_up_pct, s.step_up_frequency,
      s.sip_type, s.status, s.mandate_type,
      s.cancellation_reason,
      s.total_installments_paid, s.total_amount_invested,
      CASE
        WHEN s.amount_inr < 2000 THEN '<2K'
        WHEN s.amount_inr < 5000 THEN '2-5K'
        WHEN s.amount_inr < 15000 THEN '5-15K'
        ELSE '>15K'
      END AS amount_range,
      f.fund_name, f.amc_name,
      f.category AS fund_category,
      f.subcategory AS fund_subcategory,
      f.risk_level, f.trailing_commission_pct,
      f.is_fi_select, f.fi_star_rating,
      i.city_tier, i.risk_profile, i.occupation,
      i.acquisition_channel, i.annual_income,
      i.state, i.city, i.gender, i.age,
      i.signup_date, i.account_activated_date,
      i.investor_type, i.kyc_status, i.kyc_method,
      i.bank_name, i.bank_link_method
    FROM raw_sips s
    LEFT JOIN raw_funds f ON s.fund_id = f.fund_id
    LEFT JOIN raw_investors i ON s.investor_id = i.investor_id`,

    `CREATE OR REPLACE VIEW sips_ending_soon AS
    SELECT
      s.*,
      DATE '2026-05-28' AS as_of_date,
      date_diff('day', DATE '2026-05-28', CAST(s.end_date AS DATE)) AS days_to_end,
      CASE
        WHEN s.end_date BETWEEN DATE '2026-05-28' AND DATE '2026-05-28' + INTERVAL 30 DAY THEN 'ending_0_30d'
        WHEN s.end_date BETWEEN DATE '2026-05-28' + INTERVAL 31 DAY AND DATE '2026-05-28' + INTERVAL 90 DAY THEN 'ending_31_90d'
        ELSE 'outside_window'
      END AS sip_end_window,
      s.end_date BETWEEN DATE '2026-05-28' AND DATE '2026-05-28' + INTERVAL 90 DAY AS is_ending_soon
    FROM sips_full s
    WHERE s.end_date BETWEEN DATE '2026-05-28' AND DATE '2026-05-28' + INTERVAL 90 DAY`,

    `CREATE OR REPLACE VIEW goals_full AS
    SELECT
      g.goal_id, g.investor_id, g.goal_type,
      g.target_amount_inr, g.target_date,
      g.monthly_sip_needed_inr, g.current_value_inr,
      g.created_date, g.status, g.created_by,
      g.flagged_at_risk_date, g.achieved_date,
      CASE WHEN g.target_amount_inr < 500000 THEN '<5L'
           WHEN g.target_amount_inr < 2500000 THEN '5-25L'
           WHEN g.target_amount_inr < 10000000 THEN '25L-1Cr'
           ELSE '>1Cr' END AS target_bucket,
      i.city_tier, i.risk_profile, i.occupation,
      i.acquisition_channel, i.annual_income,
      i.state, i.city, i.gender, i.age,
      i.investor_type, i.kyc_status, i.kyc_method,
      i.bank_name, i.bank_link_method
    FROM raw_goals g
    LEFT JOIN raw_investors i ON g.investor_id = i.investor_id`,

    `CREATE OR REPLACE VIEW comms_full AS
    SELECT
      c.comm_id, c.investor_id, c.channel, c.campaign_type,
      c.sent_at, c.delivered, c.opened, c.clicked,
      c.converted, c.action_taken,
      i.city_tier, i.risk_profile, i.occupation,
      i.acquisition_channel, i.annual_income,
      i.state, i.city, i.gender, i.age,
      i.investor_type, i.kyc_status, i.kyc_method,
      i.bank_name, i.bank_link_method, i.is_active
    FROM raw_comms_log c
    LEFT JOIN raw_investors i ON c.investor_id = i.investor_id`,

    `CREATE OR REPLACE VIEW advisory_full AS
    SELECT
      a.session_id, a.investor_id, a.session_date,
      a.advisor_type, a.session_type, a.duration_min,
      a.recommendation_type, a.outcome,
      a.portfolio_value_at_time, a.triggered_by,
      CASE WHEN a.portfolio_value_at_time < 100000 THEN '<1L'
           WHEN a.portfolio_value_at_time < 500000 THEN '1-5L'
           WHEN a.portfolio_value_at_time < 2500000 THEN '5-25L'
           ELSE '>25L' END AS portfolio_value_bucket,
      i.city_tier, i.risk_profile, i.occupation,
      i.acquisition_channel, i.annual_income,
      i.state, i.city, i.gender, i.age,
      i.investor_type, i.kyc_status, i.kyc_method,
      i.bank_name, i.bank_link_method
    FROM raw_advisory a
    LEFT JOIN raw_investors i ON a.investor_id = i.investor_id`,

    `CREATE OR REPLACE VIEW support_full AS
    SELECT
      s.ticket_id, s.investor_id, s.created_at, s.resolved_at,
      s.category, s.channel, s.priority, s.status,
      s.resolution_hours, s.nps_score,
      CASE WHEN s.resolution_hours IS NULL THEN NULL
           WHEN s.resolution_hours <= 24 THEN '<=24h'
           WHEN s.resolution_hours <= 72 THEN '25-72h'
           ELSE '72h+' END AS resolution_bucket,
      CASE WHEN s.nps_score IS NULL THEN NULL
           WHEN s.nps_score <= 6 THEN 'detractor'
           WHEN s.nps_score <= 8 THEN 'passive'
           ELSE 'promoter' END AS nps_bucket,
      i.city_tier, i.risk_profile, i.occupation,
      i.acquisition_channel, i.annual_income,
      i.state, i.city, i.gender, i.age,
      i.investor_type, i.kyc_status, i.kyc_method,
      i.bank_name, i.bank_link_method, i.is_active
    FROM raw_support s
    LEFT JOIN raw_investors i ON s.investor_id = i.investor_id`,

    `CREATE OR REPLACE VIEW user_events_full AS
    SELECT
      ue.event_id, ue.event_name, ue.investor_id, ue.anonymous_id, ue.session_id,
      TRY_CAST(ue.timestamp AS TIMESTAMP) AS event_timestamp,
      ue.platform, ue.page_path, ue.source_medium,
      ue.fund_id,
      COALESCE(NULLIF(ue.fund_category, ''), f.category) AS fund_category,
      f.subcategory AS fund_subcategory,
      COALESCE(NULLIF(ue.amc_name, ''), f.amc_name) AS amc_name,
      f.risk_level, f.is_fi_select, f.fi_star_rating,
      ue.calculator_type,
      TRY_CAST(ue.calc_input_amount AS DOUBLE) AS calc_input_amount,
      TRY_CAST(ue.calc_result_amount AS DOUBLE) AS calc_result_amount,
      ue.article_slug, ue.campaign_type, ue.search_query,
      TRY_CAST(ue.amount_inr AS DOUBLE) AS amount_inr,
      CASE WHEN TRY_CAST(ue.amount_inr AS DOUBLE) IS NULL THEN NULL
           WHEN TRY_CAST(ue.amount_inr AS DOUBLE) < 2000 THEN '<2K'
           WHEN TRY_CAST(ue.amount_inr AS DOUBLE) < 5000 THEN '2-5K'
           WHEN TRY_CAST(ue.amount_inr AS DOUBLE) < 15000 THEN '5-15K'
           ELSE '>15K' END AS amount_range,
      ue.sip_id, ue.goal_type, ue.step_name, ue.drop_reason,
      i.city_tier, i.risk_profile, i.occupation, i.acquisition_channel,
      i.annual_income, i.state, i.city, i.gender, i.age,
      i.investor_type, i.kyc_status, i.kyc_method, i.bank_name, i.bank_link_method,
      i.signup_date, i.bank_verified_date, i.account_activated_date
    FROM raw_user_events ue
    LEFT JOIN raw_funds f ON ue.fund_id = f.fund_id
    LEFT JOIN raw_investors i ON ue.investor_id = i.investor_id`,

    `CREATE OR REPLACE VIEW systematic_plans_full AS
    SELECT
      sp.plan_id, sp.investor_id, sp.plan_type, sp.source_fund_id, sp.target_fund_id,
      sp.amount_inr, sp.frequency, sp.start_date, sp.end_date, sp.status,
      sp.installments_completed,
      CASE WHEN sp.amount_inr < 5000 THEN '<5K'
           WHEN sp.amount_inr < 15000 THEN '5-15K'
           WHEN sp.amount_inr < 50000 THEN '15-50K'
           ELSE '>50K' END AS amount_range,
      sf.fund_name AS source_fund_name,
      sf.amc_name AS source_amc_name,
      sf.category AS source_fund_category,
      sf.subcategory AS source_fund_subcategory,
      tf.fund_name AS target_fund_name,
      tf.amc_name AS target_amc_name,
      tf.category AS target_fund_category,
      tf.subcategory AS target_fund_subcategory,
      i.city_tier, i.risk_profile, i.occupation, i.acquisition_channel,
      i.annual_income, i.state, i.city, i.gender, i.age,
      i.investor_type, i.kyc_status, i.kyc_method, i.bank_name, i.bank_link_method
    FROM raw_systematic_plans sp
    LEFT JOIN raw_funds sf ON sp.source_fund_id = sf.fund_id
    LEFT JOIN raw_funds tf ON sp.target_fund_id = tf.fund_id
    LEFT JOIN raw_investors i ON sp.investor_id = i.investor_id`,

    `CREATE OR REPLACE VIEW investor_investment_history AS
    SELECT
      t.investor_id,
      t.txn_id AS activity_id,
      'transaction' AS activity_source,
      t.txn_type AS activity_type,
      'mutual_fund' AS product_type,
      t.fund_name AS product_name,
      CAST(t.txn_date AS TIMESTAMP) AS activity_timestamp,
      t.txn_date AS activity_date,
      CASE WHEN t.txn_type = 'redemption' THEN 'outflow'
           WHEN t.status = 'failed' THEN 'failed'
           WHEN t.status = 'pending' THEN 'pending'
           ELSE 'inflow' END AS cashflow_direction,
      t.status,
      t.amount_inr,
      t.units,
      t.nav_at_txn,
      t.fund_id,
      t.fund_name,
      t.amc_name,
      t.fund_category,
      t.fund_subcategory,
      t.risk_level,
      t.is_fi_select,
      t.fi_star_rating,
      t.sip_id,
      t.goal_id,
      CAST(NULL AS VARCHAR) AS plan_id,
      t.channel,
      t.payment_mode,
      t.city_tier,
      t.risk_profile,
      t.acquisition_channel,
      t.annual_income,
      t.state,
      t.city,
      t.gender,
      t.age,
      CAST(NULL AS VARCHAR) AS target_fund_id,
      CAST(NULL AS VARCHAR) AS target_fund_name,
      CAST(NULL AS VARCHAR) AS target_amc_name,
      CAST(NULL AS VARCHAR) AS target_fund_category,
      CAST(NULL AS VARCHAR) AS target_fund_subcategory
    FROM transactions_full t
    UNION ALL
    SELECT
      s.investor_id,
      s.sip_id AS activity_id,
      'sip' AS activity_source,
      'sip_created' AS activity_type,
      'sip' AS product_type,
      s.fund_name AS product_name,
      CAST(s.start_date AS TIMESTAMP) AS activity_timestamp,
      s.start_date AS activity_date,
      'setup' AS cashflow_direction,
      s.status,
      s.amount_inr,
      CAST(NULL AS DOUBLE) AS units,
      CAST(NULL AS DOUBLE) AS nav_at_txn,
      s.fund_id,
      s.fund_name,
      s.amc_name,
      s.fund_category,
      s.fund_subcategory,
      s.risk_level,
      s.is_fi_select,
      s.fi_star_rating,
      s.sip_id,
      CAST(NULL AS VARCHAR) AS goal_id,
      CAST(NULL AS VARCHAR) AS plan_id,
      CAST(NULL AS VARCHAR) AS channel,
      s.mandate_type AS payment_mode,
      s.city_tier,
      s.risk_profile,
      s.acquisition_channel,
      s.annual_income,
      s.state,
      s.city,
      s.gender,
      s.age,
      CAST(NULL AS VARCHAR) AS target_fund_id,
      CAST(NULL AS VARCHAR) AS target_fund_name,
      CAST(NULL AS VARCHAR) AS target_amc_name,
      CAST(NULL AS VARCHAR) AS target_fund_category,
      CAST(NULL AS VARCHAR) AS target_fund_subcategory
    FROM sips_full s
    UNION ALL
    SELECT
      s.investor_id,
      s.sip_id AS activity_id,
      'sip' AS activity_source,
      CASE WHEN s.status = 'cancelled' THEN 'sip_cancelled'
           WHEN s.status = 'paused' THEN 'sip_paused'
           ELSE 'sip_ended' END AS activity_type,
      'sip' AS product_type,
      s.fund_name AS product_name,
      CAST(s.end_date AS TIMESTAMP) AS activity_timestamp,
      s.end_date AS activity_date,
      'status_change' AS cashflow_direction,
      s.status,
      s.amount_inr,
      CAST(NULL AS DOUBLE) AS units,
      CAST(NULL AS DOUBLE) AS nav_at_txn,
      s.fund_id,
      s.fund_name,
      s.amc_name,
      s.fund_category,
      s.fund_subcategory,
      s.risk_level,
      s.is_fi_select,
      s.fi_star_rating,
      s.sip_id,
      CAST(NULL AS VARCHAR) AS goal_id,
      CAST(NULL AS VARCHAR) AS plan_id,
      CAST(NULL AS VARCHAR) AS channel,
      s.mandate_type AS payment_mode,
      s.city_tier,
      s.risk_profile,
      s.acquisition_channel,
      s.annual_income,
      s.state,
      s.city,
      s.gender,
      s.age,
      CAST(NULL AS VARCHAR) AS target_fund_id,
      CAST(NULL AS VARCHAR) AS target_fund_name,
      CAST(NULL AS VARCHAR) AS target_amc_name,
      CAST(NULL AS VARCHAR) AS target_fund_category,
      CAST(NULL AS VARCHAR) AS target_fund_subcategory
    FROM sips_full s
    WHERE s.end_date IS NOT NULL
    UNION ALL
    SELECT
      sp.investor_id,
      sp.plan_id AS activity_id,
      'systematic_plan' AS activity_source,
      sp.plan_type || '_started' AS activity_type,
      sp.plan_type AS product_type,
      CASE
        WHEN sp.target_fund_name IS NOT NULL THEN sp.source_fund_name || ' -> ' || sp.target_fund_name
        ELSE sp.source_fund_name
      END AS product_name,
      CAST(sp.start_date AS TIMESTAMP) AS activity_timestamp,
      sp.start_date AS activity_date,
      'setup' AS cashflow_direction,
      sp.status,
      sp.amount_inr,
      CAST(NULL AS DOUBLE) AS units,
      CAST(NULL AS DOUBLE) AS nav_at_txn,
      sp.source_fund_id AS fund_id,
      sp.source_fund_name AS fund_name,
      sp.source_amc_name AS amc_name,
      sp.source_fund_category AS fund_category,
      sp.source_fund_subcategory AS fund_subcategory,
      CAST(NULL AS VARCHAR) AS risk_level,
      CAST(NULL AS BOOLEAN) AS is_fi_select,
      CAST(NULL AS INTEGER) AS fi_star_rating,
      CAST(NULL AS VARCHAR) AS sip_id,
      CAST(NULL AS VARCHAR) AS goal_id,
      sp.plan_id,
      CAST(NULL AS VARCHAR) AS channel,
      CAST(NULL AS VARCHAR) AS payment_mode,
      sp.city_tier,
      sp.risk_profile,
      sp.acquisition_channel,
      sp.annual_income,
      sp.state,
      sp.city,
      sp.gender,
      sp.age,
      sp.target_fund_id,
      sp.target_fund_name,
      sp.target_amc_name,
      sp.target_fund_category,
      sp.target_fund_subcategory
    FROM systematic_plans_full sp
    UNION ALL
    SELECT
      sp.investor_id,
      sp.plan_id AS activity_id,
      'systematic_plan' AS activity_source,
      sp.plan_type || '_' || sp.status AS activity_type,
      sp.plan_type AS product_type,
      CASE
        WHEN sp.target_fund_name IS NOT NULL THEN sp.source_fund_name || ' -> ' || sp.target_fund_name
        ELSE sp.source_fund_name
      END AS product_name,
      CAST(sp.end_date AS TIMESTAMP) AS activity_timestamp,
      sp.end_date AS activity_date,
      'status_change' AS cashflow_direction,
      sp.status,
      sp.amount_inr,
      CAST(NULL AS DOUBLE) AS units,
      CAST(NULL AS DOUBLE) AS nav_at_txn,
      sp.source_fund_id AS fund_id,
      sp.source_fund_name AS fund_name,
      sp.source_amc_name AS amc_name,
      sp.source_fund_category AS fund_category,
      sp.source_fund_subcategory AS fund_subcategory,
      CAST(NULL AS VARCHAR) AS risk_level,
      CAST(NULL AS BOOLEAN) AS is_fi_select,
      CAST(NULL AS INTEGER) AS fi_star_rating,
      CAST(NULL AS VARCHAR) AS sip_id,
      CAST(NULL AS VARCHAR) AS goal_id,
      sp.plan_id,
      CAST(NULL AS VARCHAR) AS channel,
      CAST(NULL AS VARCHAR) AS payment_mode,
      sp.city_tier,
      sp.risk_profile,
      sp.acquisition_channel,
      sp.annual_income,
      sp.state,
      sp.city,
      sp.gender,
      sp.age,
      sp.target_fund_id,
      sp.target_fund_name,
      sp.target_amc_name,
      sp.target_fund_category,
      sp.target_fund_subcategory
    FROM systematic_plans_full sp
    WHERE sp.end_date IS NOT NULL`,

    `CREATE OR REPLACE VIEW investor_fund_positions AS
    WITH cashflows AS (
      SELECT
        investor_id,
        fund_id,
        fund_name,
        amc_name,
        fund_category,
        fund_subcategory,
        risk_level,
        is_fi_select,
        fi_star_rating,
        city_tier,
        risk_profile,
        acquisition_channel,
        annual_income,
        state,
        city,
        gender,
        age,
        MIN(activity_date) FILTER (
          WHERE activity_type IN ('sip_installment','lumpsum','stp_purchase') AND status = 'success'
        ) AS first_purchase_date,
        MAX(activity_date) FILTER (
          WHERE activity_type IN ('sip_installment','lumpsum','stp_purchase') AND status = 'success'
        ) AS last_purchase_date,
        MAX(activity_date) AS last_activity_date,
        MAX(activity_date) FILTER (
          WHERE activity_type = 'redemption' AND status = 'success'
        ) AS last_redemption_date,
        COUNT(*) FILTER (
          WHERE activity_type IN ('sip_installment','lumpsum','stp_purchase') AND status = 'success'
        ) AS purchase_count,
        COUNT(*) FILTER (
          WHERE activity_type = 'sip_installment' AND status = 'success'
        ) AS sip_installment_count,
        COUNT(*) FILTER (
          WHERE activity_type = 'lumpsum' AND status = 'success'
        ) AS lumpsum_count,
        COUNT(*) FILTER (
          WHERE activity_type = 'stp_purchase' AND status = 'success'
        ) AS stp_purchase_count,
        COUNT(*) FILTER (
          WHERE activity_type = 'redemption' AND status = 'success'
        ) AS redemption_count,
        COUNT(DISTINCT sip_id) FILTER (
          WHERE activity_type = 'sip_installment' AND status = 'success' AND sip_id IS NOT NULL
        ) AS linked_sip_count,
        SUM(CASE
          WHEN activity_type IN ('sip_installment','lumpsum','stp_purchase') AND status = 'success' THEN COALESCE(amount_inr, 0)
          ELSE 0
        END) AS gross_purchased_inr,
        SUM(CASE
          WHEN activity_type = 'redemption' AND status = 'success' THEN COALESCE(amount_inr, 0)
          ELSE 0
        END) AS redeemed_inr,
        SUM(CASE
          WHEN activity_type IN ('sip_installment','lumpsum','stp_purchase') AND status = 'success' THEN COALESCE(amount_inr, 0)
          WHEN activity_type = 'redemption' AND status = 'success' THEN -COALESCE(amount_inr, 0)
          ELSE 0
        END) AS net_invested_inr,
        SUM(CASE
          WHEN activity_type IN ('sip_installment','lumpsum','stp_purchase') AND status = 'success' THEN COALESCE(units, 0)
          ELSE 0
        END) AS gross_units_purchased,
        SUM(CASE
          WHEN activity_type = 'redemption' AND status = 'success' THEN COALESCE(units, 0)
          ELSE 0
        END) AS redeemed_units,
        SUM(CASE
          WHEN activity_type IN ('sip_installment','lumpsum','stp_purchase') AND status = 'success' THEN COALESCE(units, 0)
          WHEN activity_type = 'redemption' AND status = 'success' THEN -COALESCE(units, 0)
          ELSE 0
        END) AS net_units,
        BOOL_OR(activity_type = 'sip_installment' AND status = 'success') AS has_sip_investment,
        BOOL_OR(activity_type = 'lumpsum' AND status = 'success') AS has_lumpsum_investment,
        BOOL_OR(activity_type = 'stp_purchase' AND status = 'success') AS has_stp_investment
      FROM investor_investment_history
      WHERE activity_source = 'transaction' AND fund_id IS NOT NULL
      GROUP BY
        investor_id, fund_id, fund_name, amc_name, fund_category, fund_subcategory,
        risk_level, is_fi_select, fi_star_rating, city_tier, risk_profile,
        acquisition_channel, annual_income, state, city, gender, age
    )
    SELECT
      *,
      gross_purchased_inr > 0 AS has_purchase_in_window,
      redeemed_inr > 0 AS has_redemption_in_window,
      net_units > 0 AND net_invested_inr > 0 AS is_current_holding,
      CASE
        WHEN net_units > 0 AND net_invested_inr > 0 AND redeemed_inr > 0 THEN 'current_reduced'
        WHEN net_units > 0 AND net_invested_inr > 0 THEN 'current'
        WHEN gross_purchased_inr = 0 AND redeemed_inr > 0 THEN 'redemption_only_prior_position'
        WHEN gross_purchased_inr > 0 AND redeemed_inr > 0 THEN 'fully_redeemed'
        WHEN gross_purchased_inr > 0 THEN 'purchased_no_current_units'
        ELSE 'unknown'
      END AS position_status,
      CASE
        WHEN net_invested_inr <= 0 THEN 'zero_or_negative'
        WHEN net_invested_inr < 10000 THEN '<10K'
        WHEN net_invested_inr < 50000 THEN '10-50K'
        WHEN net_invested_inr < 200000 THEN '50K-2L'
        ELSE '>2L'
      END AS position_size_bucket,
      linked_sip_count > 0 AS is_sip_linked,
      purchase_count >= 5 AS is_repeat_buyer
    FROM cashflows
    WHERE gross_purchased_inr > 0 OR redeemed_inr > 0`,

    `CREATE OR REPLACE VIEW investor_portfolio_summary AS
    WITH base AS (
      SELECT
        investor_id,
        MIN(city_tier) AS city_tier,
        MIN(risk_profile) AS risk_profile,
        MIN(acquisition_channel) AS acquisition_channel,
        MIN(annual_income) AS annual_income,
        MIN(state) AS state,
        MIN(city) AS city,
        MIN(gender) AS gender,
        MIN(age) AS age,
        MIN(first_purchase_date) AS first_purchase_date,
        MAX(last_purchase_date) AS last_purchase_date,
        MAX(last_activity_date) AS last_activity_date,
        MAX(last_redemption_date) AS last_redemption_date,
        COUNT(*) AS position_count,
        COUNT(*) FILTER (WHERE is_current_holding) AS current_fund_count,
        COUNT(DISTINCT fund_category) FILTER (WHERE is_current_holding) AS current_category_count,
        COUNT(DISTINCT amc_name) FILTER (WHERE is_current_holding) AS current_amc_count,
        COUNT(DISTINCT fund_id) FILTER (WHERE has_purchase_in_window) AS ever_bought_fund_count,
        SUM(purchase_count) AS purchase_count,
        SUM(sip_installment_count) AS sip_installment_count,
        SUM(lumpsum_count) AS lumpsum_count,
        SUM(stp_purchase_count) AS stp_purchase_count,
        SUM(redemption_count) AS redemption_count,
        SUM(gross_purchased_inr) AS gross_purchased_inr,
        SUM(redeemed_inr) AS redeemed_inr,
        SUM(net_invested_inr) AS net_activity_inr,
        SUM(CASE WHEN is_current_holding THEN net_invested_inr ELSE 0 END) AS net_invested_inr,
        SUM(CASE WHEN is_current_holding THEN net_units ELSE 0 END) AS net_units,
        COUNT(*) FILTER (WHERE is_current_holding AND is_fi_select = true) AS fi_select_current_count,
        COUNT(*) FILTER (WHERE is_current_holding AND fund_category = 'elss') AS elss_current_count,
        COUNT(*) FILTER (WHERE is_current_holding AND fund_category = 'equity') AS equity_current_count,
        COUNT(*) FILTER (WHERE is_current_holding AND fund_category = 'debt') AS debt_current_count,
        COUNT(*) FILTER (WHERE is_current_holding AND fund_category = 'liquid') AS liquid_current_count,
        COUNT(*) FILTER (WHERE is_current_holding AND is_sip_linked = true) AS sip_linked_current_count,
        COUNT(*) FILTER (WHERE is_current_holding AND is_repeat_buyer = true) AS repeat_position_count
      FROM investor_fund_positions
      GROUP BY investor_id
    ),
    dominant_category AS (
      SELECT investor_id, fund_category AS dominant_current_category
      FROM (
        SELECT
          investor_id,
          fund_category,
          ROW_NUMBER() OVER (
            PARTITION BY investor_id
            ORDER BY SUM(net_invested_inr) DESC, fund_category
          ) AS rn
        FROM investor_fund_positions
        WHERE is_current_holding
        GROUP BY investor_id, fund_category
      ) ranked_categories
      WHERE rn = 1
    ),
    dominant_amc AS (
      SELECT investor_id, amc_name AS dominant_current_amc
      FROM (
        SELECT
          investor_id,
          amc_name,
          ROW_NUMBER() OVER (
            PARTITION BY investor_id
            ORDER BY SUM(net_invested_inr) DESC, amc_name
          ) AS rn
        FROM investor_fund_positions
        WHERE is_current_holding
        GROUP BY investor_id, amc_name
      ) ranked_amcs
      WHERE rn = 1
    )
    SELECT
      b.*,
      dc.dominant_current_category,
      da.dominant_current_amc,
      current_fund_count > 0 AS has_current_holding,
      gross_purchased_inr > 0 AS has_purchase_in_window,
      redeemed_inr > 0 AS has_redemption_in_window,
      fi_select_current_count > 0 AS has_fi_select_holding,
      elss_current_count > 0 AS has_elss_holding,
      sip_linked_current_count > 0 AS has_sip_linked_holding,
      CASE
        WHEN current_fund_count > 0 AND redeemed_inr > 0 THEN 'active_with_redemptions'
        WHEN current_fund_count > 0 THEN 'active'
        WHEN gross_purchased_inr > 0 AND redeemed_inr > 0 THEN 'fully_redeemed'
        WHEN gross_purchased_inr = 0 AND redeemed_inr > 0 THEN 'redemption_only_prior_positions'
        ELSE 'inactive'
      END AS portfolio_status,
      CASE
        WHEN net_invested_inr <= 0 THEN 'zero_or_negative'
        WHEN net_invested_inr < 10000 THEN '<10K'
        WHEN net_invested_inr < 50000 THEN '10-50K'
        WHEN net_invested_inr < 200000 THEN '50K-2L'
        ELSE '>2L'
      END AS portfolio_value_bucket,
      CASE
        WHEN current_fund_count = 0 THEN '0'
        WHEN current_fund_count = 1 THEN '1 fund'
        WHEN current_fund_count = 2 THEN '2 funds'
        WHEN current_fund_count = 3 THEN '3 funds'
        WHEN current_fund_count = 4 THEN '4 funds'
        WHEN current_fund_count = 5 THEN '5 funds'
        ELSE '6+ funds'
      END AS portfolio_breadth_bucket
    FROM base b
    LEFT JOIN dominant_category dc ON b.investor_id = dc.investor_id
    LEFT JOIN dominant_amc da ON b.investor_id = da.investor_id`,

    `CREATE OR REPLACE VIEW fund_position_summary AS
    WITH aggregate_positions AS (
      SELECT
        fund_id,
        fund_name,
        amc_name,
        fund_category,
        fund_subcategory,
        risk_level,
        is_fi_select,
        fi_star_rating,
        MIN(first_purchase_date) AS first_purchase_date,
        MAX(last_purchase_date) AS last_purchase_date,
        MAX(last_activity_date) AS last_activity_date,
        MAX(last_redemption_date) AS last_redemption_date,
        COUNT(*) AS user_fund_positions,
        COUNT(DISTINCT investor_id) AS investors_with_position_history,
        COUNT(DISTINCT investor_id) FILTER (WHERE has_purchase_in_window) AS buyers,
        COUNT(DISTINCT investor_id) FILTER (WHERE is_current_holding) AS current_holders,
        COUNT(DISTINCT investor_id) FILTER (WHERE has_redemption_in_window) AS redeemers,
        COUNT(DISTINCT investor_id) FILTER (WHERE is_sip_linked AND is_current_holding) AS sip_linked_holders,
        COUNT(DISTINCT investor_id) FILTER (WHERE has_lumpsum_investment AND is_current_holding) AS lumpsum_holders,
        COUNT(DISTINCT investor_id) FILTER (WHERE has_stp_investment AND is_current_holding) AS stp_holders,
        COUNT(DISTINCT investor_id) FILTER (WHERE is_repeat_buyer AND is_current_holding) AS repeat_buyers,
        SUM(purchase_count) AS purchase_count,
        SUM(redemption_count) AS redemption_count,
        SUM(gross_purchased_inr) AS gross_purchased_inr,
        SUM(redeemed_inr) AS redeemed_inr,
        SUM(CASE WHEN is_current_holding THEN net_invested_inr ELSE 0 END) AS net_invested_inr,
        SUM(CASE WHEN is_current_holding THEN net_units ELSE 0 END) AS net_units
      FROM investor_fund_positions
      GROUP BY
        fund_id, fund_name, amc_name, fund_category, fund_subcategory,
        risk_level, is_fi_select, fi_star_rating
    )
    SELECT
      *,
      current_holders > 0 AS has_current_holders,
      CASE
        WHEN current_holders > 0 AND redeemers > 0 THEN 'active_with_redemptions'
        WHEN current_holders > 0 THEN 'active'
        WHEN buyers > 0 AND redeemers > 0 THEN 'fully_redeemed'
        WHEN buyers = 0 AND redeemers > 0 THEN 'redemption_only_prior_positions'
        ELSE 'inactive'
      END AS fund_position_status,
      CASE
        WHEN current_holders = 0 THEN '0'
        WHEN current_holders < 100 THEN '<100'
        WHEN current_holders < 500 THEN '100-499'
        WHEN current_holders < 1000 THEN '500-999'
        ELSE '1000+'
      END AS holder_bucket,
      CASE
        WHEN net_invested_inr <= 0 THEN 'zero_or_negative'
        WHEN net_invested_inr < 1000000 THEN '<10L'
        WHEN net_invested_inr < 10000000 THEN '10L-1Cr'
        WHEN net_invested_inr < 50000000 THEN '1-5Cr'
        ELSE '>5Cr'
      END AS net_invested_bucket
    FROM aggregate_positions`,
  ];
}
