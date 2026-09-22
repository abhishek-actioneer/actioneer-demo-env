export type KnowledgeCategory =
  | "Data validation"
  | "External benchmark"
  | "Insight"
  | "Reporting"
  | "Segment"
  | "Visualisation"
  | "Metric"
  | "Metric range";

export type KnowledgePriority = "Critical" | "High" | "Good to have";

export type KnowledgeSource = "thread" | "manual" | "paste-import" | "website" | "auto-generated";

export type KnowledgeLevel = "global" | "user";

export interface KnowledgeEntry {
  id: string;
  /** Display title for page-backed knowledge. */
  title?: string;
  content: string;
  level: KnowledgeLevel;
  category: KnowledgeCategory;
  priority: KnowledgePriority;
  source: KnowledgeSource;
  dateAdded: string;
  addedBy: string;
  referenceThread?: string;
  /** ID of the conversation this knowledge was saved from */
  sourceConversationId?: string;
  /** Public page used to create this knowledge entry. */
  sourceUrl?: string;
}

export const KNOWLEDGE_CATEGORIES: KnowledgeCategory[] = [
  "Data validation",
  "External benchmark",
  "Insight",
  "Reporting",
  "Segment",
  "Visualisation",
  "Metric",
  "Metric range",
];

export const KNOWLEDGE_PRIORITIES: KnowledgePriority[] = [
  "Critical",
  "High",
  "Good to have",
];

export const KNOWLEDGE_SOURCES: KnowledgeSource[] = [
  "thread",
  "manual",
  "paste-import",
  "website",
  "auto-generated",
];
