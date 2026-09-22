"use client";

import { useState } from "react";
import {
  Store,
  ChevronsUpDown,
  Moon,
  Settings,
  Bell,
  HelpCircle,
  LogOut,
  Wallet,
  KeyRound,
  Loader2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useClerk, useUser } from "@clerk/nextjs";
import { useDataset } from "@/lib/dataset-context";
import { useSidebarContext } from "@/components/sidebar-context";
import { getBalance } from "@/lib/credit-store";
import { ITEM, PRIMARY, SECONDARY, SECTION_HEADER } from "@/lib/sidebar-config";

function PanelDivider() {
  return <div className="mx-2.5 my-2 border-t border-border" />;
}

const ITEM_DISABLED = "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left pointer-events-none cursor-not-allowed opacity-50";

export function UserPanel() {
  const [wsDropdown, setWsDropdown] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const { theme, setTheme } = useTheme();
  const { datasetId, dataset, allDatasets, switchDataset } = useDataset();
  const { creditVersion } = useSidebarContext();
  const { user } = useUser();
  const { signOut } = useClerk();
  const router = useRouter();
  void creditVersion; // Subscribe to updates for balance reactivity
  const balance = getBalance();

  const displayName = user?.fullName || user?.firstName || "User";
  const displayEmail = user?.primaryEmailAddress?.emailAddress || "";
  const initials = displayName.charAt(0).toUpperCase();

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
          className={`${ITEM} justify-between`}
          onClick={() => setWsDropdown((v) => !v)}
        >
          <div className="flex items-center gap-2 min-w-0">
            <Store className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <p className={PRIMARY}>{dataset.label}</p>
          </div>
          <ChevronsUpDown className="w-3 h-3 text-muted-foreground shrink-0" />
        </button>
        {wsDropdown && (
          <div className="mt-0.5 mx-1 rounded-md border border-border bg-popover shadow-md z-50">
            {allDatasets.map(({ id, label }) => {
              const isActive = id === datasetId;
              return (
                <button
                  key={id}
                  onClick={() => {
                    if (!isActive) switchDataset(id);
                    setWsDropdown(false);
                  }}
                  className={`flex items-center gap-2 w-full px-3 py-2 text-[10.8px] transition-colors ${
                    isActive ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  }`}
                >
                  <Store className="w-3.5 h-3.5" />
                  {label}
                </button>
              );
            })}
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

      {/* Settings */}
      <div>
        <p className={SECTION_HEADER}>Settings</p>
        <button
          onClick={() => router.push("/billing")}
          className={ITEM}
        >
          <Wallet className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <div className="min-w-0 flex-1">
            <p className={PRIMARY}>Billing</p>
            <p className={SECONDARY}>{balance.toLocaleString()} credits</p>
          </div>
        </button>
        <div className={ITEM_DISABLED}>
          <Bell className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <div className="min-w-0 flex-1">
            <p className={PRIMARY}>Notifications</p>
            <p className={SECONDARY}>Coming soon</p>
          </div>
        </div>
        <div className={ITEM_DISABLED}>
          <KeyRound className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <div className="min-w-0 flex-1">
            <p className={PRIMARY}>API Keys</p>
            <p className={SECONDARY}>Coming soon</p>
          </div>
        </div>
      </div>

      <PanelDivider />

      {/* Links */}
      <div>
        <UserPanelLink icon={HelpCircle} label="Help & Support" />
      </div>

      <PanelDivider />

      <div className="py-1">
        <UserPanelLink
          icon={LogOut}
          label={loggingOut ? "Signing Out..." : "Log Out"}
          danger
          loading={loggingOut}
          onClick={() => {
            if (loggingOut) return;
            // Show immediate feedback — the actual sign-out is a network round-trip
            // to Clerk, so the button would otherwise look frozen for ~1-2s.
            setLoggingOut(true);
            // Clear all app localStorage to prevent data leaking between users
            const keysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
              const key = localStorage.key(i);
              if (key && (key.startsWith("sentinel-") || key.startsWith("baby-sentinel-"))) {
                keysToRemove.push(key);
              }
            }
            keysToRemove.forEach((k) => localStorage.removeItem(k));
            signOut({ redirectUrl: "/auth" });
          }}
        />
      </div>
    </div>
  );
}

function UserPanelLink({
  icon: Icon,
  label,
  danger,
  onClick,
  loading,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  danger?: boolean;
  onClick?: () => void;
  loading?: boolean;
}) {
  return (
    <button className={ITEM} onClick={onClick} disabled={loading}>
      {loading ? (
        <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-foreground" />
      ) : (
        <Icon className={`w-3.5 h-3.5 shrink-0 ${danger ? "text-foreground" : "text-muted-foreground"}`} />
      )}
      <div className="min-w-0 flex-1">
        <p className={`text-[11.7px] truncate ${danger ? "text-foreground" : "text-foreground"}`}>{label}</p>
      </div>
    </button>
  );
}
