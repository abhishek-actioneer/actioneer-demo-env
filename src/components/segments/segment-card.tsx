"use client";

import { Users, Trash2, MoreVertical } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Segment } from "@/lib/types";
import { useLiveFreshness, formatRelativeTime } from "@/components/synthetic/live-freshness-hook";

interface SegmentCardProps {
  segment: Segment;
  onClick: () => void;
  onDelete: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  idle: "bg-muted-foreground/40",
  pushing: "bg-foreground animate-pulse",
  synced: "bg-foreground",
  error: "bg-foreground",
};

export function SegmentCard({ segment, onClick, onDelete }: SegmentCardProps) {
  const { lastTickAt, enabled: liveEnabled } = useLiveFreshness();
  const date = new Date(segment.createdAt);
  const dateStr = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <Card
      className="cursor-pointer hover:border-foreground/30 transition-colors group"
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <h3 className="font-medium text-sm leading-snug line-clamp-2 flex-1">
            {segment.name}
          </h3>
          <DropdownMenu>
            <DropdownMenuTrigger
              onClick={(e) => e.stopPropagation()}
              className="p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-muted transition-[opacity,background-color]"
            >
              <MoreVertical className="w-4 h-4 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                className="text-foreground"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-1.5 text-muted-foreground text-xs mb-3">
          <Users className="w-3.5 h-3.5" />
          <span>{segment.userCount.toLocaleString()} users</span>
          <span className="mx-1">·</span>
          <span>{dateStr}</span>
          {liveEnabled && lastTickAt && (
            <>
              <span className="mx-1">·</span>
              <span title={`Live data updated ${new Date(lastTickAt).toLocaleString()}`}>
                {formatRelativeTime(lastTickAt)}
              </span>
            </>
          )}
        </div>

        {/* Push status dots */}
        <div className="flex items-center gap-1.5">
          {["firebase", "clevertap", "bigquery"].map((intId) => {
            const status = segment.pushStatus[intId] ?? "idle";
            return (
              <div
                key={intId}
                className={`w-2 h-2 rounded-full ${STATUS_COLORS[status] ?? STATUS_COLORS.idle}`}
                title={`${intId}: ${status}`}
              />
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
