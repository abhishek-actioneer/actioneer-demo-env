import { describe, expect, it } from "vitest";
import {
  buildVoiceCallEvalContextSnapshot,
  buildVoiceEvalCallContext,
} from "@/lib/server/voice-eval-context";
import type { VoiceCall, VoiceCampaign } from "@/lib/voice-campaign-types";
import { DEFAULT_VOICE_EVAL_CONTEXT_SOURCES } from "@/lib/voice-evals";

function campaign(): VoiceCampaign {
  return {
    id: "campaign-1",
    userId: "user-1",
    name: "Renewal calls",
    datasetId: "quickhelp",
    segmentId: "segment-1",
    segmentName: "Renewals",
    purposeId: "renewal",
    purposeName: "Confirm renewal intent",
    systemPrompt: "Follow the approved renewal workflow.",
    firstMessage: "Hello, is now a good time?",
    scriptReasoning: "Test campaign",
    agentId: "gemini-live",
    voice: "Aoede",
    language: "English",
    phoneNumbers: ["+919876543210"],
    status: "completed",
    calls: [],
    createdAt: "2026-07-20T09:00:00.000Z",
    workflow: {
      templateId: "workflow-1",
      templateTitle: "Renewal workflow",
      nodes: [{
        id: "start",
        type: "voiceNode",
        position: { x: 0, y: 0 },
        data: { kind: "question", title: "Confirm availability", body: "Ask whether now is a good time." },
      }],
      edges: [],
    },
  };
}

function call(): VoiceCall {
  return {
    id: "call-1",
    callConfigId: "config-1",
    provider: "plivo",
    toNumber: "+919876543210",
    status: "completed",
    durationSeconds: 42,
    engaged: true,
    startedAt: "2026-07-20T09:01:00.000Z",
    endedAt: "2026-07-20T09:01:42.000Z",
    transcript: [
      { id: "t1", role: "assistant", text: "Please confirm +91 98765 43210.", at: "2026-07-20T09:01:01.000Z" },
      { id: "t2", role: "user", text: "Email me at person@example.com.", at: "2026-07-20T09:01:04.000Z" },
    ],
  };
}

describe("voice eval context", () => {
  it("includes only selected sources and marks missing instrumentation unavailable", () => {
    const context = buildVoiceEvalCallContext({
      userId: "user-1",
      datasetId: "quickhelp",
      campaign: campaign(),
      call: call(),
      selectedSources: ["transcript", "call-metadata", "tool-logs"],
    });

    expect(context.blocks.map((block) => block.source)).toEqual([
      "transcript",
      "call-metadata",
      "tool-logs",
    ]);
    expect(context.blocks[2]).toMatchObject({ available: false });
    expect(JSON.stringify(context)).not.toContain("agent-config");
  });

  it("redacts phone numbers, email addresses, and secret-shaped variable fields", () => {
    const evalCall = call();
    evalCall.recipientContext = {
      source: "generic",
      datasetId: "quickhelp",
      rawFields: {
        email: "person@example.com",
        api_token: "should-not-leak",
      },
    };
    const context = buildVoiceEvalCallContext({
      userId: "user-1",
      datasetId: "quickhelp",
      campaign: campaign(),
      call: evalCall,
      selectedSources: ["transcript", "call-metadata", "variables"],
    });
    const serialized = JSON.stringify(context);

    expect(serialized).not.toContain("9876543210");
    expect(serialized).not.toContain("person@example.com");
    expect(serialized).not.toContain("should-not-leak");
    expect(serialized).toContain("[REDACTED]");
  });

  it("uses immutable call-time configuration snapshots after a campaign is edited", () => {
    const originalCampaign = campaign();
    const evalCall = call();
    evalCall.evalContextSnapshot = buildVoiceCallEvalContextSnapshot({
      campaign: originalCampaign,
      systemPrompt: originalCampaign.systemPrompt,
      firstMessage: originalCampaign.firstMessage,
      contactMemory: "Customer previously requested a morning callback.",
    });
    originalCampaign.systemPrompt = "A newly edited prompt.";
    originalCampaign.workflow!.templateTitle = "New workflow title";

    const context = buildVoiceEvalCallContext({
      userId: "user-1",
      datasetId: "quickhelp",
      campaign: originalCampaign,
      call: evalCall,
      selectedSources: ["agent-config", "workflow-config", "contact-memory"],
    });
    const serialized = JSON.stringify(context);

    expect(serialized).toContain("Follow the approved renewal workflow.");
    expect(serialized).toContain("Renewal workflow");
    expect(serialized).not.toContain("A newly edited prompt.");
    expect(serialized).not.toContain("New workflow title");
    expect(context.blocks.every((block) => block.provenance === "call_time_snapshot")).toBe(true);
  });

  it("keeps model-generated analysis and raw webhooks out of the default source set", () => {
    expect(DEFAULT_VOICE_EVAL_CONTEXT_SOURCES).not.toContain("analysis");
    expect(DEFAULT_VOICE_EVAL_CONTEXT_SOURCES).not.toContain("webhook-payloads");
  });

  it("normalizes legacy workflow source ids", () => {
    const context = buildVoiceEvalCallContext({
      userId: "user-1",
      datasetId: "quickhelp",
      campaign: campaign(),
      call: call(),
      selectedSources: ["pathway-semantics", "pathway-config"],
    });

    expect(context.blocks.map((block) => block.source)).toEqual([
      "workflow-semantics",
      "workflow-config",
    ]);
  });
});
