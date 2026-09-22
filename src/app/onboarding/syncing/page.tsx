"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { Upload, FileSpreadsheet, Brain, Sparkles, CheckCircle2, Loader2, AlertCircle, ArrowLeft, Database, Users } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { setWizardStep, setSelectedDataset, setSelectedConnectors, getWizardState, completeWizard } from "@/lib/onboarding-wizard-store";
import { getPendingUpload, clearPendingUpload } from "@/lib/onboarding-upload-store";

interface Stage {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const UPLOAD_STAGES: Stage[] = [
  { id: "uploading", label: "Uploading file", icon: Upload },
  { id: "parsing", label: "Parsing columns & types", icon: FileSpreadsheet },
  { id: "enriching", label: "Building AI context", icon: Brain },
  { id: "finalizing", label: "Finalizing dataset", icon: Sparkles },
];

const SAMPLE_STAGES: Stage[] = [
  { id: "loading", label: "Loading dataset", icon: Database },
  { id: "enriching", label: "Building AI context", icon: Brain },
  { id: "segments", label: "Creating sample workspace", icon: Users },
  { id: "finalizing", label: "Finalizing", icon: Sparkles },
];

export default function SyncingStep() {
  const router = useRouter();
  const [activeStage, setActiveStage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const started = useRef(false);

  // Detect mode: upload (has pending file) vs sample (has selectedDataset from wizard)
  const pending = typeof window !== "undefined" ? getPendingUpload() : null;
  const wizardState = typeof window !== "undefined" ? getWizardState() : null;
  const isSampleMode = !pending && !!wizardState?.selectedDataset;
  const STAGES = isSampleMode ? SAMPLE_STAGES : UPLOAD_STAGES;

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    if (isSampleMode) {
      // ── Sample dataset flow ──
      const datasetId = wizardState!.selectedDataset;
      const timers: ReturnType<typeof setTimeout>[] = [];
      timers.push(setTimeout(() => setActiveStage(1), 1500));
      timers.push(setTimeout(() => setActiveStage(2), 3000));

      (async () => {
        try {
          if (datasetId === "fundsindia") {
            await apiFetch("/api/sample-workspace/setup", {
              method: "POST",
              body: { datasetId },
              datasetId,
              skipModel: true,
            });
            // Starter chats are best-effort — failure shouldn't block onboarding.
            await apiFetch("/api/conversations/generate-starters", {
              method: "POST",
              body: { datasetId },
              datasetId,
              skipModel: true,
            }).catch(() => {});
          } else {
            // Segments are required (failure aborts onboarding); metrics, funnels,
            // retentions and starter chats are best-effort and can be retried.
            const [segRes, metricsRes, funnelRes, retentionRes, chatRes] = await Promise.allSettled([
              apiFetch("/api/segments/generate-all", { method: "POST", body: { datasetId }, datasetId, skipModel: true }),
              apiFetch("/api/metrics/generate", { method: "POST", body: { datasetId }, datasetId, skipModel: true }),
              apiFetch("/api/funnels/generate-starters", { method: "POST", body: { datasetId }, datasetId, skipModel: true }),
              apiFetch("/api/retentions/generate-starters", { method: "POST", body: { datasetId }, datasetId, skipModel: true }),
              apiFetch("/api/conversations/generate-starters", { method: "POST", body: { datasetId }, datasetId, skipModel: true }),
            ]);

            if (segRes.status === "rejected") {
              console.warn("[onboarding] segment generation failed:", segRes.reason);
              // Don't throw — let user proceed and trigger from segments page
            }
            if (metricsRes.status === "rejected") {
              console.warn("[onboarding] metric generation failed (non-fatal)");
            }
            if (funnelRes.status === "rejected") {
              console.warn("[onboarding] funnel starter generation failed (non-fatal)");
            }
            if (retentionRes.status === "rejected") {
              console.warn("[onboarding] retention starter generation failed (non-fatal)");
            }
            if (chatRes.status === "rejected") {
              console.warn("[onboarding] starter chat seeding failed (non-fatal)");
            }
          }

          setActiveStage(SAMPLE_STAGES.length);
          setDone(true);
          completeWizard();

          setTimeout(() => {
            router.push("/");
          }, 1200);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Setup failed.");
        } finally {
          timers.forEach(clearTimeout);
        }
      })();

      return () => timers.forEach(clearTimeout);
    }

    // ── Upload flow ──
    if (!pending) {
      router.replace("/onboarding/connect");
      return;
    }

    const { file, label } = pending;

    const timers: ReturnType<typeof setTimeout>[] = [];
    timers.push(setTimeout(() => setActiveStage(1), 3000));
    timers.push(setTimeout(() => setActiveStage(2), 8000));
    timers.push(setTimeout(() => setActiveStage(3), 20000));

    (async () => {
      try {
        const formData = new FormData();
        formData.append("label", label);
        formData.append("file", file);

        const res = await fetch("/api/datasets/upload", {
          method: "POST",
          body: formData,
        });

        let data: { id?: string; error?: string };
        try {
          data = await res.json();
        } catch {
          throw new Error("Upload timed out. Try a smaller file.");
        }

        if (!res.ok) {
          throw new Error(data.error ?? `Upload failed (${res.status})`);
        }

        if (!data.id) {
          throw new Error("Upload succeeded but no dataset ID was returned.");
        }

        setActiveStage(UPLOAD_STAGES.length);
        setDone(true);
        clearPendingUpload();

        setSelectedDataset(data.id);
        setSelectedConnectors(["csv-upload"]);
        setWizardStep("complete");

        setTimeout(() => {
          router.push("/onboarding/complete");
        }, 1200);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed.");
        clearPendingUpload();
      } finally {
        timers.forEach(clearTimeout);
      }
    })();

    return () => timers.forEach(clearTimeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleRetry() {
    setError(null);
    setWizardStep("connect");
    router.push("/onboarding/connect");
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
      className="w-full max-w-md"
    >
      <h1 className="text-[19.8px] font-semibold text-[#18181b] text-center mb-2">
        {error ? "Something went wrong" : done ? "All set" : isSampleMode ? "Setting up your workspace" : "Processing your data"}
      </h1>
      <p className="text-[11.7px] text-[#71717a] text-center mb-10">
        {error
          ? isSampleMode
            ? "We couldn\u2019t set up the dataset. You can try again."
            : "We couldn\u2019t process your file. You can try again with a different file."
          : done
            ? "Your dataset is ready. Redirecting..."
            : isSampleMode
              ? "Generating your starter workspace and building your AI data model."
              : "Analyzing your schema and building your AI data model."}
      </p>

      {/* Progress stages */}
      <div className="space-y-1 mb-10">
        {STAGES.map((stage, i) => {
          const isActive = i === activeStage && !error && !done;
          const isComplete = i < activeStage || done;
          const isFailed = error && i === activeStage;
          const Icon = stage.icon;

          return (
            <motion.div
              key={stage.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.08, duration: 0.25 }}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                isActive ? "bg-[#f4f4f5]" : ""
              }`}
            >
              {/* Status icon */}
              <div className="w-8 h-8 rounded-lg shrink-0 flex items-center justify-center bg-card border border-[#e4e4e7]">
                {isComplete ? (
                  <CheckCircle2 className="w-4 h-4 text-[#18181b]" />
                ) : isFailed ? (
                  <AlertCircle className="w-4 h-4 text-[#dc2626]" />
                ) : isActive ? (
                  <Loader2 className="w-4 h-4 text-[#18181b] animate-spin" />
                ) : (
                  <Icon className="w-4 h-4 text-[#71717a]" />
                )}
              </div>

              {/* Label */}
              <span
                className={`text-[12.6px] transition-colors ${
                  isComplete
                    ? "text-[#18181b]"
                    : isFailed
                      ? "text-[#dc2626]"
                      : isActive
                        ? "text-[#18181b] font-medium"
                        : "text-[#71717a]"
                }`}
              >
                {stage.label}
              </span>
            </motion.div>
          );
        })}
      </div>

      {/* Error retry */}
      {error && (
        <div className="space-y-3">
          <p className="text-[10.8px] text-[#dc2626] text-center">{error}</p>
          <button
            onClick={handleRetry}
            className="w-full h-11 rounded-lg border border-[#e4e4e7] text-[12.6px] text-[#18181b] font-medium hover:bg-[#f4f4f5] active:scale-[0.97] transition-all flex items-center justify-center gap-2"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Try Again
          </button>
        </div>
      )}
    </motion.div>
  );
}
