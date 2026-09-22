"use client";

import { useState, useRef, useCallback, useEffect, useImperativeHandle, forwardRef } from "react";
import { ArrowUp, Square, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import type { DetectableEntity, DetectedDateRange } from "@/lib/entity-types";
import { detectDateRange } from "@/lib/temporal-parser";
import { ContextPicker, type ContextReference } from "./context-picker";
import type { ChatSendOptions, VoiceAgentPromptContext } from "@/lib/voice-agent-generation-types";

// ── ChatInput ──

export interface ChatInputHandle {
  focus: () => void;
  setValue: (text: string) => void;
  setQuotedContext: (text: string) => void;
  /** Silently attach LLM context to the next submission — not shown in UI */
  setSilentContext: (ctx: string) => void;
  /** Populate prompt text without sending — lets user review context + prompt before Enter */
  suggest: (text: string) => void;
  /** Inject a context reference chip (e.g. from a chart click) */
  addContextRef: (ref: ContextReference) => void;
  /** Attach structured audience context to the next home voice-agent submission. */
  setVoiceAgentContext: (context: VoiceAgentPromptContext) => void;
}

export interface EntityContext {
  entities: never[];
  dateRange: DetectedDateRange;
}

interface ChatInputProps {
  onSend: (text: string, entityContext?: EntityContext, contextRefs?: ContextReference[], silentContext?: string, options?: ChatSendOptions) => void;
  onStop?: () => void;
  deepResearch: boolean;
  onToggleDeepResearch: () => void;
  isProcessing?: boolean;
  entityCatalog?: DetectableEntity[];
  runCatalog?: DetectableEntity[];
  schemaContext?: string;
  onInputChange?: (hasContent: boolean) => void;
  contextBadge?: { label: string; sublabel?: string };
  /** When set, populates the textarea without sending. Cleared after consumption. */
  pendingPrompt?: string | null;
  onPendingPromptConsumed?: () => void;
  /** Open picker above the input instead of below (use when input is at bottom of viewport) */
  dropUp?: boolean;
  /** Hide the deep research toggle (used in compact sidebar chat) */
  hideDeepResearchToggle?: boolean;
  /** Use tighter outer spacing when embedded in the sidebar footer */
  compactChrome?: boolean;
  placeholder?: string;
}

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(function ChatInput({
  onSend,
  onStop,
  deepResearch,
  onToggleDeepResearch,
  isProcessing,
  entityCatalog,
  runCatalog,
  onInputChange,
  contextBadge,
  pendingPrompt,
  onPendingPromptConsumed,
  dropUp,
  hideDeepResearchToggle,
  compactChrome,
  placeholder,
}, ref) {
  const [value, setValue] = useState("");
  const [quotedContext, setQuotedContext] = useState<string | null>(null);
  const [silentContext, setSilentContextState] = useState<string | null>(null);
  const [voiceAgentContext, setVoiceAgentContext] = useState<VoiceAgentPromptContext | null>(null);
  const [popped, setPopped] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Context picker state (@ references)
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerFilter, setPickerFilter] = useState("");
  const [pickerAnchorPos, setPickerAnchorPos] = useState(-1);
  const [contextRefs, setContextRefs] = useState<ContextReference[]>([]);

  // /run picker state
  const [runPickerActive, setRunPickerActive] = useState(false);
  const [runPickerFilter, setRunPickerFilter] = useState("");

  useEffect(() => {
    onInputChange?.(value.trim().length > 0);
  }, [value, onInputChange]);

  // Consume pending prompt (from suggested actions) — populate textarea without sending
  useEffect(() => {
    if (pendingPrompt) {
      setValue(pendingPrompt);
      onPendingPromptConsumed?.();
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.style.height = "auto";
          el.style.height = Math.min(el.scrollHeight, 160) + "px";
          el.setSelectionRange(pendingPrompt.length, pendingPrompt.length);
        }
      });
    }
  }, [pendingPrompt, onPendingPromptConsumed]);

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
    setValue: (text: string) => {
      setValue(text);
      setVoiceAgentContext(null);
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.style.height = "auto";
          textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
        }
      });
    },
    setQuotedContext: (text: string) => {
      setQuotedContext(text.slice(0, 2000));
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    setSilentContext: (ctx: string) => {
      setSilentContextState(ctx);
    },
    suggest: (text: string) => {
      setValue(text);
      setVoiceAgentContext(null);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.style.height = "auto";
          el.style.height = Math.min(el.scrollHeight, 160) + "px";
          el.setSelectionRange(text.length, text.length);
        }
      });
    },
    addContextRef: (ref: ContextReference) => {
      setContextRefs((prev) =>
        prev.some((r) => r.id === ref.id) ? prev : [...prev, ref],
      );
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    setVoiceAgentContext: (context: VoiceAgentPromptContext) => {
      setVoiceAgentContext(context);
    },
  }));

  // Handle context picker selection
  const handleContextSelect = useCallback(
    (ctxRef: ContextReference) => {
      // Remove the @filter text from value
      const before = value.slice(0, pickerAnchorPos);
      const afterAnchor = value.slice(pickerAnchorPos);
      // Find end of @... token (up to space or end)
      const tokenEnd = afterAnchor.indexOf(" ");
      const after = tokenEnd >= 0 ? afterAnchor.slice(tokenEnd) : "";
      const newValue = `${before}${after}`;
      setValue(newValue);

      // Add to context refs (avoid duplicates)
      setContextRefs((prev) =>
        prev.some((r) => r.id === ctxRef.id) ? prev : [...prev, ctxRef]
      );

      setPickerOpen(false);
      setPickerFilter("");
      setPickerAnchorPos(-1);

      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.focus();
          const cursorPos = before.length;
          el.setSelectionRange(cursorPos, cursorPos);
        }
      });
    },
    [value, pickerAnchorPos],
  );

  // Handle /run picker selection — add playbook as a chip and let user keep typing
  const handleRunSelect = useCallback(
    (entity: DetectableEntity) => {
      setRunPickerActive(false);
      setRunPickerFilter("");
      // Remove the /run... text, leave cursor for user to type instructions
      setValue("");

      // Add the playbook as a context reference chip
      const playbookId = (entity.contextPayload?.playbookId as string) ?? entity.id;
      setContextRefs((prev) => [
        ...prev.filter((r) => r.type !== "playbook"), // only one playbook at a time
        {
          id: playbookId,
          type: "playbook" as ContextReference["type"],
          name: entity.name,
          displayLabel: entity.name,
          contextPayload: { playbookId, ...(entity.contextPayload ?? {}) },
        },
      ]);

      // Focus textarea so user can continue typing instructions
      setTimeout(() => textareaRef.current?.focus(), 50);
    },
    [],
  );

  const removeContextRef = useCallback((id: string) => {
    setContextRefs((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const handleSubmit = useCallback(() => {
    const text = value.trim();
    if (!text && contextRefs.length === 0) return;

    // Context refs are passed separately — rich context is built in use-analytics.ts
    const fullText = [
      quotedContext ? `> ${quotedContext}\n\n` : "",
      text,
    ].join("").trim();

    const dateRange = detectDateRange(fullText);
    const entityContext: EntityContext | undefined =
      dateRange && !dateRange.isDefault
        ? { entities: [], dateRange }
        : undefined;

    onSend(
      fullText,
      entityContext,
      contextRefs.length > 0 ? [...contextRefs] : undefined,
      silentContext ?? undefined,
      voiceAgentContext ? { voiceAgentContext } : undefined,
    );
    setValue("");
    setQuotedContext(null);
    setSilentContextState(null);
    setVoiceAgentContext(null);
    setContextRefs([]);
    setPickerOpen(false);
    setRunPickerActive(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [value, quotedContext, silentContext, onSend, contextRefs, voiceAgentContext]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (pickerOpen || runPickerActive) return;

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newVal = e.target.value;
    setValue(newVal);
    onInputChange?.(newVal.trim().length > 0);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";

    // @ context picker detection
    const cursor = el.selectionStart ?? newVal.length;
    const textBeforeCursor = newVal.slice(0, cursor);
    const lastAtIdx = textBeforeCursor.lastIndexOf("@");

    if (lastAtIdx >= 0) {
      const charBefore = lastAtIdx > 0 ? textBeforeCursor[lastAtIdx - 1] : " ";
      const afterAt = textBeforeCursor.slice(lastAtIdx + 1);
      // Only trigger if @ is at start or after a space, and no newlines after it
      if ((charBefore === " " || charBefore === "\n" || lastAtIdx === 0) && !/\n/.test(afterAt)) {
        setPickerOpen(true);
        setPickerFilter(afterAt);
        setPickerAnchorPos(lastAtIdx);
      } else {
        setPickerOpen(false);
      }
    } else {
      setPickerOpen(false);
    }

    // /run picker detection
    if (newVal.startsWith("/run")) {
      const afterRun = newVal.slice(4);
      if (afterRun === "" || afterRun.startsWith(" ")) {
        setRunPickerActive(true);
        setRunPickerFilter(afterRun.trim());
      } else {
        setRunPickerActive(false);
      }
    } else {
      setRunPickerActive(false);
    }
  };

  const handlePickerClose = useCallback(() => {
    setPickerOpen(false);
    setPickerFilter("");
  }, []);

  const handleRunPickerClose = useCallback(() => {
    setRunPickerActive(false);
  }, []);

  return (
    <div data-tour="tour-ask" className={`${compactChrome ? "px-0 pb-0 pt-0" : "px-4 pb-4 pt-2"} max-w-[52rem] mx-auto w-full`}>
      <div className={`relative transition-transform duration-220 ease-out will-change-transform ${popped ? "scale-[1.01]" : "scale-100"}`}>
        {/* /run picker dropdown — outside overflow-clip container */}
        {runPickerActive && runCatalog && runCatalog.length > 0 && (
          <RunPickerDropdown
            catalog={runCatalog}
            filter={runPickerFilter}
            onSelect={handleRunSelect}
            onClose={handleRunPickerClose}
          />
        )}

        <div className={`relative overflow-clip rounded-none border border-border bg-muted/40 backdrop-blur-xl transition-[box-shadow] focus-within:ring-2 focus-within:ring-ring/20 ${
          pickerOpen
            ? dropUp
              ? "border-t-0"
              : "border-b-0"
            : ""
        }`}>

          {/* Slash command hint */}
          {value.startsWith("/") && !value.includes(" ") && !runPickerActive && (
            <div className="px-4 pt-2 pb-0 space-y-1">
              <div className="text-xs text-muted-foreground bg-muted/50 rounded-md px-2.5 py-1.5 inline-block">
                <span className="font-mono font-medium">/playbook</span>
                <span className="ml-1.5 text-muted-foreground/70">&quot;describe your analysis&quot;: Create a new playbook</span>
              </div>
              <div className="text-xs text-muted-foreground bg-muted/50 rounded-md px-2.5 py-1.5 inline-block">
                <span className="font-mono font-medium">/run</span>
                <span className="ml-1.5 text-muted-foreground/70">Run a saved playbook with parameters</span>
              </div>
            </div>
          )}

          {/* Non-playbook context reference chips (above textarea) */}
          {contextRefs.filter((r) => r.type !== "playbook").length > 0 && (
            <div className="flex flex-wrap gap-1.5 mx-3 mt-3">
              {contextRefs.filter((r) => r.type !== "playbook").map((ctxRef) => (
                <span
                  key={ctxRef.id}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-foreground/[0.08] text-foreground/80 rounded-md"
                >
                  @{ctxRef.displayLabel}
                  <button
                    onClick={() => removeContextRef(ctxRef.id)}
                    className="ml-0.5 text-muted-foreground/50 hover:text-foreground transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Quoted context block */}
          {quotedContext && (
            <div className="mx-3 mt-3 flex items-start gap-2.5 rounded-lg bg-muted/50 px-3 py-2.5">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="shrink-0 mt-0.5 text-muted-foreground/60"
              >
                <path d="M4.583 17.321C3.553 16.227 3 15 3 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311 1.804.167 3.226 1.648 3.226 3.489a3.5 3.5 0 0 1-3.5 3.5c-1.073 0-2.099-.49-2.748-1.179zm10 0C13.553 16.227 13 15 13 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311 1.804.167 3.226 1.648 3.226 3.489a3.5 3.5 0 0 1-3.5 3.5c-1.073 0-2.099-.49-2.748-1.179z" />
              </svg>
              <p className="flex-1 text-xs text-muted-foreground line-clamp-3 leading-relaxed">
                {quotedContext}
              </p>
              <button
                onClick={() => setQuotedContext(null)}
                className="shrink-0 mt-0.5 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Textarea with inline playbook chip */}
          <div className="flex flex-wrap items-start gap-1 px-4 pt-3 pb-0">
            {/* Inline playbook run chip */}
            {contextRefs.filter((r) => r.type === "playbook").map((ctxRef) => (
              <span
                key={ctxRef.id}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-[11.7px] font-medium bg-foreground/10 text-foreground border border-foreground/15 rounded-md shrink-0 mt-0.5 max-w-[70%]"
              >
                <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor" className="shrink-0 opacity-70">
                  <path d="M4 2l10 6-10 6V2z" />
                </svg>
                <span className="truncate">Run {ctxRef.displayLabel}</span>
                <button
                  onClick={() => removeContextRef(ctxRef.id)}
                  className="ml-0.5 text-muted-foreground/40 hover:text-foreground transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            <textarea
              ref={textareaRef}
              value={value}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              onFocus={() => { setPopped(true); setTimeout(() => setPopped(false), 220); }}
              placeholder={contextRefs.some((r) => r.type === "playbook") ? "Add instructions (optional)..." : placeholder || "What do you want to know?"}
              rows={2}
              className="flex-1 min-w-[120px] py-1 text-sm bg-transparent resize-none focus:outline-none placeholder:text-muted-foreground"
            />
          </div>

          {/* Bottom bar */}
          <div className="flex items-center justify-between px-4 pb-3">
            <div className="flex items-center gap-4">
              {hideDeepResearchToggle && contextBadge ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[9.9px] font-medium bg-foreground/[0.06] text-muted-foreground rounded-md">
                  <span className="w-1.5 h-1.5 rounded-full bg-foreground/30" />
                  {contextBadge.sublabel ?? contextBadge.label}
                </span>
              ) : !hideDeepResearchToggle && (
                <div className="flex items-center gap-2">
                  <Switch
                    checked={deepResearch}
                    onCheckedChange={onToggleDeepResearch}
                    className="h-5 w-9 data-[state=checked]:bg-foreground"
                  />
                  <span className="text-xs text-muted-foreground">
                    Deep Research
                  </span>
                </div>
              )}
            </div>

            <button
              onClick={isProcessing && !value.trim() && contextRefs.length === 0 ? onStop : handleSubmit}
              disabled={!value.trim() && !isProcessing && contextRefs.length === 0}
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-[background-color,transform] active:scale-[0.92] ${
                isProcessing && !value.trim() && contextRefs.length === 0
                  ? "bg-foreground text-background"
                  : value.trim() || contextRefs.length > 0
                    ? "bg-foreground text-background hover:bg-foreground/90"
                    : "bg-foreground/80 text-background"
              }`}
            >
              {isProcessing && !value.trim() && contextRefs.length === 0 ? (
                <Square className="w-3.5 h-3.5" fill="currentColor" />
              ) : (
                <ArrowUp className="w-4 h-4" />
              )}
            </button>
          </div>

        </div>

        {/* Context picker (@ references) */}
        {pickerOpen && entityCatalog && (
          <div className={`absolute left-0 right-0 z-50 border border-border/20 bg-white/[0.08] backdrop-blur-xl overflow-clip ${
            dropUp
              ? "bottom-full border-b-0 rounded-t-2xl"
              : "top-full border-t-0 rounded-b-2xl"
          }`}>
            <ContextPicker
              entityCatalog={entityCatalog}
              onSelect={handleContextSelect}
              onClose={handlePickerClose}
              filter={pickerFilter}
            />
          </div>
        )}
      </div>

      {/* Page context badge */}
      {contextBadge && !hideDeepResearchToggle && (
        <div className="flex items-center gap-1.5 mt-1.5 px-1">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[9.9px] font-medium bg-foreground/[0.06] text-muted-foreground rounded-md">
            <span className="w-1.5 h-1.5 rounded-full bg-foreground/30" />
            {contextBadge.label}
          </span>
          {contextBadge.sublabel && (
            <span className="text-[9.9px] text-muted-foreground/50 truncate">
              {contextBadge.sublabel}
            </span>
          )}
        </div>
      )}
    </div>
  );
});

// ── Simple /run picker (replaces MentionDropdown for /run only) ──

function RunPickerDropdown({
  catalog,
  filter,
  onSelect,
  onClose,
}: {
  catalog: DetectableEntity[];
  filter: string;
  onSelect: (entity: DetectableEntity) => void;
  onClose: () => void;
}) {
  const q = filter.toLowerCase();
  const filtered = catalog
    .filter((e) => !q || e.name.toLowerCase().includes(q))
    .slice(0, 10);

  const [activeIndex, setActiveIndex] = useState(0);
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { setActiveIndex(0); }, [filter]);
  useEffect(() => { activeRef.current?.scrollIntoView({ block: "nearest" }); }, [activeIndex]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        if (filtered[activeIndex]) onSelect(filtered[activeIndex]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [filtered, activeIndex, onSelect, onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [handleKeyDown]);

  if (filtered.length === 0) {
    return (
      <div className="absolute bottom-full left-0 right-0 mb-1 mx-4 bg-popover border border-border rounded-lg shadow-lg p-3 z-50">
        <p className="text-xs text-muted-foreground text-center">No playbooks found</p>
      </div>
    );
  }

  return (
    <div
      className="absolute bottom-full left-0 right-0 mb-1 mx-4 bg-popover border border-border rounded-lg shadow-lg overflow-hidden z-50"
      style={{ maxHeight: 240 }}
    >
      <div className="px-3 py-1.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60 bg-muted/30">
        Run Playbook
      </div>
      <div className="overflow-y-auto" style={{ maxHeight: 200 }}>
        {filtered.map((entity, idx) => {
          const isActive = idx === activeIndex;
          return (
            <button
              key={entity.id}
              ref={isActive ? activeRef : undefined}
              onMouseDown={(e) => { e.preventDefault(); onSelect(entity); }}
              onMouseEnter={() => setActiveIndex(idx)}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
                isActive ? "bg-accent text-accent-foreground" : "hover:bg-muted/50"
              }`}
            >
              <span className="truncate font-medium">{entity.name}</span>
              {entity.stat && (
                <span className="ml-auto text-xs text-muted-foreground shrink-0">{entity.stat}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
