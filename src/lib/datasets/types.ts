import type { EventDefinition } from "../explorer-types";

export type DatasetSourceType = "csv" | "duckdb";

export type SerializableDatasetConfig = Omit<DatasetConfig, "viewSQL">;

export interface DatasetConfig {
  id: string;
  label: string;
  /** Path to .duckdb file relative to process.cwd() */
  dbFile: string;

  // ── Table metadata ──
  /** Primary table name (e.g. "events", "bookings") */
  primaryTable: string;
  /**
   * Per-entity profile table used to display/break-down a segment's users
   * (Users tab, Composition tab, segment preview). One row per `userIdField`
   * with the entity's attributes + behaviour. Defaults to `primaryTable` when
   * unset. Set this when the primary analytics table is event/transaction-grained
   * (e.g. loans_full) but segments are a set of entities (e.g. borrowers_full).
   */
  entityTable?: string;
  /** Column used as user/entity identifier (for segments) */
  userIdField?: string;
  /** Column used for date filtering */
  dateField?: string;
  /** Data date range */
  dateRange?: { start: string; end: string };

  // ── LLM prompt injection ──
  schemaContext: string;
  systemContext: string;
  /** Domain-specific SQL hints appended to text-to-sql prompt */
  domainHints?: string;
  /** Hint about summary tables for the text-to-sql prompt */
  summaryTableHint?: string;

  // ── SQL generator ──
  /** Dynamic agent specs from schema map (takes priority when present) */
  agents?: AgentSpec[];
  /** Per-agent query descriptions for multi-agent mode */
  queryDescriptions: Record<string, string[]>;
  /** Multi-agent SQL generation prompt (the part after TEXT_TO_SQL_PROMPT) */
  multiAgentPrompt: string;

  // ── UI display ──
  /** Company/product name used when generated prompts need a caller identity. Defaults to label. */
  companyName?: string;
  /** Currency symbol for formatting monetary values (e.g. "$", "₹", "€") */
  currency?: string;
  /** Name of the primary entity (e.g. "users", "customers", "patients") */
  entityName?: string;
  reportMeta: {
    totalEvents: string;
    totalUsers: string;
    dateRangeLabel: string;
    dbName: string;
  };

  // ── Setup: how to create the DB views & summary tables ──
  /** SQL statements to create views over raw data files */
  viewSQL?: (dataDir: string) => string[];
  /** SQL statements to create pre-materialized summary tables */
  summaryTableSQL?: string[];
  /** Bump when setup/view SQL changes and a running process should rerun dataset setup. */
  setupVersion?: string;

  // ── Welcome screen ──
  /** Suggested prompts shown on empty chat (6 items) */
  suggestedPrompts?: string[];
  /** Subtitle for the welcome screen */
  welcomeSubtitle?: string;

  // ── Explorer: curated event catalog ──
  /** Curated events for the analytics explorer (click-based query builder) */
  events?: EventDefinition[];

  // ── Ownership ──
  /** Clerk userId of the uploader. null/undefined = sample dataset visible to all. */
  ownerId?: string | null;

  // ── Dynamic dataset flags ──
  isDynamic?: boolean;
  /** Dynamic dataset promoted to a shared sample — visible to all users (like static samples) despite having no ownerId. */
  isSample?: boolean;
  sourceFiles?: string[];
  /** How the dataset was created — required for correct rehydration on server restart */
  sourceType: DatasetSourceType;
}

export type DatasetId = string;

// ── Agent specs: dynamic agent selection & task assignment ──

export interface AgentQuerySpec {
  /** UI label + task description (e.g. "Default rate by loan grade and vintage year") */
  description: string;
  /** SQL generation hint (e.g. "GROUP BY grade, EXTRACT(YEAR FROM ...)") */
  hint: string;
}

export interface AgentSpec {
  /** Canonical agent ID (e.g. "data-quality", "rev-opt") */
  id: string;
  /** 1-3 query tasks for this agent */
  queries: AgentQuerySpec[];
}

// ── Schema Map: LLM-generated dataset understanding ──

export interface ColumnMeta {
  description: string;
  semanticType: "metric" | "dimension" | "identifier" | "timestamp" | "text";
  sampleValues?: string[];
  nullRate?: number;
  cardinalityHint?: "low" | "medium" | "high" | "unique";
  sqlGotcha?: string;
}

export interface SchemaMap {
  /** Per-column LLM-generated understanding */
  columns: Record<string, ColumnMeta>;

  /** LLM-detected primary entity/user identifier column (e.g. "customer_id", "borrower_id") */
  userIdField?: string;
  /** LLM-detected primary date/timestamp column (e.g. "order_date", "created_at") */
  dateField?: string;

  /** Detected domain (e.g. "food delivery logistics", "lending/credit risk") */
  domain: string;
  /** Persona for system context (e.g. "delivery operations analytics assistant") */
  domainPersona: string;
  /** Focus instruction (e.g. "Focus on delivery time optimization...") */
  domainFocus: string;
  /** Currency symbol if detected */
  currency?: string;

  /** Numbered SQL gotcha rules for text-to-SQL prompt */
  domainHints: string;
  /** How to query this dataset */
  summaryTableHint: string;

  /** Dynamic agent selection with per-agent task specs (source of truth when present) */
  agents: AgentSpec[];

  /** @deprecated Use agents[]. Kept for backward compat with handcrafted configs */
  multiAgentPrompt: string;
  /** @deprecated Use agents[]. Kept for backward compat */
  queryDescriptions: Record<string, string[]>;
  /** Annotated schema context with inline column comments */
  annotatedSchemaContext: string;

  /** Suggested prompts for the welcome screen (6 items) */
  suggestedPrompts: string[];
  /** Welcome screen subtitle */
  welcomeSubtitle: string;
}
