/**
 * Roleplay scenario store — dataset-scoped CRUD for trainer-curated scenario
 * bundles.
 * ------------------------------------------------------------------------------
 * Follows the project's store convention (`knowledge-store` shape): a nested
 * Map<datasetId, Map<bundleId, bundle>>. Roleplay scenarios are NOT entity-catalog
 * items (they aren't @-mentionable), so — like `folder-store` — this deliberately
 * does NOT call `invalidateCatalog()`.
 *
 * Backed by local JSON under data/datasets/<datasetId>/roleplay so generated
 * and edited scenarios survive dev-server restarts.
 */

import type { SavedScenarioBundle } from "./roleplay-scenario";
import { readRoleplayCollection, writeRoleplayCollection } from "./roleplay-store-persistence";

/**
 * Stashed on `globalThis` so the store survives Next dev HMR: editing any module
 * in this graph re-evaluates it and would otherwise reset a plain module-level
 * `Map`, dropping a just-generated scenario before its workspace page loads it
 * ("Scenario not found"). `globalThis` persists for the life of the Node process,
 * so this keeps the in-memory semantics (resets on a real restart) without the
 * hot-reload footgun. The disk layer below covers full process restarts.
 */
const globalStore = globalThis as typeof globalThis & {
  __roleplayScenarioStores?: Map<string, Map<string, SavedScenarioBundle>>;
  __roleplayScenarioInitialized?: Set<string>;
};
const stores: Map<string, Map<string, SavedScenarioBundle>> =
  globalStore.__roleplayScenarioStores ?? (globalStore.__roleplayScenarioStores = new Map());
const initialized: Set<string> =
  globalStore.__roleplayScenarioInitialized ?? (globalStore.__roleplayScenarioInitialized = new Set());

function getStore(datasetId: string): Map<string, SavedScenarioBundle> {
  let store = stores.get(datasetId);
  if (!store) {
    store = new Map<string, SavedScenarioBundle>();
    stores.set(datasetId, store);
  }

  if (!initialized.has(datasetId)) {
    const memoryBundles = Array.from(store.values());
    for (const bundle of readRoleplayCollection<SavedScenarioBundle>(datasetId, "scenarios")) {
      store.set(bundle.id, bundle);
    }
    for (const bundle of memoryBundles) {
      store.set(bundle.id, bundle);
    }
    initialized.add(datasetId);
  }

  return store;
}

export function saveScenarioBundle(datasetId: string, bundle: SavedScenarioBundle): void {
  const store = getStore(datasetId);
  store.set(bundle.id, bundle);
  writeRoleplayCollection(datasetId, "scenarios", Array.from(store.values()));
}

export function getScenarioBundle(datasetId: string, id: string): SavedScenarioBundle | undefined {
  return getStore(datasetId).get(id);
}

/** Most-recently-updated first — the order the library renders. */
export function getAllScenarioBundles(datasetId: string): SavedScenarioBundle[] {
  return Array.from(getStore(datasetId).values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function deleteScenarioBundle(datasetId: string, id: string): boolean {
  const store = getStore(datasetId);
  const deleted = store.delete(id);
  writeRoleplayCollection(datasetId, "scenarios", Array.from(store.values()));
  return deleted;
}
