"use client";

import {
  parseConversationScript,
  serializeConversationScript,
  scriptTextareaRows,
  type ConversationScriptLine,
} from "@/lib/voice-campaign-studio-utils";

export function ConversationScriptReader({
  scriptText,
  onChange,
}: {
  scriptText: string;
  onChange: (value: string) => void;
}) {
  const sections = parseConversationScript(scriptText);

  function updateSectionTitle(sectionIndex: number, title: string) {
    const next = sections.map((section, index) => (
      index === sectionIndex ? { ...section, title } : section
    ));
    onChange(serializeConversationScript(next));
  }

  function updateLine(sectionIndex: number, lineIndex: number, text: string) {
    const next = sections.map((section, index) => {
      if (index !== sectionIndex) return section;
      return {
        ...section,
        lines: section.lines.map((line, innerIndex) => (
          innerIndex === lineIndex ? { ...line, text } : line
        )),
      };
    });
    onChange(serializeConversationScript(next));
  }

  if (!scriptText.trim()) {
    return (
      <div className="max-w-4xl rounded-md border border-dashed border-border bg-muted/10 px-6 py-12 text-left text-sm text-muted-foreground">
        Generate or write the conversation script the agent should follow during the call.
      </div>
    );
  }

  return (
    <div className="max-w-5xl py-2">
      {sections.map((section, sectionIndex) => (
        <section
          key={`${section.number ?? "section"}-${section.title}-${sectionIndex}`}
          className="group grid grid-cols-[28px_minmax(0,1fr)] gap-3 border-b border-border/40 py-5 last:border-b-0 first:pt-0"
        >
          <div className="pt-1.5 text-left text-xs tabular-nums text-muted-foreground/70">
            {section.number ?? ""}
          </div>
          <div className="min-w-0">
            <input
              value={section.title}
              onChange={(event) => updateSectionTitle(sectionIndex, event.target.value)}
              className="w-full rounded-sm border-0 bg-transparent px-0 py-0 text-base font-semibold leading-7 text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:bg-muted/20 focus:px-1"
              aria-label={`Section ${section.number ?? sectionIndex + 1} title`}
            />
            {section.lines.length > 0 && (
              <div className="mt-3 space-y-2">
                {section.lines.map((line, lineIndex) => (
                  <ConversationScriptLineView
                    key={`${line.kind}-${lineIndex}-${line.text.slice(0, 24)}`}
                    line={line}
                    onChange={(text) => updateLine(sectionIndex, lineIndex, text)}
                  />
                ))}
              </div>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

export function ConversationScriptLineView({
  line,
  onChange,
}: {
  line: ConversationScriptLine;
  onChange: (value: string) => void;
}) {
  const rows = scriptTextareaRows(line.text, line.kind === "say" ? 2 : 1);

  if (line.kind === "say") {
    return (
      <div className="grid grid-cols-[68px_minmax(0,1fr)] gap-3 rounded-sm py-1">
        <div className="pt-1.5 text-[9.9px] font-medium uppercase tracking-wide text-muted-foreground/80">
          Say
        </div>
        <textarea
          value={line.text}
          onChange={(event) => onChange(event.target.value)}
          rows={rows}
          className="min-h-0 w-full resize-none rounded-sm border-0 bg-transparent px-0 py-1 text-[13.5px] leading-7 text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:bg-muted/20 focus:px-2"
        />
      </div>
    );
  }

  if (line.kind === "note") {
    return (
      <div className="grid grid-cols-[68px_minmax(0,1fr)] gap-3 rounded-sm py-0.5">
        <div className="pt-1 text-[9.9px] font-medium uppercase tracking-wide text-muted-foreground/80">
          Note
        </div>
        <textarea
          value={line.text}
          onChange={(event) => onChange(event.target.value)}
          rows={rows}
          className="min-h-0 w-full resize-none rounded-sm border-0 bg-transparent px-0 py-1 text-sm leading-6 text-muted-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:bg-muted/20 focus:px-2 focus:text-foreground"
        />
      </div>
    );
  }

  if (line.kind === "route") {
    return (
      <div className="grid grid-cols-[68px_minmax(0,1fr)] gap-3 rounded-sm py-0.5">
        <div className="pt-1 text-[9.9px] font-medium uppercase tracking-wide text-muted-foreground/80">
          Route
        </div>
        <textarea
          value={line.text}
          onChange={(event) => onChange(event.target.value)}
          rows={rows}
          className="min-h-0 w-full resize-none rounded-sm border-0 bg-transparent px-0 py-1 font-mono text-xs leading-5 text-muted-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:bg-muted/20 focus:px-2 focus:text-foreground"
        />
      </div>
    );
  }

  return (
    <textarea
      value={line.text}
      onChange={(event) => onChange(event.target.value)}
      rows={rows}
      className="min-h-0 w-full resize-none rounded-sm border-0 bg-transparent px-0 py-1 text-sm leading-6 text-muted-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:bg-muted/20 focus:px-2 focus:text-foreground"
    />
  );
}
