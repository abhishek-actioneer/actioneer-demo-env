---
title: Claude Code Skills — Documentation Index
type: reference
date: 2026-02-18
---

# Claude Code Skills — Documentation Index

Quick navigation for all research and templates related to creating Claude Code skills that invoke external CLI tools.

## Quick Start (2 min)

**Goal:** Create a `/gemini` skill to invoke Gemini CLI

1. Start here: **[RESEARCH-SUMMARY.md](./RESEARCH-SUMMARY.md)** — Understand what's in each document
2. Copy template: **[skill-file-template.md](./skill-file-template.md)** → `~/.claude/skills/gemini/SKILL.md`
3. Implement Bash calls: **[bash-tool-patterns-external-cli.md](./bash-tool-patterns-external-cli.md)** → Copy error handling patterns
4. Reference design: **[Gemini CLI Brainstorm](../../../brainstorms/2026-02-18-gemini-cli-subagent-skill-brainstorm.md)** → Key decisions and output locations

## Document Reference

### 1. RESEARCH-SUMMARY.md (This Research)
**What:** Executive summary of all findings
**Length:** ~2 min read
**Best for:**
- First time here? Start here
- Need a quick overview?
- Want to understand how all docs relate?

**Key sections:**
- What was researched
- Key findings
- How to use this research
- Next steps for creating `/gemini` skill

---

### 2. claude-code-skill-creation-patterns.md (Full Reference)
**What:** Comprehensive guide to skill structure and design
**Length:** ~15 min read
**Best for:**
- Understanding skill file format deeply
- Learning design principles (scope, reusability, complexity)
- Understanding error handling strategy
- Understanding Baby-Sentinel conventions

**Key sections:**
- Skill file structure & format (YAML frontmatter, content organization)
- CLI invocation patterns (execution flow, output file naming, error handling)
- Baby-Sentinel project conventions (doc structure, output locations)
- Skill design principles (scope, reusability, minimal complexity)
- Implementation checklist for external CLI skills
- Bash tool patterns for CLI invocation
- Project-specific guidance

**Copy-paste from this doc:**
- Frontmatter template
- Error handling checklist
- Timeout configuration guidance
- Escaping examples

---

### 3. skill-file-template.md (Templates)
**What:** Ready-to-use SKILL.md templates
**Length:** ~5 min read
**Best for:**
- Starting a new skill (copy SKILL.md template)
- Understanding minimal viable skill
- Quick reference for what sections to include

**Key sections:**
- Standard Markdown skill template
- CLI invocation skill template (what you need for `/gemini`)
- Minimalist template (for simpler skills)
- Installation instructions for users
- Pre-creation checklist

**How to use:**
```bash
# Copy CLI invocation template into ~/.claude/skills/gemini/SKILL.md
# Replace <tool-name> with "gemini"
# Implement the CLI invocation logic
```

---

### 4. bash-tool-patterns-external-cli.md (Code Snippets)
**What:** Practical Bash tool patterns and code examples
**Length:** ~10 min read (reference style)
**Best for:**
- Copy-pasting Bash command patterns
- Understanding timeout configuration
- Learning error handling (tool not installed, API key missing, timeout)
- Understanding command escaping and safety

**Key sections:**
- Bash tool basics (parameters, timeout defaults)
- Timeout configuration (2 min default, 5-10 min for external APIs)
- Command escaping & safety (quoting, special characters)
- Structured output (JSON parsing)
- Error handling patterns (exit codes, missing tools, timeouts)
- Baby-Sentinel specific patterns (env vars, file locations)
- Common patterns (invoke with timeout, check installation, write results)
- Debugging tips

**Copy-paste ready:**
- Timeout configuration template
- Error checking patterns
- JSON parsing example
- File writing pattern
- Tool installation check

---

## Navigation by Task

### "I'm creating the `/gemini` skill"

1. Read: **RESEARCH-SUMMARY.md** (understand the design)
2. Copy: **skill-file-template.md** → CLI Invocation Skill Template
3. Code: **bash-tool-patterns-external-cli.md** → Copy patterns for:
   - Timeout configuration
   - Error handling
   - JSON output parsing
   - File writing
4. Reference: **Gemini CLI Brainstorm** → Key design decisions and output locations

### "I'm creating a different CLI skill (linter, formatter, etc.)"

1. Skim: **RESEARCH-SUMMARY.md** (understand principles)
2. Adapt: **skill-file-template.md** → Minimalist template
3. Implement: **bash-tool-patterns-external-cli.md** → Error handling patterns
4. Check: **claude-code-skill-creation-patterns.md** → Design principles section

### "I want to understand skill file structure deeply"

1. Read: **claude-code-skill-creation-patterns.md** → Skill File Structure & Format section
2. Compare: **humanizer skill** at `~/.claude/skills/humanizer/SKILL.md`
3. Reference: **skill-file-template.md** → Anatomy of each section

### "I need to handle errors in my Bash calls"

1. Go to: **bash-tool-patterns-external-cli.md** → Error Handling Patterns section
2. Copy: Pattern that matches your scenario:
   - Tool not installed → Pattern: "Check Tool Installation"
   - Missing credentials → Pattern: "Tool Not Installed" (adapt for API key)
   - Timeout → Pattern: "Timeout Handling"
   - Parse failure → Pattern: "Checking Exit Code"

### "I need to understand timeout configuration"

1. Go to: **bash-tool-patterns-external-cli.md** → Timeout Configuration section
2. Key facts:
   - Default: 2 minutes (120000 ms)
   - External APIs: 5-10 minutes (300000-600000 ms)
   - Max: 10 minutes (600000 ms)
3. See: "Rule of thumb" for decision-making

---

## Key Concepts Quick Reference

### Skill File Location
```
~/.claude/skills/<skill-name>/
  SKILL.md          (required)
  README.md         (optional)
```

### YAML Frontmatter (Required)
```yaml
---
name: <lowercase-name>
version: 1.0.0
description: |
  Multi-line description.
allowed-tools:
  - Bash              ← Required for CLI skills
  - Read
  - Write
  - Grep
---
```

### Bash Timeout (For External APIs)
```typescript
await Bash({
  command: "gemini -p '...' --output-format json",
  timeout: 300000,  // 5 minutes for external APIs
  description: "Invoke Gemini CLI"
});
```

### Command Escaping (Security)
```bash
# BAD (injection vulnerability)
gemini -p Review $userPrompt

# GOOD (quoted)
gemini -p "Review src/lib/sql-generator.ts"
```

### Error Handling (Pattern)
```typescript
if (result.stderr.includes("command not found")) {
  return "Gemini CLI not installed. Install with: brew install gemini";
}
if (result.stderr.includes("API key")) {
  return "GEMINI_API_KEY not set";
}
```

### Output File Location
```
docs/gemini-output/
  2026-02-18-1045-security-review.md
  2026-02-18-1102-optimization-research.md
```
Format: `YYYY-MM-DD-HHMM-<slug>.md`

---

## Related Project Files

### Brainstorms
- **Gemini CLI Subagent Skill:** `docs/brainstorms/2026-02-18-gemini-cli-subagent-skill-brainstorm.md`

### Project Documentation
- **CLAUDE.md:** `/CLAUDE.md` (project conventions and architecture)

### Reference Skill
- **Humanizer:** `~/.claude/skills/humanizer/SKILL.md` (example of completed skill)

---

## Checklist: Before Creating a Skill

- [ ] **Understand scope** — Reusable across projects, not task-specific
- [ ] **Choose name** — Lowercase, matches directory (e.g., `gemini`)
- [ ] **Prepare template** — Copy from `skill-file-template.md`
- [ ] **Add Bash to allowed-tools** — Required for CLI invocation
- [ ] **Plan timeout** — 2 min default, 5-10 min for external APIs
- [ ] **Handle errors** — Copy patterns from `bash-tool-patterns-external-cli.md`
- [ ] **Plan output** — Where will results be written? (docs/ subdirectory)
- [ ] **Test locally** — Verify CLI tool works before adding to skill
- [ ] **Document examples** — At least 2 invocation examples in SKILL.md
- [ ] **Test skill** — Invoke from Claude Code, verify output

---

## File Sizes & Read Times

| Document | File Size | Read Time | Type |
|----------|-----------|-----------|------|
| RESEARCH-SUMMARY.md | ~5 KB | 2-3 min | Summary |
| claude-code-skill-creation-patterns.md | ~25 KB | 15 min | Reference |
| skill-file-template.md | ~8 KB | 5 min | Template |
| bash-tool-patterns-external-cli.md | ~15 KB | 10 min | Code snippets |
| This README | ~6 KB | 3-5 min | Navigation |

**Total:** ~59 KB, ~35-45 minutes of reading (reference style, not all at once)

---

## Feedback & Updates

This research was completed on 2026-02-18. Key sources:

- Humanizer skill analysis (`~/.claude/skills/humanizer/`)
- Baby-Sentinel brainstorms (`docs/brainstorms/`)
- Project CLAUDE.md and conventions
- Global Claude Code instructions (`~/.claude/CLAUDE.md`)

If the Bash tool API or skill format changes, update this documentation.

---

## Summary

**You have everything needed to create a Claude Code skill that invokes external CLI tools.**

Start with:
1. **RESEARCH-SUMMARY.md** for context
2. **skill-file-template.md** for a template
3. **bash-tool-patterns-external-cli.md** for code snippets

Good luck building skills!
