// Catalog data is discovered dynamically from the database schema via /api/data-catalog.
// This file provides only the formatRowCount utility.

/** Format large row counts with K/M suffixes */
export function formatRowCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}
