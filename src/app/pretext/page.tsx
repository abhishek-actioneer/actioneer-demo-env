"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { PretextReport } from "@/components/pretext/pretext-report";
import { ChatInput } from "@/components/chat/chat-input";
import { useAnalytics } from "@/hooks/use-analytics";
import { useDataset } from "@/lib/dataset-context";
import type { ChatMessage } from "@/lib/types";
import type { PanelState } from "@/hooks/use-panel";
import { Loader2 } from "lucide-react";

export default function PretextPage() {
  const { datasetId } = useDataset();

  // ── Local chat state (no providers needed) ──
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const agentMsgIdRef = useRef("");
  const messagesRef = useRef(messages);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // ── useAnalytics with no-op callbacks ──
  const noOpPanel = useCallback((_p: PanelState) => {}, []);
  const noOpVoid = useCallback(() => {}, []);
  const noOpAsync = useCallback(async () => {}, []);
  const noOpPhase = useCallback((_p: string | null) => {}, []);

  const analytics = useAnalytics({
    messages,
    setMessages,
    activeConvId,
    setActiveConvId,
    isProcessing,
    setIsProcessing,
    agentMsgIdRef,
    messagesRef,
    refreshChats: noOpVoid,
    notifyCreditChanged: noOpVoid,
    setPanel: noOpPanel,
    datasetId,
    handlePlaybookCreate: noOpAsync,
    setProcessingPhase: noOpPhase,
  });

  // ── Derive content for PretextReport ──
  const latestAssistant = messages.findLast((m) => m.role === "sentinel");
  const reportContent = analytics.generatedReport || latestAssistant?.content || "";

  // Auto-scroll during streaming
  useEffect(() => {
    if (isProcessing && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [reportContent, isProcessing]);

  // Deep research on by default
  useEffect(() => {
    if (!analytics.deepResearch) {
      analytics.setDeepResearch(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col h-full min-w-0">
      {/* Header */}
      <div className="border-b border-border px-6 py-3 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-base font-semibold">Pretext Layout Engine</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Magazine-style report with resizable charts — drag chart edges to resize
          </p>
        </div>
        {reportContent && (
          <button
            onClick={() => {
              setMessages([]);
              setActiveConvId(null);
            }}
            className="px-3 py-1.5 text-xs rounded-md bg-muted hover:bg-muted/80 text-muted-foreground transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Report area + overlaid chat input */}
      <div className="flex-1 min-h-0 relative">
        <div className="absolute inset-0 overflow-y-auto" ref={scrollRef}>
          <div className="max-w-5xl mx-auto px-8 py-8 pb-40">
            {isProcessing && !reportContent && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Generating research report...</span>
              </div>
            )}

            {reportContent && (
              <PretextReport content={reportContent} />
            )}

            {!reportContent && !isProcessing && (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <p className="text-muted-foreground text-sm">
                  Ask a question to generate a magazine-style research report
                </p>
              </div>
            )}

            {isProcessing && reportContent && (
              <span className="inline-block w-2 h-4 bg-foreground/60 animate-pulse rounded-sm ml-1" />
            )}
          </div>
        </div>

        {/* Chat input — overlaid at bottom */}
        <div className="absolute bottom-0 left-0 right-0 z-10">
          <div className="max-w-5xl mx-auto px-8">
            <ChatInput
              onSend={analytics.handleSend}
              onStop={analytics.handleStop}
              deepResearch={analytics.deepResearch}
              onToggleDeepResearch={() => analytics.setDeepResearch((d) => !d)}
              isProcessing={isProcessing}
              dropUp
            />
          </div>
        </div>
      </div>
    </div>
  );
}
