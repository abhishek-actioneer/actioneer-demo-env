import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import {
  GetObjectCommand,
  HeadObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { recordingFilePath } from "./voice-storage";

export type RecordingStorageProvider = "local" | "s3";

export interface StoredRecordingResult {
  storageKey: string;
  provider: RecordingStorageProvider;
  recordingUri: string;
  sizeBytes: number;
  contentType: string;
}

interface RecordingReadResult {
  bytes: Buffer;
  provider: RecordingStorageProvider;
}

function activeProvider(): RecordingStorageProvider {
  const configured = process.env.VOICE_RECORDING_STORAGE_PROVIDER?.trim().toLowerCase();
  return configured === "s3" ? "s3" : "local";
}

function fallbackProvider(primary: RecordingStorageProvider): RecordingStorageProvider | undefined {
  const configured = process.env.VOICE_RECORDING_STORAGE_FALLBACK?.trim().toLowerCase();
  if (!configured) return undefined;
  const fallback = configured === "s3" ? "s3" : "local";
  return fallback === primary ? undefined : fallback;
}

export function resolveRecordingStorageProviders(): {
  primary: RecordingStorageProvider;
  fallback?: RecordingStorageProvider;
} {
  const primary = activeProvider();
  return { primary, fallback: fallbackProvider(primary) };
}

function s3Bucket(): string {
  const bucket = process.env.VOICE_RECORDING_S3_BUCKET?.trim();
  if (!bucket) throw new Error("VOICE_RECORDING_S3_BUCKET is not set");
  return bucket;
}

function s3Prefix(): string {
  return process.env.VOICE_RECORDING_S3_PREFIX?.trim().replace(/^\/+|\/+$/g, "") || "voice-recordings";
}

function s3Key(storageKey: string): string {
  const normalized = storageKey.replace(/^\/+/, "");
  return `${s3Prefix()}/${normalized}`;
}

function localFileUri(storageKey: string): string {
  return `file://${recordingFilePath(storageKey)}`;
}

function templateUri(
  storageKey: string,
  provider: RecordingStorageProvider,
): string | undefined {
  const template = process.env.VOICE_RECORDING_URI_TEMPLATE?.trim();
  if (!template) return undefined;
  const s3ObjectKey = s3Key(storageKey);
  const bucket = process.env.VOICE_RECORDING_S3_BUCKET?.trim() ?? "";
  return template
    .replaceAll("{storageKey}", storageKey)
    .replaceAll("{provider}", provider)
    .replaceAll("{s3Key}", s3ObjectKey)
    .replaceAll("{bucket}", bucket);
}

export function resolveRecordingUri(
  storageKey: string,
  provider: RecordingStorageProvider = activeProvider(),
): string {
  const templated = templateUri(storageKey, provider);
  if (templated) return templated;
  if (provider === "s3") {
    const bucket = s3Bucket();
    return `s3://${bucket}/${s3Key(storageKey)}`;
  }
  return localFileUri(storageKey);
}

let _s3Client: S3Client | undefined;
function s3Client(): S3Client {
  if (_s3Client) return _s3Client;
  _s3Client = new S3Client({
    region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
  });
  return _s3Client;
}

async function s3BodyToBuffer(body: unknown): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body === "string") return Buffer.from(body);
  if (typeof (body as { transformToByteArray?: () => Promise<Uint8Array> }).transformToByteArray === "function") {
    const bytes = await (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
    return Buffer.from(bytes);
  }

  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array | Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function putLocal(storageKey: string, bytes: Buffer): Promise<void> {
  const path = recordingFilePath(storageKey);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}

async function putS3(storageKey: string, bytes: Buffer, contentType: string): Promise<void> {
  await s3Client().send(new PutObjectCommand({
    Bucket: s3Bucket(),
    Key: s3Key(storageKey),
    Body: bytes,
    ContentType: contentType,
  }));
}

async function putUsing(
  provider: RecordingStorageProvider,
  storageKey: string,
  bytes: Buffer,
  contentType: string,
): Promise<void> {
  if (provider === "s3") {
    await putS3(storageKey, bytes, contentType);
    return;
  }
  await putLocal(storageKey, bytes);
}

async function readLocal(storageKey: string): Promise<Buffer> {
  return readFileSync(recordingFilePath(storageKey));
}

async function readS3(storageKey: string): Promise<Buffer> {
  const response = await s3Client().send(new GetObjectCommand({
    Bucket: s3Bucket(),
    Key: s3Key(storageKey),
  }));
  return s3BodyToBuffer(response.Body);
}

function isMissingRecordingError(error: unknown): boolean {
  if (error instanceof NoSuchKey) return true;
  if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404) return true;
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes("nosuchkey") || msg.includes("specified key does not exist") || msg.includes("enoent");
  }
  return false;
}

async function readUsing(provider: RecordingStorageProvider, storageKey: string): Promise<Buffer> {
  if (provider === "s3") return readS3(storageKey);
  return readLocal(storageKey);
}

async function existsUsing(provider: RecordingStorageProvider, storageKey: string): Promise<boolean> {
  if (provider === "s3") {
    try {
      await s3Client().send(new HeadObjectCommand({
        Bucket: s3Bucket(),
        Key: s3Key(storageKey),
      }));
      return true;
    } catch (error) {
      if (
        error instanceof NoSuchKey ||
        (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404)
      ) {
        return false;
      }
      throw error;
    }
  }
  return existsSync(recordingFilePath(storageKey));
}

export async function storeRecordingBytes(
  storageKey: string,
  bytes: Buffer,
  contentType = "application/octet-stream",
): Promise<StoredRecordingResult> {
  const primary = activeProvider();
  const fallback = fallbackProvider(primary);
  try {
    await putUsing(primary, storageKey, bytes, contentType);
    return {
      storageKey,
      provider: primary,
      recordingUri: resolveRecordingUri(storageKey, primary),
      sizeBytes: bytes.length,
      contentType,
    };
  } catch (error) {
    if (!fallback) throw error;
    console.warn(`[voice/storage] Primary provider ${primary} failed, trying ${fallback}`, error);
    await putUsing(fallback, storageKey, bytes, contentType);
    return {
      storageKey,
      provider: fallback,
      recordingUri: resolveRecordingUri(storageKey, fallback),
      sizeBytes: bytes.length,
      contentType,
    };
  }
}

export async function readRecordingBytes(
  storageKey: string,
  options?: { quiet?: boolean },
): Promise<RecordingReadResult> {
  const primary = activeProvider();
  const fallback = fallbackProvider(primary);
  try {
    return { bytes: await readUsing(primary, storageKey), provider: primary };
  } catch (error) {
    if (!fallback) throw error;
    if (!options?.quiet) {
      if (isMissingRecordingError(error)) {
        console.warn(`[voice/storage] Read via ${primary} missed key=${storageKey}, trying ${fallback}`);
      } else {
        console.warn(`[voice/storage] Read via ${primary} failed, trying ${fallback}`, error);
      }
    }
    return { bytes: await readUsing(fallback, storageKey), provider: fallback };
  }
}

export async function recordingExists(storageKey: string): Promise<boolean> {
  const primary = activeProvider();
  const fallback = fallbackProvider(primary);
  try {
    const primaryExists = await existsUsing(primary, storageKey);
    if (primaryExists) return true;
    if (!fallback) return false;
    return existsUsing(fallback, storageKey);
  } catch (error) {
    if (!fallback) throw error;
    console.warn(`[voice/storage] Exists via ${primary} failed, trying ${fallback}`, error);
    return existsUsing(fallback, storageKey);
  }
}
