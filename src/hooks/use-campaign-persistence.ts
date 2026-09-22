"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { layoutVoiceWorkflow } from "@/lib/voice-campaign-layout";
import {
  campaignLanguageForUi,
  defaultOpeningLineForLanguage,
  isSystemGeneratedOpeningLine,
  withDataset,
} from "@/lib/voice-campaign-studio-utils";
import type { VoiceCampaign } from "@/lib/voice-campaign-types";
import type { VoiceCampaignTemplate } from "@/lib/voice-campaign-flow";
import type { VoiceCampaignStudioTab } from "@/components/voice-campaigns/voice-campaign-studio";
import type { CampaignDraftSetters } from "@/hooks/use-campaign-draft";

interface UseCampaignPersistenceParams {
  setters: CampaignDraftSetters;
  scriptText: string;
  firstMessage: string;
  language: string;
  agentName: string;
  companyName: string;
  existingCampaignId: string | null;
  liveTestCampaignId: string | null;
  datasetId: string;
  requestedTab: VoiceCampaignStudioTab | null;
  datasetReadyForPage: boolean;
  lastPersistedScriptRef: React.MutableRefObject<string>;
  autoRewrittenScriptKeysRef: React.MutableRefObject<Set<string>>;
}

export interface CampaignPersistenceResult {
  campaign: VoiceCampaign | null;
  setCampaign: React.Dispatch<React.SetStateAction<VoiceCampaign | null>>;
  loadingExistingCampaign: boolean;
  error: string | null;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  activeTab: VoiceCampaignStudioTab;
  setActiveTab: React.Dispatch<React.SetStateAction<VoiceCampaignStudioTab>>;
  savingLanguage: boolean;
  analyzingResponses: boolean;
  hasLoadedExistingCampaign: boolean;
  preparingExistingCampaign: boolean;
  persistCampaignLanguage: (campaignId: string, nextLanguage: string, nextFirstMessage?: string, options?: { silent?: boolean }) => Promise<VoiceCampaign | undefined>;
  persistEditableScript: (nextScript: string, options?: { silent?: boolean }) => Promise<VoiceCampaign | undefined>;
  applyCampaign: (existing: VoiceCampaign, options?: { preserveEditableInputs?: boolean }) => void;
  refreshExistingCampaign: (options?: { preserveEditableInputs?: boolean }) => Promise<VoiceCampaign | undefined>;
  handleLanguageChange: (nextValue: string) => Promise<void>;
  handleAnalyzeResponses: (force?: boolean) => Promise<void>;
}

export function useCampaignPersistence({
  setters,
  scriptText,
  firstMessage,
  language,
  agentName,
  companyName,
  existingCampaignId,
  liveTestCampaignId,
  datasetId,
  requestedTab,
  lastPersistedScriptRef,
}: UseCampaignPersistenceParams): CampaignPersistenceResult {
  const [campaign, setCampaign] = useState<VoiceCampaign | null>(null);
  const [loadingExistingCampaign, setLoadingExistingCampaign] = useState(() => Boolean(existingCampaignId));
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<VoiceCampaignStudioTab>(
    () => requestedTab ?? (existingCampaignId ? "overview" : "script"),
  );
  const [savingLanguage, setSavingLanguage] = useState(false);
  const [analyzingResponses, setAnalyzingResponses] = useState(false);
  const languageSaveSeqRef = useRef(0);
  const lastResponseAnalysisKeyRef = useRef("");
  const settersRef = useRef(setters);
  settersRef.current = setters;

  const hasLoadedExistingCampaign = Boolean(existingCampaignId && campaign?.id === existingCampaignId);
  const preparingExistingCampaign = Boolean(existingCampaignId) && !error && (
    loadingExistingCampaign || campaign?.id !== existingCampaignId || !setters.scriptHistory
  );

  const persistCampaignLanguage = useCallback(async (
    campaignId: string,
    nextLanguage: string,
    nextFirstMessage?: string,
    options?: { silent?: boolean },
  ): Promise<VoiceCampaign | undefined> => {
    const seq = languageSaveSeqRef.current + 1;
    languageSaveSeqRef.current = seq;
    setSavingLanguage(true);
    try {
      const saved = await apiFetch<VoiceCampaign>(
        withDataset(`/api/voice-campaigns/${encodeURIComponent(campaignId)}`, datasetId),
        {
          method: "PATCH",
          body: {
            datasetId,
            language: nextLanguage,
            languageExplicit: true,
            ...(nextFirstMessage !== undefined ? { firstMessage: nextFirstMessage } : {}),
          },
          skipModel: true,
          datasetId,
        },
      );
      if (languageSaveSeqRef.current === seq) {
        setCampaign((current) => current?.id === saved.id
          ? {
              ...current,
              language: saved.language,
              languageExplicit: true,
              ...(nextFirstMessage !== undefined ? { firstMessage: saved.firstMessage } : {}),
            }
          : current);
      }
      return saved;
    } catch (err) {
      if (!options?.silent && languageSaveSeqRef.current === seq) setError((err as Error).message);
      return undefined;
    } finally {
      if (languageSaveSeqRef.current === seq) setSavingLanguage(false);
    }
  }, [datasetId]);

  const persistEditableScript = useCallback(async (
    nextScript: string,
    options?: { silent?: boolean },
  ): Promise<VoiceCampaign | undefined> => {
    const campaignId = existingCampaignId ?? liveTestCampaignId;
    if (!campaignId || !nextScript.trim()) return undefined;
    try {
      const saved = await apiFetch<VoiceCampaign>(
        withDataset(`/api/voice-campaigns/${encodeURIComponent(campaignId)}`, datasetId),
        {
          method: "PATCH",
          body: { datasetId, editableScript: nextScript, language, languageExplicit: true },
          skipModel: true, datasetId,
        },
      );
      lastPersistedScriptRef.current = saved.editableScript ?? nextScript;
      setCampaign((current) => current?.id === saved.id
        ? { ...current, editableScript: saved.editableScript ?? nextScript, language: saved.language, languageExplicit: true }
        : current);
      return saved;
    } catch (err) {
      if (!options?.silent) setError((err as Error).message);
      return undefined;
    }
  }, [datasetId, existingCampaignId, language, liveTestCampaignId, lastPersistedScriptRef]);

  const applyCampaign = useCallback((existing: VoiceCampaign, options?: { preserveEditableInputs?: boolean }) => {
    const restoredLanguage = campaignLanguageForUi(existing);
    const restoredCampaign = restoredLanguage === existing.language
      ? existing
      : { ...existing, language: restoredLanguage, languageExplicit: true };

    const restoredEdges = existing.workflow?.edges ?? [];
    const restoredNodes = layoutVoiceWorkflow(existing.workflow?.nodes ?? [], restoredEdges);
    const restoredTemplate: VoiceCampaignTemplate = {
      id: existing.workflow?.templateId ?? "existing-campaign",
      title: existing.workflow?.templateTitle ?? existing.name,
      description: "Existing voice campaign",
      objective: existing.scriptReasoning || "Run this voice campaign.",
      audienceHint: existing.segmentName,
      defaultCampaignName: existing.name,
      firstMessage: existing.firstMessage,
      nodes: restoredNodes,
      edges: restoredEdges,
    };

    setCampaign(restoredCampaign);
    setError(null); // successful load always clears any prior error

    if (restoredLanguage !== existing.language) {
      void persistCampaignLanguage(existing.id, restoredLanguage, undefined, { silent: true });
    }

    if (!options?.preserveEditableInputs) {
      settersRef.current.applyDraftFromCampaign(existing, restoredLanguage, restoredTemplate);
    }
  }, [persistCampaignLanguage]);

  const refreshExistingCampaign = useCallback(async (options?: { preserveEditableInputs?: boolean }): Promise<VoiceCampaign | undefined> => {
    if (!existingCampaignId) return undefined;
    const next = await apiFetch<VoiceCampaign>(
      withDataset(`/api/voice-campaigns/${existingCampaignId}`, datasetId),
      { skipModel: true, datasetId },
    );
    applyCampaign(next, options);
    return next;
  }, [applyCampaign, datasetId, existingCampaignId]);

  const handleLanguageChange = useCallback(async (nextValue: string) => {
    const nextLanguage = nextValue.trim() || "Hinglish";
    const resolvedAgentName = campaign?.voiceName || agentName;
    const resolvedCompanyName = campaign?.companyName || companyName;
    const currentFirstMessage = campaign?.firstMessage || firstMessage;
    const shouldRegenerateOpening = isSystemGeneratedOpeningLine(
      currentFirstMessage,
      language,
      { agentName: resolvedAgentName, companyName: resolvedCompanyName },
    );
    const nextFirstMessage = shouldRegenerateOpening
      ? defaultOpeningLineForLanguage(nextLanguage, {
          agentName: resolvedAgentName,
          companyName: resolvedCompanyName,
        })
      : currentFirstMessage;
    setters.setLanguage(nextLanguage as Parameters<typeof setters.setLanguage>[0]);
    if (shouldRegenerateOpening) {
      setters.setFirstMessage(nextFirstMessage as Parameters<typeof setters.setFirstMessage>[0]);
    }
    setCampaign((current) => current ? {
      ...current,
      language: nextLanguage,
      languageExplicit: true,
      ...(shouldRegenerateOpening ? { firstMessage: nextFirstMessage } : {}),
    } : current);
    const campaignId = existingCampaignId ?? liveTestCampaignId;
    if (campaignId) {
      await persistCampaignLanguage(
        campaignId,
        nextLanguage,
        shouldRegenerateOpening ? nextFirstMessage : undefined,
      );
    }
  }, [agentName, campaign?.companyName, campaign?.firstMessage, campaign?.voiceName, companyName, existingCampaignId, firstMessage, language, liveTestCampaignId, persistCampaignLanguage, setters]);

  const responseAnalysisInputKey = useMemo(() => {
    const calls = campaign?.calls ?? [];
    return calls.map((call) => [
      call.id, call.status, call.durationSeconds ?? "",
      call.analysis ? "" : call.summary ?? "",
      (call.transcript ?? []).map((turn) => `${turn.role}:${turn.itemId ?? ""}:${turn.text}`).join("~"),
    ].join("|")).join("||");
  }, [campaign]);

  const handleAnalyzeResponses = useCallback(async (force = false) => {
    if (!existingCampaignId || analyzingResponses) return;
    setAnalyzingResponses(true);
    try {
      const result = await apiFetch<{ campaign?: VoiceCampaign }>(
        withDataset(`/api/voice-campaigns/${existingCampaignId}/analyze-responses`, datasetId),
        { method: "POST", body: { force }, skipModel: true, datasetId },
      );
      if (result.campaign) {
        applyCampaign(result.campaign, { preserveEditableInputs: true });
      } else {
        await refreshExistingCampaign({ preserveEditableInputs: true });
      }
    } catch (err) {
      console.warn("[voice-campaigns] Failed to analyze responses", err);
    } finally {
      setAnalyzingResponses(false);
    }
  }, [analyzingResponses, applyCampaign, datasetId, existingCampaignId, refreshExistingCampaign]);

  // Stable ref so the initial load effect doesn't re-fire when applyCampaign's
  // identity changes due to setters/persistCampaignLanguage re-renders.
  const applyCampaignRef = useRef(applyCampaign);
  applyCampaignRef.current = applyCampaign;

  // Initial load of existing campaign — does NOT wait for datasetReadyForPage
  // because the campaign JSON store is independent of DuckDB/dataset initialization.
  useEffect(() => {
    if (!existingCampaignId) { setCampaign(null); setLoadingExistingCampaign(false); return; }
    let active = true;
    setLoadingExistingCampaign(true);
    apiFetch<VoiceCampaign>(withDataset(`/api/voice-campaigns/${existingCampaignId}`, datasetId), { skipModel: true, datasetId })
      .then((existing) => {
        if (!active) return;
        applyCampaignRef.current(existing);
        setActiveTab(requestedTab ?? "script");
      })
      .catch((err) => {
        // Only surface hard errors (404 Not Found). Transient network errors
        // ("Failed to fetch") are silent — the 5-second poll recovers them.
        const msg = (err as Error).message ?? "";
        if (active && (msg.includes("Not found") || msg.includes("404"))) {
          setError("Campaign not found.");
        }
      })
      .finally(() => { if (active) setLoadingExistingCampaign(false); });
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingCampaignId, requestedTab]);

  // Refresh on tab navigation to data tabs
  useEffect(() => {
    if (!existingCampaignId || !hasLoadedExistingCampaign) return;
    if (!["overview", "call-logs", "voice-analysis"].includes(activeTab)) return;
    refreshExistingCampaign({ preserveEditableInputs: true }).catch(() => undefined);
  }, [activeTab, existingCampaignId, hasLoadedExistingCampaign, refreshExistingCampaign]);

  // Auto-analyze responses when navigating to voice-analysis tab
  useEffect(() => {
    if (activeTab !== "voice-analysis" || !existingCampaignId || !hasLoadedExistingCampaign || !responseAnalysisInputKey) return;
    if (lastResponseAnalysisKeyRef.current === responseAnalysisInputKey) return;
    lastResponseAnalysisKeyRef.current = responseAnalysisInputKey;
    void handleAnalyzeResponses(false);
  }, [activeTab, existingCampaignId, handleAnalyzeResponses, hasLoadedExistingCampaign, responseAnalysisInputKey]);

  // Auto-save script with 900ms debounce
  useEffect(() => {
    const campaignId = existingCampaignId ?? liveTestCampaignId;
    if (!campaignId || loadingExistingCampaign || !scriptText.trim()) return;
    if (scriptText === lastPersistedScriptRef.current) return;
    const timer = window.setTimeout(() => { void persistEditableScript(scriptText, { silent: true }); }, 900);
    return () => window.clearTimeout(timer);
  }, [existingCampaignId, liveTestCampaignId, loadingExistingCampaign, persistEditableScript, scriptText, lastPersistedScriptRef]);

  return {
    campaign, setCampaign, loadingExistingCampaign, error, setError,
    activeTab, setActiveTab, savingLanguage, analyzingResponses,
    hasLoadedExistingCampaign, preparingExistingCampaign,
    persistCampaignLanguage, persistEditableScript, applyCampaign,
    refreshExistingCampaign, handleLanguageChange, handleAnalyzeResponses,
  };
}
