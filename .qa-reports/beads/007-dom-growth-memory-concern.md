# BEAD-007: DOM Growth Investigation — FALSE ALARM

**Severity:** ~~MEDIUM~~ → **NONE (closed)**
**Category:** Performance
**Status:** Investigated — no leak found

---

## Investigation Summary

The original QA report measured 432 DOM nodes on Home and 1,143 on Metric Tree, calling it "165% growth." This was a misdiagnosis. **There is no DOM leak.** The numbers simply reflect different page content sizes.

## Evidence: Systematic Navigation Measurement

Navigated through all 9 pages, measuring DOM nodes at each stop:

| Page | Total | Sidebar | Main | Body Scripts | Radix Portals |
|------|-------|---------|------|-------------|---------------|
| Home (baseline) | 432 | 245 | 54 | 16 | 0 |
| Metrics | 907 | 245 | 517 | 27 | 0 |
| Segments | 594 | 245 | 215 | 21 | 0 |
| Playbooks | 406 | 245 | 20 | 29 | 0 |
| Scouts | 475 | 245 | 87 | 31 | 0 |
| Knowledge | 464 | 245 | 80 | 26 | 0 |
| Decks | 401 | 245 | 23 | 21 | 0 |
| Connectors | 553 | 245 | 173 | 22 | 0 |
| Metric Tree | 1,143 | 245 | 763 | 21 | 0 |
| **Home (after all)** | **431** | **245** | **54** | 16 | 0 |

### Key findings:

1. **Sidebar is constant at 245 nodes** — no accumulation across navigations
2. **Main content changes per page** — Metrics has a 30-row table (517 nodes), Metric Tree has a React Flow canvas (763 nodes). These are legitimate content differences, not leaks.
3. **Home returns to 431** after navigating all 9 pages — essentially identical to the 432 baseline (1 node difference is a Next.js route announcer)
4. **Zero Radix portal leaks** — no tooltip/popover containers accumulating
5. **Zero toast leaks** — Sonner region clean
6. **Body script tags fluctuate** — Next.js Turbopack injects per-route script tags in dev mode (16 for home, 27 for metrics). These are zero-child `<script>` tags with negligible cost. They don't accumulate — going back to home returns to 16.

### Rapid navigation stress test:

After 12 rapid navigations (metrics → segments → knowledge → home × 3 cycles):
- Total DOM: **431** (identical to baseline)
- Radix portals: **0**
- Body divs: **3** (app container + empty div + account popover)

### The Account Popover

One persistent element: a `fixed w-64 rounded-xl` div with 52 children that renders the Account popover (Admin, admin@company.com, Billing, Usage, Theme, Model, Logout). This is always mounted in the DOM (not portal-based, not lazy). It's a constant 52 nodes — does not grow.

## Conclusion

**No fix needed.** The original "165% growth" was comparing Home (a minimal page with 54 main-content nodes) against Metric Tree (a complex visualization with 763 main-content nodes). The sidebar, portals, toasts, and body-level elements are all stable. React's component unmounting is working correctly — navigating back to Home returns to baseline.

The only optimization opportunity is the always-mounted Account popover (52 nodes), which could be lazily rendered. But 52 nodes is negligible — not worth the complexity.
