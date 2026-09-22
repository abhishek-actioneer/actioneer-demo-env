import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "fs";
import { randomBytes } from "crypto";
import { dirname } from "path";
import {
  normalizeVoiceCampaignExperimentSplit,
  successDefinitionWithExperimentBaseline,
} from "./voice-campaign-experiment";
import {
  getVoiceCampaignStorePath,
  recordingFilePath,
  recordingStorageKeyCandidatesForScope,
} from "./voice-storage";
import { resolveRecordingUri } from "./voice-recording-storage";
import {
  flushCallTranscriptJsonlPersistNow,
  scheduleCallTranscriptJsonlPersist,
} from "./voice-transcript-storage";
import { recordCustomerChannelEvent } from "./customer-channel-memory";
import type {
  VoiceCampaign,
  VoiceCall,
  VoiceCampaignStatus,
  VoiceFollowUp,
  VoiceRecording,
  VoiceTranscriptTurn,
} from "./voice-campaign-types";
import { sortTranscriptTurns } from "./voice-transcript-sort";
import { normalizeVoiceCallProvider } from "./voice-call-provider";

type SerializedStore = Record<string, VoiceCampaign>;
type LegacySerializedStore = Array<[string, VoiceCampaign]>;
export interface VoiceCampaignScope {
  userId?: string;
  datasetId?: string;
}

const campaignMap = new Map<string, VoiceCampaign>();
let loaded = false;
let loadedMtimeMs = 0;
const STORE_LOCK_ATTEMPTS = 40;
const STORE_LOCK_DELAY_MS = 25;
const STORE_LOCK_STALE_MS = 30_000;

interface StoreLockPayload {
  pid: number;
  acquiredAt: number;
}

function storeLockPath(): string {
  return `${getVoiceCampaignStorePath()}.lock`;
}

function sleepMs(ms: number): void {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    // Busy-wait briefly — store writes are small and infrequent.
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readLockPayload(lockPath: string): StoreLockPayload | null {
  try {
    const raw = readFileSync(lockPath, "utf8").trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoreLockPayload;
    if (typeof parsed.pid !== "number" || typeof parsed.acquiredAt !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function isLockStale(lockPath: string): boolean {
  if (!existsSync(lockPath)) return false;
  const payload = readLockPayload(lockPath);
  if (!payload) {
    try {
      return Date.now() - statSync(lockPath).mtimeMs > STORE_LOCK_STALE_MS;
    } catch {
      return false;
    }
  }
  if (!isProcessAlive(payload.pid)) return true;
  return Date.now() - payload.acquiredAt > STORE_LOCK_STALE_MS;
}

function removeStaleLockIfNeeded(lockPath: string): void {
  if (!isLockStale(lockPath)) return;
  try {
    unlinkSync(lockPath);
    console.warn("[voice/campaign-store] Removed stale store lock", { lockPath });
  } catch {
    // Another process may have removed it.
  }
}

function acquireStoreLock(lockPath: string): number {
  const payload = JSON.stringify({ pid: process.pid, acquiredAt: Date.now() } satisfies StoreLockPayload);
  try {
    const fd = openSync(lockPath, "wx");
    writeFileSync(fd, payload, "utf8");
    return fd;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") throw err;
    removeStaleLockIfNeeded(lockPath);
    const fd = openSync(lockPath, "wx");
    writeFileSync(fd, payload, "utf8");
    return fd;
  }
}

function withCampaignStoreWrite<T>(mutate: () => T): T {
  const lockPath = storeLockPath();
  mkdirSync(dirname(lockPath), { recursive: true });

  for (let attempt = 0; attempt < STORE_LOCK_ATTEMPTS; attempt += 1) {
    let lockFd: number | undefined;
    try {
      lockFd = acquireStoreLock(lockPath);
      loaded = false;
      loadCampaigns();
      const result = mutate();
      persistCampaignsAtomic();
      return result;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EEXIST") {
        sleepMs(STORE_LOCK_DELAY_MS);
        continue;
      }
      throw err;
    } finally {
      if (lockFd !== undefined) {
        closeSync(lockFd);
        try {
          unlinkSync(lockPath);
        } catch {
          // Another writer may have already released the lock.
        }
      }
    }
  }

  throw new Error("[voice/campaign-store] Timed out acquiring store lock");
}

function normalizeCampaign(raw: VoiceCampaign): VoiceCampaign {
  const calls = Array.isArray(raw.calls)
    ? raw.calls.map((call) =>
      normalizeCall(call, {
        userId: raw.userId,
        datasetId: raw.datasetId,
        campaignId: raw.id,
      }))
    : [];
  return {
    ...raw,
    callProvider: normalizeVoiceCallProvider(raw.callProvider),
    calls,
    phoneNumbers: Array.isArray(raw.phoneNumbers) ? raw.phoneNumbers : [],
    status: raw.status ?? (calls.length > 0 ? "completed" : "draft"),
    createdAt: raw.createdAt ?? new Date().toISOString(),
    successDefinition: successDefinitionWithExperimentBaseline(raw.successDefinition, raw.experimentSplit),
    experimentSplit: normalizeVoiceCampaignExperimentSplit(raw.experimentSplit),
  };
}

function normalizeCall(
  call: VoiceCall,
  scope: { userId?: string; datasetId?: string; campaignId?: string },
): VoiceCall {
  return hydrateCallFromDisk({
    ...call,
    followUps: Array.isArray(call.followUps) ? call.followUps : [],
    transcript: Array.isArray(call.transcript) ? call.transcript : undefined,
    tags: Array.isArray(call.tags) ? call.tags : undefined,
  }, scope);
}

function hydrateCallFromDisk(
  call: VoiceCall,
  scope: { userId?: string; datasetId?: string; campaignId?: string },
): VoiceCall {
  if (call.bridgeRecording?.storageKey) return call;

  const sid = `bridge-${call.id}`;
  const candidateKeys = recordingStorageKeyCandidatesForScope(scope, call.id, sid, "wav");
  let storageKey: string | undefined;
  let path: string | undefined;
  for (const candidate of candidateKeys) {
    const candidatePath = recordingFilePath(candidate);
    if (existsSync(candidatePath)) {
      storageKey = candidate;
      path = candidatePath;
      break;
    }
  }
  if (!storageKey || !path) return call;

  const stat = statSync(path);
  return {
    ...call,
    bridgeRecording: {
      sid,
      status: "completed",
      source: "bridge",
      storageKey,
      recordingUri: resolveRecordingUri(storageKey, "local"),
      durationSeconds: Math.round((stat.size - 44) / (8000 * 2 * 2)),
      channels: 2,
      contentType: "audio/wav",
      sizeBytes: stat.size,
      storedAt: stat.mtime.toISOString(),
    },
  };
}

function hydrateCampaign(campaign: VoiceCampaign): VoiceCampaign {
  return {
    ...campaign,
    calls: (Array.isArray(campaign.calls) ? campaign.calls : []).map((call) =>
      normalizeCall(call, {
        userId: campaign.userId,
        datasetId: campaign.datasetId,
        campaignId: campaign.id,
      })),
  };
}

function campaignEntries(parsed: unknown): VoiceCampaign[] {
  if (Array.isArray(parsed)) {
    return (parsed as LegacySerializedStore)
      .map((entry) => entry?.[1])
      .filter((campaign): campaign is VoiceCampaign => !!campaign && typeof campaign.id === "string");
  }

  if (parsed && typeof parsed === "object") {
    return Object.values(parsed as SerializedStore)
      .filter((campaign): campaign is VoiceCampaign => !!campaign && typeof campaign.id === "string");
  }

  return [];
}

function loadCampaigns(): void {
  const path = getVoiceCampaignStorePath();
  if (!existsSync(path)) {
    loaded = true;
    loadedMtimeMs = 0;
    return;
  }

  const mtimeMs = statSync(path).mtimeMs;
  if (loaded && mtimeMs <= loadedMtimeMs) return;

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    campaignMap.clear();
    for (const campaign of campaignEntries(parsed)) {
      const normalized = normalizeCampaign(campaign);
      campaignMap.set(normalized.id, normalized);
    }
    loaded = true;
    loadedMtimeMs = mtimeMs;
  } catch (err) {
    console.error("[voice/campaign-store] Failed to load campaigns:", err);
    loaded = true;
  }
}

function persistCampaignsAtomic(): void {
  const path = getVoiceCampaignStorePath();
  mkdirSync(dirname(path), { recursive: true });
  const serialized = JSON.stringify(Object.fromEntries(campaignMap), null, 2);
  const tmpPath = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmpPath, serialized, "utf8");
  renameSync(tmpPath, path);
  loaded = true;
  loadedMtimeMs = statSync(path).mtimeMs;
}

function matchesScope(campaign: VoiceCampaign, scope?: VoiceCampaignScope): boolean {
  if (scope?.userId && campaign.userId !== scope.userId) return false;
  if (scope?.datasetId && campaign.datasetId !== scope.datasetId) return false;
  return true;
}

export function saveCampaign(campaign: VoiceCampaign): void {
  withCampaignStoreWrite(() => {
    campaignMap.set(campaign.id, normalizeCampaign(campaign));
  });
}

export function updateCampaign(
  id: string,
  patch: Partial<Omit<VoiceCampaign, "id" | "userId" | "datasetId" | "createdAt">>,
  scope?: VoiceCampaignScope
): VoiceCampaign | undefined {
  return withCampaignStoreWrite(() => {
    const c = campaignMap.get(id);
    if (!c) return undefined;
    if (!matchesScope(c, scope)) return undefined;
    const updated = normalizeCampaign({
      ...c,
      ...patch,
      calls: patch.calls ?? c.calls,
      phoneNumbers: patch.phoneNumbers ?? c.phoneNumbers,
    });
    campaignMap.set(id, updated);
    return updated;
  });
}

export function getCampaign(id: string, scope?: VoiceCampaignScope): VoiceCampaign | undefined {
  loadCampaigns();
  const campaign = campaignMap.get(id);
  if (!campaign) return undefined;
  const hydrated = hydrateCampaign(campaign);
  if (!matchesScope(hydrated, scope)) return undefined;
  campaignMap.set(id, hydrated);
  return hydrated;
}

export function deleteCampaign(id: string, scope?: VoiceCampaignScope): boolean {
  return withCampaignStoreWrite(() => {
    const campaign = campaignMap.get(id);
    if (!campaign) return false;
    if (!matchesScope(campaign, scope)) return false;
    return campaignMap.delete(id);
  });
}

export function listCampaigns(scope?: VoiceCampaignScope): VoiceCampaign[] {
  loadCampaigns();
  return Array.from(campaignMap.values()).map((campaign) => {
    const hydrated = hydrateCampaign(campaign);
    campaignMap.set(hydrated.id, hydrated);
    return hydrated;
  }).filter((campaign) => matchesScope(campaign, scope)).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function updateCampaignStatus(id: string, status: VoiceCampaignStatus, scope?: VoiceCampaignScope): void {
  withCampaignStoreWrite(() => {
    const c = campaignMap.get(id);
    if (!c) return;
    if (!matchesScope(c, scope)) return;
    campaignMap.set(id, {
      ...c,
      calls: Array.isArray(c.calls) ? c.calls : [],
      status,
      ...(status === "in_progress" ? { launchedAt: new Date().toISOString() } : {}),
    });
  });
}

function callIdentityMatches(existing: VoiceCall, next: Partial<VoiceCall> & { id: string }): boolean {
  if (existing.id === next.id) return true;
  if (next.callConfigId && existing.callConfigId === next.callConfigId) return true;
  if (next.providerRequestId && existing.providerRequestId === next.providerRequestId) return true;
  return false;
}

export function upsertCall(campaignId: string, call: Partial<VoiceCall> & { id: string }): void {
  withCampaignStoreWrite(() => {
    upsertCallInMemory(campaignId, call);
  });
}

function upsertCallInMemory(campaignId: string, call: Partial<VoiceCall> & { id: string }): void {
  const c = campaignMap.get(campaignId);
  if (!c) return;
  const existingCalls = Array.isArray(c.calls) ? c.calls : [];
  const existing = existingCalls.find((cl) => callIdentityMatches(cl, call));
  const updated: VoiceCall = existing
    ? {
        ...existing,
        ...call,
        ...(call.recording ? { recording: { ...existing.recording, ...call.recording } } : {}),
        ...(call.bridgeRecording ? { bridgeRecording: { ...existing.bridgeRecording, ...call.bridgeRecording } } : {}),
      }
    : {
        toNumber: "",
        status: "calling" as const,
        engaged: false,
        ...call,
      };
  const calls = existing
    ? existingCalls.map((cl) => (callIdentityMatches(cl, call) ? updated : cl))
    : [...existingCalls, updated];

  const terminalStatuses = new Set(["completed", "failed", "no_answer"]);
  const allDone = calls.length > 0 && calls.every((cl) => terminalStatuses.has(cl.status));

  campaignMap.set(campaignId, {
    ...c,
    calls,
    status: allDone ? "completed" : c.status,
  });

  if (terminalStatuses.has(updated.status) && Array.isArray(updated.transcript) && updated.transcript.length > 0) {
    void flushCallTranscriptJsonlPersistNow(
      { id: c.id, userId: c.userId, datasetId: c.datasetId },
      { id: updated.id, transcript: updated.transcript },
    ).catch((error) => {
      console.error("[voice/campaign-store] Failed terminal transcript flush:", error);
    });
  }
}

export function findCall(callId: string, scope?: VoiceCampaignScope): { campaign: VoiceCampaign; call: VoiceCall } | undefined {
  loadCampaigns();
  for (const campaign of campaignMap.values()) {
    const hydrated = hydrateCampaign(campaign);
    if (!matchesScope(hydrated, scope)) continue;
    campaignMap.set(hydrated.id, hydrated);
    const call = (Array.isArray(hydrated.calls) ? hydrated.calls : []).find((c) => c.id === callId);
    if (call) return { campaign: hydrated, call };
  }
  return undefined;
}

export function findCallByProviderRequestId(
  providerRequestId: string,
  scope?: VoiceCampaignScope,
): { campaign: VoiceCampaign; call: VoiceCall } | undefined {
  loadCampaigns();
  for (const campaign of campaignMap.values()) {
    const hydrated = hydrateCampaign(campaign);
    if (!matchesScope(hydrated, scope)) continue;
    campaignMap.set(hydrated.id, hydrated);
    const call = (Array.isArray(hydrated.calls) ? hydrated.calls : []).find((c) =>
      c.providerRequestId === providerRequestId || c.callConfigId === providerRequestId || c.id === providerRequestId
    );
    if (call) return { campaign: hydrated, call };
  }
  return undefined;
}

export function findCallByAnyIdentity(
  identities: Array<string | undefined>,
  scope?: VoiceCampaignScope,
): { campaign: VoiceCampaign; call: VoiceCall } | undefined {
  loadCampaigns();
  const unique = Array.from(new Set(
    identities.map((value) => value?.trim()).filter((value): value is string => Boolean(value)),
  ));
  if (unique.length === 0) return undefined;

  for (const campaign of campaignMap.values()) {
    const hydrated = hydrateCampaign(campaign);
    if (!matchesScope(hydrated, scope)) continue;
    campaignMap.set(hydrated.id, hydrated);
    const call = (Array.isArray(hydrated.calls) ? hydrated.calls : []).find((item) =>
      unique.includes(item.id) ||
      Boolean(item.callConfigId && unique.includes(item.callConfigId)) ||
      Boolean(item.providerRequestId && unique.includes(item.providerRequestId))
    );
    if (call) return { campaign: hydrated, call };
  }
  return undefined;
}

export function upsertCallRecording(callId: string, recording: VoiceRecording): void {
  const found = findCall(callId);
  if (!found) return;
  upsertCall(found.campaign.id, {
    id: callId,
    recording: {
      ...found.call.recording,
      ...recording,
    },
  });
}

export function upsertCallBridgeRecording(callId: string, bridgeRecording: VoiceRecording): void {
  const found = findCall(callId);
  if (!found) return;
  upsertCall(found.campaign.id, {
    id: callId,
    bridgeRecording: {
      ...found.call.bridgeRecording,
      ...bridgeRecording,
    },
  });
}

export function appendCallTranscript(
  campaignId: string,
  callId: string,
  turn: VoiceTranscriptTurn,
): void {
  withCampaignStoreWrite(() => {
    const campaign = campaignMap.get(campaignId);
    if (!campaign) return;
    const call = (Array.isArray(campaign.calls) ? campaign.calls : []).find((c) => c.id === callId);
    if (!call) return;

    const transcript = call.transcript ?? [];
    const existingIndex = transcript.findIndex((entry) =>
      entry.itemId && entry.itemId === turn.itemId && entry.role === turn.role
    );
    const nextTranscript = existingIndex >= 0
      ? transcript.map((entry, index) => index === existingIndex ? { ...entry, ...turn } : entry)
      : [...transcript, turn];

    const sortedTranscript = sortTranscriptTurns(nextTranscript, { callStartedAt: call.startedAt });
    upsertCallInMemory(campaignId, {
      id: callId,
      transcript: sortedTranscript,
    });
    scheduleCallTranscriptJsonlPersist(campaign, { ...call, transcript: sortedTranscript });
    recordVoiceTranscriptMemoryEvent(campaign, call, callId, turn);
  });
}

export function appendCallTranscriptTurns(
  campaignId: string,
  callId: string,
  turns: VoiceTranscriptTurn[],
): void {
  withCampaignStoreWrite(() => {
    const campaign = campaignMap.get(campaignId);
    if (!campaign) return;
    const call = (Array.isArray(campaign.calls) ? campaign.calls : []).find((c) => c.id === callId);
    if (!call) return;

    const nextTranscript = [...(call.transcript ?? [])];
    for (const turn of turns) {
      const existingIndex = nextTranscript.findIndex((entry) =>
        entry.itemId && entry.itemId === turn.itemId && entry.role === turn.role
      );
      if (existingIndex >= 0) {
        nextTranscript[existingIndex] = { ...nextTranscript[existingIndex], ...turn };
      } else {
        nextTranscript.push(turn);
      }
    }

    const sortedTranscript = sortTranscriptTurns(nextTranscript, { callStartedAt: call.startedAt });
    upsertCallInMemory(campaignId, {
      id: callId,
      transcript: sortedTranscript,
    });
    scheduleCallTranscriptJsonlPersist(campaign, { ...call, transcript: sortedTranscript });
    for (const turn of turns) {
      recordVoiceTranscriptMemoryEvent(campaign, call, callId, turn);
    }
  });
}

function recordVoiceTranscriptMemoryEvent(
  campaign: VoiceCampaign,
  call: VoiceCall,
  callId: string,
  turn: VoiceTranscriptTurn,
): void {
  if (turn.role === "recording") return;
  const phone = call.toNumber?.trim();
  if (!phone || !turn.text?.trim()) return;
  recordCustomerChannelEvent({
    channel: "voice",
    direction: turn.role === "user" ? "inbound" : "outbound",
    actor: turn.role === "user" ? "customer" : "agent",
    phone,
    text: turn.text,
    at: turn.at,
    provider: "gemini",
    callId,
    campaignId: campaign.id,
    userId: campaign.userId,
    datasetId: campaign.datasetId,
    recipientId: call.recipientId,
    eventType: `voice.transcript.${turn.role}`,
    idempotencyKey: [
      "voice",
      campaign.id,
      callId,
      turn.itemId || turn.id,
      turn.role,
    ].join(":"),
  });
}

export function upsertCallFollowUp(callId: string, followUp: VoiceFollowUp): void {
  const found = findCall(callId);
  if (!found) return;

  const existingFollowUps = found.call.followUps ?? [];
  const existing = existingFollowUps.find((item) => item.id === followUp.id);
  const followUps = existing
    ? existingFollowUps.map((item) => item.id === followUp.id ? { ...item, ...followUp } : item)
    : [...existingFollowUps, followUp];

  upsertCall(found.campaign.id, {
    id: callId,
    followUps,
  });
}

export function seedCallStubs(campaignId: string, phoneNumbers: string[]): void {
  withCampaignStoreWrite(() => {
    const c = campaignMap.get(campaignId);
    if (!c) return;
    const existingCalls = Array.isArray(c.calls) ? c.calls : [];
    if (existingCalls.length > 0) return;
    const stubs: VoiceCall[] = phoneNumbers.map((num, i) => ({
      id: `pending-${campaignId}-${i}`,
      toNumber: num,
      status: "queued",
      engaged: false,
    }));
    campaignMap.set(campaignId, { ...c, calls: stubs });
  });
}
