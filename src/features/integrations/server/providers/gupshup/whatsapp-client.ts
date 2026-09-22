import { getEffectiveWhatsAppCredentials } from "@/lib/tenant-connections-store";

const GUPSHUP_REQUEST_TIMEOUT_MS = 8000;

type TemplateVariableValue = string | number | boolean | null | undefined;

export interface WhatsAppTemplateRuntime {
  [key: string]: TemplateVariableValue;
}

export interface WhatsAppTemplatePayload {
  templateId: string;
  params: string[];
  /** Legacy alias kept so older follow-up records can still render. */
  contentSid: string;
  /** Legacy keyed form used by existing workflow config. */
  contentVariables: Record<string, string>;
}

export interface ResolveWhatsAppTemplatePayloadInput {
  userId?: string;
  credentials?: Record<string, string | undefined>;
  templateId?: string;
  /** Legacy Twilio field accepted while old campaign workflow records exist. */
  contentSid?: string;
  configuredParams?: Array<TemplateVariableValue> | Record<string, TemplateVariableValue> | string;
  /** Legacy keyed variable config accepted from existing workflow nodes. */
  configuredVariables?: Record<string, TemplateVariableValue> | string;
  runtimeVariables?: WhatsAppTemplateRuntime;
  /** Media header. Requires the approved template to declare the same header type. */
  media?: WhatsAppMediaPayload;
}

export interface SendWhatsAppResult {
  sid: string;
  status: string;
  from: string;
  to: string;
  provider: "gupshup";
  templateId?: string;
  contentSid?: string;
  /** Set when the message carried media. */
  mediaType?: WhatsAppMediaType;
}

export type WhatsAppMediaType = "image" | "video" | "audio" | "file" | "sticker";

/**
 * Media attached to a WhatsApp message.
 *
 * `url` must be publicly reachable — Gupshup fetches it server-side, so a
 * localhost or private-network URL fails with an opaque provider error. Use
 * resolvePublicBaseUrl() (tunnel in dev, platform domain in prod) or S3.
 *
 * Meta size caps, enforced on their side, not ours: image 5MB, video 16MB,
 * audio 16MB, file 100MB, sticker 100KB.
 */
export interface WhatsAppMediaPayload {
  type: WhatsAppMediaType;
  url: string;
  /** Thumbnail. Image only; defaults to `url`. */
  previewUrl?: string;
  /** Image and video only — ignored elsewhere by the provider. */
  caption?: string;
  /** Required for `file`; Gupshup rejects a document with no filename. */
  filename?: string;
}

function assertPublicMediaUrl(url: string): string {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error(`WhatsApp media url must be an absolute http(s) URL, got "${trimmed}"`);
  }
  let host: string;
  try {
    host = new URL(trimmed).hostname.toLowerCase();
  } catch {
    throw new Error(`WhatsApp media url is not a valid URL: "${trimmed}"`);
  }
  // Gupshup fetches this from their own network. Catching it here turns a
  // confusing provider-side failure into an actionable local error.
  if (host === "localhost" || host === "0.0.0.0" || /^127\./.test(host) || host === "[::1]") {
    throw new Error(
      `WhatsApp media url "${trimmed}" is not reachable from Gupshup — use a public URL (S3 via hostWhatsAppMedia).`,
    );
  }
  // Dev tunnels answer a browser-ish User-Agent with an HTML interstitial
  // rather than the file. Gupshup's fetcher gets that HTML, drops the media,
  // and still delivers the message — so the image vanishes with no error
  // anywhere. Verified on a live send: the same payload rendered fine from a
  // real CDN and rendered nothing through ngrok. Fail loudly instead.
  if (TUNNEL_MEDIA_HOSTS.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) {
    throw new Error(
      `WhatsApp media url "${trimmed}" is served from a dev tunnel. Gupshup receives the tunnel's ` +
        `interstitial HTML instead of the file and the image is dropped silently. ` +
        `Upload it with hostWhatsAppMedia() and send the presigned S3 URL instead.`,
    );
  }
  return trimmed;
}

/** Tunnel hosts that inject an interstitial page in front of static files. */
const TUNNEL_MEDIA_HOSTS = [
  "ngrok-free.dev",
  "ngrok-free.app",
  "ngrok.io",
  "ngrok.app",
  "trycloudflare.com",
  "loca.lt",
  "serveo.net",
];

/**
 * `message` field for the session (/msg) endpoint.
 *
 * Note the field names differ per type, and images use `originalUrl` rather
 * than the `url` every other type uses. Kept separate from the template shape
 * below on purpose — the two endpoints genuinely disagree.
 */
function sessionMediaMessage(media: WhatsAppMediaPayload): Record<string, unknown> {
  const url = assertPublicMediaUrl(media.url);
  const caption = media.caption?.replace(/\s+/g, " ").trim() || undefined;
  switch (media.type) {
    case "image":
      return {
        type: "image",
        originalUrl: url,
        previewUrl: assertPublicMediaUrl(media.previewUrl?.trim() || url),
        ...(caption ? { caption } : {}),
      };
    case "video":
      return { type: "video", url, ...(caption ? { caption } : {}) };
    case "file": {
      const filename = media.filename?.trim();
      if (!filename) throw new Error("WhatsApp file media requires a filename");
      return { type: "file", url, filename };
    }
    case "audio":
      return { type: "audio", url };
    case "sticker":
      return { type: "sticker", url };
  }
}

/**
 * `message` field for the template (/template/msg) endpoint — a *separate*
 * form field alongside `template`. The template itself must already be
 * approved by Meta with a matching media header; params fill body text only.
 */
function templateMediaMessage(media: WhatsAppMediaPayload): Record<string, unknown> {
  const link = assertPublicMediaUrl(media.url);
  if (media.type === "sticker") {
    throw new Error("WhatsApp templates do not support sticker headers");
  }
  const key = media.type === "file" ? "document" : media.type;
  const filename = media.type === "file" ? media.filename?.trim() : undefined;
  if (media.type === "file" && !filename) {
    throw new Error("WhatsApp document template header requires a filename");
  }
  return {
    type: key,
    [key]: { link, ...(filename ? { filename } : {}) },
  };
}

export interface GupshupWhatsAppTemplate {
  id: string;
  name: string;
  status?: string;
  category?: string;
  type?: string;
  languageCode?: string;
  body?: string;
  parameterCount: number;
  defaultParams: string[];
}

type GupshupTemplateApiMode = "account" | "partner";

interface GupshupWhatsAppConfig {
  apiKey: string;
  source: string;
  appName: string;
  appId?: string;
  templateId?: string;
  templateParams?: string;
  apiBase: string;
  templateApiBase: string;
}

interface GupshupCredentialInput {
  userId?: string;
  credentials?: Record<string, string | undefined>;
}

interface GupshupTemplateListConfig {
  mode: GupshupTemplateApiMode;
  appId: string;
  apiKey?: string;
  partnerToken?: string;
  apiBase: string;
}

interface GupshupResponseBody {
  status?: string;
  messageId?: string;
  message_id?: string;
  id?: string;
  error?: string;
  message?: string;
}

function requireValue(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function digitsOnlyPhone(value: string): string {
  return value.trim().replace(/^whatsapp:/i, "").replace(/\D/g, "");
}

function normalizeSource(value: string): string {
  const normalized = digitsOnlyPhone(value);
  if (!normalized) throw new Error("GUPSHUP_WHATSAPP_SOURCE is not valid");
  return normalized;
}

function normalizeDestination(value: string): string {
  const normalized = digitsOnlyPhone(value);
  if (!normalized) throw new Error("WhatsApp destination is not valid");
  return normalized;
}

function cleanBaseUrl(value: string | undefined, fallback: string): string {
  return (value?.trim() || fallback).replace(/\/+$/, "");
}

function mergeCredentialOverride(
  value: string | undefined,
  fallback: string | undefined,
): string | undefined {
  return value?.trim() || fallback;
}

function gupshupCredentials(input?: string | GupshupCredentialInput): GupshupWhatsAppConfig {
  const userId = typeof input === "string" ? input : input?.userId;
  const overrides = typeof input === "string" ? undefined : input?.credentials;
  const credentials = getEffectiveWhatsAppCredentials(userId);
  return {
    apiKey: requireValue(
      "GUPSHUP_WHATSAPP_API_KEY",
      mergeCredentialOverride(overrides?.apiKey, credentials.apiKey),
    ),
    source: normalizeSource(requireValue(
      "GUPSHUP_WHATSAPP_SOURCE",
      mergeCredentialOverride(overrides?.source, credentials.source),
    )),
    appName: requireValue(
      "GUPSHUP_WHATSAPP_APP_NAME",
      mergeCredentialOverride(overrides?.appName, credentials.appName),
    ),
    appId: mergeCredentialOverride(overrides?.appId, credentials.appId),
    templateId: mergeCredentialOverride(overrides?.templateId, credentials.templateId),
    templateParams: mergeCredentialOverride(overrides?.templateParams, credentials.templateParams),
    apiBase: cleanBaseUrl(
      mergeCredentialOverride(overrides?.apiBase, credentials.apiBase),
      "https://api.gupshup.io/wa/api/v1",
    ),
    templateApiBase: cleanBaseUrl(
      mergeCredentialOverride(overrides?.templateApiBase, credentials.templateApiBase),
      "https://api.gupshup.io/wa",
    ),
  };
}

function gupshupTemplateListCredentials(
  input: { userId?: string; credentials?: Record<string, string | undefined> } = {},
): GupshupTemplateListConfig {
  const effective = getEffectiveWhatsAppCredentials(input.userId);
  const overrides = input.credentials ?? {};
  const apiKey = mergeCredentialOverride(overrides.apiKey, effective.apiKey);
  const partnerToken = mergeCredentialOverride(overrides.partnerToken, effective.partnerToken);
  const rawMode = mergeCredentialOverride(overrides.templateApiMode, effective.templateApiMode);
  const mode: GupshupTemplateApiMode = rawMode === "partner" || (!rawMode && partnerToken && !apiKey)
    ? "partner"
    : "account";
  return {
    mode,
    appId: requireValue(
      "GUPSHUP_WHATSAPP_APP_ID",
      mergeCredentialOverride(overrides.appId, effective.appId),
    ),
    apiKey: mode === "account" ? requireValue("GUPSHUP_WHATSAPP_API_KEY", apiKey) : apiKey,
    partnerToken: mode === "partner"
      ? requireValue("GUPSHUP_WHATSAPP_PARTNER_TOKEN", partnerToken)
      : partnerToken,
    apiBase: mode === "partner"
      ? cleanBaseUrl(
          mergeCredentialOverride(overrides.partnerApiBase, effective.partnerApiBase),
          "https://partner.gupshup.io/partner",
        )
      : cleanBaseUrl(
          mergeCredentialOverride(overrides.templateApiBase, effective.templateApiBase),
          "https://api.gupshup.io/wa",
        ),
  };
}

function normalizeVariables(
  variables: Record<string, TemplateVariableValue> | undefined,
): Record<string, string> | undefined {
  if (!variables) return undefined;
  const entries = Object.entries(variables)
    .filter(([key]) => key.trim().length > 0)
    .map(([key, value]) => [key.trim(), value == null ? "" : String(value)] as const);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function parseConfiguredValue(raw: string | undefined): unknown {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error("GUPSHUP_WHATSAPP_TEMPLATE_PARAMS must be valid JSON");
  }
}

function objectValuesInTemplateOrder(value: Record<string, TemplateVariableValue>): string[] {
  return Object.entries(value)
    .filter(([key]) => key.trim().length > 0)
    .sort(([a], [b]) => {
      const aNum = Number(a);
      const bNum = Number(b);
      if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum;
      if (Number.isFinite(aNum)) return -1;
      if (Number.isFinite(bNum)) return 1;
      return 0;
    })
    .map(([, val]) => val == null ? "" : String(val));
}

function configuredParamsToArray(
  value: Array<TemplateVariableValue> | Record<string, TemplateVariableValue> | string | undefined,
): string[] | undefined {
  const parsed = typeof value === "string" ? parseConfiguredValue(value) : value;
  if (parsed === undefined) return undefined;
  if (Array.isArray(parsed)) return parsed.map((item) => item == null ? "" : String(item));
  if (parsed && typeof parsed === "object") {
    return objectValuesInTemplateOrder(parsed as Record<string, TemplateVariableValue>);
  }
  throw new Error("GUPSHUP_WHATSAPP_TEMPLATE_PARAMS must be a JSON array or object");
}

function renderVariableTemplate(value: string, runtime: WhatsAppTemplateRuntime): string {
  return value.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}|\{\s*([A-Za-z0-9_]+)\s*\}/g, (_match, doubleName, singleName) => {
    const name = String(doubleName || singleName);
    const next = runtime[name];
    return next == null ? "" : String(next);
  });
}

function paramsToLegacyVariables(params: string[]): Record<string, string> {
  return Object.fromEntries(params.map((value, index) => [String(index + 1), value]));
}

export function renderWhatsAppTemplateParams(
  params: string[] | undefined,
  runtime: WhatsAppTemplateRuntime = {},
): string[] {
  const normalized = params === undefined ? ["{message}"] : params;
  return normalized.map((value) => renderVariableTemplate(value, runtime));
}

export function renderWhatsAppTemplateVariables(
  variables: Record<string, TemplateVariableValue> | undefined,
  runtime: WhatsAppTemplateRuntime = {},
): Record<string, string> {
  const normalized = normalizeVariables(variables) ?? { "1": "{message}" };
  return Object.fromEntries(
    Object.entries(normalized).map(([key, value]) => [
      key,
      renderVariableTemplate(value, runtime),
    ]),
  );
}

export function resolveWhatsAppTemplatePayload(
  input: ResolveWhatsAppTemplatePayloadInput = {},
): WhatsAppTemplatePayload | undefined {
  const credentials = getEffectiveWhatsAppCredentials(input.userId);
  const templateId = input.templateId?.trim() ||
    input.contentSid?.trim() ||
    input.credentials?.templateId?.trim() ||
    credentials.templateId?.trim();
  if (!templateId) return undefined;

  const paramsFromNewConfig = configuredParamsToArray(
    input.configuredParams ?? input.credentials?.templateParams ?? credentials.templateParams,
  );
  const variablesFromLegacyConfig = typeof input.configuredVariables === "string"
    ? normalizeVariables(parseConfiguredValue(input.configuredVariables) as Record<string, TemplateVariableValue>)
    : normalizeVariables(input.configuredVariables);

  const renderedParams = paramsFromNewConfig
    ? renderWhatsAppTemplateParams(paramsFromNewConfig, input.runtimeVariables)
    : variablesFromLegacyConfig
      ? objectValuesInTemplateOrder(renderWhatsAppTemplateVariables(variablesFromLegacyConfig, input.runtimeVariables))
      : renderWhatsAppTemplateParams(undefined, input.runtimeVariables);

  return {
    templateId,
    params: renderedParams,
    contentSid: templateId,
    contentVariables: paramsToLegacyVariables(renderedParams),
  };
}

export function hasGupshupWhatsAppTemplateConfig(userId?: string): boolean {
  return Boolean(resolveWhatsAppTemplatePayload({ userId }));
}

export function ensureGupshupWhatsAppConfig(userId?: string): void {
  gupshupCredentials(userId);
  if (!resolveWhatsAppTemplatePayload({ userId })) {
    throw new Error("GUPSHUP_WHATSAPP_TEMPLATE_ID is not set");
  }
}

function responseStatus(body: GupshupResponseBody, fallback: string): string {
  return body.status?.trim() || fallback;
}

function responseMessageId(body: GupshupResponseBody): string {
  return body.messageId || body.message_id || body.id || "";
}

function parseResponseText(text: string): GupshupResponseBody {
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as GupshupResponseBody;
  } catch {
    return { status: text.trim() };
  }
}

async function parseJsonResponse(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { status: text.trim() };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = stringValue(record[key]);
    if (value) return value;
  }
  return undefined;
}

function parseJsonObject(value: unknown): Record<string, unknown> | undefined {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return undefined;
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function templateBody(record: Record<string, unknown>): string | undefined {
  const direct = firstString(record, [
    "body",
    "data",
    "template",
    "templateText",
    "template_text",
    "content",
    "text",
  ]);
  if (direct) return direct;

  const containerMeta = parseJsonObject(record.containerMeta ?? record.container_meta);
  if (!containerMeta) return undefined;
  return firstString(containerMeta, [
    "body",
    "data",
    "sampleText",
    "sample_text",
    "template",
    "templateText",
    "text",
  ]);
}

function templateParameterCount(body: string | undefined): number {
  if (!body) return 0;
  const seen = new Set<string>();
  for (const match of body.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
    const name = match[1]?.trim();
    if (name) seen.add(name);
  }
  return seen.size;
}

function defaultParamsForTemplate(parameterCount: number): string[] {
  if (parameterCount <= 0) return [];
  return Array.from({ length: parameterCount }, () => "{message}");
}

function appendOptionalQueryParam(params: URLSearchParams, key: string, value: string | undefined): void {
  const trimmed = value?.trim();
  if (trimmed) params.set(key, trimmed);
}

function responseTemplateArrays(value: unknown): unknown[][] {
  if (Array.isArray(value)) return [value];
  if (!isRecord(value)) return [];
  const candidates = [
    value.templates,
    value.templateList,
    value.template_list,
    value.results,
    value.items,
    value.data,
  ];
  const arrays: unknown[][] = [];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) arrays.push(candidate);
    else if (isRecord(candidate)) arrays.push(...responseTemplateArrays(candidate));
  }
  return arrays;
}

function normalizeTemplateRecord(record: Record<string, unknown>): GupshupWhatsAppTemplate | undefined {
  const id = firstString(record, ["id", "templateId", "template_id", "elementId", "externalId"]);
  if (!id) return undefined;
  const name = firstString(record, ["elementName", "element_name", "templateName", "template_name", "name"]) ?? id;
  const body = templateBody(record);
  const parameterCount = templateParameterCount(body);
  return {
    id,
    name,
    status: firstString(record, ["templateStatus", "template_status", "status", "stage"]),
    category: firstString(record, ["templateCategory", "template_category", "category"]),
    type: firstString(record, ["templateType", "template_type", "type"]),
    languageCode: firstString(record, ["languageCode", "language_code", "language"]),
    body,
    parameterCount,
    defaultParams: defaultParamsForTemplate(parameterCount),
  };
}

function normalizeTemplateResponse(body: unknown): GupshupWhatsAppTemplate[] {
  const arrays = responseTemplateArrays(body);
  const templates = arrays
    .flatMap((items) => items)
    .filter(isRecord)
    .map(normalizeTemplateRecord)
    .filter((template): template is GupshupWhatsAppTemplate => Boolean(template));
  return Array.from(new Map(templates.map((template) => [template.id, template])).values());
}

async function postForm(
  url: string,
  config: GupshupWhatsAppConfig,
  fields: Record<string, string>,
): Promise<GupshupResponseBody> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        apikey: config.apiKey,
      },
      body: new URLSearchParams(fields),
      signal: AbortSignal.timeout(GUPSHUP_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error(`Gupshup WhatsApp API timed out after ${GUPSHUP_REQUEST_TIMEOUT_MS}ms`);
    }
    throw error;
  }
  const text = await res.text();
  const parsed = parseResponseText(text);
  if (!res.ok) {
    throw new Error(parsed.error || parsed.message || parsed.status || `Gupshup WhatsApp API error ${res.status}`);
  }
  return parsed;
}

export async function fetchGupshupWhatsAppTemplates(input: {
  userId?: string;
  credentials?: Record<string, string | undefined>;
  templateStatus?: string;
  templateType?: string;
  pageSize?: number;
  maxPages?: number;
} = {}): Promise<GupshupWhatsAppTemplate[]> {
  const config = gupshupTemplateListCredentials(input);
  const pageSize = Math.min(Math.max(input.pageSize ?? 100, 1), 100);
  const maxPages = Math.min(Math.max(input.maxPages ?? 10, 1), 50);
  const templates: GupshupWhatsAppTemplate[] = [];

  for (let pageNo = 0; pageNo < maxPages; pageNo += 1) {
    const params = new URLSearchParams({
      pageNo: String(pageNo),
      pageSize: String(pageSize),
    });
    appendOptionalQueryParam(params, config.mode === "partner" ? "status" : "templateStatus", input.templateStatus);
    appendOptionalQueryParam(params, "templateType", input.templateType);
    const url = config.mode === "partner"
      ? `${config.apiBase}/app/${encodeURIComponent(config.appId)}/templates?${params}`
      : `${config.apiBase}/app/${encodeURIComponent(config.appId)}/template?${params}`;
    const res = await fetch(
      url,
      {
        headers: {
          Accept: "application/json",
          ...(config.mode === "partner"
            ? { token: requireValue("GUPSHUP_WHATSAPP_PARTNER_TOKEN", config.partnerToken) }
            : { apikey: requireValue("GUPSHUP_WHATSAPP_API_KEY", config.apiKey) }),
        },
        cache: "no-store",
      },
    );
    const parsed = await parseJsonResponse(res);
    if (!res.ok) {
      const message = isRecord(parsed)
        ? stringValue(parsed.error) ?? stringValue(parsed.message) ?? stringValue(parsed.status)
        : undefined;
      throw new Error(message ?? `Gupshup template API error ${res.status}`);
    }
    const pageTemplates = normalizeTemplateResponse(parsed);
    templates.push(...pageTemplates);
    if (pageTemplates.length < pageSize) break;
  }

  return Array.from(new Map(templates.map((template) => [template.id, template])).values());
}

export async function sendWhatsApp(
  to: string,
  body: string,
  options: { userId?: string } = {},
): Promise<SendWhatsAppResult> {
  return sendWhatsAppTemplate(to, {
    userId: options.userId,
    runtimeVariables: {
      message: body,
      body,
      text: body,
    },
  });
}


export async function sendWhatsAppSessionText(
  to: string,
  body: string,
  input: GupshupCredentialInput = {},
): Promise<SendWhatsAppResult> {
  const config = gupshupCredentials(input);
  const destination = normalizeDestination(to);
  const text = body.replace(/\s+/g, " ").trim();
  if (!text) throw new Error("WhatsApp session reply text is required");

  const parsed = await postForm(`${config.apiBase}/msg`, config, {
    channel: "whatsapp",
    source: config.source,
    "src.name": config.appName,
    destination,
    message: JSON.stringify({ type: "text", text }),
  });

  return {
    sid: responseMessageId(parsed),
    status: responseStatus(parsed, "submitted"),
    from: config.source,
    to: destination,
    provider: "gupshup",
  };
}

/**
 * Send media inside the 24h customer-service window.
 *
 * Free-form, so it needs no Meta template approval — but it is only legal
 * while the window is open. Check hasOpenWhatsAppSession() first; outside the
 * window this is rejected by the provider and an approved media template is
 * the only route.
 *
 * A caption rides on the media itself (image/video). WhatsApp has no way to
 * attach a caption to audio, files or stickers — send a separate text message
 * for those.
 */
export async function sendWhatsAppSessionMedia(
  to: string,
  media: WhatsAppMediaPayload,
  input: GupshupCredentialInput = {},
): Promise<SendWhatsAppResult> {
  const config = gupshupCredentials(input);
  const destination = normalizeDestination(to);

  const parsed = await postForm(`${config.apiBase}/msg`, config, {
    channel: "whatsapp",
    source: config.source,
    "src.name": config.appName,
    destination,
    message: JSON.stringify(sessionMediaMessage(media)),
  });

  return {
    sid: responseMessageId(parsed),
    status: responseStatus(parsed, "submitted"),
    from: config.source,
    to: destination,
    provider: "gupshup",
    mediaType: media.type,
  };
}

export async function sendWhatsAppTemplate(
  to: string,
  input: ResolveWhatsAppTemplatePayloadInput = {},
): Promise<SendWhatsAppResult> {
  const config = gupshupCredentials(input);
  const destination = normalizeDestination(to);
  const payload = resolveWhatsAppTemplatePayload(input);
  if (!payload) {
    throw new Error("GUPSHUP_WHATSAPP_TEMPLATE_ID is not set");
  }
  const blankParamIndex = payload.params.findIndex((value) => !value.trim());
  if (blankParamIndex >= 0) {
    throw new Error(`WhatsApp template parameter ${blankParamIndex + 1} resolved to an empty text value`);
  }
  const parsed = await postForm(`${config.apiBase}/template/msg`, config, {
    source: config.source,
    "src.name": config.appName,
    destination,
    template: JSON.stringify({ id: payload.templateId, params: payload.params }),
    // Media header travels in its own form field, NOT inside `template`.
    // Only valid when the approved template declares a matching header.
    ...(input.media ? { message: JSON.stringify(templateMediaMessage(input.media)) } : {}),
  });

  return {
    sid: responseMessageId(parsed),
    status: responseStatus(parsed, "submitted"),
    from: config.source,
    to: destination,
    provider: "gupshup",
    templateId: payload.templateId,
    contentSid: payload.templateId,
    ...(input.media ? { mediaType: input.media.type } : {}),
  };
}

export function validateGupshupWhatsAppConfig(
  config: Record<string, string | undefined> = {},
): { ok: true } | { ok: false; missing: string[] } {
  const mode = config.templateApiMode === "partner" ||
    (!config.templateApiMode && !config.apiKey && (config.partnerToken || process.env.GUPSHUP_WHATSAPP_PARTNER_TOKEN))
    ? "partner"
    : "account";
  const merged = {
    appId: config.appId ?? process.env.GUPSHUP_WHATSAPP_APP_ID,
    ...(mode === "partner"
      ? { partnerToken: config.partnerToken ?? process.env.GUPSHUP_WHATSAPP_PARTNER_TOKEN }
      : { apiKey: config.apiKey ?? process.env.GUPSHUP_WHATSAPP_API_KEY }),
  };
  const missing = Object.entries(merged)
    .filter(([, value]) => !value?.trim())
    .map(([key]) => key);
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

export async function testGupshupWhatsAppConnection(
  config: Record<string, string | undefined> = {},
): Promise<{ ok: boolean; status?: number; label?: string; error?: string }> {
  const validation = validateGupshupWhatsAppConfig(config);
  if (!validation.ok) {
    return { ok: false, error: `Missing ${validation.missing.join(", ")}` };
  }

  const appId = config.appId?.trim() || process.env.GUPSHUP_WHATSAPP_APP_ID?.trim();
  const label = `Gupshup app ${requireValue("GUPSHUP_WHATSAPP_APP_ID", appId)}`;

  try {
    const templates = await fetchGupshupWhatsAppTemplates({
      credentials: config,
      pageSize: 100,
      maxPages: 1,
    });
    if (templates.length === 0) {
      return { ok: true, label: `${label} / no templates found` };
    }
    return { ok: true, label: `${label} / ${templates.length} templates` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Gupshup test failed" };
  }
}
