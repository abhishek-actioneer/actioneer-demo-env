"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import {
  compileVoiceCampaignScript,
  type VoiceDatasetContext,
  type VoiceFlowNode,
  type VoiceFlowEdge,
  type VoiceCampaignTemplate,
} from "@/lib/voice-campaign-flow";
import {
  withDataset,
  campaignPurposeFallback,
  campaignSegmentFallback,
  templateWithEditedCallScript,
  extractOpeningLineFromScript,
  extractOpeningLineFromWorkflow,
  isSystemGeneratedOpeningLine,
  type VoiceCampaignTemplateWithRoutes,
} from "@/lib/voice-campaign-studio-utils";
import { normalizeVoiceCampaignExperimentSplit, successDefinitionWithExperimentBaseline } from "@/lib/voice-campaign-experiment";
import { geminiVoiceGender, geminiPreviewText } from "@/lib/gemini-voices";
import type {
  VoiceCampaign,
  VoiceCallProvider,
  VoiceCampaignExperimentSplit,
  VoiceCampaignSuccessDefinition,
} from "@/lib/voice-campaign-types";
import type { Segment } from "@/lib/types";
import type { Purpose } from "@/lib/purpose-types";

type CompiledCampaignScript = ReturnType<typeof compileVoiceCampaignScript>;

interface UseCampaignActionsParams {
  datasetId: string;
  existingCampaignId: string | null;
  // draft
  template: VoiceCampaignTemplate | null;
  campaignName: string;
  firstMessage: string;
  scriptText: string;
  language: string;
  voice: string;
  agentName: string;
  companyName: string;
  personaPrompt: string;
  selectedVoiceName: string;
  callProvider: VoiceCallProvider;
  nodes: VoiceFlowNode[];
  edges: VoiceFlowEdge[];
  segmentId: string;
  purposeId: string;
  phoneNumbers: string[];
  successDefinition: VoiceCampaignSuccessDefinition;
  experimentSplit: VoiceCampaignExperimentSplit;
  voiceDatasetContext: VoiceDatasetContext;
  selectedSegment: Segment | undefined;
  selectedOffer: Purpose | undefined;
  // persistence
  campaign: VoiceCampaign | null;
  applyCampaign: (c: VoiceCampaign, opts?: { preserveEditableInputs?: boolean }) => void;
  refreshExistingCampaign: (opts?: { preserveEditableInputs?: boolean }) => Promise<VoiceCampaign | undefined>;
  setActiveTab: (tab: string) => void;
  setError: (msg: string | null) => void;
  // live test state setters (from useLiveTest)
  liveTestCampaignId: string | null;
  setLiveTestCampaignId: (id: string) => void;
  setPreparingLiveTest: (b: boolean) => void;
  openCustomerModalForBrowser: () => void;
  setAutoStartLiveTest: (b: boolean) => void;
  preparingLiveTest: boolean;
}

export function useCampaignActions({
  datasetId, existingCampaignId,
  template, campaignName, firstMessage, scriptText, language, voice, agentName,
  companyName, personaPrompt,
  selectedVoiceName, callProvider, nodes, edges, segmentId, purposeId, phoneNumbers,
  successDefinition, experimentSplit, voiceDatasetContext,
  selectedSegment, selectedOffer,
  campaign, applyCampaign, refreshExistingCampaign, setActiveTab, setError,
  liveTestCampaignId, setLiveTestCampaignId, setPreparingLiveTest,
  openCustomerModalForBrowser, setAutoStartLiveTest, preparingLiveTest,
}: UseCampaignActionsParams) {
  const router = useRouter();
  const [launching, setLaunching] = useState(false);
  const [recalling, setRecalling] = useState(false);
  const [savingCampaign, setSavingCampaign] = useState(false);
  const [deletingCampaign, setDeletingCampaign] = useState(false);
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);
  const [callDialogRow, setCallDialogRow] = useState<Record<string, unknown> | null>(null);
  const [callPhone, setCallPhone] = useState("");
  const [callLoading, setCallLoading] = useState(false);

  // Routes bound by the current draft (import/generation) take precedence over
  // whatever the stored campaign carries — same rule as buildPatchBody.
  const draftUniversalRoutes =
    (template as VoiceCampaignTemplateWithRoutes | null)?.universalRoutes
    ?? campaign?.workflow?.universalRoutes;

  const buildCompiled = useCallback((seg: Segment, offer: Purpose) =>
    compileVoiceCampaignScript({
      template: templateWithEditedCallScript(template!, scriptText, nodes, edges),
      campaignName, firstMessage, nodes, edges,
      segment: seg, purpose: offer,
      dataset: voiceDatasetContext, language, voice, voiceName: selectedVoiceName, agentName,
      companyName, personaPrompt,
      guardrails: successDefinition.guardrails,
      operatorScript: scriptText,
      universalRoutes: draftUniversalRoutes,
    }),
    [template, scriptText, nodes, edges, campaignName, firstMessage, voiceDatasetContext, language, voice, selectedVoiceName, agentName, companyName, personaPrompt, successDefinition.guardrails, draftUniversalRoutes],
  );

  const buildPatchBody = useCallback((
    compiled: CompiledCampaignScript | null,
    options?: { segment?: Segment | null; purpose?: Purpose | null },
  ) => {
    const nextSegmentId = options?.segment?.id || campaign?.segmentId || "";
    const nextPurposeId = options?.purpose?.purposeId || campaign?.purposeId || "";
    const nextSystemPrompt = compiled?.systemPrompt ?? campaign?.systemPrompt ?? scriptText.trim();
    const storedFirstMessage = ((compiled?.firstMessage ?? firstMessage) || campaign?.firstMessage) ?? "";
    // Opening is workflow-authored. Prefer start-node Say:, then Script-tab
    // spoken line, then stored firstMessage (legacy / Spanish sync).
    const workflowOpening = extractOpeningLineFromWorkflow(nodes);
    const scriptOpening = extractOpeningLineFromScript(scriptText);
    const stockOpener = isSystemGeneratedOpeningLine(storedFirstMessage, language, {
      agentName: agentName || selectedVoiceName || campaign?.voiceName,
      companyName: companyName || voiceDatasetContext.companyName || campaign?.companyName,
    });
    const nextFirstMessage =
      workflowOpening
      || (scriptOpening && stockOpener ? scriptOpening : storedFirstMessage);
    const nextScriptReasoning = compiled?.reasoning ?? campaign?.scriptReasoning ?? "";

    return {
      datasetId,
      datasetLabel: voiceDatasetContext.label,
      companyName: companyName || voiceDatasetContext.companyName,
      entityName: voiceDatasetContext.entityName,
      ...(campaignName || campaign?.name ? { campaignName: campaignName || campaign?.name } : {}),
      ...(nextSegmentId ? { segmentId: nextSegmentId } : {}),
      ...(nextPurposeId ? { purposeId: nextPurposeId } : {}),
      ...(options?.purpose?.purposeId ? { purpose: options.purpose } : {}),
      phoneNumbers,
      language,
      languageExplicit: true,
      voice,
      voiceName: agentName || selectedVoiceName,
      callProvider,
      ...(nextSystemPrompt.trim() ? { systemPrompt: nextSystemPrompt } : {}),
      firstMessage: nextFirstMessage,
      scriptReasoning: nextScriptReasoning,
      ...(personaPrompt.trim() ? { personaPrompt } : {}),
      successDefinition: successDefinitionWithExperimentBaseline(successDefinition, experimentSplit),
      experimentSplit: normalizeVoiceCampaignExperimentSplit(experimentSplit, { defaultEnabled: true }),
      ...(template
        ? {
            workflow: {
              templateId: template.id,
              templateTitle: template.title,
              nodes,
              edges,
              // Draft routes (import/generation ride on the template object)
              // win over the campaign's stored ones.
              universalRoutes:
                (template as VoiceCampaignTemplateWithRoutes).universalRoutes
                ?? campaign?.workflow?.universalRoutes,
            },
          }
        : campaign?.workflow
          ? { workflow: campaign.workflow }
          : {}),
      editableScript: scriptText,
    };
  }, [
    agentName, callProvider, campaign, campaignName, companyName, datasetId, edges, experimentSplit,
    firstMessage, language, nodes, personaPrompt, phoneNumbers, scriptText, selectedVoiceName,
    successDefinition, template, voice, voiceDatasetContext,
  ]);

  const compileCurrentScript = useCallback((): CompiledCampaignScript | null => {
    if (template && selectedSegment && selectedOffer) return buildCompiled(selectedSegment, selectedOffer);
    const trimmedScript = scriptText.trim();
    if (!trimmedScript) return null;
    const stored = firstMessage || campaign?.firstMessage || "";
    const workflowOpening = extractOpeningLineFromWorkflow(nodes);
    const scriptOpening = extractOpeningLineFromScript(trimmedScript);
    const stockOpener = isSystemGeneratedOpeningLine(stored, language, {
      agentName: agentName || selectedVoiceName || campaign?.voiceName,
      companyName: companyName || voiceDatasetContext.companyName || campaign?.companyName,
    });
    return {
      systemPrompt: trimmedScript,
      firstMessage:
        workflowOpening
        || (scriptOpening && stockOpener ? scriptOpening : stored),
      reasoning: campaign?.scriptReasoning ?? "",
    };
  }, [
    agentName, buildCompiled, campaign?.companyName, campaign?.firstMessage, campaign?.scriptReasoning,
    campaign?.voiceName, companyName, firstMessage, language, nodes, scriptText, selectedOffer, selectedSegment,
    selectedVoiceName, template, voiceDatasetContext.companyName,
  ]);

  const ensureLiveTestCampaign = useCallback(async (): Promise<string | undefined> => {
    const campaignId = existingCampaignId ?? liveTestCampaignId;
    if (campaignId) {
      const compiled = compileCurrentScript();
      if (!compiled && !campaign?.systemPrompt?.trim()) {
        toast.error("Write a script first before starting a live test.");
        return undefined;
      }
      if (compiled || scriptText.trim()) {
        const saved = await apiFetch<VoiceCampaign>(
          withDataset(`/api/voice-campaigns/${encodeURIComponent(campaignId)}`, datasetId),
          {
            method: "PATCH",
            body: buildPatchBody(compiled, {
              segment: selectedSegment ?? campaignSegmentFallback(campaign),
              purpose: selectedOffer ?? campaignPurposeFallback(campaign),
            }),
            datasetId,
            skipModel: true,
          },
        );
        applyCampaign(saved, { preserveEditableInputs: true });
      }
      return campaignId;
    }

    // Require at minimum a script (template + segment + offer preferred, but scriptText alone works)
    const hasFullSetup = template && selectedSegment && selectedOffer;
    if (!hasFullSetup && !scriptText.trim()) {
      toast.error("Write a script first before starting a live test.");
      return undefined;
    }

    const compiled = hasFullSetup
      ? buildCompiled(selectedSegment, selectedOffer)
      : { systemPrompt: scriptText.trim(), firstMessage: firstMessage || "", reasoning: "" };

    const result = await apiFetch<{ id: string; callProvider?: VoiceCallProvider; campaign?: VoiceCampaign }>(
      withDataset("/api/voice-campaigns", datasetId),
      {
        method: "POST",
        body: {
          launch: false, datasetId,
          datasetLabel: voiceDatasetContext.label,
          companyName: voiceDatasetContext.companyName,
          entityName: voiceDatasetContext.entityName,
          campaignName: campaignName || "Browser test",
          segmentId: segmentId || "test", purposeId: purposeId || "test",
          ...(selectedOffer && { purpose: selectedOffer }),
          systemPrompt: compiled.systemPrompt, firstMessage: compiled.firstMessage,
          scriptReasoning: compiled.reasoning, editableScript: scriptText,
          voice, voiceName: agentName || selectedVoiceName,
          callProvider, language, languageExplicit: true,
          successDefinition: successDefinitionWithExperimentBaseline(successDefinition, experimentSplit),
          experimentSplit: normalizeVoiceCampaignExperimentSplit(experimentSplit, { defaultEnabled: true }),
          ...(template && { workflow: { templateId: template.id, templateTitle: template.title, nodes, edges, universalRoutes: draftUniversalRoutes } }),
          phoneNumbers,
        },
        datasetId, skipModel: true,
      },
    );
    setLiveTestCampaignId(result.id);
    if (result.campaign) applyCampaign(result.campaign, { preserveEditableInputs: true });
    router.replace(`/voice-campaigns/new?campaignId=${encodeURIComponent(result.id)}`);
    return result.id;
  }, [
    agentName, applyCampaign, buildCompiled, buildPatchBody, callProvider, campaign, campaignName, draftUniversalRoutes,
    compileCurrentScript, datasetId, edges, existingCampaignId, firstMessage, language,
    liveTestCampaignId, nodes, purposeId, phoneNumbers, router,
    scriptText, segmentId, selectedOffer, selectedSegment, selectedVoiceName,
    setLiveTestCampaignId, successDefinition, experimentSplit, template, voice, voiceDatasetContext,
  ]);

  const openLiveTest = useCallback(async (): Promise<boolean> => {
    if (preparingLiveTest) return false;
    setPreparingLiveTest(true);
    setError(null);
    try {
      const campaignIdForTest = await ensureLiveTestCampaign();
      if (!campaignIdForTest) return false;
      setAutoStartLiveTest(false);
      openCustomerModalForBrowser();
      return true;
    } catch (err) {
      toast.error((err as Error).message); setError(null);
      return false;
    } finally {
      setPreparingLiveTest(false);
    }
  }, [ensureLiveTestCampaign, openCustomerModalForBrowser, preparingLiveTest, setAutoStartLiveTest, setError, setPreparingLiveTest]);

  const handleLaunch = useCallback(async () => {
    if (!template || !selectedSegment || !selectedOffer || phoneNumbers.length === 0) return;
    setLaunching(true);
    setError(null);
    try {
      const compiled = buildCompiled(selectedSegment, selectedOffer);
      if (existingCampaignId) {
        const saved = await apiFetch<VoiceCampaign>(
          withDataset(`/api/voice-campaigns/${encodeURIComponent(existingCampaignId)}`, datasetId),
          {
            method: "PATCH",
            body: buildPatchBody(compiled, { segment: selectedSegment, purpose: selectedOffer }),
            datasetId,
            skipModel: true,
          },
        );
        applyCampaign(saved, { preserveEditableInputs: true });
        await apiFetch<{ ok: boolean }>(
          withDataset(`/api/voice-campaigns/${encodeURIComponent(existingCampaignId)}/launch`, datasetId),
          {
            method: "POST",
            body: {
              campaignName: campaignName || saved.name,
              phoneNumbers,
              voice,
              voiceName: agentName || selectedVoiceName,
              callProvider,
              language,
              languageExplicit: true,
              experimentSplit: normalizeVoiceCampaignExperimentSplit(experimentSplit, { defaultEnabled: true }),
            },
            datasetId,
            skipModel: true,
          },
        );
        await refreshExistingCampaign({ preserveEditableInputs: true });
        setActiveTab("call-logs");
        return;
      }
      const result = await apiFetch<{ id: string }>(
        withDataset("/api/voice-campaigns", datasetId),
        {
          method: "POST",
          body: {
            datasetId, datasetLabel: voiceDatasetContext.label,
            companyName: voiceDatasetContext.companyName, entityName: voiceDatasetContext.entityName,
            campaignName, segmentId, purposeId, purpose: selectedOffer,
            systemPrompt: compiled.systemPrompt, firstMessage: compiled.firstMessage,
            scriptReasoning: compiled.reasoning, editableScript: scriptText,
            voice, voiceName: agentName || selectedVoiceName, callProvider, language, languageExplicit: true,
            successDefinition: successDefinitionWithExperimentBaseline(successDefinition, experimentSplit),
            experimentSplit: normalizeVoiceCampaignExperimentSplit(experimentSplit, { defaultEnabled: true }),
            workflow: { templateId: template.id, templateTitle: template.title, nodes, edges, universalRoutes: draftUniversalRoutes },
            phoneNumbers,
          },
          datasetId, skipModel: true,
        },
      );
      router.replace(`/voice-campaigns/new?campaignId=${encodeURIComponent(result.id)}`);
    } catch (err) {
      toast.error((err as Error).message); setError(null);
    } finally {
      setLaunching(false);
    }
  }, [
    agentName, applyCampaign, buildCompiled, buildPatchBody, callProvider, campaignName, datasetId, draftUniversalRoutes,
    edges, existingCampaignId, experimentSplit, language, nodes, purposeId, phoneNumbers,
    refreshExistingCampaign, router, scriptText, segmentId, selectedOffer, selectedSegment,
    selectedVoiceName, setActiveTab, setError, successDefinition, template, voice, voiceDatasetContext,
  ]);

  const handleAudienceLaunchHoldComplete = useCallback(async () => {
    if (!selectedSegment || !selectedOffer || !template) {
      toast.error("Select an audience, purpose, and script before launching."); setError(null);
      return;
    }
    setLaunching(true);
    setError(null);
    try {
      const campaignId = await ensureLiveTestCampaign();
      if (!campaignId) return;
      const result = await apiFetch<{ ok: boolean; campaign?: VoiceCampaign }>(
        withDataset(`/api/voice-campaigns/${encodeURIComponent(campaignId)}/simulate-launch`, datasetId),
        { method: "POST", body: { audienceSize: selectedSegment.userCount }, datasetId, skipModel: true },
      );
      if (result.campaign) applyCampaign(result.campaign, { preserveEditableInputs: true });
      else await refreshExistingCampaign({ preserveEditableInputs: true });
      setActiveTab("overview");
    } catch (err) {
      toast.error((err as Error).message); setError(null);
    } finally {
      setLaunching(false);
    }
  }, [applyCampaign, datasetId, ensureLiveTestCampaign, refreshExistingCampaign, selectedOffer, selectedSegment, setActiveTab, setError, template]);

  const handleCallAgain = useCallback(async () => {
    if (!existingCampaignId) { toast.error("Save or launch the campaign before calling again."); setError(null); return; }
    if (phoneNumbers.length === 0) { toast.error("Add at least one phone number before calling again."); setError(null); return; }
    const recallSegment = selectedSegment ?? campaignSegmentFallback(campaign);
    const recallPurpose = selectedOffer ?? campaignPurposeFallback(campaign);
    if (!campaign && (!template || !recallSegment || !recallPurpose)) {
      toast.error("Campaign is still loading. Try again in a moment."); setError(null);
      return;
    }
    setRecalling(true);
    setError(null);
    try {
      const compiled = template && recallSegment && recallPurpose ? buildCompiled(recallSegment, recallPurpose) : null;
      await apiFetch<{ ok: boolean }>(
        withDataset(`/api/voice-campaigns/${existingCampaignId}/recall`, datasetId),
        {
          method: "POST",
          body: {
            campaignName: campaignName || campaign?.name, phoneNumbers,
            language, languageExplicit: true,
            voice, voiceName: agentName || selectedVoiceName, callProvider,
            systemPrompt: compiled?.systemPrompt ?? campaign?.systemPrompt,
            firstMessage: (compiled?.firstMessage ?? firstMessage) || campaign?.firstMessage,
            scriptReasoning: compiled?.reasoning ?? campaign?.scriptReasoning ?? "",
            editableScript: scriptText,
            successDefinition: successDefinitionWithExperimentBaseline(successDefinition, experimentSplit),
            experimentSplit: normalizeVoiceCampaignExperimentSplit(experimentSplit, { defaultEnabled: true }),
            workflow: template
              ? { templateId: template.id, templateTitle: template.title, nodes, edges, universalRoutes: draftUniversalRoutes }
              : campaign?.workflow,
          },
          skipModel: true, datasetId,
        },
      );
      await refreshExistingCampaign({ preserveEditableInputs: true });
      setActiveTab("call-logs");
    } catch (err) {
      toast.error((err as Error).message); setError(null);
    } finally {
      setRecalling(false);
    }
  }, [
    agentName, buildCompiled, callProvider, campaign, campaignName, datasetId, draftUniversalRoutes, edges, existingCampaignId,
    experimentSplit, firstMessage, language, nodes, phoneNumbers, refreshExistingCampaign,
    scriptText, selectedOffer, selectedSegment, selectedVoiceName, setActiveTab, setError,
    successDefinition, template, voice,
  ]);

  const handleSaveCampaignEdits = useCallback(async () => {
    if (!existingCampaignId) { toast.error("Launch this campaign before saving script edits."); setError(null); return; }
    if (!scriptText.trim()) { toast.error("Add a conversation script before saving."); setError(null); return; }
    const saveSegment = selectedSegment ?? campaignSegmentFallback(campaign);
    const savePurpose = selectedOffer ?? campaignPurposeFallback(campaign);
    const compiled = template && saveSegment && savePurpose ? buildCompiled(saveSegment, savePurpose) : null;
    if (!compiled && !campaign) { toast.error("Campaign is still loading. Try again in a moment."); setError(null); return; }
    setSavingCampaign(true);
    setError(null);
    try {
      const saved = await apiFetch<VoiceCampaign>(
        withDataset(`/api/voice-campaigns/${encodeURIComponent(existingCampaignId)}`, datasetId),
        {
          method: "PATCH",
          body: buildPatchBody(compiled, { segment: saveSegment, purpose: savePurpose }),
          skipModel: true, datasetId,
        },
      );
      applyCampaign(saved, { preserveEditableInputs: true });
    } catch (err) {
      toast.error((err as Error).message); setError(null);
    } finally {
      setSavingCampaign(false);
    }
  }, [
    applyCampaign, buildCompiled, buildPatchBody, campaign, datasetId, existingCampaignId,
    selectedOffer, selectedSegment, setError, scriptText, template,
  ]);

  const handleSaveMeasurementSettings = useCallback(async () => {
    if (!existingCampaignId) return;
    setSavingCampaign(true);
    setError(null);
    try {
      const saved = await apiFetch<VoiceCampaign>(
        withDataset(`/api/voice-campaigns/${encodeURIComponent(existingCampaignId)}`, datasetId),
        {
          method: "PATCH",
          body: {
            datasetId,
            successDefinition: successDefinitionWithExperimentBaseline(successDefinition, experimentSplit),
            experimentSplit: normalizeVoiceCampaignExperimentSplit(experimentSplit, { defaultEnabled: true }),
          },
          skipModel: true, datasetId,
        },
      );
      applyCampaign(saved, { preserveEditableInputs: true });
    } catch (err) {
      toast.error((err as Error).message); setError(null);
    } finally {
      setSavingCampaign(false);
    }
  }, [applyCampaign, datasetId, existingCampaignId, experimentSplit, setError, successDefinition]);

  const handleDeleteCampaign = useCallback(async () => {
    if (!existingCampaignId || deletingCampaign) return;
    setDeletingCampaign(true);
    setError(null);
    try {
      await apiFetch(withDataset(`/api/voice-campaigns/${encodeURIComponent(existingCampaignId)}`, datasetId), {
        method: "DELETE", skipModel: true, datasetId,
      });
      router.replace("/voice-campaigns");
    } catch (err) {
      toast.error((err as Error).message); setError(null);
    } finally {
      setDeletingCampaign(false);
    }
  }, [datasetId, deletingCampaign, existingCampaignId, router, setError]);

  const handlePreviewVoice = useCallback(async (voiceName: string) => {
    setPreviewingVoice(voiceName);
    setError(null);
    try {
      const gender = geminiVoiceGender(voiceName);
      const text = geminiPreviewText(gender === "unknown" ? "female" : gender, language);
      const res = await apiFetch("/api/voice/gemini-preview", {
        method: "POST", body: { voiceName, text }, stream: true, skipDataset: true, skipModel: true,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(typeof body.error === "string" ? body.error : "Voice preview failed");
      }
      const url = URL.createObjectURL(await res.blob());
      const audio = new Audio(url);
      audio.addEventListener("ended", () => URL.revokeObjectURL(url), { once: true });
      await audio.play();
    } catch (err) {
      toast.error((err as Error).message); setError(null);
    } finally {
      setPreviewingVoice(null);
    }
  }, [language, setError]);

  const handleCallUser = useCallback(async (
    campaignId: string,
    userId: unknown,
    txnId: unknown,
    phone: string,
    customerContext?: unknown,
    isTest?: boolean,
  ): Promise<void> => {
    setCallLoading(true);
    try {
      await apiFetch<{ callId: string; toNumber: string; status: string }>(`/api/voice-campaigns/${campaignId}/call-user`, {
        method: "POST",
        body: { userId, txnId, phone, ...(customerContext ? { customerContext } : {}), ...(isTest ? { isTest: true } : {}) },
        datasetId,
        skipModel: true,
      });
      setCallDialogRow(null);
      setCallPhone("");
    } finally {
      setCallLoading(false);
    }
  }, [datasetId]);

  return {
    launching, recalling, savingCampaign, deletingCampaign, previewingVoice,
    callDialogRow, setCallDialogRow, callPhone, setCallPhone, callLoading,
    ensureLiveTestCampaign, openLiveTest,
    handleLaunch, handleAudienceLaunchHoldComplete, handleCallAgain,
    handleSaveCampaignEdits, handleSaveMeasurementSettings, handleDeleteCampaign,
    handlePreviewVoice, handleCallUser,
  };
}
