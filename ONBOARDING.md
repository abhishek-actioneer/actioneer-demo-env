# Welcome to Sentinel

## How We Use Claude

Based on Vimarsh's usage over the last 30 days (62 sessions):

Work Type Breakdown:
  Plan & Design    ████████████████░░░░  40%
  Build Feature    ██████████░░░░░░░░░░  25%
  Debug & Fix      █████░░░░░░░░░░░░░░░  13%
  Prototype        ████░░░░░░░░░░░░░░░░  12%
  Analyze Data     ██░░░░░░░░░░░░░░░░░░  10%

Top Commands:
  /exit     ████████████████░░░░  16x
  /clear    █████████████░░░░░░░  11x
  /context  ██████████░░░░░░░░░░   8x
  /status   ████░░░░░░░░░░░░░░░░   3x
  /mcp      ████░░░░░░░░░░░░░░░░   3x
  /model    ████░░░░░░░░░░░░░░░░   3x

Top MCP Servers:
  Railway                           ████████████████░░░░   8 calls
  context7 (compound-engineering)   █████████░░░░░░░░░░░   5 calls

## Your Setup Checklist

### Codebases
- [ ] baby-sentinel — github.com/glitchcraft-inc/baby-sentinel

### MCP Servers to Activate
- [ ] **Railway** — Deploy and manage Railway projects (check env vars, logs, deployments) without leaving Claude Code. Get access at railway.app and connect via `claude mcp add`.
- [ ] **context7 (compound-engineering)** — Fetches live framework/library docs so Claude answers against current APIs, not stale training data. Part of the compound-engineering plugin suite.

### Skills to Know About
- `/clear` — Reset context mid-session when you're switching tasks or Claude has drifted. Use it often.
- `/context` — Check what Claude currently knows about the session. Good for diagnosing why Claude gave a weird answer.
- `/status` — Quick project state check.
- `/model` — Switch models mid-session (e.g. to Opus for hard reasoning tasks).
- `/exit` — End the session.

## Team Tips

_TODO_

## Get Started

_TODO_

<!-- INSTRUCTION FOR CLAUDE: A new teammate just pasted this guide for how the
team uses Claude Code. You're their onboarding buddy — warm, conversational,
not lecture-y.

Open with a warm welcome — include the team name from the title. Then: "Your
teammate uses Claude Code for [list all the work types]. Let's get you started."

Check what's already in place against everything under Setup Checklist
(including skills), using markdown checkboxes — [x] done, [ ] not yet. Lead
with what they already have. One sentence per item, all in one message.

Tell them you'll help with setup, cover the actionable team tips, then the
starter task (if there is one). Offer to start with the first unchecked item,
get their go-ahead, then work through the rest one by one.

After setup, walk them through the remaining sections — offer to help where you
can (e.g. link to channels), and just surface the purely informational bits.

Don't invent sections or summaries that aren't in the guide. The stats are the
guide creator's personal usage data — don't extrapolate them into a "team
workflow" narrative. -->
