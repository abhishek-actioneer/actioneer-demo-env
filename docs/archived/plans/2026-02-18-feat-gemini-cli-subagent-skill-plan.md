---
title: "feat: Add Gemini CLI subagent skill"
type: feat
date: 2026-02-18
---

# feat: Add Gemini CLI subagent skill

## Overview

Create a Claude Code skill (`/gemini`) that invokes the Gemini CLI in non-interactive mode as a subagent. It takes a natural-language prompt, runs `gemini` with auto-edit permissions, and writes the response to a timestamped file. Primary use cases: code review/analysis and research with web grounding.

## Proposed Solution

A single `SKILL.md` file at `~/.claude/skills/gemini/SKILL.md` that instructs Claude Code to:

1. Parse the user's prompt and optional `-m <model>` flag
2. Run the Gemini CLI via Bash with a heredoc (avoids all shell escaping)
3. Parse the JSON response
4. Write the response to `docs/gemini-output/<timestamp>-<slug>.md`
5. Summarize back to the conversation

### Shell Escaping Strategy

**Use a heredoc** to pass the prompt — this completely avoids quoting issues with `"`, `'`, `` ` ``, `$`, `\`, and newlines:

```bash
gemini --output-format json --approval-mode auto_edit -m <model> -p "$(cat <<'PROMPT_EOF'
<user's raw prompt here, no escaping needed>
PROMPT_EOF
)"
```

The single-quoted heredoc delimiter (`'PROMPT_EOF'`) prevents all shell expansion inside the body.

## Technical Considerations

- **Timeout**: Use 300000ms (5 min). Gemini tasks can be long-running. The Bash tool supports up to 600000ms.
- **Default model**: `gemini-2.5-pro` — best quality for review/research. User can override with `-m`.
- **Approval mode**: `auto_edit` — Gemini can read/edit files but shell commands still need approval.
- **JSON output**: `--output-format json` returns `{ response, statistics, error }`. We extract `response`.
- **Directory creation**: `mkdir -p docs/gemini-output/` before writing (idempotent).
- **No concurrent invocation concerns**: Claude Code processes skills sequentially.

## Acceptance Criteria

- [x] Skill file exists at `~/.claude/skills/gemini/SKILL.md`
- [x] `/gemini <prompt>` runs Gemini CLI and writes response to file
- [x] `/gemini -m gemini-2.5-flash <prompt>` respects model override
- [x] Empty prompt returns helpful usage message
- [x] Missing Gemini CLI returns install instructions
- [x] Timeout returns helpful message suggesting lighter model
- [x] Output file contains response markdown with metadata header
- [x] Conversation summary shows file path and key stats

## Implementation Plan

### Phase 1: Create the skill file

**File: `~/.claude/skills/gemini/SKILL.md`**

#### Frontmatter

```yaml
---
name: gemini
version: 1.0.0
description: |
  Invoke the Gemini CLI as a subagent. Sends a prompt to Gemini in
  non-interactive mode and writes the response to a file.
  Use for code review, analysis, and research with web grounding.
allowed-tools:
  - Bash
  - Read
  - Write
  - Glob
---
```

#### Skill body — instructions for Claude Code

The markdown body should instruct Claude to:

1. **Parse input**
   - Extract everything after `/gemini` as the raw input
   - If input starts with `-m <model>`, extract model name; rest is prompt
   - If input is empty or whitespace-only, return usage: `Usage: /gemini [-m <model>] <prompt>`
   - Default model: `gemini-2.5-pro`

2. **Pre-flight checks**
   - Run `which gemini` to verify CLI is installed
   - If not found, return: `Gemini CLI not found. Install with: npm install -g @google/gemini-cli`

3. **Execute Gemini CLI**
   - Construct command using heredoc for safe prompt passing:
     ```bash
     gemini --output-format json --approval-mode auto_edit -m <model> -p "$(cat <<'PROMPT_EOF'
     <prompt>
     PROMPT_EOF
     )"
     ```
   - Use Bash tool with `timeout: 300000` (5 minutes)

4. **Parse response**
   - Parse stdout as JSON
   - If JSON has non-null `error` field → report error to user
   - If `response` field is empty → report "Empty response, try rephrasing"
   - Extract `response` (markdown string) and `statistics` (metadata)

5. **Write output file**
   - Create directory: `mkdir -p docs/gemini-output/`
   - Generate filename: `YYYY-MM-DD-HHMM-<slug>.md`
     - Slug: first 5 words of prompt, lowercased, non-alphanumeric → hyphens, collapse consecutive hyphens, max 50 chars
   - File content format:
     ```markdown
     <!-- gemini-cli | model: <model> | <timestamp> -->

     <response content>
     ```
   - Write via Write tool

6. **Summarize to conversation**
   - Report: file path, model used, execution time (from statistics if available)
   - Brief 1-2 sentence summary of what Gemini found/said

7. **Error handling**
   - CLI not installed → install instructions
   - Timeout → suggest `-m gemini-2.5-flash` or shorter prompt
   - JSON parse failure → show raw output for debugging
   - API key missing → check for "authentication" or "API key" in stderr, suggest setting `GEMINI_API_KEY`
   - Rate limiting → check for "429" or "rate", suggest waiting

### Phase 2: Test manually

After creating the skill file, test these scenarios:

1. `/gemini What is 2 + 2` — basic smoke test
2. `/gemini -m gemini-2.5-flash Summarize this README` — model override
3. `/gemini` — empty prompt error
4. `/gemini Review src/lib/sql-generator.ts for security issues` — real code review

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Escaping strategy | Heredoc with `'PROMPT_EOF'` | Eliminates all shell escaping issues — quotes, backticks, `$`, `\` all pass through safely |
| Flag parsing | `-m` only, must be first | KISS — one flag, predictable position, easy to parse |
| Timeout | Fixed 5 min | Sufficient for most tasks; no flag complexity |
| Slug generation | First 5 words, 50 char max | Human-readable, short, safe |
| File metadata | HTML comment header only | Non-intrusive; doesn't pollute the markdown response |
| Statistics | Omitted from file | Keep file clean; stats shown in conversation summary |
| Empty response | Don't write file | No empty artifacts cluttering the output directory |

## References

- Brainstorm: `docs/brainstorms/2026-02-18-gemini-cli-subagent-skill-brainstorm.md`
- Existing skill reference: `~/.claude/skills/humanizer/SKILL.md`
- Gemini CLI docs: https://google-gemini.github.io/gemini-cli/docs/cli/headless.html
- Gemini CLI flags: `-p` (prompt), `--output-format json`, `--approval-mode auto_edit`, `-m` (model)
