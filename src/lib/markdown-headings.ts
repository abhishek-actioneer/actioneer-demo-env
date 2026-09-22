export interface MarkdownHeading {
  id: string;
  text: string;
  level: 1 | 2 | 3;
}

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([a-z][\w-]*):Q(\d+)\]/gi, "")
    .trim();
}

function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "section";
}

export function extractMarkdownHeadings(content: string): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  const slugCounts = new Map<string, number>();
  let inCodeFence = false;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;

    let level: 1 | 2 | 3 | null = null;
    let raw = "";

    if (line.startsWith("### ")) {
      level = 3;
      raw = line.slice(4);
    } else if (line.startsWith("## ")) {
      level = 2;
      raw = line.slice(3);
    } else if (line.startsWith("# ")) {
      level = 1;
      raw = line.slice(2);
    }

    if (!level) continue;

    const text = stripInlineMarkdown(raw);
    const base = slugify(text);
    const seen = slugCounts.get(base) ?? 0;
    slugCounts.set(base, seen + 1);
    const id = seen === 0 ? base : `${base}-${seen + 1}`;

    headings.push({ id, text: text || "Section", level });
  }

  return headings;
}
