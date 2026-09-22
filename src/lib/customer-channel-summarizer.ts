import { getDb } from "./meta-db";
import { generateText } from "./llm";
import { normalizeCustomerPhone } from "./customer-channel-memory";

const STALE_AFTER_DAYS = 7;
const OLD_EVENTS_THRESHOLD_DAYS = 30;

interface ContactPhoneRow { contact_id: string }
interface ContactSummaryRow { background_summary_at: string | null }
interface OldEventRow { content: string | null; channel: string; direction: string; actor: string; occurred_at: string }

export function triggerBackgroundSummaryIfStale(userId: string | undefined, phone: string): void {
  if (!userId || !phone) return;
  const normalizedPhone = normalizeCustomerPhone(phone);
  if (!normalizedPhone) return;

  const db = getDb();

  const phoneRow = db.prepare(
    "SELECT contact_id FROM contact_phones WHERE phone = ? AND user_id = ?",
  ).get(normalizedPhone, userId) as ContactPhoneRow | undefined;
  if (!phoneRow) return;

  const contact = db.prepare(
    "SELECT background_summary_at FROM contacts WHERE id = ? AND user_id = ?",
  ).get(phoneRow.contact_id, userId) as ContactSummaryRow | undefined;
  if (!contact) return;

  const staleCutoff = new Date(Date.now() - STALE_AFTER_DAYS * 86_400_000).toISOString();
  if (contact.background_summary_at && contact.background_summary_at > staleCutoff) return;

  const oldCutoff = new Date(Date.now() - OLD_EVENTS_THRESHOLD_DAYS * 86_400_000).toISOString();
  const { cnt } = db.prepare(
    "SELECT COUNT(*) as cnt FROM channel_events WHERE user_id = ? AND contact_id = ? AND occurred_at < ?",
  ).get(userId, phoneRow.contact_id, oldCutoff) as { cnt: number };
  if (cnt === 0) return;

  const contactId = phoneRow.contact_id;

  void (async () => {
    try {
      const rows = db.prepare(`
        SELECT content, channel, direction, actor, occurred_at
        FROM channel_events
        WHERE user_id = ? AND contact_id = ? AND occurred_at < ?
        ORDER BY occurred_at ASC LIMIT 50
      `).all(userId, contactId, oldCutoff) as OldEventRow[];

      const lines = rows
        .filter(r => r.content?.trim())
        .map(r => `${r.occurred_at}: ${r.channel} ${r.direction} (${r.actor}): ${r.content}`)
        .join("\n");

      if (!lines) return;

      const summary = await generateText({
        label: "contact background summary",
        timeoutMs: 10_000,
        maxOutputTokens: 80,
        messages: [
          {
            role: "system",
            content: [
              "Summarize this customer's interaction history in 1-2 sentences.",
              "Focus on what topics they raised, any pending requests, and their preferences.",
              "Be factual and concise. No markdown.",
            ].join(" "),
          },
          { role: "user", content: lines },
        ],
      });

      if (!summary?.trim()) return;

      const now = new Date().toISOString();
      db.prepare(
        "UPDATE contacts SET background_summary = ?, background_summary_at = ?, updated_at = ? WHERE id = ? AND user_id = ?",
      ).run(summary.trim(), now, now, contactId, userId);
    } catch (err) {
      console.warn("[customer-channel-summarizer] background summary failed:", err);
    }
  })();
}
