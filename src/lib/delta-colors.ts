/**
 * Color for a numeric delta / change indicator.
 *
 * The UI is otherwise strictly monochrome; deltas are the one explicitly
 * requested colored signal: positive (a "+" value) renders green, negative
 * (a "−" value) renders red, and zero / missing stays muted. The actual colors
 * live in CSS tokens (`--delta-up` / `--delta-down`) so they can be tuned in
 * one place.
 */
export function deltaColorClass(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value) || value === 0) return "text-muted-foreground";
  // The `color:` hint is required — `text-[var(--x)]` is ambiguous to Tailwind v4
  // (could be a font-size) and won't compile to a color without it.
  return value > 0 ? "text-[color:var(--delta-up)]" : "text-[color:var(--delta-down)]";
}
