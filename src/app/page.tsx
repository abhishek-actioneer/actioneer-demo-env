"use client";

import { useCallback, useEffect, useState, Suspense } from "react";
import { ErrorBoundary } from "@/components/error-boundary";
import { ChatWelcome } from "@/components/chat/chat-welcome";
import { ChatInput } from "@/components/chat/chat-input";
import { ChatThread } from "@/components/chat/chat-thread";
import { TaskPanel } from "@/components/chat/task-panel";
import { SourcesPanel } from "@/components/chat/sources-panel";
import { ResizablePanel } from "@/components/chat/resizable-panel";
import { CreateSegmentModal } from "@/components/segments/create-segment-modal";
import { useRouter, useSearchParams } from "next/navigation";
import { useSidebarContext } from "@/components/sidebar-context";
import { useChatState } from "@/components/chat/chat-state-provider";
import Link from "next/link";
import { Phone, Workflow } from "lucide-react";
import type { VoiceAgentPrompt } from "@/lib/voice-agent-generation-types";

// ── Main component ──

export default function Home() {
  return (
    <ErrorBoundary>
      <Suspense>
        <HomeInner />
      </Suspense>
    </ErrorBoundary>
  );
}

function HomeInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { notifyCanvasChanged } = useSidebarContext();
  const chat = useChatState();
  const [inputHasContent, setInputHasContent] = useState(false);

  // ── Handle ?segment= param ──
  const segmentParam = searchParams.get("segment");
  useEffect(() => {
    if (!segmentParam) return;
    try {
      const raw = sessionStorage.getItem("segment-context");
      if (!raw) return;
      const ctx = JSON.parse(raw) as { name?: string; traits?: string[]; differentiator?: string };
      sessionStorage.removeItem("segment-context");
      const trait = ctx.traits?.[0] ?? "behavior";
      const prompt = `Tell me more about the ${ctx.name} segment, specifically their ${trait} behavior and how it impacts revenue.`;
      chat.chatInputRef.current?.setValue(prompt);
      chat.chatInputRef.current?.focus();
      router.replace("/");
    } catch {
      // Ignore parse errors
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segmentParam]);

  // ── Handle ?playbook= param ──
  const playbookParam = searchParams.get("playbook");
  useEffect(() => {
    if (playbookParam && !chat.isProcessing) {
      router.replace("/");
      // Trigger playbook creation via send
      chat.handleSend(`/playbook "${playbookParam}"`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playbookParam]);

  // ── Render ──

  const hasMessages = chat.messages.length > 0;
  const isVoiceAgentConversation = chat.messages.some((message) => message.variant === "voice-agent-generation");
  const activeVoiceAgentContext = [...chat.messages].reverse().find((message) => message.voiceAgentGeneration)?.voiceAgentGeneration;
  const hasSidePanel = !!chat.panel.type;
  const handlePromptClick = useCallback(
    (prompt: VoiceAgentPrompt) => {
      chat.chatInputRef.current?.setValue(prompt.text);
      chat.chatInputRef.current?.setVoiceAgentContext(prompt.context);
      chat.chatInputRef.current?.focus();
    },
    [chat.chatInputRef],
  );

  return (
    <div className={`flex h-full min-w-0 ${hasSidePanel ? "gap-3 pr-3" : ""}`}>
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {!hasMessages && (
          <div className="flex h-14 shrink-0 items-center justify-end gap-2 border-b border-border bg-sidebar px-4">
            <Link
              href="/voice-campaigns/new"
              className="inline-flex h-8 items-center gap-2 border border-border bg-card px-3 text-sm font-medium transition-colors hover:bg-muted"
            >
              <Workflow className="size-3.5" />
              Build Workflow
            </Link>
            <Link
              href="/voice-campaigns"
              className="inline-flex h-8 items-center gap-2 border border-foreground bg-foreground px-3 text-sm font-medium text-background transition-opacity hover:opacity-85"
            >
              Send Call
              <Phone className="size-3.5" />
            </Link>
          </div>
        )}
        {chat.dbStatus === "offline" && (
          <div className="px-4 py-2 bg-muted border-b border-border text-foreground text-xs flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-foreground/50 shrink-0" />
            Database not connected. Run <code className="px-1 py-0.5 bg-foreground/10 rounded font-mono">npx tsx scripts/setup-data.ts</code> to set up the dataset.
            <button
              onClick={chat.checkHealth}
              className="ml-auto text-xs font-medium underline hover:no-underline shrink-0"
            >
              Retry
            </button>
          </div>
        )}
        <div className={`flex-1 min-h-0 ${hasMessages ? "relative" : "flex flex-col"}`}>
          {hasMessages ? (
            <>
              <ChatThread
                hideMinimap={chat.panel.type === "sources"}
                onChartPinned={notifyCanvasChanged}
                onAddToFollowUp={(text) => {
                  chat.chatInputRef.current?.setQuotedContext(text);
                }}
                onAddToKnowledge={(text) => {
                  chat.handleSaveToKnowledge(text, "global");
                }}
              />
              <div className="absolute bottom-0 left-0 right-0 z-10">
                <ChatInput
                  ref={chat.chatInputRef}
                  onSend={(text, entityContext, contextRefs, silentContext, options) => chat.handleSend(
                    text,
                    entityContext,
                    contextRefs,
                    silentContext,
                    isVoiceAgentConversation
                      ? {
                          ...options,
                          voiceAgentMode: true,
                          voiceAgentContext: options?.voiceAgentContext ?? (activeVoiceAgentContext ? {
                            datasetId: activeVoiceAgentContext.datasetId,
                            segmentId: activeVoiceAgentContext.segmentId,
                            segmentName: activeVoiceAgentContext.segmentName,
                            segmentUserCount: activeVoiceAgentContext.segmentUserCount,
                          } : undefined),
                        }
                      : options,
                  )}
                  onStop={chat.handleStop}
                  deepResearch={chat.deepResearch}
                  onToggleDeepResearch={() => chat.setDeepResearch((d) => !d)}
                  isProcessing={chat.isProcessing}
                  entityCatalog={chat.entityCatalog}
                  runCatalog={chat.runCatalog}
                  dropUp
                  hideDeepResearchToggle={isVoiceAgentConversation}
                  placeholder={isVoiceAgentConversation ? "Ask for changes to this agent..." : undefined}
                />
              </div>
            </>
          ) : (
            <ChatWelcome onPromptClick={handlePromptClick} hidePrompts={inputHasContent}>
              <ChatInput
                ref={chat.chatInputRef}
                onSend={chat.handleSend}
                onStop={chat.handleStop}
                deepResearch={chat.deepResearch}
                onToggleDeepResearch={() => chat.setDeepResearch((d) => !d)}
                isProcessing={chat.isProcessing}
                entityCatalog={chat.entityCatalog}
                runCatalog={chat.runCatalog}
                onInputChange={setInputHasContent}
                hideDeepResearchToggle
              />
            </ChatWelcome>
          )}
        </div>
      </div>

      {chat.panel.type === "task" && (
        <ResizablePanel defaultWidth={380} minWidth={300} maxWidth={600}>
          <TaskPanel
            agentMsgId={chat.panel.agentMsgId}
            selectedSubagentId={chat.panel.subagentId}
            messages={chat.messages}
            onClose={chat.handleClosePanel}
            onSubagentClick={chat.handleSubagentClick}
          />
        </ResizablePanel>
      )}
      {chat.panel.type === "sources" && (
        <ResizablePanel defaultWidth={400} minWidth={300} maxWidth={650}>
          <SourcesPanel
            agents={chat.sourcesAgents}
            highlightedQuery={chat.panel.highlightedQuery}
            onClose={chat.handleClosePanel}
          />
        </ResizablePanel>
      )}

      {chat.segmentModal && (
        <CreateSegmentModal
          open={chat.segmentModal.open}
          onOpenChange={(open) => {
            if (!open) chat.closeSegmentModal();
          }}
          defaultName={chat.segmentModal.defaultName}
          defaultSql={chat.segmentModal.sql}
          defaultUserCount={chat.segmentModal.userCount}
          onConfirm={chat.handleCreateSegment}
          isCreating={chat.isCreatingSegment}
        />
      )}
      {chat.segmentToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="flex items-center gap-3 bg-foreground text-background px-4 py-2.5 rounded-lg shadow-lg text-sm">
            <span className="w-2 h-2 rounded-full bg-background shrink-0" />
            <span>
              <strong>{chat.segmentToast.name}</strong> created
            </span>
            <button
              onClick={() => {
                router.push(`/segments/${chat.segmentToast!.id}`);
                chat.dismissSegmentToast();
              }}
              className="text-xs font-medium underline underline-offset-2 opacity-80 hover:opacity-100 transition-opacity"
            >
              View
            </button>
            <button
              onClick={chat.dismissSegmentToast}
              className="ml-1 opacity-60 hover:opacity-100 text-xs"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
