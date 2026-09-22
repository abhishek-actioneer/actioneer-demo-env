"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { ChevronDown, Check } from "lucide-react";

interface EditableCellProps {
  value: string | number;
  type: "text" | "number" | "select";
  options?: { value: string; label: string }[];
  prefix?: string;
  placeholder?: string;
  onSave: (newValue: string | number) => void;
  validate?: (value: string) => boolean;
  editing?: boolean;
  onEditStart?: () => void;
  onEditEnd?: () => void;
  className?: string;
}

export function EditableCell({
  value,
  type,
  options,
  prefix,
  placeholder = "---",
  onSave,
  validate,
  editing = false,
  onEditStart,
  onEditEnd,
  className = "",
}: EditableCellProps) {
  const [localValue, setLocalValue] = useState(String(value));
  const inputRef = useRef<HTMLInputElement>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Sync local value when prop changes
  useEffect(() => {
    if (!editing) {
      setLocalValue(String(value));
    }
  }, [value, editing]);

  // Auto-focus when entering edit mode
  useEffect(() => {
    if (editing && type !== "select") {
      setLocalValue(String(value));
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [editing, value, type]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [dropdownOpen]);

  const commitValue = useCallback(() => {
    const trimmed = localValue.trim();

    if (validate && !validate(trimmed)) {
      setLocalValue(String(value));
      onEditEnd?.();
      return;
    }

    if (type === "number") {
      const num = parseFloat(trimmed);
      if (isNaN(num) || num < 0) {
        setLocalValue(String(value));
        onEditEnd?.();
        return;
      }
      if (num !== value) {
        onSave(num);
      }
    } else {
      if (trimmed !== String(value)) {
        onSave(trimmed);
      }
    }

    onEditEnd?.();
  }, [localValue, value, type, validate, onSave, onEditEnd]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitValue();
      } else if (e.key === "Escape") {
        e.preventDefault();
        setLocalValue(String(value));
        onEditEnd?.();
      }
    },
    [commitValue, value, onEditEnd]
  );

  // ── Select type: custom dropdown ──
  if (type === "select" && options) {
    const currentLabel = options.find((o) => o.value === String(value))?.label ?? String(value);

    return (
      <div ref={dropdownRef} className="relative">
        <button
          onClick={() => setDropdownOpen((p) => !p)}
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11.7px] hover:bg-muted/50 transition-colors w-full text-left min-h-[28px] ${className}`}
        >
          <span className="flex-1 truncate">{currentLabel}</span>
          <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
        </button>

        {dropdownOpen && (
          <div className="absolute top-full left-0 mt-1 z-50 min-w-[160px] bg-background border border-border rounded-lg shadow-lg py-1 animate-in fade-in-0 zoom-in-95 duration-100">
            {options.map((o) => (
              <button
                key={o.value}
                onClick={() => {
                  if (o.value !== String(value)) {
                    onSave(o.value);
                  }
                  setDropdownOpen(false);
                }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-[11.7px] hover:bg-muted transition-colors text-left ${
                  o.value === String(value) ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                <span className="w-3.5 flex items-center justify-center shrink-0">
                  {o.value === String(value) && <Check className="w-3 h-3" />}
                </span>
                {o.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Display mode ──
  if (!editing) {
    const displayValue =
      type === "number"
        ? `${prefix || ""}${Number(value).toFixed(2)}`
        : String(value) || placeholder;
    const isEmpty = !value && value !== 0;

    return (
      <div
        onMouseDown={(e) => {
          e.stopPropagation();
          onEditStart?.();
        }}
        className={`px-1.5 py-0.5 rounded cursor-text text-[11.7px] hover:bg-muted/50 transition-colors min-h-[28px] flex items-center ${
          isEmpty ? "text-muted-foreground/50" : ""
        } ${className}`}
      >
        {displayValue}
      </div>
    );
  }

  // ── Edit mode ──
  return (
    <input
      ref={inputRef}
      type={type === "number" ? "number" : "text"}
      value={localValue}
      onChange={(e) => setLocalValue(e.target.value)}
      onBlur={commitValue}
      onKeyDown={handleKeyDown}
      step={type === "number" ? "0.01" : undefined}
      min={type === "number" ? "0" : undefined}
      placeholder={placeholder}
      className={`w-full bg-transparent text-[11.7px] px-1.5 py-0.5 rounded outline-none ring-2 ring-ring/20 min-h-[28px] ${className}`}
    />
  );
}
