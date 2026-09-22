export interface Scene {
  timestamp: string;
  description: string;
  transition: string;
}

export interface OnScreenText {
  timestamp: string;
  text: string;
  style: string;
}

export interface VisualAnalysis {
  style: string;
  layout: string;
  color_palette: string[];
  framing: string;
  products_and_characters: string[];
  environments: string[];
  scenes: Scene[];
  on_screen_text: OnScreenText[];
}

export interface AudioAnalysis {
  spoken_dialogue: string[];
  hook_line: string | null;
  voiceover_style: string | null;
  background_music: string | null;
  sound_effects: string[];
  emotional_tone: string | null;
}

export interface TextualAnalysis {
  headline: string;
  messaging: string[];
  value_propositions: string[];
  calls_to_action: string[];
}

export interface InteractiveAnalysis {
  is_playable: boolean;
  interactive_elements: string[];
  mechanics_shown: string[];
  gameplay_demonstrated: string;
}

export interface CreativeStrategy {
  hook: string;
  value_prop: string;
  target_audience: string;
  format_notes: string;
}

export interface CreativeAnalysis {
  description: string;
  visual: VisualAnalysis;
  audio: AudioAnalysis;
  textual: TextualAnalysis;
  interactive: InteractiveAnalysis;
  creative_strategy: CreativeStrategy;
}

/* ── V2 schema (two-stage evidence-linked) ──────────────── */

export interface V2Chapter {
  chapter_id: string;
  start_time: string;
  end_time: string;
  description: string;
  camera?: string;
  audio_notes?: string;
}

export interface V2Evidence {
  chapter_id: string;
  detail: string;
}

export interface V2HookWindow {
  start_time: string;
  end_time: string;
  description: string;
  camera?: string;
  audio_notes?: string;
}

export interface V2EndCard {
  start_time: string;
  end_time: string;
  cta_buttons: string[];
  branding_elements: string[];
  overlay_text: string[];
}

export interface V2AudioLayers {
  music_description: string;
  music_genre?: string;
  sound_effects: string[];
  voiceover: string;
}

export interface V2Visuals {
  primary_colors: string[];
  overall_aesthetic: string;
  notable_characters: string[];
  notable_objects: string[];
}

export interface V2OnScreenText {
  time: string;
  text: string;
  style: string;
}

export interface V2HookAnalysis {
  tactics: string[];
  emotion_tags: string[];
  psychological_tactics: string[];
  description: string;
  evidence: V2Evidence[];
}

export interface V2EmotionalArc {
  tone_of_voice: string;
  overarching_tone: string[];
  arc_description: string;
  evidence: V2Evidence[];
}

export interface V2ContentStrategy {
  concept_tags: string[];
  narrative_description: string;
  player_motivations: string[];
  persuasion_tactics: string[];
  cultural_references: string[];
  positioning_strategy: string;
  evidence: V2Evidence[];
}

export interface V2AdFormat {
  format_tags: string[];
  ad_type: string;
  ad_type_description: string;
  structure_description: string;
  structure_rationale: string;
  evidence: V2Evidence[];
}

export interface V2GameplayAnalysis {
  total_duration_sec: number;
  moment_types: string[];
  core_mechanics_shown: string;
  evidence: V2Evidence[];
}

export interface V2Confidence {
  overall: string;
  ambiguities: string[];
  missing_signal: string[];
}

export interface CreativeAnalysisV2 {
  chapterization: V2Chapter[];
  hook_window: V2HookWindow;
  gameplay_segments: unknown[];
  end_card: V2EndCard | null;
  audio_layers: V2AudioLayers;
  visuals: V2Visuals;
  on_screen_text: V2OnScreenText[];
  hook_analysis: V2HookAnalysis;
  emotional_arc: V2EmotionalArc;
  content_strategy: V2ContentStrategy;
  ad_format: V2AdFormat;
  gameplay_analysis: V2GameplayAnalysis;
  confidence: V2Confidence;
  _meta?: Record<string, unknown>;
}

export interface AnalyzedCreative {
  id: string;
  url: string;
  type: "video" | "image";
  mimeType: string;
  analyzedAt: string;
  schemaVersion?: "v1" | "v2";
  analysis: CreativeAnalysis;
  analysisV2?: CreativeAnalysisV2;
  // Metadata from report imports
  networks?: string[];
  firstSeen?: string;
  lastSeen?: string;
  dimensions?: string;
  videoDurationSec?: string | null;
  // Scraped ad metadata
  advertiserName?: string;
  adBodyText?: string;
  adHeadline?: string;
  adCta?: string;
  startDate?: string;
  status?: string;
}

export interface ReportSummary {
  total_creatives: number;
  by_type: { video: number; image: number };
  hook_archetypes: {
    name: string;
    description: string;
    creative_ids: string[];
    frequency: string;
  }[];
}

export interface ReportData {
  app_name: string;
  generated_at: string;
  summary: ReportSummary;
}

export type AnalyzePhase =
  | "downloading"
  | "uploading"
  | "processing"
  | "analyzing"
  | "complete"
  | "error";

export const PHASE_LABELS: Record<AnalyzePhase, string> = {
  downloading: "Downloading creative…",
  uploading: "Preparing media…",
  processing: "Processing file…",
  analyzing: "Analyzing creative…",
  complete: "Done",
  error: "Analysis failed",
};

export const COLOR_MAP: Record<string, string> = {
  red: "#ef4444",
  blue: "#3b82f6",
  green: "#22c55e",
  white: "#ffffff",
  black: "#171717",
  orange: "#f97316",
  yellow: "#eab308",
  purple: "#a855f7",
  pink: "#ec4899",
  brown: "#92400e",
  gold: "#ca8a04",
  "neon blue": "#60a5fa",
  "neon orange": "#fb923c",
  "light orange": "#fdba74",
  "skin tones": "#d4a574",
};
