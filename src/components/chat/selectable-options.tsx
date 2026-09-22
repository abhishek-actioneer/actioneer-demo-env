"use client";

/**
 * Extracts numbered options (1. 2. 3.) from markdown text and renders them
 * as clickable buttons. The preamble text before the options is returned
 * separately for normal markdown rendering.
 */

interface SelectableOptionsProps {
  content: string;
  onSelect: (optionText: string) => void;
  disabled?: boolean;
}

interface ParsedContent {
  preamble: string;
  options: { number: number; text: string }[];
}

export function parseNumberedOptions(content: string): ParsedContent {
  const lines = content.split("\n");
  const options: { number: number; text: string }[] = [];
  const preambleLines: string[] = [];
  let foundFirstOption = false;

  for (const line of lines) {
    const match = line.match(/^(\d+)\.\s+(.+)/);
    if (match) {
      foundFirstOption = true;
      options.push({ number: parseInt(match[1]), text: match[2].trim() });
    } else if (!foundFirstOption) {
      preambleLines.push(line);
    }
    // Skip lines after options start that aren't numbered (continuation lines)
  }

  return {
    preamble: preambleLines.join("\n").trim(),
    options,
  };
}

export function hasNumberedOptions(content: string): boolean {
  return /^\d+\.\s+/m.test(content);
}

export function SelectableOptions({ content, onSelect, disabled }: SelectableOptionsProps) {
  const { options } = parseNumberedOptions(content);

  if (options.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5 mt-3">
      {options.map((opt) => (
        <button
          key={opt.number}
          onClick={() => onSelect(`Option ${opt.number}: ${opt.text}`)}
          disabled={disabled}
          className="w-full text-left px-3 py-2.5 rounded-md border border-border hover:bg-muted/50 hover:border-foreground/20 transition-all duration-150 active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none group"
        >
          <div className="flex items-start gap-2.5">
            <span className="text-xs font-semibold text-muted-foreground mt-0.5 shrink-0 w-4">{opt.number}.</span>
            <span className="text-xs text-foreground leading-relaxed">{opt.text}</span>
          </div>
        </button>
      ))}
    </div>
  );
}
