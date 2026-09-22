// Tracks risk-verification calls by generated callId. The registry survives
// call-config cleanup so post-call webhooks can still recover verification
// context after the media bridge tears down.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { getVoiceStorageRoot } from "./voice-storage";

export type VerificationOutcome = "clear" | "block" | "escalate" | "unknown";

export interface FraudCallMeta {
  datasetId: string;
  campaignId: string;
  userId?: string;
  alertId?: string;
  customerId?: string;
  subjectId?: string;
  subjectName?: string;
  phone?: string;
  amountAtRisk?: number;
  cardholderGender?: string;
  verificationReason?: string;
  transaction?: Record<string, unknown>;
  context?: Record<string, unknown>;
  outcome?: VerificationOutcome;
  outcomeTool?: string;
  outcomeArgs?: Record<string, unknown>;
  registeredAt?: string;
  resolvedAt?: string;
}

type Registry = Record<string, FraudCallMeta>;

function registryPath(): string {
  return join(getVoiceStorageRoot(), "fraud-call-registry.json");
}

function load(): Registry {
  const path = registryPath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Registry;
  } catch {
    return {};
  }
}

function save(registry: Registry): void {
  const path = registryPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(registry, null, 2));
}

export function registerFraudCall(callId: string, meta: FraudCallMeta): void {
  const registry = load();
  registry[callId] = {
    ...meta,
    registeredAt: meta.registeredAt ?? new Date().toISOString(),
  };
  save(registry);
}

export function getFraudCallMeta(callId: string): FraudCallMeta | undefined {
  return load()[callId];
}

export function resolveFraudCall(
  callId: string,
  outcome: VerificationOutcome,
  tool: string,
  args: Record<string, unknown>,
): void {
  const registry = load();
  if (!registry[callId]) return;
  registry[callId] = {
    ...registry[callId],
    outcome,
    outcomeTool: tool,
    outcomeArgs: args,
    resolvedAt: new Date().toISOString(),
  };
  save(registry);
}
