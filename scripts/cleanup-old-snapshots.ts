/**
 * Cleans up versioned visual snapshot files that are 2 or more cycles behind
 * the current highest version for each base name.
 *
 * Naming convention: <page>-<description>-v<N>.png
 * Example: metrics-list-v3.png (current) → deletes metrics-list-v1.png (2 behind)
 *
 * Usage: npx tsx scripts/cleanup-old-snapshots.ts
 */
import { readdirSync, unlinkSync } from 'fs';
import { resolve, join } from 'path';

const SNAPSHOTS_DIR = resolve(__dirname, '../tests/visual/snapshots');

function parseVersion(filename: string): { base: string; version: number } | null {
  const match = filename.match(/^(.+)-v(\d+)\.png$/);
  if (!match) return null;
  return { base: match[1], version: parseInt(match[2], 10) };
}

function main() {
  let files: string[];
  try {
    files = readdirSync(SNAPSHOTS_DIR).filter((f) => f.endsWith('.png'));
  } catch {
    console.log('Snapshots directory not found:', SNAPSHOTS_DIR);
    return;
  }

  // Group files by base name, track max version
  const versions = new Map<string, number>();
  for (const file of files) {
    const parsed = parseVersion(file);
    if (!parsed) continue;
    const current = versions.get(parsed.base) ?? 0;
    if (parsed.version > current) {
      versions.set(parsed.base, parsed.version);
    }
  }

  // Delete files that are 2+ versions behind current
  let deleted = 0;
  for (const file of files) {
    const parsed = parseVersion(file);
    if (!parsed) continue;
    const maxVersion = versions.get(parsed.base) ?? 0;
    if (maxVersion - parsed.version >= 2) {
      const filePath = join(SNAPSHOTS_DIR, file);
      unlinkSync(filePath);
      console.log('Deleted:', file);
      deleted++;
    }
  }

  if (deleted === 0) {
    console.log('No old snapshots to clean up.');
  } else {
    console.log(`\nDeleted ${deleted} old snapshot(s).`);
  }
}

main();
