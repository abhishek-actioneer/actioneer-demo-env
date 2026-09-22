"use client";

import { useEffect, useState } from "react";
import { FileUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Segment } from "@/lib/types";

export function CsvAudienceUploadDialog({
  open,
  onOpenChange,
  datasetId,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  datasetId: string;
  onUploaded: (segment: Segment) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
    setFile(null);
    setName("");
    setError(null);
    setUploading(false);
  }, [open]);

  const chooseFile = (nextFile: File | null) => {
    setFile(nextFile);
    setError(null);
    if (nextFile && !name.trim()) {
      setName(nextFile.name.replace(/\.csv$/i, "").replace(/[_-]+/g, " "));
    }
  };

  const upload = async () => {
    if (!file || !name.trim() || uploading) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("name", name.trim());
      // FormData is the documented exception to apiFetch's JSON-only body handling.
      const response = await fetch("/api/segments/upload", {
        method: "POST",
        headers: { "x-dataset-id": datasetId },
        body: formData,
      });
      const result = await response.json() as Segment | { error?: string };
      if (!response.ok) {
        throw new Error("error" in result && result.error ? result.error : "Upload failed.");
      }
      onUploaded(result as Segment);
      onOpenChange(false);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !uploading && onOpenChange(nextOpen)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload audience CSV</DialogTitle>
          <DialogDescription>
            Each data row becomes one audience member. The first row must contain unique column names.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="audience-csv" className="text-sm font-medium">CSV file</label>
            <Input
              id="audience-csv"
              type="file"
              accept=".csv,text/csv"
              disabled={uploading}
              onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
              className="h-10 py-1.5"
            />
            <p className="text-xs text-muted-foreground">Maximum 10 MB, 100 columns, and 100,000 rows.</p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="audience-name" className="text-sm font-medium">Audience name</label>
            <Input
              id="audience-name"
              value={name}
              maxLength={200}
              disabled={uploading}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. July renewal audience"
            />
          </div>

          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={uploading}>Cancel</Button>
          <Button onClick={upload} disabled={!file || !name.trim() || uploading}>
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}
            {uploading ? "Uploading" : "Upload audience"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
