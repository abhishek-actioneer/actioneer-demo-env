"use client";

import { useState, useRef, useCallback } from "react";
import {
  Play,
  Image as ImageIcon,
  Clapperboard,
  Loader2,
  Sparkles,
  Link as LinkIcon,
  FileJson,
  Calendar,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CreativeDetail } from "@/components/ad-creative/creative-detail";
import { CreativeDetailV2 } from "@/components/ad-creative/creative-detail-v2";
import type {
  AnalyzedCreative,
  AnalyzePhase,
  CreativeAnalysis,
  CreativeAnalysisV2,
  ReportData,
  ReportSummary,
} from "@/lib/ad-creative-types";
import { PHASE_LABELS } from "@/lib/ad-creative-types";

export default function AdCreativePage() {
  const [creatives, setCreatives] = useState<AnalyzedCreative[]>([]);
  const [report, setReport] = useState<ReportData | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<AnalyzePhase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const analyzing = phase !== null && phase !== "complete" && phase !== "error";
  const selected = creatives.find((c) => c.id === selectedId) ?? null;

  const analyzeUrl = useCallback(async () => {
    if (!url.trim() || analyzing) return;
    setPhase("downloading");
    setError(null);

    try {
      const res = await fetch("/api/ad-creative/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop()!;

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const data = JSON.parse(line.slice(5).trim());

          if (data.phase === "error") {
            setError(data.message);
            setPhase("error");
            return;
          }

          if (data.phase === "complete") {
            const creative = data.creative as AnalyzedCreative;
            setCreatives((prev) => [creative, ...prev]);
            setSelectedId(creative.id);
            setPhase("complete");
            setUrl("");
            return;
          }

          setPhase(data.phase);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
      setPhase("error");
    }
  }, [url, analyzing]);

  const importReport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);

        // Case 1: Single v2 analysis JSON (has `chapterization`)
        if (data.chapterization && data._meta?.schema_version === "v2") {
          const id = file.name.replace(/\.json$/, "");
          const meta = data._meta as Record<string, unknown>;
          const creative: AnalyzedCreative = {
            id,
            url: "",
            type: (meta.mode === "ad" ? "video" : "video") as "video",
            mimeType: "video/mp4",
            analyzedAt: new Date().toISOString(),
            schemaVersion: "v2",
            analysis: {} as CreativeAnalysis,
            analysisV2: data as CreativeAnalysisV2,
            adHeadline: id,
          };
          setCreatives([creative]);
          setReport(null);
          setSelectedId(id);
          return;
        }

        // Case 2: Report JSON with `creatives` array (v1)
        const imported: AnalyzedCreative[] = (data.creatives ?? []).map(
          (c: Record<string, unknown>) => ({
            id: c.creative_id as string,
            url: (c.url as string) || "",
            type: c.type as "video" | "image",
            mimeType: c.type === "video" ? "video/mp4" : "image/jpeg",
            analyzedAt: data.generated_at ?? new Date().toISOString(),
            schemaVersion: "v1",
            analysis: c.analysis as CreativeAnalysis,
            networks: c.networks as string[] | undefined,
            firstSeen: c.first_seen as string | undefined,
            lastSeen: c.last_seen as string | undefined,
            dimensions: c.dimensions as string | undefined,
            videoDurationSec: c.video_duration_sec as string | null | undefined,
            advertiserName: c.advertiser_name as string | undefined,
            adBodyText: c.ad_body_text as string | undefined,
            adHeadline: c.ad_headline as string | undefined,
            adCta: c.ad_cta as string | undefined,
            startDate: c.start_date as string | undefined,
            status: c.status as string | undefined,
          })
        );
        setCreatives(imported);
        if (data.summary) {
          setReport({
            app_name: data.app_name ?? "Unknown",
            generated_at: data.generated_at ?? "",
            summary: data.summary as ReportSummary,
          });
        }
        setSelectedId(null);
      } catch {
        setError("Invalid report JSON");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }, []);

  /* ── Column 1: Strip (single-column list of creatives) ───────────────── */
  const strip = (
    <div className="w-[320px] shrink-0 border-r border-border flex flex-col min-h-0">
      {/* Strip header */}
      <div className="px-4 py-5 border-b border-border space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-semibold text-foreground">Ad Creatives</h1>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={importReport}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            className="gap-1.5 shrink-0"
          >
            <FileJson className="size-3.5" />
            Import
          </Button>
        </div>

        {/* Input */}
        <div className="space-y-2">
          <div className="relative">
            <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Paste URL to analyze…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && analyzeUrl()}
              className="pl-9 h-9"
              disabled={analyzing}
            />
          </div>
          <Button
            onClick={analyzeUrl}
            disabled={analyzing || !url.trim()}
            className="gap-1.5 w-full"
            size="sm"
          >
            {analyzing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            Analyze
          </Button>
        </div>

        {analyzing && phase && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground animate-pulse">
            <Loader2 className="size-3 animate-spin" />
            {PHASE_LABELS[phase]}
          </div>
        )}
        {error && <p className="text-xs text-muted-foreground">{error}</p>}

        {report && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[9.9px] text-muted-foreground">
            <span className="font-medium text-foreground">{report.app_name}</span>
            <span>{report.summary.total_creatives} total</span>
            <span>{report.summary.by_type.video}v · {report.summary.by_type.image}i</span>
          </div>
        )}
      </div>

      {/* Strip list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {creatives.length > 0 ? (
          <ul className="p-3 space-y-2">
            {creatives.map((creative) => {
              const isSelected = creative.id === selectedId;
              return (
                <li key={creative.id}>
                  <button
                    onClick={() => setSelectedId(creative.id)}
                    className={`w-full text-left rounded-md overflow-hidden border border-border transition-colors ${
                      isSelected
                        ? "bg-accent/40 ring-1 ring-foreground/15 ring-inset"
                        : "hover:bg-accent/20"
                    }`}
                  >
                    <div className="aspect-video bg-muted/30 overflow-hidden relative">
                      {creative.url ? (
                        creative.type === "video" ? (
                          <>
                            <video
                              src={creative.url}
                              className="absolute inset-0 w-full h-full object-cover"
                              preload="metadata"
                              muted
                            />
                            <div className="absolute inset-0 flex items-center justify-center">
                              <div className="size-9 rounded-full bg-black/50 flex items-center justify-center backdrop-blur-sm">
                                <Play className="size-3.5 text-white fill-white ml-0.5" />
                              </div>
                            </div>
                          </>
                        ) : (
                          <img // eslint-disable-line @next/next/no-img-element
                            src={creative.url}
                            alt=""
                            loading="lazy"
                            className="absolute inset-0 w-full h-full object-cover"
                          />
                        )
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                          {creative.type === "video" ? <Play className="size-5" /> : <ImageIcon className="size-5" />}
                        </div>
                      )}
                    </div>
                    <div className="px-3 py-2.5 space-y-1">
                      <p className="text-xs font-medium truncate">
                        {creative.adHeadline || creative.advertiserName || "Untitled"}
                      </p>
                      {creative.adBodyText && (
                        <p className="text-[9.9px] text-muted-foreground line-clamp-2">
                          {creative.adBodyText}
                        </p>
                      )}
                      <div className="flex items-center gap-2 pt-0.5">
                        <span className="text-[9px] text-muted-foreground/70 flex items-center gap-1">
                          {creative.type === "video" ? <Play className="size-2.5" /> : <ImageIcon className="size-2.5" />}
                          {creative.type}
                        </span>
                        {creative.startDate && (
                          <span className="text-[9px] text-muted-foreground/70 flex items-center gap-1">
                            <Calendar className="size-2.5" />
                            {creative.startDate}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          !analyzing && (
            <div className="flex h-full flex-col items-center justify-center px-6 py-16 text-center">
              <Clapperboard className="size-10 text-muted-foreground mb-3" />
              <p className="text-xs text-muted-foreground">
                Paste a URL above or import a report.
              </p>
            </div>
          )
        )}
      </div>
    </div>
  );

  /* ── Column 2: Viewer (media only) ───────────────────────────────────── */
  const viewer = (
    <div className="flex-1 min-w-0 border-r border-border flex flex-col min-h-0">
      {selected ? (
        <>
          <div className="flex items-center justify-between px-6 h-14 shrink-0 border-b border-border">
            <div className="flex items-center gap-3 min-w-0">
              <Badge variant="outline" className="gap-1 shrink-0">
                {selected.type === "video" ? <Play className="size-3" /> : <ImageIcon className="size-3" />}
                {selected.type}
              </Badge>
              {selected.startDate && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Calendar className="size-3" />
                  {selected.startDate}
                </span>
              )}
              <span className="text-xs font-mono text-muted-foreground truncate">
                {selected.id}
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setSelectedId(null)}
              aria-label="Close"
            >
              <X className="size-4" />
            </Button>
          </div>
          <div className="flex-1 flex items-center justify-center p-6 min-h-0 overflow-hidden">
            {selected.url ? (
              selected.type === "video" ? (
                <video
                  key={selected.id}
                  src={selected.url}
                  controls
                  className="h-full w-auto max-w-full object-contain"
                  preload="metadata"
                />
              ) : (
                <img // eslint-disable-line @next/next/no-img-element
                  key={selected.id}
                  src={selected.url}
                  alt="Creative"
                  className="h-full w-auto max-w-full object-contain"
                />
              )
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
                {selected.type === "video" ? <Play className="size-8" /> : <ImageIcon className="size-8" />}
                <span className="text-xs">No media available</span>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center text-center px-6">
          <p className="text-sm text-muted-foreground">
            Select a creative from the strip to preview it.
          </p>
        </div>
      )}
    </div>
  );

  /* ── Column 3: Analysis ──────────────────────────────────────────────── */
  const analysis = (
    <div className="w-[440px] shrink-0 flex flex-col min-h-0">
      {selected ? (
        <>
          <div className="flex items-center gap-2 px-6 h-14 shrink-0 border-b border-border">
            <h2 className="text-sm font-semibold truncate min-w-0">
              {selected.adHeadline || selected.advertiserName || "Analysis"}
            </h2>
            {selected.adCta && (
              <Badge variant="outline" className="shrink-0">
                {selected.adCta}
              </Badge>
            )}
          </div>
          <div className="flex-1 overflow-y-auto min-h-0 px-6 pt-6 pb-24">
            {selected.advertiserName && selected.adHeadline && (
              <p className="text-xs text-muted-foreground mb-4 -mt-1">
                {selected.advertiserName}
              </p>
            )}
            {selected.schemaVersion === "v2" && selected.analysisV2 ? (
              <CreativeDetailV2 analysis={selected.analysisV2} />
            ) : (
              <CreativeDetail creative={selected} />
            )}
          </div>
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center text-center px-6">
          <p className="text-sm text-muted-foreground">
            Analysis and insights will appear here.
          </p>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex h-full min-w-0">
      {strip}
      {viewer}
      {analysis}
    </div>
  );
}
