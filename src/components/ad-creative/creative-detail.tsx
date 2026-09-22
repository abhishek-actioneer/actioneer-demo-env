"use client";

import { useState } from "react";
import type { AnalyzedCreative } from "@/lib/ad-creative-types";
import { COLOR_MAP } from "@/lib/ad-creative-types";
import {
  ChevronDown,
  ChevronRight,
  ArrowRight,
  Type,
  Eye,
  Ear,
  Gamepad2,
  Film,
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

function ColorStrip({ colors }: { colors: string[] }) {
  if (colors.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        {colors.map((c) => {
          const hex = COLOR_MAP[c.toLowerCase()] || "#6b7280";
          return (
            <div
              key={c}
              className="size-5 rounded-sm border border-border"
              style={{ backgroundColor: hex }}
              title={c}
            />
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
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
          <span className="text-xs text-muted-foreground/70 ml-auto">
            {badge}
          </span>
        )}
      </button>
      {open && <div className="pb-4 pl-8 space-y-4">{children}</div>}
    </section>
  );
}

/* ── Main Component ─────────────────────────────────────── */

export function CreativeDetail({ creative }: { creative: AnalyzedCreative }) {
  const { analysis } = creative;
  const isVideo = creative.type === "video";
  const hasAudio = isVideo && (analysis.audio.hook_line || analysis.audio.spoken_dialogue.length > 0);
  const hasMechanics = analysis.interactive.mechanics_shown.length > 0;

  return (
    <div className="space-y-8">
      {/* Date info */}
      {creative.firstSeen && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>First seen: {creative.firstSeen}</span>
          {creative.lastSeen && <span>Last seen: {creative.lastSeen}</span>}
          {creative.firstSeen && creative.lastSeen && (
            <span>
              Active:{" "}
              {Math.ceil(
                (new Date(creative.lastSeen).getTime() - new Date(creative.firstSeen).getTime()) / 86400000
              ) + 1}{" "}
              days
            </span>
          )}
        </div>
      )}

      {/* ═══ TIER 1: Flat insight sections ═══ */}

      {/* Description as lede */}
      <p className="text-[13.5px] leading-7 text-foreground/90">
        {analysis.description}
      </p>

      <div className="space-y-6">
        {/* Hook — strategy + literal opening words together */}
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">Hook</p>
          <p className="text-sm leading-relaxed text-foreground/90">
            {analysis.creative_strategy.hook}
          </p>
          {isVideo && analysis.audio.hook_line && (
            <blockquote className="mt-2 border-l-2 border-border/60 pl-3 text-sm italic text-muted-foreground leading-relaxed">
              &ldquo;{analysis.audio.hook_line}&rdquo;
            </blockquote>
          )}
        </div>

        {/* Value prop */}
        <Field label="Value Proposition">{analysis.creative_strategy.value_prop}</Field>

        {/* Target audience */}
        <Field label="Target Audience">{analysis.creative_strategy.target_audience}</Field>

        {/* CTAs — vertical list, not badge soup */}
        {analysis.textual.calls_to_action.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Calls to Action</p>
            <ul className="space-y-1">
              {analysis.textual.calls_to_action.map((cta) => (
                <li
                  key={cta}
                  className="flex items-start gap-2 text-sm text-foreground/90 leading-relaxed"
                >
                  <ArrowRight className="size-3.5 mt-1 text-muted-foreground shrink-0" />
                  <span>{cta}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Visual Style — stacked, no cramped grid */}
        <Field label="Visual Style">{analysis.visual.style}</Field>

        {/* Colors — palette strip, not dot list */}
        {analysis.visual.color_palette.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Colors</p>
            <ColorStrip colors={analysis.visual.color_palette} />
          </div>
        )}

        {/* Tone */}
        {isVideo && analysis.audio.emotional_tone && (
          <Field label="Tone">{analysis.audio.emotional_tone}</Field>
        )}
      </div>

      {/* ═══ TIER 2: Flat collapsible list ═══ */}

      <div>
        {/* Messaging — default open, it's usually short */}
        {analysis.textual.messaging.length > 0 && (
          <Collapsible
            icon={Type}
            title="Key Messaging"
            badge={`${analysis.textual.messaging.length} messages`}
            defaultOpen
          >
            <Field label="Headline">{analysis.textual.headline}</Field>
            <Field label="Messages">
              <ul className="list-disc list-inside space-y-1 text-sm">
                {analysis.textual.messaging.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </Field>
          </Collapsible>
        )}

        {/* Storyboard — default open for videos with multiple scenes */}
        {isVideo && analysis.visual.scenes.length > 1 && (
          <Collapsible
            icon={Film}
            title="Storyboard"
            badge={`${analysis.visual.scenes.length} scenes`}
            defaultOpen
          >
            <div className="relative pl-6 border-l border-border space-y-4">
              {analysis.visual.scenes.map((scene, i) => (
                <div key={i} className="relative">
                  <div className="absolute -left-[25px] top-1 size-2.5 rounded-full bg-muted-foreground/40" />
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-mono text-muted-foreground">{scene.timestamp}</span>
                    <span className="text-xs text-muted-foreground/60">{scene.transition}</span>
                  </div>
                  <p className="text-sm">{scene.description}</p>
                </div>
              ))}
            </div>
          </Collapsible>
        )}

        {/* Audio details (videos only) */}
        {hasAudio && (
          <Collapsible icon={Ear} title="Audio" badge={analysis.audio.voiceover_style ? "voiceover" : undefined}>
            {analysis.audio.voiceover_style && (
              <Field label="Voiceover">{analysis.audio.voiceover_style}</Field>
            )}
            {analysis.audio.background_music && (
              <Field label="Music">{analysis.audio.background_music}</Field>
            )}
            {analysis.audio.spoken_dialogue.length > 0 && (
              <Field label="Dialogue">
                <ol className="list-decimal list-inside space-y-1 text-sm">
                  {analysis.audio.spoken_dialogue.map((d, i) => (
                    <li key={i} className="italic">&ldquo;{d}&rdquo;</li>
                  ))}
                </ol>
              </Field>
            )}
          </Collapsible>
        )}

        {/* Visual details */}
        {(analysis.visual.environments.length > 0 || analysis.visual.products_and_characters.length > 0) && (
          <Collapsible icon={Eye} title="Visual Details">
            {analysis.visual.environments.length > 0 && (
              <Field label="Environments">
                <p className="text-sm leading-relaxed text-foreground/90">
                  {analysis.visual.environments.join(", ")}
                </p>
              </Field>
            )}
            {analysis.visual.products_and_characters.length > 0 && (
              <Field label="Products & Characters">
                <ul className="list-disc list-inside space-y-1 text-sm">
                  {analysis.visual.products_and_characters.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </Field>
            )}
          </Collapsible>
        )}

        {/* Mechanics (only if non-trivial) */}
        {hasMechanics && (
          <Collapsible icon={Gamepad2} title="App Mechanics" badge={`${analysis.interactive.mechanics_shown.length} shown`}>
            <Field label="Mechanics Shown">
              <ul className="list-disc list-inside space-y-1 text-sm">
                {analysis.interactive.mechanics_shown.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </Field>
          </Collapsible>
        )}
      </div>
    </div>
  );
}
