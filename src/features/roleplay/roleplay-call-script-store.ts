/**
 * Training-call script store — dataset-scoped CRUD, keyed by scenario bundle id.
 *
 * Kept in a SEPARATE collection from the scenario bundle so that saving/editing
 * a scenario (which PUTs a fixed field set) can never clobber a generated
 * script. Follows the same globalThis-backed + disk-persisted convention as
 * `roleplay-scenario-store`.
 */

import type { TrainingCallScript } from "./roleplay-call-script";
import { readRoleplayCollection, writeRoleplayCollection } from "./roleplay-store-persistence";

const globalStore = globalThis as typeof globalThis & {
  __roleplayCallScriptStores?: Map<string, Map<string, TrainingCallScript>>;
  __roleplayCallScriptInitialized?: Set<string>;
};
const stores: Map<string, Map<string, TrainingCallScript>> =
  globalStore.__roleplayCallScriptStores ?? (globalStore.__roleplayCallScriptStores = new Map());
const initialized: Set<string> =
  globalStore.__roleplayCallScriptInitialized ?? (globalStore.__roleplayCallScriptInitialized = new Set());

function getStore(datasetId: string): Map<string, TrainingCallScript> {
  let store = stores.get(datasetId);
  if (!store) {
    store = new Map<string, TrainingCallScript>();
    stores.set(datasetId, store);
  }

  if (!initialized.has(datasetId)) {
    const memory = Array.from(store.values());
    for (const script of readRoleplayCollection<TrainingCallScript>(datasetId, "call-scripts")) {
      store.set(script.scenarioBundleId, script);
    }
    for (const script of memory) {
      store.set(script.scenarioBundleId, script);
    }
    initialized.add(datasetId);
  }

  return store;
}

export function saveCallScript(datasetId: string, script: TrainingCallScript): void {
  const store = getStore(datasetId);
  store.set(script.scenarioBundleId, script);
  writeRoleplayCollection(datasetId, "call-scripts", Array.from(store.values()));
}

export function getCallScript(datasetId: string, scenarioBundleId: string): TrainingCallScript | undefined {
  return getStore(datasetId).get(scenarioBundleId);
}

export function deleteCallScript(datasetId: string, scenarioBundleId: string): boolean {
  const store = getStore(datasetId);
  const deleted = store.delete(scenarioBundleId);
  writeRoleplayCollection(datasetId, "call-scripts", Array.from(store.values()));
  return deleted;
}
