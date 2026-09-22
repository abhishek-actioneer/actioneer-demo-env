"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, Check, Upload, ArrowLeft, Link2, Plus, X } from "lucide-react";
import { CONNECTOR_CATEGORIES, type ConnectorCategory } from "@/lib/connector-categories";
import { ConnectorModal } from "@/components/connectors/connector-modal";
import { ConnectorLogo } from "@/components/connectors/connector-logo";

const CONNECTED_NAMES = new Set(["BigQuery", "AppsFlyer"]);
const CONNECTION_COUNTS: Record<string, number> = { BigQuery: 4, AppsFlyer: 3 };

export default function AddConnectorsPageWrapper() {
  return (
    <Suspense>
      <AddConnectorsPage />
    </Suspense>
  );
}

function AddConnectorsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackCrmIntent = searchParams.get("intent") === "callback_crm";
  const [activeTab,          setActiveTab]          = useState(callbackCrmIntent ? "others" : "all");
  const [searchQuery,        setSearchQuery]        = useState(searchParams.get("query") ?? (callbackCrmIntent ? "CRM" : ""));
  const [selectedConnector,  setSelectedConnector]  = useState<{ name: string; category: ConnectorCategory } | null>(null);

  const totalCount = CONNECTOR_CATEGORIES.reduce((n, c) => n + c.examples.length, 0);
  const allTabs = [
    { id: "all", name: `All Connectors (${totalCount}+)` },
    ...CONNECTOR_CATEGORIES,
  ];

  const baseCats = activeTab === "all"
    ? CONNECTOR_CATEGORIES
    : CONNECTOR_CATEGORIES.filter((c) => c.id === activeTab);

  const filteredCats = searchQuery
    ? baseCats
        .map((cat) => ({
          ...cat,
          examples: cat.examples.filter((ex) =>
            ex.toLowerCase().includes(searchQuery.toLowerCase())
          ),
        }))
        .filter((cat) => cat.examples.length > 0)
    : baseCats;

  return (
    <div className="flex flex-col h-full min-w-0">
      <main className="flex-1 overflow-y-auto">
        <div
          className="max-w-5xl mx-auto px-6 py-8 animate-fade-in-up"
          style={{ animationFillMode: "backwards" }}
        >
          {/* ── Page header ── */}
          <div className="mb-5">
            <h1 className="text-xl font-semibold">Add Data Connectors</h1>
          </div>

          {/* ── Action bar ── */}
          <div className="flex items-center gap-3 mb-6">
            <button
              type="button"
              onClick={() => router.back()}
              className="flex items-center gap-1.5 px-1 py-[7px] text-sm font-medium text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back
            </button>
            <div
              className="relative flex-1 max-w-sm"
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
                autoFocus
                className="w-full pl-8 pr-9 py-2 text-sm border border-border rounded-lg bg-card placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring/20"
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
          </div>

          {/* ── Filter tabs ── */}
          <div className="flex items-center gap-1 mb-7 flex-wrap">
            {allTabs.map((t) => {
              const isActive = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTab(t.id)}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 leading-4 text-sm font-medium rounded-xl border transition-colors whitespace-nowrap ${
                    isActive
                      ? "bg-muted text-foreground border-border"
                      : "bg-background text-muted-foreground border-border hover:text-foreground hover:bg-muted/50"
                  }`}
                  style={{ transition: "transform 0.2s ease, color 0.15s, background 0.15s" }}
                  onMouseEnter={e => (e.currentTarget.style.transform = "scale(0.99)")}
                  onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}
                  onPointerDown={e => (e.currentTarget.style.transform = "scale(0.97)")}
                  onPointerUp={e => (e.currentTarget.style.transform = "scale(0.99)")}
                  onPointerLeave={e => (e.currentTarget.style.transform = "scale(1)")}
                >
                  {isActive && <Check className="w-3 h-3 shrink-0" />}
                  {t.name}
                </button>
              );
            })}
          </div>

          {/* ── Catalog sections ── */}
          <div className="space-y-8">
            {filteredCats.length === 0 ? (
              <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
                <Search className="mb-4 size-10 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  No connectors match &ldquo;{searchQuery}&rdquo;.
                </p>
              </div>
            ) : (
              filteredCats.map((cat) => (
                <CatalogSection
                  key={cat.id}
                  category={cat}
                  onSelect={(name, category) => setSelectedConnector({ name, category })}
                />
              ))
            )}

            {filteredCats.length > 0 && (
              <div className="pt-2 border-t border-border">
                <button
                  type="button"
                  className="flex items-center gap-3 px-4 py-3 border border-dashed border-border rounded-lg hover:bg-muted/40 transition-colors text-left"
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
            )}
          </div>
        </div>
      </main>

      {selectedConnector && (
        <ConnectorModal
          name={selectedConnector.name}
          category={selectedConnector.category}
          onClose={() => setSelectedConnector(null)}
          onContinue={() => {
            setSelectedConnector(null);
            router.back();
          }}
        />
      )}
    </div>
  );
}

function CatalogSection({
  category,
  onSelect,
}: {
  category: ConnectorCategory;
  onSelect: (name: string, cat: ConnectorCategory) => void;
}) {
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-3">
        <h3 className="text-sm font-semibold">{category.name}</h3>
        {category.connectTime && (
          <span className="text-xs text-muted-foreground">{category.connectTime}</span>
        )}
      </div>
      <div className="grid grid-cols-4 gap-2">
        {category.examples.map((name) => (
          <ConnectorTile
            key={name}
            name={name}
            category={category}
            connectionCount={CONNECTION_COUNTS[name] ?? 0}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

function ConnectorTile({
  name,
  category,
  connectionCount,
  onSelect,
}: {
  name: string;
  category: ConnectorCategory;
  connectionCount: number;
  onSelect: (name: string, cat: ConnectorCategory) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(name, category)}
      className="group relative flex items-center gap-[6px] text-left rounded-[8px]"
      style={{ padding: "9px", background: "var(--connector-surface)", border: "1px solid var(--connector-border)", transition: "transform 0.2s ease" }}
      onMouseEnter={e => (e.currentTarget.style.transform = "scale(0.95)")}
      onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}
    >
      <div className="shrink-0 rounded-[4px] overflow-hidden flex items-center justify-center" style={{ width: 32, height: 32, background: "var(--connector-icon-bg)" }}>
        <ConnectorLogo name={name} fallbackIcon={category.icon} size={32} />
      </div>
      <span className="text-[11.7px] font-medium line-clamp-2 flex-1 min-w-0" style={{ color: "var(--foreground)" }}>{name}</span>
      {connectionCount > 0 && (
        <span className="flex items-center gap-1 shrink-0" style={{ color: "var(--muted-foreground)" }}>
          <Link2 className="w-4 h-4" />
          <span className="text-[12.6px] tabular-nums">{connectionCount}</span>
        </span>
      )}
    </button>
  );
}
