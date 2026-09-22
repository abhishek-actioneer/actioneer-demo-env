import crypto from "crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { getVoiceStorageRoot } from "@/lib/voice-storage";
import type { IntegrationCapability } from "./capabilities";

export type ConnectionStatus = "connected" | "not_connected" | "error" | "disabled";

export interface Connection {
  id: string;
  tenantId: string;
  providerId: string;
  capability: IntegrationCapability;
  displayName: string;
  status: ConnectionStatus;
  config: Record<string, string>;
  encryptedSecrets: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertConnectionInput {
  id?: string;
  tenantId: string;
  providerId: string;
  capability: IntegrationCapability;
  displayName?: string;
  status?: ConnectionStatus;
  config?: Record<string, string | undefined>;
  secrets?: Record<string, string | undefined>;
}

type ConnectionLogEntry = ({ op: "set" } & Connection) | { op: "delete"; id: string };

type G = typeof globalThis & {
  __integrationConnections?: Map<string, Connection>;
  __integrationConnectionsLoaded?: boolean;
};

const g = globalThis as G;
if (!g.__integrationConnections) g.__integrationConnections = new Map();
if (g.__integrationConnectionsLoaded === undefined) g.__integrationConnectionsLoaded = false;

const store = g.__integrationConnections;

function storePath(): string {
  const root = getVoiceStorageRoot();
  mkdirSync(root, { recursive: true });
  return join(root, "integration-connections.jsonl");
}

function cleanRecord(values: Record<string, string | undefined> = {}): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values)
      .map(([key, value]) => [key, value?.trim() ?? ""] as const)
      .filter(([, value]) => value.length > 0),
  );
}

function encryptionKey(): Buffer {
  const material =
    process.env.CONNECTION_ENCRYPTION_KEY ||
    process.env.CLERK_SECRET_KEY ||
    process.env.NEXTAUTH_SECRET ||
    "actioneer-local-dev-connection-key";
  return crypto.createHash("sha256").update(material).digest();
}

function encryptSecret(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "aes256gcm",
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

export function decryptSecret(value: string): string {
  const [version, ivRaw, tagRaw, ciphertextRaw] = value.split(":");
  if (version !== "aes256gcm" || !ivRaw || !tagRaw || !ciphertextRaw) {
    throw new Error("Unsupported encrypted secret format");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextRaw, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function encryptSecrets(values: Record<string, string | undefined> = {}): Record<string, string> {
  return Object.fromEntries(
    Object.entries(cleanRecord(values)).map(([key, value]) => [key, encryptSecret(value)]),
  );
}

function defaultConnectionId(input: Pick<UpsertConnectionInput, "tenantId" | "providerId" | "capability">): string {
  return `${input.tenantId}:${input.providerId}:${input.capability}`
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-");
}

function load(): void {
  if (g.__integrationConnectionsLoaded) return;
  g.__integrationConnectionsLoaded = true;
  const path = storePath();
  if (!existsSync(path)) return;

  try {
    const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      const entry = JSON.parse(line) as ConnectionLogEntry;
      if (entry.op === "delete") {
        store.delete(entry.id);
      } else {
        const { op: _op, ...record } = entry;
        store.set(record.id, record);
      }
    }
  } catch (error) {
    console.error("[integration-connections] load failed:", error);
  }
}

function append(entry: ConnectionLogEntry): void {
  try {
    appendFileSync(storePath(), JSON.stringify(entry) + "\n", "utf8");
  } catch (error) {
    console.error("[integration-connections] append failed:", error);
  }
}

export function upsertIntegrationConnection(input: UpsertConnectionInput): Connection {
  load();
  const id = input.id?.trim() || defaultConnectionId(input);
  const existing = store.get(id);
  const now = new Date().toISOString();
  const next: Connection = {
    id,
    tenantId: input.tenantId,
    providerId: input.providerId,
    capability: input.capability,
    displayName: input.displayName?.trim() || existing?.displayName || input.providerId,
    status: input.status ?? existing?.status ?? "connected",
    config: { ...(existing?.config ?? {}), ...cleanRecord(input.config) },
    encryptedSecrets: { ...(existing?.encryptedSecrets ?? {}), ...encryptSecrets(input.secrets) },
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  store.set(id, next);
  append({ op: "set", ...next });
  return next;
}

export function deleteIntegrationConnection(id: string): void {
  load();
  store.delete(id);
  append({ op: "delete", id });
}

export function deleteIntegrationConnectionByCapability(
  tenantId: string,
  providerId: string,
  capability: IntegrationCapability,
): void {
  deleteIntegrationConnection(defaultConnectionId({ tenantId, providerId, capability }));
}

export function listIntegrationConnections(tenantId: string): Connection[] {
  load();
  return Array.from(store.values())
    .filter((connection) => connection.tenantId === tenantId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getIntegrationConnection(id: string): Connection | undefined {
  load();
  return store.get(id);
}
