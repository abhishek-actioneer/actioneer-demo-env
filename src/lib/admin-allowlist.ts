/**
 * Internal-team allowlist for the provisioning admin panel (`/admin`).
 *
 * Only these six internal people may open the panel or call any `/api/admin/*`
 * route. We accept both work domains: the product brand `actioneer.com` and the
 * underlying company Google Workspace `gameramp.com` (the accounts people
 * actually sign in with). They are Google Workspace logins, so "Google-only
 * access" falls out of the allowlist — we do not build a separate admin login.
 *
 * Plain-language: this is the security boundary for the panel. Anyone signed in
 * who is NOT on this list is treated as a regular user / prospect and is denied.
 */
const ADMIN_NAMES = ["taha", "sashank", "indresh", "vivek", "divyansh", "vimarsh"] as const;

/**
 * Internal-team email domains — the single source of truth shared by the admin
 * allowlist (named people, below) and the dataset-switch gate (`isTeamEmail` in
 * auth-domain.ts, which unlocks for ANYONE on these domains).
 */
export const TEAM_DOMAINS = ["actioneer.com", "gameramp.com"] as const;

export const ADMIN_EMAILS = ADMIN_NAMES.flatMap((name) =>
  TEAM_DOMAINS.map((domain) => `${name}@${domain}`),
);

const ADMIN_EMAIL_SET = new Set(ADMIN_EMAILS.map((e) => e.toLowerCase()));

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAIL_SET.has(email.trim().toLowerCase());
}
