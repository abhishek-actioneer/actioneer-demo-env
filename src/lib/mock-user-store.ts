// src/lib/mock-user-store.ts

import type { MockUser, WorkspaceRole } from "./policy-types";

const userMap = new Map<string, MockUser>();
let initialized = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

const STORAGE_KEY = "baby-sentinel-mock-users";
const STORAGE_VERSION = 2;

function persistToStorage() {
  if (typeof window === "undefined") return;
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    try {
      const items = Array.from(userMap.values());
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
      localStorage.setItem(STORAGE_KEY + "-version", String(STORAGE_VERSION));
    } catch {
      // silent
    }
  }, 300);
}

function seedDefaults() {
  const defaults: MockUser[] = [
    { id: "u1", name: "Aarav Sharma",  email: "aarav@acme.co",  initials: "AS", lastActive: "2h ago",  role: "super-admin" },
    { id: "u2", name: "Priya Mehta",   email: "priya@acme.co",  initials: "PM", lastActive: "1d ago",  role: "member" },
    { id: "u3", name: "Rohan Kumar",   email: "rohan@acme.co",  initials: "RK", lastActive: "3d ago",  role: "member" },
    { id: "u4", name: "Ananya Gupta",  email: "ananya@acme.co", initials: "AG", lastActive: "5h ago",  role: "admin" },
    { id: "u5", name: "Kiran Patel",   email: "kiran@acme.co",  initials: "KP", lastActive: "1d ago",  role: "member" },
    { id: "u6", name: "Diya Singh",    email: "diya@acme.co",   initials: "DS", lastActive: "4d ago",  role: "member" },
    { id: "u7", name: "Vikram Rao",    email: "vikram@acme.co", initials: "VR", lastActive: "1w ago",  role: "member" },
    { id: "u8", name: "Neha Joshi",    email: "neha@acme.co",   initials: "NJ", lastActive: "3h ago",  role: "admin" },
    { id: "u9", name: "Arjun Verma",   email: "arjun@acme.co",  initials: "AV", lastActive: "2d ago",  role: "member" },
  ];

  for (const user of defaults) {
    userMap.set(user.id, user);
  }
}

function ensureInitialized() {
  if (initialized) return;
  initialized = true;

  if (typeof window !== "undefined") {
    const storedVersion = localStorage.getItem(STORAGE_KEY + "-version");
    if (storedVersion !== null && storedVersion !== String(STORAGE_VERSION)) {
      console.warn(
        `[mock-user-store] version mismatch: stored="${storedVersion}" current="${STORAGE_VERSION}" — clearing`,
      );
      localStorage.removeItem(STORAGE_KEY);
    }

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const items: MockUser[] = JSON.parse(stored);
        items.forEach((u) => userMap.set(u.id, u));
        localStorage.setItem(STORAGE_KEY + "-version", String(STORAGE_VERSION));
        return;
      }
    } catch {
      console.warn("[mock-user-store] corrupt localStorage data — clearing");
      localStorage.removeItem(STORAGE_KEY);
    }
    localStorage.setItem(STORAGE_KEY + "-version", String(STORAGE_VERSION));
  }

  seedDefaults();
}

/* ── Public API ── */

export function getAllMockUsers(): MockUser[] {
  ensureInitialized();
  return Array.from(userMap.values());
}

export function getMockUser(id: string): MockUser | undefined {
  ensureInitialized();
  return userMap.get(id);
}

export function updateUserRole(id: string, role: WorkspaceRole): MockUser | null {
  ensureInitialized();
  const user = userMap.get(id);
  if (!user) return null;
  const updated: MockUser = { ...user, role };
  userMap.set(id, updated);
  persistToStorage();
  return updated;
}
