/**
 * Pure helpers for provisioning prospect demo logins. No I/O — kept separate so
 * they can be unit-tested without Clerk or SendGrid.
 */

/**
 * Turns a company name into the local-tag of its login identity:
 *   "Acme Corp"  -> "analysis+acmecorp@actioneer.com"
 *   "Yes Bank!"  -> "analysis+yesbank@actioneer.com"
 *
 * The address is a login-only identity (no real inbox), so we keep the tag
 * strictly alphanumeric and lowercase for predictability.
 */
export function companyLoginEmail(company: string): string {
  const slug = company
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 40);
  const tag = slug.length > 0 ? slug : "prospect";
  return `analysis+${tag}@actioneer.com`;
}

// Unambiguous alphabet: no 0/O, 1/l/I — clean to read aloud or type.
const PW_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

/**
 * Generates a professional, enterprise-style temporary password like
 * "Kp7M-9Rqx-Tn4w": three hyphen-separated groups of four mixed-case
 * alphanumerics. Looks like a real provisioned credential, stays easy to copy
 * or dictate, and is unguessable for a throwaway demo login.
 *
 * `rand` is injectable so tests are deterministic; defaults to Math.random.
 */
export function generateDemoPassword(rand: () => number = Math.random): string {
  const ch = () => PW_ALPHABET[Math.floor(rand() * PW_ALPHABET.length)];
  const group = () => Array.from({ length: 4 }, ch).join("");
  return `${group()}-${group()}-${group()}`;
}

/**
 * Builds the prospect magic link from a Clerk sign-in token. Reuses the existing
 * `/auth/agent-consume` consume page, which exchanges the ticket for a session.
 */
export function buildMagicLink(appUrl: string, ticket: string): string {
  const base = appUrl.replace(/\/+$/, "");
  return `${base}/auth/agent-consume?ticket=${encodeURIComponent(ticket)}`;
}

/** 48 hours, in seconds — the magic-link lifetime. */
export const MAGIC_LINK_TTL_SECONDS = 48 * 60 * 60;
