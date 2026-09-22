import {
  ShieldCheck,
  BarChart3,
  Users,
  DollarSign,
  Clock,
  Globe,
  CheckCircle2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// ── SQL Keywords (canonical set, merged from all consumers) ──

export const SQL_KEYWORDS = new Set([
  "SELECT", "FROM", "WHERE", "GROUP", "BY", "ORDER", "JOIN", "ON", "AS",
  "AND", "OR", "NOT", "IN", "IS", "NULL", "CASE", "WHEN", "THEN", "ELSE",
  "END", "WITH", "DISTINCT", "COUNT", "SUM", "AVG", "MIN", "MAX", "LIMIT",
  "HAVING", "INTO", "VALUES", "SET", "BETWEEN", "LIKE", "EXISTS", "ASC",
  "DESC", "INNER", "LEFT", "RIGHT", "OUTER", "CROSS", "CURRENT_DATE",
  "DATE_DIFF", "DAY", "FLOAT64", "ROUND", "OVER", "CAST", "TABLE", "IF",
  "DATE", "CREATE", "VIEW", "REPLACE", "INTERVAL",
]);

// ── SQL Highlighted component (Tailwind classes, for chat/panel contexts) ──

export function SqlHighlighted({ sql }: { sql: string }) {
  return (
    <>
      {sql.split("\n").map((line, li) => (
        <div key={li}>
          {line.trim().startsWith("--") ? (
            <span className="text-zinc-400 dark:text-zinc-500">{line}</span>
          ) : (
            line.split(/(\s+|[(),;`*]|'[^']*')/).map((token, ti) => {
              if (SQL_KEYWORDS.has(token.toUpperCase())) {
                return <span key={ti} className="text-blue-600 dark:text-blue-400">{token}</span>;
              }
              if (token.startsWith("'") && token.endsWith("'")) {
                return <span key={ti} className="text-amber-600 dark:text-amber-300">{token}</span>;
              }
              if (/^\d+$/.test(token)) {
                return <span key={ti} className="text-cyan-600 dark:text-cyan-300">{token}</span>;
              }
              return <span key={ti} className="text-emerald-700 dark:text-emerald-400">{token}</span>;
            })
          )}
        </div>
      ))}
    </>
  );
}

// ── Inline-style SQL highlighter (for canvas renderers where Tailwind is unavailable) ──

export function highlightSqlInline(sql: string) {
  return sql.split(/(\s+|[(),;`*]|'[^']*')/).map((token, i) => {
    if (SQL_KEYWORDS.has(token.toUpperCase())) {
      return <span key={i} style={{ fontWeight: 600 }}>{token}</span>;
    }
    if (token.startsWith("'") && token.endsWith("'")) {
      return <span key={i} style={{ color: "var(--muted-foreground)" }}>{token}</span>;
    }
    if (/^\d+$/.test(token)) {
      return <span key={i} style={{ color: "var(--muted-foreground)" }}>{token}</span>;
    }
    return <span key={i}>{token}</span>;
  });
}

// ── Agent Icons (canonical map, merged from sources-panel + working-trace) ──

const AGENT_ICONS: Record<string, LucideIcon> = {
  "data-quality": ShieldCheck,
  "daily-metrics": BarChart3,
  "cohort-retention": Users,
  "rev-opt": DollarSign,
  "user-segmentation": Clock,
  geographic: Globe,
  research: Globe,
  "data-analysis": BarChart3,
  "marketing-optimization": DollarSign,
  critique: CheckCircle2,
};

export { AGENT_ICONS };

export function getAgentIcon(id: string): LucideIcon | undefined {
  return AGENT_ICONS[id];
}
