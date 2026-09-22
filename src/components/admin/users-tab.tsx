"use client";

import { useState, useCallback } from "react";
import { useUser } from "@clerk/nextjs";
import { getAllMockUsers, updateUserRole } from "@/lib/mock-user-store";
import { WORKSPACE_ROLES, type WorkspaceRole } from "@/lib/policy-types";

export function UsersTab() {
  const [version, setVersion] = useState(0);
  const { user: clerkUser } = useUser();

  // Derive teammate emails from this workspace's login alias so they match the
  // cred. analysis+hdfc@actioneer.com  ->  aarav+hdfc@actioneer.com, etc.
  const loginEmail = clerkUser?.primaryEmailAddress?.emailAddress ?? "";
  const aliasMatch = loginEmail.match(/\+([^@]+)@(.+)$/);
  const suffix = aliasMatch?.[1];
  const domain = aliasMatch?.[2];

  const users = getAllMockUsers()
    .slice(0, 10)
    .map((u) => {
      if (!suffix || !domain) return u;
      const first = u.name.split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, "");
      return { ...u, email: `${first}+${suffix}@${domain}` };
    });

  const handleRoleChange = useCallback((userId: string, role: WorkspaceRole) => {
    updateUserRole(userId, role);
    setVersion((v) => v + 1);
  }, []);

  void version;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[1fr_160px_120px] gap-4 px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
        <span>User</span>
        <span>Role</span>
        <span>Last Active</span>
      </div>

      <div className="divide-y divide-border border border-border rounded-xl overflow-hidden">
        {users.map((user) => (
          <div key={user.id} className="grid grid-cols-[1fr_160px_120px] gap-4 px-3 py-3 items-center">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                <span className="text-xs font-medium text-muted-foreground">{user.initials}</span>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{user.name}</p>
                <p className="text-xs text-muted-foreground truncate">{user.email}</p>
              </div>
            </div>

            <select
              value={user.role}
              onChange={(e) => handleRoleChange(user.id, e.target.value as WorkspaceRole)}
              className="text-sm bg-background border border-border rounded-md px-2 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20"
            >
              {WORKSPACE_ROLES.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>

            <span className="text-xs text-muted-foreground">{user.lastActive}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
