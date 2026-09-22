/**
 * Plivo number ↔ XML-application binding, so "Activate inbound" in the UI is a
 * real product action: it points the DID at our inbound answer_url, and "Pause"
 * restores whatever the number pointed at before. Reuses the same
 * PLIVO_AUTH_ID/PLIVO_AUTH_TOKEN as the outbound client.
 */

/**
 * Plivo app names are unique per account, and local + staging + production all
 * share one account. Each environment therefore owns its own app (suffixed by
 * Railway environment name; bare name = local, matching the app that predates
 * the suffix scheme), and a number goes live on an environment by being pointed
 * at that environment's app.
 */
function inboundAppName(): string {
  const base = "baby-sentinel-inbound-gemini";
  const env = process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_ENVIRONMENT;
  if (!env) return base;
  return `${base}-${env.toLowerCase().replace(/[^a-z0-9-]+/g, "-")}`;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function authHeader(): string {
  const token = Buffer.from(`${requireEnv("PLIVO_AUTH_ID")}:${requireEnv("PLIVO_AUTH_TOKEN")}`).toString("base64");
  return `Basic ${token}`;
}

function accountBase(): string {
  return `https://api.plivo.com/v1/Account/${encodeURIComponent(requireEnv("PLIVO_AUTH_ID"))}`;
}

async function plivo(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${accountBase()}${path}`, {
    ...init,
    headers: { Authorization: authHeader(), "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`Plivo ${path} failed (${res.status}): ${text || res.statusText}`);
  return body;
}

/** Plivo Number resources are keyed by digits only (no leading `+` or spaces). */
function plivoNumber(number: string): string {
  return number.replace(/\D/g, "");
}

export interface PlivoAccountNumber {
  number: string;
  /** Plivo's own label for the DID — what the user recognises ("vastu", "tvs"). */
  alias?: string;
  /** App id currently answering this number, if any. */
  appId?: string;
}

/** Extract the app id from Plivo's `application` resource URI. */
function appIdFromUri(uri: string | undefined): string | undefined {
  return uri?.match(/Application\/(\d+)\//)?.[1];
}

/**
 * Every DID on the account. The inbound picker lists these rather than a single
 * env var, because binding is per-number and the account holds several.
 */
export async function listAccountNumbers(): Promise<PlivoAccountNumber[]> {
  const body = (await plivo(`/Number/?limit=50`)) as {
    objects?: Array<{ number?: string; alias?: string; application?: string }>;
  };
  return (body.objects ?? [])
    .filter((o): o is { number: string; alias?: string; application?: string } => Boolean(o.number))
    .map((o) => ({ number: o.number, alias: o.alias?.trim() || undefined, appId: appIdFromUri(o.application) }));
}

/** App id currently bound to a number (undefined if none). */
export async function getNumberAppId(number: string): Promise<string | undefined> {
  const body = (await plivo(`/Number/${encodeURIComponent(plivoNumber(number))}/`)) as { application?: string };
  // `application` is a resource URI like /v1/Account/AID/Application/<id>/
  return appIdFromUri(body.application);
}

/**
 * Find this environment's inbound XML app by name — creating it if absent,
 * retargeting its URLs if they drifted (tunnel rotation, domain change) —
 * and return its app id. Matching by name rather than answer_url is what
 * makes this an upsert: names are unique per account, so a URL mismatch must
 * mean OUR app needs updating, not that a second app should be created.
 */
export async function ensureInboundApp(answerUrl: string, hangupUrl: string): Promise<string> {
  const appName = inboundAppName();
  const list = (await plivo(`/Application/?limit=50`)) as {
    objects?: Array<{ app_id: string; app_name?: string; answer_url?: string; hangup_url?: string }>;
  };
  const existing = list.objects?.find((a) => a.app_name === appName);
  if (existing) {
    if (existing.answer_url !== answerUrl || existing.hangup_url !== hangupUrl) {
      await plivo(`/Application/${existing.app_id}/`, {
        method: "POST",
        body: JSON.stringify({
          answer_url: answerUrl,
          answer_method: "POST",
          hangup_url: hangupUrl,
          hangup_method: "POST",
        }),
      });
    }
    return existing.app_id;
  }

  const created = (await plivo(`/Application/`, {
    method: "POST",
    body: JSON.stringify({
      app_name: appName,
      answer_url: answerUrl,
      answer_method: "POST",
      hangup_url: hangupUrl,
      hangup_method: "POST",
    }),
  })) as { app_id: string };
  return created.app_id;
}

export async function pointNumberToApp(number: string, appId: string): Promise<void> {
  await plivo(`/Number/${encodeURIComponent(plivoNumber(number))}/`, {
    method: "POST",
    body: JSON.stringify({ app_id: appId }),
  });
}
