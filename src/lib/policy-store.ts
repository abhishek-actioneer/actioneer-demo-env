// src/lib/policy-store.ts

import type { DataPolicy } from "./policy-types";

// Demo policies are hand-authored against the quickhelp schema (events, orders, users).
// They are scoped explicitly so they remain meaningful regardless of which dataset
// is the active DEFAULT_DATASET. A future refactor can replace these with per-dataset
// schema-aware seeds.
const DEMO_POLICY_DATASET_ID = "quickhelp";

const policyMap = new Map<string, DataPolicy>();
let initialized = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

const STORAGE_KEY = "baby-sentinel-policies";
const STORAGE_VERSION = 2;

function createId() {
  return Math.random().toString(36).slice(2, 10);
}

function persistToStorage() {
  if (typeof window === "undefined") return;
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    try {
      const items = Array.from(policyMap.values());
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
      localStorage.setItem(STORAGE_KEY + "-version", String(STORAGE_VERSION));
    } catch {
      // silent
    }
  }, 300);
}

function seedDefaults() {
  const now = new Date().toISOString();

  const defaults: DataPolicy[] = [
    {
      id: "analytics-readonly",
      name: "Analytics Read-Only",
      description: "Read-only access to events table — date and event name columns only, restricted to 2026 data.",
      datasetId: DEMO_POLICY_DATASET_ID,
      tableAccess: [
        {
          tableName: "events",
          allowSelectStar: false,
          allowAllColumns: false,
          allowedColumns: ["event_date", "event_name"],
          rowFilter: "YEAR(event_date) = 2026",
          rowFilterDescription: "Only 2026 events",
        },
      ],
      createdAt: now,
      createdBy: "system",
    },
    {
      id: "full-analytics",
      name: "Full Analytics Access",
      description: "Unrestricted access to all columns in the events table with no row filters.",
      datasetId: DEMO_POLICY_DATASET_ID,
      tableAccess: [
        {
          tableName: "events",
          allowSelectStar: true,
          allowAllColumns: true,
          allowedColumns: [],
          rowFilter: null,
          rowFilterDescription: null,
        },
      ],
      createdAt: now,
      createdBy: "system",
    },
    {
      id: "revenue-access",
      name: "Revenue Access (APAC)",
      description: "Access to revenue-related columns in the orders table, restricted to APAC region.",
      datasetId: DEMO_POLICY_DATASET_ID,
      tableAccess: [
        {
          tableName: "orders",
          allowSelectStar: false,
          allowAllColumns: false,
          allowedColumns: ["order_id", "order_date", "revenue", "currency", "region"],
          rowFilter: "region = 'APAC'",
          rowFilterDescription: "APAC region only",
        },
      ],
      createdAt: now,
      createdBy: "system",
    },
    {
      id: "pii-restricted",
      name: "PII Restricted",
      description: "Access to users table with PII columns blocked.",
      datasetId: DEMO_POLICY_DATASET_ID,
      tableAccess: [
        {
          tableName: "users",
          allowSelectStar: false,
          allowAllColumns: false,
          allowedColumns: ["user_id", "created_at", "country", "plan", "status"],
          rowFilter: null,
          rowFilterDescription: null,
        },
      ],
      createdAt: now,
      createdBy: "system",
    },
  ];

  for (const policy of defaults) {
    policyMap.set(policy.id, policy);
  }
}

function ensureInitialized() {
  if (initialized) return;
  initialized = true;

  if (typeof window !== "undefined") {
    const storedVersion = localStorage.getItem(STORAGE_KEY + "-version");
    if (storedVersion !== null && storedVersion !== String(STORAGE_VERSION)) {
      console.warn(
        `[policy-store] version mismatch: stored="${storedVersion}" current="${STORAGE_VERSION}" — clearing`,
      );
      localStorage.removeItem(STORAGE_KEY);
    }

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const items: DataPolicy[] = JSON.parse(stored);
        items.forEach((p) => policyMap.set(p.id, p));
        localStorage.setItem(STORAGE_KEY + "-version", String(STORAGE_VERSION));
        return;
      }
    } catch {
      console.warn("[policy-store] corrupt localStorage data — clearing");
      localStorage.removeItem(STORAGE_KEY);
    }
    localStorage.setItem(STORAGE_KEY + "-version", String(STORAGE_VERSION));
  }

  seedDefaults();
}

/* ── Public API ── */

export function getAllPolicies(): DataPolicy[] {
  ensureInitialized();
  return Array.from(policyMap.values());
}

export function getPolicy(id: string): DataPolicy | undefined {
  ensureInitialized();
  return policyMap.get(id);
}

export function savePolicy(policy: DataPolicy): DataPolicy {
  ensureInitialized();
  const toSave: DataPolicy = {
    ...policy,
    id: policy.id || createId(),
    createdAt: policy.createdAt || new Date().toISOString(),
  };
  policyMap.set(toSave.id, toSave);
  persistToStorage();
  return toSave;
}

export function deletePolicy(id: string): boolean {
  ensureInitialized();
  const deleted = policyMap.delete(id);
  if (deleted) persistToStorage();
  return deleted;
}
