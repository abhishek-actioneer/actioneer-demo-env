"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Loader2, Sparkles } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import {
  buildScenarios,
  coachOpeningRoadmap,
  composeCoachPrompt,
  type RoleplayScenario,
  type SavedScenarioBundle,
  type TraineeRole,
} from "@/features/roleplay/roleplay-scenario";
import type { TrainingProgram } from "@/features/roleplay/roleplay-training-program-store";
import { buildInstructorDeliveryRules, type TrainingCallScript } from "@/features/roleplay/roleplay-call-script";
import { geminiVoiceGender } from "@/lib/gemini-voices";
import { defaultVoiceCampaignPersonaPrompt, normalizeAgentGenderedPhrases } from "@/lib/voice-campaign-flow";
import type { Segment } from "@/lib/types";
import { CampaignConfigPanel } from "@/components/voice-campaigns/campaign-config-panel";
import { VoiceTestPanel } from "@/components/voice-campaigns/voice-test-panel";

const DEFAULT_VOICE = "Sulafat";
const DEFAULT_COMPANY = "ABSLI";

type PhoneCallResult = { campaignId: string; callId: string; toNumber: string; status: string };
type StarterBrief = { label: string; brief: string };

/**
 * Derive the "Get started with" chips from the CONTENT the instructor teaches —
 * the approved call plan for this bundle. This is a content-training call (the
 * AI is an instructor, not a customer), so each chip focuses the lesson on a
 * real piece of the plan: the whole plan, the required talking points, the
 * mandatory disclosures, and each compliance trap.
 */
function starterBriefs(bundle: SavedScenarioBundle | null): StarterBrief[] {
  if (!bundle) return [];
  const clean = (v: string | undefined) => (v ?? "").replace(/\s+/g, " ").trim();
  const coverage = bundle.spine.coverage ?? [];
  const briefs: StarterBrief[] = [];

  // Always offer a full-plan lesson first.
  briefs.push({
    label: "Teach the whole call plan",
    brief: `Teach ${bundle.productLabel} end to end: explain the plan, walk the full agenda, drill every mandatory disclosure, and cover how to handle each compliance trap.`,
  });

  const talkingPoints = coverage.filter((c) => c.required && c.kind !== "disclosure" && c.kind !== "objection");
  if (talkingPoints.length) {
    briefs.push({
      label: "Focus: product basics",
      brief: `Focus the lesson on the core talking points: ${talkingPoints.map((c) => clean(c.topic)).join(", ")}. Make sure the trainee can explain each from scratch.`,
    });
  }

  const disclosures = coverage.filter((c) => c.required && c.kind === "disclosure");
  if (disclosures.length) {
    briefs.push({
      label: "Focus: mandatory disclosures",
      brief: `Drill the mandatory disclosures the trainee must state every time: ${disclosures.map((c) => clean(c.topic)).join(", ")}. Explain why skipping each one fails compliance.`,
    });
  }

  for (const trap of (bundle.spine.traps ?? []).slice(0, 3)) {
    briefs.push({
      label: `Handle: ${trap.label}`,
      brief: `Teach how to handle the "${clean(trap.label)}" compliance trap. A customer will tempt with: ${clean(trap.bait)}. Teach the right response (${clean(trap.pass)}) vs the wrong one.`,
    });
  }

  return briefs.slice(0, 6);
}

function slugify(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "policy";
}

function roleBlurb(role: TraineeRole): string {
  return role === "RO"
    ? "Relationship Officers — warm follow-up calls."
    : "Sales Persons — branch-first product explanation.";
}

/**
 * Phone-calls tab for the scenario workspace — a voice-campaign-style script
 * studio: an editable customer call script on the left (generate from a brief,
 * or write your own) and the reusable caller/config rail on the right. Operates
 * at PROGRAM level so the audience picker switches which role (SP/RO) you call.
 */
export function CallStudioSection({ bundleId, datasetId }: { bundleId: string; datasetId: string }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [bundlesByRole, setBundlesByRole] = useState<Partial<Record<TraineeRole, SavedScenarioBundle>>>({});
  const [roles, setRoles] = useState<TraineeRole[]>([]);
  const [activeRole, setActiveRole] = useState<TraineeRole>("SP");

  const [script, setScript] = useState("");
  const [brief, setBrief] = useState("");
  const [generating, setGenerating] = useState(false);
  const [voice, setVoice] = useState(DEFAULT_VOICE);
  const [agentName, setAgentName] = useState("Priya");
  const [companyName, setCompanyName] = useState(DEFAULT_COMPANY);
  const [campaignName, setCampaignName] = useState("Content training");
  const [personaPrompt, setPersonaPrompt] = useState(() =>
    defaultVoiceCampaignPersonaPrompt("Priya", DEFAULT_COMPANY, geminiVoiceGender(DEFAULT_VOICE)),
  );
  const [language, setLanguage] = useState("Hinglish");
  const [phoneRaw, setPhoneRaw] = useState("");

  const [saving, setSaving] = useState(false);
  const [callLoading, setCallLoading] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  const [browserOpen, setBrowserOpen] = useState(false);

  // Load the parent program (both SP + RO scenarios), falling back to just this
  // scenario when it isn't part of a program.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const self = await apiFetch<SavedScenarioBundle>(`/api/roleplay/scenarios/${bundleId}`, { skipModel: true });
        let bundleIds: string[] = [self.id];
        try {
          const list = await apiFetch<{ programs: TrainingProgram[] }>("/api/roleplay/programs", { skipModel: true });
          const parent = list.programs.find((p) => p.modules.some((m) => m.scenarioBundleId === bundleId));
          if (parent) bundleIds = parent.modules.map((m) => m.scenarioBundleId);
        } catch {
          /* standalone scenario — keep just this one */
        }

        const bundles = await Promise.all(
          bundleIds.map((sbId) =>
            sbId === self.id
              ? Promise.resolve(self)
              : apiFetch<SavedScenarioBundle>(`/api/roleplay/scenarios/${sbId}`, { skipModel: true }).catch(() => null),
          ),
        );
        if (cancelled) return;

        const byRole: Partial<Record<TraineeRole, SavedScenarioBundle>> = {};
        const orderedRoles: TraineeRole[] = [];
        for (const b of bundles) {
          if (!b || byRole[b.role]) continue;
          byRole[b.role] = b;
          orderedRoles.push(b.role);
        }
        setBundlesByRole(byRole);
        setRoles(orderedRoles);
        const startRole = byRole[self.role] ? self.role : orderedRoles[0] ?? self.role;
        setActiveRole(startRole);
        setLanguage(byRole[startRole]?.language ?? "Hinglish");
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Couldn't load the training scenarios.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bundleId]);

  const activeBundle = bundlesByRole[activeRole] ?? null;

  // Load the saved script for the active role.
  useEffect(() => {
    if (!activeBundle) return;
    let cancelled = false;
    setScript("");
    (async () => {
      try {
        const res = await apiFetch<{ script: TrainingCallScript | null }>(
          `/api/roleplay/scenarios/${activeBundle.id}/script`,
          { skipModel: true },
        );
        if (!cancelled && typeof res.script?.script === "string") setScript(res.script.script);
      } catch {
        /* no saved script yet */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeBundle]);

  const activeScenario = useMemo<RoleplayScenario | null>(() => {
    if (!activeBundle) return null;
    const built = buildScenarios(
      datasetId as "absli-life",
      slugify(activeBundle.productLabel),
      activeBundle.role,
      activeBundle.spine,
      activeBundle.roleModule,
      activeBundle.personas,
    );
    return built[0] ?? null;
  }, [activeBundle, datasetId]);

  const starters = useMemo(() => starterBriefs(activeBundle), [activeBundle]);

  // Auto-size the script textarea to its content so only the outer column
  // scrolls (a fixed row count leaves the textarea with its own scrollbar).
  const scriptRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = scriptRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [script]);

  const composed = activeScenario ? composeCoachPrompt(activeScenario) : null;
  const voiceGender = geminiVoiceGender(voice);
  const openingRoadmap = activeScenario
    ? normalizeAgentGenderedPhrases(coachOpeningRoadmap(activeScenario), voiceGender)
    : "";
  // The lesson guide (generated script, or the composed fallback) is only the
  // CONTENT. Prepend the fixed delivery rules so the agent teaches one point at
  // a time and waits for the trainee to confirm before moving on.
  const lessonGuide = (script || "").trim() || composed?.systemPrompt || "";
  const effectiveSystemPrompt = lessonGuide
    ? `${buildInstructorDeliveryRules(voiceGender, { openingRoadmap })}\n\n${lessonGuide}`
    : "";
  const firstMessage = normalizeAgentGenderedPhrases(composed?.firstMessage || "", voiceGender);

  const segments = useMemo<Segment[]>(
    () =>
      roles.map((r) => ({
        id: r.toLowerCase(),
        name: `${r} trainees`,
        sql: "",
        description: roleBlurb(r),
        userCount: bundlesByRole[r]?.personas.length ?? 0,
        createdAt: new Date().toISOString(),
        pushStatus: {},
      })),
    [roles, bundlesByRole],
  );
  const segmentId = activeRole.toLowerCase();
  const selectedSegment = segments.find((s) => s.id === segmentId) ?? null;

  function selectRole(id: string) {
    const nextRole: TraineeRole = id.toUpperCase() === "RO" ? "RO" : "SP";
    if (!bundlesByRole[nextRole]) return;
    setActiveRole(nextRole);
    setBrief("");
    setCallError(null);
    setLanguage(bundlesByRole[nextRole]?.language ?? "Hinglish");
  }

  async function generateScript() {
    if (!activeBundle || brief.trim().length < 2) return;
    setGenerating(true);
    setCallError(null);
    try {
      const res = await apiFetch<{ script: TrainingCallScript }>(`/api/roleplay/scenarios/${activeBundle.id}/script`, {
        method: "POST",
        skipModel: true,
        body: { brief, voice },
      });
      setScript(res.script.script);
      setBrief("");
    } catch (e) {
      setCallError(e instanceof Error ? e.message : "Couldn't generate the script.");
    } finally {
      setGenerating(false);
    }
  }

  async function saveConfig() {
    if (!activeBundle) return;
    setSaving(true);
    try {
      const [saved] = await Promise.all([
        apiFetch<SavedScenarioBundle>(`/api/roleplay/scenarios/${activeBundle.id}`, {
          method: "PUT",
          skipModel: true,
          body: {
            name: activeBundle.name,
            productId: activeBundle.productId,
            productLabel: activeBundle.productLabel,
            role: activeBundle.role,
            difficulty: activeBundle.difficulty,
            language,
            policyFacts: activeBundle.policyFacts,
            spine: activeBundle.spine,
            roleModule: activeBundle.roleModule,
            personas: activeBundle.personas,
          },
        }),
        apiFetch(`/api/roleplay/scenarios/${activeBundle.id}/script`, {
          method: "PUT",
          skipModel: true,
          body: { script },
        }),
      ]);
      setBundlesByRole((current) => ({ ...current, [saved.role]: saved }));
    } catch {
      /* keep local edits even if the save fails */
    } finally {
      setSaving(false);
    }
  }

  async function callLive() {
    if (!activeScenario) return;
    const phone = phoneRaw.trim();
    if (!phone) {
      setCallError("Enter the trainee phone number first.");
      return;
    }
    setCallLoading(true);
    setCallError(null);
    try {
      await apiFetch<PhoneCallResult>("/api/roleplay/phone-call", {
        method: "POST",
        skipModel: true,
        body: { scenario: activeScenario, phoneNumber: phone, mode: "learn", voice, systemPrompt: effectiveSystemPrompt, firstMessage },
      });
    } catch (e) {
      setCallError(e instanceof Error ? e.message : "Could not start the training call.");
    } finally {
      setCallLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  if (loadError || !activeBundle) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center gap-2 text-center text-muted-foreground">
        <AlertTriangle className="size-6" />
        <p className="text-sm">{loadError ?? "This scenario has no callable content yet."}</p>
      </div>
    );
  }

  const hasScript = script.trim().length > 0;

  return (
    <div className="flex h-full min-h-0 gap-6 px-6">
      {/* Left — editable customer call script (voice-campaign style) */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-10 pt-8 pb-44">
          <textarea
            ref={scriptRef}
            value={script}
            onChange={(event) => setScript(event.target.value)}
            placeholder="Write your script here, or generate one from the call plan below…"
            className="w-full resize-none overflow-hidden bg-transparent text-[13.5px] leading-8 text-foreground outline-none placeholder:text-muted-foreground/25"
            rows={6}
            spellCheck={false}
          />
        </div>

        {/* Floating call-plan composer — matches the voice-campaign script tab */}
        <div className="absolute bottom-6 left-0 right-0 px-10">
          {!hasScript && starters.length > 0 && (
            <div className="mb-3">
              <p className="mb-2 text-xs text-muted-foreground/60">Teach from the call plan</p>
              <div className="flex flex-wrap gap-2">
                {starters.map((chip) => (
                  <button
                    key={chip.label}
                    type="button"
                    onClick={() => setBrief(chip.brief)}
                    className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/20 px-3 py-2 text-sm text-foreground/80 transition-colors hover:border-border hover:bg-muted/30 hover:text-foreground"
                  >
                    <Sparkles className="size-4" />
                    {chip.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="relative rounded-2xl border border-border/40 bg-muted/60 px-4 pt-4 pb-3 shadow-xl backdrop-blur-xl">
            <textarea
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void generateScript();
                }
              }}
              rows={2}
              placeholder={hasScript ? "Describe another call to generate…" : "What's this call about?"}
              className="w-full resize-none bg-transparent text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/50"
            />
            <div className="flex items-center justify-between pt-1">
              <span className="text-[9.9px] text-muted-foreground">
                {activeRole} · generates from the approved call plan
              </span>
              <button
                type="button"
                onClick={() => void generateScript()}
                disabled={brief.trim().length < 2 || generating}
                className="flex size-7 items-center justify-center rounded-full bg-foreground text-background transition-opacity disabled:opacity-30"
              >
                {generating ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M12 19V5M5 12l7-7 7 7" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {callError && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-background/80 px-3 py-2 text-sm text-foreground">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span>{callError}</span>
            </div>
          )}
        </div>
      </div>

      {/* Right — reusable caller / config rail (Audience = SP/RO) */}
      <CampaignConfigPanel
        segments={segments}
        loadingOptions={false}
        segmentId={segmentId}
        setSegmentId={selectRole}
        selectedSegment={selectedSegment}
        savingCampaign={saving}
        onSaveCampaign={saveConfig}
        hasLoadedExistingCampaign
        language={language}
        onLanguageChange={setLanguage}
        savingLanguage={saving}
        agentName={agentName}
        setAgentName={setAgentName}
        companyName={companyName}
        setCompanyName={setCompanyName}
        campaignName={campaignName}
        setCampaignName={setCampaignName}
        personaPrompt={personaPrompt}
        setPersonaPrompt={setPersonaPrompt}
        voice={voice}
        setVoice={setVoice}
        previewingVoice={null}
        onPreviewVoice={() => {}}
        phoneRaw={phoneRaw}
        setPhoneRaw={setPhoneRaw}
        preparingLiveTest={false}
        onOpenLiveTest={() => setBrowserOpen(true)}
        onCallLive={callLive}
        callLoading={callLoading}
      />

      {/* Browser test overlay */}
      {browserOpen && effectiveSystemPrompt && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-background/25 backdrop-blur-[2px]" onClick={() => setBrowserOpen(false)} />
          <div className="pointer-events-none absolute bottom-6 left-1/2 w-[min(620px,calc(100vw-24px))] -translate-x-1/2">
            <div className="pointer-events-auto w-full">
              <VoiceTestPanel
                systemPrompt={effectiveSystemPrompt}
                firstMessage={firstMessage}
                voice={voice}
                datasetId={datasetId}
                campaignName={`${activeBundle.productLabel} · ${activeRole} content training`}
                onClose={() => setBrowserOpen(false)}
                showVoiceMetadata
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
