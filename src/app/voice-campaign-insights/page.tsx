import { Sparkles } from "lucide-react";
import { VoiceCampaignClusterVisualization } from "@/components/voice-campaigns/voice-campaign-cluster-visualization";
import {
  latestVoiceInsightRunId,
  loadVoiceCampaignInsights,
} from "@/lib/voice-campaign-insights-loader";

export const dynamic = "force-dynamic";

export default function VoiceCampaignInsightsPage() {
  const runId = latestVoiceInsightRunId();
  const insights = runId ? loadVoiceCampaignInsights(runId) : undefined;

  if (!insights) {
    return (
      <main className="flex h-full min-h-0 items-center justify-center p-6">
        <section className="max-w-md rounded-lg bg-background p-8 text-center shadow-[0_0_0_1px_var(--color-border)]">
          <Sparkles className="mx-auto mb-4 size-10 text-muted-foreground" />
          <h1 className="text-xl font-semibold">No voice insights found</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Generate and analyze a transcript run to populate this dashboard.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="h-full min-h-0 overflow-y-auto p-6">
      <div className="mx-auto w-full max-w-[1500px] space-y-5">
        <section className="bg-background px-1 py-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Sparkles className="size-3.5" />
            <span>Post-campaign intelligence</span>
            <span>Run {insights.runId}</span>
            <span>{insights.calls.toLocaleString()} calls</span>
          </div>

          <h1 className="mt-4 max-w-5xl text-balance text-3xl font-semibold leading-tight">
            {insights.headline}
          </h1>
        </section>

        <VoiceCampaignClusterVisualization insights={insights} />
      </div>
    </main>
  );
}
