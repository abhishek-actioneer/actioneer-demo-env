"use client";

/**
 * Hand-picked cross-library nav icons. Each wraps a third-party icon to match the
 * sidebar's icon signature ({ className, strokeWidth }) so they drop into the same
 * nav arrays as the lucide-react icons. Sizing/colour come from the passed
 * className (Tailwind w/h + text colour via currentColor).
 */
import { RiDiscussLine, RiRepeatLine, RiBookOpenLine } from "@remixicon/react";
import { IconFilter } from "@tabler/icons-react";
import { TreeStructure } from "@phosphor-icons/react";

type NavIconProps = { className?: string; strokeWidth?: number };

export function ChatsIcon({ className }: NavIconProps) {
  return <RiDiscussLine className={className} />;
}

export function FunnelsIcon({ className, strokeWidth }: NavIconProps) {
  return <IconFilter className={className} stroke={strokeWidth ?? 1.5} />;
}

export function RetentionsIcon({ className }: NavIconProps) {
  return <RiRepeatLine className={className} />;
}

export function KnowledgeIcon({ className }: NavIconProps) {
  return <RiBookOpenLine className={className} />;
}

export function MetricTreeIcon({ className }: NavIconProps) {
  return <TreeStructure className={className} />;
}
