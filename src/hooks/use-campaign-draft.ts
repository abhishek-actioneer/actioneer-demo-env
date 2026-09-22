"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNodesState, useEdgesState } from "@xyflow/react";
import { useScriptHistory } from "@/hooks/use-script-history";
import { useDataset } from "@/lib/dataset-context";
import {
  renderVoiceTemplateText,
  defaultAgentName,
  defaultVoiceCampaignPersonaPrompt,
  type VoiceFlowNode,
  type VoiceFlowNodeData,
  type VoiceFlowNodeKind,
  type VoiceFlowEdge,
  type VoiceCampaignTemplate,
  type VoiceDatasetContext,
} from "@/lib/voice-campaign-flow";
import { layoutVoiceWorkflow } from "@/lib/voice-campaign-layout";
import {
  applyScriptToWorkflow,
  applyWorkflowToScript,
  bootstrapWorkflowFromScript,
  buildEditableCallScript,
  parsePhoneNumbers,
  loadTestNumbers,
  workflowScriptFingerprint,
  DEFAULT_CAMPAIGN_LANGUAGE,
  type VoiceScriptOption,
  type VoicePurposeSuggestion,
} from "@/lib/voice-campaign-studio-utils";
import { DEFAULT_GEMINI_VOICE, geminiVoiceDisplayName, geminiVoiceGenderLabel, geminiVoiceGender } from "@/lib/gemini-voices";
import { defaultVoiceCampaignSuccessDefinition, normalizeVoiceCampaignSuccessDefinition } from "@/lib/voice-campaign-success";
import { defaultVoiceCampaignExperimentSplit, normalizeVoiceCampaignExperimentSplit } from "@/lib/voice-campaign-experiment";
import type {
  VoiceCallProvider,
  VoiceCampaign,
  VoiceCampaignExperimentSplit,
  VoiceCampaignSuccessDefinition,
} from "@/lib/voice-campaign-types";
import type { Segment } from "@/lib/types";
import type { Purpose } from "@/lib/purpose-types";
import type { CampaignDiagnostic } from "@/lib/voice-diagnostics";
import { buildCampaignBriefPurpose } from "@/lib/voice-campaign-purpose";

const NEW_NODE_TITLES: Record<VoiceFlowNodeKind, string> = {
  start: "Call Connect",
  prompt: "New Message",
  question: "New Question",
  condition: "New Decision",
  action: "New Action",
  transfer: "New Handoff",
  end: "New Close",
};

function makeFlowEdge(source: string, target: string, label?: string): VoiceFlowEdge {
  return {
    id: `e-${source}-${target}-${label ?? "next"}`.replace(/\s+/g, "-").toLowerCase(),
    source,
    target,
    label,
    type: "smoothstep",
  };
}

export interface CampaignDraftState {
  template: VoiceCampaignTemplate | null;
  campaignName: string;
  firstMessage: string;
  scriptText: string;
  campaignBrief: string;
  segmentId: string;
  purposeId: string;
  voice: string;
  agentName: string;
  companyName: string;
  personaPrompt: string;
  callProvider: VoiceCallProvider;
  language: string;
  successDefinition: VoiceCampaignSuccessDefinition;
  experimentSplit: VoiceCampaignExperimentSplit;
  phoneRaw: string;
  testNumbers: string[];
  selectedNodeId: string | null;
  purposeSuggestions: VoicePurposeSuggestion[];
  suggestingPurposes: boolean;
  scriptOptions: VoiceScriptOption[];
  suggestingScripts: boolean;
  generatingDraft: boolean;
  rewritingScript: boolean;
  refineScriptFeedback: string;
  refiningScript: boolean;
  /** Open items from the latest import/generation — cleared when the draft resets. */
  diagnostics: CampaignDiagnostic[];
  // derived
  selectedSegment: Segment | undefined;
  selectedOffer: Purpose | undefined;
  phoneNumbers: string[];
  voiceDatasetContext: VoiceDatasetContext;
  selectedVoiceName: string;
  selectedVoiceLabel: string;
  showVoiceSelector: boolean;
}

export interface CampaignDraftSetters {
  setTemplate: React.Dispatch<React.SetStateAction<VoiceCampaignTemplate | null>>;
  setCampaignName: React.Dispatch<React.SetStateAction<string>>;
  setFirstMessage: React.Dispatch<React.SetStateAction<string>>;
  setScriptText: React.Dispatch<React.SetStateAction<string>>;
  setCampaignBrief: React.Dispatch<React.SetStateAction<string>>;
  setSegmentId: React.Dispatch<React.SetStateAction<string>>;
  setPurposeId: React.Dispatch<React.SetStateAction<string>>;
  setCustomPurpose: React.Dispatch<React.SetStateAction<Purpose | null>>;
  setVoice: React.Dispatch<React.SetStateAction<string>>;
  setAgentName: React.Dispatch<React.SetStateAction<string>>;
  setCompanyName: React.Dispatch<React.SetStateAction<string>>;
  setPersonaPrompt: React.Dispatch<React.SetStateAction<string>>;
  setCallProvider: React.Dispatch<React.SetStateAction<VoiceCallProvider>>;
  setLanguage: React.Dispatch<React.SetStateAction<string>>;
  setSuccessDefinition: React.Dispatch<React.SetStateAction<VoiceCampaignSuccessDefinition>>;
  setExperimentSplit: React.Dispatch<React.SetStateAction<VoiceCampaignExperimentSplit>>;
  setPhoneRaw: React.Dispatch<React.SetStateAction<string>>;
  setTestNumbers: React.Dispatch<React.SetStateAction<string[]>>;
  setSelectedNodeId: React.Dispatch<React.SetStateAction<string | null>>;
  setPurposeSuggestions: React.Dispatch<React.SetStateAction<VoicePurposeSuggestion[]>>;
  setSuggestingPurposes: React.Dispatch<React.SetStateAction<boolean>>;
  setScriptOptions: React.Dispatch<React.SetStateAction<VoiceScriptOption[]>>;
  setSuggestingScripts: React.Dispatch<React.SetStateAction<boolean>>;
  setGeneratingDraft: React.Dispatch<React.SetStateAction<boolean>>;
  setRewritingScript: React.Dispatch<React.SetStateAction<boolean>>;
  setRefineScriptFeedback: React.Dispatch<React.SetStateAction<string>>;
  setRefiningScript: React.Dispatch<React.SetStateAction<boolean>>;
  setDiagnostics: React.Dispatch<React.SetStateAction<CampaignDiagnostic[]>>;
  setNodes: ReturnType<typeof useNodesState<VoiceFlowNode>>[1];
  setEdges: ReturnType<typeof useEdgesState<VoiceFlowEdge>>[1];
  onNodesChange: ReturnType<typeof useNodesState<VoiceFlowNode>>[2];
  onEdgesChange: ReturnType<typeof useEdgesState<VoiceFlowEdge>>[2];
  updateFlowNode: (nodeId: string, patch: Partial<VoiceFlowNodeData>) => void;
  /** Insert a new node after `afterNodeId` (null → after the last non-end step). Returns the new node id. */
  insertFlowNode: (afterNodeId: string | null, kind: VoiceFlowNodeKind) => string | null;
  /** Remove a node, bridging its parents to its children. Start nodes cannot be removed. */
  removeFlowNode: (nodeId: string) => void;
  pushScriptHistory: (s: string) => void;
  undoScript: () => void;
  scriptHistory: string[];
  setScriptHistory: React.Dispatch<React.SetStateAction<string[]>>;
  applyDraftFromCampaign: (existing: VoiceCampaign, restoredLanguage: string, restoredTemplate: VoiceCampaignTemplate) => void;
}

export interface CampaignDraftRefs {
  previousGeneratedScriptRef: React.MutableRefObject<string>;
  previousTemplateOpeningRef: React.MutableRefObject<string>;
  autoRewrittenScriptKeysRef: React.MutableRefObject<Set<string>>;
  lastPersistedScriptRef: React.MutableRefObject<string>;
}

export interface CampaignDraftResult {
  state: CampaignDraftState;
  setters: CampaignDraftSetters;
  nodes: VoiceFlowNode[];
  edges: VoiceFlowEdge[];
  refs: CampaignDraftRefs;
}

export function useCampaignDraft({
  segments,
  offers,
  existingCampaignId,
  datasetId,
}: {
  segments: Segment[];
  offers: Purpose[];
  existingCampaignId: string | null;
  datasetId: string;
}): CampaignDraftResult {
  const { dataset } = useDataset();

  const [template, setTemplate] = useState<VoiceCampaignTemplate | null>(null);
  const [campaignName, setCampaignName] = useState("");
  const [firstMessage, setFirstMessage] = useState("");
  const [scriptText, setScriptText] = useState("");
  const { scriptHistory, setScriptHistory, pushHistory: pushScriptHistory, undoScript } = useScriptHistory(setScriptText);
  const [campaignBrief, setCampaignBrief] = useState("");
  const [segmentId, setSegmentId] = useState("");
  const [purposeId, setPurposeId] = useState("");
  const [customPurpose, setCustomPurpose] = useState<Purpose | null>(null);
  const [purposeSuggestions, setPurposeSuggestions] = useState<VoicePurposeSuggestion[]>([]);
  const [suggestingPurposes, setSuggestingPurposes] = useState(false);
  const [voice, setVoice] = useState(DEFAULT_GEMINI_VOICE);
  const [agentName, setAgentName] = useState(() => defaultAgentName(DEFAULT_GEMINI_VOICE));
  const [companyName, setCompanyName] = useState(() => dataset.companyName?.trim() || dataset.label || "");
  const [personaPrompt, setPersonaPrompt] = useState(() =>
    defaultVoiceCampaignPersonaPrompt(
      defaultAgentName(DEFAULT_GEMINI_VOICE),
      dataset.companyName?.trim() || dataset.label || "the company",
      geminiVoiceGender(DEFAULT_GEMINI_VOICE),
    ),
  );
  const [callProvider, setCallProvider] = useState<VoiceCallProvider>("plivo-gemini");
  const [language, setLanguage] = useState(DEFAULT_CAMPAIGN_LANGUAGE);
  const [successDefinition, setSuccessDefinition] = useState<VoiceCampaignSuccessDefinition>(
    () => defaultVoiceCampaignSuccessDefinition(),
  );
  const [experimentSplit, setExperimentSplit] = useState<VoiceCampaignExperimentSplit>(
    () => defaultVoiceCampaignExperimentSplit(),
  );
  const [phoneRaw, setPhoneRaw] = useState("");
  const [testNumbers, setTestNumbers] = useState<string[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [scriptOptions, setScriptOptions] = useState<VoiceScriptOption[]>([]);
  const [suggestingScripts, setSuggestingScripts] = useState(false);
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [rewritingScript, setRewritingScript] = useState(false);
  const [refineScriptFeedback, setRefineScriptFeedback] = useState("");
  const [refiningScript, setRefiningScript] = useState(false);
  const [diagnostics, setDiagnostics] = useState<CampaignDiagnostic[]>([]);

  const [nodes, setNodes, onNodesChange] = useNodesState<VoiceFlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<VoiceFlowEdge>([]);

  const previousTemplateOpeningRef = useRef("");
  const previousGeneratedScriptRef = useRef("");
  const lastPersistedScriptRef = useRef("");
  const autoRewrittenScriptKeysRef = useRef(new Set<string>());
  const previousSetupSegmentRef = useRef("");
  const previousSetupOfferRef = useRef("");
  const scriptWorkflowSyncLockRef = useRef(false);
  /** Bumped on workflow→script writes so stale debounced script→workflow timers abort. */
  const syncEpochRef = useRef(0);
  const lastWorkflowFingerprintRef = useRef("");
  const lastScriptSyncedRef = useRef("");
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const scriptTextRef = useRef(scriptText);
  nodesRef.current = nodes;
  edgesRef.current = edges;
  scriptTextRef.current = scriptText;

  // Derived
  const selectedSegment = segments.find((s) => s.id === segmentId);
  const selectedOffer = offers.find((o) => o.purposeId === purposeId) ??
    (customPurpose?.purposeId === purposeId ? customPurpose : undefined);
  const phoneNumbers = useMemo(() => parsePhoneNumbers(phoneRaw), [phoneRaw]);

  const voiceDatasetContext = useMemo<VoiceDatasetContext>(() => ({
    datasetId,
    label: dataset.label,
    companyName: companyName.trim() || dataset.companyName,
    entityName: dataset.entityName,
    systemContext: dataset.systemContext,
    domainHints: dataset.domainHints,
    welcomeSubtitle: dataset.welcomeSubtitle,
    reportMeta: dataset.reportMeta,
  }), [companyName, dataset, datasetId]);

  const selectedVoiceName = voice;
  const selectedVoiceDisplayName = geminiVoiceDisplayName(voice);
  const selectedVoiceGenderLabel = geminiVoiceGenderLabel(voice);
  const selectedVoiceLabel = `${selectedVoiceDisplayName} (${selectedVoiceGenderLabel})`;
  const showVoiceSelector = true;

  // Script → Workflow (debounced). Keeps node talk-track aligned with Script-tab edits.
  useEffect(() => {
    if (!template) {
      previousGeneratedScriptRef.current = "";
      lastWorkflowFingerprintRef.current = "";
      lastScriptSyncedRef.current = "";
      return;
    }
    if (scriptWorkflowSyncLockRef.current) return;
    if (!scriptText.trim() || nodesRef.current.length === 0) return;
    if (scriptText === lastScriptSyncedRef.current) return;

    const epochAtSchedule = syncEpochRef.current;
    const timer = window.setTimeout(() => {
      if (scriptWorkflowSyncLockRef.current) return;
      // Workflow edit happened after this timer was scheduled — do not clobber nodes.
      if (syncEpochRef.current !== epochAtSchedule) return;
      if (scriptTextRef.current !== scriptText) return;
      const currentNodes = nodesRef.current;
      const currentEdges = edgesRef.current;
      if (currentNodes.length === 0) return;

      const currentFp = workflowScriptFingerprint(currentNodes, currentEdges);
      const applied = applyScriptToWorkflow(scriptText, currentNodes, currentEdges);
      const nextFp = workflowScriptFingerprint(applied.nodes, applied.edges);
      if (nextFp === currentFp) {
        lastScriptSyncedRef.current = scriptText;
        lastWorkflowFingerprintRef.current = currentFp;
        previousGeneratedScriptRef.current = buildEditableCallScript({
          nodes: currentNodes,
          edges: currentEdges,
        });
        return;
      }

      scriptWorkflowSyncLockRef.current = true;
      syncEpochRef.current += 1;
      lastWorkflowFingerprintRef.current = nextFp;
      lastScriptSyncedRef.current = scriptText;
      previousGeneratedScriptRef.current = buildEditableCallScript({
        nodes: applied.nodes,
        edges: applied.edges,
      });
      setNodes(applied.nodes);
      setEdges(applied.edges);
      setTemplate((current) =>
        current ? { ...current, nodes: applied.nodes, edges: applied.edges } : current,
      );
      nodesRef.current = applied.nodes;
      edgesRef.current = applied.edges;
      queueMicrotask(() => {
        scriptWorkflowSyncLockRef.current = false;
      });
    }, 350);

    return () => window.clearTimeout(timer);
  }, [scriptText, template, setNodes, setEdges, setTemplate]);

  // Workflow → Script when talk-track content changes (node drag/position alone does not).
  useEffect(() => {
    if (!template || scriptWorkflowSyncLockRef.current) return;
    if (nodes.length === 0) return;
    const fp = workflowScriptFingerprint(nodes, edges);
    if (!lastWorkflowFingerprintRef.current) {
      lastWorkflowFingerprintRef.current = fp;
      if (!scriptTextRef.current.trim()) {
        const nextScript = buildEditableCallScript({ nodes, edges });
        scriptWorkflowSyncLockRef.current = true;
        syncEpochRef.current += 1;
        setScriptText(nextScript);
        scriptTextRef.current = nextScript;
        lastScriptSyncedRef.current = nextScript;
        previousGeneratedScriptRef.current = nextScript;
        queueMicrotask(() => {
          scriptWorkflowSyncLockRef.current = false;
        });
      } else {
        lastScriptSyncedRef.current = scriptTextRef.current;
      }
      return;
    }
    if (fp === lastWorkflowFingerprintRef.current) return;

    scriptWorkflowSyncLockRef.current = true;
    syncEpochRef.current += 1;
    lastWorkflowFingerprintRef.current = fp;
    const nextScript = applyWorkflowToScript(scriptTextRef.current, nodes, edges);
    setScriptText(nextScript);
    scriptTextRef.current = nextScript;
    lastScriptSyncedRef.current = nextScript;
    previousGeneratedScriptRef.current = buildEditableCallScript({ nodes, edges });
    setTemplate((current) => (current ? { ...current, nodes, edges } : current));
    queueMicrotask(() => {
      scriptWorkflowSyncLockRef.current = false;
    });
  }, [nodes, edges, template, setScriptText, setTemplate]);

  const updateFlowNode = useCallback((nodeId: string, patch: Partial<VoiceFlowNodeData>) => {
    const nextNodes = nodesRef.current.map((node) => {
      if (node.id !== nodeId) return node;
      // Inspector edits to talk-track content are operator overrides — verbatim
      // client copy is tracked, not blocked.
      const contentEdited =
        (patch.title !== undefined && patch.title !== node.data.title) ||
        (patch.body !== undefined && patch.body !== node.data.body) ||
        (patch.helper !== undefined && patch.helper !== node.data.helper);
      return {
        ...node,
        data: {
          ...node.data,
          ...patch,
          ...(contentEdited ? { provenance: "operator" as const } : {}),
        },
      };
    });
    const currentEdges = edgesRef.current;
    const nextScript = applyWorkflowToScript(scriptTextRef.current, nextNodes, currentEdges);
    const nextFp = workflowScriptFingerprint(nextNodes, currentEdges);

    // Invalidate any pending script→workflow debounce before state updates flush.
    scriptWorkflowSyncLockRef.current = true;
    syncEpochRef.current += 1;
    lastWorkflowFingerprintRef.current = nextFp;
    lastScriptSyncedRef.current = nextScript;
    previousGeneratedScriptRef.current = buildEditableCallScript({
      nodes: nextNodes,
      edges: currentEdges,
    });
    nodesRef.current = nextNodes;
    scriptTextRef.current = nextScript;

    setNodes(nextNodes);
    setScriptText(nextScript);
    setTemplate((current) =>
      current ? { ...current, nodes: nextNodes, edges: currentEdges } : current,
    );
    queueMicrotask(() => {
      scriptWorkflowSyncLockRef.current = false;
    });
  }, [setNodes, setScriptText, setTemplate]);

  // Shared bookkeeping for structural workflow edits (insert/remove). Mirrors
  // updateFlowNode: the sync lock + epoch bump stop the debounced
  // script→workflow pass from clobbering the new structure mid-flight.
  const commitWorkflowStructure = useCallback((nextNodes: VoiceFlowNode[], nextEdges: VoiceFlowEdge[]) => {
    const nextScript = applyWorkflowToScript(scriptTextRef.current, nextNodes, nextEdges);
    const nextFp = workflowScriptFingerprint(nextNodes, nextEdges);

    scriptWorkflowSyncLockRef.current = true;
    syncEpochRef.current += 1;
    lastWorkflowFingerprintRef.current = nextFp;
    lastScriptSyncedRef.current = nextScript;
    previousGeneratedScriptRef.current = buildEditableCallScript({
      nodes: nextNodes,
      edges: nextEdges,
    });
    nodesRef.current = nextNodes;
    edgesRef.current = nextEdges;
    scriptTextRef.current = nextScript;

    setNodes(nextNodes);
    setEdges(nextEdges);
    setScriptText(nextScript);
    setTemplate((current) =>
      current ? { ...current, nodes: nextNodes, edges: nextEdges } : current,
    );
    queueMicrotask(() => {
      scriptWorkflowSyncLockRef.current = false;
    });
  }, [setNodes, setEdges, setScriptText, setTemplate]);

  const insertFlowNode = useCallback((afterNodeId: string | null, kind: VoiceFlowNodeKind): string | null => {
    const currentNodes = nodesRef.current;
    if (currentNodes.length === 0) return null;

    let anchorIndex = afterNodeId
      ? currentNodes.findIndex((node) => node.id === afterNodeId)
      : -1;
    if (anchorIndex < 0) {
      // Default anchor: the last non-end step, so appended steps land before the close.
      anchorIndex = currentNodes.length - 1;
      for (let i = currentNodes.length - 1; i >= 0; i -= 1) {
        if (currentNodes[i]!.data.kind !== "end") {
          anchorIndex = i;
          break;
        }
      }
    }
    const anchor = currentNodes[anchorIndex]!;
    const id = `step-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const newNode: VoiceFlowNode = {
      id,
      type: "voiceNode",
      // Placeholder — layoutVoiceWorkflow assigns the real position below.
      position: { x: anchor.position.x, y: anchor.position.y + 1 },
      data: {
        kind,
        title: NEW_NODE_TITLES[kind],
        body: "(Write what the agent should say or do at this step.)",
        required: false,
        provenance: "operator",
      },
    };

    const outgoing = edgesRef.current.filter((edge) => edge.source === anchor.id);
    let nextEdges: VoiceFlowEdge[];
    if (kind !== "end" && outgoing.length === 1) {
      // Splice into the single path: anchor → new → old target. The label
      // describes the condition leaving the anchor, so it stays on that leg.
      const through = outgoing[0]!;
      const label = typeof through.label === "string" ? through.label : undefined;
      nextEdges = edgesRef.current
        .filter((edge) => edge.id !== through.id)
        .concat(makeFlowEdge(anchor.id, id, label), makeFlowEdge(id, through.target));
    } else {
      // Branching anchor (or a new end node): add a new leg rather than
      // guessing which existing branch to break.
      nextEdges = [...edgesRef.current, makeFlowEdge(anchor.id, id)];
    }

    const inserted = [
      ...currentNodes.slice(0, anchorIndex + 1),
      newNode,
      ...currentNodes.slice(anchorIndex + 1),
    ];
    commitWorkflowStructure(layoutVoiceWorkflow(inserted, nextEdges), nextEdges);
    return id;
  }, [commitWorkflowStructure]);

  const removeFlowNode = useCallback((nodeId: string) => {
    const currentNodes = nodesRef.current;
    const target = currentNodes.find((node) => node.id === nodeId);
    if (!target || target.data.kind === "start" || currentNodes.length <= 1) return;

    const remaining = currentNodes.filter((node) => node.id !== nodeId);
    const incoming = edgesRef.current.filter((edge) => edge.target === nodeId);
    const outgoing = edgesRef.current.filter((edge) => edge.source === nodeId);
    const untouched = edgesRef.current.filter(
      (edge) => edge.source !== nodeId && edge.target !== nodeId,
    );

    // Bridge every parent to every child. The parent edge's label described the
    // route into the removed node, so it wins; the child's label is the fallback.
    const seen = new Set(untouched.map((edge) => `${edge.source}->${edge.target}`));
    const bridged: VoiceFlowEdge[] = [];
    for (const parent of incoming) {
      for (const child of outgoing) {
        if (parent.source === child.target) continue;
        const key = `${parent.source}->${child.target}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const parentLabel = typeof parent.label === "string" && parent.label.trim() ? parent.label : undefined;
        const childLabel = typeof child.label === "string" && child.label.trim() ? child.label : undefined;
        bridged.push(makeFlowEdge(parent.source, child.target, parentLabel ?? childLabel));
      }
    }

    const nextEdges = [...untouched, ...bridged];
    commitWorkflowStructure(layoutVoiceWorkflow(remaining, nextEdges), nextEdges);
  }, [commitWorkflowStructure]);

  // Sync firstMessage from template context
  useEffect(() => {
    if (!template) { previousTemplateOpeningRef.current = ""; return; }
    const nextOpening = renderVoiceTemplateText(template.firstMessage, voiceDatasetContext);
    const previousOpening = previousTemplateOpeningRef.current;
    setFirstMessage((current) => {
      if (!current.trim() || current === previousOpening || current === template.firstMessage) return nextOpening;
      return current;
    });
    previousTemplateOpeningRef.current = nextOpening;
  }, [template, voiceDatasetContext]);

  // Reset draft when segment changes (new campaign only)
  useEffect(() => {
    if (existingCampaignId) { previousSetupSegmentRef.current = segmentId; return; }
    if (!segmentId || !previousSetupSegmentRef.current) { previousSetupSegmentRef.current = segmentId; return; }
    if (previousSetupSegmentRef.current === segmentId) return;
    setPurposeId(""); setCustomPurpose(null); setPurposeSuggestions([]); setScriptOptions([]);
    setCampaignBrief(""); setTemplate(null); setFirstMessage(""); setScriptText(""); setNodes([]); setEdges([]);
    setDiagnostics([]);
    previousSetupSegmentRef.current = segmentId;
    previousSetupOfferRef.current = "";
  }, [existingCampaignId, segmentId, setEdges, setNodes]);

  // Reset script when offer changes (new campaign only)
  useEffect(() => {
    if (existingCampaignId) { previousSetupOfferRef.current = purposeId; return; }
    if (!purposeId || !previousSetupOfferRef.current) { previousSetupOfferRef.current = purposeId; return; }
    if (previousSetupOfferRef.current === purposeId) return;
    setScriptOptions([]); setTemplate(null); setFirstMessage(""); setScriptText(""); setNodes([]); setEdges([]);
    setDiagnostics([]);
    previousSetupOfferRef.current = purposeId;
  }, [existingCampaignId, purposeId, setEdges, setNodes]);

  // Auto-select recommended offer when template is applied
  useEffect(() => {
    if (!template || offers.length === 0 || purposeId) return;
    const recommended = offers.find((o) => o.purposeId === template.recommendedOfferId);
    if (recommended) setPurposeId(recommended.purposeId);
  }, [purposeId, offers, template]);

  // Load saved test numbers on mount
  useEffect(() => { setTestNumbers(loadTestNumbers()); }, []);

  // Called by persistence hook to apply loaded campaign data into draft state
  const applyDraftFromCampaign = useCallback((
    existing: VoiceCampaign,
    restoredLanguage: string,
    restoredTemplate: VoiceCampaignTemplate,
  ) => {
    setCampaignName(existing.name);
    setFirstMessage(existing.firstMessage);
    setSegmentId(existing.segmentId);
    setPurposeId(existing.purposeId);
    setCustomPurpose(
      offers.some((offer) => offer.purposeId === existing.purposeId)
        ? null
        : buildCampaignBriefPurpose(existing.name, {
            purposeId: existing.purposeId,
            name: existing.purposeName,
          }),
    );
    setLanguage(restoredLanguage);
    setVoice(existing.voice || DEFAULT_GEMINI_VOICE);
    const restoredAgentName = existing.voiceName || defaultAgentName(existing.voice);
    setAgentName(restoredAgentName);
    const restoredCompany =
      existing.companyName?.trim() || dataset.companyName?.trim() || dataset.label || "";
    setCompanyName(restoredCompany);
    setPersonaPrompt(
      existing.personaPrompt?.trim() ||
        defaultVoiceCampaignPersonaPrompt(
          restoredAgentName,
          restoredCompany || "the company",
          geminiVoiceGender(existing.voice || existing.voiceName || ""),
        ),
    );
    setCallProvider(existing.callProvider ?? "plivo-gemini");
    setPhoneRaw((existing.phoneNumbers ?? []).join("\n"));
    const hasWorkflow = (existing.workflow?.nodes?.length ?? 0) > 0;
    // Script-only campaigns (script-first live tests, pre-workflow records) get a
    // workflow synthesized from the script so the Workflow tab and sync work.
    const bootstrapped = !hasWorkflow && existing.editableScript?.trim()
      ? bootstrapWorkflowFromScript(existing.editableScript)
      : null;
    // Carry the stored routes onto the restored template so the open-items
    // panel and buildCompiled see them — otherwise a saved campaign with all
    // ten routes reports every one of them missing.
    const storedRoutes = existing.workflow?.universalRoutes;
    const workflowTemplate = hasWorkflow
      ? { ...restoredTemplate, ...(storedRoutes ? { universalRoutes: storedRoutes } : {}) }
      : bootstrapped
        ? { ...restoredTemplate, nodes: bootstrapped.nodes, edges: bootstrapped.edges, ...(storedRoutes ? { universalRoutes: storedRoutes } : {}) }
        : null;
    setTemplate(workflowTemplate);
    setNodes(workflowTemplate?.nodes ?? []);
    setEdges(workflowTemplate?.edges ?? []);
    setSuccessDefinition(normalizeVoiceCampaignSuccessDefinition(existing.successDefinition));
    setExperimentSplit(normalizeVoiceCampaignExperimentSplit(existing.experimentSplit));

    const generatedScript = workflowTemplate
      ? buildEditableCallScript({ nodes: workflowTemplate.nodes, edges: workflowTemplate.edges })
      : "";
    const restoredScript = existing.editableScript ?? generatedScript;
    scriptWorkflowSyncLockRef.current = true;
    if (workflowTemplate && restoredScript.trim()) {
      const synced = applyScriptToWorkflow(
        restoredScript,
        workflowTemplate.nodes,
        workflowTemplate.edges,
      );
      setNodes(synced.nodes);
      setEdges(synced.edges);
      lastWorkflowFingerprintRef.current = workflowScriptFingerprint(synced.nodes, synced.edges);
      previousGeneratedScriptRef.current = buildEditableCallScript({
        nodes: synced.nodes,
        edges: synced.edges,
      });
    } else {
      lastWorkflowFingerprintRef.current = workflowTemplate
        ? workflowScriptFingerprint(workflowTemplate.nodes, workflowTemplate.edges)
        : "";
      previousGeneratedScriptRef.current = generatedScript;
    }
    setScriptText(restoredScript);
    lastScriptSyncedRef.current = restoredScript;
    lastPersistedScriptRef.current = restoredScript;
    queueMicrotask(() => {
      scriptWorkflowSyncLockRef.current = false;
    });
  }, [dataset, offers, setEdges, setNodes]);

  const state: CampaignDraftState = {
    template, campaignName, firstMessage, scriptText, campaignBrief,
    segmentId, purposeId, voice, agentName, companyName, personaPrompt, callProvider, language,
    successDefinition, experimentSplit, phoneRaw, testNumbers, selectedNodeId,
    purposeSuggestions, suggestingPurposes, scriptOptions, suggestingScripts,
    generatingDraft, rewritingScript, refineScriptFeedback, refiningScript,
    diagnostics,
    selectedSegment, selectedOffer, phoneNumbers, voiceDatasetContext,
    selectedVoiceName, selectedVoiceLabel, showVoiceSelector,
  };

  const setters: CampaignDraftSetters = {
    setTemplate, setCampaignName, setFirstMessage, setScriptText, setCampaignBrief,
    setSegmentId, setPurposeId, setCustomPurpose, setVoice, setAgentName, setCompanyName, setPersonaPrompt, setCallProvider, setLanguage,
    setSuccessDefinition, setExperimentSplit, setPhoneRaw, setTestNumbers, setSelectedNodeId,
    setPurposeSuggestions, setSuggestingPurposes, setScriptOptions, setSuggestingScripts,
    setGeneratingDraft, setRewritingScript, setRefineScriptFeedback, setRefiningScript,
    setDiagnostics,
    setNodes, setEdges, onNodesChange, onEdgesChange, updateFlowNode, insertFlowNode, removeFlowNode,
    pushScriptHistory, undoScript, scriptHistory, setScriptHistory,
    applyDraftFromCampaign,
  };

  return { state, setters, nodes, edges, refs: { previousGeneratedScriptRef, previousTemplateOpeningRef, autoRewrittenScriptKeysRef, lastPersistedScriptRef } };
}
