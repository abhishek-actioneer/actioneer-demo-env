/**
 * Centralized API client for all frontend → backend communication.
 *
 * Eliminates the class of bugs where individual fetch() calls forget
 * x-dataset-id, x-model-id, or Content-Type headers.
 *
 * Usage:
 *   const data = await apiFetch<Segment[]>("/api/segments");
 *   const res  = await apiFetch("/api/analyze", { method: "POST", body, stream: true });
 */

// ── Module-level state (synced from React contexts via setActiveXxx) ──

let _datasetId = "";
let _modelId = "gpt-5.4";

/** Called by DatasetProvider on mount/switch to keep the module in sync */
export function setActiveDatasetId(id: string) {
  _datasetId = id;
}

/** Called by ModelProvider on mount/switch */
export function setActiveModelId(id: string) {
  _modelId = id;
}

export function getActiveDatasetId(): string {
  return _datasetId;
}

export function getActiveModelId(): string {
  return _modelId;
}

// ── Error class ──

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ── Core fetch wrapper ──

interface ApiFetchOptions extends Omit<RequestInit, "body"> {
  /** Override the auto-injected dataset ID */
  datasetId?: string;
  /** Skip dataset header and guard (for auth routes that run before DatasetProvider mounts) */
  skipDataset?: boolean;
  /** Skip model header (for non-LLM routes) */
  skipModel?: boolean;
  /** Return raw Response instead of parsing JSON (for SSE streaming) */
  stream?: boolean;
  /** JSON-serializable body (auto-stringified) */
  body?: unknown;
}

/**
 * Fetch wrapper that auto-injects x-dataset-id, x-model-id, Content-Type.
 *
 * - For JSON routes: returns parsed response of type T
 * - For streaming routes: pass `stream: true` to get raw Response
 * - Throws ApiError on non-ok responses
 */
export async function apiFetch(
  path: string,
  options: ApiFetchOptions & { stream: true },
): Promise<Response>;
export async function apiFetch<T = unknown>(
  path: string,
  options?: ApiFetchOptions,
): Promise<T>;
export async function apiFetch<T = unknown>(
  path: string,
  options?: ApiFetchOptions,
): Promise<T | Response> {
  const { datasetId, skipDataset, skipModel, stream, body, ...fetchOptions } = options ?? {};
  // Remove body from fetchOptions to avoid conflict with our typed body
  const { body: _rawBody, ...cleanFetchOptions } = fetchOptions as RequestInit & Record<string, unknown>;

  // Fail-loud if datasetId was never set by DatasetProvider (skip for auth routes)
  if (!skipDataset && !_datasetId && !datasetId) {
    throw new Error("apiFetch called before setActiveDatasetId() — DatasetProvider must mount first");
  }

  const headers: Record<string, string> = {
    ...(skipDataset ? {} : { "x-dataset-id": datasetId ?? _datasetId }),
    ...(skipModel ? {} : { "x-model-id": _modelId }),
  };

  // Auto-set Content-Type for requests with body
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  // Merge caller headers (caller wins on conflict)
  const callerHeaders = cleanFetchOptions.headers as HeadersInit | undefined;
  if (callerHeaders) {
    if (callerHeaders instanceof Headers) {
      callerHeaders.forEach((v, k) => { headers[k] = v; });
    } else if (Array.isArray(callerHeaders)) {
      for (const [k, v] of callerHeaders) headers[k] = v;
    } else {
      Object.assign(headers, callerHeaders);
    }
  }

  const res = await fetch(path, {
    ...cleanFetchOptions,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (stream) return res;

  // Session expired — redirect to auth page
  if (res.status === 401 || res.status === 403) {
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/auth")) {
      window.location.href = "/auth";
    }
    throw new ApiError(res.status, "Session expired");
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(
      res.status,
      errBody.error ?? errBody.message ?? "Unknown error",
      typeof errBody.code === "string" ? errBody.code : undefined,
    );
  }

  return res.json() as Promise<T>;
}
