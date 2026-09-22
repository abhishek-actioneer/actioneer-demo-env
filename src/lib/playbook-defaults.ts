/**
 * Shared defaults for playbook creation.
 * Centralizes owner info, category, version, and approval status
 * so they're not hardcoded across multiple files.
 */

/** Get owner info from Clerk user object */
export function getOwnerInfo(user?: { fullName?: string | null; firstName?: string | null } | null): {
  owner: string;
  ownerInitials: string;
} {
  const name = user?.fullName || user?.firstName || "You";
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "U";
  return { owner: name, ownerInitials: initials };
}

/** Default metadata for newly created playbooks */
export const PLAYBOOK_DEFAULTS = {
  category: "AI Generated",
  version: "v1.0",
  approvalStatus: "Draft",
} as const;
