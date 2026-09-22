// ── Chart Color System ──
// 5 palettes × 10 colors each. Default is multi-hue.
// Each palette works on both light and dark backgrounds.
// CVD palettes designed for specific color vision deficiencies.

export type ChartPaletteName = "default" | "deuteranopia" | "protanopia" | "tritanopia" | "focus";

// ── Palettes ──
// 10 colors each, ordered for maximum adjacent contrast.
// Dark mode values — slightly more saturated for dark backgrounds.
// Light mode: these same values work because they're mid-luminance (not too bright, not too dark).

const PALETTES: Record<ChartPaletteName, string[]> = {
  // Emerald-led, Mixpanel-energy: saturated, vibrant, alternating warm/cool
  default: [
    "#21c55e", // emerald — our brand, bright
    "#818cf8", // indigo/periwinkle — cool pop
    "#fb923c", // bright orange — warm
    "#38bdf8", // sky blue — electric cool
    "#fbbf24", // amber/gold — warm sunny
    "#f472b6", // hot pink — warm vibrant
    "#2dd4bf", // teal — cool fresh
    "#a78bfa", // soft violet — cool
    "#f87171", // coral red — warm
    "#a3e635", // lime — bright green-yellow
  ],

  // Deuteranopia (red-green blind): NO green, NO red. Use blue-yellow axis + luminance.
  deuteranopia: [
    "#2563eb", // blue
    "#fbbf24", // amber
    "#7c3aed", // violet
    "#38bdf8", // sky blue
    "#f59e0b", // dark amber
    "#a78bfa", // lavender
    "#0ea5e9", // bright blue
    "#fcd34d", // light gold
    "#6366f1", // indigo
    "#fdba74", // peach
  ],

  // Protanopia (red blind): NO red, NO green. Use blue-purple-yellow axis.
  protanopia: [
    "#2563eb", // blue
    "#fbbf24", // amber
    "#8b5cf6", // purple
    "#38bdf8", // sky blue
    "#fcd34d", // light gold
    "#6366f1", // indigo
    "#f59e0b", // dark amber
    "#a78bfa", // lavender
    "#0284c7", // dark blue
    "#fef08a", // pale yellow
  ],

  // Tritanopia (blue-yellow blind): NO blue, NO yellow. Use red-green-pink-cyan axis.
  tritanopia: [
    "#f43f5e", // rose
    "#10b981", // emerald
    "#ec4899", // pink
    "#14b8a6", // teal
    "#f87171", // coral
    "#059669", // dark emerald
    "#fb7185", // light rose
    "#2dd4bf", // light teal
    "#be123c", // dark rose
    "#34d399", // mint
  ],

  // Single-hue gradient: primary color dark → light
  // For emphasizing one series against faded context
  focus: [
    "#22c55e", // green-500 (accent, matches brand)
    "#4b5563", // gray-600
    "#6b7280", // gray-500
    "#9ca3af", // gray-400
    "#374151", // gray-700
    "#d1d5db", // gray-300
    "#78716c", // stone-500
    "#a8a29e", // stone-400
    "#525252", // neutral-600
    "#e5e7eb", // gray-200
  ],
};

// ── Active palette ──

let _activePalette: ChartPaletteName = "default";

export function setChartPalette(name: ChartPaletteName) {
  _activePalette = name;
}

export function getChartPalette(): ChartPaletteName {
  return _activePalette;
}

export function getPaletteColors(palette?: ChartPaletteName): string[] {
  return PALETTES[palette ?? _activePalette];
}

// ── Public API ──

export const CHART_ACCENT = "#21c55e"; // emerald-400 — bright, our brand
export const CHART_NEGATIVE = "#ef4444";

// Get color for a series by index.
// Pass `palette` explicitly in render paths to avoid depending on module-level state
// (which is not safe in SSR / concurrent rendering).
export function getSeriesColor(index: number, palette?: ChartPaletteName): string {
  const colors = PALETTES[palette ?? _activePalette];
  return colors[index % colors.length];
}

// Accessibility: unique shapes per series (independent of color)
export const CHART_SHAPES = [
  "circle",
  "square",
  "triangle",
  "diamond",
  "cross",
] as const;

export type ChartShape = (typeof CHART_SHAPES)[number];

// Line dash patterns per series
export const CHART_DASHES = [
  undefined,     // solid
  "6 3",         // dashed
  "2 2",         // dotted
  "8 3 2 3",     // dash-dot
  "4 4",         // even dash
] as const;

export function getSeriesShape(index: number): ChartShape {
  return CHART_SHAPES[index % CHART_SHAPES.length];
}

export function getSeriesDash(index: number): string | undefined {
  return CHART_DASHES[index % CHART_DASHES.length];
}

// All palette names for UI
export const PALETTE_NAMES: { id: ChartPaletteName; label: string; description: string }[] = [
  { id: "default", label: "Default", description: "Multi-hue palette optimized for maximum visual distinction" },
  { id: "deuteranopia", label: "Deuteranopia", description: "For red-green color blindness — uses blue and yellow tones" },
  { id: "protanopia", label: "Protanopia", description: "For red color blindness — uses blue, purple, and yellow tones" },
  { id: "tritanopia", label: "Tritanopia", description: "For blue-yellow color blindness — uses red, green, and pink tones" },
  { id: "focus", label: "Focus", description: "Single accent color with neutral grays — emphasizes one series" },
];
