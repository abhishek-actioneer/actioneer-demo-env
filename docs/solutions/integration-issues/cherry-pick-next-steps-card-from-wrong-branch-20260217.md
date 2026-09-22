---
module: Chat Components
date: 2026-02-17
problem_type: integration_issue
component: frontend_stimulus
symptoms:
  - "Next Steps card / action rows missing from ChatInput after merge"
  - "Follow-up actions only rendered as pill buttons in chat thread, not in input box"
root_cause: missing_workflow_step
resolution_type: code_fix
severity: medium
tags: [cherry-pick, merge, branch-management, chat-input, next-steps-card]
---

# Troubleshooting: Next Steps Card Missing After Merge — Feature on Wrong Branch

## Problem

After merging `origin/vimarsh` into `v1-sv` (commit `52dbfe7`), the "Next Steps card" feature (Cowork-style action rows inside the ChatInput component) was missing. Investigation revealed the feature was never on either merged branch — it existed exclusively on `v2-sv`.

## Environment

- Module: Chat Components (`chat-input.tsx`, `chat-thread.tsx`, `page.tsx`, `types.ts`)
- Stack: Next.js 16 / React 19 / TypeScript
- Affected Component: `ChatInput` component and its integration with follow-up actions
- Date: 2026-02-17

## Symptoms

- ChatInput showed only a basic text box with placeholder, Connected indicator, Deep Research toggle, and send button
- Follow-up actions (Create Segment, Refine Filters, Schedule Report, etc.) rendered as pill buttons below the chat response in the thread, not as action rows inside the input box
- No `actions`, `onAction`, or `onDismissActions` props passed to `ChatInput` in `page.tsx`

## What Didn't Work

**Initial assumption:** Changes were lost during the merge conflict resolution at `52dbfe7`.

- **Why it was wrong:** Git history analysis (`git show 52dbfe7`, `git log --all --oneline -- src/components/chat/chat-input.tsx`) proved the merge was clean for `chat-input.tsx` — only one side (vimarsh) had changes (a `/playbook` slash command hint), so git auto-merged with no conflict. No resolution happened, so nothing could have been "lost."

## Solution

Cherry-picked commit `9f9f08e` ("feat: Next Steps card merged into ChatInput (Cowork-style)") from `v2-sv` into `v1-sv`:

```bash
git cherry-pick 9f9f08e
```

This produced conflicts in 4 files. Resolution strategy: **keep both sides' additions** since features are complementary.

### Conflict 1: `src/components/chat/chat-input.tsx`

Kept both the `/playbook` slash command hint (from HEAD/vimarsh) AND the action rows (from cherry-pick):

```tsx
// Both features coexist — slash hint shown when typing "/", action rows shown when actions exist
{value.startsWith("/") && !value.includes(" ") && (
  <div className="px-4 pt-2 pb-0">...</div>
)}

{hasActions && (
  <div className="animate-fade-in-up">
    <div className="px-4 pt-3 pb-1 flex items-center justify-between">
      <span>What would you like to do next?</span>
      ...
    </div>
    {actions.map((action) => (
      <button key={action.id} onClick={() => onAction(action)}>...</button>
    ))}
  </div>
)}
```

### Conflict 2: `src/app/page.tsx`

Kept HEAD's ChatThread callback props (connectors, playbooks, knowledge) AND the cherry-pick's ChatInput ref/actions props:

```tsx
<ChatThread
  // ... HEAD's props retained:
  onFollowUpAction={handleFollowUpAction}
  onConnectorClick={handleConnectorClick}
  onProceedWithout={handleProceedWithout}
  onUploadCSV={handleUploadCSV}
  onSaveAsPlaybook={handleSaveAsPlaybook}
  onSavePlaybookPreview={handleSavePlaybookPreview}
  onSaveToKnowledge={handleSaveToKnowledge}
  onDismissKnowledge={handleDismissKnowledge}
/>
<ChatInput
  ref={chatInputRef}  // from cherry-pick
  actions={activeActions?.actions}  // from cherry-pick
  onAction={handleFollowUpAction}  // from cherry-pick
  onDismissActions={...}  // from cherry-pick
/>
```

### Conflict 3: `src/components/chat/chat-thread.tsx`

Kept HEAD's imports and props for DataConnectorWidget, ReportCTA, SaveToKnowledge, etc. The cherry-pick had removed these because it moved follow-up actions to ChatInput, but the ChatThread still needs them for other message variant rendering.

**Post-merge fix:** Removed dead import `FollowUpActions` (renamed to `NextStepsCard` in the cherry-pick but no longer used in ChatThread).

### Conflict 4: `src/lib/types.ts`

Merged both sides of `ChatMessage` interface additions:
- HEAD: `connectorInfo`, `playbookPreview`, `userQuery`, `knowledgeSuggestion`
- Cherry-pick: `cardDismissed`

## Why This Works

The root cause was a **branch management gap**: the "Next Steps card" feature was developed on `v2-sv` (a separate experimental branch) while `v1-sv` was the active integration branch. The merge at `52dbfe7` only combined `v1-sv` and `origin/vimarsh` — `v2-sv` was never part of it.

Cherry-picking brings the specific commit's changes without merging the entire `v2-sv` branch history. The conflicts were straightforward because both sides added non-overlapping features to the same file regions.

## Prevention

1. **Branch feature tracking** — Maintain a simple matrix of which features live on which branches. Before declaring a merge "complete," verify all expected features are present.
2. **Feature branch isolation** — Develop features on short-lived branches off the main integration branch (`v1-sv`), not on parallel long-lived branches (`v2-sv`).
3. **Post-merge feature checklist** — After any merge, verify key UI elements are present and functional. The existing doc on this pattern (see Related Issues) covers navigation entry points; this extends to in-component features.
4. **Git archaeology before assumptions** — When something "goes missing" after a merge, use `git log --all --oneline -- <file>` to trace which branches actually touched the file, rather than assuming the merge lost it.

## Related Issues

- See also: [post-merge-missing-navigation-entry-point.md](./post-merge-missing-navigation-entry-point.md) — Same merge (`52dbfe7`), different symptom: Segments sidebar navigation entry lost
- See also: [follow-up-actions-card-redesign.md](../design-patterns/follow-up-actions-card-redesign.md) — Design decisions for follow-up action rendering
