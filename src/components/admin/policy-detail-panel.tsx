"use client";

import { useState, useCallback } from "react";
import { X, Trash2, CheckCircle2, XCircle, ChevronRight, Copy, Check } from "lucide-react";
import type { DataPolicy } from "@/lib/policy-types";
import { deletePolicy } from "@/lib/policy-store";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface PolicyDetailPanelProps {
  policy: DataPolicy;
  onClose: () => void;
  onDelete: () => void;
  onPolicyChanged: () => void;
}

interface TestResult {
  allowed: boolean;
  reason: string;
}

function PolicyJsonSection({ policy }: { policy: DataPolicy }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const policyJson = JSON.stringify(
    {
      name: policy.name,
      description: policy.description,
      tableAccess: policy.tableAccess,
    },
    null,
    2,
  );

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(policyJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [policyJson]);

  return (
    <div className="border-t border-border pt-4 space-y-2">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
      >
        <ChevronRight className={`w-3 h-3 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`} />
        Policy JSON
      </button>
      {expanded && (
        <div className="relative">
          <button
            onClick={handleCopy}
            className="absolute top-2 right-2 p-1 rounded hover:bg-muted transition-colors"
            title="Copy JSON"
          >
            {copied ? (
              <Check className="w-3 h-3 text-foreground" />
            ) : (
              <Copy className="w-3 h-3 text-muted-foreground" />
            )}
          </button>
          <pre className="text-[9px] font-mono text-foreground bg-muted/50 border border-border rounded-md p-3 pr-8 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre">
            {policyJson}
          </pre>
        </div>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
      {children}
    </div>
  );
}

function testSqlAgainstPolicy(sql: string, policy: DataPolicy): TestResult {
  const normalizedSql = sql.toUpperCase().replace(/\s+/g, " ").trim();

  for (const rule of policy.tableAccess) {
    const tableUpper = rule.tableName.toUpperCase();

    // Check if this SQL references the table
    if (!normalizedSql.includes(tableUpper)) continue;

    // Check SELECT *
    if (!rule.allowSelectStar && normalizedSql.includes("SELECT *")) {
      return {
        allowed: false,
        reason: `SELECT * is not allowed on table "${rule.tableName}".`,
      };
    }

    // Check column access
    if (!rule.allowAllColumns) {
      // Extract the SELECT clause — between SELECT and FROM
      const selectMatch = normalizedSql.match(/SELECT\s+(.*?)\s+FROM/);
      if (selectMatch) {
        const selectClause = selectMatch[1];
        // Split by comma and extract column names (strip aliases, table prefixes)
        const cols = selectClause.split(",").map((part) => {
          // Take the last word segment (handles "table.col" and "col AS alias")
          const clean = part.trim().replace(/\s+AS\s+\w+$/i, "");
          const dotIdx = clean.lastIndexOf(".");
          return dotIdx >= 0 ? clean.slice(dotIdx + 1).trim() : clean.trim();
        });

        const allowedUpper = rule.allowedColumns.map((c) => c.toUpperCase());
        for (const col of cols) {
          if (col === "*") continue; // already handled above
          if (!allowedUpper.includes(col)) {
            return {
              allowed: false,
              reason: `Column "${col.toLowerCase()}" is not in the allowed columns list for table "${rule.tableName}".`,
            };
          }
        }
      }
    }

    // Check row filter
    if (rule.rowFilter) {
      const filterNormalized = rule.rowFilter.toUpperCase().replace(/\s+/g, " ").trim();
      if (!normalizedSql.includes(filterNormalized)) {
        return {
          allowed: false,
          reason: `Required row filter is missing: ${rule.rowFilter}`,
        };
      }
    }
  }

  return { allowed: true, reason: "Query satisfies all policy constraints." };
}

export function PolicyDetailPanel({ policy, onClose, onDelete }: PolicyDetailPanelProps) {
  const [testSql, setTestSql] = useState("");
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  function handleTestSqlChange(value: string) {
    setTestSql(value);
    setTestResult(null);
  }

  function handleTestQuery() {
    if (!testSql.trim()) return;
    setTestResult(testSqlAgainstPolicy(testSql, policy));
  }

  function handleDelete() {
    deletePolicy(policy.id);
    onDelete();
  }

  return (
    <div className="w-[340px] shrink-0 border border-border rounded-xl p-5 space-y-5 h-fit sticky top-0">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground truncate">{policy.name}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{policy.description}</p>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-muted shrink-0">
          <X className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>

      {/* Sections per table access rule */}
      {policy.tableAccess.map((rule, idx) => (
        <div key={idx} className="space-y-4">
          <Section label="Datasource">
            <p className="text-xs text-foreground">{policy.datasetId}</p>
          </Section>

          <Section label="Table">
            <p className="text-xs font-mono text-foreground">{rule.tableName}</p>
          </Section>

          {rule.allowedColumns.length > 0 && (
            <Section label="Allowed Columns">
              <div className="flex flex-wrap gap-1.5">
                {rule.allowedColumns.map((col) => (
                  <span
                    key={col}
                    className="text-xs px-2 py-0.5 rounded-md bg-muted text-foreground font-mono"
                  >
                    {col}
                  </span>
                ))}
              </div>
            </Section>
          )}

          <Section label="Access Flags">
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">SELECT *</span>
                <span className="text-xs text-foreground font-medium">
                  {rule.allowSelectStar ? "Allowed" : "Blocked"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">All columns</span>
                <span className="text-xs text-foreground font-medium">
                  {rule.allowAllColumns ? "Allowed" : "Restricted"}
                </span>
              </div>
            </div>
          </Section>

          {rule.rowFilter && (
            <Section label="Row Filter">
              <div className="space-y-1">
                <p className="text-xs font-mono bg-muted px-2 py-1.5 rounded-md text-foreground">
                  {rule.rowFilter}
                </p>
                {rule.rowFilterDescription && (
                  <p className="text-xs text-muted-foreground">{rule.rowFilterDescription}</p>
                )}
              </div>
            </Section>
          )}
        </div>
      ))}

      {/* Test Policy section */}
      <div className="border-t border-border pt-4 space-y-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Test Policy
        </p>
        <textarea
          value={testSql}
          onChange={(e) => handleTestSqlChange(e.target.value)}
          placeholder="SELECT event_date, event_name FROM events WHERE YEAR(event_date) = 2026"
          className="w-full h-20 text-xs font-mono bg-muted/50 border border-border rounded-md px-2.5 py-2 resize-none text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-border"
        />
        <button
          onClick={handleTestQuery}
          disabled={!testSql.trim()}
          className="w-full py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Test Query
        </button>

        {testResult && (
          <div
            className={`flex items-start gap-2 rounded-md px-3 py-2 text-xs ${
              testResult.allowed
                ? "bg-muted text-foreground"
                : "bg-muted text-foreground"
            }`}
          >
            {testResult.allowed ? (
              <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0 text-foreground" />
            ) : (
              <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" />
            )}
            <div className="space-y-0.5">
              <p className="font-medium">{testResult.allowed ? "Allowed" : "Blocked"}</p>
              <p className="text-muted-foreground">{testResult.reason}</p>
            </div>
          </div>
        )}
      </div>

      {/* Policy JSON */}
      <PolicyJsonSection policy={policy} />

      {/* Delete button */}
      <div className="border-t border-border pt-4">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <Trash2 className="w-3.5 h-3.5" />
              Delete policy
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete policy</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete &ldquo;{policy.name}&rdquo;? This action cannot be
                undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
