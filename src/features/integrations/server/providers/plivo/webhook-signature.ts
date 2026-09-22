import crypto from "crypto";

/** Plivo query/body param map (values may repeat). */
export type PlivoParamMap = Record<string, string[]>;

function safeCompare(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function mergeParamMaps(...maps: Array<Record<string, string | string[]>>): PlivoParamMap {
  const out: PlivoParamMap = {};
  for (const map of maps) {
    for (const [key, raw] of Object.entries(map)) {
      const values = Array.isArray(raw) ? raw : [raw];
      out[key] = [...(out[key] ?? []), ...values];
    }
  }
  return out;
}

function parseQueryToParamMap(search: string): PlivoParamMap {
  const params: PlivoParamMap = {};
  const qs = search.startsWith("?") ? search.slice(1) : search;
  if (!qs) return params;
  const usp = new URLSearchParams(qs);
  for (const key of usp.keys()) {
    params[key] = usp.getAll(key);
  }
  return params;
}

function sortedQueryString(params: PlivoParamMap): string {
  const parts: string[] = [];
  for (const key of Object.keys(params).sort()) {
    for (const value of [...params[key]!].sort()) {
      parts.push(`${key}=${value}`);
    }
  }
  return parts.join("&");
}

function sortedPostParamString(params: PlivoParamMap): string {
  const parts: string[] = [];
  for (const key of Object.keys(params).sort()) {
    const values = params[key]!;
    if (values.length > 1) {
      for (const value of [...values].sort()) {
        parts.push(`${key}${value}`);
      }
    } else {
      parts.push(`${key}${values[0]}`);
    }
  }
  return parts.join("");
}

/** Origin + path only (no query) — matches plivo-node security.js. */
function plivoOriginPath(uri: string): string {
  const parsed = new URL(uri);
  const host = parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
  return `${parsed.protocol}//${host}${parsed.pathname}`;
}

function constructGetUrl(uri: string, extraParams: PlivoParamMap = {}, appendPostDot = false): string {
  const parsed = new URL(uri);
  const base = plivoOriginPath(uri);
  const queryParams = mergeParamMaps(parseQueryToParamMap(parsed.search), extraParams);
  const queryString = sortedQueryString(queryParams);
  if (!queryString && !appendPostDot) return base;
  let result = `${base}?${queryString}`;
  if (queryString && appendPostDot) result += ".";
  return result;
}

function constructPostUrl(uri: string, postParams: PlivoParamMap): string {
  const hasPostParams = Object.keys(postParams).length > 0;
  const base = constructGetUrl(uri, {}, hasPostParams);
  return base + sortedPostParamString(postParams);
}

/** Plivo SDK applies base64 decode+encode on the HMAC digest. */
function plivoHmacSignature(authToken: string, message: string): string {
  const digest = crypto.createHmac("sha256", authToken).update(message).digest("base64");
  return Buffer.from(digest, "base64").toString("base64");
}

function matchesAnySignature(expected: string, provided: string): boolean {
  return provided.split(",").some((part) => {
    const trimmed = part.trim();
    if (!trimmed) return false;
    try {
      return safeCompare(trimmed, expected);
    } catch {
      return trimmed === expected;
    }
  });
}

export function formDataToParamMap(formData: FormData): PlivoParamMap {
  const params: PlivoParamMap = {};
  formData.forEach((value, key) => {
    const str = String(value);
    params[key] = [...(params[key] ?? []), str];
  });
  return params;
}

export function computePlivoV3Signature(
  method: string,
  uri: string,
  nonce: string,
  authToken: string,
  postParams: PlivoParamMap = {},
): string {
  const normalizedMethod = method.toUpperCase();
  let baseUrl = uri;
  if (normalizedMethod === "GET") {
    baseUrl = constructGetUrl(uri);
  } else if (normalizedMethod === "POST") {
    baseUrl = constructPostUrl(uri, postParams);
  } else {
    throw new Error(`Unsupported Plivo webhook method: ${method}`);
  }
  return plivoHmacSignature(authToken, `${baseUrl}.${nonce}`);
}

export function computePlivoV2Signature(uri: string, nonce: string, authToken: string): string {
  return plivoHmacSignature(authToken, `${plivoOriginPath(uri)}${nonce}`);
}

export function verifyPlivoV3Signature(
  method: string,
  uri: string,
  nonce: string,
  authToken: string,
  providedSignature: string,
  postParams: PlivoParamMap = {},
): boolean {
  const normalizedMethod = method.toUpperCase();
  if (normalizedMethod !== "GET" && normalizedMethod !== "POST") {
    return false;
  }
  const expected = computePlivoV3Signature(method, uri, nonce, authToken, postParams);
  return matchesAnySignature(expected, providedSignature);
}

/** V2 signs origin+path only (no query), then appends nonce with no separator. */
export function verifyPlivoV2Signature(
  uri: string,
  nonce: string,
  authToken: string,
  providedSignature: string,
): boolean {
  const expected = computePlivoV2Signature(uri, nonce, authToken);
  return matchesAnySignature(expected, providedSignature);
}
