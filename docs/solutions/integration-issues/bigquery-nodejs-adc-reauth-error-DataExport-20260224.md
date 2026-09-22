---
module: DataExport
date: 2026-02-24
problem_type: integration_issue
component: tooling
symptoms:
  - "GaxiosError: invalid_grant / invalid_rapt when calling BigQuery Node.js client"
  - "@google-cloud/bigquery fails with reauth error despite gcloud CLI working"
  - "bq CLI commands succeed but npx tsx script fails with auth error"
root_cause: config_error
resolution_type: environment_setup
severity: medium
tags: [bigquery, gcloud, auth, adc, service-account, nodejs]
---

# BigQuery Node.js Client Fails with ADC Reauth Error

## Symptom

Running a TypeScript script using `@google-cloud/bigquery` fails with:

```
GaxiosError: {"error":"invalid_grant","error_description":"reauth related error (invalid_rapt)"}
```

Even though `bq ls` and `bq query` via the gcloud CLI work fine.

## Root Cause

The `bq` CLI and the Node.js `@google-cloud/bigquery` client use **different credential sources**:

- **`bq` CLI** → uses gcloud CLI credentials from `~/.config/gcloud/credentials.db` (the active account set via `gcloud config set account`)
- **Node.js `@google-cloud/bigquery`** → uses **Application Default Credentials (ADC)** from `~/.config/gcloud/application_default_credentials.json`

ADC can expire independently of the CLI credentials and requires `gcloud auth application-default login` to refresh — which requires a browser. On dev machines with long-lived sessions, ADC tokens expire while gcloud CLI tokens remain valid.

The `invalid_rapt` sub-error specifically means "re-authentication proof token" is invalid — a Google Workspace security feature requiring periodic interactive re-auth that cannot be done non-interactively.

## Investigation Attempts That Didn't Work

1. **Using the default `new BigQuery({ projectId })` constructor** — picks up expired ADC automatically, no error until first API call
2. **`gcloud auth application-default login --no-browser`** — generates a URL requiring browser interaction; fails in non-interactive terminals
3. **`gcloud auth application-default login --impersonate-service-account=...`** — same browser requirement applies

## Solution

Use the service account key file directly via the `keyFilename` option in the BigQuery constructor. The service account key stored by gcloud for the `sv-data-agent` account is a valid JSON key file.

```typescript
// scripts/export-game-demo-dataset.ts

const SA_KEY_PATH =
  `${process.env.HOME}/.config/gcloud/legacy_credentials/sv-data-agent@gc-prod-459709.iam.gserviceaccount.com/adc.json`;

const bq = new BigQuery({
  projectId: "gc-prod-459709",
  keyFilename: SA_KEY_PATH,  // bypasses ADC entirely
});
```

The file at `~/.config/gcloud/legacy_credentials/<service-account>/adc.json` is a standard service account JSON key with `type: "service_account"` — it never expires (unlike OAuth user tokens).

### Why This Works

Service account keys use RSA signing to generate short-lived JWT tokens on each request. There's no interactive re-auth requirement. The key file persists indefinitely until explicitly rotated.

## Alternative Solution

If you need to use your personal account (not a service account), refresh ADC in a browser-capable session:

```bash
gcloud auth application-default login
# Opens browser → completes OAuth flow → updates ~/.config/gcloud/application_default_credentials.json
```

Then the default `new BigQuery({ projectId })` constructor works again.

## Prevention

When writing BigQuery scripts that will run on dev machines, explicitly pass `keyFilename` for the service account rather than relying on ambient ADC. ADC is convenient but silently expires.

**Pattern to follow in all BigQuery scripts:**

```typescript
const bq = new BigQuery({
  projectId: process.env.GCP_PROJECT_ID ?? "gc-prod-459709",
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
    ?? `${process.env.HOME}/.config/gcloud/legacy_credentials/sv-data-agent@gc-prod-459709.iam.gserviceaccount.com/adc.json`,
});
```

This respects `GOOGLE_APPLICATION_CREDENTIALS` env var (standard GCP convention for CI/prod) while falling back to the known key path in dev.

## File Reference

- `scripts/export-game-demo-dataset.ts` (line where `keyFilename` is used)
