import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { getVoiceStorageRoot } from "./voice-storage";

/**
 * Persisted inbound-agent bindings, keyed by phone number. One record per DID:
 * which agent persona answers it, the greeting, and — crucially — the live
 * Plivo binding state (our XML app + the app to roll back to). This is what the
 * Agent detail "Inbound" section reads/writes, and what resolveInboundAgentConfig
 * consults before falling back to the env default.
 */
/**
 * What the agent actually runs when the number is dialed.
 * - `inbound-agent` (default, legacy): the generic greet → discover → route
 *   engine in inbound-agent-prompt.ts, taking only the persona from the campaign.
 * - `campaign-script`: the bound campaign's own compiled talk-track and workflow,
 *   re-framed for an inbound caller. Bound from the campaign studio's Inbound card.
 */
export type InboundMode = "inbound-agent" | "campaign-script";

export interface InboundBinding {
  number: string;
  /** Real Agent entity that answers this number (Phase 1). Preferred over
   *  `campaignId`; when absent the resolver falls back to the campaign persona.
   *  Ignored when `mode` is "campaign-script" — there the campaign is the brain. */
  agentId?: string;
  campaignId: string;
  /** Absent on bindings written before campaign-script mode existed → treated
   *  as "inbound-agent", so existing live numbers keep their behavior. */
  mode?: InboundMode;
  greeting?: string;
  companyName?: string;
  live: boolean;
  /**
   * Curated grounding: when set, the inbound agent reads ONLY these knowledge
   * entry ids (in priority order, up to the prompt budget). Undefined = auto
   * (priority-ordered digest of the whole KB); `[]` = no knowledge at all.
   */
  knowledgeIds?: string[];
  /**
   * Per-number talk-track. When set, this DID runs a scripted inbound agent
   * instead of the default greet → discover → route persona, which is what
   * makes two numbers on one account behave as two different agents (e.g. a
   * welcome line and a collections line).
   *
   * The script replaces only the "let the caller lead" framing. Grounding, the
   * no-invented-numbers rule, and the no-live-transfer rule are always applied
   * on top — a script must not be able to talk the agent out of them.
   */
  script?: string;
  /**
   * Per-number override for the account-verification rail. Defaults to ON.
   *
   * A collections agent is the reason this exists: its whole job is to discuss
   * dues, which the default rail forbids outright ("never reveal or confirm any
   * account-specific detail"). Leaving it on silently muzzles that script.
   * Turning it off is a real disclosure decision — see the callers.
   */
  verificationRequired?: boolean;
  /** Our inbound XML application id (the answer_url target). */
  appId?: string;
  /** The application the number pointed at before we first bound it (rollback). */
  rollbackAppId?: string;
  updatedAt: string;
}

type Store = Record<string, InboundBinding>;

/**
 * Canonical binding key: digits only. Callers pass numbers in mixed formats
 * (env `+912269870900`, Plivo `912269870900`, UI input), so a stored binding
 * must resolve regardless of the leading `+` or spacing.
 */
function normalizeNumberKey(number: string): string {
  return number.replace(/\D/g, "");
}

function storePath(): string {
  return join(getVoiceStorageRoot(), "inbound-agents.json");
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

export function getInboundBinding(number: string): InboundBinding | undefined {
  const store = load();
  return store[normalizeNumberKey(number)] ?? store[number];
}

export function getAllInboundBindings(): InboundBinding[] {
  return Object.values(load());
}

/** The single live inbound binding, if any (v1 convenience for one-number setups). */
export function getLiveInboundBinding(): InboundBinding | undefined {
  return getAllInboundBindings().find((b) => b.live);
}

export function saveInboundBinding(binding: InboundBinding): void {
  const store = load();
  store[normalizeNumberKey(binding.number)] = { ...binding, updatedAt: new Date().toISOString() };
  write(store);
}
