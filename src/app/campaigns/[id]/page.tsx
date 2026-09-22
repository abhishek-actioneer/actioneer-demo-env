"use client";

import { use, useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  ExternalLink,
  FileText,
  Loader2,
  PhoneCall,
  Play,
  RefreshCw,
  Upload,
  Users,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import {
  FUNDSINDIA_LIFECYCLE_DATASET_ID,
  PILOT_MODE_LABEL,
  type AudiencePreview,
  type CampaignResults,
  type CampaignRunSummary,
  type DecisionValue,
  type EnrollmentSummary,
} from "@/lib/lifecycle-campaign-types";
import type { CampaignDetail, LegacyCampaignDetail, LifecycleCampaignDetail } from "@/app/api/campaigns/[id]/route";

const INPUT_CLASS = "h-9 w-full rounded border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-foreground/20";
const TEXTAREA_CLASS = "w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-foreground/20";

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function compactMetric(value: number): string {
  return value.toLocaleString();
}

function decisionLabel(decision: DecisionValue): string {
  if (decision === "ship") return "Ship";
  if (decision === "kill") return "Kill";
  return "Iterate";
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString();
}

function voiceCallEvidenceHref(task: CampaignRunSummary["tasks"][number]): string | null {
  if (!task.voiceCampaignId || !task.voiceCallId) return null;
  const params = new URLSearchParams({
    campaignId: task.voiceCampaignId,
    datasetId: FUNDSINDIA_LIFECYCLE_DATASET_ID,
    tab: "call-logs",
    callId: task.voiceCallId,
  });
  return `/voice-campaigns/new?${params.toString()}`;
}

export default function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<CampaignDetail | null>(null);
  const [preview, setPreview] = useState<AudiencePreview | null>(null);
  const [enrollment, setEnrollment] = useState<EnrollmentSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    apiFetch<CampaignDetail>(`/api/campaigns/${id}`, {
      skipModel: true,
      datasetId: FUNDSINDIA_LIFECYCLE_DATASET_ID,
    })
      .then((res) => {
        setData(res);
        setError(null);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function runAction<T>(name: string, fn: () => Promise<T>, after?: (result: T) => void) {
    setAction(name);
    setError(null);
    try {
      const result = await fn();
      after?.(result);
      load(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAction(null);
    }
  }

  if (loading) {
    return (
      <Shell>
        <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading campaign...
        </div>
      </Shell>
    );
  }

  if (error && !data) {
    return (
      <Shell>
        <ErrorBanner message={error} />
      </Shell>
    );
  }

  if (!data) {
    return (
      <Shell>
        <ErrorBanner message="Campaign not found." />
      </Shell>
    );
  }

  if (data.kind === "legacy") {
    return <LegacyDetail data={data} />;
  }

  const detail = data;
  const run = detail.run;
  const results = detail.results;
  const sourceSegmentId = detail.bundle.campaign.segmentId.startsWith("profile:")
    ? null
    : detail.bundle.campaign.segmentId;

  return (
    <Shell>
      <Link href="/campaigns" className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" />
        Campaigns
      </Link>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
            <PhoneCall className="size-3.5" />
            {detail.segmentName} · {detail.offerName ?? detail.bundle.campaign.offerId}
          </div>
          <h1 className="break-words text-2xl font-medium text-foreground">{detail.bundle.campaign.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{PILOT_MODE_LABEL}</p>
        </div>
        <button
          onClick={() => load(true)}
          className="inline-flex items-center gap-2 rounded border border-border px-3 py-2 text-sm text-foreground hover:bg-muted"
        >
          <RefreshCw className="size-4" />
          Refresh
        </button>
      </div>

      {sourceSegmentId && (
        <div className="mb-5 rounded border border-border bg-muted/20 px-4 py-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <div className="text-xs text-muted-foreground">Created from segment</div>
              <div className="mt-0.5 truncate text-sm font-medium text-foreground">
                {detail.segmentName ?? sourceSegmentId}
              </div>
            </div>
            <Link
              href={`/segments/${encodeURIComponent(sourceSegmentId)}`}
              className="inline-flex shrink-0 items-center rounded border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-muted"
            >
              View Segment
            </Link>
          </div>
        </div>
      )}

      {error && <ErrorBanner message={error} />}

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Tile label="Status" value={detail.bundle.campaign.status} />
        <Tile label="Enrolled" value={compactMetric(run.enrollmentCount)} />
        <Tile label="Control" value={compactMetric(run.controlCount)} />
        <Tile label="Treatment" value={compactMetric(run.treatmentCount)} />
        <Tile label="OEC rate" value={results ? pct(results.totals.assigned ? results.totals.converted / results.totals.assigned : 0) : "-"} />
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <ActionButton loading={action === "preview"} icon={Users} onClick={() => runAction(
          "preview",
          () => apiFetch<AudiencePreview>(`/api/campaigns/${id}/audience/preview`, {
            skipModel: true,
            datasetId: FUNDSINDIA_LIFECYCLE_DATASET_ID,
          }),
          setPreview,
        )}>
          Preview Audience
        </ActionButton>
        <ActionButton loading={action === "enroll"} icon={FileText} onClick={() => runAction(
          "enroll",
          () => apiFetch<EnrollmentSummary>(`/api/campaigns/${id}/enroll`, {
            method: "POST",
            skipModel: true,
            datasetId: FUNDSINDIA_LIFECYCLE_DATASET_ID,
          }),
          setEnrollment,
        )}>
          Enroll / Assign
        </ActionButton>
        <ActionButton loading={action === "launch"} icon={Play} onClick={() => runAction(
          "launch",
          () => apiFetch<CampaignRunSummary>(`/api/campaigns/${id}/launch`, {
            method: "POST",
            skipModel: true,
            datasetId: FUNDSINDIA_LIFECYCLE_DATASET_ID,
          }),
        )}>
          Launch Queued Calls
        </ActionButton>
        <ActionButton loading={action === "analyze"} icon={BarChart3} onClick={() => runAction(
          "analyze",
          () => apiFetch(`/api/campaigns/${id}/analyze-transcripts`, {
            method: "POST",
            skipModel: true,
            datasetId: FUNDSINDIA_LIFECYCLE_DATASET_ID,
          }),
        )}>
          Analyze Transcripts
        </ActionButton>
      </div>

      <ContactImport campaignId={id} onImported={() => {
        setPreview(null);
        load(true);
      }} />

      {preview && <AudienceSection preview={preview} />}
      {enrollment && <EnrollmentSection enrollment={enrollment} />}
      <ExperimentSection data={detail} />
      <RunSection run={run} />
      <ResultsSection results={results} />
      <DecisionSection campaignId={id} results={results} onSaved={() => load(true)} />
    </Shell>
  );
}

function ContactImport({ campaignId, onImported }: { campaignId: string; onImported: () => void }) {
  const [csvText, setCsvText] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!csvText.trim()) return;
    setLoading(true);
    setMessage(null);
    try {
      const res = await apiFetch<{ imported: number; noConsentRows: number; invalidRows: number }>(`/api/campaigns/${campaignId}/contacts/import`, {
        method: "POST",
        skipModel: true,
        datasetId: FUNDSINDIA_LIFECYCLE_DATASET_ID,
        body: { csvText },
      });
      setMessage(`${res.imported.toLocaleString()} contacts imported · ${res.noConsentRows.toLocaleString()} without consent · ${res.invalidRows.toLocaleString()} invalid`);
      setCsvText("");
      onImported();
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Section title="Contact mapping">
      <form onSubmit={submit} className="grid gap-3 md:grid-cols-[1fr_auto]">
        <textarea
          value={csvText}
          onChange={(event) => setCsvText(event.target.value)}
          className={`${TEXTAREA_CLASS} min-h-24 font-mono text-xs`}
          placeholder={"investor_id,phone_number,consent,name,preferred_language\nINV_000001,+919876543210,true,Asha,English"}
        />
        <button disabled={loading || !csvText.trim()} className="inline-flex h-9 items-center justify-center gap-2 rounded border border-border px-3 text-sm text-foreground hover:bg-muted disabled:opacity-50">
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          Import
        </button>
      </form>
      {message && <div className="mt-2 text-xs text-muted-foreground">{message}</div>}
    </Section>
  );
}

function AudienceSection({ preview }: { preview: AudiencePreview }) {
  return (
    <Section title="Audience preview">
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Tile label="Eligible" value={compactMetric(preview.eligibleCount)} />
        <Tile label="Contactable" value={compactMetric(preview.contactableCount)} />
        <Tile label="Missing phone" value={compactMetric(preview.missingPhoneCount)} />
        <Tile label="No consent" value={compactMetric(preview.noConsentCount)} />
        <Tile label="Already enrolled" value={compactMetric(preview.alreadyEnrolledCount)} />
      </div>
      {preview.warnings.length > 0 && (
        <div className="mb-3 space-y-1 text-xs text-muted-foreground">
          {preview.warnings.map((warning) => <div key={warning}>{warning}</div>)}
        </div>
      )}
      <div className="overflow-hidden rounded border border-border">
        <div className="grid grid-cols-[1fr_0.8fr_0.8fr_0.8fr_0.8fr] gap-3 border-b border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          <div>Investor</div>
          <div>Intent</div>
          <div>Fund</div>
          <div>Contact</div>
          <div>Status</div>
        </div>
        {preview.sample.slice(0, 12).map((row, index) => (
          <div key={row.investorId} className={`grid grid-cols-[1fr_0.8fr_0.8fr_0.8fr_0.8fr] gap-3 px-3 py-2 text-xs ${index > 0 ? "border-t border-border" : ""}`}>
            <div className="min-w-0">
              <div className="truncate text-foreground">{row.name || row.investorId}</div>
              <div className="truncate text-muted-foreground">{row.investorId}</div>
            </div>
            <div className="truncate text-muted-foreground">{row.lastIntentEvent ?? "-"} · {row.intentEvents}</div>
            <div className="truncate text-muted-foreground">{row.targetFundName ?? "-"}</div>
            <div className="truncate text-muted-foreground">{row.phoneNumber ?? "-"}</div>
            <div className="truncate text-foreground">{row.contactStatus.replace(/_/g, " ")}</div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function EnrollmentSection({ enrollment }: { enrollment: EnrollmentSummary }) {
  return (
    <Section title="Enrollment summary">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Tile label="Created" value={compactMetric(enrollment.enrolledCreated)} />
        <Tile label="Existing" value={compactMetric(enrollment.enrolledExisting)} />
        <Tile label="Control" value={compactMetric(enrollment.controlCount)} />
        <Tile label="Treatment" value={compactMetric(enrollment.treatmentCount)} />
        <Tile label="Tasks created" value={compactMetric(enrollment.taskCreated)} />
        <Tile label="Excluded" value={compactMetric(enrollment.excludedMissingPhone + enrollment.excludedNoConsent)} />
      </div>
    </Section>
  );
}

function ExperimentSection({ data }: { data: LifecycleCampaignDetail }) {
  return (
    <Section title="Experiment design">
      <div className="mb-4 grid gap-3 md:grid-cols-[1fr_220px_180px]">
        <div>
          <div className="text-xs text-muted-foreground">Hypothesis</div>
          <div className="mt-1 text-sm text-foreground">{data.bundle.experiment.hypothesis}</div>
        </div>
        <Tile label="OEC" value={data.bundle.experiment.oecMetric.replace(/_/g, " ")} />
        <Tile label="Randomization" value={data.bundle.experiment.randomizationUnit} />
      </div>
      <div className="overflow-hidden rounded border border-border">
        {data.bundle.arms.map((arm, index) => (
          <div key={arm.id} className={`grid grid-cols-[1fr_120px_120px_1fr] gap-3 px-3 py-2 text-sm ${index > 0 ? "border-t border-border" : ""}`}>
            <div className="text-foreground">{arm.name}</div>
            <div className="capitalize text-muted-foreground">{arm.type}</div>
            <div className="text-muted-foreground tabular-nums">{arm.allocationPct}%</div>
            <div className="truncate text-muted-foreground">{arm.metadata?.scriptSummary ?? arm.scriptVariantId ?? "-"}</div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function RunSection({ run }: { run: CampaignRunSummary }) {
  const statusRows = Object.entries(run.tasksByStatus).filter(([, count]) => count > 0);
  return (
    <Section title="Run monitor">
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">
        {statusRows.length === 0 ? <Tile label="Queued" value="0" /> : statusRows.map(([status, count]) => (
          <Tile key={status} label={status.replace(/_/g, " ")} value={compactMetric(count)} />
        ))}
      </div>
      <div className="overflow-hidden rounded border border-border">
        <div className="grid grid-cols-[1fr_0.7fr_0.8fr_0.8fr_1fr] gap-3 border-b border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          <div>Investor</div>
          <div>Status</div>
          <div>Arm</div>
          <div>Provider</div>
          <div>Evidence</div>
        </div>
        {run.tasks.slice(0, 12).map((task, index) => {
          const href = voiceCallEvidenceHref(task);
          return (
            <div key={task.id} className={`grid grid-cols-[1fr_0.7fr_0.8fr_0.8fr_1fr] gap-3 px-3 py-2 text-xs ${index > 0 ? "border-t border-border" : ""}`}>
              <div className="truncate text-foreground">{task.investorId}</div>
              <div className="truncate text-foreground">{task.status.replace(/_/g, " ")}</div>
              <div className="truncate text-muted-foreground">{task.armId.split("_").slice(-2).join(" ")}</div>
              <div className="truncate text-muted-foreground">{task.provider}</div>
              <div className="truncate">
                {href ? (
                  <Link href={href} className="inline-flex items-center gap-1 text-foreground hover:underline">
                    Open call logs
                    <ExternalLink className="size-3 text-muted-foreground" />
                  </Link>
                ) : (
                  <span className="text-muted-foreground">No call yet</span>
                )}
              </div>
            </div>
          );
        })}
        {run.tasks.length === 0 && <div className="px-3 py-8 text-center text-sm text-muted-foreground">No treatment tasks yet.</div>}
      </div>
    </Section>
  );
}

function ResultsSection({ results }: { results: CampaignResults }) {
  return (
    <Section title="Results scorecard">
      <div className="mb-3 text-xs text-muted-foreground">{results.pilotModeLabel}</div>
      <div className="overflow-hidden rounded border border-border">
        <div className="grid grid-cols-[1fr_repeat(8,90px)] gap-3 border-b border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          <div>Arm</div>
          <div className="text-right">Assigned</div>
          <div className="text-right">Attempted</div>
          <div className="text-right">Connected</div>
          <div className="text-right">Pitched</div>
          <div className="text-right">Accepted</div>
          <div className="text-right">Converted</div>
          <div className="text-right">OEC</div>
          <div className="text-right">Lift</div>
        </div>
        {results.arms.map((arm, index) => (
          <div key={arm.armId} className={`grid grid-cols-[1fr_repeat(8,90px)] gap-3 px-3 py-2 text-xs ${index > 0 ? "border-t border-border" : ""}`}>
            <div className="truncate text-foreground">{arm.armName}</div>
            <Metric>{arm.assigned}</Metric>
            <Metric>{arm.attempted}</Metric>
            <Metric>{arm.connected}</Metric>
            <Metric>{arm.pitched}</Metric>
            <Metric>{arm.accepted}</Metric>
            <Metric>{arm.converted}</Metric>
            <Metric>{pct(arm.conversionRate)}</Metric>
            <Metric>{arm.liftVsControlPctPoints === undefined ? "-" : `${arm.liftVsControlPctPoints.toFixed(1)}pp`}</Metric>
          </div>
        ))}
      </div>
    </Section>
  );
}

function DecisionSection({ campaignId, results, onSaved }: { campaignId: string; results: CampaignResults; onSaved: () => void }) {
  const savedDecision = results.latestDecision;
  const [decision, setDecision] = useState<DecisionValue>(savedDecision?.decision ?? "iterate");
  const [notes, setNotes] = useState(savedDecision?.notes ?? "");
  const [nextStep, setNextStep] = useState(savedDecision?.nextStep ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setDecision(savedDecision?.decision ?? "iterate");
    setNotes(savedDecision?.notes ?? "");
    setNextStep(savedDecision?.nextStep ?? "");
  }, [savedDecision?.decision, savedDecision?.nextStep, savedDecision?.notes]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await apiFetch(`/api/campaigns/${campaignId}/decision`, {
        method: "POST",
        skipModel: true,
        datasetId: FUNDSINDIA_LIFECYCLE_DATASET_ID,
        body: { decision, notes, nextStep },
      });
      setMessage("Decision saved.");
      onSaved();
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="Decision record">
      <div className="mb-4 rounded border border-border bg-muted/20 px-3 py-2 text-xs">
        {savedDecision ? (
          <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
            <div className="font-medium text-foreground">
              Latest decision: {decisionLabel(savedDecision.decision)}
            </div>
            <div className="text-muted-foreground">Updated {formatTimestamp(savedDecision.updatedAt)}</div>
          </div>
        ) : (
          <div className="text-muted-foreground">No decision recorded yet.</div>
        )}
        {savedDecision?.nextStep && (
          <div className="mt-1 text-muted-foreground">Next: {savedDecision.nextStep}</div>
        )}
      </div>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 md:grid-cols-[220px_1fr]">
          <label>
            <span className="mb-1.5 block text-xs text-muted-foreground">Decision</span>
            <select value={decision} onChange={(event) => setDecision(event.target.value as DecisionValue)} className={INPUT_CLASS}>
              <option value="iterate">Iterate</option>
              <option value="ship">Ship</option>
              <option value="kill">Kill</option>
            </select>
          </label>
          <label>
            <span className="mb-1.5 block text-xs text-muted-foreground">Next step</span>
            <input value={nextStep} onChange={(event) => setNextStep(event.target.value)} className={INPUT_CLASS} />
          </label>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-xs text-muted-foreground">Learning</span>
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} className={`${TEXTAREA_CLASS} min-h-24`} required />
        </label>
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">{message}</div>
          <button disabled={saving || !notes.trim()} className="inline-flex items-center gap-2 rounded bg-foreground px-3 py-2 text-sm text-background disabled:opacity-50">
            {saving && <Loader2 className="size-4 animate-spin" />}
            Save Decision
          </button>
        </div>
      </form>
    </Section>
  );
}

function LegacyDetail({ data }: { data: LegacyCampaignDetail }) {
  const sent = data.localStats?.sent ?? data.stats?.sent ?? 0;
  const clicked = data.localStats?.uniqueClicks ?? data.stats?.clicked ?? 0;
  return (
    <Shell>
      <Link href="/campaigns" className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" />
        Campaigns
      </Link>
      <div className="mb-6">
        <div className="mb-1 text-xs text-muted-foreground">Legacy send · {data.channel ?? "campaign"}</div>
        <h1 className="text-2xl font-medium text-foreground">{data.subject || "Untitled send"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{data.segmentName ?? data.segmentId}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Audience" value={(data.userCount ?? 0).toLocaleString()} />
        <Tile label="Sent" value={sent.toLocaleString()} />
        <Tile label="Clicked" value={clicked.toLocaleString()} />
        <Tile label="Status" value={data.status} />
      </div>
    </Shell>
  );
}

function ActionButton({
  children,
  icon: Icon,
  loading,
  onClick,
}: {
  children: ReactNode;
  icon: typeof Users;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="inline-flex items-center gap-2 rounded border border-border px-3 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-50"
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4" />}
      {children}
    </button>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-w-0 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl px-6 py-8">{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5 rounded border border-border bg-background p-4">
      <h2 className="mb-4 text-sm font-medium text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border bg-background px-3 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-lg font-medium tabular-nums text-foreground">{value}</div>
    </div>
  );
}

function Metric({ children }: { children: ReactNode }) {
  return <div className="text-right tabular-nums text-foreground">{children}</div>;
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="mb-4 inline-flex items-center gap-2 rounded bg-muted px-3 py-2 text-sm text-foreground">
      <AlertTriangle className="size-4" />
      {message}
    </div>
  );
}
