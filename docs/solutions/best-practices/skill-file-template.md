---
title: Claude Code Skill File Template
type: reference
date: 2026-02-18
context: Developer workflow and tooling
---

# Claude Code Skill File Template

A minimal working template for creating Claude Code skills, based on the `humanizer` skill and Gemini CLI design.

## Directory Structure

```
~/.claude/skills/<skill-name>/
  SKILL.md          ← Main skill file (required; frontmatter + instructions)
  README.md         ← User guide (optional; for complex skills)
  WARP.md           ← Implementation notes (optional; internal reference)
```

## SKILL.md Template

```yaml
---
name: <skill-name-lowercase>
version: 1.0.0
description: |
  One-line summary of what the skill does.

  Can be multi-line for more complex skills.
  Use YAML pipe (|) to preserve line breaks.
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - AskUserQuestion
  - Bash
---

# <Skill Name>: <Tagline>

Your one-sentence orientation.

## Your Task

What the user should do when invoking this skill. List concrete steps:

1. **First step** — What you'll do
2. **Second step** — What happens next
3. **Final step** — What the user gets

---

## Process

The algorithm or step-by-step process the skill follows:

1. Parse input
2. Validate preconditions
3. Perform main work
4. Format output
5. Return result

---

## Examples

### Example 1

**Input:**
```
Your input here
```

**Output:**
```
Expected output here
```

### Example 2

**Input:**
```
Another example
```

**Output:**
```
Different output
```

---

## Error Handling

How the skill handles common failure modes:

- **Missing required tool** — Explain how to install/configure
- **Invalid input** — What formats are accepted
- **Timeout** — How long operations may take, what to do if exceeded

---

## Reference

- [Wikipedia: Signs of AI writing](https://example.com) (if applicable)
- Related skills or documentation
```

## CLI Invocation Skill Template

For skills that invoke external tools like Gemini CLI:

```yaml
---
name: <tool-name>
version: 1.0.0
description: |
  Invoke <tool-name> CLI as a subagent for <primary-task>.
  Use for: code review, research, analysis, etc.
allowed-tools:
  - Bash
  - Read
  - Write
  - Grep
---

# <Tool Name> Subagent

Invoke the <tool-name> CLI to delegate analysis tasks to a specialized AI model.

## Your Task

When you need help with code review, research, or similar tasks:

1. **Formulate your request** — "Review src/lib/X.ts for security issues"
2. **Invoke the skill** — `/tool-name <your-request>`
3. **Receive analysis** — Results are saved to `docs/tool-name-output/<timestamp>-<slug>.md`
4. **Review and act** — The skill summarizes key findings back in the conversation

---

## Invocation Syntax

```
/<tool-name> <prompt>
/<tool-name> -m <model> <prompt>
/<tool-name> -t 600 <prompt>  (if timeout is configurable)
```

### Examples

```
/tool-name Review src/lib/sql-generator.ts for security issues
/tool-name -m gpt-4 Summarize best practices for DuckDB query optimization
/tool-name Research recent changes to TypeScript v5
```

---

## How It Works

1. **Parse input** — Extract optional flags (`-m <model>`, `-t <timeout>`, etc.)
2. **Construct command** — Build the CLI invocation with proper escaping
3. **Run via Bash** — Execute with timeout (default 5 minutes for external APIs)
4. **Parse output** — Extract the `response` field from JSON (if applicable)
5. **Write artifact** — Save to `docs/<tool-name>-output/<timestamp>-<slug>.md`
6. **Summarize** — Report key findings back to the conversation

---

## Configuration

### Required

- `<TOOL>_API_KEY` environment variable (if the tool requires authentication)

### Optional

- `-m <model>` — Specify model (defaults to recommended choice)
- `-t <timeout>` — Timeout in seconds (defaults to 300 = 5 minutes)

---

## Output Locations

Results are written to the project's documentation structure:

```
docs/<tool-name>-output/
  2026-02-18-1045-security-review.md
  2026-02-18-1102-optimization-research.md
```

File naming: `YYYY-MM-DD-HHMM-<slug>.md`

---

## Error Handling

| Error | Solution |
|-------|----------|
| Tool not installed | `brew install <tool>` or download from [website] |
| API key missing | Set `export TOOL_API_KEY=...` |
| Command timeout (>5 min) | Try a simpler prompt or use `-m lighter-model` |
| JSON parse error | Check the tool's output format with `<tool> --help` |

---

## Limitations

- Single-shot execution (not streaming)
- Output limited to tool's response size
- Requires active internet connection (if tool uses API)
- No interactive follow-up (use the output file to drill deeper)

---

## See Also

- Baby-Sentinel brainstorm: `docs/brainstorms/2026-02-18-gemini-cli-subagent-skill-brainstorm.md`
- Project CLAUDE.md: Architecture and conventions
```

## Minimalist Template (Text-Processing Skill)

For non-CLI skills:

```yaml
---
name: <skill-name>
version: 1.0.0
description: |
  Brief description of what the skill does.
allowed-tools:
  - Read
  - Write
  - Edit
---

# <Skill Name>

## Your Task

1. Input: [describe what you pass in]
2. Process: [how the skill works]
3. Output: [what you get back]

---

## Examples

**Input:** Example input text

**Output:** Example output

---

## Reference

Links to source material or related documentation.
```

---

## Checklist for New Skills

Before creating a skill:

- [ ] **Scope is clear** — Single, reusable responsibility (not task-specific)
- [ ] **Name is descriptive** — Lowercase, matches directory name
- [ ] **Frontmatter is complete** — name, version, description, allowed-tools
- [ ] **"Your Task" section orients users** — What to pass in, what they get back
- [ ] **Examples provided** — At least 1-2 before/after or input/output pairs
- [ ] **Error handling documented** — What to do if something breaks
- [ ] **Tools are minimal** — Only include tools actually used
- [ ] **Skill is self-contained** — Everything needed is in SKILL.md

---

## Installation Instructions (User Docs)

For your skill's README.md:

```markdown
# <Skill Name>

[One-line description]

## Installation

```bash
mkdir -p ~/.claude/skills/<skill-name>
cp SKILL.md ~/.claude/skills/<skill-name>/
```

## Usage

In Claude Code, invoke:

```
/<skill-name>

[your input]
```

Or ask Claude directly:

```
Please use the <skill-name> skill to: [your request]
```
```

---

## Key Differences from CLAUDE.md Instructions

This template is for **creating skills** (documents Claude Code will invoke), NOT for your project's main CLAUDE.md (which guides work within a repo).

- **Skill CLAUDE.md:** Instruction document in `~/.claude/skills/<name>/`
- **Project CLAUDE.md:** Guidance file checked into the repo (`<repo>/CLAUDE.md`)

Skills are **reusable across projects.** Project CLAUDE.md is **project-specific.**
