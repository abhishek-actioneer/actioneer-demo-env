import type { DetectableEntity, DetectedEntity } from "./entity-types";
import { ENTITY_TYPE_PRIORITY } from "./entity-types";

const MIN_FUZZY_LENGTH = 4;
const MAX_RESULTS = 8;

/** Tokenize input into lowercase words, splitting on whitespace and punctuation */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,;:!?.'"()\[\]{}]+/)
    .filter((t) => t.length > 0);
}

/** Check if entity name matches any input tokens */
function findMatch(
  inputTokens: string[],
  inputLower: string,
  entity: DetectableEntity,
): { matchType: "exact" | "fuzzy"; matchedOn: string } | null {
  const nameLower = entity.name.toLowerCase();

  // Exact match: full entity name appears as substring in input
  if (inputLower.includes(nameLower)) {
    return { matchType: "exact", matchedOn: nameLower };
  }

  // Multi-word entity name: check if all words appear in input
  const nameWords = tokenize(entity.name);
  if (nameWords.length > 1) {
    const allPresent = nameWords.every((nw) =>
      inputTokens.some((it) => it === nw || (it.length >= MIN_FUZZY_LENGTH && it.includes(nw)))
    );
    if (allPresent) {
      return { matchType: "fuzzy", matchedOn: nameWords.join(" ") };
    }
  }

  // Single-word fuzzy: input token is a substring of entity name (not tags/description)
  for (const token of inputTokens) {
    if (token.length < MIN_FUZZY_LENGTH) continue;

    if (nameLower.includes(token) || token.includes(nameLower)) {
      return { matchType: "fuzzy", matchedOn: token };
    }
  }

  return null;
}

/**
 * Detect entities from user input text by fuzzy-matching against the catalog.
 *
 * @param inputText - Raw user input
 * @param catalog - All detectable entities from buildEntityCatalog()
 * @param explicitRefs - IDs of explicitly @-referenced entities (always included)
 */
export function detectEntities(
  inputText: string,
  catalog: DetectableEntity[],
  explicitRefs: string[] = [],
): DetectedEntity[] {
  if (inputText.trim().length < 3) return [];

  const inputLower = inputText.toLowerCase();
  const inputTokens = tokenize(inputText);
  const matches: DetectedEntity[] = [];
  const seenIds = new Set<string>();

  // Explicit @references first (always included, highest priority)
  for (const refId of explicitRefs) {
    const entity = catalog.find((e) => e.id === refId);
    if (entity && !seenIds.has(entity.id)) {
      seenIds.add(entity.id);
      matches.push({
        entity,
        matchType: "exact",
        matchedOn: entity.name.toLowerCase(),
        source: "explicit",
      });
    }
  }

  // Passive detection — skip knowledge entries (sentence fragments, not proper names)
  for (const entity of catalog) {
    if (seenIds.has(entity.id)) continue;
    if (entity.type === "knowledge") continue;

    const match = findMatch(inputTokens, inputLower, entity);
    if (match) {
      seenIds.add(entity.id);
      matches.push({
        entity,
        matchType: match.matchType,
        matchedOn: match.matchedOn,
        source: "passive",
      });
    }
  }

  // Sort by priority: exact before fuzzy, then by entity type priority
  matches.sort((a, b) => {
    // Explicit always first
    if (a.source !== b.source) return a.source === "explicit" ? -1 : 1;
    // Exact before fuzzy
    if (a.matchType !== b.matchType) return a.matchType === "exact" ? -1 : 1;
    // Then by entity type priority
    return ENTITY_TYPE_PRIORITY[a.entity.type] - ENTITY_TYPE_PRIORITY[b.entity.type];
  });

  // Cap total results to prevent chip bar noise
  return matches.slice(0, MAX_RESULTS);
}
