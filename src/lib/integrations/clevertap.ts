import type { CleverTapConnection } from "@/lib/integrations/connections";

const BATCH_SIZE = 1000;
const MAX_CONCURRENT = 15;

type Creds = Pick<CleverTapConnection, "accountId" | "passcode" | "apiBase">;

function authHeaders(creds: Creds): Record<string, string> {
  return {
    "X-CleverTap-Account-Id": creds.accountId,
    "X-CleverTap-Passcode": creds.passcode,
    "Content-Type": "application/json",
    "Cache-Control": "no-cache",
  };
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 100) || "unnamed";
}

export function segmentAttributeKey(segmentName: string): string {
  return `ct_segment_${slugify(segmentName)}`;
}

export interface ValidateResult {
  ok: boolean;
  projectName?: string;
  status?: number;
  error?: string;
}

/**
 * Probes credentials against GET /1/settings.json — returns project name on success.
 * Used by the Connect flow to verify creds before persisting to Clerk.
 */
export async function validateConnection(creds: Creds): Promise<ValidateResult> {
  try {
    const res = await fetch(`${creds.apiBase.replace(/\/$/, "")}/1/settings.json`, {
      method: "GET",
      headers: authHeaders(creds),
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      return { ok: false, status: res.status, error: text.slice(0, 300) || `HTTP ${res.status}` };
    }
    let projectName: string | undefined;
    try {
      const json = JSON.parse(text) as Record<string, unknown>;
      const name = json["name"] ?? json["accountName"] ?? json["projectName"];
      if (typeof name === "string") projectName = name;
    } catch {
      // settings.json may not always be JSON; auth still validated by 200
    }
    return { ok: true, status: 200, projectName };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export interface CreateFileSegmentResult {
  segmentId: number | null;
  status: string;
  error?: string;
}

function csvEscape(v: string): string {
  return v.replace(/[,\n\r"]/g, "");
}

/**
 * Creates a visible "Custom List" segment in CleverTap via the 3-step API.
 * Step 1: request presigned S3 URL; Step 2: PUT CSV; Step 3: mark complete.
 * `replace: true` so re-pushing the same name overwrites.
 */
export async function createFileSegment(
  conn: CleverTapConnection,
  segmentName: string,
  identities: string[],
  creator: string,
): Promise<CreateFileSegmentResult> {
  if (!conn.adminEmail) {
    return { segmentId: null, status: "error", error: "adminEmail is required on the connection for file-segment creation" };
  }
  const base = conn.apiBase.replace(/\/$/, "");

  const unique = Array.from(
    new Set(identities.filter((v) => v !== null && v !== undefined && String(v).length > 0).map(String)),
  );
  if (unique.length === 0) {
    return { segmentId: null, status: "error", error: "0 identities" };
  }

  // Step 1 — presigned URL
  let presignedURL: string;
  try {
    const res = await fetch(`${base}/get_custom_list_segment_url`, {
      method: "POST",
      headers: authHeaders(conn),
      body: "{}",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { segmentId: null, status: "error", error: `step1 HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    const json = (await res.json().catch(() => ({}))) as { presignedS3URL?: string; status?: string };
    if (!json.presignedS3URL) {
      return { segmentId: null, status: "error", error: `step1 no URL: ${JSON.stringify(json).slice(0, 200)}` };
    }
    presignedURL = json.presignedS3URL;
  } catch (err) {
    return { segmentId: null, status: "error", error: `step1 network: ${(err as Error).message}` };
  }

  // Step 2 — PUT CSV
  const csv = ["identity,type", ...unique.map((id) => `${csvEscape(id)},i`)].join("\n");
  const filename = `actioneer_${slugify(segmentName)}_${Date.now()}.csv`;
  try {
    const res = await fetch(presignedURL, { method: "PUT", body: csv });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { segmentId: null, status: "error", error: `step2 HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
  } catch (err) {
    return { segmentId: null, status: "error", error: `step2 network: ${(err as Error).message}` };
  }

  // Step 3 — mark complete
  try {
    const res = await fetch(`${base}/upload_custom_list_segment_completed`, {
      method: "POST",
      headers: authHeaders(conn),
      body: JSON.stringify({
        name: segmentName,
        email: conn.adminEmail,
        filename,
        creator,
        url: presignedURL,
        replace: true,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { segmentId: null, status: "error", error: `step3 HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    const json = (await res.json().catch(() => ({}))) as { "Segment ID"?: number; status?: string };
    return {
      segmentId: typeof json["Segment ID"] === "number" ? json["Segment ID"] : null,
      status: String(json.status ?? "unknown"),
    };
  } catch (err) {
    return { segmentId: null, status: "error", error: `step3 network: ${(err as Error).message}` };
  }
}

export interface CampaignContent {
  subject?: string;
  body: string;
  senderName?: string;
  senderEmailId?: string;
  replyTo?: string;
  title?: string;
}

export interface CreateCampaignResult {
  ok: boolean;
  campaignId?: number;
  dashboardUrl?: string;
  estimates?: Record<string, number>;
  error?: string;
  status?: number;
}

/**
 * Creates a CleverTap campaign targeting users with the given profile attribute.
 * Uses inline `where` filter so no named segment is required (Custom List API is plan-gated).
 * `target_mode`: "email" is the most reliable on Trial (no BSP / device token requirements).
 */
export async function createCampaign(
  conn: CleverTapConnection,
  opts: {
    name: string;
    targetMode: "email" | "push" | "sms" | "webpush" | "whatsapp";
    content: CampaignContent;
    filterAttribute: string;
    filterValue?: string;
  },
): Promise<CreateCampaignResult> {
  const base = conn.apiBase.replace(/\/$/, "");
  const today = new Date();
  const toYMD = today.toISOString().slice(0, 10).replace(/-/g, "");
  const fromDate = new Date(today);
  fromDate.setFullYear(fromDate.getFullYear() - 1);
  const fromYMD = fromDate.toISOString().slice(0, 10).replace(/-/g, "");

  const { content, targetMode, filterAttribute } = opts;
  const contentBody: Record<string, unknown> = {};
  if (targetMode === "email") {
    contentBody.subject = content.subject || "(no subject)";
    contentBody.body = content.body;
    contentBody.sender_name = content.senderName || "Actioneer";
    if (content.senderEmailId) contentBody.sender_email_id = content.senderEmailId;
    if (content.replyTo) contentBody.reply_to = content.replyTo;
  } else if (targetMode === "sms") {
    contentBody.body = content.body;
    if (content.senderName) contentBody.sender_name = content.senderName;
  } else {
    contentBody.title = content.title || content.subject || "Actioneer";
    contentBody.body = content.body;
  }

  const payload = {
    name: opts.name,
    target_mode: targetMode,
    where: {
      common_profile_properties: {
        profile_fields: [
          { name: filterAttribute, operator: "equals", value: opts.filterValue ?? "true" },
        ],
      },
      from: parseInt(fromYMD, 10),
      to: parseInt(toYMD, 10),
    },
    content: contentBody,
    when: "now",
  };

  try {
    const res = await fetch(`${base}/1/targets/create.json`, {
      method: "POST",
      headers: authHeaders(conn),
      body: JSON.stringify(payload),
    });
    const json = (await res.json().catch(() => ({}))) as {
      status?: string;
      id?: number;
      url?: string;
      estimates?: Record<string, number>;
      error?: string;
    };
    if (!res.ok || json.status !== "success") {
      return { ok: false, status: res.status, error: json.error ?? `HTTP ${res.status}` };
    }
    return {
      ok: true,
      campaignId: json.id,
      dashboardUrl: json.url,
      estimates: json.estimates,
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export interface UploadResult {
  totalSent: number;
  processed: number;
  unprocessed: number;
  batches: number;
  errors: string[];
}

interface UploadRecord {
  identity: string;
  type: "profile";
  profileData: Record<string, unknown>;
}

interface CleverTapUploadResponse {
  status?: string;
  processed?: number;
  unprocessed?: unknown[];
}

export async function uploadProfiles(
  conn: CleverTapConnection,
  identities: string[],
  segmentKey: string,
): Promise<UploadResult> {
  const base = conn.apiBase.replace(/\/$/, "");

  const unique = Array.from(
    new Set(identities.filter((v) => v !== null && v !== undefined && String(v).length > 0).map(String)),
  );
  if (unique.length === 0) {
    return { totalSent: 0, processed: 0, unprocessed: 0, batches: 0, errors: [] };
  }

  const batches: string[][] = [];
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    batches.push(unique.slice(i, i + BATCH_SIZE));
  }

  const lastPushedAt = new Date().toISOString();
  let processed = 0;
  let unprocessed = 0;
  const errors: string[] = [];

  for (let w = 0; w < batches.length; w += MAX_CONCURRENT) {
    const wave = batches.slice(w, w + MAX_CONCURRENT);
    const results = await Promise.all(
      wave.map(async (batch) => {
        const records: UploadRecord[] = batch.map((identity) => ({
          identity,
          type: "profile",
          profileData: {
            [segmentKey]: true,
            "Last Pushed": lastPushedAt,
          },
        }));
        try {
          const res = await fetch(`${base}/1/upload`, {
            method: "POST",
            headers: authHeaders(conn),
            body: JSON.stringify({ d: records }),
          });
          if (!res.ok) {
            const text = await res.text().catch(() => "");
            return {
              processed: 0,
              unprocessed: batch.length,
              error: `HTTP ${res.status}: ${text.slice(0, 200)}`,
            };
          }
          const json = (await res.json().catch(() => ({}))) as CleverTapUploadResponse;
          const upCount = Array.isArray(json.unprocessed) ? json.unprocessed.length : 0;
          return {
            processed: typeof json.processed === "number" ? json.processed : batch.length - upCount,
            unprocessed: upCount,
            error: json.status !== "success" ? `status=${String(json.status)}` : undefined,
          };
        } catch (err) {
          return {
            processed: 0,
            unprocessed: batch.length,
            error: `network: ${(err as Error).message}`,
          };
        }
      }),
    );
    for (const r of results) {
      processed += r.processed;
      unprocessed += r.unprocessed;
      if (r.error) errors.push(r.error);
    }
  }

  return {
    totalSent: unique.length,
    processed,
    unprocessed,
    batches: batches.length,
    errors,
  };
}

export interface CampaignStats {
  targetId: number;
  sent?: number;
  clicked?: number;
  campaignName?: string;
  campaignType?: string;
  completedAt?: string;
  lastUpdated?: string;
  reportStatus?: string;   // "success" | "ongoing" (409) | other
  ok: boolean;
  httpStatus?: number;
  error?: string;
  raw?: unknown;
}

/**
 * Fetches per-campaign result stats from CleverTap's Get Campaign Report API.
 *
 * Endpoint (documented, synchronous):
 *   POST /1/targets/result.json  with body { id: <campaign_id> }
 *
 * Response schema (only these fields exist — no viewed/opened/delivered):
 *   { status: "success", result: { sent, clicked }, metadata: {...} }
 *
 * HTTP 409 means the campaign is ongoing and the report isn't finalized yet.
 * Rate limit: 60 req/min per campaign. Recommended poll: 1–5 min.
 */
export async function fetchCampaignResult(
  conn: CleverTapConnection,
  targetId: number,
): Promise<CampaignStats> {
  const base = conn.apiBase.replace(/\/$/, "");
  const url = `${base}/1/targets/result.json`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: authHeaders(conn),
      body: JSON.stringify({ id: targetId }),
    });
    const text = await res.text().catch(() => "");
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { parsed = text; }

    if (res.status === 409) {
      return {
        targetId,
        ok: true,
        httpStatus: 409,
        reportStatus: "ongoing",
        raw: parsed,
      };
    }
    if (!res.ok) {
      return {
        targetId,
        ok: false,
        httpStatus: res.status,
        error: typeof parsed === "string" ? parsed.slice(0, 300) : JSON.stringify(parsed).slice(0, 300),
        raw: parsed,
      };
    }

    const obj = (parsed ?? {}) as Record<string, unknown>;
    const result = (obj["result"] as Record<string, unknown> | undefined) ?? {};
    const meta = (obj["metadata"] as Record<string, unknown> | undefined) ?? {};

    const num = (v: unknown): number | undefined => {
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
      return undefined;
    };
    const str = (v: unknown): string | undefined =>
      typeof v === "string" && v.trim() !== "" ? v : undefined;

    return {
      targetId,
      ok: true,
      httpStatus: res.status,
      sent: num(result["sent"]),
      clicked: num(result["clicked"]),
      campaignName: str(meta["campaign_name"]),
      campaignType: str(meta["campaign_type"]),
      completedAt: str(meta["completed_at"]),
      lastUpdated: str(meta["last_updated"]),
      reportStatus: str(obj["status"]),
      raw: parsed,
    };
  } catch (err) {
    return { targetId, ok: false, error: (err as Error).message };
  }
}

/**
 * Patches synthetic profiles keyed by email address with the segment-membership
 * attribute AND an `Email` field, so the configured test recipients reliably
 * receive any campaign fired against this segment. These are separate profiles
 * from the real segment identities — they exist purely to give the email
 * channel a deliverable address to dispatch to.
 */
export async function uploadTestRecipientProfiles(
  conn: CleverTapConnection,
  emails: string[],
  segmentKey: string,
): Promise<UploadResult> {
  const base = conn.apiBase.replace(/\/$/, "");

  const unique = Array.from(
    new Set(
      emails
        .filter((e) => typeof e === "string" && e.includes("@"))
        .map((e) => e.trim().toLowerCase()),
    ),
  );
  if (unique.length === 0) {
    return { totalSent: 0, processed: 0, unprocessed: 0, batches: 0, errors: [] };
  }

  const lastPushedAt = new Date().toISOString();
  const records: UploadRecord[] = unique.map((email) => ({
    identity: email,
    type: "profile",
    profileData: {
      Email: email,
      [segmentKey]: true,
      "Last Pushed": lastPushedAt,
    },
  }));

  try {
    const res = await fetch(`${base}/1/upload`, {
      method: "POST",
      headers: authHeaders(conn),
      body: JSON.stringify({ d: records }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        totalSent: unique.length,
        processed: 0,
        unprocessed: unique.length,
        batches: 1,
        errors: [`test-recipients HTTP ${res.status}: ${text.slice(0, 200)}`],
      };
    }
    const json = (await res.json().catch(() => ({}))) as CleverTapUploadResponse;
    const upCount = Array.isArray(json.unprocessed) ? json.unprocessed.length : 0;
    return {
      totalSent: unique.length,
      processed: typeof json.processed === "number" ? json.processed : unique.length - upCount,
      unprocessed: upCount,
      batches: 1,
      errors: json.status !== "success" ? [`test-recipients status=${String(json.status)}`] : [],
    };
  } catch (err) {
    return {
      totalSent: unique.length,
      processed: 0,
      unprocessed: unique.length,
      batches: 1,
      errors: [`test-recipients network: ${(err as Error).message}`],
    };
  }
}
