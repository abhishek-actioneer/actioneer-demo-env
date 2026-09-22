/**
 * Shared DAG-level computation for playbook cells.
 * Used by playbook-canvas, playbook-info-panel, and playbook-plan-review-card.
 */

/** Minimal cell shape accepted by computeLevels */
interface CellLike {
  id: string;
  dependsOn: string[];
}

/**
 * Compute the topological depth (level) for each cell in a DAG.
 * Cells with no dependencies are level 0.
 * Returns a Map from cell id to its computed level.
 */
export function computeLevels<T extends CellLike>(cells: T[]): Map<string, number> {
  const levels = new Map<string, number>();
  const cellMap = new Map(cells.map((c) => [c.id, c]));

  function getLevel(id: string): number {
    if (levels.has(id)) return levels.get(id)!;
    const cell = cellMap.get(id);
    if (!cell || cell.dependsOn.length === 0) {
      levels.set(id, 0);
      return 0;
    }
    const deps = cell.dependsOn.filter((dep) => cellMap.has(dep));
    const level = deps.length > 0 ? Math.max(...deps.map(getLevel)) + 1 : 0;
    levels.set(id, level);
    return level;
  }

  for (const cell of cells) getLevel(cell.id);
  return levels;
}

/**
 * Count the number of topological steps (levels) in a cell DAG.
 */
export function computeStepCount<T extends CellLike>(cells: T[]): number {
  if (cells.length === 0) return 0;
  const levels = computeLevels(cells);
  if (levels.size === 0) return 0;
  return Math.max(...Array.from(levels.values())) + 1;
}
