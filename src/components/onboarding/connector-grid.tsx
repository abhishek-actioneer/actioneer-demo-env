"use client";

import { useState } from "react";
import { Search, Upload } from "lucide-react";
import { ConnectorCard } from "./connector-card";

/** Connectors grouped by category with descriptions and fallback icon */
const SECTIONS = [
  {
    id: "warehouse",
    label: "Data Warehouses",
    tag: "Instant",
    fallbackIcon: "Database",
    items: [
      { name: "BigQuery", desc: "Google Cloud analytics warehouse" },
      { name: "Snowflake", desc: "Multi-cloud data platform" },
      { name: "Redshift", desc: "AWS columnar warehouse" },
      { name: "PostgreSQL", desc: "Open-source relational database" },
      { name: "Databricks", desc: "Unified analytics platform" },
      { name: "ClickHouse", desc: "Real-time OLAP database" },
      { name: "MySQL", desc: "Relational database" },
      { name: "MongoDB", desc: "Document database" },
      { name: "Supabase", desc: "Postgres with realtime & auth" },
      { name: "PlanetScale", desc: "Serverless MySQL" },
    ],
  },
  {
    id: "mmp",
    label: "Attribution & MMPs",
    tag: "5-10 min",
    fallbackIcon: "Smartphone",
    items: [
      { name: "AppsFlyer", desc: "Mobile attribution & analytics" },
      { name: "Adjust", desc: "Mobile measurement partner" },
      { name: "Singular", desc: "Unified marketing analytics" },
      { name: "Branch", desc: "Deep linking & attribution" },
      { name: "Kochava", desc: "Real-time attribution" },
      { name: "Tenjin", desc: "Ad monetization & attribution" },
      { name: "Airbridge", desc: "People-based attribution" },
      { name: "GameAnalytics", desc: "Game-specific analytics" },
    ],
  },
  {
    id: "ad-networks",
    label: "Ad Networks",
    tag: "5-10 min",
    fallbackIcon: "Megaphone",
    items: [
      { name: "Meta Ads", desc: "Facebook & Instagram campaigns" },
      { name: "Google Ads", desc: "Search, display & YouTube" },
      { name: "TikTok Ads", desc: "Short-form video campaigns" },
      { name: "Unity Ads", desc: "In-game ad monetization" },
      { name: "AppLovin", desc: "Mobile ad platform" },
      { name: "ironSource", desc: "App monetization & UA" },
      { name: "Snap Ads", desc: "Snapchat ad campaigns" },
      { name: "Apple Search Ads", desc: "App Store search campaigns" },
    ],
  },
  {
    id: "others",
    label: "Revenue, CRM & Analytics",
    tag: "Varies",
    fallbackIcon: "Plug",
    items: [
      { name: "Stripe", desc: "Payments & subscriptions" },
      { name: "RevenueCat", desc: "In-app purchase management" },
      { name: "Firebase", desc: "Google app development platform" },
      { name: "Amplitude", desc: "Product analytics" },
      { name: "Mixpanel", desc: "Event-based analytics" },
      { name: "Slack", desc: "Team messaging & alerts" },
      { name: "HubSpot", desc: "CRM & marketing hub" },
      { name: "Salesforce", desc: "Enterprise CRM" },
      { name: "Segment", desc: "Customer data platform" },
    ],
  },
] as const;

const ALL_ITEMS = SECTIONS.flatMap((s) =>
  s.items.map((item) => ({ ...item, fallbackIcon: s.fallbackIcon }))
);

interface ConnectorGridProps {
  selected: string[];
  onToggle: (name: string) => void;
}

export function ConnectorGrid({ selected, onToggle }: ConnectorGridProps) {
  const [query, setQuery] = useState("");

  const filtered = query
    ? ALL_ITEMS.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
    : [];

  return (
    <div className="w-full">
      {/* Upload CSV — first-class hero card at top */}
      <button
        className="group flex items-center gap-3.5 px-4 py-3.5 rounded-xl text-left w-full transition-all duration-150 bg-[#151515] hover:bg-[#1a1a1a] mb-6"
        style={{
          boxShadow:
            "0 0 0 1px rgba(255,255,255,0.06), 0 1px 2px rgba(0,0,0,0.15)",
        }}
      >
        <div className="w-9 h-9 rounded-lg shrink-0 flex items-center justify-center bg-[#1e1e1e]">
          <Upload className="w-4 h-4 text-[#888]" />
        </div>
        <div className="min-w-0">
          <p className="text-[11.7px] font-medium text-[#ccc]">Upload CSV</p>
          <p className="text-[9.9px] text-[#555] mt-0.5">
            Drag and drop or browse files
          </p>
        </div>
      </button>

      {/* Search bar */}
      <div className="relative mb-6">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#444]" />
        <input
          type="text"
          placeholder="Search Connectors..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full h-10 pl-10 pr-4 rounded-xl text-[11.7px] text-[#e8e8e8] placeholder:text-[#444] focus:outline-none transition-all"
          style={{
            backgroundColor: "#151515",
            boxShadow:
              "0 0 0 1px rgba(255,255,255,0.06), 0 1px 2px rgba(0,0,0,0.15)",
          }}
        />
      </div>

      {/* Search results */}
      {query ? (
        <div>
          <p className="text-[10.8px] text-[#555] mb-3">
            {filtered.length} result{filtered.length !== 1 ? "s" : ""} for
            &ldquo;{query}&rdquo;
          </p>
          <div className="grid grid-cols-2 gap-2.5">
            {filtered.map((c) => (
              <ConnectorCard
                key={c.name}
                name={c.name}
                description={c.desc}
                selected={selected.includes(c.name)}
                onClick={() => onToggle(c.name)}
                fallbackIcon={c.fallbackIcon}
              />
            ))}
          </div>
        </div>
      ) : (
        /* Sections */
        <div className="space-y-6">
          {SECTIONS.map((section) => (
            <div key={section.id}>
              {/* Section header */}
              <div className="flex items-center gap-2.5 mb-3">
                <h3 className="text-[10.8px] font-semibold text-[#777] uppercase tracking-wider">
                  {section.label}
                </h3>
                <span className="text-[9px] text-[#444] font-medium px-1.5 py-0.5 rounded-md bg-[#1a1a1a]">
                  {section.tag}
                </span>
              </div>

              {/* 2-column grid */}
              <div className="grid grid-cols-2 gap-2.5">
                {section.items.map((item) => (
                  <ConnectorCard
                    key={item.name}
                    name={item.name}
                    description={item.desc}
                    selected={selected.includes(item.name)}
                    onClick={() => onToggle(item.name)}
                    fallbackIcon={section.fallbackIcon}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
