"use client";

import { useCallback } from "react";

// Module-level cache — survives segment switches within a session
const purposeSuggestionsCache = new Map<string, VoicePurposeSuggestion[]>();
import { apiFetch } from "@/lib/api-client";
import {
  renderVoiceTemplateText,
  defaultAgentName,
  type VoiceCampaignTemplate,
  type VoiceDatasetContext,
} from "@/lib/voice-campaign-flow";
import {
  withDataset,
  generatedWorkflowToTemplate,
  buildEditableCallScript,
  autoRewriteScriptKey,
  DEFAULT_CAMPAIGN_LANGUAGE,
  type GeneratedCampaignDraft,
  type VoiceScriptOption,
  type VoicePurposeSuggestion,
} from "@/lib/voice-campaign-studio-utils";
import { geminiVoiceGender } from "@/lib/gemini-voices";
import { normalizeVoiceCampaignExperimentSplit, successDefinitionWithExperimentBaseline } from "@/lib/voice-campaign-experiment";
import type {
  VoiceCampaignExperimentSplit,
  VoiceCampaignSuccessDefinition,
} from "@/lib/voice-campaign-types";
import type { Segment } from "@/lib/types";
import type { Purpose } from "@/lib/purpose-types";
import type { VoiceFlowNode, VoiceFlowEdge } from "@/lib/voice-campaign-flow";
import { buildCampaignBriefPurpose } from "@/lib/voice-campaign-purpose";
import type { ScriptImportResult } from "@/lib/voice-script-import";

interface UseCampaignHandlersParams {
  datasetId: string;
  datasetReadyForPage: boolean;
  // draft state
  campaignName: string;
  campaignBrief: string;
  scriptText: string;
  language: string;
  voice: string;
  agentName: string;
  nodes: VoiceFlowNode[];
  edges: VoiceFlowEdge[];
  successDefinition: VoiceCampaignSuccessDefinition;
  experimentSplit: VoiceCampaignExperimentSplit;
  offers: Purpose[];
  selectedSegment: Segment | undefined;
  selectedOffer: Purpose | undefined;
  voiceDatasetContext: VoiceDatasetContext;
  // setters
  setCampaignName: (n: string) => void;
  setCampaignBrief: (b: string) => void;
  setScriptText: (s: string) => void;
  setFirstMessage: (m: string) => void;
  setTemplate: (t: VoiceCampaignTemplate | null) => void;
  setNodes: (nodes: VoiceFlowNode[]) => void;
  setEdges: (edges: VoiceFlowEdge[]) => void;
  setPurposeId: (id: string) => void;
  setCustomPurpose: (purpose: Purpose | null) => void;
  setScriptOptions: (o: VoiceScriptOption[]) => void;
  setSuggestingScripts: (b: boolean) => void;
  setGeneratingDraft: (b: boolean) => void;
  setPurposeSuggestions: (s: VoicePurposeSuggestion[]) => void;
  setSuggestingPurposes: (b: boolean) => void;
  setRewritingScript: (b: boolean) => void;
  setRefineScriptFeedback: (f: string) => void;
  setRefiningScript: (b: boolean) => void;
  setSelectedNodeId: (id: string | null) => void;
  setActiveTab: (tab: string) => void;
  setScriptHistory: (fn: (prev: string[]) => string[]) => void;
  setError: (msg: string | null) => void;
  persistEditableScript: (script: string, opts?: { silent?: boolean }) => Promise<unknown>;
  /** Owned by the persistence hook — also persists the choice for saved campaigns. */
  onLanguageChange: (language: string) => Promise<void>;
  previousGeneratedScriptRef: React.MutableRefObject<string>;
  autoRewrittenScriptKeysRef: React.MutableRefObject<Set<string>>;
}

export function useCampaignHandlers({
  datasetId, datasetReadyForPage,
  campaignName, campaignBrief, scriptText, language, voice, agentName,
  successDefinition, experimentSplit,
  offers, selectedSegment, selectedOffer,
  voiceDatasetContext,
  setCampaignName, setCampaignBrief, setScriptText, setFirstMessage,
  setTemplate, setNodes, setEdges, setPurposeId, setCustomPurpose,
  setScriptOptions, setSuggestingScripts, setGeneratingDraft,
  setPurposeSuggestions, setSuggestingPurposes,
  setRewritingScript, setRefineScriptFeedback, setRefiningScript,
  setSelectedNodeId, setActiveTab, setScriptHistory, setError,
  persistEditableScript, onLanguageChange,
  previousGeneratedScriptRef, autoRewrittenScriptKeysRef,
}: UseCampaignHandlersParams) {

  const handleSuggestPurposes = useCallback(async () => {
    if (!selectedSegment) return;
    // Return cached suggestions immediately — no shimmer, no network request
    const cacheKey = `${datasetId}:${selectedSegment.id}`;
    const cached = purposeSuggestionsCache.get(cacheKey);
    if (cached) { setPurposeSuggestions(cached); return; }

    setSuggestingPurposes(true);
    setError(null);
    try {
      const result = await apiFetch<{ suggestions: VoicePurposeSuggestion[] }>(
        withDataset("/api/voice-campaigns/suggest", datasetId),
        {
          method: "POST",
          body: {
            datasetId, kind: "purposes",
            segmentId: selectedSegment.id,
            experimentSplit: normalizeVoiceCampaignExperimentSplit(experimentSplit, { defaultEnabled: true }),
          },
          datasetId,
        },
      );
      const suggestions = result.suggestions ?? [];
      purposeSuggestionsCache.set(cacheKey, suggestions);
      setPurposeSuggestions(suggestions);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSuggestingPurposes(false);
    }
  }, [datasetId, experimentSplit, selectedSegment, setPurposeSuggestions, setSuggestingPurposes, setError]);

  const handleUsePurpose = useCallback((purpose: Purpose) => {
    const catalogPurpose = offers.find((item) => item.purposeId === purpose.purposeId);
    setCustomPurpose(catalogPurpose ? null : purpose);
    setPurposeId(purpose.purposeId);
  }, [offers, setCustomPurpose, setPurposeId]);

  const handleUseBriefOnly = useCallback(() => {
    setCustomPurpose(null);
    setPurposeId("");
  }, [setCustomPurpose, setPurposeId]);

  const handleUsePurposeSuggestion = useCallback((suggestion: VoicePurposeSuggestion) => {
    const existingPurpose = suggestion.purposeId
      ? offers.find((purpose) => purpose.purposeId === suggestion.purposeId)
      : undefined;
    const purpose = existingPurpose ?? suggestion.purpose ?? buildCampaignBriefPurpose(suggestion.campaignBrief);
    handleUsePurpose(purpose);
    if (suggestion.campaignBrief.trim()) setCampaignBrief(suggestion.campaignBrief.trim());
  }, [handleUsePurpose, offers, setCampaignBrief]);

  const handleSuggestScripts = useCallback(async () => {
    if (!selectedSegment || !selectedOffer) return;
    setSuggestingScripts(true);
    setError(null);
    try {
      const result = await apiFetch<{ options: VoiceScriptOption[] }>(
        withDataset("/api/voice-campaigns/suggest", datasetId),
        {
          method: "POST",
          body: {
            datasetId, kind: "scripts",
            segmentId: selectedSegment.id, purposeId: selectedOffer.purposeId, purpose: selectedOffer,
            scriptNeed: campaignBrief.trim() || undefined,
            successDefinition: successDefinitionWithExperimentBaseline(successDefinition, experimentSplit),
            experimentSplit: normalizeVoiceCampaignExperimentSplit(experimentSplit, { defaultEnabled: true }),
          },
          datasetId,
        },
      );
      setScriptOptions(result.options ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSuggestingScripts(false);
    }
  }, [campaignBrief, datasetId, experimentSplit, selectedOffer, selectedSegment, successDefinition, setScriptOptions, setSuggestingScripts, setError]);

  const handleUseScriptOption = useCallback((option: VoiceScriptOption) => {
    setCampaignBrief(option.campaignBrief);
  }, [setCampaignBrief]);

  /**
   * Generate a draft from the campaign brief.
   *
   * Returns the generation response (including any diagnostics/archetype the
   * route reports) so the caller can stash open items into draft state; null
   * after reporting an error via `setError`.
   */
  const handleGenerateDraft = useCallback(async (): Promise<GeneratedCampaignDraft | null> => {
    const brief = campaignBrief.trim();
    if (!selectedSegment || brief.length < 2) return null;
    const effectivePurpose = !selectedOffer || selectedOffer.category === "campaign-brief"
      ? buildCampaignBriefPurpose(brief)
      : selectedOffer;
    if (!selectedOffer || selectedOffer.category === "campaign-brief") {
      setCustomPurpose(effectivePurpose);
      setPurposeId(effectivePurpose.purposeId);
    }
    if (!datasetReadyForPage) { setError("Dataset is still loading. Try again in a moment."); return null; }
    setGeneratingDraft(true);
    setError(null);
    try {
      const draft = await apiFetch<GeneratedCampaignDraft>(
        withDataset("/api/voice-campaigns/generate-script", datasetId),
        {
          method: "POST",
          body: {
            datasetId,
            segmentId: selectedSegment.id, purposeId: effectivePurpose.purposeId, purpose: effectivePurpose,
            language, brief,
            agentName: agentName.trim() || defaultAgentName(voice),
            voiceGender: geminiVoiceGender(voice),
            successDefinition: successDefinitionWithExperimentBaseline(successDefinition, experimentSplit),
            experimentSplit: normalizeVoiceCampaignExperimentSplit(experimentSplit, { defaultEnabled: true }),
          },
          datasetId,
        },
      );
      const generatedTemplate = generatedWorkflowToTemplate(draft, selectedSegment);
      setTemplate(generatedTemplate);
      setCampaignName(draft.campaignName || campaignName || generatedTemplate.defaultCampaignName);
      setFirstMessage(draft.firstMessage || renderVoiceTemplateText(generatedTemplate.firstMessage, voiceDatasetContext));
      setNodes(generatedTemplate.nodes);
      setEdges(generatedTemplate.edges);
      const nextScript = buildEditableCallScript({ nodes: generatedTemplate.nodes, edges: generatedTemplate.edges });
      setScriptText(nextScript);
      previousGeneratedScriptRef.current = nextScript;
      setSelectedNodeId(null);
      setActiveTab("script");
      // Persist immediately if campaign already exists; otherwise stash in sessionStorage
      // so the script survives a refresh before the user runs a test.
      try { sessionStorage.setItem("vc-draft-script", nextScript); } catch {}
      void persistEditableScript(nextScript, { silent: true }).catch(() => {});
      return draft;
    } catch (err) {
      setError((err as Error).message);
      return null;
    } finally {
      setGeneratingDraft(false);
    }
  }, [
    agentName, campaignBrief, campaignName, datasetId, datasetReadyForPage,
    experimentSplit, language, selectedOffer, selectedSegment, successDefinition, voice,
    voiceDatasetContext,
    setCampaignName, setFirstMessage, setTemplate, setNodes, setEdges, setScriptText,
    setCustomPurpose, setPurposeId,
    setSelectedNodeId, setActiveTab, setGeneratingDraft, setError,
    persistEditableScript, previousGeneratedScriptRef,
  ]);

  /**
   * Import an existing client script document into the studio.
   *
   * Returns the import result (including verbatim-verification detail) so the
   * caller can either apply it directly or route it through the patch-review
   * diff when a script is already present. Returns null after reporting an
   * error via `setError`.
   */
  const handleImportScript = useCallback(async (file: File): Promise<ScriptImportResult | null> => {
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("datasetId", datasetId);
      if (agentName.trim()) form.append("agentName", agentName.trim());
      if (voiceDatasetContext.companyName?.trim()) {
        form.append("companyName", voiceDatasetContext.companyName.trim());
      }
      if (selectedSegment?.name) form.append("segmentName", selectedSegment.name);

      // Multipart — the documented exception to the apiFetch rule, since
      // apiFetch JSON-stringifies its body.
      const res = await fetch(withDataset("/api/voice-campaigns/import-script", datasetId), {
        method: "POST",
        body: form,
        headers: { "x-dataset-id": datasetId },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          typeof body?.error === "string" ? body.error : "Could not import that script.",
        );
      }
      return (await res.json()) as ScriptImportResult;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not import that script.");
      return null;
    }
  }, [agentName, datasetId, selectedSegment, setError, voiceDatasetContext.companyName]);

  /**
   * Commit an imported script into draft state.
   *
   * `script` is passed separately so the caller can hand back the operator's
   * merged result from the patch-review diff rather than the raw import.
   */
  const handleApplyImportedScript = useCallback(async (
    result: ScriptImportResult,
    script: string,
  ) => {
    const template = generatedWorkflowToTemplate(
      {
        campaignName: result.campaignName,
        firstMessage: result.firstMessage,
        reasoning: result.reasoning,
        workflow: result.workflow,
      } as GeneratedCampaignDraft,
      selectedSegment ?? ({ name: result.workflow.audienceHint } as Segment),
    );

    setTemplate(template);
    setNodes(template.nodes);
    setEdges(template.edges);
    setCampaignName(result.campaignName);
    if (result.firstMessage.trim()) setFirstMessage(result.firstMessage);
    setScriptText(script);
    previousGeneratedScriptRef.current = script;
    setSelectedNodeId(null);

    // An imported script is verbatim client copy. The Devanagari auto-rewrite
    // (see handleAutoRewriteIfNeeded) would silently transliterate it and
    // persist the result, so pre-register its key as already handled and adopt
    // the document's own language — together those keep the trigger from ever
    // matching.
    const campaignKeyScript = autoRewriteScriptKey(undefined, script);
    autoRewrittenScriptKeysRef.current.add(campaignKeyScript);

    const detected = result.detectedLanguage?.trim();
    if (detected && detected.toLowerCase() !== language.toLowerCase()) {
      await onLanguageChange(detected);
    }

    try { sessionStorage.setItem("vc-draft-script", script); } catch { /* ignore */ }
    await persistEditableScript(script, { silent: true });
    setActiveTab("script");
  }, [
    autoRewrittenScriptKeysRef, language, onLanguageChange, persistEditableScript,
    previousGeneratedScriptRef, selectedSegment, setActiveTab, setCampaignName, setEdges,
    setFirstMessage, setNodes, setScriptText, setSelectedNodeId, setTemplate,
  ]);

  const handleRewriteScriptHinglish = useCallback(async (options?: { sourceScript?: string; silent?: boolean }) => {
    const sourceScript = options?.sourceScript ?? scriptText;
    if (!sourceScript.trim()) return;
    setRewritingScript(true);
    if (!options?.silent) setError(null);
    try {
      const result = await apiFetch<{ script: string }>(
        withDataset("/api/voice-campaigns/rewrite-script", datasetId),
        {
          method: "POST",
          body: {
            datasetId,
            script: sourceScript,
            spokenLanguage: "Hinglish",
            targetAuthoringLanguage: "Hinglish",
          },
          datasetId,
        },
      );
      const nextScript = result.script?.trim();
      if (nextScript) {
        setScriptText(nextScript);
        await persistEditableScript(nextScript, { silent: true });
      }
    } catch (err) {
      if (!options?.silent) setError((err as Error).message);
    } finally {
      setRewritingScript(false);
    }
  }, [datasetId, persistEditableScript, scriptText, setRewritingScript, setScriptText, setError]);

  /** Rewrite Say: lines into the studio-selected language (Odia/Tamil/… or Hinglish). */
  const handleRewriteScriptToLanguage = useCallback(async (
    targetLanguage: string,
    options?: { sourceScript?: string; silent?: boolean },
  ) => {
    const sourceScript = options?.sourceScript ?? scriptText;
    const target = targetLanguage.trim() || "Hinglish";
    if (!sourceScript.trim()) return;
    setRewritingScript(true);
    if (!options?.silent) setError(null);
    try {
      const result = await apiFetch<{ script: string }>(
        withDataset("/api/voice-campaigns/rewrite-script", datasetId),
        {
          method: "POST",
          body: {
            datasetId,
            script: sourceScript,
            spokenLanguage: target,
            targetAuthoringLanguage: target,
          },
          datasetId,
        },
      );
      const nextScript = result.script?.trim();
      if (nextScript) {
        setScriptText(nextScript);
        try { sessionStorage.setItem("vc-draft-script", nextScript); } catch { /* ignore */ }
        await persistEditableScript(nextScript, { silent: true });
      }
    } catch (err) {
      if (!options?.silent) setError((err as Error).message);
    } finally {
      setRewritingScript(false);
    }
  }, [datasetId, persistEditableScript, scriptText, setRewritingScript, setScriptText, setError]);

  const handleRefineScript = useCallback(async (feedback: string) => {
    if (!scriptText.trim() || !feedback.trim()) return;
    setRefiningScript(true);
    setError(null);
    setScriptHistory((prev) => [...prev.slice(-4), scriptText]);
    try {
      const result = await apiFetch<{ script: string }>(
        withDataset("/api/voice-campaigns/rewrite-script", datasetId),
        {
          method: "POST",
          body: {
            datasetId,
            script: scriptText,
            spokenLanguage: language,
            targetAuthoringLanguage: language,
            instruction: feedback.trim(),
          },
          datasetId,
        },
      );
      const nextScript = result.script?.trim();
      if (nextScript) {
        setScriptText(nextScript);
        setRefineScriptFeedback("");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRefiningScript(false);
    }
  }, [datasetId, language, scriptText, setRefineScriptFeedback, setRefiningScript, setScriptHistory, setScriptText, setError]);

  // Auto-rewrite Devanagari script to Hinglish
  const handleAutoRewriteIfNeeded = useCallback((
    currentScriptText: string,
    existingCampaignId: string | null,
    liveTestCampaignId: string | null,
    loadingExistingCampaign: boolean,
    rewritingScript: boolean,
  ) => {
    if (loadingExistingCampaign || rewritingScript) return;
    if (language.toLowerCase() !== DEFAULT_CAMPAIGN_LANGUAGE.toLowerCase()) return;
    if (!currentScriptText.trim() || !/[ऀ-ॿ]/.test(currentScriptText)) return;

    const campaignId = existingCampaignId ?? liveTestCampaignId ?? undefined;
    const key = autoRewriteScriptKey(campaignId, currentScriptText);
    // Imports suppress the rewrite by pre-registering the campaign-less key
    // (they run before a campaign id exists) — honor both, or a verbatim
    // Devanagari import on a saved campaign gets transliterated anyway.
    const draftKey = autoRewriteScriptKey(undefined, currentScriptText);
    if (autoRewrittenScriptKeysRef.current.has(key) || autoRewrittenScriptKeysRef.current.has(draftKey)) return;
    autoRewrittenScriptKeysRef.current.add(key);

    void handleRewriteScriptHinglish({ sourceScript: currentScriptText, silent: true });
  }, [language, autoRewrittenScriptKeysRef, handleRewriteScriptHinglish]);

  return {
    handleSuggestPurposes,
    handleUsePurpose,
    handleUseBriefOnly,
    handleUsePurposeSuggestion,
    handleSuggestScripts,
    handleUseScriptOption,
    handleGenerateDraft,
    handleImportScript,
    handleApplyImportedScript,
    handleRewriteScriptHinglish,
    handleRewriteScriptToLanguage,
    handleRefineScript,
    handleAutoRewriteIfNeeded,
  };
}
