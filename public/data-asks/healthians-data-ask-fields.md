# Healthians Pilot Data Ask: Field Appendix

Purpose: support three pilot workflows with data keyed by `customer_id`.

- Booking flow churn
- Lab test user reactivation
- Pre-visit customer coordination after booking

Phone number and visit address are required for call/WhatsApp coordination before the lab-test agent visits.

## Delivery Format

Preferred: warehouse views or CSV exports.

Join keys:

- `customer_id` across all customer-level views
- `booking_id` for booking, visit, and event-level joins

Time range: last 12-24 months, plus upcoming confirmed bookings.

Recommended handling:

- Use `customer_id` as the customer join key.
- Include `phone_number` for call-triggering workflows.
- Include address only in the visit coordination view.
- Keep consent, DND, and suppression flags so outreach can be filtered correctly.

## 1. `customer_profile`

One row per customer. This is the base table for all three use cases.

Required fields:

```text
customer_id
signup_date
phone_number
phone_verified
whatsapp_opt_in
marketing_consent
dnd_status
suppression_status
preferred_language
city
pincode
acquisition_channel
lifecycle_stage
last_activity_at
last_completed_booking_date
last_booking_status
```

## 2. `booking_funnel_events`

Event-level booking-flow table. Needed to identify where users drop before confirming a booking.

Required fields:

```text
event_id
customer_id
booking_id
event_timestamp
event_name
funnel_step
step_status
dropoff_reason
test_slug
test_category
cart_value_band
booking_channel
payment_status
device_platform
app_version
error_message_bucket
attempt_number
```

Important event names:

```text
test_viewed
package_added_to_cart
address_started
address_added
slot_selection_started
slot_selected
payment_started
payment_failed
booking_confirmed
booking_abandoned
callback_requested
```

## 3. `bookings_test_activity`

Booking and lab-test history table. Needed for reactivation of users who booked a test but have not transacted recently.

Required fields:

```text
booking_id
customer_id
booking_date
booking_status
test_slug
test_name
test_category
payment_status
amount_band
booking_channel
report_delivered_at
report_viewed
counseling_taken
follow_up_recommended
follow_up_booking_id
```

Important booking statuses:

```text
confirmed
completed
cancelled
no_show
sample_rejected
rescheduled
```

## 4. `booking_visit_coordination`

Visit-level table for confirmed/upcoming bookings. Needed to coordinate date, time, address, and on-time arrival before the phlebotomist visit.

Required fields:

```text
booking_id
customer_id
patient_name
patient_relationship
phone_number
slot_date
slot_start_time
slot_end_time
visit_address
locality
city
pincode
phlebotomist_id
phlebotomist_name
assignment_status
eta_minutes
expected_on_time_status
reschedule_status
special_instructions
```

## Derived Use-Case Logic

### Booking Flow Churn

Examples:

```text
booking_abandoned before booking_confirmed
slot_selected but payment_status != paid
payment_started and payment_failed
address_started but address_added is missing
phone_number present and dnd_status = false
```

### Lab Test User Reactivation

Examples:

```text
last completed booking older than threshold
no completed booking since last_completed_booking_date
follow_up_recommended = true and follow_up_booking_id is null
report_viewed = true but no repeat booking
marketing_consent = true and dnd_status = false
```

### Pre-Visit Customer Coordination

Examples:

```text
booking_status = confirmed
slot_date within next 24 hours
visit_address present
assignment_status in assigned, en_route
expected_on_time_status available
phone_number present
```

Recommended coordination output fields derived by Actioneer:

```text
booking_id
customer_id
coordination_reason
customer_context_summary
slot_confirmation_message
address_confirmation_message
eta_or_delay_message
preferred_channel
phone_number
suppression_status
```
