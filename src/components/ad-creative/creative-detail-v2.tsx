"use client";

import { useState } from "react";
import type {
  CreativeAnalysisV2,
  V2Evidence,
} from "@/lib/ad-creative-types";
import {
  ChevronDown,
  ChevronRight,
  Film,
  Target,
  Heart,
  Sparkles,
  Layout,
  Gamepad2,
  Type,
  Eye,
  Ear,
  AlertCircle,
} from "lucide-react";

/* ── Primitives ─────────────────────────────────────────── */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="text-sm leading-relaxed text-foreground/90">{children}</div>
    </div>
  );
}

function TagRow({ tags }: { tags: string[] }) {
  if (!tags || tags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((t) => (
        <span
          key={t}
          className="inline-flex items-center rounded-md border border-border bg-muted/30 px-2 py-0.5 text-[9.9px] text-foreground/80"
        >
          {t}
        </span>
      ))}
    </div>
  );
}

function EvidenceList({ evidence }: { evidence: V2Evidence[] }) {
  if (!evidence || evidence.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-[9.9px] uppercase tracking-wide text-muted-foreground/70">
        Evidence
      </p>
      <ul className="space-y-1.5">
        {evidence.map((e, i) => (
          <li key={i} className="flex items-start gap-2 text-xs">
            <span className="font-mono text-muted-foreground shrink-0 mt-0.5">
              {e.chapter_id}
            </span>
            <span className="text-foreground/80 leading-relaxed">{e.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ColorDots({ colors }: { colors: string[] }) {
  if (!colors || colors.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        {colors.map((c) => (
          <div
            key={c}
            className="size-5 rounded-sm border border-border"
            style={{ backgroundColor: c }}
            title={c}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed font-mono">
        {colors.join(", ")}
      </p>
    </div>
  );
}

function Collapsible({
  icon: Icon,
  title,
  badge,
  defaultOpen = false,
  children,
}: {
  icon: React.ElementType;
  title: string;
  badge?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-t border-border/40 first:border-t-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2.5 w-full py-3 text-left hover:text-foreground transition-colors"
      >
        {open ? (
          <ChevronDown className="size-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="size-3.5 text-muted-foreground shrink-0" />
        )}
        <Icon className="size-3.5 text-muted-foreground shrink-0" />
        <span className="text-sm font-medium">{title}</span>
        {badge && (
          <span className="text-xs text-muted-foreground/70 ml-auto">{badge}</span>
        )}
      </button>
      {open && <div className="pb-4 pl-8 space-y-4">{children}</div>}
    </section>
  );
}

/* ── Main Component ─────────────────────────────────────── */

export function CreativeDetailV2({ analysis }: { analysis: CreativeAnalysisV2 }) {
  const {
    chapterization,
    hook_window,
    hook_analysis,
    emotional_arc,
    content_strategy,
    ad_format,
    audio_layers,
    visuals,
    on_screen_text,
    end_card,
    gameplay_analysis,
    confidence,
  } = analysis;

  return (
    <div className="space-y-8">
      {/* ═══ TIER 1: Top-level insights ═══ */}

      {/* Hook window */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <p className="text-xs text-muted-foreground">Hook Window</p>
          <span className="text-[9px] font-mono text-muted-foreground/70">
            {hook_window.start_time}–{hook_window.end_time}
          </span>
        </div>
        <p className="text-sm leading-relaxed text-foreground/90">
          {hook_window.description}
        </p>
        {hook_window.camera && (
          <p className="text-[9.9px] text-muted-foreground">
            Camera: {hook_window.camera}
          </p>
        )}
        {hook_window.audio_notes && (
          <p className="text-[9.9px] text-muted-foreground italic">
            {hook_window.audio_notes}
          </p>
        )}
      </div>

      {/* Hook analysis — tactics, emotions, psych */}
      <div className="space-y-3">
        <Field label="Hook Strategy">{hook_analysis.description}</Field>
        <div className="space-y-2">
          <p className="text-[9.9px] uppercase tracking-wide text-muted-foreground/70">
            Tactics
          </p>
          <TagRow tags={hook_analysis.tactics} />
        </div>
        <div className="space-y-2">
          <p className="text-[9.9px] uppercase tracking-wide text-muted-foreground/70">
            Emotions Evoked
          </p>
          <TagRow tags={hook_analysis.emotion_tags} />
        </div>
        <div className="space-y-2">
          <p className="text-[9.9px] uppercase tracking-wide text-muted-foreground/70">
            Psychological Levers
          </p>
          <TagRow tags={hook_analysis.psychological_tactics} />
        </div>
      </div>

      {/* Ad format */}
      <div className="space-y-3">
        <Field label={`Ad Type: ${ad_format.ad_type}`}>
          {ad_format.ad_type_description}
        </Field>
        <div className="space-y-2">
          <p className="text-[9.9px] uppercase tracking-wide text-muted-foreground/70">
            Format
          </p>
          <TagRow tags={ad_format.format_tags} />
        </div>
        <Field label="Structure">{ad_format.structure_description}</Field>
        <Field label="Why This Structure Works">{ad_format.structure_rationale}</Field>
      </div>

      {/* Confidence */}
      {confidence && (
        <div className="flex items-center gap-2 text-xs">
          <AlertCircle className="size-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">Confidence:</span>
          <span
            className={`font-medium ${
              confidence.overall === "high"
                ? "text-foreground"
                : confidence.overall === "medium"
                ? "text-muted-foreground"
                : "text-muted-foreground"
            }`}
          >
            {confidence.overall}
          </span>
          {confidence.ambiguities.length > 0 && (
            <span className="text-muted-foreground">
              · {confidence.ambiguities.length} ambiguities
            </span>
          )}
        </div>
      )}

      {/* ═══ TIER 2: Collapsible deep dives ═══ */}

      <div>
        {/* Chapterization */}
        {chapterization.length > 0 && (
          <Collapsible
            icon={Film}
            title="Chapters"
            badge={`${chapterization.length} chapters`}
            defaultOpen
          >
            <div className="relative pl-6 border-l border-border space-y-5">
              {chapterization.map((ch) => (
                <div key={ch.chapter_id} className="relative">
                  <div className="absolute -left-[25px] top-1 size-2.5 rounded-full bg-muted-foreground/40" />
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-mono text-muted-foreground">
                      {ch.chapter_id}
                    </span>
                    <span className="text-xs font-mono text-muted-foreground/70">
                      {ch.start_time}–{ch.end_time}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed mb-1">{ch.description}</p>
                  {ch.camera && (
                    <p className="text-[9.9px] text-muted-foreground">
                      Camera: {ch.camera}
                    </p>
                  )}
                  {ch.audio_notes && (
                    <p className="text-[9.9px] text-muted-foreground italic">
                      {ch.audio_notes}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </Collapsible>
        )}

        {/* Emotional arc */}
        <Collapsible icon={Heart} title="Emotional Arc" defaultOpen>
          <Field label="Tone of Voice">{emotional_arc.tone_of_voice}</Field>
          <div className="space-y-2">
            <p className="text-[9.9px] uppercase tracking-wide text-muted-foreground/70">
              Overarching Tone
            </p>
            <TagRow tags={emotional_arc.overarching_tone} />
          </div>
          <Field label="Arc">{emotional_arc.arc_description}</Field>
          <EvidenceList evidence={emotional_arc.evidence} />
        </Collapsible>

        {/* Content strategy */}
        <Collapsible icon={Sparkles} title="Content Strategy" defaultOpen>
          <Field label="Narrative">{content_strategy.narrative_description}</Field>
          <Field label="Positioning">{content_strategy.positioning_strategy}</Field>
          <div className="space-y-2">
            <p className="text-[9.9px] uppercase tracking-wide text-muted-foreground/70">
              Concept Tags
            </p>
            <TagRow tags={content_strategy.concept_tags} />
          </div>
          <div className="space-y-2">
            <p className="text-[9.9px] uppercase tracking-wide text-muted-foreground/70">
              Persuasion Tactics
            </p>
            <TagRow tags={content_strategy.persuasion_tactics} />
          </div>
          <div className="space-y-2">
            <p className="text-[9.9px] uppercase tracking-wide text-muted-foreground/70">
              Player/User Motivations
            </p>
            <TagRow tags={content_strategy.player_motivations} />
          </div>
          {content_strategy.cultural_references.length > 0 && (
            <div className="space-y-2">
              <p className="text-[9.9px] uppercase tracking-wide text-muted-foreground/70">
                Cultural References
              </p>
              <TagRow tags={content_strategy.cultural_references} />
            </div>
          )}
          <EvidenceList evidence={content_strategy.evidence} />
        </Collapsible>

        {/* Ad format evidence */}
        <Collapsible icon={Layout} title="Ad Format Evidence">
          <EvidenceList evidence={ad_format.evidence} />
        </Collapsible>

        {/* Hook evidence */}
        <Collapsible icon={Target} title="Hook Evidence">
          <EvidenceList evidence={hook_analysis.evidence} />
        </Collapsible>

        {/* Audio layers */}
        {audio_layers && (
          <Collapsible icon={Ear} title="Audio" badge={audio_layers.music_genre}>
            <Field label="Music">{audio_layers.music_description}</Field>
            {audio_layers.sound_effects.length > 0 && (
              <Field label="Sound Effects">
                <ul className="list-disc list-inside space-y-0.5 text-sm">
                  {audio_layers.sound_effects.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </Field>
            )}
            {audio_layers.voiceover && (
              <Field label="Voiceover">
                <p className="italic text-sm leading-relaxed">
                  &ldquo;{audio_layers.voiceover}&rdquo;
                </p>
              </Field>
            )}
          </Collapsible>
        )}

        {/* Visuals */}
        {visuals && (
          <Collapsible icon={Eye} title="Visuals" badge={visuals.overall_aesthetic}>
            {visuals.primary_colors.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">Primary Colors</p>
                <ColorDots colors={visuals.primary_colors} />
              </div>
            )}
            {visuals.notable_characters.length > 0 && (
              <Field label="Characters">
                <ul className="list-disc list-inside space-y-0.5 text-sm">
                  {visuals.notable_characters.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </Field>
            )}
            {visuals.notable_objects.length > 0 && (
              <Field label="Objects">
                <ul className="list-disc list-inside space-y-0.5 text-sm">
                  {visuals.notable_objects.map((o, i) => (
                    <li key={i}>{o}</li>
                  ))}
                </ul>
              </Field>
            )}
          </Collapsible>
        )}

        {/* On-screen text */}
        {on_screen_text && on_screen_text.length > 0 && (
          <Collapsible
            icon={Type}
            title="On-Screen Text"
            badge={`${on_screen_text.length} items`}
          >
            <ul className="space-y-2">
              {on_screen_text.map((t, i) => (
                <li key={i} className="text-xs">
                  <div className="flex items-start gap-2">
                    <span className="font-mono text-muted-foreground shrink-0">
                      {t.time}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-foreground/90">{t.text}</p>
                      <p className="text-[9.9px] text-muted-foreground/70">{t.style}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Collapsible>
        )}

        {/* End card */}
        {end_card && (
          <Collapsible icon={Layout} title="End Card">
            <p className="text-[9.9px] font-mono text-muted-foreground">
              {end_card.start_time}–{end_card.end_time}
            </p>
            {end_card.cta_buttons.length > 0 && (
              <Field label="CTA Buttons">
                <ul className="list-disc list-inside space-y-0.5 text-sm">
                  {end_card.cta_buttons.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </Field>
            )}
            {end_card.branding_elements.length > 0 && (
              <Field label="Branding">
                <ul className="list-disc list-inside space-y-0.5 text-sm">
                  {end_card.branding_elements.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              </Field>
            )}
            {end_card.overlay_text.length > 0 && (
              <Field label="Overlay Text">
                <ul className="space-y-1 text-xs text-muted-foreground leading-relaxed">
                  {end_card.overlay_text.map((o, i) => (
                    <li key={i}>{o}</li>
                  ))}
                </ul>
              </Field>
            )}
          </Collapsible>
        )}

        {/* Gameplay (for game ads) */}
        {gameplay_analysis && gameplay_analysis.total_duration_sec > 0 && (
          <Collapsible
            icon={Gamepad2}
            title="Gameplay"
            badge={`${gameplay_analysis.total_duration_sec}s`}
          >
            <Field label="Core Mechanics">{gameplay_analysis.core_mechanics_shown}</Field>
            {gameplay_analysis.moment_types.length > 0 && (
              <div className="space-y-2">
                <p className="text-[9.9px] uppercase tracking-wide text-muted-foreground/70">
                  Moment Types
                </p>
                <TagRow tags={gameplay_analysis.moment_types} />
              </div>
            )}
            <EvidenceList evidence={gameplay_analysis.evidence} />
          </Collapsible>
        )}

        {/* Confidence details */}
        {confidence && (confidence.ambiguities.length > 0 || confidence.missing_signal.length > 0) && (
          <Collapsible icon={AlertCircle} title="Confidence Details">
            {confidence.ambiguities.length > 0 && (
              <Field label="Ambiguities">
                <ul className="list-disc list-inside space-y-0.5 text-sm">
                  {confidence.ambiguities.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </Field>
            )}
            {confidence.missing_signal.length > 0 && (
              <Field label="Missing Signal">
                <ul className="list-disc list-inside space-y-0.5 text-sm">
                  {confidence.missing_signal.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </Field>
            )}
          </Collapsible>
        )}
      </div>
    </div>
  );
}
