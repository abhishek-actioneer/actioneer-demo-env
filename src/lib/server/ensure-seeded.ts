import { getSampleWorkspaceSeeder } from "@/lib/server/sample-workspace-registry";
import { seedPlaybooksForDataset } from "@/lib/server/playbook-seed-registry";
import { seedStarterChatsForDataset } from "@/lib/server/starter-chats-registry";

// Runs the full handcrafted seed (segments, funnels, retentions, metrics,
// playbooks, voice campaigns, starter chats) for a sample dataset the first
// time a user opens it this server session, so the workspace populates without
// a manual "Generate" step. Idempotent and guarded so it runs at most once per
// (user, dataset) per process lifetime.
const ensured = new Set<string>();

export async function ensureWorkspaceSeeded(userId: string, datasetId: string): Promise<void> {
  const key = `${userId}:${datasetId}`;
  if (ensured.has(key)) return;
  ensured.add(key);

  try {
    const seeder = getSampleWorkspaceSeeder(datasetId);
    if (seeder) await seeder(userId); // segments, funnels, retentions (+ playbooks/voice via the main seeder)
    seedPlaybooksForDataset(userId, datasetId);
    seedStarterChatsForDataset(userId, datasetId);
  } catch (err) {
    ensured.delete(key); // allow a retry on the next request if seeding failed
    console.warn(`[ensure-seeded] ${datasetId} failed:`, err);
  }
}
