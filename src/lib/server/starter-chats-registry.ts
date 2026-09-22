import { seedStarterChats, type StarterChat } from "@/lib/server/starter-chats";
import { PRESTO_STARTER_CHATS } from "@/lib/server/starters/presto-chats";
import { VASTU_HFC_STARTER_CHATS } from "@/lib/server/starters/vastu-hfc-chats";
import { QUICKHELP_STARTER_CHATS } from "@/lib/server/starters/quickhelp-chats";
import { FUNDSINDIA_STARTER_CHATS } from "@/lib/server/starters/fundsindia-chats";
import { HEALTHIANS_STARTER_CHATS } from "@/lib/server/starters/healthians-chats";
import { SUVIDHA_CAPITAL_STARTER_CHATS } from "@/lib/server/starters/suvidha-capital-chats";
import { SEED_SAMPLE_WORKSPACE_CONTENT } from "@/lib/server/seed-config";

/** Handcrafted starter conversations per sample dataset, so a fresh workspace is never empty. */
const STARTER_CHATS_BY_DATASET: Record<string, StarterChat[]> = {
  presto: PRESTO_STARTER_CHATS,
  "vastu-hfc": VASTU_HFC_STARTER_CHATS,
  quickhelp: QUICKHELP_STARTER_CHATS,
  fundsindia: FUNDSINDIA_STARTER_CHATS,
  healthians: HEALTHIANS_STARTER_CHATS,
  "suvidha-capital": SUVIDHA_CAPITAL_STARTER_CHATS,
};

/** Seed the handcrafted starter chats for a user + dataset. Idempotent. Returns count seeded. */
export function seedStarterChatsForDataset(userId: string, datasetId: string): number {
  if (!SEED_SAMPLE_WORKSPACE_CONTENT) return 0;
  const chats = STARTER_CHATS_BY_DATASET[datasetId];
  if (!chats || chats.length === 0) return 0;
  return seedStarterChats(userId, datasetId, chats);
}
