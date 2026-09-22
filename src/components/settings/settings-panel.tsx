"use client";

import { useRouter } from "next/navigation";
import { useSidebarContext } from "@/components/sidebar-context";
import { getBalance } from "@/lib/credit-store";
import { Wallet, Bell, KeyRound, Shield } from "lucide-react";
import { isFeatureEnabled } from "@/lib/feature-flags";

const ITEM = "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-muted transition-colors text-left";
const ITEM_DISABLED = "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left pointer-events-none cursor-not-allowed opacity-50";
const PRIMARY = "text-[11.7px] text-foreground truncate";
const SECONDARY = "text-[9.9px] text-muted-foreground truncate block";
const SECTION_HEADER = "text-[9px] font-semibold text-muted-foreground/70 uppercase tracking-widest px-2.5 pt-2 pb-1";
const ICON = "w-3.5 h-3.5 text-muted-foreground shrink-0";

export function SettingsPanel() {
  const router = useRouter();
  const { creditVersion } = useSidebarContext();
  void creditVersion; // Subscribe to updates for balance reactivity

  const balance = getBalance();

  return (
    <div className="flex-1 overflow-y-auto px-1.5">
      <p className={SECTION_HEADER}>Settings</p>
      <div>
        {/* Billing — active, navigates to /billing */}
        <button
          onClick={() => router.push("/billing")}
          className={ITEM}
        >
          <Wallet className={ICON} />
          <div className="min-w-0 flex-1">
            <p className={PRIMARY}>Billing</p>
            <p className={SECONDARY}>{balance.toLocaleString()} credits</p>
          </div>
        </button>

        {/* Access Control — admin feature flag */}
        {isFeatureEnabled("admin") && (
          <button
            onClick={() => router.push("/settings/access")}
            className={ITEM}
          >
            <Shield className={ICON} />
            <div className="min-w-0 flex-1">
              <p className={PRIMARY}>Access Control</p>
              <p className={SECONDARY}>Policies & roles</p>
            </div>
          </button>
        )}

        {/* Notifications — placeholder */}
        <div className={ITEM_DISABLED}>
          <Bell className={ICON} />
          <div className="min-w-0 flex-1">
            <p className={PRIMARY}>Notifications</p>
            <p className={SECONDARY}>Coming soon</p>
          </div>
        </div>

        {/* API Keys — placeholder */}
        <div className={ITEM_DISABLED}>
          <KeyRound className={ICON} />
          <div className="min-w-0 flex-1">
            <p className={PRIMARY}>API Keys</p>
            <p className={SECONDARY}>Coming soon</p>
          </div>
        </div>
      </div>
    </div>
  );
}
