// ── Page context types for the persistent chat panel ──

export interface SuggestedAction {
  id: string;
  label: string;
  description: string;
  /** The prompt that would be sent to the LLM when clicked */
  prompt: string;
}

export interface PageContext {
  /** Route-derived page type */
  pageType: string;
  /** Human-readable label for context badge */
  pageLabel: string;
  /** Input placeholder text */
  inputPlaceholder: string;
  /** Pre-built suggested actions for this page */
  suggestedActions: SuggestedAction[];
  /** Optional entity (set by detail pages via usePageContext) */
  entity?: {
    id: string;
    name: string;
    type: string;
    summary?: string;
    /** Rich data for LLM context injection (sql, formula, dimensions, etc.) */
    contextPayload?: Record<string, unknown>;
  };
}

// ── Route → context mapping ──

const PAGE_CONTEXTS: Record<string, Omit<PageContext, "entity">> = {
  segments: {
    pageType: "segments",
    pageLabel: "Segments",
    inputPlaceholder: "Ask about your segments...",
    suggestedActions: [],
  },
  playbooks: {
    pageType: "playbooks",
    pageLabel: "Playbooks",
    inputPlaceholder: "Ask about your playbooks...",
    suggestedActions: [],
  },
  scouts: {
    pageType: "scouts",
    pageLabel: "Scouts",
    inputPlaceholder: "Ask about your scouts...",
    suggestedActions: [],
  },
  metrics: {
    pageType: "metrics",
    pageLabel: "Metrics",
    inputPlaceholder: "Ask about your metrics...",
    suggestedActions: [],
  },
  "metric-tree": {
    pageType: "metric-tree",
    pageLabel: "Metric Tree",
    inputPlaceholder: "Ask about metric relationships...",
    suggestedActions: [],
  },
  store: {
    pageType: "store",
    pageLabel: "Store",
    inputPlaceholder: "Ask about your store...",
    suggestedActions: [],
  },
  knowledge: {
    pageType: "knowledge",
    pageLabel: "Knowledge",
    inputPlaceholder: "Ask about the knowledge base...",
    suggestedActions: [],
  },
  "data-catalog": {
    pageType: "data-catalog",
    pageLabel: "Data Catalog",
    inputPlaceholder: "Ask about your data...",
    suggestedActions: [],
  },
  connectors: {
    pageType: "connectors",
    pageLabel: "Connectors",
    inputPlaceholder: "Ask about data connectors...",
    suggestedActions: [],
  },
  forecasting: {
    pageType: "forecasting",
    pageLabel: "Forecasting",
    inputPlaceholder: "Ask about forecasts...",
    suggestedActions: [],
  },
  canvas: {
    pageType: "canvas",
    pageLabel: "Canvas",
    inputPlaceholder: "Ask about your canvas...",
    suggestedActions: [],
  },
  billing: {
    pageType: "billing",
    pageLabel: "Billing",
    inputPlaceholder: "Ask about usage and billing...",
    suggestedActions: [],
  },
};

const DEFAULT_CONTEXT: Omit<PageContext, "entity"> = {
  pageType: "general",
  pageLabel: "Actioneer",
  inputPlaceholder: "Ask Actioneer anything...",
  suggestedActions: [],
};

/**
 * Resolve a pathname to a PageContext using longest-prefix matching.
 * Detail pages (e.g. /segments/abc) resolve to their parent type.
 */
export function getPageContext(pathname: string): PageContext {
  const segments = pathname.split("/").filter(Boolean);

  for (let len = segments.length; len > 0; len--) {
    const key = segments.slice(0, len).join("/");
    if (PAGE_CONTEXTS[key]) {
      return { ...PAGE_CONTEXTS[key] };
    }
  }

  if (segments.length > 0 && PAGE_CONTEXTS[segments[0]]) {
    return { ...PAGE_CONTEXTS[segments[0]] };
  }

  return { ...DEFAULT_CONTEXT };
}

// ── Dynamic action generation ──

function a(label: string, prompt: string): SuggestedAction {
  return { id: label.toLowerCase().replace(/\s+/g, "-"), label, description: prompt, prompt };
}


/**
 * Generate context-aware actions based on the current page + entity.
 * When an entity is present (detail page), actions reference it by name.
 * On list pages, actions are about creating/browsing.
 */
export function buildActionsForContext(ctx: PageContext): SuggestedAction[] {
  const name = ctx.entity?.name || null;
  const payload = ctx.entity?.contextPayload;

  switch (ctx.pageType) {
    case "metrics": {
      if (name && payload && !Array.isArray(payload.metrics)) {
        // Detail page — single metric with full context
        const change = payload.changePercent as number | undefined;
        const dims = payload.dimensions as string[] | undefined;
        const rels = payload.relationships as { target: string }[] | undefined;
        return [
          change != null
            ? a(`Why ${change > 0 ? "+" : ""}${Math.round(change)}%?`, `Why did ${name} change by ${change > 0 ? "+" : ""}${Math.round(change)}% recently?`)
            : a(`Trend breakdown`, `Break down ${name} by week over the last 3 months`),
          dims?.length
            ? a(`Split by ${dims[0]}`, `Break down ${name} by ${dims[0]}`)
            : a(`Top drivers`, `What user actions most influence ${name}?`),
          rels?.length
            ? a(`Impact on ${rels[0].target}`, `How does ${name} affect ${rels[0].target}?`)
            : a(`Edit ${name}`, `Edit the ${name} metric`),
        ];
      }
      // List page — use actual metric names if available
      const metrics = (payload?.metrics as { name: string; changePercent?: number }[]) || [];
      const mover = metrics.reduce<{ name: string; changePercent: number } | null>((best, m) => {
        if (m.changePercent == null) return best;
        if (!best || Math.abs(m.changePercent) > Math.abs(best.changePercent)) return { name: m.name, changePercent: m.changePercent };
        return best;
      }, null);
      return [
        mover
          ? a(`Why is ${mover.name} ${mover.changePercent > 0 ? "up" : "down"}?`, `${mover.name} changed ${mover.changePercent > 0 ? "+" : ""}${Math.round(mover.changePercent)}% — what's driving this?`)
          : a("Biggest movers", "Which metrics changed the most this week?"),
        a("Create a metric", "Create a new metric from my data"),
        a("Weekly summary", "Summarize how all metrics performed this week"),
      ];
    }

    case "segments": {
      if (name && payload && !Array.isArray(payload.segments)) {
        // Detail page — single segment
        const count = payload.userCount as number | undefined;
        return [
          a("Who are they?", `Describe the typical user in the ${name} segment`),
          count
            ? a(`${count.toLocaleString()} users — why?`, `What behavior puts these ${count.toLocaleString()} users into ${name}?`)
            : a("Segment drivers", `What behavior defines the ${name} segment?`),
          a("Find lookalikes", `Find users similar to ${name} who aren't in this segment yet`),
        ];
      }
      // List page
      const segments = (payload?.segments as { name: string; userCount?: number }[]) || [];
      const largest = segments.reduce<{ name: string; userCount: number } | null>((best, s) => {
        if (s.userCount == null) return best;
        if (!best || s.userCount > best.userCount) return { name: s.name, userCount: s.userCount };
        return best;
      }, null);
      return [
        largest
          ? a(`Deep dive: ${largest.name}`, `Analyze the ${largest.name} segment — who are the ${largest.userCount.toLocaleString()} users in it?`)
          : a("Largest segment", "Which segment has the most users and what defines them?"),
        a("Segment overlap", "Which segments have the most user overlap?"),
        a("Create a segment", "Create a new user segment"),
      ];
    }

    case "playbooks":
      if (name) {
        return [
          a(`Run ${name}`, `Run the ${name} playbook`),
          a("Check requirements", `What connectors does ${name} need before it can run?`),
          a(`Edit ${name}`, `Edit the ${name} playbook steps`),
        ];
      }
      return [
        a("Create a playbook", "Create a new playbook for a campaign or workflow"),
        a("What can I automate?", "What repetitive workflows could be turned into playbooks?"),
        a("Run a playbook", "Show me playbooks that are ready to run"),
      ];

    case "scouts":
      if (name) {
        return [
          a("Recent alerts", `What has ${name} flagged in the last 7 days?`),
          a("Tune thresholds", `Are ${name}'s thresholds too sensitive or too loose?`),
          a("Alert history", `Show the full alert history for ${name}`),
        ];
      }
      return [
        a("Create a scout", "Create a scout to monitor a metric for anomalies"),
        a("What to monitor?", "Which metrics would benefit most from automated monitoring?"),
        a("Active alerts", "Are any scouts currently firing alerts?"),
      ];

    case "data-catalog": {
      const tables = (payload?.tables as { name: string; rowCount?: number; columnCount?: number }[]) || [];
      const largest = tables.reduce<{ name: string; rowCount: number } | null>((best, t) => {
        if (t.rowCount == null) return best;
        if (!best || t.rowCount > best.rowCount) return { name: t.name, rowCount: t.rowCount };
        return best;
      }, null);
      return [
        largest
          ? a(`Explore ${largest.name}`, `Describe the ${largest.name} table — what does each column mean?`)
          : a("Explore tables", "What tables are in my data and what do they contain?"),
        a("Find join keys", `Which tables share keys and can be joined together?`),
        tables.length > 1
          ? a("Data quality", `Check for nulls, duplicates, and data quality issues across all ${tables.length} tables`)
          : a("Data quality", "Check for nulls, duplicates, and data quality issues"),
      ];
    }

    case "knowledge":
      return [
        a("Add knowledge", "Add a new knowledge entry from a URL or text"),
        a("Knowledge gaps", "What topics aren't covered in the knowledge base yet?"),
        a("Summarize", "Give me a one-paragraph summary of everything in the knowledge base"),
      ];

    case "forecasting":
      if (name) {
        return [
          a("Accuracy check", `How accurate has the ${name} forecast been vs actuals?`),
          a("What-if", `What happens to ${name} if growth slows by 20%?`),
          a("Adjust model", `Adjust the ${name} forecast parameters`),
        ];
      }
      return [
        a("Create a forecast", "Forecast a key metric for the next 30 days"),
        a("Which metric?", "Which metric would benefit most from a forecast?"),
        a("Compare models", "Compare forecast accuracy across different models"),
      ];

    case "metric-tree":
      return [
        a("Root cause", "What's driving changes in my north star metric?"),
        a("Weakest link", "Which metric in the tree is underperforming the most?"),
        a("Explain relationships", "How do these metrics influence each other?"),
      ];

    case "canvas": {
      const boards = (payload?.boards as { name: string; cardCount?: number }[]) || [];
      if (boards.length > 0) {
        return [
          a("What changed this week?", "What are the biggest metric changes this week?"),
          a("Revenue breakdown", "Break down revenue by channel and show week-over-week trend"),
          a("Find drop-offs", "Where are users dropping off in the conversion funnel?"),
        ];
      }
      return [
        a("What changed this week?", "What are the biggest metric changes this week?"),
        a("Revenue breakdown", "Break down revenue by channel and show week-over-week trend"),
        a("Find drop-offs", "Where are users dropping off in the conversion funnel?"),
      ];
    }

    case "store":
      return [
        a("Revenue drivers", "Which products drive the most revenue this month?"),
        a("Underperformers", "Which SKUs are declining in sales?"),
        a("Category breakdown", "Break down revenue by product category"),
      ];

    default:
      return [
        a("What changed?", "What metrics changed the most this week and why?"),
        a("Create a metric", "Create a new metric from my data"),
        a("Deep research", "Run a deep analysis on overall business performance"),
      ];
  }
}
