"use client";

import React, { useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSidebarContext } from "@/components/sidebar-context";
import {
  Search, Store, BarChart3, Package, Tag, Receipt, Users,
  Settings, HelpCircle, LogOut, ChevronsUpDown, Moon, Bell,
  LayoutDashboard, Trash2, Upload, RefreshCw,
  Plus,
} from "lucide-react";
import { getAllEntries } from "@/lib/knowledge-store";
import { getSavedPlaybookSummaries } from "@/lib/playbook-store";
import { getMetricSummaries } from "@/lib/metric-store";
import { CONNECTOR_CATEGORIES } from "@/lib/connector-categories";
import { isConnectorConnected } from "@/lib/connector-data";
import { saveBoard } from "@/lib/board-store";
import type { Board } from "@/lib/board-types";
import { ConnectorLogo } from "@/components/connectors/connector-logo";
import { getAllTransactions } from "@/lib/store-store";
import { SignOutButton, useUser } from "@clerk/nextjs";
import { useTheme } from "next-themes";
import { useDataset } from "@/lib/dataset-context";
import { isTeamEmail } from "@/lib/auth-domain";
import { apiFetch } from "@/lib/api-client";
import { DEFAULT_DATASET } from "@/lib/datasets/constants";
import {
  SECTION_HEADER, ITEM, PRIMARY, SECONDARY, FOOTER,
  ICON, EMPTY,
} from "./panel-styles";

export function PanelDivider() {
  return <div className="mx-2.5 my-2 border-t border-border" />;
}

// ── History Panel ──

export function HistoryPanel({
  chats,
  activeId,
  onSelect,
  onSearchClick,
}: {
  chats: { id: string; title: string }[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onSearchClick?: () => void;
}) {
  return (
    <>
      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <input
            type="text"
            readOnly
            onClick={onSearchClick}
            placeholder="Search..."
            className="w-full pl-7 pr-2 py-1.5 text-[11.7px] border border-border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring/20 cursor-pointer"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-1.5">
        <p className={SECTION_HEADER}>Recent</p>
        <div>
          {chats.map((chat) => (
            // Use plain <a> so we can intercept unmodified clicks (to run onSelect
            // side effects) while letting cmd/ctrl+click fall through to the browser
            // for native new-tab behaviour.
            <a
              key={chat.id}
              href={`/?conv=${chat.id}`}
              onClick={(e) => {
                if (!e.metaKey && !e.ctrlKey) {
                  e.preventDefault();
                  onSelect(chat.id);
                }
              }}
              className={`${ITEM} ${chat.id === activeId ? "bg-muted" : ""}`}
            >
              <div className="min-w-0 flex-1">
                <p className={PRIMARY}>{chat.title}</p>
              </div>
            </a>
          ))}
          {chats.length === 0 && <p className={EMPTY}>No chats found</p>}
        </div>
      </div>
    </>
  );
}

// ── Knowledge Panel ──

export function KnowledgePanel() {
  const { datasetId } = useDataset();
  const entries = getAllEntries(datasetId).slice(0, 8);

  return (
    <>
      <div className="flex-1 overflow-y-auto px-1.5">
        <p className={SECTION_HEADER}>Recent entries</p>
        <div>
          {entries.map((entry) => (
            <Link
              key={entry.id}
              href="/knowledge"
              className={ITEM}
            >
              <div className="min-w-0 flex-1">
                <p className={PRIMARY}>{entry.content}</p>
                <p className={SECONDARY}>{entry.category}</p>
              </div>
            </Link>
          ))}
          {entries.length === 0 && <p className={EMPTY}>No knowledge yet</p>}
        </div>
      </div>
      <Link href="/knowledge" className={FOOTER}>
        View All →
      </Link>
    </>
  );
}

// ── Playbooks Panel ──

export function PlaybooksPanel() {
  const { playbookVersion } = useSidebarContext();
  void playbookVersion;
  const playbooks = getSavedPlaybookSummaries();

  return (
    <>
      <div className="flex-1 overflow-y-auto px-1.5">
        <p className={SECTION_HEADER}>Saved playbooks</p>
        <div>
          {playbooks.length > 0 ? (
            playbooks.map((pb) => (
              <Link
                key={pb.id}
                href={`/playbooks/${pb.id}`}
                className={ITEM}
              >
                <div className="min-w-0 flex-1">
                  <p className={PRIMARY}>{pb.name}</p>
                  <p className={SECONDARY}>{pb.category} · {pb.owner}</p>
                </div>
              </Link>
            ))
          ) : (
            <p className={EMPTY}>No playbooks yet</p>
          )}
        </div>
      </div>
      <Link href="/playbooks" className={FOOTER}>
        View All →
      </Link>
    </>
  );
}

// ── Metrics Panel ──

export function MetricsPanel() {
  const { datasetId } = useDataset();
  const metrics = getMetricSummaries(datasetId).slice(0, 8);

  return (
    <>
      <div className="flex-1 overflow-y-auto px-1.5">
        <p className={SECTION_HEADER}>All metrics</p>
        <div>
          {metrics.map((m) => (
            <Link
              key={m.id}
              href={`/metrics/${m.id}`}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(
                  "application/x-actioneer-entity",
                  JSON.stringify({ type: "metric", id: m.id, title: m.name })
                );
                e.dataTransfer.effectAllowed = "copy";
              }}
              className={ITEM}
            >
              <div className="min-w-0 flex-1">
                <p className={PRIMARY}>{m.name}</p>
                <p className={SECONDARY}>{m.category}</p>
              </div>
            </Link>
          ))}
          {metrics.length === 0 && <p className={EMPTY}>No metrics yet</p>}
        </div>
      </div>
      <Link href="/metrics" className={FOOTER}>
        View All →
      </Link>
    </>
  );
}

// ── Metric Tree Panel ──

export function MetricTreePanel() {
  const { datasetId } = useDataset();
  const metrics = getMetricSummaries(datasetId).slice(0, 8);

  return (
    <>
      <div className="flex-1 overflow-y-auto px-1.5">
        <p className={SECTION_HEADER}>Key metrics</p>
        <div>
          {metrics.map((m) => (
            <Link
              key={m.id}
              href="/metric-tree"
              className={ITEM}
            >
              <div className="min-w-0 flex-1">
                <p className={PRIMARY}>{m.name}</p>
                <p className={SECONDARY}>{m.category}</p>
              </div>
            </Link>
          ))}
          {metrics.length === 0 && <p className={EMPTY}>No metrics yet</p>}
        </div>
      </div>
      <Link href="/metric-tree" className={FOOTER}>
        View Tree →
      </Link>
    </>
  );
}

// ── Segments Panel ──

export function SegmentsPanel() {
  const { segments } = useSidebarContext();

  return (
    <>
      <div className="flex-1 overflow-y-auto px-1.5">
        <p className={SECTION_HEADER}>User segments</p>
        <div>
          {segments.map((s) => {
            return (
              <Link
                key={s.id}
                href={`/segments/${s.id}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(
                    "application/x-actioneer-entity",
                    JSON.stringify({ type: "segment", id: s.id, title: s.name })
                  );
                  e.dataTransfer.effectAllowed = "copy";
                }}
                className={ITEM}
              >
                <div className="min-w-0 flex-1">
                  <p className={PRIMARY}>{s.name}</p>
                  <p className={SECONDARY}>{s.description}</p>
                </div>
              </Link>
            );
          })}
          {segments.length === 0 && <p className={EMPTY}>No segments yet</p>}
        </div>
      </div>
      <Link href="/segments" className={FOOTER}>
        View All →
      </Link>
    </>
  );
}

// ── Canvas Panel ──

export function CanvasPanel() {
  const router = useRouter();
  const { datasetId } = useDataset();
  const { boards, activeBoardId, setActiveBoardId, refreshBoards, boardVersion } = useSidebarContext();
  void boardVersion;

  const handleNewBoard = () => {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const board: Board = {
      id,
      name: "Untitled Board",
      datasetId,
      createdAt: now,
      updatedAt: now,
    };
    saveBoard(board);
    refreshBoards();
    setActiveBoardId(id);
    router.push(`/canvas/${id}`);
  };

  return (
    <>
      <div className="flex-1 overflow-y-auto px-1.5">
        <p className={SECTION_HEADER}>Boards</p>
        <div>
          {boards.length > 0 ? (
            boards.map((b) => (
              <Link
                key={b.id}
                href={`/canvas/${b.id}`}
                onClick={() => setActiveBoardId(b.id)}
                className={`${ITEM} ${b.id === activeBoardId ? "bg-muted" : ""}`}
              >
                <LayoutDashboard className={ICON} />
                <div className="min-w-0 flex-1">
                  <p className={PRIMARY}>{b.name}</p>
                  <p className={SECONDARY}>
                    {b.cardCount} card{b.cardCount !== 1 ? "s" : ""}
                  </p>
                </div>
              </Link>
            ))
          ) : (
            <p className={EMPTY}>No boards yet</p>
          )}
        </div>
      </div>
      <button
        onClick={handleNewBoard}
        className={FOOTER}
      >
        <span className="flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" />
          New Board
        </span>
      </button>
    </>
  );
}

// ── Scouts Panel ──

export function ScoutsPanel() {
  const scouts = [
    { id: "s-1", name: "Weekly UA Scout", schedule: "Mon 9:00 AM", status: "Active" },
    { id: "s-2", name: "Daily Revenue Scout", schedule: "Daily 8:00 AM", status: "Active" },
    { id: "s-3", name: "Retention Health Check", schedule: "Mon 9:00 AM", status: "Paused" },
    { id: "s-4", name: "Revenue Anomaly Scan", schedule: "Daily 6:00 AM", status: "Active" },
  ];

  return (
    <>
      <div className="flex-1 overflow-y-auto px-1.5">
        <p className={SECTION_HEADER}>Active scouts</p>
        <div>
          {scouts.map((s) => (
            <Link
              key={s.id}
              href={`/scouts/${s.id}`}
              className={ITEM}
            >
              <div className="min-w-0 flex-1">
                <p className={PRIMARY}>{s.name}</p>
                <p className={SECONDARY}>{s.schedule} · {s.status}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
      <Link href="/scouts" className={FOOTER}>
        View All →
      </Link>
    </>
  );
}

// ── Connectors Panel ──

export function ConnectorsPanel() {
  return (
    <>
      <div className="flex-1 overflow-y-auto px-1.5">
        {CONNECTOR_CATEGORIES.map((cat, idx) => (
          <div key={cat.id}>
            {idx > 0 && <PanelDivider />}
            <p className={SECTION_HEADER}>{cat.name}</p>
            <div>
              {cat.examples.map((name) => (
                <Link
                  key={name}
                  href={`/connectors?connect=${encodeURIComponent(name)}&category=${cat.id}`}
                  className={ITEM}
                >
                  <ConnectorLogo name={name} fallbackIcon={cat.icon} size={16} />
                  <div className="min-w-0 flex-1">
                    <p className={PRIMARY}>{name}</p>
                  </div>
                  {isConnectorConnected(name) && (
                    <span className="w-1.5 h-1.5 rounded-full bg-foreground shrink-0" />
                  )}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
      <Link href="/connectors" className={FOOTER}>
        Manage →
      </Link>
    </>
  );
}

// ── Store Panel ──

export function StorePanel() {
  const recentTx = getAllTransactions().slice(0, 5);

  const NAV_ITEMS = [
    { icon: BarChart3, label: "Overview", path: "/store" },
    { icon: Package, label: "Catalog", path: "/store/catalog" },
    { icon: Tag, label: "Offers", path: "/store/offers" },
    { icon: Receipt, label: "Transactions", path: "/store/transactions" },
    { icon: Users, label: "Players", path: "/store/players" },
  ];

  return (
    <>
      <div className="flex-1 overflow-y-auto px-1.5">
        <p className={SECTION_HEADER}>Quick access</p>
        <div>
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.path}
              href={item.path}
              className={ITEM}
            >
              <item.icon className={ICON} />
              <div className="min-w-0 flex-1">
                <p className={PRIMARY}>{item.label}</p>
              </div>
            </Link>
          ))}
        </div>

        <PanelDivider />

        <p className={SECTION_HEADER}>Recent transactions</p>
        <div>
          {recentTx.map((tx) => (
            <Link
              key={tx.id}
              href="/store/transactions"
              className={ITEM}
            >
              <div className="min-w-0 flex-1">
                <p className={PRIMARY}>{tx.playerName}</p>
                <p className={SECONDARY}>{tx.skuName} · ${tx.amount.toFixed(2)}</p>
              </div>
            </Link>
          ))}
          {recentTx.length === 0 && <p className={EMPTY}>No transactions yet</p>}
        </div>
      </div>
      <Link href="/store" className={FOOTER}>
        View Store →
      </Link>
    </>
  );
}

// ── User Panel ──

function UserPanelLink({
  icon: Icon,
  label,
  danger,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  danger?: boolean;
  onClick?: () => void;
}) {
  return (
    <button className={ITEM} onClick={onClick}>
      <Icon className={`w-3.5 h-3.5 shrink-0 ${danger ? "text-foreground" : "text-muted-foreground"}`} />
      <div className="min-w-0 flex-1">
        <p className={`text-[11.7px] truncate ${danger ? "text-foreground" : "text-foreground"}`}>{label}</p>
      </div>
    </button>
  );
}

export function UserPanel() {
  const [wsDropdown, setWsDropdown] = useState(false);
  const { theme, setTheme } = useTheme();
  const { datasetId, dataset, allDatasets, switchDataset, refreshDatasets } = useDataset();
  const { user } = useUser();
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const displayName = user?.fullName || user?.firstName || "User";
  const displayEmail = user?.primaryEmailAddress?.emailAddress || "";
  const initials = displayName.charAt(0).toUpperCase();
  // Only Actioneer team accounts can switch datasets; everyone else is locked to
  // the dataset chosen at onboarding (also enforced server-side in /api/datasets).
  const canSwitch = isTeamEmail(displayEmail);

  const THEME_OPTIONS = [
    { value: "light", label: "Light", icon: Settings },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: Settings },
  ] as const;

  return (
    <div className="flex-1 overflow-y-auto px-1.5">
      {/* User info */}
      <div className="px-2.5 py-3 flex items-center gap-2">
        {user?.imageUrl ? (
          <img src={user.imageUrl} alt="" className="w-8 h-8 rounded-full shrink-0" />
        ) : (
          <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-[11.7px] font-semibold shrink-0">
            {initials}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className={PRIMARY}>{displayName}</p>
          <p className={SECONDARY}>{displayEmail}</p>
        </div>
      </div>

      <PanelDivider />

      {/* Workspace */}
      <div className="relative">
        <p className={SECTION_HEADER}>Workspace</p>
        <button
          className={`${ITEM} justify-between ${canSwitch ? "" : "cursor-default"}`}
          onClick={() => { if (canSwitch) setWsDropdown((v) => !v); }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <Store className={ICON} />
            <p className={PRIMARY}>{dataset.label}</p>
          </div>
          {canSwitch && <ChevronsUpDown className="w-3 h-3 text-muted-foreground shrink-0" />}
        </button>
        {wsDropdown && (
          <div className="mt-0.5 mx-1 rounded-md border border-border bg-popover shadow-md z-50">
            {allDatasets.map((ds) => {
              const isActive = ds.id === datasetId;
              return (
                <div
                  key={ds.id}
                  className={`flex items-center w-full px-3 py-2 text-[10.8px] transition-colors group ${
                    isActive ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  }`}
                >
                  <button
                    className="flex items-center gap-2 flex-1 min-w-0"
                    onClick={() => {
                      if (!isActive) switchDataset(ds.id);
                      setWsDropdown(false);
                    }}
                  >
                    <Store className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{ds.label}</span>
                  </button>
                  {ds.isDynamic && (
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        try {
                          await apiFetch("/api/datasets", {
                            method: "DELETE",
                            body: { id: ds.id },
                            skipModel: true,
                          });
                          await refreshDatasets();
                          if (isActive) switchDataset(DEFAULT_DATASET);
                        } catch {
                          // Silently fail on delete error
                        }
                      }}
                      className="ml-1 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground transition-[opacity,color,background-color]"
                      title="Remove dataset"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              );
            })}
            <div className="border-t border-border">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.duckdb"
                multiple
                className="hidden"
                onChange={async (e) => {
                  if (uploadStatus) return; // prevent concurrent uploads
                  const files = e.target.files;
                  if (!files || files.length === 0) return;

                  const firstFile = files[0];

                  // Client-side 150MB size check
                  const MAX_SIZE = 150 * 1024 * 1024;
                  for (let i = 0; i < files.length; i++) {
                    if (files[i].size > MAX_SIZE) {
                      setUploadStatus(`Error: "${files[i].name}" exceeds the 150MB limit`);
                      await new Promise((r) => setTimeout(r, 3000));
                      setUploadStatus(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                      return;
                    }
                  }

                  const label = firstFile.name.replace(/\.(csv|duckdb)$/i, "").replace(/[_-]/g, " ");
                  setUploadStatus("Uploading files...");

                  let canceled = false;
                  const timers: ReturnType<typeof setTimeout>[] = [];

                  try {
                    const form = new FormData();
                    for (let i = 0; i < files.length; i++) {
                      form.append("files", files[i]);
                    }
                    form.append("label", label);

                    const steps = [
                      { text: "Analyzing schema...", delay: 2000 },
                      { text: "Profiling columns...", delay: 4000 },
                      { text: "Building schema map...", delay: 7000 },
                      { text: "Generating prompts...", delay: 11000 },
                      { text: "Finalizing dataset...", delay: 15000 },
                    ];
                    for (const s of steps) {
                      timers.push(
                        setTimeout(() => {
                          if (!canceled) setUploadStatus(s.text);
                        }, s.delay),
                      );
                    }

                    const res = await fetch("/api/datasets/upload", {
                      method: "POST",
                      headers: { "x-dataset-id": datasetId },
                      body: form,
                    });

                    if (res.ok) {
                      setUploadStatus("Ready!");
                      const ds = await res.json();
                      await refreshDatasets();
                      await new Promise((r) => setTimeout(r, 300));
                      switchDataset(ds.id);
                    } else {
                      const err = await res.json().catch(() => ({}));
                      setUploadStatus(`Error: ${(err as { error?: string }).error ?? "Upload failed"}`);
                      await new Promise((r) => setTimeout(r, 3000));
                    }
                  } finally {
                    canceled = true;
                    timers.forEach(clearTimeout);
                    setUploadStatus(null);
                    setWsDropdown(false);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }
                }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={!!uploadStatus}
                className="flex items-center gap-2 w-full px-3 py-2 text-[10.8px] text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
              >
                {uploadStatus ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    {uploadStatus}
                  </>
                ) : (
                  <>
                    <Upload className="w-3.5 h-3.5" />
                    Upload CSV or DuckDB
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      <PanelDivider />

      {/* Appearance */}
      <div>
        <p className={SECTION_HEADER}>Appearance</p>
        <div className="flex items-center gap-1 px-2.5 py-1.5">
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setTheme(opt.value)}
              className={`flex-1 py-1.5 text-[10.8px] font-medium rounded-md transition-colors ${
                theme === opt.value
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <PanelDivider />

      {/* Links */}
      <div>
        <p className={SECTION_HEADER}>Preferences</p>
        <UserPanelLink icon={Settings} label="Settings" />
        <UserPanelLink icon={Bell} label="Notifications" />
        <UserPanelLink icon={HelpCircle} label="Help & Support" />
      </div>

      <PanelDivider />

      <div className="py-1">
        <SignOutButton redirectUrl="/auth">
          <UserPanelLink icon={LogOut} label="Log Out" danger />
        </SignOutButton>
      </div>
    </div>
  );
}
