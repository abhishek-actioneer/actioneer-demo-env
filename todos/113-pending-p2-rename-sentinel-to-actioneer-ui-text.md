---
status: complete
priority: p2
issue_id: "113"
tags: [rename, ui, branding]
dependencies: []
---

# Rename Sentinel → Actioneer in user-facing UI text

## Problem Statement

All visible UI text that says "Sentinel" needs to say "Actioneer" instead. This covers headings, labels, alt text, aria-labels, placeholders, and inline copy.

## Scope

| File | What to change |
|------|---------------|
| `src/app/layout.tsx` | `title: "Sentinel"` (2 occurrences — title + template) |
| `src/lib/page-context.ts` | `pageLabel: "Sentinel"` and `inputPlaceholder: "Ask Sentinel anything..."` |
| `src/components/chat/chat-thread.tsx` | All `<p>` elements displaying "Sentinel" as the bot name (6 occurrences) |
| `src/components/chat/chat-welcome.tsx` | Welcome heading "Sentinel", alt text on logo, description copy |
| `src/components/chat/chat-fab.tsx` | `aria-label="Ask Sentinel"` and button text "Ask Sentinel" |
| `src/components/chat/search-modal.tsx` | Alt text and label "Sentinel" in search result previews |
| `src/components/sidebar.tsx` | `alt="Sentinel"` on logo image |
| `src/components/store/store-insights-section.tsx` | Heading `"Sentinel Insights"` |
| `src/components/knowledge/knowledge-import.tsx` | "Sentinel will parse it..." and "Sentinel found..." |
| `src/components/knowledge/knowledge-add-form.tsx` | "auto-assigned by Sentinel" |
| `src/app/knowledge/page.tsx` | "Help Sentinel understand your business" |
| `src/app/connectors/page.tsx` | "Sentinel will begin syncing", alt text, placeholder `sentinel_user` → `actioneer_user` |
| `src/components/connectors/connector-modal.tsx` | Alt text, "Connect via Sentinel warehouse", "Imports data to Sentinel warehouse" |
| `src/app/store/offers/page.tsx` | `"· Sentinel"` attribution label |

## Acceptance Criteria

- [ ] No user-visible string contains "Sentinel" (case-insensitive, excluding internal code identifiers)
- [ ] All alt text on logo images says "Actioneer"
- [ ] All aria-labels updated
- [ ] `document.title` shows "Actioneer"
