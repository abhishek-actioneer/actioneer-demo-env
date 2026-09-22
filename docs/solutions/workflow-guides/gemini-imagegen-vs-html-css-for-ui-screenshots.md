---
title: Gemini imagegen fails to replicate Slack message UI pixel-accurately
problem_type: workflow_antipattern
component: scripts/generate-slack-snippets.py
symptoms:
  - APP badge incorrectly added next to human sender names (Slack bot-only UI element)
  - Avatar rendered as circle instead of Slack's rounded-square crop
  - Avatar prompt requested app icon / company logo instead of person headshot photo
  - Font size, weight, and spacing inconsistent across generations
  - Timestamp format rendered as "2:14 PM" instead of Slack's "Dec 5th, 2025 at 8:15 PM" full-date format
  - "@mention highlight rendered in wrong color (blue instead of Slack yellow for @person mentions)"
  - Outer padding and background inconsistent; faint borders visible on some outputs
  - 3+ prompt-iteration cycles required per snippet due to pixel-level prompt trial-and-error
tags:
  - gemini
  - imagegen
  - slack
  - html-screenshot
  - prompt-engineering
  - presentation
severity: medium
frequency: recurring
correct_approach: >
  Do not use Gemini imagegen to render the full Slack message UI.
  Instead: (1) build Slack message rows as HTML/CSS components that exactly
  replicate Slack's DOM structure and design tokens; (2) use Gemini imagegen
  only to generate the rounded-square headshot photo per person; (3) embed
  the headshot into the HTML component; (4) screenshot the HTML for the final
  image. This eliminates all font, layout, badge, and color inconsistencies.
---

# Gemini imagegen vs HTML/CSS for UI Screenshots

## Problem

When tasked with generating realistic Slack message screenshot images for a presentation slide, the team used Gemini imagegen (`gemini-3-pro-image-preview`) to render the entire Slack message row. This produced multiple pixel-level failures across every attempt, requiring 3+ regeneration cycles on snippet 1 alone.

## Root Cause

Gemini imagegen cannot reliably reproduce pixel-accurate UI components at the detail level required to pass as real Slack screenshots. The failure points are structural:

| Failure | Why Gemini Gets It Wrong |
|---|---|
| Avatar shape (circle vs rounded-square) | Gemini defaults to circular avatars (Instagram/Twitter mental model). Slack uses rounded-square (~6px radius). |
| APP badge on human users | Gemini conflates "workspace user" with "integration". Slack only shows APP badge on bot accounts, never humans. |
| @mention highlight color | Gemini uses blue for all highlights. Slack uses **warm yellow** (`rgba(245,197,24,0.3)`) for `@person` and blue for `@app`. |
| Timestamp format | Gemini renders `"8:15 PM"` (short form). Slack shows `"Dec 5th, 2025 at 8:15 PM"` for older messages. |
| Font rendering | Gemini rasterises at arbitrary DPI with inconsistent subpixel rendering. HTML/CSS renders using system fonts at correct metrics. |
| Background consistency | Gemini generates slight padding, border artifacts, or colour drift around edges. |

**Core insight:** Gemini is good at generating photorealistic faces. It is bad at replicating exact UI specifications. Use each tool for what it does well.

---

## Pixel-Level Spec: Slack Dark Theme Message Row

Measured from reference screenshot (real Slack dark theme):

| Property | Value |
|---|---|
| Background | `#1a1d21` |
| Avatar shape | Rounded square, `border-radius: 6px`, `36×36px` |
| Avatar margin | `margin-top: 1px` (aligns cap-height with name baseline) |
| Sender name | `#ffffff`, weight `700`, `15px`, Lato / system-ui |
| APP badge | **Only on bot/integration accounts.** `#e8e8e8` bg, `#1d1c1d` text, `10px`, uppercase, `border-radius: 3px` |
| Timestamp | `#ababad`, `11px`, format: `"Dec 5th, 2025 at 8:15 PM"` |
| Message text | `#d1d2d3`, `15px`, `line-height: 1.46667` |
| @person mention | `rgba(245,197,24,0.3)` bg, `#f5c518` text, `border-radius: 3px` |
| @app / @sentinel mention | `rgba(29,155,240,0.2)` bg, `#1d9bf0` text, `border-radius: 3px` |
| @here / @channel | Same yellow as @person |
| Left padding | `16px` |
| Gap (avatar → body) | `12px` |

---

## Correct Solution

### Step 1 — Generate only the headshot with Gemini

Keep the prompt minimal — no UI context, no background elements:

```
Photorealistic headshot portrait. Plain neutral background.
Face and shoulders visible. Casual, natural expression — like a Slack profile photo.
[Add appearance description: "South Asian woman, late 20s, dark hair"]
No text, no badges, no UI chrome of any kind.
```

Save as `avatar-{name}.jpg`. Gemini returns JPEG by default — always use `.jpg` extension.

### Step 2 — Build the Slack row in HTML/CSS

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    background: #1a1d21;
    font-family: "Lato", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    -webkit-font-smoothing: antialiased;
  }

  .slack-message {
    display: flex;
    align-items: flex-start;
    padding: 8px 16px;
    gap: 12px;
  }

  .avatar {
    width: 36px;
    height: 36px;
    border-radius: 6px;   /* ROUNDED SQUARE — not circle */
    flex-shrink: 0;
    object-fit: cover;
    margin-top: 1px;
  }

  .message-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .message-header {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  .sender-name {
    font-size: 15px;
    font-weight: 700;
    color: #ffffff;
    line-height: 1.4;
  }

  /* Only add .app-badge for bot/integration senders — NEVER for humans */
  .app-badge {
    font-size: 10px;
    font-weight: 700;
    color: #1d1c1d;
    background: #e8e8e8;
    border-radius: 3px;
    padding: 1px 4px;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }

  .timestamp {
    font-size: 11px;
    color: #ababad;
    white-space: nowrap;
  }

  .message-text {
    font-size: 15px;
    color: #d1d2d3;
    line-height: 1.46667;
  }

  /* @person mention — warm yellow */
  .mention-person {
    background: rgba(245, 197, 24, 0.3);
    color: #f5c518;
    border-radius: 3px;
    padding: 0 2px;
  }

  /* @app / @sentinel mention — blue */
  .mention-app {
    background: rgba(29, 155, 240, 0.2);
    color: #1d9bf0;
    border-radius: 3px;
    padding: 0 2px;
  }
</style>
</head>
<body>
<div class="slack-message">
  <img class="avatar" src="avatar-kadir.jpg" alt="">
  <div class="message-body">
    <div class="message-header">
      <span class="sender-name">Kadir Danışman</span>
      <!-- No .app-badge — human user -->
      <span class="timestamp">Dec 5th, 2025 at 8:15 PM</span>
    </div>
    <div class="message-text">
      Hey <span class="mention-person">@sashank</span>, there really was an issue
      about fill rates and specifically Mintegral set-up was incorrect!
    </div>
  </div>
</div>
</body>
</html>
```

### Step 3 — Screenshot the HTML at 2× scale

```bash
# Playwright (Python)
python3 -c "
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(
        viewport={'width': 800, 'height': 120},
        device_scale_factor=2
    )
    page.goto('file:///path/to/slack-message.html')
    page.screenshot(path='snippet-01.png')
    browser.close()
"
```

Render at `device_scale_factor: 2` for crisp retina output.

---

## Decision Framework: Imagegen vs HTML

**Use HTML/CSS when:**
- The component is defined by a design spec (padding, font, color, border-radius)
- You need multiple data variants (different users, timestamps, messages)
- The component contains text that must be accurate and legible
- The component contains semantic icons or badges

**Use Gemini imagegen when:**
- The content is inherently generative: portraits, illustrations, artwork
- The asset is decorative and doesn't need pixel-exact reproduction
- The output is a **fill** for a slot whose container is defined in HTML

**Rule:** If a design spec defines it → HTML. If a human created it (a face, a photo) → imagegen.

---

## Pre-Generation Checklist

Before using Gemini imagegen for any UI element:

- [ ] Does this element appear in a design spec or live UI? → Use HTML.
- [ ] Do I need multiple variants with different data? → Use HTML.
- [ ] Does it contain text that must be accurate? → Use HTML (imagegen cannot reliably render text).
- [ ] Does it contain badges, icons, or status indicators? → Use HTML.
- [ ] Is this purely a photograph or portrait (no UI chrome)? → imagegen is appropriate.
- [ ] Can I reduce the imagegen scope to just the human-generated asset and composite it into an HTML shell? → Always prefer this.

---

## How to Audit a Reference Screenshot

Before building anything, inventory the reference:

1. **Layout model** — flex row, grid, absolute? What are the padding/gap values?
2. **Avatar shape** — circle (`border-radius: 50%`) or rounded square (specific px)? Measure from the reference.
3. **Typography** — font family, size per element, weight, line-height.
4. **Badge rules** — who gets badges? Which role/type? What exact colour?
5. **@mention highlight colours** — are `@user`, `@app`, `@channel` visually distinct? What colours exactly?
6. **Timestamp format** — short time only? Full date + time? Under what conditions does format change?
7. **States** — hover, unread, threaded? Which state is the reference showing?

Only after completing this inventory should you write a single line of prompt or code.

---

## Related Docs

- No prior solution docs exist for this problem type — this is the first.
- Tangentially related plans (Gemini-driven canvas content, not UI replication):
  - `docs/brainstorms/2026-03-11-living-deck-brainstorm.md`
  - `docs/plans/2026-03-11-feat-living-deck-plan.md`
