import type { FollowUpAction } from "./types";

// ── Shared regex patterns for deep-dive section stripping ──

const SECTION_REGEX = /## Suggested Further Deep-Dives\s*\n([\s\S]*?)(?=\n##|\n---|\n\*\*Data Period|\s*$)/i;
const DATA_PERIOD_REGEX = /\n---\s*\n\*\*Data Period:\*\*[^\n]*/i;
/** Greedy variant for streaming — strips everything after the heading to end of string */
const SECTION_REGEX_STREAMING = /## Suggested Further Deep-Dives\s*\n[\s\S]*$/i;
const SECTION_HEADER = "## Suggested Further Deep-Dives";

/** Strip deep-dives section from content during streaming (greedy to end of string) */
export function stripDeepDivesStreaming(text: string): string {
  if (!text.includes(SECTION_HEADER)) return text;
  return text
    .replace(SECTION_REGEX_STREAMING, "")
    .replace(DATA_PERIOD_REGEX, "")
    .trimEnd();
}

/** Strip deep-dives section from final content (bounded, preserves subsequent sections) */
export function stripDeepDivesFinal(text: string): string {
  return text
    .replace(SECTION_REGEX, "")
    .replace(DATA_PERIOD_REGEX, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Extract "Suggested Further Deep-Dives" from a research report markdown string.
 * Returns the parsed actions and the report with that section stripped.
 */
export function extractDeepDives(reportText: string): {
  actions: FollowUpAction[];
  cleanedReport: string;
} {
  const match = reportText.match(SECTION_REGEX);

  if (!match) {
    return { actions: [], cleanedReport: reportText };
  }

  const sectionBody = match[1];

  // Parse numbered list items: "1. **Topic** — Description" or "1. **Topic**: Description"
  const itemRegex = /\d+\.\s+\*\*(.+?)\*\*\s*[—–:\-]\s*(.+)/g;
  const actions: FollowUpAction[] = [];
  let m: RegExpExecArray | null;

  while ((m = itemRegex.exec(sectionBody)) !== null) {
    const topic = m[1].trim();
    const description = m[2].trim();
    actions.push({
      id: `deep-dive-${actions.length}`,
      label: `${topic} — ${description}`,
      icon: "message-circle",
      type: "follow-up-question",
    });
  }

  const cleanedReport = stripDeepDivesFinal(reportText);

  return { actions, cleanedReport };
}
