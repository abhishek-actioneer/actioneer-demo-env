"use client";

import { Play, ChevronDown, Mail } from "lucide-react";
import type { Scout } from "@/lib/scout-data";

interface ScoutConfigPanelProps {
  scout: Scout;
  onSelectRun: (runId: string) => void;
}

export function ScoutConfigPanel({ scout, onSelectRun }: ScoutConfigPanelProps) {
  return (
    <div className="h-full flex flex-col overflow-y-auto bg-background">
      {/* Scout Name */}
      <div className="px-5 py-5 border-b border-border">
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
          Scout Name
        </label>
        <input
          type="text"
          defaultValue={scout.name}
          className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring/20"
        />
      </div>

      {/* Prompt */}
      <div className="px-5 py-5 border-b border-border">
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
          Prompt
        </label>
        <textarea
          defaultValue={scout.prompt}
          rows={6}
          className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring/20 leading-relaxed"
        />
      </div>

      {/* Schedule */}
      <div className="px-5 py-5 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Schedule
            </label>
            <button className="w-full flex items-center justify-between px-3 py-2 text-sm border border-border rounded-lg bg-background hover:bg-muted/50 transition-colors">
              <span>{scout.schedule.split(" at ")[0].split(" ").slice(0, 2).join(" ") || scout.schedule}</span>
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </div>
          {scout.scheduleDay && (
            <div className="flex-1">
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                Day
              </label>
              <button className="w-full flex items-center justify-between px-3 py-2 text-sm border border-border rounded-lg bg-background hover:bg-muted/50 transition-colors">
                <span>{scout.scheduleDay}</span>
                <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Email Recipients */}
      <div className="px-5 py-5 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-muted-foreground">
            Email Recipients
          </label>
          <button className="text-[9px] text-muted-foreground hover:text-foreground transition-colors">
            Deselect All
          </button>
        </div>
        <div className="space-y-2">
          {scout.emailRecipients.map((email) => (
            <label
              key={email}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-border cursor-pointer hover:bg-muted/30 transition-colors"
            >
              <div className="w-4 h-4 rounded-full border-[1.5px] border-border flex items-center justify-center shrink-0">
                <div className="w-2 h-2 rounded-full bg-foreground" />
              </div>
              <Mail className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="text-sm text-foreground">{email}</span>
            </label>
          ))}
          <p className="text-[9.9px] text-muted-foreground">
            {scout.emailRecipients.length} recipient{scout.emailRecipients.length !== 1 ? "s" : ""} selected
          </p>
        </div>
      </div>

      {/* Run History */}
      <div className="px-5 py-5 flex-1">
        <h3 className="text-xs font-medium text-muted-foreground mb-3">Run History</h3>
        {scout.runs.length > 0 ? (
          <div className="space-y-1">
            {scout.runs.map((run) => (
              <button
                key={run.id}
                onClick={() => onSelectRun(run.id)}
                className="w-full flex items-center px-3 py-2 rounded-md hover:bg-muted transition-colors text-left"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-foreground">{run.runAt}</p>
                  <p className="text-[9.9px] text-muted-foreground truncate">
                    {run.summary}
                  </p>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No runs yet</p>
        )}
      </div>

      {/* Run Now */}
      <div className="px-5 py-4 border-t border-border">
        <button className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium bg-foreground text-background rounded-lg hover:bg-foreground/90 active:scale-[0.98] transition-[background-color,transform]">
          <Play className="w-3.5 h-3.5" />
          Run Now
        </button>
      </div>
    </div>
  );
}
