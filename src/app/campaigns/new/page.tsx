"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Check, ChevronRight, Loader2, Upload, Wand2 } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { FUNDSINDIA_LIFECYCLE_DATASET_ID, PROFILE_ONLY_SEGMENT_ID } from "@/lib/lifecycle-campaign-types";
import type { Offer } from "@/lib/offer-types";
import type { Segment } from "@/lib/types";

const SCRIPT_A = `You are a FundsIndia service caller helping investors who showed fund or SIP intent but did not complete KYC/account activation.

Lead with account activation help. Ask permission, diagnose the blocker, and offer a FundsIndia advisor callback if the investor is receptive.

Do not promise returns, recommend a fund, mention experiment assignment, or reveal internal segmentation. Stop politely on opt-out, complaint, or wrong number.`;

const SCRIPT_B = `You are a FundsIndia service caller helping investors who started exploring SIPs or funds but could not complete the next step.

Lead with the recent SIP/fund exploration context. Offer a short activation support call so they can continue only if they are interested.

Do not give investment advice, promise returns, or pressure the investor. Stop politely on opt-out, complaint, or wrong number.`;

const INPUT_CLASS = "h-10 w-full rounded border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-foreground/20";
const TEXTAREA_CLASS = "w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-foreground/20";
const DEFAULT_CAMPAIGN_NAME = "FundsIndia KYC activation recovery";
const DEFAULT_HYPOTHESIS = "Investors who recently browsed funds or started SIP flow but have not activated their account will complete activation at a higher rate after a concise service-led voice call.";
const DEFAULT_SCRIPT_A_FIRST_MESSAGE = "Hi, this is Aanya calling from FundsIndia. Am I speaking with you for a quick account activation help call?";
const DEFAULT_SCRIPT_B_FIRST_MESSAGE = "Hi, this is Aanya from FundsIndia. I noticed you had started exploring mutual funds; may I help with the next activation step?";
const DEFAULT_SCRIPT_A_SUMMARY = "KYC unblock help with a calm service-led pitch.";
const DEFAULT_SCRIPT_B_SUMMARY = "SIP intent recovery with a short advisory follow-up offer.";

type OecMetric = "account_activated" | "kyc_completed" | "bank_verified";
type WizardStepId =
  | "audience"
  | "experiment-type"
  | "hypothesis"
  | "metric"
  | "split"
  | "scripts"
  | "script-a"
  | "script-b"
  | "contacts"
  | "review";
type ExperimentType = "message_framing" | "offer" | "timing" | "audience";

const OEC_OPTIONS: Array<{
  id: OecMetric;
  label: string;
  description: string;
}> = [
  {
    id: "account_activated",
    label: "Account activated",
    description: "Primary success event after the call.",
  },
  {
    id: "kyc_completed",
    label: "KYC completed",
    description: "Useful when activation is too far downstream.",
  },
  {
    id: "bank_verified",
    label: "Bank verified",
    description: "Measures readiness to transact.",
  },
];

const GUARDRAIL_METRICS = [
  "Wrong number",
  "Complaint",
  "Conduct flag",
  "Opt out",
];

const EXPERIMENT_TYPES: Array<{
  id: ExperimentType;
  title: string;
  description: string;
  enabled: boolean;
}> = [
  {
    id: "message_framing",
    title: "Message framing",
    description: "Same audience and offer. Test two call angles or narratives.",
    enabled: true,
  },
  {
    id: "offer",
    title: "Offer",
    description: "Same audience. Test different offers or CTAs.",
    enabled: false,
  },
  {
    id: "timing",
    title: "Timing",
    description: "Same message. Test when the call is triggered.",
    enabled: false,
  },
  {
    id: "audience",
    title: "Audience rules",
    description: "Test stricter vs broader qualification.",
    enabled: false,
  },
];

interface GeneratedScriptVariant {
  title: string;
  strategy: string;
  firstMessage: string;
  scriptSummary: string;
  systemPrompt: string;
}

interface GeneratedScriptVariantsResponse {
  variantLogic: string;
  scriptA: GeneratedScriptVariant;
  scriptB: GeneratedScriptVariant;
}

const WIZARD_STEPS: Array<{
  id: WizardStepId;
  title: string;
  description: string;
}> = [
  { id: "audience", title: "Audience", description: "Name the campaign and confirm the segment, date, and offer." },
  { id: "experiment-type", title: "Experiment type", description: "Choose what you want to test." },
  { id: "hypothesis", title: "Hypothesis", description: "State the expected behavior change." },
  { id: "metric", title: "Success metric", description: "Choose the primary outcome." },
  { id: "split", title: "Groups", description: "Set the control and treatment split." },
  { id: "scripts", title: "AI scripts", description: "Generate the two treatment scripts." },
  { id: "script-a", title: "Script A", description: "Review the first treatment script." },
  { id: "script-b", title: "Script B", description: "Review the second treatment script." },
  { id: "contacts", title: "Contacts", description: "Attach phone and consent data if it is not already mapped." },
  { id: "review", title: "Review", description: "Check the launch package before creating the campaign." },
];

function normalizePct(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function getOecLabel(metric: OecMetric): string {
  return OEC_OPTIONS.find((option) => option.id === metric)?.label ?? metric.replace(/_/g, " ");
}

export default function NewCampaignPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedSegmentId = searchParams.get("segmentId")?.trim() ?? "";
  const prefillAppliedRef = useRef(false);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState<WizardStepId>("audience");
  const [audienceEditing, setAudienceEditing] = useState(false);
  const [name, setName] = useState(DEFAULT_CAMPAIGN_NAME);
  const [segmentId, setSegmentId] = useState(PROFILE_ONLY_SEGMENT_ID);
  const [offerId, setOfferId] = useState("FI_SIP_STARTER");
  const [asOfDate, setAsOfDate] = useState("2026-05-28");
  const [experimentType, setExperimentType] = useState<ExperimentType>("message_framing");
  const [hypothesis, setHypothesis] = useState(DEFAULT_HYPOTHESIS);
  const [oecMetric, setOecMetric] = useState<OecMetric>("account_activated");
  const [controlPct, setControlPct] = useState(20);
  const [scriptAPct, setScriptAPct] = useState(40);
  const [scriptBPct, setScriptBPct] = useState(40);
  const [scriptA, setScriptA] = useState(SCRIPT_A);
  const [scriptB, setScriptB] = useState(SCRIPT_B);
  const [scriptAFirstMessage, setScriptAFirstMessage] = useState(DEFAULT_SCRIPT_A_FIRST_MESSAGE);
  const [scriptBFirstMessage, setScriptBFirstMessage] = useState(DEFAULT_SCRIPT_B_FIRST_MESSAGE);
  const [scriptASummary, setScriptASummary] = useState(DEFAULT_SCRIPT_A_SUMMARY);
  const [scriptBSummary, setScriptBSummary] = useState(DEFAULT_SCRIPT_B_SUMMARY);
  const [scriptATitle, setScriptATitle] = useState("Activation unblock");
  const [scriptBTitle, setScriptBTitle] = useState("Intent recovery");
  const [scriptVariantLogic, setScriptVariantLogic] = useState("A tests service-led activation help. B tests recent SIP/fund intent recovery.");
  const [generatingScripts, setGeneratingScripts] = useState(false);
  const [csvText, setCsvText] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoadingOptions(true);
    Promise.all([
      apiFetch<Segment[]>("/api/segments", { skipModel: true, datasetId: FUNDSINDIA_LIFECYCLE_DATASET_ID }),
      apiFetch<{ offers: Offer[] }>("/api/offers", { skipModel: true, datasetId: FUNDSINDIA_LIFECYCLE_DATASET_ID }),
    ])
      .then(([segmentsRes, offersRes]) => {
        if (cancelled) return;
        setSegments(segmentsRes);
        setOffers(offersRes.offers);
        const requestedSegment = requestedSegmentId
          ? segmentsRes.find((segment) => segment.id === requestedSegmentId)
          : undefined;
        if (requestedSegment && !prefillAppliedRef.current) {
          prefillAppliedRef.current = true;
          setSegmentId(requestedSegment.id);
          setName((current) => current === DEFAULT_CAMPAIGN_NAME ? `${requestedSegment.name} lifecycle experiment` : current);
          setHypothesis((current) => current === DEFAULT_HYPOTHESIS
            ? `${requestedSegment.name} will show a measurable lift in account activation after a concise service-led voice experiment.`
            : current
          );
          setAudienceEditing(false);
          setActiveStep("experiment-type");
        }
        if (!offersRes.offers.some((offer) => offer.offerId === offerId)) {
          setOfferId(offersRes.offers[0]?.offerId ?? "FI_SIP_STARTER");
        }
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoadingOptions(false);
      });
    return () => {
      cancelled = true;
    };
  }, [offerId, requestedSegmentId]);

  const selectedOffer = useMemo(
    () => offers.find((offer) => offer.offerId === offerId),
    [offerId, offers],
  );
  const selectedSegment = useMemo(
    () => segments.find((segment) => segment.id === segmentId),
    [segmentId, segments],
  );
  const audienceLockedFromSegment = Boolean(
    requestedSegmentId &&
    selectedSegment?.id === requestedSegmentId &&
    !audienceEditing
  );
  const wizardSteps = useMemo(
    () => audienceLockedFromSegment
      ? WIZARD_STEPS.filter((step) => step.id !== "audience")
      : WIZARD_STEPS,
    [audienceLockedFromSegment],
  );
  const activeStepIndex = Math.max(0, wizardSteps.findIndex((step) => step.id === activeStep));
  const activeStepMeta = wizardSteps[activeStepIndex] ?? wizardSteps[0];
  const csvRows = csvText.trim()
    ? csvText.trim().split(/\r?\n/).filter(Boolean).length
    : 0;
  const splitTotal = controlPct + scriptAPct + scriptBPct;
  const splitValid = splitTotal === 100 && controlPct > 0 && scriptAPct > 0 && scriptBPct > 0;
  const campaignReady = Boolean(
    name.trim() &&
    segmentId &&
    offerId &&
    asOfDate &&
    hypothesis.trim() &&
    oecMetric &&
    experimentType === "message_framing" &&
    splitValid &&
    scriptA.trim() &&
    scriptB.trim() &&
    scriptAFirstMessage.trim() &&
    scriptBFirstMessage.trim()
  );
  const canContinue = useMemo(() => {
    if (activeStep === "audience") return Boolean(name.trim() && segmentId && offerId && asOfDate);
    if (activeStep === "experiment-type") return experimentType === "message_framing";
    if (activeStep === "hypothesis") return Boolean(hypothesis.trim());
    if (activeStep === "metric") return Boolean(oecMetric);
    if (activeStep === "split") return splitValid;
    if (activeStep === "scripts") return Boolean(scriptA.trim() && scriptB.trim());
    if (activeStep === "script-a") return Boolean(scriptATitle.trim() && scriptASummary.trim() && scriptAFirstMessage.trim() && scriptA.trim());
    if (activeStep === "script-b") return Boolean(scriptBTitle.trim() && scriptBSummary.trim() && scriptBFirstMessage.trim() && scriptB.trim());
    if (activeStep === "review") return campaignReady;
    return true;
  }, [activeStep, asOfDate, campaignReady, experimentType, hypothesis, name, oecMetric, offerId, scriptA, scriptAFirstMessage, scriptASummary, scriptATitle, scriptB, scriptBFirstMessage, scriptBSummary, scriptBTitle, segmentId, splitValid]);
  const showBuilderRail = !audienceLockedFromSegment || audienceEditing;

  useEffect(() => {
    if (audienceLockedFromSegment && activeStep === "audience") {
      setActiveStep("experiment-type");
    }
  }, [activeStep, audienceLockedFromSegment]);

  function goNext() {
    if (activeStep === "audience" && requestedSegmentId) {
      setAudienceEditing(false);
    }
    const next = wizardSteps[Math.min(activeStepIndex + 1, wizardSteps.length - 1)];
    setActiveStep(next.id);
  }

  function goBack() {
    const previous = wizardSteps[Math.max(activeStepIndex - 1, 0)];
    setActiveStep(previous.id);
  }

  async function handleGenerateScripts() {
    if (experimentType !== "message_framing") {
      setError("AI script generation currently supports message framing experiments.");
      return;
    }
    if (!segmentId || !offerId || !hypothesis.trim()) {
      setError("Choose an audience, offer, and hypothesis before generating scripts.");
      return;
    }

    setGeneratingScripts(true);
    setError(null);
    try {
      const result = await apiFetch<GeneratedScriptVariantsResponse>("/api/campaigns/script-variants", {
        method: "POST",
        datasetId: FUNDSINDIA_LIFECYCLE_DATASET_ID,
        body: {
          datasetId: FUNDSINDIA_LIFECYCLE_DATASET_ID,
          segmentId,
          offerId,
          campaignName: name,
          hypothesis,
          oecMetric,
          experimentType,
        },
      });
      setScriptATitle(result.scriptA.title);
      setScriptBTitle(result.scriptB.title);
      setScriptASummary(result.scriptA.strategy || result.scriptA.scriptSummary);
      setScriptBSummary(result.scriptB.strategy || result.scriptB.scriptSummary);
      setScriptAFirstMessage(result.scriptA.firstMessage);
      setScriptBFirstMessage(result.scriptB.firstMessage);
      setScriptA(result.scriptA.systemPrompt);
      setScriptB(result.scriptB.systemPrompt);
      setScriptVariantLogic(result.variantLogic);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGeneratingScripts(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (activeStep !== "review") {
      goNext();
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await apiFetch<{ id: string }>("/api/campaigns", {
        method: "POST",
        skipModel: true,
        datasetId: FUNDSINDIA_LIFECYCLE_DATASET_ID,
        body: {
          datasetId: FUNDSINDIA_LIFECYCLE_DATASET_ID,
          name,
          segmentId: segmentId === PROFILE_ONLY_SEGMENT_ID ? undefined : segmentId,
          offerId,
          asOfDate,
          attributionWindowDays: 21,
          hypothesis,
          oecMetric,
          guardrailMetrics: ["wrong_number", "complaint", "conduct_flag", "opted_out"],
          arms: [
            { type: "control", name: "Control", allocationPct: controlPct, scriptVariantId: "control" },
            {
              type: "treatment",
              name: "Script A",
              allocationPct: scriptAPct,
              scriptVariantId: "script_a",
              systemPrompt: scriptA,
              firstMessage: scriptAFirstMessage,
              scriptSummary: scriptASummary,
              voice: "Aoede",
              voiceName: "Aanya",
              language: "English",
            },
            {
              type: "treatment",
              name: "Script B",
              allocationPct: scriptBPct,
              scriptVariantId: "script_b",
              systemPrompt: scriptB,
              firstMessage: scriptBFirstMessage,
              scriptSummary: scriptBSummary,
              voice: "Aoede",
              voiceName: "Aanya",
              language: "English",
            },
          ],
        },
      });

      if (csvText.trim()) {
        await apiFetch(`/api/campaigns/${result.id}/contacts/import`, {
          method: "POST",
          skipModel: true,
          datasetId: FUNDSINDIA_LIFECYCLE_DATASET_ID,
          body: { csvText },
        });
      }

      router.push(`/campaigns/${result.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex min-w-0 items-start justify-center overflow-y-auto bg-background/70 px-4 py-5 backdrop-blur-md sm:px-6 sm:py-8">
      <div className={`flex w-full flex-col ${showBuilderRail ? "max-w-5xl" : "max-w-3xl"}`}>
        <Link href="/campaigns" className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" />
          Campaigns
        </Link>

        {error && (
          <div className="mb-4 flex items-center gap-2 rounded bg-muted px-3 py-2 text-sm text-foreground">
            <AlertTriangle className="size-4" />
            {error}
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          role="dialog"
          aria-modal="true"
          aria-label="New campaign"
          className="flex max-h-[calc(100dvh-5.5rem)] min-h-[560px] overflow-hidden rounded-lg border border-border bg-background shadow-[0_20px_70px_rgba(0,0,0,0.22)]"
        >
          <div className={showBuilderRail ? "grid min-h-0 flex-1 lg:grid-cols-[260px_minmax(0,1fr)]" : "flex min-h-0 flex-1 flex-col"}>
            {showBuilderRail && (
              <aside className="min-h-0 overflow-y-auto border-b border-border bg-muted/20 px-5 py-5 lg:border-b-0 lg:border-r">
                <div className="mb-5">
                  <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                    <Wand2 className="size-3.5" />
                    FundsIndia lifecycle pilot
                  </div>
                  <h1 id="campaign-builder-title" className="text-lg font-semibold text-foreground">New Campaign</h1>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    One decision at a time.
                  </p>
                </div>

                <div className="mb-5 rounded-md border border-border bg-background px-3 py-3">
                  <div className="text-[9.9px] font-medium uppercase tracking-wide text-muted-foreground">Campaign builder</div>
                  <div className="mt-1 truncate text-sm font-medium text-foreground">{name || "Untitled campaign"}</div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">{selectedOffer?.name ?? "No offer selected"}</div>
                </div>

                <div className="space-y-1">
                  {wizardSteps.map((step, index) => {
                    const active = step.id === activeStep;
                    const complete = index < activeStepIndex;
                    const reachable = index <= activeStepIndex;
                    return (
                      <button
                        key={step.id}
                        type="button"
                        disabled={!reachable || submitting}
                        onClick={() => setActiveStep(step.id)}
                        aria-current={active ? "step" : undefined}
                        className={`w-full rounded-md px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                          active ? "bg-background shadow-[0_0_0_1px_var(--color-border)]" : "hover:bg-background/70"
                        }`}
                      >
                        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                          <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-border text-[9.9px] tabular-nums">
                            {complete ? <Check className="size-3" /> : index + 1}
                          </span>
                          {step.title}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {loadingOptions && (
                  <div className="mt-5 inline-flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" />
                    Loading options
                  </div>
                )}
              </aside>
            )}

            <section className="flex min-h-0 min-w-0 flex-col">
              <div className="border-b border-border px-6 py-5">
                <div className="flex flex-col gap-4">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Step {activeStepIndex + 1} of {wizardSteps.length}
                    </p>
                    <h2 className="mt-1 text-lg font-semibold text-foreground">{activeStepMeta.title}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{activeStepMeta.description}</p>
                  </div>
                  {!showBuilderRail && (
                    <CompactStepProgress
                      steps={wizardSteps}
                      activeStep={activeStep}
                      activeStepIndex={activeStepIndex}
                      disabled={submitting}
                      onStepClick={setActiveStep}
                    />
                  )}
                </div>
              </div>

              {activeStep !== "audience" && (
                <AudienceContextBar
                  selectedSegment={selectedSegment}
                  segmentId={segmentId}
                  selectedOffer={selectedOffer}
                  asOfDate={asOfDate}
                  locked={audienceLockedFromSegment}
                  onChange={() => {
                    setAudienceEditing(true);
                    setActiveStep("audience");
                  }}
                />
              )}

              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                {activeStep === "audience" && (
                  <AudienceStep
                    name={name}
                    setName={setName}
                    asOfDate={asOfDate}
                    setAsOfDate={setAsOfDate}
                    segmentId={segmentId}
                    setSegmentId={setSegmentId}
                    selectedSegment={selectedSegment}
                    segments={segments}
                    offerId={offerId}
                    setOfferId={setOfferId}
                    offers={offers}
                    selectedOffer={selectedOffer}
                  />
                )}
                {activeStep === "experiment-type" && (
                  <ExperimentTypeStep
                    experimentType={experimentType}
                    setExperimentType={setExperimentType}
                  />
                )}
                {activeStep === "hypothesis" && (
                  <HypothesisStep hypothesis={hypothesis} setHypothesis={setHypothesis} />
                )}
                {activeStep === "metric" && (
                  <MetricStep oecMetric={oecMetric} setOecMetric={setOecMetric} />
                )}
                {activeStep === "split" && (
                  <SplitStep
                    controlPct={controlPct}
                    setControlPct={setControlPct}
                    scriptAPct={scriptAPct}
                    setScriptAPct={setScriptAPct}
                    scriptBPct={scriptBPct}
                    setScriptBPct={setScriptBPct}
                    splitTotal={splitTotal}
                    splitValid={splitValid}
                  />
                )}
                {activeStep === "scripts" && (
                  <ScriptGenerationStep
                    experimentType={experimentType}
                    selectedSegment={selectedSegment}
                    selectedOffer={selectedOffer}
                    generatingScripts={generatingScripts}
                    onGenerateScripts={handleGenerateScripts}
                    scriptATitle={scriptATitle}
                    scriptBTitle={scriptBTitle}
                    scriptASummary={scriptASummary}
                    scriptBSummary={scriptBSummary}
                    scriptVariantLogic={scriptVariantLogic}
                  />
                )}
                {activeStep === "script-a" && (
                  <SingleScriptStep
                    label="Script A"
                    title={scriptATitle}
                    setTitle={setScriptATitle}
                    summary={scriptASummary}
                    setSummary={setScriptASummary}
                    firstMessage={scriptAFirstMessage}
                    setFirstMessage={setScriptAFirstMessage}
                    systemPrompt={scriptA}
                    setSystemPrompt={setScriptA}
                  />
                )}
                {activeStep === "script-b" && (
                  <SingleScriptStep
                    label="Script B"
                    title={scriptBTitle}
                    setTitle={setScriptBTitle}
                    summary={scriptBSummary}
                    setSummary={setScriptBSummary}
                    firstMessage={scriptBFirstMessage}
                    setFirstMessage={setScriptBFirstMessage}
                    systemPrompt={scriptB}
                    setSystemPrompt={setScriptB}
                  />
                )}
                {activeStep === "contacts" && (
                  <ContactsStep csvText={csvText} setCsvText={setCsvText} csvRows={csvRows} />
                )}
                {activeStep === "review" && (
                  <ReviewStep
                    name={name}
                    selectedSegment={selectedSegment}
                    segmentId={segmentId}
                    selectedOffer={selectedOffer}
                    asOfDate={asOfDate}
                    hypothesis={hypothesis}
                    oecMetric={oecMetric}
                    experimentType={experimentType}
                    scriptVariantLogic={scriptVariantLogic}
                    controlPct={controlPct}
                    scriptAPct={scriptAPct}
                    scriptBPct={scriptBPct}
                    scriptATitle={scriptATitle}
                    scriptBTitle={scriptBTitle}
                    scriptA={scriptA}
                    scriptB={scriptB}
                    csvRows={csvRows}
                  />
                )}
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-4">
                <Link href="/campaigns" className="inline-flex h-10 items-center rounded-md border border-border px-3 text-sm text-foreground hover:bg-muted">
                  Cancel
                </Link>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={goBack}
                    disabled={activeStepIndex === 0 || submitting}
                    className="h-10 rounded-md border border-border px-3 text-sm text-foreground hover:bg-muted disabled:opacity-50"
                  >
                    Back
                  </button>
                  {activeStep === "review" ? (
                    <button
                      type="submit"
                      disabled={submitting || loadingOptions || !canContinue}
                      className="inline-flex h-10 items-center gap-2 rounded-md bg-foreground px-3 text-sm text-background disabled:opacity-50"
                    >
                      {submitting ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                      Create Campaign
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={goNext}
                      disabled={loadingOptions || !canContinue}
                      className="inline-flex h-10 items-center gap-2 rounded-md bg-foreground px-3 text-sm text-background disabled:opacity-50"
                    >
                      Continue
                      <ChevronRight className="size-4" />
                    </button>
                  )}
                </div>
              </div>
            </section>
          </div>
        </form>
      </div>
    </div>
  );
}

function CompactStepProgress({
  steps,
  activeStep,
  activeStepIndex,
  disabled,
  onStepClick,
}: {
  steps: typeof WIZARD_STEPS;
  activeStep: WizardStepId;
  activeStepIndex: number;
  disabled: boolean;
  onStepClick: (step: WizardStepId) => void;
}) {
  return (
    <div className="flex gap-1" aria-label="Campaign builder progress">
      {steps.map((step, index) => {
        const active = step.id === activeStep;
        const complete = index < activeStepIndex;
        const reachable = index <= activeStepIndex;
        return (
          <button
            key={step.id}
            type="button"
            disabled={!reachable || disabled}
            onClick={() => onStepClick(step.id)}
            aria-label={`${step.title}: ${step.description}`}
            aria-current={active ? "step" : undefined}
            className="group flex h-6 min-w-0 flex-1 items-center disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span
              className={`h-1.5 w-full rounded-full transition-colors ${
                active || complete ? "bg-foreground" : "bg-muted"
              }`}
            />
          </button>
        );
      })}
    </div>
  );
}

function AudienceContextBar({
  selectedSegment,
  segmentId,
  selectedOffer,
  asOfDate,
  locked,
  onChange,
}: {
  selectedSegment?: Segment;
  segmentId: string;
  selectedOffer?: Offer;
  asOfDate: string;
  locked: boolean;
  onChange: () => void;
}) {
  const audienceLabel = selectedSegment
    ? `${selectedSegment.name} · ${selectedSegment.userCount.toLocaleString()} users`
    : segmentId === PROFILE_ONLY_SEGMENT_ID
      ? "FundsIndia KYC recovery profile"
      : segmentId;

  return (
    <div className="border-b border-border px-6 py-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="text-[9.9px] font-medium uppercase tracking-wide text-muted-foreground">
              {locked ? "Audience selected" : "Audience"}
            </span>
            <span className="truncate text-sm font-medium text-foreground">{audienceLabel}</span>
            <span className="text-muted-foreground">Offer: <span className="font-medium text-foreground">{selectedOffer?.name ?? "Not selected"}</span></span>
            <span className="text-muted-foreground">As-of: <span className="font-medium text-foreground">{asOfDate || "-"}</span></span>
            <span className="rounded-md px-2 py-0.5 text-xs text-muted-foreground shadow-[0_0_0_1px_var(--color-border)]">
              KYC eligible + contactable only
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onChange}
          className="inline-flex h-9 shrink-0 items-center justify-center rounded-md border border-border px-3 text-sm text-foreground hover:bg-muted"
        >
          Change Setup
        </button>
      </div>
    </div>
  );
}

function AudienceStep({
  name,
  setName,
  asOfDate,
  setAsOfDate,
  segmentId,
  setSegmentId,
  selectedSegment,
  segments,
  offerId,
  setOfferId,
  offers,
  selectedOffer,
}: {
  name: string;
  setName: (value: string) => void;
  asOfDate: string;
  setAsOfDate: (value: string) => void;
  segmentId: string;
  setSegmentId: (value: string) => void;
  selectedSegment?: Segment;
  segments: Segment[];
  offerId: string;
  setOfferId: (value: string) => void;
  offers: Offer[];
  selectedOffer?: Offer;
}) {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Campaign name">
          <input value={name} onChange={(event) => setName(event.target.value)} className={INPUT_CLASS} required />
        </Field>
        <Field label="As-of date">
          <input type="date" value={asOfDate} onChange={(event) => setAsOfDate(event.target.value)} className={INPUT_CLASS} required />
        </Field>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.9fr)]">
        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium text-foreground">Eligibility segment</h3>
              <p className="mt-1 text-xs text-muted-foreground">Choose who enters the experiment.</p>
            </div>
            {selectedSegment && segmentId !== PROFILE_ONLY_SEGMENT_ID && (
              <Link
                href={`/segments/${encodeURIComponent(selectedSegment.id)}`}
                className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-muted"
              >
                View
              </Link>
            )}
          </div>
          <div className="grid gap-2">
            <button
              type="button"
              onClick={() => setSegmentId(PROFILE_ONLY_SEGMENT_ID)}
              className={`w-full rounded-md border p-3 text-left transition-colors ${
                segmentId === PROFILE_ONLY_SEGMENT_ID ? "border-foreground bg-muted/45" : "border-border hover:bg-muted/30"
              }`}
            >
              <span className="flex items-start justify-between gap-4">
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">FundsIndia KYC recovery profile</span>
                  <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                    Profile-scored investors who need account activation help.
                  </span>
                </span>
                <span className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground shadow-[0_0_0_1px_var(--color-border)]">
                  Default
                </span>
              </span>
            </button>

            {segments.map((segment) => {
              const active = segment.id === segmentId;
              return (
                <button
                  key={segment.id}
                  type="button"
                  onClick={() => setSegmentId(segment.id)}
                  className={`w-full rounded-md border p-3 text-left transition-colors ${
                    active ? "border-foreground bg-muted/45" : "border-border hover:bg-muted/30"
                  }`}
                >
                  <span className="flex items-start justify-between gap-4">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground">{segment.name}</span>
                      <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-muted-foreground">
                        {segment.description || "Saved audience segment"}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground shadow-[0_0_0_1px_var(--color-border)]">
                      {segment.userCount.toLocaleString()} Users
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="mb-2">
            <h3 className="text-sm font-medium text-foreground">Offer</h3>
            <p className="mt-1 text-xs text-muted-foreground">Pick the service promise used by both treatment scripts.</p>
          </div>
          <div className="grid gap-2">
            {offers.map((offer) => {
              const active = offer.offerId === offerId;
              return (
                <button
                  key={offer.offerId}
                  type="button"
                  onClick={() => setOfferId(offer.offerId)}
                  className={`w-full rounded-md border p-3 text-left transition-colors ${
                    active ? "border-foreground bg-muted/45" : "border-border hover:bg-muted/30"
                  }`}
                >
                  <span className="block text-sm font-medium text-foreground">{offer.name}</span>
                  <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-muted-foreground">
                    {offer.valueProp || offer.tagline}
                  </span>
                  <span className="mt-3 inline-flex rounded-md px-2 py-1 text-[9.9px] text-muted-foreground shadow-[0_0_0_1px_var(--color-border)]">
                    {offer.sku}
                  </span>
                </button>
              );
            })}
            {offers.length === 0 && (
              <div className="rounded-md border border-border p-3 text-sm text-muted-foreground">
                Offers are still loading.
              </div>
            )}
          </div>
          {selectedOffer && (
            <div className="mt-3 rounded-md border border-border bg-muted/20 px-3 py-3 text-xs text-muted-foreground">
              <div className="font-medium text-foreground">{selectedOffer.name}</div>
              <div className="mt-1 leading-relaxed">{selectedOffer.valueProp}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StepFrame({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex min-h-[340px] w-full max-w-2xl flex-col justify-center">{children}</div>;
}

function ExperimentTypeStep({
  experimentType,
  setExperimentType,
}: {
  experimentType: ExperimentType;
  setExperimentType: (value: ExperimentType) => void;
}) {
  return (
    <StepFrame>
      <div className="grid gap-3 sm:grid-cols-2">
        {EXPERIMENT_TYPES.map((type) => {
          const active = type.id === experimentType;
          return (
            <button
              key={type.id}
              type="button"
              disabled={!type.enabled}
              onClick={() => setExperimentType(type.id)}
              aria-pressed={active}
              className={`min-h-32 rounded-md border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                active ? "border-foreground bg-muted/35" : "border-border hover:bg-muted/30"
              }`}
            >
              <span className="flex h-full flex-col justify-between gap-4">
                <span>
                  <span className="block text-sm font-medium text-foreground">{type.title}</span>
                  <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{type.description}</span>
                </span>
                {!type.enabled && (
                  <span className="w-fit rounded-md px-2 py-0.5 text-[9.9px] text-muted-foreground shadow-[0_0_0_1px_var(--color-border)]">
                    Coming next
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </StepFrame>
  );
}

function HypothesisStep({
  hypothesis,
  setHypothesis,
}: {
  hypothesis: string;
  setHypothesis: (value: string) => void;
}) {
  return (
    <StepFrame>
      <Field label="Hypothesis">
        <textarea
          value={hypothesis}
          onChange={(event) => setHypothesis(event.target.value)}
          className={`${TEXTAREA_CLASS} min-h-40 text-base leading-relaxed`}
          required
        />
      </Field>
    </StepFrame>
  );
}

function MetricStep({
  oecMetric,
  setOecMetric,
}: {
  oecMetric: OecMetric;
  setOecMetric: (value: OecMetric) => void;
}) {
  return (
    <StepFrame>
      <div className="grid gap-3">
        {OEC_OPTIONS.map((option) => {
          const active = option.id === oecMetric;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setOecMetric(option.id)}
              aria-pressed={active}
              className={`rounded-md border p-4 text-left transition-colors ${
                active ? "border-foreground bg-muted/35" : "border-border hover:bg-muted/30"
              }`}
            >
              <span className="block text-sm font-medium text-foreground">{option.label}</span>
              <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{option.description}</span>
            </button>
          );
        })}
      </div>
    </StepFrame>
  );
}

function SplitStep({
  controlPct,
  setControlPct,
  scriptAPct,
  setScriptAPct,
  scriptBPct,
  setScriptBPct,
  splitTotal,
  splitValid,
}: {
  controlPct: number;
  setControlPct: (value: number) => void;
  scriptAPct: number;
  setScriptAPct: (value: number) => void;
  scriptBPct: number;
  setScriptBPct: (value: number) => void;
  splitTotal: number;
  splitValid: boolean;
}) {
  const barBasis = Math.max(splitTotal, 100);
  const barWidth = (value: number) => `${Math.max(0, Math.min(100, (value / barBasis) * 100))}%`;

  return (
    <StepFrame>
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">Total must be 100%.</div>
          <div className="text-sm font-medium tabular-nums text-foreground">{splitTotal}%</div>
        </div>
        <div className="flex h-2 overflow-hidden rounded-full border border-border bg-muted">
          <div className="bg-foreground/80" style={{ width: barWidth(controlPct) }} />
          <div className="bg-foreground/50" style={{ width: barWidth(scriptAPct) }} />
          <div className="bg-foreground/25" style={{ width: barWidth(scriptBPct) }} />
        </div>
        <div className="space-y-3">
          <SplitRow label="Control" helper="No call" value={controlPct} onChange={setControlPct} />
          <SplitRow label="Script A" helper="Voice call" value={scriptAPct} onChange={setScriptAPct} />
          <SplitRow label="Script B" helper="Voice call" value={scriptBPct} onChange={setScriptBPct} />
        </div>
        {!splitValid && (
          <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-foreground">
            Use positive percentages and make the total exactly 100%.
          </div>
        )}
      </div>
    </StepFrame>
  );
}

function SplitRow({
  label,
  helper,
  value,
  onChange,
}: {
  label: string;
  helper: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid grid-cols-[minmax(0,1fr)_96px] items-center gap-3 rounded-md border border-border px-4 py-3">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{helper}</span>
      </span>
      <span className="relative">
        <input
          type="number"
          min={0}
          max={100}
          step={5}
          value={value}
          onChange={(event) => onChange(normalizePct(event.target.value))}
          className="h-10 w-full rounded-md border border-border bg-background pl-3 pr-7 text-right text-sm tabular-nums text-foreground outline-none focus:ring-1 focus:ring-foreground/20"
          aria-label={`${label} allocation percentage`}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
      </span>
    </label>
  );
}

function ScriptGenerationStep({
  experimentType,
  selectedSegment,
  selectedOffer,
  generatingScripts,
  onGenerateScripts,
  scriptATitle,
  scriptBTitle,
  scriptASummary,
  scriptBSummary,
  scriptVariantLogic,
}: {
  experimentType: ExperimentType;
  selectedSegment?: Segment;
  selectedOffer?: Offer;
  generatingScripts: boolean;
  onGenerateScripts: () => void;
  scriptATitle: string;
  scriptBTitle: string;
  scriptASummary: string;
  scriptBSummary: string;
  scriptVariantLogic: string;
}) {
  const canGenerate = experimentType === "message_framing";
  return (
    <StepFrame>
      <div className="space-y-4">
        <div className="rounded-md border border-border px-4 py-4">
          <div className="text-sm font-medium text-foreground">Generate script variants</div>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Use {selectedSegment?.name ?? "the selected audience"} and {selectedOffer?.name ?? "the selected offer"} to draft two treatment angles.
          </p>
          <button
            type="button"
            onClick={onGenerateScripts}
            disabled={!canGenerate || generatingScripts}
            className="mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-md bg-foreground px-3 text-sm text-background disabled:opacity-50"
          >
            {generatingScripts ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
            {generatingScripts ? "Generating" : "Generate Variants"}
          </button>
        </div>

        {scriptVariantLogic && (
          <div className="rounded-md border border-border bg-muted/20 px-4 py-3 text-sm text-foreground">
            <div className="font-medium">Variant logic</div>
            <div className="mt-1 text-muted-foreground">{scriptVariantLogic}</div>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <VariantPreview label="Script A" title={scriptATitle} summary={scriptASummary} />
          <VariantPreview label="Script B" title={scriptBTitle} summary={scriptBSummary} />
        </div>
      </div>
    </StepFrame>
  );
}

function VariantPreview({
  label,
  title,
  summary,
}: {
  label: string;
  title: string;
  summary: string;
}) {
  return (
    <div className="rounded-md border border-border px-3 py-3">
      <div className="text-[9.9px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium text-foreground">{title}</div>
      <div className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">{summary}</div>
    </div>
  );
}

function SingleScriptStep({
  label,
  title,
  setTitle,
  summary,
  setSummary,
  firstMessage,
  setFirstMessage,
  systemPrompt,
  setSystemPrompt,
}: {
  label: string;
  title: string;
  setTitle: (value: string) => void;
  summary: string;
  setSummary: (value: string) => void;
  firstMessage: string;
  setFirstMessage: (value: string) => void;
  systemPrompt: string;
  setSystemPrompt: (value: string) => void;
}) {
  return (
    <StepFrame>
      <div className="space-y-3">
        <div>
          <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className={INPUT_CLASS}
            aria-label={`${label} title`}
          />
        </div>
        <Field label="Strategy">
          <textarea value={summary} onChange={(event) => setSummary(event.target.value)} className={`${TEXTAREA_CLASS} min-h-24`} required />
        </Field>
        <Field label="Opening line">
          <textarea value={firstMessage} onChange={(event) => setFirstMessage(event.target.value)} className={`${TEXTAREA_CLASS} min-h-24`} required />
        </Field>
        <details className="rounded-md border border-border px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium text-foreground">Full system prompt</summary>
          <textarea
            value={systemPrompt}
            onChange={(event) => setSystemPrompt(event.target.value)}
            className={`${TEXTAREA_CLASS} mt-2 min-h-56 font-mono text-xs`}
            required
          />
        </details>
      </div>
    </StepFrame>
  );
}

function ContactsStep({
  csvText,
  setCsvText,
  csvRows,
}: {
  csvText: string;
  setCsvText: (value: string) => void;
  csvRows: number;
}) {
  return (
    <div className="space-y-3">
      <Field label="CSV">
        <textarea
          value={csvText}
          onChange={(event) => setCsvText(event.target.value)}
          className={`${TEXTAREA_CLASS} min-h-64 font-mono text-xs`}
          placeholder={"investor_id,phone_number,consent,name,preferred_language\nINV_000001,+919876543210,true,Asha,English"}
        />
      </Field>
      <div className="text-xs text-muted-foreground">
        {csvRows > 0 ? `${csvRows.toLocaleString()} CSV row${csvRows === 1 ? "" : "s"} pasted.` : "No CSV pasted. The campaign can still be created and contacts can be mapped later."}
      </div>
    </div>
  );
}

function ReviewStep({
  name,
  selectedSegment,
  segmentId,
  selectedOffer,
  asOfDate,
  hypothesis,
  oecMetric,
  experimentType,
  scriptVariantLogic,
  controlPct,
  scriptAPct,
  scriptBPct,
  scriptATitle,
  scriptBTitle,
  scriptA,
  scriptB,
  csvRows,
}: {
  name: string;
  selectedSegment?: Segment;
  segmentId: string;
  selectedOffer?: Offer;
  asOfDate: string;
  hypothesis: string;
  oecMetric: OecMetric;
  experimentType: ExperimentType;
  scriptVariantLogic: string;
  controlPct: number;
  scriptAPct: number;
  scriptBPct: number;
  scriptATitle: string;
  scriptBTitle: string;
  scriptA: string;
  scriptB: string;
  csvRows: number;
}) {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-2">
        <ReviewItem label="Campaign" value={name || "-"} />
        <ReviewItem label="Audience" value={selectedSegment ? `${selectedSegment.name} · ${selectedSegment.userCount.toLocaleString()} users` : segmentId === PROFILE_ONLY_SEGMENT_ID ? "FundsIndia KYC recovery profile" : segmentId} />
        <ReviewItem label="Offer" value={selectedOffer ? `${selectedOffer.name} · ${selectedOffer.sku}` : "-"} />
        <ReviewItem label="As-of date" value={asOfDate || "-"} />
        <ReviewItem label="Experiment type" value={EXPERIMENT_TYPES.find((type) => type.id === experimentType)?.title ?? experimentType} />
        <ReviewItem label="OEC" value={getOecLabel(oecMetric)} />
        <ReviewItem label="Guardrails" value={GUARDRAIL_METRICS.join(" · ")} />
        <ReviewItem label="Contact CSV" value={csvRows > 0 ? `${csvRows.toLocaleString()} row${csvRows === 1 ? "" : "s"}` : "Not attached"} />
      </div>
      <div>
        <div className="mb-1.5 text-xs text-muted-foreground">Hypothesis</div>
        <div className="rounded border border-border px-3 py-2 text-sm text-foreground">{hypothesis || "-"}</div>
      </div>
      <div>
        <div className="mb-1.5 text-xs text-muted-foreground">Variant logic</div>
        <div className="rounded border border-border px-3 py-2 text-sm text-foreground">{scriptVariantLogic || "-"}</div>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <ReviewItem label="Control" value={`${controlPct}% · no call`} />
        <ReviewItem label={scriptATitle || "Script A"} value={`${scriptAPct}% · ${scriptA.trim().length.toLocaleString()} chars`} />
        <ReviewItem label={scriptBTitle || "Script B"} value={`${scriptBPct}% · ${scriptB.trim().length.toLocaleString()} chars`} />
      </div>
    </div>
  );
}

function ReviewItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-sm text-foreground">{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
