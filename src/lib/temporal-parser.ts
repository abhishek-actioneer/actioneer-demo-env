import type { DetectedDateRange } from "./entity-types";

/** Format a Date as ISO date string (YYYY-MM-DD) */
function toISO(date: Date): string {
  return date.toISOString().split("T")[0];
}

function today(): Date {
  return new Date();
}

function subDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - n);
  return d;
}

function subWeeks(date: Date, n: number): Date {
  return subDays(date, n * 7);
}

function subMonths(date: Date, n: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() - n);
  return d;
}

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  return d;
}

function startOfMonth(date: Date): Date {
  const d = new Date(date);
  d.setDate(1);
  return d;
}

function endOfMonth(date: Date): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + 1);
  d.setDate(0); // Last day of previous month
  return d;
}

const MONTH_NAMES: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3,
  may: 4, june: 5, july: 6, august: 7,
  september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3,
  jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const MONTH_PATTERN = new RegExp(
  `\\b(?:in|for|during|of)\\s+(${Object.keys(MONTH_NAMES).join("|")})(?:\\s+(\\d{4}))?\\b`,
  "i",
);

const BARE_MONTH_PATTERN = new RegExp(
  `\\b(${Object.keys(MONTH_NAMES).join("|")})(?:\\s+(\\d{4}))?\\b`,
  "i",
);

interface TemporalPattern {
  pattern: RegExp;
  resolve: (match: RegExpMatchArray) => { start: Date; phrase: string };
}

const TEMPORAL_PATTERNS: TemporalPattern[] = [
  {
    pattern: /\blast\s+(\d+)\s+days?\b/i,
    resolve: (m) => ({
      start: subDays(today(), parseInt(m[1])),
      phrase: m[0],
    }),
  },
  {
    pattern: /\blast\s+(\d+)\s+weeks?\b/i,
    resolve: (m) => ({
      start: subWeeks(today(), parseInt(m[1])),
      phrase: m[0],
    }),
  },
  {
    pattern: /\blast\s+(\d+)\s+months?\b/i,
    resolve: (m) => ({
      start: subMonths(today(), parseInt(m[1])),
      phrase: m[0],
    }),
  },
  {
    pattern: /\bthis\s+week\b/i,
    resolve: (m) => ({
      start: startOfWeek(today()),
      phrase: m[0],
    }),
  },
  {
    pattern: /\blast\s+week\b/i,
    resolve: (m) => ({
      start: startOfWeek(subWeeks(today(), 1)),
      phrase: m[0],
    }),
  },
  {
    pattern: /\bthis\s+month\b/i,
    resolve: (m) => ({
      start: startOfMonth(today()),
      phrase: m[0],
    }),
  },
  {
    pattern: /\blast\s+month\b/i,
    resolve: (m) => ({
      start: startOfMonth(subMonths(today(), 1)),
      phrase: m[0],
    }),
  },
  {
    pattern: /\byesterday\b/i,
    resolve: (m) => ({
      start: subDays(today(), 1),
      phrase: m[0],
    }),
  },
  {
    pattern: /\btoday\b/i,
    resolve: (m) => ({
      start: today(),
      phrase: m[0],
    }),
  },
  {
    pattern: /\bpast\s+(\d+)\s+days?\b/i,
    resolve: (m) => ({
      start: subDays(today(), parseInt(m[1])),
      phrase: m[0],
    }),
  },
];

/**
 * Detect a date range from user input text.
 * Returns the first matching temporal phrase, or a default 30-day range.
 */
export function detectDateRange(inputText: string): DetectedDateRange {
  for (const { pattern, resolve } of TEMPORAL_PATTERNS) {
    const match = inputText.match(pattern);
    if (match) {
      const { start, phrase } = resolve(match);
      return {
        phrase,
        start: toISO(start),
        end: toISO(today()),
        isDefault: false,
      };
    }
  }

  // Check for month names: "in November", "for October", or bare "November 2025"
  const monthMatch = inputText.match(MONTH_PATTERN) || inputText.match(BARE_MONTH_PATTERN);
  if (monthMatch) {
    const monthName = monthMatch[1].toLowerCase();
    const monthIdx = MONTH_NAMES[monthName];
    if (monthIdx !== undefined) {
      const year = monthMatch[2] ? parseInt(monthMatch[2]) : today().getFullYear();
      const start = new Date(year, monthIdx, 1);
      const end = endOfMonth(start);
      const label = start.toLocaleString("en-US", { month: "long", year: "numeric" });
      return {
        phrase: label,
        start: toISO(start),
        end: toISO(end),
        isDefault: false,
      };
    }
  }

  // Default: last 30 days
  return {
    phrase: "Last 30 days",
    start: toISO(subDays(today(), 30)),
    end: toISO(today()),
    isDefault: true,
  };
}
