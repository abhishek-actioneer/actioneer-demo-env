import type { SegmentBuilderConfig } from "./segment-builder-types";

export interface QueryInfo {
  sql: string;
  description: string;
  rowCount?: number;
  executionTimeMs?: number;
  error?: string;
  columns?: string[];
  data?: Record<string, unknown>[];
}

export interface SubagentInfo {
  id: string;
  name: string;
  icon: string;
  status: "pending" | "active" | "complete" | "error";
  queries: QueryInfo[];
  expectedQueryCount: number;
  summary?: string;
  // Legacy fields (kept for backwards compat with saved conversations)
  action?: string;
  progress?: { current: number; total: number };
}

export interface AgentInfo {
  status: "gathering" | "processing" | "complete";
  statusLabel?: string;
  taskCount: number;
  subagents: SubagentInfo[];
  planText?: string;
}

export interface FollowUpAction {
  id: string;
  label: string;
  icon: string;
  type:
    | "follow-up-question"
    | "create-segment"
    | "create-segment-clevertap"
    | "create-segment-firebase"
    | "create-segment-bigquery"
    | "view-in-store";
  payload?: Record<string, unknown>;
}

export interface Segment {
  id: string;
  name: string;
  sql: string;
  config?: SegmentBuilderConfig;
  description?: string;
  userCount: number;
  createdAt: string;
  sourceConversationId?: string;
  pushStatus: Record<string, "idle" | "pushing" | "synced" | "error">;
}

export interface SegmentDisplay extends Segment {
  description: string;
  type: "dynamic" | "static";
  destinations: string[];
  trend: number | null;
  refreshStatus: "active" | "stale" | "failed" | "snapshot";
  refreshLabel: string;
  creator: string;
  statusColor: "green" | "blue" | "yellow" | "red";
  archived: boolean;
  refreshFrequency: "6h" | "daily" | "weekly" | "manual";
  similarSegments: { id: string; name: string; overlapPercent: number }[];
  totalUsers: number;

  // Behavioral segment fields (optional — presence = behavioral type)
  behavioralTraits?: string[];
  behavioralSummary?: string;
  accentColor?: string;
  differentiator?: string;
  performanceMetrics?: {
    users: { value: number; delta: number };
    revenue: { value: number; delta: number };
    retention: { value: number; delta: number };
    aov: { value: number; delta: number };
  };
}

export function isBehavioralSegment(s: SegmentDisplay): boolean {
  return (s.behavioralTraits?.length ?? 0) > 0;
}

export interface Integration {
  id: string;
  name: string;
  icon: string;
  description: string;
  connected: boolean;
  lastSynced?: string;
}

export interface ConnectorRequirement {
  missing: Array<{ description: string; reason: string }>;
  recommendedCategories: string[];
  canProceedWithout: boolean;
  degradedDescription?: string;
  originalQuery: string;
}

export interface PlaybookPreviewData {
  name: string;
  description: string;
  params?: Array<{
    name: string;
    label: string;
    type: string;
    defaultVal: string;
    group?: string;
  }>;
  cells: Array<{
    id: string;
    type: string;
    role?: string;
    label: string;
    description: string;
    status: string;
    dependsOn?: string[];
    outputs?: string[];
    sql?: string;
    prompt?: string;
    nodes?: Array<{
      id: string;
      label: string;
      description: string;
      sql: string;
      status: string;
    }>;
  }>;
  produces?: Array<{
    name: string;
    description: string;
  }>;
}

// ── Question page types (used by src/components/question/) ──

export interface SubagentTrace {
  id: string;
  name: string;
  status: "pending" | "active" | "complete" | "error";
  queries: QueryInfo[];
  summary?: string;
}

export interface TraceState {
  phase: "gathering" | "generating_sql" | "executing" | "synthesizing" | "complete";
  subagents: SubagentTrace[];
  critiqueAgent?: SubagentTrace;
}

export interface QuestionState {
  id: string;
  question: string;
  answer: string;
  mode: "deep" | "quick" | "direct";
  status: "processing" | "complete" | "error";
  trace: TraceState;
  startedAt: number;
  completedAt?: number;
  hasReport?: boolean;
}

export interface MetricContextData {
  metricId: string;
  name: string;
  category: string;
  type: string;
  value: number;
  valueFormat: string;
  changePercent?: number;
  timeSeries: { date: string; value: number }[];
  timeGrain: string;
  aggregation: string;
  table: string;
  column: string;
  granularity: string;
  formula: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "sentinel" | "agent";
  content: string;
  timestamp: number;
  agent?: AgentInfo;
  variant?: "gathering" | "streaming" | "report-cta" | "connector-required" | "playbook-preview" | "save-as-playbook" | "save-to-knowledge" | "metric-context" | "segment-confirm" | "funnel-confirm" | "retention-confirm" | "metric-update-confirm" | "metric-create-confirm" | "metric-table-select" | "metric-generating" | "policy-confirm" | "policy-table-select" | "playbook-wizard" | "playbook-plan-review" | "campaign-draft" | "voice-agent-generation" | "auto-deep-notice";
  voiceAgentGeneration?: import("@/lib/voice-agent-generation-types").VoiceAgentGenerationCardData;
  /** Auto-deep-research notice card data — shown when classifier upgrades a query to deep mode */
  autoDeepNotice?: {
    reason: string;
    /** ID of the deep research agent message this notice belongs to (for revert targeting) */
    agentMsgId: string;
    /** Original user query + context, used to re-run as quick if user reverts */
    originalText: string;
    status: "active" | "committed" | "reverted";
  };
  followUpActions?: FollowUpAction[];
  connectorInfo?: ConnectorRequirement;
  playbookPreview?: PlaybookPreviewData;
  metricContext?: MetricContextData;
  /** Original user query — used by save-as-playbook to know what analysis to capture */
  userQuery?: string;
  /** Playbook plan review card (alignment step before full generation) */
  playbookPlanReview?: {
    cells: Array<{ id: string; label: string; description: string; type: string; role: string; dependsOn: string[] }>;
    status: "pending" | "approved" | "generating" | "superseded";
    /** Summary of what changed (shown on updated plan cards) */
    changeSummary?: string;
  };
  /** Playbook creation wizard step data */
  playbookWizard?: {
    stepKey: string;
    stepIndex: number;
    totalSteps: number;
    question: string;
    inputType: "text" | "options";
    options?: string[];
    chips?: string[];
    placeholder?: string;
    optional?: boolean;
    answered?: boolean;
    answer?: string;
  };
  /** Knowledge suggestion from agent correction detection */
  knowledgeSuggestion?: {
    content: string;
    suggestedLevel: "global" | "user";
  };
  /** Segment creation confirmation card data */
  segmentConfirm?: {
    suggestedName: string;
    sql: string;
    description: string;
    userCount: number | null;
    status: "ready" | "confirming" | "confirmed" | "cancelled" | "error";
    error?: string;
    segmentId?: string;
    voiceCampaignStatus?: "idle" | "creating" | "created" | "error";
    voiceCampaignId?: string;
    voiceCampaignUrl?: string;
    voiceCampaignError?: string;
  };
  /** Funnel creation confirmation card data */
  funnelConfirm?: {
    suggestedName: string;
    config: import("@/lib/funnel-types").FunnelConfig;
    description: string;
    overallConversion: number | null;
    status: "ready" | "confirming" | "confirmed" | "cancelled" | "error";
    error?: string;
    funnelId?: string;
  };
  /** Retention creation confirmation card data */
  retentionConfirm?: {
    suggestedName: string;
    config: import("@/lib/retention-types").RetentionConfig;
    description: string;
    d7Retention: number | null;
    status: "ready" | "confirming" | "confirmed" | "cancelled" | "error";
    error?: string;
    retentionId?: string;
  };
  /** Metric update confirmation card data */
  metricUpdateConfirm?: {
    metricId: string;
    metricName: string;
    oldDescription: string;
    newDescription: string;
    oldSql: string;
    newSql: string;
    oldFormula: string;
    newFormula: string;
    explanation: string;
    affectedMetrics: string[];
    userRequest: string;
    status: "ready" | "published" | "dismissed" | "editing";
    suggestedRelatedMetrics?: string[];
    table?: string;
    /** Separate value SQL (returns single row with "value" column) */
    valueSql?: string;
    /** Time series SQL (returns rows with "date" and "value" columns) */
    timeSeriesSql?: string;
    /** Computed metric value from server-side SQL execution */
    computedValue?: number | null;
    /** Whether the generated SQL executed successfully */
    sqlValid?: boolean;
    /** SQL execution errors */
    sqlErrors?: { valueSql?: string | null; timeSeriesSql?: string | null };
    /** User-edited metric name (original stays in metricName for diffing) */
    newName?: string;
  };
  /** Table clarification step — ask user which table to use before computing */
  metricTableSelect?: {
    metricId: string;
    metricName: string;
    description: string;
    tables: string[];
    selectedTable?: string;
    status: "pending" | "confirmed";
    suggestedRelatedMetrics: string[];
  };
  /** Metric generation in-progress loader */
  metricGenerating?: {
    metricId: string;
    metricName: string;
    table: string;
    phase: "analyzing" | "generating" | "computing" | "done" | "error";
    error?: string;
  };
  /** Metric creation confirmation card data */
  metricCreateConfirm?: {
    metricId: string;
    metricName: string;
    description: string;
    status: "ready" | "approved" | "dismissed";
  };
  /** Policy creation confirmation card data */
  policyConfirm?: {
    name: string;
    description: string;
    datasetId: string;
    tableAccess: import("@/lib/policy-types").TableAccessRule[];
    status: "ready" | "confirmed" | "cancelled";
    policyId?: string;
  };
  /** Policy table selection card data */
  policyTableSelect?: {
    tables: string[];
    recommendedTables: string[];
    selectedTables?: string[];
    description: string;
    status: "pending" | "confirmed";
  };
  /** Campaign draft card — LLM-generated email/push/sms draft for a segment */
  campaignDraft?: {
    segmentId: string;
    segmentName: string;
    userCount: number | null;
    channel: "email" | "push" | "sms" | "webpush" | "whatsapp";
    subject: string;
    body: string;
    senderName?: string;
    senderEmailId?: string;
    replyTo?: string;
    rationale?: string;
    status: "ready" | "firing" | "sent" | "cancelled" | "error";
    error?: string;
    campaignId?: number;
    dashboardUrl?: string;
  };
  /** Context references from @ picker — rendered as chips in user bubble */
  contextRefs?: Array<{ displayLabel: string; type: string }>;
  /** Simulated credit cost for this response */
  creditCost?: number;
  /** True for quick-mode analytics responses — enables pin button and citation badges */
  isAnalyticsResponse?: boolean;
  /** True for deep research report responses — enables document view, minimap, and board conversion. */
  isDeepResearchReport?: boolean;
  /** Marks a role:"agent" message as a data-only vessel for quick-mode query storage.
   *  These messages are never rendered in the chat thread. */
  isDataOnly?: boolean;
}
