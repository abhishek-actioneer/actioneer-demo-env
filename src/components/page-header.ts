/**
 * Shared page header style tokens.
 * Every page imports these to ensure visual cohesion across all detail
 * and list views — same title sizes, padding, spacing, and alignment.
 *
 * Usage:
 *   import { PH } from "@/components/page-header";
 *   <div className={PH.container}>
 *     <div className={PH.titleRow}>
 *       <h1 className={PH.title}>Page Title</h1>
 *       <div className={PH.actions}><Button /></div>
 *     </div>
 *     <p className={PH.subtitle}>Description text</p>
 *   </div>
 */

export const PH = {
  /** Outer container — consistent padding for all pages */
  container: "px-8 pt-6 pb-4",
  /** Title + actions on the same row */
  titleRow: "flex items-center justify-between gap-4",
  /** Page title — uniform size across all pages */
  title: "text-xl font-semibold text-foreground",
  /** Page subtitle / description */
  subtitle: "text-sm text-muted-foreground mt-1 max-w-2xl",
  /** Right-aligned actions in title row */
  actions: "flex items-center gap-2 shrink-0",
  /** Bottom border separator (optional) */
  divider: "border-b border-border mt-4",
  /** Badge / status chip next to title */
  badge: "text-xs px-2 py-0.5 rounded-md border border-border text-muted-foreground",
} as const;
