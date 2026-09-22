---
title: Claude Code Skill Creation Patterns
type: research
date: 2026-02-18
context: Architecture and developer workflow
---

# Claude Code Skill Creation Patterns

Research on creating Claude Code skills that invoke external CLI tools (e.g., Gemini CLI) as subagents.

## Skill File Structure & Format

### SKILL.md Frontmatter

All skills use YAML frontmatter at the top of the file:

```yaml
---
name: <skill-name>
version: <semantic-version>
description: |
  Multi-line description of what the skill does.
  Use for README-level clarity.
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - AskUserQuestion
  - Bash
---
```

**Key observations:**
- `name` field: lowercase, matches directory name under `~/.claude/skills/`
- `version` field: semantic versioning (e.g., `2.1.0`)
- `allowed-tools` array: declares which MCP tools the skill is permitted to use
- For CLI invocation skills: `Bash` MUST be in `allowed-tools`
- Description uses YAML pipe (`|`) for multi-line text

**Example from `humanizer/SKILL.md`:**
```yaml
---
name: humanizer
version: 2.1.0
description: |
  Remove signs of AI-generated writing from text. Use when editing or reviewing
  text to make it sound more natural and human-written...
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - AskUserQuestion
---
```

### Content Structure

After frontmatter, structure the skill document as:

1. **Title** (single `#` heading)
2. **Your Task** section (what the skill does from user perspective)
3. **Core Sections** (patterns, algorithms, process steps)
4. **Output Format** (what the user gets back)
5. **Examples** (before/after or concrete usage)
6. **Reference** (links to sources, related patterns)

**Example from `humanizer/SKILL.md`:**
```markdown
# Humanizer: Remove AI Writing Patterns

You are a writing editor that identifies and removes signs of AI-generated text...

## Your Task

When given text to humanize:
1. **Identify AI patterns** - Scan for the patterns listed below
2. **Rewrite problematic sections** - Replace AI-isms with natural alternatives
...

## CONTENT PATTERNS

### 1. Undue Emphasis on Significance...

**Words to watch:** stands/serves as, is a testament/reminder...
**Problem:** LLM writing puffs up importance...
**Before:** ...
**After:** ...

## Process

1. Read the input text carefully
2. Identify all instances of the patterns above
...

## Output Format

Provide:
1. The rewritten text
2. A brief summary of changes made (optional, if helpful)
```

### Skill Installation & Discovery

Skills are installed in `~/.claude/skills/<skill-name>/SKILL.md`. Related files (README.md, WARP.md) are optional:

```
~/.claude/skills/
  humanizer/
    SKILL.md          (required; contains frontmatter + instructions)
    README.md         (optional; user-facing guide)
    WARP.md           (optional; implementation notes)
```

**Invocation in Claude Code:**
```
/humanizer

[user input here]
```

---

## CLI Invocation Patterns

### Design from `2026-02-18-gemini-cli-subagent-skill-brainstorm.md`

The baby-sentinel project has brainstormed a `/gemini` skill for invoking the Gemini CLI as a subagent. Key design decisions:

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scope | Generic primitive | Reusable across workflows, not locked to one task |
| Output handling | Write to file | Persistent artifact for later reference |
| Permissions | Auto-edit mode | Gemini can read/edit files but shell commands need approval |
| Context strategy | Let Gemini read files | Gemini has filesystem access, simpler than piping |
| Output format | JSON | Structured response, parseable for extraction |
| Model | Configurable, default to 2.5-pro | Best quality for review/research tasks |

### Invocation Syntax

```
/gemini Review src/lib/sql-generator.ts for security issues
/gemini Research best practices for DuckDB query optimization in 2026
/gemini -m gemini-2.5-flash Summarize the changes in the last 5 commits
```

### Execution Flow

1. Parse the user's prompt (everything after `/gemini`)
2. Optionally extract `-m <model>` flag if present
3. Construct the Gemini CLI command:
   ```bash
   gemini -p "<prompt>" --approval-mode auto_edit --output-format json -m <model>
   ```
4. Run via **Bash tool** (with extended timeout for long tasks)
5. Parse JSON response, extract the `response` field
6. Write to `docs/gemini-output/<timestamp>-<slug>.md`
7. Summarize what was written back to the conversation

### Output File Naming Convention

Files are written to the `docs/` directory following the project's output pattern:

```
docs/gemini-output/
  2026-02-18-1045-security-review.md
  2026-02-18-1102-duckdb-optimization.md
```

**Format:** `YYYY-MM-DD-HHMM-<slug>.md` where slug is derived from prompt keywords

### Error Handling

The skill must handle these cases gracefully:

- **Gemini CLI not installed** — Suggest installation command
- **API key missing** — Point to env setup (e.g., `GEMINI_API_KEY`)
- **Command timeout** — Default Bash timeout is 2 min, but Gemini tasks may need 5-10 min. Suggest using a simpler model or shorter prompt
- **JSON parse failure** — Gracefully handle malformed responses

---

## Baby-Sentinel Project Conventions

### Doc Output Structure

The project stores specialized documentation in a hierarchical structure:

```
docs/
  brainstorms/          # Exploratory, open-ended research
  plans/                # Feature/refactor plans with execution details
  reviews/              # Post-mortem analyses of issues
  solutions/
    best-practices/     # Reusable patterns and recommendations
    design-patterns/    # Architecture decisions
    integration-issues/ # Problem-specific solutions
    logic-errors/       # Bug fixes and root-cause analyses
```

**File naming:** `YYYY-MM-DD-<descriptor>.md` (with type suffix for plans/reviews)

Example:
- `docs/plans/2026-02-18-refactor-codebase-style-consistency-plan.md`
- `docs/solutions/best-practices/three-zone-pointer-events-canvas-card-system-20260218.md`

### Frontmatter Standard

Plan/review files use YAML frontmatter:

```yaml
---
title: "Feature or Refactor Name"
type: feat | refactor | fix | research
date: YYYY-MM-DD
---
```

### Bash Tool Patterns in Baby-Sentinel

The codebase does NOT currently use CLI invocations from within Next.js routes (server-side). The project uses:

- **Server-side:** Gemini API (@google/genai SDK), DuckDB (node-api), Markdown rendering (custom parser)
- **Client-side:** Standard fetch to Next.js API routes

**No shell commands are run from within the app itself.** This makes the Gemini CLI skill a Claude Code automation tool (not part of the app).

---

## Skill Design Principles

Based on the humanizer skill and the proposed gemini skill:

### 1. Scope & Reusability

Skills should be **generic primitives** rather than task-specific. Examples:

- `humanizer` — Reusable for any text editing, not just one doc type
- `/gemini` — Reusable for code review, research, summarization, etc.

**Anti-pattern:** A skill that only works for "review my baby-sentinel PR" is too narrow.

### 2. Minimal Complexity

Prefer simplicity over comprehensive feature sets:

- Single-shot execution (not streaming) for CLI skills
- Structured output (JSON) over unstructured text
- Delegated file reading (Gemini CLI can read files directly rather than piping)
- Let the external tool handle UI/interaction

### 3. Explicit Tool Declarations

The `allowed-tools` list in frontmatter serves as the contract. Including only necessary tools:

- **For text editing:** `Read`, `Write`, `Edit`, `Grep`, `Glob`, `AskUserQuestion`
- **For CLI invocation:** Add `Bash` to the list above
- **Do NOT include:** Tools not actually used (keeps the skill's scope clear)

### 4. Error Messages & Fallbacks

Provide actionable error messages:

- If a required tool (e.g., Gemini CLI) is missing, suggest the installation command
- If an API key is missing, point to documentation
- If a timeout occurs, suggest alternative approaches (simpler model, shorter prompt)

### 5. Documentation Structure

Skills should be fully self-contained in SKILL.md:

- Title and "Your Task" section orient the user
- Pattern descriptions (or step-by-step process) explain how the skill works
- Examples demonstrate expected input/output
- References link to source materials or related patterns

---

## Implementation Checklist for External CLI Skills

When creating a skill that invokes an external CLI tool:

1. **Frontmatter**
   - [ ] `name` field (lowercase, matches directory)
   - [ ] `version` field (semantic versioning)
   - [ ] `description` (multi-line YAML pipe)
   - [ ] `allowed-tools` includes `Bash`

2. **User-Facing Documentation**
   - [ ] "Your Task" section explains what the skill does
   - [ ] Invocation examples (with optional flags like `-m <model>`)
   - [ ] Expected output format described

3. **Execution Logic**
   - [ ] Parse user input and optional flags
   - [ ] Construct CLI command with proper escaping
   - [ ] Handle stdout/stderr from Bash tool
   - [ ] Parse structured output (JSON) if applicable
   - [ ] Write results to persistent location (docs/ subdirectory)

4. **Error Handling**
   - [ ] Tool not installed — suggest installation
   - [ ] Missing credentials — point to env setup
   - [ ] Timeout — suggest mitigation
   - [ ] Parse failures — graceful fallback

5. **Testing Guidance** (in skill doc or README)
   - [ ] Example prompt that works offline (no API key needed)
   - [ ] Example prompt that exercises main code path
   - [ ] Common failure modes and how to recover

---

## Bash Tool Patterns for CLI Invocation

### Timeout Configuration

The Bash tool supports optional `timeout` parameter (milliseconds, max 600000 = 10 minutes):

```typescript
await Bash({
  command: "gemini -p 'Review this code' --output-format json -m gemini-2.5-pro",
  timeout: 300000,  // 5 minutes for Gemini tasks (vs default 2 minutes)
  description: "Invoke Gemini CLI for code review"
});
```

The brainstorm document notes: **Default timeout is 2 min, but Gemini tasks may need 5-10 min.** Always set an explicit timeout for external CLI calls.

### Command Escaping

When passing user input to a shell command, **always use single quotes** or proper escaping:

```bash
# BAD (vulnerable to injection)
gemini -p "Review $userPrompt"

# GOOD (quoted)
gemini -p "Review this file: src/lib/sql-generator.ts"

# If prompt contains quotes, escape them
gemini -p "Review \"critical\" sections"
```

### Structured Output

Prefer CLI tools with `--output-format json` or similar:

```bash
gemini -p "..." --output-format json | jq '.response'
```

This allows:
- Reliable parsing of results
- Separation of metadata from content
- Error detection (check for `error` field)

### File Output

Skills should write results to the project's docs directory:

```typescript
const timestamp = new Date().toISOString().slice(0, 16).replace('T', '-');
const slug = userPrompt.slice(0, 50).toLowerCase().replace(/\s+/g, '-');
const filename = `docs/gemini-output/${timestamp}-${slug}.md`;
// Write response to filename
```

---

## Project-Specific Guidance

### Baby-Sentinel Output Locations

When a skill writes output, follow the project structure:

```
docs/
  brainstorms/          # Exploratory research
  plans/                # Implementation plans
  solutions/
    best-practices/     # General patterns
    design-patterns/    # Architectural decisions
```

For a new `/gemini` skill, create:
```
docs/gemini-output/   # Output from Gemini CLI invocations
```

### Recommended Skill Patterns for Baby-Sentinel

Based on the codebase and brainstorms, these skills would be valuable:

1. **`/gemini`** — Code review, research, analysis (primary use case)
2. **`/analyze <file>`** — Prompt for SQL query analysis (wrapped around existing analyzer)
3. **`/lint-check`** — Run project linting and format checks (Bash wrapper)

---

## References

### Project Files

- **Brainstorm:** `/Users/sashank/Documents/glitchcraft/repositories/baby-sentinel/docs/brainstorms/2026-02-18-gemini-cli-subagent-skill-brainstorm.md`
- **Refactor plan (streaming patterns):** `/Users/sashank/Documents/glitchcraft/repositories/baby-sentinel/docs/plans/2026-02-18-refactor-codebase-style-consistency-plan.md`

### External Skill References

- **Humanizer skill:** `/Users/sashank/.claude/skills/humanizer/SKILL.md`
- **Humanizer README:** `/Users/sashank/.claude/skills/humanizer/README.md`

### Claude Global Instructions

- **CLAUDE.md (global):** `/Users/sashank/.claude/CLAUDE.md` — Skill Pre-Flight Protocol
- **CLAUDE.md (baby-sentinel):** `/Users/sashank/Documents/glitchcraft/repositories/baby-sentinel/CLAUDE.md` — Project architecture

---

## Summary

**Skill files are YAML frontmatter + Markdown instruction documents.** The humanizer skill is the primary reference for structure. The Gemini CLI brainstorm provides the concrete design for external tool invocation.

Key points for a new CLI-invoking skill:

1. Use `allowed-tools: [Bash]` in frontmatter
2. Parse user input and optional flags (e.g., `-m <model>`)
3. Construct CLI command with proper escaping
4. Run via Bash tool with explicit timeout (5-10 min for external API calls)
5. Parse structured output (JSON) and write to persistent location (docs/ subdirectory)
6. Provide clear error messages for common failure modes
7. Document invocation syntax with examples in the skill file itself
