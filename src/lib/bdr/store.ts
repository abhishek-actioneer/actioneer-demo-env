import Database from "better-sqlite3";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { getVoiceStorageRoot } from "@/lib/voice-storage";
import type { BdrCampaign, BdrRecipient } from "./types";

let database: Database.Database | undefined;
function db(): Database.Database {
  if (database) return database;
  const root = getVoiceStorageRoot();
  mkdirSync(root, { recursive: true });
  database = new Database(join(root, "bdr.sqlite"));
  database.pragma("journal_mode = WAL");
  database.pragma("busy_timeout = 5000");
  database.exec(`CREATE TABLE IF NOT EXISTS bdr_campaigns (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, body TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS bdr_owner ON bdr_campaigns(user_id);
    CREATE TABLE IF NOT EXISTS bdr_suppressions (phone TEXT PRIMARY KEY);`);
  return database;
}
function decode(row: unknown): BdrCampaign | undefined {
  return row ? JSON.parse((row as { body: string }).body) as BdrCampaign : undefined;
}
export function getBdrCampaign(id: string, userId?: string): BdrCampaign | undefined {
  return decode(userId ? db().prepare("SELECT body FROM bdr_campaigns WHERE id = ? AND user_id = ?").get(id, userId) : db().prepare("SELECT body FROM bdr_campaigns WHERE id = ?").get(id));
}
export function listBdrCampaigns(userId?: string): BdrCampaign[] {
  const rows = userId ? db().prepare("SELECT body FROM bdr_campaigns WHERE user_id = ? ORDER BY rowid DESC").all(userId) : db().prepare("SELECT body FROM bdr_campaigns ORDER BY rowid").all();
  return rows.map((r) => decode(r)!);
}
function save(campaign: BdrCampaign): void {
  db().prepare("INSERT INTO bdr_campaigns (id, user_id, body) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body WHERE bdr_campaigns.user_id = excluded.user_id").run(campaign.id, campaign.userId, JSON.stringify(campaign));
}
export function createBdrCampaign(campaign: BdrCampaign): BdrCampaign {
  return db().transaction(() => {
    const existing = getBdrCampaign(campaign.id);
    if (existing && existing.userId !== campaign.userId) throw new Error("Campaign ID is already in use.");
    if (existing) return existing;
    save(campaign);
    return campaign;
  }).immediate();
}
export function mutateBdrCampaign(id: string, userId: string | undefined, mutate: (campaign: BdrCampaign) => void): BdrCampaign {
  return db().transaction(() => {
    const campaign = getBdrCampaign(id, userId);
    if (!campaign) throw new Error("Campaign not found.");
    mutate(campaign);
    campaign.updatedAt = new Date().toISOString();
    save(campaign);
    return campaign;
  }).immediate();
}
export function claimBdrRecipient(maxConcurrent: number): { campaign: BdrCampaign; recipient: BdrRecipient } | undefined {
  return db().transaction(() => {
    const campaigns = listBdrCampaigns();
    const active = campaigns.flatMap((c) => c.recipients).filter((r) => ["dispatching", "calling", "connected"].includes(r.status));
    if (active.length >= maxConcurrent) return undefined;
    for (const campaign of campaigns) {
      if (campaign.status !== "running") continue;
      const recipient = campaign.recipients.find((r) => r.status === "pending");
      if (!recipient) continue;
      if (isBdrSuppressed(recipient.phone)) {
        recipient.status = "excluded";
        recipient.detail = "Do not call: contact opted out";
        save(campaign);
        continue;
      }
      recipient.status = "dispatching";
      recipient.callId = randomUUID();
      recipient.startedAt = new Date().toISOString();
      save(campaign);
      return { campaign, recipient };
    }
    return undefined;
  }).immediate();
}
export function findBdrCall(callId: string): { campaign: BdrCampaign; recipient: BdrRecipient } | undefined {
  for (const campaign of listBdrCampaigns()) {
    const recipient = campaign.recipients.find((r) => r.callId === callId);
    if (recipient) return { campaign, recipient };
  }
}
export function updateBdrCall(callId: string, mutate: (recipient: BdrRecipient, campaign: BdrCampaign) => void): void {
  const found = findBdrCall(callId);
  if (!found) return;
  mutateBdrCampaign(found.campaign.id, undefined, (campaign) => {
    const recipient = campaign.recipients.find((r) => r.callId === callId);
    if (recipient) mutate(recipient, campaign);
  });
}
export function suppressBdrPhone(phone: string): void {
  db().prepare("INSERT INTO bdr_suppressions (phone) VALUES (?) ON CONFLICT DO NOTHING").run(phone);
}
export function isBdrSuppressed(phone: string): boolean {
  return !!db().prepare("SELECT 1 FROM bdr_suppressions WHERE phone = ?").get(phone);
}
export function closeBdrStoreForTests(): void { database?.close(); database = undefined; }
