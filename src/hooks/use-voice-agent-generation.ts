"use client";

import { useCallback } from "react";
import { apiFetch } from "@/lib/api-client";
import type { ChatMessage, SegmentDisplay } from "@/lib/types";
import {
  type VoiceAgentGenerationEvent,
  type VoiceAgentBuildEvent,
  type VoiceAgentGenerationResult,
  type VoiceAgentPromptContext,
} from "@/lib/voice-agent-generation-types";

export interface GenerateVoiceAgentInput {
  goal: string;
  requestId: string;
  context?: VoiceAgentPromptContext;
  resolvedSegmentId?: string;
  targetDescription?: string | null;
  signal: AbortSignal;
}

interface UseVoiceAgentGenerationArgs {
  datasetId: string;
  segments: SegmentDisplay[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  refreshVoiceCampaigns: () => Promise<void>;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function resolveSegment(
  segments: SegmentDisplay[],
  goal: string,
  context?: VoiceAgentPromptContext,
  resolvedSegmentId?: string,
  targetDescription?: string | null,
): SegmentDisplay | undefined {
  const directId = context?.segmentId || resolvedSegmentId;
  if (directId) {
    const direct = segments.find((segment) => segment.id === directId);
    if (direct) return direct;
  }

  const target = normalize(context?.segmentName || targetDescription || "");
  if (target) {
    const exact = segments.find((segment) => normalize(segment.name) === target);
    if (exact) return exact;
    const close = segments.filter((segment) => {
      const name = normalize(segment.name);
      return target.includes(name) || name.includes(target);
    });
    if (close.length === 1) return close[0];
  }

  const normalizedGoal = normalize(goal);
  return [...segments]
    .sort((a, b) => b.name.length - a.name.length)
    .find((segment) => normalizedGoal.includes(normalize(segment.name)));
}

function errorFromResponse(text: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: string };
    return parsed.error || "Voice agent generation failed";
  } catch {
    return text.trim() || "Voice agent generation failed";
  }
}

function upsertBuildEvent(events: VoiceAgentBuildEvent[], event: VoiceAgentBuildEvent): VoiceAgentBuildEvent[] {
  const existingIndex = events.findIndex((candidate) => candidate.type === event.type && candidate.id === event.id);
  if (existingIndex < 0) return [...events, event];
  return events.map((candidate, index) => index === existingIndex ? event : candidate);
}

export function useVoiceAgentGeneration({
  datasetId,
  segments,
  setMessages,
  refreshVoiceCampaigns,
}: UseVoiceAgentGenerationArgs) {
  const generateVoiceAgent = useCallback(async ({
    goal,
    requestId,
    context,
    resolvedSegmentId,
    targetDescription,
    signal,
  }: GenerateVoiceAgentInput): Promise<VoiceAgentGenerationResult | undefined> => {
    const cardId = `voice-agent-generation-${requestId}`;
    const selectedSegment = resolveSegment(segments, goal, context, resolvedSegmentId, targetDescription);
    const initialCard: ChatMessage = {
      id: cardId,
      role: "sentinel",
      content: "",
      timestamp: Date.now(),
      variant: "voice-agent-generation",
      voiceAgentGeneration: {
        status: selectedSegment ? "generating" : "error",
        requestId,
        goal,
        datasetId,
        segmentId: selectedSegment?.id || context?.segmentId,
        segmentName: selectedSegment?.name || context?.segmentName,
        segmentUserCount: selectedSegment?.userCount ?? context?.segmentUserCount,
        buildEvents: [],
        ...(!selectedSegment ? { error: "Select a saved audience segment, then try again." } : {}),
      },
    };

    setMessages((previous) => {
      const existingIndex = previous.findIndex((message) => message.id === cardId);
      if (existingIndex < 0) return [...previous, initialCard];
      return previous.map((message) => message.id === cardId ? initialCard : message);
    });
    if (!selectedSegment) return undefined;

    try {
      const response = await apiFetch("/api/voice-campaigns/generate-agent", {
        method: "POST",
        body: {
          requestId,
          goal,
          segmentId: selectedSegment.id,
        },
        datasetId,
        signal,
        stream: true,
      });
      if (!response.ok || !response.body) {
        throw new Error(errorFromResponse(await response.text()));
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let result: VoiceAgentGenerationResult | undefined;
      let terminalError: string | undefined;
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as VoiceAgentGenerationEvent;
          if (event.type === "status") {
            setMessages((previous) => previous.map((message) => {
              if (message.id !== cardId || !message.voiceAgentGeneration) return message;
              return {
                ...message,
                voiceAgentGeneration: {
                  ...message.voiceAgentGeneration,
                  status: "generating",
                  currentStatus: event.status,
                },
              };
            }));
          }
          if (event.type === "build") {
            setMessages((previous) => previous.map((message) => {
              if (message.id !== cardId || !message.voiceAgentGeneration) return message;
              return {
                ...message,
                voiceAgentGeneration: {
                  ...message.voiceAgentGeneration,
                  buildEvents: upsertBuildEvent(message.voiceAgentGeneration.buildEvents ?? [], event.event),
                },
              };
            }));
          }
          if (event.type === "result") result = event.result;
          if (event.type === "error") terminalError = event.error;
        }
        if (done) break;
      }
      if (terminalError) throw new Error(terminalError);
      if (!result) throw new Error("Generation ended before the agent was saved");

      setMessages((previous) => previous.map((message) => {
        if (message.id !== cardId || !message.voiceAgentGeneration) return message;
        return {
          ...message,
          voiceAgentGeneration: {
            ...message.voiceAgentGeneration,
            status: "created",
            currentStatus: undefined,
            result,
            error: undefined,
          },
        };
      }));
      await refreshVoiceCampaigns();
      return result;
    } catch (error) {
      if (signal.aborted) return undefined;
      setMessages((previous) => previous.map((message) => {
        if (message.id !== cardId || !message.voiceAgentGeneration) return message;
        return {
          ...message,
          voiceAgentGeneration: {
            ...message.voiceAgentGeneration,
            status: "error",
            error: error instanceof Error ? error.message : "Voice agent generation failed",
          },
        };
      }));
      return undefined;
    }
  }, [datasetId, refreshVoiceCampaigns, segments, setMessages]);

  return { generateVoiceAgent };
}
