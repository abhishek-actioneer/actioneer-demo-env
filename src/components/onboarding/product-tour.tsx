"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";

/** Dispatch `window.dispatchEvent(new Event(START_TOUR_EVENT))` to launch the tour. */
export const START_TOUR_EVENT = "actioneer:start-tour";

// ── Tour copy ────────────────────────────────────────────────────────────────
// One shared set of copy for every workspace. House style: no em-dashes or
// en-dashes, headings in title case, plain language (no internal jargon).
// Long descriptions use a blank line (\n\n) to split into two short paragraphs;
// the popover renders newlines via `white-space: pre-line`.
const TOUR_COPY = {
  ask: "Ask complex questions across all your data in natural language, including multi-table joins, without writing SQL.\n\nEvery response is fully transparent: the exact query executed, table sources, row counts, and data lineage. Use normal mode for quick answers, or Deep Research for deeper analysis.",
  metrics: "Actioneer's semantic layer: a structured mapping of your definitions, KPIs, and data logic, established during onboarding and maintained over time.\n\nEvery query, segment, and playbook runs on consistent, company-specific definitions rather than generic model guesses.",
  segments: "Build precise user cohorts directly from chat, or in the Segments section itself, by defining rules across behavioral, transactional, funnel-position, or time-window signals.\n\nBoth static (CSV) and dynamic, real-time segments are supported, and you can push them straight to your CDP, CLM, S3, or BigQuery for immediate activation.",
  funnels: "Build conversion funnels across any sequence of events and see where users drop off at each step, with breakdowns by cohort, channel, or property.",
  retention: "Track how many users come back over time after a key action, with retention curves by cohort, so you can see what keeps users engaged and where they fall away.",
  playbooks: "Deterministic, rule-based automation workflows built through a simple chat interface. It turns recurring queries and multi-step analyses into scheduled sequences that surface key observations and trigger downstream actions like campaigns or alerts.\n\nDeep analysis runs automatically, with guardrails ensuring consistent, auditable execution.",
  voice: "AI-powered outbound calling that automatically generates context-aware scripts from your event data and proven call flows, fully editable by your team.\n\nVoice agents handle complex scenarios with if-else routing for different responses, with SMS and WhatsApp fallback when calls go unanswered. Call logs and CRM handoff notes are written back automatically, all on your own dialer.",
  boards: "Assemble charts and findings from any analysis into shareable boards for your team to review and act on together.",
  knowledge: "Your organization's tribal knowledge in one place: the definitions, business rules, and context that usually live only in people's heads.\n\nActioneer draws on it so every answer reflects how your business actually operates, not generic assumptions.",
  connect: "Integrations that unify data across your stack, from warehouses and product analytics to ad platforms and engagement tools, into a single queryable layer.\n\nNew tables and events are detected and mapped automatically with natural-language prompts, and no data ever leaves your infrastructure.",
};

// Completion step: a drawn checkmark + a short "you're set" message, rendered as
// HTML in the popover description (driver.js sets description via innerHTML).
const DONE_HTML = `<div class="tour-done"><span class="tour-done-check"><svg viewBox="0 0 52 52"><circle class="tour-done-circle" cx="26" cy="26" r="24" fill="none"/><path class="tour-done-tick" fill="none" d="M16 27l7 7 14-15"/></svg></span><span class="tour-done-title">You're All Set</span></div>`;

function buildSteps(): DriveStep[] {
  const c = TOUR_COPY;
  return [
    {
      popover: {
        title: "Guided Walkthrough",
        description: "A quick tour to get you familiar with the platform's core capabilities.",
        popoverClass: "actioneer-tour actioneer-tour-centered",
      },
    },
    { element: '[data-tour="tour-ask"]', popover: { title: "Ask Anything", description: c.ask } },
    { element: '[data-tour="tour-nav-segments"]', popover: { title: "Segments", description: c.segments } },
    { element: '[data-tour="tour-nav-playbooks"]', popover: { title: "Playbooks", description: c.playbooks } },
    { element: '[data-tour="tour-nav-voice"]', popover: { title: "Voice", description: c.voice } },
    { element: '[data-tour="tour-nav-metrics"]', popover: { title: "Metrics", description: c.metrics } },
    { element: '[data-tour="tour-nav-funnels"]', popover: { title: "Funnels", description: c.funnels } },
    { element: '[data-tour="tour-nav-retentions"]', popover: { title: "Retention", description: c.retention } },
    { element: '[data-tour="tour-nav-boards"]', popover: { title: "Boards", description: c.boards } },
    { element: '[data-tour="tour-nav-knowledge"]', popover: { title: "Knowledge", description: c.knowledge } },
    { element: '[data-tour="tour-nav-connectors"]', popover: { title: "Connect Your Data", description: c.connect } },
    {
      popover: {
        description: DONE_HTML,
        showButtons: ["next"],
        showProgress: false,
        popoverClass: "actioneer-tour actioneer-tour-centered",
      },
    },
  ];
}

/** Resolve once `selector` exists in the DOM (or after `timeout`ms). */
function waitFor(selector: string, timeout = 2500): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (document.querySelector(selector) || Date.now() - start > timeout) return resolve();
      requestAnimationFrame(tick);
    };
    tick();
  });
}

export function ProductTour() {
  const router = useRouter();

  useEffect(() => {
    async function start() {
      // The tour spotlights home + the left nav, so make sure we're on home first.
      router.push("/");
      await waitFor('[data-tour="tour-ask"]');

      // Drop any step whose anchor isn't on the page (feature-flagged nav, etc.).
      const steps = buildSteps().filter(
        (s) => !s.element || document.querySelector(s.element as string),
      );
      const d = driver({
        showProgress: true,
        progressText: "{{current}}/{{total}}",
        animate: true,
        overlayOpacity: 0.6,
        stagePadding: 6,
        stageRadius: 8,
        popoverClass: "actioneer-tour",
        nextBtnText: "Next",
        prevBtnText: "Back",
        doneBtnText: "Start Exploring",
        steps,
      });
      d.drive();
    }

    window.addEventListener(START_TOUR_EVENT, start);
    return () => window.removeEventListener(START_TOUR_EVENT, start);
  }, [router]);

  return <TourStyles />;
}

/** Brand theming for the Driver.js popover: monochrome, app font, arrowless. */
function TourStyles() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
        .driver-popover.actioneer-tour {
          background: var(--background);
          color: var(--foreground);
          border: 1px solid var(--border);
          border-radius: var(--radius-2xl);
          box-shadow: 0 16px 52px rgba(0,0,0,0.22);
          padding: 26px 26px 20px;
          max-width: 448px;
          min-width: 408px;
          font-family: inherit;
        }
        .driver-popover.actioneer-tour .driver-popover-title {
          font-size: 17.5px; font-weight: 600; line-height: 1.3; color: var(--foreground); margin: 0 0 9px;
        }
        .driver-popover.actioneer-tour .driver-popover-description {
          font-size: 14px; line-height: 1.62; color: var(--muted-foreground); margin: 0; white-space: pre-line;
        }
        .driver-popover.actioneer-tour .driver-popover-arrow { display: none; }
        /* Centered (no-anchor) steps: nudge right so they center over the main
           content area instead of the whole viewport (the sidebar eats the left). */
        .driver-popover.actioneer-tour-centered { transform: translateX(110px); }
        .driver-popover.actioneer-tour .driver-popover-footer { margin-top: 16px; gap: 8px; }
        .driver-popover.actioneer-tour .driver-popover-progress-text {
          font-size: 13px; color: var(--muted-foreground);
        }
        .driver-popover.actioneer-tour .driver-popover-navigation-btns { gap: 6px; }
        .driver-popover.actioneer-tour .driver-popover-navigation-btns button {
          background: var(--foreground); color: var(--background); border: none; text-shadow: none;
          border-radius: var(--radius-md); padding: 7px 15px; font-size: 13px; font-weight: 500;
          transition: opacity .15s ease;
        }
        .driver-popover.actioneer-tour .driver-popover-navigation-btns button:hover { opacity: .9; }
        .driver-popover.actioneer-tour .driver-popover-prev-btn {
          background: transparent; color: var(--muted-foreground); border: 1px solid var(--border);
        }
        .driver-popover.actioneer-tour .driver-popover-close-btn {
          color: var(--muted-foreground); transition: color .15s ease;
        }
        .driver-popover.actioneer-tour .driver-popover-close-btn:hover { color: var(--foreground); }

        /* Completion step: hide the progress counter and center the single button. */
        .driver-popover.actioneer-tour:has(.tour-done) .driver-popover-progress-text { display: none !important; }
        .driver-popover.actioneer-tour:has(.tour-done) .driver-popover-footer { justify-content: center; margin-top: 18px; }
        .driver-popover.actioneer-tour:has(.tour-done) .driver-popover-navigation-btns button { padding: 9px 22px; }
        .driver-popover.actioneer-tour .tour-done {
          display: flex; flex-direction: column; align-items: center; text-align: center;
          white-space: normal; padding: 6px 6px 2px;
        }
        .tour-done .tour-done-check { width: 54px; height: 54px; margin-bottom: 16px; }
        .tour-done .tour-done-check svg { width: 100%; height: 100%; }
        .tour-done .tour-done-circle {
          stroke: var(--foreground); stroke-width: 2;
          stroke-dasharray: 151; stroke-dashoffset: 151;
          animation: tourDoneCircle .5s ease-out forwards;
        }
        .tour-done .tour-done-tick {
          stroke: var(--foreground); stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round;
          stroke-dasharray: 30; stroke-dashoffset: 30;
          animation: tourDoneTick .35s .45s ease-out forwards;
        }
        .tour-done .tour-done-title {
          font-size: 20px; font-weight: 600; color: var(--foreground); margin-bottom: 2px;
        }
        @keyframes tourDoneCircle { to { stroke-dashoffset: 0; } }
        @keyframes tourDoneTick { to { stroke-dashoffset: 0; } }
      `,
      }}
    />
  );
}
