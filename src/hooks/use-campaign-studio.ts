"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useDataset } from "@/lib/dataset-context";
import { useBreadcrumbTitle } from "@/lib/breadcrumb-context";
import { useChatPanel } from "@/components/chat/chat-panel-provider";
import { useCampaignOptions } from "@/hooks/use-campaign-options";
import { useCampaignDraft } from "@/hooks/use-campaign-draft";
import { useCampaignPersistence } from "@/hooks/use-campaign-persistence";
import { useCampaignHandlers } from "@/hooks/use-campaign-handlers";
import { useLiveTest } from "@/hooks/use-live-test";
import { useCampaignActions } from "@/hooks/use-campaign-actions";
import {
  isSafeDatasetId,
  studioTabFromParam,
  callLogFilterFromParams,
  templateWithEditedCallScript,
} from "@/lib/voice-campaign-studio-utils";
import { compileVoiceCampaignScript } from "@/lib/voice-campaign-flow";
import type { PromptPreview } from "@/components/voice-campaigns/voice-campaign-studio";

function buildAgentSummary(params: {
  campaignName: string;
  status?: string;
  segmentName?: string;
  segmentCount?: number;
  purposeName?: string;
  brief: string;
  templateTitle?: string;
  scriptText: string;
  language: string;
  voiceLabel: string;
  nodeCount: number;
  callCount?: number;
}): string {
  const lines = [
    `Campaign: ${params.campaignName || "Untitled"}`,
    `Status: ${params.status ?? "Draft"}`,
  ];
  if (params.segmentName) lines.push(`Audience: ${params.segmentName}${params.segmentCount != null ? ` (${params.segmentCount.toLocaleString()} users)` : ""}`);
  if (params.purposeName) lines.push(`Purpose: ${params.purposeName}`);
  if (params.brief) lines.push(`Brief: ${params.brief.slice(0, 300)}`);
  if (params.templateTitle) lines.push(`Script template: ${params.templateTitle}`);
  if (params.scriptText) lines.push(`Script preview:\n${params.scriptText.slice(0, 600)}`);
  lines.push(`Language: ${params.language}`, `Voice: ${params.voiceLabel}`);
  if (params.nodeCount > 0) lines.push(`Conversation flow: ${params.nodeCount} nodes`);
  if (params.callCount != null) lines.push(`Calls so far: ${params.callCount}`);
  return lines.join("\n");
}

export function useCampaignStudio() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { datasetId, dataset, ready: datasetReady, switchDataset } = useDataset();
  const { setEntity, setDetailContent, setDetailHeaderHidden } = useChatPanel();

  const existingCampaignId = searchParams.get("campaignId");
  const prefillSegmentId = searchParams.get("segmentId") ?? "";
  const prefillBrief = searchParams.get("brief")?.trim() ?? "";
  const requestedTab = studioTabFromParam(searchParams.get("tab"));
  const requestedCallId = searchParams.get("callId")?.trim() || null;
  const requestedCallLogFilter = callLogFilterFromParams(
    searchParams.get("callFilter"),
    searchParams.get("outcome"),
    searchParams.get("scriptCheck"),
    searchParams.get("minSeconds"),
  );
  const datasetReadyForPage = datasetReady;

  // Stable ref-backed callbacks — identity never changes, so useCampaignOptions's
  // effect deps don't flip every render and trigger an infinite reload loop.
  const onSegmentIdRef = useRef<(id: string) => void>(() => {});
  const onOfferIdRef = useRef<(id: string) => void>(() => {});
  const onCampaignBriefRef = useRef<(brief: string) => void>(() => {});
  const onErrorRef = useRef<(msg: string) => void>(() => {});

  const stableOnSegmentIdChange = useCallback((id: string) => onSegmentIdRef.current(id), []);
  const stableOnOfferId = useCallback((id: string) => onOfferIdRef.current(id), []);
  const stableOnCampaignBrief = useCallback((brief: string) => onCampaignBriefRef.current(brief), []);
  const stableOnError = useCallback((msg: string) => onErrorRef.current(msg), []);

  const { segments, offers, loadingOptions } = useCampaignOptions({
    datasetId, datasetReadyForPage, existingCampaignId,
    prefillSegmentId, prefillBrief,
    onSegmentIdChange: stableOnSegmentIdChange,
    onOfferId: stableOnOfferId,
    onCampaignBrief: stableOnCampaignBrief,
    onError: stableOnError,
  });

  // Draft state (all form inputs + nodes + derived values)
  const { state: draft, setters, nodes, edges, refs } = useCampaignDraft({
    segments, offers, existingCampaignId, datasetId,
  });

  // Wire options callbacks to draft setters (updated every render — no re-render cost)
  onSegmentIdRef.current = setters.setSegmentId as (id: string) => void;
  onOfferIdRef.current = setters.setPurposeId as (id: string) => void;
  onCampaignBriefRef.current = (brief: string) => {
    setters.setCampaignBrief((current: string) => current.trim() ? current : brief);
  };

  // Live test (state only — no API calls)
  const liveTest = useLiveTest({ existingCampaignId });

  // Persistence (load/save/autosave/effects) — depends on liveTest.liveTestCampaignId
  const persistence = useCampaignPersistence({
    setters,
    scriptText: draft.scriptText,
    firstMessage: draft.firstMessage,
    language: draft.language,
    agentName: draft.agentName,
    companyName: draft.voiceDatasetContext.companyName ?? "",
    existingCampaignId,
    liveTestCampaignId: liveTest.liveTestCampaignId,
    datasetId,
    requestedTab,
    datasetReadyForPage,
    lastPersistedScriptRef: refs.lastPersistedScriptRef,
    autoRewrittenScriptKeysRef: refs.autoRewrittenScriptKeysRef,
  });

  // Wire error callback
  onErrorRef.current = (msg: string) => persistence.setError(msg);

  // Handlers (generate/suggest/refine/rewrite) — depends on persistence
  const handlers = useCampaignHandlers({
    datasetId, datasetReadyForPage,
    campaignName: draft.campaignName, campaignBrief: draft.campaignBrief,
    scriptText: draft.scriptText,
    language: draft.language, voice: draft.voice, agentName: draft.agentName,
    nodes, edges,
    successDefinition: draft.successDefinition, experimentSplit: draft.experimentSplit,
    offers, selectedSegment: draft.selectedSegment, selectedOffer: draft.selectedOffer,
    voiceDatasetContext: draft.voiceDatasetContext,
    setCampaignName: (n) => setters.setCampaignName(n as Parameters<typeof setters.setCampaignName>[0]),
    setCampaignBrief: (b) => setters.setCampaignBrief(b as Parameters<typeof setters.setCampaignBrief>[0]),
    setScriptText: (s) => setters.setScriptText(s as Parameters<typeof setters.setScriptText>[0]),
    setFirstMessage: (m) => setters.setFirstMessage(m as Parameters<typeof setters.setFirstMessage>[0]),
    setTemplate: (t) => setters.setTemplate(t as Parameters<typeof setters.setTemplate>[0]),
    setNodes: setters.setNodes as unknown as (n: typeof nodes) => void,
    setEdges: setters.setEdges as unknown as (e: typeof edges) => void,
    setPurposeId: (id) => setters.setPurposeId(id as Parameters<typeof setters.setPurposeId>[0]),
    setCustomPurpose: (purpose) => setters.setCustomPurpose(purpose),
    setScriptOptions: (o) => setters.setScriptOptions(o as Parameters<typeof setters.setScriptOptions>[0]),
    setSuggestingScripts: (b) => setters.setSuggestingScripts(b),
    setGeneratingDraft: (b) => setters.setGeneratingDraft(b),
    setPurposeSuggestions: (s) => setters.setPurposeSuggestions(s as Parameters<typeof setters.setPurposeSuggestions>[0]),
    setSuggestingPurposes: (b) => setters.setSuggestingPurposes(b),
    setRewritingScript: (b) => setters.setRewritingScript(b),
    setRefineScriptFeedback: (f) => setters.setRefineScriptFeedback(f as Parameters<typeof setters.setRefineScriptFeedback>[0]),
    setRefiningScript: (b) => setters.setRefiningScript(b),
    setSelectedNodeId: (id) => setters.setSelectedNodeId(id),
    setActiveTab: (tab) => persistence.setActiveTab(tab as Parameters<typeof persistence.setActiveTab>[0]),
    setScriptHistory: setters.setScriptHistory as (fn: (prev: string[]) => string[]) => void,
    setError: (msg) => persistence.setError(msg),
    persistEditableScript: persistence.persistEditableScript,
    onLanguageChange: persistence.handleLanguageChange,
    previousGeneratedScriptRef: refs.previousGeneratedScriptRef,
    autoRewrittenScriptKeysRef: refs.autoRewrittenScriptKeysRef,
  });

  // Actions (launch/recall/save/delete + ensureLiveTestCampaign + openLiveTest)
  const actions = useCampaignActions({
    datasetId, existingCampaignId,
    template: draft.template,
    campaignName: draft.campaignName, firstMessage: draft.firstMessage, scriptText: draft.scriptText,
    language: draft.language, voice: draft.voice, agentName: draft.agentName,
    companyName: draft.companyName, personaPrompt: draft.personaPrompt,
    selectedVoiceName: draft.selectedVoiceName, callProvider: draft.callProvider,
    nodes, edges,
    segmentId: draft.segmentId, purposeId: draft.purposeId, phoneNumbers: draft.phoneNumbers,
    successDefinition: draft.successDefinition, experimentSplit: draft.experimentSplit,
    voiceDatasetContext: draft.voiceDatasetContext,
    selectedSegment: draft.selectedSegment, selectedOffer: draft.selectedOffer,
    campaign: persistence.campaign,
    applyCampaign: persistence.applyCampaign,
    refreshExistingCampaign: persistence.refreshExistingCampaign,
    setActiveTab: (tab) => persistence.setActiveTab(tab as Parameters<typeof persistence.setActiveTab>[0]),
    setError: (msg) => persistence.setError(msg),
    liveTestCampaignId: liveTest.liveTestCampaignId,
    setLiveTestCampaignId: liveTest.setLiveTestCampaignId,
    setPreparingLiveTest: liveTest.setPreparingLiveTest,
    openCustomerModalForBrowser: liveTest.openCustomerModalForBrowser,
    setAutoStartLiveTest: liveTest.setAutoStartLiveTest,
    preparingLiveTest: liveTest.preparingLiveTest,
  });

  // Existing campaign pages derive their dataset from the saved campaign, not
  // from a mutable URL parameter.
  useEffect(() => {
    const campaignDatasetId = persistence.campaign?.datasetId ?? null;
    if (!existingCampaignId || !isSafeDatasetId(campaignDatasetId)) return;
    if (campaignDatasetId !== datasetId) switchDataset(campaignDatasetId);
  }, [datasetId, existingCampaignId, persistence.campaign?.datasetId, switchDataset]);

  useEffect(() => {
    if (!searchParams.has("datasetId")) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("datasetId");
    const nextQuery = params.toString();
    router.replace(nextQuery ? `/voice-campaigns/new?${nextQuery}` : "/voice-campaigns/new", { scroll: false });
  }, [router, searchParams]);

  // Auto-rewrite Devanagari → Hinglish
  // Capture the handler in a ref so the effect deps don't include the handlers object
  // (which is a new object every render and would cause the effect to run every render).
  const handleAutoRewriteRef = useRef(handlers.handleAutoRewriteIfNeeded);
  handleAutoRewriteRef.current = handlers.handleAutoRewriteIfNeeded;

  useEffect(() => {
    handleAutoRewriteRef.current(
      draft.scriptText,
      existingCampaignId,
      liveTest.liveTestCampaignId,
      persistence.loadingExistingCampaign,
      draft.rewritingScript,
    );
  }, [
    draft.scriptText, draft.rewritingScript, existingCampaignId,
    liveTest.liveTestCampaignId, persistence.loadingExistingCampaign,
  ]);

  // Prompt preview for live test panel
  const promptPreview = useMemo<PromptPreview>(() => {
    const { template, campaignName: cn, firstMessage: fm, scriptText: st, selectedSegment, selectedOffer, voiceDatasetContext, language, voice, selectedVoiceName, agentName, companyName, personaPrompt, selectedVoiceLabel } = draft;
    if (!template) {
      return { datasetName: dataset.label, voice: selectedVoiceLabel, voiceName: selectedVoiceName, language, segmentName: selectedSegment?.name, purposeName: selectedOffer?.name };
    }
    const compiled = compileVoiceCampaignScript({
      template: templateWithEditedCallScript(template, st, nodes, edges),
      campaignName: cn, firstMessage: fm, nodes, edges,
      segment: selectedSegment, purpose: selectedOffer,
      dataset: voiceDatasetContext, language, voice, voiceName: selectedVoiceName, agentName,
      companyName, personaPrompt,
      guardrails: draft.successDefinition.guardrails,
      operatorScript: st,
      universalRoutes: persistence.campaign?.workflow?.universalRoutes,
    });
    return {
      firstMessage: compiled.firstMessage,
      systemPrompt: compiled.systemPrompt,
      reasoning: compiled.reasoning, datasetName: dataset.label,
      segmentName: selectedSegment?.name, purposeName: selectedOffer?.name,
      voice: selectedVoiceLabel, voiceName: selectedVoiceName, language,
    };
  }, [draft, dataset.label, nodes, edges, persistence.campaign]);

  const panelCanLaunch =
    datasetReadyForPage &&
    Boolean(draft.template) &&
    draft.campaignName.trim().length > 0 &&
    Boolean(draft.segmentId) &&
    Boolean(draft.purposeId) &&
    draft.phoneNumbers.length > 0 &&
    nodes.some((n) => n.data.kind === "start") &&
    nodes.some((n) => n.data.kind === "end") &&
    !actions.launching &&
    !loadingOptions;

  // Breadcrumb
  useBreadcrumbTitle(persistence.campaign?.name || draft.campaignName || "New campaign");

  // UI effects
  useEffect(() => {
    setDetailHeaderHidden(true);
    return () => setDetailHeaderHidden(false);
  }, [setDetailHeaderHidden]);

  useEffect(() => {
    setDetailContent(null);
    return () => setDetailContent(null);
  }, [setDetailContent]);

  // Agent-friendly entity context
  useEffect(() => {
    setEntity({
      id: existingCampaignId ?? "voice-campaign-new",
      type: "voice-campaign",
      name: persistence.campaign?.name || draft.campaignName || "New campaign",
      summary: buildAgentSummary({
        campaignName: persistence.campaign?.name || draft.campaignName || "New campaign",
        status: persistence.campaign?.status,
        segmentName: draft.selectedSegment?.name,
        segmentCount: draft.selectedSegment?.userCount,
        purposeName: draft.selectedOffer?.name,
        brief: draft.campaignBrief,
        templateTitle: draft.template?.title,
        scriptText: draft.scriptText,
        language: draft.language,
        voiceLabel: draft.selectedVoiceLabel,
        nodeCount: nodes.length,
        callCount: persistence.campaign?.calls?.length,
      }),
    });
  }, [
    existingCampaignId, persistence.campaign, draft.campaignName, draft.selectedSegment,
    draft.selectedOffer, draft.campaignBrief, draft.template, draft.scriptText,
    draft.language, draft.selectedVoiceLabel, nodes.length, setEntity,
  ]);

  // Call log navigation helpers
  const setActiveTabRef = useRef(persistence.setActiveTab);
  setActiveTabRef.current = persistence.setActiveTab;

  const replaceCallLogSearchParams = useCallback((mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "call-logs");
    params.delete("datasetId");
    mutate(params);
    router.replace(`/voice-campaigns/new?${params.toString()}`, { scroll: false });
    setActiveTabRef.current("call-logs");
  }, [router, searchParams]);

  const handleOverviewDrilldown = useCallback((drilldown: { callRef?: string; filter?: { kind: string; outcome?: string; check?: string; minSeconds?: number } }) => {
    replaceCallLogSearchParams((params) => {
      params.delete("callId"); params.delete("callFilter"); params.delete("outcome"); params.delete("scriptCheck"); params.delete("minSeconds");
      if (drilldown.callRef) params.set("callId", drilldown.callRef);
      if (drilldown.filter?.kind === "outcome" && drilldown.filter.outcome) { params.set("callFilter", "outcome"); params.set("outcome", drilldown.filter.outcome); }
      if (drilldown.filter?.kind === "script-check" && drilldown.filter.check) { params.set("callFilter", "script-check"); params.set("scriptCheck", drilldown.filter.check); }
      if (drilldown.filter?.kind === "latency") params.set("callFilter", "latency");
      if (drilldown.filter?.kind === "retention") { params.set("callFilter", "retention"); if (drilldown.filter.minSeconds != null) params.set("minSeconds", String(drilldown.filter.minSeconds)); }
    });
  }, [replaceCallLogSearchParams]);

  const handleClearCallLogFilter = useCallback(() => {
    replaceCallLogSearchParams((params) => {
      params.delete("callFilter"); params.delete("outcome"); params.delete("scriptCheck"); params.delete("minSeconds");
    });
  }, [replaceCallLogSearchParams]);

  const liveTestCampaignIdForPanel = existingCampaignId ?? liveTest.liveTestCampaignId ?? undefined;

  const handleLiveTestClose = useCallback(() => {
    liveTest.closeLiveTest();
    if (!liveTestCampaignIdForPanel) return;
    persistence.refreshExistingCampaign({ preserveEditableInputs: true }).catch(() => undefined);
  }, [liveTest, liveTestCampaignIdForPanel, persistence]);

  const rewriteScriptToLanguageRef = useRef(handlers.handleRewriteScriptToLanguage);
  rewriteScriptToLanguageRef.current = handlers.handleRewriteScriptToLanguage;

  const handleLanguageChange = useCallback((nextValue: string) => {
    const nextLanguage = nextValue.trim() || "Hinglish";
    void persistence.handleLanguageChange(nextLanguage);
    // Studio language must rewrite spoken "Say:" lines — otherwise Odia/Tamil
    // stays Hinglish in the editor while Language says Odia. Re-selecting the
    // same language also re-syncs (fixes already-mismatched campaigns).
    if (
      !draft.scriptText.trim() ||
      draft.rewritingScript ||
      persistence.loadingExistingCampaign
    ) {
      return;
    }
    void rewriteScriptToLanguageRef.current(nextLanguage, {
      sourceScript: draft.scriptText,
      silent: false,
    });
  }, [
    draft.rewritingScript,
    draft.scriptText,
    persistence,
  ]);

  return {
    // identifiers
    existingCampaignId, datasetId, dataset, datasetReadyForPage,
    requestedCallId, requestedCallLogFilter,
    // draft
    draft, setters, nodes, edges,
    // persistence
    campaign: persistence.campaign,
    loadingExistingCampaign: persistence.loadingExistingCampaign,
    error: persistence.error, setError: persistence.setError,
    activeTab: persistence.activeTab, setActiveTab: persistence.setActiveTab,
    savingLanguage: persistence.savingLanguage || draft.rewritingScript,
    analyzingResponses: persistence.analyzingResponses,
    hasLoadedExistingCampaign: persistence.hasLoadedExistingCampaign,
    preparingExistingCampaign: persistence.preparingExistingCampaign,
    handleLanguageChange,
    handleAnalyzeResponses: persistence.handleAnalyzeResponses,
    savingCampaign: actions.savingCampaign,
    // live test
    showLiveTest: liveTest.showLiveTest,
    showCustomerModal: liveTest.showCustomerModal,
    sampledCustomer: liveTest.sampledCustomer,
    confirmCustomerAndStartTest: liveTest.confirmCustomerAndStartTest,
    closeCustomerModal: liveTest.closeCustomerModal,
    openCustomerModalForPhone: liveTest.openCustomerModalForPhone,
    autoStartLiveTest: liveTest.autoStartLiveTest,
    setAutoStartLiveTest: liveTest.setAutoStartLiveTest,
    preparingLiveTest: liveTest.preparingLiveTest,
    liveTestCampaignIdForPanel,
    closeLiveTest: liveTest.closeLiveTest,
    handleLiveTestClose,
    openLiveTest: actions.openLiveTest,
    // handlers
    handlers,
    // actions
    actions,
    // options
    segments, offers, loadingOptions,
    // computed
    promptPreview, panelCanLaunch,
    // call log navigation
    handleOverviewDrilldown, handleClearCallLogFilter,
  };
}
