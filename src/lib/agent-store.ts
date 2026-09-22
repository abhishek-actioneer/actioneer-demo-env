import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { getVoiceStorageRoot } from "./voice-storage";
import type { Agent } from "./agent-types";

/**
 * Persisted store for reusable voice Agents (see agent-types.ts). Mirrors the
 * inbound-agent-store shape: a single JSON map keyed by agent id under the voice
 * storage root. Agents are minted by the campaign backfill (agent-backfill.ts)
 * and edited in place (e.g. knowledge selection), so writes must preserve any
 * fields the backfill doesn't own.
 */

type Store = Record<string, Agent>;

function storePath(): string {
  return join(getVoiceStorageRoot(), "agents.json");
}

function load(): Store {
  const path = storePath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Store;
  } catch {
    return {};
  }
}

function write(store: Store): void {
  const path = storePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(store, null, 2));
}

export function getAgent(id: string): Agent | undefined {
  return load()[id];
}

export function listAgents(userId?: string): Agent[] {
  const all = Object.values(load());
  const scoped = userId ? all.filter((a) => !a.userId || a.userId === userId) : all;
  return scoped.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export function saveAgent(agent: Agent): void {
  const store = load();
  store[agent.id] = { ...agent, updatedAt: new Date().toISOString() };
  write(store);
}

export function deleteAgent(id: string): boolean {
  const store = load();
  if (!store[id]) return false;
  delete store[id];
  write(store);
  return true;
}
