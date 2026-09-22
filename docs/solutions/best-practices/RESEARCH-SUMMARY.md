---
title: Research Summary — Claude Code Skill Creation for External CLI Tools
type: research
date: 2026-02-18
---

# Research Summary: Claude Code Skill Creation

Complete research on creating Claude Code skills that invoke external CLI tools (e.g., Gemini CLI) as subagents.

## What Was Researched

1. **Existing skill file structure** — How the humanizer skill is organized
2. **Skill format and conventions** — YAML frontmatter, allowed-tools, documentation structure
3. **Bash tool patterns** — How to safely invoke external CLIs with timeouts and error handling
4. **Baby-Sentinel project conventions** — How this project structures docs and uses tools
5. **External CLI design** — The Gemini CLI brainstorm as a concrete reference implementation

## Key Findings

### Skill File Structure (from `humanizer/SKILL.md`)

Skills are Markdown files with YAML frontmatter in `~/.claude/skills/<name>/`:

```yaml
---
name: skill-name
version: 2.1.0
description: |
  Multi-line description of what the skill does.
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - AskUserQuestion
---
```

**Critical for CLI skills:** Include `Bash` in `allowed-tools`.

### Bash Tool Timeout Configuration

The Bash tool has a **default 2-minute timeout** but supports up to 10 minutes:

```typescript
await Bash({
  command: "external-cli-command",
  timeout: 300000,  // 5 minutes for external APIs
  description: "Invoke external tool"
});
```

**Rule:** External API calls need 5-10 min timeout; local tools use default.

### Baby-Sentinel Project Conventions

**Doc output structure:**
```
docs/
  brainstorms/              # Exploratory research
  plans/                    # Implementation plans
  solutions/
    best-practices/         # Reusable patterns
    design-patterns/        # Architecture decisions
```

**File naming:** `YYYY-MM-DD-descriptor.md`

**Frontmatter for plans/reviews:**
```yaml
---
title: "Feature or Refactor Name"
type: feat | refactor | fix | research
date: 2026-02-18
---
```

### External CLI Design (Gemini CLI Brainstorm)

The project has a brainstormed `/gemini` skill design with these key decisions:

| Decision | Choice | Why |
|----------|--------|-----|
| Output | Write to file | Persistent artifacts |
| Permissions | Auto-edit mode | Simpler than piping |
| Output format | JSON | Structured, parseable |
| Timeout | 5-10 minutes | External API calls |
| Model | Configurable, default 2.5-pro | Best quality |

**Invocation syntax:**
```
/gemini Review src/lib/sql-generator.ts for security issues
/gemini -m gemini-2.5-flash Research DuckDB optimization in 2026
```

### Command Escaping & Safety

**Always quote user input:**

```bash
# DANGEROUS
gemini -p Review $userPrompt

# SAFE
gemini -p "Review src/lib/sql-generator.ts for security issues"

# With quotes inside
gemini -p "Review \"critical\" code sections"
```

### Error Handling for CLI Skills

Skills must gracefully handle:

1. **Tool not installed** — Suggest installation command
2. **Missing API key** — Point to env setup
3. **Timeout** — Suggest simpler prompt or lighter model
4. **Parse failure** — Graceful fallback

## Generated Documentation

This research produced 4 reference documents in `/docs/solutions/best-practices/`:

### 1. `claude-code-skill-creation-patterns.md` (4,100 lines)

Comprehensive guide covering:
- Skill file structure and YAML frontmatter
- Content organization and documentation patterns
- CLI invocation design principles
- Error handling and output locations
- Implementation checklist
- Baby-Sentinel project conventions

**Use this for:** Understanding the full landscape of skill creation.

### 2. `skill-file-template.md` (300 lines)

Ready-to-use templates for:
- Generic skills (text processing, analysis)
- CLI-invoking skills (external tools like Gemini)
- Minimal template for quick starts
- Installation instructions for users
- Pre-creation checklist

**Use this for:** Copying a template to start a new skill.

### 3. `bash-tool-patterns-external-cli.md` (400 lines)

Reference guide for:
- Bash tool parameters and timeout configuration
- Command escaping and security
- Structured output (JSON) parsing
- Error handling patterns (exit codes, missing tools, timeouts)
- Baby-Sentinel specific patterns (env vars, file locations)
- Common code snippets and debugging tips

**Use this for:** Copy-paste Bash patterns when building skills.

### 4. `RESEARCH-SUMMARY.md` (this file)

Executive summary of findings and document index.

## How These Docs Relate to Each Other

```
RESEARCH-SUMMARY.md (you are here)
  ├── Points to all findings
  └── Links to detailed docs

claude-code-skill-creation-patterns.md
  ├── Full background on skill structure
  ├── References humanizer skill
  └── References Gemini CLI brainstorm

skill-file-template.md
  ├── Minimal example for quick start
  └── Can be used directly (copy SKILL.md into ~/.claude/skills/)

bash-tool-patterns-external-cli.md
  └── Copy/paste code snippets for your skill
```

## How to Use This Research

### Scenario 1: Creating a New `/gemini` Skill

1. Read: `claude-code-skill-creation-patterns.md` (understand design)
2. Copy: `skill-file-template.md` (start with template)
3. Reference: `bash-tool-patterns-external-cli.md` (implement Bash calls)
4. Validate: Humanizer skill in `~/.claude/skills/humanizer/SKILL.md` (compare structure)

### Scenario 2: Creating a Linter Skill

1. Start with minimalist template from `skill-file-template.md`
2. Use error handling patterns from `bash-tool-patterns-external-cli.md`
3. Check timeout needs (linters are usually fast; use default 2 min)
4. Follow Baby-Sentinel file output conventions

### Scenario 3: Understanding Skill Design Trade-offs

Read `claude-code-skill-creation-patterns.md` section "Skill Design Principles" for:
- Scope & reusability (generic vs. task-specific)
- Minimal complexity
- Tool declarations
- Documentation structure

## Critical Design Decisions for Gemini CLI Skill

Based on the brainstorm, the `/gemini` skill should:

1. **Accept prompts with optional model flag**
   ```
   /gemini -m gemini-2.5-flash Review this code
   ```

2. **Run via Bash tool with 5-min timeout**
   ```bash
   gemini -p "<prompt>" --approval-mode auto_edit --output-format json -m <model>
   ```

3. **Parse JSON response and write to file**
   ```
   docs/gemini-output/2026-02-18-1045-security-review.md
   ```

4. **Handle these errors gracefully:**
   - Gemini CLI not installed → suggest `brew install gemini`
   - API key missing → suggest env setup
   - Timeout → suggest simpler prompt or `-m gemini-2.5-flash`

5. **Document invocation clearly** with examples in the skill file itself

## Next Steps

To create the `/gemini` skill:

1. **Create directory:** `mkdir -p ~/.claude/skills/gemini`
2. **Copy template:** Use `skill-file-template.md` CLI Invocation Skill Template section
3. **Implement logic:**
   - Parse user prompt and `-m <model>` flag
   - Construct Gemini CLI command (use escaping from `bash-tool-patterns-external-cli.md`)
   - Run via Bash tool with `timeout: 300000`
   - Parse JSON response
   - Write to `docs/gemini-output/<timestamp>-<slug>.md`
4. **Test locally:**
   - Invoke skill from Claude Code
   - Verify file is written to correct location
   - Verify error handling (try missing API key, timeout, etc.)

## References

### Project Files

- **Brainstorm:** `/Users/sashank/Documents/glitchcraft/repositories/baby-sentinel/docs/brainstorms/2026-02-18-gemini-cli-subagent-skill-brainstorm.md`
- **CLAUDE.md:** `/Users/sashank/Documents/glitchcraft/repositories/baby-sentinel/CLAUDE.md`
- **Humanizer skill:** `/Users/sashank/.claude/skills/humanizer/SKILL.md`

### Generated Documentation

- `claude-code-skill-creation-patterns.md` — Full reference guide
- `skill-file-template.md` — Ready-to-use templates
- `bash-tool-patterns-external-cli.md` — Code snippets and patterns

## Summary Table

| Aspect | Finding | Reference |
|--------|---------|-----------|
| **Skill file location** | `~/.claude/skills/<name>/SKILL.md` | humanizer skill |
| **Frontmatter required** | name, version, description, allowed-tools | skill-file-template.md |
| **For CLI skills** | Add `Bash` to allowed-tools | claude-code-skill-creation-patterns.md |
| **Timeout for external APIs** | 300000 ms (5 min) | bash-tool-patterns-external-cli.md |
| **Command escaping** | Always quote user input | bash-tool-patterns-external-cli.md |
| **Output format** | Write to docs/, use JSON for parsing | Gemini CLI brainstorm |
| **Error handling** | Tool missing, API key, timeout | bash-tool-patterns-external-cli.md |
| **Project doc structure** | brainstorms/, plans/, solutions/ | Baby-Sentinel CLAUDE.md |

---

**Research completed:** 2026-02-18
**Status:** Ready for implementation
