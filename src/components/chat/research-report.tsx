"use client";

import { FileText, Download, X, ExternalLink, NotebookPen, LayoutGrid } from "lucide-react";
import { MarkdownContent } from "@/lib/markdown";
import { useDataset } from "@/lib/dataset-context";


// ── Report CTA (inline in chat) ──

interface ReportCTAProps {
  onClick?: () => void;
}

export function ReportCTA({ onClick }: ReportCTAProps) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 w-full max-w-md px-4 py-3 rounded-lg border-l-4 border-l-foreground border border-border bg-card hover:bg-muted/50 transition-colors text-left"
    >
      <div className="w-8 h-8 rounded bg-muted flex items-center justify-center shrink-0">
        <FileText className="w-4 h-4 text-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">Research Report</p>
        <p className="text-xs text-muted-foreground">
          Click to view full report in side panel
        </p>
      </div>
      <ExternalLink className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
    </button>
  );
}

// ── Save as Playbook CTA (inline in chat, after deep research) ──

interface SaveAsPlaybookCTAProps {
  onClick: () => void;
}

export function SaveAsPlaybookCTA({ onClick }: SaveAsPlaybookCTAProps) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 w-full max-w-md px-4 py-3 rounded-lg border border-border bg-card hover:bg-muted/50 transition-colors text-left"
    >
      <div className="w-8 h-8 rounded bg-muted flex items-center justify-center shrink-0">
        <NotebookPen className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">Save as Playbook</p>
        <p className="text-xs text-muted-foreground">
          Turn this analysis into a reusable playbook.
        </p>
      </div>
      <ExternalLink className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
    </button>
  );
}

// ── Save as Board CTA ──

interface SaveAsBoardCTAProps {
  onClick: () => void;
  loading?: boolean;
}

export function SaveAsBoardCTA({ onClick, loading }: SaveAsBoardCTAProps) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="flex items-center gap-3 w-full max-w-md px-4 py-3 rounded-lg border border-border bg-card hover:bg-muted/50 transition-colors text-left disabled:opacity-50"
    >
      <div className="w-8 h-8 rounded bg-muted flex items-center justify-center shrink-0">
        <LayoutGrid className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{loading ? "Creating board..." : "Save as Board"}</p>
        <p className="text-xs text-muted-foreground">
          Convert this research into an interactive dashboard.
        </p>
      </div>
      <ExternalLink className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
    </button>
  );
}

// ── Report Panel (side panel) ──

interface ReportPanelProps {
  onClose: () => void;
  content?: string;
  userQuery?: string;
}

export function ReportPanel({ onClose, content, userQuery }: ReportPanelProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Research Report</h2>
          <span className="text-[9px] text-muted-foreground ml-1">3/24</span>
        </div>
        <div className="flex items-center gap-1">
          <button className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border border-border bg-muted text-foreground hover:bg-muted/80 transition-colors">
            <Download className="w-3 h-3" />
            Download PDF
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Report content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {content ? (
          <DynamicReport content={content} userQuery={userQuery} />
        ) : (
          <StaticReport />
        )}
      </div>
    </div>
  );
}

// ── Dynamic report (from real LLM response) ──

function DynamicReport({ content, userQuery }: { content: string; userQuery?: string }) {
  return (
    <div className="p-5 space-y-4">
      {userQuery && (
        <div className="border-l-4 border-l-foreground/30 bg-muted/50 px-3 py-2 rounded-r-md">
          <p className="text-[9px] uppercase tracking-wide text-muted-foreground font-medium mb-0.5">Query</p>
          <p className="text-xs text-foreground">{userQuery}</p>
        </div>
      )}
      <div className="report-prose text-sm leading-relaxed prose prose-sm prose-neutral max-w-none
        prose-headings:text-foreground
        prose-h1:text-lg prose-h1:font-bold prose-h1:mb-3 prose-h1:mt-0
        prose-h2:text-sm prose-h2:font-semibold prose-h2:mb-2 prose-h2:mt-5
        prose-h3:text-xs prose-h3:font-semibold prose-h3:mb-1.5 prose-h3:mt-3
        prose-p:text-xs prose-p:text-muted-foreground prose-p:leading-relaxed prose-p:mb-2
        prose-strong:text-foreground prose-strong:font-semibold
        prose-table:text-xs prose-table:border-collapse
        prose-th:text-left prose-th:py-1.5 prose-th:px-2 prose-th:font-medium prose-th:border prose-th:border-border prose-th:bg-muted/30
        prose-td:py-1.5 prose-td:px-2 prose-td:border prose-td:border-border
        prose-li:text-xs prose-li:text-muted-foreground
        prose-ol:pl-4 prose-ol:space-y-1
        prose-ul:pl-4 prose-ul:space-y-1
        prose-hr:my-4 prose-hr:border-border
      ">
        <MarkdownContent content={content} />
      </div>
    </div>
  );
}

// ── Static report (fallback for preloaded conversations) ──

function StaticReport() {
  const { dataset } = useDataset();

  return (
        <div className="p-5 space-y-6">
          {/* Title */}
          <h1 className="text-lg font-bold leading-tight">
            {dataset.label} Performance & Customer Behavior Deep Analysis
          </h1>

          {/* Analysis Period */}
          <div>
            <h2 className="text-sm font-semibold mb-2">Analysis Period</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <tbody>
                  <MetaRow label="Data Source" value={`DuckDB · ${dataset.reportMeta.dbName}`} />
                  <MetaRow label="Events Data" value={dataset.reportMeta.dateRangeLabel} />
                  <MetaRow label="Total Events" value={dataset.reportMeta.totalEvents} />
                  <MetaRow label="Total Users Analyzed" value={dataset.reportMeta.totalUsers} />
                  <MetaRow label="Paying Customers" value="211,402 unique buyers" />
                  <MetaRow label="Total Revenue" value="$115.3M" />
                  <MetaRow label="Duration" value="16 days" />
                </tbody>
              </table>
            </div>
          </div>

          {/* Executive Summary */}
          <div>
            <h2 className="text-sm font-semibold mb-2">Executive Summary</h2>
            <p className="text-xs text-muted-foreground leading-relaxed">
              This comprehensive analysis examines customer purchase behavior, conversion funnel
              performance, category and brand dynamics, cart abandonment patterns, and
              pricing optimization opportunities across the {dataset.label.toLowerCase()}.
            </p>
          </div>

          {/* Key Findings */}
          <div>
            <div className="bg-foreground text-background px-3 py-2 rounded-t-lg">
              <h2 className="text-sm font-semibold">Key Findings at a Glance</h2>
            </div>
            <div className="border border-t-0 border-border rounded-b-lg overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left py-2 px-3 font-medium">Category</th>
                    <th className="text-left py-2 px-3 font-medium">Finding</th>
                    <th className="text-left py-2 px-3 font-medium">Implication</th>
                  </tr>
                </thead>
                <tbody>
                  <FindingRow
                    category="Conversion Funnel"
                    finding="View → Cart: 4.8%, Cart → Purchase: 62.3%, overall conversion: 2.98%"
                    implication="Cart-to-purchase is strong; focus on view-to-cart"
                  />
                  <FindingRow
                    category="Revenue Concentration"
                    finding="Electronics drives 68% of revenue; top 10 brands account for 45% of sales"
                    implication="High category dependency risk"
                  />
                  <FindingRow
                    category="Cart Abandonment"
                    finding="37.7% cart abandonment rate; highest in Apparel (52%) and Furniture (48%)"
                    implication="Category-specific recovery strategies needed"
                  />
                  <FindingRow
                    category="Customer Segments"
                    finding="High-value customers (3.1%) generate 52% of revenue; 12% are cart abandoners"
                    implication="Focus on HV retention + abandoner recovery"
                  />
                  <FindingRow
                    category="Peak Hours"
                    finding="Traffic peaks at 10 AM UTC; purchases peak 9-11 AM with secondary peak 6-8 PM"
                    implication="Optimize promotions for peak windows"
                  />
                </tbody>
              </table>
            </div>
          </div>

          {/* Conversion Funnel Section */}
          <div>
            <h2 className="text-sm font-semibold mb-1">
              5. Conversion Funnel Analysis
            </h2>
            <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
              <strong>Key Question:</strong> Where are users dropping off in the purchase journey?
            </p>

            <h3 className="text-xs font-semibold mb-2">
              5.1 Funnel by Category
            </h3>
            <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
              <strong>Key Finding:</strong> Conversion rates vary significantly by category, with Electronics outperforming all others.
            </p>

            {/* Category funnel table */}
            <div className="overflow-x-auto mb-4">
              <table className="w-full text-xs border-collapse border border-border">
                <thead>
                  <tr className="bg-muted/30">
                    <th className="text-left py-1.5 px-2 font-medium border border-border">Category</th>
                    <th className="text-left py-1.5 px-2 font-medium border border-border">Views</th>
                    <th className="text-left py-1.5 px-2 font-medium border border-border">Cart Rate</th>
                    <th className="text-left py-1.5 px-2 font-medium border border-border">Purchase Rate</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="py-1.5 px-2 border border-border">Electronics</td>
                    <td className="py-1.5 px-2 border border-border">12.4M</td>
                    <td className="py-1.5 px-2 border border-border">5.2%</td>
                    <td className="py-1.5 px-2 border border-border">3.4%</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 px-2 border border-border">Appliances</td>
                    <td className="py-1.5 px-2 border border-border">4.8M</td>
                    <td className="py-1.5 px-2 border border-border">6.1%</td>
                    <td className="py-1.5 px-2 border border-border">4.2%</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 px-2 border border-border">Computers</td>
                    <td className="py-1.5 px-2 border border-border">3.2M</td>
                    <td className="py-1.5 px-2 border border-border">4.7%</td>
                    <td className="py-1.5 px-2 border border-border">2.9%</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 px-2 border border-border">Furniture</td>
                    <td className="py-1.5 px-2 border border-border">1.9M</td>
                    <td className="py-1.5 px-2 border border-border">3.8%</td>
                    <td className="py-1.5 px-2 border border-border">1.8%</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 px-2 border border-border">Apparel</td>
                    <td className="py-1.5 px-2 border border-border">1.1M</td>
                    <td className="py-1.5 px-2 border border-border">3.2%</td>
                    <td className="py-1.5 px-2 border border-border">1.5%</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Chart placeholder */}
            <div className="border border-border rounded-lg p-4 bg-muted/20">
              <p className="text-xs font-medium mb-3">
                Conversion Rate by Category (View → Purchase)
              </p>
              <RetentionChart />
            </div>
          </div>

          {/* Insights Summary */}
          <div className="space-y-2">
            <h2 className="text-sm font-semibold">Insights</h2>
            {[
              { text: "Cart-to-purchase conversion (62.3%) is strong. The bottleneck is getting users to add to cart", confidence: "High" },
              { text: "Electronics dominance (68% revenue) creates category concentration risk", confidence: "High" },
              { text: "High-value segment (3.1%) drives 52% of revenue. Retention is critical", confidence: "High" },
              { text: "Cart abandoners (12% of users) represent $8.2M recovery opportunity", confidence: "Medium" },
            ].map((insight, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-foreground mt-0.5">•</span>
                <span className="text-xs text-muted-foreground flex-1">{insight.text}</span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full shrink-0 ${
                  insight.confidence === "High"
                    ? "bg-muted text-foreground"
                    : "bg-muted text-muted-foreground"
                }`}>
                  {insight.confidence}
                </span>
              </div>
            ))}
          </div>

          {/* Key Validated Insights */}
          <div>
            <h2 className="text-sm font-semibold mb-2">
              Key Validated Insights
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse border border-border">
                <thead>
                  <tr className="bg-muted/30">
                    <th className="text-left py-1.5 px-2 font-medium border border-border">Insight</th>
                    <th className="text-left py-1.5 px-2 font-medium border border-border">Evidence</th>
                    <th className="text-left py-1.5 px-2 font-medium border border-border">Confidence</th>
                    <th className="text-left py-1.5 px-2 font-medium border border-border">Significance</th>
                  </tr>
                </thead>
                <tbody>
                  <InsightRow
                    insight="View-to-cart is the primary funnel bottleneck"
                    evidence="Only 4.8% of views convert to cart adds"
                    confidence="High"
                    significance="p < 0.0001"
                  />
                  <InsightRow
                    insight="Appliances has highest category conversion"
                    evidence="4.2% view-to-purchase vs 2.98% avg"
                    confidence="High"
                    significance="p < 0.0003"
                  />
                  <InsightRow
                    insight="Repeat buyers drive disproportionate revenue"
                    evidence="18.4% repeat rate, 41% of total revenue"
                    confidence="High"
                    significance="p < 0.0001"
                  />
                  <InsightRow
                    insight="Samsung leads volume, Apple leads AOV"
                    evidence="Samsung: 23K orders; Apple: $342 AOV"
                    confidence="High"
                    significance="p < 0.0002"
                  />
                  <InsightRow
                    insight="Morning peak drives highest conversion"
                    evidence="9-11 AM: 3.8% conversion vs 2.1% overnight"
                    confidence="Medium"
                    significance="p < 0.0005"
                  />
                </tbody>
              </table>
            </div>
          </div>

          {/* Conclusion */}
          <div>
            <h2 className="text-sm font-semibold mb-2">Conclusion</h2>
            <p className="text-xs text-muted-foreground leading-relaxed">
              The store shows a healthy conversion pipeline with a strong cart-to-purchase rate
              (62.3%), but the primary opportunity lies in improving the view-to-cart step.
              Revenue is heavily concentrated in Electronics (68%), suggesting diversification
              opportunities in high-performing categories like Appliances. The 12% cart abandoner
              segment represents a significant revenue recovery opportunity, while the high-value
              customer segment (3.1% of users, 52% of revenue) warrants dedicated retention
              strategies.
            </p>
          </div>

          {/* Suggested deep dives */}
          <div>
            <h2 className="text-sm font-semibold mb-2">
              Suggested Further Deep-Dives
            </h2>
            <ol className="space-y-1.5 text-xs text-muted-foreground list-decimal pl-4">
              <li>
                <strong>Cart abandonment analysis</strong>: What product attributes correlate with higher abandonment rates?
              </li>
              <li>
                <strong>Cross-sell opportunities</strong>: Which product pairs are most commonly purchased together?
              </li>
              <li>
                <strong>Price sensitivity</strong>: How do price changes in Electronics affect conversion in other categories?
              </li>
              <li>
                <strong>Session-level funnel</strong>: Map the full user session journey from first view to purchase
              </li>
              <li>
                <strong>Brand switching</strong>: When users abandon a brand, where do they go next?
              </li>
            </ol>
          </div>

          {/* Footer metadata */}
          <div className="pt-2 border-t border-border">
            <p className="text-[9.9px] text-muted-foreground">
              <strong>Data Period:</strong> Nov 1-16, 2019 |{" "}
              <strong>Users Analyzed:</strong> 2.36M |{" "}
              <strong>Buyers:</strong> 211,402 |{" "}
              <strong>Revenue:</strong> $115.3M
            </p>
          </div>
        </div>
  );
}

// ── Helper components ──

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-b border-border/50">
      <td className="py-1.5 pr-4 font-medium text-muted-foreground whitespace-nowrap">
        {label}
      </td>
      <td className="py-1.5">{value}</td>
    </tr>
  );
}

function FindingRow({
  category,
  finding,
  implication,
}: {
  category: string;
  finding: string;
  implication: string;
}) {
  return (
    <tr className="border-b border-border/50">
      <td className="py-2 px-3 font-medium whitespace-nowrap align-top">
        {category}
      </td>
      <td className="py-2 px-3 text-muted-foreground">{finding}</td>
      <td className="py-2 px-3 text-muted-foreground">{implication}</td>
    </tr>
  );
}

function InsightRow({
  insight,
  evidence,
  confidence,
  significance,
}: {
  insight: string;
  evidence: string;
  confidence: string;
  significance: string;
}) {
  return (
    <tr className="border-b border-border/50">
      <td className="py-1.5 px-2 border border-border">{insight}</td>
      <td className="py-1.5 px-2 border border-border text-muted-foreground">
        {evidence}
      </td>
      <td className="py-1.5 px-2 border border-border">
        <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
          confidence === "High"
            ? "bg-muted text-foreground"
            : "bg-muted text-muted-foreground"
        }`}>
          {confidence}
        </span>
      </td>
      <td className="py-1.5 px-2 border border-border text-muted-foreground font-mono">
        {significance}
      </td>
    </tr>
  );
}

function RetentionChart() {
  const data = [
    { label: "Apparel", value: 1.5 },
    { label: "Furniture", value: 1.8 },
    { label: "Computers", value: 2.9 },
    { label: "Electronics", value: 3.4 },
    { label: "Appliances", value: 4.2 },
  ];
  const maxVal = 5;
  const chartH = 120;
  const chartW = 280;
  const barW = 36;
  const gap = 20;
  const startX = 30;

  return (
    <svg
      viewBox={`0 0 ${chartW} ${chartH + 30}`}
      className="w-full max-w-[280px]"
    >
      {/* Y axis labels */}
      {[0, 2, 4].map((v) => {
        const y = chartH - (v / maxVal) * chartH;
        return (
          <g key={v}>
            <text
              x={22}
              y={y + 3}
              textAnchor="end"
              className="text-[7.2px] fill-muted-foreground"
            >
              {v}%
            </text>
            <line
              x1={startX}
              y1={y}
              x2={chartW}
              y2={y}
              stroke="currentColor"
              className="text-border"
              strokeDasharray="2,2"
            />
          </g>
        );
      })}

      {/* Bars */}
      {data.map((d, i) => {
        const x = startX + i * (barW + gap);
        const barH = (d.value / maxVal) * chartH;
        const y = chartH - barH;
        return (
          <g key={d.label}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={barH}
              rx={3}
              fill={["#8b5cf6", "#7c3aed", "#6d28d9", "#0d9488", "#10b981"][i]}
              opacity={0.85}
            />
            <text
              x={x + barW / 2}
              y={y - 4}
              textAnchor="middle"
              className="text-[6.3px] fill-foreground font-medium"
            >
              {d.value}%
            </text>
            <text
              x={x + barW / 2}
              y={chartH + 12}
              textAnchor="middle"
              className="text-[6.3px] fill-muted-foreground"
            >
              {d.label}
            </text>
          </g>
        );
      })}

      {/* Trend line */}
      <polyline
        points={data
          .map((d, i) => {
            const x = startX + i * (barW + gap) + barW / 2;
            const y = chartH - (d.value / maxVal) * chartH;
            return `${x},${y}`;
          })
          .join(" ")}
        fill="none"
        stroke="#f59e0b"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {data.map((d, i) => {
        const cx = startX + i * (barW + gap) + barW / 2;
        const cy = chartH - (d.value / maxVal) * chartH;
        return (
          <circle key={`dot-${i}`} cx={cx} cy={cy} r="2.5" fill="#f59e0b" />
        );
      })}
    </svg>
  );
}
