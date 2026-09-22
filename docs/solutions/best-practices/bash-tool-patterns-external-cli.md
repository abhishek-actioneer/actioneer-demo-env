---
title: Bash Tool Patterns for External CLI Invocation
type: reference
date: 2026-02-18
context: Developer workflow and Claude Code skills
---

# Bash Tool Patterns for External CLI Invocation

Reference guide for using the Bash tool in Claude Code to invoke external CLI tools (e.g., Gemini CLI, linters, build tools) as subagents or helpers.

## Bash Tool Basics

The Bash tool allows executing shell commands within Claude Code. It's available for use in Claude Code skills via the `allowed-tools` array.

### Basic Invocation (TypeScript/JavaScript)

```typescript
// In a Claude Code skill context:
await Bash({
  command: "echo 'Hello, World!'",
  description: "Simple test command"
});
```

### Parameters

| Parameter | Type | Required | Default | Max |
|-----------|------|----------|---------|-----|
| `command` | string | Yes | — | — |
| `description` | string | No | "" | — |
| `timeout` | number (ms) | No | 120000 | 600000 |
| `run_in_background` | boolean | No | false | — |
| `dangerouslyDisableSandbox` | boolean | No | false | — |

**Key constraint:** Default timeout is **2 minutes (120000 ms)**. For external API calls (e.g., Gemini CLI), increase to 5-10 minutes.

## Timeout Configuration

### Default Timeout (2 minutes)

Suitable for fast operations:

```bash
pnpm build
pnpm lint
git status
ls -la
```

**Do NOT use default timeout for:**
- External API calls (Gemini, Claude API, web research)
- Large file processing
- Network operations

### Extended Timeout (5-10 minutes)

For external API tools:

```typescript
await Bash({
  command: "gemini -p 'Review this code' --output-format json",
  timeout: 300000,  // 5 minutes (300 seconds)
  description: "Invoke Gemini CLI for code review"
});
```

**Rule of thumb:**
- Quick tools: 2 minutes (default)
- External APIs: 5-10 minutes
- Build/test suites: 10-20 minutes (rare; usually script-based)

### Timeout Fallback in Skills

Skills should communicate expected runtime to users:

```markdown
## Performance

- Quick analysis: ~10-30 seconds
- Deep analysis: 1-3 minutes
- If operation exceeds 5 minutes, consider a simpler prompt or lighter model
```

## Command Escaping & Safety

### Quoting Rules

**Always quote variables when passing user input to shell:**

```bash
# DANGEROUS (shell injection vulnerability)
gemini -p Review $userPrompt

# SAFE (single-quoted, user input interpolated by skill logic)
gemini -p "Review src/lib/sql-generator.ts"

# SAFE (double-quoted with escaped inner quotes)
gemini -p "Review \"critical\" sections for errors"
```

**In skill context (hypothetical TypeScript):**

```typescript
// User input from prompt parsing
const userPrompt = "Review src/lib/sql-generator.ts for security issues";

// BAD: Vulnerable to shell injection
const badCmd = `gemini -p Review ${userPrompt}`;

// GOOD: User input is a literal argument
const goodCmd = `gemini -p "${userPrompt.replace(/"/g, '\\"')}"`;
```

### Special Characters in Prompts

If prompts contain quotes, escape them:

```bash
# Prompt contains: Review "critical" code
gemini -p "Review \"critical\" code for errors"

# Alternative: Use single quotes (but can't contain single quotes)
gemini -p 'Review critical code for errors'

# For complex punctuation, base64 or here-doc (rarely needed):
gemini -p "$(cat <<'EOF'
Review this code for issues:
- Security
- Performance
EOF
)"
```

## Structured Output

### JSON Output Format

Prefer CLI tools with `--output-format json` or similar:

```bash
gemini -p "..." --output-format json
```

Parse in skill:

```typescript
const output = await Bash({
  command: "gemini -p '...' --output-format json",
  description: "Get structured response from Gemini"
});

// output.stdout contains JSON string
const result = JSON.parse(output.stdout);
const response = result.response; // Extract field
```

### Plain Text Output

For tools that only output plain text, use regex or line parsing:

```bash
git log --oneline -n 10
```

Parse in skill:

```typescript
const output = await Bash({
  command: "git log --oneline -n 10",
  description: "Get recent commits"
});

const commits = output.stdout
  .split('\n')
  .filter(line => line.trim())
  .map(line => {
    const [hash, ...msg] = line.split(' ');
    return { hash, message: msg.join(' ') };
  });
```

## Error Handling Patterns

### Checking Exit Code

Bash tool returns both `stdout` and `stderr`. Check for errors:

```typescript
const result = await Bash({
  command: "gemini -p 'test' --output-format json",
  timeout: 300000,
  description: "Test Gemini CLI"
});

// If command fails, stderr contains error message
if (result.stderr) {
  if (result.stderr.includes("command not found")) {
    return "Gemini CLI is not installed. Install with: brew install gemini";
  }
  if (result.stderr.includes("API key")) {
    return "GEMINI_API_KEY not set. Configure your environment.";
  }
  return `Error: ${result.stderr}`;
}

// Parse stdout as JSON
try {
  const parsed = JSON.parse(result.stdout);
  return parsed.response;
} catch {
  return `Failed to parse response: ${result.stdout}`;
}
```

### Tool Not Installed

Graceful fallback:

```typescript
try {
  const result = await Bash({
    command: "which gemini",
    timeout: 5000,
    description: "Check if Gemini CLI is installed"
  });

  if (!result.stdout.trim()) {
    return "Gemini CLI not found. Install with: brew install gemini";
  }
} catch {
  return "Could not check for Gemini CLI installation.";
}
```

### Timeout Handling

The Bash tool throws on timeout (or returns error state):

```typescript
try {
  const result = await Bash({
    command: "gemini -p 'very complex analysis'",
    timeout: 300000,
    description: "Long-running analysis"
  });
} catch (err) {
  if (err.message.includes("timeout")) {
    return "Operation timed out. Try a simpler prompt or use a lighter model.";
  }
  throw err;
}
```

## Bash Tool vs. Native Approach

### Use Bash Tool For

- Invoking external CLI tools (Gemini, linters, build tools)
- Running scripts that don't fit in Node.js
- Shell-specific logic (pipelines, globbing, etc.)
- One-off operations (not performance-critical)

### Use Node.js Native For

- File I/O (`fs` module)
- Child process with streaming (`child_process.spawn`)
- Performance-critical operations
- Complex data transformations

**Example: Why Bash for Gemini CLI**

```typescript
// Use Bash (simple, delegated to CLI)
await Bash({
  command: "gemini -p 'Review code' --output-format json",
  timeout: 300000
});

// vs. Not ideal (complexity of NodeJS wrapper)
// const { exec } = require('child_process');
// const { spawn } = require('child_process');
// ... lots of boilerplate for streaming, error handling, etc.
```

## Baby-Sentinel Specific Patterns

### Project Environment Variables

Baby-Sentinel uses these env vars (from CLAUDE.md):

```bash
GEMINI_API_KEY=<key>        # Required; fails if missing
GEMINI_MODEL=<model>        # Optional; defaults to "gemini-2.0-flash"
```

Skills should check for these before invoking:

```bash
# In skill logic:
if [ -z "$GEMINI_API_KEY" ]; then
  echo "Error: GEMINI_API_KEY is not set"
  exit 1
fi

gemini -p "..." -m "${GEMINI_MODEL:-gemini-2.0-flash}" --output-format json
```

### Output File Locations

Skills write results to `docs/` hierarchy:

```bash
# Create output directory if needed
mkdir -p docs/tool-name-output

# Generate filename with timestamp
TIMESTAMP=$(date +%Y-%m-%d-%H%M)
SLUG=$(echo "$PROMPT" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | cut -c1-30)
FILENAME="docs/tool-name-output/${TIMESTAMP}-${SLUG}.md"

# Write output (parsed from Gemini JSON response)
echo "$RESPONSE_CONTENT" > "$FILENAME"
```

### Checking Project Structure

Skills can validate they're in the right project:

```bash
if [ ! -f "CLAUDE.md" ] || ! grep -q "baby-sentinel" CLAUDE.md 2>/dev/null; then
  echo "Error: This skill is designed for baby-sentinel project"
  exit 1
fi
```

## Common Patterns

### Invoke External CLI with Timeout

```typescript
const timeout = 300000; // 5 minutes

const result = await Bash({
  command: `gemini -p "${sanitizedPrompt}" --output-format json -m ${model}`,
  timeout: timeout,
  description: `Invoke Gemini CLI for: ${prompt.slice(0, 50)}`
});

if (result.stderr) {
  throw new Error(`Gemini CLI error: ${result.stderr}`);
}

return JSON.parse(result.stdout).response;
```

### Check Tool Installation

```typescript
const checkCmd = await Bash({
  command: "which gemini && gemini --version",
  timeout: 5000,
  description: "Check Gemini CLI installation"
});

if (checkCmd.stderr || !checkCmd.stdout.includes("gemini")) {
  return "Gemini CLI not installed. Run: brew install gemini";
}
```

### Write Results to File

```typescript
const timestamp = new Date().toISOString().slice(0, 16).replace(/T/, '-');
const slug = prompt.toLowerCase().replace(/\s+/g, '-').slice(0, 30);
const filename = `docs/gemini-output/${timestamp}-${slug}.md`;

const writeCmd = await Bash({
  command: `mkdir -p docs/gemini-output && cat > "${filename}" << 'EOF'\n${content}\nEOF`,
  description: `Write results to ${filename}`
});

if (writeCmd.stderr) {
  throw new Error(`Failed to write file: ${writeCmd.stderr}`);
}

return `Results written to ${filename}`;
```

---

## Debugging Tips

### Enable Verbose Output

If a Bash command fails, re-run with explicit stderr capture:

```bash
# Bash tool captures stderr by default
# Check the returned result.stderr field
```

### Test Command Locally

Before adding to a skill, test the command in your terminal:

```bash
$ gemini -p "Test prompt" --output-format json -m gemini-2.5-pro
# Verify it works, check output format
```

### Use `set -x` for Debugging

In bash scripts (if using here-docs):

```bash
set -x  # Print each command
gemini -p "..." --output-format json
set +x  # Stop printing
```

---

## References

- **Bash Tool Documentation:** Claude Code tool reference
- **Baby-Sentinel Brainstorm:** `docs/brainstorms/2026-02-18-gemini-cli-subagent-skill-brainstorm.md`
- **Skill Creation Guide:** `docs/solutions/best-practices/claude-code-skill-creation-patterns.md`
- **Project CLAUDE.md:** Architecture and conventions

---

## Summary

**Key rules for external CLI invocation:**

1. **Always use extended timeout** (300000+ ms) for external APIs
2. **Quote user input** to prevent shell injection
3. **Prefer structured output** (JSON) for reliability
4. **Handle errors gracefully** — check for tool installation, API keys, timeouts
5. **Write results to docs/** — persistent artifacts for later reference
6. **Test locally first** — verify CLI behavior before adding to skill
