/**
 * Tenant-level connection registry.
 *
 * Credentials are stored per-user in a JSONL append log.
 * Environment variables act as a fallback for dev/ops-configured credentials.
 * Priority: JSONL configured > env vars.
 *
 * Credentials are stored server-side only and never returned to the client
 * in raw form — only masked display values are sent over the wire.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import {
  deleteIntegrationConnectionByCapability,
  upsertIntegrationConnection,
} from "@/features/integrations/server/connections";
import { ACTIONEER_CDP_ENABLED } from "@/lib/datasets/constants";
import type { IntegrationCapability } from "@/features/integrations/server/capabilities";
import { getVoiceStorageRoot } from "./voice-storage";

export type ConnectionType =
  | "cdp"
  | "sms"
  | "whatsapp"
  | "email"
  | "hubspot"
  | "plivo"
  | "exotel"
  | "zoho";

export interface TenantConnection {
  type: ConnectionType;
  label: string;
  provider: string;
  status: "connected" | "not_connected" | "coming_soon";
  source: "environment" | "configured";
  meta: Record<string, string>; // masked display values — safe for client
  prefill?: Record<string, string>; // non-secret values only — safe for client forms
  configuredSecretKeys?: string[]; // lets the UI show that a secret exists without exposing it
}

// Raw credentials stored in JSONL — never sent to client
export interface StoredCredentials {
  type: ConnectionType;
  userId: string;
  provider: string;
  credentials: Record<string, string>;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// globalThis pinning (same pattern as attribution-store)
// ---------------------------------------------------------------------------

type G = typeof globalThis & {
  __tenantConns?: Map<string, StoredCredentials>; // key: `${userId}:${type}`
  __tenantConnsLoaded?: boolean;
};
const g = globalThis as G;
if (!g.__tenantConns) g.__tenantConns = new Map();
if (g.__tenantConnsLoaded === undefined) g.__tenantConnsLoaded = false;

const store = g.__tenantConns;

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function storePath(): string {
  const root = getVoiceStorageRoot();
  mkdirSync(root, { recursive: true });
  return join(root, "tenant-connections.jsonl");
}

function load(): void {
  if (g.__tenantConnsLoaded) return;
  g.__tenantConnsLoaded = true;

  const path = storePath();
  if (!existsSync(path)) return;

  try {
    const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as { op: "set" | "delete" } & StoredCredentials;
        const key = `${entry.userId}:${entry.type}`;
        if (entry.op === "delete") {
          store.delete(key);
        } else {
          store.set(key, entry);
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch (err) {
    console.error("[tenant-connections-store] load failed:", err);
  }
}

function append(op: "set" | "delete", entry: StoredCredentials): void {
  try {
    appendFileSync(storePath(), JSON.stringify({ op, ...entry }) + "\n", "utf-8");
  } catch (err) {
    console.error("[tenant-connections-store] append failed:", err);
  }
}

// ---------------------------------------------------------------------------
// Masking helpers
// ---------------------------------------------------------------------------

function maskSid(sid: string | undefined): string {
  if (!sid || sid.length < 8) return "—";
  return sid.slice(0, 4) + "••••••" + sid.slice(-4);
}

function maskToken(token: string | undefined): string {
  if (!token) return "—";
  if (token.length < 8) return "••••";
  return token.slice(0, 3) + "••••••" + token.slice(-3);
}

function maskPhone(num: string | undefined): string {
  if (!num) return "—";
  const clean = num.replace(/^whatsapp:/i, "");
  if (clean.length < 6) return clean;
  return clean.slice(0, -4).replace(/\d/g, "•") + clean.slice(-4);
}

function displayHost(url: string | undefined): string {
  if (!url) return "—";
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//i, "").replace(/\/.*$/, "") || url;
  }
}

function cleanCredentials(credentials: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(credentials)
      .map(([key, value]) => [key, value.trim()] as const)
      .filter(([, value]) => value.length > 0),
  );
}

function configuredValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function compactSafeValues(values: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
}

function capabilityForType(type: ConnectionType): IntegrationCapability {
  if (type === "cdp") return "cdp";
  if (type === "hubspot" || type === "zoho") return "crm";
  if (type === "plivo" || type === "exotel") return "dialer";
  return type;
}

function providerIdForConnection(type: ConnectionType, provider: string): string {
  const normalized = provider.trim().toLowerCase();
  if (type === "cdp" || normalized.includes("actioneer")) return "actioneer-cdp";
  if (type === "whatsapp") return "gupshup";
  if (type === "plivo") return "plivo";
  if (type === "exotel") return "exotel";
  if (type === "zoho") return "zoho-crm";
  if (normalized.includes("twilio")) return "twilio";
  if (type === "hubspot") return "hubspot";
  return normalized.replace(/[^a-z0-9_-]+/g, "-") || type;
}

function splitClientConfigAndSecrets(credentials: Record<string, string>): {
  config: Record<string, string>;
  secrets: Record<string, string>;
} {
  const config: Record<string, string> = {};
  const secrets: Record<string, string> = {};
  for (const [key, value] of Object.entries(cleanCredentials(credentials))) {
    if (/(token|secret|passcode|password|apiKey|api_key)$/i.test(key)) {
      secrets[key] = value;
    } else {
      config[key] = value;
    }
  }
  return { config, secrets };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function saveCredentials(
  userId: string,
  type: ConnectionType,
  provider: string,
  credentials: Record<string, string>,
): void {
  load();
  const existing = store.get(`${userId}:${type}`);
  const submittedCredentials = Object.fromEntries(
    Object.entries(credentials).map(([key, value]) => [key, value.trim()]),
  );
  const entry: StoredCredentials = {
    type,
    userId,
    provider,
    credentials: {
      ...(existing?.credentials ?? {}),
      ...submittedCredentials,
    },
    createdAt: new Date().toISOString(),
  };
  store.set(`${userId}:${type}`, entry);
  append("set", entry);

  const providerId = providerIdForConnection(type, provider);
  const { config, secrets } = splitClientConfigAndSecrets(entry.credentials);
  upsertIntegrationConnection({
    tenantId: userId,
    providerId,
    capability: capabilityForType(type),
    displayName: provider || type,
    status: "connected",
    config,
    secrets,
  });
}

export function deleteCredentials(userId: string, type: ConnectionType): void {
  load();
  const existing = store.get(`${userId}:${type}`);
  if (!existing) return;
  store.delete(`${userId}:${type}`);
  append("delete", { ...existing, createdAt: new Date().toISOString() });
  deleteIntegrationConnectionByCapability(
    userId,
    providerIdForConnection(type, existing.provider),
    capabilityForType(type),
  );
}

export function getRawCredentials(
  userId: string,
  type: ConnectionType,
): StoredCredentials | undefined {
  load();
  return store.get(`${userId}:${type}`);
}

export function getTenantConnections(userId?: string): TenantConnection[] {
  load();

  // ---------------------------------------------------------------------------
  // Customer data / CDP
  // ---------------------------------------------------------------------------
  const cdpCfg = userId ? store.get(`${userId}:cdp`) : undefined;
  const cdpBaseUrl =
    configuredValue(cdpCfg?.credentials.profileServiceUrl) ??
    configuredValue(cdpCfg?.credentials.baseUrl) ??
    process.env.ACTIONEER_CDP_PROFILE_SERVICE_URL;
  const cdpTenantId =
    configuredValue(cdpCfg?.credentials.tenantId) ??
    configuredValue(cdpCfg?.credentials.teamId) ??
    process.env.ACTIONEER_CDP_TENANT_ID ??
    process.env.ACTIONEER_CDP_TEAM_ID;
  const cdpAppId = configuredValue(cdpCfg?.credentials.appId) ?? process.env.ACTIONEER_CDP_APP_ID;
  const cdpConnected = Boolean(cdpBaseUrl && cdpTenantId && cdpAppId);

  // ---------------------------------------------------------------------------
  // SMS
  // ---------------------------------------------------------------------------
  const smsCfg = userId ? store.get(`${userId}:sms`) : undefined;
  const smsSid = configuredValue(smsCfg?.credentials.accountSid) ?? process.env.TWILIO_ACCOUNT_SID;
  const smsFrom = configuredValue(smsCfg?.credentials.from) ?? process.env.TWILIO_SMS_FROM ?? process.env.TWILIO_PHONE_NUMBER;
  const smsConnected = Boolean(smsSid && smsFrom);

  // ---------------------------------------------------------------------------
  // WhatsApp
  // ---------------------------------------------------------------------------
  const waCfg = userId ? store.get(`${userId}:whatsapp`) : undefined;
  const waApiKey = configuredValue(waCfg?.credentials.apiKey) ?? process.env.GUPSHUP_WHATSAPP_API_KEY;
  const waPartnerToken = configuredValue(waCfg?.credentials.partnerToken) ?? process.env.GUPSHUP_WHATSAPP_PARTNER_TOKEN;
  const waTemplateApiMode =
    configuredValue(waCfg?.credentials.templateApiMode) ??
    process.env.GUPSHUP_WHATSAPP_TEMPLATE_API_MODE ??
    (waPartnerToken ? "partner" : "account");
  const waSource =
    configuredValue(waCfg?.credentials.source) ??
    configuredValue(waCfg?.credentials.from) ??
    process.env.GUPSHUP_WHATSAPP_SOURCE;
  const waAppName = configuredValue(waCfg?.credentials.appName) ?? process.env.GUPSHUP_WHATSAPP_APP_NAME;
  const waAppId = configuredValue(waCfg?.credentials.appId) ?? process.env.GUPSHUP_WHATSAPP_APP_ID;
  const waTemplateId =
    configuredValue(waCfg?.credentials.templateId) ??
    configuredValue(waCfg?.credentials.contentSid) ??
    process.env.GUPSHUP_WHATSAPP_TEMPLATE_ID;
  const waConnected = Boolean(waAppId && (waTemplateApiMode === "partner" ? waPartnerToken : waApiKey));

  // ---------------------------------------------------------------------------
  // Voice dialers
  // ---------------------------------------------------------------------------
  const plivoCfg = userId ? store.get(`${userId}:plivo`) : undefined;
  const plivoAuthId = configuredValue(plivoCfg?.credentials.authId) ?? process.env.PLIVO_AUTH_ID;
  const plivoAuthToken = configuredValue(plivoCfg?.credentials.authToken) ?? process.env.PLIVO_AUTH_TOKEN;
  const plivoFrom = configuredValue(plivoCfg?.credentials.from) ?? process.env.PLIVO_PHONE_NUMBER;
  const plivoConnected = Boolean(plivoAuthId && plivoAuthToken && plivoFrom);

  const exotelCfg = userId ? store.get(`${userId}:exotel`) : undefined;
  const exotelAccountSid = configuredValue(exotelCfg?.credentials.accountSid) ?? process.env.EXOTEL_ACCOUNT_SID;
  const exotelApiKey = configuredValue(exotelCfg?.credentials.apiKey) ?? process.env.EXOTEL_API_KEY;
  const exotelApiToken = configuredValue(exotelCfg?.credentials.apiToken) ?? process.env.EXOTEL_API_TOKEN;
  const exotelFrom = configuredValue(exotelCfg?.credentials.from) ?? process.env.EXOTEL_PHONE_NUMBER;
  const exotelSubdomain = configuredValue(exotelCfg?.credentials.subdomain) ?? process.env.EXOTEL_SUBDOMAIN;
  const exotelConnected = Boolean(exotelAccountSid && exotelApiKey && exotelApiToken && exotelFrom);

  // ---------------------------------------------------------------------------
  // CRM
  // ---------------------------------------------------------------------------
  const zohoCfg = userId ? store.get(`${userId}:zoho`) : undefined;
  const zohoClientId = configuredValue(zohoCfg?.credentials.clientId) ?? process.env.ZOHO_CLIENT_ID;
  const zohoClientSecret = configuredValue(zohoCfg?.credentials.clientSecret) ?? process.env.ZOHO_CLIENT_SECRET;
  const zohoRefreshToken = configuredValue(zohoCfg?.credentials.refreshToken) ?? process.env.ZOHO_REFRESH_TOKEN;
  const zohoApiDomain = configuredValue(zohoCfg?.credentials.apiDomain) ?? process.env.ZOHO_API_DOMAIN ?? "https://www.zohoapis.in";
  const zohoAccountsDomain = configuredValue(zohoCfg?.credentials.accountsDomain) ?? process.env.ZOHO_ACCOUNTS_DOMAIN ?? "https://accounts.zoho.in";
  const zohoConnected = Boolean(zohoClientId && zohoClientSecret && zohoRefreshToken);

  return [
    {
      type: "plivo",
      label: "Voice calling",
      provider: "Plivo",
      status: plivoConnected ? "connected" : "not_connected",
      source: plivoCfg ? "configured" : "environment",
      meta: plivoConnected
        ? { authId: maskToken(plivoAuthId), from: maskPhone(plivoFrom) }
        : {},
      prefill: compactSafeValues({ authId: plivoAuthId, from: plivoFrom }),
      configuredSecretKeys: plivoAuthToken ? ["authToken"] : [],
    },
    {
      type: "whatsapp",
      label: "WhatsApp",
      provider: "Gupshup WhatsApp",
      status: waConnected ? "connected" : "not_connected",
      source: waCfg ? "configured" : "environment",
      meta: waConnected
        ? {
            apiKey: maskToken(waApiKey),
            templateApiMode: waTemplateApiMode,
            ...(waAppId ? { appId: waAppId } : {}),
            ...(waSource ? { from: maskPhone(waSource) } : {}),
            ...(waAppName ? { appName: waAppName } : {}),
            ...(waTemplateId ? { templateId: maskSid(waTemplateId) } : {}),
          }
        : {},
      prefill: compactSafeValues({
        templateApiMode: waTemplateApiMode,
        appId: waAppId,
        source: waSource,
        appName: waAppName,
        templateId: waTemplateId,
        templateParams: configuredValue(waCfg?.credentials.templateParams) ?? process.env.GUPSHUP_WHATSAPP_TEMPLATE_PARAMS,
      }),
      configuredSecretKeys: [
        ...(waApiKey ? ["apiKey"] : []),
        ...(waPartnerToken ? ["partnerToken"] : []),
      ],
    },
    {
      type: "zoho",
      label: "CRM",
      provider: "Zoho CRM",
      status: zohoConnected ? "connected" : "not_connected",
      source: zohoCfg ? "configured" : "environment",
      meta: zohoConnected ? { clientId: maskToken(zohoClientId), apiDomain: displayHost(zohoApiDomain) } : {},
      prefill: compactSafeValues({
        clientId: zohoClientId,
        apiDomain: zohoApiDomain,
        accountsDomain: zohoAccountsDomain,
      }),
      configuredSecretKeys: [
        ...(zohoClientSecret ? ["clientSecret"] : []),
        ...(zohoRefreshToken ? ["refreshToken"] : []),
      ],
    },
    {
      type: "exotel",
      label: "Voice calling",
      provider: "Exotel",
      status: exotelConnected ? "connected" : "not_connected",
      source: exotelCfg ? "configured" : "environment",
      meta: exotelConnected
        ? { accountSid: maskSid(exotelAccountSid), from: maskPhone(exotelFrom) }
        : {},
      prefill: compactSafeValues({
        accountSid: exotelAccountSid,
        from: exotelFrom,
        subdomain: exotelSubdomain,
      }),
      configuredSecretKeys: [
        ...(exotelApiKey ? ["apiKey"] : []),
        ...(exotelApiToken ? ["apiToken"] : []),
      ],
    },
    ...(ACTIONEER_CDP_ENABLED
      ? [{
          type: "cdp" as const,
          label: "Customer data",
          provider: "Actioneer CDP",
          status: cdpConnected ? "connected" as const : "not_connected" as const,
          source: cdpCfg ? "configured" as const : "environment" as const,
          meta: cdpConnected
            ? {
                baseUrl: displayHost(cdpBaseUrl),
                tenantId: cdpTenantId ?? "",
                appId: cdpAppId ?? "",
              }
            : {},
          prefill: compactSafeValues({ profileServiceUrl: cdpBaseUrl, tenantId: cdpTenantId, appId: cdpAppId }),
          configuredSecretKeys: (
            configuredValue(cdpCfg?.credentials.apiToken) ?? process.env.ACTIONEER_CDP_API_TOKEN
          ) ? ["apiToken"] : [],
        }]
      : []),
    {
      type: "sms",
      label: "SMS",
      provider: "Twilio",
      status: smsConnected ? "connected" : "not_connected",
      source: smsCfg ? "configured" : "environment",
      meta: smsConnected
        ? { accountSid: maskSid(smsSid), from: maskPhone(smsFrom) }
        : {},
      prefill: compactSafeValues({ accountSid: smsSid, from: smsFrom }),
      configuredSecretKeys: (
        configuredValue(smsCfg?.credentials.authToken) ?? process.env.TWILIO_AUTH_TOKEN
      ) ? ["authToken"] : [],
    },
    {
      type: "hubspot",
      label: "CRM",
      provider: "HubSpot",
      status: "coming_soon",
      source: "configured",
      meta: {},
    },
  ];
}

export function getConnectionStatus(
  userId: string,
  type: ConnectionType,
): TenantConnection["status"] {
  const conn = getTenantConnections(userId).find((c) => c.type === type);
  return conn?.status ?? "not_connected";
}

// Exported for use in Twilio/SMS send paths
export function getEffectiveSmsCredentials(userId?: string): {
  accountSid?: string;
  authToken?: string;
  from?: string;
} {
  load();
  const cfg = userId ? store.get(`${userId}:sms`) : undefined;
  return {
    accountSid: configuredValue(cfg?.credentials.accountSid) ?? process.env.TWILIO_ACCOUNT_SID,
    authToken: configuredValue(cfg?.credentials.authToken) ?? process.env.TWILIO_AUTH_TOKEN,
    from: configuredValue(cfg?.credentials.from) ?? process.env.TWILIO_SMS_FROM ?? process.env.TWILIO_PHONE_NUMBER,
  };
}

export function getEffectiveWhatsAppCredentials(userId?: string): {
  apiKey?: string;
  partnerToken?: string;
  source?: string;
  appName?: string;
  appId?: string;
  templateId?: string;
  templateParams?: string;
  templateApiMode?: string;
  apiBase?: string;
  templateApiBase?: string;
  partnerApiBase?: string;
} {
  load();
  const waCfg = userId ? store.get(`${userId}:whatsapp`) : undefined;
  return {
    apiKey: configuredValue(waCfg?.credentials.apiKey) ?? process.env.GUPSHUP_WHATSAPP_API_KEY,
    partnerToken:
      configuredValue(waCfg?.credentials.partnerToken) ??
      process.env.GUPSHUP_WHATSAPP_PARTNER_TOKEN,
    source:
      configuredValue(waCfg?.credentials.source) ??
      configuredValue(waCfg?.credentials.from) ??
      process.env.GUPSHUP_WHATSAPP_SOURCE,
    appName: configuredValue(waCfg?.credentials.appName) ?? process.env.GUPSHUP_WHATSAPP_APP_NAME,
    appId: configuredValue(waCfg?.credentials.appId) ?? process.env.GUPSHUP_WHATSAPP_APP_ID,
    templateId:
      configuredValue(waCfg?.credentials.templateId) ??
      configuredValue(waCfg?.credentials.contentSid) ??
      process.env.GUPSHUP_WHATSAPP_TEMPLATE_ID,
    templateParams:
      configuredValue(waCfg?.credentials.templateParams) ??
      configuredValue(waCfg?.credentials.contentVariables) ??
      process.env.GUPSHUP_WHATSAPP_TEMPLATE_PARAMS,
    templateApiMode:
      configuredValue(waCfg?.credentials.templateApiMode) ??
      process.env.GUPSHUP_WHATSAPP_TEMPLATE_API_MODE,
    apiBase: configuredValue(waCfg?.credentials.apiBase) ?? process.env.GUPSHUP_WHATSAPP_API_BASE,
    templateApiBase:
      configuredValue(waCfg?.credentials.templateApiBase) ??
      process.env.GUPSHUP_WHATSAPP_TEMPLATE_API_BASE,
    partnerApiBase:
      configuredValue(waCfg?.credentials.partnerApiBase) ??
      process.env.GUPSHUP_WHATSAPP_PARTNER_API_BASE,
  };
}

function normalizedPhoneDigits(value: string | undefined): string | undefined {
  const digits = value?.replace(/\D/g, "");
  return digits || undefined;
}

export function findWhatsAppCredentialsForWebhook(input: {
  appName?: string;
  source?: string;
}): StoredCredentials | undefined {
  load();
  const appName = configuredValue(input.appName)?.toLowerCase();
  const source = normalizedPhoneDigits(input.source);
  const gupshupFallbacks: StoredCredentials[] = [];
  for (const entry of store.values()) {
    if (entry.type !== "whatsapp") continue;
    const credentials = entry.credentials;
    if (configuredValue(credentials.apiKey) || /gupshup/i.test(entry.provider)) {
      gupshupFallbacks.push(entry);
    }
    const entryAppName = configuredValue(credentials.appName)?.toLowerCase();
    const entrySource = normalizedPhoneDigits(
      configuredValue(credentials.source) ?? configuredValue(credentials.from),
    );
    if (appName && entryAppName && appName === entryAppName) return entry;
    if (source && entrySource && source === entrySource) return entry;
  }
  return gupshupFallbacks[0];
}

export function getEffectiveCdpCredentials(userId?: string): Record<string, string | undefined> {
  if (!ACTIONEER_CDP_ENABLED) return {};
  load();
  const cfg = userId ? store.get(`${userId}:cdp`) : undefined;
  return {
    profileServiceUrl:
      configuredValue(cfg?.credentials.profileServiceUrl) ??
      configuredValue(cfg?.credentials.baseUrl) ??
      process.env.ACTIONEER_CDP_PROFILE_SERVICE_URL,
    apiToken: configuredValue(cfg?.credentials.apiToken) ?? process.env.ACTIONEER_CDP_API_TOKEN,
    teamId: configuredValue(cfg?.credentials.teamId) ?? process.env.ACTIONEER_CDP_TEAM_ID,
    tenantId:
      configuredValue(cfg?.credentials.tenantId) ??
      configuredValue(cfg?.credentials.teamId) ??
      process.env.ACTIONEER_CDP_TENANT_ID ??
      process.env.ACTIONEER_CDP_TEAM_ID,
    appId: configuredValue(cfg?.credentials.appId) ?? process.env.ACTIONEER_CDP_APP_ID,
    authenticatedHeader:
      configuredValue(cfg?.credentials.authenticatedHeader) ??
      configuredValue(cfg?.credentials.authenticated) ??
      process.env.ACTIONEER_CDP_AUTHENTICATED,
    pageSize: configuredValue(cfg?.credentials.pageSize) ?? process.env.ACTIONEER_CDP_PAGE_SIZE,
    memberLimit: configuredValue(cfg?.credentials.memberLimit) ?? process.env.ACTIONEER_CDP_MEMBER_LIMIT,
    readinessProfileLimit:
      configuredValue(cfg?.credentials.readinessProfileLimit) ??
      process.env.ACTIONEER_CDP_READINESS_PROFILE_LIMIT,
    requestTimeoutMs:
      configuredValue(cfg?.credentials.requestTimeoutMs) ??
      process.env.ACTIONEER_CDP_REQUEST_TIMEOUT_MS,
    outcomesPath: configuredValue(cfg?.credentials.outcomesPath) ?? process.env.ACTIONEER_CDP_OUTCOMES_PATH,
  };
}
