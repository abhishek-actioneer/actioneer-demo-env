import type Database from "better-sqlite3";
import { getDb } from "@/lib/meta-db";

/**
 * Repo for prospect demo logins provisioned from the /admin panel.
 *
 * Unlike feature repos (funnels, segments) these records are NOT scoped to a
 * single user — they are an internal shared resource that the whole admin team
 * sees. So functions here intentionally do not take a userId; authorization is
 * enforced upstream by `requireAdmin()` on every /admin route.
 */

export interface ProvisionedCred {
  id: string;
  clerkUserId: string;
  loginEmail: string;
  password: string;
  company: string;
  industries: string[];
  championName: string;
  championEmail: string;
  dealOwnerName: string;
  dealOwnerEmail: string;
  cc: string[];
  bcc: string[];
  magicLink: string;
  magicLinkExpiresAt: string;
  status: "active" | "revoked";
  lastEmailStatus: "sent" | "failed" | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface CredRow {
  id: string;
  clerk_user_id: string;
  login_email: string;
  password: string;
  company: string;
  industry: string;
  industries_json: string | null;
  champion_name: string;
  champion_email: string;
  deal_owner_name: string;
  deal_owner_email: string;
  cc_json: string | null;
  bcc_json: string | null;
  magic_link: string;
  magic_link_expires_at: string;
  status: string;
  last_email_status: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

function parseList(json: string | null): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function rowToCred(row: CredRow): ProvisionedCred {
  return {
    id: row.id,
    clerkUserId: row.clerk_user_id,
    loginEmail: row.login_email,
    password: row.password,
    company: row.company,
    industries: (() => {
      const arr = parseList(row.industries_json);
      return arr.length > 0 ? arr : row.industry ? [row.industry] : [];
    })(),
    championName: row.champion_name,
    championEmail: row.champion_email,
    dealOwnerName: row.deal_owner_name,
    dealOwnerEmail: row.deal_owner_email,
    cc: parseList(row.cc_json),
    bcc: parseList(row.bcc_json),
    magicLink: row.magic_link,
    magicLinkExpiresAt: row.magic_link_expires_at,
    status: row.status === "revoked" ? "revoked" : "active",
    lastEmailStatus:
      row.last_email_status === "sent" || row.last_email_status === "failed"
        ? row.last_email_status
        : null,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Prepared statements, cached on the db instance lazily.
let _stmts: ReturnType<typeof prepare> | null = null;
function prepare(db: Database.Database) {
  return {
    insert: db.prepare(`
      INSERT INTO provisioned_creds (
        id, clerk_user_id, login_email, password, company, industry, industries_json,
        champion_name, champion_email, deal_owner_name, deal_owner_email,
        cc_json, bcc_json, magic_link, magic_link_expires_at,
        status, last_email_status, created_by, created_at, updated_at
      ) VALUES (
        @id, @clerk_user_id, @login_email, @password, @company, @industry, @industries_json,
        @champion_name, @champion_email, @deal_owner_name, @deal_owner_email,
        @cc_json, @bcc_json, @magic_link, @magic_link_expires_at,
        @status, @last_email_status, @created_by, @created_at, @updated_at
      )
    `),
    listAll: db.prepare(`SELECT * FROM provisioned_creds ORDER BY created_at DESC`),
    getById: db.prepare(`SELECT * FROM provisioned_creds WHERE id = ?`),
    getByLogin: db.prepare(`SELECT * FROM provisioned_creds WHERE login_email = ?`),
    updatePassword: db.prepare(`
      UPDATE provisioned_creds SET password = ?, updated_at = ? WHERE id = ?
    `),
    updateStatus: db.prepare(`
      UPDATE provisioned_creds SET status = ?, updated_at = ? WHERE id = ?
    `),
    updateEmailStatus: db.prepare(`
      UPDATE provisioned_creds SET last_email_status = ?, updated_at = ? WHERE id = ?
    `),
    updateMagicLink: db.prepare(`
      UPDATE provisioned_creds
      SET magic_link = ?, magic_link_expires_at = ?, updated_at = ? WHERE id = ?
    `),
    del: db.prepare(`DELETE FROM provisioned_creds WHERE id = ?`),
  };
}
function stmts() {
  const db = getDb();
  if (!_stmts) _stmts = prepare(db);
  return _stmts;
}

export function insertProvisionedCred(cred: ProvisionedCred): void {
  stmts().insert.run({
    id: cred.id,
    clerk_user_id: cred.clerkUserId,
    login_email: cred.loginEmail,
    password: cred.password,
    company: cred.company,
    industry: cred.industries[0] ?? "",
    industries_json: JSON.stringify(cred.industries ?? []),
    champion_name: cred.championName,
    champion_email: cred.championEmail,
    deal_owner_name: cred.dealOwnerName,
    deal_owner_email: cred.dealOwnerEmail,
    cc_json: JSON.stringify(cred.cc ?? []),
    bcc_json: JSON.stringify(cred.bcc ?? []),
    magic_link: cred.magicLink,
    magic_link_expires_at: cred.magicLinkExpiresAt,
    status: cred.status,
    last_email_status: cred.lastEmailStatus,
    created_by: cred.createdBy,
    created_at: cred.createdAt,
    updated_at: cred.updatedAt,
  });
}

export function listProvisionedCreds(): ProvisionedCred[] {
  return (stmts().listAll.all() as CredRow[]).map(rowToCred);
}

export function getProvisionedCred(id: string): ProvisionedCred | null {
  const row = stmts().getById.get(id) as CredRow | undefined;
  return row ? rowToCred(row) : null;
}

export function getProvisionedCredByLogin(loginEmail: string): ProvisionedCred | null {
  const row = stmts().getByLogin.get(loginEmail.toLowerCase()) as CredRow | undefined;
  return row ? rowToCred(row) : null;
}

export function updateProvisionedCredPassword(id: string, password: string): void {
  stmts().updatePassword.run(password, new Date().toISOString(), id);
}

export function setProvisionedCredStatus(id: string, status: "active" | "revoked"): void {
  stmts().updateStatus.run(status, new Date().toISOString(), id);
}

/** Hard-delete a provisioned cred row (used to remove test creds). */
export function deleteProvisionedCred(id: string): void {
  stmts().del.run(id);
}

export function setProvisionedCredEmailStatus(
  id: string,
  status: "sent" | "failed",
): void {
  stmts().updateEmailStatus.run(status, new Date().toISOString(), id);
}

export function updateProvisionedCredMagicLink(
  id: string,
  magicLink: string,
  expiresAt: string,
): void {
  stmts().updateMagicLink.run(magicLink, expiresAt, new Date().toISOString(), id);
}
