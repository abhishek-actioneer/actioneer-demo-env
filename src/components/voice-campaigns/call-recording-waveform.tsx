"use client";

import { AlertCircle, Download, Loader2, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type WaveSurferInstance = import("wavesurfer.js").default;

interface CallRecordingWaveformProps {
  src: string;
  durationSeconds?: number;
  contentType?: string;
  channels?: number;
  downloadName?: string;
  className?: string;
}

function formatWaveTime(seconds: number | undefined): string {
  if (!seconds || !Number.isFinite(seconds) || seconds < 0) return "0:00";
  const rounded = Math.floor(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainingSeconds = rounded % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
  }

  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function cssToken(element: HTMLElement, token: string, fallback: string): string {
  return getComputedStyle(element).getPropertyValue(token).trim() || fallback;
}

function downloadFilename(src: string, contentType?: string, downloadName?: string): string {
  if (downloadName) return downloadName;
  const extension = contentType?.includes("wav") ? "wav" : contentType?.includes("mpeg") ? "mp3" : "audio";
  const id = src.split("/").filter(Boolean).at(-1)?.split("?")[0] || "recording";
  return `${decodeURIComponent(id)}.${extension}`;
}

export function CallRecordingWaveform({
  src,
  durationSeconds,
  contentType,
  channels,
  downloadName,
  className,
}: CallRecordingWaveformProps) {
  const waveformRef = useRef<HTMLDivElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const waveSurferRef = useRef<WaveSurferInstance | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(durationSeconds ?? 0);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isSplitChannel = (channels ?? 0) > 1;
  const filename = downloadFilename(src, contentType, downloadName);

  useEffect(() => {
    const waveformEl = waveformRef.current;
    const timelineEl = timelineRef.current;
    if (!waveformEl || !timelineEl) return;

    let cancelled = false;
    setCurrentTime(0);
    setDuration(durationSeconds ?? 0);
    setLoadingProgress(0);
    setIsReady(false);
    setIsPlaying(false);
    setError(null);
    waveformEl.replaceChildren();
    timelineEl.replaceChildren();

    void (async () => {
      try {
        const [{ default: WaveSurfer }, { default: TimelinePlugin }, { default: HoverPlugin }] = await Promise.all([
          import("wavesurfer.js"),
          import("wavesurfer.js/dist/plugins/timeline.esm.js"),
          import("wavesurfer.js/dist/plugins/hover.esm.js"),
        ]);

        if (cancelled) return;

        const foreground = cssToken(waveformEl, "--foreground", "oklch(0.87 0.015 65)");
        const mutedForeground = cssToken(waveformEl, "--muted-foreground", "oklch(0.52 0.008 65)");
        const border = cssToken(waveformEl, "--border", "oklch(0.265 0.002 75)");
        const background = cssToken(waveformEl, "--background", "oklch(0.175 0.002 75)");

        const waveSurfer = WaveSurfer.create({
          container: waveformEl,
          url: src,
          duration: durationSeconds,
          height: isSplitChannel ? 112 : 92,
          normalize: true,
          waveColor: mutedForeground,
          progressColor: foreground,
          cursorColor: foreground,
          cursorWidth: 1,
          barWidth: 2,
          barGap: 1,
          barRadius: 2,
          barMinHeight: 1,
          dragToSeek: true,
          hideScrollbar: true,
          splitChannels: isSplitChannel
            ? [
                {
                  height: 48,
                  waveColor: mutedForeground,
                  progressColor: foreground,
                  cursorColor: foreground,
                },
                {
                  height: 48,
                  waveColor: border,
                  progressColor: foreground,
                  cursorColor: foreground,
                },
              ]
            : undefined,
          plugins: [
            TimelinePlugin.create({
              container: timelineEl,
              height: 24,
              formatTimeCallback: formatWaveTime,
              style: {
                color: mutedForeground,
                fontFamily: "var(--font-geist-mono)",
                fontSize: "9.9px",
              },
            }),
            HoverPlugin.create({
              lineColor: foreground,
              labelColor: background,
              labelBackground: foreground,
              labelSize: 11,
              formatTimeCallback: formatWaveTime,
            }),
          ],
        });

        waveSurferRef.current = waveSurfer;
        waveSurfer.on("loading", (progress) => setLoadingProgress(progress));
        waveSurfer.on("ready", (readyDuration) => {
          setDuration(readyDuration);
          setIsReady(true);
          setLoadingProgress(100);
        });
        waveSurfer.on("timeupdate", (time) => setCurrentTime(time));
        waveSurfer.on("seeking", (time) => setCurrentTime(time));
        waveSurfer.on("play", () => setIsPlaying(true));
        waveSurfer.on("pause", () => setIsPlaying(false));
        waveSurfer.on("finish", () => {
          setIsPlaying(false);
          setCurrentTime(waveSurfer.getDuration());
        });
        waveSurfer.on("error", () => {
          setError("Recording waveform could not be loaded.");
          setIsReady(false);
        });
      } catch {
        if (!cancelled) setError("Recording waveform could not be loaded.");
      }
    })();

    return () => {
      cancelled = true;
      waveSurferRef.current?.destroy();
      waveSurferRef.current = null;
    };
  }, [src, durationSeconds, isSplitChannel]);

  const togglePlayback = () => {
    if (!isReady || error) return;
    void waveSurferRef.current?.playPause();
  };

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Recording</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {isSplitChannel ? "Two-channel call audio" : contentType ?? "Audio"}
          </p>
        </div>
        <p className="font-mono text-xs tabular-nums text-muted-foreground">
          {formatWaveTime(currentTime)} / {formatWaveTime(duration)}
        </p>
      </div>

      <div className="relative overflow-hidden px-0 py-2">
        {isSplitChannel && (
          <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-col gap-[34px] text-[9px] font-medium uppercase text-muted-foreground">
            <span>User</span>
            <span>Agent</span>
          </div>
        )}
        <div ref={waveformRef} className={cn("min-h-[92px]", isSplitChannel && "pl-11")} />
        <div ref={timelineRef} className={cn("mt-1 h-6 overflow-hidden", isSplitChannel && "pl-11")} />
        {!isReady && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/70">
            <div className="inline-flex items-center gap-2 rounded-md bg-background px-3 py-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Loading waveform {loadingProgress > 0 ? `${Math.round(loadingProgress)}%` : ""}
            </div>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80">
            <div className="inline-flex items-center gap-2 rounded-md bg-background px-3 py-1.5 text-xs text-muted-foreground">
              <AlertCircle className="size-3.5" />
              {error}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={togglePlayback}
          disabled={!isReady || Boolean(error)}
          aria-label={isPlaying ? "Pause recording" : "Play recording"}
          className="inline-flex size-10 items-center justify-center rounded-md bg-foreground text-background transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-40"
        >
          {isPlaying ? <Pause className="size-4" /> : <Play className="size-4 translate-x-px" />}
        </button>
        <a
          href={src}
          download={filename}
          className="inline-flex h-10 items-center gap-2 rounded-md bg-muted px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <Download className="size-4" />
          Audio
        </a>
      </div>
    </div>
  );
}
