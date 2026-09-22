export function formatValue(value: number | null | undefined, format: string, currency?: string): string {
  if (value == null || isNaN(value)) return "—";
  const sym = currency || "₹";
  switch (format) {
    case "currency":
      return value >= 1_000_000_000
        ? `${sym}${(value / 1_000_000_000).toFixed(1)}B`
        : value >= 1_000_000
        ? `${sym}${(value / 1_000_000).toFixed(1)}M`
        : value >= 1_000
        ? `${sym}${(value / 1_000).toFixed(1)}K`
        : `${sym}${value.toFixed(0)}`;
    case "percent":
      return `${value.toFixed(2)}%`;
    case "integer":
      return value >= 1_000_000_000
        ? `${(value / 1_000_000_000).toFixed(1)}B`
        : value >= 1_000_000
        ? `${(value / 1_000_000).toFixed(1)}M`
        : value >= 1_000
        ? `${(value / 1_000).toFixed(0)}K`
        : value.toLocaleString("en-US");
    default:
      return value.toLocaleString("en-US");
  }
}
