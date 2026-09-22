"use client";

import { useState } from "react";

export interface ChartShellProps {
  title: string;
  onTitleChange?: (title: string) => void;
  variant: "compact" | "normal" | "expanded";
  controls?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

function EditableTitle({
  title,
  onTitleChange,
}: {
  title: string;
  onTitleChange?: (t: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);

  if (!onTitleChange) {
    return <p className="text-sm font-medium text-foreground truncate">{title}</p>;
  }

  if (editing) {
    return (
      <input
        autoFocus
        className="text-base font-medium text-foreground bg-transparent border-none outline-none w-full"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (draft.trim() && draft.trim() !== title) onTitleChange(draft.trim());
          else setDraft(title);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(title);
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <p
      className="text-sm font-medium text-foreground truncate cursor-text"
      onClick={() => {
        setDraft(title);
        setEditing(true);
      }}
    >
      {title}
    </p>
  );
}

export function ChartShell({
  title,
  onTitleChange,
  variant,
  controls,
  actions,
  children,
}: ChartShellProps) {
  const isCompact = variant === "compact";

  return (
    <div className="flex flex-col h-full overflow-hidden antialiased">
      {/* Header */}
      <div className="px-5 pt-4 pb-2 shrink-0 space-y-2">
        {title ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <div className="flex-1 min-w-0">
                <EditableTitle title={title} onTitleChange={onTitleChange} />
              </div>
              {actions && (
                <div className="flex items-center gap-1 shrink-0">
                  {actions}
                </div>
              )}
            </div>
            {!isCompact && controls && (
              <div className="flex items-center">
                {controls}
              </div>
            )}
          </>
        ) : (
          /* No title — put controls and actions on one row */
          !isCompact && (controls || actions) && (
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center flex-1 min-w-0">
                {controls}
              </div>
              {actions && (
                <div className="flex items-center gap-1 shrink-0">
                  {actions}
                </div>
              )}
            </div>
          )
        )}
      </div>

      {/* Chart content */}
      <div className="flex-1 min-h-0">
        {children}
      </div>
    </div>
  );
}
