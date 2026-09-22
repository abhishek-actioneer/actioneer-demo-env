"use client";

import { useState, useRef } from "react";
import { apiFetch } from "@/lib/api-client";
import { useModel } from "@/lib/model-context";
import { X, Loader2, Check, FileText, Upload, Link, Globe } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { KnowledgeSelect } from "@/components/knowledge/knowledge-select";
import type {
  KnowledgeEntry,
  KnowledgeLevel,
  KnowledgePriority,
} from "@/lib/knowledge-types";
import { KNOWLEDGE_PRIORITIES } from "@/lib/knowledge-types";

type InputMode = "paste" | "file" | "url";

interface KnowledgeImportProps {
  mode: "paste" | "notion";
  defaultLevel: KnowledgeLevel;
  defaultInputMode?: InputMode;
  initialFile?: File | null;
  onSave: (entries: KnowledgeEntry[]) => void;
  onClose: () => void;
}

const PRIORITY_STYLES: Record<string, string> = {
  Critical: "bg-foreground/10 text-foreground font-semibold",
  High: "bg-muted text-foreground",
  "Good to have": "bg-muted text-muted-foreground",
};

export function KnowledgeImport({
  mode,
  defaultLevel,
  defaultInputMode = "paste",
  initialFile,
  onSave,
  onClose,
}: KnowledgeImportProps) {
  if (mode === "notion") {
    return <NotionImport onClose={onClose} />;
  }

  return (
    <PasteImport
      defaultLevel={defaultLevel}
      defaultInputMode={defaultInputMode}
      initialFile={initialFile}
      onSave={onSave}
      onClose={onClose}
    />
  );
}

// ── Paste & Import ──

function PasteImport({
  defaultLevel,
  defaultInputMode = "paste",
  initialFile,
  onSave,
  onClose,
}: {
  defaultLevel: KnowledgeLevel;
  defaultInputMode?: InputMode;
  initialFile?: File | null;
  onSave: (entries: KnowledgeEntry[]) => void;
  onClose: () => void;
}) {
  useModel(); // sync module-level model state for apiFetch
  const [rawText, setRawText] = useState("");
  const [level, setLevel] = useState<KnowledgeLevel>(defaultLevel);
  const [parsedEntries, setParsedEntries] = useState<KnowledgeEntry[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isParsing, setIsParsing] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [inputMode, setInputMode] = useState<InputMode>(defaultInputMode);
  const [urlValue, setUrlValue] = useState("");
  const [isFetchingUrl, setIsFetchingUrl] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initialFileProcessed = useRef(false);

  // Process file passed from the add modal
  if (initialFile && !initialFileProcessed.current) {
    initialFileProcessed.current = true;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setRawText(text);
      setFileName(initialFile.name);
    };
    reader.readAsText(initialFile);
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setRawText(text);
      setFileName(file.name);
    };
    reader.readAsText(file);

    // Reset input so the same file can be re-selected
    e.target.value = "";
  };

  const handleFetchUrl = async () => {
    if (!urlValue.trim() || isFetchingUrl) return;
    setIsFetchingUrl(true);
    try {
      const { text } = await apiFetch<{ text: string }>("/api/knowledge/fetch-url", {
        method: "POST",
        body: { url: urlValue.trim() },
        skipModel: true,
      });
      setRawText(text);
    } catch {
      setRawText(`[Could not fetch content from URL. Paste the content manually instead.]\n\nURL: ${urlValue}`);
    } finally {
      setIsFetchingUrl(false);
    }
  };

  const handleParse = async () => {
    if (!rawText.trim() || isParsing) return;

    setIsParsing(true);
    try {
      const { entries } = await apiFetch<{ entries: KnowledgeEntry[] }>("/api/knowledge/parse", {
        method: "POST",
        body: { text: rawText.trim(), level },
      });
      setParsedEntries(entries);
      setSelectedIds(new Set(entries.map((e: KnowledgeEntry) => e.id)));
    } catch (err) {
      console.error("Parse failed:", err);
    } finally {
      setIsParsing(false);
    }
  };

  const toggleEntry = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === parsedEntries.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(parsedEntries.map((e) => e.id)));
    }
  };

  const updateEntryPriority = (id: string, priority: KnowledgePriority) => {
    setParsedEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, priority } : e))
    );
  };

  const handleSave = () => {
    const toSave = parsedEntries.filter((e) => selectedIds.has(e.id));
    onSave(toSave);
  };

  return (
    <div className="fixed inset-0 bg-background/60 backdrop-blur-md flex items-center justify-center z-50" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-background rounded-lg border border-border shadow-lg w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 pb-0">
          <h2 className="text-base font-semibold">Paste & Import</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-muted rounded-md transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {parsedEntries.length === 0 ? (
          /* Step 1: Input */
          <div className="p-5 flex flex-col flex-1">
            <p className="text-xs text-muted-foreground mb-4">
              Import knowledge from any source. Actioneer will parse it into
              individual entries.
            </p>

            {/* Input mode tabs */}
            <div className="flex items-center gap-1 mb-4 p-1 bg-muted/50 rounded-lg w-fit">
              <button
                onClick={() => setInputMode("paste")}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  inputMode === "paste"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <FileText className="w-3 h-3" />
                Paste Text
              </button>
              <button
                onClick={() => setInputMode("file")}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  inputMode === "file"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Upload className="w-3 h-3" />
                Upload File
              </button>
              <button
                onClick={() => setInputMode("url")}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  inputMode === "url"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Link className="w-3 h-3" />
                From URL
              </button>
            </div>

            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.markdown,.txt,.csv,.json,.html,.htm"
              onChange={handleFileUpload}
              className="hidden"
            />

            {/* Paste mode */}
            {inputMode === "paste" && (
              <textarea
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder={`Paste metric definitions, glossary, business context...\n\nExample:\nARPU: Monthly revenue divided by paying users only.\nD7 Retention: % of users returning on day 7.\nAlways exclude test accounts (user_id < 1000).`}
                className="w-full border border-border rounded-lg p-3 text-sm min-h-[200px] bg-background focus:outline-none focus:ring-2 focus:ring-ring/20 mb-4 resize-y flex-1"
                autoFocus
              />
            )}

            {/* File upload mode */}
            {inputMode === "file" && (
              <div className="mb-4 flex-1 flex flex-col">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex flex-col items-center justify-center gap-3 w-full py-8 border-2 border-dashed border-border rounded-lg text-muted-foreground hover:border-foreground/30 hover:text-foreground transition-colors mb-3"
                >
                  <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                    <Upload className="w-4 h-4" />
                  </div>
                  {fileName ? (
                    <div className="text-center">
                      <p className="text-sm font-medium text-foreground">{fileName}</p>
                      <p className="text-[9.9px] text-muted-foreground mt-0.5">File loaded. Click to replace.</p>
                    </div>
                  ) : (
                    <div className="text-center">
                      <p className="text-sm font-medium">Choose a file</p>
                      <p className="text-[9.9px] text-muted-foreground mt-0.5">
                        .md, .txt, .csv, .json, .html
                      </p>
                    </div>
                  )}
                </button>
                {rawText && (
                  <textarea
                    value={rawText}
                    onChange={(e) => setRawText(e.target.value)}
                    className="w-full border border-border rounded-lg p-3 text-sm min-h-[120px] bg-background focus:outline-none focus:ring-2 focus:ring-ring/20 resize-y flex-1"
                    placeholder="File content will appear here for review..."
                  />
                )}
              </div>
            )}

            {/* URL mode */}
            {inputMode === "url" && (
              <div className="mb-4 flex-1 flex flex-col">
                <div className="flex gap-2 mb-3">
                  <div className="flex-1 relative">
                    <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <input
                      type="url"
                      value={urlValue}
                      onChange={(e) => setUrlValue(e.target.value)}
                      placeholder="https://docs.google.com/... or any public URL"
                      className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring/20"
                      autoFocus
                    />
                  </div>
                  <button
                    onClick={handleFetchUrl}
                    disabled={!urlValue.trim() || isFetchingUrl}
                    className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border border-border rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
                  >
                    {isFetchingUrl ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Link className="w-3 h-3" />
                    )}
                    {isFetchingUrl ? "Fetching..." : "Fetch"}
                  </button>
                </div>
                <p className="text-[9.9px] text-muted-foreground mb-3">
                  Works with Google Docs (published), Confluence (public), blog posts, and any publicly accessible page.
                </p>
                <textarea
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  placeholder="Fetched content will appear here for review. You can also paste content directly."
                  className="w-full border border-border rounded-lg p-3 text-sm min-h-[160px] bg-background focus:outline-none focus:ring-2 focus:ring-ring/20 resize-y flex-1"
                />
              </div>
            )}

            <div className="flex items-center justify-between">
              <div>
                <label className="text-[9.9px] text-muted-foreground mr-2">
                  Level:
                </label>
                <KnowledgeSelect
                  label="Level"
                  value={level}
                  onValueChange={(value) => setLevel(value as KnowledgeLevel)}
                  options={[{ value: "global", label: "Global Context" }, { value: "user", label: "My Preference" }]}
                  className="h-8 text-xs"
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleParse}
                  disabled={!rawText.trim() || isParsing}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium bg-foreground text-background rounded-md hover:bg-foreground/90 transition-colors disabled:opacity-50"
                >
                  {isParsing && <Loader2 className="w-3 h-3 animate-spin" />}
                  {isParsing ? "Parsing..." : "Parse & Review →"}
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* Step 2: Review */
          <div className="p-5 flex flex-col flex-1 min-h-0">
            <p className="text-xs text-muted-foreground mb-3">
              Actioneer found{" "}
              <span className="font-medium text-foreground">
                {parsedEntries.length}
              </span>{" "}
              entries. Uncheck any you don&apos;t want to save.
            </p>

            <div className="flex-1 overflow-y-auto space-y-2 mb-4 min-h-0">
              {parsedEntries.map((entry) => (
                <div
                  key={entry.id}
                  className={`flex items-start gap-3 p-3 border rounded-md transition-colors ${
                    selectedIds.has(entry.id)
                      ? "border-border bg-background"
                      : "border-border/50 bg-muted/30 opacity-60"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(entry.id)}
                    onChange={() => toggleEntry(entry.id)}
                    className="mt-1 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge
                        variant="secondary"
                        className={`text-[9px] px-1.5 py-0 border-0 ${
                          PRIORITY_STYLES[entry.priority] || ""
                        }`}
                      >
                        {entry.priority}
                      </Badge>
                      <Badge
                        variant="outline"
                        className="text-[9px] px-1.5 py-0"
                      >
                        {entry.category}
                      </Badge>
                      <KnowledgeSelect
                        label={`Priority for ${entry.content.slice(0, 40)}`}
                        value={entry.priority}
                        onValueChange={(value) => updateEntryPriority(entry.id, value as KnowledgePriority)}
                        options={KNOWLEDGE_PRIORITIES.map((priority) => ({ value: priority, label: priority }))}
                        className="ml-auto h-7 min-w-[108px] text-[9px]"
                      />
                    </div>
                    <p className="text-xs leading-relaxed">{entry.content}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-border">
              <button
                onClick={toggleAll}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {selectedIds.size === parsedEntries.length
                  ? "Deselect All"
                  : "Select All"}
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => setParsedEntries([])}
                  className="px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  ← Back
                </button>
                <button
                  onClick={handleSave}
                  disabled={selectedIds.size === 0}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium bg-foreground text-background rounded-md hover:bg-foreground/90 transition-colors disabled:opacity-50"
                >
                  Save {selectedIds.size}{" "}
                  {selectedIds.size === 1 ? "entry" : "entries"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Notion Import (Placeholder) ──

function NotionImport({ onClose }: { onClose: () => void }) {
  const [isConnected, setIsConnected] = useState(false);

  return (
    <div className="fixed inset-0 bg-background/60 backdrop-blur-md flex items-center justify-center z-50" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-background rounded-lg border border-border shadow-lg w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold">Import from Notion</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-muted rounded-md transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {isConnected ? (
          <div className="text-center py-6">
            <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
              <Check className="w-6 h-6 text-foreground" />
            </div>
            <p className="text-sm font-medium mb-1">Connected to Notion</p>
            <p className="text-xs text-muted-foreground mb-5">
              MCP integration active. You can now search and import Notion pages.
            </p>
            <div className="border border-border rounded-md p-3 mb-4">
              <div className="relative mb-3">
                <input
                  type="text"
                  placeholder="Search Notion pages..."
                  className="w-full pl-3 pr-3 py-2 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring/20"
                  disabled
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
                  <FileText className="w-4 h-4 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium">KPI Glossary</p>
                    <p className="text-[9px] text-muted-foreground">
                      Marketing Wiki · Last edited Feb 10
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
                  <FileText className="w-4 h-4 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium">
                      Metric Definitions Q4 2025
                    </p>
                    <p className="text-[9px] text-muted-foreground">
                      Analytics Team · Last edited Jan 28
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <p className="text-[9px] text-muted-foreground">
              Full Notion import coming soon via MCP
            </p>
          </div>
        ) : (
          <div className="text-center py-6">
            <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
              <FileText className="w-6 h-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium mb-1">Connect Notion</p>
            <p className="text-xs text-muted-foreground mb-5 max-w-xs mx-auto">
              Connect your Notion workspace to import knowledge entries directly
              from your docs and wikis via MCP.
            </p>
            <button
              onClick={() => setIsConnected(true)}
              className="px-4 py-2 text-sm font-medium bg-foreground text-background rounded-lg hover:bg-foreground/90 transition-colors"
            >
              Connect Notion
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
