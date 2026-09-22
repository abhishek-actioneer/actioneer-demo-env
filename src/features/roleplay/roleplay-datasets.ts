/**
 * Roleplay dataset gating — the ONLY place roleplay training is switched on.
 * ------------------------------------------------------------------------------
 * Intentionally self-contained: the whole feature (route, nav, coach, scorer)
 * gates on `isRoleplayEnabled(datasetId)`, and only the Life Insurance dataset is
 * listed here. Nothing outside this module needs to change to keep roleplay
 * scoped — no edits to the shared dataset config / API / providers.
 *
 * If a second insurance dataset ever needs it, add its id here (or graduate this
 * to a `capabilities.roleplayTraining` flag on DatasetConfig — same effect).
 */

const ROLEPLAY_DATASETS = new Set<string>(["absli-life"]);

export function isRoleplayEnabled(datasetId: string | undefined | null): boolean {
  return !!datasetId && ROLEPLAY_DATASETS.has(datasetId);
}
