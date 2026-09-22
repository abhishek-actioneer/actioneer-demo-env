"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Copy, GitCompareArrows, Loader2, Play, Plus, RefreshCw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api-client";
import { useDataset } from "@/lib/dataset-context";
import { DEFAULT_CANDIDATE_GENERATOR_PROMPT } from "@/features/prompts/voice/campaign-bench";
import type { Purpose } from "@/lib/purpose-types";
import type { Segment } from "@/lib/types";
import type { PromptBenchRun } from "@/lib/voice-campaign-prompt-bench-types";

const DEFAULT_BRIEF = "Create a focused outbound voice campaign for this audience. The agent should understand the customer's context, answer basic questions, and offer the next step only after being helpful.";

const DEFAULT_SIMULATION_LINES = [
  "Why are you calling?",
  "I am busy right now.",
  "Not interested.",
  "Transfer me to a human.",
  "My KYC is stuck and I do not know what to do.",
].join("\n");

const MAX_PROMPTS = 12;
const PROMPT_SET_STORAGE_KEY = "voice-campaign-prompt-bench-prompts";
const CUSTOM_PURPOSE_ID = "CUSTOM_PROMPT_BENCH_PURPOSE";

interface PromptDraft {
  id: string;
  label: string;
  prompt: string;
}

function createPromptId(): string {
  return `candidate-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function defaultPromptDraft(label = "Candidate 1"): PromptDraft {
  return {
    id: createPromptId(),
    label,
    prompt: DEFAULT_CANDIDATE_GENERATOR_PROMPT,
  };
}

function parseStoredPromptDrafts(value: string | null): PromptDraft[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return null;
    const drafts = parsed
      .map((item, index): PromptDraft | null => {
        if (typeof item !== "object" || item === null) return null;
        const candidate = item as Partial<PromptDraft>;
        const prompt = typeof candidate.prompt === "string" ? candidate.prompt : "";
        if (prompt.trim().length < 100) return null;
        return {
          id: typeof candidate.id === "string" && candidate.id ? candidate.id : createPromptId(),
          label: typeof candidate.label === "string" && candidate.label.trim() ? candidate.label.trim() : `Candidate ${index + 1}`,
          prompt,
        };
      })
      .filter((item): item is PromptDraft => Boolean(item));
    return drafts.length ? drafts.slice(0, MAX_PROMPTS) : null;
  } catch {
    return null;
  }
}

function withDataset(path: string, datasetId: string): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}datasetId=${encodeURIComponent(datasetId)}`;
}

function selectedById<T extends { id?: string; purposeId?: string }>(
  items: T[],
  id: string,
  key: "id" | "purposeId",
): T | undefined {
  return items.find((item) => item[key] === id) ?? items[0];
}

function shortCount(value: number | undefined): string {
  if (!value) return "0";
  return value.toLocaleString();
}

function textOrEmpty(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function compactLine(value: string, fallback: string, maxLength = 220): string {
  const text = value.replace(/\s+/g, " ").trim() || fallback;
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).trim()}...`;
}

export default function VoiceCampaignPromptBenchPage() {
  const router = useRouter();
  const { datasetId, dataset, allDatasets, switchDataset } = useDataset();
  const [segments, setSegments] = useState<Segment[]>([]);
  const [purposes, setPurposes] = useState<Purpose[]>([]);
  const [segmentId, setSegmentId] = useState("");
  const [purposeId, setPurposeId] = useState("");
  const [purposeMode, setPurposeMode] = useState<"catalog" | "custom">("catalog");
  const [customPurposeName, setCustomPurposeName] = useState("Written purpose");
  const [customPurposeDescription, setCustomPurposeDescription] = useState("");
  const [customPurposeValueProp, setCustomPurposeValueProp] = useState("");
  const [customPurposePrice, setCustomPurposePrice] = useState("Not specified");
  const [customPurposeCta, setCustomPurposeCta] = useState("Continue only if the customer is interested");
  const [language, setLanguage] = useState("Hinglish");
  const [voiceGender, setVoiceGender] = useState<"female" | "male" | "unknown">("female");
  const [agentName, setAgentName] = useState("Ananya");
  const [brief, setBrief] = useState(DEFAULT_BRIEF);
  const [briefTouched, setBriefTouched] = useState(false);
  const [promptDrafts, setPromptDrafts] = useState<PromptDraft[]>(() => [defaultPromptDraft()]);
  const [promptDraftsReady, setPromptDraftsReady] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerAttributes, setCustomerAttributes] = useState("");
  const [customerLastEvent, setCustomerLastEvent] = useState("");
  const [includeSimulations, setIncludeSimulations] = useState(false);
  const [simulationLines, setSimulationLines] = useState(DEFAULT_SIMULATION_LINES);
  const [loadingData, setLoadingData] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingData(true);
    setError(null);
    Promise.all([
      apiFetch<Segment[]>(withDataset("/api/segments", datasetId), { skipModel: true, datasetId }),
      apiFetch<{ purposes: Purpose[] }>(withDataset("/api/purposes", datasetId), { skipModel: true, datasetId }),
    ])
      .then(([nextSegments, nextPurposePayload]) => {
        if (cancelled) return;
        setSegments(nextSegments);
        setPurposes(nextPurposePayload.purposes);
        setSegmentId((current) => nextSegments.some((item) => item.id === current) ? current : nextSegments[0]?.id ?? "");
        setPurposeId((current) => nextPurposePayload.purposes.some((item) => item.purposeId === current) ? current : "");
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load bench inputs");
      })
      .finally(() => {
        if (!cancelled) setLoadingData(false);
      });
    return () => {
      cancelled = true;
    };
  }, [datasetId]);

  useEffect(() => {
    try {
      const stored = parseStoredPromptDrafts(localStorage.getItem(PROMPT_SET_STORAGE_KEY));
      if (stored) setPromptDrafts(stored);
    } catch {
      // localStorage unavailable
    } finally {
      setPromptDraftsReady(true);
    }
  }, []);

  useEffect(() => {
    if (!promptDraftsReady) return;
    try {
      localStorage.setItem(PROMPT_SET_STORAGE_KEY, JSON.stringify(promptDrafts));
    } catch {
      // localStorage unavailable
    }
  }, [promptDrafts, promptDraftsReady]);

  const selectedSegment = useMemo(() => selectedById(segments, segmentId, "id"), [segments, segmentId]);
  const catalogPurpose = useMemo(() => selectedById(purposes, purposeId, "purposeId"), [purposes, purposeId]);
  const writtenPurpose = useMemo<Purpose | null>(() => {
    const description = customPurposeDescription.trim();
    if (!description) return null;
    const name = customPurposeName.trim() || "Written purpose";
    const valueProp = customPurposeValueProp.trim() || description;
    const cta = customPurposeCta.trim() || "Continue only if the customer is interested";
    return {
      purposeId: CUSTOM_PURPOSE_ID,
      sku: "CUSTOM-PROMPT-BENCH-PURPOSE",
      name,
      category: "custom",
      tagline: compactLine(valueProp, name, 220),
      description,
      valueProp,
      priceDisplay: customPurposePrice.trim() || "Not specified",
      cta,
    };
  }, [customPurposeCta, customPurposeDescription, customPurposeName, customPurposePrice, customPurposeValueProp]);
  const selectedPurpose = purposeMode === "custom" ? writtenPurpose : catalogPurpose;

  useEffect(() => {
    if (briefTouched || !selectedSegment || !selectedPurpose) return;
    setBrief(`Create a focused outbound voice campaign for "${selectedSegment.name}" around "${selectedPurpose.name}". The agent should understand the customer's context, answer basic questions, and offer the next step only after being helpful.`);
  }, [briefTouched, selectedPurpose, selectedSegment]);

  function updatePromptDraft(id: string, patch: Partial<Pick<PromptDraft, "label" | "prompt">>) {
    setPromptDrafts((current) => current.map((draft) => draft.id === id ? { ...draft, ...patch } : draft));
  }

  function addPromptDraft() {
    setPromptDrafts((current) => {
      if (current.length >= MAX_PROMPTS) return current;
      return [...current, defaultPromptDraft(`Candidate ${current.length + 1}`)];
    });
  }

  function duplicatePromptDraft(id: string) {
    setPromptDrafts((current) => {
      if (current.length >= MAX_PROMPTS) return current;
      const source = current.find((draft) => draft.id === id) ?? current[current.length - 1];
      if (!source) return current;
      return [
        ...current,
        {
          id: createPromptId(),
          label: `${source.label} copy`,
          prompt: source.prompt,
        },
      ];
    });
  }

  function removePromptDraft(id: string) {
    setPromptDrafts((current) => {
      if (current.length <= 1) return current;
      return current.filter((draft) => draft.id !== id);
    });
  }

  function resetPromptDraft(id: string) {
    updatePromptDraft(id, { prompt: DEFAULT_CANDIDATE_GENERATOR_PROMPT });
  }

  async function runBench() {
    if (!selectedSegment) return;
    if (!selectedPurpose) {
      setError(purposeMode === "custom"
        ? "Write a purpose description before running the bench."
        : "Select a purpose before running the bench.");
      return;
    }
    const promptVariants = promptDrafts
      .map((draft, index) => ({
        id: draft.id,
        label: draft.label.trim() || `Candidate ${index + 1}`,
        prompt: draft.prompt.trim(),
      }))
      .filter((draft) => draft.prompt.length >= 100);
    if (promptVariants.length === 0) {
      setError("Add at least one prompt with 100+ characters before running the bench.");
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const payload = {
        datasetId,
        segmentId: selectedSegment.id,
        purposeId: selectedPurpose.purposeId,
        purpose: selectedPurpose,
        language,
        brief,
        agentName,
        voiceGender,
        promptVariants,
        customerContext: {
          name: textOrEmpty(customerName) || undefined,
          attributes: textOrEmpty(customerAttributes) || undefined,
          lastEvent: textOrEmpty(customerLastEvent) || undefined,
        },
        includeSimulations,
        simulationUtterances: simulationLines.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
      };
      const run = await apiFetch<PromptBenchRun>(
        withDataset("/api/voice-campaigns/prompt-bench", datasetId),
        { method: "POST", body: payload, datasetId },
      );
      router.push(`/voice-campaigns/prompt-bench/results?runId=${encodeURIComponent(run.id)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Prompt bench failed");
      setRunning(false);
    }
  }

  return (
    <div className="flex h-full min-w-0 flex-col overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
              <GitCompareArrows className="size-4" />
              Voice campaign generator
            </div>
            <h1 className="text-2xl font-medium text-foreground">Prompt bench</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Add multiple generator prompts, run each in its own parallel LLM request, then review outputs on a dedicated results page.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={runBench} disabled={running || loadingData || !selectedSegment || !selectedPurpose}>
            {running ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
            Run prompts
          </Button>
        </div>

        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
            <AlertCircle className="size-4" />
            {error}
          </div>
        )}

        <div className="mb-5 rounded-lg border border-border bg-background">
          <div className="grid gap-4 border-b border-border p-4 lg:grid-cols-4">
            <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
              Dataset
              <select
                value={datasetId}
                onChange={(event) => switchDataset(event.target.value)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {(allDatasets.length ? allDatasets : [dataset]).map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
              Segment
              <select
                value={segmentId}
                onChange={(event) => setSegmentId(event.target.value)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                disabled={loadingData || segments.length === 0}
              >
                {segments.map((segment) => (
                  <option key={segment.id} value={segment.id}>{segment.name}</option>
                ))}
              </select>
            </label>
            <div className="space-y-1.5 text-xs font-medium text-muted-foreground">
              Purpose source
              <div className="grid h-9 grid-cols-2 rounded-md border border-input p-0.5">
                <button
                  type="button"
                  onClick={() => setPurposeMode("catalog")}
                  className={`rounded-sm px-2 text-sm transition-colors ${purposeMode === "catalog" ? "bg-muted text-foreground" : "text-muted-foreground"}`}
                >
                  Catalog
                </button>
                <button
                  type="button"
                  onClick={() => setPurposeMode("custom")}
                  className={`rounded-sm px-2 text-sm transition-colors ${purposeMode === "custom" ? "bg-muted text-foreground" : "text-muted-foreground"}`}
                >
                  Written
                </button>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
                Language
                <Input value={language} onChange={(event) => setLanguage(event.target.value)} className="h-9" />
              </label>
              <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
                Voice
                <select
                  value={voiceGender}
                  onChange={(event) => setVoiceGender(event.target.value as typeof voiceGender)}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                  <option value="unknown">Unknown</option>
                </select>
              </label>
              <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
                Agent
                <Input value={agentName} onChange={(event) => setAgentName(event.target.value)} className="h-9" />
              </label>
            </div>
          </div>

          <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
            <div className="space-y-4">
              {purposeMode === "catalog" ? (
                <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
                  Catalog purpose
                  <select
                    value={purposeId}
                    onChange={(event) => setPurposeId(event.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    disabled={loadingData || purposes.length === 0}
                  >
                    <option value="" disabled>Select a purpose</option>
                    {purposes.map((purpose) => (
                      <option key={purpose.purposeId} value={purpose.purposeId}>{purpose.name}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className="space-y-3 rounded-lg border border-border bg-muted/10 p-3">
                  <div>
                    <h2 className="text-sm font-medium text-foreground">Written purpose</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      This is used only for the bench run and is sent as an inline purpose.
                    </p>
                  </div>
                  <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
                    Purpose name
                    <Input
                      value={customPurposeName}
                      onChange={(event) => setCustomPurposeName(event.target.value)}
                      placeholder="KYC recovery callback"
                      className="h-9"
                    />
                  </label>
                  <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
                    Purpose description
                    <Textarea
                      value={customPurposeDescription}
                      onChange={(event) => setCustomPurposeDescription(event.target.value)}
                      placeholder="Describe what the call should achieve, what offer or help is being discussed, and what the agent should avoid claiming."
                      className="min-h-[108px] resize-y text-sm"
                    />
                  </label>
                  <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
                    Key benefit
                    <Input
                      value={customPurposeValueProp}
                      onChange={(event) => setCustomPurposeValueProp(event.target.value)}
                      placeholder="Optional; defaults to the description"
                      className="h-9"
                    />
                  </label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
                      Price / rate detail
                      <Input
                        value={customPurposePrice}
                        onChange={(event) => setCustomPurposePrice(event.target.value)}
                        placeholder="Not specified"
                        className="h-9"
                      />
                    </label>
                    <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
                      How to close
                      <Input
                        value={customPurposeCta}
                        onChange={(event) => setCustomPurposeCta(event.target.value)}
                        placeholder="Ask for consent for the next step"
                        className="h-9"
                      />
                    </label>
                  </div>
                </div>
              )}

              <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
                Campaign brief
                <Textarea
                  value={brief}
                  onChange={(event) => {
                    setBriefTouched(true);
                    setBrief(event.target.value);
                  }}
                  className="min-h-[112px] resize-y text-sm"
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-3">
                <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
                  Customer name
                  <Input value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Optional" className="h-9" />
                </label>
                <label className="space-y-1.5 text-xs font-medium text-muted-foreground sm:col-span-2">
                  Last activity
                  <Input value={customerLastEvent} onChange={(event) => setCustomerLastEvent(event.target.value)} placeholder="Optional sample context" className="h-9" />
                </label>
              </div>

              <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
                Known customer facts
                <Textarea
                  value={customerAttributes}
                  onChange={(event) => setCustomerAttributes(event.target.value)}
                  placeholder="Optional sample runtime context for candidate prompts."
                  className="min-h-[96px] resize-y text-sm"
                />
              </label>

              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={includeSimulations}
                  onChange={(event) => setIncludeSimulations(event.target.checked)}
                  className="size-4 rounded border-border"
                />
                Run customer-response simulations after generation
              </label>

              {includeSimulations && (
                <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
                  Simulation customer utterances
                  <Textarea
                    value={simulationLines}
                    onChange={(event) => setSimulationLines(event.target.value)}
                    className="min-h-[120px] resize-y font-mono text-xs"
                  />
                </label>
              )}

              <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs leading-5 text-muted-foreground">
                The current production prompt is always included as the baseline. Each candidate prompt below is sent as a separate generation call in parallel.
              </div>
            </div>

            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-medium text-foreground">Candidate prompts</h2>
                  <p className="text-xs text-muted-foreground">{promptDrafts.length} of {MAX_PROMPTS} prompts</p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={addPromptDraft} disabled={running || promptDrafts.length >= MAX_PROMPTS}>
                  <Plus className="size-3.5" />
                  Add prompt
                </Button>
              </div>

              <div className="space-y-3">
                {promptDrafts.map((draft, index) => (
                  <div key={draft.id} className="rounded-lg border border-border bg-background">
                    <div className="flex items-center gap-2 border-b border-border p-3">
                      <Input
                        value={draft.label}
                        onChange={(event) => updatePromptDraft(draft.id, { label: event.target.value })}
                        className="h-8 text-sm"
                        aria-label={`Prompt ${index + 1} name`}
                      />
                      <Button type="button" variant="ghost" size="sm" onClick={() => duplicatePromptDraft(draft.id)} disabled={running || promptDrafts.length >= MAX_PROMPTS} aria-label={`Duplicate ${draft.label}`}>
                        <Copy className="size-3.5" />
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => resetPromptDraft(draft.id)} disabled={running} aria-label={`Reset ${draft.label}`}>
                        <RefreshCw className="size-3.5" />
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => removePromptDraft(draft.id)} disabled={running || promptDrafts.length <= 1} aria-label={`Remove ${draft.label}`}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                    <Textarea
                      value={draft.prompt}
                      onChange={(event) => updatePromptDraft(draft.id, { prompt: event.target.value })}
                      className="min-h-[260px] resize-y rounded-none border-0 font-mono text-xs leading-5 shadow-none focus-visible:ring-0"
                      aria-label={`${draft.label} prompt`}
                    />
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
            <div className="text-xs text-muted-foreground">
              {selectedSegment ? `${selectedSegment.name} - ${shortCount(selectedSegment.userCount)} users` : "No segment selected"}
              {selectedPurpose ? ` - ${selectedPurpose.name}` : ""}
            </div>
            {running && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                Running {promptDrafts.length + 1} parallel generation calls{includeSimulations ? " plus simulations" : ""}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
