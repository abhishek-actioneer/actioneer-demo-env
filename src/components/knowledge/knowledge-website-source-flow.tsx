"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Globe,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { KnowledgeSelect } from "@/components/knowledge/knowledge-select";
import { apiFetch } from "@/lib/api-client";
import type { KnowledgeEntry, KnowledgeLevel } from "@/lib/knowledge-types";

type FlowStep = 1 | 2 | 3 | 4;
type ProcessingPhase = "idle" | "scraping" | "indexing" | "complete" | "error";
type UrlStatus = "queued" | "scraping" | "complete" | "error";

interface DiscoveredPage {
  url: string;
  path: string;
  title: string;
  selected: boolean;
}

interface DiscoveryGroup {
  seedUrl: string;
  name: string;
  pages: DiscoveredPage[];
  expanded: boolean;
  error?: string;
}

interface UrlActivity {
  url: string;
  status: UrlStatus;
  progress: number;
  error?: string;
}

interface ScrapedPage {
  url: string;
  title: string;
  text: string;
  truncated: boolean;
}

interface KnowledgeWebsiteSourceFlowProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  datasetId: string;
  defaultLevel: KnowledgeLevel;
  onSave: (entries: KnowledgeEntry[]) => Promise<KnowledgeEntry[]>;
}

const MAX_URLS = 100;

export function KnowledgeWebsiteSourceFlow({
  open,
  onOpenChange,
  datasetId,
  defaultLevel,
  onSave,
}: KnowledgeWebsiteSourceFlowProps) {
  const [step, setStep] = useState<FlowStep>(1);
  const [sourceName, setSourceName] = useState("");
  const [description, setDescription] = useState("");
  const [level, setLevel] = useState<KnowledgeLevel>(defaultLevel);
  const [urlDraft, setUrlDraft] = useState("");
  const [groups, setGroups] = useState<DiscoveryGroup[]>([]);
  const [discoveringUrl, setDiscoveringUrl] = useState<string | null>(null);
  const [discoverySearch, setDiscoverySearch] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [phase, setPhase] = useState<ProcessingPhase>("idle");
  const [activity, setActivity] = useState<UrlActivity[]>([]);
  const [createdCount, setCreatedCount] = useState(0);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const processingRef = useRef(false);
  const lastAutoAttemptRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open || processingRef.current) return;
    setStep(1);
    setSourceName("");
    setDescription("");
    setLevel(defaultLevel);
    setUrlDraft("");
    setGroups([]);
    setDiscoveringUrl(null);
    setDiscoverySearch("");
    setInputError(null);
    setPhase("idle");
    setActivity([]);
    setCreatedCount(0);
    setProcessingError(null);
    lastAutoAttemptRef.current = null;
  }, [defaultLevel, open]);

  const selectedUrls = useMemo(() => {
    const seen = new Set<string>();
    return groups.flatMap((group) => group.pages)
      .filter((page) => page.selected)
      .map((page) => page.url)
      .filter((url) => {
        if (seen.has(url)) return false;
        seen.add(url);
        return true;
      })
      .slice(0, MAX_URLS);
  }, [groups]);
  const completedUrls = activity.filter((item) => item.status === "complete").length;
  const failedUrls = activity.filter((item) => item.status === "error").length;
  const activeUrls = activity.filter((item) => item.status === "scraping").length;
  const displayName = sourceName.trim() || groups[0]?.name || "Website source";
  const discoverUrl = useCallback(async (rawUrl = urlDraft) => {
    const normalized = normalizeUrl(rawUrl);
    if (!normalized) {
      setInputError("Enter a valid public URL beginning with http:// or https://.");
      return;
    }
    if (groups.some((group) => group.seedUrl === normalized)) {
      setInputError("That website is already included.");
      return;
    }
    if (selectedUrls.length >= MAX_URLS) {
      setInputError(`This source already contains the maximum of ${MAX_URLS} pages.`);
      return;
    }

    setInputError(null);
    setDiscoveringUrl(normalized);
    setUrlDraft("");
    try {
      const result = await apiFetch<{
        name: string;
        seedUrl: string;
        pages: Array<Omit<DiscoveredPage, "selected">>;
        truncated: boolean;
      }>("/api/knowledge/discover-url", {
        method: "POST",
        body: { url: normalized, limit: MAX_URLS - selectedUrls.length },
        datasetId,
        skipModel: true,
      });
      const alreadyKnown = new Set(groups.flatMap((group) => group.pages.map((page) => page.url)));
      const pages = result.pages
        .filter((page) => !alreadyKnown.has(page.url))
        .slice(0, MAX_URLS - selectedUrls.length)
        .map((page) => ({ ...page, selected: true }));
      if (pages.length === 0) throw new Error("No crawlable pages were found on this website.");
      setGroups((current) => [...current, {
        seedUrl: result.seedUrl,
        name: result.name,
        pages,
        expanded: true,
      }]);
      setSourceName((current) => current.trim() || result.name);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Website discovery failed.";
      setInputError(message);
    } finally {
      setDiscoveringUrl(null);
    }
  }, [datasetId, groups, selectedUrls.length, urlDraft]);

  useEffect(() => {
    if (step !== 2 || discoveringUrl) return;
    const normalized = normalizeUrl(urlDraft);
    if (!normalized || groups.some((group) => group.seedUrl === normalized)) return;
    if (lastAutoAttemptRef.current === normalized) return;

    const timeout = window.setTimeout(() => {
      lastAutoAttemptRef.current = normalized;
      void discoverUrl(normalized);
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [discoverUrl, discoveringUrl, groups, step, urlDraft]);

  const updateGroup = (seedUrl: string, update: (group: DiscoveryGroup) => DiscoveryGroup) => {
    setGroups((current) => current.map((group) => group.seedUrl === seedUrl ? update(group) : group));
  };

  const togglePage = (seedUrl: string, pageUrl: string) => {
    const target = groups.find((group) => group.seedUrl === seedUrl)?.pages.find((page) => page.url === pageUrl);
    if (!target?.selected && selectedUrls.length >= MAX_URLS) {
      setInputError(`You can select up to ${MAX_URLS} pages.`);
      return;
    }
    updateGroup(seedUrl, (group) => ({
      ...group,
      pages: group.pages.map((page) => page.url === pageUrl ? { ...page, selected: !page.selected } : page),
    }));
    setInputError(null);
  };

  const selectGroupPages = (seedUrl: string, select: boolean) => {
    const outsideSelected = groups
      .filter((group) => group.seedUrl !== seedUrl)
      .flatMap((group) => group.pages)
      .filter((page) => page.selected).length;
    let remaining = Math.max(0, MAX_URLS - outsideSelected);
    updateGroup(seedUrl, (group) => ({
      ...group,
      pages: group.pages.map((page) => {
        if (!select) return { ...page, selected: false };
        const selected = remaining > 0;
        if (selected) remaining -= 1;
        return { ...page, selected };
      }),
    }));
  };

  const startProcessing = async () => {
    const capturedUrls = [...selectedUrls];
    if (capturedUrls.length === 0) return;
    processingRef.current = true;
    setStep(4);
    setPhase("scraping");
    setProcessingError(null);
    setCreatedCount(0);
    setActivity(capturedUrls.map((url) => ({ url, status: "queued", progress: 0 })));

    try {
      const response = await apiFetch("/api/knowledge/scrape-urls", {
        method: "POST",
        body: { urls: capturedUrls },
        datasetId,
        skipModel: true,
        stream: true,
      });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({ error: "Website scraping failed." }));
        throw new Error(typeof body.error === "string" ? body.error : "Website scraping failed.");
      }

      const scraped: ScrapedPage[] = [];
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let terminalError: string | null = null;
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as {
            type: string;
            url?: string;
            error?: string;
            page?: ScrapedPage;
            index?: number;
            progress?: number;
          };
          if (event.type === "page_start" && typeof event.index === "number") {
            setActivity((current) => current.map((item, index) => index === event.index ? { ...item, status: "scraping", progress: Math.max(item.progress, 3), error: undefined } : item));
          } else if (event.type === "page_progress" && typeof event.index === "number" && typeof event.progress === "number") {
            const pageIndex = event.index;
            const pageProgress = event.progress;
            setActivity((current) => current.map((item, index) => index === pageIndex ? { ...item, status: "scraping", progress: Math.max(item.progress, Math.min(99, pageProgress)) } : item));
          } else if (event.type === "page_complete" && event.page) {
            scraped.push(event.page);
            setActivity((current) => current.map((item, index) => index === event.index ? { ...item, status: "complete", progress: 100 } : item));
          } else if (event.type === "page_error" && typeof event.index === "number") {
            setActivity((current) => current.map((item, index) => index === event.index ? { ...item, status: "error", error: event.error } : item));
          } else if (event.type === "error") {
            terminalError = event.error || "Website scraping failed.";
          }
        }
        if (done) break;
      }
      if (terminalError) throw new Error(terminalError);
      if (scraped.length === 0) throw new Error("None of the selected pages could be scraped.");

      setPhase("indexing");
      const now = new Date().toISOString();
      const websitePages: KnowledgeEntry[] = scraped
        .filter((page) => page.text.trim().length > 0)
        .map((page, index) => ({
          id: `kb-page-${Date.now()}-${index}`,
          title: page.title || page.url,
          content: page.text,
          level,
          category: "Insight",
          priority: "High",
          source: "website",
          sourceUrl: page.url,
          addedBy: "You",
          dateAdded: now,
        }));
      if (websitePages.length === 0) throw new Error("The selected pages did not contain readable text.");
      const persistedPages = await onSave(websitePages);
      setCreatedCount(persistedPages.length);
      setPhase("complete");
    } catch (error) {
      setProcessingError(error instanceof Error ? error.message : "Website processing failed. Please try again.");
      setPhase("error");
    } finally {
      processingRef.current = false;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[92vh] gap-0 overflow-hidden rounded-none border-border bg-white p-0 text-[#171714] [color-scheme:light] [--background:#fff] [--border:#deded8] [--foreground:#171714] [--muted:#f1f1ed] [--muted-foreground:#707069] sm:max-w-5xl"
      >
        <FlowHeader step={step} phase={phase} onClose={() => onOpenChange(false)} />
        <div className="min-h-[480px] overflow-y-auto px-6 py-8">
          {step === 1 && (
            <div className="mx-auto max-w-3xl">
              <div className="grid grid-cols-[180px_1fr] gap-x-8 border-b border-border py-7">
                <div>
                  <p className="text-sm font-semibold">Name</p>
                  <p className="mt-1 text-xs text-muted-foreground">Auto-generated</p>
                </div>
                <div>
                  <input
                    value={sourceName}
                    onChange={(event) => setSourceName(event.target.value)}
                    placeholder="Will be generated from your URLs"
                    className="h-11 w-full border border-border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus:border-foreground/50"
                    autoFocus
                  />
                  <p className="mt-2 text-xs text-muted-foreground">The source name is inferred from the first discovered website. You can override it here.</p>
                </div>
              </div>
              <div className="grid grid-cols-[180px_1fr] gap-x-8 border-b border-border py-7">
                <div>
                  <p className="text-sm font-semibold">Description</p>
                  <p className="mt-1 text-xs text-muted-foreground">Optional</p>
                </div>
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Describe what this website source contains..."
                  className="min-h-32 w-full resize-y border border-border bg-background p-3 text-sm outline-none placeholder:text-muted-foreground focus:border-foreground/50"
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="mx-auto max-w-4xl space-y-5">
              <div>
                <h2 className="text-lg font-semibold">Website URLs</h2>
                <p className="mt-1 text-sm text-muted-foreground">Add a public URL and the scraper will discover rendered pages from the same site.</p>
              </div>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Globe className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="url"
                    value={urlDraft}
                    onChange={(event) => { setUrlDraft(event.target.value); setInputError(null); }}
                    onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void discoverUrl(); } }}
                    placeholder="https://example.com or add another URL..."
                    className="h-11 w-full border border-border bg-muted/30 pl-10 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:border-foreground/50"
                    autoFocus
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void discoverUrl()}
                  disabled={!urlDraft.trim() || Boolean(discoveringUrl) || selectedUrls.length >= MAX_URLS}
                  className={`flex h-11 items-center gap-2 border px-4 text-sm font-medium transition-colors ${
                    discoveringUrl
                      ? "cursor-wait border-blue-200 bg-blue-50/50 text-blue-600 disabled:opacity-100"
                      : "border-border hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                  }`}
                >
                  {discoveringUrl ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  {discoveringUrl ? "Discovering" : "Add website"}
                </button>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Discovered pages are automatically selected and can be reviewed below.</span>
                <span className="tabular-nums">{selectedUrls.length}/{MAX_URLS} URLs selected</span>
              </div>
              {inputError && <InlineError message={inputError} />}
              <div className="flex items-baseline gap-2">
                <h3 className="text-base font-semibold">Related pages</h3>
                {discoveringUrl && <span className="flex items-center gap-1.5 text-sm font-medium text-blue-600"><Loader2 className="size-3.5 animate-spin" /> Discovering automatically...</span>}
              </div>
              {groups.length === 0 && !discoveringUrl ? (
                <div className="flex min-h-52 flex-col items-center justify-center border border-dashed border-border text-center">
                  <Globe className="size-8 text-muted-foreground" />
                  <p className="mt-3 text-sm font-medium">No website added yet</p>
                  <p className="mt-1 text-xs text-muted-foreground">Enter a URL above to discover its pages with the scraper.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {groups.map((group) => (
                    <DiscoveryGroupCard
                      key={group.seedUrl}
                      group={group}
                      search={discoverySearch}
                      onSearch={setDiscoverySearch}
                      onToggleExpanded={() => updateGroup(group.seedUrl, (current) => ({ ...current, expanded: !current.expanded }))}
                      onTogglePage={(url) => togglePage(group.seedUrl, url)}
                      onSelectAll={(select) => selectGroupPages(group.seedUrl, select)}
                      onRemove={() => setGroups((current) => current.filter((item) => item.seedUrl !== group.seedUrl))}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="mx-auto max-w-3xl space-y-7">
              <div>
                <h2 className="text-lg font-semibold">Automatic sync</h2>
                <div className="mt-4 border border-border bg-muted/20 p-5">
                  <div className="flex items-start gap-3">
                    <RefreshCw className="mt-0.5 size-5 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">Manual refresh</p>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">Automatic re-scraping is not enabled. Create a new website source when you want to refresh this content.</p>
                    </div>
                    <span className="border border-border px-2 py-1 text-xs font-medium text-muted-foreground">Off</span>
                  </div>
                </div>
              </div>
              <div>
                <div className="flex items-end justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">Review URLs</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{selectedUrls.length} pages selected for scraping</p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums">{selectedUrls.length} / {MAX_URLS}</span>
                </div>
                <div className="mt-4 max-h-72 divide-y divide-border overflow-y-auto border border-border">
                  {groups.map((group) => {
                    const selected = group.pages.filter((page) => page.selected);
                    if (selected.length === 0) return null;
                    return (
                      <div key={group.seedUrl}>
                        <div className="flex items-center gap-3 bg-muted/30 px-4 py-3">
                          <Globe className="size-4 text-muted-foreground" />
                          <span className="flex-1 text-sm font-semibold">{hostname(group.seedUrl)}</span>
                          <span className="text-xs tabular-nums text-muted-foreground">{selected.length}</span>
                        </div>
                        {selected.map((page) => (
                          <div key={page.url} className="flex items-center gap-3 px-5 py-3 text-sm">
                            <span className="size-1.5 rounded-full bg-foreground" />
                            <span className="min-w-0 flex-1 truncate font-mono text-xs">{page.path}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
              <label className="block">
                <span className="mb-2 block text-sm font-medium">Knowledge scope</span>
                <KnowledgeSelect
                  label="Knowledge scope"
                  value={level}
                  onValueChange={(value) => setLevel(value as KnowledgeLevel)}
                  options={[{ value: "global", label: "Global context" }, { value: "user", label: "My preferences" }]}
                  className="h-11 w-full"
                />
              </label>
            </div>
          )}

          {step === 4 && (
            <ProcessingView
              phase={phase}
              activity={activity}
              completedUrls={completedUrls}
              failedUrls={failedUrls}
              activeUrls={activeUrls}
              createdCount={createdCount}
              error={processingError}
              displayName={displayName}
            />
          )}
        </div>

        <FlowFooter
          step={step}
          phase={phase}
          canContinue={step !== 2 || selectedUrls.length > 0}
          onBack={() => setStep((step - 1) as FlowStep)}
          onCancel={() => onOpenChange(false)}
          onContinue={() => {
            if (step === 1) setStep(2);
            else if (step === 2) setStep(3);
            else if (step === 3) void startProcessing();
          }}
          onRetry={() => void startProcessing()}
        />
      </DialogContent>
    </Dialog>
  );
}

function FlowHeader({ step, phase, onClose }: { step: FlowStep; phase: ProcessingPhase; onClose: () => void }) {
  const status = phase === "scraping" || phase === "indexing" ? "Processing" : phase === "complete" ? "Complete" : phase === "error" ? "Needs attention" : null;
  return (
    <>
      <div className="flex items-start gap-3 px-6 pb-5 pt-6">
        <div className="flex size-10 shrink-0 items-center justify-center border border-border"><Globe className="size-5 text-muted-foreground" /></div>
        <div className="min-w-0 flex-1">
          <DialogTitle className="text-base">Create Website Source</DialogTitle>
          <DialogDescription className="mt-1 text-xs font-medium">Scrape and index web content</DialogDescription>
        </div>
        {status && <span className="mr-1 inline-flex h-7 items-center gap-1.5 border border-border px-2 text-xs font-medium text-muted-foreground"><span className="size-1.5 rounded-full bg-foreground" />{status}</span>}
        <span className="pt-1 text-sm font-semibold text-muted-foreground">Step {step} of 4</span>
        <button type="button" aria-label="Close website source flow" onClick={onClose} className="-mr-2 -mt-2 flex size-10 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"><X className="size-4" /></button>
      </div>
      <div className="grid grid-cols-4 gap-2 border-b border-border px-6 pb-5">
        {[1, 2, 3, 4].map((segment) => <span key={segment} className={`h-1 ${segment <= step ? "bg-foreground" : "bg-border"}`} />)}
      </div>
    </>
  );
}

function DiscoveryGroupCard({
  group,
  search,
  onSearch,
  onToggleExpanded,
  onTogglePage,
  onSelectAll,
  onRemove,
}: {
  group: DiscoveryGroup;
  search: string;
  onSearch: (value: string) => void;
  onToggleExpanded: () => void;
  onTogglePage: (url: string) => void;
  onSelectAll: (select: boolean) => void;
  onRemove: () => void;
}) {
  const selectedCount = group.pages.filter((page) => page.selected).length;
  const filtered = group.pages.filter((page) => `${page.title} ${page.path}`.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="border border-border">
      <div className="flex items-center gap-3 px-4 py-3">
        <Globe className="size-4 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{hostname(group.seedUrl)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{selectedCount} of {group.pages.length} pages selected</p>
        </div>
        <span className="min-w-7 border border-border px-2 py-1 text-center text-xs tabular-nums">{selectedCount}</span>
        <button type="button" onClick={onToggleExpanded} className="flex h-9 items-center gap-1.5 border border-border px-3 text-xs font-medium hover:bg-muted">
          {group.expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          {group.expanded ? "Hide" : "Show"}
        </button>
        <button type="button" aria-label={`Remove ${hostname(group.seedUrl)}`} onClick={onRemove} className="flex size-9 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"><Trash2 className="size-4" /></button>
      </div>
      {group.expanded && (
        <div className="border-t border-border p-3">
          <label className="relative block">
            <span className="sr-only">Search discovered pages</span>
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search pages..." className="h-10 w-full bg-muted/30 pl-9 pr-3 text-sm outline-none" />
          </label>
          <div className="mt-3 flex items-center gap-3 border border-border px-3 py-2 text-xs">
            <span className="flex-1">Found {group.pages.length} pages · {selectedCount} selected</span>
            <button type="button" onClick={() => onSelectAll(true)} className="font-medium hover:underline">Select all</button>
            <button type="button" onClick={() => onSelectAll(false)} className="font-medium hover:underline">Clear all</button>
          </div>
          <div className="mt-2 max-h-64 space-y-1 overflow-y-auto">
            {filtered.map((page) => (
              <label key={page.url} className={`flex min-h-11 cursor-pointer items-center gap-3 border px-3 py-2 text-sm ${page.selected ? "border-foreground/30 bg-muted/50" : "border-border hover:bg-muted/30"}`}>
                <input type="checkbox" checked={page.selected} onChange={() => onTogglePage(page.url)} className="size-4" />
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{page.path}</span>
                <a href={page.url} target="_blank" rel="noreferrer" aria-label={`Open ${page.url}`} onClick={(event) => event.stopPropagation()} className="flex size-8 items-center justify-center text-muted-foreground hover:text-foreground"><ExternalLink className="size-3.5" /></a>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ProcessingView({
  phase,
  activity,
  completedUrls,
  failedUrls,
  activeUrls,
  createdCount,
  error,
  displayName,
}: {
  phase: ProcessingPhase;
  activity: UrlActivity[];
  completedUrls: number;
  failedUrls: number;
  activeUrls: number;
  createdCount: number;
  error: string | null;
  displayName: string;
}) {
  const overallProgress = activity.length > 0
    ? Math.round(activity.reduce((sum, item) => sum + item.progress, 0) / activity.length)
    : 0;
  if (phase === "indexing") return (
    <div className="mx-auto max-w-xl py-4">
      <h2 className="text-lg font-semibold">Indexing content</h2>
      <p className="mt-1 text-sm text-muted-foreground">Saving {completedUrls} complete rendered pages</p>
      <div className="mt-7 border-l-2 border-border bg-muted/30 px-5 py-4 font-mono text-sm leading-7"><p>&gt;_ Preserving page text</p><p>&gt;_ Saving page URLs and titles</p><p>&gt;_ Updating knowledge index</p></div>
      <div className="mt-6 border border-border p-6 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /><p className="mt-4 font-mono text-sm text-muted-foreground">This may take a minute</p></div>
    </div>
  );
  if (phase === "complete") return (
    <div className="mx-auto flex max-w-xl flex-col items-center py-12 text-center">
      <div className="flex size-14 items-center justify-center border border-foreground"><Check className="size-6" /></div>
      <h2 className="mt-5 text-lg font-semibold">Website source created</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{displayName} stored {createdCount} complete pages from {completedUrls} successful scrapes.</p>
      {failedUrls > 0 && <p className="mt-3 text-xs text-muted-foreground">{failedUrls} pages were skipped because they could not be rendered.</p>}
    </div>
  );
  if (phase === "error") return (
    <div className="mx-auto flex max-w-xl flex-col items-center py-12 text-center">
      <div className="flex size-14 items-center justify-center border border-border"><AlertCircle className="size-6 text-muted-foreground" /></div>
      <h2 className="mt-5 text-lg font-semibold">Website source needs attention</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{error}</p>
    </div>
  );
  return (
    <div className="mx-auto max-w-2xl">
      <h2 className="text-lg font-semibold">Scraping in progress</h2>
      <p className="mt-1 text-sm text-muted-foreground">The scraper is rendering the selected pages.</p>
      <div className="mt-6 border-l-2 border-border bg-muted/30 px-5 py-4 font-mono text-sm leading-7"><p>&gt;_ Scraper session connected</p><p>&gt;_ Pages to scan: {activity.length}</p><p>&gt;_ Concurrent workers: {Math.min(3, activity.length)}</p></div>
      <h3 className="mb-3 mt-6 text-sm font-semibold">Activity</h3>
      <div className="max-h-64 divide-y divide-border overflow-y-auto border border-border">
        {activity.map((item, index) => (
          <div key={item.url} className={`grid grid-cols-[32px_minmax(0,1fr)_120px] items-center gap-3 px-4 py-3 ${item.status === "scraping" ? "bg-muted/60" : ""}`}>
            <span className="font-mono text-xs text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
            <div className="min-w-0"><p className="truncate font-mono text-xs">{item.url}</p>{item.error && <p className="mt-1 truncate text-[9.9px] text-muted-foreground">{item.error}</p>}</div>
            <div className="flex items-center gap-2"><div role="progressbar" aria-label={`Scraping progress for ${item.url}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={item.progress} className="h-2 flex-1 overflow-hidden bg-muted"><div className="h-full origin-left bg-foreground transition-transform duration-200" style={{ transform: `scaleX(${item.progress / 100})` }} /></div><span className="w-9 text-right font-mono text-xs tabular-nums text-muted-foreground">{item.status === "error" ? "Error" : `${item.progress}%`}</span></div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex justify-between border-t border-border pt-3 text-xs text-muted-foreground"><span>{completedUrls} complete · {activeUrls} active · {failedUrls} failed</span><span className="tabular-nums">{overallProgress}% complete</span></div>
    </div>
  );
}

function FlowFooter({
  step,
  phase,
  canContinue,
  onBack,
  onCancel,
  onContinue,
  onRetry,
}: {
  step: FlowStep;
  phase: ProcessingPhase;
  canContinue: boolean;
  onBack: () => void;
  onCancel: () => void;
  onContinue: () => void;
  onRetry: () => void;
}) {
  const processing = phase === "scraping" || phase === "indexing";
  return (
    <div className="flex min-h-16 items-center justify-between border-t border-border px-6 py-3">
      {step > 1 && step < 4 ? <button type="button" onClick={onBack} className="h-10 px-3 text-sm font-medium text-muted-foreground hover:text-foreground">Back</button> : <span />}
      <div className="flex items-center gap-3">
        {step < 4 && <button type="button" onClick={onCancel} className="h-10 border border-border px-4 text-sm font-medium hover:bg-muted">Cancel</button>}
        {step < 4 && <PrimaryButton onClick={onContinue} disabled={!canContinue}>{step === 3 ? "Start scraping" : "Continue"}<ArrowRight className="size-4" /></PrimaryButton>}
        {step === 4 && processing && <><button type="button" onClick={onCancel} className="h-10 px-3 text-sm font-medium text-muted-foreground hover:text-foreground">Continue in background</button><button type="button" disabled className="flex h-10 items-center gap-2 bg-muted-foreground px-4 text-sm font-medium text-white opacity-70"><Loader2 className="size-4 animate-spin" />Processing</button></>}
        {step === 4 && phase === "complete" && <PrimaryButton onClick={onCancel}>Done <Check className="size-4" /></PrimaryButton>}
        {step === 4 && phase === "error" && <><button type="button" onClick={onCancel} className="h-10 border border-border px-4 text-sm font-medium hover:bg-muted">Close</button><PrimaryButton onClick={onRetry}>Try again</PrimaryButton></>}
      </div>
    </div>
  );
}

function InlineError({ message }: { message: string }) {
  return <p role="alert" className="flex items-center gap-2 text-sm text-foreground"><AlertCircle className="size-4 shrink-0" />{message}</p>;
}

function PrimaryButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button type="button" onClick={onClick} disabled={disabled} className="flex h-10 items-center gap-2 bg-foreground px-4 text-sm font-medium text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40">{children}</button>;
}

function normalizeUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function hostname(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}
