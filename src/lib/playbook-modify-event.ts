/**
 * Lightweight pub/sub for triggering playbook modifications from the chat.
 *
 * The playbook detail page registers a handler on mount.
 * use-analytics.ts calls triggerPlaybookModify when the classifier
 * detects a "playbook_modify" intent.
 *
 * Same pattern as dataset-switch.ts / catalog-invalidation.ts.
 */

/** Returns a confirmation message string, or throws on failure */
type PlaybookModifyHandler = (message: string) => Promise<string>;

let handler: PlaybookModifyHandler | null = null;

/** Register the current playbook page's modify handler. Call with null on unmount. */
export function setPlaybookModifyHandler(h: PlaybookModifyHandler | null) {
  handler = h;
}

/**
 * Trigger a playbook modification from the chat.
 * Returns the handler's confirmation message, or null if no handler is registered.
 */
export async function triggerPlaybookModify(message: string): Promise<string | null> {
  if (!handler) return null;
  return handler(message);
}
