# Gemini CLI Subagent Skill

**Date:** 2026-02-18
**Status:** Brainstorm complete

## What We're Building

A generic Claude Code skill (`/gemini`) that invokes the Gemini CLI as a subagent. It takes a natural-language prompt, runs `gemini` in non-interactive mode with auto-edit permissions, and writes the response to a file.

**Primary use cases:**
- **Code review / analysis** — send code to Gemini for review, leveraging its large context window and different perspective
- **Research with web grounding** — use Gemini's Google Search grounding for fresh information, docs, or web research

## Why This Approach

**Simple Bash wrapper with JSON output.** We chose this over streaming or temp-file approaches because:

- Single-shot `gemini -p` is sufficient for code review and research tasks
- `--output-format json` gives structured, parseable responses
- Minimal complexity — easy to debug and extend
- Gemini reads files itself (auto-edit mode) rather than piping file contents

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scope | Generic primitive | Reusable across workflows, not locked to one task |
| Output handling | Write to file | Persistent artifact for later reference |
| Permissions | Auto-edit mode | Gemini can read/edit files but shell commands need approval |
| Context strategy | Let Gemini read files | Gemini has filesystem access, simpler than piping |
| Output format | JSON | Structured response, parseable for extraction |
| Model | Configurable, default to 2.5-pro | Best quality for review/research tasks |

## Design Sketch

### Invocation
```
/gemini Review src/lib/sql-generator.ts for security issues
/gemini Research best practices for DuckDB query optimization in 2026
/gemini -m gemini-2.5-flash Summarize the changes in the last 5 commits
```

### Skill Behavior
1. Parse the user's prompt (everything after `/gemini`)
2. Optionally extract `-m <model>` flag if present
3. Construct the Gemini CLI command:
   ```bash
   gemini -p "<prompt>" --approval-mode auto_edit --output-format json -m <model>
   ```
4. Run via Bash tool (with extended timeout for long tasks)
5. Parse JSON response, extract the `response` field
6. Write to `docs/gemini-output/<timestamp>-<slug>.md`
7. Summarize what was written back to the conversation

### Output File Structure
```
docs/gemini-output/
  2026-02-18-1045-security-review.md
  2026-02-18-1102-duckdb-optimization.md
```

### Error Handling
- If Gemini CLI is not installed, suggest installation command
- If API key is missing, point to env setup
- If command times out (>5 min), suggest using a simpler model or shorter prompt

## Open Questions

- Should there be a max timeout? Default Bash timeout is 2 min, Gemini tasks may need 5-10 min.
- Should we support `--sandbox` mode as a safety option?
- File naming: slug from prompt or sequential numbering?
