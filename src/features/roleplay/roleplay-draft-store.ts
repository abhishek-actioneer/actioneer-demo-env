/**
 * Roleplay draft store — dataset-scoped holding pen for a freshly captured
 * source document, before it's turned into a scenario.
 * ------------------------------------------------------------------------------
 * When a trainer fetches a URL / uploads a brochure, we persist the extracted
 * text as a draft and navigate straight to a full-page review workspace
 * (`/training/draft/[id]`). Generating from that page creates the real
 * `SavedScenarioBundle` and the draft can be discarded.
 *
 * Backed by local JSON under data/datasets/<datasetId>/roleplay so an expensive
 * source capture survives dev-server restarts. Not an entity-catalog item, so it
 * deliberately does NOT call `invalidateCatalog()`.
 */

import { readRoleplayCollection, writeRoleplayCollection } from "./roleplay-store-persistence";

export interface ScenarioDraft {
  id: string;
  datasetId: string;
  /** Best-effort human label for the source (page title / file name). */
  productLabel: string;
  /** Where it came from (URL or file name), shown in the review header. */
  source: string;
  /** How it was captured — drives the header icon on the review page. */
  sourceMode: "url" | "file";
  /** Cleaned, markdown-ish policy content that feeds the generator. */
  text: string;
  /** True after an LLM review-formatting pass produced replacement text. */
  reviewNormalized?: boolean;
  /** Version of the review formatting contract used for `text`. */
  reviewFormatVersion?: number;
  /** True when the extracted text was truncated at ingest. */
  truncated: boolean;
  createdAt: number;
}

// Stashed on `globalThis` so a freshly captured draft survives Next dev HMR (a
// plain module-level Map resets on every hot-reload). See roleplay-scenario-store.
const globalStore = globalThis as typeof globalThis & {
  __roleplayDraftStores?: Map<string, Map<string, ScenarioDraft>>;
  __roleplayDraftInitialized?: Set<string>;
};
const stores: Map<string, Map<string, ScenarioDraft>> =
  globalStore.__roleplayDraftStores ?? (globalStore.__roleplayDraftStores = new Map());
const initialized: Set<string> =
  globalStore.__roleplayDraftInitialized ?? (globalStore.__roleplayDraftInitialized = new Set());

function getStore(datasetId: string): Map<string, ScenarioDraft> {
  let store = stores.get(datasetId);
  if (!store) {
    store = new Map<string, ScenarioDraft>();
    stores.set(datasetId, store);
  }

  if (!initialized.has(datasetId)) {
    const memoryDrafts = Array.from(store.values());
    for (const draft of readRoleplayCollection<ScenarioDraft>(datasetId, "drafts")) {
      store.set(draft.id, draft);
    }
    for (const draft of memoryDrafts) {
      store.set(draft.id, draft);
    }
    initialized.add(datasetId);
  }

  return store;
}

export function saveDraft(datasetId: string, draft: ScenarioDraft): void {
  const store = getStore(datasetId);
  store.set(draft.id, draft);
  writeRoleplayCollection(datasetId, "drafts", Array.from(store.values()));
}

export function getDraft(datasetId: string, id: string): ScenarioDraft | undefined {
  return getStore(datasetId).get(id);
}

export function getAllDrafts(datasetId: string): ScenarioDraft[] {
  return Array.from(getStore(datasetId).values()).sort((a, b) => b.createdAt - a.createdAt);
}

export function deleteDraft(datasetId: string, id: string): boolean {
  const store = getStore(datasetId);
  const deleted = store.delete(id);
  writeRoleplayCollection(datasetId, "drafts", Array.from(store.values()));
  return deleted;
}
