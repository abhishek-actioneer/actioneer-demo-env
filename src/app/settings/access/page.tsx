"use client";

import { useState } from "react";
import { FeatureGate } from "@/components/feature-gate";
import { PoliciesTab } from "@/components/admin/policies-tab";
import { UsersTab } from "@/components/admin/users-tab";

type Tab = "policies" | "users";

const TABS: { id: Tab; label: string }[] = [
  { id: "policies", label: "Policies" },
  { id: "users", label: "Users" },
];

export default function AccessControlPage() {
  const [activeTab, setActiveTab] = useState<Tab>("policies");

  return (
    <FeatureGate feature="admin">
      <div className="flex flex-col h-full min-w-0">
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
            <div>
              <h1 className="text-xl font-semibold">Access Control</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Manage data policies and user access.
              </p>
            </div>

            <div className="flex gap-4 border-b border-border">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`pb-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                    activeTab === tab.id
                      ? "border-foreground text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {activeTab === "policies" && <PoliciesTab />}
            {activeTab === "users" && <UsersTab />}
          </div>
        </div>
      </div>
    </FeatureGate>
  );
}
