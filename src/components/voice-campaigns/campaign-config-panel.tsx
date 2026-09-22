"use client";

import { useState } from "react";
import { CheckIcon, ChevronRight, Headphones, Loader2, Phone, Search, Users, Volume2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { VoiceVoxel } from "@/components/voice-campaigns/voice-voxel";
import { InboundNumberCard } from "@/components/voice-campaigns/inbound-number-card";
import {
  GEMINI_VOICES,
  geminiVoiceGenderLabel,
} from "@/lib/gemini-voices";
import { defaultAgentName } from "@/lib/voice-campaign-flow";
import { CASUAL_INDIC_LANGUAGES } from "@/lib/voice-casual-spoken-register";
import { geminiVoiceDisplayName } from "@/lib/gemini-voices";
import type { Segment } from "@/lib/types";
import type { VoiceCallProvider } from "@/lib/voice-campaign-types";

// ---------------------------------------------------------------------------
// Constants (mirrored from page.tsx)
// ---------------------------------------------------------------------------

// The campaign language is written once into the Gemini setup systemInstruction
// and never enforced at runtime — there is no language detection, drift guard,
// or mid-call switching. See voice-language-policy.ts.
//
// Picking a regional language selects the THIRD slot on a trilingual call:
// {regional + Hindi + English}. Hindi and English are always available and are
// not separately selectable — the agent opens in the regional language, falls
// back to Hindi, and repairs misunderstandings in the regional language.
// The first three entries stay monolingual.
const LANGUAGES = [
  "Hinglish",
  "Hindi",
  "English",
  ...CASUAL_INDIC_LANGUAGES,
] as const;

const CALL_RUNTIMES: { value: VoiceCallProvider; label: string }[] = [
  { value: "plivo-gemini", label: "Actioneer Voice" },
  { value: "mulberry-pipecat", label: "Mulberry" },
];

/** Every campaign language is an Indian-call language — see voice-language-policy. */
function languageFlag(_language: string): string {
  return "🇮🇳";
}

// ---------------------------------------------------------------------------
// CampaignConfigPanel props
// ---------------------------------------------------------------------------

export interface CampaignConfigPanelProps {
  segments: Segment[];
  loadingOptions: boolean;
  segmentId: string;
  setSegmentId: (id: string) => void;
  selectedSegment: Segment | null | undefined;
  savingCampaign: boolean;
  onSaveCampaign: () => void;
  hasLoadedExistingCampaign: boolean;
  language: string;
  onLanguageChange: (value: string) => void;
  savingLanguage: boolean;
  /** When omitted (e.g. fraud/training studio) the call-runtime selector is hidden. */
  callProvider?: VoiceCallProvider;
  onCallProviderChange?: (value: VoiceCallProvider) => void;
  agentName: string;
  setAgentName: (value: string) => void;
  companyName: string;
  setCompanyName: (value: string) => void;
  campaignName: string;
  setCampaignName: (value: string) => void;
  personaPrompt: string;
  setPersonaPrompt: (value: string) => void;
  voice: string;
  setVoice: (value: string) => void;
  previewingVoice: string | null;
  onPreviewVoice: (voiceName: string) => void;
  phoneRaw: string;
  setPhoneRaw: (value: string) => void;
  preparingLiveTest: boolean;
  onOpenLiveTest: () => void;
  onCallLive: () => void;
  callLoading: boolean;
  /** Saved campaign id — required to bind an inbound number to this campaign. */
  campaignId?: string;
}

function SegmentPickerModal({
  open,
  onClose,
  segments,
  segmentId,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  segments: Segment[];
  segmentId: string;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = query.trim()
    ? segments.filter((s) =>
        s.name.toLowerCase().includes(query.toLowerCase()) ||
        (s.description ?? "").toLowerCase().includes(query.toLowerCase()),
      )
    : segments;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-[min(900px,90vw)] max-w-none sm:max-w-none p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-0">
          <DialogTitle className="text-base font-semibold">Select an audience</DialogTitle>
        </DialogHeader>

        {/* Search */}
        <div className="relative px-5 pt-4 pb-3">
          <Search className="pointer-events-none absolute left-8 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search segments…"
            className="h-9 w-full rounded-md border border-border bg-muted/30 pl-8 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring/30"
          />
        </div>

        {/* List */}
        <div className="max-h-[560px] overflow-y-auto px-2 pb-3">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No segments match</p>
          ) : (
            filtered.map((seg) => {
              const selected = seg.id === segmentId;
              return (
                <button
                  key={seg.id}
                  type="button"
                  onClick={() => { onSelect(seg.id); onClose(); }}
                  className={`flex w-full items-start gap-3 rounded-md px-3 py-3 text-left transition-colors hover:bg-muted/40 ${selected ? "bg-muted/30" : ""}`}
                >
                  <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted/60">
                    <Users className="size-3.5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-medium">{seg.name}</span>
                      <span className="shrink-0 tabular-nums text-xs text-muted-foreground">{seg.userCount.toLocaleString()}</span>
                    </div>
                    {seg.description && (
                      <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{seg.description}</p>
                    )}
                  </div>
                  {selected && <CheckIcon className="mt-1 size-4 shrink-0 text-foreground" />}
                </button>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function VoicePickerModal({
  open, onClose, voice, onSelect, previewingVoice, onPreviewVoice,
}: {
  open: boolean;
  onClose: () => void;
  voice: string;
  onSelect: (name: string) => void;
  previewingVoice: string | null;
  onPreviewVoice: (name: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-[min(520px,90vw)] max-w-none sm:max-w-none p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-0">
          <DialogTitle className="text-base font-semibold">Select a voice</DialogTitle>
        </DialogHeader>
        <div className="max-h-[480px] overflow-y-auto px-2 py-3">
          {GEMINI_VOICES.map((v) => {
            const selected = v.name === voice;
            return (
              <button
                key={v.name}
                type="button"
                onClick={() => { onSelect(v.name); onClose(); }}
                className={`flex w-full items-center gap-3 rounded-md px-3 py-3 text-left transition-colors hover:bg-muted/40 ${selected ? "bg-muted/30" : ""}`}
              >
                <VoiceVoxel voiceName={v.name} size={28} animate={selected || previewingVoice === v.name} />
                <div className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{v.displayName}</span>
                  <span className="block text-xs text-muted-foreground">{geminiVoiceGenderLabel(v.name)}</span>
                </div>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); if (previewingVoice !== v.name) onPreviewVoice(v.name); }}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); onPreviewVoice(v.name); } }}
                  className="rounded p-1 text-muted-foreground hover:text-foreground"
                >
                  {previewingVoice === v.name ? <Loader2 className="size-3.5 animate-spin" /> : <Volume2 className="size-3.5" />}
                </span>
                {selected && <CheckIcon className="size-4 shrink-0 text-foreground" />}
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// CampaignConfigPanel
// ---------------------------------------------------------------------------

export function CampaignConfigPanel({
  segments,
  loadingOptions,
  segmentId,
  setSegmentId,
  selectedSegment,
  savingCampaign,
  onSaveCampaign,
  hasLoadedExistingCampaign,
  language,
  onLanguageChange,
  savingLanguage,
  callProvider = "plivo-gemini",
  onCallProviderChange,
  agentName,
  setAgentName,
  companyName,
  setCompanyName,
  campaignName,
  setCampaignName,
  personaPrompt,
  setPersonaPrompt,
  voice,
  setVoice,
  previewingVoice,
  onPreviewVoice,
  phoneRaw,
  setPhoneRaw,
  preparingLiveTest,
  onOpenLiveTest,
  onCallLive,
  callLoading,
  campaignId,
}: CampaignConfigPanelProps) {
  const [segmentPickerOpen, setSegmentPickerOpen] = useState(false);
  const [voicePickerOpen, setVoicePickerOpen] = useState(false);
  const [expandedSection, setExpandedSection] = useState<"voice" | "language" | "model" | "agent" | null>(null);

  return (
    <aside className="flex w-[34%] min-w-[340px] max-w-[480px] shrink-0 flex-col overflow-y-auto border-l border-border bg-[#f6f6f2]">
      <SegmentPickerModal
        open={segmentPickerOpen}
        onClose={() => setSegmentPickerOpen(false)}
        segments={segments}
        segmentId={segmentId}
        onSelect={setSegmentId}
      />

      {/* CONTEXT — company / campaign / persona feed the live Gemini system prompt */}
      <section className="border-b border-border px-5 py-5">
        <p className="mb-2.5 text-[13.5px] font-semibold text-foreground">Context</p>
        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Company</label>
            <Input
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="e.g. Vastu Housing Finance"
              className="h-9 rounded-none"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Campaign</label>
            <Input
              value={campaignName}
              onChange={(e) => setCampaignName(e.target.value)}
              placeholder="e.g. Existing Customer Top-Up"
              className="h-9 rounded-none"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Persona</label>
            <Textarea
              value={personaPrompt}
              onChange={(e) => setPersonaPrompt(e.target.value)}
              placeholder="You are Ananya, a phone advisor…"
              rows={6}
              className="resize-y rounded-none text-sm leading-relaxed"
            />
            <p className="mt-1.5 text-[9.9px] leading-relaxed text-muted-foreground">
              Injected at the top of the live prompt. Company and Campaign appear right after it.
            </p>
          </div>
        </div>
      </section>

      {/* AUDIENCE */}
      <section className="border-b border-border px-5 py-5">
        <p className="mb-2.5 text-[13.5px] font-semibold text-foreground">Audience</p>
        {loadingOptions ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Loading…</div>
        ) : (
          <div className="overflow-hidden rounded-none border border-input bg-background divide-y divide-border">
            <button
              type="button"
              onClick={() => setSegmentPickerOpen(true)}
              className="flex min-h-11 w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/45"
            >
              {selectedSegment ? (
                <>
                  <Users className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm">{selectedSegment.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{selectedSegment.userCount.toLocaleString()}</span>
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                </>
              ) : (
                <>
                  <Users className="size-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 text-sm text-muted-foreground">Select audience</span>
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                </>
              )}
            </button>
          </div>
        )}
      </section>

      {/* INBOUND — bind a DID so callers get this campaign's script */}
      <InboundNumberCard campaignId={campaignId} />

      <VoicePickerModal
        open={voicePickerOpen}
        onClose={() => setVoicePickerOpen(false)}
        voice={voice}
        onSelect={(name) => { setVoice(name); setAgentName(defaultAgentName(name)); }}
        previewingVoice={previewingVoice}
        onPreviewVoice={(name) => void onPreviewVoice(name)}
      />

      {/* VOICES */}
      <section className="border-b border-border px-5 py-5">
        <p className="mb-2.5 text-[13.5px] font-semibold text-foreground">Voice</p>
        <div className="overflow-hidden rounded-none border border-input bg-background divide-y divide-border">
          <button
            type="button"
            onClick={() => setVoicePickerOpen(true)}
            className="flex min-h-11 w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/45"
          >
            <VoiceVoxel voiceName={voice} size={22} animate={false} />
            <span className="min-w-0 flex-1 truncate text-sm">{agentName || geminiVoiceDisplayName(voice)}</span>
            <span className="shrink-0 rounded-[2px] border border-border bg-muted px-1.5 py-0.5 text-[8.1px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Primary</span>
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </div>
      </section>

      {/* LANGUAGE */}
      <section className="border-b border-border px-5 py-5">
        <div className="mb-3">
          <p className="text-[13.5px] font-semibold text-foreground">Language</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Choose the language the agent will communicate in.</p>
        </div>
        <div className="overflow-hidden rounded-none border border-input bg-background divide-y divide-border">
          <button
            type="button"
            disabled={savingLanguage}
            onClick={() => setExpandedSection(expandedSection === "language" ? null : "language")}
            className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/25 disabled:opacity-60"
          >
            <span className="text-base leading-none">{languageFlag(language)}</span>
            <span className="min-w-0 flex-1 text-sm">{language === "Hinglish" ? "Hindi" : language}</span>
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[9px] font-medium text-muted-foreground">
              {savingLanguage ? "Syncing…" : "Default"}
            </span>
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </div>
        {expandedSection === "language" && (
          <div className="mt-2 overflow-hidden rounded-[3px] border border-border bg-background divide-y divide-border">
            {LANGUAGES.filter((l) => l !== "Hinglish").map((l) => (
              <button
                key={l}
                type="button"
                disabled={savingLanguage}
                onClick={() => { onLanguageChange(l); setExpandedSection(null); }}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/25 disabled:opacity-60 ${language === l || (language === "Hinglish" && l === "Hindi") ? "text-foreground" : "text-muted-foreground"}`}
              >
                <span className="text-base leading-none">{languageFlag(l)}</span>
                <span className="flex-1">{l}</span>
                {(language === l || (language === "Hinglish" && l === "Hindi")) && <CheckIcon className="size-3.5 text-foreground" />}
              </button>
            ))}
          </div>
        )}
        {(language === "Hindi" || language === "Hinglish") && (
          <div className="mt-4 flex items-center gap-2.5">
            <Switch
              checked={language === "Hinglish"}
              onCheckedChange={(checked) => onLanguageChange(checked ? "Hinglish" : "Hindi")}
              disabled={savingLanguage}
            />
            <span className="text-sm">Hinglish Mode</span>
          </div>
        )}
        {savingLanguage && (
          <p className="mt-2 text-xs text-muted-foreground">
            Rewriting spoken script lines into {language === "Hinglish" ? "Hinglish" : language}…
          </p>
        )}
      </section>

      {/* CALL RUNTIME */}
      {onCallProviderChange && (
        <section className="border-b border-border px-5 py-5">
          <div className="mb-3">
            <p className="text-[13.5px] font-semibold text-foreground">Call runtime</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Which engine places and runs the call.</p>
          </div>
          <div className="overflow-hidden rounded-none border border-input bg-background divide-y divide-border">
            {CALL_RUNTIMES.map((rt) => (
              <button
                key={rt.value}
                type="button"
                onClick={() => onCallProviderChange(rt.value)}
                className={`flex min-h-11 w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/25 ${callProvider === rt.value ? "text-foreground" : "text-muted-foreground"}`}
              >
                <span className="min-w-0 flex-1 text-sm">{rt.label}</span>
                {callProvider === rt.value && <CheckIcon className="size-3.5 shrink-0 text-foreground" />}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* SAVE */}
      {hasLoadedExistingCampaign && (
        <section className="border-b border-border px-5 py-4">
          <Button
            type="button" size="sm" variant="outline"
            onClick={onSaveCampaign}
            disabled={savingCampaign}
            className="h-9 w-full bg-background text-foreground border-input hover:bg-muted"
          >
            {savingCampaign ? <Loader2 className="size-3 animate-spin" /> : null}
            {savingCampaign ? "Saving…" : "Save"}
          </Button>
        </section>
      )}

      {/* TEST */}
      <section className="px-5 py-5">
        <p className="mb-3 text-[9.9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Test</p>
        <Button type="button" size="sm" variant="outline" onClick={onOpenLiveTest} disabled={preparingLiveTest} className="mb-4 h-9 w-full bg-background text-foreground border-input hover:bg-muted">
          {preparingLiveTest ? <Loader2 className="size-3 animate-spin" /> : <Headphones className="size-3" />}
          Browser test
        </Button>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Phone number</label>
        <div className="flex gap-1.5">
          <Input type="tel" value={phoneRaw} onChange={(e) => setPhoneRaw(e.target.value)} placeholder="+91 98765 43210" className="h-9 flex-1 font-mono text-xs" />
          <Button type="button" size="sm" onClick={onCallLive} disabled={!phoneRaw.trim() || callLoading} className="h-9 shrink-0 border-[var(--status-green)] bg-[var(--status-green)] text-white hover:opacity-90">
            {callLoading ? <Loader2 className="size-3 animate-spin" /> : <Phone className="size-3" />}
            Live call test
          </Button>
        </div>
      </section>
    </aside>
  );
}
