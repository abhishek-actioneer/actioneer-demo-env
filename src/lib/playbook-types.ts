export interface PlaybookParam {
  name: string;
  label: string;
  type: "date" | "integer" | "float" | "boolean" | "string";
  defaultVal: string;
  group?: string;
}

export interface PlaybookProduces {
  name: string;
  description: string;
  /** Column-level detail inferred by LLM during playbook creation */
  columns?: Array<{ name: string; description: string }>;
}

export interface PlaybookRunHistory {
  date: string;   // ISO string (new runs) or human-readable legacy format
  who: string;    // user email / display name
  result: string;
  status: "success" | "partial" | "failed";
  /** How the run was triggered */
  runVia?: "playbook" | "chat" | "scout";
  /** Total execution time in milliseconds */
  durationMs?: number;
  /** ID of the cell that caused a failure */
  failedCellId?: string;
  /** Human-readable label of the failed cell */
  failedCellLabel?: string;
  /** Raw error message from the failed cell */
  error?: string;
  /** Brief summary of each executed cell's output */
  cellSummaries?: Array<{
    cellId: string;
    label: string;
    rowCount?: number;
    timeMs?: number;
    status: "done" | "error" | "skipped";
    /** Column names from query results */
    columns?: string[];
    /** Preview rows (top 20) from query results */
    preview?: Record<string, unknown>[];
    /** LLM-generated text content (analysis, reports, summaries) */
    content?: string;
    /** Error message for failed cells */
    error?: string;
  }>;
  /** Parameter overrides used for this run */
  paramOverrides?: Record<string, string>;
}

export type CellStatus =
  | "idle"
  | "done"
  | "running"
  | "waiting"
  | "blocked"
  | "error";

export interface PlaybookNode {
  id: string;
  label: string;
  description: string;
  type: "init" | "sql" | "python" | "output";
  status: CellStatus;
  footer?: string;
  content?: string;
  result?: string;
  sql?: string;
}

export interface PlaybookCell {
  id: string;
  label: string;
  description: string;
  type: "init" | "sql-group" | "compute" | "summary";
  status: CellStatus;
  footer?: string;
  content?: string;
  nodes?: PlaybookNode[];
}

export interface NodeDetail {
  id: string;
  label: string;
  description: string;
  type: "init" | "sql" | "python" | "output";
  status: CellStatus;
  language: "sql" | "python";
  code: string;
  inputs: string;
  producesData: string;
  duration: string;
  rowCount?: string;
  result?: string;
}

export interface Playbook {
  id: string;
  name: string;
  description: string;
  category: string;
  version: string;
  approvalStatus: string;
  owner: string;
  ownerInitials: string;
  cells: PlaybookCell[];
  params: PlaybookParam[];
  produces: PlaybookProduces[];
  runHistory: PlaybookRunHistory[];
  nodeDetails: NodeDetail[];
  summaryPrompt?: string;
  /** Dataset this playbook was created for */
  datasetId?: string;
}

export interface PlaybookSummary {
  id: string;
  name: string;
  description: string;
  category: string;
  owner: string;
  ownerInitials: string;
  lastRun: string;
  lastRunStatus: "success" | "partial" | "failed" | "never";
  usedBy: string;
}

export interface PlaybookExecutionState {
  status: "idle" | "running" | "done" | "error";
  cellStatuses: Record<string, CellStatus>;
  nodeStatuses: Record<string, CellStatus>;
  nodeResults: Record<string, {
    rowCount?: number;
    timeMs?: number;
    columns?: string[];
    preview?: Record<string, unknown>[];
    content?: string;
    error?: string;
  }>;
  cellResults: Record<string, { content?: string; footer?: string }>;
  streamingText: Record<string, string>;
}

// ── V2 Playbook System ──
// Flexible DAG-based workflows with variable-length cells

export type NewCellType = "sql" | "llm";

export type CellRole =
  | "guardrail"   // validates data availability/quality
  | "parameter"   // computes dynamic values for downstream cells
  | "query"       // core data retrieval SQL
  | "analysis"    // LLM interprets query results
  | "summary";    // final synthesis/report

export interface PlaybookCellV2 {
  id: string;
  label: string;
  description: string;
  type: NewCellType;
  role: CellRole;
  status: CellStatus;
  dependsOn: string[];   // cell IDs that must complete before this runs
  outputs: string[];     // named output variables this cell produces
  sql?: string;          // for sql cells
  prompt?: string;       // for llm cells
  footer?: string;
  content?: string;
  skeleton?: boolean;    // true when only outline data is present (no sql/prompt yet)
}

// ── Pending changes / review workflow ─────────────────────────────────────────

export interface CellDiff {
  cellId: string;
  cellLabel: string;
  changeType: "modified" | "added" | "removed";
  sqlDiff?: { old: string; new: string };
  promptDiff?: { old: string; new: string };
  descriptionDiff?: { old: string; new: string };
  labelDiff?: { old: string; new: string };
}

export type ReviewStatus = "none" | "pending_review" | "approved" | "rejected";

export interface PlaybookPendingChanges {
  reviewStatus: ReviewStatus;
  cellDiffs: CellDiff[];
  submittedAt?: string;
  submittedBy?: string;
  auditStatus: "pending" | "running" | "pass" | "fail";
  auditErrors?: Array<{ cellId: string; cellLabel: string; error: string }>;
  /** Staged cells — proposed version. Only promoted to main cells on approval. */
  stagedCells?: PlaybookCellV2[];
  /** Snapshot of cells before modification — used for rollback on rejection. */
  previousCells?: PlaybookCellV2[];
}

// ──────────────────────────────────────────────────────────────────────────────

export interface PlaybookV2 {
  id: string;
  schemaVersion: 2;
  name: string;
  description: string;
  category: string;
  version: string;
  approvalStatus: string;
  owner: string;
  ownerInitials: string;
  cells: PlaybookCellV2[];
  params: PlaybookParam[];
  produces: PlaybookProduces[];
  runHistory: PlaybookRunHistory[];
  changelog: PlaybookChangelogEntry[];
  summaryPrompt?: string;
  /** ID of the conversation this playbook was built from */
  sourceConversationId?: string;
  /** The original user query that triggered the research */
  sourceQuery?: string;
  /** Dataset this playbook was created for */
  datasetId?: string;
  /** Pending changes awaiting review & approval */
  pendingChanges?: PlaybookPendingChanges;
}

export type AnyPlaybook = (Playbook & { schemaVersion?: 1 | undefined }) | PlaybookV2;

export interface PlaybookChangelogEntry {
  date: string;
  summary: string;
  changes: {
    type: "add" | "modify" | "remove";
    cellLabel: string;
    cellId: string | null;
    detail?: string;
  }[];
}

export interface PlaybookAnnotation {
  id: string;
  cellId: string | null; // null = general / canvas-level note
  text: string;
}

export interface PlaybookExecutionStateV2 {
  status: "idle" | "running" | "done" | "error";
  cellStatuses: Record<string, CellStatus>;
  cellResults: Record<string, {
    content?: string;
    footer?: string;
    rowCount?: number;
    timeMs?: number;
    columns?: string[];
    preview?: Record<string, unknown>[];
    error?: string;
  }>;
  streamingText: Record<string, string>;
  context: Record<string, unknown>;
}

/** Migrate a V1 playbook to V2 format */
export function migrateToV2(pb: AnyPlaybook): PlaybookV2 {
  if ("schemaVersion" in pb && pb.schemaVersion === 2) return pb as PlaybookV2;

  const old = pb as Playbook;
  const sqlGroup = old.cells.find((c) => c.type === "sql-group");
  const sqlNodes = sqlGroup?.nodes ?? [];

  const v2Cells: PlaybookCellV2[] = [];

  // Init → guardrail LLM cell
  v2Cells.push({
    id: "cell1_init",
    label: "Initialize",
    description: "Validate schema and set analysis parameters",
    type: "llm",
    role: "guardrail",
    status: "idle",
    dependsOn: [],
    outputs: ["init_context"],
  });

  // Each SQL node → individual sql cell
  for (const node of sqlNodes) {
    v2Cells.push({
      id: node.id,
      label: node.label,
      description: node.description,
      type: "sql",
      role: "query",
      status: "idle",
      dependsOn: ["cell1_init"],
      outputs: [`result_${node.id}`],
      sql: node.sql,
    });
  }

  // Compute → analysis LLM cell depending on all SQL cells
  const sqlCellIds = sqlNodes.map((n) => n.id);
  v2Cells.push({
    id: "cell3_compute",
    label: "Compute Scores",
    description: "Evaluate results from query data",
    type: "llm",
    role: "analysis",
    status: "idle",
    dependsOn: sqlCellIds,
    outputs: ["scoring"],
  });

  // Summary → summary LLM cell depending on analysis
  v2Cells.push({
    id: "cell4_summary",
    label: "Summary",
    description: "Final analysis & recommendations",
    type: "llm",
    role: "summary",
    status: "idle",
    dependsOn: ["cell3_compute"],
    outputs: ["summary"],
    prompt: old.summaryPrompt,
  });

  return {
    id: old.id,
    schemaVersion: 2,
    name: old.name,
    description: old.description,
    category: old.category,
    version: old.version,
    approvalStatus: old.approvalStatus,
    owner: old.owner,
    ownerInitials: old.ownerInitials,
    cells: v2Cells,
    params: old.params,
    produces: old.produces,
    runHistory: old.runHistory,
    changelog: [],
    summaryPrompt: old.summaryPrompt,
    datasetId: old.datasetId,
  };
}

/** Check if a playbook is V2 */
export function isPlaybookV2(pb: AnyPlaybook): pb is PlaybookV2 {
  return "schemaVersion" in pb && pb.schemaVersion === 2;
}

/** Get a PlaybookSummary from any playbook version */
export function toPlaybookSummary(pb: AnyPlaybook): PlaybookSummary {
  const lastRun = pb.runHistory.length > 0 ? pb.runHistory[0] : null;
  return {
    id: pb.id,
    name: pb.name,
    description: pb.description,
    category: pb.category,
    owner: pb.owner,
    ownerInitials: pb.ownerInitials,
    lastRun: lastRun ? lastRun.date : "Never",
    lastRunStatus: lastRun ? lastRun.status : "never",
    usedBy: "Manual Only",
  };
}
