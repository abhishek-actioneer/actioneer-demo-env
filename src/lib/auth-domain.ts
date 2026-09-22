import { TEAM_DOMAINS } from "@/lib/admin-allowlist";

/**
 * Dataset switching is unlocked only for the internal team — anyone on the
 * Actioneer / GameRamp work domains (the same TEAM_DOMAINS the admin allowlist
 * uses, so there is ONE definition of "internal team domain").
 *
 * Everyone else — prospects, personal Google sign-ins, and any other domain — is
 * locked to the single dataset they chose at onboarding. Enforced server-side
 * (the /api/datasets list returns only their dataset) and reflected in the UI
 * (the workspace switcher is hidden).
 *
 * Callers must pass a VERIFIED email — an unverified address must never unlock
 * (see /api/datasets/route.ts).
 */
export function isTeamEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  return TEAM_DOMAINS.some((d) => e.endsWith(`@${d}`));
}
