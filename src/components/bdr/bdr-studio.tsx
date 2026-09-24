"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { UserButton } from "@clerk/nextjs";
import { ArrowDownToLine, ArrowUpRight, AudioLines, Check, ChevronRight, Loader2, Pause, Phone, Play, RefreshCw, Save, Search, Users, Workflow } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { DEFAULT_DATASET } from "@/lib/datasets/constants";
import { personalizeBdr, type BdrAudience, type BdrCampaign, type BdrRecipient } from "@/lib/bdr/types";

type Fields = Pick<BdrCampaign, "name" | "script" | "opening" | "voiceId" | "language">;
type Readiness = { monaco: boolean; calling: boolean; missing: string[] };
const requestOptions = { datasetId: DEFAULT_DATASET, skipModel: true };
const control = "w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-foreground/20 disabled:opacity-50";
const button = "inline-flex items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40";
function fieldsOf(campaign: BdrCampaign): Fields { return { name: campaign.name, script: campaign.script, opening: campaign.opening, voiceId: campaign.voiceId, language: campaign.language }; }

export function BdrStudio() {
  const [campaigns, setCampaigns] = useState<BdrCampaign[]>([]);
  const [audiences, setAudiences] = useState<BdrAudience[]>([]);
  const [readiness, setReadiness] = useState<Readiness>({ monaco: false, calling: false, missing: [] });
  const [selectedId, setSelectedId] = useState("");
  const [audienceId, setAudienceId] = useState("");
  const [fields, setFields] = useState<Fields | null>(null);
  const [tab, setTab] = useState<"script" | "contacts">("script");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [transcriptId, setTranscriptId] = useState("");
  const importKey = useRef("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const selected = campaigns.find((c) => c.id === selectedId);
  const dirty = !!selected && !!fields && JSON.stringify(fieldsOf(selected)) !== JSON.stringify(fields);
  const activeCall = selected?.recipients.some((r) => ["dispatching", "calling", "connected"].includes(r.status));
  const locked = selected?.status === "running" || activeCall;
  const pending = selected?.recipients.filter((r) => r.status === "pending").length || 0;
  const allRecipients = campaigns.flatMap((c) => c.recipients);

  const refresh = useCallback(async () => {
    const result = await apiFetch<{ campaigns: BdrCampaign[]; readiness: Readiness }>("/api/bdr", requestOptions);
    setCampaigns(result.campaigns); setReadiness(result.readiness);
    return result;
  }, []);
  useEffect(() => {
    let alive = true;
    void refresh().then((result) => {
      if (!alive) return;
      const first = result.campaigns[0];
      if (first) { setSelectedId(first.id); setFields(fieldsOf(first)); }
    }).catch((caught: Error) => { if (alive) setError(caught.message); }).finally(() => { if (alive) setLoading(false); });
    const timer = setInterval(() => { void refresh().catch(() => undefined); }, 5000);
    return () => { alive = false; clearInterval(timer); audioRef.current?.pause(); };
  }, [refresh]);

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label); setError(""); setMessage("");
    try { await action(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Request failed."); }
    finally { setBusy(""); }
  }
  function select(campaign: BdrCampaign) { setSelectedId(campaign.id); setFields(fieldsOf(campaign)); setQuery(""); setPage(0); setTranscriptId(""); }
  async function loadAudiences() {
    const result = await apiFetch<{ audiences: BdrAudience[] }>("/api/bdr/audiences", requestOptions);
    setAudiences(result.audiences);
    if (!result.audiences.length) setMessage("No active audiences found in Monaco.");
  }
  async function importAudience() {
    if (!importKey.current) importKey.current = crypto.randomUUID();
    const result = await apiFetch<{ campaign: BdrCampaign }>("/api/bdr/campaigns", { ...requestOptions, method: "POST", body: { id: importKey.current, audienceId } });
    await refresh(); select(result.campaign); importKey.current = "";
    setMessage("Segment imported as a draft. Review your script, then launch when ready.");
  }
  async function command(action: "save" | "launch" | "pause") {
    if (!selected || !fields) return;
    const result = await apiFetch<{ campaign: BdrCampaign }>(`/api/bdr/campaigns/${selected.id}`, { ...requestOptions, method: "PATCH", body: action === "save" ? { action, fields } : { action } });
    setCampaigns((rows) => rows.map((row) => row.id === result.campaign.id ? result.campaign : row));
    if (action === "save") setFields(fieldsOf(result.campaign));
    setMessage(action === "save" ? "Script and voice saved." : action === "pause" ? "Campaign paused. Any call already started will finish; no new calls will start." : "Campaign started. Contacts will be called one at a time.");
  }
  async function preview() {
    if (!fields || !selected) return;
    const contact = selected.recipients.find((r) => r.status !== "excluded") || selected.recipients[0];
    const text = contact ? personalizeBdr(fields.opening, contact) : fields.opening;
    const result = await apiFetch<{ audio: string }>("/api/bdr/preview", { ...requestOptions, method: "POST", body: { text, voiceId: fields.voiceId, language: fields.language } });
    audioRef.current?.pause();
    audioRef.current = new Audio(`data:audio/wav;base64,${result.audio}`);
    await audioRef.current.play();
  }
  const filtered = selected?.recipients.filter((r) => `${r.firstName} ${r.lastName} ${r.company} ${r.phone}`.toLowerCase().includes(query.toLowerCase())) || [];
  const transcript = selected?.recipients.find((r) => r.id === transcriptId);
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex h-16 items-center justify-between border-b border-border px-5 md:px-8">
        <div className="flex items-center gap-3"><span className="flex size-8 items-center justify-center rounded-md bg-foreground text-background"><AudioLines size={18} /></span><span className="text-lg font-semibold tracking-tight">actioneer</span><span className="mx-2 text-border">/</span><span className="text-sm text-muted-foreground">AI BDR</span></div>
        <div className="flex items-center gap-4"><span className="hidden text-xs text-muted-foreground sm:block">Monaco → Twilio → Cartesia</span><UserButton /></div>
      </header>
      <main className="mx-auto max-w-[1440px] px-5 py-8 md:px-8">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p className="mb-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">Outbound workspace</p><h1 className="text-3xl font-semibold tracking-tight">Your next conversation starts here.</h1><p className="mt-2 text-sm text-muted-foreground">Pull a Monaco segment, shape the conversation, and launch calls when you’re ready.</p></div><button className={button} disabled={!!busy} onClick={() => void run("refresh", async () => { await refresh(); })}><RefreshCw size={14} /> Refresh</button></div>
        <div className="mb-7 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[["Campaigns", campaigns.length], ["Ready to call", allRecipients.filter((r) => r.status === "pending").length], ["On a call", allRecipients.filter((r) => ["dispatching", "calling", "connected"].includes(r.status)).length], ["Completed calls", allRecipients.filter((r) => r.status === "completed").length]].map(([label, count]) => <div key={label} className="rounded-lg border border-border bg-card p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-3 text-2xl font-semibold tabular-nums">{count}</p></div>)}
        </div>
        {error && <div role="alert" className="mb-5 rounded-md border border-foreground/30 bg-muted p-4 text-sm">{error}</div>}
        {message && <div role="status" className="mb-5 flex items-center gap-2 rounded-md border border-border p-4 text-sm"><Check size={15} />{message}</div>}
        <div className="grid items-start gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="space-y-5">
            <section className="rounded-lg border border-border bg-card p-5"><div className="mb-4 flex items-center justify-between"><h2 className="flex items-center gap-2 text-sm font-semibold"><Users size={16} /> Monaco segments</h2><span className="text-[11px] text-muted-foreground">{readiness.monaco ? "Connected" : "Setup needed"}</span></div>
              <p className="mb-4 text-xs leading-5 text-muted-foreground">Bring an audience into a new campaign. Importing never starts a call.</p>
              <button className={`${button} mb-3 w-full`} disabled={!!busy || !readiness.monaco} onClick={() => void run("audiences", loadAudiences)}>{busy === "audiences" ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />} Load segments</button>
              <select aria-label="Monaco audience" className={control} value={audienceId} disabled={!!busy} onChange={(e) => { setAudienceId(e.target.value); importKey.current = ""; }}><option value="">Select an audience</option>{audiences.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.contact_count})</option>)}</select>
              <button className={`${button} mt-3 w-full bg-foreground text-background hover:bg-foreground/90`} disabled={!!busy || !audienceId || dirty} onClick={() => void run("import", importAudience)}>{busy === "import" ? <Loader2 className="animate-spin" size={14} /> : <ArrowDownToLine size={14} />} Import segment</button>
            </section>
            <section className="overflow-hidden rounded-lg border border-border bg-card"><h2 className="border-b border-border px-5 py-4 text-sm font-semibold">Campaigns</h2>{loading ? <div className="p-5"><Loader2 className="animate-spin" size={18} /></div> : !campaigns.length ? <p className="p-5 text-xs leading-5 text-muted-foreground">Your imported segments will appear here.</p> : campaigns.map((campaign) => <button key={campaign.id} disabled={!!busy || dirty} className={`flex w-full items-center gap-3 border-b border-border px-5 py-4 text-left transition last:border-0 hover:bg-muted disabled:opacity-50 ${selectedId === campaign.id ? "bg-muted" : ""}`} onClick={() => select(campaign)}><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{campaign.name}</p><p className="mt-1 text-xs capitalize text-muted-foreground">{campaign.status} · {campaign.recipients.length} contacts</p></div><ChevronRight size={14} /></button>)}</section>
            <SetupGuide readiness={readiness} />
          </aside>
          {!selected || !fields ? <section className="flex min-h-[540px] flex-col items-center justify-center rounded-lg border border-dashed border-border px-8 text-center"><Workflow className="mb-5 text-muted-foreground" size={38} /><h2 className="text-xl font-medium">Build your first calling campaign</h2><p className="mt-3 max-w-sm text-sm leading-6 text-muted-foreground">Connect Monaco and import a segment to get started. Your script, voice, contacts, and call progress will live here.</p><p className="mt-6 text-xs text-muted-foreground">1. Import segment &nbsp; → &nbsp; 2. Save script &nbsp; → &nbsp; 3. Launch</p></section> : <section className="min-w-0 overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-5"><div className="min-w-0 flex-1"><p className="mb-1 text-xs capitalize text-muted-foreground">{selected.status} campaign{dirty ? " · Unsaved changes" : ""}</p><h2 className="truncate text-xl font-semibold">{selected.name}</h2><p className="mt-2 text-xs text-muted-foreground">{pending} ready · {selected.recipients.filter((r) => r.status === "excluded").length} excluded · One call at a time</p></div>
              {selected.status === "running" ? <button className={button} disabled={!!busy} onClick={() => void run("pause", () => command("pause"))}><Pause size={14} /> Pause calling</button> : <button className={`${button} bg-foreground text-background hover:bg-foreground/90`} disabled={!!busy || !readiness.calling || dirty || !pending} onClick={() => void run("launch", () => command("launch"))}>{busy === "launch" ? <Loader2 size={14} className="animate-spin" /> : <Phone size={14} />}{selected.status === "paused" ? "Resume calling" : `Launch ${pending} calls`}</button>}
            </div>
            {selected.error && <p role="alert" className="border-b border-border bg-muted px-5 py-3 text-sm">{selected.error}</p>}
            {!readiness.calling && <p className="border-b border-border px-5 py-3 text-xs text-muted-foreground">Finish connection setup to enable calling. You can still prepare and save your campaign.</p>}
            <div className="flex gap-5 border-b border-border px-5">{(["script", "contacts"] as const).map((item) => <button key={item} className={`border-b-2 py-3 text-sm capitalize ${tab === item ? "border-foreground font-medium" : "border-transparent text-muted-foreground"}`} onClick={() => setTab(item)}>{item === "script" ? "Script & voice" : "Contacts & call activity"}</button>)}</div>
            {tab === "script" ? <div className="space-y-5 p-5 md:p-6">
              <label className="block text-xs font-medium">Campaign name<input className={`${control} mt-2`} maxLength={200} disabled={!!locked} value={fields.name} onChange={(e) => setFields({ ...fields, name: e.target.value })} /></label>
              <div className="grid gap-4 sm:grid-cols-[160px_1fr]"><label className="text-xs font-medium">Language<select className={`${control} mt-2`} disabled={!!locked} value={fields.language} onChange={(e) => setFields({ ...fields, language: e.target.value as Fields["language"] })}><option>English</option><option>Hindi</option><option>Hinglish</option></select></label><label className="text-xs font-medium">Cartesia voice ID<input className={`${control} mt-2 font-mono text-xs`} disabled={!!locked} value={fields.voiceId} onChange={(e) => setFields({ ...fields, voiceId: e.target.value })} /><span className="mt-1 block text-[11px] font-normal text-muted-foreground">Copy a voice ID from your Cartesia voice library.</span></label></div>
              <label className="block text-xs font-medium">Opening line<textarea className={`${control} mt-2 min-h-24 resize-y leading-6`} maxLength={1200} disabled={!!locked} value={fields.opening} onChange={(e) => setFields({ ...fields, opening: e.target.value })} /><span className="mt-2 block text-[11px] font-normal text-muted-foreground">Personalize with {"{{first_name}}"}, {"{{company}}"}, {"{{full_name}}"}, or {"{{title}}"}.</span></label>
              <button className={button} disabled={!!busy || readiness.missing.includes("CARTESIA_API_KEY")} onClick={() => void run("preview", preview)}>{busy === "preview" ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Listen to opening</button>
              <label className="block text-xs font-medium">Conversation script<textarea className={`${control} mt-2 min-h-72 resize-y leading-6`} maxLength={15000} disabled={!!locked} value={fields.script} onChange={(e) => setFields({ ...fields, script: e.target.value })} /><span className="mt-2 block text-[11px] font-normal leading-5 text-muted-foreground">Describe your pitch, qualification questions, objection handling, and desired next step. The agent follows this script and responds to the prospect.</span></label>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5"><p className="text-xs text-muted-foreground">{locked ? "Pause and wait for the active call to finish before editing." : dirty ? "Save your changes before switching campaigns or launching." : "Saved script is ready for your review."}</p><button className={button} disabled={!!busy || !!locked || !dirty} onClick={() => void run("save", () => command("save"))}>{busy === "save" ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save changes</button></div>
            </div> : <div className="p-5"><div className="relative mb-4"><Search size={14} className="absolute left-3 top-3 text-muted-foreground" /><input aria-label="Search contacts" className={`${control} pl-9`} placeholder="Search name, company, or phone" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} /></div><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b border-border text-xs text-muted-foreground"><tr><th className="pb-3 font-normal">Contact</th><th className="pb-3 font-normal">Phone</th><th className="pb-3 font-normal">Status</th><th className="pb-3 font-normal">Call</th></tr></thead><tbody>{filtered.slice(page * 50, (page + 1) * 50).map((r) => <tr key={r.id} className="border-b border-border/60"><td className="max-w-56 py-3 pr-3"><p className="truncate font-medium">{[r.firstName, r.lastName].filter(Boolean).join(" ") || "Unnamed contact"}</p><p className="mt-1 truncate text-xs text-muted-foreground">{r.company || r.title || "—"}</p></td><td className="whitespace-nowrap pr-3 font-mono text-xs">{r.phone || "—"}</td><td className="py-3 pr-3"><span className="rounded border border-border px-2 py-1 text-[11px] capitalize">{r.status.replaceAll("_", " ")}</span>{r.detail && <p className="mt-2 max-w-52 text-[11px] text-muted-foreground">{r.detail}</p>}</td><td><button className="text-xs underline disabled:opacity-30" disabled={!r.transcript?.length && !r.providerSid} onClick={() => setTranscriptId(r.id)}>Details</button></td></tr>)}</tbody></table>{!filtered.length && <p className="py-8 text-center text-sm text-muted-foreground">No contacts match.</p>}</div><div className="mt-4 flex items-center justify-between text-xs text-muted-foreground"><span>{filtered.length} contacts · Page {page + 1}</span><div className="flex gap-2"><button className={button} disabled={!page} onClick={() => setPage(page - 1)}>Previous</button><button className={button} disabled={(page + 1) * 50 >= filtered.length} onClick={() => setPage(page + 1)}>Next</button></div></div>{transcript && <CallDetails recipient={transcript} onClose={() => setTranscriptId("")} />}</div>}
          </section>}
        </div>
      </main>
    </div>
  );
}

function CallDetails({ recipient, onClose }: { recipient: BdrRecipient; onClose: () => void }) {
  return <div className="mt-6 rounded-md border border-border p-4"><div className="mb-4 flex items-center justify-between"><h3 className="text-sm font-medium">Conversation with {recipient.firstName || "contact"}</h3><button className="text-xs underline" onClick={onClose}>Close</button></div>{recipient.providerSid && <p className="mb-4 break-all font-mono text-[11px] text-muted-foreground">Twilio call: {recipient.providerSid}</p>}{recipient.transcript?.map((turn, i) => <div key={i} className={`mb-3 rounded-md p-3 text-sm ${turn.role === "assistant" ? "bg-muted" : "border border-border"}`}><p className="mb-1 text-[11px] font-medium text-muted-foreground">{turn.role === "assistant" ? "AI agent" : "Prospect"}</p>{turn.text}</div>)}{!recipient.transcript?.length && <p className="text-xs text-muted-foreground">No transcript yet. Call completion does not by itself indicate qualification.</p>}</div>;
}

function SetupGuide({ readiness }: { readiness: Readiness }) {
  return <details className="rounded-lg border border-border bg-card p-5" open={!readiness.calling}><summary className="cursor-pointer text-sm font-semibold">Connection setup</summary><p className="mt-3 text-xs leading-5 text-muted-foreground">Railway → actioneer-web → Variables. Add the following server variables, then deploy the changes.</p><div className="mt-3 space-y-3 text-xs">{[
    ["MONACO_API_KEY", "Monaco API key for the Actioneer workspace"], ["TWILIO_ACCOUNT_SID", "Twilio Console → Account Info"], ["TWILIO_AUTH_TOKEN", "Twilio Console → Account Info"], ["TWILIO_PHONE_NUMBER", "Your voice-enabled Twilio number, including +country code"], ["CARTESIA_API_KEY", "Cartesia dashboard → API keys"], ["OPENAI_API_KEY", "OpenAI Platform → API keys"], ["BDR_OPERATOR_EMAILS", "Comma-separated email addresses allowed to use this workspace"],
  ].map(([key, hint]) => <div key={key}><code className="break-all text-[11px]">{key}</code><p className="mt-1 text-[11px] leading-4 text-muted-foreground">{hint}</p></div>)}</div><p className="mt-4 text-[11px] leading-5 text-muted-foreground">Keep the existing Clerk keys, public URL, and persistent volume. Twilio webhooks are configured automatically when a call starts. Imports stay as drafts.</p><a className="mt-3 inline-flex items-center gap-1 text-xs underline" href="https://railway.com/project/aac8afc2-a9da-4ed0-8e8e-22da08c9fc85" target="_blank" rel="noreferrer">Open Railway <ArrowUpRight size={12} /></a></details>;
}
