import { describe, it, expect } from "vitest";
import { getDb } from "@/lib/meta-db";

describe("meta-db voice/omnichannel tables", () => {
  it("creates all five transplanted tables", () => {
    const db = getDb();
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => (r as { name: string }).name);
    for (const t of [
      "call_event_outbox",
      "call_recordings",
      "contacts",
      "contact_phones",
      "channel_events",
    ]) {
      expect(names).toContain(t);
    }
  });
});
