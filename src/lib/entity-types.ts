// ── Entity detection types for chatbox intelligence ──

export type EntityType = "metric" | "segment" | "playbook" | "knowledge" | "table" | "scout" | "deck" | "board" | "funnel" | "retention";

/** An entity from any store that can be detected in user input */
export interface DetectableEntity {
  id: string;
  type: EntityType;
  name: string;
  description?: string;
  tags?: string[];
  stat?: string;
  route?: string;
  contextPayload: Record<string, unknown>;
}

/** A match result from entity detection */
export interface DetectedEntity {
  entity: DetectableEntity;
  matchType: "exact" | "fuzzy";
  matchedOn: string;
  source: "passive" | "explicit";
}

/** Resolved date range from temporal phrase detection */
export interface DetectedDateRange {
  phrase: string;
  start: string; // ISO date
  end: string;   // ISO date
  isDefault: boolean;
}

/** Priority order for entity type ranking (lower = higher priority) */
export const ENTITY_TYPE_PRIORITY: Record<EntityType, number> = {
  metric: 0,
  segment: 1,
  playbook: 2,
  knowledge: 3,
  table: 4,
  scout: 5,
  deck: 6,
  board: 7,
  funnel: 8,
  retention: 9,
};

/** Icons for chip display */
export const ENTITY_TYPE_ICON: Record<EntityType, string> = {
  metric: "\uD83D\uDCCA",
  segment: "\uD83D\uDC65",
  playbook: "\uD83D\uDCCB",
  knowledge: "\uD83D\uDCA1",
  table: "\uD83D\uDDC2\uFE0F",
  scout: "\uD83D\uDD0D",
  deck: "\uD83D\uDCC8",
  board: "\uD83D\uDDBC\uFE0F",
  funnel: "\uD83D\uDD3B",
  retention: "\uD83D\uDD04",
};
