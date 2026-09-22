/**
 * Master switch for auto-seeding handcrafted sample content into a fresh
 * workspace: starter chats, playbooks, funnels, retentions, and segments.
 *
 * Set to `true` (2026-06-22) to restore the handcrafted sample workspace so every
 * dataset ships validated, realistic starter funnels/retentions/segments (and
 * starter chats/playbooks) instead of falling back to unreliable live-LLM
 * generation. Metrics are unaffected (they load from
 * data/datasets/<id>/metrics.json, not these seeders).
 */
export const SEED_SAMPLE_WORKSPACE_CONTENT = true;
