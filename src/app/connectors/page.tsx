"use client";

import Image from "next/image";
import { useState, useCallback, Suspense } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Search,
  Plus,
  Loader2,
  RefreshCw,
  Upload,
  Check,
  Copy,
  KeyRound,
  Lock,
  Shield,
  ChevronRight,
  Link2,
  X,
  AlertCircle,
  AlertTriangle,
  Database,
} from "lucide-react";
import { getIssuesForConnector } from "@/lib/connector-issues";
import { CONNECTOR_CATEGORIES, type ConnectorCategory } from "@/lib/connector-categories";
import { ConnectorModal } from "@/components/connectors/connector-modal";
import { ConnectorLogo } from "@/components/connectors/connector-logo";
import {
  ACTIVE_CONNECTIONS,
  CONNECTION_COUNTS,
  connectorSlug,
  getSubLabel,
  type SubStatus,
} from "@/lib/active-connections";

/* ─────────────────────────────────────────────
   Types
   ───────────────────────────────────────────── */

interface SelectedConnector {
  name: string;
  category: ConnectorCategory;
}

/* ─────────────────────────────────────────────
   Connection form field configs
   ───────────────────────────────────────────── */

interface ConnectorField {
  label: string;
  placeholder: string;
  type?: "text" | "password" | "textarea";
  rows?: number;
  monospace?: boolean;
  helpText?: string;
}

const CONNECTOR_FIELDS: Record<string, ConnectorField[]> = {
  BigQuery: [
    { label: "Connection Name", placeholder: "My Production Database" },
    { label: "Database Name",   placeholder: "analytics_db" },
    { label: "Host",            placeholder: "db.example.com" },
    { label: "Port",            placeholder: "5432" },
    { label: "Username",        placeholder: "admin" },
    { label: "Password",        placeholder: "••••••••", type: "password" },
  ],
  Snowflake: [
    { label: "Connection Name", placeholder: "Analytics Warehouse" },
    { label: "Account URL",     placeholder: "org-account.snowflakecomputing.com" },
    { label: "Database",        placeholder: "ANALYTICS" },
    { label: "Warehouse",       placeholder: "COMPUTE_WH" },
    { label: "Username",        placeholder: "sentinel_user" },
    { label: "Password",        placeholder: "••••••••", type: "password" },
  ],
  PostgreSQL: [
    { label: "Connection Name", placeholder: "Production DB" },
    { label: "Database Name",   placeholder: "myapp_production" },
    { label: "Host",            placeholder: "db.example.com" },
    { label: "Port",            placeholder: "5432" },
    { label: "Username",        placeholder: "admin" },
    { label: "Password",        placeholder: "••••••••", type: "password" },
  ],
};

function getConnectorFields(name: string): ConnectorField[] {
  return CONNECTOR_FIELDS[name] ?? [
    { label: "Connection Name", placeholder: `My ${name} Connection` },
    { label: "Account ID",      placeholder: `Your ${name} account identifier` },
    { label: "API Key",         placeholder: `Your ${name} API key` },
    { label: "API Secret",      placeholder: `Your ${name} API secret`, type: "password" },
  ];
}

const WHITELIST_IP = "35.244.14.238";

/* ─────────────────────────────────────────────
   Page wrapper
   ───────────────────────────────────────────── */

export default function ConnectorsPageWrapper() {
  return (
    <Suspense>
      <ConnectorsPage />
    </Suspense>
  );
}

/* ─────────────────────────────────────────────
   Main page
   ───────────────────────────────────────────── */

function ConnectorsPage() {
  const router = useRouter();
  const [searchQuery,         setSearchQuery]       = useState("");
  const [refreshing,          setRefreshing]        = useState(false);
  const [selectedConnector,   setSelectedConnector] = useState<SelectedConnector | null>(null);
  const [connectingConnector, setConnectingConnector] = useState<{
    name: string; category: ConnectorCategory; connectionName: string;
  } | null>(null);

  const handleSelect = useCallback((name: string, cat: ConnectorCategory) => {
    setSelectedConnector({ name, category: cat });
  }, []);

  function handleRefresh() {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1200);
  }

  const filteredConnections = searchQuery
    ? ACTIVE_CONNECTIONS.filter(
        (c) =>
          c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          c.subConnections.some((s) =>
            s.name.toLowerCase().includes(searchQuery.toLowerCase())
          )
      )
    : ACTIVE_CONNECTIONS;

  return (
    <div className="flex flex-col h-full min-w-0">
      <main className="flex-1 overflow-y-auto">
        {connectingConnector ? (
          <ConnectionFormPage
            name={connectingConnector.name}
            category={connectingConnector.category}
            connectionName={connectingConnector.connectionName}
            onBack={() => setConnectingConnector(null)}
          />
        ) : (
          <div className="max-w-5xl mx-auto px-6 py-8">

            {/* ── Action bar ── */}
            <div
              className="flex items-center gap-3 mb-8 animate-fade-in-up"
              style={{ animationDelay: "50ms", animationFillMode: "backwards" }}
            >
              <h1 className="text-xl font-semibold text-foreground">Connectors</h1>
              <div
                className="relative"
                style={{ transition: "transform 0.2s ease" }}
                onMouseEnter={e => (e.currentTarget.style.transform = "scale(0.99)")}
                onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}
                onPointerDown={e => (e.currentTarget.style.transform = "scale(0.97)")}
                onPointerUp={e => (e.currentTarget.style.transform = "scale(0.99)")}
                onPointerLeave={e => (e.currentTarget.style.transform = "scale(1)")}
              >
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search Connectors"
                  spellCheck={false}
                  autoComplete="off"
                  className="w-72 pl-8 pr-9 py-2 text-sm border border-border rounded-lg bg-card placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring/20"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-0.5 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
                    style={{ color: "var(--muted-foreground)" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "var(--connector-surface-hover)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "")}
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
              <div className="ml-auto flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleRefresh}
                  disabled={refreshing}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-medium border border-border rounded-md bg-background hover:bg-muted/50 transition-colors disabled:opacity-50"
                  style={{ transition: "transform 0.2s ease" }}
                  onMouseEnter={e => (e.currentTarget.style.transform = "scale(0.99)")}
                  onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}
                  onPointerDown={e => (e.currentTarget.style.transform = "scale(0.97)")}
                  onPointerUp={e => (e.currentTarget.style.transform = "scale(0.99)")}
                  onPointerLeave={e => (e.currentTarget.style.transform = "scale(1)")}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={() => router.push("/connectors/add-connectors")}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-medium bg-foreground text-background rounded-md hover:bg-foreground/90 transition-colors"
                  style={{ transition: "transform 0.2s ease" }}
                  onMouseEnter={e => (e.currentTarget.style.transform = "scale(0.99)")}
                  onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}
                  onPointerDown={e => (e.currentTarget.style.transform = "scale(0.97)")}
                  onPointerUp={e => (e.currentTarget.style.transform = "scale(0.99)")}
                  onPointerLeave={e => (e.currentTarget.style.transform = "scale(1)")}
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Connectors
                </button>
              </div>
            </div>

            {/* ── Connector cards ── */}
            <div
              className="space-y-2.5 animate-fade-in-up"
              style={{ animationDelay: "90ms", animationFillMode: "backwards", opacity: refreshing ? 0.4 : 1, transition: "opacity 0.3s ease" }}
            >
              {filteredConnections.length === 0 ? (
                <div className="min-h-[60vh] flex flex-col items-center justify-center text-center">
                  <Database className="size-10 text-muted-foreground mb-4" />
                  <p className="text-sm text-muted-foreground">No connections found.</p>
                </div>
              ) : (
                filteredConnections.map((conn) => {
                  const category = CONNECTOR_CATEGORIES.find((c) => c.id === conn.categoryId)!;
                  const subLabel  = getSubLabel(conn.categoryId);
                  const errorCount   = conn.subConnections.filter((s) => s.status === "error").length;
                  const syncingCount = conn.subConnections.filter((s) => s.status === "syncing").length;

                  const connIssues = getIssuesForConnector(conn.name);
                  const hasIssueError = connIssues.some(i => i.severity === "error");
                  const hasIssueWarning = connIssues.some(i => i.severity === "warning");

                  return (
                    <button
                      key={conn.name}
                      type="button"
                      onClick={() => router.push(`/connectors/${connectorSlug(conn.name)}`)}
                      className="w-full flex items-center gap-3 p-3 rounded-xl text-left"
                      style={{ background: "var(--connector-surface)", border: "1px solid var(--connector-border)", transition: "transform 0.2s ease" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(0.99)"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"; }}
                      onPointerDown={e => (e.currentTarget.style.transform = "scale(0.97)")}
                      onPointerUp={e => (e.currentTarget.style.transform = "scale(0.99)")}
                      onPointerLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"; }}
                    >
                      {/* Logo */}
                      <div className="w-8 h-8 rounded-[7px] bg-muted overflow-hidden shrink-0 flex items-center justify-center">
                        <ConnectorLogo name={conn.name} fallbackIcon={category.icon} size={32} />
                      </div>

                      {/* Name + meta */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground">{conn.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {conn.connectionName} · {conn.subConnections.length} {subLabel.charAt(0).toUpperCase() + subLabel.slice(1)}{conn.subConnections.length !== 1 ? "s" : ""}
                          {conn.refreshedAt && <> · {conn.refreshedAt}</>}
                        </p>
                      </div>

                      {/* Status + chevron */}
                      <div className="flex items-center gap-2.5 shrink-0">
                        <ConnectorStatus
                          errorCount={errorCount}
                          syncingCount={syncingCount}
                          hasIssueError={hasIssueError}
                          hasIssueWarning={hasIssueWarning}
                        />
                        <ChevronRight className="w-4 h-4 text-muted-foreground/30" />
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* ── Add connector CTA (CSV) ── */}
            <div
              className="mt-4 animate-fade-in-up"
              style={{ animationDelay: "130ms", animationFillMode: "backwards" }}
            >
              <button
                type="button"
                className="flex items-center gap-3 px-4 py-3 border border-dashed border-border rounded-xl hover:bg-muted/40 transition-colors text-left w-full"
              >
                <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                  <Upload className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
                <div>
                  <span className="text-sm font-medium block">Upload CSV</span>
                  <span className="text-xs text-muted-foreground">Import data from a CSV file</span>
                </div>
              </button>
            </div>

          </div>
        )}
      </main>

      {selectedConnector && (
        <ConnectorModal
          name={selectedConnector.name}
          category={selectedConnector.category}
          onClose={() => setSelectedConnector(null)}
          onContinue={(connectionName) => {
            setConnectingConnector({
              name: selectedConnector.name,
              category: selectedConnector.category,
              connectionName,
            });
            setSelectedConnector(null);
          }}
        />
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   Connector status — a labelled indicator so the
   impact reads at a glance. Monochrome: severity is
   carried by the word + text weight, not colour.
   ───────────────────────────────────────────── */

function ConnectorStatus({
  errorCount,
  syncingCount,
  hasIssueError,
  hasIssueWarning,
}: {
  errorCount: number;
  syncingCount: number;
  hasIssueError: boolean;
  hasIssueWarning: boolean;
}) {
  // Most urgent first: a failed feed or logged error needs a fix.
  if (hasIssueError || errorCount > 0) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
        Action Needed
      </span>
    );
  }
  if (hasIssueWarning) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground/75">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        Needs Attention
      </span>
    );
  }
  if (syncingCount > 0) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="w-2 h-2 rounded-full bg-muted-foreground/50 shrink-0 animate-pulse" />
        Syncing
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="w-2 h-2 rounded-full bg-foreground shrink-0" />
      Connected
    </span>
  );
}

/* ─────────────────────────────────────────────
   Connection Form Page
   ───────────────────────────────────────────── */

function ConnectionFormPage({
  name,
  category,
  connectionName,
  onBack,
}: {
  name: string;
  category: ConnectorCategory;
  connectionName: string;
  onBack: () => void;
}) {
  const [isConnecting,     setIsConnecting]     = useState(false);
  const [isConnected,      setIsConnected]      = useState(false);
  const [sshEnabled,       setSshEnabled]       = useState(false);
  const [sshAuthMethod,    setSshAuthMethod]    = useState<"key" | "password">("key");
  const [copied,           setCopied]           = useState(false);
  const [fieldValues,      setFieldValues]      = useState<Record<string, string>>({});
  const [sshKeyValue,      setSshKeyValue]      = useState("");
  const [sshPasswordValue, setSshPasswordValue] = useState("");
  const fields = getConnectorFields(name);

  const updateField = useCallback((key: string, value: string) => {
    setFieldValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleConnect = () => {
    const emptyFields = fields.filter((f) => {
      const val = f.label === "Connection Name"
        ? (fieldValues[f.label] ?? connectionName)
        : (fieldValues[f.label] ?? "");
      return !val.trim();
    });
    if (emptyFields.length > 0) {
      toast.error(`Please fill in: ${emptyFields.map((f) => f.label).join(", ")}`);
      return;
    }
    setIsConnecting(true);
    setTimeout(() => {
      setIsConnecting(false);
      setIsConnected(true);
      toast.success(`${name} connected successfully.`);
    }, 2000);
  };

  const handleCopyIP = () => {
    navigator.clipboard.writeText(WHITELIST_IP);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isConnected) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-16 text-center">
        <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
          <Check className="w-7 h-7 text-foreground" />
        </div>
        <h2 className="text-xl font-semibold mb-2">Connected</h2>
        <p className="text-sm text-muted-foreground mb-6">
          {name} is now connected as &ldquo;{connectionName}&rdquo;. Actioneer will begin syncing your data.
        </p>
        <button
          type="button"
          onClick={onBack}
          className="px-5 py-2.5 text-sm font-medium bg-foreground text-background rounded-lg hover:bg-foreground/90 transition-colors"
        >
          Back to Connectors
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-8 py-10">
      <div className="flex items-center gap-4 mb-6">
        <ConnectorLogo name={name} fallbackIcon={category.icon} size={36} className="rounded-full" />
        <div className="flex items-center gap-0">
          <div className="w-10 h-px bg-border" />
          <div className="w-0 h-0 border-t-[3px] border-t-transparent border-b-[3px] border-b-transparent border-l-[5px] border-l-border" />
        </div>
        <Image src="/grlogo.svg" alt="Actioneer" width={28} height={28} className="shrink-0" />
      </div>

      <h1 className="text-[25.2px] font-semibold mb-2">Connect {name}</h1>
      <p className="text-sm text-muted-foreground">
        Connect all your data: BI, analytics, CRM, ad platforms, org databases, Slack, and more.
      </p>
      <p className="text-sm text-muted-foreground mt-1 mb-10">
        Need help?{" "}
        <a href="#" className="text-foreground underline underline-offset-2 font-medium">Invite a teammate</a>
        {" "}or{" "}
        <a href="#" className="text-foreground underline underline-offset-2 font-medium">Join our Slack channel</a>
      </p>

      <div className="grid grid-cols-2 gap-x-8 gap-y-6 mb-10">
        {fields.map((field) => (
          <div key={field.label} className={field.type === "textarea" ? "col-span-2" : ""}>
            <label className="text-sm font-medium">
              {field.label}<span className="text-muted-foreground">*</span>
            </label>
            {field.type === "textarea" ? (
              <textarea
                placeholder={field.placeholder}
                rows={field.rows ?? 4}
                value={fieldValues[field.label] ?? ""}
                onChange={(e) => updateField(field.label, e.target.value)}
                className={`w-full mt-2 text-sm border border-border rounded-lg px-4 py-3 bg-background placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring/20 resize-none ${field.monospace ? "font-mono text-xs" : ""}`}
              />
            ) : (
              <input
                type={field.type ?? "text"}
                placeholder={field.placeholder}
                value={fieldValues[field.label] ?? (field.label === "Connection Name" ? connectionName : "")}
                onChange={(e) => updateField(field.label, e.target.value)}
                className="w-full mt-2 text-sm border border-border rounded-lg px-4 py-3 bg-background placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between bg-muted/50 rounded-xl px-6 py-4 mb-4">
        <div>
          <span className="inline-block text-sm font-mono font-semibold text-foreground bg-muted px-3 py-1.5 rounded-md">
            {WHITELIST_IP}
          </span>
          <p className="text-[11.7px] text-muted-foreground mt-2">
            Copy and whitelist this IP if your database is behind a firewall.
          </p>
        </div>
        <button
          type="button"
          onClick={handleCopyIP}
          className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-foreground text-background rounded-lg hover:bg-foreground/90 transition-colors shrink-0 ml-6"
        >
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          {copied ? "Copied" : "Copy IP"}
        </button>
      </div>

      <div className="border border-border rounded-xl mb-10 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5">
          <div className="flex items-center gap-3">
            <Shield className="w-5 h-5 text-muted-foreground" />
            <div>
              <p className="text-sm font-semibold">Use SSH Tunnel</p>
              <p className="text-[11.7px] text-muted-foreground mt-0.5">Connect to private databases via a bastion host</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSshEnabled(!sshEnabled)}
            className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${sshEnabled ? "bg-foreground" : "bg-muted"}`}
          >
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-background shadow-sm transition-transform ${sshEnabled ? "left-[22px]" : "left-0.5"}`} />
          </button>
        </div>

        {sshEnabled && (
          <div className="border-t border-border px-6 py-6 space-y-5">
            <div>
              <label className="text-sm font-semibold">SSH Host <span className="text-muted-foreground">*</span></label>
              <input type="text" placeholder="54.123.45.67" className="w-full mt-2 text-sm border border-border rounded-lg px-4 py-3 bg-background placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring/20" />
            </div>
            <div className="grid grid-cols-2 gap-x-8">
              <div>
                <label className="text-sm font-semibold">SSH Port</label>
                <input type="text" placeholder="22" className="w-full mt-2 text-sm border border-border rounded-lg px-4 py-3 bg-background placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring/20" />
              </div>
              <div>
                <label className="text-sm font-semibold">SSH Username <span className="text-muted-foreground">*</span></label>
                <input type="text" placeholder="ec2-user" className="w-full mt-2 text-sm border border-border rounded-lg px-4 py-3 bg-background placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring/20" />
              </div>
            </div>
            <div>
              <label className="text-sm font-semibold">SSH Authentication Method <span className="text-muted-foreground">*</span></label>
              <div className="grid grid-cols-2 gap-3 mt-2">
                <button type="button" onClick={() => setSshAuthMethod("key")} className={`flex items-center justify-center gap-2 px-4 py-3 rounded-lg border text-sm font-medium transition-colors ${sshAuthMethod === "key" ? "border-foreground/30 bg-muted/50" : "border-border hover:bg-muted/30"}`}>
                  <KeyRound className="w-4 h-4" /> Private Key
                  {sshAuthMethod === "key" && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-muted text-foreground leading-none">Recommended</span>}
                </button>
                <button type="button" onClick={() => setSshAuthMethod("password")} className={`flex items-center justify-center gap-2 px-4 py-3 rounded-lg border text-sm font-medium transition-colors ${sshAuthMethod === "password" ? "border-foreground/30 bg-muted/50" : "border-border hover:bg-muted/30"}`}>
                  <Lock className="w-4 h-4" /> Password
                </button>
              </div>
            </div>
            {sshAuthMethod === "key" ? (
              <div>
                <label className="text-sm font-semibold">SSH Private Key <span className="text-muted-foreground">*</span></label>
                <textarea rows={5} placeholder="-----BEGIN RSA PRIVATE KEY----- ..." value={sshKeyValue} onChange={(e) => setSshKeyValue(e.target.value)} className="w-full mt-2 text-sm font-mono border border-border rounded-lg px-4 py-3 bg-background placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring/20 resize-none" />
              </div>
            ) : (
              <div>
                <label className="text-sm font-semibold">SSH Password <span className="text-muted-foreground">*</span></label>
                <input type="password" placeholder="••••••••" value={sshPasswordValue} onChange={(e) => setSshPasswordValue(e.target.value)} className="w-full mt-2 text-sm border border-border rounded-lg px-4 py-3 bg-background placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring/20" />
              </div>
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={handleConnect}
        disabled={isConnecting}
        className="flex items-center gap-2 px-6 py-3 text-sm font-medium bg-foreground text-background rounded-lg hover:bg-foreground/90 transition-colors disabled:opacity-50 active:scale-[0.97]"
      >
        {isConnecting && <Loader2 className="w-4 h-4 animate-spin" />}
        {isConnecting ? "Connecting..." : `Connect ${name}`}
      </button>
    </div>
  );
}
