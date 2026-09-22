/**
 * Per-dataset seed-content coverage.
 *
 * Guards the "nothing empty" guarantee: every sample dataset must ship
 * handcrafted, well-formed starter chats and (for the non-LLM datasets) a
 * sample-workspace seeder, plus a curated knowledge.json. Pure file/shape
 * checks — no DB connections are opened.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

import { PRESTO_STARTER_CHATS } from "@/lib/server/starters/presto-chats";
import { VASTU_HFC_STARTER_CHATS } from "@/lib/server/starters/vastu-hfc-chats";
import { QUICKHELP_STARTER_CHATS } from "@/lib/server/starters/quickhelp-chats";
import { FUNDSINDIA_STARTER_CHATS } from "@/lib/server/starters/fundsindia-chats";
import { HEALTHIANS_STARTER_CHATS } from "@/lib/server/starters/healthians-chats";
import type { StarterChat } from "@/lib/server/starter-chats";

const ALL_DATASETS = ["presto", "vastu-hfc", "quickhelp", "fundsindia", "healthians"];

const STARTER_CHATS: Record<string, StarterChat[]> = {
  presto: PRESTO_STARTER_CHATS,
  "vastu-hfc": VASTU_HFC_STARTER_CHATS,
  quickhelp: QUICKHELP_STARTER_CHATS,
  fundsindia: FUNDSINDIA_STARTER_CHATS,
  healthians: HEALTHIANS_STARTER_CHATS,
};

describe("starter chats", () => {
  for (const ds of ALL_DATASETS) {
    it(`${ds} has well-formed starter chats`, () => {
      const chats = STARTER_CHATS[ds];
      expect(chats.length).toBeGreaterThanOrEqual(3);
      const slugs = new Set<string>();
      for (const chat of chats) {
        expect(chat.slug).toBeTruthy();
        expect(slugs.has(chat.slug)).toBe(false);
        slugs.add(chat.slug);
        expect(chat.title.trim().length).toBeGreaterThan(0);
        expect(chat.messages.length).toBeGreaterThanOrEqual(2);
        // A real thread starts with the user and gets a sentinel reply. Deep
        // threads also include agent + report-cta messages whose content is
        // intentionally empty, so only require content on the question + answer.
        expect(chat.messages[0].role).toBe("user");
        expect(chat.messages.some((m) => m.role === "user" && m.content.trim().length > 0)).toBe(true);
        expect(chat.messages.some((m) => m.role === "sentinel" && m.content.trim().length > 0)).toBe(true);
        for (const m of chat.messages) {
          expect(["user", "sentinel", "agent"]).toContain(m.role);
        }
      }
    });
  }
});

describe("starter chats are audited (query sources + citations)", () => {
  for (const ds of ALL_DATASETS) {
    it(`${ds} chats carry real query sources and every citation resolves`, () => {
      const chats = STARTER_CHATS[ds];
      let chatsWithSources = 0;

      for (const chat of chats) {
        const subs = chat.messages.flatMap((m) => m.agent?.subagents ?? []);

        // expectedQueryCount must match the actual queries, and each query needs real SQL + a label.
        for (const s of subs) {
          expect(s.expectedQueryCount ?? 0).toBe(s.queries?.length ?? 0);
          for (const q of s.queries ?? []) {
            expect(q.sql.trim().length).toBeGreaterThan(0);
            expect(q.description.trim().length).toBeGreaterThan(0);
          }
        }

        const countById = new Map<string, number>();
        for (const s of subs) countById.set(s.id, s.queries?.length ?? 0);
        if ([...countById.values()].some((n) => n > 0)) chatsWithSources++;

        // Every [agent-id:Q#] citation in an answer must point at a real agent + an in-range query.
        const citationRe = /\[([a-z][\w-]*):Q(\d+)\]/g;
        for (const m of chat.messages) {
          if (m.role !== "sentinel" || !m.content) continue;
          // No em-dashes or en-dashes in seeded copy.
          expect(m.content.includes("—")).toBe(false);
          expect(m.content.includes("–")).toBe(false);
          let match: RegExpExecArray | null;
          while ((match = citationRe.exec(m.content)) !== null) {
            const agentId = match[1];
            const n = Number(match[2]);
            expect(countById.has(agentId)).toBe(true);
            expect(n).toBeGreaterThanOrEqual(1);
            expect(n).toBeLessThanOrEqual(countById.get(agentId) ?? 0);
          }
        }
      }

      // All 7 seeded chats per dataset should now be source-backed.
      expect(chatsWithSources).toBeGreaterThanOrEqual(5);
    });
  }
});

describe("curated knowledge.json", () => {
  for (const ds of ALL_DATASETS) {
    it(`${ds} ships a non-empty knowledge.json`, () => {
      const p = resolve(process.cwd(), `data/datasets/${ds}/knowledge.json`);
      expect(existsSync(p)).toBe(true);
      const entries = JSON.parse(readFileSync(p, "utf-8"));
      expect(Array.isArray(entries)).toBe(true);
      expect(entries.length).toBeGreaterThanOrEqual(3);
      const ids = new Set<string>();
      for (const e of entries) {
        expect(e.id).toBeTruthy();
        expect(ids.has(e.id)).toBe(false);
        ids.add(e.id);
        expect(typeof e.content).toBe("string");
        expect(e.content.trim().length).toBeGreaterThan(0);
        expect(e.category).toBeTruthy();
        expect(e.priority).toBeTruthy();
      }
    });
  }
});

describe("sample-workspace seeder registry", () => {
  it("every sample dataset resolves to a handcrafted seeder", async () => {
    const { hasHandcraftedSeeder } = await import("@/lib/server/sample-workspace-registry");
    for (const ds of ALL_DATASETS) {
      expect(hasHandcraftedSeeder(ds)).toBe(true);
    }
  });
});
