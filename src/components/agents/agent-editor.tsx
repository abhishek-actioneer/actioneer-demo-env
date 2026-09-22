"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  AudioLines,
  BarChart3,
  BookOpen,
  Briefcase,
  Check,
  ChevronRight,
  Globe,
  Loader2,
  MessageSquare,
  Mic,
  Pencil,
  Phone,
  PhoneCall,
  Send,
  Settings2,
  Shield,
  Sparkles,
  User,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { VoiceVoxel } from "@/components/voice-campaigns/voice-voxel";
import { VoiceTestPanel } from "@/components/voice-campaigns/voice-test-panel";
import type { Agent } from "@/lib/agent-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type TabKey = "general" | "behavior" | "knowledge" | "security" | "analysis";
const TABS: { key: TabKey; label: string; icon: typeof Settings2 }[] = [
  { key: "general", label: "General", icon: Settings2 },
  { key: "behavior", label: "Behavior", icon: MessageSquare },
  { key: "knowledge", label: "Knowledge", icon: BookOpen },
  { key: "security", label: "Security", icon: Shield },
  { key: "analysis", label: "Analysis", icon: BarChart3 },
];

interface KnowledgeItem {
  id: string;
  title: string;
  priority: string;
  chars: number;
}

/** The subset of Agent the editor writes back. */
interface EditableForm {
  name: string;
  avatarSeed: string; // "" = default (name + voice)
  role: string;
  language: string;
  systemPrompt: string;
  firstMessage: string;
  knowledgeIds: string[] | null; // null = auto (whole KB)
}

/** Distinct voxel identities the user can pick from. */
const AVATAR_SEEDS = ["aurora", "cobalt", "violet", "ember", "jade", "rose", "sky", "amber", "slate", "coral", "teal", "plum"];

/** The seed the agent's voxel avatar renders from (chosen override, else default). */
function avatarSeedOf(name: string, voiceName: string | undefined, override: string): string {
  return override || `${name}-${voiceName ?? name}`;
}

const LANGUAGES = ["Hinglish", "Hindi", "English (US)", "English (India)", "Tamil", "Telugu", "Marathi", "Bengali"];
const BACKGROUND_NOISE = ["None", "Office", "Cafe", "Call center"];

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

/** Voxel-orb agent avatar (same generator as the agent cards). */
function AgentAvatar({ seed, label, size = 40 }: { seed: string; label: string; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${label || "Agent"} avatar`}
    >
      <VoiceVoxel voiceName={seed} size={Math.round(size * 0.78)} />
    </span>
  );
}

function SectionHeading({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {sub && <p className="mt-0.5 text-sm text-muted-foreground">{sub}</p>}
    </div>
  );
}

/** Identity row whose value is edited inline via a pencil toggle. */
function EditableRow({
  icon, value, placeholder, sub, onChange,
}: {
  icon: React.ReactNode;
  value: string;
  placeholder: string;
  sub: string;
  onChange: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <span className="grid size-8 place-items-center text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1">
        {editing ? (
          <Input
            autoFocus
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setEditing(false); } }}
            className="h-8"
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
          />
        ) : (
          <>
            <span className="block truncate text-sm font-medium text-foreground">{value || placeholder}</span>
            <span className="block text-xs text-muted-foreground">{sub}</span>
          </>
        )}
      </span>
      {!editing && (
        <button type="button" onClick={() => setEditing(true)} className="text-muted-foreground hover:text-foreground" aria-label="Edit">
          <Pencil className="size-4" />
        </button>
      )}
    </div>
  );
}

/** A framed, list-style row like the reference's identity rows. */
function Row({
  icon,
  title,
  sub,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  sub?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
      {icon && <span className="grid size-8 place-items-center text-muted-foreground">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">{title}</span>
        {sub && <span className="mt-0.5 block text-xs text-muted-foreground">{sub}</span>}
      </span>
      {children}
    </div>
  );
}

export function AgentEditor({ id }: { id: string }) {
  const router = useRouter();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [knowledge, setKnowledge] = useState<KnowledgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<TabKey>("general");
  const [previewMode, setPreviewMode] = useState<"voice" | "chat">("voice");

  // Persisted fields.
  const [form, setForm] = useState<EditableForm | null>(null);
  // Decorative controls (interactive; not persisted in v1).
  const [ui, setUi] = useState({
    backgroundNoise: "Office",
    waitForGreeting: false,
    noiseCancellation: false,
    interruptionThreshold: 500,
    voicemail: "Hangup",
    memory: false,
    generateSummary: true,
    recordCalls: true,
  });

  // Inbound state (real).
  const [inbound, setInbound] = useState<{ live: boolean; agentName: string | null } | null>(null);
  const [inboundBusy, setInboundBusy] = useState(false);

  // Live voice preview (real Gemini Live call in the browser).
  const [previewStarting, setPreviewStarting] = useState(false);
  const [previewConfig, setPreviewConfig] = useState<{
    systemPrompt: string;
    firstMessage: string;
    voice: string;
    datasetId?: string;
  } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setNotFound(false);
    apiFetch<{ agent: Agent; knowledge: KnowledgeItem[] }>(`/api/agents/${id}`, { skipModel: true })
      .then((r) => {
        setAgent(r.agent);
        setKnowledge(r.knowledge ?? []);
        setForm({
          name: r.agent.name ?? "",
          avatarSeed: r.agent.avatarSeed ?? "",
          role: r.agent.role ?? "",
          language: r.agent.language ?? "",
          systemPrompt: r.agent.systemPrompt ?? "",
          firstMessage: r.agent.firstMessage ?? "",
          knowledgeIds: r.agent.knowledgeIds ?? null,
        });
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const refreshInbound = useCallback(() => {
    apiFetch<{ live: boolean; agentName: string | null }>("/api/inbound-agent", { skipModel: true })
      .then((s) => setInbound({ live: s.live, agentName: s.agentName }))
      .catch(() => setInbound(null));
  }, []);
  useEffect(() => { refreshInbound(); }, [refreshInbound]);

  const dirty = useMemo(() => {
    if (!agent || !form) return false;
    return (
      form.name !== (agent.name ?? "") ||
      form.avatarSeed !== (agent.avatarSeed ?? "") ||
      form.role !== (agent.role ?? "") ||
      form.language !== (agent.language ?? "") ||
      form.systemPrompt !== (agent.systemPrompt ?? "") ||
      form.firstMessage !== (agent.firstMessage ?? "") ||
      JSON.stringify(form.knowledgeIds) !== JSON.stringify(agent.knowledgeIds ?? null)
    );
  }, [agent, form]);

  const update = <K extends keyof EditableForm>(key: K, value: EditableForm[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));

  async function save() {
    if (!form) return;
    setSaving(true);
    try {
      const r = await apiFetch<{ agent: Agent }>(`/api/agents/${id}`, {
        method: "PATCH",
        skipModel: true,
        body: form,
      });
      setAgent(r.agent);
      toast.success("Changes saved");
    } catch {
      toast.error("Could not save changes");
    } finally {
      setSaving(false);
    }
  }

  const isLiveInbound = Boolean(inbound?.live && agent && inbound?.agentName?.toLowerCase() === agent.name.toLowerCase());

  async function toggleInbound(action: "activate" | "deactivate") {
    if (!agent?.primaryCampaignId) {
      toast.error("This agent has no campaign persona to deploy.");
      return;
    }
    setInboundBusy(true);
    try {
      await apiFetch("/api/inbound-agent", {
        method: "POST",
        skipModel: true,
        body: action === "activate" ? { action, campaignId: agent.primaryCampaignId } : { action },
      });
      refreshInbound();
      toast.success(action === "activate" ? "Now answering inbound calls" : "Inbound paused");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setInboundBusy(false);
    }
  }

  // Compile the draft (unsaved) persona + knowledge into a ready-to-speak config,
  // then hand it to <VoiceTestPanel> for a real in-browser Gemini Live call.
  async function startPreview() {
    if (!form || previewStarting) return;
    setPreviewStarting(true);
    try {
      const cfg = await apiFetch<{
        systemPrompt: string;
        firstMessage: string;
        voice: string;
        datasetId?: string;
      }>(`/api/agents/${id}/preview`, {
        method: "POST",
        skipModel: true,
        body: {
          systemPrompt: form.systemPrompt,
          firstMessage: form.firstMessage,
          knowledgeIds: form.knowledgeIds,
        },
      });
      if (!cfg.systemPrompt?.trim()) {
        toast.error("Add a Global Prompt in the Behavior tab before previewing.");
        return;
      }
      setPreviewConfig(cfg);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start the preview");
    } finally {
      setPreviewStarting(false);
    }
  }

  if (loading) {
    return (
      <div className="grid h-full place-items-center text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-2"><Loader2 className="size-4 animate-spin" />Loading agent…</span>
      </div>
    );
  }
  if (notFound || !agent || !form) {
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <div>
          <p className="text-sm font-medium">Agent not found</p>
          <p className="mt-1 text-sm text-muted-foreground">It may have been removed, or the link is stale.</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => router.push("/agents")}>Back to agents</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button onClick={() => router.push("/agents")} className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Back to agents">
          <ArrowLeft className="size-4" />
        </button>
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="truncate text-sm text-muted-foreground">Agents /</span>
          <span className="truncate text-sm font-semibold text-foreground">{form.name || "Untitled Agent"}</span>
          <span className={`ml-1 shrink-0 rounded-full border px-2 py-0.5 text-[9.9px] font-medium ${isLiveInbound ? "border-border bg-foreground text-background" : "border-border text-muted-foreground"}`}>
            {isLiveInbound ? "Live" : "Draft"}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            className="h-8 border-[var(--brand-amber-border)] bg-[var(--brand-amber)] text-[var(--brand-amber-foreground)] hover:bg-[var(--brand-amber-hover)] disabled:opacity-50"
            disabled={!dirty || saving}
            onClick={save}
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Save Changes
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Left: tabs + content */}
        <div className="flex min-w-0 flex-1 flex-col">
          <nav className="grid h-11 shrink-0 auto-cols-fr grid-flow-col items-stretch border-b border-border bg-[#f1f1ed]" role="tablist">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t.key)}
                  className={`flex h-full items-center justify-center gap-1.5 border-l border-border px-2 text-[9.9px] font-semibold uppercase tracking-[0.075em] transition-colors first:border-l-0 hover:bg-background/60 hover:text-foreground ${
                    active
                      ? "bg-background text-foreground shadow-[inset_0_2px_0_var(--brand-amber)]"
                      : "text-muted-foreground"
                  }`}
                >
                  <Icon className="size-3.5 opacity-70" />
                  {t.label}
                </button>
              );
            })}
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto px-8 py-8">
            <div className="w-full">
              {/* Identity summary line */}
              <div className="mb-6 flex items-center gap-3">
                <AgentAvatar seed={avatarSeedOf(form.name, agent.voiceName, form.avatarSeed)} label={form.name} size={44} />
                <div className="min-w-0">
                  <div className="truncate text-lg font-semibold text-foreground">{form.name || "Untitled Agent"}</div>
                  <div className="truncate text-sm text-muted-foreground">{form.role || "Voice Agent"} · {agent.campaignCount ?? 0} campaigns</div>
                </div>
              </div>

              {tab === "general" && (
                <GeneralTab
                  form={form}
                  update={update}
                  ui={ui}
                  setUi={setUi}
                  agent={agent}
                  isLiveInbound={isLiveInbound}
                  inboundBusy={inboundBusy}
                  toggleInbound={toggleInbound}
                />
              )}
              {tab === "behavior" && <BehaviorTab form={form} update={update} />}
              {tab === "knowledge" && (
                <KnowledgeTab form={form} update={update} knowledge={knowledge} />
              )}
              {tab === "security" && <SecurityTab />}
              {tab === "analysis" && <AnalysisTab ui={ui} setUi={setUi} />}
            </div>
          </div>
        </div>

        {/* Right: preview */}
        <aside className="hidden w-[460px] shrink-0 flex-col border-l border-border bg-muted/30 lg:flex">
          <div className="flex h-11 items-center justify-between border-b border-border px-4">
            <span className="text-sm font-medium text-foreground">Preview</span>
            <div className="flex items-center gap-1 rounded-full border border-border bg-background p-0.5">
              {(["voice", "chat"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => { setPreviewMode(m); if (m !== "voice") setPreviewConfig(null); }}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${previewMode === m ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          {/* Identity — always centered in the free space above the dock. */}
          <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6">
            <VoiceVoxel voiceName={avatarSeedOf(form.name, agent.voiceName, form.avatarSeed)} size={128} />
            <div className="text-center text-lg font-semibold text-foreground">{form.name || "Untitled Agent"}</div>
          </div>

          {/* Bottom dock — live call panel (flush, sharp) or the start controls. */}
          {previewConfig && previewMode === "voice" ? (
            <div>
              <VoiceTestPanel
                variant="embedded"
                systemPrompt={previewConfig.systemPrompt}
                firstMessage={previewConfig.firstMessage}
                voice={previewConfig.voice}
                datasetId={previewConfig.datasetId}
                campaignName={form.name || "Agent preview"}
                modelLabel="Gemini Live"
                autoStart
                onClose={() => setPreviewConfig(null)}
              />
              <p className="border-t border-border px-6 py-2.5 text-center text-[9.9px] text-muted-foreground">
                Previewing your unsaved edits · grounded on selected knowledge
              </p>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-4 border-t border-border px-6 py-5">
              <button className="grid size-11 place-items-center rounded-full border border-border text-muted-foreground" aria-label="Mute"><Mic className="size-4" /></button>
              <button
                onClick={previewMode === "voice" ? startPreview : () => toast("Text chat preview — coming soon")}
                disabled={previewStarting}
                className="grid size-14 place-items-center rounded-full bg-[#1a7f4b] text-white shadow-sm transition hover:bg-[#166b40] disabled:opacity-60"
                aria-label="Start preview call"
              >
                {previewStarting ? <Loader2 className="size-5 animate-spin" /> : <Phone className="size-5" />}
              </button>
              <button className="grid size-11 place-items-center rounded-full border border-border text-muted-foreground" aria-label="Assist"><Sparkles className="size-4" /></button>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

/* ─────────────────────────── General ─────────────────────────── */

type UiState = {
  backgroundNoise: string; waitForGreeting: boolean; noiseCancellation: boolean;
  interruptionThreshold: number; voicemail: string; memory: boolean;
  generateSummary: boolean; recordCalls: boolean;
};

function GeneralTab({
  form, update, ui, setUi, agent, isLiveInbound, inboundBusy, toggleInbound,
}: {
  form: EditableForm;
  update: <K extends keyof EditableForm>(k: K, v: EditableForm[K]) => void;
  ui: UiState;
  setUi: React.Dispatch<React.SetStateAction<UiState>>;
  agent: Agent;
  isLiveInbound: boolean;
  inboundBusy: boolean;
  toggleInbound: (a: "activate" | "deactivate") => void;
}) {
  return (
    <div className="space-y-8">
      <section>
        <SectionHeading title="Identity" sub="How and where your agent appears to users." />
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="flex items-center gap-3 border-b border-border px-4 py-3">
            <AgentAvatar seed={avatarSeedOf(form.name, agent.voiceName, form.avatarSeed)} label={form.name} size={36} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-foreground">Avatar</span>
              <span className="block text-xs text-muted-foreground">Pick a voxel identity for this agent</span>
            </span>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8">Choose</Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 p-3">
                <p className="mb-2 text-xs font-medium text-muted-foreground">Choose an avatar</p>
                <div className="grid grid-cols-4 gap-2">
                  {AVATAR_SEEDS.map((s) => {
                    const selected = form.avatarSeed === s;
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => update("avatarSeed", s)}
                        aria-label={`Avatar ${s}`}
                        className={`grid aspect-square place-items-center overflow-hidden rounded-md border bg-muted transition ${selected ? "border-foreground ring-1 ring-foreground" : "border-border hover:border-foreground/40"}`}
                      >
                        <VoiceVoxel voiceName={s} size={34} />
                      </button>
                    );
                  })}
                </div>
                {form.avatarSeed && (
                  <button type="button" onClick={() => update("avatarSeed", "")} className="mt-2 text-xs text-muted-foreground hover:text-foreground">
                    Reset to default
                  </button>
                )}
              </PopoverContent>
            </Popover>
          </div>
          <EditableRow icon={<User className="size-4" />} value={form.name} placeholder="Untitled agent" sub="Your display name" onChange={(v) => update("name", v)} />
          <EditableRow icon={<Briefcase className="size-4" />} value={form.role} placeholder="Describe the role" sub="Describe the agent's role and responsibilities" onChange={(v) => update("role", v)} />
          <Row icon={<Mic className="size-4" />} title={agent.voiceName || agent.name} sub={`Voice · ${agent.voice}`}>
            <ChevronRight className="size-4 text-muted-foreground" />
          </Row>
          <div className="flex items-center gap-3 border-b border-border px-4 py-3">
            <span className="grid size-8 place-items-center text-muted-foreground"><Globe className="size-4" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-foreground">{form.language || "Language"}</span>
              <span className="block text-xs text-muted-foreground">Choose your preferred language</span>
            </span>
            <Select value={form.language} onValueChange={(v) => update("language", v)}>
              <SelectTrigger className="h-8 w-40"><SelectValue placeholder="Language" /></SelectTrigger>
              <SelectContent>
                {[...new Set([form.language, ...LANGUAGES])].filter(Boolean).map((l) => (
                  <SelectItem key={l} value={l}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-3 px-4 py-3">
            <span className="grid size-8 place-items-center text-muted-foreground"><AudioLines className="size-4" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-foreground">Background noise</span>
              <span className="block text-xs text-muted-foreground">Add ambient sounds to the agent&apos;s calls</span>
            </span>
            <Select value={ui.backgroundNoise} onValueChange={(v) => setUi((s) => ({ ...s, backgroundNoise: v }))}>
              <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {BACKGROUND_NOISE.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      <section>
        <SectionHeading title="Modalities" sub="Use this agent across channels." />
        <div className="rounded-lg border border-border">
          <Row icon={<PhoneCall className="size-4" />} title="Voice &amp; Calls" sub={isLiveInbound ? "Live on your inbound number" : "Answer inbound calls with this agent"}>
            {isLiveInbound ? (
              <Button variant="outline" size="sm" className="h-8" disabled={inboundBusy} onClick={() => toggleInbound("deactivate")}>
                {inboundBusy ? <Loader2 className="size-3.5 animate-spin" /> : null}Pause inbound
              </Button>
            ) : (
              <Button
                size="sm"
                className="h-8 border-[var(--brand-amber-border)] bg-[var(--brand-amber)] text-[var(--brand-amber-foreground)] hover:bg-[var(--brand-amber-hover)]"
                disabled={inboundBusy || !agent.primaryCampaignId}
                onClick={() => toggleInbound("activate")}
              >
                {inboundBusy ? <Loader2 className="size-3.5 animate-spin" /> : null}Add to Inbound Numbers
              </Button>
            )}
          </Row>
          <Row icon={<Send className="size-4" />} title="SMS Messaging" sub="Manage SMS numbers and messaging settings">
            <Button variant="outline" size="sm" className="h-8" onClick={() => toast("SMS numbers — coming soon")}>Add SMS Numbers</Button>
          </Row>
          <Row icon={<Sparkles className="size-4" />} title="Web Widget (coming soon)" sub="Configure your agent's web widget">
            <Switch checked={false} disabled />
          </Row>
        </div>
      </section>

      <section>
        <SectionHeading title="Policy &amp; Compliance" sub="Keep the agent compliant with your org and state policies." />
        <div className="rounded-lg border border-border">
          <Row icon={<Shield className="size-4" />} title="Guard Rails" sub="Monitor the agent for TCPA or other critical policy violations">
            <ChevronRight className="size-4 text-muted-foreground" />
          </Row>
        </div>
      </section>
    </div>
  );
}

/* ─────────────────────────── Behavior ─────────────────────────── */

function BehaviorTab({
  form, update,
}: {
  form: EditableForm;
  update: <K extends keyof EditableForm>(k: K, v: EditableForm[K]) => void;
}) {
  return (
    <div className="space-y-8">
      <section>
        <SectionHeading title="General Behavior" sub="Configure overall behaviors and key conversational settings." />
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Global Prompt</label>
        <Textarea
          value={form.systemPrompt}
          onChange={(e) => update("systemPrompt", e.target.value)}
          placeholder="Describe the agent's overall behavior, personality, and motivations."
          className="min-h-56"
        />
        <label className="mb-1.5 mt-4 block text-xs font-medium text-muted-foreground">Opening message</label>
        <Textarea
          value={form.firstMessage}
          onChange={(e) => update("firstMessage", e.target.value)}
          placeholder="The agent's first line."
          className="min-h-20"
        />
      </section>
    </div>
  );
}

/* ─────────────────────────── Knowledge ─────────────────────────── */

const PRIORITY_RANK: Record<string, number> = { Critical: 0, High: 1, "Good to have": 2 };
const KB_BUDGET = 12000;
const KB_PER_ENTRY = 4000;

function KnowledgeTab({
  form, update, knowledge,
}: {
  form: EditableForm;
  update: <K extends keyof EditableForm>(k: K, v: EditableForm[K]) => void;
  knowledge: KnowledgeItem[];
}) {
  const ordered = useMemo(
    () => [...knowledge].sort((a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) || b.chars - a.chars),
    [knowledge],
  );
  const allIds = useMemo(() => ordered.map((k) => k.id), [ordered]);
  const isAuto = form.knowledgeIds === null;
  const selected = useMemo(() => new Set(form.knowledgeIds ?? allIds), [form.knowledgeIds, allIds]);

  const effective = useMemo(() => {
    let sum = 0;
    for (const k of ordered) if (selected.has(k.id)) sum += Math.min(k.chars, KB_PER_ENTRY);
    return Math.min(sum, KB_BUDGET);
  }, [ordered, selected]);
  const pct = Math.round((effective / KB_BUDGET) * 100);

  function toggle(kid: string) {
    const next = new Set(selected);
    if (next.has(kid)) next.delete(kid); else next.add(kid);
    update("knowledgeIds", [...next]);
  }

  return (
    <div className="space-y-8">
      <section>
        <SectionHeading title="Knowledge Base Sources" sub="The sources this agent grounds its answers on. It answers only from what you select here." />
        <div className="mb-3 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{isAuto ? "Auto — whole base, truncated to fit" : `Custom — ${form.knowledgeIds?.length ?? 0} of ${ordered.length}`}</span>
          <div className="flex gap-3 text-xs">
            <button className="text-muted-foreground hover:text-foreground" onClick={() => update("knowledgeIds", [...allIds])}>Select all</button>
            <button className="text-muted-foreground hover:text-foreground" onClick={() => update("knowledgeIds", [])}>Clear</button>
            {!isAuto && <button className="text-muted-foreground hover:text-foreground" onClick={() => update("knowledgeIds", null)}>Reset to auto</button>}
          </div>
        </div>
        {ordered.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">No knowledge sources for this agent&apos;s dataset yet.</div>
        ) : (
          <>
            <div className="max-h-80 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {ordered.map((k) => {
                const on = selected.has(k.id);
                return (
                  <button key={k.id} onClick={() => toggle(k.id)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/40">
                    <span className={`grid size-4 shrink-0 place-items-center border ${on ? "border-foreground bg-foreground text-background" : "border-border"}`}>{on && <Check className="size-3" />}</span>
                    <span className="min-w-0 flex-1 truncate text-sm">{k.title}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{fmt(k.chars)}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground"><span>Reaches the agent</span><span className="tabular-nums">≈ {fmt(effective)} / {fmt(KB_BUDGET)} chars</span></div>
              <div className="mt-1 h-1.5 w-full bg-muted"><div className="h-full bg-foreground" style={{ width: `${pct}%` }} /></div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

/* ─────────────────────────── Security ─────────────────────────── */

function SecurityTab() {
  return (
    <div className="space-y-8">
      <section>
        <SectionHeading title="Identity &amp; Account Safety" sub="Rules that protect account-specific information on a call." />
        <div className="rounded-lg border border-border">
          <Row icon={<Shield className="size-4" />} title="Require identity verification" sub="Never reveal account details until the caller is verified.">
            <Switch checked disabled />
          </Row>
          <Row icon={<Shield className="size-4" />} title="No unconfirmed figures" sub="The agent never invents rates, EMIs, or eligibility.">
            <Switch checked disabled />
          </Row>
        </div>
      </section>
      <section>
        <SectionHeading title="Guard Rails" sub="Monitor the agent for policy violations during the call." />
        <div className="rounded-lg border border-border">
          <Row icon={<Shield className="size-4" />} title="TCPA &amp; compliance monitoring" sub="Flag critical policy violations from the transcript.">
            <ChevronRight className="size-4 text-muted-foreground" />
          </Row>
        </div>
      </section>
    </div>
  );
}

/* ─────────────────────────── Analysis ─────────────────────────── */

function AnalysisTab({ ui, setUi }: { ui: UiState; setUi: React.Dispatch<React.SetStateAction<UiState>> }) {
  const [summaryPrompt, setSummaryPrompt] = useState("Summarize the conversation between the agent and the caller.");
  const [webhookUrl, setWebhookUrl] = useState("");
  return (
    <div className="space-y-8">
      <section>
        <SectionHeading title="Post-Conversation Analysis" sub="Customize automated reports and analysis." />
        <div className="rounded-lg border border-border p-4">
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm"><span className="block font-medium">Generate Summary</span><span className="text-xs text-muted-foreground">Create a short summary after each conversation.</span></span>
            <Switch checked={ui.generateSummary} onCheckedChange={(v) => setUi((s) => ({ ...s, generateSummary: v }))} />
          </label>
          {ui.generateSummary && (
            <Textarea value={summaryPrompt} onChange={(e) => setSummaryPrompt(e.target.value)} className="mt-3 min-h-20" />
          )}
        </div>
      </section>
      <section>
        <SectionHeading title="Evaluations" sub="Automatically score conversations after they end." />
        <div className="rounded-lg border border-border">
          <Row title="Post-Call Eval" sub="Run a selected eval against each conversation when it ends.">
            <Select defaultValue="none">
              <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="none">No eval</SelectItem></SelectContent>
            </Select>
          </Row>
        </div>
      </section>
      <section>
        <SectionHeading title="Webhook" sub="Send call details to a URL when the call ends." />
        <Input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://example.com/webhook" />
      </section>
    </div>
  );
}
