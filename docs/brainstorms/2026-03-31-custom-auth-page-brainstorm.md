---
date: 2026-03-31
topic: custom-auth-page
---

# Combined Auth Page with Custom Flow

## What We're Building

A single combined sign-in/sign-up page using Clerk's `useSignIn()` and `useSignUp()` hooks instead of the pre-built `<SignIn>` and `<SignUp>` components. Inspired by Sana AI's auth page.

**Layout:** Split-screen — left side is auth form, right side is a product screenshot/preview showing Actioneer's UI. Full pixel control over the auth form. No Clerk branding, no CSS specificity fights.

**Auth methods:** Google SSO + Email OTP (no passwords). User enters email → gets verification code → enters code → authenticated. Sign-in and sign-up are the same page — Clerk auto-detects whether the email is new or existing.

## Why This Approach

The current `<SignIn>` / `<SignUp>` components have CSS specificity issues (our dark theme overrides don't fully win against Clerk's internal styles). Building with hooks gives us:

1. **Total design control** — our inputs, buttons, spacing, animations. Zero Clerk UI.
2. **Simpler UX** — no passwords, no "forgot password", no separate sign-up page.
3. **Product preview** — right panel shows the app, creating an "aha moment" before auth.
4. **Smooth onboarding entry** — after verification, redirect to /onboarding seamlessly.

## Key Decisions

- **Single page for both flows:** `/auth` replaces both `/sign-in` and `/sign-up`. Clerk's hooks handle the routing internally.
- **Email OTP only + Google SSO:** Disable password auth in Clerk dashboard. Cleaner, more secure.
- **Split layout:** Left 40% auth form, right 60% product preview (screenshot or dark UI mockup).
- **No nav header on auth page:** Just the Actioneer logo in the auth panel. Minimal.
- **Legal text at bottom:** Small muted text for terms/privacy, same as Sana.
- **Product preview:** Static screenshot of the Actioneer app (dark theme) on a subtle device mockup or just floating.

## Resolved Questions

- **Right panel:** Stylized dark UI mockup/illustration, not a literal screenshot. Premium feel.
- **Mobile:** Hide product preview, full-width auth form only.

## Next Steps

→ `/workflows:plan` for implementation
