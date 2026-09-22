"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  BarChart3, Users, BookOpen, Lightbulb, Database, Search,
  ChevronRight, ArrowLeft, MessageSquare,
} from "lucide-react";
import type { DetectableEntity, EntityType } from "@/lib/entity-types";
import { getAllConversations } from "@/lib/conversation-store";

// ── Types ──

export interface ContextReference {
  id: string;
  type: EntityType | "conversation" | "page" | "chart";
  name: string;
  /** Display label in the input chip (e.g. "Segments / HV Mobile Users") */
  displayLabel: string;
  /** Data to inject into the LLM prompt */
  contextPayload: Record<string, unknown>;
}

interface Category {
  id: string;
  label: string;
  icon: React.ReactNode;
  entityType?: EntityType;
  /** If true, load items from conversation store instead of entity catalog */
  isConversation?: boolean;
}

const CATEGORIES: Category[] = [
  { id: "metric", label: "Metrics", icon: <BarChart3 className="w-4 h-4" />, entityType: "metric" },
  { id: "segment", label: "Segments", icon: <Users className="w-4 h-4" />, entityType: "segment" },
  { id: "playbook", label: "Playbooks", icon: <BookOpen className="w-4 h-4" />, entityType: "playbook" },
  { id: "scout", label: "Scouts", icon: <Search className="w-4 h-4" />, entityType: "scout" },
  { id: "knowledge", label: "Knowledge", icon: <Lightbulb className="w-4 h-4" />, entityType: "knowledge" },
  { id: "table", label: "Tables", icon: <Database className="w-4 h-4" />, entityType: "table" },
  { id: "conversation", label: "Chats", icon: <MessageSquare className="w-4 h-4" />, isConversation: true },
];

// ── Component ──

interface ContextPickerProps {
  entityCatalog: DetectableEntity[];
  onSelect: (ref: ContextReference) => void;
  onClose: () => void;
  filter: string;
}

export function ContextPicker({ entityCatalog, onSelect, onClose, filter }: ContextPickerProps) {
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [items, setItems] = useState<PickerItem[]>([]);
  const activeRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const activeCategory = activeCategoryId
    ? CATEGORIES.find((c) => c.id === activeCategoryId) ?? null
    : null;

  // Build items asynchronously to support async conversation store API
  useEffect(() => {
    let cancelled = false;

    async function buildItems() {
      const lower = filter.toLowerCase();

      if (!activeCategory) {
        const cats = CATEGORIES.filter((c) => !lower || c.label.toLowerCase().includes(lower));
        let convCount = "";
        if (activeCategoryId === null) {
          const convs = await getAllConversations();
          convCount = `${convs.length}`;
        }

        if (cancelled) return;
        setItems(cats.map((c) => ({
          id: c.id,
          kind: "category",
          label: c.label,
          stat: c.id === "conversation" ? convCount : getCategoryCountFromCatalog(c, entityCatalog),
          icon: c.icon,
          ref: {
            id: c.id,
            type: "page",
            name: c.label,
            displayLabel: c.label,
            contextPayload: { page: c.id },
          },
        })));
        return;
      }

      if (activeCategory.isConversation) {
        const convs = await getAllConversations();
        if (cancelled) return;
        const filtered = convs.filter((c) => !lower || c.title.toLowerCase().includes(lower));
        setItems(filtered.slice(0, 20).map((c) => {
          const userMsg = c.messages?.find((m) => m.role === "user");
          return {
            id: c.id,
            kind: "entity",
            label: c.title,
            icon: <MessageSquare className="w-4 h-4" />,
            ref: {
              id: c.id,
              type: "conversation",
              name: c.title,
              displayLabel: `Chats / ${c.title}`,
              contextPayload: {
                title: c.title,
                query: userMsg?.content,
              },
            },
          };
        }));
        return;
      }

      const type = activeCategory.entityType!;
      const entities = entityCatalog
        .filter((e) => e.type === type)
        .filter((e) => !lower || e.name.toLowerCase().includes(lower) || e.description?.toLowerCase().includes(lower));

      if (cancelled) return;
      setItems(entities.slice(0, 30).map((e) => ({
        id: e.id,
        kind: "entity",
        label: e.name,
        icon: activeCategory.icon,
        ref: {
          id: e.id,
          type: e.type,
          name: e.name,
          displayLabel: `${activeCategory.label} / ${e.name}`,
          contextPayload: e.contextPayload,
        },
      })));
    }

    buildItems();

    return () => {
      cancelled = true;
    };
  }, [activeCategory, activeCategoryId, entityCatalog, filter]);

  // Reset index when view changes
  useEffect(() => {
    setActiveIndex(0);
  }, [activeCategoryId, filter]);

  // Scroll active into view
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  // Keyboard handler
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, items.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        e.stopImmediatePropagation();
        const item = items[activeIndex];
        if (!item) return;

        if (item.kind === "category") {
          setActiveCategoryId(item.id);
        } else {
          onSelect(item.ref);
        }
      } else if (e.key === "ArrowLeft" || (e.key === "Backspace" && !filter)) {
        if (activeCategoryId) {
          e.preventDefault();
          setActiveCategoryId(null);
        }
      } else if (e.key === "ArrowRight") {
        const item = items[activeIndex];
        if (item?.kind === "category") {
          e.preventDefault();
          setActiveCategoryId(item.id);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (activeCategoryId) {
          setActiveCategoryId(null);
        } else {
          onClose();
        }
      }
    },
    [items, activeIndex, activeCategoryId, filter, onSelect, onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [handleKeyDown]);

  return (
    <div
      ref={containerRef}
      className=""
    >
      {/* Header (drill-down) */}
      {activeCategory && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border/20">
          <button
            onMouseDown={(e) => { e.preventDefault(); setActiveCategoryId(null); }}
            className="p-0.5 rounded hover:bg-white/[0.06] text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-3 h-3" />
          </button>
          <span className="text-[9.9px] font-semibold text-foreground/70">{activeCategory.label}</span>
        </div>
      )}

      {/* Items */}
      <div className="overflow-y-auto" style={{ maxHeight: 210 }}>
        {items.length === 0 && (
          <div className="px-3 py-3 text-center">
            <p className="text-[9.9px] text-muted-foreground/60">
              {filter ? `No results for "${filter}"` : "No items"}
            </p>
          </div>
        )}
        {items.map((item, idx) => {
          const isActive = idx === activeIndex;
          return (
            <button
              key={item.id}
              ref={isActive ? activeRef : undefined}
              role="option"
              aria-selected={isActive}
              onMouseDown={(e) => {
                e.preventDefault();
                if (item.kind === "category") {
                  setActiveCategoryId(item.id);
                } else {
                  onSelect(item.ref);
                }
              }}
              onMouseEnter={() => setActiveIndex(idx)}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                isActive ? "bg-white/[0.06] text-foreground" : "text-foreground/80 hover:bg-white/[0.04]"
              }`}
            >
              <span className="shrink-0 text-muted-foreground/60 [&_svg]:w-3.5 [&_svg]:h-3.5">{item.icon}</span>
              <span className="truncate font-medium">{item.label}</span>
              <span className="ml-auto flex items-center gap-1.5 shrink-0">
                {item.stat && (
                  <span className="text-[9.9px] text-muted-foreground/40">{item.stat}</span>
                )}
                {item.kind === "category" && (
                  <ChevronRight className="w-3 h-3 text-muted-foreground/30" />
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Item building helpers ──

interface PickerItem {
  id: string;
  kind: "category" | "entity";
  label: string;
  stat?: string;
  icon: React.ReactNode;
  ref: ContextReference;
}

function getCategoryCountFromCatalog(category: Category, entityCatalog: DetectableEntity[]): string {
  if (category.isConversation) return "";
  if (!category.entityType) return "";
  const count = entityCatalog.filter((e) => e.type === category.entityType).length;
  return count > 0 ? `${count}` : "";
}
