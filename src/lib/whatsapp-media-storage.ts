/**
 * Public hosting for outbound WhatsApp media.
 *
 * WHY THIS EXISTS: Gupshup fetches media server-side before handing it to Meta,
 * so the URL must be reachable from their network *and* return the actual
 * bytes. Two things learned the hard way on live sends:
 *
 *  1. A dev tunnel does not work. ngrok returns a ~3KB HTML interstitial to
 *     fetchers with a browser-ish User-Agent, so the message delivers with the
 *     caption intact and the image silently missing, with no error anywhere.
 *  2. Presigned S3 URLs did not render either. The bytes were identical to a
 *     CDN URL that worked, so the difference is the URL itself — most likely
 *     the long `?X-Amz-…` query string.
 *
 * So media is stored in S3 privately and served through our own route at a
 * clean, query-string-free URL: `{baseUrl}/api/whatsapp-media/{key}`. That
 * matches the shape of every URL that has actually rendered, keeps the bucket
 * private, and needs no extra dependency.
 */

import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { resolvePublicBaseUrl } from "./public-base-url";

export interface HostedWhatsAppMedia {
  /** Clean public URL to hand to the provider. No query string. */
  url: string;
  /** Path segment under the media route, and the S3 key suffix. */
  key: string;
  bucket: string;
  contentType: string;
  sizeBytes: number;
}

export function whatsAppMediaBucket(): string {
  const value =
    process.env.WHATSAPP_MEDIA_S3_BUCKET?.trim() ||
    process.env.VOICE_RECORDING_S3_BUCKET?.trim();
  if (!value) {
    throw new Error("WHATSAPP_MEDIA_S3_BUCKET (or VOICE_RECORDING_S3_BUCKET) is not set");
  }
  return value;
}

/**
 * Nested under the recordings prefix on purpose: the dev IAM policy grants
 * s3:PutObject only on `voice-recordings/*`, so a top-level `whatsapp-media/`
 * key is denied. Point WHATSAPP_MEDIA_S3_PREFIX at a dedicated prefix once the
 * policy is widened — nothing else here assumes the nesting.
 */
export function whatsAppMediaPrefix(): string {
  const configured = process.env.WHATSAPP_MEDIA_S3_PREFIX?.trim().replace(/^\/+|\/+$/g, "");
  if (configured) return configured;
  const recordings =
    process.env.VOICE_RECORDING_S3_PREFIX?.trim().replace(/^\/+|\/+$/g, "") || "voice-recordings";
  return `${recordings}/whatsapp-media`;
}

function client(): S3Client {
  const region = process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim();
  return new S3Client(region ? { region } : {});
}

/** Reject traversal and absolute keys before they reach S3. */
function safeKey(key: string): string {
  const normalized = key.replace(/^\/+/, "").trim();
  if (!normalized || normalized.includes("..")) {
    throw new Error(`Invalid WhatsApp media key: "${key}"`);
  }
  return normalized;
}

/**
 * Store bytes and return the public URL to send.
 *
 * `key` should be stable per asset so re-sending the same creative overwrites
 * rather than accumulating objects.
 */
export async function hostWhatsAppMedia(
  key: string,
  bytes: Buffer,
  contentType: string,
): Promise<HostedWhatsAppMedia> {
  const normalized = safeKey(key);
  const baseUrl = resolvePublicBaseUrl();
  if (!baseUrl) {
    throw new Error(
      "No public base URL configured — set VOICE_PUBLIC_BASE_URL or an equivalent so the provider can fetch media.",
    );
  }

  await client().send(
    new PutObjectCommand({
      Bucket: whatsAppMediaBucket(),
      Key: `${whatsAppMediaPrefix()}/${normalized}`,
      Body: bytes,
      ContentType: contentType,
    }),
  );

  return {
    url: `${baseUrl.replace(/\/+$/, "")}/api/whatsapp-media/${normalized}`,
    key: normalized,
    bucket: whatsAppMediaBucket(),
    contentType,
    sizeBytes: bytes.length,
  };
}

export interface WhatsAppMediaObject {
  bytes: Buffer;
  contentType: string;
}

/** Read a stored object back, for the public media route to stream. */
export async function readWhatsAppMedia(key: string): Promise<WhatsAppMediaObject> {
  const response = await client().send(
    new GetObjectCommand({
      Bucket: whatsAppMediaBucket(),
      Key: `${whatsAppMediaPrefix()}/${safeKey(key)}`,
    }),
  );
  const bytes = Buffer.from(await response.Body!.transformToByteArray());
  return { bytes, contentType: response.ContentType || "application/octet-stream" };
}

/**
 * Mirror media we already have somewhere into S3 so the provider fetches it
 * from a URL we control. Use for anything behind a dev tunnel or a signed URL.
 */
export async function rehostWhatsAppMediaFromUrl(
  sourceUrl: string,
  key: string,
): Promise<HostedWhatsAppMedia> {
  const res = await fetch(sourceUrl);
  if (!res.ok) throw new Error(`Could not read media at ${sourceUrl}: HTTP ${res.status}`);
  const contentType =
    res.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
  if (!/^(image|video|audio|application)\//.test(contentType)) {
    throw new Error(`Refusing to host ${sourceUrl} — unexpected content-type "${contentType}"`);
  }
  return hostWhatsAppMedia(key, Buffer.from(await res.arrayBuffer()), contentType);
}
