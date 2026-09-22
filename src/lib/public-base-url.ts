const EXPLICIT_BASE_URL_ENVS = [
  "VOICE_PUBLIC_BASE_URL",
  "PLIVO_PUBLIC_BASE_URL",
  "PUBLIC_BASE_URL",
  "APP_URL",
] as const;

const PLATFORM_BASE_URL_ENVS = [
  "RAILWAY_PUBLIC_DOMAIN",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_URL",
  "RENDER_EXTERNAL_URL",
] as const;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);
const LOCAL_TUNNEL_SUFFIXES = ["ngrok-free.dev", "ngrok-free.app", "ngrok.io"];

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

function hostnameWithoutPort(host: string): string {
  const trimmed = host.trim().toLowerCase();
  if (trimmed.startsWith("[") && trimmed.includes("]")) {
    return trimmed.slice(0, trimmed.indexOf("]") + 1);
  }
  return trimmed.split(":")[0] ?? trimmed;
}

function isLocalHost(hostname: string): boolean {
  return LOCAL_HOSTS.has(hostnameWithoutPort(hostname));
}

function isLocalTunnelHost(hostname: string): boolean {
  const normalized = hostnameWithoutPort(hostname);
  return LOCAL_TUNNEL_SUFFIXES.some((suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`));
}

function valueWithDefaultScheme(raw: string): string {
  const trimmed = raw.trim();
  if (/^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function normalizePublicOrigin(raw: string | undefined, source: string, allowWebSocket = false): string | undefined {
  if (!raw?.trim()) return undefined;

  let url: URL;
  try {
    url = new URL(valueWithDefaultScheme(raw));
  } catch {
    throw new Error(`${source} must be a valid absolute URL or public host`);
  }

  const allowedProtocols = allowWebSocket ? ["http:", "https:", "ws:", "wss:"] : ["http:", "https:"];
  if (!allowedProtocols.includes(url.protocol)) {
    throw new Error(`${source} must use ${allowWebSocket ? "http, https, ws, or wss" : "http or https"}`);
  }

  if ((url.pathname && url.pathname !== "/") || url.search || url.hash) {
    throw new Error(`${source} must be an origin only, without a path, query, or hash`);
  }

  if (isProductionRuntime()) {
    if (isLocalHost(url.hostname)) {
      throw new Error(`${source} points to a local host; configure a public deployment URL instead`);
    }
    if (isLocalTunnelHost(url.hostname) && process.env.ALLOW_TUNNEL_BASE_URL_IN_PRODUCTION !== "true") {
      throw new Error(`${source} points to a local tunnel; refusing to use it in production`);
    }
  }

  return url.origin;
}

function firstConfiguredOrigin(envNames: readonly string[], allowWebSocket = false): string | undefined {
  for (const envName of envNames) {
    const origin = normalizePublicOrigin(process.env[envName], envName, allowWebSocket);
    if (origin) return origin;
  }
  return undefined;
}

function requestOrigin(req: Request): string | undefined {
  const forwardedHost = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || req.headers.get("host")?.split(",")[0]?.trim();
  if (!host) return undefined;

  const forwardedProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto = forwardedProto || (isLocalHost(host) ? "http" : "https");
  return normalizePublicOrigin(`${proto}://${host}`, "request host");
}

export function resolvePublicBaseUrl(req?: Request): string | undefined {
  return (
    firstConfiguredOrigin(EXPLICIT_BASE_URL_ENVS) ||
    firstConfiguredOrigin(PLATFORM_BASE_URL_ENVS) ||
    normalizePublicOrigin(process.env.NEXT_PUBLIC_BASE_URL, "NEXT_PUBLIC_BASE_URL") ||
    (req ? requestOrigin(req) : undefined)
  );
}

export function requirePublicBaseUrl(): string {
  const baseUrl = resolvePublicBaseUrl();
  if (!baseUrl) {
    throw new Error("Public base URL is not configured. Set VOICE_PUBLIC_BASE_URL in production or NEXT_PUBLIC_BASE_URL locally.");
  }
  return baseUrl;
}

export function resolvePlivoStreamBaseUrl(req?: Request): string | undefined {
  return firstConfiguredOrigin(["PLIVO_STREAM_BASE_URL"], true) || resolvePublicBaseUrl(req);
}

export function toWebSocketUrl(baseUrl: string, pathname: string): string {
  const url = new URL(pathname, baseUrl);
  url.protocol = url.protocol === "http:" || url.protocol === "ws:" ? "ws:" : "wss:";
  return url.toString();
}
