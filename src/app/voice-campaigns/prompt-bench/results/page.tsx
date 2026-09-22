"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertCircle, Check, GitCompareArrows, Loader2, Mic, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { VoiceTestPanel } from "@/components/voice-campaigns/voice-test-panel";
import { apiFetch } from "@/lib/api-client";
import { DEFAULT_GEMINI_VOICE } from "@/lib/gemini-voices";
import type {
  PromptBenchRun,
  PromptBenchVariantResult,
} from "@/lib/voice-campaign-prompt-bench-types";

type ArtifactTab = "script" | "runtime" | "workflow" | "prompts";

function CodePanel({
  title,
  value,
  minHeight = "min-h-[280px]",
}: {
  title: string;
  value: string;
  minHeight?: string;
}) {
  return (
    <section className="rounded-lg border border-border bg-background">
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
        <h3 className="text-xs font-medium text-foreground">{title}</h3>
        <span className="text-[9.9px] text-muted-foreground">{value.length.toLocaleString()} chars</span>
      </div>
      <pre className={`${minHeight} max-h-[520px] overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs leading-5 text-muted-foreground`}>
        {value || "No output."}
      </pre>
    </section>
  );
}

function VariantHeader({
  variant,
  onBrowserTest,
}: {
  variant: PromptBenchVariantResult;
  onBrowserTest: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {variant.error ? (
            <AlertCircle className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <Check className="size-4 shrink-0 text-muted-foreground" />
          )}
          <h2 className="truncate text-sm font-medium text-foreground">{variant.label}</h2>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onBrowserTest}
          disabled={!variant.systemPrompt || Boolean(variant.error)}
        >
          <Mic className="size-3.5" />
          Browser test
        </Button>
      </div>
      {variant.error ? (
        <p className="text-sm text-muted-foreground">{variant.error}</p>
      ) : (
        <div className="space-y-2 text-sm">
          <p className="font-medium text-foreground">{variant.campaignName}</p>
          <p className="text-muted-foreground">{variant.firstMessage}</p>
          <p className="text-xs leading-5 text-muted-foreground">{variant.reasoning}</p>
        </div>
      )}
    </div>
  );
}

function VariantColumn({
  variant,
  artifact,
}: {
  variant: PromptBenchVariantResult;
  artifact: ArtifactTab;
}) {
  if (variant.error) {
    return (
      <div className="rounded-lg border border-border bg-background p-3 text-sm text-muted-foreground">
        {variant.error}
      </div>
    );
  }

  if (artifact === "script") {
    return <CodePanel title="Script tab output" value={variant.editableScript ?? ""} />;
  }

  if (artifact === "runtime") {
    return <CodePanel title="Runtime system prompt" value={variant.systemPrompt ?? ""} />;
  }

  if (artifact === "workflow") {
    return <CodePanel title="Workflow JSON" value={JSON.stringify(variant.workflow ?? null, null, 2)} />;
  }

  const promptText = [
    "SYSTEM MESSAGE",
    variant.promptMessages?.system ?? "",
    "",
    "USER MESSAGE",
    variant.promptMessages?.user ?? "",
    variant.promptMessages?.renderedCandidatePrompt
      ? `\n\nRENDERED CANDIDATE STRUCTURE\n${variant.promptMessages.renderedCandidatePrompt}`
      : "",
  ].join("\n");

  return <CodePanel title="Generator prompt sent" value={promptText} minHeight="min-h-[420px]" />;
}

function comparisonColumns(count: number) {
  return { gridTemplateColumns: `repeat(${Math.max(count, 1)}, minmax(360px, 1fr))` };
}

export default function VoiceCampaignPromptBenchResultsPage() {
  const searchParams = useSearchParams();
  const runId = searchParams.get("runId") ?? "";
  const [run, setRun] = useState<PromptBenchRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [artifact, setArtifact] = useState<ArtifactTab>("script");
  const [activeTestKey, setActiveTestKey] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) {
      setError("No prompt bench run id was provided.");
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch<PromptBenchRun>(`/api/voice-campaigns/prompt-bench?runId=${encodeURIComponent(runId)}`, {
      skipDataset: true,
      skipModel: true,
    })
      .then((nextRun) => {
        if (!cancelled) setRun(nextRun);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load prompt bench run");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  const activeVariant = useMemo(
    () => run?.variants.find((variant) => variant.key === activeTestKey) ?? null,
    [activeTestKey, run],
  );

  return (
    <div className="flex h-full min-w-0 flex-col overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-7xl px-6 py-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
              <GitCompareArrows className="size-4" />
              Prompt bench results
            </div>
            <h1 className="text-2xl font-medium text-foreground">Generation output</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Review each prompt output, then run a browser voice test on any generated runtime prompt.
            </p>
          </div>
          <Button asChild type="button" variant="outline" size="sm">
            <Link href="/voice-campaigns/prompt-bench">New run</Link>
          </Button>
        </div>

        {loading && (
          <div className="mb-5 flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading prompt bench run...
          </div>
        )}

        {error && (
          <div className="mb-5 flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
            <AlertCircle className="size-4" />
            {error}
          </div>
        )}

        {run && (
          <div className="space-y-5">
            <section className="rounded-lg border border-border bg-background p-3">
              <div className="grid gap-3 text-xs text-muted-foreground md:grid-cols-4">
                <div>
                  <span className="block text-foreground">Dataset</span>
                  {run.dataset.label}
                </div>
                <div>
                  <span className="block text-foreground">Segment</span>
                  {run.segment.name}
                </div>
                <div>
                  <span className="block text-foreground">Purpose</span>
                  {run.purpose.name}
                </div>
                <div>
                  <span className="block text-foreground">Run</span>
                  {new Date(run.createdAt).toLocaleString()}
                </div>
              </div>
            </section>

            <div className="overflow-x-auto pb-2">
              <div className="grid min-w-full gap-4" style={comparisonColumns(run.variants.length)}>
                {run.variants.map((variant) => (
                  <VariantHeader
                    key={variant.key}
                    variant={variant}
                    onBrowserTest={() => setActiveTestKey(variant.key)}
                  />
                ))}
              </div>
            </div>

            {activeVariant?.systemPrompt && (
              <section className="rounded-lg border border-border bg-background p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-medium text-foreground">Browser test: {activeVariant.label}</h2>
                    <p className="text-xs text-muted-foreground">Uses this variant&apos;s generated runtime system prompt.</p>
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setActiveTestKey(null)}>
                    <X className="size-3.5" />
                    Close
                  </Button>
                </div>
                <VoiceTestPanel
                  systemPrompt={activeVariant.systemPrompt}
                  firstMessage={activeVariant.firstMessage ?? "Namaste, main team se bol rahi hoon. Kya abhi ek minute baat ho payegi?"}
                  voice={DEFAULT_GEMINI_VOICE}
                  datasetId={run.dataset.id}
                  modelLabel="Browser voice test"
                  campaignName={activeVariant.campaignName || activeVariant.label}
                />
              </section>
            )}

            <Tabs value={artifact} onValueChange={(value) => setArtifact(value as ArtifactTab)}>
              <TabsList variant="line">
                <TabsTrigger value="script">Script</TabsTrigger>
                <TabsTrigger value="runtime">Runtime Prompt</TabsTrigger>
                <TabsTrigger value="workflow">Workflow</TabsTrigger>
                <TabsTrigger value="prompts">Generator Prompts</TabsTrigger>
              </TabsList>
              {(["script", "runtime", "workflow", "prompts"] as const).map((tab) => (
                <TabsContent key={tab} value={tab}>
                  <div className="overflow-x-auto pb-2">
                    <div className="grid min-w-full gap-4" style={comparisonColumns(run.variants.length)}>
                      {run.variants.map((variant) => (
                        <VariantColumn key={variant.key} variant={variant} artifact={tab} />
                      ))}
                    </div>
                  </div>
                </TabsContent>
              ))}
            </Tabs>

            {run.simulations.length > 0 && (
              <section className="rounded-lg border border-border bg-background">
                <div className="border-b border-border px-3 py-2">
                  <h2 className="text-sm font-medium text-foreground">Customer simulations</h2>
                </div>
                <div className="divide-y divide-border">
                  {run.simulations.map((simulation) => (
                    <div key={simulation.utterance} className="p-3">
                      <div className="mb-3 text-sm text-foreground">{simulation.utterance}</div>
                      <div className="overflow-x-auto pb-1">
                        <div className="grid min-w-full gap-3" style={comparisonColumns(simulation.responses.length)}>
                          {simulation.responses.map((response) => (
                            <div key={response.variantKey} className="rounded-md border border-border bg-muted/20">
                              <div className="border-b border-border px-3 py-2 text-xs font-medium text-foreground">
                                {response.label}
                              </div>
                              <pre className="whitespace-pre-wrap p-3 text-xs leading-5 text-muted-foreground">
                                {response.error || response.response}
                              </pre>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
