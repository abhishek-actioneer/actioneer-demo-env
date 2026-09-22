# FundsIndia Pilot Data Ask: Field Appendix

Purpose: support three pilot workflows with data keyed by `investor_id`.

- KYC funnels data
- Personalised user reactivation
- RM concierge call-list generation, derived from the same KYC, activity, and comms data

Phone number is required where outbound calls need to be triggered.

## Delivery Format

Preferred: warehouse views or CSV exports.

Join key: `investor_id`.

Time range: last 12-24 months, plus current profile/status snapshot.

Recommended handling:

- Use `investor_id` as the join key across all views.
- Include `phone_number` for call-triggering workflows.
- Keep consent, DND, and suppression flags so outreach can be filtered correctly.

## 1. `investor_profile`

One row per investor. This is the base table for all three use cases.

Required fields:

```text
investor_id
signup_date
kyc_status
current_kyc_step
kyc_submitted_at
kyc_verified_at
kyc_on_hold_at
kyc_dropoff_reason
bank_verification_status
bank_verified_at
account_activated_at
first_investment_date
last_login_at
last_activity_at
city_tier
acquisition_channel
preferred_language
preferred_channel
phone_number
phone_verified
whatsapp_opt_in
marketing_consent
dnd_status
suppression_status
```

## 2. `kyc_onboarding_funnel_events`

Event-level onboarding/KYC table. Needed to identify exactly where users drop.

Required fields:

```text
event_id
investor_id
event_timestamp
event_name
funnel_step
step_status
dropoff_reason
kyc_method
device_platform
app_version
error_code
error_message_bucket
attempt_number
```

Important event names:

```text
signup_started
pan_entered
pan_verified
kyc_started
kyc_details_submitted
digilocker_started
digilocker_failed
aadhaar_otp_started
aadhaar_otp_failed
document_upload_started
document_upload_failed
kyc_submitted
kyc_on_hold
kyc_verified
bank_link_started
bank_link_failed
bank_verified
account_activated
```

## 3. `transactions_or_holdings_activity`

Product activity table for reactivation and RM context. One row per transaction or product activity.

Required fields:

```text
transaction_id
investor_id
transaction_date
product_type
product_name
amc_name
scheme_name
fund_category
transaction_type
transaction_status
amount_band
payment_mode
sip_id
sip_status
sip_start_date
sip_end_date
last_successful_payment_date
last_failed_payment_date
channel
```

Important product/activity values:

```text
mutual_fund_lumpsum
sip
elss
stocks
corporate_fd
nps
insurance
loan_against_mutual_funds
```

Important transaction values:

```text
purchase
sip_installment
sip_created
sip_failed
sip_cancelled
lumpsum_purchase
```

## 4. `customer_comms_history`

Needed to avoid blind targeting and to measure action response.

Required fields:

```text
comm_id
investor_id
sent_at
channel
campaign_name
campaign_type
delivered
opened
clicked
converted
conversion_event
suppression_reason
unsubscribe_status
```

## Derived Use-Case Logic

### KYC Funnels Data

Examples:

```text
kyc_started but kyc_verified_at is null
kyc_status = on_hold
bank_verification_status in failed, pending
event_name in digilocker_failed, aadhaar_otp_failed, document_upload_failed, bank_link_failed
marketing_consent = true and dnd_status = false
```

### Personalised User Reactivation

Examples:

```text
last successful purchase between 60 and 90 days ago
no follow-up transaction after that purchase
no active SIP after a lumpsum purchase
sip_status in paused, cancelled, failed
last campaign not converted
marketing_consent = true and dnd_status = false
```

### RM Concierge

For this use case, use all four tables above:

```text
investor_profile
kyc_onboarding_funnel_events
transactions_or_holdings_activity
customer_comms_history
```

Example RM queues:

```text
KYC Help Needed
Bank Mandate Help Needed
First Investment Assist
Recent Buyer Follow-up
SIP Failure Recovery
High Intent, No Conversion
```

Recommended RM output fields derived by Actioneer:

```text
investor_id
queue_name
reason_for_followup
customer_context_summary
recommended_next_action
preferred_channel
preferred_language
last_relevant_activity_at
urgency_score
suppression_status
```
