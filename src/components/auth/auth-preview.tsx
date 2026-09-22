"use client";

import { motion } from "motion/react";
import {
  BarChart3,
  MessageSquare,
  Database,
  GitFork,
  Activity,
  Search,
} from "lucide-react";

/**
 * Stylized product preview for the auth page right panel.
 * Shows a realistic-looking Actioneer session with convincing
 * content — sidebar, chat, chart, metrics. Not interactive.
 */
export function AuthPreview() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.6, delay: 0.15, ease: [0.25, 0.1, 0.25, 1] }}
      className="w-full max-w-2xl"
    >
      {/* Fake app window */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{
          backgroundColor: "#151515",
          boxShadow:
            "0 0 0 1px rgba(255,255,255,0.06), 0 8px 32px rgba(0,0,0,0.4), 0 24px 64px rgba(0,0,0,0.3)",
        }}
      >
        {/* Title bar */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[#1e1e1e]">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-[#333]" />
            <div className="w-2.5 h-2.5 rounded-full bg-[#333]" />
            <div className="w-2.5 h-2.5 rounded-full bg-[#333]" />
          </div>
          <div className="flex-1 flex justify-center">
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-[#1a1a1a]">
              <Search className="w-2.5 h-2.5 text-[#444]" />
              <span className="text-[9px] text-[#444]">Search</span>
            </div>
          </div>
        </div>

        {/* App layout mockup */}
        <div className="flex h-[420px]">
          {/* Fake sidebar */}
          <div className="w-40 border-r border-[#1e1e1e] p-2.5 space-y-0.5 shrink-0">
            <SidebarItem icon={MessageSquare} label="New Chat" active />
            <SidebarItem icon={BarChart3} label="Metrics" />
            <SidebarItem icon={Database} label="Boards" />
            <SidebarItem icon={GitFork} label="Playbooks" />
            <SidebarItem icon={Activity} label="Explore" />

            <div className="pt-3 mt-3 border-t border-[#1e1e1e]">
              <p className="text-[8.1px] text-[#444] font-medium px-2 mb-1.5 uppercase tracking-wider">Recent</p>
              <div className="space-y-0.5">
                <div className="px-2 py-1.5 rounded text-[9px] text-[#555] truncate">Revenue by channel</div>
                <div className="px-2 py-1.5 rounded text-[9px] text-[#555] truncate">User retention cohort</div>
                <div className="px-2 py-1.5 rounded text-[9px] text-[#555] truncate">CAC vs LTV trend</div>
              </div>
            </div>
          </div>

          {/* Fake content area */}
          <div className="flex-1 p-4 space-y-3.5 overflow-hidden">
            {/* User question */}
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, duration: 0.3 }}
              className="flex justify-end"
            >
              <div className="rounded-xl bg-[#1e1e1e] px-3.5 py-2.5 max-w-[75%]">
                <p className="text-[9.9px] text-[#ccc] leading-relaxed">
                  What&apos;s the revenue trend this quarter compared to last?
                </p>
              </div>
            </motion.div>

            {/* Agent response with SQL badge */}
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6, duration: 0.3 }}
              className="space-y-2"
            >
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-4 rounded-full bg-[#282828]" />
                <span className="text-[9px] text-[#666]">Actioneer</span>
                <span className="text-[8.1px] px-1.5 py-0.5 rounded bg-[#1e1e1e] text-[#555]">3 queries</span>
              </div>
              <p className="text-[9.9px] text-[#999] leading-relaxed pl-5.5">
                Q3 revenue is up 23% vs Q2, driven primarily by the enterprise segment.
                Here&apos;s the breakdown:
              </p>
            </motion.div>

            {/* Chart card */}
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.8, duration: 0.3 }}
              className="rounded-xl bg-[#1a1a1a] p-3.5"
              style={{ boxShadow: "0 0 0 1px rgba(255,255,255,0.04)" }}
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-[9px] font-medium text-[#888]">Revenue by Quarter</span>
                <span className="text-[9px] text-[#555]">Last 4 quarters</span>
              </div>
              {/* Bar chart with real-looking proportions */}
              <div className="flex items-end gap-[6px] h-20">
                {[
                  { h: 45, label: "Q4" },
                  { h: 55, label: "Q1" },
                  { h: 62, label: "Q2" },
                  { h: 80, label: "Q3" },
                ].map((bar, i) => (
                  <div key={bar.label} className="flex-1 flex flex-col items-center gap-1">
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: `${bar.h}%` }}
                      transition={{ delay: 1.0 + i * 0.08, duration: 0.4, ease: "easeOut" }}
                      className={`w-full rounded-sm ${i === 3 ? "bg-[#e8e8e8]" : "bg-[#333]"}`}
                    />
                    <span className="text-[7.2px] text-[#555]">{bar.label}</span>
                  </div>
                ))}
              </div>
            </motion.div>

            {/* Metrics row */}
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.1, duration: 0.3 }}
              className="grid grid-cols-3 gap-2"
            >
              {[
                { label: "Revenue", value: "$2.4M", change: "+23%" },
                { label: "Active Users", value: "32.1k", change: "+12%" },
                { label: "Retention", value: "68.2%", change: "+3.1pp" },
              ].map((m) => (
                <div
                  key={m.label}
                  className="rounded-lg bg-[#1a1a1a] p-2.5"
                  style={{ boxShadow: "0 0 0 1px rgba(255,255,255,0.04)" }}
                >
                  <p className="text-[8.1px] text-[#555] mb-0.5">{m.label}</p>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[11.7px] font-semibold text-[#e8e8e8]">{m.value}</span>
                    <span className="text-[8.1px] text-[#555]">{m.change}</span>
                  </div>
                </div>
              ))}
            </motion.div>

            {/* Input bar */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.3, duration: 0.3 }}
              className="rounded-lg bg-[#1a1a1a] px-3.5 py-2.5 flex items-center gap-2"
              style={{ boxShadow: "0 0 0 1px rgba(255,255,255,0.04)" }}
            >
              <span className="text-[9.9px] text-[#444]">What do you want to know?</span>
            </motion.div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function SidebarItem({
  icon: Icon,
  label,
  active,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 px-2 py-1.5 rounded-md ${
        active ? "bg-[#1e1e1e]" : ""
      }`}
    >
      <Icon className={`w-3 h-3 ${active ? "text-[#888]" : "text-[#444]"}`} />
      <span className={`text-[9px] ${active ? "text-[#ccc]" : "text-[#555]"}`}>
        {label}
      </span>
    </div>
  );
}
