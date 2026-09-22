import type { ChatMessage } from "@/lib/types";

/** Derived tag representing a thematic domain this conversation touches */
export interface ConversationTag {
  domain: string;
  source: "agent" | "action" | "metric" | "keyword";
  weight: number; // 0-1 relevance score
}

/** A pending action that was suggested but not yet completed */
export interface PendingAction {
  id: string;
  type: string;
  label: string;
  messageId: string;
  createdAt: number;
  completedAt?: number;
  dismissedAt?: number;
  payload?: Record<string, unknown>;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  /** "deck" conversations are auto-created by the Decks pipeline and excluded from the history sidebar */
  origin?: "user" | "deck";
  sourceCanvasItemId?: string;
  datasetId?: string;
  /** Derived thematic tags for intersection matching */
  tags?: ConversationTag[];
  /** Follow-up actions that haven't been completed */
  pendingActions?: PendingAction[];
  /** Folder this conversation belongs to (undefined = uncategorized) */
  folderId?: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  datasetId?: string;
  folderId?: string;
}
