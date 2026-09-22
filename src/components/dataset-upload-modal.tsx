"use client";

import { useState, useRef, useCallback } from "react";
import { X, Upload, Loader2 } from "lucide-react";
import { useDataset } from "@/lib/dataset-context";
import { slugify } from "@/lib/datasets/utils";

interface DatasetUploadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function fileToLabel(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, "") // strip extension
    .replace(/[-_]+/g, " ") // hyphens/underscores → spaces
    .replace(/\b\w/g, (c) => c.toUpperCase()) // title-case
    .trim();
}

export function DatasetUploadModal({ open, onOpenChange }: DatasetUploadModalProps) {
  const { datasetId, allDatasets, refreshDatasets, switchDataset } = useDataset();

  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState("");
  const [labelTouched, setLabelTouched] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const resetState = useCallback(() => {
    setFile(null);
    setLabel("");
    setLabelTouched(false);
    setIsLoading(false);
    setError(null);
    abortControllerRef.current = null;
  }, []);

  const handleClose = useCallback(() => {
    if (isLoading) {
      abortControllerRef.current?.abort();
    }
    onOpenChange(false);
    // Delay reset so the modal has time to animate out
    setTimeout(resetState, 300);
  }, [isLoading, onOpenChange, resetState]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    if (!picked) return;
    setFile(picked);
    setError(null);
    if (!labelTouched) {
      setLabel(fileToLabel(picked.name));
    }
    // Reset input so same file can be re-selected
    e.target.value = "";
  };

  const handleLabelChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLabel(e.target.value);
    setLabelTouched(true);
    setError(null);
  };

  const handleSubmit = async () => {
    if (!file || !label.trim() || isLoading) return;

    // Client-side pre-flight validation
    if (!slugify(label.trim())) {
      setError("Label must contain at least one letter or number.");
      return;
    }
    if (allDatasets.some((d) => d.label.toLowerCase() === label.trim().toLowerCase())) {
      setError("A dataset with this name already exists.");
      return;
    }
    const sizeLimitMB = file.name.toLowerCase().endsWith(".duckdb") ? 150 : 50;
    if (file.size > sizeLimitMB * 1024 * 1024) {
      setError(`File exceeds the ${sizeLimitMB} MB limit.`);
      return;
    }

    setIsLoading(true);
    setError(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const formData = new FormData();
      formData.append("label", label.trim());
      formData.append("file", file);

      const res = await fetch("/api/datasets/upload", {
        method: "POST",
        signal: controller.signal,
        headers: { "x-dataset-id": datasetId },
        body: formData,
      });

      // Non-JSON guard — handles 504 Gateway Timeout (no JSON body)
      let data: { id?: string; error?: string };
      try {
        data = await res.json();
      } catch {
        throw new Error("Upload timed out — try a smaller file.");
      }

      if (!res.ok) {
        throw new Error(data.error ?? `Upload failed (${res.status})`);
      }

      const newId = data.id;
      if (!newId) {
        throw new Error("Upload succeeded but no dataset ID was returned.");
      }

      // Await refresh BEFORE switching so the new dataset is in allDatasets
      // before the header re-renders with the new datasetId.
      await refreshDatasets();
      switchDataset(newId);
      onOpenChange(false);
      setTimeout(resetState, 300);
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") {
        // User dismissed while in-flight — silently reset
        return;
      }
      setError(err instanceof Error ? err.message : "Upload failed.");
      setIsLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-background/60 backdrop-blur-md flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isLoading) handleClose();
      }}
    >
      <div className="bg-background rounded-lg border border-border shadow-lg w-full max-w-sm mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-5 pb-4">
          <h2 className="text-base font-semibold">Upload dataset</h2>
          <button
            onClick={handleClose}
            disabled={isLoading}
            className="p-1 hover:bg-muted rounded-md transition-colors disabled:opacity-40 disabled:pointer-events-none"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 pb-5 flex flex-col gap-4">
          {/* File drop zone */}
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.duckdb"
              onChange={handleFileChange}
              className="hidden"
              disabled={isLoading}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
              className="flex flex-col items-center justify-center gap-2 w-full py-6 border-2 border-dashed border-border rounded-lg text-muted-foreground hover:border-foreground/30 hover:text-foreground transition-colors disabled:pointer-events-none disabled:opacity-50"
            >
              <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center">
                <Upload className="w-4 h-4" />
              </div>
              {file ? (
                <div className="text-center">
                  <p className="text-sm font-medium text-foreground">{file.name}</p>
                  <p className="text-[9.9px] text-muted-foreground mt-0.5">Click to replace</p>
                </div>
              ) : (
                <div className="text-center">
                  <p className="text-sm font-medium">Choose a file</p>
                  <p className="text-[9.9px] text-muted-foreground mt-0.5">.csv or .duckdb</p>
                </div>
              )}
            </button>
          </div>

          {/* Label input */}
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Dataset name</label>
            <input
              type="text"
              value={label}
              onChange={handleLabelChange}
              placeholder="e.g. Q4 Sales Data"
              disabled={isLoading}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:opacity-50"
            />
            {error && (
              <p className="text-xs text-muted-foreground mt-1.5">{error}</p>
            )}
          </div>

          {/* In-progress hint */}
          {isLoading && (
            <p className="text-[9.9px] text-muted-foreground text-center">
              Processing... This may take up to 2 minutes.
            </p>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={handleClose}
              disabled={isLoading}
              className="px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:pointer-events-none"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!file || !label.trim() || isLoading}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium bg-foreground text-background rounded-md hover:bg-foreground/90 transition-colors disabled:opacity-50 disabled:pointer-events-none"
            >
              {isLoading && <Loader2 className="w-3 h-3 animate-spin" />}
              {isLoading ? "Uploading..." : "Upload"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
