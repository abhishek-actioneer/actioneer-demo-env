import { getDb } from "@/lib/meta-db";

export type BugStatus =
  | "new"
  | "planning"
  | "plan_ready"
  | "awaiting_approval"
  | "executing"
  | "awaiting_commit_approval"
  | "committed"
  | "demoed"
  | "rejected"
  | "failed";

export interface Bug {
  id: string;
  user_id: string;
  dataset_id: string | null;
  title: string;
  description: string;
  page_url: string | null;
  user_agent: string | null;
  screenshot_b64: string | null;
  status: BugStatus;
  cursor_agent_id: string | null;
  plan_markdown: string | null;
  diff_summary: string | null;
  pr_url: string | null;
  demo_video_url: string | null;
  created_at: number;
  updated_at: number;
}

export interface CreateBugInput {
  userId: string;
  datasetId?: string | null;
  description: string;
  pageUrl?: string | null;
  userAgent?: string | null;
  screenshotB64?: string | null;
}

export function createBug(input: CreateBugInput): Bug {
  const db = getDb();
  const id = `B-${crypto.randomUUID().slice(0, 8)}`;
  const now = Date.now();

  const trimmed = input.description.trim();
  const title = trimmed.length <= 60 ? trimmed : trimmed.slice(0, 57).replace(/\s+\S*$/, "") + "…";

  db.prepare(
    `INSERT INTO bugs (id, user_id, dataset_id, title, description, page_url, user_agent, screenshot_b64, status, created_at, updated_at)
     VALUES (@id, @user_id, @dataset_id, @title, @description, @page_url, @user_agent, @screenshot_b64, 'new', @created_at, @updated_at)`,
  ).run({
    id,
    user_id: input.userId,
    dataset_id: input.datasetId ?? null,
    title,
    description: trimmed,
    page_url: input.pageUrl ?? null,
    user_agent: input.userAgent ?? null,
    screenshot_b64: input.screenshotB64 ?? null,
    created_at: now,
    updated_at: now,
  });

  return getBug(id, input.userId)!;
}

export function getBug(id: string, userId: string): Bug | null {
  const db = getDb();
  return (db.prepare(`SELECT * FROM bugs WHERE id = ? AND user_id = ?`).get(id, userId) as Bug | undefined) ?? null;
}

export function listBugsForUser(userId: string): Bug[] {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM bugs WHERE user_id = ? ORDER BY created_at DESC`)
    .all(userId) as Bug[];
}
