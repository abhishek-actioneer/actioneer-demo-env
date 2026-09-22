#!/usr/bin/env python3
"""
Generate Slack message snippet images.

Strategy:
  1. Use OpenAI image generation to generate ONLY the
     headshot portrait for each person — plain background, no UI.
  2. Build the Slack message row as a pixel-accurate HTML/CSS component.
  3. Screenshot the HTML with Playwright at 2x device pixel ratio.

Usage:
    python3 scripts/generate-slack-snippets.py           # generate all 10
    python3 scripts/generate-slack-snippets.py --only 1  # generate snippet 1 only
    python3 scripts/generate-slack-snippets.py --skip-avatars  # reuse existing avatar PNGs
"""

import os
import sys
import argparse
import base64
import json
import textwrap
from pathlib import Path
from urllib import error, request

from playwright.sync_api import sync_playwright

OUTPUT_DIR   = Path(".claude-design/slack-snippets")
AVATARS_DIR  = OUTPUT_DIR / "avatars"

# ---------------------------------------------------------------------------
# Snippet data
# ---------------------------------------------------------------------------

SNIPPETS = [
    {
        "n": 1,
        "name": "Kadir Danışman",
        "date": "Dec 5th, 2025 at 2:14 PM",
        "message": "Hey @sashank, there really was an issue about fill rates and specifically Mintegral set-up was incorrect!",
        # @sashank is a person mention → yellow highlight
        "mentions": {"@sashank": "person"},
        "avatar": "Turkish man, late 20s, short dark hair, light stubble, relaxed smile, plain light gray background",
    },
    {
        "n": 2,
        "name": "Liam Purcell",
        "date": "Dec 9th, 2025 at 9:47 AM",
        "message": "@sentinel Can you provide the link to the Meta UA Spend & LTV Build-Up Report",
        "mentions": {"@sentinel": "app"},
        "avatar": "Irish man, early 30s, reddish-brown hair slightly messy, friendly expression, plain light gray background",
    },
    {
        "n": 3,
        "name": "Alex Kim",
        "date": "Dec 10th, 2025 at 10:22 AM",
        "message": "@sentinel what's our D30 retention for the Jan cohort vs Dec?",
        "mentions": {"@sentinel": "app"},
        "avatar": "Korean-American man, late 20s, straight black hair, wire-rimmed glasses, relaxed expression, plain light gray background",
    },
    {
        "n": 4,
        "name": "Maya Rodriguez",
        "date": "Dec 11th, 2025 at 11:05 AM",
        "message": "@sentinel just flagged our iOS fill rate dropped 18% since yesterday morning. looking into it",
        "mentions": {"@sentinel": "app"},
        "avatar": "Latina woman, early 30s, dark wavy hair to shoulders, warm smile, plain light gray background",
    },
    {
        "n": 5,
        "name": "Tom Okafor",
        "date": "Dec 8th, 2025 at 3:38 PM",
        "message": "okay this is actually insane. asked @sentinel for ROAS breakdown by network and it came back in 8 seconds",
        "mentions": {"@sentinel": "app"},
        "avatar": "Nigerian man, late 20s, short natural hair, big grin, plain light gray background",
    },
    {
        "n": 6,
        "name": "Sarah Chen",
        "date": "Dec 12th, 2025 at 8:51 AM",
        "message": "@sentinel our MRR number in today's WBR looks off — can you cross-check against Stripe?",
        "mentions": {"@sentinel": "app"},
        "avatar": "Chinese-American woman, early 30s, straight black hair in a ponytail, focused expression, plain light gray background",
    },
    {
        "n": 7,
        "name": "David Park",
        "date": "Dec 13th, 2025 at 4:17 PM",
        "message": "@sentinel flagged a 14% spike in churn this week. pulling the full cohort breakdown now",
        "mentions": {"@sentinel": "app"},
        "avatar": "Korean man, mid 30s, short neat dark hair, calm expression, plain light gray background",
    },
    {
        "n": 8,
        "name": "Priya Nair",
        "date": "Dec 7th, 2025 at 6:02 PM",
        "message": "shared the @sentinel WBR prep with the exec team. first time no one asked 'where did this number come from'",
        "mentions": {"@sentinel": "app"},
        "avatar": "South Indian woman, late 20s, long dark hair loose, bright eyes, casual smile, plain light gray background",
    },
    {
        "n": 9,
        "name": "James Wu",
        "date": "Dec 14th, 2025 at 7:30 AM",
        "message": "the @sentinel daily digest just dropped. retention curve is looking clean 🟢",
        "mentions": {"@sentinel": "app"},
        "avatar": "Chinese man, early 30s, short dark hair, easy-going smile, plain light gray background",
    },
    {
        "n": 10,
        "name": "Nina Patel",
        "date": "Dec 6th, 2025 at 2:55 PM",
        "message": "@sentinel our Q1 pipeline report is missing the enterprise segment — can you regenerate?",
        "mentions": {"@sentinel": "app"},
        "avatar": "Indian woman, mid 30s, dark hair in a loose bun, professional but relaxed, plain light gray background",
    },
]

# ---------------------------------------------------------------------------
# Step 1 — Generate headshot portrait via OpenAI
# ---------------------------------------------------------------------------

AVATAR_PROMPT = """\
Photorealistic headshot portrait photo.
Subject: {description}.
Plain flat light gray background (#e5e5e5). No texture, no gradient.
Framing: face + shoulders, centered, looking slightly toward camera.
Casual, natural expression — the kind of photo someone uses as a Slack profile picture.
Not a corporate LinkedIn headshot. Not a stock photo pose.
No text, no badges, no UI elements, no other people.
Square composition.
"""


def generate_avatar(api_key: str, snippet: dict) -> Path:
    n = snippet["n"]
    avatar_path = AVATARS_DIR / f"avatar-{n:02d}.jpg"

    if avatar_path.exists():
        print(f"  Avatar {n:02d} already exists, reusing.")
        return avatar_path

    print(f"  Generating avatar {n:02d} — {snippet['name']}...")
    prompt = AVATAR_PROMPT.format(description=snippet["avatar"])

    payload = json.dumps({
        "model": os.environ.get("OPENAI_IMAGE_MODEL", "gpt-image-1"),
        "prompt": prompt,
        "size": "1024x1024",
        "n": 1,
    }).encode("utf-8")
    req = request.Request(
        "https://api.openai.com/v1/images/generations",
        data=payload,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )

    try:
        with request.urlopen(req, timeout=120) as res:
            body = json.loads(res.read().decode("utf-8"))
    except error.HTTPError as err:
        detail = err.read().decode("utf-8", errors="ignore")
        print(f"  ✗ OpenAI image generation failed: {err.code} {detail[:200]}")
        return None

    image_b64 = body.get("data", [{}])[0].get("b64_json")
    if image_b64:
        avatar_path.write_bytes(base64.b64decode(image_b64))
        print(f"  ✓ Avatar saved → {avatar_path}")
        return avatar_path

    print(f"  ✗ No avatar image returned for snippet {n}")
    return None


# ---------------------------------------------------------------------------
# Step 2 — Build pixel-accurate Slack HTML row
# ---------------------------------------------------------------------------

def mentions_to_html(message: str, mentions: dict) -> str:
    """
    Replace @mention strings in message with styled <span> elements.
    mention type "person" → yellow (#f5c518 tint)
    mention type "app"    → blue  (#1d9bf0 tint)
    """
    # Sort longest mention first to avoid partial-match replacements
    for mention, kind in sorted(mentions.items(), key=lambda x: -len(x[0])):
        if kind == "person":
            span = f'<span class="mention mention-person">{mention}</span>'
        else:
            span = f'<span class="mention mention-app">{mention}</span>'
        message = message.replace(mention, span)
    return message


SLACK_HTML_TEMPLATE = """\
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}

  body {{
    background: #1a1d21;
    font-family: "Lato", "Slack-Lato", -apple-system, BlinkMacSystemFont,
                 "Segoe UI", Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
    /* Width sized to content — playwright clips to element bounds */
  }}

  .slack-message {{
    display: flex;
    align-items: flex-start;
    padding: 8px 16px 8px 16px;
    gap: 12px;
    background: #1a1d21;
    width: 680px;
  }}

  .avatar {{
    width: 36px;
    height: 36px;
    border-radius: 6px;        /* Slack's rounded-square — NOT circle */
    flex-shrink: 0;
    object-fit: cover;
    margin-top: 1px;           /* Aligns avatar cap-height with name baseline */
  }}

  .message-body {{
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }}

  .message-header {{
    display: flex;
    align-items: baseline;
    gap: 8px;
    line-height: 1.4;
  }}

  .sender-name {{
    font-size: 15px;
    font-weight: 900;
    color: #ffffff;
    cursor: pointer;
    letter-spacing: -0.01em;
  }}

  /* APP badge only for bots — not used for human senders in this set */
  .app-badge {{
    font-size: 10px;
    font-weight: 700;
    color: #1d1c1d;
    background: #e8e8e8;
    border-radius: 3px;
    padding: 1px 4px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    line-height: 1.4;
  }}

  .timestamp {{
    font-size: 12px;
    color: #ababad;
    font-weight: 400;
    white-space: nowrap;
  }}

  .message-text {{
    font-size: 15px;
    color: #d1d2d3;
    line-height: 1.46667;
    word-break: break-word;
  }}

  /* @person mention — warm yellow, like @sashank in reference */
  .mention {{
    border-radius: 3px;
    padding: 0 3px;
    font-weight: 400;
  }}

  .mention-person {{
    background: rgba(245, 197, 24, 0.3);
    color: #f5c518;
  }}

  /* @app / @sentinel mention — blue */
  .mention-app {{
    background: rgba(29, 155, 209, 0.2);
    color: #1d9bd1;
  }}
</style>
</head>
<body>
<div class="slack-message">
  <img class="avatar" src="data:image/jpeg;base64,{avatar_b64}" alt="">
  <div class="message-body">
    <div class="message-header">
      <span class="sender-name">{name}</span>
      <span class="timestamp">{date}</span>
    </div>
    <div class="message-text">{message_html}</div>
  </div>
</div>
</body>
</html>
"""


def build_html(snippet: dict, avatar_path: Path) -> str:
    avatar_b64 = base64.b64encode(avatar_path.read_bytes()).decode()
    message_html = mentions_to_html(snippet["message"], snippet.get("mentions", {}))
    return SLACK_HTML_TEMPLATE.format(
        avatar_b64=avatar_b64,
        name=snippet["name"],
        date=snippet["date"],
        message_html=message_html,
    )


# ---------------------------------------------------------------------------
# Step 3 — Screenshot HTML with Playwright
# ---------------------------------------------------------------------------

def screenshot_html(html: str, out_path: Path, page) -> None:
    page.set_content(html, wait_until="domcontentloaded")
    # Clip to the exact message element — no extra whitespace
    el = page.locator(".slack-message")
    el.screenshot(path=str(out_path), type="jpeg", quality=95)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Generate Slack snippet images (HTML + OpenAI headshots)")
    parser.add_argument("--only", type=int, metavar="N", help="Generate only snippet N (1–10)")
    parser.add_argument("--skip-avatars", action="store_true", help="Skip avatar generation, reuse existing")
    args = parser.parse_args()

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("Error: OPENAI_API_KEY environment variable not set.")
        sys.exit(1)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    AVATARS_DIR.mkdir(parents=True, exist_ok=True)

    if args.only:
        targets = [s for s in SNIPPETS if s["n"] == args.only]
        if not targets:
            print(f"Error: snippet {args.only} not found (valid range: 1–10)")
            sys.exit(1)
    else:
        targets = SNIPPETS

    print(f"Generating {len(targets)} snippet(s)...\n")

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(
            viewport={"width": 800, "height": 300},
            device_scale_factor=2,
        )

        results = []
        for snippet in targets:
            n = snippet["n"]
            print(f"[{n:02d}] {snippet['name']}")

            # Step 1 — headshot
            if not args.skip_avatars:
                avatar_path = generate_avatar(api_key, snippet)
            else:
                avatar_path = AVATARS_DIR / f"avatar-{n:02d}.jpg"
                if not avatar_path.exists():
                    print(f"  ✗ Avatar not found: {avatar_path}. Run without --skip-avatars first.")
                    continue

            if not avatar_path:
                continue

            # Step 2 — build HTML
            html = build_html(snippet, avatar_path)

            # Step 3 — screenshot
            out_path = OUTPUT_DIR / f"snippet-{n:02d}.jpg"
            screenshot_html(html, out_path, page)
            print(f"  ✓ Snippet saved → {out_path}")
            results.append(out_path)
            print()

        browser.close()

    print(f"Done. {len(results)}/{len(targets)} snippets generated.")
    for p in results:
        print(f"  {p}")


if __name__ == "__main__":
    main()
