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
  eventType: string,
  category: string,
  options: Partial<Omit<EventDefinition, "id" | "displayName" | "table" | "dateColumn" | "filterColumn" | "filterValue" | "category">> = {},
): EventDefinition {
  return e({
    id,
    displayName,
    category,
    table: "user_events_full",
    dateColumn: "event_timestamp",
    filterColumn: "event_type",
    filterValue: eventType,
    properties: USER_EVENT_PROPERTIES,
    ...options,
  });
}

const CUSTOMER_CORE_PROPERTIES = [
  prop("city_tier", "City Tier"),
  prop("city", "City", "string", "medium"),
  prop("state", "State", "string", "medium"),
  prop("archetype", "Customer Archetype"),
  prop("customer_lifecycle_stage", "Lifecycle Stage"),
  prop("ltv_bucket", "LTV Bucket"),
  prop("acquisition_channel", "Acquisition Source"),
  prop("age_group", "Age Group"),
  prop("customer_gender", "Customer Gender"),
  prop("chronic_condition", "Health Condition"),
];

const CUSTOMER_PROFILE_PROPERTIES = [
  prop("install_platform", "Install Platform"),
  prop("device_model_tier", "Device Tier"),
  prop("health_goal", "Health Goal", "string", "medium"),
  prop("primary_health_concern", "Primary Health Concern", "string", "medium"),
  prop("bmi_category", "BMI Category"),
  prop("smoking_status", "Smoking Status"),
  prop("alcohol_consumption", "Alcohol Consumption"),
  prop("exercise_frequency", "Exercise Frequency"),
  prop("family_history", "Family History"),
  prop("on_regular_medication", "On Regular Medication"),
  prop("insurance_provider", "Insurance Provider", "string", "medium"),
  prop("insurance_linked_to_healthians", "Insurance Linked"),
  prop("books_primarily_for", "Books Primarily For"),
  prop("subscription_active", "Subscription Active"),
  prop("push_opt_in", "Push Opt In"),
  prop("whatsapp_opt_in", "WhatsApp Opt In"),
];

const HEALTH_STATUS_PROPERTIES = [
  prop("vitamin_d_status", "Vitamin D Status"),
  prop("vitamin_b12_status", "Vitamin B12 Status"),
  prop("thyroid_status", "Thyroid Status"),
  prop("glucose_status", "Glucose Status"),
  prop("cholesterol_status", "Cholesterol Status"),
  prop("hemoglobin_status", "Hemoglobin Status"),
];

const BOOKING_PROPERTIES = uniqueProperties(
  CUSTOMER_CORE_PROPERTIES,
  [
    prop("primary_test_category", "Test Category", "string", "medium"),
    prop("test_slug", "Test", "string", "medium"),
    prop("booking_channel", "Booking Channel"),
    prop("slot_band", "Slot Time"),
    prop("payment_method", "Payment Method"),
    prop("patient_relationship", "Patient Relationship"),
    prop("patient_gender", "Patient Gender"),
    prop("persons_in_booking", "Persons In Booking", "number"),
    prop("is_family_bundle", "Family Bundle"),
    prop("is_first_booking", "First Booking"),
    prop("is_prescription_driven", "Prescription Driven"),
    prop("is_subscription_run", "Subscription Run"),
    prop("booking_status", "Booking Status"),
    prop("price_bucket", "Price Bucket"),
    prop("fee_bucket", "Consumables Fee Bucket"),
    prop("coupon_bucket", "Coupon Bucket"),
    prop("delay_bucket", "Delay Bucket"),
    prop("tat_bucket", "TAT Bucket"),
  ],
  HEALTH_STATUS_PROPERTIES,
);

const TEST_PROPERTIES = uniqueProperties(
  [
    prop("test_category", "Test Category", "string", "medium"),
    prop("test_slug", "Test", "string", "medium"),
    prop("test_name", "Test Name", "string", "medium"),
    prop("item_type", "Item Type"),
    prop("parameters_count", "Parameters Count", "number", "medium"),
    prop("item_price_bucket", "Item Price Bucket"),
  ],
  CUSTOMER_CORE_PROPERTIES,
);

const USER_EVENT_PROPERTIES = uniqueProperties(
  [
    prop("platform", "Platform"),
    prop("channel", "Channel", "string", "medium"),
    prop("event_category", "Event Category", "string", "medium"),
    prop("test_slug", "Test", "string", "medium"),
    prop("slot_band", "Slot Time"),
    prop("payment_method", "Payment Method"),
    prop("amount_bucket", "Amount Bucket"),
    prop("fee_bucket", "Fee Bucket"),
    prop("campaign_type", "Campaign Type", "string", "medium"),
    prop("source", "Source", "string", "medium"),
    prop("on_time", "On Time"),
  ],
  CUSTOMER_CORE_PROPERTIES,
);

const REPORT_PROPERTIES = uniqueProperties(
  CUSTOMER_CORE_PROPERTIES,
  [
    prop("health_score_category", "Health Score"),
    prop("report_view_platform", "Report View Platform"),
    prop("notification_channels", "Notification Channels", "string", "medium"),
    prop("primary_test_category", "Test Category", "string", "medium"),
    prop("test_slug", "Test", "string", "medium"),
    prop("booking_channel", "Booking Channel"),
    prop("slot_band", "Slot Time"),
    prop("critical_bucket", "Critical Count"),
    prop("abnormal_bucket", "Abnormal Count"),
    prop("tat_breach", "TAT Breach"),
    prop("on_time", "On Time"),
  ],
);

const CLINICAL_PROPERTIES = uniqueProperties(
  CUSTOMER_CORE_PROPERTIES,
  [
    prop("test_slug", "Test", "string", "medium"),
    prop("parameter_name", "Parameter", "string", "medium"),
    prop("status", "Result Status"),
    prop("is_critical", "Critical"),
    prop("is_borderline", "Borderline"),
    prop("is_abnormal", "Abnormal"),
    prop("primary_test_category", "Booking Test Category", "string", "medium"),
  ],
  HEALTH_STATUS_PROPERTIES,
);

const OPS_PROPERTIES = uniqueProperties(
  CUSTOMER_CORE_PROPERTIES,
  [
    prop("slot_band", "Slot Time"),
    prop("booking_channel", "Booking Channel"),
    prop("primary_test_category", "Test Category", "string", "medium"),
    prop("on_time", "On Time"),
    prop("no_show", "No Show"),
    prop("sample_rejected", "Sample Rejected"),
    prop("rejection_reason", "Rejection Reason"),
    prop("delay_bucket", "Delay Bucket"),
    prop("tat_bucket", "TAT Bucket"),
    prop("tat_breach", "TAT Breach"),
  ],
);

const SAMPLE_PROPERTIES = uniqueProperties(
  CUSTOMER_CORE_PROPERTIES,
  [
    prop("primary_test_category", "Test Category", "string", "medium"),
    prop("test_slug", "Test", "string", "medium"),
    prop("booking_channel", "Booking Channel"),
    prop("slot_band", "Slot Time"),
    prop("lab_id", "Lab", "string", "medium"),
    prop("transit_route", "Transit Route"),
    prop("qc_status", "QC Status"),
    prop("rejection_reason", "Rejection Reason"),
    prop("tat_sla_met", "TAT SLA Met"),
    prop("temperature_breach", "Temperature Breach"),
  ],
);

const PHLEB_PROPERTIES = uniqueProperties(
  CUSTOMER_CORE_PROPERTIES,
  [
    prop("phleb_city", "Phlebotomist City", "string", "medium"),
    prop("phleb_tier", "Phlebotomist City Tier"),
    prop("certification_level", "Certification Level"),
    prop("rating", "Rating", "number"),
    prop("review_text_sentiment", "Review Sentiment"),
    prop("communication_issue", "Communication Issue"),
    prop("customer_request_repeated", "Customer Requested Repeat"),
    prop("delay_bucket", "Delay Bucket"),
    prop("slot_band", "Slot Time"),
  ],
);

const COMMS_PROPERTIES = uniqueProperties(
  [
    prop("channel", "Channel"),
    prop("campaign_type", "Campaign Type", "string", "medium"),
    prop("user_segment_at_send", "User Segment"),
    prop("delivered", "Delivered"),
    prop("opened", "Opened"),
    prop("clicked", "Clicked"),
    prop("converted", "Converted"),
    prop("send_cost_bucket", "Send Cost Bucket"),
  ],
  CUSTOMER_CORE_PROPERTIES,
);

const COUNSELING_PROPERTIES = uniqueProperties(
  CUSTOMER_CORE_PROPERTIES,
  [
    prop("counselor_type", "Counselor Type"),
    prop("outcome", "Outcome"),
    prop("follow_up_recommended", "Follow-up Recommended"),
    prop("satisfaction_score", "Satisfaction Score", "number"),
    prop("duration_bucket", "Duration Bucket"),
  ],
);

const FUTURE_TEST_PROPERTIES = uniqueProperties(
  CUSTOMER_CORE_PROPERTIES,
  [
    prop("test_slug", "Recommended Test", "string", "medium"),
    prop("recommended_frequency", "Test Frequency"),
    prop("recommended_by", "Recommended By"),
    prop("booked_within_window", "Booked Within Window"),
    prop("health_score_category", "Health Score"),
  ],
);

const SUBSCRIPTION_PROPERTIES = uniqueProperties(
  CUSTOMER_CORE_PROPERTIES,
  [
    prop("test_slug", "Subscription Test", "string", "medium"),
    prop("status", "Subscription Status"),
    prop("frequency_bucket", "Frequency"),
    prop("adherence_bucket", "Adherence Bucket"),
  ],
);

const SUBSCRIPTION_RUN_PROPERTIES = uniqueProperties(
  CUSTOMER_CORE_PROPERTIES,
  [
    prop("test_slug", "Subscription Test", "string", "medium"),
    prop("subscription_status", "Subscription Status"),
    prop("run_status", "Run Status"),
    prop("days_late_bucket", "Days Late Bucket"),
  ],
);

const SUPPORT_PROPERTIES = uniqueProperties(
  CUSTOMER_CORE_PROPERTIES,
  [
    prop("channel", "Support Channel"),
    prop("category", "Issue Category"),
    prop("root_cause", "Root Cause"),
    prop("resolution", "Resolution"),
    prop("escalated", "Escalated"),
    prop("resolution_bucket", "Resolution Time"),
    prop("nps_after_resolution_bucket", "NPS After Resolution"),
  ],
);

const NPS_PROPERTIES = uniqueProperties(
  CUSTOMER_CORE_PROPERTIES,
  [
    prop("nps_category", "NPS Category"),
    prop("score_bucket", "NPS Score"),
    prop("booking_channel", "Booking Channel"),
    prop("primary_test_category", "Test Category", "string", "medium"),
  ],
);

const LEAD_PROPERTIES = uniqueProperties(
  CUSTOMER_CORE_PROPERTIES,
  [
    prop("lead_type", "Lead Type"),
    prop("source_type", "Source Type"),
    prop("outcome", "Lead Outcome"),
    prop("test_context_slug", "Test Context", "string", "medium"),
    prop("consent_given", "Consent Given"),
  ],
);

const LIFESTYLE_PROPERTIES = uniqueProperties(
  CUSTOMER_CORE_PROPERTIES,
  [
    prop("bmi_category", "BMI Category"),
    prop("physical_activity_freq", "Physical Activity"),
    prop("smoking_status", "Smoking Status"),
    prop("food_preference", "Food Preference"),
    prop("alcohol_consumption", "Alcohol Consumption"),
    prop("family_history", "Family History"),
    prop("current_medications", "Current Medication", "string", "medium"),
  ],
);

export const EXPANDED_HEALTHIANS_EVENTS: EventDefinition[] = [
  // Acquisition and discovery
  e({ id: "customer_signup", displayName: "Customer Signed Up", category: "Acquisition", table: "customers_full", dateColumn: "signup_date", properties: uniqueProperties(CUSTOMER_CORE_PROPERTIES, CUSTOMER_PROFILE_PROPERTIES, HEALTH_STATUS_PROPERTIES) }),
  e({ id: "lifestyle_profile_completed", displayName: "Lifestyle Profile Completed", category: "Acquisition", table: "lifestyle_profiles_full", dateColumn: "questionnaire_date", properties: LIFESTYLE_PROPERTIES }),
  userEvent("web_visit", "Web Visit", "web_visit", "Acquisition"),
  userEvent("app_opened", "App Opened", "app_opened", "Acquisition"),
  userEvent("category_browsed", "Category Browsed", "category_browsed", "Discovery"),
  userEvent("test_page_viewed", "Test Page Viewed", "test_page_viewed", "Discovery"),
  userEvent("book_now_clicked", "Book Now Clicked", "book_now_clicked", "Discovery"),
  userEvent("book_now_tapped", "Book Now Tapped", "book_now_tapped", "Discovery"),
  userEvent("lead_form_submitted", "Lead Form Submitted", "lead_form_submitted", "Leads"),
  e({ id: "lead_created", displayName: "Lead Created", category: "Leads", table: "leads_full", dateColumn: "submitted_at", properties: LEAD_PROPERTIES }),
  e({ id: "lead_booked", displayName: "Lead Converted to Booking", category: "Leads", table: "leads_full", dateColumn: "submitted_at", filterSQL: "outcome = 'booked'", properties: LEAD_PROPERTIES }),
  e({ id: "consented_lead", displayName: "Consented Lead", category: "Leads", table: "leads_full", dateColumn: "submitted_at", filterSQL: "consent_given = true", properties: LEAD_PROPERTIES }),
  userEvent("otp_verified", "OTP Verified", "otp_verified", "Checkout"),
  userEvent("slot_selected", "Slot Selected", "slot_selected", "Checkout"),
  userEvent("consumables_fee_revealed", "Consumables Fee Revealed", "consumables_fee_revealed", "Checkout", { valueColumn: "fee_inr" }),

  // Booking and revenue
  e({ id: "booking", displayName: "Booking Placed", category: "Bookings", table: "bookings_full", dateColumn: "booking_date", valueColumn: "total_paid_inr", properties: BOOKING_PROPERTIES }),
  e({ id: "first_booking", displayName: "First Booking", category: "Bookings", table: "bookings_full", dateColumn: "booking_date", filterSQL: "is_first_booking = true", valueColumn: "total_paid_inr", properties: BOOKING_PROPERTIES }),
  e({ id: "repeat_booking", displayName: "Repeat Booking", category: "Bookings", table: "bookings_full", dateColumn: "booking_date", filterSQL: "is_first_booking = false", valueColumn: "total_paid_inr", properties: BOOKING_PROPERTIES }),
  e({ id: "completed_booking", displayName: "Booking Completed", category: "Bookings", table: "bookings_full", dateColumn: "booking_date", filterSQL: "booking_status = 'completed'", valueColumn: "total_paid_inr", properties: BOOKING_PROPERTIES }),
  e({ id: "cancelled_booking", displayName: "Booking Cancelled", category: "Bookings", table: "bookings_full", dateColumn: "booking_date", filterSQL: "booking_status = 'cancelled'", funnelEligible: false, properties: uniqueProperties(BOOKING_PROPERTIES, [prop("cancellation_reason", "Cancellation Reason")]) }),
  e({ id: "family_booking", displayName: "Family Booking", category: "Bookings", table: "bookings_full", dateColumn: "booking_date", filterSQL: "patient_relationship != 'self'", valueColumn: "total_paid_inr", properties: BOOKING_PROPERTIES }),
  e({ id: "multi_person_booking", displayName: "Multi-Person Booking", category: "Bookings", table: "bookings_full", dateColumn: "booking_date", filterSQL: "persons_in_booking > 1", valueColumn: "total_paid_inr", properties: BOOKING_PROPERTIES }),
  e({ id: "minor_patient_booking", displayName: "Minor Patient Booking", category: "Bookings", table: "bookings_full", dateColumn: "booking_date", filterSQL: "patient_is_minor = true", valueColumn: "total_paid_inr", properties: BOOKING_PROPERTIES }),
  e({ id: "prescription_booking", displayName: "Doctor-Prescribed Booking", category: "Bookings", table: "bookings_full", dateColumn: "booking_date", filterSQL: "is_prescription_driven = true", valueColumn: "total_paid_inr", properties: BOOKING_PROPERTIES }),
  e({ id: "subscription_booking", displayName: "Subscription Run Booking", category: "Bookings", table: "bookings_full", dateColumn: "booking_date", filterSQL: "is_subscription_run = true", valueColumn: "total_paid_inr", properties: BOOKING_PROPERTIES }),
  e({ id: "coupon_booking", displayName: "Coupon Booking", category: "Revenue", table: "bookings_full", dateColumn: "booking_date", filterSQL: "coupon_discount_inr > 0", valueColumn: "total_paid_inr", properties: BOOKING_PROPERTIES }),
  e({ id: "high_value_booking", displayName: "High-Value Booking", category: "Revenue", table: "bookings_full", dateColumn: "booking_date", filterSQL: "total_paid_inr >= 1000", valueColumn: "total_paid_inr", properties: BOOKING_PROPERTIES }),
  e({ id: "cashback_booking", displayName: "Cashback Booking", category: "Revenue", table: "bookings_full", dateColumn: "booking_date", filterSQL: "cashback_earned_inr > 0", valueColumn: "cashback_earned_inr", properties: BOOKING_PROPERTIES }),
  e({ id: "billing_dispute", displayName: "Billing Dispute", category: "Revenue", table: "bookings_full", dateColumn: "booking_date", filterSQL: "billing_dispute = true", funnelEligible: false, properties: BOOKING_PROPERTIES }),
  userEvent("payment_completed", "Payment Completed", "payment_completed", "Checkout", { valueColumn: "amount_inr" }),
  userEvent("booking_confirmed", "Booking Confirmed", "booking_confirmed", "Checkout", { valueColumn: "amount_inr" }),

  // Test demand
  e({ id: "diabetes_test", displayName: "Diabetes Test", category: "Test Categories", table: "bookings_full", dateColumn: "booking_date", filterSQL: "primary_test_category = 'diabetes' OR test_slug IN ('hba1c','diabetes_checkup')", valueColumn: "total_paid_inr", properties: uniqueProperties(BOOKING_PROPERTIES, HEALTH_STATUS_PROPERTIES) }),
  e({ id: "full_body_checkup", displayName: "Full Body Checkup", category: "Test Categories", table: "bookings_full", dateColumn: "booking_date", filterSQL: "primary_test_category = 'full_body' OR test_slug IN ('full_body','full_body_basic')", valueColumn: "total_paid_inr", properties: BOOKING_PROPERTIES }),
  e({ id: "fever_test", displayName: "Fever/Infection Test", category: "Test Categories", table: "bookings_full", dateColumn: "booking_date", filterSQL: "primary_test_category = 'fever' OR test_slug IN ('fever','dengue','typhoid','cbc')", valueColumn: "total_paid_inr", properties: BOOKING_PROPERTIES }),
  e({ id: "thyroid_test", displayName: "Thyroid Test", category: "Test Categories", table: "bookings_full", dateColumn: "booking_date", filterSQL: "primary_test_category = 'thyroid' OR test_slug IN ('thyroid','thyroid_tsh')", valueColumn: "total_paid_inr", properties: uniqueProperties(BOOKING_PROPERTIES, HEALTH_STATUS_PROPERTIES) }),
  e({ id: "cardiac_test", displayName: "Cardiac Test", category: "Test Categories", table: "bookings_full", dateColumn: "booking_date", filterSQL: "primary_test_category = 'cardiac' OR test_slug = 'cardiac'", valueColumn: "total_paid_inr", properties: BOOKING_PROPERTIES }),
  e({ id: "kidney_test", displayName: "Kidney Test", category: "Test Categories", table: "bookings_full", dateColumn: "booking_date", filterSQL: "primary_test_category = 'kidney' OR test_slug = 'kidney'", valueColumn: "total_paid_inr", properties: BOOKING_PROPERTIES }),
  e({ id: "liver_test", displayName: "Liver Test", category: "Test Categories", table: "bookings_full", dateColumn: "booking_date", filterSQL: "primary_test_category = 'liver' OR test_slug = 'liver'", valueColumn: "total_paid_inr", properties: BOOKING_PROPERTIES }),
  e({ id: "vitamin_test", displayName: "Vitamin Test", category: "Test Categories", table: "bookings_full", dateColumn: "booking_date", filterSQL: "primary_test_category = 'vitamins' OR test_slug IN ('vitamin_d','vitamin_b12')", valueColumn: "total_paid_inr", properties: uniqueProperties(BOOKING_PROPERTIES, HEALTH_STATUS_PROPERTIES) }),
  e({ id: "hematology_test", displayName: "Hematology Test", category: "Test Categories", table: "bookings_full", dateColumn: "booking_date", filterSQL: "primary_test_category = 'hematology' OR test_slug = 'cbc'", valueColumn: "total_paid_inr", properties: BOOKING_PROPERTIES }),
  e({ id: "cbc_test", displayName: "CBC Test", category: "Test Categories", table: "bookings_full", dateColumn: "booking_date", filterSQL: "test_slug = 'cbc'", valueColumn: "total_paid_inr", properties: BOOKING_PROPERTIES }),
  e({ id: "hba1c_test", displayName: "HbA1c Test", category: "Test Categories", table: "bookings_full", dateColumn: "booking_date", filterSQL: "test_slug = 'hba1c'", valueColumn: "total_paid_inr", properties: BOOKING_PROPERTIES }),
  e({ id: "lipid_test", displayName: "Lipid Profile Test", category: "Test Categories", table: "bookings_full", dateColumn: "booking_date", filterSQL: "test_slug = 'lipid'", valueColumn: "total_paid_inr", properties: BOOKING_PROPERTIES }),
  e({ id: "vitamin_d_test", displayName: "Vitamin D Test", category: "Test Categories", table: "bookings_full", dateColumn: "booking_date", filterSQL: "test_slug = 'vitamin_d'", valueColumn: "total_paid_inr", properties: BOOKING_PROPERTIES }),
  e({ id: "addon_test_purchased", displayName: "Add-On Test Purchased", category: "Test Categories", table: "booking_items_full", dateColumn: "booking_date", filterSQL: "item_type = 'addon_pathology'", valueColumn: "item_price_inr", properties: TEST_PROPERTIES }),

  // Operations and sample lifecycle
  userEvent("phlebotomist_assigned", "Phlebotomist Assigned", "phlebotomist_assigned", "Operations"),
  userEvent("phlebotomist_en_route", "Phlebotomist En Route", "phlebotomist_en_route", "Operations"),
  userEvent("phlebotomist_arrived", "Phlebotomist Arrived", "phlebotomist_arrived", "Operations"),
  userEvent("sample_collected", "Sample Collected", "sample_collected", "Operations"),
  userEvent("sample_received_at_lab", "Sample Received at Lab", "sample_received_at_lab", "Operations"),
  userEvent("report_generated", "Report Generated", "report_generated", "Operations"),
  e({ id: "on_time_delivery", displayName: "On-Time Delivery", category: "Operations", table: "bookings_full", dateColumn: "booking_date", filterSQL: "on_time = true AND booking_status = 'completed'", properties: OPS_PROPERTIES }),
  e({ id: "late_delivery", displayName: "Late Delivery", category: "Operations", table: "bookings_full", dateColumn: "booking_date", filterSQL: "on_time = false AND booking_status = 'completed' AND no_show = false", funnelEligible: false, properties: OPS_PROPERTIES }),
  e({ id: "no_show", displayName: "Phlebotomist No-Show", category: "Operations", table: "bookings_full", dateColumn: "booking_date", filterSQL: "no_show = true", funnelEligible: false, properties: OPS_PROPERTIES }),
  e({ id: "sample_rejected", displayName: "Sample Rejected", category: "Operations", table: "bookings_full", dateColumn: "booking_date", filterSQL: "sample_rejected = true", funnelEligible: false, properties: uniqueProperties(OPS_PROPERTIES, [prop("rejection_reason", "Rejection Reason")]) }),
  e({ id: "qc_rejected", displayName: "QC Rejected Sample", category: "Operations", table: "sample_tracking_full", dateColumn: "lab_received_timestamp", filterSQL: "qc_status = 'rejected'", funnelEligible: false, properties: SAMPLE_PROPERTIES }),
  e({ id: "tat_breach", displayName: "TAT Breach", category: "Operations", table: "bookings_full", dateColumn: "booking_date", filterSQL: "tat_breach = true", funnelEligible: false, properties: OPS_PROPERTIES }),
  e({ id: "temperature_breach", displayName: "Temperature Breach", category: "Operations", table: "sample_tracking_full", dateColumn: "lab_received_timestamp", filterSQL: "temperature_breach = true", funnelEligible: false, properties: SAMPLE_PROPERTIES }),
  e({ id: "communication_issue", displayName: "Phlebotomist Communication Issue", category: "Operations", table: "phlebotomist_full", dateColumn: "assigned_at", filterSQL: "communication_issue = true", funnelEligible: false, properties: PHLEB_PROPERTIES }),
  e({ id: "customer_request_repeated", displayName: "Customer Requested Same Phlebotomist", category: "Operations", table: "phlebotomist_full", dateColumn: "assigned_at", filterSQL: "customer_request_repeated = true", properties: PHLEB_PROPERTIES }),
  e({ id: "phlebotomist_rating", displayName: "Phlebotomist Rated", category: "Operations", table: "phlebotomist_ratings_full", dateColumn: "submitted_at", properties: PHLEB_PROPERTIES }),
  e({ id: "negative_phlebotomist_rating", displayName: "Negative Phlebotomist Rating", category: "Operations", table: "phlebotomist_ratings_full", dateColumn: "submitted_at", filterSQL: "rating <= 2 OR review_text_sentiment = 'negative'", funnelEligible: false, properties: PHLEB_PROPERTIES }),

  // Reports, clinical insights, and counseling
  userEvent("report_notification_sent", "Report Notification Sent", "report_notification_sent", "Report Engagement"),
  e({ id: "report_viewed", displayName: "Report Viewed", category: "Report Engagement", table: "reports_full", dateColumn: "report_date", filterSQL: "report_viewed = true", properties: REPORT_PROPERTIES }),
  userEvent("health_score_viewed", "Health Score Viewed", "health_score_viewed", "Report Engagement"),
  e({ id: "health_karma_viewed", displayName: "Health Karma Viewed", category: "Report Engagement", table: "reports_full", dateColumn: "report_date", filterSQL: "health_karma_viewed = true", properties: REPORT_PROPERTIES }),
  userEvent("abnormal_flag_clicked", "Abnormal Flag Clicked", "abnormal_flag_clicked", "Report Engagement"),
  e({ id: "abnormal_report", displayName: "Abnormal Result Found", category: "Clinical", table: "reports_full", dateColumn: "report_date", filterSQL: "abnormal_params_count > 0", properties: REPORT_PROPERTIES }),
  e({ id: "critical_report", displayName: "Critical Report", category: "Clinical", table: "reports_full", dateColumn: "report_date", filterSQL: "critical_params_count > 0", funnelEligible: false, properties: REPORT_PROPERTIES }),
  e({ id: "borderline_report", displayName: "Borderline Report", category: "Clinical", table: "reports_full", dateColumn: "report_date", filterSQL: "borderline_params_count > 0", funnelEligible: false, properties: REPORT_PROPERTIES }),
  e({ id: "abnormal_parameter", displayName: "Abnormal Parameter", category: "Clinical", table: "report_results_full", dateColumn: "report_date", filterSQL: "is_abnormal = true", properties: CLINICAL_PROPERTIES }),
  e({ id: "critical_parameter", displayName: "Critical Parameter", category: "Clinical", table: "report_results_full", dateColumn: "report_date", filterSQL: "is_critical = true", funnelEligible: false, properties: CLINICAL_PROPERTIES }),
  e({ id: "borderline_parameter", displayName: "Borderline Parameter", category: "Clinical", table: "report_results_full", dateColumn: "report_date", filterSQL: "is_borderline = true", funnelEligible: false, properties: CLINICAL_PROPERTIES }),
  e({ id: "low_parameter", displayName: "Low Parameter", category: "Clinical", table: "report_results_full", dateColumn: "report_date", filterSQL: "status = 'low'", funnelEligible: false, properties: CLINICAL_PROPERTIES }),
  e({ id: "counseling_session", displayName: "Counseling Session", category: "Counseling", table: "counseling_full", dateColumn: "session_date", properties: COUNSELING_PROPERTIES }),
  userEvent("counseling_started", "Counseling Started", "counseling_started", "Counseling"),
  userEvent("counseling_completed", "Counseling Completed", "counseling_completed", "Counseling"),
  e({ id: "ai_counseling_session", displayName: "AI Counseling Session", category: "Counseling", table: "counseling_full", dateColumn: "session_date", filterSQL: "counselor_type = 'ai'", properties: COUNSELING_PROPERTIES }),
  e({ id: "human_counseling_session", displayName: "Human Advisor Counseling", category: "Counseling", table: "counseling_full", dateColumn: "session_date", filterSQL: "counselor_type = 'human_advisor'", properties: COUNSELING_PROPERTIES }),
  e({ id: "follow_up_recommended", displayName: "Follow-Up Test Recommended", category: "Report Engagement", table: "future_tests_full", dateColumn: "created_at", properties: FUTURE_TEST_PROPERTIES }),
  e({ id: "follow_up_booked", displayName: "Follow-Up Test Booked", category: "Report Engagement", table: "future_tests_full", dateColumn: "created_at", filterSQL: "booked_within_window = true", properties: FUTURE_TEST_PROPERTIES }),

  // CRM and notifications
  e({ id: "comms_sent", displayName: "Message Sent", category: "CRM", table: "comms_full", dateColumn: "sent_at", valueColumn: "send_cost_inr", properties: COMMS_PROPERTIES }),
  e({ id: "comms_delivered", displayName: "Message Delivered", category: "CRM", table: "comms_full", dateColumn: "sent_at", filterSQL: "delivered = true", funnelEligible: false, properties: COMMS_PROPERTIES }),
  e({ id: "comms_opened", displayName: "Message Opened", category: "CRM", table: "comms_full", dateColumn: "sent_at", filterSQL: "opened = true", funnelEligible: false, properties: COMMS_PROPERTIES }),
  e({ id: "comms_clicked", displayName: "Message Clicked", category: "CRM", table: "comms_full", dateColumn: "sent_at", filterSQL: "clicked = true", funnelEligible: false, properties: COMMS_PROPERTIES }),
  e({ id: "comms_converted", displayName: "Campaign Converted", category: "CRM", table: "comms_full", dateColumn: "sent_at", filterSQL: "converted = true", funnelEligible: false, properties: COMMS_PROPERTIES }),
  e({ id: "reactivation_comms", displayName: "Reactivation Campaign Sent", category: "CRM", table: "comms_full", dateColumn: "sent_at", filterSQL: "campaign_type = 'reactivation'", funnelEligible: false, properties: COMMS_PROPERTIES }),
  e({ id: "report_delivery_comms", displayName: "Report Delivery Message Sent", category: "CRM", table: "comms_full", dateColumn: "sent_at", filterSQL: "campaign_type = 'report_delivery'", funnelEligible: false, properties: COMMS_PROPERTIES }),
  e({ id: "welcome_comms", displayName: "Welcome Message Sent", category: "CRM", table: "comms_full", dateColumn: "sent_at", filterSQL: "campaign_type = 'welcome_series'", funnelEligible: false, properties: COMMS_PROPERTIES }),
  e({ id: "annual_checkup_reminder", displayName: "Annual Checkup Reminder Sent", category: "CRM", table: "comms_full", dateColumn: "sent_at", filterSQL: "campaign_type = 'annual_checkup_reminder'", funnelEligible: false, properties: COMMS_PROPERTIES }),
  e({ id: "dengue_season_alert", displayName: "Dengue Season Alert Sent", category: "CRM", table: "comms_full", dateColumn: "sent_at", filterSQL: "campaign_type = 'dengue_season_alert'", funnelEligible: false, properties: COMMS_PROPERTIES }),
  e({ id: "tax_deduction_nudge", displayName: "Tax Deduction Nudge Sent", category: "CRM", table: "comms_full", dateColumn: "sent_at", filterSQL: "campaign_type = 'tax_deduction_nudge'", funnelEligible: false, properties: COMMS_PROPERTIES }),
  e({ id: "post_diwali_sugar_check", displayName: "Post-Diwali Sugar Check Sent", category: "CRM", table: "comms_full", dateColumn: "sent_at", filterSQL: "campaign_type = 'post_diwali_sugar_check'", funnelEligible: false, properties: COMMS_PROPERTIES }),
  userEvent("notification_sent", "Notification Sent", "notification_sent", "CRM"),
  userEvent("notification_opened", "Notification Opened", "notification_opened", "CRM"),
  userEvent("notification_clicked", "Notification Clicked", "notification_clicked", "CRM"),

  // Subscriptions
  e({ id: "subscription_started", displayName: "Subscription Activated", category: "Subscriptions", table: "subscriptions_full", dateColumn: "start_date", properties: SUBSCRIPTION_PROPERTIES }),
  e({ id: "subscription_active", displayName: "Active Subscription", category: "Subscriptions", table: "subscriptions_full", dateColumn: "start_date", filterSQL: "status = 'active'", funnelEligible: false, properties: SUBSCRIPTION_PROPERTIES }),
  e({ id: "subscription_paused", displayName: "Paused Subscription", category: "Subscriptions", table: "subscriptions_full", dateColumn: "start_date", filterSQL: "status = 'paused'", funnelEligible: false, properties: SUBSCRIPTION_PROPERTIES }),
  e({ id: "subscription_cancelled", displayName: "Cancelled Subscription", category: "Subscriptions", table: "subscriptions_full", dateColumn: "start_date", filterSQL: "status = 'cancelled'", funnelEligible: false, properties: SUBSCRIPTION_PROPERTIES }),
  e({ id: "subscription_run_scheduled", displayName: "Subscription Run Scheduled", category: "Subscriptions", table: "subscription_runs_full", dateColumn: "scheduled_date", properties: SUBSCRIPTION_RUN_PROPERTIES }),
  e({ id: "subscription_run_completed", displayName: "Subscription Run Completed", category: "Subscriptions", table: "subscription_runs_full", dateColumn: "actual_date", filterSQL: "run_status = 'completed'", properties: SUBSCRIPTION_RUN_PROPERTIES }),
  e({ id: "subscription_run_late", displayName: "Subscription Run Late", category: "Subscriptions", table: "subscription_runs_full", dateColumn: "scheduled_date", filterSQL: "run_status = 'late'", funnelEligible: false, properties: SUBSCRIPTION_RUN_PROPERTIES }),
  e({ id: "subscription_run_skipped", displayName: "Subscription Run Skipped", category: "Subscriptions", table: "subscription_runs_full", dateColumn: "scheduled_date", filterSQL: "run_status = 'skipped'", funnelEligible: false, properties: SUBSCRIPTION_RUN_PROPERTIES }),

  // Support, NPS, and voice of customer
  e({ id: "support_ticket", displayName: "Support Ticket", category: "Support", table: "support_full", dateColumn: "opened_at", properties: SUPPORT_PROPERTIES }),
  e({ id: "escalated_ticket", displayName: "Escalated Support Ticket", category: "Support", table: "support_full", dateColumn: "opened_at", filterSQL: "escalated = true", funnelEligible: false, properties: SUPPORT_PROPERTIES }),
  e({ id: "delayed_report_ticket", displayName: "Delayed Report Ticket", category: "Support", table: "support_full", dateColumn: "opened_at", filterSQL: "category = 'delayed_report'", funnelEligible: false, properties: SUPPORT_PROPERTIES }),
  e({ id: "phlebotomist_issue_ticket", displayName: "Phlebotomist Issue Ticket", category: "Support", table: "support_full", dateColumn: "opened_at", filterSQL: "category IN ('phlebotomist_late','phlebotomist_no_show')", funnelEligible: false, properties: SUPPORT_PROPERTIES }),
  e({ id: "sample_rejected_ticket", displayName: "Sample Rejected Ticket", category: "Support", table: "support_full", dateColumn: "opened_at", filterSQL: "category = 'sample_rejected'", funnelEligible: false, properties: SUPPORT_PROPERTIES }),
  e({ id: "wrong_result_ticket", displayName: "Wrong/Incomplete Result Ticket", category: "Support", table: "support_full", dateColumn: "opened_at", filterSQL: "category IN ('wrong_result','incomplete_report')", funnelEligible: false, properties: SUPPORT_PROPERTIES }),
  e({ id: "billing_support_ticket", displayName: "Billing Support Ticket", category: "Support", table: "support_full", dateColumn: "opened_at", filterSQL: "category IN ('billing_dispute','refund_pending')", funnelEligible: false, properties: SUPPORT_PROPERTIES }),
  e({ id: "refund_ticket", displayName: "Refund Ticket", category: "Support", table: "support_full", dateColumn: "opened_at", filterSQL: "category = 'refund_pending'", funnelEligible: false, properties: SUPPORT_PROPERTIES }),
  e({ id: "resolved_ticket", displayName: "Support Ticket Resolved", category: "Support", table: "support_full", dateColumn: "resolved_at", filterSQL: "resolution IN ('resolved','rebooked','refund_given')", properties: SUPPORT_PROPERTIES }),
  e({ id: "refund_given", displayName: "Refund Given", category: "Support", table: "support_full", dateColumn: "resolved_at", filterSQL: "resolution = 'refund_given'", funnelEligible: false, properties: SUPPORT_PROPERTIES }),
  e({ id: "nps_response", displayName: "NPS Response", category: "NPS", table: "nps_full", dateColumn: "submitted_at", properties: NPS_PROPERTIES }),
  e({ id: "nps_promoter", displayName: "NPS Promoter", category: "NPS", table: "nps_full", dateColumn: "submitted_at", filterSQL: "nps_category = 'promoter'", funnelEligible: false, properties: NPS_PROPERTIES }),
  e({ id: "nps_detractor", displayName: "NPS Detractor", category: "NPS", table: "nps_full", dateColumn: "submitted_at", filterSQL: "nps_category = 'detractor'", funnelEligible: false, properties: NPS_PROPERTIES }),
];

export function getHealthiansViewSQL(): string[] {
  return [
    `CREATE OR REPLACE VIEW customers_full AS
    SELECT c.*, c.gender AS customer_gender
    FROM raw_customers c`,

    `CREATE OR REPLACE VIEW bookings_full AS
    SELECT
      b.booking_id, b.customer_id, b.booking_date, b.booking_time, b.slot_date, b.slot_band,
      b.city, b.city_tier, b.hub_id, b.address_id, b.primary_test_category,
      b.tests_count, b.advertised_price_inr, b.consumables_transport_fee_inr,
      b.hard_copy_fee_inr, b.diet_consultation_fee_inr, b.coupon_discount_inr,
      b.cashback_earned_inr, b.total_paid_inr, b.payment_method, b.booking_channel,
      b.patient_age, b.patient_gender, b.patient_relationship, b.patient_is_minor,
      b.persons_in_booking, b.is_family_bundle, b.is_first_booking, b.is_prescription_driven,
      b.is_subscription_run, b.subscription_id, b.on_time, b.delay_min, b.no_show,
      b.sample_rejected, b.rejection_reason, b.tat_hours, b.tat_breach, b.report_viewed,
      b.time_to_view_hours, b.counseling_taken, b.follow_up_booked, b.billing_dispute,
      b.cancellation_reason, b.booking_status,
      CASE WHEN b.total_paid_inr < 500 THEN '<500'
           WHEN b.total_paid_inr < 1000 THEN '500-999'
           WHEN b.total_paid_inr < 1500 THEN '1000-1499'
           ELSE '1500+' END AS price_bucket,
      CASE WHEN b.consumables_transport_fee_inr <= 0 THEN 'none'
           WHEN b.consumables_transport_fee_inr < 100 THEN '<100'
           ELSE '100+' END AS fee_bucket,
      CASE WHEN b.coupon_discount_inr <= 0 THEN 'no_coupon'
           WHEN b.coupon_discount_inr < 100 THEN '<100'
           WHEN b.coupon_discount_inr < 250 THEN '100-249'
           ELSE '250+' END AS coupon_bucket,
      CASE WHEN b.delay_min = 0 THEN 'on_time'
           WHEN b.delay_min <= 30 THEN '1-30m'
           WHEN b.delay_min <= 60 THEN '31-60m'
           ELSE '60m+' END AS delay_bucket,
      CASE WHEN b.tat_hours <= 24 THEN '<=24h'
           WHEN b.tat_hours <= 48 THEN '25-48h'
           WHEN b.tat_hours <= 72 THEN '49-72h'
           ELSE '72h+' END AS tat_bucket,
      c.archetype, c.age AS customer_age, c.age_group,
      c.gender AS customer_gender, c.state, c.acquisition_channel, c.install_platform,
      c.device_model_tier, c.health_goal, c.primary_health_concern, c.chronic_condition,
      c.family_history, c.smoking_status, c.alcohol_consumption, c.exercise_frequency,
      c.bmi_category, c.on_regular_medication, c.last_doctor_visit_timeframe,
      c.insurance_provider, c.insurance_linked_to_healthians, c.family_members_added,
      c.books_primarily_for, c.total_bookings, c.most_booked_category,
      c.preferred_slot_band, c.preferred_payment_method, c.subscription_active,
      c.vitamin_d_status, c.vitamin_b12_status, c.thyroid_status, c.glucose_status,
      c.cholesterol_status, c.hemoglobin_status, c.lifetime_abnormal_flags_count,
      c.customer_lifecycle_stage, c.ltv_bucket, c.nps_category, c.push_opt_in,
      c.whatsapp_opt_in, c.is_active,
      bi.test_slug, bi.test_name, bi.test_category, bi.parameters_count,
      bi.item_price_inr, bi.item_type
    FROM raw_bookings b
    LEFT JOIN raw_customers c ON b.customer_id = c.customer_id
    LEFT JOIN raw_booking_items bi ON b.booking_id = bi.booking_id AND bi.item_type = 'primary'`,

    `CREATE OR REPLACE VIEW booking_items_full AS
    SELECT
      bi.*, b.booking_date, b.booking_channel, b.city, b.city_tier, b.slot_band,
      c.state, c.archetype, c.customer_lifecycle_stage, c.ltv_bucket,
      c.acquisition_channel, c.age_group, c.gender AS customer_gender, c.chronic_condition,
      CASE WHEN bi.item_price_inr < 300 THEN '<300'
           WHEN bi.item_price_inr < 600 THEN '300-599'
           WHEN bi.item_price_inr < 1000 THEN '600-999'
           ELSE '1000+' END AS item_price_bucket
    FROM raw_booking_items bi
    LEFT JOIN raw_bookings b ON bi.booking_id = b.booking_id
    LEFT JOIN raw_customers c ON bi.customer_id = c.customer_id`,

    `CREATE OR REPLACE VIEW reports_full AS
    SELECT
      r.report_id, r.booking_id, r.customer_id, r.report_date, r.health_score,
      r.health_score_category, r.critical_params_count, r.borderline_params_count,
      r.abnormal_params_count, r.keep_watching_params, r.report_released_at,
      r.notification_sent_at, r.notification_channels, r.report_viewed,
      r.time_to_view_hours, r.report_view_platform, r.health_karma_viewed,
      CASE WHEN r.critical_params_count = 0 THEN '0'
           WHEN r.critical_params_count = 1 THEN '1'
           ELSE '2+' END AS critical_bucket,
      CASE WHEN r.abnormal_params_count = 0 THEN '0'
           WHEN r.abnormal_params_count <= 2 THEN '1-2'
           WHEN r.abnormal_params_count <= 5 THEN '3-5'
           ELSE '6+' END AS abnormal_bucket,
      c.archetype, c.age AS customer_age, c.age_group, c.gender AS customer_gender,
      c.city, c.city_tier, c.state, c.acquisition_channel, c.chronic_condition,
      c.customer_lifecycle_stage, c.ltv_bucket, c.vitamin_d_status, c.vitamin_b12_status,
      c.thyroid_status, c.glucose_status, c.cholesterol_status, c.hemoglobin_status,
      b.slot_band, b.booking_channel, b.primary_test_category, b.tat_hours,
      b.tat_breach, b.on_time, bi.test_slug, bi.test_name, bi.test_category
    FROM raw_reports r
    LEFT JOIN raw_customers c ON r.customer_id = c.customer_id
    LEFT JOIN raw_bookings b ON r.booking_id = b.booking_id
    LEFT JOIN raw_booking_items bi ON r.booking_id = bi.booking_id AND bi.item_type = 'primary'`,

    `CREATE OR REPLACE VIEW report_results_full AS
    SELECT
      rr.*, r.report_date, r.health_score_category, r.report_viewed,
      c.city, c.city_tier, c.state, c.archetype, c.age_group,
      c.gender AS customer_gender, c.acquisition_channel, c.chronic_condition,
      c.customer_lifecycle_stage, c.ltv_bucket, c.vitamin_d_status, c.vitamin_b12_status,
      c.thyroid_status, c.glucose_status, c.cholesterol_status, c.hemoglobin_status,
      b.booking_channel, b.primary_test_category
    FROM raw_report_results rr
    LEFT JOIN raw_reports r ON rr.report_id = r.report_id
    LEFT JOIN raw_customers c ON rr.customer_id = c.customer_id
    LEFT JOIN raw_bookings b ON rr.booking_id = b.booking_id`,

    `CREATE OR REPLACE VIEW phlebotomist_full AS
    SELECT
      pa.assignment_id, pa.booking_id, pa.customer_id, pa.phlebotomist_id,
      pa.assigned_at, pa.arrived_at, pa.on_time, pa.delay_min, pa.no_show,
      pa.collection_duration_min, pa.tubes_collected, pa.communication_issue,
      pa.customer_request_repeated,
      CASE WHEN pa.delay_min = 0 THEN 'on_time'
           WHEN pa.delay_min <= 30 THEN '1-30m'
           WHEN pa.delay_min <= 60 THEN '31-60m'
           ELSE '60m+' END AS delay_bucket,
      NULL AS rating, NULL AS review_text_sentiment,
      p.city AS phleb_city, p.city_tier AS phleb_tier, p.hub_id,
      p.experience_months, p.certification_level, p.avg_rating,
      b.slot_date, b.slot_band, b.booking_channel, b.primary_test_category,
      b.city, b.city_tier, c.state, c.archetype, c.age_group,
      c.gender AS customer_gender, c.acquisition_channel, c.chronic_condition,
      c.customer_lifecycle_stage, c.ltv_bucket
    FROM raw_assignments pa
    LEFT JOIN raw_phlebotomists p ON pa.phlebotomist_id = p.phlebotomist_id
    LEFT JOIN raw_bookings b ON pa.booking_id = b.booking_id
    LEFT JOIN raw_customers c ON pa.customer_id = c.customer_id`,

    `CREATE OR REPLACE VIEW phlebotomist_ratings_full AS
    SELECT
      pr.*, p.city AS phleb_city, p.city_tier AS phleb_tier, p.certification_level,
      b.booking_channel, b.primary_test_category, b.slot_band, b.city, b.city_tier,
      c.state, c.archetype, c.age_group, c.gender AS customer_gender,
      c.acquisition_channel, c.chronic_condition, c.customer_lifecycle_stage, c.ltv_bucket,
      NULL AS communication_issue, NULL AS customer_request_repeated, NULL AS delay_bucket
    FROM raw_phleb_ratings pr
    LEFT JOIN raw_phlebotomists p ON pr.phlebotomist_id = p.phlebotomist_id
    LEFT JOIN raw_bookings b ON pr.booking_id = b.booking_id
    LEFT JOIN raw_customers c ON pr.customer_id = c.customer_id`,

    `CREATE OR REPLACE VIEW sample_tracking_full AS
    SELECT
      st.*, b.customer_id, b.booking_date, b.booking_channel, b.primary_test_category,
      b.slot_band, b.city, b.city_tier, b.on_time, b.no_show, b.sample_rejected,
      bi.test_slug, bi.test_name, bi.test_category,
      CASE WHEN st.tat_hours <= 24 THEN '<=24h'
           WHEN st.tat_hours <= 48 THEN '25-48h'
           WHEN st.tat_hours <= 72 THEN '49-72h'
           ELSE '72h+' END AS tat_bucket,
      c.state, c.archetype, c.age_group, c.gender AS customer_gender,
      c.acquisition_channel, c.chronic_condition, c.customer_lifecycle_stage, c.ltv_bucket
    FROM raw_sample_tracking st
    LEFT JOIN raw_bookings b ON st.booking_id = b.booking_id
    LEFT JOIN raw_booking_items bi ON st.booking_id = bi.booking_id AND bi.item_type = 'primary'
    LEFT JOIN raw_customers c ON b.customer_id = c.customer_id`,

    `CREATE OR REPLACE VIEW comms_full AS
    SELECT
      cl.send_id, cl.customer_id, cl.booking_id, cl.channel, cl.campaign_type,
      cl.sent_at, cl.delivered, cl.opened, cl.clicked, cl.converted,
      cl.conversion_booking_id, cl.send_cost_inr, cl.user_segment_at_send,
      cl.days_since_last_booking,
      CASE WHEN cl.send_cost_inr <= 0.02 THEN 'low'
           WHEN cl.send_cost_inr <= 0.08 THEN 'medium'
           ELSE 'high' END AS send_cost_bucket,
      c.city, c.city_tier, c.state, c.archetype, c.age_group,
      c.gender AS customer_gender, c.acquisition_channel, c.chronic_condition,
      c.customer_lifecycle_stage, c.ltv_bucket, c.is_active
    FROM raw_comms_log cl
    LEFT JOIN raw_customers c ON cl.customer_id = c.customer_id`,

    `CREATE OR REPLACE VIEW counseling_full AS
    SELECT
      cs.*,
      CASE WHEN cs.duration_min < 10 THEN '<10m'
           WHEN cs.duration_min < 20 THEN '10-19m'
           WHEN cs.duration_min < 30 THEN '20-29m'
           ELSE '30m+' END AS duration_bucket,
      c.city, c.city_tier, c.state, c.archetype, c.age_group,
      c.gender AS customer_gender, c.acquisition_channel, c.chronic_condition,
      c.customer_lifecycle_stage, c.ltv_bucket
    FROM raw_counseling cs
    LEFT JOIN raw_customers c ON cs.customer_id = c.customer_id`,

    `CREATE OR REPLACE VIEW future_tests_full AS
    SELECT
      ft.*, r.health_score_category, r.abnormal_params_count, r.critical_params_count,
      c.city, c.city_tier, c.state, c.archetype, c.age_group,
      c.gender AS customer_gender, c.acquisition_channel, c.chronic_condition,
      c.customer_lifecycle_stage, c.ltv_bucket
    FROM raw_future_tests ft
    LEFT JOIN raw_reports r ON ft.report_id = r.report_id
    LEFT JOIN raw_customers c ON ft.customer_id = c.customer_id`,

    `CREATE OR REPLACE VIEW subscriptions_full AS
    SELECT
      s.*,
      CASE WHEN s.frequency_days <= 90 THEN 'quarterly_or_more'
           WHEN s.frequency_days <= 180 THEN 'half_yearly'
           ELSE 'annual' END AS frequency_bucket,
      CASE WHEN s.adherence_rate_pct < 50 THEN '<50'
           WHEN s.adherence_rate_pct < 75 THEN '50-74'
           WHEN s.adherence_rate_pct < 90 THEN '75-89'
           ELSE '90+' END AS adherence_bucket,
      c.city, c.city_tier, c.state, c.archetype, c.age_group,
      c.gender AS customer_gender, c.acquisition_channel, c.chronic_condition,
      c.customer_lifecycle_stage, c.ltv_bucket
    FROM raw_subscriptions s
    LEFT JOIN raw_customers c ON s.customer_id = c.customer_id`,

    `CREATE OR REPLACE VIEW subscription_runs_full AS
    SELECT
      sr.run_id, sr.subscription_id, sr.customer_id, sr.booking_id, sr.run_number,
      sr.scheduled_date, sr.actual_date, sr.status AS run_status, sr.days_late,
      CASE WHEN sr.days_late = 0 THEN 'on_time'
           WHEN sr.days_late <= 3 THEN '1-3d'
           WHEN sr.days_late <= 7 THEN '4-7d'
           ELSE '8d+' END AS days_late_bucket,
      s.status AS subscription_status, s.test_slug, s.test_name, s.frequency_days,
      c.city, c.city_tier, c.state, c.archetype, c.age_group,
      c.gender AS customer_gender, c.acquisition_channel, c.chronic_condition,
      c.customer_lifecycle_stage, c.ltv_bucket
    FROM raw_subscription_runs sr
    LEFT JOIN raw_subscriptions s ON sr.subscription_id = s.subscription_id
    LEFT JOIN raw_customers c ON sr.customer_id = c.customer_id`,

    `CREATE OR REPLACE VIEW support_full AS
    SELECT
      st.ticket_id, st.customer_id, st.booking_id, st.opened_at, st.resolved_at,
      st.resolution_days, st.channel, st.category, st.city, st.city_tier,
      st.root_cause, st.escalated, st.resolution, st.nps_after_resolution,
      CASE WHEN st.resolution_days <= 1 THEN '<=1d'
           WHEN st.resolution_days <= 3 THEN '2-3d'
           WHEN st.resolution_days <= 7 THEN '4-7d'
           ELSE '8d+' END AS resolution_bucket,
      CASE WHEN st.nps_after_resolution <= 6 THEN 'detractor'
           WHEN st.nps_after_resolution <= 8 THEN 'passive'
           ELSE 'promoter' END AS nps_after_resolution_bucket,
      c.state, c.archetype, c.age_group, c.gender AS customer_gender,
      c.acquisition_channel, c.chronic_condition, c.customer_lifecycle_stage,
      c.ltv_bucket, c.is_active
    FROM raw_support st
    LEFT JOIN raw_customers c ON st.customer_id = c.customer_id`,

    `CREATE OR REPLACE VIEW nps_full AS
    SELECT
      n.*,
      CASE WHEN n.score <= 6 THEN '0-6'
           WHEN n.score <= 8 THEN '7-8'
           ELSE '9-10' END AS score_bucket,
      b.booking_channel, b.primary_test_category, b.city, b.city_tier,
      c.state, c.archetype, c.age_group, c.gender AS customer_gender,
      c.acquisition_channel, c.chronic_condition, c.customer_lifecycle_stage, c.ltv_bucket
    FROM raw_nps n
    LEFT JOIN raw_bookings b ON n.booking_id = b.booking_id
    LEFT JOIN raw_customers c ON n.customer_id = c.customer_id`,

    `CREATE OR REPLACE VIEW leads_full AS
    SELECT
      l.*, c.city_tier, c.state, c.archetype, c.age_group,
      c.gender AS customer_gender, c.acquisition_channel, c.chronic_condition,
      c.customer_lifecycle_stage, c.ltv_bucket
    FROM raw_leads l
    LEFT JOIN raw_customers c ON l.customer_id = c.customer_id`,

    `CREATE OR REPLACE VIEW lifestyle_profiles_full AS
    SELECT
      lp.*, c.city, c.city_tier, c.state, c.archetype, c.age_group,
      c.gender AS customer_gender, c.acquisition_channel, c.chronic_condition,
      c.customer_lifecycle_stage, c.ltv_bucket
    FROM raw_lifestyle_profiles lp
    LEFT JOIN raw_customers c ON lp.customer_id = c.customer_id`,

    `CREATE OR REPLACE VIEW user_events_full AS
    SELECT
      ue.event_id, ue.customer_id, ue.session_id,
      COALESCE(NULLIF(ue.booking_id, ''), json_extract_string(ue.properties, '$.booking_id')) AS booking_id,
      TRY_CAST(ue.timestamp AS TIMESTAMP) AS event_timestamp, ue.event_type, ue.platform, ue.channel,
      json_extract_string(ue.properties, '$.test_slug') AS test_slug,
      json_extract_string(ue.properties, '$.category') AS event_category,
      json_extract_string(ue.properties, '$.campaign_type') AS campaign_type,
      json_extract_string(ue.properties, '$.source') AS source,
      json_extract_string(ue.properties, '$.method') AS payment_method,
      TRY_CAST(json_extract_string(ue.properties, '$.amount') AS DOUBLE) AS amount_inr,
      TRY_CAST(json_extract_string(ue.properties, '$.fee') AS DOUBLE) AS fee_inr,
      json_extract_string(ue.properties, '$.slot_band') AS slot_band,
      TRY_CAST(json_extract_string(ue.properties, '$.on_time') AS BOOLEAN) AS on_time,
      CASE WHEN TRY_CAST(json_extract_string(ue.properties, '$.amount') AS DOUBLE) IS NULL THEN NULL
           WHEN TRY_CAST(json_extract_string(ue.properties, '$.amount') AS DOUBLE) < 500 THEN '<500'
           WHEN TRY_CAST(json_extract_string(ue.properties, '$.amount') AS DOUBLE) < 1000 THEN '500-999'
           WHEN TRY_CAST(json_extract_string(ue.properties, '$.amount') AS DOUBLE) < 1500 THEN '1000-1499'
           ELSE '1500+' END AS amount_bucket,
      CASE WHEN TRY_CAST(json_extract_string(ue.properties, '$.fee') AS DOUBLE) IS NULL THEN NULL
           WHEN TRY_CAST(json_extract_string(ue.properties, '$.fee') AS DOUBLE) <= 0 THEN 'none'
           WHEN TRY_CAST(json_extract_string(ue.properties, '$.fee') AS DOUBLE) < 100 THEN '<100'
           ELSE '100+' END AS fee_bucket,
      c.city, c.city_tier, c.state, c.archetype, c.age_group,
      c.gender AS customer_gender, c.acquisition_channel, c.chronic_condition,
      c.customer_lifecycle_stage, c.ltv_bucket
    FROM raw_user_events ue
    LEFT JOIN raw_customers c ON ue.customer_id = c.customer_id`,
  ];
}
